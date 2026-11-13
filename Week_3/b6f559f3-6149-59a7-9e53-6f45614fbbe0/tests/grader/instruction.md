# Tinderbox Optics Halation Studio

Halation Studio is a browser editor for layered, interactive 2D and 3D hero scenes, built for solo founders who design and ship their own product's marketing site. A founder builds a scene from 2D layers, 3D primitives, extruded type, uploaded glTF models, particle fields and cloth. They tune how the scene responds to the pointer, to scrolling and to three fixed breakpoints, then check every value in an inspector that reports exact numbers at any clock time. When the scene is ready, they publish it as a numbered, immutable version, and the embed on their site switches to the new version in place. The backend is one TypeScript server. It keeps every record in PostgreSQL, stores uploads, original imports and published scene bundles byte for byte in MinIO, and sends invites and publish notices through Mailpit. A WebSocket hub inside the same server carries live edits, presence, layer locks and new versions to open embeds. These things are out of scope: custom shader code, video layers and video export, any AI assistant, MCP access, outside sign-in, paid plans and watermarks, external assets, external fonts, and any datastore, cache or queue beyond the three services. Sign-in is local, with email and password. Text layers and extruded text use the system font stack or the built-in outline font generated in code. Matcaps, environment backgrounds and preset models are also generated in code, never shipped as files.

## Problem and users

A founder who wants a moving hero (a light field that leans toward the cursor, extruded type, a particle swarm that forms the logo, a camera that orbits as the page scrolls) has three bad options today. They can hand-write 3D code and lose weeks. They can use a no-code tool that locks scenes in a closed format. Or they can use a design tool where every re-export means re-pasting an embed that may still serve an old cached copy. None of these give numbered, immutable versions, so a half-finished edit can reach the live site and there is no clean way back. Nothing reports the exact colour, screen position or particle position at a given moment, so "the logo sits 40 px lower on tablet" costs an afternoon of guessing. Founders pay for this in lost launch days, contractor invoices and heroes that stutter on mid-range phones.

- **Owner (founder-owner)**, daily. Builds the hero with every breakpoint, previews it on the timeline clock, publishes numbered versions and points the live site's embed at them. Each project has exactly one owner.
- **Editor (invited editor)**, weekly. A contractor or co-founder who joins only through the single-use accept link in an invite mail. They tune layers, keyframes, variables and presets in the same project, live, without touching what is published. They receive a mail naming every version the owner publishes.
- **Viewer**, occasional. An advisor or early customer who opens the shared project read-only, scrubs the clock, switches breakpoints and reads the inspector to give exact feedback.
- **Embed visitor**, daily. An anonymous visitor to the founder's site who sees only the latest published version. It responds to pointer, scroll and breakpoint, and updates in place when a new version ships.

## Journeys

1. **Place a 3D object exactly.** Ines (owner) signs in by keyboard and opens Orbit study. She adds a Torus from `Add layer` without a mouse, sets its position with arrow keys, types a rotation and scales it with the drag gizmo. She reads the `Screen point` of its centre and of a corner vertex, then narrows the field of view and sees both readouts change. After a reload everything is still there.
2. **Make the logo out of light.** In Logo forge, Ines extrudes the word `HALO` and an uploaded one-path SVG, switches a material from matcap to glass, turns off depth testing and reads the draw order. She sends particles to form the wordmark and reads particle positions at chosen frames on the timeline. A three-path SVG and an unsupported character are refused with exact messages.
3. **Animate a model and a banner.** In Model bay, Ines uploads a small glTF, plays its clip, loops it at 1.5× speed and reads the node transform at set times. In Banner test, she reads cloth points at frames 0, 30 and 60 and checks the still frame-0 state with `Reduce motion` on.
4. **Tune the pointer response.** In Orbit study, Ines previews the scene, hovers the stage at three-quarter width and watches the tilt readouts count toward the target and ease back when the pointer leaves. She drags `Scroll progress` to orbit the camera. In a second browser, the published embed orbits as it is scrolled.
5. **Fit every breakpoint.** In Lumen hero, Ines overrides a rotation for Tablet, which Mobile inherits, and lowers a particle rate for Mobile. She resets one override and publishes. A phone-sized embed shows the Mobile values, and a desktop-sized one shows the Desktop values.
6. **Work together.** Ines invites Mara as Editor. Mara accepts from the mail, edits a model layer, and Ines sees it held and is refused. After the lock times out, Ines edits and both see each other's changes live. Tomas, a Viewer, watches with every edit control disabled. Presets switch the whole look live for everyone.
7. **Ship and roll back.** Ines publishes Lumen hero as version 1, and an open embed shows it. An unpublished edit stays out of the embed. Version 2 appears in the embed without a reload. `Republish version 1` ships version 3. Every owner and editor gets one mail per version. Mara cannot publish.
8. **Tidy up on a phone and bring in a file.** On a phone, Ines reorders, duplicates, groups and hides layers by touch, then undoes and redoes. She imports two broken JSON files, which are refused at the first problem, and one valid file, which becomes a new project whose original bytes download unchanged. She trashes a project and restores it intact.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health check** /app/run.json installs, builds and serves the app on port 4173 (or APP_PUBLIC_PORT), and GET /api/health answers as qualified in API.
- **DP-02 — Grading routes** With the right X-Grading-Key, the reset, seed and clock routes empty the store, create the published seed with every id and session, and move the server clock; without the key they answer 404.
- **DP-03 — Seeded sign-in** A seeded person signs in with email and password using only the keyboard, gets the hs_session cookie and lands on the project list; wrong credentials show the sign-in error.
- **DP-04 — Unseen projects answer 404** Any project, project API route or embed the requester can't open, including another workspace's, an unknown one, a purged one or an unpublished embed, answers 404, never 403.
- **DP-05 — One error order for every write** Every write checks sign-in, visibility, role, locks and state, validation, limits and storage in the published order and answers with the one published error shape.
- **DP-06 — Invites by mail** The owner invites an email as Editor or Viewer, Mailpit receives one invite with a single-use link valid for INVITE_TTL_HOURS, and accepting it is the only way to become a member.
- **DP-07 — Mail outage keeps mail queued** With Mailpit unreachable, invites and publishes still succeed, their mail waits in the outbox and shows as queued, and each queued mail is sent exactly once when mail works again.
- **DP-08 — Autosave and reload** Each change is saved within AUTOSAVE_MS of the last change while the save status shows its progress, and every saved change is still there after a reload.
- **DP-09 — Landing stage with Follow Light** The landing stage starts black, raises its light over 800 ms while the headline lines stagger in 60 ms apart, leans the light toward the pointer and settles back, with the published reduced-motion substitute.
- **DP-10 — Nocturnal panel look** Every screen uses the near-black inset panel stack, takes its violet light only from live canvases, and uses the grotesk-plus-serif headline and tabular figures described in Visual design.
- **DP-11 — Three viewports without overflow** At 375x812, 768x1024 and 1280x800 each screen shows its published layout with no horizontal scrolling and with every touched control at least 44 px in both directions.
- **DP-12 — Real stage and configuration from env** The stage draws every layer from the stored scene with WebGL2 or the 2D fallback, the inspector uses the published formulas, and every credential, timer and limit comes from the environment.
- **DP-13 — Primitives and 3D transforms** The five primitives show their published triangle counts, and position, rotation and scale change by typing, arrow keys, Shift steps and the drag gizmo with the published steps and snaps.
- **DP-14 — Camera projection readout** The inspector's Screen point for a layer centre or a named vertex equals the published projection for the current camera, breakpoint and clock, or reads Not visible.
- **DP-15 — Place and frame a primitive** A signed-in owner adds a Torus by keyboard, places it, scales it with the gizmo, reads its screen points, narrows the field of view and sees every readout update.
- **DP-16 — Text and SVG extrusion** Text in the built-in Halation Block cell font and one-path straight-line SVGs extrude with the published bounds and triangle counts, and every other input is refused with its exact text.
- **DP-17 — Materials and draw order** Matcap and Glass materials, depth testing and face settings produce the published IOR readout, Draw order items and Triangles drawn.
- **DP-18 — Uploads confirmed and kept as submitted** An uploaded image, SVG or model becomes usable for a layer only after storage confirms its object, and its original bytes download unchanged.
- **DP-19 — glTF upload subset and refusals** .gltf and .glb files inside the published subset upload and list their clips, and files outside it are refused with the first applicable exact text.
- **DP-20 — Clip sampling on the timeline** A model node's translation, rotation and scale at any timeline time follow the published clip-time and sampling rules for Loop, Speed, offset, LINEAR and STEP.
- **DP-21 — Storage outage keeps embeds playing** With storage unreachable, uploads and publishing are refused with the outage text while published embeds still render from their version row, with a named placeholder for each stored asset.
- **DP-22 — Seeded particle emitter** An emitter's live count and each numbered particle's position at a frame follow the published seeded simulation exactly.
- **DP-23 — Particle formation and trails** Particles forming into a shape follow the published start points, target points and Glide easing, and trail points follow the published rule.
- **DP-24 — Fixed-step cloth** A cloth point's position at a frame follows the published fixed-step simulation for every pinned edge, wind and stiffness setting.
- **DP-25 — Reduce motion preview** With Reduce motion on in the editor, or reduced motion requested in the embed, every animation, clip, particle field, cloth and the cursor tilt show their published still state.
- **DP-26 — Follow Light cursor tilt** Cursor tilt and the light focus follow the pointer by the published per-frame smoothing within the max tilt, ease back over 1.2 s when the pointer leaves, and can be driven from the keyboard.
- **DP-27 — Scroll camera orbit** The camera azimuth follows scroll progress between the start and end angles, driven by the editor's Scroll progress slider and by real scrolling in the embed.
- **DP-28 — Easing presets and keyframe values** Property values between keyframes follow each published easing preset, Elastic, Bouncy and Spring exactly.
- **DP-29 — Timeline by keyboard and drag** The playhead, Add keyframe (K) and keyframe buttons move by frames with the keyboard and snap when dragged, and focus stays on the moved control.
- **DP-30 — Undo history counts each change once** Undo and redo walk each person's own changes up to UNDO_LIMIT steps, and a retried save, undo or redo never applies twice.
- **DP-31 — Breakpoint inheritance and overrides** Tablet inherits Desktop and Mobile inherits Tablet, an override shows a reset marker, and the inspector names the level that supplied each value.
- **DP-32 — Embed follows its own width** A published embed picks Desktop, Tablet or Mobile values by its own viewport width, switching exactly at 1024 and 640 pixels.
- **DP-33 — Variables and bindings** Typed variables bind to compatible properties, clamp to the property's range, make the bound field read-only, and leave their last value behind when deleted.
- **DP-34 — Presets applied live** Applying a preset sets only the variables it names, reaches every open editor and viewer within 2 s, and undoes as one step.
- **DP-35 — Blend modes, masks and colour sampling** The inspector's Sample equals the published 8-bit compositing of 2D layers, blend modes, opacity and masks at the pixel centre.
- **DP-36 — Gradients and effects** Linear and radial gradients and the per-pixel effects sample to the published values, spatial effects show their published readouts, and a disabled effect passes pixels through unchanged.
- **DP-37 — Work together live** An invited editor accepts from the mail and edits alongside the owner, with presence and live changes both ways, while a viewer watches with every edit control disabled.
- **DP-38 — Layer locks** Editing a layer takes its lock, others see who holds it and are refused, and the lock is released on deselect, on blur, or after LOCK_TIMEOUT_SECONDS without a change.
- **DP-39 — Roles and member counts** Viewers can't edit, editors can't publish or manage members, and the project list's layer count, live version and editor and viewer counts always match the stored records.
- **DP-40 — Numbered immutable publishing** One publish click or retry creates exactly one gapless version number whose bundle and scene never change, and the version goes live only once storage confirms the bundle, as qualified in Business rules.
- **DP-41 — Embed page and live version swap** /embed/<projectId> shows only the latest live version and switches to a new one within 2 s over the live channel, or within EMBED_POLL_SECONDS by polling.
- **DP-42 — Publish notices by mail** Every publish mails each owner and editor once with the project name and version number, and a retried publish sends no second mail.
- **DP-43 — Layer list editing on a phone** On a 390x844 phone the owner reorders, duplicates, groups, hides, undoes and redoes layers by touch and the row menu, using the Editor panels tabs.
- **DP-44 — Trash and exact restore** A restored project, or a layer delete that was undone, comes back with every layer, keyframe, binding and override exactly, and published versions stay unchanged throughout.
- **DP-45 — JSON export and import** A scene exports as complete schema version 3 JSON, defaults included, that re-imports to an identical scene as qualified in Business rules, and an import is either refused at the first published problem or creates a project with its original bytes kept beside it.

## Frontend

### Screens and layout (DP-10, DP-11, DP-43)

Every screen is a framed stack of inset dark panels on the near-black ground. On a phone the panels sit 15 px in from the viewport edges. No screen scrolls horizontally at 375×812, 768×1024 or 1280×800. The editor uses its own three layouts: phone below 640 px, tablet from 640 px to 1023 px, desktop from 1024 px.

- **Landing (`/`)**
  - The **workspace header** runs across the top: the Halation Studio wordmark on the left. On the right, `Sign in` when signed out, or the person's name and `Sign out` when signed in.
  - Below it is the **Follow Light stage**, a full-width inset panel that runs the built-in demo scene. On a phone it is about three-quarters of the viewport tall, and on wider screens about 600 px tall. Stacked in its centre are the **release note pill**, the **split-face headline**, a one-paragraph sub-line and the **Open editor button**.
  - Below the stage, in this order:
    - the **published embeds marquee**, under a muted caption;
    - the **layer kind tiles**: two columns on a phone, three on tablet, four on desktop;
    - the **keyframe timeline** demo panel;
    - the **variables and presets card** demo;
    - the **inspector readout panel** demo;
    - the **version export card**;
    - the **project thumbnail mosaic**: two small tiles over one wide tile on a phone, a three-tile row on wider screens;
    - the **workspace footer**.
  - Every demo panel is a working component drawn by the app, never a picture.
- **Sign-in (`/signin`)**: one centred surface panel with the email and password fields and the sign-in button.
- **Projects (`/projects`)**
  - The workspace header, then the `Projects` tabs (Active, Trash), then the **project thumbnail mosaic**.
  - The mosaic shows one card per project, each with a live thumbnail of its latest published version, or a dim still frame when nothing is published. It has one column on a phone, two on tablet and three on desktop.
  - Each card shows the project name, its layer count, its live version and its editor and viewer counts.
  - The Trash tab lists trashed projects, each with its purge date and a restore button.
- **Editor (`/projects/<projectId>`)**
  - **Desktop:** the workspace header carries the save status, presence avatars, Undo, Redo, Members, Versions and Publish. Below it are three columns:
    - left: the Layers panel, with the **variables and presets card** under it;
    - centre: the black inset stage, with the preview bar (Breakpoint, Preview, Reduce motion, Scroll progress) above it;
    - right: the Inspector, ending in the **inspector readout panel** (`Readouts`).
    - The **keyframe timeline** spans the full width at the bottom.
  - **Tablet:** the stage spans the top, the Layers and Inspector panels sit side by side under it, and the timeline is at the bottom.
  - **Phone:** a `tablist` named `Editor panels` with tabs Layers, Stage, Inspector and Timeline shows one panel at a time. The header actions that don't fit move into a header menu button named `More actions`.
  - The stage always shows the selected breakpoint's artboard, fitted inside its panel with its aspect ratio kept.
- **Invite accept (`/invite/<token>`)**: one centred panel that names the project and role and holds the accept form.
- **Embed (`/embed/<projectId>`)**: the published scene fills the viewport, with nothing else on the page. The page is three viewport heights tall and the stage stays fixed, so scrolling only drives scroll progress.

### Public screens and controls (DP-03, DP-13, DP-29, DP-31, DP-33, DP-37, DP-41, DP-43)

Only the roles and names below are public. Each is stated once here and used everywhere else.

| Where | Role and accessible name | Visible copy and notes |
|---|---|---|
| All app pages | `banner` with link `Halation Studio home`; button `Sign out` | the **workspace header** |
| Landing | `region` `Follow Light stage`, with attributes `data-light-level` (0 to 1) and `data-light-focus` (`<x>, <y>`, 3 decimals) | the **Follow Light stage** |
| Landing | link `New Republish any version as the next one` | the **release note pill**: a small dot, the bold word `New`, then the muted text |
| Landing | `heading` level 1 `Scenes that hold their shape` | the **split-face headline**; the word `shape` is set in the serif face |
| Landing | link `Open editor` | the **Open editor button**; goes to `/projects`, or to `/signin` when signed out |
| Landing | `region` `Published embeds` | the **published embeds marquee**; caption `Published from Halation Studio`; invented names `Northwind Kiln hero`, `Pell & Sorrel launch`, `Quiet Orbit pricing`, `Ferrous Lab intro`, `Tallow Street drop`, `Marrow FM teaser` |
| Landing | `region` `Layer kinds` with six tiles titled `Primitives`, `Extruded type`, `Models`, `Particles`, `Cloth`, `Effects` | the **layer kind tiles** |
| Landing | `region` `Every publish gets a number` | the **version export card**: an extruded numeral drawn by the stage, a sample embed code box |
| Landing and project pages | `contentinfo` | the **workspace footer**: the Tinderbox Optics wordmark, link `Open editor ↗`, `© 2026 Tinderbox Optics`, and link groups Product (`Editor`, `Embeds`, `Versions`), Studio (`Release notes`) and Help (`Keyboard shortcuts`, which opens `dialog` `Keyboard shortcuts`). Every link goes to a section or route that exists |
| Sign-in | textbox `Email`, textbox `Password`, button `Sign in`, `alert` | |
| Projects | `tablist` `Projects` with tabs `Active` and `Trash`; button `New project` opens `dialog` `New project` (textbox `Project name`, button `Create project`); button `Import JSON` opens a file chooser labelled `Choose JSON file` | |
| Projects | `article` `<project name>` with `data-project-id`, `data-layer-count`, `data-live-version` (empty when none), `data-editor-count`, `data-viewer-count`; link `Open <project name>`; button `Move <project name> to trash` (owner only) | text `<n> layers`, `Live version <n>` or `Not published`, `<e> editors · <v> viewers` (singular `1 layer`, `1 editor`, `1 viewer`) |
| Projects, Trash tab | `listitem` `<project name>`; button `Restore <project name>` | `<project name> · purges on <date>` |
| Editor header | `status` `Save status`; `status` `Editor status`; button `Undo`; button `Redo`; button `Members`; button `Versions`; button `Publish`; `img` `<name> is here` for each other person present; combobox `Scene` | |
| Layers | `tree` `Layers` (multi-selectable); `treeitem` `<layer name>, <kind>` with `data-layer-id`, `data-kind`, `data-order` (0 = bottom); group rows are expandable treeitems with kind `Group`; the first row is the fixed `treeitem` `Camera, Camera` | rows list the topmost layer first; text `Held by <name>` on a locked-by-others row |
| Layers | button `Add layer` opens `menu` `Add layer` | see the menu item list under Interactions |
| Layer row | buttons `Drag <layer name>`, `Hide <layer name>` / `Show <layer name>`, `Lock <layer name>` / `Unlock <layer name>`, `Actions for <layer name>` (opens a `menu` with items `Move up`, `Move down`, `Duplicate`, `Group`, `Ungroup`, `Delete`) | |
| Stage | `group` `Stage` (focusable) with `data-renderer` (`webgl2` or `canvas2d`), `data-breakpoint`, `data-frame` | |
| Preview bar | `radiogroup` `Breakpoint` (radios `Desktop`, `Tablet`, `Mobile`); switch `Preview`; switch `Reduce motion`; slider `Scroll progress` (0 to 100, step 1) | |
| Gizmo (selected 3D layer, Preview off) | buttons `Move along X`, `Move along Y`, `Move along Z`, `Rotate around X`, `Rotate around Y`, `Rotate around Z` | |
| Inspector, 3D | spinbuttons `Position X`, `Position Y`, `Position Z`, `Rotation X`, `Rotation Y`, `Rotation Z`, `Scale X`, `Scale Y`, `Scale Z`; combobox `Vertex` | |
| Inspector, camera | spinbuttons `Field of view`, `Camera position X/Y/Z`, `Camera target X/Y/Z`, `Near`, `Far`; switch `Scroll orbit`; spinbuttons `Start angle`, `End angle`; combobox `Environment`; switch `Light field` | |
| Inspector, material | combobox `Material` (Matcap, Glass); combobox `Matcap` (Clay, Chrome, Jade, Ember); textbox `Colour`; spinbuttons `Material opacity`, `Refraction strength`; switch `Back-face refraction`; switch `Depth testing`; `radiogroup` `Faces` (radios `Front only`, `Both sides`) | |
| Inspector, 2D | spinbuttons `X`, `Y`, `Width`, `Height`, `Opacity`, `Sides`, `Text size`; textbox `Fill`; textbox `Text`; combobox `Blend mode` (Normal, Multiply, Screen, Overlay, Darken, Lighten); switch `Mask the layer above` | |
| Inspector, gradient | combobox `Gradient type` (Linear, Radial); spinbuttons `Angle`, `Centre X`, `Centre Y`, `Radius`; `list` `Gradient stops`, with textbox `Stop <i> colour`, spinbutton `Stop <i> position`, button `Remove stop <i>` per stop; button `Add stop` | |
| Inspector, effect | switch `Enabled`; spinbuttons `Blur radius`, `Grain amount`, `Grain seed`, `Bloom threshold`, `Bloom intensity`, `Bloom radius`, `Glow strength`, `Glow threshold`, `Aberration amount`, `Displacement amount`, `Pixel cell` (only the selected effect's own fields show) | |
| Inspector, extrusion | textbox `Extrude text`; spinbuttons `Letter height`, `Extrude depth`, `Bevel size`, `Bevel segments` | |
| Inspector, model | combobox `Node`; `list` `Clips` with `listitem` `<clip name> · <duration> s`; per clip button `Play <clip>` / `Pause <clip>`, switch `Loop <clip>`, spinbuttons `Speed <clip>` and `Clip offset <clip>` | |
| Inspector, particles | `radiogroup` `Particle mode` (radios `Emit`, `Form into`); spinbuttons `Particle seed`, `Rate`, `Burst`, `Lifetime`, `Particle speed`, `Particle gravity`, `Trail length`, `Orbit`, `Attractor X`, `Attractor Y`, `Attractor Z`, `Attractor strength`, `Count`, `Formation duration`, `Particle number`; combobox `Form into` | |
| Inspector, cloth | spinbuttons `Columns`, `Rows`, `Cloth gravity`, `Wind strength`, `Wind direction`, `Cloth stiffness`, `Cloth damping`, `Constraint iterations`, `Cloth seed`; combobox `Pinned edge`; combobox `Cloth point` | |
| Inspector, events | switches `Tilt toward cursor`, `Appear`, `Hover`, `Forwards only`, `Scroll into view`, `Loop`; spinbuttons `Max tilt`, `Sensitivity`, `Momentum`, `Appear duration`, `Appear delay`, `Hover duration`, `Hover delay`, `Scroll delay`, `Scroll duration`, `Loop delay`; comboboxes `Appear easing`, `Hover easing`, `Scroll easing` | |
| Inspector, any field | button `Reset <Field> to inherited value` (overridden fields only); button `Bind <Field>` / `Unbind <Field>`; text `Bound to <name>` and `Clamped to <limit>` under the field | `<Field>` is the field's accessible name |
| Inspector, sample | spinbuttons `Sample X`, `Sample Y` | |
| Readouts | `region` `Readouts`; each readout element carries `data-readout` with a key from the readout table below, and its text is the full readout | the **inspector readout panel** |
| Readouts | `list` `Draw order` with one `listitem` per draw | |
| Timeline | `region` `Timeline`; `slider` `Playhead` (value = frame, aria-valuetext = time readout); button `Play` / `Pause`; button `Add keyframe`; spinbutton `Duration` (seconds); button `<Property> keyframe at <time readout>` per keyframe; combobox `Easing` (for the focused keyframe); spinbuttons `Spring stiffness`, `Spring damping`, `Spring mass` | the **keyframe timeline** |
| Variables | `tablist` `Variables and presets` with tabs `Variables` and `Presets`; textbox `New variable name`; combobox `Variable type`; button `Add variable`; value fields `<name> value` (Number, Text, Colour), switch `<name> value` (Boolean), spinbuttons `<name> x`, `<name> y`, `<name> z` (vectors); button `Delete <name>` | the **variables and presets card** |
| Presets | button `Apply <preset>`; textbox `Preset name`; button `Save preset` | |
| Members | `dialog` `Members`; `list` `Members`; button `Invite people`; button `Remove <name>`; `status` `Members status` | invite rows read `<email> · <Role> · Invite sent` or `<email> · <Role> · Invite queued — mail is unavailable` |
| Invite | `dialog` `Invite people`; textbox `Email`; `radiogroup` `Role` (radios `Editor`, `Viewer`); button `Send invite` | |
| Versions | `dialog` `Versions`; `list` `Versions` with `listitem` `Version <n> · <date> <time> · Live` (or `· Superseded`) plus the notice text; button `Republish version <n>`; link `Export version <n> JSON`; textbox `Embed code` (read-only); button `Copy embed code`; link `Export working JSON`; link `Download original import` (imported projects only) | the version list and embed code form the **version export card** in the editor |
| Upload | file choosers labelled `Choose image`, `Choose SVG`, `Choose model` | |
| Invite page | heading `Join <project name> as <Role>`; textbox `Your name`; textbox `Choose a password`; textbox `Password`; button `Accept invite`; `alert` | |
| Embed | `region` `<project name>, version <n>` with `data-version`, `data-breakpoint`, `data-frame`, `data-renderer`, `data-scroll-progress`; visually hidden `list` `Scene values` with one `listitem` per layer carrying `data-layer-name` and `data-values` (a JSON object of that layer's resolved property values at the current frame and breakpoint, keyed by property path); `img` `<layer name> (storage unavailable)` placeholders | |

`Add layer` menu items: `Rectangle`, `Ellipse`, `Polygon`, `Text`, `Image`, `Gradient`, `Blur`, `Grain`, `Bloom`, `Glow`, `Chromatic aberration`, `Displacement`, `Pixelate`, `Cube`, `Sphere`, `Cylinder`, `Torus`, `Plane`, `Extruded text`, `Extruded SVG`, `Model`, `Pebble model`, `Arch model`, `Lattice model`, `Particles`, `Cloth`. `Image`, `Extruded SVG` and `Model` open their file choosers.

**Readout table.** Every readout key and its exact text format. The same text appears in the inspector and in the API's `readouts`.

| `data-readout` | Text |
|---|---|
| `time` | `<MM:SS.mmm>` |
| `property` (with `data-path`) | `<Field> <value>`, followed by ` (from <Level>)` when the value comes from a breakpoint level other than the selected one, for example `Rotation Y 30.000 (from Tablet)` |
| `screen-point` | `<x>, <y> px` or `Not visible` |
| `vertex-point` | `<x>, <y> px` or `Not visible` for the chosen `Vertex` |
| `vertex-world` | `<x>, <y>, <z>` |
| `camera-azimuth` | `Camera azimuth <a>°` |
| `triangles` | `Triangles <n>` |
| `triangles-drawn` | `Triangles drawn <n>` |
| `bounds` | `Bounds <w> × <h> × <d>` |
| `ior` | `IOR <i>` |
| `sample` | a hash sign and the six uppercase hex digits of the colour, then a space, a middle dot and a space, then the lowercase word `rgb` with the three channels in round brackets attached directly to it, separated by a comma and a space. For channels 143, 122 and 102 the hex digits are 8F7A66 and the brackets hold `(143, 122, 102)` |
| `blur` | `σ <s> · <n> taps` |
| `aberration` | `R +<a> px · B -<a> px` |
| `live-particles` | `Live particles <n>` |
| `particle` | `Particle <n> at <x>, <y>, <z>` or `Particle <n> is not alive at <time readout>.` |
| `trail-points` | `Trail points <n>` |
| `cloth-point` | `Cloth point <name> at <x>, <y>, <z>` |
| `node-translation` | `Translation <x>, <y>, <z>` |
| `node-quaternion` | `Quaternion <x>, <y>, <z>, <w>` |
| `node-euler` | `Euler <x>, <y>, <z>` |
| `node-scale` | `Scale <x>, <y>, <z>` |
| `clip-time` (with `data-clip`) | `<clip name> <c> s` |
| `tilt-x`, `tilt-y` | `Tilt X <deg>`, `Tilt Y <deg>` |
| `tilt-target` | `Tilt target <x>, <y>` |
| `light-focus` | `Light focus <x>, <y>` |

Numbers follow the formatting rule in Business rules.

### Interactions (DP-13, DP-26, DP-29, DP-43)

- **Keyboard everywhere.**
  - Tab order follows reading order: header, Layers, preview bar, stage, Inspector, Readouts, Timeline.
  - Every focused control shows a visible focus ring.
  - After any keyboard action (reorder, nudge, add keyframe, move keyframe, switch breakpoint), focus stays on the control that was acted on. A moved keyframe keeps focus even though its name changes. After adding a layer, focus moves to the new layer's row.
  - In every dialog and menu, Tab and Shift+Tab wrap inside it, Escape closes it, and focus returns to the control that opened it.
- **Shortcuts.** They work while focus is anywhere in the editor except inside a text entry (`Text`, `Extrude text`, names, `Email`), where keys type as usual.
  - Ctrl or Cmd+Z undoes; Ctrl or Cmd+Shift+Z redoes.
  - Ctrl or Cmd+D duplicates the selected layer.
  - Ctrl or Cmd+G groups the selected rows; Ctrl or Cmd+Shift+G ungroups.
  - Delete removes the selected layer, or the focused keyframe when focus is on a keyframe button.
  - K adds a keyframe for the focused property: the inspector field that most recently had focus. K also works with focus on the playhead, a keyframe button or `Play`.
- **Layers tree.**
  - ArrowUp and ArrowDown move between rows. ArrowRight and ArrowLeft expand and collapse groups.
  - Shift+ArrowUp and Shift+ArrowDown extend the selection. Space toggles a row in the selection.
  - Alt+ArrowUp moves the focused layer one place up the list, which is one step higher in stack order. Alt+ArrowDown moves it one place down.
  - Dragging a row's `Drag <layer name>` handle with the mouse or by touch drops it between rows, with a thin accent line marking the drop point.
  - On a phone, the row menu's `Move up` and `Move down` do the same as the Alt+Arrow keys.
  - Grouping needs the selected rows to share a parent. The new group takes the place of the topmost selected row.
  - Duplicating places the copy directly above the original. The copy carries its keyframes, overrides, events and bindings.
- **Inspector fields.**
  - Typing a value and pressing Enter or Tab commits it.
  - ArrowUp and ArrowDown step by the field's step. Shift+Arrow takes the larger step listed in the property table.
  - Viewers see every edit control marked unavailable, with the viewer-refusal copy from Feedback states as its tooltip and accessible description. Inspection controls stay usable for viewers: `Breakpoint`, `Preview`, `Reduce motion`, `Scroll progress`, `Playhead`, `Vertex`, `Node`, `Cloth point`, `Particle number`, `Sample X`, `Sample Y`, `Scene`.
- **Gizmo.** Dragging a move or rotate handle changes the value live as the pointer moves. Releasing ends one undo step. Holding Shift during the drag uses the coarse snap.
- **Stage in Preview.**
  - The pointer over the stage drives cursor tilt, the light focus and hover events.
  - Touch-dragging on the stage does the same.
  - With the stage focused, the arrow keys move a virtual pointer by 0.1 in the normalised pointer range (starting from the centre), and Escape releases it as if the pointer had left.
  - With Preview off, the stage is for selection: clicking a layer selects it and shows the gizmo.
- **Timeline.**
  - On the focused `Playhead`: ArrowLeft and ArrowRight move one frame, Shift+Arrow moves ten frames, Home and End jump to the start and end.
  - On a focused keyframe button, the arrows move that keyframe by one frame (ten with Shift).
  - Dragging a keyframe by mouse or touch snaps to whole frames. Within 4 px of the playhead or another keyframe, it snaps onto it.
  - Tapping the timeline ruler moves the playhead there.
  - `Play` advances the playhead with the clock and turns into `Pause`.
- **Copy embed code** puts the snippet on the clipboard.
- **Phone.** Tapping a tab in `Editor panels` shows that panel. Every touched control is at least 44 by 44 px.

### Visual design (DP-10, DP-11)

- **Direction:** a seed-derived, nocturnal, luminous and exact look. The near-black ground fills every screen edge to edge. The only light comes from live canvases. Every readout is a number the inspector can prove.
- **Typefaces.**
  - Display headings use the device's system grotesk (system-ui, falling back to Segoe UI or Roboto) at semibold weight, set tight.
  - One accent word per headline switches to the system serif (ui-serif, falling back to Georgia) in regular italic, at the same size and on the same baseline.
  - Body text uses the same grotesk at regular and medium weight, with tabular figures for every number.
  - A monospace system face appears only in the JSON export view.
  - No font files are shipped or fetched.
  - Each heading level is 1.25 times the size of the level below it, starting from body text.
- **Colour roles.**
  - The ground is near-black with a faint blue cast.
  - Panels are a slightly lifted charcoal surface; inputs and icon squares a step lighter again.
  - Fine hairline borders are a dim grey-violet.
  - Text is a pale lavender-white, slightly dimmer where it sits over the glow. Secondary text is a muted grey-lavender.
  - The single accent is a saturated violet, used for the pill dot, the playhead, the selected-row marker and focus rings. A paler periwinkle appears only inside canvas light.
  - Values at a limit (`Not visible`, `Clamped to …`, live particles at the cap) and every error or outage notice use an amber numeral colour.
  - All text meets WCAG 2.2 AA contrast against its panel.
- **Composition.** Panels have softly rounded corners (about 10 px); controls are rounded less (about 4 px). Density is comfortable, with about 16 to 24 px of padding inside panels. Each panel holds either a live canvas or a working component.
- **Hero.** The landing stage is a full-bleed canvas. A violet light volume rises from the bottom-right behind the split-face headline, with the release note pill above and the Open editor button below. The button is a translucent outlined rectangle whose fill brightens slightly on hover. Each project's cover panel runs that project's own published scene.
- **Working screens.**
  - The editor keeps the panel stack. The stage is a black inset, and the timeline is a ruled track panel with a one-pixel accent playhead.
  - Inputs sit on the raised surface with hairline borders that lighten on focus.
  - Empty states show a dim, still stage frame with one line of muted text.
  - Loading states are flat dark tiles that fade their content in.
  - Errors and outages are amber notice rows inside the affected panel, never red toasts.
  - Buttons, text and panels never glow.

### Motion and effects (DP-09, DP-25, DP-26, DP-27)

- **Follow Light on the landing stage.**
  1. On load, the stage is black for one frame.
  2. The light then rises and brightens over 800 ms, so `data-light-level` climbs from 0 to 1 and settles softly.
  3. The pill fades in first. The headline lines rise slightly and fade in, each over 600 ms and 60 ms after the previous line. The Open editor button arrives last, 300 ms after the final line starts.
  4. With the pointer or a touch over the stage, the light focus trails the pointer by roughly a third to half a second, using the light smoothing in Business rules.
  5. When the pointer leaves, the focus eases back to rest over 1.2 s, quickly at first and settling softly.
  6. With no input after the entrance, the stage is completely still.
- **Editor and embed stages.** The scene moves only with the timeline clock. In the editor this means `Play` or a playhead change; in the embed, the clock runs from frame 0 when the page loads. Pointer-driven effects (cursor tilt, hover and the light focus) respond to the pointer. Scroll-driven effects respond to `Scroll progress` in the editor and to page scrolling in the embed, and they reverse step by step when the user scrolls back. There is no other idle motion: no unnamed decorative loops anywhere. A layer's own `Loop` setting and looping clips are the only repeating animations, and they belong to the scene.
- **The marquee** is the only continuous page motion. It drifts sideways at about 30 px per second with soft fades at both edges. It pauses on hover and while off-screen. Under reduced motion it is a still, wrapped row.
- **Demo panels on the landing** play once as they enter: timeline bars extend, the playhead sweeps across in about two seconds, and readout numbers count up over about 600 ms. None of them loop.
- **Feedback motion.**
  - Hover and press changes on links, the pill, buttons and tiles take about 150 ms.
  - A pressed button shrinks very slightly.
  - Panels and loaded content fade in over about 400 ms.
  - Menu and dialog openings settle in under a quarter of a second.
- **Reduced motion.** When the device asks for reduced motion, or `Reduce motion` is on in the editor:
  - The landing stage shows one still frame of the light at rest.
  - Text appears with a 150 ms fade and no movement.
  - The scene shows the still states listed in Business rules, and the light and tilt don't follow the pointer.
- **Without WebGL2**, the stage draws on a 2D canvas with flat-shaded 3D using the same projection, and every readout, mirror and behaviour stays the same.

### Feedback states (DP-05, DP-07, DP-08, DP-18, DP-21)

Success and progress text goes to `status` `Editor status` unless another region is named. Errors appear as an amber notice row with role `alert` inside the panel where the action started. API error bodies carry the same text in `message`.

| Action | Pending | Success | Errors and outage |
|---|---|---|---|
| Any edit (autosave) | `Save status`: `Saving…` | `Save status`: `All changes saved` | server unreachable: `Save status`: `Not saved — retrying` (it keeps retrying the same change) |
| Live connection | — | `Reconnected` | `Connection lost — reconnecting` |
| Undo / Redo | — | `Undone` / `Redone` | `Nothing to undo` / `Nothing to redo` |
| Add keyframe (K) | — | `Keyframe added at <time readout>` | `Choose a property first.` |
| Edit by a viewer | — | — | `Viewers can't edit this project.` |
| Edit a locked layer | — | — | `<layer name> is locked.` |
| Edit a layer held by another person | — | — | `<name> is editing this layer.` |
| Override a non-overridable field (API only) | — | — | `<Field> can't differ between breakpoints.` |
| Field validation | — | — | `Must be between <min> and <max>.`; `Enter a name.`; `Use a lowercase letter first, then lowercase letters, digits or _ (at most 32 characters).`; `A variable named <name> already exists.`; `Use a colour like #RRGGBB.`; `A gradient needs between 2 and 8 stops.`; `Character "<c>" is not in the built-in outline font.` |
| Upload (image, SVG, model) | `Uploading <file name>…` | `<file name> is ready.` | the image, SVG and model refusals in Business rules; outage: `Storage is unavailable, so uploads are paused. Published scenes still play.` |
| Upload used before it is ready (API only) | — | — | `This upload isn't ready yet.` |
| Publish / Republish | button reads `Publishing…` and is disabled | `Version <n> is live.` | `Only the owner can publish.`; `This project has reached its limit of <n> published versions.`; outage: `Storage is unavailable, so publishing is paused. Published scenes still play.` |
| Publish notice (in the Versions list item) | — | `Notice sent` | `Notice queued — mail is unavailable` |
| Invite (`Members status`) | button reads `Sending…` | `Invite sent to <email>.` (also shown when the mail is only queued; the row then reads `Invite queued — mail is unavailable`) | `Only the owner can manage members.`; `Enter a valid email address.`; `<email> is already a member.`; `An invite to <email> is already pending.` |
| Accept invite | button reads `Joining…` | the project opens | `This invite link has already been used or has expired.`; `This invite was sent to <email>. Sign out to accept it.`; `Choose a password of at least 10 characters.` |
| Sign in | button reads `Signing in…` | the project list opens | `Email or password is incorrect.` |
| Variable delete | — | `Deleted <name>. <n> properties keep its last value.` (when n is 1: `Deleted <name>. 1 property keeps its last value.`) | — |
| Preset | — | `Applied <preset>.` | — |
| Copy embed code | — | `Embed code copied.` | — |
| Trash / Restore | — | `Moved <project name> to the trash.` / `Restored <project name>.` | `This project is already in the trash.`; `This project is not in the trash.`; edits to a trashed project: `This project is in the trash. Restore it to edit.` |
| Import JSON | `Importing <file name>…` | `Created <project name> (imported).` | the import refusals in Business rules; the storage outage text |
| Version change attempt (API only) | — | — | `Published versions can't be changed.` |
| Embed with no live version | — | — | page text `This scene is not published.` |

## Backend

### API (DP-01–DP-06, DP-14, DP-18, DP-30, DP-38–DP-42, DP-45)

**Request and response format.**
- JSON requests use `Content-Type: application/json`, with a maximum body of 1,048,576 bytes (exactly 1,048,576 is allowed). Uploads and imports use `multipart/form-data`, with a maximum body of 10,485,760 bytes (exactly that is allowed). A larger body answers `413 {"error":"too_large","message":"Request body is larger than <limit> bytes."}`, and a JSON route sent another type answers `415 {"error":"unsupported_media_type","message":"Send application/json."}`.
- Every error uses one shape: `{"error":"<code>","message":"<copy>"}`. A 422 adds `"errors":{"<field path>":"<message>"}`, and `message` is then the first field message.
- Times are ISO 8601 UTC strings.
- Ids are opaque strings.

**Error order (one rule for the whole API).** Each request is checked in this order and fails at the first match:
1. `401` `unauthenticated` (`Sign in to continue.`)
2. `404` `not_found` (`Not found.`) for anything the requester can't open
3. `403` `forbidden` with the role copy
4. `409` for locks and state conflicts: `layer_held`, `layer_locked`, `trashed`, `already_trashed`, `not_trashed`, `nothing_to_undo`, `nothing_to_redo`, `idempotency_conflict`
5. `422` `validation`
6. `409` `limit_reached` (publish limit)
7. `503` `storage_unavailable` (uploads, imports and publishing only)

A replayed `opId` or `Idempotency-Key` with the same body returns its stored response right after the 401, 404 and 403 checks, before any later check. Endpoint rows below name only their own errors.

**Health and grading**

| Method and path | Request | Success | Notes |
|---|---|---|---|
| `GET /api/health` | — | `200 {"status":"ok"}`; when storage is unreachable `200 {"status":"unavailable"}` | never 503 |
| `POST /api/grading/reset` | header `X-Grading-Key` | `200 {"status":"reset"}` | empties every table and the bucket and sets the clock back to `APP_START_AT`; a missing or wrong key answers `404` |
| `POST /api/grading/seed` | header `X-Grading-Key` | `201` with the seed map (see Seed data) | when storage is unreachable `503 storage_unavailable` |
| `POST /api/grading/clock` | `{"advanceMs": <non-negative integer>}` | `200 {"now":"<ISO time>"}` | moves the server clock forward |

**Session**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `POST /api/session` | `{"email","password"}` | `200 {"user":{"id","name","email"}}`; sets cookie `hs_session` (HttpOnly, SameSite=Lax, Path=/) | `401 {"error":"bad_credentials","message":"Email or password is incorrect."}` |
| `DELETE /api/session` | — | `204` | |
| `GET /api/me` | — | `200 {"user":{…},"workspaces":[{"id","name","role"}]}` | |

**Projects**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `GET /api/projects?status=active` (or `trashed`) | — | `200 {"projects":[<project summary>]}` | |
| `POST /api/projects` | `{"workspaceId","name"}` | `201 {"project":<project summary>}`; the project starts with the creator as Owner and one empty scene named `Main` (scene defaults, no layers), whose id appears in `GET /api/projects/:id` | the workspace owner only |
| `GET /api/projects/:id` | — | `200 {"project":<project summary>,"document":<scene document>,"assets":[<asset>]}` | |
| `DELETE /api/projects/:id` | — | `200 {"project":<summary>}` with `status` `trashed` | owner only |
| `POST /api/projects/:id/restore` | — | `200 {"project":<summary>}` with `status` `active` | owner only |

A project summary is `{"id","name","workspaceId","status","role","layerCount","liveVersion","editorCount","viewerCount","trashedAt","purgeAt"}`. `liveVersion` is null when nothing is published, and `trashedAt` and `purgeAt` are null unless the project is trashed.

**Edits**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `POST /api/projects/:id/ops` | `{"opId":"<1–100 chars>","sceneId","changes":[<change>]}` | `200 {"opId","seq","undoDepth","redoDepth","ids":{"<client ref>":"<new id>"}}` | `409 layer_held`, `layer_locked`, `trashed`; `422` |
| `POST /api/projects/:id/undo` | `{"opId"}` | `200 {"opId","seq","undoDepth","redoDepth"}` | `409 nothing_to_undo` |
| `POST /api/projects/:id/redo` | `{"opId"}` | same | `409 nothing_to_redo` |
| `PUT /api/projects/:id/layers/:layerId/lock` | — | `200 {"lock":{"layerId","heldBy":{"id","name"},"expiresAt"}}` | `409 layer_held` |
| `DELETE /api/projects/:id/layers/:layerId/lock` | — | `204` | |

Change types:

| Change | Fields |
|---|---|
| `addLayer` | `layer` (a layer object from the scene document, without `id`), `ref` (client reference) |
| `updateLayer` | `layerId`, `set` (property path to value), `breakpoint` (`desktop`, `tablet` or `mobile`; tablet and mobile write overrides) |
| `clearOverride` | `layerId`, `breakpoint`, `path` |
| `deleteLayer` | `layerId` |
| `moveLayer` | `layerId`, `parentId`, `order` |
| `duplicateLayer` | `layerId` |
| `group` | `layerIds` |
| `ungroup` | `groupId` |
| `setKeyframe` | `layerId`, `property`, `frame`, `value`, `easing` |
| `moveKeyframe` | `layerId`, `property`, `fromFrame`, `toFrame` |
| `deleteKeyframe` | `layerId`, `property`, `frame` |
| `updateScene` | `set` (scene path to value), `breakpoint` |
| `addVariable` | `variable`: `{"name","type","value"}` |
| `updateVariable` | `name`, `value` |
| `deleteVariable` | `name` |
| `bind` | `layerId`, `property`, `variable` |
| `unbind` | `layerId`, `property` |
| `savePreset` | `name` |
| `applyPreset` | `name` |
| `deletePreset` | `name` |

**Inspection (the server's evaluator)**

| Method and path | Query | Success |
|---|---|---|
| `GET /api/projects/:id/inspect` | `scene` (required), `layer`, `frame` (default 0), `breakpoint` (default `desktop`), `scroll` (0–100, default 0), `reducedMotion` (`0` or `1`), `vertex`, `particle`, `point`, `node`, `sampleX`, `sampleY`, `version` (a published number; evaluates that version instead of the working copy) | `200 {"frame","time","breakpoint","values":{"<path>":<number or string>},"sources":{"<path>":"Desktop"\|"Tablet"\|"Mobile"},"readouts":{"<readout key>":"<text>"}}` |

`readouts` holds exactly the texts the inspector shows for the same inputs, keyed by the readout table, for every readout that applies to the layer or sample requested. A query value outside its range answers `422`.

**Uploads and originals**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `POST /api/projects/:id/assets` | multipart fields `kind` (`image`, `svg`, `model`) and `file` | `201 {"asset":{"id","kind","fileName","bytes","sha256","status":"confirmed","width","height","vertices","clips":[{"name","durationS"}]}}` | `422 {"errors":{"file":"<refusal>"}}`; `503 storage_unavailable` |
| `GET /api/assets/:assetId/original` | — | `200` with the exact uploaded bytes and the uploaded content type | |

**Versions and publishing**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `GET /api/projects/:id/versions` | — | `200 {"versions":[{"number","status","publishedAt","publishedBy","sha256","notice":"sent"\|"queued"}]}` | |
| `POST /api/projects/:id/versions` | header `Idempotency-Key` (1–100 chars); body `{}` or `{"fromVersion": <n>}` | `201 {"version":{"number","status":"live","publishedAt","publishedBy","sha256"}}` | `403` (`Only the owner can publish.`); `422` (missing key, unknown `fromVersion`); `409 limit_reached`; `503` |
| `GET /api/projects/:id/versions/:n/export` | — | `200 application/json`, the bundle bytes exactly | |
| `PUT`, `PATCH`, `DELETE /api/projects/:id/versions/:n` | — | — | always `405 {"error":"immutable","message":"Published versions can't be changed."}` |

**Export and import**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `GET /api/projects/:id/export` | — | `200 application/json` with the working scene document | |
| `POST /api/imports` | multipart fields `workspaceId` and `file` | `201 {"project":<summary>}` | `422 {"errors":{"file":"<refusal>"}}`; `503` |
| `GET /api/projects/:id/import/original` | — | `200` with the original import bytes exactly | `404` if the project wasn't imported |

**Members and invites**

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `GET /api/projects/:id/members` | — | `200 {"members":[{"personId","name","email","role"}],"invites":[{"id","email","role","status":"sent"\|"queued"\|"accepted"\|"expired","expiresAt"}]}` | |
| `POST /api/projects/:id/invites` | `{"email","role":"Editor"\|"Viewer"}` | `201 {"invite":{…}}` | `403` (`Only the owner can manage members.`); `422` |
| `DELETE /api/projects/:id/members/:personId` | — | `204` | owner only |
| `GET /api/invites/:token` | — | `200 {"projectName","role","email","accountExists"}` | `410 {"error":"invite_unavailable","message":"This invite link has already been used or has expired."}` |
| `POST /api/invites/:token/accept` | `{}` when signed in as the invited email; `{"password"}` for an existing account; `{"name","password"}` for a new one | `200 {"projectId","role"}`; sets `hs_session` | `410`; `422`; `409 {"error":"wrong_person","message":"This invite was sent to <email>. Sign out to accept it."}` |

**Embed (anonymous)**

| Method and path | Success | Errors |
|---|---|---|
| `GET /embed/:projectId` | `200` HTML page | `404` page with `This scene is not published.` when there is no live version, the project is trashed or purged, or the id is unknown |
| `GET /api/embed/:projectId/scene` | `200 application/json`, the live bundle bytes, with headers `X-Halation-Version: <n>` and `X-Scene-Source: bundle` (or `row` when storage is unreachable) | `404` |
| `GET /api/embed/:projectId/version` | `200 {"number": <n>}` | `404` |
| `GET /api/embed/:projectId/assets/:assetId` | `200` asset bytes, only for assets the live version uses | `404`; `503 storage_unavailable` |

**Live channel.** A WebSocket at `/ws` on the same origin. Editors and viewers subscribe to a project to receive changes, presence and lock events. Embed pages subscribe to a project's version announcements.

### Business rules (DP-04–DP-08, DP-13, DP-14, DP-16, DP-17, DP-19, DP-20, DP-22–DP-36, DP-38–DP-40, DP-42, DP-44, DP-45)

**Formatting and time.**
- In this brief a colour is written as its six hex digits without the leading hash sign. Fields, readouts and the JSON document carry it with a leading hash sign and uppercase digits.
- Numbers in readouts and fields round half away from zero to the stated decimals. Negatives use the ASCII hyphen-minus, and negative zero shows as `0.000`.
- Property values are stored to 3 decimals. A field's step is the arrow-key increment, not a storage grid.
- Readout values not covered by the rule that produces them:
  - `vertex-world` coordinates and the `clip-time` value c show to 3 decimals.
  - `aberration`, `triangles`, `triangles-drawn`, `live-particles` and `trail-points` show whole numbers.
- `property` readouts show values in these formats:
  - every numeric property to 3 decimals, whole-number fields included (for example `X 100.000`, `Opacity 60.000`, `Sides 6.000`);
  - colours as `#RRGGBB`;
  - booleans as `On` or `Off`;
  - text exactly as stored, without quotes;
  - choice fields (kind, primitive, blend mode, material, matcap, faces, gradient type, particle mode, pinned edge, environment, easing) by their display name from the controls table or the easing list, for example `Both sides`.
- The evaluate route's `values` and the embed's `data-values` use the same formats: numbers are JSON numbers rounded to 3 decimals, and every other value is the same string the readout shows.
- The server clock starts at `APP_START_AT` (default `2026-11-06T10:00:00Z`) on reset, runs in real time from there, and moves forward with the grading clock route. Its offset is stored in the database so every running copy of the app agrees.
- Dates show as `D MMM YYYY` (for example `6 Nov 2026`) and times as 24-hour `HH:mm`, both in `APP_TIME_ZONE` (default `Europe/Lisbon`).
- The device clock may be wrong. Trash purge dates, invite expiry, lock state, live versions and every inspector value come from the server's records and evaluator, never from the browser's clock.

**Roles and visibility.**

| | Owner | Editor | Viewer | Anyone else |
|---|---|---|---|---|
| Open the project, scrub, switch breakpoints, read the inspector | yes | yes | yes | 404 |
| Edit layers, keyframes, variables, presets, scene | yes | yes | 403 `Viewers can't edit this project.` | 404 |
| Publish, republish | yes | 403 `Only the owner can publish.` | 403 `Only the owner can publish.` | 404 |
| Invite, remove members | yes | 403 `Only the owner can manage members.` | 403 `Only the owner can manage members.` | 404 |
| Trash, restore | yes | 403 `Only the owner can manage members.` | 403 `Only the owner can manage members.` | 404 |

A person sees only projects they are a member of. Another workspace's project, its API routes and a purged project answer 404, never 403. An embed is public only while its project is active and has a live version, and answers 404 otherwise. Membership exists only after an invite link is accepted.

**Invites.**
- An invite carries a single-use token valid for `INVITE_TTL_HOURS` (default 72) of server time.
- A used or expired token answers 410 with the copy from Feedback states. Of two simultaneous accepts, exactly one succeeds.
- A new account's password must be at least 10 characters.
- Accepting signs the person in as a member with the invited role and opens the project.
- An invite to an existing member, or to an email with an invite already pending, is refused with 422.

**Project lifecycle.**
- `active → trashed` (owner, `DELETE`): sets `trashedAt` and `purgeAt` = `trashedAt` + 30 days. Edits and publishing then answer `409 trashed`, the embed answers 404, and the project moves to the Trash tab.
- `trashed → active` (owner, restore before `purgeAt`) brings back every scene, layer, keyframe, event, variable, binding, preset, breakpoint override, member and version exactly as they were. The embed then serves the latest live version again.
- `trashed → purged` happens automatically once server time passes `purgeAt`. Every row and object goes, and the project answers 404.
- Illegal transitions: trashing a trashed project answers `409 already_trashed`; restoring an active project answers `409 not_trashed`.

**Versions.**
- `publishing → live → superseded`, and no version is ever edited.
- Publishing works as one unit:
  1. Under a per-project lock, the next number is reserved as one more than the highest existing number.
  2. The version row is written with the full scene document and status `publishing`.
  3. The bundle is written to storage and confirmed by reading its metadata back.
  4. The row becomes `live` and the previous live version becomes `superseded`.
  5. The new number is broadcast to open embeds, and one notice per owner and editor is added to the mail outbox.
- If the bundle can't be stored or confirmed, everything is rolled back: no row stays, the number is not used, and nothing is broadcast or mailed. Numbers are therefore gapless (1, 2, 3 …).
- The bundle bytes, the bytes stored on the version row and the version export are identical, and their SHA-256 is recorded on the version.
- A version's document and bundle hold the whole project document: every scene, variable and preset. Scenes keep their creation order; in the seeded Backdrop project that is `Blend`, `Ramp`, `Grain`. The embed, project card thumbnails and cover panels play the document's first scene.
- `fromVersion` republishes that version's stored document as the next number.
- When a project already has `PUBLISH_LIMIT` versions (default 20), publishing answers `409 limit_reached`.
- **Idempotency.**
  - Replaying the same `Idempotency-Key` with the same body returns the stored `201` response and creates no version and no mail.
  - The same key with a different body answers `409 {"error":"idempotency_conflict","message":"This key was already used for a different request."}`.
  - Of two concurrent requests with the same key, one publishes and the other returns its response.
  - Two concurrent publishes with different keys get consecutive numbers.
  - The Publish button sends one key per click and is disabled while pending, so a double click makes one version.
- Unpublished edits never reach an embed.

**Uploads.**
- Each upload goes `pending → confirmed | failed`.
- The original bytes are stored unchanged under `projects/<projectId>/assets/<assetId>/original`, then confirmed by reading the object's metadata back. Only then is the asset `confirmed` and usable by `addLayer`.
- An `addLayer` naming a pending or failed asset answers `422 {"errors":{"layer.assetId":"This upload isn't ready yet."}}`.
- If storage fails, the asset is `failed`, no layer appears, and the call answers 503.
- Uploaded files are never rewritten. Parsing and normalising work on the working copy only.

**Edits, autosave and undo.**
- Each user action is one undo step: a committed field value, one gizmo drag from press to release, one keyboard nudge, one reorder, one keyframe change or one preset application. Consecutive changes to the same field less than `AUTOSAVE_MS` apart merge into one step.
- The editor sends each step within `AUTOSAVE_MS` (default 800 ms) of its last change, as one `ops` request with its own `opId`. A retry resends the same `opId`.
- Replaying an `opId` with the same body returns the stored response, and the change is applied and recorded only once. The same `opId` with a different body answers 409 `idempotency_conflict`. Undo and redo follow the same rule.
- History is kept per person per project, holding at most `UNDO_LIMIT` steps (default 100); beyond that the oldest step is dropped.
- Undo reverts that person's latest step that is not yet undone, and redo reapplies it. A new step clears that person's redo list.
- Undoing a layer delete brings back the layer with its keyframes, events, overrides, bindings and position in the stack exactly.
- Undo needs the same locks as the original change.

**Live collaboration and locks.**
- Every committed change reaches the project's other open editors and viewers within 2 s, without a reload.
- Presence lists every other person with the project open.
- Changing a layer's field takes that layer's lock, stored in the database. The lock is released when its holder deselects the layer, when the holder's inspector panel loses focus, or after `LOCK_TIMEOUT_SECONDS` (default 30) of server time with no change.
- While a lock is held, others see `Held by <name>` on the row, and their changes to that layer answer `409 layer_held` with `<name> is editing this layer.` (`<name>` is the holder's full name).
- Of two simultaneous attempts to take a lock, the first committed wins.
- Scene-level fields, variables and presets have no lock: the last committed write wins, and everyone sees the final value within 2 s.
- A layer with `locked` on refuses changes with `409 layer_locked` and `<layer name> is locked.`

**Breakpoints and artboards.**

| Level | Artboard | Viewport width that selects it in the embed |
|---|---|---|
| Desktop | 1440 × 810 | 1024 px and wider |
| Tablet | 834 × 1112 | 640 px to 1023 px |
| Mobile | 390 × 844 | 639 px and narrower |

- Desktop holds the base values. Tablet inherits Desktop unless overridden, and Mobile inherits Tablet (and through it Desktop) unless overridden. Resolution therefore checks Mobile, then Tablet, then Desktop.
- The editor's `Breakpoint` selects the artboard. The embed selects by its own viewport width.
- All screen points are artboard pixels, whatever the browser window size.
- Overridable: every transform, camera, material, particle and cloth setting, opacity, visibility, text size, effect parameters and event parameters.
- Not overridable: name, kind, stack order, mask assignment, blend mode and variable bindings. Writing one of these with a breakpoint other than `desktop` answers 422 `<Field> can't differ between breakpoints.`
- `clearOverride` restores inheritance.

**Property table.** Values outside a range are refused with `Must be between <min> and <max>.` Each row reads: JSON path (under `props`), then the field name, range, step (Shift step) and default.

*Every layer*
- `name`: Name, 1–60 characters, defaulting to the kind name. Further layers of the same kind are numbered `Torus 2`, `Torus 3`.
- `visible`, `locked`: booleans, defaulting to true and false.

*2D layers*
- `x`, `y`: X and Y, −10000..10000 artboard px, step 1 (10), default 0. The point is the box's top-left corner.
- `width`, `height`: 1..10000, step 1 (10), default 200.
- `opacity`: 0..100 %, step 1 (10), default 100.
- `fill`: a colour, default FFFFFF (white).
- `blendMode`: Normal.
- `maskAbove`: false.
- Polygon `sides`: 3..12, step 1, default 6. The polygon is regular, inscribed in the box, with its first point at the top centre.
- Text `text`: up to 200 characters, default `Text`. `textSize`: 8..400, step 1 (10), default 48.

*Gradient layers*
- `gradient.type`: Linear.
- `gradient.angle`: 0..359°, step 1 (15), default 0.
- `gradient.centerX`, `gradient.centerY`: 0..100 % of the box, step 1, default 50.
- `gradient.radius`: 1..10000 px, step 1, default 100.
- `gradient.stops`: 2 to 8 items, each `{color, position}` with position 0..100 % in steps of 1.

*Effect layers*
- `effect.kind`, and `enabled`, default true.
- Parameters, as range, step, default:

| Parameter | Range | Step | Default |
|---|---|---|---|
| `blurRadius` | 0–50 px | 1 | 8 |
| `grainAmount` | 0–1 | 0.01 | 0.15 |
| `grainSeed` | integer | 1 | `GRAIN_SEED` |
| `bloomThreshold` | 0–1 | 0.01 | 0.7 |
| `bloomIntensity` | 0–3 | 0.1 | 1 |
| `bloomRadius` | 0–50 px | 1 | 12 |
| `glowStrength` | 0–3 | 0.1 | 1 |
| `glowThreshold` | 0–1 | 0.01 | 0.7 |
| `aberration` | 0–20 px | 1 | 4 |
| `displacement` | 0–100 px | 1 | 10 |
| `pixelCell` | 2–64 px | 1 | 8 |

*3D layers*
- `position.x/y/z`: −100..100, step 0.1 (1), default 0.
- `rotation.x/y/z`: −360..360°, step 1 (15), default 0.
- `scale.x/y/z`: 0.01..100, step 0.1 (1), default 1.
- `material.kind`: Matcap.
- `material.matcap`: Clay.
- `material.color`: FFFFFF for Matcap, B7A4FF for Glass.
- `material.opacity`: 0..1, step 0.01, default 1 for Matcap and 0.35 for Glass. Switching kind resets colour and opacity to the new kind's defaults.
- `material.refraction`: 0..2, step 0.05, default 1.
- `material.backFaceRefraction`: false.
- `depthTest`: true.
- `faces`: `front` (`both` for Both sides).

*Primitive layers*
- `primitive`: Cube, Sphere, Cylinder, Torus or Plane. Not overridable.

*Extrusion layers*
- `source`: `text` or `svg`.
- `text`: the extruded text.
- `letterHeight`: 0.1..10, step 0.1, default 1.
- `svgAssetId`.
- `depth`: 0.01..10, step 0.01 (0.1), default 0.2.
- `bevelSize`: 0..0.5, step 0.01, default 0.
- `bevelSegments`: 1..4, step 1, default 1.

*Model layers*
- `modelAssetId` or `preset` (Pebble, Arch or Lattice).
- `clips`: a list of `{name, play, loop, speed, offsetMs}`, where speed is 0.25..4 in steps of 0.25 (default 1) and offsetMs is 0..60000 (default 0).

*Particle layers*
- `mode`: `emit` or `form`.

| Setting | Range | Step | Default |
|---|---|---|---|
| `seed` | integer | 1 | `PARTICLE_SEED` |
| `rate` | 0–600 per second | 1 | 30 |
| `burst` | 0–500 | 1 | 0 |
| `lifetime` | 0.1–10 s | 0.1 | 2 |
| `speed` | 0–20 | 0.1 | 2 |
| `gravity` | 0–30 | 0.1 | 9.8 |
| `trailLength` | 0–32 | 1 | 0 |
| `orbit` | −720..720 °/s | 1 | 0 |
| `attractor.x/y/z` | −100..100 | 0.1 | 0 |
| `attractor.strength` | 0–20 | 0.1 | 0 (off) |
| `formation.target` | layer id | — | — |
| `formation.count` | 1–2000 | 1 | 200 |
| `formation.durationMs` | 100–5000 | 1 | 1500 |

*Cloth layers*

| Setting | Range | Step | Default |
|---|---|---|---|
| `columns`, `rows` | 4–20 | 1 | 10 |
| `pinned` | `Top`, `Left`, `Corners`, `None` | — | `Top` |
| `gravity` | 0–30 | 0.1 | 9.8 |
| `windStrength` | 0–20 | 0.1 | 0 |
| `windDirection` | 0–359° | 1 | 0 |
| `stiffness` | 0.1–1 | 0.01 | 1 |
| `damping` | 0–0.2 | 0.01 | 0.02 |
| `iterations` | 1–10 | 1 | 3 |
| `seed` | integer | 1 | `CLOTH_SEED` |

*Events (on any layer)*
- `events.appear`: `{enabled, durationMs 0–1000 (600), delayMs 0–2500 (0), easing, from:{path:value}}`
- `events.hover`: `{enabled, durationMs 0–1000 (300), delayMs 0–2500 (0), easing, forwardsOnly (false), to:{path:value}}`
- `events.tilt`: `{enabled, maxTilt 0–45° step 1 (12), sensitivity 0–1 step 0.05 (1), momentum 0–1 step 0.05 (1)}`
- `events.scroll`: `{enabled, delayPct 0–100 (0), durationPct 1–200 (50), easing, from:{path:value}}`
- `events.loop`: `{enabled, loopDelayMs 0–5000 (0)}`

*Scene*
- `background`: 0B0B0E.
- `environment`: `Dusk room`, `Night grid` or `Flat`; default `Flat`.
- `durationMs`: 500..60000, default 5000.
- `camera.fov`: 10..120°, step 1, default 50.
- `camera.position`: default (0, 0, 10).
- `camera.target`: default (0, 0, 0).
- `camera.near`: 0.01..10, default 0.1.
- `camera.far`: 1..1000, default 100.
- `orbit.enabled`: false.
- `orbit.startAngle` and `orbit.endAngle`: −360..360°, default 0 and 90.
- `light.enabled`: true.
- `light.sensitivity`: 1.
- `light.momentum`: 1.

**2D compositing and Sample.**
- 2D layers composite bottom to top over the scene background in 8-bit sRGB values, with no linearisation. Each channel is taken as c/255.
- With backdrop Cb, source Cs and layer opacity α (the 0–100 % value divided by 100): result = Cb·(1−α) + B(Cb, Cs)·α. Each channel is then floor(v·255 + 0.5).
- Blend function B:
  - Normal: Cs.
  - Multiply: Cb·Cs.
  - Screen: Cb + Cs − Cb·Cs.
  - Overlay: 2·Cb·Cs if Cb ≤ 0.5, else 1 − 2·(1−Cb)·(1−Cs).
  - Darken: the minimum.
  - Lighten: the maximum.
- Worked example: backdrop 336699, source CC8844 at 60 % opacity gives Normal 8F7A66, Multiply 2D4956, Screen 9597A9, Overlay 456A7C, Darken 336666, Lighten 8F7A99.
- A layer with `Mask the layer above` on is not drawn. Instead it limits the layer directly above it: that layer's α becomes α × coverage, where coverage is the mask's opacity inside the mask's shape and 0 outside. Hidden layers neither draw nor mask. Worked example: the same pair at Normal 60 %, with a mask at 50 % opacity covering the point, gives 617080.
- `Sample` reads the composited colour at artboard pixel (x, y), sampled at the pixel centre (x + 0.5, y + 0.5) with hard shape edges. A Rectangle covers its box, an Ellipse the inscribed ellipse and a Polygon its regular polygon.
- What Sample includes:
  - Rectangle, Ellipse, Polygon and Gradient layers are sampled.
  - Text, Image and 3D layers are left out, and so is the light field.
  - Spatial effects (Blur, Bloom, Chromatic aberration, Displacement) are not applied to the sample.
  - Per-pixel effects (Grain, Glow, Pixelate) are applied.
- An effect layer applies to every layer below it in the same group. At the top level that is the composite of everything below. Inside a group, it is the group's lower children composited over the backdrop as it stood where the group begins.
- A disabled effect passes pixels through unchanged.

**Gradients.**
- Linear: angle 0° runs left to right, and positive angles turn clockwise. t = ((p − c)·d)/L + 0.5, with d = (cos θ, sin θ), c the layer box centre and L = |w·cos θ| + |h·sin θ|.
- Radial: t = |p − centre| / radius, where the centre sits at `Centre X`/`Centre Y` percent of the box.
- t is clamped to 0..1. Between the two neighbouring stops, each 8-bit channel is interpolated linearly and then rounded with floor(v + 0.5).
- Worked examples: FF0000 at 0 % to 0000FF at 100 % gives channels 191, 0, 64 (red, green, blue) at t = 25 %. Three stops (FF0000 at 0 %, FFFF00 at 40 %, 0000FF at 100 %) give channels 128, 128, 128 at t = 70 %.

**Effects.**
- **Blur:** Gaussian with σ = radius/2. The readout shows σ to 2 decimals and taps = 2·ceil(3σ) + 1. For example, radius 8 gives `σ 4.00 · 25 taps`.
- **Glow:** Y = 0.2126R + 0.7152G + 0.0722B, using channels divided by 255. Each channel is multiplied by (1 + strength·max(0, Y − threshold)), clamped to 0..1, then floor(v·255 + 0.5).
- **Chromatic aberration:** red is sampled at x + amount and blue at x − amount. For example, amount 4 gives `R +4 px · B -4 px`.
- **Displacement:** offset = amount·(2·h − 1), where h is the grain hash with seed `GRAIN_SEED`.
- **Pixelate:** the colour is read at pixel (floor(x/cell)·cell + floor(cell/2), same for y), at that pixel's centre.
- **Grain** uses this hash, given in full (JavaScript):
  ```
  function grainHash(x, y, seed) { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1274126177)) | 0; h = Math.imul(h ^ (h >>> 13), 1103515245); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
  ```
  Each channel = clamp(floor(c + amount·(h − 0.5)·255 + 0.5), 0, 255), using the same h for all three channels at integer pixel (x, y). Worked example: grainHash(10, 20, 7) = 0.130621…, so 336699 with amount 0.15 becomes channels 37, 88, 139.

**3D transforms and gizmo.**
- World space is right-handed with y up.
- Vertices transform as v' = T·Rz·Ry·Rx·S·v: scale first, then rotation about X, then Y, then Z, then translation. With angles in degrees:
  - Rx: y' = y·cos − z·sin, z' = y·sin + z·cos.
  - Ry: x' = x·cos + z·sin, z' = −x·sin + z·cos.
  - Rz: x' = x·cos − y·sin, y' = x·sin + y·cos.
- Move handles: X and Z use the horizontal pointer movement and Y the vertical movement (up is positive), at 0.01 units per CSS pixel, snapped to 0.01 (0.1 with Shift).
- Rotate rings: 0.5° per horizontal pixel, snapped to 1° (15° with Shift).

**Camera and projection.**
- View = lookAt(position, target, up (0, 1, 0)).
- f = 1/tan(fov/2), where fov is vertical, and aspect = artboard width / height.
- For a point in camera space (xc, yc, zc): ndc x = (f/aspect)·xc/(−zc), ndc y = f·yc/(−zc), screen x = (ndc x + 1)/2·W and screen y = (1 − ndc y)/2·H. W and H are the artboard size. Screen points show to 2 decimals.
- A point whose −zc is outside [near, far] reads `Not visible`.
- `Screen point` uses the selected layer's centre. `Vertex` offers, by the selected layer's kind:
  - Cube: the eight corners `+x +y +z`, `-x +y +z`, `+x -y +z`, `-x -y +z`, `+x +y -z`, `-x +y -z`, `+x -y -z`, `-x -y -z`, in that order (cube corner order), at local ±0.5.
  - Sphere, Cylinder, Torus, text extrusion and Model: the eight corners of the layer's local bounding box, with the same names in cube corner order.
    - Half-extents (x, y, z) before the layer's scale: Sphere 0.5, 0.5, 0.5; Cylinder 0.5, 0.5, 0.5; Torus 0.65, 0.65, 0.15.
    - Text extrusion: half of its `Bounds` on each axis, bevel included.
    - Model: the box enclosing every mesh vertex as placed by its nodes' stored translation, rotation and scale, with no clip applied, so the box never changes with the clock.
  - Plane: `+x +y`, `-x +y`, `+x -y`, `-x -y` (local ±0.5, z = 0).
  - SVG extrusion: `Outline 1` and `Outline <N>`, the first and last outline points on the front face.
  - The layer's own position, rotation and scale then place the chosen point in world space, which the `vertex-world` readout shows.
- Worked examples (Desktop 1440 × 810, default camera):
  - A layer at (1, 2, 0) has centre `806.85, 231.29 px`. At fov 35 it is `848.45, 148.10 px`. On Mobile (390 × 844, fov 50) it is `285.50, 241.00 px`.
  - A cube at (1, 2, 0) with rotation (0, 45, 0) and scale (2, 1, 1) has vertex `+x +y +z` at world (2.061, 2.500, −0.354), screen `892.86, 195.28 px`.
  - A cube at the origin rotated (30, 45, 0) has vertex `+x +y +z` at world (0.837, 0.183, 0.129), screen `793.61, 388.90 px`.

**Primitives.** Unit sizes and triangle counts:

| Primitive | Unit size | Segments | Triangles |
|---|---|---|---|
| Cube | edge 1 | 1 × 1 × 1 | 12 |
| Sphere | radius 0.5, poles on the y axis | 32 × 16 | 960 |
| Cylinder | radius 0.5, height 1, axis along y, capped | 32 radial | 128 |
| Torus | radius 0.5, tube 0.15, ring in the xy plane around the z axis | 48 × 16 | 1536 |
| Plane | 1 × 1 in the xy plane | 1 × 1 | 2 |

**Extrusion.**
- Triangles for a simple polygon of N points: 4N − 4 without a bevel, or 4N − 4 + 4N·segments with one. For example, N = 4 gives 12, or 28 with one bevel segment; N = 6 gives 20, or 68 with two segments.
- Bounds: the outline width × height × depth, each grown by 2 × bevel size when the bevel is above 0, shown to 3 decimals. The geometry is centred on the layer origin, and the front face sits at z = depth/2 + bevel size.
- **Built-in outline font, Halation Block** (generated in code):
  - Characters: A–Z, 0–9, space, and `-`, `.`, `!`. Lowercase shows as uppercase. Any other character is refused with `Character "<c>" is not in the built-in outline font.`
  - Each glyph cell is 0.6 wide and 1.0 tall at letter height 1, with an advance of 0.7. Text of n characters (spaces included) is therefore letterHeight·(0.7n − 0.1) wide and letterHeight tall. `Bounds` always uses this cell box, whichever cells the glyphs fill, and the text is centred on the layer origin.
  - Each glyph is a grid of 3 columns by 5 rows of square cells, each 0.2·letterHeight on a side, filling the glyph cell. Every filled cell is its own 4-point square outline, extruded on its own, and neighbouring cells are never merged.
  - Character i (1-based) has its left edge at −width/2 + (i − 1)·0.7·letterHeight and its top at letterHeight/2. Row 1 is the top row and column 1 the left column. A space fills no cells.
  - `Triangles` for text is the number of filled cells times a square's count: 12 without a bevel, or 12 + 16·segments with one.
  - The glyphs, each written as its five rows from top to bottom (1 = filled, columns left to right), with their filled-cell count:

| Character | Rows | Cells |
|---|---|---|
| A | 010 101 111 101 101 | 10 |
| B | 110 101 110 101 110 | 10 |
| C | 011 100 100 100 011 | 7 |
| D | 110 101 101 101 110 | 10 |
| E | 111 100 110 100 111 | 10 |
| F | 111 100 110 100 100 | 8 |
| G | 011 100 101 101 011 | 9 |
| H | 101 101 111 101 101 | 11 |
| I | 111 010 010 010 111 | 9 |
| J | 001 001 001 101 010 | 6 |
| K | 101 101 110 101 101 | 10 |
| L | 100 100 100 100 111 | 7 |
| M | 101 111 111 101 101 | 12 |
| N | 110 101 101 101 101 | 10 |
| O | 111 101 101 101 111 | 12 |
| P | 110 101 110 100 100 | 8 |
| Q | 010 101 101 110 011 | 9 |
| R | 110 101 110 101 101 | 10 |
| S | 011 100 010 001 110 | 7 |
| T | 111 010 010 010 010 | 7 |
| U | 101 101 101 101 111 | 11 |
| V | 101 101 101 101 010 | 9 |
| W | 101 101 111 111 101 | 12 |
| X | 101 101 010 101 101 | 9 |
| Y | 101 101 010 010 010 | 7 |
| Z | 111 001 010 100 111 | 9 |
| 0 | 010 101 101 101 010 | 8 |
| 1 | 010 110 010 010 111 | 8 |
| 2 | 110 001 010 100 111 | 8 |
| 3 | 110 001 010 001 110 | 7 |
| 4 | 101 101 111 001 001 | 9 |
| 5 | 111 100 110 001 110 | 9 |
| 6 | 011 100 110 101 010 | 8 |
| 7 | 111 001 010 010 010 | 7 |
| 8 | 010 101 010 101 010 | 7 |
| 9 | 010 101 011 001 110 | 8 |
| - | 000 000 111 000 000 | 3 |
| . | 000 000 000 000 010 | 1 |
| ! | 010 010 010 000 010 | 4 |

  - For example, `HALO` at letter height 1, depth 0.2, bevel 0.02 and 1 bevel segment fills 11 + 10 + 7 + 12 = 40 cells. It gives `Bounds 2.740 × 1.040 × 0.240` and `Triangles 1120`. With bevel size 0 it gives `Triangles 480`.
- **SVG extrusion.** The SVG must have exactly one `<path>` using only M, L, H, V and Z commands (absolute or relative). 100 SVG user units = 1 unit, and y is flipped. Refusals, checked in this order:
  1. `This file is not an SVG.`
  2. `This SVG has <n> paths. Extrusion needs exactly one path.`
  3. `Only straight-line path commands (M, L, H, V, Z) are supported.`
  4. `The path crosses itself.`

  For example, `M0 0 L200 0 L200 100 L0 100 Z` gives N = 4, `Bounds 2.000 × 1.000 × 0.200` and `Triangles 12`.

**Materials and draw order.**
- Matcaps `Clay`, `Chrome`, `Jade` and `Ember` and the environments are generated in code. The environment is also the reflection map.
- Glass index of refraction = 1 + 0.25 × refraction strength, shown as `IOR <i>` to 3 decimals (for example `IOR 1.250`). Glass with back-face refraction always draws both sides.
- `Draw order` lists every visible 3D layer's draws:
  1. First, depth-tested layers in stack order (bottom first), each `<name> · depth on`.
  2. Then layers with depth testing off, in stack order, each `<name> · depth off · on top`.
  3. A Both-sides layer appears as two consecutive items, `<name> · back faces` and then `<name> · front faces`.
- `Triangles drawn` for the selected layer equals its triangles, doubled when it draws both sides.

**glTF models.**
- Accepted: `.glb` or `.gltf` (glTF 2.0) within this subset:
  - meshes with POSITION and NORMAL (FLOAT VEC3), optional indices (UNSIGNED_SHORT or UNSIGNED_INT), and mode TRIANGLES;
  - node translation, rotation (quaternion) and scale;
  - buffers embedded as `data:` URIs or in the GLB binary chunk;
  - animations on translation, rotation and scale with LINEAR or STEP interpolation.
- Refusals, checked in this order. 1 MB = 1,048,576 bytes, shown to one decimal.
  1. Larger than `MODEL_MAX_BYTES` → `This file is <x.x> MB; the limit is <y.y> MB.`
  2. Not parseable → `This file is not a valid glTF or GLB file.`
  3. `asset.version` not 2.0 → `Only glTF 2.0 files are supported.`
  4. Compression in `extensionsRequired` → `Compressed meshes (<extension name>) are not supported.`
  5. External URI → `External buffer URIs are not supported: embed buffers in the file.`
  6. Node `matrix` → `Node matrices are not supported; use translation, rotation and scale.`
  7. CUBICSPLINE → `Animation interpolation CUBICSPLINE is not supported; use LINEAR or STEP.`
  8. More vertices than `MODEL_MAX_VERTICES` → `This model has <n> vertices; the limit is <limit>.`

  A file exactly at a limit is accepted.
- Preset models `Pebble`, `Arch` and `Lattice` are generated in code.
- Clips are listed as `<clip name> · <duration> s`, with the duration to 3 decimals.

**Clip sampling.**
- Clip time at timeline time T seconds (T = frame/60): c = max(0, T − offset)·speed. A looping clip uses c mod duration; a non-looping clip uses min(c, duration). A clip that isn't playing stays at c = 0.
- LINEAR interpolates translation and scale linearly and rotation by normalised slerp. If the quaternion dot product is negative, the second quaternion is negated; if the dot is above 0.9995, normalised lerp is used instead.
- STEP uses the keyframe at or before c.
- Before the first keyframe the first value applies, and after the last the last value applies.
- When two clips drive the same node property, the clip later in the list wins.
- The inspector shows the selected `Node`'s transform at the current frame: translation and scale to 3 decimals, rotation as a quaternion to 4 decimals and as Euler degrees (X, Y, Z, matching the transform order) to 3 decimals.
- Worked example: rotation about Y from 0° at 0 s to 90° at 2 s, and translation from (0, 0, 0) to (2, 1, 0), LINEAR.
  - At 0.5 s: q = (0.0000, 0.1951, 0.0000, 0.9808), 22.500°, translation (0.500, 0.250, 0.000).
  - At 1.5 s: q = (0.0000, 0.5556, 0.0000, 0.8315), 67.500°.
  - At timeline 2.6 s with speed 1.5: looping gives clip time 1.9 s and q = (0.0000, 0.6788, 0.0000, 0.7343); not looping gives clip time 2.0 s.

**Particles.**
- Seeded random source, given in full (JavaScript):
  ```
  function mulberry32(seed) { let a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  ```
  For example, mulberry32(42) gives 0.6011037519, 0.4482905590, 0.8524657935, 0.6697340414.
- Simulation uses a fixed step dt = 1/60 s, one step per timeline frame. Step 0 is time 0, and the burst spawns at step 0. For each step k ≥ 1, in this order:
  1. Every live particle, in number order: a = (0, −gravity, 0) + strength·(A − p); v = v + a·dt; p = p + v·dt. Then orbit rotates p about the emitter's vertical axis by θ = orbit·dt degrees: x' = x·cos θ + z·sin θ, z' = −x·sin θ + z·cos θ.
  2. A particle born at step b is removed after step b + round(lifetime·60).
  3. floor(rate·k/60) − floor(rate·(k−1)/60) new particles spawn, born at step k.
- Spawning:
  - Each new particle takes the next number (1, 2, …; numbers are never reused) and starts at the emitter origin.
  - It draws u1, u2, u3 in order and starts with v = ((2u1−1)·speed, (2u2−1)·speed, (2u3−1)·speed).
  - A spawn that would make live particles exceed `PARTICLE_MAX` is skipped. It takes no number and draws no randoms.
- Trail keeps a particle's last `trailLength` positions, including its current one, and never affects motion. `Trail points` = min(trailLength, steps since birth + 1).
- Positions are emitter-local, to 3 decimals, at the current frame.
- Worked example A (seed 7, burst 3, rate 0, speed 2, gravity 9.8): at frame 2, particle 1 is at (−0.065, −0.067, 0.064).
- Worked example B (seed 7, burst 3, rate 30, speed 2, gravity 9.8, lifetime 0.5 s, orbit 90 °/s, attractor (0, 1, 0) at strength 4):
  - frame 29: 17 live, particle 1 at (−0.433, −1.367, 1.006);
  - frame 30: 15 live (particles 4–18);
  - frame 45 (`00:00.750`): 15 live (particles 11–25), particle 20 at (0.042, −0.222, −0.337), and particle 1 is not alive.
- **Formation** (`mode` `form`):
  - `formation.count` particles are all alive from frame 0.
  - Particle i (1-based) starts at (4u1−2, 4u2−2, 4u3−2), drawn from mulberry32(seed) in particle order.
  - It moves to target point ((i−1) mod V) with progress Glide(t/duration), where t = frame·1000/60 ms. After the duration it rests on its point.
  - Target points, in world space with the target's transform, then made local to the particle layer:
    - Cube: the 8 corners in `Vertex` order.
    - Plane: its 4 corners.
    - Sphere, Cylinder, Torus or Model: the 8 corners of its bounding box in cube corner order.
    - SVG extrusion: outline points 1..N on the front face.
    - Text extrusion: for each character except spaces, in order, the 4 corners of its glyph cell on the front face, in the order top-left, top-right, bottom-right, bottom-left.
  - For example, forming into `HALO` (letter height 1, depth 0.2, bevel 0.02) at the origin, from a particle layer at the origin: particle 1 rests at (−1.350, 0.500, 0.120), particle 6 at (−0.050, 0.500, 0.120), and particle 17 at the same point as particle 1.

**Cloth.**
- Points are named `R<row> C<col>`, with row 1 at the top. Rest position: x = (col − 1 − (C−1)/2)·0.1, y = −(row − 1)·0.1, z = (u − 0.5)·0.002, with u drawn from mulberry32(seed) in row-major order over all points.
- Pinned edges:
  - `Top`: all of row 1.
  - `Left`: all of column 1.
  - `Corners`: `R1 C1` and `R1 C<columns>`.
  - `None`: nothing pinned.

  Pinned points never move.
- Fixed step 1/60 s, one step per frame. Each step:
  1. Every unpinned point, in row-major order (Verlet): v = (p − prev)·(1 − damping); prev = p; p = p + v + a·dt², with a = (wind·cos φ, −gravity, wind·sin φ). Wind direction 0° points to +x and 90° to +z.
  2. Repeat `iterations` times: for each point in row-major order, solve its constraint to the right neighbour, then to the lower neighbour, with rest length 0.1. d = p2 − p1, L = |d|, diff = (L − 0.1)/L·stiffness. If both points are free, p1 += d·diff/2 and p2 −= d·diff/2. If one is pinned, only the free one moves, by the full d·diff.
- Positions are layer-local, to 3 decimals.
- Worked example (4 × 4, seed 3, `Top`, wind 2 at 0°, other settings default):
  - `R4 C1` is at (−0.150, −0.300, 0.000) at frame 0, (−0.051, −0.285, 0.001) at frame 30 and (−0.114, −0.300, 0.000) at frame 60.
  - `R2 C4` is at (0.180, −0.097, −0.001) at frame 30.
  - With pinned edge `Corners`, `R4 C1` is at (−0.031, −0.276, 0.001) at frame 30.

**Easing.**
- Cubic Bézier presets, given as control points x1, y1, x2, y2:

| Preset | x1 | y1 | x2 | y2 |
|---|---|---|---|---|
| Linear | 0 | 0 | 1 | 1 |
| Ease | 0.25 | 0.1 | 0.25 | 1 |
| Ease in | 0.42 | 0 | 1 | 1 |
| Ease out | 0 | 0 | 0.58 | 1 |
| Ease in-out | 0.42 | 0 | 0.58 | 1 |
| Glide | 0.22 | 1 | 0.36 | 1 |
| Anticipate | 0.36 | 0 | 0.66 | −0.56 |

- Elastic: 2^(−10t)·sin((10t − 0.75)·2π/3) + 1, which is 0 at t ≤ 0 and 1 at t ≥ 1.
- Bouncy: the standard out-bounce with n = 7.5625 and d = 2.75.
- Spring: stiffness k, damping c and mass m, with the ranges and defaults below. x runs from 0 toward 1 by semi-implicit Euler at 1/60 s: a = (−k(x−1) − c·v)/m; v += a/60; x += v/60. Spring ignores segment length: E is x after (frame − start keyframe frame) steps, and at the next keyframe's frame the value becomes that keyframe's value.
- Worked values at t = 0.5: Ease 0.802, Ease in 0.315, Ease out 0.685, Ease in-out 0.500, Glide 0.961, Anticipate −0.087, Elastic 1.016, Bouncy 0.766. Spring at its defaults reads 0.845 after 15 frames and 0.983 after 30.
- **Easing in JSON.**
  - A keyframe `easing` is one of the strings `linear`, `ease`, `ease-in`, `ease-out`, `ease-in-out`, `glide`, `anticipate`, `elastic` or `bouncy`, or a Spring object `{"type":"spring","stiffness":<k>,"damping":<c>,"mass":<m>}`.
  - An event `easing` (appear, hover, scroll) is one of those nine strings only. Spring is a keyframe-only easing and has no event form.

  Any other value, including a Spring object on an event, answers 422 with `Choose one of the listed easings.` at the `easing` path.
- The keyframe `Easing` combobox lists `Linear`, `Ease`, `Ease in`, `Ease out`, `Ease in-out`, `Glide`, `Anticipate`, `Elastic`, `Bouncy` and `Spring`. The `Appear easing`, `Hover easing` and `Scroll easing` comboboxes list the same names without `Spring`.
- Spring parameters, each with range, step (Shift step) and default:
  - `Spring stiffness`: 1–1000, step 1 (10), default 170.
  - `Spring damping`: 0–100, step 1 (10), default 26.
  - `Spring mass`: 0.1–10, step 0.1 (1), default 1.

  These fields show only when the focused keyframe's easing is Spring.
- A new keyframe takes `linear`. A new appear, hover or scroll event takes `glide`.

**Keyframes and timeline.**
- The timeline runs at 60 frames per second, for 0.5–60 s (default 5 s).
- Time readout: `MM:SS.mmm`, with ms = round(frame·1000/60). For example, frame 75 is `00:01.250`.
- Keyframes sit on whole frames, at most one per property per frame. Between keyframes k1 (frame f1, value v1, k1's easing E) and k2 (f2, v2), the value is v1 + (v2 − v1)·E((f − f1)/(f2 − f1)). Before the first keyframe its value applies, and after the last its value applies.
- Example: Rotation Y at 0° at 0 s and 90° at 1 s, with Ease out, reads `61.618` at 0.5 s; with Ease in it reads `28.382`.
- Keyframe buttons are named `<Property> keyframe at <time readout>`.

**Events.**
- **Appear:** progress = E((t − delay)/duration), where t is timeline time. Values go from `from` to the layer's own value.
- **Hover:** the pointer is over a 3D layer when it is inside the rectangle spanned by the layer's projected bounding-box corners. Values move to `to` over the duration after the delay. On hover-out they reverse over the same duration, unless `Forwards only` is on.
- **Mouse movement smoothing:** each 60 Hz frame, value += (target − value)·f, with f = 1 − 0.92·momentum. Momentum 1 gives f = 0.08 and momentum 0.5 gives f = 0.54. A pointer change takes effect at the next frame. Frames are counted from elapsed clock time (60 per second), so results don't depend on the display rate.
- **Scroll into view:** entered = (viewport height − element top)/viewport height·100, where the stage's virtual top is viewport height·(1 − scroll progress/100), so entered equals the scroll progress. progress = clamp((entered − delay)/duration, 0, 1). Example: entered 25 %, delay 10 % and duration 50 % give progress 0.300, and Ease out on opacity 0 → 1 then gives 0.445.
- **Loop:** with Loop on, the appear animation restarts every duration + loop delay.
- Every 3D property (transform, camera, material, particle, cloth) is keyframeable, overridable per breakpoint, and animatable through appear, hover, mouse movement, scroll and the timeline.

**Follow Light (cursor tilt and light focus).**
- Pointer n = (x/W)·2 − 1 and m = (y/H)·2 − 1 over the stage, where W and H are the stage's displayed size.
- With `Tilt toward cursor` on: target rotation Y = n·sensitivity·max tilt and target rotation X = −m·sensitivity·max tilt. The tilt is added to the layer's rotation and smoothed per frame as above. `Tilt X`/`Tilt Y` show the current tilt, and `Tilt target` shows the target (X, Y), all to 3 decimals.
- The light focus target is (x/W, y/H), with rest at (0.800, 0.900), smoothed with the scene's light momentum in the same way and shown to 3 decimals.
- When the pointer leaves, each value eases from its current value to rest (tilt 0, focus at rest) over 1200 ms with Glide.
- Worked example, pointer at 75 % width (n = 0.5), max 12°:
  - Momentum 1 (f = 0.08): tilt Y is 0.480 after 1 frame, 3.394 after 10 and 5.508 after 30.
  - Momentum 0.5 (f = 0.54): 3.240 after 1 frame.
  - Leaving from 6.000: 1.411 at 300 ms and 0.232 at 600 ms.

**Scroll camera orbit.**
- With `Scroll orbit` on: camera azimuth = start + (end − start)·progress, about the target at the camera's current horizontal distance, with its height kept. Azimuth 0 puts the camera on +z, and positive angles turn it toward +x.
- Progress comes from `Scroll progress` in the editor. In the embed it is the page's real scroll progress, scrollY / (page height − viewport height)·100.
- `Camera azimuth` shows the angle to 3 decimals.
- Example: a layer at (1, 2, 0) with the default camera reads `720.00, 211.99 px` at azimuth 90° and `786.09, 218.08 px` at azimuth 45°.

**Reduced motion.** In the editor with `Reduce motion`, and in the embed when the device asks for reduced motion:
- every appear, hover, scroll and keyframe animation shows its end pose (its own value, or the last keyframe's value);
- tilt stays at rest (0), while `Tilt target` still reports the target;
- the scroll orbit shows its end angle;
- clips show frame 0;
- particles and cloth show their state at frame 0;
- the light focus stays at rest;
- text appears with a 150 ms fade.

**Variables and presets.**

| Type | Values | Binds to |
|---|---|---|
| Number | −1,000,000..1,000,000, 3 decimals | any numeric property, clamped to that property's range; the field then shows `Clamped to <limit>`, with the range end as written in the property table |
| Boolean | true or false | visibility or effect `Enabled` |
| Text | up to 200 characters | text content |
| Colour | `#RRGGBB` | colour properties |
| Vector 2 | (x, y) | 2D position (`x`, `y`) |
| Vector 3 | (x, y, z) | Position, Rotation or Scale of a 3D layer |

- Names match `[a-z][a-z0-9_]{0,31}` and are unique per project.
- A bound field shows `Bound to <name>` and is read-only.
- Deleting a variable unbinds every property bound to it. Each property keeps the variable's last value, and the status counts each binding once (a Vector 3 bound to Rotation counts as 1).
- `Save preset` stores the current value of every variable under the preset name.
- `Apply <preset>` sets only the variables the preset names, while the others keep their values. It counts as one undo step and reaches every open editor and viewer within 2 s.

**JSON export and import.**
- **Document shape:** `{"schemaVersion":3,"name","variables":[{"name","type","value"}],"presets":[{"name","values":{}}],"scenes":[{"id","name","background","environment","durationMs","camera":{"fov","position":{"x","y","z"},"target":{"x","y","z"},"near","far"},"orbit":{},"light":{},"layers":[{"id","name","kind","parentId","order","visible","locked","maskAbove","blendMode","props":{},"overrides":{"tablet":{},"mobile":{}},"keyframes":[{"property","frame","value","easing"}],"events":{},"bindings":{}}]}]}`.
- Layer kinds are `Rectangle`, `Ellipse`, `Polygon`, `Text`, `Image`, `Gradient`, `Effect`, `Primitive`, `Extrusion`, `Model`, `Particles`, `Cloth` and `Group`.
- Required fields: `schemaVersion`, `name`, `scenes`, each scene's `id`, `name` and `layers`, and each layer's `id`, `name` and `kind`. Every other missing value takes its default in the working copy only.
- **Import refusals,** reported one at a time. The checks run in the order below; each walks the document depth-first in the order keys appear in the file, array items by index, and the first problem found is reported:
  1. `This file is not valid JSON.`
  2. `Missing field: schemaVersion`
  3. `This file uses schema version <n>; this app reads up to version 3.`
  4. `Missing field: <path>` (for example `scenes[0].layers[2].kind`)
  5. `Unknown layer kind "<kind>" at <path>.`
  6. `Value out of range: <path> is <value> (allowed <min> to <max>).`
- A valid import:
  - creates project `<name> (imported)` with the importer as Owner;
  - stores the original bytes unchanged under `projects/<projectId>/imports/original.json`, downloadable through `Download original import`;
  - keeps the document's scene ids and layer ids.
- **Exports are always complete.** Working exports, version bundles and version exports write the complete document:
  - every field of the document shape;
  - every property in the property table that applies to the layer's kind or to the scene, with its current value, defaults included;
  - `overrides` holding only the values actually overridden.

  An imported file that omitted optional values therefore exports with those defaults filled in, while its stored original keeps the omissions.
- **"Identical" means deep JSON equality:** the same keys and values at every level, ignoring key order and whitespace, with numbers compared after rounding to 3 decimals.
  - Exporting an imported project gives the imported document with every missing value filled with its default and `name` set to `<name> (imported)`.
  - Re-importing any export (working or version) and exporting again gives a document identical to that export apart from `name`.

**Derived counters.**
- `layerCount` counts the project's layers in every scene, excluding groups and the camera, and counting layers inside groups.
- `liveVersion` is the live version's number.
- `editorCount` and `viewerCount` count accepted members with those roles. The owner and pending invites are not counted.
- All four are recomputed from the stored rows on every read. They match after adds, deletes, undo, redo, member removal and restore.

**Mail.**
- Every mail is written to the outbox table first, in the same transaction as the change that causes it, and then sent.
- If sending fails, the row stays `queued` and every running copy of the app retries queued rows every 10 seconds. A copy claims each row in a transaction before sending it, so each mail leaves exactly once.
- A mail outage never blocks or duplicates an invite or a publish.

### Services (DP-06, DP-07, DP-18, DP-21, DP-40, DP-42)

- **PostgreSQL** (`DATABASE_URL`) is the source of truth after a reload. It holds workspaces, people, sessions, members, invites, projects, scenes, layers, keyframes, variables, presets, breakpoint overrides, layer locks, the op history, idempotency records, the clock offset, the mail outbox, and the numbered version rows (each with the full scene document). Every time it starts, the app applies its schema idempotently to the database `DATABASE_URL` names. That database always exists but may be empty.
- **MinIO** (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`) stores objects under these keys:
  - uploads: `projects/<projectId>/assets/<assetId>/original`
  - import originals: `projects/<projectId>/imports/original.json`
  - version bundles: `projects/<projectId>/versions/<n>/scene.json`

  Every object holds the exact bytes. An object counts only after the app has read its metadata back.

  At start the app creates the bucket named by `S3_BUCKET` if it does not exist, and keeps one that does. If storage is unreachable at start, the app creates the bucket as soon as storage answers, before the first upload, import, publish or seed succeeds.

  **When storage is unreachable:**
  - Uploads, imports, publishing and the grading seed answer 503 with the storage copy from Feedback states.
  - The editor and inspector keep working from PostgreSQL.
  - `GET /api/health` reports `unavailable`.
  - `/api/embed/<projectId>/scene` serves the same bytes from the version row with `X-Scene-Source: row`.
  - The embed draws every layer it can, and shows each image or model layer as a dim box named `<layer name> (storage unavailable)`.
- **Mailpit** (`SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL`) receives mail from `MAIL_FROM` (`Halation Studio <studio@tinderbox-optics.test>`):
  - **Invite**, to the invited email. Subject: `Join <project name> in Halation Studio`. The body names the inviter and the role, contains the accept link `<APP_PUBLIC_URL>/invite/<token>`, and says `This link works once and expires on <date> at <time>.`
  - **Publish notice**, to every owner and editor of the project, one mail per person per version. Subject: `<project name> version <n> is live`. The body names the publisher and links to the project.

  **When Mailpit is unreachable:** the invite or publish still answers success, its rows show the queued copy from Feedback states, and the mail is sent once on recovery.

### Seed data (DP-02, DP-03)

Every person, workspace, project and file below is invented. `POST /api/grading/seed` creates exactly this, at server time `APP_START_AT`.

**People.**

| Name | Email | Password | Workspace role |
|---|---|---|---|
| Ines Okafor | `ines@lumenyard.test` | `halation-ines-01` | owner of Lumen Yard |
| Mara Lindqvist | `mara@lumenyard.test` | `halation-mara-01` | — |
| Tomas Reyes | `tomas@lumenyard.test` | `halation-tomas-01` | — |
| Pavel Duarte | `pavel@quarryhall.test` | `halation-pavel-01` | owner of Quarry Hall |

Ines owns every Lumen Yard project. Mara is an Editor and Tomas a Viewer of every Lumen Yard project except Orbit study, where Tomas is a Viewer and Mara is not a member. Seeded memberships count as invites accepted before the start. Each project's scene is named `Main` unless stated otherwise, and layers use default values unless stated otherwise.

**Projects in Lumen Yard.**
- **Lumen hero** (not published):
  - `Halo cube`: Cube at (1, 2, 0), rotation (0, 45, 0), scale (2, 1, 1), Matcap Clay. Tilt toward cursor on (max 12, sensitivity 1, momentum 1). Appear from material opacity 0, 600 ms, Glide. Tablet override rotation Y 30.
  - `Pebble`: preset model at (−2, 0, 0).
  - `Swing`: uploaded model `swing.gltf`, clip `Turn` playing and looping.
  - `Sparks`: particles with seed 7, rate 60, burst 0, lifetime 2, speed 2, gravity 9.8.
- **Orbit study:**
  - `Probe`: Sphere at (1, 2, 0) with Tilt toward cursor on (max 12, sensitivity 1, momentum 1).
  - `Arch`: preset model at (−2, 0, 0).
  - Scroll orbit on, start 0°, end 90°. Light field on.
- **Logo forge:**
  - `Wordmark`: text extrusion `HALO`, letter height 1, depth 0.2, bevel 0.02, 1 segment, at the origin.
  - `Swarm`: particles as in worked example B.
  - `Drift`: particles as in worked example A, with lifetime 2 and trail length 8.
  - `Formation`: particles in Form into `Wordmark`, count 32, duration 1500 ms, seed 7.
- **Model bay** (version 1 live, published by Ines):
  - `Swing`: model `swing.gltf`.
  - `Grain plate`: image `grain-plate.png`, 64 × 64 px.
  - `swing.gltf` (text glTF, embedded buffers) has nodes `Arm` and `Foot`, each with a 24-vertex box mesh, and two clips:
    - `Turn`: 2 s, LINEAR, on `Arm`, the rotation and translation of the clip worked example. Playing, not looping, speed 1, offset 0.
    - `Hop`: 1 s, STEP, on `Foot`, translation (0, 0, 0) at 0 s, (0, 1, 0) at 0.5 s and (0, 0, 0) at 1 s. Not playing.
- **Banner test:**
  - `Banner`: cloth 4 × 4, seed 3, `Top`, wind 2 at 0°.
- **Easing lab:**
  - `Turner`: Cube with Rotation Y keyframes 0 at frame 0 (Ease out) and 90 at frame 60.
  - `Blank`: Cube with no keyframes.
- **Variable room:**
  - `Spinner`: Cube.
  - Variables: `spin` (Vector 3, (0, 45, 0)), `boost` (Number, 150), `tint` (Colour, B7A4FF).
  - Presets: `Calm` {spin: (0, 0, 0)} and `Lively` {spin: (0, 90, 15), boost: 2}.
- **Backdrop** (2D), three scenes:
  - Scene `Blend`, background 336699:
    - `Veil`: Rectangle at 0, 0, size 720 × 810, fill FFFFFF, opacity 50, hidden, mask off, order 0.
    - `Wash`: Rectangle at 0, 0, size 1440 × 810, fill CC8844, opacity 60, Normal, order 1.
  - Scene `Ramp`, background 000000:
    - `Spectrum`: Linear gradient, 0°, box 0, 0, 1440 × 810, stops FF0000 at 0 %, FFFF00 at 40 %, 0000FF at 100 %.
  - Scene `Grain`, background 336699:
    - `Grain`: Grain effect, amount 0.15, seed 7.
- **Phone kit** (2D), bottom to top:
  - `Base`: Rectangle.
  - `Glow`: Ellipse.
  - `Spark`: Polygon.
  - `Caption`: Text `Ship it`.

**Project in Quarry Hall.**
- **Quarry teaser** (owner Pavel, not published):
  - `Slab`: Cube.

**Seed response.** `201 {"workspaces":{"<name>":"<id>"},"people":{"<email>":{"id","name","session"}},"projects":{"<project name>":{"id","scenes":{"<scene name>":"<id>"},"layers":{"<layer name>":"<id>"},"assets":{"<file name>":"<id>"},"versions":[<numbers>]}}}`. `session` is a valid `hs_session` cookie value for that person.

## Technical requirements

### Deployment (DP-01, DP-12)

Backend: TypeScript on Node 22 with npm. Frontend: TypeScript built with Node 22 in the same `build` step.

- `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`. For example: `{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}`.
- The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set.
- `GET /api/health` answers 200 JSON as published in API.
- The lockfile is committed.
- The stage uses WebGL2 (three.js under the MIT licence is allowed) and falls back to a 2D canvas.
- Icons come from a bundled ISC-licensed set.

### Configuration and secrets (DP-12)

Read every value at start. Never hard-code a value or send it to the browser.
- **Services:** `DATABASE_URL`; `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`; `SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL`, `MAIL_FROM`.
- **Links:** `APP_PUBLIC_URL`, the origin used in mail links.
- **Grading, time, limits and seeds:**

| Variable | Default |
|---|---|
| `GRADING_KEY` | — |
| `APP_START_AT` | `2026-11-06T10:00:00Z` |
| `APP_TIME_ZONE` | `Europe/Lisbon` |
| `AUTOSAVE_MS` | 800 |
| `UNDO_LIMIT` | 100 |
| `LOCK_TIMEOUT_SECONDS` | 30 |
| `PUBLISH_LIMIT` | 20 |
| `EMBED_POLL_SECONDS` | 30 |
| `INVITE_TTL_HOURS` | 72 |
| `IMAGE_MAX_BYTES` | 1048576 |
| `IMAGE_MAX_DIMENSION` | 2048 |
| `MODEL_MAX_BYTES` | 2097152 |
| `MODEL_MAX_VERTICES` | 50000 |
| `PARTICLE_MAX` | 2000 |
| `PARTICLE_SEED` | 7 |
| `CLOTH_SEED` | 3 |
| `GRAIN_SEED` | 11 |

- **Images:** PNG, JPEG or WebP, up to `IMAGE_MAX_BYTES` and `IMAGE_MAX_DIMENSION` px per side (the limits themselves are allowed). Refusals: `Only PNG, JPEG and WebP images are supported.`, `This image is <x.x> MB; the limit is <y.y> MB.`, `This image is <w> × <h> px; the limit is <d> px per side.`

### Server boundary (DP-04, DP-21)

- Same origin only. The server sends no CORS headers, and a state-changing request whose `Origin` header names another origin answers `403 {"error":"cross_origin","message":"Requests must come from this site."}` before any other check.
- Body limits are as published in API.
- The server never serves source files, `.env` files, credentials, raw storage URLs or other people's objects. Uploaded originals are served only through the app's own routes after the visibility check.
- The embed page loads no outside script, font or JSON.
- The `/api/grading/*` routes are hidden (404) without the key.
- If PostgreSQL is unreachable at start, the server keeps retrying the connection and answers 503 on API routes until it connects. If storage or Mailpit is unreachable at start, the server still starts and behaves as described in Services.
- The graders may run extra copies of the app at the same time, with one service pointed at an unreachable address. Each copy runs either against the same database and bucket or against a fresh empty database with a bucket name that may not exist yet. Both are prepared at start as described in Services. Keep all shared state (sessions, locks, clock offset, outbox, idempotency records) in PostgreSQL.
- Each copy's live channel serves the browsers connected to that copy.

### Browser support and performance (DP-11, DP-41)

- Current Chromium, Firefox and Safari, at 375×812, 768×1024 and 1280×800, plus the 390×844 phone editor.
- The editor is usable within three seconds of load on the seed data.
- Inspector readouts update within one frame of a clock or field change.
- Open embeds switch versions within 2 s while connected.
- Every behaviour works without WebGL2, on the 2D fallback.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`, and nothing else is needed to run the app.
- IF-02: `THIRD_PARTY_NOTICES.md` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) with its licence.
- IF-03: Shipped packages use only MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, CC0-1.0 or BlueOak-1.0.0 licences.
- IF-04: No datastore, cache or queue beyond PostgreSQL and MinIO, and no service beyond PostgreSQL, MinIO and Mailpit.
- IF-05: The repository ships no font, image, model, matcap or video files. Every visual asset is generated in code or comes from the bundled icon package.
- IF-06: The provided service configuration and seeded development settings are left unchanged.
- IF-07: `package-lock.json` is committed, and `install` uses it.
- IF-08: The running app fetches nothing from outside hosts.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript on both server and client, with no `any` escape hatches on domain data.
- Names match this brief's domain terms: layer, override, breakpoint, keyframe, version, bundle, outbox, lock, variable, preset.
- Each domain rule is decided in exactly one place and reused wherever needed: each formula, each state transition, each derived counter and each refusal text. The inspector, the embed and the evaluate route share one evaluator.
- There are no abstractions with a single implementation, and no dead, commented-out or unreachable code.
- There are no defensive checks for states the data model rules out. Input validation happens once, at the server boundary.
- Every API error uses the one published error shape, built in one place.
- No features exist beyond this brief.
