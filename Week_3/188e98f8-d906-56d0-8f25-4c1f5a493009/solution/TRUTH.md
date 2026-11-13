# TRUTH — Roundkeeper golden

The brief made concrete. Every value says where it came from: `brief: <section>` (copied verbatim) or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## 1. Ideal end-to-end flows

### J1 Before the night (quizmaster, picture sheets)
- Start: fresh database; rounds 1-8 drafted; rounds 3 and 6 show `Sheet not stored` (brief: Journeys 1, Seed data).
- Open `/quizmaster` signed out: the server redirects to exactly `/sign-in` (brief: Server boundary). Desk code focused (brief: Focus and keyboard).
- Type `HOST-4417`, Enter: `POST /api/session` 201 sets the `rk_desk` cookie (HttpOnly; decided: a session cookie lasts until sign-out); the browser goes to `/quizmaster`, focus on `heading "Quizmaster's desk"`, page at the top (brief: DP-61).
- Round 3 card: Tab from `Open round 3` to the file field, Enter opens the chooser, pick an image, Tab to `Upload`, Enter. Pending `Storing sheet`; `PUT /api/rounds/3/sheet`; the server checks the bytes against the declared type and the 200-4,000 px dimensions, writes `sheets/night-4/round-3/<sha256>.png` to MinIO, reads the object back and compares size and SHA-256, then answers 201. Card shows `Sheet stored`; Desk messages `Sheet stored for round 3.` for 6 s; focus stays on `Upload sheet for round 3` (brief: Feedback states).
- A second quizmaster device shows `Sheet stored` within one 3 s poll without moving its focus (brief: Live updates).
- Round 6, `Upload` with no file: no request, `Choose a sheet image to upload.`, focus on Upload. `Open round 6` is enabled; the server answers 409 `sheet_not_stored`; the card shows `Upload and store the picture sheet before opening round 6.` and round 6 stays drafted.

### J2 Running a round
- Quizmaster activates `Open round 1` by keyboard: `POST /api/rounds/1/open` sets `opened_at` and `closes_at = opened_at + ROUND_SECONDS`; focus moves to `Close round 1` on the same card; all strips show `Round 1 · Open` within one poll (accent fill).
- Captain (375x812, touch) taps Desk code, types `CAP-05`, taps Sign in, lands on `/captain` (focus on `Answer desk`, no sideways scroll). The form `Round 1 answers` shows the countdown `<m>:<ss> left` above Question 1, pinned to the top below 768 px while the fields scroll.
- Eight answers, each with `used/120`; Enter moves to the next field, Enter in Question 8 submits. `POST /api/rounds/1/answers` with a fresh `Idempotency-Key`; 201 stores NFC-normalised, trimmed text; `Answers in for round 1.`; `list "Accepted answers"` fades in over 240 ms.
- Countdown resets from `seconds_left` on every poll and ticks once a second; ticks and polls never touch the fields, caret or focus.
- At `closes_at` (or the quizmaster's close) the server closes the round (`closed_at = closes_at` for the timer). Within one poll every chip reads `Closed`, the captain's fields become read-only in place, `Round 1 is closed. Answers are no longer taken.` shows once per round per device, the quizmaster's Close button disappears and focus on it moves to the card. The read-only form stays until another round opens. A submit with time still on the phone clock gets 409 `round_closed`.

### J3 Rename
- Captain: `Rename team` opens the dialog (pane from 768 px, sheet below), prefilled, focus in Team name, counter `<used>/40`. Enter or `Save name`: `PATCH /api/teams/{id}`; `Team name saved.`; the dialog closes and focus returns to `Rename team`. Table `version` stays; within one poll the tile on `/`, `/captain` and `/quizmaster` shows the new name as the same element.

### J4 Marking
- Marker opens `Mark round n` (closed round): pane lists every current answer in API order (question, then team id). Current row = first unmarked. `C` correct, `X` wrong (saves, moves to the next unmarked row), `J`/`K` move, arrows and taps choose a mark and make that row current; Ctrl/Meta/Alt disable the keys. Marks from another marker appear in place on the next poll. `Finish marking`: 409 `unmarked_answers` shows `Answers left to mark in round n: <count>.` and the pane stays; success closes the pane, focus on `heading "Marking"`, `Round n is marked.`.

### J5 Archive and search
- `/archive`: first page loads on open; `More answers` appends below, focus on the first appended row without scrolling; an empty page shows `No newer answers yet.`. Times sent are `HH:MM:SS` of `submitted_at` in UTC. Search: plain text, case- and accent-insensitive, up to 100 results, `Answers matching: <count>.`; ArrowDown from the field walks the result rows, Escape returns to the field.

### J6 Dispute
- Captain: on a `marked` round each zero-marked current answer without a dispute has `Dispute question q`; the sheet takes a reason (`<used>/280`); 201 shows `Dispute sent to the quizmaster.`, the row reads `Raised` and focus goes to the next Dispute button or `Answer desk`. Quizmaster: `Rule on <team>, round n, question q` opens `Rule on dispute`; `U`/`D` choose; `Save ruling` sets the ruling (409 `dispute_already_ruled` if another device ruled first), sends one note to the raising captain through Mailpit, and shows `Ruling saved. The captain's note is on its way.`. The captain's phone shows `Dispute ruled: <ruling> for round n, question q.` once.
- A poll reporting the round published removes the Dispute buttons in place (focus to `Your marks`); an open sheet stays and its Send shows `Disputes for round n are closed.`.

### J7 Publish
- `Publish round n` (409 `disputes_pending` with count while disputes are raised). 200 returns round and table; `version` +1. Every tile screen runs the Tally cascade: flips in previous order (70 ms apart, 360 ms each), then slides to new places with totals counting up (420 ms); Table news speaks only after settling (about 1.55 s for twelve tiles). Reduced motion: 120 ms crossfade, final places and totals and the news on the first frame.

### J8 Storage down
- Upload or open of a picture round with a stored sheet answers 503 `storage_unavailable`; the card shows `Sheet not stored — storage is unreachable. This round cannot open yet.` until the next upload or open attempt on that card is answered; Desk messages shows it for 6 s only; the round stays drafted.

## 2. Palette roles (brief: Visual design, Published tokens)
| Role | Hex | Where |
|---|---|---|
| ground | #F3EDE2 | page, tiles, cards |
| ink | #1F1A17 | text, rules, borders |
| accent (ale red) | #B5462B | only the open-round chip and the position-1 tile (white text) |
| secondary (bottle green) | #2F5D50 | buttons (white text), links, focus outline, marked chip |
| muted (malt tan) | #C9B99A | drafted chip, dividers, error band |
Chips: drafted tan/ink, open red/white, closed ground/ink, marked green/white, published ink/ground (brief). Error band: ink text on tan with a 2px solid ink left edge (brief). Backdrop: ink at 55% (decided: a dimmed backdrop is required, the strength is free).

## 3. Type, space and layout per viewport
- Body: Atkinson Hyperlegible 18px (brief). Display: Fraunces; h3 23.99px, h2 31.98px, h1 42.63px (18px x 1.333 per level; brief). Tabular figures on every number (brief). Counters 15px, chip text 15px (decided: above the 12px floor).
- Tiles and cards: 12px radius, 2px solid ink; buttons and inputs 8px radius (decided: inputs must not match the card rule). Tile gap 16px (decided).
- 375x812 (<600): strip two rows of four chips scrolling inside itself; 2 tile columns; sign-in card = width - 32; one answer field per row, countdown pinned; dialogs are full-screen sheets; archive rows are stacked cards (six labelled fields).
- 600-767: one-row strip; 3 tile columns; sign-in card 420 px centred; quizmaster cards in two columns; archive five columns with time sent under the answer.
- 768x1024: dialogs are right panes of max(480 px, 50% of the width); answer fields in two columns, countdown scrolls with the page.
- 1024+/1280x800: 4 tile columns; archive six columns; quizmaster cards in the left two thirds, Disputes in the right third, tiles below.

## 4. Motion table (brief: Motion and effects)
| Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| pane (>=768) / sheet (<768) | open, close | 600 ms | cubic-bezier(0.2, 0.8, 0.2, 1) | 120 ms opacity crossfade, no movement |
| backdrop | with the panel | 600 ms | same | 120 ms fade |
| press | button down | 80 ms | same | colour only, no movement |
| tile hover | pointer over tile | 100 ms | same | same (colour/border only) |
| chip recolour | status change | 240 ms | same | 120 ms |
| accepted answers | submit accepted | 240 ms | same | 120 ms |
| tile flip | cascade | 360 ms, 70 ms stagger | same | one face, 120 ms crossfade |
| tile slide + total count | after the last flip | 420 ms | same | final places and totals on the first frame |
Cascade timing is driven by requestAnimationFrame on `performance.now()` (decided: the verifier steps the page clock); panes use `element.animate()` and presses/hovers CSS transitions so they can be finished and seeked.

## 5. States per async action (brief: Feedback states)
Sign in `Checking code` -> `That code does not open a desk.`; any 401 -> `/sign-in` with `Your desk session has ended. Sign in again.`; submit `Sending answers` -> `Answers in for round <n>.` / over limit / `Round <n> is closed. Answers are no longer taken.` / `Too many submits. Please wait <seconds> s and try again.`; rename `Saving name` -> `Team name saved.` / `A team needs a name.` / `Team names can be up to 40 characters.` / `Another team already has that name.`; upload `Storing sheet` -> `Sheet stored for round <n>.` / `Choose a sheet image to upload.` / `Sheets must be PNG or JPEG images.` / `Sheets can be up to 5,000,000 bytes.` / `Sheets must be 200 to 4,000 pixels on each side.` / the outage line; open `Opening round <n>` -> `Round <n> is open.` / sheet missing / `Close the open round before opening another.`; close `Closing round <n>` -> `Round <n> closed by the quizmaster.`; mark `<team name>, question <q>: correct.|wrong.`; finish `Finishing round <n>` -> `Round <n> is marked.` / `Answers left to mark in round <n>: <count>.`; archive `Loading answers` / `No newer answers yet.`; search `Searching` -> `Answers matching: <count>.` / `No answers match "<query>".` / `Type something to search for.` / `Searches can be up to 80 characters.` / `That search took too long. Try a shorter spelling.`; dispute `Sending dispute` -> `Dispute sent to the quizmaster.` / `Say what was wrong with the mark.` / `Reasons can be up to 280 characters.` / `Disputes for round <n> are closed.`; ruling `Saving ruling` -> `Ruling saved. The captain's note is on its way.` / `This dispute was already ruled.`; publish `Publishing round <n>` -> Table news `Round <n> published. Leader: <team name> on <total> points.` / `Open disputes left on round <n>: <count>. Rule on them before publishing.`; no response or unlisted 5xx -> `The desk can't reach the server. Trying again.`; unknown page -> `No such page in the quiz book.`.
Decided copy (the brief gives none): `Choose Uphold or Dismiss.` (Save ruling with no choice), `No disputes are waiting for a ruling.` (empty queue), `Marks appear here once the marker has finished a round.` (empty Your marks), `Nothing matched that spelling.` (empty results), `Back to the league table`, `Back to the desk`, `Desk sign-in`.

## 6. Server behaviour fixed by the brief
Error precedence: boundary (404 / 405 with Allow / 413 / 415 / 400 bad_json) -> 401 -> 404 -> 403 -> 429 -> idempotency -> 409 -> 422 -> 503. Submit allowance 6 per rolling 60 s, counted at the rate step. Search budget 1.5 s (database statement timeout 1.2 s -> 503 `search_timeout`). Ruling note: To the captain email, From `MAIL_FROM`, subject `Ruling on round <n>, question <q>`, four body lines; `note` becomes `sent` only after the mail server accepts it, `queued` and retried every 10 s while it is unreachable. League total = seeded past scores + ruled score of current answers in published rounds, ordered by total then name in code-point order (decided: derived at read time, never stored).

## 7. Breakpoints
600, 768, 1024 CSS px, exact at each and one pixel either side (brief). Nothing else changes a layout.

## 8. Media and licences
- Fonts: Fraunces (variable weight axis, latin) and Atkinson Hyperlegible (400, 700, latin), self-hosted woff2 from Fontsource, SIL OFL 1.1 (brief: Published tokens; listed in `app/assets.json` and `app/THIRD_PARTY_NOTICES.md`).
- Coaster mark, check, cross and chevron: drawn inline as SVG for this app, licence `original` (decided: the masthead and empty states want a drawn subject).
- Picture-round sheets are quizmaster uploads at run time, never shipped.
