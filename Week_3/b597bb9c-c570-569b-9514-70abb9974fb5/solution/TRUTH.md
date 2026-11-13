# TRUTH — Gatecut golden

Each value names its source: `brief: <section>` (copied from `instruction.md`) or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Journeys, start to end

1. **Bring the rushes in** (brief: Journeys 1; Uploads; Business rules, Uploads).
   - Start: owner signed in on `/library`; storage figure in the band reads 41.2 of 100 GB.
   - Choose two MP4 and one WAV with "Upload files". Each file is hashed in the browser (SHA-256, one 4 MiB slice at a time), `POST /api/uploads` answers 201 (or 200 with `chunks_received` for a known open upload, or 200 `{duplicate:true}` for a stored checksum), chunks go up one at a time as `PUT /api/uploads/{id}/chunks/{n}`, then `POST …/complete`.
   - Visible: the Uploads list shows a progressbar per file, `Uploading <name> — <percent>%`; after a reload `<name> — <percent>% · choose the file again to resume`; success `<name> is in the library.`; a duplicate `<name> is already in the library as <existing>.`; a truncated MP4 `Gatecut could not use <name>: MP4 header is damaged.`
   - Provider: chunk objects `uploads/<id>/<n>` exist until confirmed or refused, then are deleted; the file is `media/<sha256>` once (multipart from the chunks); Postgres `media` row only after storage confirmed it; Valkey `gatecut:<workspace>:storage-bytes` rose by exactly the file bytes (atomic Lua take); the band text follows within one second through the socket.
2. **Cut together** (brief: Journeys 2; Keyboard on the timeline; Saving changes).
   - Start: owner and Idris open `harbour-light`. Idris tabs into the timeline (one roving stop, the current clip) and nudges (`move`), splits (`S`), hides (`H`), groups (Ctrl/Cmd+G), ripple-removes (Shift+Delete).
   - Visible: each change reaches the owner within a second, the clip block shows the author's name for two seconds, and the hidden `Project activity` status announces it once, in server order (`<name> moved <clip> to <timecode>.`).
   - Two people trim the same clip from the same version: the first op in server order answers 200, the other 412 `conflict` naming the winner; the loser's page settles on the winner's state, shows the conflict copy, and its other queued ops still save.
   - Provider: `ops` rows in version order with their touched ids; `projects.version` raised by one per op; `undo_entries` for the caller.
3. **Caption the cut** (brief: Journeys 3; Captions; Business rules, Captions).
   - Captions dialog → "Caption row" → "SRT file" → "Import captions": `POST …/captions/import` (raw `application/x-subrip`) replaces the row in one op; notice `<n> captions imported into <row>.`; "Edit cue <n>" opens "Cue text" (counter `data-count` = 42 minus longest line), "Save cue" sends `caption_edit`; "Download SRT" is `GET …/captions/export` with the row's last line ending and byte-order mark and original milliseconds for untouched cues.
4. **Skim and shape a title** (brief: Journeys 4, 8; Frame Loupe; Shaping a layer).
   - Pointer over the canvas shows the loupe within 120 ms (70 ms animation, created synchronously in the pointer handler), nine 40 px cells, snapping within 2 frames to clip edges, the playhead and markers, a white guide; the stage goes to `data-stage-mode="skim"` and the Inspector shows the same numbers; nothing is saved, the address and playhead stay.
   - `L` pins the loupe; arrows move it (Shift: one second); Enter moves the playhead there; Escape closes it and returns focus to the clip that was current.
   - Dragging a layer snaps to the frame centre then the edges (8 project pixels), one `set_layer` op on release; corner handles scale about the centre; arrow keys and `[` `]` are one op each.
   - "Frame size" → `PUT /api/projects/{id}` converts every `x`, `y` and diamond by the new frame over the old, in one op; Undo restores every value exactly.
5. **Client review on a phone** (brief: Journeys 5; Review page; Review links).
   - `/review/<token>` at 375 px: stacked clip list, Scrubber, comment box above the fixed bar; "Send comment" `POST /api/review/{token}/comments` (always `review`, on the link's current cut); the owner's Comments panel receives it by socket. "Approve this cut" records one approval per name. Revoking closes the page's socket with 4410 and the page shows `This review link was turned off. Ask <owner> for a new one.`
   - The `ETag` is the SHA-256 of the exact body, so it changes when another cut is shared or a comment or approval lands; `If-None-Match` with the current tag answers 304.
6. **Producer notes and mail** (brief: Journeys 6; Notes and pins; Mail).
   - Maren pins a team note with `@noor @idris`; the draft is saved by the server about a second after typing pauses; each mentioned person (not the author) gets one grouped mail per project per `MAIL_GROUP_SECONDS` window, subject `Gatecut · <title> · notes for you (<n>)`, lines `<author> at <timecode>: <body>`. Mail waits in `outbox` as `waiting` and becomes `sent` when SMTP accepts it; it is never sent twice (rows are claimed with `FOR UPDATE SKIP LOCKED`).
   - A late client note pinned to a clip shows on the live timeline at `clip.start + offset`.
7. **Export and allowance** (brief: Journeys 7; Exports; Allowance).
   - "Export" → cut and size → `POST /api/projects/{id}/exports` answers 202 (new), 200 (same cut and size). Minutes are taken from Valkey in one atomic step before the row is inserted; the row is committed before the message is published to the durable queue; the worker advances ten steps of `EXPORT_STEP_MS`, writes `manifests/<export id>.json` only if absent, marks `done`, and queues the export-finished mail. Cancel returns the minutes once.
8. **Go back to Cut 1** (brief: Journeys 10; Restoring a cut): `POST …/cuts/{id}/restore` is one op that raises the version, is announced as `<name> restored <cut>.` and is undoable; a locked row that would change refuses the whole restore (`row_locked`).
9. **Agency dashboard** (brief: Journeys 11; Read tokens): `gct_` + 40 hex shown once; `/api/v1` GET only; opaque keyset cursors; 30 requests per fixed ten-second window in `gatecut:rate:<token id>:<window>` (expiring after 20 s); the Profile screens show the counter within a second.

## Palette and type (brief: Visual design; hex decided to satisfy the brief's words and WCAG AA)

| Role | Hex | Use |
|---|---|---|
| ground | #14110e | page ground, dialog bodies, text on a gold control |
| surface | #211b17 | timeline canvas, loupe, Notices strip, loading frames |
| raised | #2d2621 | clip blocks, buttons, fields, loupe cells (decided: no border allowed, so objects need a third step) |
| ink | #ffffff | titles, values, focus ring |
| muted | #a69b8f | secondary values and labels (6.90:1 on ground) |
| accent | #c4a15a | exactly "New project" and "Export" |

Work Sans 400 at 14/20 for everything; 17/22 for "Gatecut" and dialog titles only; Sometype Mono only for a token string and `/api/v1`; tabular figures everywhere (brief: Type).

## Space and layout (brief: Screens and layout; Composition)

14 px margins and gutters; the band hangs 20 px from the top; the Notices strip is a fixed 28 px row (decided: no layout shift). Project list: seven columns at ≥1100 (runs are subgrid items spanning 3 or 4 columns, packed densely so a run of three and a run of four share a row), four at 700–1099 (one run per row), two at <600 (each run scrolls inside itself, "New project" fixed bottom right); about 300 px of bare ground between band and sheet. Project page: `data-layout` is `review-list` under 700, `two-pane` from 700 to 1099, `editor` from 1100; the editor grid puts the stage in columns 1–4, the Inspector in 5, Comments in 6–7, the timeline across all seven and Exports below it. Touch layouts give every control at least 44 by 44 px (decided: the brief sets 44 px for review-list and two-pane).

Timeline scale: zoom levels 0 to 5 at 0.25, 0.5, 1, 2, 4, 8 px per frame, default 2; a block's left edge is `(start − first) × px per frame` from the canvas's left edge (brief: Zoom and scroll).

## Motion (brief: Motion and effects)

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| Frame Loupe | pointer enters canvas | 70 ms opacity 0→1 and scale 0.96→1 (WAAPI) | cubic-bezier(0.2,0,0,1) | no animation is created |
| Stage | pointer leaves canvas | 140 ms opacity crossfade | linear | none |
| Project runs | hover or title focus | 80 ms opacity to 30% | linear | none |
| Remote clip move | someone else's op | 140 ms left/width | cubic-bezier(0.2,0,0,1) | jumps |
| Buttons | press | 0 ms | none | same |
| Export progress | each step | 0 ms | none | same |

No idle, looping or decorative animation, no spinners. (Durations decided inside the brief's 120/200 ms limits.)

## States per async action (brief: Feedback states)

Every own action writes its pending copy, then its success or error copy, into the `Notices` status: Sign in, Upload, Name cut, Restore cut, Change the frame, Share or regenerate link, Revoke link, Pin note, Approve, Start export, Cancel export, Import captions, New read token; client comments use `Review status`. Remote events, export results and allowance changes go to the hidden `Project activity` status once, in server order. Outage banners (storage, queue, mail) are owner only, come from `GET /api/status` on load and after a failing action, and clear when a later action of the owner's succeeds. A failed dialog save keeps the dialog open with focus on its error summary.

## Services (brief: Services)

Postgres holds every record and the op log; MinIO holds `uploads/<id>/<n>`, `media/<sha256>` and `manifests/<export id>.json`; Valkey holds `gatecut:<workspace>:export-minutes:<YYYY-MM>` (expiring after 40 days), `gatecut:<workspace>:storage-bytes`, `gatecut:peaks:<sha256>` and `gatecut:rate:<token id>:<window>`; RabbitMQ carries the durable `EXPORT_QUEUE`; SMTP carries mail. The outage instances share the primary's Postgres, so every sweeper and consumer is safe with several processes on one database (conditional UPDATEs, `SKIP LOCKED`, advisory locks).

## Media and licences

No photographs or video: Gatecut never decodes pictures. Sheet frames, stage layers and waveform strips are drawn from data. Fonts: Work Sans and Sometype Mono, OFL-1.1, self-hosted woff2 in `web/fonts/` with their OFL text (listed in `app/assets.json`). Icons: Lucide (ISC) inlined by the bundler. Seed stand-ins (MP4, WAV, PNG) are generated by the server at seeding (`original`).
