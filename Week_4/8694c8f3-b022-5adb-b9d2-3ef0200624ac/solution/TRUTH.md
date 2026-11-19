# TRUTH — Afterglass golden

Every value says where it came from: `brief: <section>` (copied) or `decided: <why>` (the brief is silent).

## Journeys (ideal end-to-end flows)

1. **First rehearsal** (brief: Journeys 1). Start: signed out at `/`. The booth dialog 'Afterglass' sits over the shell running
   'Low Tide Tunnel' at 120 BPM. Press Play: `data-frame` rises, the cube field orbits once per 8 beats. Create account
   (Email, Password, Display name): invalid submits show 'Enter a valid email address', 'Password must be at least 10 characters',
   'Display name must be 1 to 40 characters' under the field. A valid submit lands in the empty workspace ('No sets yet' and a
   single `button "New set"`). New set dialog: `textbox "Set name"`, `radio "Blank stage"`, `button "Create set"` creates the set
   (Stage > Main camera, Key light, Floor; BPM 120; graph with one Beat clock node). Add > Tube, Cube, Cube; reparent the cubes under a
   Group with Alt+Right or drag; move, rotate and scale with the gizmo under Grid snap (0.5) and Angle snap (15°). Drag the tube's
   Twist scrub field: the stage redraws every frame; release commits one op; Autosave reads 'Saved'. The keyframe dot places a key
   on the nearest quarter beat; the timeline shows the diamond `Key Twist at 1:1` and the readout `1:1 0.000 s`.
   Provider state: PostgreSQL holds the user, set, layers, keys and the gapless op log.
2. **Assets and shaders** (brief: Journeys 2). Assets tile > Upload asset (file input 'Choose GLB or texture file'): 'Uploading <name>'
   then '<name> is ready'; the bytes are in MinIO at `sets/<set id>/assets/<asset id>`, byte-identical, sha256 reported. Model layer:
   `combobox "Model asset"`; Floor: Albedo > Browse texture > Choose texture > Use texture; the shelf shows '1 dependents'. Shader layer:
   Shader editor tab, save a broken source: 'Line <n>: <driver message>' and a red gutter mark, the stage keeps the last good program;
   fix and save: 'Compiled'. Three saves then Restore version 1: history lists the new latest version with 'Restored from version 1'.
3. **Beat-driven motion** (brief: Journeys 3). Node graph: Beat clock → LFO → Remap → Layer property (twist), the last wire via the
   Connect wire dialog from the keyboard. Play: the property moves every frame. Script with `onBeat(ctx)` pulses a cube; a second
   script registers a plugin node listed in Add node; a third throws and the Console shows '<name>: line <n>: <message>' while the
   stage keeps drawing. BPM 120 → 140 keeps every key's bar:beat; only seconds change.
4. **Back-to-back prep** (brief: Journeys 4). Owner: Shows tile > Invite guest VJ > Editor > Create link. The guest signs in on
   `/join/<token>` and presses 'Join as editor'. Both see each other in `list "In this set"` with cursor colours (owner blue,
   guest green) and selected layer. Guest Take lock: owner's tree shows `img "Locked by <name>"`; the owner's Take lock gives
   'Locked by <name>'. A stale edit opens 'Someone changed this layer first'; Reapply mine commits on the current version.
   The lock frees on Release lock or 30 seconds after the last heartbeat (Valkey key expiry; `lock` event with reason `expired`).
5. **Venue Wi-Fi drops** (brief: Journeys 5). Offline edits apply locally and queue (persisted in the browser);
   banner 'Connection lost. <n> changes waiting to sync.' (singular for 1); Autosave 'Waiting to sync'. On return the queue replays in
   order with the same client op ids, the browser catches up, the banner clears and 'Back online. All changes synced.' is announced.
6. **Show night** (brief: Journeys 6). Publish show: 'Publishing version <n>' then 'Version <n> is live'; the bundle is in MinIO at
   `sets/<set id>/shows/<n>/bundle.json`. `/show/<token>` plays the live version full-window; Show info (or I) shows 'Version <n>',
   'SHA-256 <sha256>', 'Published <time>'. A new publish switches the open tab within five seconds. Roll back: 'Rolled back. Version <n> is live';
   the link serves version 1's exact bytes again.
7. **Moving to another machine** (brief: Journeys 7). Export set: 'Preparing export' then 'Export ready'; the zip in MinIO is
   byte-identical to the download and its sha256 matches. Import (Set menu) creates '<name> (imported)' with the same scene.
8. **A bad night for services** (brief: Journeys 8). MinIO down: 'Asset storage is unreachable. Uploads and publishing are paused.'
   (uploads end 'upload failed', publish 'Publish failed. Version <live> is still live.'), editing continues. Valkey down:
   'Live collaboration is offline. Locks can’t be taken right now.', Take lock takes nothing, edits commit and the other editor
   catches up within five seconds (polling every two). The Activity pane lists every committed op, publish, rollback and failure.

## Contract values (brief: Backend)

Port 4173 or `APP_PUBLIC_PORT`; `GET /api/health` → `{"status":"ok"}` once PostgreSQL is connected. Session cookie `ag_session`, HttpOnly,
SameSite=Lax, 30 days. Error shape `{"error":{"code","message",…}}`. Body limits 1,000,000 / 20,000,000 (model) / 8,000,000 (texture) /
50,000,000 (import). Ticks 96 per beat, 4 beats per bar, keys 0..24,575, quarter-beat snap 24 ticks. Lock lease 30 s with 10 s heartbeats.
Valkey keys `afterglass:lock:<set>:<layer>`, `afterglass:presence:<set>:<user>`, channel `afterglass:set:<set>`.

## Palette roles and hex values (brief: Visual design; hex in DESIGN.md)

ground #222222, graphite #333333, raised #666666→#555555 (pressed #444444), field #111111, stage clear #000000, ink #cccccc
(selected tab #ffffff), muted #a3a3a3 (decided: AA on graphite), value numerals #3399ff (scrubbed #66bbff), inspector title #4a90d9,
toggles on #66dd66, grid axis #33aa77, selected bullet #33cc33 on #000000, links #e8d27a, error text #f46666 (decided: AA), record
#cc2222, emblem #d8d0dc, focus ring #5bbcff (brief: Accessibility).

## Type, space and layout per viewport

Arimo 12px body, 14.4px menus, 20.4px titles, 24px booth title (decided: 2x the 12px body, inside the brief's 1.5 to 2 times), 40px embossed headline; PT Sans 12px on row buttons; JetBrains Mono
12px in editors only (brief: Typefaces). ≥1024: dock 64px, menubar 30px, rig panel 300px, timeline dock 29% of height, 4px gutters,
no document scroll (brief: Screens and layout). <1024 (768×1024, 375×812): menubar on top and wrapping, stage above the timeline
dock, dock as a bottom icon row, rig panel as a full-width drawer opened by `button "Rig panel"`, every control ≥44×44, no document scroll.

## Motion table

| Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| rows, tiles, menu items, buttons | hover / press | 100 ms | ease | instant |
| component drawers | open / close | 300 ms | ease | instant |
| rig panel drawer (<1024) | open / close | 450 ms | ease | instant |
| menus, popovers | open | 100 ms | ease | instant |
| booth dialog | first paint | 900 ms | ease | instant |
| stage canvas | playing, scrub, gizmo drag, orbit; one frame after a commit | per frame | rAF | scrub redraws once on release; orbit inertia off; playback still runs |
| orbit coast | release | ≤450 ms | quadratic decay | none |

(brief: Motion and effects; the booth fade, drawer and slide timings are inside the brief's stated bounds.)

## States per async action (brief: Feedback states)

Autosave: Saving / Saved / Waiting to sync / Save failed. Shader compile: Compiling / Compiled / 'Line <n>: <message>'. Asset upload:
'Uploading <name>' / '<name> is ready' / '<name> upload failed'. Show status: 'Publishing version <n>' / 'Version <n> is live' /
'Rolled back. Version <n> is live' / 'Publish failed. Version <live> is still live.' / 'Publish failed. Nothing is live yet.'.
Export status: 'Preparing export' / 'Export ready' / the storage banner copy. Script status: '<name>: line <n>: <message>',
'<name> stopped: onBeat took longer than 50 ms', '<name> stopped: network access is not allowed'. Empty states: 'No sets yet',
'No assets yet', 'No show versions yet', 'No scripts yet', 'No activity yet', 'Nothing is live yet', 'This invite link has already been used'.
No WebGL: 'This browser can't draw the stage. Your set still saves.'

## Breakpoints

375, 768 (drawer layout); 1024 and up (desktop shell); checked at 1280×800 and 1440×900 (brief: Browser support).

## Media and licences

No photographs, audio or video. The booth emblem is drawn in code (`original`). Icons are Lucide (ISC, inline SVG). Fonts: Arimo,
PT Sans, JetBrains Mono (SIL OFL-1.1, self-hosted woff2, listed in `app/assets.json`). Packages are listed in `THIRD_PARTY_NOTICES.md`.
