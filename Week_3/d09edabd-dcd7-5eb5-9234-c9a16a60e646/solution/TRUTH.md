# TRUTH — Keyway Bench (golden)

The intended behaviour of the app, made concrete. Every value says where it came from: `brief: <section>` (copied from `instruction.md`) or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Ideal end-to-end flows

### 1. Walk into a starter room (brief: Journeys 1)
1. Start: signed in as the owner; `/app` loads. The `Open a room` dialog sits over the dimmed grid stage, the first card (Apothecary, alphabetical) is highlighted (`aria-selected="true"`) and holds focus (brief: Room picker; Interactions).
2. Enter: the dialog and scrim fade out over about 0.15 s; the app calls `POST /api/rooms/:id/walk-in` (a new `running` `walk_in` session hosted by the user); the camera dollies from the overview (yaw 30, pitch 35) through the entry door to the 1.6 m start pose over 600 ms (brief: 0.5 to 0.7 s; decided: 600 ms is the middle). Camera reads `Walking in`, then `Player height`.
3. End state: the Play button shows the stop square (`Stop playtest`), the transport shows `timer "Playtest clock"` at the server's remaining time (`60:00` by default), the chain figures read `0 of 6 solved`, Editor status reads `Playtest running.`. Provider-recorded: one `playtests` row, state `running`, kind `walk_in`, `host_user_id` = the user (brief: Play button; Journeys 1).
4. P (or Stop): `POST /api/playtests/:id/end` (outcome `stopped`), the camera returns to the saved editing pose over 600 ms and Camera reads `Overview`, the Debrief dialog opens headed `Playtest ended`; closing it puts focus on the Play button, which reads `Start playtest` (brief: Play button). The debrief mail is queued for every unrevoked invite, the host and the workspace owner.

### 2. Lay out a room together (brief: Journeys 2)
Owner and co-designer open the same room on different instances; the Presence button reads `2 here` on both (Valkey `presence:<roomId>:<userId>`, TTL 30 s, refreshed every 10 s). Selecting a placement takes `lock:<roomId>:placement:<id>` with the lock TTL and refreshes it every 10 s. The other member selecting it sees `<display name> is holding this prop.` and their nudges save nothing. Each saved move publishes `placement` and `room` events on `room:<roomId>` and reaches the other stage within a second. Releasing the selection (or the TTL lapsing) frees the lock (brief: Locks; Live events).

### 3. Wire the chain and read the bottleneck (brief: Journeys 3)
In the Vault the Trigger graph sheet lists the six nodes in chain order; N steps through them; the longest run reads 6. Unchecking `Blacklight cue` from Safe dial's prerequisites and pressing `Save node` makes the API, the stage figures and the Vault card read `Longest run 4` within a second (brief: Chain figures; Trigger graph sheet).

### 4. Upload a prop (brief: Journeys 4)
Prop library: choose a `.glb`, name `Coffre à secrets`, 0.900 x 0.500 x 0.600 m, Upload. Editor status `Uploading <file name>...`; a pending card with no Place button; after MinIO confirms `props/<id>.glb`, the stored card appears, Editor status reads `<prop name> is in the library.` and focus moves to `Place <prop name>`. Place adds a `prop` placement at the centre of the floor, closes the sheet and the prop count rises by one. With MinIO down: `Upload failed. Nothing was added.`, no prop row, no object (brief: Props stored as uploaded).

### 5. Run a remote playtest (brief: Journeys 5)
Playtests sheet: Start time (browser-local, sent as a UTC ISO `startsAt`), `Schedule playtest`; invites by email (each a row with `Sent`, `Queued` or `Failed`); `Open lobby`, then `Start` (focus stays in the sheet); every viewer's clock is the server's. A hint is refused with `Next hint in <m:ss>` inside the cooldown.

### 6. Play from a phone (brief: Journeys 6)
The emailed `/play/<token>` shows `Waiting for the game master to start.`; the tester types a display name and taps the raised Join, which becomes the disabled `Joined`. When the session starts they walk (W A S D / arrows, drag to look), enter `4172` for `Herb cabinet code`; `Cabinet maglock` and `Blacklight label` fire on their own (`solved_by` null). Solving `Exit door` ends the session as `escaped`; the screen shows `Playtest ended`; every tester and the owner receive the debrief; reopening the link shows `This playtest invite has expired.`.

### 7. Freeze and hand off (brief: Journeys 7)
`Freeze version` writes the version record, `versions/<id>/snapshot.json`, a byte copy of each placed prop file and the pack link in one transaction (all or nothing, else `503 storage_unavailable` and `Freeze failed. Nothing was saved. Try again.`). The previous frozen version becomes `Superseded` with `supersededBy` = its number + 1; both `version` events reach every open Versions sheet within a second, in place, without moving focus. The pack page shows lengths from the stored millimetres (`16' 4 7/8"` for 5,000 mm); Units rewrites the address in place; Download serves the version's own file with the published headers; regenerate kills the old link at once.

### 8. Services drop mid-session (brief: Journeys 8)
Valkey down: the pill word reads `Paused`, the banner reads `Live editing is paused. Solo editing still works.`, locks and playtest actions answer 503 `live_unavailable`, moves still save, freezing still works. Valkey back: the banner clears within 10 s, presence returns, no restart. MinIO down: `Prop storage is unavailable. Uploads and freezing resume when it's back.` Mail down: invites are created `queued` and sent within 10 s of the server's return (retried every 10 s, `failed` after 3 attempts).

## Palette (brief: Visual design; hex from the seed ledger, `decided` where noted)
ground `#11151D`; surface `#1B212D`; surface-raised `#222937`; hairline `#262D3B`; ink `#E6E9EF`; muted `#98A1B3`; accent (selection ring) `#3B82F6`; primary fill `#2563EB` (decided: white text on `#3B82F6` is 3.7:1); link `#6AA8FF`; play `#E8572E`; on-accent `#FFFFFF`; scrim `rgb(21 26 36 / 0.88)`.

## Type (brief: Type)
Inter for readable text (13 to 14 px body, 16 px section titles, 18 px the wordmark and the largest text anywhere); JetBrains Mono for the build line (`bench 1.0.0`), room codes, clock, ids and hashes; tabular figures for lengths, times, counts and the clock. Both self-hosted (Fontsource, OFL-1.1).

## Space and layout per viewport (brief: Screens and layout; Viewports)
- Edge margin 14 px (12 px on the phone). 1280x800 and 768x1024: corner clusters — logo top-left, 520 px session pill top-centre, chain figures + Presence + 44 px Account avatar top-right (under the pill at widths below 1000 px so they never overlap: decided), Inspector under it, Scene panel left (240 px), Add primitive and Upload prop bottom-left, Cue timeline and Units bottom-right, a 310 px transport bar bottom-centre. Picker 600 px wide, four columns, top 103 px.
- 375x812: compact pill, Presence and the first figure on top; 60 px full-width tab bar `toolbar "Transport"` with Tools, Graph, raised 56 px Play circle centred on the bar's top edge, Props, Rooms; picker and every sheet are full-width with 12 px margins, scroll inside themselves and end at or above the tab bar's top edge (752 px).
- Pack page: pinned top bar; column at most 960 px centred at 768 and 1280; each of four tables in its own focusable scroll region on the phone with cells on one line.

## Motion (brief: Motion and effects)
| Element | Trigger | Duration, easing | Reduced-motion substitute |
|---|---|---|---|
| hover and highlight colours | hover, arrow keys | 120 ms ease | instant |
| card / cluster press | pointer down | 100 ms ease, 0.98 / 0.95 | none |
| Play button | hover / press | 150 ms grow to 1.05 / 100 ms dip | none |
| dialog open / close | open / close | 200 ms / 150 ms, fade + 0.98 to 1 | gone within 80 ms, no scale |
| doorway dolly | walk-in / Stop | 600 ms, plain in-out | camera cut |
| drop | D | 120 fixed steps per second | same (not decorative) |
| public tour | scroll | camera = f(scroll progress) | camera stays at the overview; cues light instantly |

## States per async action
- Upload: pending card + `Uploading <file name>...` -> stored card + `<prop name> is in the library.` / `Upload failed. Nothing was added.`
- Freeze: `Freezing version...` -> `Version <n> frozen.` and focus on the new card's Copy button / `Freeze failed. Nothing was saved. Try again.`; label error beside the field.
- Save queue: `Saving...`, `All changes saved.`, `Offline. <n> changes waiting to save.` (queue kept in localStorage per room, retried every 5 s with the same `Op-Id`).
- Lock: `<name> is holding this prop.` / `Prop locked` dialog (Cancel, Take over) / `You now hold <label>.` / `<name> took over <label>.`
- Undo, Scene move, Restore, links: the published Editor status copy.
- Invites: `Invite sent to <email>.` / `Invite to <email> is queued.`; roster word `Sent`, `Queued` or `Failed`.

## Breakpoints
The layout changes at exactly 768 px (brief). The only extra rule is the top-right cluster at 1000 px (decided, see above).

## Media and licences
No fetched media. The Tumbler & Pin mark and favicon are drawn in code (`original`); room thumbnails are rendered by the app from stored placements; icons are Lucide (ISC, inlined); fonts Inter and JetBrains Mono (OFL-1.1, Fontsource). All packages are MIT, ISC, BSD, Apache-2.0, 0BSD, BlueOak or OFL; see `app/THIRD_PARTY_NOTICES.md`.

## Decisions where the brief is silent
- Sessions: `hostUserId` of a scheduled session is the owner who scheduled it; `durationSeconds` is stored when the session is created.
- Mail delivery runs from an outbox table; an instance only sends while its own SMTP probe is up (so an instance with mail down never fails another instance's messages).
- Debrief `stats.solved` counts the nodes of that session; the room's figure counts the latest session that reached running.
- Each request takes one moment (`now`) when it arrives: it ends any session past its deadline as of that moment and reports `serverTime`, `remainingSeconds` and the state at that same moment, so a read whose `serverTime` is at or after the deadline always shows `ended` (brief: Server-owned time, "Any read at or after the deadline already shows `ended`"; decided: one instant per read keeps the figures consistent with each other).
- After an invite or hint is accepted, its field clears only if it still holds the sent text, so typing the next email before the answer arrives is never lost (decided: the brief's roster flow invites several testers in a row).
- Thumbnail renders (the open room's and the picker cards') wait while the open room's playtest runs; the room cannot change then (decided: brief, Edits during playtests; keeps the stage the only thing drawing during a walk-in).
- A closed dialog stays in the page, faded out and inert, so it never blinks away between two checks.
