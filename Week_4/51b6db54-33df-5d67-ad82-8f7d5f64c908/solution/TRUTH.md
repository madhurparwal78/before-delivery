# TRUTH

Ground truth of the golden Celmate. Each value says where it comes from: `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys (ideal flows)

1. **Set up and invite** (brief: Journeys 1). Start: no account. `/signup`: Name, Email, Password, `Create account` → Notices `We are sending your code to <email>`, Code field appears (brief: Feedback states). Mailpit holds `Your Celmate code: <6 digits>`. `Confirm` → signed in, `/projects`. Owner creates `Project name` → link; project page `New sprite` dialog (16 by 16) → sprite link. `Invite email` + `Invite role` → `Invite created for <email>`; Mailpit holds `Join <project> on Celmate` with `Role:`, `Expires:`, `Accept:`. The invitee opens `/invites/<token>`, `Accept invite` → `You joined <project>`; the Members table lists three people with roles. Provider state: Postgres rows in `users`, `memberships`, `invites`; three messages in Mailpit.
2. **Draw together**. Two editors open one sprite. Pointer or keyboard strokes draw at once locally, are posted with a client stroke id, sequenced under a per-sprite row lock, and pushed over server-sent events; both stages show equal `data-composite-hash`. Undo reverses only the person's own action as a new operation.
3. **Change a colour**. `Save swatch` sends `{color, version}`. Accepted: every page announces `Swatch 3 now ff0044ff, used by 12 pixels in 2 frames`, the stage floods in Chebyshev rings from the editing cursor over 420 ms (`data-flood-radius`), thumbnails switch left to right 30 ms apart (`data-thumb-seq`), the count rolls over 320 ms (`data-used-by` is final at once). A stale version answers 409 `version_conflict`; the alert reads `<name> changed this swatch first`.
4. **Animate**. `Add frame`, `Link cel`, `Frame duration`, tag form (`Tag name` draft autosaved after `CELMATE_AUTOSAVE_MS`), `Preview tag` and `Preview speed`; after reload the timeline and tag are unchanged.
5. **Build a map**. `New tileset`, `New tilemap`, `Import frame as tiles`, tile keys (Enter, Delete, H, V, Shift+arrows, C), `Edge matching` updates a cell and its four neighbours as one operation; `Edit tile` dialog saves a tile and every use changes.
6. **Review and restore**. `Pin comment` or key C pins a comment to frame and pixel; a mention emails the member once (`Sending to` becomes `Delivered to` after the mail server accepts). The owner compares two snapshots (`12 pixels changed in frame 3`) and restores one: `Before restore <name>` snapshot, one restore operation, `Restored <name>` on every page.
7. **Export**. `Export` dialog → job queued/rendering/stored with `Processing 40 of 120`, `Stored: <files>`; objects are written to MinIO only through the app and the job is listed only after size and checksum are confirmed. With storage down: drawing continues, the alert reads `Storage is unavailable. Your artwork is safe.`
8. **Share and end**. Owner creates a link (`Link hours` default 24, end read from `GET /api/config`); the viewer opens `/s/<token>` (stage, zoom, `Preview` only). Revoking, regenerating or the server clock ending it moves the viewer to `This link has ended` within 2 s; an ended (not revoked) link mails the owner once.

## Palette roles (brief: Visual design / Colours)

| Role | Value | Source |
|---|---|---|
| ground | `#000000` | brief: pure black |
| surface | `#0d0d11` | brief: near-black working surface |
| ink | `#ffffff` | brief: ink white |
| muted | `#a9a9b4` (hero first clause `#8f8f9a`) | brief: mid-grey |
| accent | `#a6efff` | brief: pale candy cyan; text on accent `#000000` |
| mint / cyan / lemon / orange / cornflower | `#a8f0cf` / `#9be8ff` / `#fff08a` / `#ffb066` / `#a9b9ff` | brief: flat fields, black text; decided: exact hues |
| card | `#ffffff` on ink `#0b0b0f`, radius 28 px | brief: white cards, about 28 px |

## Type (brief: Typefaces)

Headlines Stack Sans Headline (300, 600), everything else Stack Sans Text (400, 600), shipped as woff2 in `public/fonts`. Heading steps ratio 1.25 (1.25 rem, 1.563, 1.953). Figures use `font-variant-numeric: tabular-nums`. Hero headline `9vw`, weight 300, first clause grey, second white.

## Layout per viewport (brief: Screens and layout)

375x812: top bar, active panel, tab dock (`tablist "Workspace"`, tabs Canvas, Layers, Frames, Palette; `More panels` in the top bar opens a bottom sheet with Tiles, Comments, Snapshots, Activity). 768x1024: stage over a dock of Palette, Layers, Frames with Preview; `More panels` opens a side drawer. 1280x800: left Palette and Layers, centre tools, stage and Frames, right Preview, Tiles, Comments, Snapshots, Activity. Breakpoints 700 and 1100 CSS px (brief). Tap targets at least 44 px (brief).

## Motion (brief: Motion and effects)

| Element | Trigger | Duration, easing | Reduced motion |
|---|---|---|---|
| Index Flood rings | swatch edit accepted | 420 ms, ease-out cubic | none; one step |
| Thumbnails | after the rings | 30 ms apart | one step |
| Count roll | after thumbnails | 320 ms, ease-out cubic | one step |
| Preview | autoplay | each frame's duration, speed Half 2x, Normal, Double rh(ms,2) | step buttons only |
| Hero sprite | page load | 8 frames x 100 ms once, settles | end state |
| Stickers | page load | 420 ms, overshoot, then stop | end state |
| Pills | press | 80 ms translate onto the shadow | none |
| Dialogs and sheets | open | 220 ms | none |

## States per async action

Pending text, success text and refusal alerts are the exact strings of brief: Feedback states (Notices, Draft status, Job progress, Sync status). Loading shows a dashed outline of the panel with no shimmer. Outage and refusals use the orange field.

## Decided values

- Server-sent events carry the private live channel (brief allows WebSocket or SSE).
- Presence, cursors and the 2 s stroke window live in the process; documents, order, jobs, mail and the clock live in Postgres.
- Export jobs lease for 3 s and are claimed by `FOR UPDATE SKIP LOCKED`, so a surviving server continues a dead one's job within the 5 s limit.
- Media: hero sprite, stickers, icons and empty-state stickers are drawn in code (original); fonts are OFL-1.1.
- Taking or releasing a layer lock is a sprite operation of type `layer`: it gets the next sequence number, the reply's `seq` is that number, and it reaches open workspaces as that event (brief: Business rules / Order, "The server gives every sprite operation ... one sequence number per sprite, rising by exactly 1 with no gaps"; API event `type` list includes `layer`).
- An export job's row is locked from its first upload until the commit that marks it stored and lists it, so a cancel and the finish exclude each other and a read of the job waits for the confirmed outcome (decided: brief Export jobs, "Exactly one of a cancel and a finish wins", and DP-43).
- Requests that arrive while the server's start-up (migration, clock, demo seed) is still in flight wait for it; only a failed start-up answers 503 `database_unavailable` (decided: brief Server boundary, listen at once yet serve real answers when Postgres is reachable).
