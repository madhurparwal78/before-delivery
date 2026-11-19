# TRUTH — Twinefold Software Sprigmap

The golden's ground truth. Every value says where it came from: `brief: <section>` (copied from `instruction.md`) or
`decided: <why>` (the brief is silent; the reason ties it to the brief's intent). Where the reference-tests print a
value that the brief also prints, the brief is the source.

## 1. Journeys end to end

### J1 Grow a map by keyboard (DP-13 to DP-18) — brief: Journeys 1, Interactions
1. Owner opens `/m/<id>` on an empty map: the root (central topic) holds focus (roving tabindex, one `treeitem` with `tabIndex 0`), the canvas shows `Press Tab to add the first branch.` and one undrawn dashed ribbon.
2. Tab on the root opens a title input holding `New topic`, fully selected (`selectionStart 0`, `selectionEnd 9`). Typing replaces it; Enter commits: the topic exists as the last child, focus lands on that topic, the prompt disappears and the first connector draws in (800 ms once). A new topic is sent as one group when its title commits, so one change is counted.
3. Enter on a topic adds a sibling right after it (on the root, a last child). F2 opens the input with the caret at the end; a printable key replaces the title with that character; Escape cancels (new topic keeps `New topic`, rename restores the old title).
4. Delete removes the branch; focus goes to the next sibling, else the previous, else the parent; on the root the notice `The central topic can't be deleted.` shows.
5. Alt+arrow keys reorder, demote, outdent and pin level 2 topics; each move announces `<title> is now <k> of <n> under <parent title>.` in `status "Map announcements"`; with no room it announces `<title> can't move that way.` and changes nothing.
6. End state: every topic sits at the coordinates the layout engine publishes (`data-x`, `data-y`, `data-w`, `data-h`, `data-side`); the server holds the same tree and pins.

### J2 Rearrange together (DP-19 to DP-24) — brief: Journeys 2
Owner picks `Org chart` in `radiogroup "Layout"`: `data-layout` flips at once on both screens, every topic's `data-*` takes its final engine value at once, each topic animates `regrow-topic` (320 ms) from its old screen centre and connectors fade in (`regrow-connector`, 200 ms after a 320 ms delay). The co-editor collapses a branch for themselves (Space): its descendants leave their map, tab order and outline; cross-links into it end at the collapsed topic (`data-drawn-to`); the other person's view is unchanged; the collapse is stored per person and map.

### J3 Work on a train (DP-31 to DP-33) — brief: Journeys 3, Business rules Offline
`switch "Work offline"` closes the socket and persists the offline flag and queue in `localStorage` per map and person. The banner in `region "Connection"` reads `You're working offline. <n> changes waiting.`; edits of one title combine into one queued title edit; Ctrl+Z removes the last queued group. Reload keeps the queue. Switching back reconnects with `since=<seq>` (stored live messages replay), sends each queued group once with its original base revision and operation ids, then announces `Back online: <n> changes sent, <k> conflicts.` (a conflict is a group merged, rejected or recovered). Both screens end on the same merged title.

### J4 Untangle crossing moves and undo (DP-34 to DP-41) — brief: Journeys 4, Business rules
A move that would put a topic inside its own subtree is rejected with `cycle` and the whole group rolls back on the author's screen (notice `Move undone: <title> can't go inside its own branch.`, focus on the moved topic at its restored place). Two moves of one topic both apply in server order; the earlier mover gets `<user> moved <title> after you.`. An edit inside a branch deleted since its base becomes a Recovered edit (`<user> deleted this branch. Your edit is in Recovered edits.`); `Re-apply` adds it as a new topic under the nearest surviving ancestor. Undo and redo are per person and map, kept on the server, skip a group someone else touched since (`Can't undo: <user> changed <title> after you.`).

### J5 Edit on a phone (DP-42 to DP-45) — brief: Journeys 5, Interactions Touch
Long press (500 ms page timer, under 8 px of movement) opens `menu "Topic actions"`; dragging more than 8 px reparents with a drop preview (`data-drop-target`, `Drop to make <title> a child of <target title>`) and edge panning (8 px per 16 ms within 40 px of an edge); one finger pans, two fingers pinch about their midpoint; Open details opens `dialog "Topic"` on Notes. A desktop co-editor sees each change live.

### J6 Replay and restore (DP-46 to DP-49) — brief: Journeys 6
History opens `slider "Version playback"` (value text `Version <k> of <n> by <user>`), `View version` opens `/m/<id>/versions/<vid>` read-only with `This is version <k>. Read only.`, `combobox "Compare with"`, `region "Changes"` (`Added <a>, removed <r>, moved <m>, edited <e>`) and `list "Removed topics"`; the owner restores (one undoable group, a new `restore` version, `Restored version <k>.`), a second person sees it live, the owner undoes it.

### J7 Present (DP-50 to DP-53) — brief: Journeys 7
Owner orders slides (Alt+ArrowUp/Down), `Start presentation` opens `region "Presenter"` with `<origin>/p/<code>`; `Go live` makes the session live; ArrowRight/Space/ArrowLeft step; deleted or restricted slides are skipped with `Slide <k> was skipped: ...`. The audience opens `/p/<code>`: waiting text, then the slide card; each step animates `camera` (400 ms) to the fit of the slide's branch; a swipe of at least 50 px goes back through slides it has seen, `Back to live` returns; ended shows `This presentation has ended.`.

### J8 Share, restrict and hand over (DP-54 to DP-58, DP-64 to DP-73) — brief: Journeys 8
Share dialog: role accordion with checklist and preview, invite, roles, share links with expiry. A link ends at its server-recorded expiry instant live in an open tab (`This link has expired.`); regenerate/turn off shows `This link was turned off by the map's owner.`; a restricted branch is absent for commenters in every view and API answer; comments with @mentions feed `Inbox (<n>)`; import stores the outline first then previews and grafts as one group; export is a five-step server-clock job whose download is offered only once the stored object exists; attachments are confirmed in storage before `Image attached.` shows.

## 2. Palette roles (hex the build uses) — brief: Visual design; hex decided in DESIGN.md

| Role | Hex | Source |
|---|---|---|
| ground | #ffffff | brief: Palette roles (pure white) |
| surface | #f3f4f8 | brief: pale lavender-grey; decided: seed-reference surface |
| ink | #1f1e30 | brief: near-black with a faint violet cast |
| muted ink | #6b6a8c | decided: seed #8686a7 fails AA |
| accent | #1a40ff | brief: single saturated royal blue |
| border | #dcdce8 | brief: light grey-lavender |
| gold | #e0a21a | brief: vote stars warm gold |
| marker | #e2621b | brief: orange marker on notice bands |
| indigo, azure, teal, green, violet, magenta, orange, ochre | #2b2fd9, #1496e0, #13a08f, #1fa032, #6a2bd9, #b02ac0, #e2621b, #c98c0a | brief: eight flat branch colours in order; hex decided so the luminance rule (white text on indigo, violet, magenta, accent; ink on azure, teal, green, orange, ochre) and AA agree |

## 3. Type, space, layout — brief: Visual design; DESIGN.md

Figtree 400/500/600/700 woff2 served from `/fonts/` (brief: Typography). Hero 60 px (44 px phone), section headings 40 px, sub-heads 28 px, body 16 px, tabular figures on counts. Radius: controls 8, topic pills 14, dialogs 16, cards 20, panels 28 (brief: one rule set). Tap targets 44 px.

| Viewport | Editor arrangement | Source |
|---|---|---|
| 375x812, 390x844 | slim top bar (`Tools`, `Outline`, `Inbox (<n>)`); toolbar in the Tools drawer; outline, topic details and activity as bottom sheets | brief: Screens and layout |
| 768x1024 | single toolbar band; collapsible outline rail (`Outline` toggles; closed = not in the page); details/activity panel over the right canvas | brief |
| 1280x800 | outline rail about a quarter of the width always open, no `Outline` button; details/activity beside the canvas | brief |

## 4. Motion — brief: Motion and effects

| id | Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|---|
| `regrow-topic` | each topic in the page | layout switch | 320 ms | cubic-bezier(0.4, 0, 0.2, 1) | none runs |
| `regrow-connector` | each connector | layout switch, delay 320 ms | 200 ms | same | none runs |
| `topic-enter` | a newly added topic | it appears | 160 ms | same | none runs |
| `toast-enter` | a toast | it appears | 120 ms | same | none runs |
| `camera` | the stage | presentation step, Fit to screen while presenting | 400 ms | same | cuts |

## 5. States per async action — brief: Feedback states

| Action | Pending | Success | Error | Outage |
|---|---|---|---|---|
| Attach image | `Uploading <file name>` | `Image attached.` | size, type and quota sentences | `File storage is unavailable. Nothing was added. Try again in a moment.` |
| Upload outline | `Reading <file name>` | `Adds <n> topics under <title>.` | `This file can't be imported:` + line errors | same outage copy |
| Export | `progressbar "Export"` | `Export ready.` + `Download export` | — | `Export failed: file storage is unavailable.` + `Retry export` |
| Save version | button spinner | `Saved version <k>.` | — | `File storage is unavailable. The version was not saved. Try again in a moment.` |
| Restore | button spinner | `Restored version <k>.` | — | `File storage is unavailable. Nothing was restored. Try again in a moment.` |
| Sign in | spinner | signed in | field and form errors | — |
| Session expiry | — | `dialog "Sign in again"` closes, queue replays | `Wrong username or password.` | — |

## 6. Breakpoints and media — brief: Screens and layout; DESIGN.md Media

Breakpoints 768 and 1280 (brief). Media: Figtree woff2 files (OFL-1.1, `assets.json`); every other picture, icon and illustration is drawn in code as inline SVG (originals; some icon shapes follow Lucide, ISC, listed in `THIRD_PARTY_NOTICES.md`).
