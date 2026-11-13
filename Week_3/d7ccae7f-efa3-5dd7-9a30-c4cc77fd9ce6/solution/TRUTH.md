# TRUTH — Corkline Works Lastbell

The golden's ground truth. Each value says where it came from: `brief: <section>` (copied from `instruction.md`) or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent). Where the brief pins a literal (copy, status code, accessible name, error code, key, seed value) the app uses it verbatim.

## 1. Journeys (start state → actions → visible end state → what the providers record)

### J1 Writing a deck (brief: Journeys 1; DP-01, DP-03, DP-05, DP-06, DP-08, DP-09)
1. Start signed out at `/host/login` (or any `/host…`, `/stage/…` visit, which redirects there). The quizmaster signs in with email and password; `status "Account status"` reads "Signing in…" then the Decks screen (`/host`) opens. Postgres: a `sessions` row (token hash only), cookie `lastbell_session` HttpOnly, SameSite=Lax, 30 days.
2. Types a title in `textbox "New deck title"`, presses `button "Create deck"`: `status "Decks status"` "Creating deck…" then "Deck created"; the deck row appears with "0 questions". Postgres: `decks` row, version 1.
3. Opens the deck (`link "<deck title>"`) → deck editor. "Add question" appends `group "Question 1"`; picks "Multiple choice", fills Prompt, Time limit, Option A–D, `radio "Correct: A"`, presses "Save question": `status "Editor status"` "Saving…" then "Saved". Postgres: `questions` row version 1. Same for "Estimate" (Minimum, Maximum, Step, Correct value, Tolerance, Unit) and "Sequence" (Item 1…Item 6 in correct order).
4. Chooses a file for `Picture for question 1`: the status reads "Uploading picture…", the area shows "No picture" and no `img`. The server sniffs the bytes, writes `questions/<questionId>/<sha256>.<png|jpg|webp>` to MinIO with the sniffed content type, stats it, then answers 201; the status reads "Picture attached", the area reads "Picture attached" and shows `img "Picture for question 1"` from the presigned preview link. Postgres: question `image` set, version +1.
5. Back on `/host`, after a reload, the deck row reads "3 questions" with `button "Open room for <title>"`.
Provider-recorded end state: Postgres deck + 3 questions (one with image metadata); MinIO one object under the published key.

### J2 Filling the room (brief: Journeys 2; DP-12–DP-16)
1. On `/host` the quizmaster presses "Open room" on a deck with questions: `status "Decks status"` "Opening room…", then `/stage/<roomId>`. Postgres: `rooms` (state lobby, fresh six-digit PIN, deck title), `room_questions` snapshot of every question (versions, picture keys, sequence item ids).
2. The stage lobby shows `region "Join details"` with the PIN in very large chalk numerals, "Join at <origin>" and "0 of 0 phones connected", and `list "Players"`.
3. A player types the PIN and nickname on `/` and presses "Join the night": "Joining…", then `/play/<roomId>`. The phone rejoins with the stored rejoin token (new client id), opens its stream; `status "Answer status"` reads "You're in, <nickname>. Watch the big screen."
4. The stage list gains the nickname (`player_joined`), the join region reads "<n> of <m> phones connected" (`presence`). Postgres: `seats` (rejoin token hash only), `clients`, `standings`, `room_events`; Valkey: `lastbell:room:<roomId>:clients` holds the stage and phone client ids, `…:leaderboard` holds each seat at score 0.

### J3 Running the night from the keyboard (brief: Journeys 3; DP-17–DP-22, DP-38–DP-42)
1. Lobby: only "Open question" is enabled. `O` opens question 1: `status "Stage status"` "Question 1 open"; phones show the question with a countdown; the stage shows the band, the tiles and `timer "Time left"`.
2. Players answer; `region "Question"` reads "<n> of <m> answered". `L` locks (reason `host`) — or the server locks at the deadline (reason `deadline`): "Locked"; phones read "Time's up".
3. `R` reveals: scores are computed for every seat; the stage raises one pillar per option (Tally Pour), `list "Answer split"` counts up, then marks the correct item; phones read "Answers are in" and show rank and score. Postgres: `answers.points` filled, `standings` rewritten, Valkey leaderboard set equals the stored scores.
4. `B` shows `list "Leaderboard"` (top ten); `O` opens the next question … until none remain (`no_more_questions`).
5. `P` shows the podium (camera dollies 1.4 s; `list "Podium"` appears on arrival); `E` opens `dialog "End the night?"` (focus on "Keep going"); "End night" ends: "Night ended"; phones read "The night is over. Thanks for playing."; the PIN is free again; Valkey room keys expire in one hour.

### J4 Answering on a phone (brief: Journeys 4; DP-23–DP-25, DP-28–DP-30)
Tap a tile, move the estimate slider and press "Lock in estimate", or order items and press "Lock in order": `status "Answer status"` "Sending…" then "Locked in". After the deadline the server answers `409 window_closed` with negative `remainingMs`: "Too late — the server got it <late> ms after the bell." After an early lock: "Too late — the quizmaster locked this question." A second answer: "Already answered — your first answer stands." At each reveal the standing strip updates: "Rank <rank> of <seated> · <score> pts".

### J5 A phone reloads mid-question (brief: Journeys 5; DP-45, DP-46, DP-48)
Reload or wifi loss: the controller reads the stored rejoin token, `POST /api/rooms/rejoin` returns the same seat, nickname, score and streak with a new client id and retires the old one; the phone shows the current question or the reveal it missed. The retired client's stream receives one `superseded` message; any other tab shows "This seat is now open on another screen."

### J6 The venue's live link fails (brief: Journeys 6; DP-49–DP-51)
Valkey becomes unreachable: open streams close, `GET …/stream` answers `503 {"error":"live_unavailable"}`; stage and phones show `status "Connection status"` "Backup link: live updates are down. Answers still count." and poll `GET …/poll?after=<id>`; commands, answers, reveals and leaderboard continue from Postgres. When Valkey returns (server retry ≤ 5 s, client retry every 5 s) streams answer 200, the leaderboard set is rebuilt from `standings`, the status reads "Back on the live link". No restart.

### J7 The stage tab closes (brief: Journeys 7; DP-19)
The server locks at the deadline with no stage connected. The signed-in quizmaster reopens `/stage/<roomId>`: the stage shows the current state (open question with live countdown, locked question, reveal at final heights, leaderboard) and the controls legal from it.

### J8 Looking back (brief: Journeys 8; DP-54, DP-55)
`/host` → "Past nights" (`list "Past nights"`, newest first, each `link "<deck title> — <date>"` plus top three nicknames) → a night → `table "Final standings"` with columns Rank, Nickname, Score.

## 2. Palette roles (brief: Visual design / Colour roles; hex values decided)

| Role | Hex | Use |
|---|---|---|
| ground | `#0B1A14` (hsl 156 41% 7%) | every page ground and the stage clear colour; lightness under 12%, hue 156 |
| surface | `#112720` | panels, tiles, inputs |
| ink (chalk) | `#EDE9E1` (hsl 45 25% 91%) | text, numerals, tile outlines, focus ring |
| muted (slate) | `#93A89C` | dimmed options, secondary text, disabled controls |
| line | `#5F8071` | borders |
| brass | `#D2A24C` (hsl 39 62% 56%) | correct pillar, correct item mark, podium plinths, "Correct answer" on the phone reveal; nowhere else (brief: "reserved for the correct answer at reveal and for the podium") |
| coral | `#F2766A` (hsl 5 83% 68%) | last five seconds of a countdown, too-late message, refused-late states; nowhere else |

## 3. Type (brief: Visual design / Type)
Fraunces (self-hosted variable woff2, wght 100–900, opsz) carries the question band, the PIN, every count, score and rank, and the wordmark. Atkinson Hyperlegible (400, 700, self-hosted) carries all body text and controls. Heading steps scale by 1.333 (1, 1.333, 1.777, 2.369, 3.157, 4.209, 5.61, 7.478 rem). All numerals use `font-variant-numeric: tabular-nums`. Fonts are served from `/fonts/` of the app; no request leaves the origin.

## 4. Space, layout per viewport (brief: Screens and layout; DP-28, DP-43, DP-59)

| Screen | 375×812 | 768×1024 | 1280×800 |
|---|---|---|---|
| Join | one centred column: wordmark, PIN field, nickname field, button, link at the foot | same | same |
| Sign in / Create account | one centred column | same | same |
| Decks | deck row stacks title over count over button | title, count and button on one line | same as 768 |
| Deck editor | picture area below the fields | picture area below the fields | panels in a column 66.667vw wide, picture area right of the fields |
| Stage | one column: band, tiles (one column), timer, control bar after the tiles, wrapping to rows | same | band across the upper third (top 64 px, bottom ≤ 250 px, width viewport − 112 px), tiles 2×2, control bar pinned to the bottom edge |
| Phone | standing strip, question echo (3-line clamp, picture thumbnail beside), countdown in the top 40% (324.8 px); every answer control at or below 40% of the viewport height, at least 48×48 px, no scrolling | centred column ≤ 26rem | centred column ≤ 26rem |
| Past nights, Night results | table keeps Rank, Nickname, Score and wraps nicknames | same | same |
No screen scrolls sideways at any of the three sizes. Spacing unit 8 px (decided: airy direction); controls ≥ 44 px, phone answer controls ≥ 48 px (brief: Touch size).

## 5. Motion table (brief: Motion and effects)

| Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| Phone view | room state change | 250 ms cross-fade | ease | instant change |
| Pressed tile or button | press | background darkens within 90 ms | ease-out | none (colour change is instant) |
| Countdown numeral | each second | none, text changes | — | same |
| Pillar *i* (Tally Pour) | reveal arrives live | starts at 90 ms × *i*, settles ≤ 600 ms after its own start | critically damped spring, no bounce, no overshoot (`1 − e^(−11t)(1 + 0.35·11t)`) | still list of bars, final counts and shares at once |
| Count label | with its pillar | 0 → server count in whole numbers, never above, exact at settle | same spring | final count at once |
| Correct pillar / item | last pillar settled | colour switch to brass, others to slate; item gains " ✓ Correct answer" | — | marked at once |
| Replayed reveal | reload, reconnect, resume | none: final heights and counts at once, brass in place | — | same |
| Podium camera | podium step | 1400 ms dolly from the wide stage to the podium framing | cubic ease-out (brisk start, gentle landing) | still ranked list at once |
| `list "Podium"` | camera arrives | appears (opacity 0 → 1 at arrival, no transition) | — | visible at once |
| Idle 3D room | — | no motion: no drift, particles or looping glow; nothing responds to the pointer | — | no 3D room drawn |
At 768 and 375 (brief: Screens and layout) the stage stacks into one column and still plays Tally Pour and the podium dolly: the answer-split labels and the podium names sit in the column below an open stretch of floor where the pillars and plinths rise (decided: the brief makes the still versions depend only on reduced motion or missing WebGL).
Reduced motion (or no WebGL): no 3D room; reveal is `list "Answer split"` as still bars `"<label> — <count> (<share>%)"` (share = count ÷ sum of counts × 100, halves up; 0 when the sum is 0) with " ✓ Correct answer"; podium is the still ranked list; every CSS transition and animation is removed.

## 6. States per async action (brief: Feedback states; copy verbatim)

| Action | Region | Pending | Success | Errors |
|---|---|---|---|---|
| Sign in | `status "Account status"` | Signing in… | lands on Decks | `invalid_credentials`: That email and password don't match. |
| Create account | `status "Account status"` | Creating your account… | lands on Decks | `email_taken`: An account already uses that email.; field errors under fields |
| Create deck | `status "Decks status"` | Creating deck… | Deck created | field error under "New deck title" |
| Open room | `status "Decks status"` | Opening room… | stage | Add a question before opening a room. |
| Save title / question | `status "Editor status"` | Saving… | Saved | `version_conflict`: A newer version was saved elsewhere. Reload to see it.; field errors under fields |
| Upload picture | `status "Editor status"` | Uploading picture… | Picture attached | unsupported_type: That file isn't a PNG, JPEG or WebP picture. · image_too_large: That picture is too large for a question. · empty_file: That file is empty. · image_store_unavailable: Picture storage is down. The question is saved without a picture. |
| Remove picture | `status "Editor status"` | Removing picture… | Picture removed | image_store_unavailable copy |
| Join | `status "Join status"` | Joining… | `/play/<roomId>` | room_not_found: No live room has that PIN. · nickname_taken: That nickname is taken in this room. · room_full: This room is full. · room_closed: This night has reached the podium. Joining is closed. |
| Phone lobby | `status "Answer status"` | | You're in, <nickname>. Watch the big screen. | |
| Send answer | `status "Answer status"` | Sending… | Locked in | window_closed negative: Too late — the server got it <late> ms after the bell. · zero or positive: Too late — the quizmaster locked this question. · already_answered: Already answered — your first answer stands. |
| Phone state | `status "Answer status"` | | Question <n> is open · Time's up · Answers are in · Leaderboard is on the big screen · Podium time — watch the big screen · The night is over. Thanks for playing. | client_superseded: This seat is now open on another screen. |
| Host command | `status "Stage status"` | | Question <n> open · Locked · Revealed · Leaderboard · Podium · Night ended | illegal_transition / no_more_questions: That step isn't available right now. |
| Idle end | `status "Stage status"` | | Night ended because the room sat empty. | |
| Live link | `status "Connection status"` | Reconnecting… | Back on the live link | Backup link: live updates are down. Answers still count. |
| Picture in a question | picture slot | | the picture | Picture unavailable |
| Past nights | list area | Loading nights… | the list | No nights yet. |

## 7. API and rule values (brief: API, Business rules, Services)
- Error shape `{"error":"<code>"}`; validation `422 {"error":"validation_failed","fields":{…}}`. Precedence: cross-origin and size (403 `cross_origin`, 413 `payload_too_large` at 64,000 JSON bytes, 2,100,000 upload bytes) → 401 → 404 → 409/410/412 → 413/415 picture → 422.
- Ids are UUIDs; client ids and rejoin tokens are 43-character random strings (256 bits).
- Question rules: prompt 1–200, time limit whole 5–120 s, multiple choice 2–4 options of 1–80, estimate min < max, step > 0, answer within, tolerance 0…(max − min), unit 0–20, sequence 3–6 items unique ignoring case; deck title 1–80, at most 50 questions.
- Pictures: 2,000,000 bytes allowed, 2,000,001 refused; checks in order empty_file 422, image_too_large 413, unsupported_type 415, then MinIO (503); key `questions/<questionId>/<sha256>.<png|jpg|webp>`; presigned GET lifetime `IMAGE_URL_TTL_SECONDS` (default 120).
- State machine (`shared/machine.ts`): open_question (lobby, leaderboard) → question_open; lock → locked; reveal → reveal; show_leaderboard → leaderboard; show_podium (leaderboard) → podium; end (podium) → ended; plus server auto-lock and idle end.
- Scoring: base = 1000 − floor(500 × latency / window); fully correct: floor(base × (10 + min(streak − 1, 5)) / 10); sequence partial: floor(base × k / n), streak 0; wrong or none: 0, streak 0. Ranking: score, lower cumulative response time (latency, or the full window for each question opened after the seat joined that it did not answer), earlier join. Estimate bins: eight equal bins, lower edge included, last bin includes max.
- Events: ids per room from 1, strictly increasing, written in the same transaction as the change; `answer_count` per answer, `player_joined` per join, `presence` per change of the connected set.
- Valkey keys: `lastbell:room:<roomId>:leaderboard` (sorted set of seat ids), `…:clients` (set of client ids with an open stream), `…:replay` (last 500 events), channel `…:events`; each key expires one hour after the room ends.
- Seed (brief: Seed data): Ines Talbot, Rowan Pike, their decks, and the ended night of 2026-10-27 21:40 UTC with five seats.

## 8. Breakpoints (decided from the brief's three graded sizes)
375 (phone, stacked), 768 (tablet: deck rows on one line, editor fields in two columns), 1100 (stage tiles 2×2), 1280 (editor two-thirds column with the picture beside the fields).

## 9. Media and licences
No photographs, audio or video. The 3D room, pillars and plinths are drawn in Three.js from primitives and a canvas-drawn chalkboard texture (original). Icons: Lucide (ISC) inline SVG. Tally marks and empty-state drawings are inline SVG (original). Fonts: Fraunces and Atkinson Hyperlegible, SIL Open Font License 1.1, vendored from Fontsource (`app/assets.json`, `app/THIRD_PARTY_NOTICES.md`). Question pictures are the quizmaster's own uploads, served only through presigned MinIO links.
