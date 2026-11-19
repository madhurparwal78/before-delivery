# TRUTH — Lanternfold Rooms (golden)

The brief made concrete. Every value says where it came from: `brief: <section>` (verbatim) or
`decided: <why>`.

## Journeys, end to end

### 1. Prepare a workshop (brief: Journeys 1; DP-02, DP-08, DP-09, DP-65, DP-66)
- Start: Juno signed in on `/workshops` (brief: Screens and layout).
- "New workshop" opens `dialog "New workshop"`; Title "Ação às 9h – Zoë", radio "Discovery sprint", Starts/Ends
  typed as `YYYY-MM-DDTHH:MM`, Sponsor email, Client fee (EUR) "1250.10"; "Create workshop" reads "Creating…"
  while pending (brief: Feedback states).
- A start or end in a spring-forward gap stays in the dialog with "That time doesn't exist in Europe/Lisbon
  because the clocks go forward" under its field; nothing is created (brief: API field messages).
- Success: the room `/w/<id>` opens in Draft with "Problems", "Opportunities", "Questions" in the rail; Board
  activity reads "Workshop created from the Discovery sprint template"; the drawer shows the join URL and
  "Works until <date, HH:mm> (Europe/Lisbon)", the resolved end plus 86400 s (brief: Join links; decided: the
  wording around the instant).
- Invites: a batch with `"Bram Client" <x@y>` answers 422 and shows "Every entry must be an email address"
  under "Client emails"; nothing is sent. The fixed batch sends one message per distinct lower-cased address,
  subject "You're invited: <title>", one To; Board activity "Invites sent to 2 people"; `list "Invites"` shows
  "<email> — sent" (brief: Invite batches, Mail).

### 2. Brainstorm in silence (brief: Journeys 2; DP-05, DP-11..DP-14, DP-18, DP-63, DP-68)
- Participant opens `/join/<token>`, types a name, "Join workshop" ("Joining…"), lands in the room in Open.
- Facilitator types the round length and presses "Start silent round"; Board activity "Silent round started —
  ends at <hh:mm>" in the facilitator's zone; `timer "Session timer"` counts down each second from the server
  deadline corrected by the server-time offset; rust in the last minute; "Time's up" at zero.
- "Add note" opens the editor on the frame nearest the view centre; "Save note" (or Ctrl/Cmd+Enter) closes the
  editor and the note appears at once with "Saving…"; network failures retry every second with the same
  `clientOpId` and Board problems reads "Couldn't reach the board — retrying your note."; success reads "Note
  added to <frame title>" (brief: Feedback states; decided: 1 s retry interval).
- Other people's notes are `button "Hidden note"` outline card backs at their real positions with no text node;
  the facilitator's read "Hidden note by <name>" and show only the name; counters read "<n> hidden".
- Image: "Add image" picks a file, toolbar reads "Uploading…", the image note lands; Delete removes it, Board
  activity "Note deleted", its URL answers 404 at once and the MinIO object is removed.
- After the deadline the server answers `deadline_passed` to Add note.
- Cursors: participants receive none during the silent round.

### 3. Reveal, search and cluster (brief: Journeys 3; DP-15..DP-17, DP-23..DP-26, DP-60, DP-67)
- "Reveal": every board's next render compares with its last render; when the last was `silent_round` and the
  new one is past it, the cards that were backs flip in a wave per frame and Board activity announces "Round
  revealed: <n> notes in <frame> frame" per announced frame in rail order (preceded by "Back online" after a
  drop); focus moves to the first announced frame's heading. A fresh load shows faces with no flip.
- Search: 333 ms after the last keystroke or on Enter; results are buttons named by note text; pressing one
  centres the note, focuses it and empties the list; Escape clears the box.
- Drag onto a cluster places the note at the drop row; cluster counts update live on every instance.
- Keyboard: Space picks up ("Picked up. Up and down arrows reorder, M moves to another cluster or frame, Space
  drops, Escape cancels."), arrows announce "Position i of n in <cluster>", Space drops ("Dropped. Position i of
  n in <cluster>") and saves, M opens `dialog "Move note"` with `listbox "Destinations"`, Enter moves ("Moved to
  <title>, position i of n"), Escape cancels ("Move cancelled. Note returned to <title>."). Focus stays on the
  note throughout.

### 4. Vote (brief: Journeys 4; DP-27..DP-29, DP-57, DP-69)
- "Start voting" with "Voting length in minutes" and "Dots per person" → "Voting started — 3 dots each".
- Participants: "Add dot to <cluster>" / "Remove dot from <cluster>", disabled while pending; "Dot placed on
  <cluster>. <n> left."; drawer "<n> of <budget> dots left"; cluster "<n> of yours". A fourth dot shows "You have
  no dots left" in Board problems.
- Facilitator: `list "Vote totals"` in ranking order "<title> — <n> dots", digits rolling.
- "Turn off join link" → "Join link turned off. Everyone who joined with it has been disconnected."; the
  participant's stream gets `ended` and the page shows only "This join link is no longer active. Ask your
  facilitator for a new one."; their dots stay.

### 5. Recover a mistake (brief: Journeys 5; DP-31, DP-32, DP-59, DP-70)
- "Frame options" → "Move to trash": frame leaves the rail, Board activity "Frame <title> moved to trash" with
  an "Undo" button for 10 s.
- "Trash" dialog rows "Deleted <date>, purged <date>" with "Restore <title>" → "Frame <title> restored with
  <n> notes".
- "Versions" dialog rows "Version <v> — Autosave — <date>, <HH:mm>"; "Restore version <v>" asks "Restore version
  <v>? The current board is saved as a version first." with Restore/Cancel → "Board restored to version <v>. The
  previous board is saved as version <saved>."

### 6. Close and deliver (brief: Journeys 6; DP-33..DP-37, DP-52, DP-58)
- "Close workshop" → `dialog "Close workshop"` → "Close and send recap" → "Workshop closed. Preparing the
  recap."; drawer "Recap in progress" then "Recap sent to <n> people", "Invoice <number> — €1,250.10" and
  `link "Open recap page"`.
- Provider end state: Kill Bill account `sponsor:<email>` holds one invoice of 1250.10 EUR; MinIO holds
  `recap/board.pdf`, `recap/notes.csv`, `recap/frames/<id>.png`; Mailpit holds one "Recap: <title>" per
  recipient.
- Recap page `/recap/<token>`: "Recap: <title>", status, invoice line, `list "Recap files"`, `list "Cluster
  ranking"` with frame, title, dot total and note texts.

### 7. Bad connection and outages (brief: Journeys 7; DP-10, DP-19, DP-22, DP-36)
- Stream drop: top bar and Board activity read "Reconnecting to the board…"; reconnect retries every second
  (decided) with `Last-Event-ID`, then "Back online".
- A failed move glides back over 300 ms with a rust ring fading over 1 s; Board problems "Move not saved —
  you're offline. The note is back where everyone else sees it."
- Storage down at close: recap queued "Recap queued — file storage is unavailable. It will finish
  automatically."; no email or invoice; completes on the healthy instance's worker.

### 8. Change plan (brief: Journeys 8; DP-46..DP-51)
- `/billing`: "Agency" + "Monthly" + "Change plan" ("Changing…") → "Plan changed to Agency (Monthly). Invoice
  <n> for €<amount>."; meters slide to the new caps.
- "Studio" → "Studio (Monthly) starts on <date>." and "Changes on <date> to Studio (Monthly)".
- Kill Bill down → "Billing is unavailable. Your plan hasn't changed — try again shortly."; the page shows
  "Showing your plan as of <date>, <HH:mm> — billing is unavailable."

## Palette (brief: Visual design; hex decided in DESIGN.md)

| Role | Hex | Source |
|---|---|---|
| ground (paper) | `#F6F1E7` | brief: warm off-white; decided: hex |
| dot grid | `#D6CCBA`, 24 px SVG tile, canvas only | brief: faint dot grid |
| ink | `#2A2420` | brief: warm near-black |
| muted (secondary, card backs, frame rules) | `#675D52` | brief: muted warm grey |
| sticky / edge / ledge | `#FBE48C` / `#D9B94E` / `#C7A23B` | brief: butter yellow, darker edge, crisp shadow |
| accent (rust, live state only) | `#B0431C` | brief: one rust-orange accent |
| blush, warm grey (mesh only) | `#EFC9B6`, `#CFC5B6` | brief: mesh colours |
| surface (sheets, drawer, dialogs) | `#FBF8F2` | decided: a lifted sheet of the same paper |

Gradients: hero mesh, Studio card border (rust → butter), cursor halo, sticky sheen — nothing else (brief).

## Type and space

- Instrument Serif display; IBM Plex Sans body 16/1.5; IBM Plex Mono for timer, counters, prices, meters, totals
  (brief: Type). Scale 16 × 1.25ⁿ: 20, 25, 31.25, 39.06, 48.83, 61.04 (brief: quarter-step).
- Controls ≥ 44 × 44; focus ring 2 px ink `outline` offset 2 px on the element itself (brief: Size, Keyboard).
- Sticky 176 × 104, padding 14, 1 px border, `3px 3px 0 0` ledge `box-shadow`; clusters 200 wide, 44 header,
  10 gap (decided: shared with the recap PNG via `shared/layout.ts`).

## Layout per viewport (brief: Screens and layout; breakpoints decided)

| Width | Landing | Room |
|---|---|---|
| ≥ 1100 (1280×800) | two columns, hero ≤ 720 px tall so it sits inside the first 800 px | rail 216 + canvas + drawer 340 docked |
| 640–1099 (768×1024) | one column, demo under the headline at column width, plans 2 + 1 | rail 200 docked; "Session" opens the drawer sheet from the right |
| < 640 (375×812) | one column; eyebrow, headline, lede, then the demo (fully inside the first viewport), then the rest; plans 1 per row | "Frames" sheet from the left, "Session" sheet from the bottom, search behind "Search" |

On load the canvas fits every frame in view (decided: so every frame and its controls start on screen).

## Motion (brief: Motion and effects)

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| hero mesh | always, paused off-screen or hidden tab | 12 s alternate (24 s cycle), ±2.5 % translate | ease-in-out | none |
| scroll demo | scroll; progress 0 at 90 % → 1 at 30 % of viewport | discrete per rank | — | cards face up, still |
| Play the reveal | button | flips 420 ms, 24 ms per rank | cubic-bezier(.3,.9,.4,1) | 150 ms crossfade |
| pricing thumb / prices | term radio | 250 ms / 400 ms digit roll | cubic-bezier(.2,.8,.2,1) / (.16,1,.3,1) | instant |
| card entrance | first board load | 240 ms, 18 ms apart, last start ≤ 560 ms | cubic-bezier(.2,.8,.2,1) | none |
| note lands | new note or card back | 180 ms | ease-out | none |
| lift | pick-up or drag | 120 ms scale 1.04 + rust ring | ease-out | ring only |
| spring drop | release | k 400, c 32, m 1, ends < 0.5 px, ≤ 600 ms | precomputed linear keyframes | jump |
| snap-back | failed move | 300 ms glide, ring fades 1 s | ease-out | jump, ring 1 s |
| tickers | vote totals, cluster totals, dots left, meters | 400 ms | cubic-bezier(.16,1,.3,1) | final value |
| meter fill | usage change | 600 ms scaleX | cubic-bezier(.2,.8,.2,1) | final fill |
| cursor glide | presence event, applied on the next animation frame (decided: a room's burst of cursor events renders once) | 100 ms | linear | jump |
| sheets / dialogs | open | 250 ms slide / 180 ms rise | soft / ease-out | instant |
| hover / press | pointer | colour instant; press translate(2px,2px) 80 ms | ease-out | colour only |
| reveal wave | wave rule | 420 ms per card, 24 ms per rank (shortened past 21 ranks to ≤ 480 ms), back swapped at the edge-on midpoint | cubic-bezier(.3,.9,.4,1) | 150 ms crossfade, focus to first announced heading |

All are Web Animations on `transform`/`opacity`; nothing transitions colour or layout (brief: DP-43).

## States per async action (brief: Feedback states)

Pending copy: "Signing in…", "Creating…", "Joining…", "Working…", "Sending…", "Saving…" tag, "Uploading…",
"Changing…", "Retrying…", "Restoring…", "Searching…". Success to `status "Board activity"` / `status "Billing
activity"`; failures to `alert "Board problems"` / `alert "Billing problems"`; other pages use their `alert` and
field messages. Each message stays until the next one in its region replaces it.

## Media and licences

| Item | Licence | Source |
|---|---|---|
| IBM Plex Sans, IBM Plex Mono (TTF) | OFL-1.1 | brief: Type; github.com/IBM/plex |
| Instrument Serif (TTF) | OFL-1.1 | brief: Type; github.com/Instrument/instrument-serif |
| Lucide icons via lucide-react | ISC | brief: Icons |
| favicon, dot grid, cursor glyph | original | drawn in SVG/CSS for this app |
| hero mesh `client/mesh.png` (48×28, upscaled smoothly) | original | drawn by `mesh.py` for this app; decided: one image instead of four radial-gradient layers keeps the drifting layer cheap to draw, which keeps the next page's frames running in software-rendered Chromium |
