# TRUTH — Transom Works Mullion

The golden's ground truth: the brief made concrete. Every value says where it came from: `brief: <section>` (copied from `instruction.md`) or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## 1. Journeys

Each journey lists the start state, every action, the visible end state and what the providers (Postgres, Valkey) hold.

### J1 — Build by keyboard (DP-01, DP-02, DP-03, DP-04, DP-05)
- Start: a new visitor on `/signup` (brief: Journeys 1).
- Actions: type a username and password, press "Create account" → `POST /api/signup` answers 201 `{username}` and sets `mullion_session` (HttpOnly, SameSite=Lax, Path `/`) → the browser goes to `/` showing `No layouts yet.` → "New layout" opens the dialog "New layout" (Blank checked) → name it, "Create layout" → `POST /api/layouts` 201 → the browser goes to `/layouts/<id>`.
- In the grid: Tab reaches the cells as one stop (cursor cell row 1, column 1 takes a solid burnt-orange ring); Arrow keys move the cursor (a plain arrow also moves the anchor), Shift+arrow moves only the cursor and the selection is the rectangle anchor → cursor (`aria-selected="true"`); Enter opens "Name area" (focus in "Area name"); typing `main` and Enter sends `set_area`; "Layout updates" announces `Area main created.`; focus returns to the cursor cell; `c`, Shift+`C`, `r`, Shift+`R` add and remove the cursor's column or row; Control+Z and Control+Shift+Z undo and redo from any editor control except a text field.
- End state: the grid shows the area block, the preview frame contains `.main`, the code pane holds the canonical CSS; after a reload the layout is in "Your layouts" with the same CSS. Postgres: `layouts.revision` counts every applied change by one, `changes` holds one row per applied change.

### J2 — Shape tracks and areas (DP-06 to DP-21)
- Start: a Holy Grail layout open; at 1280 the tab "From 768px" is in effect (brief: Interactions, Preview width).
- Track size fields apply on Enter or on leaving when the value differs from the stored one; a refusal shows the message of the first failing check (form, range, fr minimum, order) in "Edit problem" and under the field, marks the field invalid, and the field goes back to the stored size; nothing is stored.
- Dragging across cells with mouse, pen or finger selects the rectangle live and opens "Name area" on release; the same name over an adjacent rectangle extends the area; a selection exactly equal to one area with a new name renames it in every scope.
- Each column header shows the resolved width of the preview frame's grid column at the current preview width, rounded half up (`data-resolved-px` is the bare whole number, the text has `px`).
- Clearing (Delete or Backspace) empties cells and removes emptied areas, or is refused with `Area <name> must stay one rectangle.`

### J3 — Paste CSS back (DP-22 to DP-25)
- Start: a layout open, code pane showing; the text of "Layout CSS" mirrors the stored CSS until the designer types.
- "Apply CSS" or Control+Enter sends `apply_css`; an error shows `Line <n>: …` (first error by line) in "Edit problem" and the typed text and layout stay; a valid apply announces `CSS applied.` with ` Areas added: …` and ` Areas removed: …`; applying CSS whose result equals the layout answers `unchanged` and announces `No changes.` with no new revision.

### J4 — Fold through breakpoints (DP-26 to DP-30)
- "Add breakpoint" opens a dialog with "Minimum width"; the new breakpoint copies the grid in effect below it and inherits its gap; "Preview width" keys (arrows ±10, Page Up and Page Down to 320 / every breakpoint minimum / 1440, Home 320, End 1440) and drag change the width, the tab in effect, the canvas scope, the resolved widths and announce `Showing <tab> at <n>px.`; area blocks present in both scopes glide from their old cells to their new cells (WAAPI, 240 ms), new blocks appear at once.

### J5 — Co-edit live (DP-34 to DP-38)
- The founder opens "Share" and sends the co-edit link; the guest signs in, `POST /api/join/<token>` adds a collaborator and lands on the layout. Each editor opens a WebSocket `/api/layouts/<id>/live` (same origin, session cookie); the server sets `presence:<layout id>:<username>` in Valkey with `EX PRESENCE_SECONDS`, renews it every quarter of that, deletes it when the designer's last connection closes, and every editor lists the designers alphabetically within 2 seconds.
- Every applied change is published on the Valkey channel `layout:<layout id>`; every app process forwards it to its open editors (`<author>: <announcement>`) and view pages (`Layout updated.`). Two changes to one column: the first arrival wins; the second gets 409 and the notice `<founder username> changed column 2 first. Your change was not applied.` and shows the layout from the 409 body.

### J6 — Restore a version (DP-39 to DP-42)
- "Save version" stores the whole layout as the next numbered version without changing the revision; "Versions" opens the drawer (slides in from the right in 280 ms); "Compare" lists differences in the published order; "Restore version <n>" opens `Restore version <n>?`; "Restore" applies one new revision and one new version `Restored from version <n>`, leaving the drawer open; every other editor shows the layout and the notice `<username> restored version <n>.`

### J7 — Read as a developer (DP-43 to DP-45)
- "Create view link" gives `/view/<token>`; the signed-out developer sees the read-only grid, the breakpoint tabs, the slider, the frame and read-only code, and `Layout updated.` for each live change. Regenerating or revoking takes effect on the next request: the old token answers 404 and the page shows `This layout is not available.` with link "Sign in".

### J8 — Edit on a phone (DP-47, DP-48, DP-50)
- At 375 by 812 the tablist "Editor panes" shows one of Grid, Tracks, Preview, Code; a tap places the cursor; a finger drag across cells selects (the page does not scroll: `touch-action: none` on cells) and opens "Name area"; with reduced motion every motion ends at once with the same end state and announcements.

## 2. Palette roles (brief: Visual design; hex decided within it)

| Role | Hex | Source |
|---|---|---|
| page, "drafting paper" | `#F6F1E7` (hue 40°, lightness 93%) | brief: Visual design (warm off-white); decided: the hex |
| field (inputs, code, sheet) | `#FBF8F1` | decided: one step lighter than the page, flat |
| ink (graphite) | `#23262B` | brief: Visual design (near-black graphite) |
| muted text | `#565B63` (6.1:1 on the page) | decided: AA |
| blueprint (control borders, links) | `#2F5DA8` | brief: Visual design (blueprint-blue) |
| gridline (1px hairlines) | `#5B83C4` (hue 217°, 3.4:1) | brief: Visual design (hairlines on every canvas) |
| area wash | `#DCE5F2` | brief: Visual design (pale washes of the blueprint blue) |
| accent (burnt orange) | `#B5470F` (hue 20°, saturation 85%) | brief: Visual design (one burnt-orange accent) |
| danger (wine) | `#8B1E3F`, only invalid fields and refusal messages | brief: Visual design |

## 3. Type
System sans-serif for body (400) and headings (800); system monospace with `font-variant-numeric: tabular-nums` for every track size, gap, width, readout, revision and code box. Scale 1.2: body 14px, h3 16.8px, h2 20.2px, h1 24.2px (brief: Visual design). Mono 12.5px (decided: one step under body for dense values).

## 4. Space and layout per viewport (brief: Editor widths, Screens and layout)
- Every button, tab, separator, gridcell and field is at least 44 by 44 px; spacing unit 4px; hairlines 1px; no gradient and no drop shadow anywhere.
- 1200 and up (1280 by 800): top bar; notice area ("Editor notice" slides over the top of the panels, "Live status" takes a line only while paused); a status bar at the foot with "Layout updates" and "Edit problem"; rail (240px), canvas, preview and code (460px) side by side; the page does not scroll, each panel scrolls inside itself.
- 700 to 1199 (768 by 1024): rail (232px) and canvas side by side, preview and code stacked below.
- Under 700 (375 by 812): top bar and notice area stay; tablist "Editor panes" with Grid, Tracks, Preview, Code, one panel visible at a time (the others are hidden and inert but still laid out so the frame measures the columns). The view page uses Grid, Preview, Code.
- No horizontal page scroll at any width; the canvas and the preview frame scroll inside their panels.

## 5. Motion (brief: Motion and effects; reduced-motion substitutes from the brief)

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| Versions drawer (`transform` from `translateX(100%)`) | "Versions", "Close versions", Escape | 280 ms (brief: 200 to 350) | `cubic-bezier(0.16, 1, 0.3, 1)` (fast, settling softly) | open or closed at once |
| Editor notice (`transform` from `translateY(-110%)`) | a notice appears; stays 8000 ms; then leaves; "Dismiss notice" leaves at once | 220 ms in, 220 ms out (brief: 150 to 300) | same | appears and disappears in place (still after 8 s) |
| Breakpoint Fold (`transform` translate and scale of each area block present in both scopes) | scope in effect changes (slider or tab) | 240 ms (brief: 150 to 300) | same | blocks jump |

Nothing else animates: hover and press change colour instantly; there are no CSS transitions or keyframes.

## 6. States per async action (brief: Feedback states)
- "Save state": `All changes saved.` at load; `Saving…` from the moment a change, version or link request is sent until its reply; `Not saved. Check your connection.` and "Edit problem" `Mullion could not be reached. Your last change was not saved.` when no reply comes.
- Refusals outside a dialog: "Edit problem"; inside a dialog: "Dialog problem", dialog stays open; sign-up and sign-in: "Form problem".
- Announcements: the exact copy of the brief's table, composed by the server for changes (it knows the removed areas) and sent in the reply and in the broadcast; scope changes, versions and links are announced by the client.
- "Live status" shows `Live updates are paused. Your changes are still saved.` as soon as a page loads with `live: false` and stays; empty when `live` is true; decided only from the server's `live` field.
- Loading: a static hairline skeleton with `Loading layout…`; empty library: a drawn blueprint sheet and `No layouts yet.`; denied: heading `This layout is not available.` with one link.

## 7. Backend facts (brief: API, Business rules, Services)
- Error order for every route: 413, 401, 404, 422 (form), 409, 422 (rules against the layout); never 403; no cross-origin headers; only built client files and the published pages are served, so `/run.json`, `/package.json`, lockfiles, `/node_modules`, `.env` answer 404.
- Revisions: one per applied change, serialised per layout by `SELECT … FOR UPDATE`; a change with no effect gets no revision, no log row, no fan-out and is not in the undo history.
- Conflicts: a stale change meets a later change by another designer when their targets meet (same track; any track add or remove in a scope; same area or overlapping cells in a scope; the same scope's gaps; the whole layout for CSS, restore, breakpoint add or remove and their undo or redo). The notice names the first such winner and its target (`column <n>`, `row <n>`, `area <name>`, `the gaps`, `the layout`).
- Undo and redo are per designer, replayed from that designer's own rows in `changes` (each row stores the patch that reverses it), so they survive a restart; both are refused as conflicts measured from the change being undone.
- Valkey away: layouts open and every change, version, link and collaborator action saves through Postgres; `live` is false; `GET /api/health` answers `{"status":"unavailable"}`; nothing is pushed; "Designers here" lists only the designer; every Valkey call is capped at one second; the connection is retried every two seconds. Postgres away at boot: the server listens, answers health `503 {"status":"starting"}` and retries every second.

## 8. Breakpoints
Layout switches at 700 and 1200 pixels wide (brief: Editor widths); the preview width runs 320 to 1440 and starts at 1280; breakpoint minimum widths run 400 to 1440 (brief: Business rules, Breakpoints).

## 9. Media and licences
The only image file is `favicon.svg` (drawn for this app, licence original). Icons (close, grip) and the empty-library drawing are inline SVG drawn for this app (licence: original); fonts are the system stacks; no request leaves the app's origin. Shipped npm packages are `pg`, `ioredis`, `ws` and their dependencies, all MIT, ISC or Apache-2.0 (listed in `THIRD_PARTY_NOTICES.md`).
