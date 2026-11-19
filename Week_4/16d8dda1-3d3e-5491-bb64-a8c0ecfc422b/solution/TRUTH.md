# TRUTH — Slatehall golden

Every value says where it came from: `brief: <section>` (copied from instruction.md) or `decided: <why>`.

## Ideal end-to-end flows

### 1. Arranging a classroom (brief: Journeys 1, DP-03, DP-04)
1. Start: a teacher has signed up (`POST /api/teachers` sets `slatehall_session`) and created a class (new class layout `{"columns":8,"rows":6,"pieces":[{"kind":"board","column":2,"row":0}]}`, brief: Classes).
2. They open `/classes/<id>/room`. The plan shows the board as one slab four cells wide on the top row (front wall at the top). Cursor starts at cell 0,0 (`aria-selected="true"`).
3. Radio `Seat` + Enter on cell 0,2 places a seat (`data-piece="seat"`); radio `Table` + Enter on 1,2 places a table; Delete/Backspace removes the piece under the cursor; clicking a cell places the chosen piece.
4. `Save room` sends the pieces in placement order. On refusal the server's text appears in the editor's `alert` and the plan is unchanged; on success Page status reads `Room saved.`.
5. Provider record: Postgres `classes.layout`; `GET /api/classes/<id>` returns seats `B1`→`T1` etc. computed by `server/domain/layout.ts`.

### 2. Joining and taking a seat (brief: Journeys 2, DP-05, DP-06, DP-08, DP-09)
1. A live session, teacher on instance a, learner on instance b. The learner enters the class code (case/space-insensitive) and a name; `POST /api/join` → 201 `{sessionId, learnerId}` and cookie; the page opens `/sessions/<id>`.
2. The cursor starts on the lowest seat id; arrows move it, Enter claims the seat: one Valkey Lua script updates `sh:<sid>:seats` and `sh:<sid>:seat-of` atomically.
3. The seat appears on both pages within one second (`data-occupant`, `data-occupant-name`). A loser gets `409 Seat <id> was just taken. Pick another seat.`, stays where they were, and the page announces the text.

### 3. Teaching from the board (brief: Journeys 3, DP-11..DP-14)
PageDown/PageUp (or Previous/Next slide buttons) set `sh:<sid>:slide`; every board shows the slide and announces `Slide <n> of <total>.`; a late joiner starts from the snapshot. `H` raises/lowers a hand (Valkey list `sh:<sid>:hands`); `T` or `Take next hand` pops the first hand (`<name> has the floor.`); an empty queue shows `No hands raised.`.

### 4. Preparing a lesson (brief: Journeys 4, DP-15..DP-18)
`Add files` uploads PNG/JPEG/glTF-binary judged by content; rows show Pending then Confirmed after MinIO confirms the byte count (`lessons/<lessonId>/<fileId>`); a refused file removes the request's rows and the alert names the file; reorder → `Lesson updated.`; `Mark ready to teach` → `Lesson ready to teach.` and `Status: Ready`. MinIO down → 503 `Files can't be saved right now. Try again in a minute.` with nothing half-saved.

### 5. Poll, then breakouts (brief: Journeys 5, DP-19..DP-25)
Open poll (2–6 options) → learners answer by button or number key (replaces earlier answer) → teacher counts update (Valkey hashes) → Close poll writes the tally once (percent rounded half up) and announces `Poll results: …`. Start breakouts at k tables deals seated learners in seat-id order to T1..Tk round-robin; the server holds the deadline (`BREAKOUT_SECONDS`), `Add 2 minutes` adds `BREAKOUT_EXTEND_SECONDS`, the warning fires at `BREAKOUT_WARNING_SECONDS` (edge included), and at the deadline everyone is back at home seats (Bell Return), the board brightens, chat disables.

### 6. Spotlight, lock and roles (brief: Journeys 6, DP-31..DP-34)
Co-teacher advances slides and spotlights; only the owner locks (`The class is locked.`); a newcomer gets `409 This class is locked. Ask your teacher to let you in.`; a learner already in reloads and returns; role refusals are `403 Only the teacher can do that.`; anything unopenable is `404 Not found.`.

### 7. Live bus outage (brief: Journeys 7, DP-35)
An instance without Valkey answers live actions `503 Live updates are paused. Try again in a moment.`, pushes a paused frame, shows the banner `Live updates are paused. Your class will resume on its own.`, and freezes its pages; when the bus returns (≤5 s, or at once via the outage route) it pushes the current snapshot, the banner goes and `Live updates are back.` is announced.

### 8. After class (brief: Journeys 8, DP-27, DP-28, DP-36)
Ending writes poll tally, closes presence, and stores attendance and summary in Postgres. The summary page shows counts, the Attendance table (times as `HH:MM:SS` in the class zone), poll results, `Hands taken: <n>`, `Breakout rounds: <n>`. A learner who attended steps through `/review/<id>` (`Slide <n> of <total>`); others get not found.

## Palette roles (hex used by the build)
| Role | Hex | Source |
|---|---|---|
| ground (page) | `#F6F0E4` | brief: Visual design (warm paper off-white) |
| ground-raised | `#FBF7EE` | decided: panels lift without heavy shadows |
| ground-sunk | `#EFE7D6` | decided: quiet grouping |
| ink | `#1B2723` | brief: near-black with a hint of green |
| muted | `#4E5B55` | decided: AA helper text |
| board / primary / focus | `#2F4B41` (hover `#243A32`) | brief: deep slate-green |
| rule (decorative) | `#CFC6B2` | brief: soft greige |
| rule-strong (control boundaries) | `#857D6C` | brief: AA control boundaries |
| brick (Live marker, urgent timer and rings only) | `#A6361F` | brief: one brick accent |
| table-fill | `#4A4234` | decided: a table must differ from a seat without any red-ish colour |

## Type
Headings platform serif (Iowan Old Style … Georgia), each level 1.25× the one below (1rem, 1.25, 1.563, 1.953, 2.441); body platform sans (root 16px phone, 17px otherwise); timers, counts, seat ids, codes, times platform monospace with tabular figures. No web font (brief: Visual design).

## Space, layout per viewport
- Spacing scale 4/8/12/16/24/32/48; radius 6 controls, 10 panels; every button/tab/target ≥ 44×44 (brief: Controls).
- 1280×800: classroom region 62% of width left, 2px greige-ruled rail right (Hands, Poll, Breakout, Table chat, 24px apart), control bar above (brief: Screens and layout; DP-43).
- 768×1024: classroom on top; `Class panel` opens a bottom sheet 60% of the height with a handle bar, sliding in 250 ms on the page clock; closed sheet is gone.
- Every viewport: `Class announcements` is a fixed two-line strip under the canvas showing the newest announcement (decided: a live message must never resize the WebGL canvas, which would stall the page past the brief's one second for live changes).
- 375×812: header row, region (board strip + canvas) 54% of the height, teacher control row, Breakout region while breakouts run, `Class panels` tab bar (Seats, Hands, Poll, Chat) and the selected panel; the mirror lists are visually hidden; closed panels `hidden` + `inert`.

## Motion table
| Element | Trigger | Duration, easing | Reduced-motion substitute | Source |
|---|---|---|---|---|
| camera | entering, new seat | 650 ms ease-out | cut | brief: Motion (0.5–0.8 s) |
| avatar walk | seat taken, breakouts start, return | 640 ms; return stagger 120 ms per table | appear at once | brief: Bell Return |
| arm lift | hand raised/lowered | 220 ms | immediate | brief: Motion |
| spotlight pool | spotlight set/cleared | 320 ms fade | immediate | brief: Motion |
| board brightness | breakouts start / return | 0.4 → 1 in 320 ms | full strength at once | brief: Bell Return |
| rings | breakouts | drain with server time; refill 280 ms on Add 2 minutes; brick when warned | stepped whole-second label on each table | brief: Bell Return |
| model | live or breakouts | one turn per 30 s | still | brief: Motion (20–40 s) |
| sheet | open/close | 250 ms rAF tween on `performance.now()` | none | brief: Motion |
| dialog | open | 180 ms opacity | none | brief: Motion (within a fifth) |
| buttons | hover, press | 90 ms background-color, transform | none | brief: Motion (within a tenth) |

All scene and sheet motion advances from `requestAnimationFrame` + `performance.now()` so it follows the page clock (decided: the verifier steps that clock).

## States per async action
Forms: submit disabled + `aria-busy="true"`, Page status `Saving...`, then the success copy or the refusal in `role=alert` (ink with slate rule, never red). Live actions: pressed button disabled + `aria-busy`, no announcement while pending, refusal text announced. Outages: MinIO 503 text on upload/read/setup; Valkey 503 text on live actions plus banner. Empty states: `No hands raised.`, `No poll is open.`, `Chat opens when breakouts start.`.

## Breakpoints
Phone < 600, tablet < 1024, desktop otherwise (decided: the three published viewports fall in distinct bands; brief: no other breakpoint changes what they get).

## Media and licences
No binary asset ships (`assets.json` is `[]`). Icons and empty-state drawings are inline SVG drawn for the app (licence: original); the 3D floor texture is painted on a canvas in code; the grading setup generates its slides (PNG) and model (glTF binary) at run time. Shipped packages: ioredis, pg, react, react-dom, three, ws and their dependencies, all MIT/ISC/Apache-2.0/BSD (see `THIRD_PARTY_NOTICES.md`).
