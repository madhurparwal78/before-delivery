# TRUTH: Halation Studio golden

Every value says where it came from: `brief: <section>` (copied from the brief) or `decided: <why>` (the brief is
silent; the reason ties it to the brief's intent).

## Product frame

Halation Studio is a browser editor for layered, interactive 2D and 3D hero scenes. One TypeScript server on Node 22
keeps every record in PostgreSQL, keeps uploads, original imports and published bundles byte for byte in MinIO, sends
invites and publish notices through Mailpit, and carries live edits, presence, layer locks and new versions over a
WebSocket at `/ws` (brief: intro, Services). Sign-in is local with email and password (brief: intro). The app listens on
`0.0.0.0:4173` or `APP_PUBLIC_PORT` (brief: Deployment). `GET /api/health` answers `200 {"status":"ok"}`, or
`200 {"status":"unavailable"}` while storage is unreachable, never 503 (brief: API, Health and grading).

## Journeys (ideal end-to-end flows)

1. **Place a 3D object exactly** (brief: Journeys 1).
   - Start: Ines (owner, `ines@lumenyard.test`) signs in with the keyboard on `/signin` and lands on `/projects`; opens
     `Orbit study`.
   - Actions: `Add layer` menu by keyboard, `Torus`; focus moves to the new `Torus, Primitive` row. Arrow keys set a
     position (step 0.1, Shift 1), a typed rotation, the drag gizmo scales or moves (0.01 units per CSS pixel, snapped
     to 0.01, 0.1 with Shift). `Screen point` and the `Vertex` readouts show `<x>, <y> px`; narrowing `Field of view`
     changes both.
   - End state: `Save status` reads `All changes saved` within `AUTOSAVE_MS` of the last change; after a reload every
     value is still there (PostgreSQL).
2. **Make the logo out of light** (brief: Journeys 2). In `Logo forge`, `Wordmark` shows `Bounds 2.740 × 1.040 × 0.240`
   and `Triangles 1120` for `HALO`; an uploaded one-path SVG extrudes; material switches Matcap to Glass (`IOR 1.250`);
   `Depth testing` off reorders `Draw order`; `Formation` shows particle positions per frame. A three-path SVG answers
   `This SVG has 3 paths. Extrusion needs exactly one path.`; an unsupported character answers
   `Character "<c>" is not in the built-in outline font.`
3. **Animate a model and a banner** (brief: Journeys 3). `Model bay`: upload a glTF, `Play Turn`, `Loop Turn`, speed 1.5,
   read node transforms; `Banner test`: cloth points at frames 0, 30, 60; `Reduce motion` shows the frame-0 state.
4. **Tune the pointer response** (brief: Journeys 4). `Preview` on, hover at 75 % width: `Tilt X/Y`, `Tilt target`,
   `Light focus` count toward the target; leaving eases back over 1200 ms. `Scroll progress` orbits the camera; the
   embed orbits with real scrolling.
5. **Fit every breakpoint** (brief: Journeys 5). Tablet override of a rotation, Mobile inherits it; reset removes it;
   the embed picks Desktop at 1024 px and wider, Tablet from 640 to 1023, Mobile at 639 and narrower.
6. **Work together** (brief: Journeys 6). Owner invites Mara as `Editor`; the invite arrives in Mailpit once with a
   single-use link; Mara accepts, edits; Ines sees `Held by Mara Lindqvist`, is refused with
   `Mara Lindqvist is editing this layer.`; after `LOCK_TIMEOUT_SECONDS` of server time Ines edits. Tomas (`Viewer`)
   sees every edit control unavailable. Presets switch the whole look live for everyone within 2 s.
7. **Ship and roll back** (brief: Journeys 7). Publish creates version 1 (`Version 1 is live.`); unpublished edits stay
   out of the embed; version 2 appears without a reload; `Republish version 1` ships version 3; every owner and editor
   gets one mail per version; Mara answers `Only the owner can publish.`
8. **Tidy up on a phone and bring in a file** (brief: Journeys 8). 390×844: `Editor panels` tabs, row menu
   `Move up`/`Move down`/`Duplicate`/`Group`/`Ungroup`/`Delete`, Undo and Redo; two broken JSON files are refused at the
   first problem; a valid file becomes `<name> (imported)` whose original bytes download unchanged; trash and restore
   bring the project back intact.

## Palette roles (brief: Visual design, Colour roles; hex values decided in DESIGN.md)

| Role | Hex | Source |
|---|---|---|
| ground | `#0B0B0E` | brief: Property table, scene `background` default `0B0B0E`; near-black with a faint blue cast |
| surface | `#141418` | decided: slightly lifted charcoal, 12.5:1 with the ink |
| raised | `#1C1C22` | decided: a step lighter again for inputs and icon squares |
| hairline | `#2A2A31` | decided: dim grey-violet |
| ink | `#D6D3E6` | decided: pale lavender-white |
| muted | `#8B8A98` | decided: muted grey-lavender, 5.4:1 on surface |
| accent | `#8E6CF2` | decided: the single saturated violet (pill dot, playhead, selected-row marker, focus ring) |
| canvas light | `#B7A4FF` | brief: Glass `material.color` default `B7A4FF`; paler periwinkle only inside canvas light |
| warn | `#F2A23A` | decided: amber for `Not visible`, `Clamped to …`, particle cap, every error and outage notice |

## Type, space and layout

- Display headings use the system grotesk (`system-ui`, Segoe UI, Roboto) at semibold, set tight; one accent word per
  headline switches to the system serif (`ui-serif`, Georgia) in regular italic (brief: Visual design, Typefaces).
  Body 15 px with tabular figures for every number; each heading level is 1.25 times the one below
  (brief: Typefaces). A monospace system face appears only in the JSON export view. No font file ships.
- Panels radius 10 px, controls 4 px, panel padding 16 to 24 px, phone insets 15 px (brief: Screens and layout,
  Composition).
- Viewports 375×812, 768×1024 and 1280×800 never scroll horizontally; every touched control is at least 44×44 px
  (brief: Screens and layout; DP-11). The editor layouts are phone below 640 px, tablet 640 to 1023 px, desktop from
  1024 px (brief: Screens and layout).
- Landing stage about three-quarters of the viewport tall on a phone and about 600 px on wider screens. Kind tiles: two
  columns on a phone, three on tablet, four on desktop. Mosaic: two small tiles over one wide on a phone, a three-tile
  row wider. Projects mosaic: one, two, three columns (brief: Screens and layout).

## Motion table (brief: Motion and effects)

| Element | Trigger | Duration and easing | Reduced-motion substitute |
|---|---|---|---|
| Landing light | load | 800 ms, `data-light-level` 0 to 1, settles softly | one still frame of the light at rest |
| Release note pill | load | fades in first | 150 ms fade, no movement |
| Headline lines | load | each 600 ms, 60 ms apart, rise slightly and fade | 150 ms fade, no movement |
| Open editor button | load | 300 ms after the final line starts | 150 ms fade |
| Light focus | pointer or touch over the stage | per 60 Hz frame `value += (target − value)·(1 − 0.92·momentum)` | does not follow |
| Light focus and tilt on leave | pointer leaves | 1200 ms, Glide | at rest |
| Marquee | always | about 30 px per second, pauses on hover and off-screen | still wrapped row |
| Landing demo panels | enter view | bars extend, playhead sweeps about 2 s, numbers count up about 600 ms, once | end state |
| Hover and press | pointer | about 150 ms; pressed button shrinks very slightly | none |
| Panels and loaded content | enter | fade about 400 ms | none |
| Menus and dialogs | open | settle in under 250 ms | none |
| Editor and embed stage | timeline clock, pointer, scroll progress | no other idle motion | still states of Business rules |

## States per async action (brief: Feedback states)

| Action | Pending | Success | Errors and outage |
|---|---|---|---|
| Any edit (autosave) | `Saving…` | `All changes saved` | `Not saved — retrying` |
| Live connection | none | `Reconnected` | `Connection lost — reconnecting` |
| Undo / Redo | none | `Undone` / `Redone` | `Nothing to undo` / `Nothing to redo` |
| Add keyframe (K) | none | `Keyframe added at <time readout>` | `Choose a property first.` |
| Upload | `Uploading <file name>…` | `<file name> is ready.` | the image, SVG and model refusals; outage: `Storage is unavailable, so uploads are paused. Published scenes still play.` |
| Publish / Republish | `Publishing…`, button disabled | `Version <n> is live.` | `Only the owner can publish.`; limit; outage text |
| Invite | `Sending…` | `Invite sent to <email>.` (row `Invite sent` or `Invite queued — mail is unavailable`) | the four invite refusals |
| Accept invite | `Joining…` | the project opens | the three accept refusals |
| Sign in | `Signing in…` | the project list opens | `Email or password is incorrect.` |
| Trash / Restore | none | `Moved <project name> to the trash.` / `Restored <project name>.` | the two state refusals |
| Import JSON | `Importing <file name>…` | `Created <project name> (imported).` | the six import refusals; outage text |
| Embed with no live version | none | none | page text `This scene is not published.` |

Errors are amber notice rows with role `alert` inside the panel where the action started, never red toasts and never
native dialogs (brief: Visual design; Feedback states).

## Breakpoints and artboards (brief: Business rules, Breakpoints and artboards)

| Level | Artboard | Embed viewport width |
|---|---|---|
| Desktop | 1440 × 810 | 1024 px and wider |
| Tablet | 834 × 1112 | 640 px to 1023 px |
| Mobile | 390 × 844 | 639 px and narrower |

Mobile checks Mobile, then Tablet, then Desktop; Tablet checks Tablet, then Desktop.

## Rules decided where the brief is silent

- Stack order: 2D layers draw on a 2D canvas below, 3D layers on the WebGL canvas above (decided: the brief gives 2D
  compositing and a 3D draw order separately).
- Layer `order` counts within a parent, 0 = bottom (brief: Screens, `data-order`).
- Breakpoint overrides of scene fields (camera) live in the scene's own `overrides` (decided: the brief makes camera
  settings overridable and `updateScene` takes `breakpoint`).
- Version bundle bytes, the version row bytes and the version export are the same complete schema-version-3 document
  (brief: Versions; Export and import).
- Sessions have no expiry; sign-out ends one (decided: the grading clock moves 30 days at a time).
- The `ops` response and the live channel carry the patch of rows a change touched so every open editor merges the
  same post-change state (decided: needed so the actor, other editors and viewers agree without a reload).

## Media and licences (brief: IF-05; DESIGN.md Media)

No image, font, model, matcap or video file ships. The landing light, the scene covers, the extruded numeral, the
matcaps, the environments and the preset models are generated in code. Icons come from `lucide-react` (ISC). Packages:
React, three.js, ws, pg (MIT), lucide-react (ISC); build tooling is dev only. `app/assets.json` is an empty list.
