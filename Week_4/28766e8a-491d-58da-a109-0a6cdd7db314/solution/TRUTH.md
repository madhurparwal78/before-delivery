# TRUTH — Ferrule & Pell Linewell (golden)

The brief made concrete. Every value says where it comes from: `brief: <section>` (verbatim) or
`decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Journeys (ideal end-to-end flow)

### 1. Start and share (brief: Journeys 1, Roles and invites, Services)
- Start: Ada signed in, no diagrams. `/` shows heading `Your diagrams`, `New diagram` and `No diagrams yet. Create one to start drawing.` (brief: Feedback states).
- New diagram asks for a title in `dialog "New diagram"` (decided: a dialog keeps the list in view). A title with a line break shows `Remove line breaks and control characters.` under the field; the API answers 422 `invalid` with `fields.title` (brief: Text safety).
- `Pipeline` creates the diagram with `Page 1` / `Layer 1` and lands on `/d/<id>?page=<pageId>` showing `This page is empty. Add a shape from the toolbar or press R.` (brief: API, Empty page).
- Three rectangles via the toolbar, two connectors via port drag or C. Share › invite Bea (Editor) and Cy (Viewer): rows read `Invited`; announcer `Invite emailed to <email>.`; Mailpit holds one message per invitee, To = that invitee only, subject `Ada Lindqvist shared "Pipeline" with you as an editor` / `... as a viewer`, body with `<APP_PUBLIC_URL>/d/<id>` and no shape, page, layer or comment text (brief: Services Mailpit).
- Bea opens the link → `/signin?next=/d/<id>` → `Create an account` keeps `next` → signs up with the invited address → lands on Pipeline with `toolbar "Tools"`; members API shows her `active` `editor`.
- Cy signs up after `INVITE_TTL_MS`: account created, Pipeline answers the 404 not-found page; Ada's row turns `Expired` (re-read every second while Share is open, judged on the server clock) with `Resend invite to <email>`. Resend → `Invited`; Cy signs in → view-only banner `View only. Ask Ada Lindqvist for edit access.`, no tools.
- Downgrade mid-drag: Ada sets Bea to Viewer; the server refuses Bea's next operation with 403 at once; within 2 s Bea's tools leave and the view-only banner shows; her drop is refused and rolled back with `You're now a viewer. Your last change was not saved.` Upgrading restores the tools.

### 2. Rearrange with live wiring (brief: Journey 2, Tethered reroute, Live inspector)
- Dragging Intake shows vermilion port dots (120 ms fade-in) at both ends of every connector bound to the dragged shapes; every frame routes the whole page with the shared router at the drawn positions, and every connector whose route differs from its committed route shows the preview in `data-points` (brief: Motion, Tethered reroute 2); inspector X/Y equal the drawn `data-x`/`data-y` each frame.
- Drop: one `update_shape` (one `update_shapes` for a multi-selection or group) commits exactly the drawn values; `data-points` switch at once to the committed route (= the last preview); connectors bound to moved shapes carry `data-settling="true"` for 200 ms; on acknowledgement Ada hears `Moved Intake. <n> connectors rerouted.` with `<n>` = the acknowledgement's `rerouted` length (brief: Motion, Feedback states).
- Bea's X/Y follow within 1 s without reselecting; her focused Width draft stays until Enter, which commits a later `seq` that wins. Width `10` + Enter: field gets `aria-invalid="true"`, `Enter a whole number from 24 to 2000.` shows under it and is announced, nothing is sent; Escape clears it (brief: Inspector, Range check).
- Dragging Archive into the Log→Store corridor reroutes that unbound connector; the count includes it. Reload and SVG export show the same routes (routes are derived only on the server and stored in the document).
- Intake, Review and Log selected + ArrowRight: one `update_shapes` (one `seq`, one undo entry), `Moved 3 shapes. <n> connectors rerouted.`; one Ctrl+Z puts all three back (brief: Journey 2, One action, one operation).
- Bea deletes Archive: shape and its connector leave every screen and the outline within 1 s; Bea hears `Moved Archive. <n> connectors rerouted.` when the delete rerouted connectors; Ada's concurrent Archive edit rolls back with `Archive was deleted by Bea Okafor. Your change was not saved.`; Bea's Ctrl+Z restores the same shape, connector and group ids and re-anchors the comment (brief: Deleting, Undo of a delete).
- Connector labels: a connector with a non-empty label contains one `<text class="connector-label">` holding the label (brief: Canvas markup), centred within 1 unit of the midpoint of its route's longest segment, the first of equal segments along the route, on the canvas and in the SVG export alike (brief: Connector labels); on the canvas the label sits on a paper chip so it reads over routes and grid (decided: legibility over the graph paper).

### 3. Build without a pointer (brief: Journey 3, Keyboard, Connect mode, Outline)
- Tab reaches the canvas as one stop (roving tabindex: last-focused shape or first in reading order; the empty canvas itself on an empty page). Rectangle button + Enter sends `add_shape` (160×80, empty label) at the insertion position at once, selects it and opens `textbox "Label"` over it; Enter commits the label as `update_shape`; Escape keeps the old (empty) label, so the shape stays as `Untitled <kind>` (brief: Keyboard, Enter on a selected shape; Insertion position).
- C on Start: candidates = other shapes on visible, unlocked layers in reading order; highlight (2 px ink dashed outline) starts on Check; arrows wrap; 4 picks `w`; Enter creates the connector from Start's default port and announces `Connected Start to Check.`; focus returns to Start.
- Arrow nudges move 8 (Shift 1), never snapped; Ctrl+Z sends an undo operation that reverses the stored patch.
- Outline reads `Start, rectangle, connected to Check`. Walls on a locked layer: connector named `..., blocked`, dashed; wall shapes carry the padlock and `aria-description="On locked layer Walls"`; hiding Walls clears both within 1 s.

### 4. Arrange pages and layers (brief: Journey 4)
- Ctrl+Alt+N adds `Page 2` and opens it; F2 renames in place; Alt+ArrowUp moves it first and announces `Moved Floor plan to position 1 of 2.` with focus kept on the item; Ada sees the order within 1 s. Same keys for layers (top layer first).
- Ctrl+PageDown/Up switch pages; the address `?page=` is pushed and restored by reload, Back and Forward.
- At 768–1279 the left rail starts collapsed behind View › Layers; while collapsed or closing its content is `inert`, `aria-hidden` and `visibility:hidden`, then `hidden`.

### 5. Work through a dropped connection (brief: Journey 5, Offline, Sessions)
- Socket closes (4503 during a save outage): after 3 s of page time `Offline. 0 changes waiting to save.`; each local change is applied on screen, stored in `localStorage` and counted; a reload restores the queue and count; retry every 2 s.
- Reconnect: the queue replays one operation at a time with original opIds; accepted ones save once (server replay table), a change to a shape Ada deleted rolls back with `Beta was deleted by Ada Lindqvist. Your change was not saved.`; then `All changes saved.` for 3 s.
- Sign out elsewhere: sockets of that session close 4401 within 1 s; the workspace keeps editing, shows `Your session ended. Sign in to keep your changes. 2 changes waiting to save.`, opens `dialog "Sign in to continue"` (read-only email); a wrong password shows `Email or password is incorrect.`; after sign-in the queue replays once and the address never changes.

### 6. Comment from a phone (brief: Journey 6, Comments, Touch, Menu placement)
- Cy at 375×812 pinches to zoom, swipes the page strip; a 500 ms long press on a shape selects it and opens `menu "Shape actions"` (viewer: `Comment` only), placed inside the viewport and clear of the bottom toolbar, page strip and view controls.
- Comment with `@ada…` → pin `Comment by Cy Moreau on <label>` at the shape's top-right on Ada's screen without reload; Ada gets exactly one email `Cy Moreau mentioned you on "Pipeline"`. Resolve removes the pin on both screens; Cy's sheet shows `Resolved (1)`.

### 7. Undo a restructure (brief: Journey 7, Versions)
- The server cuts `Version <n>` `VERSION_INTERVAL_MS` after the first uncovered operation (DB-held due time, swept every 250 ms by every instance); open History lists refresh via a broadcast within 2 s. Items read `<display name> · <author> · <d Mon yyyy, HH:mm> UTC` from the server's `createdAt`.
- Choosing a version pushes `?page=…&version=…`; reload / direct visit opens the same read-only preview with `Previewing <name>. Restore it or go back to the latest.`; a foreign version id gives the 404 page.
- Restore: `Restoring <name>...`, then the document equals the version (ids, pages, layers, groups, ports, labels; routes re-derive identically); comments re-anchor from the restored document; a `Restored <name>` version is cut; every session announces `<name> restored <version name>.` Ctrl+Z by the restorer undoes the whole restore (anchoring included) and cuts no version.

### 8. Export only what is visible (brief: Journey 8, Exports)
- Export dialog (Format, Scale, Page, Background) → 202 `rendering`; a second press while the first request is unanswered sends nothing, and a repeat with the same settings at the same `seq` while one renders answers 200 with that export (brief: One export per request); the export records the document `seq` and snapshot at the request, under the diagram row lock, so later shapes never appear (brief: Snapshot); rendering runs on the server; closing the dialog or reloading never cancels it.
- `ready` only after the PUT succeeds and a HEAD confirms `exports/<diagramId>/<exportId>.svg`; the requesting tab announces `Export ready.` exactly once (tracked in `sessionStorage`); others show `link "Download latest export"` within 2 s via the socket.
- SVG: `image/svg+xml`, root `data-seq="<seq>"`, viewBox = visible shapes and shown routes at that `seq` padded by 24, `<g id="shape-…">` / `<g id="connector-…">` only for visible content, shape labels as escaped `<text>` inside the shape group, connector labels as `<text class="connector-label">`; PNG: rasterised from that SVG at scale 1 or 2, alpha when Transparent.
- Storage down: after 10 s without storage `storage_unavailable`; dialog and banner row show `Exports are paused: storage is unavailable. Editing still works.` with `Try again`; editing and health keep working. Try again shows `Exporting <page>...`; of simultaneous retries one answers 202 (`UPDATE … WHERE status = 'storage_unavailable'`), the rest 409 `export_not_retryable`, which the dialog shows as the export's current state, never as an error (brief: Exports, Export dialog).

## Operations (brief: API, Operations over HTTP, Working together)

- Request bodies accept only `opId`, `baseSeq`, `op`; each kind only its published keys. Any other key, and any out-of-range value, answers 422 `invalid` with `fields` at its dotted path (`op.set.route`, `op.shapes.0.set.seq`); nothing changes and no `seq` is taken.
- Precedence per operation: 401, 404 (an id that never belonged), 403, replay of a known `opId` (stored body returned), 503, 409 (`op_conflict`, then `shape_deleted` / `connector_deleted` / `layer_locked` in list order), 422.
- `update_shapes` (1–500 entries, one page, each id once) is all or nothing: one `seq`, one rerouted list. A `set.layer` on another page answers 422 at `op.set.layer`.
- `seq` allocation and `opId` dedupe happen inside one transaction holding `SELECT … FOR UPDATE` on the diagram row (decided: one place, atomic across instances).
- Replaced notice: for each field an operation sets, the author of the latest earlier operation that set it (when someone else) hears `<name> changed <label> at the same time. Their edit was kept.` once (brief: Same field changed by two people).
- Router rule 5: the window search is widened over every obstacle it meets whenever its route has more than two bends, and the fewer-bend route is kept (decided: a true minimum without searching the whole page every frame).

## Palette (brief: Visual design; hex decided in DESIGN.md)

| Role | Hex | Source |
|---|---|---|
| paper ground (canvas, rails, top bar, dialogs) | `#F7F3EA` | brief: warm off-white; decided hex |
| paper-sunk (current row, pressed toggle) | `#EFE8DA` | decided: state without a new colour |
| shape fill | `#FBF9F4` | decided: shapes read over the grid |
| grid minor (24 units) / major (120 units) | `#EAE0CC` / `#D8C8A8` | brief: sand lines every 24, stronger every 120 |
| hairline rule | `#D6C7A9` | brief: sand-coloured hairline rules |
| ink | `#1B2A4A` | brief: deep navy ink |
| ink-soft | `#4B5874` | decided: secondary text, AA 6.7:1 |
| vermilion (selection, handles, port dots only) | `#C8402A` | brief: single vermilion accent |
| teal (avatars, cursors, name tags) | `#0E6767` | brief: deep teal presence |

## Type (brief: Type)

| Use | Face | Size |
|---|---|---|
| diagram title (largest on screen) | Instrument Serif 400 | 22.5px |
| panel headings | Instrument Serif 400 | 18.7 / 15.6px |
| body, controls | IBM Plex Sans 400/500/600 | 13px (12px small) |
| inspector numbers, zoom readout, strip count, layer counts | IBM Plex Mono 400 | 12–13px |

## Space and layout per viewport (brief: Layouts)

| Width | Layout |
|---|---|
| ≥1280 (1280×800) | top bar 44px; left rail 248px; canvas pane (Tools toolbar 41px across its top, view plate bottom-right above the 40px page strip); inspector rail 296px; hairline rules between |
| 768–1279 (768×1024) | canvas + 296px inspector rail; left rail collapsed behind View › Layers, opens as a 248px overlay between the Tools toolbar and the view plate (decided: the overlay never hides the shape buttons, view controls or page strip) |
| ≤767 (375×812) | top bar, canvas, page strip (48px), bottom toolbar (Layers, Inspector, Comments, History, Shape actions, Insert); sheets open as dialogs; every control ≥44×44 |

Spacing unit 4px, row 28px (44px on phones), radius 2px, no shadows or gradients (brief: Density, Composition; decided values).

## Motion (brief: Motion and effects)

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| port dots | drag start / drop | in 120 ms, out 200 ms | fast start, soft settle | full opacity, no fade |
| connector routes | every drag frame | per frame | — | same |
| `data-settling` | drop or nudge | 200 ms | settle | never set |
| remote shape glide | remote move | 240 ms (drawn ghost; `data-*` committed at once) | settle | instant |
| remote cursor glide | cursor message | 240 ms | settle | instant |
| `#inspector-rail` | Toggle inspector | progress × 200 ms, reversible, `data-motion` / `data-progress` | width eased from linear progress | jumps to `open 1.00` / `closed 0.00` |
| layers rail, sheets | open / close | 200 ms (sheets travel 32px) | settle | instant |
| hover / press | pointer | 120 ms colour | linear | none |

All motion runs on page timers and `requestAnimationFrame`; nothing loops; pending states are text.

## States per async action (brief: Feedback states)

| Action | Pending | Success | Error / outage |
|---|---|---|---|
| edits | none | none (moved notice on ack) | rollback + deleted / role / replaced notice; offline banner; session-ended banner + dialog |
| restore | `Restoring <v>...` | `<name> restored <v>.` | — |
| save version | — | `Saved <v>.` | — |
| export | `Exporting <page>...` | `Export ready.` + Download link | paused banner + Try again |
| invite / resend | `Sending invite...` | `Invite emailed to <email>.` | mail outage banner in Share, row `Email not sent` |
| sign-in, sign-up, new diagram, Sign in to continue | — | — | field errors under fields, announced; auth pages add a linked summary |

## Breakpoints

1280 and 768 (brief: Layouts); JS layout state from `innerWidth` mirrors the CSS media queries (decided: rails and sheets mount only in their layout so hidden copies never enter the accessibility tree).

## Media and licences

| Asset | Licence | Source |
|---|---|---|
| Instrument Serif 400 woff2 | OFL-1.1 | Fontsource 5.3.0 (`app/assets.json`) |
| IBM Plex Sans 400/500/600 woff2 | OFL-1.1 | Fontsource 5.3.0 |
| IBM Plex Mono 400/500 woff2 | OFL-1.1 | Fontsource 5.3.0 |
| Icons (inline) | ISC | `lucide` 0.546.0 |
| Graph paper, shapes, padlock, cursors | original | drawn in SVG/CSS |
