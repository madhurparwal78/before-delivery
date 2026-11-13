# Holloway Carriage Co. Strikeproof

Strikeproof is a browser typing-speed test for everyday typists. It offers timed, word-count, quote and custom-text tests and private typing races. Every result is a proof. The server issues each test as a ticket that holds the exact text. The browser sends the full keystroke log, and the server replays that log under the published rules before the run can reach history or a board. The typist can watch the same replay on their certificate, second by second. The app is a TypeScript service on Node with a browser client. It stores everything in PostgreSQL and sends account mail (email verification and password reset only) through an SMTP server that Mailpit captures. The app server pushes live updates (race rooms and the daily board) over a WebSocket or Server-Sent Events on the same origin.

Out of scope:

- AI or language-model features, typing sounds and ads
- outside sign-in providers, paid plans and public profiles (board rows are the only public view of a typist)
- any third-party realtime or analytics service
- any request from the browser to another origin
- any datastore, queue or cache other than PostgreSQL

## Problem and users

Millions of people take short browser typing tests to measure and improve their speed. They chase a personal best and compare themselves on public boards. Those boards only mean something if the scores are honest, and on many sites they are not:

- Auto-typers and macros take the top spots.
- Some sites lock accounts after the fact.
- Others make fast typists pass a CAPTCHA retest at a lower speed.

Both kinds of check judge a score after it has already been shown, and neither tells the typist why a run did or did not count. Sites also define "raw speed" and "consistency" loosely, so the same run scores differently from site to site. Typists lose time and trust: a personal best a bot can beat, a board they stop checking, a run that silently vanishes.

Strikeproof publishes one exact set of typing and scoring rules. It applies them identically in the browser and on the server, and it shows the verdict and its reason on the certificate.

Users:

- **Typist** (daily): takes time, words, quote and custom tests, reads an exact certificate for each run, and works to beat their personal bests.
- **Racer** (weekly): opens a private race room, shares its code with friends and races the same passage live.
- **Guest typist** (occasional): tries a test without an account and sees the full result, knowing it is not filed or ranked.
- **Board reader** (weekly): browses the daily and all-time leaderboards without signing in.

## Journeys

1. **A timed test and its certificate.** A signed-in, verified typist opens the Test folder. The typing input already has focus and three lines of words are showing. They type a 15-second test with a few mistakes, a correction and two extra letters. The letters change state as they type, and the timer and live speed tick once per second. At exactly 15 seconds the sheet lifts into a certificate. It shows exact speed, raw speed, accuracy, consistency, characters and duration, a speed-over-time chart with its table, and an errors-by-key table. A screen reader hears the result line once. The seal reads held, then counted, and the stub shows the run's proof key. If they had restarted ten seconds into an earlier test, that test's timers would never have touched this one.
2. **Corrections, restart and the command line.** In a 10-word test the typist fixes mistakes with Backspace and Ctrl+Backspace and sees that Backspace cannot move back into a correct word. Every letter state is marked by shape as well as tone in every theme. They press Tab, then Enter, to restart with fresh words. They press Escape, type to filter the command line, and switch to a 60-second test, the carbon theme and a block caret, quickly enough that requests overlap. The sheet ends on the latest ticket. After a reload the last settings they chose are still there.
3. **Quotes and custom text.** The typist takes a quote test. The Punctuation and Numbers boxes vanish, and they see the passage and its source. They switch to short quotes from the command line. They open the custom text dialog, watch the live count reach the limit and see Use text disabled. Then they trim their text and type it to the last word.
4. **Watching the proof.** After a run the typist drags the Replay position slider or uses the arrow keys. They watch each character strike onto the carbon at the second it was typed, mistakes and backspaces included, with the speed at that second. On a filed run the address keeps the position, so a reload returns to the same second. When a submission is altered on the way to the server, the seal says exactly why the run was not counted. A run refused by a check on its log or text is filed, and history lists it as Not counted. A submission refused because it is unknown, expired or oversized files nothing, so history does not change.
5. **Typing on a phone.** On a 375-pixel touch screen the typist picks a mode by tap, opens the custom text and command line dialogs and taps their options, and types with the on-screen keyboard. The page never jumps while they type. The certificate fits the screen, and they scrub the replay with a finger without scrolling the page.
6. **From sign-up to history.** A new typist signs up and can type straight away. The seal tells them their runs are not filed until they verify. They open the verification link from their email. Their next run is counted and marked as a new personal best. They find it in history, with filters that survive reload, and on their account page. A second typist who guesses the run's address is told there is no such run. If mail is down, sign-up still works and a banner says the email will follow. Later they reset their password from the mailed link, and every browser they were signed in on is signed out.
7. **Boards.** A board reader in any time zone watches the daily 15-second board, which splits at midnight UTC. Another typist finishes a better run, and it appears at its rank within three seconds with an announcement and no reload. The reader moves between the Daily and All-time tabs and the 15- and 60-second tabs with the arrow keys.
8. **A private race.** A racer creates a room and shares its code. Friends join with the code in any letter case. The lobby fills live, and each racer hears the others join. When the host closes the page, the host role passes on after the rejoin window. The host starts the race, and every racer sees and hears the same server countdown. They race the same passage and watch each other's progress bars move. Racers who finish in the same time share a place. A racer who reloads mid-race is put back where they were. Anyone joining a full or already-started room gets an exact refusal.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Server-issued tickets** Every test, signed in or not, starts from a ticket the server issues through the tickets endpoint with its exact words, seed, quote id and expiry, as specified in API.
- **DP-02 — Published text generator** Generated words follow the published word list, generator and seed rule exactly, so a ticket's words are reproducible from its seed with punctuation and numbers on or off.
- **DP-03 — Letter states and caret** While typing, every letter element in the words area carries the data-state and the caret carries the word and letter position that the published typing rules give after each key.
- **DP-04 — Time test clock** A time test starts on its first logged key, shows the seconds left and the live speed and accuracy once per second, and ends exactly its length after that key, with later keys neither changing the screen nor entering the log.
- **DP-05 — Certificate figures** When a test ends, the certificate shows speed, raw speed, accuracy, consistency, characters and duration exactly as the published formulas and rounding give for the log just typed.
- **DP-06 — Speed-over-time and error tables** The certificate's Speed over time table holds one row per second with that second's speed, raw speed and errors, and its Errors by key table lists every miskeyed key in the published order.
- **DP-07 — Result announcement** The Test result live region announces the published result line exactly once per finished test and never again for that test.
- **DP-08 — Timed test journey** A signed-in typist takes a 15-second time test by keyboard with mistakes, a correction and extra letters, and reads the exact letter states, live readouts, certificate figures, tables and announcement.
- **DP-09 — Backspace** Backspace deletes the current word's last typed letter and, in an empty word, moves back into the previous word only when that word has an error, restoring its missed letters to untyped.
- **DP-10 — Ctrl+Backspace** Ctrl+Backspace and Alt+Backspace clear the current word's typed letters and, in an empty word, cross into an erroneous previous word and clear it, under the same error-only rule as Backspace.
- **DP-11 — Space, extra letters and test end** Space in an empty word does nothing, letters past a word's end become extra letters up to the published cap, Space leaves untyped letters missed, and words, quote and custom tests end on the published ending keystroke.
- **DP-12 — Correction journey** A typist takes a 10-word test that exercises every correction rule and reads the exact letter states, characters, accuracy and speed on the certificate.
- **DP-13 — Quick restart** The quick-restart key and Next test issue a new ticket with the same settings and the remembered custom text in custom mode, discard the log, submit nothing, reset the timer and return focus to the typing input, in both published quick-restart settings, and Enter never restarts while a dialog is open.
- **DP-14 — Command line** Escape opens the Command line dialog, whose filter, active option kept in view, arrow-key wrap, Enter, Escape, focus trap, focus return and Settings updates announcement follow Interactions.
- **DP-15 — Typist settings** Theme, caret style, smooth caret, font size, blind mode and quick restart are set from the command line or the settings folder, apply at once, and survive reload, on the server for signed-in typists and in the browser for guests.
- **DP-16 — Restart and command line journey** A typist restarts mid-test by keyboard, switches mode, theme, caret and quick-restart key through the command line, and finds the settings kept after reload.
- **DP-17 — Three-line view** The words area is exactly three lines tall at every published width and font size, moves the text up one line when the caret enters the first word of the third line, and recomputes its lines after a mid-test resize without changing any letter state, as reported by each word's data-line.
- **DP-18 — Focus warning** When the typing input stays unfocused for the published focus warning time during a test, the words area is marked blurred and the focus button appears, a running time test keeps counting, the key that refocuses is neither typed nor logged, and the warning never appears over the certificate.
- **DP-19 — Caps Lock warning** The Caps Lock region shows and clears the published warning from the Caps Lock key and the modifier state of other keys, without changing what is typed.
- **DP-20 — Blind mode** With blind mode on, typed letters show as typed, extra letters are hidden and missed letters stay untyped, while the certificate figures stay exactly as without blind mode.
- **DP-21 — Text view journey** A typist at a large font size watches the three-line scroll, resizes the window mid-test, leaves and regains focus, toggles Caps Lock and types blind, reading each published state.
- **DP-22 — On-screen keyboard typing** Characters and deletions that arrive as input events, with no key events or with unidentified composition key events, are typed and logged exactly once each, and typing never scrolls the page.
- **DP-23 — Published breakpoints** The test sheet, certificate, history, boards and navigation take the published phone, tablet and desktop layouts at 375, 768 and 1280 pixels wide, with no sideways scrolling and the history as index cards below 768.
- **DP-24 — Touch scrubbing** Dragging the Replay position slider by touch moves it in whole seconds and never scrolls the page.
- **DP-25 — Phone typing journey** A typist on a 375-pixel touch screen picks a mode by tap, operates the Custom text and Command line dialogs by tap, types a test with the on-screen keyboard, reads the certificate within the screen width and scrubs the replay by touch.
- **DP-26 — Quote tests and mode controls** A quote test uses the published quote picked for its length group, shows its exact text and source and ends on its last letter, and in quote and custom modes the controls that do not apply are absent from the screen, the Tab order, the accessibility tree and the ticket request.
- **DP-27 — Custom text limit** Custom text is collapsed and trimmed, counted live against the published character and word limits, and refused by the server with the published code when it exceeds either.
- **DP-28 — Custom text dialog** The Custom text dialog opens above every folder and inside the viewport from the custom radio or the Mode: custom command, keeps Tab inside itself, disables Use text over a limit, closes on Escape with the published fallback ticket, returns focus as stated in Interactions, and is absent from the accessibility tree when closed.
- **DP-29 — Quote and custom journey** A typist takes a fixed quote test, switches to short quotes through the command line, and builds and finishes a custom test by keyboard.
- **DP-30 — Replay slider** The certificate's Replay position slider spans 0 to the run's whole seconds, starts at its maximum or at a stored run's address position, carries the published value text, moves by the published keys and steps, and keeps a stored run's position in the address without adding history entries.
- **DP-31 — Carbon strike state** At every slider position the carbon, its caret, the replay speed numeral and the current chart point and table row show exactly the state after the log entries before that second, and moving back restores earlier states.
- **DP-32 — Stored run replay** Opening a filed counted run shows its certificate, finish time and carbon replay rebuilt from the stored keystroke log with the same figures and states as when it was typed, and a run without a replay shows its stored figures only.
- **DP-33 — Carbon replay journey** After typing the published worked example, a typist scrubs the carbon by keyboard from the start to the end and reads the exact strike states and speeds at each second.
- **DP-34 — Sign-up and verification** Sign-up creates an unverified, signed-in account and sends the verification mail through Mailpit, whose single-use link verifies the account within its validity.
- **DP-35 — Sign-in and password reset** Sign-in sets the session or answers the published refusal and a rate limit that counts parallel failures exactly, and password reset mails a single-use link for known emails while showing the same notice for any email.
- **DP-36 — Mail outage** When mail cannot be sent, sign-up still creates the account, the page shows the mail outage banner, and the verification mail is delivered by retry once mail recovers.
- **DP-37 — Filing seal** The seal shows the published state for guests, unverified typists and verified typists, moves from held to the server's first verdict with the personal best mark, resends a held run only until that first verdict, and announces each change.
- **DP-38 — History ledger** History lists the typist's own runs newest first in pages of 20 with UTC dates, with Mode, Length and Verdict filters kept in the URL across reload and the published empty sheet.
- **DP-39 — Counted totals and personal bests** The account's Tests counted total, its personal bests and the typist's board row are derived from counted runs only and agree after reload.
- **DP-40 — Private runs** A run, its certificate, carbon replay and keystroke log are served to its owner only, and anyone else gets the published not found answer and No such run page.
- **DP-41 — Sign-up to history journey** A new typist signs up, verifies through the mailed link, takes a counted test and finds it in history and on the account page, while a second typist cannot open it.
- **DP-42 — Run checks in published order** The server checks every submitted run in the published order, stores the log as the JSON value submitted, malformed values included, and answers each refusal with its single published status and code.
- **DP-43 — Bounded keystroke logs** A log longer than the published event or time limit is refused before replay within one second, without storing a run.
- **DP-44 — One ticket, one run** Repeated or parallel submissions of one ticket, whatever their bodies, all get the first response unchanged, and the ticket never gets a second run, history row or board entry.
- **DP-45 — Server-clock ticket expiry** A ticket submitted after its server-side lifetime is refused as expired whatever the browser's clock says, and the screen shows the server's verdict.
- **DP-46 — Not counted seal** When the server refuses a run, the seal shows and announces Not counted with the published reason for that code.
- **DP-47 — Tampered log journey** A typist whose browser submissions are altered sees each exact Not counted reason, finds the runs refused with a 422 code filtered as Not counted in history while 404, 410 and 413 refusals leave history unchanged, and never sees any of them on the open daily board of a second typist.
- **DP-48 — Board ranking** The daily and all-time boards rank each eligible typist's best counted run by the published eligibility and order, with the daily board split at 00:00 UTC and every date shown in UTC whatever the browser's time zone.
- **DP-49 — Board row fields** Board responses and board rows carry rank, name, speed, accuracy and date only, never emails, logs, per-key errors or ids.
- **DP-50 — Live board** An open board shows a new eligible counted run at its rank within 3 seconds without reload and announces it in the Board updates region.
- **DP-51 — Board tabs** The Board and Length tab lists move by arrow keys with roving focus, switch the shown board, and mark the signed-in typist's own row as current.
- **DP-52 — Live board journey** A typist watching the daily 15-second board sees another typist's new best appear at its rank live, switches boards by keyboard and never sees an ineligible run.
- **DP-53 — Race rooms** A signed-in racer creates a room with a published-format code, others join with the code in any case with or without the dash, and every other seated racer sees the racers list update live and hears each join exactly once.
- **DP-54 — Last seat** A room holds at most 8 racers, and when several racers claim the last seat at once exactly one joins and every other is told the room is full, while a seated racer's repeated join never takes a second seat.
- **DP-55 — Server-timed countdown** The host starts the race once two racers are in, every racer sees and hears each countdown step the server pushes exactly once, and keys before Go are ignored whatever the browser's clock says.
- **DP-56 — Live race progress** Every racer sees each racer's progress bar at the published value within 1 second of their typing.
- **DP-57 — Race places** Finished racers are replayed and placed by replayed duration with shared places for equal durations in the Race results table, and every other racer hears each finish and the race end exactly once in Race updates.
- **DP-58 — Private race journey** Three racers in separate browsers gather in a room, count down, type the same text and see live bars and shared places.
- **DP-59 — Race rejoin** A racer who reloads within the rejoin window is told they rejoined, gets their typed words and caret back, continues from the server's elapsed time, and other racers never see their bar drop.
- **DP-60 — Leaving and cut-off** A racer gone longer than the rejoin window during a race shows as Left, unfinished racers show DNF after the time limit, and the room refuses joins once the race has started.
- **DP-61 — Race rejoin journey** A racer reloads mid-race, continues and places, while late, unknown and full-room joins get their published refusals by keyboard.
- **DP-62 — Smooth caret** With smooth caret on, the caret glides to its new place over the published time after each keystroke, and it jumps with smooth caret off or under reduced motion.
- **DP-63 — Certificate and seal motion** The certificate rise, the seal stamp and the carbon ink-in run over their published durations, and under reduced motion all appear at once with the same text and announcements.
- **DP-64 — Keyboard focus and accessibility** Every control is reachable and operable by keyboard with a visible focus ring, and the test page, certificate, history and boards have no automated accessibility violations at the three published widths.
- **DP-65 — Health and run manifest** The app installs, builds and serves from its run manifest on the published port and answers the health check in every grading instance.
- **DP-66 — Server boundary** The server accepts same-origin JSON within the published size limit, answers unknown API paths with the published not found body, and never serves source files or credentials.
- **DP-67 — Configuration from environment** Every service address, credential, timer and limit is read from the published environment variables at start, and none is hard-coded or sent to the browser.
- **DP-68 — File drawer look** Every folder screen is drawn as sand stationery inside a flat cobalt drawer field on the sand page ground, set in Bodoni Moda and Jost with one cobalt ink, as described in Visual design.
- **DP-69 — Certificate stationery** The certificate reads as a 5:7 proficiency certificate with its large Bodoni speed, aligned figure column, drawn keyboard of errors and perforated stub holding the seal and proof key.
- **DP-70 — Landing hero** The landing page shows the published hero with the wordmark, the headline, the stacked folders and the open Test folder holding the live test sheet.
- **DP-71 — Timers belong to their test** Every timer a test starts ends with that test, so a restarted, abandoned or left test never ends, warns, resends or changes the seal of the test that replaced it.
- **DP-72 — Letter states by shape and contrast** Every letter state in the words area and the carbon carries its published strike-through or dotted underline mark and meets the published contrast in all four themes, and every caret style meets its published contrast.
- **DP-73 — Latest request wins** The sheet shows and submits only the latest requested ticket, and the stored and reloaded settings are always the last ones chosen, whatever order the server answers in.
- **DP-74 — A reset ends every session** Confirming a password reset signs the typist out of every browser, the confirming one included, and closes their live connections within 5 seconds.
- **DP-75 — Proof key** Every stored run carries a proof key that is the SHA-256 of the exact bytes of the first body received for its ticket, returned by the run endpoints and shown on the certificate stub.
- **DP-76 — Lobby seats and host handover** In an open room, a racer whose live connection stays closed for the rejoin window loses their seat, the host role passes to the earliest-seated remaining racer, an emptied room is deleted, and closed live connections leave no database work running.

## Frontend

All visible copy uses straight apostrophes and straight quotes (the plain ASCII characters U+0027 and U+0022), never typographic ones. Copy in backticks renders character for character, and every announcement built from it carries the same characters.

The verifier pauses the browser clock and advances it between keys, so results are exact. Read keystroke times from the browser's high-resolution clock (`performance.now()`) or from `Date.now()`. Drive every screen timer from browser timers or animation frames: the test end, the focus warning, the live readouts, the resend loop and every motion.

The device clock may be wrong. The browser never uses it to decide whether a ticket has expired, when a race starts or when it ends. The server decides those (Business rules), and the screen shows what the server says.

### Screens and layout (DP-17, DP-23, DP-32, DP-38, DP-70)

Layouts switch at exactly two widths:

- Below 768 pixels: the **phone** layout.
- From 768 to 1279 pixels: the **tablet** layout.
- 1280 pixels and up: the **desktop** layout.

The published viewports are 375x812 (phone), 768x1024 (tablet) and 1280x800 (desktop). No breakpoint between them changes which layout a published viewport gets. No screen scrolls sideways at any of them.

- **Top row and navigation.** A narrow top row holds the wordmark `STRIKEPROOF` in the centre. At the far right it holds `link "Sign in"` when signed out, or `link "Account"` and `button "Sign out"` when signed in. Navigation is `navigation "Folders"` with the links `Test` (`/`), `History` (`/history`), `Boards` (`/boards`), `Race rooms` (`/race`) and `Settings` (`/settings`), drawn as folder tabs. On tablet and desktop the tabs sit across the top, above the open folder. On phone they become a bar fixed to the bottom of the screen, with the same five links, each at least 44 pixels tall.
- **Test folder (`/`) and hero.**
  - The page opens on the cobalt drawer field (Visual design), which fills the first screen edge to edge.
  - Under the wordmark, the headline `TYPE IT. PROVE IT.` is set very large in sand capitals. Under it, a smaller line in sand reads `Timed tests whose every keystroke is replayed before it counts.`
  - From just over halfway down the first screen, the five navigation folders stack like files in a drawer. They alternate sand, darker sand and muted blue, and each has a tab whose sides slope inward.
  - The front folder, Test, is open and runs off the bottom of the screen. Its top-left holds the mode row (Mode, Length, Punctuation and Numbers, each where it applies) and a solid cobalt `button "Begin test"` whose top corners slope like a folder tab.
  - Below them sits the live test sheet: a tall paper panel holding the timer and the live readouts above the words area and the caret.
  - Desktop: the sheet is a centred column about two-thirds of the screen width, and the mode row is one line.
  - Tablet: the sheet spans the width with margins, and the mode row wraps to two lines.
  - Phone: the headline shrinks to fit the width, the mode row wraps, and the sheet spans the full width.
- **Words area geometry.** At every published viewport and at each font size (`1`, `1.5`, `2`, `3`), the words area meets all of the following:
  - Its height is exactly three line heights, give or take 1 pixel. A line height is defined in Public screens and controls, under Themes and type size.
  - Words with the same `data-line` share one top edge, give or take 1 pixel.
  - Lines 1 to 3 lie inside the words area.
  - Words on line 0 and on lines 4 and above are not visible: they are cut off by the words area, so a click at their place never reaches them.
  - No word sticks out of the sheet sideways.
- **Certificate.** When a test ends, the certificate (`region "Certificate"`) replaces the sheet in the same folder.
  - It is a 5:7 card with:
    - the speed figure set very large
    - a column of figures
    - a small drawn keyboard showing errors by key
    - a perforated stub along its foot that holds the seal and the proof key
  - The carbon replay sits beside the card: the carbon copy of the passage, the speed-over-time chart, the Replay position slider, the replay speed numeral and the two tables.
  - Desktop: card on the left, carbon panel on the right, side by side. Tablet and phone: card on top, carbon panel below, both full width. On phone, nothing on the certificate is wider than the screen.
  - `/runs/<id>` shows the same certificate for a stored run, rebuilt from its stored log, with its finish time on the stub. A run created by the grading route, and every not-counted run, has no replay-derived figures (Business rules). Its page shows its stored figures and the seal, without the carbon, slider or tables.
- **History (`/history`).** A ledger sheet with the three filters above it, a table of runs, and `button "Older runs"` below it. On tablet and desktop it is a table. On phone each row becomes an index card in a list, with the same texts in the same order.
- **Account (`/account`).** The Tests counted total and the Personal bests table on one sheet.
- **Boards (`/boards`).** A pinned results sheet: the two tab lists, then the Leaderboard table with one rank column.
- **Race rooms (`/race`, `/race/<code>`).**
  - `/race` holds Create room and the join form.
  - A room page is a ticket-shaped panel with a notch cut from one edge. It shows:
    - the room code, set large
    - the racers as filled stamps in the Racers list
    - the Start race button, for the host
    - the countdown
    - a words area, with the same words-area contract as the test sheet
    - one progress bar per racer
    - the Race results table
  - Signed-out visitors see `link "Sign in"` with the text from Feedback states, in place of the forms.
- **Settings (`/settings`).** A form printed on the back of a folder, with the six setting groups.
- **Sign-up, sign-in, reset and verify (`/signup`, `/signin`, `/reset`, `/reset/<token>`, `/verify/<token>`).** Single sand sheets, each with one form or message.
- **Dialogs.** `dialog "Custom text"` and `dialog "Command line"` open in the browser's top layer, above every folder. They are never cut off by a folder's slanted edges or by any scrolling region. At 375x812 each dialog lies entirely inside the viewport.
- **Footer.** The back of the drawer, `contentinfo`, with the text `Strikeproof is made by Holloway Carriage Co.`
- **Unknown pages.** A sand sheet with the not-found heading from Feedback states.

### Public screens and controls (DP-03, DP-04, DP-06, DP-13, DP-14, DP-15, DP-18, DP-19, DP-20, DP-26, DP-28, DP-30, DP-31, DP-38, DP-39, DP-51, DP-53, DP-56, DP-57, DP-72, DP-75)

Only the controls and regions below are public. Everything else is free.

| Where | Role and accessible name | Visible copy or content |
|---|---|---|
| All | `navigation "Folders"` | links `Test`, `History`, `Boards`, `Race rooms`, `Settings` |
| All | `link "Sign in"`, `link "Account"`, `button "Sign out"` | as named |
| Test | `button "Begin test"` | `Begin test` |
| Test | `radiogroup "Mode"` | radios `time`, `words`, `quote`, `custom` |
| Test | `radiogroup "Length"` | time: `15`, `30`, `60`, `120`; words: `10`, `25`, `50`, `100`; quote: `short`, `medium`, `long`, `all`; absent in custom mode |
| Test | `checkbox "Punctuation"`, `checkbox "Numbers"` | present in time and words modes only, absent in quote and custom |
| Test | `textbox "Typing input"` | a visually hidden field that receives typing |
| Test | words area `id="words"` | the passage (contract below) |
| Test | caret `id="caret"` | contract below |
| Test | `id="timer"`, `id="live-speed"`, `id="live-accuracy"` | contract below; not live regions |
| Test | `id="quote-source"` | quote tests only: `<source>` from the quotes table |
| Test | `button "Click or press any key to focus"` | shown over the words area while blurred |
| Test | `status` named `Caps Lock` | the Caps Lock copy from Feedback states, or empty |
| Test | `button "Restart test"` | `Restart test`, straight after the typing input in Tab order |
| Test | `dialog "Custom text"` with `textbox "Custom text"`, live count `id="custom-count"` and `button "Use text"` | count reads `<c> of 2000 characters, <w> of 400 words` |
| Test | `dialog "Command line"` with `combobox "Command"` and `listbox "Commands"` | option labels below |
| Test | `status` named `Settings updates` | announcement from Feedback states |
| Test | `status` named `Test result` | announcement from Feedback states |
| Certificate | `region "Certificate"` | the figures below |
| Certificate | `id="result-speed"`, `id="result-raw"`, `id="result-accuracy"`, `id="result-consistency"`, `id="result-characters"`, `id="result-duration"` | for example, the first worked example gives `55.00`, `60.00`, `91.67%`, `73.24%`, `9/0/0/0`, `2.40 s` |
| Certificate | `id="result-finished"` | on `/runs/<id>` only: the run's finish as `YYYY-MM-DD HH:MM UTC` |
| Certificate | `img "Speed over time"` | the chart, with one point per second carrying `data-second="<k>"` |
| Certificate | `table "Speed over time"` | columns `Second`, `Speed`, `Raw`, `Errors`, one row per second; Second and Errors as integers, Speed and Raw with two decimals |
| Certificate | `table "Errors by key"` | columns `Key`, `Errors`, rows in the errors-by-key order from Business rules; replaced by the no-errors text from Feedback states when there are none |
| Certificate | `slider "Replay position"` | contract below |
| Certificate | carbon `id="carbon"`, carbon caret `id="carbon-caret"`, numeral `id="replay-speed"` | contract below |
| Certificate | `status` named `Seal`, element `id="seal"` | seal copy from Feedback states |
| Certificate | `id="proof-key"` on the stub | the proof stub copy from Feedback states, once the server's answer carries a proof key; empty otherwise |
| Certificate | `button "Next test"` | starts a new test with the same settings |
| History | `combobox "Mode"` | `All`, `time`, `words`, `quote`, `custom` |
| History | `combobox "Length"` | `All` plus the lengths of the chosen mode: only `All` when Mode is All; for custom, the word counts present in the typist's runs |
| History | `combobox "Verdict"` | `All`, `Counted`, `Not counted` |
| History | `table "History"` (tablet and desktop) or `list "History"` (phone) | columns or card fields `Date`, `Mode`, `Length`, `Speed`, `Raw`, `Accuracy`, `Consistency`, `Verdict`; each row or card has `link "Open run"` |
| History | `button "Older runs"` | shown while more runs exist |
| Account | `id="tests-counted"` | `Tests counted <n>` |
| Account | `table "Personal bests"` | columns `Mode`, `Length`, `Punctuation`, `Numbers`, `Speed`, `Accuracy`, `Date` |
| Boards | `tablist "Board"` | `tab "Daily"`, `tab "All-time"` |
| Boards | `tablist "Length"` | `tab "15 seconds"`, `tab "60 seconds"` |
| Boards | `table "Leaderboard"` | columns `Rank`, `Typist`, `Speed`, `Accuracy`, `Date` |
| Boards | `status` named `Board updates` | announcement from Feedback states |
| Race | `button "Create room"`, `textbox "Room code"`, `button "Join"` | as named |
| Race room | `id="room-code"` | the code as `XXX-XXX` |
| Race room | `list "Racers"` | one item per seated racer: `<name>`, then ` (host)` for the host, then ` (Left)` once they have left a race; for example, `Ada (host)` |
| Race room | `button "Start race"` | host only |
| Race room | `status` named `Race countdown` | each pushed step: `3`, `2`, `1`, then `Go` (from `RACE_COUNTDOWN_SECONDS` down to 1, then `Go`) |
| Race room | `progressbar "<name> progress"` | one per racer, with `aria-valuenow` from 0 to 100 |
| Race room | `table "Race results"` | columns `Place`, `Racer`, `Speed`, `Accuracy` |
| Race room | `status` named `Race updates` | announcements from Feedback states |
| Settings | `radiogroup "Theme"` (`sand`, `cobalt`, `carbon`, `ledger`), `radiogroup "Caret"` (`line`, `block`, `underline`, `off`), `radiogroup "Font size"` (`1`, `1.5`, `2`, `3`), `radiogroup "Quick restart"` (`tab`, `enter`), `checkbox "Smooth caret"`, `checkbox "Blind mode"` | as named |
| Sign-up | `textbox "Display name"`, `textbox "Email"`, `textbox "Password"`, `button "Create account"` | as named |
| Sign-in | `textbox "Email"`, `textbox "Password"`, `button "Sign in"`, `link "Forgot password"` | as named |
| Reset | `textbox "Email"`, `button "Send reset link"`; on `/reset/<token>`: `textbox "New password"`, `button "Set password"` | as named |
| All | `status` named `Mail status` | the mail outage banner: a cobalt slip clipped across the top of the folder |

**Command line options.** The option labels, exactly and in this order:

`Mode: time`, `Mode: words`, `Mode: quote`, `Mode: custom`, `Time: 15`, `Time: 30`, `Time: 60`, `Time: 120`, `Words: 10`, `Words: 25`, `Words: 50`, `Words: 100`, `Quote length: short`, `Quote length: medium`, `Quote length: long`, `Quote length: all`, `Punctuation: on`, `Punctuation: off`, `Numbers: on`, `Numbers: off`, `Theme: sand`, `Theme: cobalt`, `Theme: carbon`, `Theme: ledger`, `Caret: line`, `Caret: block`, `Caret: underline`, `Caret: off`, `Smooth caret: on`, `Smooth caret: off`, `Font size: 1`, `Font size: 1.5`, `Font size: 2`, `Font size: 3`, `Blind mode: on`, `Blind mode: off`, `Quick restart: tab`, `Quick restart: enter`

These 38 options are always listed. `Time: <n>` and `Words: <n>` also switch the mode. `Quote length: <g>` switches to quote mode. `Punctuation` and `Numbers` options switch to time mode when the current mode is quote or custom.

**Words area contract.**

- Inside `id="words"` there is one element per word, with `data-index="<i>"` (counting from 0) and `data-line="<n>"`.
- Inside each word there is one element per letter, with `data-state` set to `untyped`, `correct`, `incorrect`, `extra` or `missed`. Extra letters are added after the word's own letters, as elements with state `extra`.
- The words area shows exactly 3 lines. A line is the set of words that share one visual row.
- `data-line` is 1, 2 or 3 for the visible lines, 0 for words that have scrolled above, and 4, 5 and up for the hidden words below.
- When the caret enters the first word of line 3, the text moves up one line before the next frame. That word's line becomes 2, and the old line 1's words become 0.
- Words never move between lines while typing. Extra letters may push a word onto a new line only after Space leaves it.
- When the viewport width changes during a test, the lines are recomputed from the new layout. The current word's line becomes 1 if it was on line 1, and 2 otherwise. No letter state or caret value changes, and nothing is logged.
- While a ticket is loading, the words area has `aria-busy="true"`. While blurred (Interactions), it has `data-blurred="true"`.

**Caret contract.** `id="caret"` carries three attributes:

- `data-word`: the index of the current word
- `data-letter`: the number of typed letters in the current word, extras included
- `data-style`: `line`, `block`, `underline` or `off` (the caret is hidden when `off`)

**Letter marks and contrast.** In the words area and on the carbon, each state has a mark that does not rely on colour. Use the browser's own text decorations, so the page's computed style reports them:

| State | Colour | Mark |
|---|---|---|
| `correct` | ink | no text decoration |
| `incorrect` | muted | a line struck through it (line-through) |
| `extra` | muted | a line struck through it (line-through) |
| `missed` | ink | a dotted underline |
| `untyped` | ink at reduced strength | no text decoration |
| `typed` (blind mode) | ink | no text decoration |

Contrast rules, in all four themes:

- Every state's effective colour reaches at least 4.5:1 contrast against the sheet behind it. The effective colour is the letter colour after any transparency is blended over the sheet, so a dimmed untyped letter must still reach 4.5:1.
- The caret, in each of the `line`, `block` and `underline` styles, is drawn in ink and reaches at least 3:1 against the sheet.
- Under a `block` caret, the letter beneath is drawn in the sheet colour, so it keeps at least 4.5:1 against the caret fill.

**Readouts.**

- During a time test, `id="timer"` shows the seconds left. It shows the ticket's length (for example `15`) before the first logged key, then `14`, `13` and down, changing at each whole second after the first logged key.
- In other tests, `id="timer"` shows `<words done>/<words>`, where `<words done>` is the current word's index. It updates on every keystroke.
- `id="live-speed"` shows the per-second Speed and `id="live-accuracy"` shows the accuracy of the keystrokes so far, both over the whole seconds elapsed. They are whole numbers rounded half up (`55`, `92%`) and update once per second. Before the first second has passed they show `0` and `100%`. With no keystrokes so far, live accuracy follows the no-keystroke accuracy rule in Business rules.

**Blind mode.** Typed letters, correct or incorrect, show `data-state="typed"`. Extra letters are not shown. Missed letters stay `untyped`. Results do not change.

**Replay contract.**

- `slider "Replay position"` has:
  - `aria-valuemin` 0
  - `aria-valuemax` equal to the number of seconds in the run (see per-second values in Business rules)
  - an integer `aria-valuenow`
  - `aria-valuetext` `<s> seconds, speed <speed>`, where `<s>` is the position and `<speed>` is the replay speed at that position
- At position `s`, the carbon and its caret show the typed state after every log entry whose `t` is below `s × 1000`. At the maximum position they show every entry.
  - The carbon is `id="carbon"`. It has the same word and letter elements and `data-state` values as the words area, shows every word up to the last word the run reached, and has no `data-line`.
  - The carbon caret is `id="carbon-caret"`, with `data-word` and `data-letter`.
- `id="replay-speed"` shows the per-second Speed for second `s` with two decimals, and `0.00` at 0.
- For `s` of 1 or more, the chart point with `data-second="<s>"` and row `s` of `table "Speed over time"` have `aria-current="true"`. At 0 nothing is current.

**Themes and type size.**

- A theme sets `data-theme` on the `html` element, and sets the page background (also the sheet colour), the text (ink) colour and the muted colour. The colours below are red, green and blue channel values:

| Theme | Background | Text (ink) | Muted |
|---|---|---|---|
| `sand` | 230, 219, 199 | 6, 43, 138 | 58, 90, 168 |
| `cobalt` | 6, 43, 138 | 230, 219, 199 | 170, 184, 214 |
| `carbon` | 31, 29, 26 | 232, 225, 211 | 168, 160, 146 |
| `ledger` | 244, 241, 232 | 29, 59, 42 | 74, 110, 88 |

- Font size `n` sets the text in the words area to `n × 24` pixels. Each line is 1.5 times that height, which is the line height used in the words area geometry.
- Defaults: theme `sand`, caret `line`, smooth caret on, font size `1.5`, blind mode off, quick restart `tab`.
- The last chosen mode, length, punctuation and numbers, and the remembered custom text (Interactions, Custom text), are kept in the browser across reload. Custom counts as the last chosen mode only once a custom ticket has been issued. The punctuation and numbers choices are remembered separately, so they come back when the typist returns from quote or custom mode to time or words mode.

### Interactions (DP-04, DP-09, DP-10, DP-11, DP-13, DP-14, DP-15, DP-18, DP-19, DP-22, DP-24, DP-26, DP-28, DP-30, DP-51, DP-53, DP-55, DP-59, DP-64, DP-71, DP-73)

- **Getting a test.**
  - Each of these requests a new ticket (API) and lays out its words:
    - loading the Test folder
    - changing any Mode, Length, Punctuation or Numbers control
    - applying a command that changes them
    - every restart and Next test
  - Each ticket request supersedes all earlier ones. The words area shows only the words of the latest requested ticket and stays busy until that ticket arrives. The timer shows that ticket's length, and the run is submitted with that ticket's `ticketId`.
  - A response to a superseded request never changes the sheet, even when it arrives last.
  - A ticket request in quote mode carries `"punctuation":false,"numbers":false`, and so does one in custom mode, whatever the boxes showed before.
  - When the ticket is ready, `textbox "Typing input"` gets focus without scrolling the page, with one exception. A ticket requested by closing `dialog "Custom text"` that was opened from the `custom` radio (by Use text or by Escape) never moves focus. Focus stays where the Custom text rules below put it. `button "Begin test"` scrolls the sheet into view and focuses the typing input.
- **Mode controls.** `radiogroup "Length"` is not rendered in custom mode. `checkbox "Punctuation"` and `checkbox "Numbers"` are not rendered in quote and custom modes. An absent control is not on screen, not in the accessibility tree, not in the Tab order and not clickable. Dimming or disabling a control is not enough.
- **Tab order in the Test folder.** The Folders links, then `radiogroup "Mode"`, `radiogroup "Length"` and the Punctuation and Numbers boxes (where present), then `button "Begin test"`, then the typing input, then `button "Restart test"`.
- **Typing keys.**
  - A keydown whose key is a single printed character is typed and logged as that character, with case kept (Shift+a logs `A`).
  - The space key logs `Space`. Backspace logs `Backspace`. Backspace with Ctrl held, or with Alt held, logs `CtrlBackspace`.
  - No other key is logged or typed. That includes Shift, Tab, Escape, the arrows, Caps Lock, Enter, and any character pressed with Ctrl or Meta held.
  - Every typing key the engine receives is logged, even when it has no effect, apart from the exceptions in Business rules.
- **On-screen keyboards.** A phone's on-screen keyboard sends input events with no key events, or with a keydown whose key is `"Unidentified"` or whose key code is 229.
  - Read the input data instead: `insertText` with one character types that character (a space types `Space`), `deleteContentBackward` is Backspace, and `deleteWordBackward` is CtrlBackspace.
  - Each character the typist enters is typed and logged exactly once, whichever way it arrives. An unidentified keydown followed by `insertText` gives one entry, from the input data.
  - Typing never scrolls the page and never moves the sheet. The view moves only by the three-line rule.
- **Focus warning.**
  - While a test is ready or running, if the typing input loses focus and does not get it back within `FOCUS_WARNING_MS` (read from `/api/config`), the words area becomes blurred and the focus button covers it. Nothing changes one millisecond earlier.
  - Clicking the button, or pressing any printed key while focus is on the page body, refocuses the typing input. That key is not typed or logged.
  - A running time test keeps running while blurred.
  - Once the certificate is showing, the warning never applies. The words area never becomes blurred, and the focus button never covers the certificate.
- **Caps Lock.** A keydown of the Caps Lock key toggles the warning. Any other keydown shows the warning when its Caps Lock modifier state is on, and clears it when it is off. The warning never changes what is typed.
- **Quick restart.**
  - With quick restart `tab`, Tab from the typing input moves focus to `button "Restart test"`, and Enter or Space on it restarts.
  - With `enter`, Enter restarts at any time in the Test folder, including on the certificate, as long as no dialog is open. There are two exceptions:
    - When focus is on a link, Enter follows the link.
    - When focus is on a button other than Restart test, Enter activates that button (for example `button "Begin test"`).
  - With `enter`, Enter on a `radiogroup "Mode"` or `radiogroup "Length"` radio, or on the Punctuation or Numbers checkbox, restarts with the current settings and never changes them. With `tab`, Enter on those controls does nothing. Radios change only by arrow keys, click or tap, and checkboxes only by Space, click or tap.
  - While `dialog "Command line"` or `dialog "Custom text"` is open, Enter belongs to the dialog (see Command line and Custom text below) and never restarts, whatever the quick-restart setting.
  - A restart issues a new ticket with the same settings, discards the log, submits nothing, resets the timer and returns focus to the typing input. `button "Next test"` on the certificate does the same.
- **Timers belong to their test.**
  - Every timer a test starts belongs to that test's ticket: the end timer, the per-second readout tick, the focus warning timer and the resend loop (Feedback states).
  - Each of these cancels every timer of the old test:
    - a quick restart
    - `button "Next test"`
    - opening the command line during a test
    - following a Folders link away from the Test folder
  - A new time test always ends exactly `<length> × 1000` milliseconds after its own first logged key. For example, a restart made 10 seconds into a 15-second test never ends the next test early.
  - A verdict that arrives after the typist has moved on to a new test still files the run on the server (it shows in history), but it never changes the new sheet's seal, its result region or its announcements.
- **Command line.**
  - Escape opens `dialog "Command line"` from anywhere in the Test folder, whichever control has focus, unless another dialog is open. If a test is running, it is abandoned, and a new ticket is issued when the dialog closes.
  - Focus starts in `combobox "Command"`.
  - An option matches when every space-separated part of the typed text appears in its label, ignoring case. For example, `time 60` matches only `Time: 60`.
  - The first match is active: it is the `aria-activedescendant` and has `aria-selected="true"`.
  - ArrowDown and ArrowUp move the active option through the matches and wrap at both ends. `listbox "Commands"` scrolls inside the dialog so the active option is always fully visible.
  - Tapping or clicking an option applies it. Enter applies the active option. Either way the dialog closes.
  - Escape closes the dialog without applying anything. On close, focus returns to the typing input.
  - Tab from the last control goes to the first, and Shift+Tab from the first goes to the last.
- **Custom text.**
  - **The remembered custom text.** The browser remembers the custom text of the last custom ticket issued, for guests and signed-in typists alike. It survives reload and starts out empty.
  - **Opening the dialog.** Choosing the `custom` radio opens `dialog "Custom text"`, prefilled with the remembered custom text, with focus in its textbox. Applying `Mode: custom` from the command line does the same: the command line closes, the Custom text dialog opens in its place, and `Mode: custom applied.` is announced.
  - The live count updates on every input. Over a limit, the limit message from Feedback states replaces the count, and `button "Use text"` is disabled.
  - **Use text.** Use text, by click, tap, or Enter anywhere in the dialog while it is enabled, requests a custom ticket with that text. It then remembers the text and closes the dialog. While Use text is disabled, Enter does nothing. Line breaks typed or pasted into the textbox are whitespace and collapse under the custom text rule.
  - **Escape.** Escape closes the dialog without using its content.
    - If a custom text is remembered, a custom ticket with the remembered text is requested.
    - If none is remembered, the mode returns to the one chosen before custom, and a ticket for that mode is requested.
  - **Focus after closing.** The final focus owner depends on how the dialog was opened, and it does not change when the ticket arrives.
    - Opened from the `custom` radio: on close, by Use text or by Escape, focus moves to the checked radio of `radiogroup "Mode"` and stays there after the requested ticket arrives. The typist reaches the typing input with Tab or `button "Begin test"`.
    - Opened from the command line: on close, focus moves to the typing input and stays there when the ticket arrives.
  - **Other custom tickets.** A restart, `button "Next test"`, a test abandoned by the command line, and loading the Test folder with custom as the last chosen mode never open the dialog. Each requests a custom ticket with the remembered custom text (`"length":null`, `"text":"<remembered text>"`).
  - Tab and Shift+Tab wrap inside the dialog.
  - While closed, the dialog and `id="custom-count"` are not in the accessibility tree.
- **Settings changes.**
  - Settings are applied on screen at once, in the order the typist chose them.
  - The server ends up holding the last choice, and a reload shows the last choice, even when an earlier save is slowed on the network or answered late.
  - An earlier save, or its late answer, never overwrites a later choice on screen or on the server.
- **Replay slider.**
  - ArrowRight and ArrowUp move it +1 second. ArrowLeft and ArrowDown move it −1. PageUp moves +5 and PageDown −5. Home jumps to 0 and End to the maximum. Values stay inside the range.
  - Pointer and touch dragging snap to whole seconds. Dragging the slider by touch never scrolls the page.
  - On a just-finished test the slider starts at the maximum and the address does not change.
- **Replay position in the address (`/runs/<id>`).**
  - On a stored run with a carbon, every slider move replaces the current address with `/runs/<id>?at=<s>`. It never adds a history entry, so Back after scrubbing leaves the run page.
  - Opening `/runs/<id>?at=<s>` with a whole number `s` from 0 to the maximum starts the slider at `s`, with the carbon, caret, numeral, chart point and table row for that second.
  - A whole number below 0 is clamped to 0, and one above the maximum is clamped to the maximum. The address is then replaced with the clamped value.
  - An `at` that is not a whole number (for example `1.5`) starts the slider at the maximum, and the address is replaced with `?at=<maximum>`.
  - With no `at`, the slider starts at the maximum and the address stays as it is until the slider moves.
  - Runs without a carbon ignore `at` and leave the address unchanged.
- **Board tabs.** In each tab list, ArrowLeft and ArrowRight move focus to the previous or next tab, wrapping at the ends, and select it at once. Only the selected tab is in the Tab order. The chosen board and length are kept in the URL (`/boards?board=daily&length=15`).
- **History filters.** Changing a filter updates the table at once, without a submit button, and writes the filter to the URL (`?mode=time&length=15&verdict=counted`). `verdict` is `counted` or `not_counted`, and an absent parameter means All. Reloading keeps the filters. Older runs appends the next 20 runs.
- **Race rooms.**
  - `button "Create room"` opens `/race/<code>` with the creator seated as host.
  - `textbox "Room code"` accepts the code in any case, with or without the dash, with spaces trimmed. Enter in the textbox, or `button "Join"`, joins.
  - Opening `/race/<code>` directly joins the room if the visitor is not seated yet.
  - Refusals appear as an `alert` on the page where they happened.
  - `button "Start race"` is disabled until two racers are seated.
  - During the countdown, keys are ignored. From `Go`, keys type into the room's words area.
  - When a racer's test ends, their log is submitted (API) and their words area is replaced by their own result line.
- **Signing up and in.** Enter in any field submits its form. After sign-up the page shows the check-your-email heading. Sign-in returns to the page the typist came from, or to `/`.
- **Ended sessions.** When a request answers 401 `unauthenticated` for a page that showed a signed-in typist, the top row replaces `link "Account"` and `button "Sign out"` with `link "Sign in"`.
- **Focus.** Every interactive element shows a visible focus ring whenever it has keyboard focus. The ring is at least 2 pixels thick and drawn in the ink colour. Every dialog keeps Tab and Shift+Tab inside itself, closes on Escape, and returns focus to the control named above.

### Visual design (DP-68, DP-69, DP-70, DP-72)

The direction is "the page is the object": the product is a typing school's file drawer.

- The page ground (the page background) is the theme's background. In the default `sand` theme that is a warm light sand.
- On that ground sits the drawer, a flat cobalt field. The drawer fills the hero edge to edge and frames every folder screen with a cobalt margin around its sand folder.
- Each section is a tabbed sand folder inside the cobalt drawer, and the open front folder holds the work.
- In the other themes, the theme's background takes the sand's place (page ground, folders and sheets), and its text colour takes the cobalt's place (ink and drawer field).

- **Typefaces.**
  - Bodoni Moda, a high-contrast didone with hairline strokes, is the display face: the wordmark, the headline, the certificate's speed figure, the replay numeral and section headings.
  - Jost, a geometric sans, is used for everything else. That includes the typing passage, which is set large in Jost and never in monospace.
  - Every figure uses Jost's tabular (equal-width) digits, so columns of numbers line up on their decimal point.
- **Scale.** Each heading step is one third larger than the step below it, starting from the body text.
- **Colour roles.**
  - Ground: a warm light sand, the page background in the default `sand` theme.
  - Drawer field: the ink cobalt.
  - Surface: a slightly darker sand, for panels set on the sand.
  - Ink: a deep cobalt blue, for text, the caret, strokes and the solid buttons.
  - Muted: a softer mid blue, for incorrect and extra letters, secondary labels and the third folder tone.
  - Accent: the same deep cobalt as the ink, so there is exactly one hue.
  - Text on accent: the sand.
  - There is no second hue, no gradient, and no shadow heavier than a sheet lifting off a desk.
  - Muted text sits only on the sand ground, or at large size on the darker surface, so every text and its background meet WCAG 2.2 AA contrast.
- **Density.** Comfortable: generous margins around each sheet, and rows tall enough to read at a glance.
- **Composition and hero.** As described for the Test folder in Screens and layout. The hero is the product: the live test sheet sits in the open folder.
- **Working screens.** Everything is a piece of the same stationery.
  - Panels are filled sand or darker sand with real edges, never outlined boxes.
  - The test sheet is a tall paper panel, like a typing-exam passage, with a cobalt caret. The letters follow the marks in Public screens and controls.
  - The certificate is a 5:7 card. Its speed is set in Bodoni at about 96 pixels. Raw speed, accuracy and consistency sit in one tabular column. Errors by key are a small keyboard drawn in thin cobalt strokes, with the miskeyed keys filled. A perforated stub of small round holes along the foot holds the seal and the proof key.
  - History is a ledger sheet that becomes index cards on phone.
  - Boards are a pinned results sheet with one rank column.
  - A race room is a ticket with a notch cut from its edge, the room code set large, and the seats drawn as filled stamps.
  - The empty history is a blank sheet carrying the empty copy.
  - Outages are a cobalt slip clipped across the folder top.
  - Settings is a form printed on the back of a folder.
- **Controls.** Solid cobalt blocks with sand text, whose top corners slope like folder tabs. Every control is at least 44 pixels tall and wide, for touch.
- **Avoid.** Dark terminal looks, monospace labels, glass effects, index numbering and decorative hairline rules.

### Motion and effects (DP-62, DP-63)

All motion starts quickly and settles gently, and none of it loops.

- **Sheet to certificate.** When a test ends, the certificate rises 24 pixels into place and fades in over 480 milliseconds, just under half a second.
- **Seal stamp.** When the verdict arrives, the seal shrinks from 1.2 times its size to its normal size over 240 milliseconds, about a quarter of a second, like a stamp pressed onto the stub.
- **Carbon ink-in.** As the playhead moves forward, each newly struck letter inks in over 120 milliseconds. Moving backward un-strikes letters in reverse order, step by step, and the reverse is instant.
- **Smooth caret.** With smooth caret on, the caret glides from its old place to its new place over 100 milliseconds after each keystroke, easing out, so a sample halfway through falls between the two places. With smooth caret off, it jumps.
- **Folder tabs.** On hover or press, a tab rises a few pixels in under a fifth of a second.
- **Curtain footer.** The footer sits behind the last folder and is revealed as the folder scrolls up off it.
- **No other motion.** There are no decorative loops, pulsing, shimmer or idle animation anywhere.
- **Reduced motion.** When the system asks for reduced motion:
  - There is no rise, ink-in or stamp. The certificate appears in place, letters show or hide at once as the playhead moves, and the seal text swaps.
  - The caret always jumps, the tabs do not rise, and the footer sits in the normal page flow.
  - None of these effects has frames in between.
  - Scrubbing, the numeral, the chart cursor, the verdict and every announcement work exactly as without reduced motion.

### Feedback states (DP-07, DP-19, DP-27, DP-36, DP-37, DP-38, DP-40, DP-46, DP-50, DP-53, DP-54, DP-55, DP-57, DP-59, DP-60, DP-71, DP-74, DP-75)

Placeholders used in the copy below:

- `<speed>`, `<raw>`, `<accuracy>` and `<consistency>` are those values rounded half up to two decimals.
- `<name>` is a display name, and `<email>` is the address typed.
- `<rank>` is a whole number.
- `<ordinal>` is the English ordinal of a place: `1st`, `2nd`, `3rd`, then `th` for every other number. `11th`, `12th` and `13th` end in `th`, while `21st`, `22nd`, `23rd` and `31st` follow their last digit.
- `<n>` is whole seconds, rounded up.
- `<label>` is a command label.
- `<c>` and `<w>` are the custom character and word counts.
- `<XXX-XXX>` is the room code with its dash.
- `<proof>` is the first 16 characters of the run's `proofKey`.

| Moment | Where | Exact copy |
|---|---|---|
| Test ends | `status "Test result"`, announced once per test | `Speed <speed>, accuracy <accuracy>%, raw <raw>, consistency <consistency>%.` For example, the first worked example gives `Speed 55.00, accuracy 91.67%, raw 60.00, consistency 73.24%.` |
| Run submitted, waiting | `status "Seal"` | `Held: replay in progress` |
| Counted | `status "Seal"` | `Counted`, plus a line `New personal best` when the response marks one |
| Refused | `status "Seal"` | `Not counted: <reason>` |
| Proof key known | `id="proof-key"` | `Proof <proof>` |
| Guest run, or a session that ended before the verdict | `status "Seal"` | `Not filed: sign in to keep your runs.` |
| Unverified run | `status "Seal"` | `Not filed: verify your email to keep your runs.` |
| Setting applied from the command line | `status "Settings updates"` | `<label> applied.` |
| Caps Lock on | `status "Caps Lock"` | `Caps Lock is on` |
| Custom text over a limit | in place of the live count | `Custom text can have at most 2000 characters and 400 words.` |
| No miskeyed keys | in place of `table "Errors by key"` | `No errors.` |
| Ticket request failed | `alert` on the sheet | `Could not start a test. Check your connection and try again.` |
| Empty history | the history sheet | `Nothing filed yet. Your first counted run will be filed here.` |
| Run not found | heading on `/runs/<id>` | `No such run.` |
| Empty board | in place of the Leaderboard rows | `No counted runs on this board yet.` |
| Board change | `status "Board updates"` | `<name> is now #<rank> with <speed> wpm.` |
| Signed up | heading, then line | `Check your email`, then `We sent a verification link to <email>.` |
| Mail down at sign-up | `status "Mail status"` banner, replacing the "We sent" line | `Email is unavailable. Your verification email will be sent when it recovers.` |
| Duplicate email | field error under Email | `An account with that email already exists.` |
| Bad display name | field error | `Display name must be 1 to 24 characters.` |
| Bad email | field error | `Enter a valid email address.` |
| Short password | field error (sign-up and new password) | `Password must be at least 10 characters.` |
| Verified | heading, then line | `Email verified`, then `Your runs will now be filed.` |
| Used or expired link | heading, then line | `Link expired`, then `This link has expired or was already used.` |
| Wrong sign-in | `alert` | `Email or password is incorrect.` |
| Too many sign-ins | `alert` | `Too many attempts. Try again in <n> seconds.` |
| Reset requested | line under the form | `If that email has an account, a reset link is on its way.` |
| Password set | heading, then line, with the signed-out top row | `Password changed`, then `Sign in with your new password.` |
| Race page signed out | line beside `link "Sign in"` | `Sign in to race.` |
| Unknown room | `alert` | `No room with that code.` |
| Full room | `alert` | `This room is full.` |
| Started race | `alert` | `This race has already started.` |
| Rejoined | `status "Race updates"` on the rejoining racer's page | `Rejoined race <XXX-XXX>.` |
| Another racer seated | `status "Race updates"` | `<name> joined.` |
| Another racer's lobby seat freed, or another racer marked Left in a race | `status "Race updates"` | `<name> left.` |
| Host role passed on | `status "Race updates"` | `<name> is now the host.` |
| Racer finished and placed | `status "Race updates"` | `<name> finished <ordinal> with <speed> wpm.` |
| Race over | heading, and `status "Race updates"` | heading `Race finished`; announcement `Race finished.` |
| Unknown page | heading | `Page not found` |
| Any other server error | `alert` | `Something went wrong. Try again.` |

Reasons for `Not counted: <reason>`, by error code:

| Code | `<reason>` |
|---|---|
| `wrong_text` | `the text does not match this test.` |
| `impossible_interval` | `keystrokes arrived faster than a person can type.` |
| `duration_mismatch` | `the test length does not match its mode.` |
| `replay_mismatch` | `the replay does not match the submitted result.` |
| `ticket_expired` | `this test expired before it was submitted.` |
| `invalid_log` | `the keystroke log is malformed.` |
| `log_too_long` | `the keystroke log is too long.` |
| `ticket_not_found` | `this test was not issued to you.` |

**Race announcements.** `status "Race updates"` announces each room event exactly once on the page of every other seated racer: joins, leaves, host handovers, placed finishes and the race end. A racer's own join, leave, handover and finish announce nothing on their own page. After a live connection drops and reconnects, the page reloads the room state but never repeats an event already announced, and announces any event it missed once. `status "Race countdown"` shows each step the server pushes, exactly once and in order. It never shows a step the server did not push.

**Async actions and their states.**

- **Ticket request.**
  - Pending: the words area is busy.
  - Success: the words appear and the typing input has focus.
  - Failure: the ticket alert.
- **Run submission (signed in and verified only).**
  - Pending: the held seal.
  - The first answer with a status below 500 is the verdict:
    - 201 shows `Counted`.
    - A body with a code from the reasons table shows `Not counted: <reason>`.
    - 401 shows the sign-in Not filed copy.
    - 403 `email_unverified` shows the unverified copy.
  - Both 201 and 422 answers carry the proof key.
  - After a network failure or a 5xx answer, the seal stays held and the browser sends the identical body again 5 seconds later. It repeats this until the verdict arrives. After the verdict, nothing more is sent for that ticket.
  - The resend loop belongs to its test (Interactions). Guest and unverified runs are never submitted, and their seal shows the matching Not filed copy at once.
- **Sign-up, sign-in, reset and new password.**
  - Pending: the submit button is disabled.
  - Success and errors: as listed above. Field errors sit under their fields and are announced.
- **History filter and Older runs.**
  - Pending: the table has `aria-busy="true"`.
  - Success: the rows update in place.
- **Board and race updates.** These are pushed and update in place with their announcements. If the live connection drops, the page reconnects within 5 seconds and reloads the board or room state.

## Backend

### API (DP-01, DP-27, DP-32, DP-34, DP-35, DP-38, DP-40, DP-42, DP-43, DP-44, DP-49, DP-53, DP-65, DP-74, DP-75)

Conventions for every endpoint:

- Every request and response body is JSON (`application/json`, UTF-8).
- Times are ISO 8601 in UTC (`2026-11-03T09:15:00.000Z`).
- Numbers are rounded half up to two decimals.
- Authentication is a session cookie, set by sign-in and sign-up and cleared by sign-out.
- Every error body has the shape `{"error": "<code>"}`, with extra keys only where a row below says so.

**Error precedence (the whole API).** Checks run in this order, and each later check runs only if every earlier one passed:

1. `401 {"error":"unauthenticated"}`
2. `403 {"error":"email_unverified"}`, for endpoints that need a verified typist
3. `415 {"error":"unsupported_media_type"}`, then `413 {"error":"body_too_large","limit":1000000}`, then `400 {"error":"invalid_json"}`
4. `413 {"error":"log_too_long","limit":12000}` (the limit is the configured `MAX_LOG_EVENTS`)
5. `404`, for an unknown resource or one that belongs to someone else
6. `403`, for a resource the caller may see but not change
7. an already-submitted ticket returns its stored response
8. state conflicts (`409`, `410`)
9. validation (`422`), in the endpoint's listed order

**Keystroke log.**

- A log is a JSON array of `{"k": <key>, "t": <integer ms>}` entries in typing order.
- `k` is exactly one of: a single printed character (letters, digits or punctuation, with case kept), `"Space"`, `"Backspace"` or `"CtrlBackspace"`.
- `t` is `Math.round(now − start)` in milliseconds.
  - In a ticketed test, `start` is the clock origin from Business rules (the test's first logged key), so the first entry's `t` is 0.
  - In a race, `start` is Go, so the first `t` may be above 0 (Business rules, Race rooms).

**Proof key.** `proofKey` is the lowercase hex SHA-256 of the exact bytes of the first request body the server received for that ticket (or that race finish). It is computed before any parsing. Whitespace and key order are part of the bytes.

| Method and path | Request | Success | Endpoint errors |
|---|---|---|---|
| `GET /api/health` | none | `200 {"status":"ok"}` | while the database is unreachable at boot: `503 {"status":"starting"}` |
| `GET /api/config` | none | `200 {"focusWarningMs":<int>,"maxExtraLetters":<int>,"raceCountdownSeconds":<int>,"raceRejoinSeconds":<int>}` | none |
| `POST /api/signup` | `{"name","email","password"}` | `201 {"id":"<uuid>","email","verified":false,"mail":"sent"\|"retrying"}`; signs the typist in | `409 {"error":"email_taken"}`; `422 {"error":"invalid_fields","errors":{"<field>":"<field message from Feedback states>"}}` |
| `POST /api/verify` | `{"token"}` | `200 {"verified":true}` | `410 {"error":"link_expired"}`, for an unknown, used or expired token |
| `POST /api/session` | `{"email","password"}` | `200 {"id","name","verified"}`; sets the cookie | `401 {"error":"invalid_credentials"}`; `429 {"error":"too_many_attempts","retryAfter":<seconds>}` |
| `DELETE /api/session` | none | `204`; ends only this session | none |
| `GET /api/me` | none | `200 {"id","name","verified"}` | 401 |
| `POST /api/password-reset` | `{"email"}` | `202 {"status":"accepted"}`, for any email | none |
| `POST /api/password-reset/confirm` | `{"token","password"}` | `200 {"status":"changed"}`; ends every session of the typist, including the caller's, and clears the caller's cookie | `410 {"error":"link_expired"}`; 422 `invalid_fields` |
| `GET /api/settings` | none | `200 {"theme","caret","smoothCaret":bool,"fontSize":<number>,"blindMode":bool,"quickRestart":"tab"\|"enter"}` | 401 |
| `PUT /api/settings` | the same full object | `200` with the stored object | 401; 422 `invalid_fields` |
| `POST /api/tickets` | `{"mode":"time"\|"words"\|"quote"\|"custom","length":<see note>,"punctuation":bool,"numbers":bool,"text":"<custom text>"\|null}` | `201 {"ticketId":"<uuid>","seed":<int>\|null,"words":["..."],"quoteId":"q1".."q6"\|null,"expiresAt":"<ISO>"}` | `422 {"error":"invalid_ticket_request"}`; `422 {"error":"custom_text_empty"}`; `422 {"error":"custom_text_too_long"}` |
| `POST /api/runs` | `{"ticketId","text":["..."],"log":[...],"duration":<ms>,"speed","raw","accuracy","consistency","characters":{"correct","incorrect","extra","missed"}}` | `201 {"runId","verdict":"counted","personalBest":bool,"speed","raw","accuracy","consistency","proofKey"}` | needs a verified typist; 413 `log_too_long`; `404 {"error":"ticket_not_found"}`; `410 {"error":"ticket_expired"}`; 422 codes in run-check order, each `{"error":"<code>","verdict":"not_counted","runId":"<uuid>","proofKey":"<hex>"}` |
| `GET /api/runs/<id>` | none | `200 {"runId","mode","length","punctuation","numbers","quoteId","words","log","duration","speed","raw","accuracy","consistency","characters","errorsByKey":{"<key>":<int>}\|null,"perSecond":[{"second","speed","raw","errors"}]\|null,"verdict":"counted"\|"not_counted","reason":"<code>"\|null,"finishedAt","proofKey":"<hex>"\|null}` (see note) | `404 {"error":"not_found"}`, for an unknown run or another typist's |
| `GET /api/history?mode=&length=&verdict=&page=` | query; `page` counts from 1 | `200 {"runs":[{"runId","finishedAt","mode","length","speed","raw","accuracy","consistency","verdict"}],"more":bool}` | 401 |
| `GET /api/account` | none | `200 {"name","email","verified","testsCounted":<int>,"personalBests":[{"mode","length","punctuation","numbers","speed","accuracy","finishedAt","runId"}]}` | 401 |
| `GET /api/boards?board=daily\|alltime&length=15\|60` | query | `200 {"rows":[{"rank","name","speed","accuracy","finishedAt"}]}`, with exactly those keys in each row | `422 {"error":"invalid_board"}` |
| `POST /api/rooms` | `{}` | `201 {"code":"<6 characters>"}`; the creator is seated as host | 401 |
| `GET /api/rooms/<code>` | none (seated racers) | `200 {"code","state":"open"\|"countdown"\|"racing"\|"finished","racers":[{"name","host":bool,"left":bool,"progress":<int>,"place":<int>\|null,"speed"\|null,"accuracy"\|null}],"words":["..."]\|null,"elapsedMs":<int>\|null}` | `404 {"error":"room_not_found"}` |
| `POST /api/rooms/<code>/join` | `{}` | `200 {"code","rejoined":bool}` | `404 {"error":"room_not_found"}`; `409 {"error":"race_started"}`; `409 {"error":"room_full"}` |
| `POST /api/rooms/<code>/start` | `{}` | `200 {"state":"countdown"}` | 404 `room_not_found`; `403 {"error":"not_host"}`; `409 {"error":"race_started"}`; `409 {"error":"not_enough_racers"}` |
| `POST /api/rooms/<code>/finish` | as for `POST /api/runs`, without `ticketId` | `200 {"place":<int>,"verdict":"counted","speed","accuracy","proofKey"}` | 404 `room_not_found`; `409 {"error":"race_over"}`; the 422 run codes |
| `POST /api/grading/setup` | header `X-Grading-Key`; `{"typists":[{"email","name","password","verified":bool}],"runs":[{"email","mode","length","punctuation","numbers","speed","raw","accuracy","consistency","finishedAt"}]}` | `201 {"typists":[{"email","id"}]}` | a missing or wrong key: `404 {"error":"not_found"}` |
| `POST /api/grading/next-text` | header `X-Grading-Key`; `{"target":"typist:<email>"\|"guest"\|"race","words":["..."]}` or `{"target":...,"quoteId":"q1".."q6"}` | `200 {"queued":true}` | a missing or wrong key: 404 |

Notes:

- The ticket `length` depends on the mode: `15`, `30`, `60` or `120` for time; `10`, `25`, `50` or `100` for words; `"short"`, `"medium"`, `"long"` or `"all"` for quote; `null` for custom.
- In `GET /api/runs/<id>`:
  - `words` are the ticket's words.
  - For a counted run, every figure is the replay's (equal to the submitted ones).
  - For a not-counted run, `duration`, `speed`, `raw`, `accuracy`, `consistency` and `characters` are the submitted values as stored, and `errorsByKey` and `perSecond` are `null`, whatever the reason (Business rules, run checks).
  - `log` is the JSON value exactly as submitted.
  - `proofKey` is `null` only for runs made by the grading route.
- `<code>` in room paths accepts any case, with or without the dash.
- Racers must be signed in. Verification is not needed to race.
- The live channel (a WebSocket or Server-Sent Events, at a path of your choosing on the same origin) carries board changes, room events and state, countdown steps, racers' typed entries and progress. The server computes race progress from the entries racers send. A live connection opened by a signed-in session belongs to that session.
- The grading routes never return session tokens or passwords.
  - Setup with an email that already exists replaces that typist's name, password and verified flag, and adds the runs.
  - Runs created by setup are counted runs with `log` `[]`, `duration` `null`, `errorsByKey` and `perSecond` `null`, and `proofKey` `null`.
  - `next-text` makes the next ticket issued to that typist (or to any guest, or the next race started) use exactly those words, or that quote's words and `quoteId`, with `seed` null, in whatever mode is requested. A time test with fixed words never needs more words in grading.

### Business rules (DP-02, DP-03, DP-04, DP-05, DP-06, DP-09, DP-10, DP-11, DP-17, DP-26, DP-27, DP-34, DP-35, DP-36, DP-37, DP-39, DP-42, DP-43, DP-44, DP-45, DP-48, DP-50, DP-53, DP-54, DP-55, DP-56, DP-57, DP-59, DP-60, DP-74, DP-75, DP-76)

**One typing engine.** The test sheet, the carbon replay, the race page and the server replay all apply exactly these rules to a log.

- **Clock origin.** A ticketed test's clock starts at its first logged key of any kind, including a Space or Backspace that has no effect. That key's `t` is 0. The time test's length, the timer and the live readouts all count from that moment. In a race, the origin is Go instead (Race rooms).
- **Letters** go into the current word. Letters past the word's length are **extra** letters, at most `MAX_EXTRA_LETTERS` per word. Any further letter is logged, but it has no effect and is not a keystroke.
- **Space** with nothing typed in the current word does nothing: it is logged, but it is not a keystroke. Otherwise Space moves to the next word, and the untyped letters of the word it leaves become **missed**. On the last word of a words, quote, custom or race test, Space ends the test. In a time test, Space on the last word does nothing.
- **Backspace** deletes the current word's last typed letter. In an empty current word, it moves back into the previous word, but only if that word has an error, meaning its typed letters differ from the word. The caret then goes to the end of that word's typed letters, and its missed letters become untyped again. Otherwise Backspace does nothing.
- **CtrlBackspace** deletes all typed letters of the current word. In an empty current word, it moves back into the previous word under the same error-only rule and deletes all of that word's typed letters.
- **Test end.** A words, quote, custom or race test ends on the keystroke that makes the last word's typed letters equal the word, or on Space in the last word. A time test ends when `<length> × 1000` ms have passed since the first logged key. Keys at or after that moment are ignored and not logged.
- **Keystrokes** are the entries counted for accuracy, raw speed and errors: letters that took effect, plus Spaces that moved on or ended the test.
  - A letter keystroke is correct when it lands at position `i`, below the word's length, and equals the word's letter `i`. Extra letters are incorrect.
  - A Space keystroke is correct when the word it leaves was typed exactly.
  - Backspace and CtrlBackspace are never keystrokes. A letter typed wrong and then deleted still counts as an incorrect keystroke.

**Formulas.**

- `duration` (ms) is `<length> × 1000` for a time test. For other tests it is the `t` of the keystroke that ended the test. `minutes = duration / 60000`.
- **Speed** = correct-word characters / 5 / minutes. Correct-word characters are counted as follows:
  - For every word left with Space whose typed letters equal the word: its length + 1 (for the Space).
  - For the word the test ended in, in a finished words, quote, custom or race test: its length, if it was typed exactly.
  - For the word a time test ended in: its typed letter count, if the typed letters are an exact prefix of the word, and otherwise 0.
- **Raw speed** = keystrokes / 5 / minutes.
- **Accuracy** = 100 × correct keystrokes / keystrokes. With no keystrokes it is 100: the API sends `100`, the certificate shows `100.00%`, and the live readout shows `100%`.
- **Per-second raw.** For second `k` from 1 to `ceil(duration / 1000)`, take the interval `[(k−1)×1000, min(k×1000, duration))`. The last interval also includes a keystroke at exactly `duration`. The value is the keystrokes in the interval × 12000 / the interval's length in ms. The number of seconds in a run is `ceil(duration / 1000)`.
- **Consistency** = max(0, 100 − 100 × population standard deviation / mean) of the per-second raw values. It is 0 when the mean is 0.
- **Per-second speed** is the chart's Speed, the replay numeral and the live speed. For second `k`, it is the Speed of the keystrokes with `t` below `k × 1000`, scored as a time test of `k` seconds. The last second (where `k × 1000 ≥ duration`) shows the final Speed.
- **Per-second errors**: the incorrect keystrokes in that second's interval.
- **Characters** `<correct>/<incorrect>/<extra>/<missed>` are counted over the final typed state of every word reached:
  - correct and incorrect letters below each word's length
  - extra letters
  - missed letters, from words left with Space and from the last word when Space ended the test

  A time test's unfinished last word has no missed letters.
- **Errors by key.** Every incorrect keystroke counts once: under the letter it should have been (with case as in the text), under `space` for a Space, and under `extra` for an extra letter. Rows are ordered by Errors descending, then by Key ascending in plain UTF-16 code unit order, case-sensitive, comparing whole key strings. For example, `B` comes before `a`, `,` before `a`, and `extra` before `space`.
- **Rounding.**
  - Every number is rounded half up to two decimals in the API and shown with exactly two decimals on screen (`55.00`).
  - Accuracy and consistency show `%` after the number (`91.67%`).
  - Duration shows seconds with two decimals followed by ` s` (`2.40 s`).
  - When `duration` is 0, Speed, Raw speed and Consistency are 0.00, and the run has no per-second rows.

**Worked example.** A words test with the text `the cat sat`, typed `t h e Space c x Backspace a t Space s a t` with 200 ms between keys (`t` = 0, 200, …, 2400).

- There are 13 log entries. Backspace is not a keystroke, so there are 12 keystrokes, 1 of them incorrect (`x` where `a` was due). The duration is 2400 ms.
- Correct-word characters: `the ` 4 + `cat ` 4 + `sat` 3 = 11.
- Speed = 11 / 5 / 0.04 = **55.00**. Raw = 12 / 5 / 0.04 = **60.00**. Accuracy = 11 / 12 = **91.67%**.
- Per-second raw: second 1 has 5 keystrokes, so 60.00. Second 2 has 4, so 48.00. Second 3 (2000–2400 ms, 400 ms long) has 3, so 90.00.
- Consistency = 100 − 100 × 17.66 / 66 = **73.24%**.
- Per-second speed: 60.00, 48.00, 55.00. Per-second errors: 0, 1, 0.
- Characters `9/0/0/0`. Errors by key: `a` 1.

**Second example.** A 2-second time test with the text `sun map red ink toy`, typed `s u n Space m o p Space r e d d Space i` at 150 ms steps.

- There are 14 keystrokes, 4 of them incorrect: `o`, the Space after `mop`, the extra `d`, and the Space after `redd`.
- Speed = (`sun ` 4 + `i` 1) / 5 / (2/60) = **30.00**. Raw **84.00**. Accuracy **71.43%**. Consistency **100.00%**.
- Characters `9/1/1/0`. Errors by key: `space` 2, `a` 1, `extra` 1.

**Text generator.**

- The pseudo-random generator is mulberry32, exactly: `function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}`.
- A ticket's seed is `(TEXT_SEED + n) mod 2^32`. `n` is the ticket's sequence number in this database, counting from 1. Every ticket issued (generated, fixed, quote or custom) and every race start takes the next `n`. `r()` below is mulberry32 started with that seed.
- Words, for i = 0, 1, …:
  1. Draw `w = list[floor(r() × 120)]` from the `holloway-120` list (Seed data). Redraw while `w` equals the previous drawn list word.
  2. With numbers on, draw `x = r()`. If `x < 0.15`, replace `w` with `String(floor(r() × 1000))`.
  3. With punctuation on, draw `y = r()`. If `y < 0.1`, append `,`. Otherwise, if `y < 0.2`, append `.`.
  4. With punctuation on, capitalise the word (first character upper case) when `i` is 0 or the previous word ends with `.`.
- Counts: a time test gets `<length> × 4` words, a words test gets `<length>` words, and a race gets `RACE_WORDS` words.
- Examples: seed 4243, 12 words: `apple cotton bloom valley crane yarrow stone slate stone maple copper willow`. Seed 4243 with punctuation and numbers on: `Apple. Valley stone maple arch fable 455 sail otter pebble dove canal`.

**Quotes and custom text.**

- A quote test picks `group[floor(r() × group size)]` with the ticket's first draw. The group is the quotes of that length in id order, and `all` is all six in id order.
- A quote's words are the quote split on single spaces, with case and punctuation kept. Quote tests are always issued with punctuation and numbers off.
- Custom text: runs of whitespace collapse to one space, and the text is trimmed.
  - It may have at most 2000 characters and at most 400 words. Exactly 2000 and exactly 400 are allowed.
  - Characters are counted as Unicode code points, so an emoji counts as 1. Words are the space-separated parts.
  - The live count and the server use the same rule. Custom tickets are issued with punctuation and numbers off.

**Run states.** A run goes `typing → submitted → held → counted | not_counted`. `typing` and `held` exist in the browser only. The server records a run only together with its verdict, in one transaction, and never edits it afterwards.

**Run checks** for `POST /api/runs`, inside the API precedence:

1. `log_too_long` (413): `log` is an array with more than `MAX_LOG_EVENTS` entries, or an entry has a numeric `t` above `MAX_TEST_MS`. This is decided before any replay, answers within one second for any body up to the size limit, and stores nothing.
2. `ticket_not_found` (404): an unknown ticket, a guest ticket or another typist's ticket.
3. A ticket that already has a stored run returns that run's first response unchanged: same status, same body, same `proofKey`, whatever the new body says.
4. `ticket_expired` (410): the ticket is past its `expiresAt` on the server clock. Nothing is stored.
5. Then the 422 checks, in this order:
   1. `invalid_log`: `log` is not an array of `{k, t}` objects with an allowed `k` and an integer `t` and no other keys. For a ticketed run, also when the first `t` is not 0. For a race finish, also when the first `t` is below 0, or at or above `RACE_TIME_LIMIT_SECONDS` × 1000.
   2. `wrong_text`: `text` differs from the ticket's words.
   3. `impossible_interval`: any `t` is lower than the one before it, or more than 30% of the gaps between consecutive entries are under `FAST_INTERVAL_MS`.
   4. `duration_mismatch`: in a time test, `duration` is not `<length> × 1000`, or some `t` is at or after it. In other tests, the replay never ends the test, entries follow the ending keystroke, or `duration` differs from the ending keystroke's `t`.
   5. `replay_mismatch`: after rounding, the submitted speed, raw, accuracy or consistency, or any of the four character counts, differs from the replay.
6. Each 422 stores the run as not counted.
   - Its `log` is stored as the JSON value submitted, whatever that value is: for `invalid_log`, a string, `null`, nested arrays or objects with extra keys read back equal to what was sent.
   - It stores and returns the submitted `duration`, `speed`, `raw`, `accuracy`, `consistency` and `characters` counts, with numbers rounded half up to two decimals and `null` for any value that is missing or not a number. History shows those figures, with `-` for a `null`.
   - Its `words` are the ticket's words, and its `errorsByKey` and `perSecond` are `null`, whatever the reason: the server keeps no replay-derived figures for a refused run.
7. A counted run is stored with its log as submitted.
8. Every stored run (counted or not counted) stores the first body's raw bytes and its `proofKey`.
9. Only runs refused with a 422 code are filed as not counted and listed in history. A 404 `ticket_not_found`, 410 `ticket_expired` or 413 `log_too_long` refusal stores no run, so history, totals and boards are unchanged. The seal still shows its `Not counted: <reason>` from Feedback states. A later submission of the same ticket is checked afresh.

**One ticket, one run.** One ticket has at most one run, one history row and one board entry. Any number of submissions for one ticket, in sequence or in parallel, with the same or different bodies, all receive the response of the one submission that was recorded first, byte for byte. The ticket row, or a uniqueness rule in the database, decides which submission is first. The run checks in steps 1 and 2 still apply to each submission on its own.

**Personal bests and totals.**

- `personalBest` is true when a counted run becomes the best for its mode, length, punctuation and numbers setting. Best means the highest Speed; ties go to the higher accuracy, then to the earlier finish. A setting's first counted run is a best.
- `testsCounted` is the number of the typist's counted runs.
- The Personal bests table has one row per setting the typist has counted runs in, showing that setting's best. Rows are ordered by mode (time, words, quote, custom), then by length (numbers ascending; then short, medium, long, all), then punctuation off before on, then numbers off before on. A custom run's length is its word count.
- Punctuation and Numbers show `on` or `off`. Date shows `YYYY-MM-DD` (UTC).
- Not-counted, guest and unverified runs never reach any total, best or board.
- History shows the typist's counted and not-counted runs, newest first. Date shows `YYYY-MM-DD HH:MM` (UTC), and Verdict shows `Counted` or `Not counted`.

**Dates and the day boundary.** Every day boundary is UTC. Every date and time shown on boards, history, the account and the certificate is UTC, whatever the browser's time zone (for example in UTC+14 or UTC−11). A run finished at `<today>T00:00:00.000Z` is on today's daily board. A run finished at `<yesterday>T23:59:59.999Z` is not on it, but it is on the all-time board.

**Boards.**

- Eligible runs are counted runs by verified typists in time tests of 15 or 60 seconds, with punctuation and numbers off.
- Each board has one row per typist: their best eligible run, by Speed descending, then Accuracy descending, then the earlier finish. Rows are ordered the same way and ranked 1 to 50.
- The daily board covers runs whose server-recorded finish falls on the current UTC day. It resets at 00:00 UTC, and open daily boards show the new day's board within 3 seconds after 00:00 UTC.
- Typist shows the display name, and Date shows `YYYY-MM-DD` (UTC).
- When a counted eligible run adds or improves a row, every open board showing that board and length updates within 3 seconds, without reload, and announces the change. The signed-in typist's own row has `aria-current="true"`.

**Accounts and sessions.**

- Display names are 1 to 24 characters after trimming.
- Emails need text on both sides of a single `@` and a dot in the part after it. They are compared without regard to case.
- Passwords are at least 10 characters.
- Sign-up signs the new typist in. Unverified typists can type, but their runs are never submitted or filed.
- Verification links are valid for `VERIFY_TTL_SECONDS` and work once. Reset links are valid for `RESET_TTL_SECONDS` and work once.
- Confirming a reset ends every session of that typist, including the one that confirmed it. Within 5 seconds, every live connection opened by an ended session is closed. Every request made with an ended session answers 401 `unauthenticated`.
- **Sign-in limit.** Failed sign-ins are counted per email, exactly, even when requests arrive in parallel.
  - When an email has 5 failed sign-ins within the last 60 seconds, every further sign-in for it answers 429 until the oldest of those five is 60 seconds old, even with the right password.
  - For example, twelve parallel wrong-password sign-ins for one email give exactly five 401 and seven 429 answers.
  - `retryAfter` is the whole seconds remaining, rounded up.
  - Unknown emails get the same 401 and the same limit.

**Race rooms.**

- A room code is 6 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, shown as `XXX-XXX`.
- A room moves `open → countdown → racing → finished`, and the server times every step. An open room is deleted when its last racer is removed.
- **Seats.**
  - A room holds at most 8 seated racers.
  - When any number of racers claim the last seat at the same moment, exactly one is seated (200) and every other gets 409 `room_full`.
  - A racer who is already seated and joins again, even in parallel, gets `"rejoined":true` and never takes a second seat.
  - Joining a room that is not open gives 409 `race_started`, except for a racer already seated, who rejoins.
- **Starting.** Only the host starts, only from `open`, and only with at least two racers. Starting from any other state gives 409 `race_started`. A racer who is no longer host gets 403 `not_host`.
- **Countdown.** From the server's start instant, the server pushes the countdown steps one second apart, `RACE_COUNTDOWN_SECONDS` of them, then `Go`. Each racer's browser shows each step as it arrives and never computes the steps from its own clock.
- **Text.** Every racer types the same words: `RACE_WORDS` words from the generator, or the grading fixed text.
- **Timing.** In a race, `t` is measured from Go. `start` is the moment the browser receives Go or, on rejoin, now minus the server's `elapsedMs`. The first `t` need not be 0. Otherwise a race is a words test under the same rules and run checks.
- **Progress.** A racer's progress is `floor(100 × words completed correctly / words)`. Words completed correctly are words left with Space whose typed letters equal the word, plus the last word when it ends the test. Every racer's view of every progress bar updates within 1 second of that racer's typing, and a bar never goes down.
- **Places.**
  - A finish replays like a run. A passing finish is placed by replayed duration, shortest first.
  - Equal durations share a place, and the next place skips (1st, 1st, 3rd). The table re-sorts as finishes arrive.
  - A refused finish, or a finish arriving more than `RACE_TIME_LIMIT_SECONDS` after Go on the server clock (409 `race_over`), leaves that racer with Place `DNF`.
- **Race end.** The race is finished when every seated racer who has not left has finished, or `RACE_TIME_LIMIT_SECONDS` after Go. Unfinished racers then show Place `DNF`, and left racers show Place `Left`. For both, Speed and Accuracy show `-`.
- **Leaving during a race.** A racer whose live connection drops during `countdown` or `racing` keeps their seat and progress for `RACE_REJOIN_SECONDS`. Reloading within that time rejoins them: their typed entries come back from the server, the words area and caret are restored to the same place, and they continue. After that time they are marked Left. Leaving during a race never changes the host or frees a seat.
- **Leaving the lobby.**
  - In `open`, a racer whose last live connection has been closed for `RACE_REJOIN_SECONDS` is removed, and their seat is freed.
  - Until that moment the seat still counts, so a full room still answers 409 `room_full`. After it, a join succeeds.
  - If the removed racer was the host, the earliest-seated remaining racer becomes host, shows as `<name> (host)`, and gets `button "Start race"`.
  - When every racer has been removed, the room is deleted, and joins answer 404 `room_not_found`.
- Race results are not filed in history or boards. Rooms live in the app server's memory.

**Time rules.** Tickets expire `TICKET_TTL_SECONDS` after issue, on the server clock. Every timer and limit is read from the environment (Configuration and secrets).

### Services (DP-34, DP-35, DP-36, DP-74)

- **PostgreSQL** (`DATABASE_URL`) is the source of truth for:
  - typists, sessions, settings and sign-in failures
  - tickets, with their exact words
  - every first run body, as raw bytes with its proof key, and its log as submitted
  - verdicts, and counted and not-counted runs
  - personal bests, history and both boards
  - pending mail

  Apply the schema idempotently every time the server starts, not only at build.
- **Mail** goes over SMTP to `SMTP_HOST`:`SMTP_PORT`, where Mailpit captures it.
  - The From line is `MAIL_FROM` (`Strikeproof <proofs@strikeproof.test>` in grading). The To line is the typist's email.
  - Plain-text bodies put each link on its own line. Links are absolute, built from `APP_PUBLIC_URL`.
  - Verification mail: subject `Verify your Strikeproof account`, with the line `Verify: <APP_PUBLIC_URL>/verify/<token>`.
  - Reset mail: subject `Reset your Strikeproof password`, with the line `Reset: <APP_PUBLIC_URL>/reset/<token>`.
  - Sign-up sends exactly one verification mail.
- **Mail outage.** When the SMTP server cannot be reached:
  - Sign-up still answers 201 with `"mail":"retrying"`, and the page shows the mail outage banner.
  - The server keeps the message and retries every `MAIL_RETRY_SECONDS` until it is delivered, exactly once.
  - Reset requests are kept and retried the same way, and the reset page shows its usual notice.
  - Nothing else depends on mail, and `GET /api/health` still answers 200.

### Seed data (DP-02, DP-26)

The database starts empty: there are no typists, runs or rooms. Graders create invented typists through the grading route. The app ships two fixtures.

Word list `holloway-120`, in this order: `amber anchor apple arch ash attic badge barley basin beacon bell bench birch blade bloom bolt bramble brick bridge brook cabin candle canal cedar chalk cider cliff clover cobble comet copper coral cotton crane crest dawn delta ditch dove drift dune ember fable fern ferry field flint forge frost garden glade gravel harbor hazel heath hedge hollow honey inlet island ivory jetty kettle lantern larch ledge linen lodge maple marsh meadow mill mist moss nectar oak orchard otter paddle pebble pine plume quarry quill rain reed ridge river robin saddle sail shore slate spruce stone stream thistle timber tide trail valley velvet willow wren yarrow acorn barrow canopy dusk elm fjord grove hamlet iris juniper kiln lark moor nook pond`.

Quotes. These are public-domain passages, in ASCII only. `<source>` is the source column exactly.

| id | group | text | source |
|---|---|---|---|
| q1 | short | `Brevity is the soul of wit.` | `William Shakespeare, Hamlet (1603)` |
| q2 | short | `Beware; for I am fearless, and therefore powerful.` | `Mary Shelley, Frankenstein (1818)` |
| q3 | medium | `It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.` | `Jane Austen, Pride and Prejudice (1813)` |
| q4 | medium | `I went to the woods because I wished to live deliberately, to front only the essential facts of life.` | `Henry David Thoreau, Walden (1854)` |
| q5 | long | `It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief, it was the epoch of incredulity.` | `Charles Dickens, A Tale of Two Cities (1859)` |
| q6 | long | `Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it.` | `Lewis Carroll, Alice's Adventures in Wonderland (1865)` |

Every typist that graders create is invented.

## Technical requirements

### Deployment (DP-65)

- Node.js 22 and npm are available. Write the server and the client in TypeScript.
- `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

- The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when that is set.
- `GET /api/health` answers HTTP 200 `{"status":"ok"}` once the schema is applied, in every grading instance, including the mail outage instance.

### Configuration and secrets (DP-67)

Read every variable at start. Never hard-code a credential, and never send one to the browser.

| Variable | Meaning | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection | provided |
| `SMTP_HOST`, `SMTP_PORT` | mail server | provided |
| `MAIL_FROM` | From line | provided |
| `APP_PUBLIC_URL` | absolute base for mailed links | provided |
| `APP_PUBLIC_PORT` | listen port | 4173 |
| `GRADING_KEY` | key for the grading routes | `holloway-grading-key` |
| `TEXT_SEED` | generator base seed | 4242 |
| `TICKET_TTL_SECONDS` | ticket lifetime | 1800 |
| `MAX_LOG_EVENTS` | log entry limit (that many entries allowed) | 12000 |
| `MAX_TEST_MS` | highest allowed `t` (that value allowed) | 125000 |
| `FAST_INTERVAL_MS` | impossible-gap threshold | 10 |
| `MAX_EXTRA_LETTERS` | extra letters per word | 10 |
| `FOCUS_WARNING_MS` | focus warning delay | 1000 |
| `RACE_WORDS` | race length in words | 15 |
| `RACE_COUNTDOWN_SECONDS` | countdown length | 3 |
| `RACE_REJOIN_SECONDS` | rejoin and lobby release window | 30 |
| `RACE_TIME_LIMIT_SECONDS` | race cut-off after Go | 120 |
| `VERIFY_TTL_SECONDS` | verification link lifetime | 86400 |
| `RESET_TTL_SECONDS` | reset link lifetime | 3600 |
| `MAIL_RETRY_SECONDS` | mail retry gap | 30 |

Grading runs three instances:

- **main**: the defaults, with `TEXT_SEED` 4242.
- **mail-down**: sets `SMTP_HOST` to 127.0.0.1 and `SMTP_PORT` to 9.
- **short-timer**: sets `TICKET_TTL_SECONDS` 8, `RACE_COUNTDOWN_SECONDS` 1, `RACE_REJOIN_SECONDS` 4, `RACE_TIME_LIMIT_SECONDS` 20, `VERIFY_TTL_SECONDS` 8 and `TEXT_SEED` 777, and gives the instance its own empty database.

### Server boundary (DP-42, DP-43, DP-66, DP-75, DP-76)

- **Same origin only.** The browser talks only to the app's own origin. A state-changing request whose `Origin` header names another origin answers `403 {"error":"cross_origin"}`.
- **Request size.** Request bodies are limited to 1,000,000 bytes, and exactly 1,000,000 bytes is allowed. The over-limit, wrong-type and malformed-body answers are the ones in the API precedence. The run endpoints keep the exact bytes received, for the proof key.
- **Session cookie.** The session cookie is HTTP-only and same-site.
- **Unknown paths.** Unknown `/api/` paths answer `404 {"error":"not_found"}`. Unknown pages show the not-found sheet with status 404.
- **Never served.** The server never serves source files, `.env` files, package manifests, lockfiles, source maps of server code or any credential.
- **No outside requests.** The browser makes no request to any other origin. The app serves the fonts (Bodoni Moda and Jost), the icons and the chart drawing code from open-licensed packages.
- **Closed live connections.** A closed live connection, or one aborted mid-stream, releases everything it held at once. After ten closes in a row, within a few seconds no database connection of the app is busy or idle inside a transaction, and the next page loads.
- **Dependencies at boot.** If PostgreSQL is unreachable at boot, the server keeps retrying every 2 seconds and answers health with the starting body until it connects. If mail is unreachable at boot, the server starts normally.

### Browser support and performance (DP-04, DP-23, DP-50, DP-56, DP-64)

- Supported browsers: current Chromium, Firefox and Safari at 375x812, 768x1024 and 1280x800.
- The Test folder is ready to type within 3 seconds of navigation.
- Each key updates the letter states and the caret before the next frame.
- Board changes reach open boards within 3 seconds, and race progress reaches every racer within 1 second.
- A refused oversized log answers within 1 second.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, and nothing else is needed to start the app.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` names every shipped package and both font families with their licence. "Shipped packages" means the production dependency tree as `npm ls --omit=dev --all --json` reports it.
- IF-03: Every shipped package and font uses only the MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1 licence.
- IF-04: PostgreSQL is the only datastore. There is no Redis, SQLite, message queue, cache server or state kept in files.
- IF-05: The server and client source are TypeScript, and the npm lockfile is committed.
- IF-06: The browser loads nothing from another origin. Fonts, icons and chart code are bundled and served by the app.
- IF-07: The `holloway-120` word list and the six quotes ship exactly as published, and the app ships no other typing texts.
- IF-08: The provided service configuration files are left unchanged.

## Engineering standards

- Code is idiomatic, strictly typed TypeScript, with no `any` on domain values and no disabled type checks.
- Names in the code match the domain terms of this brief: ticket, keystroke log, keystroke, extra, missed, verdict, seal, proof key, carbon, personal best, board, room, racer, seat.
- The typing and scoring rules live in exactly one implementation, which the test sheet, the carbon replay, the race page and the server replay all run. Every other domain rule is also decided in exactly one place: the run check order, run state changes, personal bests, board eligibility, seat claims, lobby release and host handover, and room state changes.
- No abstraction has only one implementation, and there are no defensive checks for states the rules make impossible.
- There is no dead, commented-out or unreachable code, and no feature beyond this brief.
- Every API error uses the one published error shape, with codes from this brief.
- Concurrency-sensitive writes (seat claims, ticket submissions, sign-in failure counts) are made safe by database or single-process guarantees that the code makes visible, not by timing.
- Every browser timer and request a test starts is owned by that test and cancelled with it in one visible place, and a stale response is discarded by an explicit check rather than by timing.
