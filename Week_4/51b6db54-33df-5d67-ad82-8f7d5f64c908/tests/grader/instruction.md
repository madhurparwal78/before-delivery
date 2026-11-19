# Marzipan Row Celmate

Celmate is a browser workspace where a small group draws, animates and builds tiles on the same pixel sprite at the same time, with indexed palettes, per-person undo, pinned review comments, named snapshots and stored exports. It is for project owners, editors, reviewers and people holding a read-only link. It uses three backend services only: Postgres for all artwork, sequenced operations, palettes, comments, snapshots, memberships, links, jobs and the business clock; MinIO for rendered exports and imported originals; and Mailpit as the mail server for sign-up codes, invites, comment mentions and link notices. The drawing engine runs in the browser on a canvas element, while the server is the single authority on order and final pixels and computes them by the same published rules. Out of scope: video, audio, AI generation, 3D, vector tools, soft-edged brushes, plugins, game-engine integrations, public galleries, likes, follows, contests, challenges, drawing rooms, outside sign-in and paid plans. All artwork and every person in the product is invented, and demo artwork is generated.

## Problem and users

Small groups making pixel graphics still work one at a time. A project file moves through a shared drive or version control while everyone else waits, and two people's edits to one file cannot be combined. Edge-matched tiles are placed by hand or with separate scripts, feedback arrives as cropped screenshots that lose the frame and pixel it refers to, and a palette change can miss a frame. The organiser pays in lost days and repainted work.

- **Project owner** (daily): sets up a project, invites the group, controls access, and names the snapshots and exports the group relies on.
- **Editor** (daily): draws, animates and builds tiles on the same sprite as others, undoing only their own work.
- **Reviewer** (weekly): pins comments to an exact pixel and frame and compares snapshots, without being able to change artwork.
- **Link viewer** (occasional): watches one sprite and its animation through a read-only link, without an account.

## Journeys

1. **Set up and invite.** An owner signs up, confirms the emailed code, creates a project and a sprite, invites an editor and a reviewer by email, and each accepts. The end state is a Members table listing three people with their roles.
2. **Draw together.** Two editors open one sprite in separate browsers. Each draws with pointer or keyboard, sees the other's cursor and strokes appear without a reload, and undoes only their own stroke. Both stages end with the same composite hash.
3. **Change a colour.** An editor edits a swatch used across several frames. Everyone sees the colour spread out from the editor's cursor, then the thumbnails change, then the count settles. The stored indices are unchanged and a stale edit from another editor gets a named conflict.
4. **Animate.** An editor adds frames, links a cel across frames, sets durations and a pingpong tag, and watches the preview. After a reload the timeline and tag are unchanged.
5. **Build a map.** An editor imports a frame as tiles, places tiles with edge matching using the keyboard, flips one, and edits a tile. Every use changes and each tile's use count is right.
6. **Review and restore.** A reviewer pins a comment to a pixel and mentions an editor, who receives one email. The owner compares two snapshots and restores one. Everyone's stage changes live to the restored bytes and all later snapshots remain.
7. **Export.** An owner starts a project export, watches progress, and sees a stored result only after the store confirms it, then downloads the sheet and JSON. With storage down, drawing continues and the export reports the outage.
8. **Share and end.** An owner creates a read-only link. A viewer with no account watches the sprite and preview. When the link's end passes or the owner revokes it, the open viewer lands on the ended page and the owner receives a notice for a link that reached its end.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Sprite stage contract.** The stage is one named canvas that exposes the published attributes, whole-number zoom and pixel mapping at every moment.
- **DP-02 — Pixel route matches the stage hash.** The pixel route returns the published colour text, and its bytes hash to the stage's composite hash at the same sequence number.
- **DP-03 — Drawing mode by keyboard.** An editor enters drawing mode, moves the cursor, applies every tool and leaves using only the keyboard, and a second person sees the result live and after a reload.
- **DP-04 — Tool and brush hotkeys.** The published stage hotkeys choose tools, mirror, swatches, brush size and frame whichever non-text workspace control has focus.
- **DP-05 — Shift runs.** Holding Shift with arrow keys paints a run that commits as one stroke when Shift is released.
- **DP-06 — Stage announcements.** Cursor, tool, frame and swatch changes are announced in the named live region with the exact published text.
- **DP-07 — Line rule and joined samples.** Lines and successive pointer samples follow the published line rule, so fast strokes leave no gaps.
- **DP-08 — Brush masks.** Brush sizes cover the published offsets and cells outside the sprite are dropped.
- **DP-09 — Rectangle and ellipse tools.** Outline and filled shapes cover exactly the cells the published rules give.
- **DP-10 — Fill tool.** Fill changes the published region by exact swatch index on the active layer, with and without contiguous matching.
- **DP-11 — Mirror painting.** Mirror modes paint the reflected cells by the published rule, with a cell on the axis painted once.
- **DP-12 — Dither tool.** Dither fills the fill region using the published matrix anchored to absolute sprite coordinates.
- **DP-13 — Selection operations.** Move, copy, paste, both flips and rotate are each one atomic operation following the published rules.
- **DP-14 — Command palette.** The command palette finds and runs tools, layers, frames and swatches, ranked by the published score, as part of a pointer and hotkey drawing session whose hash matches in a second context.
- **DP-15 — Layer properties.** Editors set a layer's opacity, blend and visibility, and everyone's stage follows without a reload.
- **DP-16 — Integer compositing.** The composite follows the published integer formulas, excluding hidden layers, as checked on both the hash and the pixel route.
- **DP-17 — Keyboard pick-up.** Layers, frames and swatches are lifted, moved, dropped and cancelled by keyboard with the exact announcements, and a change in layer order changes a watcher's hash live.
- **DP-18 — Onion skin isolation.** Onion skin draws separately and never changes the hash, the pixel route or exports.
- **DP-19 — Indexed cels.** Cels store swatch indices only, with index 0 transparent and unchangeable, and a swatch edit changes no cel index.
- **DP-20 — Swatch edits with a version check.** A swatch edit is one operation, and a stale edit or an edit of a removed swatch gets a named conflict with the current state and never merges.
- **DP-21 — Swatch counts and removal.** Each swatch shows its true pixel count after every stroke, undo, restore and tile edit, and removing a swatch in use is refused with that count.
- **DP-22 — Colour ramps.** A ramp adds the intermediate swatches between two swatches by the published formula.
- **DP-23 — Palette file import.** Hex and GIMP palette files are accepted whole or refused at their first bad line with the exact text.
- **DP-24 — Index Flood.** After a swatch edit is accepted, watchers see the colour reach every use in the published stages while the stored values are already final, as qualified in Motion and effects.
- **DP-25 — Image import is all or nothing.** A PNG or GIF import yields both a stored original and a new sprite or neither, judged on decoded content against the configured limits, and the original downloads byte for byte at any later time.
- **DP-26 — Merge down.** Merging a layer down composites both layers into exact new or reused swatches across all frames, or is refused whole with the exact counts, and a watcher sees the list and hash change live.
- **DP-27 — Frame durations and order.** Frame durations stay within the configured limits and every person sees frame additions and moves live.
- **DP-28 — Linked cels.** A linked cel is one buffer shared by frames, so an edit shows in every linked frame until unlinking makes an independent copy, and the timeline survives a reload.
- **DP-29 — Frames grid.** The frames grid renders a bounded number of rows, reports the true total and moves by the published keys.
- **DP-30 — Focus held under live frames.** When another person adds frames above the focused row, focus stays on the same frame while its number updates.
- **DP-31 — Animation tags.** Tags name a frame range and direction, and the sequence each direction gives is the published one.
- **DP-32 — Preview playback.** The preview plays the chosen sequence with each frame's duration on browser timers, and tags and frames edited beforehand are still there after a reload.
- **DP-33 — Reduced-motion preview.** Under reduced motion nothing autoplays and the step controls walk the same sequence.
- **DP-34 — Draft autosave and stale drafts.** Comment and tag drafts save after the configured pause in typing and survive a reload, and saving over a newer version is refused while the person can load the newer text.
- **DP-35 — Number and date settings.** Each person chooses a number format and time zone, and every count, duration total and date they see, including timeline totals and their emails, follows the published format, as part of a long timeline session.
- **DP-36 — Tilesets and frame cutting.** Importing a frame cuts it into tiles in the published order and reuses identical or flipped tiles with their flags.
- **DP-37 — Tilemap grid.** Map cells expose tile and flip attributes, and placing, erasing and flipping work by the published keys.
- **DP-38 — Tile edits and use counts.** Editing a tile changes every cell using it live, and each tile's use count stays correct.
- **DP-39 — Edge matching.** With edge matching on, placing or erasing updates that cell and its four neighbours as one operation from the published mask and table, seen live by a second person and after a reload.
- **DP-40 — Export jobs with live progress.** Sprite and project exports run as jobs through the published states, with progress shown in place, from starting a job to downloading its stored files.
- **DP-41 — Cancelling an export.** Cancelling a running job gives the exact text and leaves no record to download and no stored object.
- **DP-42 — Export jobs survive a server death.** A job whose server dies is continued by a running server within the published time and finishes correctly.
- **DP-43 — Stored only after confirmation.** An export shows as stored only after the object store confirms its size and checksum, and a failed export leaves no download or stray object.
- **DP-44 — PNG and GIF output.** PNG and GIF exports follow the published scale, delay and transparency rules and are deterministic for one sequence number.
- **DP-45 — Packed sheet and JSON.** The packed sheet and its JSON follow the published layout and schema.
- **DP-46 — Storage outage.** While object storage is unreachable, drawing continues and exports and imports report the outage with the exact status and copy.
- **DP-47 — One order for every operation.** Every sprite operation gets one sequence number, and all members converge on one hash, shown by two people painting the same pixels.
- **DP-48 — Strokes apply once.** A stroke resent with the same client stroke id is applied once and answers with its stored response.
- **DP-49 — Layer locks.** A lock shows to everyone, and another person's stroke on that layer is refused and rolled back.
- **DP-50 — Personal undo and redo.** Undo and redo reverse only that person's own actions, as new operations, within the configured depth.
- **DP-51 — Undo refusals.** Undo or redo is refused with the exact text when someone else has changed the affected pixels or swatch, or when the stack is empty.
- **DP-52 — Presence list and live cursors.** The presence list shows people in join order, with the configured overflow, idle marks and prompt removal, and other members' cursors appear in place with their position and frame.
- **DP-53 — Preview speed and repeats.** Tags carry a repeat count and the preview a speed, so playback follows the exact published durations and sequence on browser timers and stops at the published frame with the exact text.
- **DP-54 — Team announcements.** Joins, departures and painted-pixel totals are announced with the published wording and summing window.
- **DP-55 — Missed events route.** The events route returns every sequenced operation after a given sequence number.
- **DP-56 — Offline stroke queue.** When the browser reports itself offline, strokes queue in order, draw at once and are counted in the sync status.
- **DP-57 — Reconnect and replay.** On coming back online the client fetches missed events and replays queued strokes, reports the counts, rolls back refused strokes and converges with everyone.
- **DP-58 — Pinned comments.** Owners, editors and reviewers pin a comment to a frame and pixel, including by keyboard, and everyone sees the pin in place, as part of a review session that runs through mention, compare and restore.
- **DP-59 — Comment states.** A comment moves between open and resolved by the published transitions, and illegal moves are refused.
- **DP-60 — Mention email and delivery state.** A mention emails the named member and shows as delivered only after the mail server accepts the message.
- **DP-61 — One comment per post.** A double post or a repost with one idempotency key makes one comment and one email.
- **DP-62 — Reviewer refusals.** The server refuses reviewers on artwork, palette, restore and invite actions, and the interface offers them no such controls.
- **DP-63 — Named snapshots.** Owners save named snapshots that capture the whole sprite at one sequence number, listed newest first.
- **DP-64 — Snapshot compare.** Compare shows each changed frame's count and the changed cells in the published order.
- **DP-65 — Exact restore.** Restore first saves a snapshot, then replaces the current state byte for byte live for everyone, keeps all snapshots and clears undo.
- **DP-66 — Activity sentences.** The activity list records each published action in its exact sentence, merging consecutive strokes by the published rule.
- **DP-67 — Activity paging.** Activity pages stay stable while new events arrive.
- **DP-68 — Sign-up with an emailed code.** A person signs up with email and password and confirms with a 6-digit code received by mail.
- **DP-69 — Projects and sprites.** A signed-in person creates projects and sprites within the configured limits and becomes the owner of each project they create.
- **DP-70 — Invites.** Owners invite by email with a role, and an invite is single use, revocable and lapses on the business clock when accepted too late.
- **DP-71 — Role changes take effect live.** Removing a member or lowering their role refuses their next request and changes their open session within the published time.
- **DP-72 — Read-only link scope.** A link opens one sprite and its preview with no account and reaches no comments, member details, cursors, other sprites or exports, as seen from invitation through the end of the link.
- **DP-73 — Revoking and regenerating links.** Revoked and replaced links stop working at once, and no link can change anything.
- **DP-74 — Links ended by the server clock.** Open viewers move to the ended page within the published time when the server clock ends the link, whatever the device clock says.
- **DP-75 — Link ended notice.** The owner receives one email when a link reaches its end.
- **DP-76 — Relative times follow the business clock.** Relative times and idle marks on open pages follow the business clock within the published delay.
- **DP-77 — Phone tabs and zoom.** Below the published width the workspace uses the published tabs, and the named zoom buttons step through the published zoom levels without a pinch.
- **DP-78 — One-finger painting.** One finger paints exact pixels by the line rule, seen live by a second person on desktop and kept after a reload.
- **DP-79 — Long-press colour pick.** A long press picks the colour and paints nothing.
- **DP-80 — Tile stamps and map undo.** A person copies a region of the map to a stamp by keyboard, flips and places it as one operation seen live by another person, and undoes map changes with the published refusal.
- **DP-81 — Published layouts.** Each of the three published viewports shows its published layout with no horizontal overflow.
- **DP-82 — Landing stage.** The landing page carries the published centred headline, sprite, stickers, pill and full-height candy fields.
- **DP-83 — Workspace panel language.** Working panels sit under flat candy title blocks around square-cornered artwork on black.
- **DP-84 — Cards, empty states and notices.** Forms, tables, empty states, outage notices and loading outlines carry the published look.
- **DP-85 — Dialog focus.** Every dialog or sheet keeps Tab inside, closes on Escape and returns focus to its opener.
- **DP-86 — Tap targets.** Every interactive control outside the pixel canvas is at least 44 pixels in both directions.
- **DP-87 — Motion discipline.** Only the named motions run, none loops decoratively, and under reduced motion each lands at its end state at once.
- **DP-88 — Browser timing rule.** Pixels, attributes and live text follow input and server messages at once, and only the named timed behaviours wait on browser timers.
- **DP-89 — Business clock and config.** One stored clock drives every server-side time rule, and the config route reports it with the active limits.
- **DP-90 — Grading routes.** The seed and clock routes work only with the grading key and create the published records in one call.
- **DP-91 — Demo workspace.** A first start with no people generates the same demo project every time.
- **DP-92 — API error order.** Every endpoint follows the one published error order and body shapes.
- **DP-93 — Server boundary.** The server enforces same-origin writes and body limits and never serves source files or credentials.
- **DP-94 — Health and run manifest.** The run manifest starts the app on the published port, and the health route reports as published.
- **DP-95 — Artwork survives restart.** All artwork, order and undo history return exactly after a reload or server restart.
- **DP-96 — Credentials stay on the server.** Every service credential comes from the environment at start and never reaches the browser.
- **DP-97 — Server pixel authority.** A stroke sent directly to the API produces the same pixels as the browser would, because the server computes them itself.
- **DP-98 — Floating selection by keyboard.** A selection lifts, moves and commits by keyboard with exact text, and neither the hash nor a second person sees any change until the commit, which then survives a reload.
- **DP-99 — Pixel perfect pencil.** With pixel perfect on, the pencil drops corner cells by the published rule, identically in the browser and on the server, and a second person sees the same hash.

## Frontend

### Screens and layout (DP-01, DP-77, DP-81, DP-82, DP-83, DP-84)

Pages: landing `/`; sign-up `/signup`; sign-in `/signin`; project list `/projects`; project page `/projects/<id>` (white cards for sprites, members, invites, read-only links and exports); invite `/invites/<token>`; workspace `/projects/<id>/sprites/<sprite id>`; read-only view `/s/<token>`.

The workspace holds a top bar (project and sprite name, `list "On this sprite"`, `status "Sync status"`, `button "Export"`), `toolbar "Tools"`, the stage with its zoom buttons, and the panels Palette, Layers, Frames (with Preview), Tiles, Comments, Snapshots and Activity.

| Viewport | Workspace layout | Order |
|---|---|---|
| 375x812 | `tablist "Workspace"` docked at the bottom with tabs Canvas, Layers, Frames, Palette. One tab's panel fills the area above it. Canvas shows tools, stage and zoom and pan buttons. `button "More panels"` opens a sheet with Tiles, Comments, Snapshots and Activity. | top bar, active panel, tab dock |
| 768x1024 | Stage above a dock of three side-by-side panels: Palette, Layers, Frames with Preview. No tablist. `button "More panels"` opens the same content as a side drawer. | top bar, tools, stage, dock |
| 1280x800 | Three panes. Left: Palette, Layers. Centre: tools, stage, Frames below it. Right: Preview, Tiles, Comments, Snapshots, Activity, each scrolling inside the pane. | left, centre, right |

Export controls: `button "Export"` in the workspace top bar opens `dialog "Export"` holding the format, scale, frame, padding, extrude and label fields, `button "Start export"`, and below them `status "Job progress"` and `button "Cancel job"` while the job runs; closing the dialog does not cancel the job. On the project page the Exports white card holds `button "Export project"`, `table "Exports"` (each row linking its stored files) and, while a project job runs, its own `status "Job progress"` and `button "Cancel job"`.

The tablist exists only below 700 CSS pixels. The three-pane layout starts at 1100 CSS pixels; widths from 700 to 1099 use the stage-over-dock layout. No page scrolls horizontally at any of the three viewports. The canvas never overflows the page: the stage sits inside a clipping viewport that scrolls inside itself when the zoom exceeds the space.

The read-only view shows the stage, zoom buttons and `region "Preview"`, with the sprite name above them, and nothing else. On the phone it stacks in that order. Other pages use one centred column of white cards at 375 and 768, and at most two columns at 1280.

### Public screens and controls (DP-26, DP-35, DP-53, DP-80, DP-98, DP-99, DP-01, DP-02, DP-03, DP-13, DP-14, DP-17, DP-29, DP-32, DP-37, DP-52, DP-53, DP-77, DP-80)

Only these are public; everything else is free.

| Where | Role and accessible name | Notes |
|---|---|---|
| Landing | `heading` level 1 `Draw the same sprite, at the same time.` | hero headline |
| Landing | `link "Start a project"` | goes to `/signup`, or `/projects` when signed in |
| Sign-up | `textbox "Name"`, `textbox "Email"`, `textbox "Password"`, `button "Create account"`, `textbox "Code"`, `button "Confirm"` | code fields appear after the account is created |
| Sign-in | `textbox "Email"`, `textbox "Password"`, `button "Sign in"` | |
| Projects | `button "New project"`, `textbox "Project name"`, `link "<project name>"`, `combobox "Number format"` (options `en-US`, `en-IN`), `combobox "Time zone"` (options `UTC`, `Asia/Kolkata`, `America/New_York`), `button "Save settings"` | settings save for the signed-in person |
| Project | `button "New sprite"`, `dialog "New sprite"`, `textbox "Sprite name"`, `spinbutton "Width"`, `spinbutton "Height"`, `button "Create sprite"`, `link "<sprite name>"` | |
| Project | `button "Import image"`, file input named `Image file`, `link "Download original <file name>"` | |
| Project, Members | `table "Members"`, `row "<name>"`, `combobox "Role for <name>"`, `button "Remove <name>"` | role options are `Editor` and `Reviewer`; the owner's row shows `Owner` and its combobox is disabled |
| Project, Invites | `textbox "Invite email"`, `combobox "Invite role"`, `button "Invite"`, `table "Invites"`, `button "Revoke invite"` | invite role options are `Editor` and `Reviewer`; a row shows the email, the role as `Editor` or `Reviewer`, and the state as `pending`, `accepted`, `revoked` or `lapsed` |
| Project, Links | `combobox "Link sprite"`, `textbox "Link label"`, `spinbutton "Link hours"`, `button "Create link"`, `table "Read-only links"`, `row "<label>"`, `button "Revoke link"`, `button "Regenerate link"` | row shows URL and state; `Link hours` follows Read-only links under Business rules |
| Project, Exports | `table "Exports"`, `link "Download <file name>"` | |
| Invite | `button "Accept invite"` | |
| Workspace | `canvas` with role `application` and name `Sprite stage` | see stage contract |
| Workspace | `button "Zoom in"`, `button "Zoom out"`, `button "Pan left"`, `button "Pan right"`, `button "Pan up"`, `button "Pan down"` | pan buttons only below 700 CSS pixels |
| Workspace | `toolbar "Tools"` with `button "Pencil"`, `"Eraser"`, `"Line"`, `"Rectangle"`, `"Ellipse"`, `"Fill"`, `"Dither"`, `"Selection"`, `"Picker"` | pressed state marks the active tool |
| Workspace | `checkbox "Pixel perfect"`, `checkbox "Filled"`, `checkbox "Contiguous"`, `spinbutton "Dither level"`, `spinbutton "Brush size"`, `combobox "Mirror"` | options None, X, Y, Both |
| Workspace | `button "Move selection"`, `button "Copy selection"`, `button "Paste selection"`, `button "Flip horizontal"`, `button "Flip vertical"`, `button "Rotate 90"` | |
| Workspace | `checkbox "Onion skin"`, `spinbutton "Onion frames"` | frames from 1 to 4 |
| Workspace | `button "Undo"`, `button "Redo"` | |
| Palette | `region "Palette"`, `listbox "Palette"`, `option "Swatch <index>"` with `data-used-by` | |
| Palette | `textbox "Swatch colour"`, `button "Save swatch"`, `button "Add swatch"`, `button "Remove swatch"`, `spinbutton "Ramp steps"`, `button "Add ramp"`, `button "Import palette"`, file input named `Palette file` | |
| Layers | `region "Layers"`, `listbox "Layers"`, `option "<layer name>"` | top of the list is the top layer |
| Layers | `button "Add layer"`, `slider "Layer opacity"`, `combobox "Blend"` (options Normal, Multiply), `checkbox "Layer visible"`, `button "Lock layer"`, `button "Merge down"` | lock button reads `Unlock layer` for the holder |
| Frames | a line in `region "Frames"` with `data-total-ms` reading `Total <ms> ms · Average <ms> ms` | formats per Number and date settings |
| Frames | `region "Frames"`, `grid "Frames"`, `row "Frame <n>"`, `button "Add frame"`, `spinbutton "Frame duration"`, `button "Link cel"`, `button "Unlink cel"` | |
| Frames | `textbox "Tag name"`, `spinbutton "Tag from"`, `spinbutton "Tag to"`, `combobox "Tag direction"` (options Forward, Reverse, Pingpong), `spinbutton "Tag repeat"`, `button "Add tag"`, `button "Load newer"` | |
| Preview | `region "Preview"` holding a canvas with `data-preview-frame` and `data-preview-mode`; `combobox "Preview tag"`, `combobox "Preview speed"` (options Half, Normal, Double), `button "Previous frame"`, `button "Next frame"`, `button "Pause preview"` | the pause button reads `Play preview` while paused and is absent under reduced motion; `Preview tag` options are `All frames` (selected on load, plays all frames forward) then one option per tag named by the tag |
| Tiles | `region "Tiles"`, `listbox "Tiles"`, `option "Tile <n>"`, `grid "Tilemap"`, `gridcell` with `data-x`, `data-y`, `data-tile`, `data-flip-h`, `data-flip-v` | the grid carries `data-stamp` (`w,h`) while a stamp is held |
| Tiles | `checkbox "Edge matching"`, `button "New tileset"`, `combobox "Tile size"`, `button "New tilemap"`, `button "Import frame as tiles"`, `button "Edit tile"`, `dialog "Edit tile"`, `application "Tile editor"`, `button "Save tile"`, `textbox "Edge table"`, `button "Save edge table"` | |
| Comments | `region "Comments"`, `list "Comments"`, `button "Pin comment"`, `dialog "New comment"`, `textbox "Comment"`, `button "Post comment"`, `button "Resolve"`, `button "Reopen"`, `button "Load newer"` | |
| Stage overlay | `button "Comment at <x>, <y>"` with `data-state` of `open` or `resolved` | pins for the current frame |
| Stage overlay | `region "Live cursors"`, children carrying `data-person`, `data-x`, `data-y`, `data-frame` | absent on the read-only view |
| Snapshots | `region "Snapshots"`, `textbox "Snapshot name"`, `button "Save snapshot"`, `list "Snapshots"`, `button "Restore"`, `combobox "From"`, `combobox "To"`, `list "Snapshot changes"` | |
| Activity | `region "Activity"`, `list "Activity"`, `button "Load more"` | |
| Exports | `button "Export"`, `dialog "Export"`, `combobox "Format"` (options PNG, GIF, Sheet), `spinbutton "Scale"`, `spinbutton "Export frame"`, `spinbutton "Padding"`, `spinbutton "Extrude"`, `textbox "Export label"`, `button "Start export"`, `button "Export project"`, `button "Cancel job"` | |
| Palette of commands | `dialog "Command palette"`, `combobox "Command"`, `listbox "Commands"` | |
| Phone | `tablist "Workspace"`, `tab "Canvas"`, `tab "Layers"`, `tab "Frames"`, `tab "Palette"`, `button "More panels"`, `dialog "More panels"` | |
| Top bar | `list "On this sprite"`, `listitem "<name>"` with `data-idle`, overflow `listitem "+<n>"` | |
| Live regions | `status "Stage announcements"`, `status "List announcements"`, `status "Team announcements"`, `status "Sync status"`, `status "Job progress"`, `status "Draft status"`, `status "Notices"`, `alert` | copy in Feedback states |
| Ended link | `heading "This link has ended"` | |

**Stage contract.** The stage canvas carries `data-sprite-id`, `data-frame` (frames count from 1), `data-layer` (active layer name), `data-zoom`, `data-cursor-x`, `data-cursor-y`, `data-seq` (the last server sequence number applied), `data-composite-hash`, `data-selection` (`x,y,w,h`, or absent with no selection) and `data-floating` (`x,y,w,h` of a lifted selection, or absent). `data-composite-hash` is the lowercase SHA-256 of the current frame's composite RGBA bytes, rows top to bottom, each row left to right. For example, a 2 by 1 frame whose cells are `ff0044ff` and `00000000` hashes to `ac0b31f44df1d49682a57b5bcdca73870c19d91315a0681b26e05fa939923b9d`.

Zoom is a whole number of CSS pixels per sprite pixel from 1, 2, 4, 8, 16, 32. The default is 8, or the largest of those that fits the stage viewport when 8 does not. The canvas has no outer frame or inner margin, no scaling beyond the zoom, no blurring between pixels, and a drawing buffer of exactly width times zoom by height times zoom. So sprite x = floor((clientX - canvas left) / zoom), and y likewise with clientY and the canvas top.

Each frame row's thumbnail carries `data-thumb-seq`, the sequence number of the last swatch edit drawn into it, `0` when none.

**Attribute values.** All `data-*` values are plain decimal text. `data-flip-h` and `data-flip-v` are always present on a map cell and are `true` or `false`. `data-tile` is `0` for an empty map cell and the tile number otherwise. `data-person` on a live cursor is the person's display name. `data-idle` is always present on a presence entry and is `true` or `false`. `data-state` on a comment pin is `open` or `resolved`.

### Interactions (DP-26, DP-35, DP-53, DP-80, DP-98, DP-99, DP-03, DP-04, DP-05, DP-13, DP-14, DP-17, DP-29, DP-30, DP-37, DP-58, DP-78, DP-79, DP-80, DP-85, DP-88)

**Timing rule.** The device clock can be wrong or paused. Pixels, `data-*` attributes and live text follow pointer input, key presses and server messages at once, never waiting on an animation frame or a timer. Only these run on browser timers: preview playback, the swatch flood, draft autosave debounce, the long press and the stroke-announcement window.

**Stage by keyboard.** Focus arriving in the stage is drawing mode, with the cursor at its last position or at 0, 0 on first arrival.
- Arrows move the cursor one cell, stopping at the sprite's edges.
- Space applies the active tool at the cursor. Pencil and eraser paint one stamp. Line, rectangle, ellipse and selection take Space at the first corner and at the second. Fill and dither apply. Picker takes the colour as primary.
- Holding Shift, each arrow extends a straight run from the cursor, for pencil and eraser. The first press paints the start cell and the cell moved to, later presses paint each new cell, and a press on the other axis bends the same stroke at that cell. Releasing Shift commits the run as one stroke. For example, from 3, 3, three Shift+Right presses and a release make one stroke covering x from 3 to 6.
- B pencil, E eraser, L line, R rectangle, O ellipse, G fill, D dither, S selection, I picker.
- M cycles mirror none, x, y, both. X swaps primary and secondary. [ and ] lower and raise brush size. Comma and period go to the previous and next frame, stopping at the ends.
- C opens `dialog "New comment"` pinned at the cursor on the current frame.
- P toggles pixel perfect. F lifts the current selection, per Floating selection below.
- Tab and Shift+Tab do nothing in drawing mode. Escape leaves drawing mode and the next Tab moves on. Enter on the focused stage re-enters drawing mode.
- Tab order leaving the stage follows the reading order of the viewport's layout, and a panel that is not on screen is not focusable:
  - 1280x800: `Zoom in`, `Zoom out`, `grid "Frames"` (below the stage in the centre pane), then the controls of the right pane from top to bottom. Palette and Layers sit in the left pane before the stage, so Tab from the stage does not reach them.
  - 768x1024: `Zoom in`, `Zoom out`, `listbox "Palette"`, `listbox "Layers"`, `grid "Frames"`, then the Preview controls and `button "More panels"`.
  - 375x812: `Zoom in`, `Zoom out`, `Pan left`, `Pan right`, `Pan up`, `Pan down`, then the tabs of `tablist "Workspace"`. Palette, Layers and Frames are in other tabs, are not rendered while their tab is not chosen, and become the next Tab stop after the tablist once their tab is chosen.

The letter, comma, period, X, M and bracket hotkeys also work with focus on any button, checkbox, slider, listbox or grid in the workspace, except the Tilemap grid, where H, V and C keep their map meaning. They never fire while typing in a text field or inside a dialog. Ctrl or Cmd+Z undoes and Ctrl or Cmd+Shift+Z redoes, from anywhere in the workspace outside a text field. Ctrl or Cmd+K opens the command palette from anywhere in the workspace.

**Stage by pointer.** Pointer movement over the stage updates the cursor attributes. Pressing and dragging paints with pencil and eraser, and samples are joined by the line rule. Line, rectangle, ellipse and selection drag from corner to corner. Fill, dither and picker act on press. Releasing commits one stroke, which is drawn at once and rolled back if refused. With `Pin comment` pressed, the next stage click opens `dialog "New comment"` at that pixel.

**Selection.** `Move selection` and `Paste selection` use the stage cursor as the new top-left corner, so point at the destination, then act. `Copy selection` keeps the selected indices in the browser for pasting on any frame or layer.

**Floating selection.** With a selection present, F lifts it: `data-floating` appears and the lifted cells are drawn over the stage. While floating, arrows move it one cell, with its top-left allowed from one cell short of fully off the left or top edge to the last column or row. Enter commits it as one move operation, cells outside the sprite dropped, and `data-floating` goes while `data-selection` takes the new rectangle. Escape cancels it, returning it to where it was and staying in drawing mode. Until the commit, `data-seq`, `data-composite-hash`, the pixel route and every other person's stage do not change, and Space and tool keys do nothing. For example, a 4 by 3 selection at 2, 5 moved by one Right press reads as at 3, 5.

**Primary and secondary swatches.** The primary swatch starts as swatch 1 and the secondary as swatch 2, or as index 0 when the palette has fewer than two swatches. Clicking an option in `listbox "Palette"`, or pressing Enter on it, makes it primary; Shift+click or Shift+Enter makes it secondary; the Picker sets the primary; X swaps them. `spinbutton "Dither level"` starts at 8 and `spinbutton "Ramp steps"` at 5. Dither uses the primary and secondary swatches. `Add ramp` uses the primary swatch as the start and the secondary as the end, and is disabled while either is index 0.

**Keyboard pick-up.** `listbox "Layers"`, `grid "Frames"` and `listbox "Palette"` use roving focus. Enter selects. Space lifts, arrows move, Space drops, Escape cancels, and each step writes the text from Feedback states. Pointer drag does the same. `<item>` is the layer name, `Frame <n>` using the number it had when lifted, or `Swatch <index>`. Positions count from the top from 1. The new order is sent on drop and others see it live.

**Frames grid.** At most 40 rows are in the page at once, `aria-rowcount` is the true total and each row has its `aria-rowindex`. Home and End go to the first and last frames, Page Up and Page Down move 10 rows, and arrows move one. When frames arrive live above the focused row, focus stays on the same frame while its number and `aria-rowindex` update, and `data-frame` on the stage follows if it is that frame.

**Tilemap.** `grid "Tilemap"` uses roving focus. Arrows move. Enter places the selected tile (or the table's tile with edge matching on), Delete erases, H and V toggle the focused cell's flips. Shift+arrow grows a marked rectangle from the focused cell, and C copies it to a stamp, with `data-stamp` set. While a stamp is held, Enter places it with its top-left at the focused cell as one operation (cells beyond the map dropped, empty stamp cells written as empty, edge matching ignored), H mirrors the stamp's columns and toggles each of its cells' horizontal flip, V does the same for rows and vertical flip, and Escape drops the stamp. For example, a stamp row of tile 3, then tile 4 with no flips, after H, is tile 4 flipped, then tile 3 flipped. In `application "Tile editor"`, arrows move, Space or a click paints the primary swatch, and `Save tile` sends the tile.

**Command palette.** `combobox "Command"` drives `listbox "Commands"` through `aria-activedescendant`. Items are `Tool: Pencil`, one for each tool in the toolbar; `Layer: <name>`; `Frame <n>`; `Swatch <index>`. Up and Down move, Enter runs the active item and closes, Escape closes, and focus returns to the opener. The ranking rule is under Business rules.

**Dialogs and sheets.** Tab and Shift+Tab wrap inside every open dialog or sheet, Escape closes it, and focus returns to its opener.

**Touch.** Below 700 CSS pixels one finger paints with the active tool, pencil by default. A finger held still for `CELMATE_LONG_PRESS_MS`, measured by browser timer, picks the colour under it as primary and paints nothing. A touch that lifts sooner paints one stamp, and one that moves to another cell first starts a stroke, joined by the line rule. A second finger cancels the touch with no pixels. Zoom uses the named buttons, and no pinch is ever needed. The tabs switch panels in place and keep the stage state.

**Presence and live view.** Other people's strokes, cursors, swatch counts, comment pins, frame and layer changes appear within one second, without a reload.

### Visual design (DP-82, DP-83, DP-84, DP-86)

**Direction.** Sugary, exact and playful: a floor-to-ceiling candy field behind every landing stage, artwork always drawn with hard pixel edges, and die-cut pixel stickers that tilt into place and then stop. Soft, oversized candy shapes surround a hard-edged pixel grid on pure black, with light headline type where this genre expects chunky retro lettering. The black ground gives indexed colours no tint to fight.

**Typefaces.** Headlines use Stack Sans Headline and everything else uses Stack Sans Text, both shipped inside the app. Each heading step is about a quarter larger than the one below. Figures use the text face's tabular numerals.

**Colours.** The ground is pure black, the working surface a near-black, ink white, muted text mid-grey, the accent a pale candy cyan, and text on the accent black. The candy fields and title blocks are flat mint, cyan, lemon, orange and cornflower, with black text on them. Density is comfortable.

**Landing.** A centred axis with full-height flat fields stacked in the order mint, cyan, lemon, orange, cornflower, below a black hero. Each field carries one short heading and line about, in turn, live co-editing, the swatch flood, tiles, pinned review and exports, with stickers cropped by the viewport edges. The hero has the centred headline at about nine percent of the viewport width in light weight, its first clause grey and its second white, on black. Below it are a procedurally drawn sprite that animates once and settles at 40% of the width, four die-cut pixel stickers taken from that sprite and cropped at different rotations, and one large cyan pill. On a phone the order is headline, sprite, pill, with two corner stickers.

**Working screens.** Every working panel sits on the near-black surface under a title on a flat candy block with black text: mint for Palette, cyan for Layers, lemon for Frames, orange for Tiles, cornflower for Comments. Snapshots and Activity use white cards. Forms and tables of members, links and exports sit on white cards with black text and generously rounded corners of about 28 pixels. Controls are always cyan pills with black text, with a hard black offset shadow where they sit on a field, so they stay visible on the cyan block. Empty states show one tilted sticker and one line of copy. Errors and outage notices use the orange field with black text. Loading shows the panel's outline with no shimmer. The canvas and thumbnails are always square-cornered, with artwork centred on pure black between flat panels.

**Access.** Controls outside the pixel canvas are at least 44 pixels in both directions. Text and controls meet WCAG 2.2 AA contrast. Focus is always visible as a thick outline.

### Motion and effects (DP-24, DP-32, DP-33, DP-82, DP-87)

**Index Flood.** Its job is to show how far a colour reaches, including off-screen frames, and that one palette entry changed rather than the pixels. After the server accepts a swatch edit, on every member's page:
1. Pixels of that index on the visible cel take the new colour in rings of growing Chebyshev distance from the editing person's stage cursor, over 420 ms, starting quickly and settling softly. All other pixels hold still. While this runs the stage carries `data-flood-radius`, the current ring, which starts at 0, never falls and reaches the furthest cell of the sprite from the cursor by the end. Cells within the radius are drawn new and cells beyond it old. The attribute is then removed.
2. The frame thumbnails change left to right, 30 ms apart, each updating `data-thumb-seq`.
3. The swatch's visible count rolls up to the server's total over 320 ms. `data-used-by` holds the final total from the start.

The pixel route and `data-composite-hash` hold the final values at once, and only what is drawn is staged. An undo by the same person floods the old colour back the same way. The status text from Feedback states is announced when the flood starts.

Under reduced motion `data-flood-radius` never appears, and the canvas, all thumbnails and the count land in one step with the same announcement.

**Preview.** `data-preview-frame` advances on browser timers by each frame's duration through the published sequence, repeating. It is the only continuous motion in the product and `Pause preview` stops it. Under reduced motion `data-preview-mode` is `step`, nothing autoplays, and `Previous frame` and `Next frame` walk the same sequence, wrapping at its ends; otherwise the mode is `autoplay` while playing and `step` while paused.

**Landing.** The hero sprite plays its animation once in no more than one second and settles, and stickers tilt into place in under half a second and stop. Under reduced motion the sprite and stickers show their end state at once.

**Feedback motion.** Pills press down onto their shadow in under a tenth of a second on press. Panels and sheets slide in within about a quarter of a second. Under reduced motion they appear at once. No other decorative loop exists.

### Feedback states (DP-26, DP-35, DP-53, DP-80, DP-98, DP-99, DP-06, DP-17, DP-24, DP-34, DP-35, DP-40, DP-41, DP-43, DP-46, DP-54, DP-56, DP-57, DP-60, DP-71)

Refusal messages from the API show in `alert` on the orange field, and field errors show under their field and in `alert`, with a 422 text exactly as the API sent it. A noun takes its singular form when its count is exactly 1, and counts use the viewer's number format.

| Live region | When | Exact text |
|---|---|---|
| `status "Stage announcements"` (latest only) | cursor moved or painted at | `Pixel 3, 5, ff0044ff, layer Body`, for the active layer's cell |
| | tool chosen | `Tool: Line` |
| | frame changed | `Frame 3 of 8` |
| | swatch edit accepted | `Swatch 3 now ff0044ff, used by 12 pixels in 2 frames` |
| | colour picked | `Picked swatch 3` |
| | secondary chosen | `Secondary swatch 4` |
| | swatches swapped | `Swatches swapped` |
| | mirror changed | `Mirror: x` |
| | brush changed | `Brush size 3` |
| | Escape on the stage | `Left drawing mode` |
| | map cell focused or changed | `Cell 1, 2, tile 5`, adding `, flip H` and `, flip V` when set |
| | undo or redo applied | `Undone`, `Redone` |
| | pixel perfect toggled | `Pixel perfect on`, `Pixel perfect off` |
| | selection lifted or moved | `Selection 4 by 3 at 2, 5` |
| | floating selection committed or cancelled | `Selection placed at 3, 5`, `Selection cancelled` |
| | stamp copied or placed | `Stamp 3 by 2`, `Stamped 3 by 2 at 4, 1` |
| `status "List announcements"` | pick-up | `Lifted <item>, position 2 of 7`; `Moved <item>, position 3 of 7`; `Dropped <item>, position 3 of 7`; `Cancelled, <item> back at position 2 of 7` |
| `status "Team announcements"` (keeps its last 20 lines, on every member's page) | presence | `<name> joined`, `<name> left` |
| | strokes | `<name> painted <n> pixels`: a person's first stroke shows at once, and strokes within the next 2000 ms of browser time are summed into one line for that person when the window ends |
| `status "Sync status"` | connected | `Synced` |
| | offline | `Offline · <n> strokes queued` |
| | back online | `Reconnected · <n> updates applied`, where n is missed events plus accepted strokes; a refusal adds a line below it, `1 stroke refused: <refusal message>`, with the true count and the first refused stroke's message |
| `status "Job progress"` | running, starting at 0 | `Processing 40 of 120` |
| | cancelled | `Cancelled at 40 of 120: nothing stored` |
| | confirmed | `Stored: <file names joined by comma and space>` |
| | failed after starting | `Export failed: nothing stored` |
| `status "Draft status"` | autosave | `Saving…` then `Saved` |
| | stale save | `A newer version exists`, with `button "Load newer"` |
| `status "Notices"` | swatch save pending | `Saving swatch…` |
| | swatch removed | `Swatch <index> removed` |
| | palette import | `Importing palette…`, then `Added <n> swatches` |
| | image import | `Importing…`, then `Imported <file name>` |
| | comment | `Posting…`, then `Comment posted` |
| | snapshot | `Saving snapshot…`, then `Snapshot <name> saved` |
| | restore, on everyone's page | `Restoring…` for the person acting, then `Restored <name>` |
| | invite | `Sending invite…`, then `Invite created for <email>` |
| | link | `Creating link…`, then `Link created`, `Link revoked` or `Link regenerated` |
| | sign-up | `We are sending your code to <email>` |
| | invite accepted | `You joined <project>` |
| | merge | `Merged into <layer>, 2 new swatches`, on everyone's page |
| | settings | `Settings saved` |
| | preview finished | `Finished after 3 passes` |
| `alert` | stale swatch | `<name> changed this swatch first`, with the current colour shown in the swatch row; `<name>` is that swatch's `edited_by` |
| | storage unreachable | `Storage is unavailable. Your artwork is safe.` |
| | offline action other than a stroke | `You are offline` |
| | role lowered | `Your role is now <role>` |
| | removed from project | `You no longer have access to <project>`, on `/projects` |
| Mention line in a comment | waiting | `Sending to <name>` |
| | mail server accepted | `Delivered to <name>` |

A reviewer's workspace shows the reviewer stroke refusal from Business rules as a visible line directly above the stage, and also when a reviewer presses Space or clicks the stage to draw. Empty panels show one line, for example `No frames yet`, `No comments yet`, `No snapshots yet`. Command palette with no result: `No matching commands`. Swatch rows show `Used by <n> pixels`, tiles show `Used <n> times`, a locked layer shows `Locked by <name>` to everyone, and a linked cel's frame row shows `Linked`.

## Backend

### API (DP-26, DP-35, DP-53, DP-80, DP-98, DP-99, DP-02, DP-15, DP-20, DP-27, DP-28, DP-37, DP-40, DP-48, DP-55, DP-64, DP-67, DP-68, DP-69, DP-70, DP-73, DP-89, DP-90, DP-92, DP-94)

Bodies are JSON unless stated; instants are ISO 8601 UTC with milliseconds and `Z`. Sign-in is a session cookie. `<id>` values are integers.

**Error order for the whole API.** 401 `{"error":"unauthenticated"}`, then 404 `{"error":"not_found"}` for anything the person cannot open (never 403 for a hidden record), then 403 `{"error":"forbidden","message":"<text>"}` for a role lacking a right on a record it can open, then 409 for conflicts, then 422 `{"errors":{"<field>":"<text>"}}`. An idempotent replay returns its stored response before any state check. Endpoint rows list only their own extra errors.

**Platform and grading**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/health` | | 200 `{"status":"ok"}`, or 200 `{"status":"unavailable"}` while object storage or Postgres is unreachable; never 503 | |
| `GET /api/config` (no sign-in) | | 200 `{"now":"<instant>","palette_max":n,"sprite_max":n,"frame_min_ms":n,"frame_max_ms":n,"invite_ttl_seconds":n,"long_press_ms":n,"presence_visible":n,"idle_seconds":n,"undo_depth":n,"activity_page":n,"autosave_ms":n,"job_item_ms":n,"import_max_bytes":n}` | |
| `POST /api/grading/seed` | shape below | 201 `{"ids":{"<key>":<id>}}` | 404 `{"error":"not_found"}` unless header `X-Grading-Key` equals `GRADING_KEY`; 422 for an unknown reference or a broken limit, with nothing created |
| `POST /api/grading/clock` | `{"advance_seconds":n}` with n from 0, or `{"set":"<instant>"}` not earlier than now | 200 `{"now":"<instant>"}` | same 404; 422 otherwise |

Seed body; every array is optional, keys are unique in the call, and references use keys from the same call:

```json
{
 "users":[{"key":"ada","email":"ada@team.example","name":"Ada","password":"pw-ada-12","confirmed":true,"number_format":"en-US","time_zone":"UTC"}],
 "projects":[{"key":"p","name":"Quest","owner":"ada"}],
 "memberships":[{"key":"m","project":"p","user":"ada2","role":"editor"}],
 "palettes":[{"key":"pal","swatches":[{"index":1,"color":"ff0044ff"}]}],
 "sprites":[{"key":"s","project":"p","palette":"pal","name":"Hero","width":16,"height":16}],
 "layers":[{"key":"l","sprite":"s","name":"Body","opacity":100,"blend":"normal","visible":true,"locked_by":null}],
 "frames":[{"key":"f1","sprite":"s","duration_ms":100}],
 "cels":[{"key":"c1","frame":"f1","layer":"l","rows":[[1,0],[0,1]]},{"key":"c2","frame":"f2","layer":"l","link_to":"f1"}],
 "tags":[{"key":"t","sprite":"s","name":"walk","from":2,"to":5,"direction":"pingpong","repeat":0}],
 "tilesets":[{"key":"ts","sprite":"s","name":"Ground","tile_size":8,"tiles":[{"key":"t1","rows":[[1,1],[1,1]]}],"edge_table":[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]}],
 "tilemaps":[{"key":"tm","sprite":"s","tileset":"ts","name":"Map","width":8,"height":8,"cells":[{"x":1,"y":1,"tile":1,"flip_h":false,"flip_v":false}]}],
 "comments":[{"key":"k","sprite":"s","author":"ada","frame":1,"x":3,"y":4,"text":"Check this","state":"open"}],
 "snapshots":[{"key":"n","sprite":"s","name":"Base"}],
 "share_links":[{"key":"sl","sprite":"s","label":"Client","token":"tok-1","expires_at":"2027-03-09T16:00:00.000Z"}],
 "invites":[{"key":"i","project":"p","email":"new@team.example","role":"editor","token":"inv-1","expires_at":"2027-03-08T17:00:00.000Z"}]
}
```

These rules govern the seed body. A palette serves exactly one sprite. Layers are listed bottom first and frames in order. Absent cels are fully transparent. `rows` must be the full cel size (or tile size for tiles; the sample rows above show the shape only). `locked_by`, `owner`, `user` and `author` are user keys, and `link_to` is a frame key. A snapshot captures the state after every cel, tag, tile and map in the call. Seeding sends no mail and writes no activity, and each sprite starts at sequence 0 with empty undo stacks. Each seeded person may sign in with `POST /api/auth/login`.

**Accounts**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/auth/signup` | `{"email","password","name"}` | 201 `{"status":"pending"}` | 422 `email`: `Already registered`; 422 `password`: `Use at least 8 characters` |
| `POST /api/auth/confirm` | `{"email","code"}` | 200 `{"id","email","name"}`, session set | 422 `code`: `That code is not right` |
| `POST /api/auth/login` | `{"email","password"}` | 200 `{"id","email","name"}`, session set | 422 `password`: `Email or password is incorrect`; 422 `email`: `Confirm your email first` |
| `POST /api/auth/logout` | | 204 | |
| `GET /api/me` | | 200 `{"id","email","name","number_format","time_zone"}` | |
| `PATCH /api/me` | any of `{"number_format","time_zone"}` | 200 the same object | 422 per field |

**Projects, members, invites**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/projects` | | 200 `{"projects":[{"id","name","role"}]}` | |
| `POST /api/projects` | `{"name"}` | 201 `{"id","name","role":"owner"}` | 422 `name` |
| `GET /api/projects/<id>` | | 200 `{"id","name","role","members":[{"id","name","email","role"}],"sprites":[{"id","name"}]}` | |
| `PATCH /api/projects/<id>/members/<user id>` | `{"role":"editor|reviewer"}` | 200 `{"id","role"}` | 409 `{"error":"owner_required"}` on the owner |
| `DELETE /api/projects/<id>/members/<user id>` | | 204 | same 409 |
| `GET /api/projects/<id>/invites` | | 200 `{"invites":[{"id","email","role","state","expires_at"}]}` | |
| `POST /api/projects/<id>/invites` | `{"email","role":"editor|reviewer"}` | 201 `{"id","state":"pending","expires_at"}` | 409 `{"error":"already_member"}`; 409 `{"error":"invite_pending"}` |
| `DELETE /api/invites/<id>` | | 200 `{"state":"revoked"}` | 409 per Business rules |
| `GET /api/invites/<token>` | signed in or not | 200 `{"project","role","state","expires_at"}` | |
| `POST /api/invites/<token>/accept` | | 200 `{"project":id,"role"}` | 403 message `This invite is for another email`; 409 per Business rules |
| `GET /api/projects/<id>/activity?cursor=<c>` | | 200 `{"items":[{"id","sentence","at"}],"next_cursor":c|null}` | |

**Sprites, layers, frames, tags**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/projects/<id>/sprites` | `{"name","width","height"}` | 201 `{"id","palette":id,"seq":0}`, with an empty palette, one frame and one layer named `Layer 1` | 422 `width` or `height`: `Largest size is <limit>` |
| `GET /api/sprites/<id>` | | 200 `{"id","name","width","height","seq","palette":id,"layers":[{"id","name","opacity","blend","visible","locked_by","position"}],"frames":[{"number","duration_ms","linked_layers":[]}],"tags":[{"id","name","from","to","direction","repeat"}],"tilesets":[id],"tilemaps":[id]}` | |
| `GET /api/sprites/<id>/frames/<n>/pixels?layer=<name>` | | 200 `{"width":w,"height":h,"seq":s,"rows":[["rrggbbaa",...],...]}`; composite without `layer`, otherwise that layer's plain swatch colours | |
| `GET /api/sprites/<id>/frames/<n>/indices?layer=<name>` | `layer` required | 200 `{"width":w,"height":h,"seq":s,"rows":[[index,...],...],"linked_frames":[n,...]}` | |
| `POST /api/sprites/<id>/layers` | `{"name"}` optional | 201 `{"id","name","seq"}`, placed on top, default name `Layer <n>` | 422 `name`: `That name is taken` |
| `PATCH /api/sprites/<id>/layers/<layer id>` | any of `{"opacity","blend","visible","position"}`, position 1 being top | 200 `{"seq"}` | 422 per field |
| `POST /api/sprites/<id>/layers/<layer id>/lock` | | 200 `{"locked_by":"<name>","seq"}` | 409 `layer_locked` |
| `DELETE /api/sprites/<id>/layers/<layer id>/lock` | holder or owner | 200 `{"seq"}` | 403 message `Only the holder or the owner can unlock` |
| `POST /api/sprites/<id>/layers/<layer id>/merge-down` | | 200 `{"seq","new_swatches":n}` | 409 `layer_locked`; 409 `palette_full`; 422 `layer`: `No layer below` |
| `POST /api/sprites/<id>/frames` | `{"position","duration_ms"}`, position optional, default last | 201 `{"number","seq"}` | 422 `duration_ms`: `Use <min> to <max> ms` |
| `PATCH /api/sprites/<id>/frames/<n>` | `{"duration_ms"}` and or `{"position"}` | 200 `{"seq"}` | same 422 |
| `POST /api/sprites/<id>/frames/<n>/cels/link` | `{"layer","to_frame"}` | 200 `{"seq"}` | 422 `to_frame` |
| `POST /api/sprites/<id>/frames/<n>/cels/unlink` | `{"layer"}` | 200 `{"seq"}` | 409 `{"error":"not_linked"}` |
| `POST /api/sprites/<id>/tags` | `{"name","from","to","direction":"forward|reverse|pingpong","repeat":n}`, repeat from 0 to 99, default 0 | 201 `{"id","seq"}` | 422 per field |
| `DELETE /api/sprites/<id>/tags/<tag id>` | | 200 `{"seq"}` | |

Frames have no delete, and a layer goes away only by merging down. `frame` in any request means the position at the moment the server applies it.

**Drawing**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/sprites/<id>/strokes` | `{"client_stroke_id","frame","layer","tool","points":[[x,y],...],"swatch","size","mirror":"none|x|y|both","options":{}}` | 201 `{"seq":n,"pixels_changed":c}` | 409 `layer_locked`; 422 `swatch`: `Swatch <index> was removed`; 422 `frame`, `layer`, `size`, `tool` or `points` |
| `POST /api/sprites/<id>/selection` | `{"client_stroke_id","frame","layer","op":"move|paste|flip_h|flip_v|rotate","rect":{"x","y","w","h"},"to":{"x","y"},"rows":[[index]]}`; `rows` and `to` for paste, `to` for move, whose coordinates may be negative | 201 `{"seq":n,"pixels_changed":c}` | as strokes |
| `POST /api/sprites/<id>/undo`, `/redo` | | 200 `{"seq":n,"pixels_changed":c}` | 409 per Business rules |
| `GET /api/sprites/<id>/events?since=<seq>` | default 0 | 200 `{"events":[{"seq":n,"type":"<type>","by":"<name>","at":"<instant>","data":{}}]}`, ascending | |

`tool` is `pencil`, `eraser`, `line`, `rectangle`, `ellipse`, `fill` or `dither`. `options` may hold `filled`, `contiguous` (default true), `secondary`, `level` and `pixel_perfect`. `points` is the sample list for pencil and eraser, two corners for line, rectangle and ellipse, and one cell for fill and dither. `type` is one of stroke, selection, undo, redo, swatch, palette, layer, frame, cel, tag, tile, tilemap, comment, snapshot, restore. The browser's live channel is private and may be a WebSocket or server-sent events inside the app server.

**Palette**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/palettes/<id>` | | 200 `{"id","order":[index],"swatches":[{"index","color","version","used_by","frames","edited_by"}]}` | |
| `POST /api/palettes/<id>/swatches` | `{"color"}` | 201 `{"index","color","version","seq"}` | 422 `color`: `Palette limit is <limit> swatches` |
| `PATCH /api/palettes/<id>/swatches/<index>` | `{"color","version"}` | 200 `{"index","color","version","used_by","frames","seq"}` | 409 stale or removed, per Business rules; 422 `index`, 422 `color`: `Use eight lowercase hex digits` |
| `DELETE /api/palettes/<id>/swatches/<index>` | | 200 `{"seq"}` | 409 `swatch_in_use`; 422 `index` |
| `PATCH /api/palettes/<id>/order` | `{"order":[index,...]}` | 200 `{"seq"}` | 422 `order` |
| `POST /api/palettes/<id>/ramp` | `{"from":a,"to":b,"steps":n}`, n from 3 to 32 | 201 `{"swatches":[{"index","color","version"}],"seq"}` | 422 as swatches |
| `POST /api/palettes/<id>/import` | `{"file_name","text"}` | 201 `{"added":n,"seq"}` | 422 `file` with the line text, or `Use a .hex or .gpl file`; 422 limit as swatches |

**Tiles**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/sprites/<id>/tilesets` | `{"name","tile_size":8|16}` | 201 `{"id","seq"}` | 422 `tile_size` |
| `GET /api/tilesets/<id>` | | 200 `{"id","name","tile_size","edge_table":[16 numbers],"tiles":[{"id","rows","uses"}]}` | |
| `POST /api/tilesets/<id>/import` | `{"frame","layer","tilemap":id,"x":0,"y":0}`, tilemap and offsets optional | 201 `{"tiles_added":k,"cells":[{"x","y","tile","flip_h","flip_v"}],"seq"}` | 422 per field |
| `PATCH /api/tilesets/<id>/tiles/<n>` | `{"rows":[[index]]}` | 200 `{"uses","seq"}` | 422 `rows` |
| `PATCH /api/tilesets/<id>/edges` | `{"table":[16 numbers]}` | 200 `{"seq"}` | 422 `table`: `Use 16 existing tile numbers` |
| `POST /api/sprites/<id>/tilemaps` | `{"name","tileset","width","height"}` | 201 `{"id","seq"}` | 422 per field |
| `GET /api/tilemaps/<id>` | | 200 `{"id","name","tileset","width","height","cells":[{"x","y","tile","flip_h","flip_v"}],"seq"}`, listing filled cells | |
| `POST /api/tilemaps/<id>/cells` | `{"x","y","tile","flip_h","flip_v","edge_matching":bool}`, tile 0 erases | 201 `{"seq","changed":[{"x","y","tile","flip_h","flip_v","mask"}]}`, ordered by y then x; `mask` null with edge matching off | 422 `tile`: `Edge table points at a missing tile` |
| `PATCH /api/tilemaps/<id>/cells/<x>/<y>` | `{"flip_h","flip_v"}` | 200 `{"seq"}` | 422 on an empty cell |
| `POST /api/tilemaps/<id>/stamp` | `{"x","y","cells":[[{"tile","flip_h","flip_v"}]]}`, rows of cells | 201 `{"seq","changed":[{"x","y","tile","flip_h","flip_v"}]}`, ordered by y then x | 422 per field |

**Imports and exports**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/projects/<id>/imports` | multipart field `file` | 201 `{"import":id,"sprite":id,"file_name","colours":n}` | 422 `file`, per Business rules; 503 |
| `GET /api/imports/<id>/original` | | 200 the original bytes as an attachment | 503 |
| `POST /api/sprites/<id>/exports` | `{"format":"png|gif|sheet","scale":1..16,"frame":n,"padding":p,"extrude":e,"label"}`; frame for PNG only, padding and extrude for sheet only, padding 0 to 64, extrude 0 to 16 | 202 `{"job":id}` | 422 per field; 503 |
| `POST /api/projects/<id>/exports` | `{"scale","padding","extrude","label"}` | 202 `{"job":id}` | same |
| `GET /api/projects/<id>/exports` | | 200 `{"exports":[{"id","job","label","state","seq","files":[{"name","size","sha256"}]}]}`, listing only exports in `stored` state | |
| `GET /api/jobs/<id>` | | 200 `{"id","state","done","total","files":[]}` | |
| `GET /api/jobs/<id>/events` | | server-sent events, each `{"state","done","total","files":[]}`, the latest at once on connecting, closing after an end state | |
| `POST /api/jobs/<id>/cancel` | | 200 `{"state":"cancelled","done","total"}` | 409 `{"error":"job_finished","state":"<state>"}` |
| `GET /api/exports/<id>/files/<name>` | | 200 the file | 503 |

The 503 body is `{"error":"storage_unavailable"}`.

**Comments, snapshots, drafts**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/sprites/<id>/comments` | | 200 `{"comments":[{"id","frame","x","y","text","state","author","mentions":[{"name","state":"pending|delivered"}]}]}` | |
| `POST /api/sprites/<id>/comments` | header `Idempotency-Key` optional; `{"frame","x","y","text"}` | 201 the comment object plus `"seq"` | 409 `{"error":"idempotency_conflict"}` when one key meets a different body; 422 `text`: `Write a comment first`, `Use at most 2,000 characters`; 422 `frame`, `x`, `y` |
| `POST /api/comments/<id>/resolve`, `/reopen` | | 200 the comment object | 409 per Business rules |
| `GET /api/sprites/<id>/snapshots` | | 200 `{"snapshots":[{"id","name","seq","at"}]}`, newest first | |
| `POST /api/sprites/<id>/snapshots` | `{"name"}` | 201 `{"id","name","seq","at"}` | 422 `name`: `That name is taken` |
| `GET /api/sprites/<id>/snapshots/compare?from=&to=` | snapshot ids | 200 `{"frames":[{"frame":3,"changed":12,"cells":[{"x","y","before","after"}]}]}`; unchanged frames absent; cells ordered by y then x, on the composite; a frame in only one snapshot compares with transparent | |
| `POST /api/snapshots/<id>/restore` | | 200 `{"seq","before_snapshot":id}` | |
| `GET /api/drafts/<key>` | | 200 `{"text","version"}`, `""` and 0 when none | |
| `PUT /api/drafts/<key>` | `{"text","version"}` | 200 `{"text","version"}` | 409 `{"error":"draft_newer","current":{"text","version"}}` |

Draft keys are `comment:<sprite id>` and `tag:<sprite id>`, private to each person. The `version` sent must equal the current one, and a success adds 1. A posted comment or added tag empties its draft.

**Read-only links**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/projects/<id>/links` | | 200 `{"links":[{"id","sprite","label","token","url","state","expires_at"}]}` | |
| `POST /api/sprites/<id>/links` | `{"label","expires_at"}` | 201 `{"id","token","url","label","state":"active","expires_at"}` | 422 `expires_at`: `Choose a time after now` |
| `DELETE /api/links/<id>` | | 200 `{"state":"revoked"}` | 409 `{"error":"link_ended"}` |
| `POST /api/links/<id>/regenerate` | | 200 `{"id","token","url","state":"active","expires_at"}` | 409 `{"error":"link_ended"}` |
| `GET /api/share/<token>` (no sign-in) | | 200 `{"sprite":{"name","width","height","seq","frames":[{"number","duration_ms"}],"tags":[{"name","from","to","direction","repeat"}]},"state":"active"}` | |
| `GET /api/share/<token>/frames/<n>/pixels` | | 200 same body as the pixel route, composite only | |
| Any other method on `/api/share/<token>` paths | | never succeeds | 403 message `This link is read only` |

An ended, revoked, replaced or unknown token answers 404 `{"error":"not_found"}`, on the API and through `/s/<token>`, whose page also shows the ended heading. `/api/share/<token>/events` and the rest of the private channel carry only stage, frame and tag changes for that sprite. No other route accepts a token.

### Business rules (DP-26, DP-35, DP-53, DP-80, DP-98, DP-99, DP-07 to DP-13, DP-16, DP-19 to DP-23, DP-25, DP-27, DP-28, DP-31, DP-36 to DP-39, DP-42 to DP-45, DP-47 to DP-51, DP-55, DP-57 to DP-76, DP-89, DP-95, DP-97)

**Colour text.** Everywhere (pixel route, announcements, snapshot compares) a colour is eight lowercase hex digits `rrggbbaa` with no prefix, for example `ff0044ff`; transparent is `00000000`.

**Business clock.** One server clock is kept in Postgres. It starts at `CELMATE_START_AT` on a database with no stored clock, or at real time if that is unset; it runs in real time and is moved only by the clock route. Every server-side time rule and every stored or shown time reads it, and open pages re-render relative times, idle marks and expiries within 2 seconds of a move. Shown dates and emailed dates follow the Number and date settings of the person reading them. Something expiring at an instant has ended once the clock is at or past that instant.

**Number and date settings.** Each person has a number format and a time zone, by default `en-US` and `UTC`, which apply to everything shown to them in the browser and sent to them by email, and to the `message` and the 422 `errors` text of a response to them. A request with no signed-in person uses `en-US`. Every number in that text is grouped, including `<limit>`, `<w>`, `<h>`, `<min>`, `<max>` and the colour count. For example, with an import limit of 200000, `en-US` reads `File is larger than 200,000 bytes` and `en-IN` reads `File is larger than 2,00,000 bytes`. With the grading limits and `en-US`, the other errors read `Use 20 to 5,000 ms` and `Image is 1,000 by 1,000, limit 64`. `en-US` groups in threes and `en-IN` groups the last three digits, then in twos: 123456.5 is `123,456.5` and `1,23,456.5`; 1000 is `1,000` in both. Dates: `en-US` is `Mar 8, 2027 16:00 UTC` and `en-IN` is `8 Mar 2027 21:30 IST`, a 24-hour time in the person's zone with its abbreviation: `UTC`, `IST`, or `EST` or `EDT` by the date in force for `America/New_York`. Exact JSON values such as `used_by`, `at` and `expires_at` stay plain numbers and UTC instants. Copy showing a colour, sprite coordinate or file line number is not grouped. The line `Total <ms> ms · Average <ms> ms` in the Frames panel sums the frames' durations, and shows their mean rounded half up to one decimal, dropped when it ends in .0; `data-total-ms` holds the plain total, and it updates live. Worked with durations 100 and 101 and `en-US`: `Total 201 ms · Average 100.5 ms`; with 120 frames of 2000 ms and `en-IN`: `Total 2,40,000 ms · Average 2,000 ms`.

**Roles.**
- Owners do everything.
- Editors draw, edit palettes, frames, tags and tiles, import, and export.
- Reviewers read, comment, resolve, compare and download stored exports.
- Link viewers read one sprite.

403 messages:
- A reviewer's strokes, selection operations, undo and redo: `Reviewers can't draw`.
- A reviewer's other artwork changes (palette, layers, frames, tags, tiles, imports): `Reviewers can't change artwork`.
- A reviewer's exports: `Reviewers can't export`.
- Member, invite, link, snapshot-save and restore actions by anyone but the owner: `Only the project owner can do this`.

The interface offers each role no controls it lacks. A role reduction or removal applies on the next request and changes open sessions within 2 seconds, so a removed person's next request answers 404, a lowered person's stroke answers 403, and their tools vanish. A strokes request from a person reduced while it was in flight is judged at the moment the server applies it.

**Order.** The server gives every sprite operation, comment, snapshot and restore one sequence number per sprite, rising by exactly 1 with no gaps, and applies operations in that order. For any pixel the highest sequence wins, so all clients converge on one hash. Cursors, presence and drafts carry no sequence number. A stroke is one atomic operation. Replaying a `client_stroke_id` from the same person on the same sprite returns the stored 201 and changes nothing. A refused stroke stores nothing, so its resend is judged again. `pixels_changed` counts cells whose index actually changed.

**Lines.** From (x0,y0) to (x1,y1): dx=|x1-x0|, dy=-|y1-y0|, err=dx+dy; plot; stop at the end; e2=2*err; if e2>=dy add dy to err and step x; if e2<=dx add dx to err and step y. Worked: (0,0) to (5,2) gives (0,0),(1,0),(2,1),(3,1),(4,2),(5,2); (0,0) to (4,2) gives (0,0),(1,1),(2,1),(3,2),(4,2); (1,1) to (3,6) gives (1,1),(1,2),(2,3),(2,4),(3,5),(3,6). Pointer samples are joined in order by the same rule.

**Brush.** Size s from 1 to 8 stamps an s by s square at offsets -floor((s-1)/2) to floor(s/2): size 2 covers offsets 0,1; size 3 covers -1,0,1; size 4 covers -1,0,1,2. Cells outside the sprite are dropped. Size applies to pencil, eraser and line; rectangle and ellipse draw at size 1.

**Rectangle.** Corners are inclusive and may arrive in any order. Outline is the border cells; filled is every cell.

**Ellipse.** Box (x0,y0)-(x1,y1), W=x1-x0+1, H=y1-y0+1, u=2x+1-(x0+x1+1), v=2y+1-(y0+y1+1); a cell is inside when u²H²+v²W²<=W²H². Filled is every inside cell; outline is inside cells with a 4-neighbour outside. Worked: box (0,0)-(4,4) outline rows `.###.`, `#...#`, `#...#`, `#...#`, `.###.`; box (0,0)-(5,3) outline rows `.####.`, `#....#`, `#....#`, `.####.`.

**Fill.** 4-connected on exact swatch index, on the active layer. With contiguous off, every cell of that index on the cel changes.

**Mirror.** Axis x reflects x to W-1-x and axis y reflects y to H-1-y, for every painted cell. On width 8, column 3 mirrors to 4; on width 7, column 3 is its own mirror and is painted once. Both axes paint all four. For fill and dither, each reflected seed cell is also applied, with regions read from the cel before the stroke.

**Dither.** Matrix rows `0 8 2 10`, `12 4 14 6`, `3 11 1 9`, `15 7 13 5`, read at [y mod 4][x mod 4] in sprite coordinates. Level L runs from 1 to 16. Dither is a fill over the same region as Fill: a cell takes the primary swatch when its matrix value is below L, else the secondary. Worked with L=6: (7,7) matrix 5 is primary, (5,2) matrix 11 is secondary, (4,4) matrix 0 is primary.

**Selection.** Each operation is one atomic, undoable operation. Move clears its rectangle to index 0, then places the non-transparent cells at the new top-left. Paste places non-transparent cells only; pasted transparent cells do not overwrite. Flips mirror the rectangle in place. Rotate 90 degrees clockwise about the selection's top-left corner makes a W by H selection H by W, with (x,y) going to (top-left x + H-1-(y-top), top-left y + (x-left)); the old rectangle clears first. Cells outside the sprite are dropped.

**Eraser.** Writes swatch index 0.

**Pixel perfect.** The checkbox applies to pencil and eraser at size 1 and is ignored otherwise; it is sent as `pixel_perfect`. The server joins the samples by the line rule, collapses repeated cells, then walks the path keeping a list: for each new cell c appended after kept cells q and p, when q and c differ by exactly 1 in both x and y, and p shares a row or column with each of them, p is removed. Mirror reflects the kept cells. The browser shows the same cells on release. Worked: (0,0),(1,0),(1,1),(2,1),(2,2) keeps (0,0),(1,1),(2,2); (0,0),(1,0),(2,0),(2,1) keeps (0,0),(1,0),(2,1); (0,0),(1,0),(2,0) keeps all three.

**Merge down.** Merges a layer into the layer directly below it as one sequenced operation, on every frame. Each result cell composites only those two layers from transparent by the compositing formulas, using their current opacity, blend and swatch colours, ignoring visibility. A result with alpha 0 becomes index 0. Any other result colour uses the lowest-numbered swatch with exactly that colour, or else takes a new swatch at the lowest free index, allocating by frames ascending, then rows top to bottom, then cells left to right. The lower layer keeps its name and position, gets opacity 100 and normal blend, and each of its cels becomes independent; the upper layer is gone. If either layer is locked by someone else: `layer_locked`. If the new swatches do not fit, nothing changes and it answers `409 {"error":"palette_full","message":"Needs 5 new swatches, 2 free"}` with the true counts. It clears all undo and redo stacks for the sprite. Worked, one cell, on a palette holding `204080ff` and `ff8040ff`: lower `204080ff` at 100, upper `ff8040ff` at 50 multiply gives a new swatch `203050ff`; a second merge result of `204080ff` reuses the existing swatch.

**Compositing.** rh(n,d)=floor((2n+d)/(2d)), rounding half up. Bottom layer first; hidden layers excluded. For each layer with swatch colour (sr,sg,sb,sa), opacity o from 0 to 100, under current (dr,dg,db,da):
- a=rh(sa*o,100); skip the layer if a is 0.
- Multiply when da>0: each channel c=rh(s*(255-da)+rh(s*d,255)*da,255). Otherwise normal: c=s.
- Result alpha ra=a+rh(da*(255-a),255); each channel r=rh(c*a*255+d*da*(255-a),ra*255).

Worked over base `204080ff`: `ff8040ff` at 50 normal gives `906060ff`; at 100 multiply gives `202020ff`; at 50 multiply gives `203050ff`. Over base `20408080`, `ff8040ff` at 40 multiply gives `5f4952b3`. `ff0044ff` at 33 alone gives `ff004454`.

**Palette.** Each pixel stores a swatch index. Index 0 is transparent and cannot be changed or removed (422 `index`: `Index 0 is transparent`). Swatches have a stable index, a colour and a `version` starting at 1 and adding 1 per change; a swatch returning to a freed index continues above its last version. New swatches take the lowest free index, up to `CELMATE_PALETTE_MAX`, excluding index 0, the limit itself allowed. Changing a swatch is one operation and changes no cel index. A stale version answers exactly `409 {"error":"version_conflict","current":{"index":i,"color":"rrggbbaa","version":v}}`. An edit of a removed swatch answers `409 {"error":"swatch_removed","message":"<name> removed this swatch first"}`. Palette versions never merge, and the person's edit is dropped until they retry from the current state. Removing a used swatch answers `409 {"error":"swatch_in_use","message":"Used by 12 pixels"}` with the true count.

**Counts.** A swatch's pixel count covers cel cells across all frames and layers, with a linked cel counted once, plus tile cells, each tile counted once however often it is used. Its `frames` figure is the number of frames showing a cell of that index, counting each linked frame. Index 0 has no count. For example, a linked cel holding 12 pixels of a swatch across 2 frames gives `used_by` 12 and `frames` 2. Swatch and tile counts match the artwork after every stroke, undo, redo, restore and tile edit.

**Ramp.** Step i of n between swatches a and b has each channel rh(a*(n-1-i)+b*i, n-1), including alpha. The two ends are the existing swatches, and the n-2 steps between become new swatches. The interface passes the primary swatch as `from` and the secondary as `to`. An end of index 0 answers 422 `from` or `to`: `Index 0 is transparent`. Worked: `000000ff` to `ff8001ff` in 5 steps gives `000000ff`, `402000ff`, `804001ff`, `bf6001ff`, `ff8001ff`.

**Palette files.** `.hex` is one six-digit colour per line, alpha `ff`; blank lines are skipped but counted. `.gpl` has the GIMP header line `GIMP Palette`, optional `Name:` and `Columns:` lines and comment lines starting with a number sign, then `R G B name` rows. Errors are exact; the first bad line wins and nothing is applied: `Line 3: expected six hex digits` and `Line 5: expected three numbers from 0 to 255`.

**Image import.** Limits judge decoded content, never the file name or stated type, with `file` errors in this order: `Not a PNG or GIF image`; `File is larger than <limit> bytes` (the limit itself allowed); `Image is <w> by <h>, limit <limit>`; `Needs 40 colours, limit 16`, with the true count and limit, counting distinct colours other than fully transparent. On success, fully transparent pixels become index 0 and other colours take swatches from index 1 in first-appearance order. A PNG makes one frame of 100 ms, clamped to the frame limits. A GIF makes one frame per composed image, with its delay converted to ms and clamped. Each makes one layer, `Layer 1`, and the sprite is named after the file. The original is stored byte for byte. If the store fails, neither sprite nor object remains.

**Frames.** Duration in ms within the configured limits, both inclusive, else 422. A linked cel is one buffer shared by several frames, and an edit shows in every linked frame. `Link cel` replaces the current frame's active-layer cel with a link to the previous frame's cel. `Unlink cel` makes an independent copy for the current frame.

**Tags and sequences.** A tag names a frame range and direction. Worked for frames 2 to 5: forward 2,3,4,5; reverse 5,4,3,2; pingpong 2,3,4,5,4,3 then repeating (end frames never repeat); frames 2 to 3 pingpong is 2,3; a single frame is that frame. With no tag, the preview plays all frames forward.

**Repeats and speed.** A pass is one run of the sequence, and `data-preview-pass` counts passes from 1. Repeat 0 plays forever. Repeat n stops after n passes: forward ends on `to`, reverse ends on `from`, and pingpong shows `from` once more, so frames 2 to 5, pingpong, repeat 1 shows 2,3,4,5,4,3,2 and stops. On stopping, the preview mode is `step` and the Notices text is shown; choosing the tag again or `Play preview` starts over. Speed changes how long each frame shows: Half shows a frame for 2 times its ms, Normal for its ms, and Double for rh(ms,2), so 105 ms at Double shows 53 ms. Under reduced motion, repeat and speed do not apply and the step buttons walk one pass, wrapping. Repeat does not appear in the export JSON.

**Tilesets.** A tileset has tile size 8 or 16 and tiles numbered from 1 (0 is empty). Tile cells are swatch indices. A tilemap cell stores tile number and horizontal and vertical flip flags. Importing a frame cuts the given layer's indices left to right, top to bottom, dropping incomplete blocks at the right and bottom edges. An all-transparent block is empty. Other blocks identical by exact cells to an existing tile, tested in the order identity, horizontal flip, vertical flip, both, reuse it with those flags, and this includes tiles made earlier in the same import. Editing a tile changes all uses live. A tile's `uses` counts cells across all tilemaps of that tileset, flipped or not. A stamp writes its cells as given.

**Edge matching.** Mask N=1, E=2, S=4, W=8 for filled neighbours; cells beyond the map are not filled. The tile is table[mask] from the tileset's 16-entry table, whose default is mask + 1 and whose entries are from 1. Placing or erasing updates that cell and its four neighbours as one operation; each filled cell among them takes table[mask] with its flips cleared, and an erased cell stays empty. Worked: place (1,1): mask 0; place (2,1): (1,1) mask 2, (2,1) mask 8; place (1,2): (1,1) mask 6, (1,2) mask 1; erase (2,1): (1,1) mask 4.

**Locks.** A locked layer's holder alone may draw on it. Strokes by others answer `409 {"error":"layer_locked","message":"Locked by <name>"}`, and that message shows in `alert` with the drawn pixels rolled back.

**Undo.** Undo and redo are per person per sprite, on the server, with depth `CELMATE_UNDO_DEPTH` (older actions fall off). Undoable actions are drawing strokes, selection operations, swatch edits, and map placing, erasing, flipping and stamping; a person has one stack per sprite across all of these. Undo reverses that person's last undoable action as a new sequenced operation. If any of its pixels, its swatch or its map cells was changed by someone else since: `409 {"error":"undo_conflict","message":"Can't undo: <name> changed this"}`, nothing changes, and `<name>` is the most recent such person. Redo gives the same shape with `Can't redo: <name> changed this`. An empty stack gives `409 {"error":"nothing_to_undo","message":"Nothing to undo"}` and `409 {"error":"nothing_to_redo","message":"Nothing to redo"}`. A new stroke clears that person's redo. Refusal messages show in `alert`.

**Command ranking.** Match is case-insensitive subsequence, taking each query character leftmost. Score = 100 - index of the first matched character - (span length - query length). Higher comes first; ties go by lowercased name. An empty query lists all, by lowercased name. Worked: query `pen` gives `Tool: Pencil` 94 above `Layer: Pen shadow` 93.

**Presence.** `list "On this sprite"` lists people in join order, oldest first, one entry per person however many tabs, showing `CELMATE_PRESENCE_VISIBLE` then `+<n>`. An entry has `data-idle="true"` after `CELMATE_IDLE_SECONDS` of business-clock time with no stroke or cursor activity, and is removed within 2 real seconds of that person's last tab closing.

**Reconnect.** The browser reporting itself offline counts as a dropped connection at once. On the browser reporting online, immediately with no timer, the client fetches missed events, replays queued strokes in order with their same `client_stroke_id`, then shows the counts from Feedback states. A refused stroke rolls back, and all clients converge.

**Comments.** Pins hold frame, x and y. Owners, editors and reviewers comment. A comment moves open to resolved, and resolved to reopened (shown as open). Resolving a resolved comment answers `409 {"error":"comment_state","message":"Already resolved"}`, and reopening an open one answers the same with `Already open`. Reposting with one `Idempotency-Key` from one person returns the stored 201 and makes one comment and one email. `@name` mentions match a project member's name case-insensitively, longest name first, and each named member gets one email per comment. A mention stays `pending` until the mail server accepts it, then becomes `delivered`, with retries; the comment itself never waits on mail.

**Snapshots.** A snapshot captures layers, cels, palette, frames, tags, tilesets and tilemaps at one sequence number; comments are not part of it. Names are unique per sprite, apart from automatic ones. Restore first makes a snapshot `Before restore <name>`, then appends one operation that replaces the current state live for everyone byte for byte, destroys no snapshot or history, clears all undo and redo stacks for the sprite, and releases layer locks. Compare lines read `12 pixels changed in frame 3`.

**Activity.** Newest first by each entry's first event. Sentences: `<name> painted <n> pixels on <sprite>, frame <f>`, `<name> edited swatch <i>`, `<name> restored <snapshot>`, `<name> commented on <sprite>`, `<name> invited <email>`, `<name> exported <file>` (the job's first file, once stored). Consecutive strokes by one person on one sprite within 60 seconds of a group's first event merge: `<name> painted <n> pixels in <k> strokes on <sprite>`. Page size is `CELMATE_ACTIVITY_PAGE` and the cursor is opaque; events arriving later never shift or repeat items on later pages. Relative times by the business clock: `just now` under 60 seconds, `<n> minutes ago`, `<n> hours ago`, `<n> days ago`, floored, with `1 minute ago` singular.

**Invites.** States are pending, accepted, revoked and lapsed. Single use; lifetime `CELMATE_INVITE_TTL_SECONDS` on the business clock, judged when accepted. Accepting a lapsed invite answers `409 {"error":"invite_lapsed","message":"This invite has lapsed"}` and records `lapsed`; an accepted one answers `409 {"error":"invite_used","message":"This invite was already used"}`; a revoked one answers `409 {"error":"invite_revoked","message":"This invite was revoked"}`. Revoking is legal only from pending; otherwise it answers `409 {"error":"invite_closed","message":"This invite is closed"}`. The invite page signs in or signs up, then returns to itself.

**Read-only links.** States are active and ended, by date or by revocation. The server clock alone ends a link, and an open viewer moves to the ended page within 2 seconds, on the server's push, whatever the device clock says; the browser never compares the clock itself. Regenerating gives a new token with the same label and end, and the old token dies at once. `null` for `expires_at` means no end date. In the interface, `spinbutton "Link hours"` takes a whole number of hours from 1 to 720, both limits allowed, and starts at 24. When `Create link` is pressed, the browser reads `now` from `GET /api/config`, adds the hours to that business-clock instant and sends the result as `expires_at`, never using the device clock. Emptying the field creates a link with no end date, sent as `null`. Any other value sends nothing and shows the field error `Use 1 to 720 hours`. Links are hidden from nobody with the URL, and they give no way to reach anything but the sprite's own stage and preview.

**Export jobs.** States are queued, rendering, stored, failed, cancelled, moving only forward; items are frames, summed across sprites for a project export. Each item takes at least `CELMATE_JOB_ITEM_MS` of real time. The job renders the state at the sequence number when it was queued. A job whose server dies is continued by any running server within 5 seconds and finishes correctly, and a job already in an end state never restarts. Exactly one of a cancel and a finish wins. Cancelled or failed jobs leave no object and no listed export.

**Export files.** Names use `<slug>`, the sprite name lowercased with each run of other characters than letters and digits turned to `-`: `<slug>-frame<n>-x<scale>.png`, `<slug>-x<scale>.gif`, `<slug>-sheet-x<scale>.png` and `<slug>-sheet-x<scale>.json`. Output is byte-identical for one sequence number and one set of settings; no timestamps go in the files.

A sprite export lists one file for PNG and GIF, and for a sheet the PNG then the JSON. A project export renders every sprite of the project in ascending sprite id as a sheet with the request's scale, padding and extrude, and lists for each sprite the sheet PNG then its JSON; its items are all frames of all sprites. When two or more sprites share a slug, each of them uses `<slug>-<sprite id>` in place of `<slug>`. A job's `files` is empty until the job is stored and then lists `{"name","size","sha256"}` for each file in that order, which is also the order of the Stored text.
- **PNG:** the frame's composite as 8-bit RGBA, enlarged by whole-number nearest-neighbour scale.
- **GIF:** delay in centiseconds = max(2, rh(ms,10)): 100 ms is 10, 105 is 11, 104 is 10, 14 is 2. Alpha below 128 becomes transparent, else opaque with its colour unchanged. Every frame is present in order, even when identical to its neighbour, and disposes to background; the GIF loops forever. A frame with more than 255 opaque colours fails the job.
- **Sheet:** columns = ceiling of the square root of the frame count, rows as needed, left to right then top to bottom. Cell = scaled frame + 2*extrude; gap = padding. Extrude repeats edge pixels outward. Worked: 5 frames of 16 by 16, padding 2, extrude 1: 3 columns, size 58 by 38, frame origins (1,1),(21,1),(41,1),(1,21),(21,21). 10 frames of 8 by 8, padding 1: 4 columns, size 35 by 26.
- **JSON:** `{"meta":{"sprite","scale","size":{"w","h"},"padding","extrude"},"frames":[{"index","x","y","w","h","duration_ms"}],"tags":[{"name","from","to","direction"}]}`. `index` counts from 1, and x and y are the origin of the frame itself.

### Services (DP-25, DP-26, DP-43, DP-46, DP-60, DP-68, DP-70, DP-75)

**Postgres.** Holds every sequenced operation, indexed cel buffer, palette, frame, tag, tileset, tilemap, comment, snapshot, membership, link, job, mail outbox entry and the business clock, so all artwork returns exactly after a reload or restart. Apply the schema idempotently each time the server starts.

**MinIO.** Imports go to `imports/<project id>/<import id>/<file name>` and exports to `exports/<project id>/<export id>/<name>`, where `<file name>` keeps letters, digits, dot, dash and underscore and turns anything else into `_`. An export or import counts as done only after the store reports the object's size and checksum and they match what was sent; otherwise the object is deleted and the job fails.

**Storage down.** Drawing and everything held in Postgres continues. An export or import, on its request after validation, and a download answer the 503 from API, and the UI shows the outage copy from Feedback states. No job row reaches stored. In grading this runs as a separate instance with its own empty database.

**Mailpit.** Send over SMTP from the address in `MAIL_FROM` through a Postgres outbox, so a slow or absent mail server never blocks the action and each message goes once, even across a restart. Every message below goes to the named person.

| When | To | Subject | Body lines |
|---|---|---|---|
| Sign-up | new person | `Your Celmate code: <code>` | the 6-digit code |
| Invite | invited email | `Join <project> on Celmate` | `Role: <role>`, `Expires: <date>`, `Accept: <public URL>/invites/<token>` |
| Mention | mentioned member | `Mentioned on <sprite>, frame <f>` | `From: <commenter>`, `Comment: <text>` |
| Link reaches its end | project owner | `Read-only link ended: <sprite>` | `Link: <label>`, `Ended: <date>` |

Revoking a link sends no notice. In an email, `<role>` is lowercase `editor` or `reviewer`. `<public URL>` is `APP_PUBLIC_URL`, or the request's origin when it is unset. `<date>` uses the recipient's settings under Number and date settings; an address with no account uses `en-US` and `UTC`.

### Seed data (DP-91)

On a first start with no people, the app creates the following, generated identically every time. A reviewer signing in sees real work with no upload or setup. Every person and business is invented; the artwork is generated.

| Record | Values |
|---|---|
| Demo owner | `Demo Owner`, `demo@celmate.example`, password `celmate-demo-1` |
| Demo editor | `Demo Editor`, `demo-editor@celmate.example`, password `celmate-demo-2` |
| Demo reviewer | `Demo Reviewer`, `demo-reviewer@celmate.example`, password `celmate-demo-3` |
| Project | `Marzipan Demo`, with those three people in those roles |
| Sprite | `Gumdrop Walker`, 32 by 32, 8 frames of 100 ms, layers bottom to top `Shadow`, `Body`, `Outline`, a palette of 12 swatches |
| Tags | `walk` frames 1 to 8 forward; `bounce` frames 2 to 5 pingpong |
| Tileset and tilemap | `Candy Ground`, tile size 8, 16 tiles; `Courtyard`, 12 by 8 cells, using the default edge table |
| Comments | by Demo Reviewer: `Outline breaks on the left foot here.` open, frame 3; `Can the shadow sit one pixel lower?` open, frame 5; `Colour pass looks right on this frame.` resolved, frame 1 |
| Snapshots | `First pass` then `Colour pass` |
| Read-only link | label `Client preview`, token `demo-gumdrop`, ending `2030-01-01T00:00:00.000Z` |

## Technical requirements

### Deployment (DP-94, DP-95)

Backend: TypeScript on Node 22 with npm. Frontend: TypeScript built with Node 22 in the same `build` step.

Node 22 is the runtime available. `/app/run.json` holds string `install`, `build` and `serve`, and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run serve"}
```

Bind `0.0.0.0` on the port in `APP_PUBLIC_PORT`, or else in `PORT`, or else 4173. The health path is `/api/health`, as printed in API.

### Configuration and secrets (DP-89, DP-96)

Read at start, never hard-coded and never sent to the browser: `DATABASE_URL`; `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`; `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` (value `Celmate <no-reply@celmate.example>`); `APP_PUBLIC_URL`.

| Variable | Meaning | Default | Grading value |
|---|---|---|---|
| `GRADING_KEY` | secret for the grading routes; with none set they always answer 404 | none | `grade-cm-5d2a` |
| `CELMATE_START_AT` | business clock start instant | real time | `2027-03-08T16:00:00Z` |
| `CELMATE_PALETTE_MAX` | most swatches per palette, index 0 excluded, the limit itself allowed | 255 | 16 |
| `CELMATE_SPRITE_MAX` | largest width and height in pixels, the limit itself allowed | 512 | 64 |
| `CELMATE_FRAME_MIN_MS`, `CELMATE_FRAME_MAX_MS` | frame duration limits, inclusive | 10, 65535 | 20, 5000 |
| `CELMATE_INVITE_TTL_SECONDS` | invite lifetime on the business clock | 604800 | 3600 |
| `CELMATE_LONG_PRESS_MS` | long-press colour pick on touch | 500 | 400 |
| `CELMATE_PRESENCE_VISIBLE` | avatars shown before overflow | 4 | 2 |
| `CELMATE_IDLE_SECONDS` | business-clock seconds until a person shows idle | 300 | 120 |
| `CELMATE_UNDO_DEPTH` | undoable actions per person per sprite | 50 | 3 |
| `CELMATE_ACTIVITY_PAGE` | activity page size | 50 | 5 |
| `CELMATE_AUTOSAVE_MS` | draft autosave debounce | 1000 | 800 |
| `CELMATE_JOB_ITEM_MS` | least real time per job item | 0 | 400 |
| `CELMATE_IMPORT_MAX_BYTES` | largest import, the limit itself allowed | 5000000 | 200000 |

### Server boundary (DP-73, DP-93, DP-94)

All pages and APIs are same-origin. The session cookie is HTTP-only. A state-changing request whose `Origin` differs from the server answers 403 with message `Cross-origin request refused`. JSON bodies may reach 1,000,000 bytes, the limit itself allowed, and the seed route 20,000,000 bytes; over that answers 413 `{"error":"too_large"}`. A write with another content type answers 415 `{"error":"unsupported_media_type"}`. Imports use their own limit from Configuration and are judged by the file inside the request.

The server serves only built assets and API responses, never source files, environment files, credentials or object-store addresses. Files download only through the app's routes.

The server starts and listens even when a dependency is unreachable. With Postgres unreachable, every route but health answers 503 `{"error":"database_unavailable"}` while it keeps retrying. With object storage unreachable it behaves as in Services. With the mail server unreachable, mail waits in the outbox.

### Browser support and performance (DP-81, DP-88)

Support current Chromium, Firefox and Safari at 375x812, 768x1024 and 1280x800. The workspace is usable within three seconds of opening. A local stroke draws in the same frame as its input, and other people see it within one second.

## Working rules

- **IF-01** `/app/run.json` exists with string `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`.
- **IF-02** `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package and both typefaces with its licence; shipped packages means the production dependency tree (`npm ls --omit=dev --all --json`, or the lockfile's non-dev group).
- **IF-03** Shipped packages and fonts use only MIT, Apache-2.0, BSD, ISC or SIL Open Font licences.
- **IF-04** Postgres, MinIO and Mailpit are the only datastores and services; no other database, cache or broker is added.
- **IF-05** Typefaces and every asset ship inside the app; no page loads anything from another origin.
- **IF-06** A committed lockfile pins every dependency, with exact versions for the PNG and GIF libraries.
- **IF-07** Credentials are read from the environment; none appear in committed files.

## Engineering standards

- The code is idiomatic strict TypeScript with no untyped escape hatches in domain logic.
- Names match this brief's terms: stage, cel, swatch, frame, tag, tileset, tilemap, snapshot, stroke, sequence number.
- The published drawing, compositing and edge rules are each decided in exactly one place in the source, shared by browser and server.
- Each state transition and derived value (job, invite, comment, link, swatch count, tile use count) is decided in exactly one place.
- No abstraction has a single implementation only for its own sake, and no defensive check guards an impossible state.
- The source has no dead, commented-out or unreachable code.
- Every API error comes from one consistent error shape, as published in the error order.
- The code holds no feature beyond this brief.
