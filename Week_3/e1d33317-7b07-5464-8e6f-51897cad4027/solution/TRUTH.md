# TRUTH

The golden's ground truth. Every value says where it came from: `brief: <section>` (copied verbatim) or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Journeys

### 1. The composer grows the orchestra and writes by keyboard (brief: Journeys 1)
- Start: `/s/seat-composer-7f3a` opens `/score/sc-tidewater`; Live sync reads “Live”.
- Add staff (top rail) → dialog “Add staff” → Staff name “Clarinet II”, Clef Treble, Transposition “B♭ (sounds a major second lower)”, Part “New part” → Create staff… → POST `/staves` 201 → Score changes “Clarinet II added.” Every open screen receives the `score` broadcast and lists the new staff.
- Add measures → spinbutton 8, “3/4” → Append → Score changes “8 measures added. The score now has 56 measures.”
- Select Oboe (Staves option, Enter makes it the entry staff, Entry “Entering on Oboe, voice 1.”), press End, type `5` (“Quarter selected.”), `e f g`, `7`, `.`, `a`: each note announces “<pitch> <duration>, measure <m>, beat <b>.”; the last runs past the barline: “… Tied across the barline into measure <n>.”. Up raises a semitone (“Now <pitch>.”), `j` respells (“Respelled as <pitch>.”).
- Provider-recorded end state: operation rows in Postgres (stamped, seq increasing), the oboe voice endpoint returns `pieces` split at the barline.

### 2. Three people type into the same bars (brief: Journeys 2)
- Three browsers on the oboe voice; each types at the same moment; each send is a stamped batch after 250 ms; inserts after the same element order by the greater lamport, then the greater site; all three screens and `GET /voices/1` show one order.
- Throttle: more than 120 operations in a server-clock 10 s window → 429 `rate_limited` + `Retry-After`; the editor keeps the batch and later edits in order, Sync queue reads “Waiting <s> s to send <k> queued edits.” counting down each second, then “All queued edits sent.”.

### 3. Hold race and leaving (brief: Journeys 3)
- Composer and copyist both select Violin I and Violin II and press “Hold selected staves”; the server serialises under an advisory lock: one 201, the loser 423 `staff_held` naming the winner. Winner Holds “Holding Violin I, Violin II.”; loser “<winner> is holding Violin I, Violin II. Your notes still save.”. Notes from both save.
- Closing the winner's tab releases its holds within 2 s (hold released on socket close); the loser holds at once; Holds tab lists “Violin I — <name>”.

### 4. The copyist proofreads and traces a tie (brief: Journeys 4)
- Respell (`j`), Shift+D (“Dynamic pp.”), Shift+F (“Dynamic above the staff.”), `t` (“Tie added.”). History tab → Show “Ties” → feed of articles with the exact text “<author name> · <summary> · <staff name>, measure <m>, beat <b> · <HH:MM:SS>” (brief: Interactions, History; `<HH:MM:SS>` is the server timestamp as a time of day in UTC); new changes while reading appear as one “Show <k> new changes” button; “Load older changes” appends with strictly older `seq` cursors.
- A collaborator without heartbeats leaves the presence list when the server publishes the new list (window `AWARENESS_TTL_SECONDS`, default 15, checked every second).

### 5. The copyist extracts and delivers the oboe part (brief: Journeys 5)
- Hold Oboe, open the Oboe part, After measure 24 → Add page turn → Layout “Page turn after measure 24 added.”; Shift+E opens “Extract part” (Oboe preselected) → Extract…; part moves draft → engraving → rendering → ready; chip reads “Ready” only after MinIO confirmed `scores/sc-tidewater/parts/p-ob/r<n>/part.pdf`. In Helix view the oboe staff peels off the drum and settles onto a portrait page; the downloaded PDF has one 9×12in page per engraved page.
- Renderer down: pages stored, status `pdf_pending`, Parts “Oboe PDF pending: the renderer is unavailable. The preview pages are ready.”, no download link, retry every `PDF_RETRY_SECONDS`.

### 6. A section player works on a phone (brief: Journeys 6)
- `/s/seat-oboe-5b1d` at 375×812 lands on the Oboe part as a System strip; expression text `<i>dolce, sempre legato</i>` keeps only i, b, br; Play follows the audio clock; Extract Oboe shows the same chip. Reduced motion: 200 ms crossfade.

### 7. The composer's sample bank and a storage outage (brief: Journeys 7)
- A disguised file → Sample banks “<file> was refused: Upload a WAV (RIFF/WAVE) or SFZ file.” and no object or row. A real WAV → “Uploading <file>…”, item “… · Oboe · Uploading…”, then “… · Oboe · Loaded” and “<file> loaded.” only after MinIO confirmed. Storage down: Playback “Sample bank unavailable — playing Oboe with the built-in synth.”; storage back: “Samples restored for Oboe.” at the next oboe note, no restart.

### 8. The composer builds the team (brief: Journeys 8)
- People → Invite collaborator → name, “Section player”, Viola → Create invite… → Team “Invite created for <name>.”; link `/i/<token>`; Join page heading “Join Tidewater Nocturne” and button “Join as <name>”; accept once (atomic UPDATE) → seat token; Team “<name> joined.”. The violist edits only Viola (403 “You can edit only your own staves.” otherwise). Remove → alertdialog → Team “<name> removed.”; within 2 s the seat token answers 401, sockets close, holds release, presence drops.

## Palette roles (decided: see DESIGN.md)

| Role | Hex | Source |
|---|---|---|
| stage | `#0b1017` | brief: Visual design (very dark blue-black) |
| stage raised | `#131b27` | decided: rail surface one step above the stage |
| paper | `#f5f0e4` | brief: Visual design (warm off-white) |
| ink | `#1b1a17` | brief: Visual design (near-black) |
| muted grey | `#5f584d` on paper, `#a8b1c0` on night | brief: Visual design (muted warm grey) |
| vermilion | `#d8431f` | brief: Visual design (one vermilion, selection / holds / caret / playhead only) |

## Type (brief: Visual design)

Fraunces display (h1–h4, part names), IBM Plex Sans body 0.9375rem, IBM Plex Mono for measure, beat, stamp and count figures, Bravura for notation. Scale ×1.25 per level: 0.9375, 1.1719, 1.4648, 1.8311 rem.

## Space and layout per viewport (brief: Screens and layout)

| Viewport | Layout |
|---|---|
| 1280×800 | top rail full width; paper column centred (max 1120px) with the 156px staves list on its left edge; tools rail right, `clamp(372px, 29vw, 440px)`, Hide tools collapses to a 52px edge |
| 768×1024 | tools rail is a bottom sheet: closed shows a 52px handle labelled with the active tab, open covers the lower half (50dvh); Helix available; top rail wraps |
| 375×812 | System strip (one system at a time in a strip that scrolls sideways inside itself), the staves list moves into the bottom sheet as its first section, Note pad toolbar above the 52px bottom sheet handle, part pages show as the same strip, Helix not offered, no page-level sideways scroll |

## Motion table (brief: Motion and effects)

| Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| controls | hover, press | 100 ms | ease-out | none |
| dialogs, bottom sheet | open / close | 250 ms / 150 ms | decelerate / ease-in | immediate |
| tools rail | Hide / Show tools | 250 ms | ease | immediate |
| notes from others | arrival | 200 ms | ease-out | none |
| Helix | idle | 0.05 rad/s | linear | still, drag still turns |
| Helix behind a settled part page | part page open | holds still until Back to score (decided: the page is the focus and the blurred score behind it is a backdrop; brief: Motion and effects allows only the idle turn and the playhead as continuous motion) | — | still |
| part page | appears (Extract, Open part) | 200 ms opacity fade | ease-out | same 200 ms crossfade (brief: Reduced motion) |
| Helix peel | Extract / Open part | strips 40 ms stagger, at rest < 0.9 s, focus 0.4 s | critically damped; ease-out | 200 ms crossfade |
| playhead | playback | audio clock | linear | static measure highlight |

## States per async action (brief: Feedback states)

Every button that starts a request is disabled and gains “…” while in flight. Entry, Sync queue, Holds, Score changes, Team, Parts, Sample banks, Playback, History, Layout, Text, View, Live sync and the PDF chips use the exact copy of the Feedback states table. Errors: 401 Seat link not valid screen; 403 / 422 / 409 / 423 / 429 / 503 shown with the API message and `errors` per field.

## Breakpoints (decided: DESIGN.md)

375 phone strip; 768 bottom sheet; 1024 rail returns to the right; 1280 desktop.

## Media and licences

No fetched media. Fonts self-hosted in `public/fonts` (OFL-1.1): Bravura (Steinberg), Fraunces, IBM Plex Sans, IBM Plex Mono. Icons are inline SVG strokes drawn for this app (`original`). Notation and the Helix are drawn by code from the score's operations.
