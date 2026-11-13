# TRUTH — Holloway Carriage Co. Strikeproof

The intended behaviour of the golden app. Every value says where it comes from: `brief: <section>` is copied from
`instruction.md`; `decided: <why>` is a choice where the brief is silent, tied to its intent.

## Journeys

### 1. A timed test and its certificate
1. Start: a signed-in, verified typist opens `/`. The typing input has focus (`brief: Interactions, Getting a test`), three lines
   of words show, the timer shows `15`, live speed `0`, live accuracy `100%` (`brief: Readouts`).
2. Typing: every keydown of a printed character, Space, Backspace or Ctrl/Alt+Backspace is logged with `t = Math.round(now - start)`;
   `start` is the first logged key (`brief: Keystroke log`). Letter `data-state` and the caret's `data-word` and `data-letter` follow the
   engine after each key (`brief: Words area contract`).
3. Each whole second after the first key the timer, speed and accuracy update (`brief: Readouts`).
4. At exactly 15000 ms the end timer fires, later keys are ignored and not logged, the certificate rises in 480 ms
   (`brief: Motion and effects`). The Test result region announces `Speed 55.00, accuracy 91.67%, raw 60.00, consistency 73.24%.`-style line once
   (`brief: Feedback states`).
5. The seal reads `Held: replay in progress`, then `Counted` (plus `New personal best`); the stub shows `Proof <first 16 characters>`.
   Provider-recorded end state: one `runs` row in PostgreSQL with the first body's bytes and its SHA-256 proof key (`brief: Proof key`).
6. A restart ten seconds in cancels the old test's end timer, tick timer, focus timer and resend loop (`brief: Timers belong to their test`).

### 2. Corrections, restart and the command line
Backspace and Ctrl/Alt+Backspace follow the engine rules (an empty word steps back only into an erroneous word). Tab then Enter (quick restart
`tab`) or Enter alone (`enter`) restarts with fresh words. Escape opens the Command line; typing filters (every space-separated part must
appear, case-insensitive); Enter applies; `<label> applied.` is announced. Overlapping ticket requests end on the latest ticket; settings saves
are sent one at a time carrying the latest choice. After reload the last settings remain (server for signed-in, browser for guests)
(`brief: Interactions`).

### 3. Quotes and custom text
Quote mode removes the Punctuation and Numbers boxes and shows `#quote-source`. The Custom text dialog counts live, shows the limit message
and disables Use text over 2000 characters or 400 words (code points). Use text requests a custom ticket with `length` null; Escape requests
the remembered text, or returns to the mode before custom (`brief: Interactions, Custom text`).

### 4. Watching the proof
The Replay position slider spans 0 to the run's whole seconds, moves by ArrowLeft/Right/Up/Down (1), PageUp/PageDown (5), Home, End and by
pointer or touch; the carbon, its caret, the numeral, chart point and table row follow. On `/runs/<id>` every move replaces the address with
`?at=<s>` without adding history. Refusals are filed with a 422 code and shown as `Not counted: <reason>`; 404, 410 and 413 refusals file nothing.

### 5. Typing on a phone
At 375 px the navigation is a fixed bottom bar, dialogs are inside the viewport, input events (`insertText`, `deleteContentBackward`,
`deleteWordBackward`, or keydown `Unidentified`/229) are typed once each, typing never scrolls the page, and the slider has `touch-action: none`.

### 6. From sign-up to history
Sign-up creates an unverified signed-in account and queues one verification mail (`Verify: <APP_PUBLIC_URL>/verify/<token>`); an unreachable SMTP
server answers `mail: "retrying"` and the mail is retried every `MAIL_RETRY_SECONDS`, delivered exactly once. Unverified runs are not submitted.
After verifying, the next run is counted and marked a personal best; it appears in history (filters in the URL) and on the account page. Another
typist gets `No such run.` A password reset ends every session of the typist and closes their live connections within 5 seconds.

### 7. Boards
The daily board splits at 00:00 UTC; every date is shown in UTC. A new eligible counted run is pushed over the WebSocket to every open board of
that length within 3 seconds and announced in Board updates. Tabs move by ArrowLeft/ArrowRight with roving focus and keep the choice in the URL.

### 8. A private race
Create room returns a `XXX-XXX` code (alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789`); joins accept any case with or without the dash; at most 8 seats,
claimed synchronously in the server process. Start needs two racers and the host; the server pushes `3`, `2`, `1`, `Go`. The server computes
progress from pushed entries; finishes are replayed and placed by replayed duration with shared places. A reload within `RACE_REJOIN_SECONDS`
restores typed words and the caret from the server and continues from `elapsedMs`.

## Palette roles

| Role | Value | Source |
|---|---|---|
| ground (sand) | #E6DBC7 | brief: Themes and type size |
| ink / accent / drawer field (cobalt) | #062B8A | brief: Themes and type size |
| muted | #3A5AA8 | brief: Themes and type size |
| surface (darker sand) | #D4C9B7 (ground 92% with black 8%) | decided: a slightly darker sand for panels set on the sand |
| cobalt theme | ground 6,43,138; ink 230,219,199; muted 170,184,214 | brief: Themes and type size |
| carbon theme | ground 31,29,26; ink 232,225,211; muted 168,160,146 | brief: Themes and type size |
| ledger theme | ground 244,241,232; ink 29,59,42; muted 74,110,88 | brief: Themes and type size |
| untyped letter | ink at 80% alpha | decided: at least 4.5:1 in all four themes (5.7:1 on sand) |

## Type, space and layout per viewport

| Item | Value | Source |
|---|---|---|
| Display face | Bodoni Moda (wordmark, headline, section headings, speed figure 72-96 px, replay numeral) | brief: Typefaces |
| Text face | Jost, tabular digits | brief: Typefaces |
| Heading scale | 1rem, 1.333, 1.777, 2.369, 3.157 rem (each step one third larger) | brief: Scale |
| Words area | font `n x 24px`, line height `1.5 x` that, height exactly three lines | brief: Themes and type size |
| Phone (375x812) | navigation fixed to the bottom, each link at least 44 px; sheet full width; history as index cards; card above carbon | brief: Screens and layout |
| Tablet (768x1024) | tabs across the top; sheet spans the width with margins; mode row wraps; card above carbon | brief: Screens and layout |
| Desktop (1280x800) | sheet is a centred column at two thirds of the width; card left, carbon right | brief: Screens and layout |
| Certificate card | 5:7 | brief: Certificate |

## Motion table

| Element | Trigger | Duration | Easing | Reduced-motion substitute | Source |
|---|---|---|---|---|---|
| certificate | test ends | 480 ms, rises 24 px and fades in | cubic-bezier(0.2, 0.7, 0.2, 1) | appears in place | brief: Motion and effects |
| seal | verdict arrives | 240 ms, scale 1.2 to 1 | ease-out | text swaps | brief: Motion and effects |
| carbon letters | playhead moves forward | 120 ms ink-in; backward is instant | ease-out | letters show at once | brief: Motion and effects |
| caret | each keystroke, smooth caret on | 100 ms glide | ease-out | jumps | brief: Motion and effects |
| folder tabs | hover or press | 160 ms, rise 2 px | cubic-bezier(0.2, 0.7, 0.2, 1) | no rise | brief: Motion and effects |
| footer | page scroll | curtain reveal | none | normal flow | brief: Motion and effects |

## States per async action

| Action | Pending | Success | Failure | Source |
|---|---|---|---|---|
| Ticket request | words area `aria-busy="true"` | words appear, input focused | `alert`: `Could not start a test. Check your connection and try again.` | brief: Feedback states |
| Run submission | seal `Held: replay in progress` | `Counted` (+ `New personal best`) | `Not counted: <reason>`; network failure or 5xx resends the identical body every 5 s | brief: Feedback states |
| Sign-up, sign-in, reset | submit disabled | check-your-email / return to the page / notice | field errors, `alert`, rate-limit text | brief: Feedback states |
| History filter, Older runs | table `aria-busy="true"` | rows update in place | n/a | brief: Feedback states |
| Board and race updates | live, in place | announcements | reconnect within 5 seconds and reload state | brief: Feedback states |

## Breakpoints

768 and 1280 px only; the published viewports are 375x812, 768x1024, 1280x800 (`brief: Screens and layout`).

## Media and licences

No pictures. The keyboard of errors and the chart are drawn as inline SVG. Fonts: Bodoni Moda and Jost, self-hosted woff2 (latin variable),
SIL OFL 1.1, listed in `app/assets.json` and `app/THIRD_PARTY_NOTICES.md`. Code: preact, pg, ws (MIT) and their dependencies (MIT, ISC).
