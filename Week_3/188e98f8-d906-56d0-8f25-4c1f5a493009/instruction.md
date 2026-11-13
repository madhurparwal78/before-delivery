# Snugbar Works Roundkeeper

Roundkeeper is a phone-first answer desk for a weekly team quiz league held in one village pub. It has three desks. The volunteer quizmaster opens and closes each round, uploads picture-round sheets, rules on disputed marks and publishes the league table. The volunteer marker scores every team's answers and searches the answer archive. Each team captain submits the team's answers from a phone and raises a dispute when a mark looks wrong. A public table view lets the whole pub follow the season. Only the server decides round status, scores and the league table. Roundkeeper uses three backend services:

- PostgreSQL holds the league, teams, rounds, every answer, marks, disputes, rulings and the published table.
- MinIO object storage holds the picture-round sheets.
- An SMTP mail sink (Mailpit) receives the ruling notes sent to captains.

These are out of scope: personal accounts or passwords (each desk opens with a seeded desk code), payments, writing or storing questions, buzzers, speed scoring, more than one pub or league, and any datastore other than the two named above.

## Problem and users

Every Thursday a volunteer quizmaster runs eight rounds of eight questions for twelve regular teams. Answer sheets get passed between tables to a volunteer marker. The season table lives in a notebook that the quizmaster types up again at home. The same arguments keep breaking out at the bar: smudged sheets, answers slipped in after the round was called, disputed spellings, and captains who swear the answer was written down. The pub quiz apps built for paid hosts run for a single night, score by speed and keep no season table. This league needs the night's ruling to stand and the table to add up week after week.

- **Quizmaster** (weekly): uploads the picture-round sheets before the night, then opens and closes each round, rules on disputes, and publishes each round into the league table the pub trusts.
- **Marker** (weekly): marks every team's answers question by question, quickly and by keyboard or by tapping on a tablet, and searches the answer archive when a spelling is contested.
- **Team captain** (weekly): submits the team's answers for the open round from a phone, renames the team now and then, and disputes a mark that looks wrong.

## Journeys

1. **Before the night.** The quizmaster follows a shared link to the quizmaster desk and lands on the sign-in form. They sign in with the quizmaster desk code using only the keyboard. They land on their own desk with focus on its heading, at the top of the page. Tonight's eight rounds are drafted, and both picture rounds show their sheets as not stored. On the round 3 card the quizmaster tabs from Open round 3 to the sheet file field, presses Enter to open the file chooser, picks an image, tabs to Upload and presses Enter. When storage confirms it, the round 3 card shows the sheet as stored. A second quizmaster device shows the same within a few seconds, and its focus does not move. On round 6 the quizmaster presses Upload without choosing a file; nothing is sent and the desk asks for an image. Round 6 stays not stored. Its Open round 6 button is still shown and enabled, but activating it is refused with the sheet-missing copy, and round 6 stays drafted.
2. **Running a round.** The quizmaster opens round 1 by keyboard, and focus moves to the round's Close button. Within a few seconds the round strip shows round 1 as open on every desk and on the public table. A phone whose clock is hours wrong shows the same. A captain on the smallest phone signs in by tapping the desk code field, typing and tapping Sign in, and lands on the answer desk without the page ever scrolling sideways. The answer form shows the countdown above Question 1. The captain types eight answers, one per row, watching each answer's character counter, and as they scroll down the form the countdown stays pinned to the top of the screen. They submit. The countdown ticks and the screen refreshes underneath without disturbing the captain's typing, caret or focus. When the server's allowance runs out, or the quizmaster closes the round first, the round shows as closed everywhere. The captain's fields turn read-only in place, with their text and focus kept, and the read-only form stays on the phone until the quizmaster opens the next round. A captain whose countdown still shows time is refused and sees the round-closed message.
3. **A team renames itself.** A captain opens the rename dialog, types a new name while the counter shows the characters used, and saves with Enter. The team's tile on the public table, on every captain's desk and on the quizmaster's desk shows the new name within a few seconds, in the same place, without anyone's focus or scroll moving.
4. **Marking.** The marker opens the marking pane for the closed round. Using only the keyboard, or by tapping the large mark targets on a tablet, they move through each team's answer to each question and mark it correct or wrong. A second marker on another tablet can mark rows at the same time, and those marks appear in place. When every answer is marked, the marker finishes marking. The pane closes, focus lands on the marking desk heading, and the round shows as marked.
5. **A contested spelling.** The marker opens the answer archive and pages through it while captains are still sending answers to a later round. Each new page is added below the rows already shown, and focus moves to the first new row. Every row's time sent reads the same on every device, whatever its clock or time zone. The marker then searches for a contested spelling, watching the search counter. The search finds every answer containing that spelling, whatever its case or accents, and shows each one exactly as the team typed it. The results fill in place on the same screen.
6. **A dispute.** A captain sees a wrong mark on a marked round and disputes it from the phone with a short reason. The quizmaster opens the dispute queue, upholds or dismisses the dispute by keyboard and saves, and focus moves on to the next dispute. The captain's phone shows the ruling in place, and the captain's inbox receives a ruling note. Another captain, whose phone clock is hours wrong, has a dispute sheet open when the quizmaster publishes that round; Send dispute tells them disputes for the round are closed, and their Dispute buttons disappear on the next refresh.
7. **Publishing.** With no disputes left open, the quizmaster publishes the round. The team tiles flip one after another to show the round's score, on the public table, on the quizmaster's desk and on every captain's phone. Then they slide into their new league order while each total counts up. When the motion stops, the tiles match the server's table, and only then does the table news announce the result. On a phone set to reduce motion, nothing moves. The tiles change by a short fade and show their final places and totals at once.
8. **Storage is down.** With object storage unreachable, the quizmaster tries to upload a sheet. The round card reports that the sheet is not stored because storage is unreachable, and the round cannot be opened. The line stays on the card until the quizmaster's next attempt on that card gets an answer.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Desk code sign-in** Signing in with a seeded desk code starts a session for that code's role and team, and an unknown code is refused, as specified in API and Seed data.
- **DP-02 — Role permissions** Each endpoint answers only the roles the API section gives it, and a captain acts only for their own team.
- **DP-03 — Signed-out desks** A desk request without a session is refused with 401, and a desk screen that receives a 401 returns to sign-in with the signed-out copy from Feedback states.
- **DP-04 — Sign in to a desk** A quizmaster, marker or captain types a desk code using only the keyboard and lands on their own desk, whose round strip and time left match what the server reports even when the device clock is hours off.
- **DP-05 — Confirmed picture sheets** A picture-round sheet shows as stored only after the storage service holds the object at the published key with matching size and SHA-256, as qualified in Business rules.
- **DP-06 — Sheet type and size** Sheet uploads accept only the declared image types and the byte range in Business rules and refuse all others with the published statuses.
- **DP-07 — Storage outage on sheets** While storage is unreachable, uploading a sheet or opening a picture round whose sheet is stored fails with the outage status, and the round card shows the outage line word for word until the next upload or open attempt on that card answers.
- **DP-08 — Upload a picture sheet** The quizmaster uploads a sheet for a drafted picture round and sees the round card change to stored, with the object present in storage.
- **DP-09 — Round state machine** Rounds move only along the published round machine, and every illegal move is refused with its published conflict code.
- **DP-10 — Picture round open guard** A picture round cannot open until its sheet is stored and storage confirms it again at the moment of opening.
- **DP-11 — Server-timed close** An open round closes on the server when its allowance from ROUND_SECONDS runs out or when the quizmaster closes it, whichever comes first.
- **DP-12 — Round strip status** The masthead round strip shows each round's server status and refreshes within the published polling delay, whatever the device clock says.
- **DP-13 — Run the night's rounds** The quizmaster opens a round, watches the strip show it open on every desk, and closes it, with every step reachable by keyboard.
- **DP-14 — Answers stored as typed** Each submitted answer is stored NFC-normalised exactly as typed, the latest answer per question counts, and earlier answers stay in the archive.
- **DP-15 — Answer length limit** Answers outside the published code-point range are refused field by field with 422.
- **DP-16 — Live character counters** Every limited text field shows a live count of characters used, counted exactly as the server counts them, against its limit before submit, and shows the field's over-limit copy as soon as the limit is passed.
- **DP-17 — Submit rate limit** A team's submits beyond the published rolling allowance are refused with 429 and a Retry-After in whole seconds.
- **DP-18 — Wait shown on the phone** After a 429 the captain's phone shows the too-many-submits copy with the server's wait, word for word.
- **DP-19 — Closed round refusal** A submit that reaches the server after the round's close is refused with the round-closed conflict, and the phone switches to the round-closed copy even if its countdown still shows time.
- **DP-20 — Server-synced countdown** The captain's countdown is drawn from the server's seconds left and re-synced on every poll, never from the device clock alone.
- **DP-21 — Submit replay** A submit repeated with the same idempotency key replays the stored response, and the same key with a different body is refused as a conflict.
- **DP-22 — Submit a round from a phone** A captain fills in and submits the open round's answers on a phone-sized screen and sees the success copy with their answers listed back.
- **DP-23 — Team name rules** A captain renames their own team within the published name length and uniqueness rules, and every table shows the new name.
- **DP-24 — Rename dialog keyboard** The rename dialog keeps Tab and Shift+Tab wrapping in its published order over an inert background, Enter in Team name saves, and Escape, Cancel or a saved name closes it with focus back on Rename team.
- **DP-25 — Rename the team** A captain opens the rename dialog, types a new name while watching the counter, saves it, and sees the new name on their tile.
- **DP-26 — Marks never touch answers** The marker records a mark of 0 or 1 only on current answers of a closed round, and marking never changes the stored answer text.
- **DP-27 — Finish marking guard** A round becomes marked only when every current answer in it carries a mark; otherwise the server refuses and reports how many are left.
- **DP-28 — Keyboard marking pane** The marking pane's published shortcuts work whichever control in the pane has focus and do nothing while Ctrl, Meta or Alt is held, Tab follows its one-stop-per-row order and wraps over an inert background, and Escape closes it with focus back on its opener.
- **DP-29 — Mark a round** The marker opens a closed round, marks every team's answers using only the keyboard, finishes marking and sees the round turn marked in the strip.
- **DP-30 — Stable capped archive paging** The answer archive pages in a stable order with cursors that never skip or repeat an answer while new answers arrive, using the published default and cap on page size.
- **DP-31 — Page the archive live** The quizmaster pages the archive with More answers while captains submit, and sees every answer exactly once.
- **DP-32 — Search matching** Archive search finds answers containing the query as plain text, ignoring case and accents, in archive order and within the published result cap.
- **DP-33 — Search bounds** Search refuses queries outside the published length range, and bodies deeper than the published JSON depth, with 422.
- **DP-34 — Search time budget** Every search, including a pathological query, answers within the published time budget or returns the published timeout error within it.
- **DP-35 — Check a contested spelling** The marker searches the archive for a contested spelling, sees every matching answer as submitted, hears the result count in Desk messages, and moves through Search results and back to the search field with the published ArrowDown, ArrowUp, Home, End and Escape keys.
- **DP-36 — Raise a dispute** A captain raises one dispute on a zero-marked current answer of their own team, with a reason in the published length range.
- **DP-37 — Dispute window** Disputes are accepted only while the answer's round is marked, and are refused before marking and after publishing with the published conflict.
- **DP-38 — Dispute a mark** A captain sees their marks for a marked round, disputes one from the phone, and sees the dispute-sent copy with the dispute listed as raised.
- **DP-39 — Rulings** The quizmaster upholds or dismisses a raised dispute once, an upheld ruling scores that answer 1, and when rulings on one dispute arrive at the same time exactly one wins.
- **DP-40 — Ruling note email** Each ruling sends exactly one note to the raising captain, naming the round, the question number, the answer as submitted and the ruling.
- **DP-41 — Confirmed note delivery** A ruling's note shows as sent only after the mail server accepts it, and while the mail server is unreachable the ruling stands with its note queued, as qualified in Services.
- **DP-42 — Keyboard ruling dialog** The ruling dialog's published shortcuts work whichever control in it has focus, Save ruling and Cancel included, Tab follows its published order and wraps over an inert background, and Escape or Cancel closes it with focus back on its opener.
- **DP-43 — Dispute ruled copy** The raising captain sees the dispute-ruled copy word for word on the answer desk and on the table view, within the published polling delay.
- **DP-44 — Rule on a dispute** The quizmaster opens the dispute queue, rules by keyboard and sees the ruling-saved copy, and the captain's inbox receives the note.
- **DP-45 — Publish guard** A round publishes only when it is marked with no raised disputes left, and when several publishes arrive at the same time exactly one succeeds.
- **DP-46 — League table derivation** The server computes each team's league total as the sum of its published round scores and orders teams by the published tie rule.
- **DP-47 — Tally cascade** On a new publish every tile turns in the previous table order, slides to its new place and counts up its total at the published timings, settling to match the table API with focus and scroll kept, as described in Motion and effects.
- **DP-48 — Tally cascade with reduced motion** With reduced motion the tiles crossfade and take their places with final totals on the first frame, and the publish result is announced in Table news on that frame.
- **DP-49 — Publish a round to the pub** The quizmaster publishes a marked round, and the public table and each captain's desk show the new order and totals, with Table news announcing the publish only after the tiles settle.
- **DP-50 — Published API surface** Only the routes in the API section answer: unknown routes get 404, wrong methods get 405 with Allow, and wrong content types get 415, as stated in Server boundary.
- **DP-51 — Error order and shape** Every error uses the one published error body and follows the single error precedence order in API.
- **DP-52 — Health and run manifest** The app installs, builds and serves from the run manifest on the published port and answers the health check.
- **DP-53 — Schema and seed on serve** Serving applies the schema and seed data idempotently, so a fresh empty database starts with exactly the Seed data records.
- **DP-54 — Responsive layout** Each screen shows its published arrangement at 375x812, 768x1024 and 1280x800 with no horizontal overflow.
- **DP-55 — Pane and press motion** Panes, sheets, presses, hovers and chip recolours start from their published positions and run for their published durations on the one published easing curve, and nothing loops.
- **DP-56 — Not-found page** An unknown page path answers 404 with the published not-found heading.
- **DP-57 — Contrast and tap targets** Text and controls meet WCAG 2.2 AA contrast, every control is at least 44 by 44 pixels, and every focused element shows the published focus outline, at every viewport.
- **DP-58 — Beer-mat look** Screens read as cream beer-mat tiles with rounded corners and an ink rule, with serif display type, hyperlegible body type and tabular score numerals, and an ale-red accent kept for the open round and the leader.
- **DP-59 — Credentials from environment** Every service credential and URL is read from the environment at start and is never hard-coded or sent to the browser.
- **DP-60 — Browser renders server state** The browser renders round status, seconds left, scores and totals from server responses and never computes them itself.
- **DP-61 — Sign-in landing** A signed-out desk visit goes to exactly /sign-in, sign-in ignores every query parameter, and each role lands only on its own desk path with focus on that desk's level-1 heading.
- **DP-62 — Sign-in card and signed-out copy** The sign-in card has the published width either side of 600 px, and the signed-out copy shows on sign-in and expires without touching the typed code, its caret or focus.
- **DP-63 — Sheet content and dimensions** A sheet whose bytes do not match its declared type is refused with 415 and one outside the published pixel dimensions with 422, and a refused upload writes no object.
- **DP-64 — Round cards live and timer-safe** Round cards on the quizmaster desk update in place within one polling delay, keeping focus, scroll and a chosen sheet file, and focus stays on the Upload button after a stored sheet.
- **DP-65 — Round strip wrap and card focus** The round strip wraps at the published width, and after Open, Close or Publish succeeds focus moves to the published target on the same round card.
- **DP-66 — Answer form survives its timers** Countdown ticks and polls never change an answer field's value, selection or focus or replace the form, and on a phone the form meets the published touch and reduced-motion rules.
- **DP-67 — Rename sheet and live name** The rename dialog is a full-screen sheet at 767 px and below and a right-anchored pane from 768 px, and a poll that renames the team updates the tile behind it without touching the dialog's text, counter, caret or focus.
- **DP-68 — Marking pane live** The marking pane shows marks saved on another marker device in place within one polling delay without moving the current row, focus or scroll, and neither message expiry nor a refused Finish marking closes it or moves focus.
- **DP-69 — Archive append in place** More answers appends rows without moving or replacing the rows shown and focuses the first appended row, later polls and message expiry never move that focus, the scroll or the rows, below 600 px rows are stacked cards, from 600 to 1023 px the table has the published five columns with each row's time sent inside its Answer cell, and from 1024 px it has all six columns.
- **DP-70 — Search bar survives timers** Enter in the search field runs the search with focus kept there, results fill in place with no navigation and no archive reload, polls and message expiry never clear the query, filter, results or caret, and the search bar has the published layout either side of 600 px.
- **DP-71 — Dispute sheet focus and stillness** The dispute sheet follows its published Tab order and keeps its typed reason, caret, counter and focus through polls and message expiry, its reduced-motion version moves no layer, a sent dispute moves focus to the published target, and a ruling changes the row in place with focus and scroll kept.
- **DP-72 — Ruling focus and live queue** After a saved ruling focus goes to the published target in the queue, and another quizmaster device drops the ruled dispute in place and shows the already-ruled copy if its dialog was open on it.
- **DP-73 — Publish still on every layer** With reduced motion, a publish on /, /captain and /quizmaster turns, moves or resizes no tile, tile face, grid or chip, runs nothing longer than 120 milliseconds, and shows final totals on the first frame.
- **DP-74 — Breakpoints exact** Every published layout switches exactly at 600, 768 and 1024 px, with the published layout at and either side of each and no horizontal overflow.
- **DP-75 — Reduced motion on panes and controls** With reduced motion, every dialog, pane and sheet, its backdrop and inner panel, and every pressed control changes only by fades and colour within 120 milliseconds.
- **DP-76 — Desk messages lifetime** Every result copy in Desk messages stays exactly 6 seconds and then clears, and a newer message replaces it and restarts the 6 seconds.
- **DP-77 — Published tokens** Colours, type sizes, corner radius, ink rule, tabular numerals and the accent's two uses match the published token table on every screen.
- **DP-78 — Reopen during exit** Reopening a dialog, pane or sheet during its exit leaves it fully open with focus on its first stop, a stale close never hides it, and a finished exit removes it from the accessibility tree.
- **DP-79 — Server-timed close seen live** When the server closes a round with no user action, every open screen shows it closed within one polling delay, the captain's answer fields turn read-only in place keeping their text, elements and focus with the round-closed copy shown, and focus on Close round moves to its round card, whatever the device clock says.
- **DP-80 — Touch sign-in on small phones** On a 320x568 or 375x812 touch phone a captain signs in by tapping and typing and lands on /captain, Desk code and Sign in are each at least 44 by 44 pixels, neither /sign-in nor the desk scrolls sideways, and every round chip can be brought fully into view by scrolling the strip while the page stays put.
- **DP-81 — Keyboard-complete sheet upload** On a drafted picture round card Tab goes from Open round to the file field to Upload, the focused file field is visible, outlined and at least 44 by 44 pixels, Enter or Space on it opens the file chooser with focus returning to it, and Upload with no file chosen sends nothing and shows the no-file copy with focus kept on Upload.
- **DP-82 — Answer form layout** The countdown sits above Question 1, below 768 px each field has its own full-width row with its label above and the countdown stays pinned to the top of the viewport while the form scrolls, and from 768 px the fields form two columns in row order.
- **DP-83 — Rename seen live on every table** Within one polling delay of a saved rename, the team's tile on /, /captain and /quizmaster shows the new name as the same element in its place with focus and scroll kept, even though the table version does not change.
- **DP-84 — Touch marking with reduced motion** On a 768x1024 touch tablet a tap anywhere in the 44 by 44 pixel square centred on a marking radio chooses and saves that mark and makes its row current, a row's two radios have centres at least 44 pixels apart, and with reduced motion the pane, its inner panel, its backdrop and their ancestors keep their position and size on every frame of open and close.
- **DP-85 — Archive times from the server** Each archive row's time sent is the HH:MM:SS of the answer's submitted_at in UTC, the same on every device whatever its clock or time zone, and from 1024 px the archive columns are Round, Question, Team, Answer, Time sent and Mark in that order.
- **DP-86 — Search counter counts code points** The search counter counts code points after normalising and trimming exactly as the server does, matching the worked examples in Business rules, and a query one past the limit shows the over-limit copy and is refused by the server.
- **DP-87 — Dispute window from the server** Dispute buttons show exactly while the server last reported their round marked whatever the device clock says, a poll reporting the round published removes them in place with focus moving to Your marks, and a dispute sheet left open on a stale screen stays open and shows the window-closed copy on Send dispute.

## Frontend

### Screens and layout (DP-04, DP-12, DP-22, DP-29, DP-31, DP-49, DP-54, DP-56, DP-62, DP-65, DP-67, DP-69, DP-70, DP-74, DP-80, DP-82, DP-85)

**Page paths.** The app has these page paths:

- `/`: the public table view.
- `/sign-in`.
- `/captain`, `/marker` and `/quizmaster`: one desk per role.
- `/archive`: open to the marker and the quizmaster.

Any other page path shows the not-found screen. Server boundary states the sign-in landing and the redirects for signed-out visits.

**Top of every screen.**

- **Masthead:** a heavy ruled bar holding the product name, the league name and tonight's night number.
- **Round strip:** directly under the masthead, one chip per round in round order. Each chip shows the round number and the round's server status. When the chips are wider than the viewport, the strip scrolls sideways inside itself, keeping its rows as the breakpoint table gives them; the page itself never scrolls sideways.

**The screens.**

- **Public table view (`/`).**
  - The round strip, then the league table as a grid of team tiles in table order.
  - Each tile shows the position, the team name and the league total. Once a round tonight has been published, it also shows that team's score for the latest published round.
- **Sign-in (`/sign-in`).** One beer-mat card holding the desk code field and the Sign in button.
- **Answer desk (`/captain`).** One centred column, top to bottom:
  - The team name and the Rename team control.
  - While a round is open, the answer form. Top to bottom it holds the countdown, then eight answer fields, each with its visible label `Question <q>` above it and its counter below it, then the picture sheet image when the round is a picture round, then the Submit answers button. The answers the server accepted are listed under the form.
  - After the form's round closes, the same form stays on screen with read-only fields, its typed text and its accepted answers. It stays through every later poll while that round is closed, marked or published, and the countdown reads `0:00 left`. The captain sees no waiting card in this time.
  - On the first poll that reports a different round open, the closed round's form is removed. The new round's form replaces it in the same place, with eight empty fields and a countdown from the server's seconds left.
  - Only while no round has opened yet tonight, a waiting card takes the form's place.
  - Your marks. For each marked or published round, it lists the team's current answers with their marks and dispute status. Each zero-marked current answer with no dispute has a Dispute control exactly while the server last reported its round marked; the device clock never decides this.
  - The league table grid.
- **Marking desk (`/marker`).** A list of tonight's rounds, a Mark control on each closed round, and a link to the answer archive. The marking pane opens over it.
- **Quizmaster's desk (`/quizmaster`).**
  - One beer-mat round card per round, in round order. Each card shows the title, the status and, for picture rounds, the sheet status. A card holds only the controls for its status, in this order:
    - While drafted: `Open round <n>`. On a picture round this button is present and enabled whether or not the sheet is stored. If the sheet is not stored, the server refuses the open and the card shows the sheet-missing copy from Feedback states.
    - While drafted, on a picture round only, after the Open button: the sheet file field, then its Upload button.
    - While open: `Close round <n>`.
    - While marked: `Publish round <n>`.
    - While closed or published: no controls.
  - The Disputes region, listing raised disputes oldest first.
  - The league table grid.
  - The ruling dialog, which opens the same way as the marking pane.
- **Answer archive (`/archive`).**
  - A search bar holding the search field with its counter, a round filter and the Search button.
  - Search results: one table that stays on the screen once the first search has run. Each later search replaces its rows in place.
  - The archive table, with a More answers button at its foot. From 1024 px its column headers are, in this order, `Round`, `Question`, `Team`, `Answer`, `Time sent` and `Mark`. From 600 to 1023 px it has five column headers, in this order, `Round`, `Question`, `Team`, `Answer` and `Mark`, and each row shows its time sent inside its Answer cell, on its own line below the answer text. In the stacked card layout each card labels its six fields with the same six words, each label followed by its value. Search results use the same columns as the archive table at each width.
- **Not-found screen.** The masthead, then one card with the not-found heading and a link back to the table view.

**Published breakpoints.** The published breakpoints are 600, 768 and 1024 CSS pixels of viewport width. Each layout below is exact at each breakpoint, one pixel below it and one pixel above it. No other width changes any of these layouts.

| Viewport width | Below 600 | 600 to 767 | 768 to 1023 | 1024 and wider |
|---|---|---|---|---|
| Round strip | two rows of four chips | one row | one row | one row |
| Team tile grid | 2 columns | 3 columns | 3 columns | 4 columns |
| Sign-in card | viewport width minus 16 px on each side | 420 px wide, centred | 420 px wide, centred | 420 px wide, centred |
| Answer form fields | one field per row at the form's full content width, label above; countdown pinned to the top while the form scrolls | same as below 600 | two columns in row order (Questions 1 and 2, then 3 and 4, 5 and 6, 7 and 8); countdown stays in its place above Question 1 | same as 768 to 1023 |
| Dialogs and panes (Rename team, Raise a dispute, Mark round `<n>`, Rule on dispute) | full-screen sheet covering the viewport | full-screen sheet covering the viewport | anchored to the right edge at full viewport height, as wide as the larger of 480 px and half the viewport width | same as 768 to 1023 |
| Quizmaster round cards | one column, Disputes below the cards | two-column card grid, Disputes below | two-column card grid, Disputes below | cards in the left two-thirds, Disputes in the right third, tile grid below both |
| Archive rows | stacked card rows, one card per answer holding its six fields | a table of five columns, time sent on its own line inside the Answer cell | the same five-column table | a table of six columns |
| Archive search bar | search field on its own full-width row, Round and Search on the next row | field, Round and Search on one row | one row | one row |

"Centred" means the left and right gaps are equal to within 1 px. Pane widths are exact to within 1 px. For example, a pane is 511.5 px wide at a viewport width of 1023.

**Pinned countdown.** Below 768 px, once the answer form's top has scrolled above the top of the viewport, `timer "Time left"` stays pinned with its top at the viewport's top edge, to within 1 px, and fully visible, for as long as any answer field is in view. From 768 px the countdown scrolls with the page.

At the three main viewports:

- At 375x812: two-row strip, 2 tile columns, one answer field per row and full-screen sheets.
- At 768x1024: one-row strip, 3 tile columns, two answer columns and right-anchored panes 480 px wide.
- At 1280x800: one-row strip, 4 tile columns, two answer columns and right-anchored panes 640 px wide.

A dimmed backdrop covers the screen behind every pane or sheet. No screen scrolls sideways at any width from 320 px up.

### Public screens and controls (DP-01, DP-12, DP-16, DP-20, DP-24, DP-28, DP-31, DP-35, DP-38, DP-42, DP-47, DP-61, DP-65, DP-69, DP-71, DP-72, DP-81, DP-85, DP-87)

Only the controls and regions below are public; everything else is free. `<n>` is a round number from 1 to 8, `<q>` is a question number from 1 to 8, and `<team name>` is a team's current name.

| Where | Role and accessible name | Visible copy |
|---|---|---|
| Every screen | `banner` holding `list "Rounds tonight"` with eight `listitem` chips | `Round <n> · <Status>`, where `<Status>` is `Drafted`, `Open`, `Closed`, `Marked` or `Published` |
| Every screen with tiles | `heading "League table"`, `list "League table"`, each `listitem` holding a focusable `article "<team name>"` | the position as `<position>`, the name, `<total> pts`, and `Round <n>: <score>` once tonight has a published round |
| Every screen with tiles | `status "Table news"` (polite) | copy from Feedback states |
| Every screen when signed in, and `/sign-in` | `status "Desk messages"` (polite) | copy from Feedback states |
| Every desk | `button "Sign out"` | `Sign out` |
| `/sign-in` | `form "Sign in"`, `textbox "Desk code"`, `button "Sign in"` | `Desk code`, `Sign in` |
| `/captain` | level-1 `heading "Answer desk"`, `button "Rename team"` | `Answer desk`, `Rename team` |
| `/captain` | `form "Round <n> answers"`, `timer "Time left"`, eight `textbox "Question <q>"`, `img "Picture sheet for round <n>"` on picture rounds, `button "Submit answers"`, `list "Accepted answers"` | each field's visible label `Question <q>`; each field's counter reads `<used>/<limit>` |
| `/captain` | `region "Your marks"`, with each round group `group "Round <n>"` holding `button "Dispute question <q>"` | each answer shows its `ruled` value, `1` or `0` (so an upheld answer reads `1`), and its dispute status, `Raised`, `Upheld` or `Dismissed` |
| `/captain` | `dialog "Rename team"` with `textbox "Team name"`, `button "Save name"`, `button "Cancel"` | counter `<used>/40` |
| `/captain` | `dialog "Raise a dispute"` with `textbox "Reason"`, `button "Send dispute"`, `button "Cancel"` | counter `<used>/280` |
| `/marker` | level-1 `heading "Marking"`, `button "Mark round <n>"`, `link "Answer archive"` | |
| `/marker` | `dialog "Mark round <n>"` holding one `radiogroup "<team name>, question <q>"` per current answer, each with `radio "Correct"` and `radio "Wrong"`, plus `button "Finish marking"` and `button "Close"` | the answer text exactly as stored |
| `/quizmaster` | level-1 `heading "Quizmaster's desk"`, one `article "Round <n>"` per round card, `button "Open round <n>"`, `button "Close round <n>"`, `button "Publish round <n>"` | sheet status `Sheet stored` or `Sheet not stored` |
| `/quizmaster` | a file field labelled `Picture sheet for round <n>`, `button "Upload sheet for round <n>"` | |
| `/quizmaster` | `region "Disputes"`, `heading "Disputes"`, `button "Rule on <team name>, round <n>, question <q>"` | |
| `/quizmaster` | `dialog "Rule on dispute"` with `radiogroup "Ruling"` holding `radio "Uphold"` and `radio "Dismiss"`, plus `button "Save ruling"` and `button "Cancel"` | the answer as submitted and the captain's reason |
| `/archive` | level-1 `heading "Answer archive"`, `searchbox "Search answers"`, `combobox "Round"` (options `All rounds`, `Round 1` to `Round 8`), `button "Search"`, `table "Search results"`, `table "Answer archive"` in which each answer is one `row` (in the stacked card layout too), `button "More answers"` | `columnheader`s `Round`, `Question`, `Team`, `Answer`, `Time sent`, `Mark`; search counter `<used>/80` |
| Not-found screen | level-1 `heading` | copy from Feedback states |

Round card articles, desk level-1 headings, `heading "Disputes"`, `region "Your marks"` and archive rows can take focus when the app moves focus to them, but they are not stops in the Tab order. Tile articles are Tab stops, in table order. The sheet file field is a Tab stop between `Open round <n>` and `Upload sheet for round <n>` on its card. On `/sign-in` the Tab order is Desk code, then Sign in. Desk messages is never a Tab stop.

### Interactions (DP-13, DP-16, DP-20, DP-22, DP-24, DP-25, DP-28, DP-29, DP-31, DP-35, DP-38, DP-42, DP-44, DP-64, DP-66, DP-68, DP-69, DP-70, DP-78, DP-80, DP-81, DP-84, DP-86, DP-87)

Focus targets, dialog Tab orders and the rules for dialogs are stated once, under Focus and keyboard in Feedback states. The bullets below refer to them.

- **Sign in.**
  - Enter in the Desk code field, or activating Sign in, submits the form.
  - On a touch phone, tapping Desk code focuses it and tapping Sign in submits.
  - On success the browser goes to the role's desk.
  - On failure the typed code stays in the field.
  - Sign out ends the session and opens `/sign-in`.
- **Counters.**
  - Every limited field (answers, team name, search, dispute reason) shows `<used>/<limit>` below it, updated on every keystroke and paste.
  - `<used>` counts characters by the counting rule in Business rules, exactly as the server does, including every worked example there.
  - Above the limit, the counter and the field switch to the error look, and the field's over-limit copy from Feedback states appears under the field. That copy is announced once each time the field crosses the limit.
  - Submit stays enabled. If the server refuses the value, the refusal shows the same copy.
- **Answer form.**
  - Each answer field is a single line. Enter in an answer field moves focus to the next field, and Enter in the last field submits.
  - Submit answers sends every non-empty field in one submit.
  - Every submit carries a fresh idempotency key. The one exception is a retry of a request that got no response, which reuses its key.
  - After a successful submit the fields keep their text, and the server's accepted answers fill `list "Accepted answers"`.
  - The countdown shows `<m>:<ss> left`. It counts down once a second from the server's seconds left and resets from the server on every poll, so it is always within 1 second of the server's `seconds_left`.
  - When the server reports the round closed, every answer field becomes read-only on the spot and keeps its text. The fields stay the same elements, and a field that had focus keeps it. Submit answers stays focusable but no longer sends anything. This happens whatever the countdown shows.
- **Waiting card.** Only while no round has opened yet tonight, the captain sees the waiting copy from Feedback states. The form appears on the first poll that reports an open round. Once a round has opened, the waiting card never returns that night; Screens and layout states which form shows after a close.
- **Rename team.**
  - Activating Rename team opens the rename dialog, prefilled with the current name.
  - Enter in Team name, or activating Save name, saves. Cancel or Escape closes the dialog without saving.
- **Disputes from the phone.**
  - Activating `Dispute question <q>` opens the Raise a dispute dialog. Send dispute submits.
  - On success the dialog closes, the answer row shows `Raised`, and the row no longer has a Dispute button.
  - A Raise a dispute dialog that is open when a poll reports its round published stays open, with its typed reason. Send dispute then gets the window-closed refusal from Feedback states and the dialog stays open.
- **Marking pane.**
  - Activating `Mark round <n>` opens the pane. The pane lists every current answer of the round in the order `GET /api/rounds/{n}/answers` returns them (see API), whatever the current table order or team names.
  - The current row starts as the first unmarked row, or the first row when every row is marked.
  - These shortcuts work whichever control in the pane has focus (a radio, Finish marking or Close), in lower or upper case:
    - `C` marks the current row correct.
    - `X` marks it wrong.
    - `J` moves to the next row.
    - `K` moves to the previous row.
  - With Ctrl, Meta or Alt held, these keys do nothing and send no request.
  - After `C` or `X` the mark is saved, and the current row moves to the next unmarked row.
  - Arrow keys inside a row's radiogroup choose a mark, which saves at once, and make that row the current row.
  - A tap or click on a radio, anywhere within the 44 by 44 pixel square centred on it, chooses that mark, which saves at once and makes that row current. The Correct and Wrong radios of one row have centres at least 44 px apart, so their squares never overlap.
  - The current row is outlined and scrolled into view inside the pane.
  - Finish marking asks the server to mark the round.
  - While the pane is open, it re-reads the round's answers on every poll.
- **Round cards.**
  - Open, Close and Publish act at once, with no confirmation step.
  - Uploading a sheet takes two steps: choose a file in the labelled file field, then activate the Upload button.
  - The file field is a Tab stop. When focused it is visible on screen, at least 44 by 44 px, and shows the focus outline. Enter or Space on it opens the file chooser. When the chooser closes, whether a file was chosen or not, focus is back on the file field.
  - A chosen file stays chosen until Upload is activated or the card's status changes.
  - Activating Upload with no file chosen sends no request and shows the no-file copy from Feedback states.
- **Dispute queue.**
  - Activating a `Rule on ...` button opens the ruling dialog.
  - In the dialog, `U` selects Uphold and `D` selects Dismiss whichever control in the dialog has focus (the radiogroup, Save ruling or Cancel), in lower or upper case. With Ctrl, Meta or Alt held they do nothing.
  - Enter on Save ruling saves.
- **Archive.**
  - The archive loads its first page when it opens.
  - More answers fetches the next page and appends its rows below the rows already shown. The rows already shown stay where they are and are never redrawn or replaced.
  - The archive table changes only when the screen opens and on More answers. Polls never reload it from the start.
- **Search.**
  - Search, or Enter in the search field, runs a search and fills Search results in place. The address does not change, the page does not reload or scroll, and the archive table keeps its rows.
  - Searching with an empty field is refused with the empty-search copy. Search results by keyboard: ArrowDown in the search field moves focus to the first row of Search results and leaves the field's text and caret unchanged; it does nothing while Search results has no rows. On a focused result row, ArrowDown and ArrowUp move focus one row down or up and leave it where it is at the last or the first row, Home moves it to the first row and End to the last row, and Escape returns focus to the search field with its text and caret exactly as they were before the ArrowDown. Result rows are not Tab stops.
- **Dialog exit and reopen.** Activating a dialog's opener while that dialog is still running its exit stops the exit and leaves the dialog fully open, with focus on its first stop. A close that was started earlier never hides a dialog that has been reopened. When an exit finishes, the dialog is gone from the page and from the accessibility tree.
- **Polling.** Every screen re-reads round status and the table at the polling delay in Business rules. Desks also re-read their own lists at that delay:
  - the captain's answers, marks and disputes
  - the open marking pane's answers
  - the quizmaster's round cards and dispute queue
- **Touch.** Every action works by tap. Long-press and swipe do nothing special, except that a swipe on the round strip scrolls the strip sideways when its chips are wider than the viewport. Hover only changes the hover look.

### Visual design (DP-57, DP-58, DP-77)

**Character.** Every screen is laid out like a quiz sheet on a beer mat. The page is a warm cream, with near-black ink for text and rules. Team tiles and round cards are cream mats with softly rounded corners and a firm, thin ink border. A bottle green marks ordinary actions: buttons, links and focus outlines. A pale malt tan covers quiet surfaces, dividers and the drafted chip. One ale red is the only accent. It fills the open-round chip and the leader's tile, and appears nowhere else. Errors are never shown in the accent.

**Published tokens.** These values are exact on every screen.

| Token | Exact value and where it goes |
|---|---|
| Ground | sRGB 243, 237, 226. The page background, and the fill of tiles and cards other than the leader's tile |
| Ink | sRGB 31, 26, 23. Body text, headings, rules and the border of every tile and card |
| Accent (ale red) | sRGB 181, 70, 43. Only the fill of the open-round chip and the fill of the position-1 tile, each with white text. No other element uses it as fill, text or border colour |
| Secondary (bottle green) | sRGB 47, 93, 80. Button fills (with white text), links and the focus outline |
| Muted (malt tan) | sRGB 201, 185, 154. The drafted chip (ink text), dividers, quiet surfaces and the error band |
| Other chips | Closed: ground fill with ink text. Marked: bottle green fill with white text. Published: ink fill with ground-colour text |
| Error band | ink text on the muted tan, with a 2 px solid ink edge down its left side |
| Body type | Atkinson Hyperlegible, 18 CSS pixels, for body text and controls |
| Display type | Fraunces, for headings, the masthead and tile totals |
| Heading sizes | each level is 1.333 times the level below, starting from the body size. Level 3 is 1.333 times the body, level 2 is 1.333 times level 3, and level 1 is 1.333 times level 2. Each is exact to within half a pixel |
| Tiles and cards | tiles, round cards, the sign-in card and the not-found card have corners rounded to a 12-pixel radius and a 2-pixel solid ink border at rest |
| Numerals | figures of equal width (tabular figures) on every position, total, round score, counter and countdown, so numbers line up and do not jitter while they count |
| Focus outline | at least 2 pixels, solid bottle green, on every focused control and on every element the app moves focus to |

- **Density.** Comfortable: generous padding inside each mat, and at least a finger's width of space between tiles.
- **Composition.** The masthead is a heavy ruled band, like the header of a printed quiz sheet. The round strip of chips sits directly under it, and the tile grid fills the page below. Panes come in from the right edge on wide screens and rise as sheets on narrow ones.
- **Floor.**
  - Every control is at least 44 by 44 CSS pixels at every viewport, from 320 px wide up. On the phone, each answer field and Submit answers is at least 44 px tall, and Desk code and Sign in are each at least 44 by 44 px.
  - All text and control boundaries meet WCAG 2.2 AA contrast against their background. That includes white text on the ale red and on the bottle green.

### Motion and effects (DP-47, DP-48, DP-55, DP-66, DP-71, DP-73, DP-75, DP-78, DP-84)

Every animation and transition in Roundkeeper uses one easing curve: the cubic Bézier curve whose two control points are (0.2, 0.8) and (0.2, 1). It starts fast and settles long and soft. Each motion says one thing at a time and never loops.

| Motion | What it means | Where it starts | Duration |
|---|---|---|---|
| Pane enter and exit, 768 px and wider | a pane is opening or closing | one full pane width to the right, just outside the right edge; it slides in to rest, and on exit slides back out the same way | 600 milliseconds |
| Sheet enter and exit, 767 px and narrower | a sheet is opening or closing | one full sheet height down, just below the bottom edge; it rises to rest, and on exit sinks back down | 600 milliseconds |
| Press | a button or chip was pressed | the control moves down 1 pixel and its fill darkens | 80 milliseconds |
| Hover | the pointer is over a tile | the tile's ink border thickens from 2 to 3 pixels | 100 milliseconds |
| Chip recolour | a round chip changed status | the chip's colours change to those of its new status | 240 milliseconds |
| Accepted answers | the server accepted a submit | the list fades in | 240 milliseconds |
| Tile flip | a tile reveals its new content in the Tally cascade | the tile turns half a turn about its upright centre line, from 0 to 180 degrees | 360 milliseconds |
| Tile slide and total count | a tile moves to its new table place | the tile slides from its old grid place | 420 milliseconds |

The backdrop behind a pane or sheet fades in and out over the pane's 600 milliseconds.

**Signature: Tally cascade.** The cascade runs on every screen with tiles. It starts when a poll or a publish response shows a table version newer than the one on screen, together with a newly published round. It never runs on first load, and never for a change that leaves the version unchanged, such as a rename.

1. Each tile makes a half turn. The tiles turn one after another, in the order they held before the publish. The tile that was first starts at once, and each later tile starts 70 milliseconds after the one before it. Each turn takes the flip duration.
2. The face revealed by the turn shows the tile's new content: position, name, `Round <n>: <score>` for the round just published, and the total.
3. When the last tile's turn ends, every tile slides from its old grid place to its new one over the slide duration. Over the same time, each total counts up from the old total to the new one.
4. With twelve tiles, the whole cascade settles within 1.6 seconds of the first turn. When it settles, the tile order and the totals equal the latest table from the server.
5. Keyboard focus stays on the same team's tile it was on before the cascade, and the page does not scroll.
6. The cascade runs in place on `/`, `/captain` and `/quizmaster`, with no reload. It is driven by time, not by scrolling. If a newer table arrives mid-cascade, the tiles jump to the end of the running cascade and the new cascade starts from there.
7. Table news keeps its previous text while the cascade runs. It changes to the publish result from Feedback states only once the cascade has settled.

**Reduced motion.** When the device asks for reduced motion, no element on any screen is turned, shifted or resized at any moment, whether at rest or animating. No animation or transition moves, turns or resizes anything, and none lasts longer than 120 milliseconds. These rules cover every layer:

- each tile's `listitem`, its `article` and both of its faces (with reduced motion, a tile shows one face and changes its content in place)
- the `list "League table"` grid
- each dialog, pane and sheet, its backdrop, its inner panel and every element that contains them; each keeps its position and size on every frame of opening and closing
- the round chips and every button

What each part does instead:

- **Tiles.** Tiles crossfade to their new content over 120 milliseconds and take their new places at once. Each total shows its final value on the first frame drawn after the table arrives. Focus stays on the same team's tile. Table news announces the publish result on that same first frame.
- **Panes and sheets.** Every pane and sheet, the Raise a dispute sheet on the phone and the marking pane on the tablet included, appears and disappears with a 120-millisecond crossfade, without sliding or rising.
- **Controls.** A press keeps its colour change and does not move. Chip recolours and hover borders finish within 120 milliseconds.
- **Accepted answers.** The list fades in over 120 milliseconds.

Page scrolling, the round strip scrolling sideways, and the pinned countdown staying put while the page scrolls are not motion and are not affected by these rules.

No animated element loops or idles. The open-round chip is a steady fill and never pulses.

### Feedback states (DP-03, DP-07, DP-16, DP-18, DP-19, DP-35, DP-43, DP-48, DP-56, DP-62, DP-64, DP-66, DP-67, DP-68, DP-70, DP-71, DP-72, DP-76, DP-79, DP-81, DP-83, DP-87)

**Messages.** Every async action shows its pending copy in `status "Desk messages"` while it waits, then its result copy in the same place.

- Every result copy in Desk messages stays exactly 6 seconds, then the region empties. That covers success, refusal and outage copy, the signed-out copy, the round-closed copy, the no-file copy and the dispute-ruled copy.
- A newer message replaces the one showing and starts its own 6 seconds.
- Pending copy stays until its result arrives.
- Field errors also appear beneath their field, and stay there until the field's value changes.
- Table news keeps its latest announcement until the next one.
- **Card outage line.** The sheet outage copy also shows as a line on its round card, under `Sheet not stored`. This line is not bound by the 6-second lifetime. It stays until the next upload or open attempt on that card gets an answer.

Copy below is exact to the character: straight apostrophes, straight double quotes, the case and the full stops. Copy is shown on its own, with no added prefix such as "Error:". The dash in the outage copy is an em dash with one space on each side.

**Placeholders.**

- `<n>` and `<q>`: round and question numbers.
- `<team name>`: the team's current name.
- `<total>`: the league total as a plain integer.
- `<count>`: a plain integer.
- `<seconds>`: the Retry-After value received, not counted down.
- `<ruling>`: `upheld` or `dismissed`.
- `<query>`: the search text as typed.
- `<m>:<ss>`: whole minutes and two-digit seconds.

| Action | Pending | Success | Field error or refusal |
|---|---|---|---|
| Sign in | `Checking code` | (lands on the desk) | 401: `That code does not open a desk.` |
| Any desk request answered 401 | | | returns to `/sign-in`, showing `Your desk session has ended. Sign in again.` |
| Submit answers | `Sending answers` | `Answers in for round <n>.` | over limit: `Answers can be up to 120 characters.`; round closed: `Round <n> is closed. Answers are no longer taken.`; 429: `Too many submits. Please wait <seconds> s and try again.` |
| Answer desk before any round opens | | | waiting card: `No round is open. The quizmaster will call the next one.` |
| Countdown (`timer "Time left"`) | | | `<m>:<ss> left` |
| Rename team | `Saving name` | `Team name saved.` | empty: `A team needs a name.`; over limit: `Team names can be up to 40 characters.`; taken: `Another team already has that name.` |
| Upload sheet | `Storing sheet` | `Sheet stored for round <n>.` | no file chosen (no request sent): `Choose a sheet image to upload.`; wrong type or content: `Sheets must be PNG or JPEG images.`; too large: `Sheets can be up to 5,000,000 bytes.`; dimensions: `Sheets must be 200 to 4,000 pixels on each side.`; outage: `Sheet not stored — storage is unreachable. This round cannot open yet.` |
| Open round | `Opening round <n>` | `Round <n> is open.` | sheet missing: `Upload and store the picture sheet before opening round <n>.`; another open: `Close the open round before opening another.`; outage: the sheet outage copy above |
| Close round | `Closing round <n>` | `Round <n> closed by the quizmaster.` | |
| Mark an answer | | `<team name>, question <q>: correct.` or `<team name>, question <q>: wrong.` | |
| Finish marking | `Finishing round <n>` | `Round <n> is marked.` | unmarked left: `Answers left to mark in round <n>: <count>.` |
| Archive page | `Loading answers` | (rows appended) | empty page: `No newer answers yet.` |
| Search | `Searching` | `Answers matching: <count>.` | none: `No answers match "<query>".`; empty: `Type something to search for.`; over limit: `Searches can be up to 80 characters.`; timeout: `That search took too long. Try a shorter spelling.` |
| Raise dispute | `Sending dispute` | `Dispute sent to the quizmaster.` | empty: `Say what was wrong with the mark.`; over limit: `Reasons can be up to 280 characters.`; window closed: `Disputes for round <n> are closed.` |
| Ruling seen by its captain | | `Dispute ruled: <ruling> for round <n>, question <q>.` | |
| Save ruling | `Saving ruling` | `Ruling saved. The captain's note is on its way.` | already ruled: `This dispute was already ruled.` |
| Publish round | `Publishing round <n>` | Table news: `Round <n> published. Leader: <team name> on <total> points.` | disputes open: `Open disputes left on round <n>: <count>. Rule on them before publishing.` |
| Any request that gets no response, or a 5xx not listed above | | | `The desk can't reach the server. Trying again.` |
| Not-found screen | | | heading `No such page in the quiz book.` |

- **Round closed.** On the answer desk, the round-closed copy shows as soon as a poll reports the form's round closed, or as soon as a submit is refused for that reason. A poll-detected close shows the copy once per round per device.
- **Server-timed close on screen.** When the server closes a round with no user action, every open screen shows it within one polling delay: the chip reads `Round <n> · Closed`, the captain's fields turn read-only in place as Interactions describes, and the captain sees the round-closed copy. On the quizmaster desk the card loses its Close button. If focus was on that button, it moves to the card article. All of this holds when the device clock is hours off.
- **Dispute ruled.** The dispute-ruled copy shows once per ruling per signed-in device. It appears in Desk messages on `/captain`, and on `/` while the captain is signed in, within one polling delay of the ruling. The answer's row in Your marks then shows `Upheld` or `Dismissed`.
- **Dispute window on screen.** A poll that reports a round published removes every `Dispute question <q>` button of that round in place, with the rows and their marks kept. A Raise a dispute sheet open on that round stays open; its Send dispute shows the window-closed copy.

**Live updates and timers.** These rules apply on every open screen.

- Server changes appear in place within one polling delay, with no reload, no change of scroll position and no change of focus. Server changes means round status, sheet status, marks, dispute rulings, team names and the table.
- A rename leaves the table's `version` unchanged, yet within one polling delay the team's tile on `/`, `/captain` and `/quizmaster` shows the new name. It is the same tile element in the same place, and focus and page scroll stay as they were, even when focus is on that tile.
- The countdown tick (once a second), the 3-second polls and the 6-second message lifetime never change any of these:
  - a field's value, caret or selection
  - a chosen file
  - which element has focus
  - an open dialog, pane or sheet
  - the scroll position of the page or of a pane
- The countdown tick, the polls and the message lifetime never replace an open form, its fields, the archive rows, the tiles or the Search results table with new elements. The answer form and its fields stay the same elements while their round is open and after it closes, until a poll reports a different round open and that round's new form replaces them. An open dialog keeps its own typed text, counter and caret.
- A poll that brings a change to something behind an open dialog or sheet updates it behind the dialog and leaves the dialog alone. For example, a new team name updates the tile but not the Team name field, and a new mark on another answer updates Your marks behind the Raise a dispute sheet without touching its Reason, counter or caret.
- In the open marking pane, a mark saved from another marker device checks the matching radio in place. The current row stays the same.
- In the dispute queue, a dispute ruled from another quizmaster device leaves the queue in place. If that device has the ruling dialog open for the same dispute, the dialog stays open, and Save ruling then shows the already-ruled copy.

**Focus and keyboard.** This is the one place these rules are stated.

- Every action in the journeys can be completed with the keyboard alone. Focus never falls to the page body.
- Tab order follows the visual order: masthead, then desk controls from top to bottom, then the tiles in table order.
- While a dialog or sheet is open, the content behind it cannot be reached or used:
  - Tab from its last stop goes to its first, and Shift+Tab from its first stop goes to its last.
  - Clicking or tapping the backdrop does nothing, and focus stays inside the dialog.
  - Escape closes it.
- A refusal leaves focus on the control that sent the request, and a dialog stays open after a refusal.

Tab order inside each dialog:

| Dialog | Tab order (then wraps to the first) |
|---|---|
| Rename team | Team name, Save name, Cancel |
| Raise a dispute | Reason, Send dispute, Cancel |
| Rule on dispute | the Ruling radiogroup (one stop), Save ruling, Cancel |
| Mark round `<n>` | each row's radiogroup in list order (one stop each, on its checked radio, or on Correct when the row is unmarked), then Finish marking, then Close |

Where focus goes after each event. A dialog's first stop is the focus target in the "opens" row for that dialog.

| Event | Focus goes to |
|---|---|
| `/sign-in` opens | `textbox "Desk code"` |
| Landing on a desk after sign-in or a redirect | that desk's level-1 heading, with the page scrolled to the top |
| `Open round <n>` succeeds | `Close round <n>` on the same card |
| `Close round <n>` or `Publish round <n>` succeeds, or the server closes the round while focus is on `Close round <n>` | `article "Round <n>"` |
| The file chooser closes | the file field `Picture sheet for round <n>` |
| Sheet upload succeeds or is refused, or Upload is activated with no file chosen | `Upload sheet for round <n>` |
| Rename team opens | Team name |
| Rename team closes by Save name, Enter, Cancel or Escape | `Rename team` |
| Raise a dispute opens | Reason |
| Dispute sent | the next `Dispute question <q>` button after it in Your marks, or `heading "Answer desk"` when there is none after it |
| Send dispute refused, the window-closed refusal included | stays on Send dispute, with the sheet open |
| Raise a dispute closes by Cancel or Escape | its `Dispute question <q>` button, or `region "Your marks"` once a poll has removed that button |
| A poll removes the focused `Dispute question <q>` button | `region "Your marks"` |
| Mark round `<n>` opens | the current row's checked radio, or its Correct radio when the row is unmarked |
| Mark round `<n>` closes by Close or Escape | `Mark round <n>` |
| Finish marking succeeds | the pane closes, and focus goes to `heading "Marking"` |
| Finish marking refused | stays on Finish marking, with the pane open |
| Rule on dispute opens | Uphold |
| Ruling saved, or already ruled and then closed | the `Rule on ...` button that followed it in queue order; if it was last, the first `Rule on ...` button; if the queue is empty, `heading "Disputes"` |
| Rule on dispute closes by Cancel or Escape while its dispute is still queued | its `Rule on ...` button |
| More answers brings rows | the first appended row, without scrolling the page; later polls and message expiry leave focus there |
| More answers brings an empty page | stays on More answers |
| Search from the search field with Enter | stays in `searchbox "Search answers"` |

## Backend

### API (DP-01, DP-02, DP-14, DP-21, DP-30, DP-36, DP-39, DP-46, DP-51)

**Request basics.**

- Every endpoint lives under `/api`.
- JSON bodies are UTF-8 with content type `application/json`, and responses are `application/json`.
- Times are ISO 8601 in UTC.
- A desk session is a cookie set by `POST /api/session`, and it lasts until sign-out.
- The roles are `quizmaster`, `marker` and `captain`. A captain's session belongs to one team.

**Error body.** Every error has the same shape, `{"error":"<code>"}`, with these additions:

- `422` adds `"fields":{"<field>":"required|too_long|invalid|too_deep"}`, with `"error":"invalid"`.
- `429` adds `"retry_after":<seconds>`.
- Conflicts that carry a count add `"count":<n>`.

**Field error values.** This is the one rule for the value a `fields` entry carries. A 422 lists every failing field, and each field gets exactly one value:

- `required`:
  - a field that is missing or `null`
  - a text that is empty after trimming (`code`, `name`, `question_<q>`, `query`, `reason`)
  - an `answers` list that is missing or empty
  - an empty sheet body (field `body`)
- `too_long`: a text longer than its code-point limit in Business rules (`name`, `question_<q>`, `query`, `reason`).
- `too_deep`: a search body nested deeper than its limit in Business rules (field `body`). When this applies, it is the only field reported.
- `invalid`, for every other failure, including:
  - a value of the wrong JSON type
  - `answers` with more than 8 items, a repeated question, or a question that is not an integer from 1 to 8
  - an `Idempotency-Key` header that is empty, longer than 64 characters, or holds characters outside visible ASCII (field `idempotency_key`)
  - `points` other than the integer 0 or 1
  - an `answer_id` that is not a positive integer
  - a `ruling` other than `upheld` or `dismissed`
  - a `limit` below 1, or one that is not an integer
  - a `cursor` the server cannot read
  - a `round` that is not an integer from 1 to 8, in a query parameter or in the search body
  - sheet dimensions outside the range in Business rules, or unreadable dimensions (field `body`)

**Error precedence.** This one rule covers every endpoint. The first check that fails decides the response.

1. **Server boundary checks.** Unknown route 404, wrong method 405, body too large 413, wrong declared content type 415, and malformed JSON `400 {"error":"bad_json"}`.
2. **Session.** `401 {"error":"signed_out"}` when the endpoint needs a session and there is none.
3. **Unknown resource.** `404 {"error":"not_found"}` for an unknown round number, team, answer or dispute.
4. **Role.** `403 {"error":"forbidden"}` for the wrong role, or for a captain acting for another team.
5. **Rate limit.** `429`, for submits only.
6. **Idempotency.** This step applies only to submits that carry an `Idempotency-Key`.
   - If the team already has the key stored with the same request, the stored response is returned.
   - If the key is stored with a different request, the answer is `409 {"error":"idempotency_conflict"}`.
   - Both outcomes come before any state conflict or validation. For example, a reused key on a round that has since closed still replays or gets `idempotency_conflict`, never `round_closed`.
   - Business rules defines when two requests are the same.
7. **State conflicts.** `409`, in the order Business rules lists them for that action.
8. **Validation.** `422`. For the sheet upload this step runs in order: an empty body gets `422 fields.body:"required"`, then the content check gets `415 {"error":"unsupported_media_type"}`, then the dimension check gets `422 fields.body:"invalid"`.
9. **Provider calls.** Storage and search outcomes: `503`.

The endpoint rows below name only their own errors.

**Objects.**

- **Round:**
  ```json
  {"number":n,"title":"...","kind":"standard"|"picture","status":"drafted"|"open"|"closed"|"marked"|"published","opened_at":iso|null,"closes_at":iso|null,"closed_at":iso|null,"seconds_left":int|null,"sheet":{"status":"stored"|"not_stored","key":str|null,"size":int|null,"sha256":hex|null,"width":int|null,"height":int|null}|null}
  ```
  - `seconds_left` is the whole number of seconds left, rounded up, while the round is open. Otherwise it is `null`.
  - `sheet` is `null` for standard rounds.
- **Answer:**
  ```json
  {"id":int,"round":n,"team_id":int,"team_name":str,"question":q,"text":str,"submitted_at":iso,"current":bool,"mark":0|1|null,"ruled":0|1|null}
  ```
  - `id` increases in the order answers are accepted.
  - `submitted_at` is the moment the server accepted the answer, in UTC with a trailing `Z`, for example `2026-11-05T20:14:07.381Z`.
  - `ruled` is the mark after any upheld dispute. It is `null` until the answer is marked.
- **Dispute:**
  ```json
  {"id":int,"answer_id":int,"team_id":int,"round":n,"question":q,"answer_text":str,"reason":str,"status":"raised"|"upheld"|"dismissed","raised_at":iso,"ruled_at":iso|null,"note":"queued"|"sent"|null}
  ```
- **Table:**
  ```json
  {"night":4,"version":int,"last_published_round":n|null,"teams":[{"position":int,"team_id":int,"name":str,"total":int,"last_round":{"round":n,"score":int}|null}]}
  ```

**Endpoints.**

- **Health and session.** These need no session, except where a row says otherwise.
  - `GET /api/health` → `200 {"status":"ok"}` once the database is ready, and `503 {"status":"starting"}` before that.
  - `POST /api/session` with body `{"code":str}` → `201 {"role":str,"team_id":int|null,"team_name":str|null}`, and sets the session cookie.
    - Any other body field is ignored.
    - `401 {"error":"bad_code"}` for an unknown code; `422 fields.code`.
  - `GET /api/session` (any session) → `200` with the same body as the `201` above.
  - `DELETE /api/session` (any session) → `204`.
- **Rounds and table.** Public.
  - `GET /api/rounds` → `200 {"night":4,"server_time":iso,"rounds":[Round×8]}`.
  - `GET /api/rounds/{n}` → `200 {"round":Round}`.
  - `GET /api/table` → `200 Table`.
- **Quizmaster.**
  - `PUT /api/rounds/{n}/sheet` with raw image bytes and content type `image/png` or `image/jpeg` → `201 {"round":Round}` with `sheet.status` `stored`. Errors: `413 {"error":"too_large"}`, `415 {"error":"unsupported_media_type"}`, `422 fields.body` and `503 {"error":"storage_unavailable"}`.
  - `POST /api/rounds/{n}/open` (no body) → `200 {"round":Round}`. Error: `503 {"error":"storage_unavailable"}`.
  - `POST /api/rounds/{n}/close` (no body) → `200 {"round":Round}`.
  - `POST /api/rounds/{n}/publish` (no body) → `200 {"round":Round,"table":Table}`.
  - `POST /api/disputes/{id}/ruling` with body `{"ruling":"upheld"|"dismissed"}` → `200 {"dispute":Dispute}`. Error: `422 fields.ruling`.
- **Sheets.** Quizmaster, marker and captain.
  - `GET /api/rounds/{n}/sheet` → `200` with the stored image bytes and their content type.
    - The quizmaster may read a sheet in any round status.
    - Other roles get `409 {"error":"round_not_open"}` while the round is drafted.
    - `404` when no sheet is stored; `503 {"error":"storage_unavailable"}`.
- **Answers.**
  - `POST /api/rounds/{n}/answers` (captain), with an optional `Idempotency-Key` header and body `{"answers":[{"question":q,"text":str}]}` → `201 {"round":n,"accepted":[Answer]}`. Errors:
    - `422` with field `answers` for a missing or empty list, more than 8 items, a repeated question, or a question outside 1 to 8.
    - `422` with field `question_<q>` for that answer's text.
    - `422` with field `idempotency_key` for a bad key.
  - `GET /api/rounds/{n}/answers` → `200 {"round":n,"answers":[Answer]}`, holding current answers only. They are ordered by question number ascending, then by `team_id` ascending. This order never follows the league table or team names.
    - The quizmaster and the marker see all teams.
    - A captain sees only their own team, with `mark` and `ruled` shown as `null` until the round is marked.
- **Marks.** Marker.
  - `PUT /api/rounds/{n}/marks` with body `{"answer_id":int,"points":0|1}` → `200 {"answer":Answer}`. An answer from another round counts as unknown (`404`). Errors: `422 fields.points` or `fields.answer_id`.
  - `POST /api/rounds/{n}/marked` (no body) → `200 {"round":Round}`.
- **Archive.** Quizmaster and marker.
  - `GET /api/answers?limit=&cursor=&round=` → `200 {"answers":[Answer],"limit":int,"next_cursor":str|null,"has_more":bool}`.
    - Answers come in ascending `id`, and every version is included, superseded ones too.
    - `limit` defaults to 25. A value above 100 is served as 100, and the applied value is echoed in `limit`. A value below 1, or one that is not an integer, gets `422 fields.limit`.
    - `next_cursor` is an opaque string pointing just after the last answer on the page. It is `null` only when the page is empty; the client then keeps its previous cursor.
    - `has_more` says whether more answers existed after this page when it was read.
    - An unreadable cursor gets `422 fields.cursor`. A `round` outside 1 to 8 gets `422 fields.round`.
    - Paging from no cursor until a page comes back empty shows every answer accepted before that final read exactly once, with no repeats and no gaps, even while new answers are being accepted. Answers accepted later appear on later pages.
  - `POST /api/answers/search` with body `{"query":str,"round":n?}` → `200 {"answers":[Answer],"count":int,"truncated":bool}`, matching as Business rules states. Error: `503 {"error":"search_timeout"}`.
- **Teams.** Captain, own team only.
  - `PATCH /api/teams/{id}` with body `{"name":str}` → `200 {"team":{"id":int,"name":str}}`. Error: `422 fields.name`.
- **Disputes.**
  - `POST /api/disputes` (captain) with body `{"answer_id":int,"reason":str}` → `201 {"dispute":Dispute}`. Error: `422 fields.reason`.
  - `GET /api/disputes` (quizmaster and captain) → `200 {"disputes":[Dispute]}`, oldest first. The quizmaster sees every dispute. A captain sees only their own team's.

**Role table.** An endpoint that is not marked public or "any session" above answers only the role named in its group heading. Where a group or row lists several roles, that row's rule applies.

### Business rules (DP-05, DP-06, DP-09, DP-10, DP-11, DP-14, DP-15, DP-17, DP-19, DP-20, DP-21, DP-23, DP-26, DP-27, DP-32, DP-33, DP-34, DP-36, DP-37, DP-39, DP-45, DP-46, DP-60, DP-63, DP-83, DP-85, DP-86, DP-87)

**Text and limits.**

- Every text the server accepts is first normalised to Unicode NFC, then trimmed of leading and trailing white space. Its length is then counted in Unicode code points. Live counters in the browser count the same way.
- Worked examples of the count, each after normalising and trimming:

  | Text | Counts |
  |---|---|
  | `e` followed by a combining acute accent (it composes to é) | 1 |
  | 🍺 (one emoji code point) | 1 |
  | 🇬🇧 (two regional-indicator letters) | 2 |
  | 👨‍👩‍👧 (man, zero-width joiner, woman, zero-width joiner, girl) | 5 |
  | `q` followed by a combining dot above (it has no composed form) | 2 |
  | `  bjork  ` (two spaces either side) | 5 |

  For example, sixteen 👨‍👩‍👧 in the search field count 80 and are accepted, and one more character makes 81, which is over the limit.
- The limits, all inclusive:

  | Field | Code points |
  |---|---|
  | Team name | 1 to 40 |
  | Answer text | 1 to 120 |
  | Search query | 1 to 80 |
  | Dispute reason | 1 to 280 |

- A text that is empty after trimming gets `required`, and one over its limit gets `too_long`.
- Answers are stored after normalising and trimming, and nothing else about them changes: case, spelling and punctuation stay as typed.

**Round machine.** A round moves `drafted → open → closed → marked → published` and never moves backwards.

- **The moves:**
  - open: by the quizmaster, from drafted
  - close: by the quizmaster from open, or by the server timer
  - marked: by the marker, from closed
  - publish: by the quizmaster, from marked
- At most one round is open at a time. Rounds may be opened in any order.
- **Refusals,** checked in this order for each action:
  - **Open:**
    1. `409 {"error":"round_not_drafted"}` unless the round is drafted.
    2. `409 {"error":"another_round_open"}`.
    3. For a picture round, `409 {"error":"sheet_not_stored"}` when no sheet is stored.
    4. If storage cannot confirm the stored sheet again at that moment, `503 {"error":"storage_unavailable"}`, and the round stays drafted.
  - **Close:** `409 {"error":"round_not_open"}` unless the round is open.
  - **Marked:** `409 {"error":"round_not_closed"}` unless the round is closed, then `409 {"error":"unmarked_answers","count":<unmarked current answers>}`.
  - **Publish:** `409 {"error":"round_not_marked"}` unless the round is marked, then `409 {"error":"disputes_pending","count":<raised disputes in that round>}`.
  - **Sheet upload:** `409 {"error":"not_picture_round"}` for a standard round, then `409 {"error":"round_not_drafted"}` unless the round is drafted.
  - **Submit:** `409 {"error":"round_not_open"}` while the round is drafted, and `409 {"error":"round_closed"}` once it is closed, marked or published.
  - **Mark:** `409 {"error":"round_not_closed"}` unless the round is closed, then `409 {"error":"answer_superseded"}` for an answer that is not current.

**Time rules.**

- Only the server decides whether a round is open or closed.
- **Allowance.**
  - Opening a round sets `closes_at` to `opened_at` plus `ROUND_SECONDS` seconds.
  - `ROUND_SECONDS` is an environment variable in whole seconds, from 5 to 3600, with a default of 240.
- **Closing.**
  - From `closes_at` on, the round is closed, with `closed_at` equal to `closes_at`, whether or not any request arrived at that moment.
  - A quizmaster close sets `closed_at` to the moment of the close.
- **Late submits.** A submit is accepted only if the server receives it before `closed_at`. Otherwise it gets the round-closed conflict, whatever the phone's countdown shows.
- **Polling.** Every screen polls `GET /api/rounds` and `GET /api/table` every 3 seconds. Desks poll their own lists at the same 3-second delay.
- **The device clock may be wrong by hours, and its time zone may be anything.**
  - The browser shows round status, seconds left, scores, totals and positions exactly as the server last returned them. It never derives any of them from the device clock or from its own arithmetic.
  - The captain's countdown is for display only. It resets from `seconds_left` on every poll and on landing, and ticks down once a second in between.
  - Dispute buttons follow the round status the server last reported, never the device clock.
- **Archive time sent.** Each archive and search row shows its answer's time sent as `HH:MM:SS`: the two-digit hour (00 to 23), minute and second of `submitted_at` in UTC, truncated, never rounded. For example, `2026-11-05T20:14:07.981Z` shows `20:14:07`. It is the same on every device whatever its clock or time zone, and never relative to now.

**Picture sheets.**

- **Size and type.**
  - An upload may be up to 5,000,000 bytes, inclusive. An empty body gets 422, and a body above 5,000,000 bytes gets 413.
  - The declared content type must be `image/png` or `image/jpeg`. Anything else gets 415.
- **Content.** The declared type is then checked against the bytes themselves. The file's name is never consulted.
  - `image/png` must start with the eight-byte PNG signature (bytes 137 80 78 71 13 10 26 10), followed by an IHDR chunk that gives the width and height.
  - `image/jpeg` must start with the bytes 255 216 255. Its width and height come from the first baseline, extended or progressive start-of-frame segment (marker bytes 255 192, 255 193 or 255 194), so baseline and progressive JPEGs are both accepted.
  - Bytes that do not match the declared type get `415 {"error":"unsupported_media_type"}`.
- **Dimensions.**
  - Width and height must each be from 200 to 4,000 pixels, inclusive.
  - A sheet outside that range gets `422 {"error":"invalid","fields":{"body":"invalid"}}`. So does a sheet with a matching signature whose dimensions cannot be read.
- **Refusals write nothing.** A refused upload writes no object to storage.
- **Storing.**
  - The server computes the SHA-256 of the bytes and writes the object at the key given in Services.
  - The server records the sheet as `stored`, and answers 201, only after storage reports an object at that key whose size and SHA-256 equal the upload's.
  - Any failure to write or to confirm leaves the sheet `not_stored` and answers `503 storage_unavailable`. A sheet stored earlier stays as it was.
- **Replacing.** A new upload to a drafted round replaces the previous sheet once the new one is confirmed.

**Submits.**

- A submit carries 1 to 8 answers, each for a different question.
- Each accepted answer becomes the team's new current answer for its question, and the previous one becomes `current: false`. Earlier answers stay in the archive unchanged.
- A team that submits nothing for a question scores 0 for it.

**Rate limit.**

- Each team may make 6 submits in any rolling 60 seconds, across all rounds.
- Every authenticated submit by the team's captain counts, replays and refused submits included. Submits answered 429 do not count.
- The 7th and later submits inside the window get `429 {"error":"too_many_submits","retry_after":<s>}` with the header `Retry-After: <s>`.
- `<s>` is the whole number of seconds, rounded up and at least 1, until the oldest counted submit in the window is 60 seconds old.

**Idempotency.**

- `Idempotency-Key` is optional. It is 1 to 64 visible ASCII characters and scoped to the team.
- Only a 201 response is stored under its key, and stored responses never expire.
- Two requests under one key are the same when they target the same round number and their JSON bodies are equal after parsing. Equal means the same values, ignoring object key order and white space, with array order significant. Text values are compared as received, before normalising.
- A repeat of the same request returns the stored status and body with the header `Idempotent-Replayed: true`, and stores nothing new.
- A repeat that is a different request gets the idempotency conflict from the error precedence in API.
- A key with no stored response, for example one whose earlier request was refused, is processed as a new submit.

**Marks and scores.**

- A mark is 0 or 1 points on a current answer of a closed round. Marking the same answer again replaces its mark while the round is closed.
- Marks and rulings never change an answer's stored text.
- A team's round score is the sum of the `ruled` points of its current answers in that round. `ruled` equals the mark, except that an upheld dispute makes it 1.

**Disputes and rulings.**

- A captain may dispute only a current answer of their own team that is marked 0, and only while its round is `marked`, which means after marking and before the quizmaster publishes it.
- Refusals, in this order:
  1. `409 {"error":"dispute_window_closed"}` when the round is not marked, whether before marking or after publishing.
  2. `409 {"error":"answer_superseded"}`.
  3. `409 {"error":"answer_not_marked_wrong"}` for an answer marked 1.
  4. `409 {"error":"dispute_exists"}` when the answer already has a dispute.
- A ruling applies only to a raised dispute. Any other gets `409 {"error":"dispute_already_ruled"}`.
- `upheld` sets the answer's `ruled` to 1, and `dismissed` leaves it at 0. A ruling is final.

**Publish and the league table.**

- Publishing fixes the round's scores and makes them count in the table. `version` goes up by 1 on each publish and on nothing else; a rename leaves it unchanged.
- A team's total is the sum of its published scores: each seeded past night's score plus every round published tonight. The server computes totals at publish.
- Table order is by total, highest first, then by team name in ascending Unicode code-point order. `position` is the 1-based place in that order.
- `last_round` is the team's score in `last_published_round`, or `null` while no round tonight is published.

**Search.**

- The query is plain text, never a pattern. Characters such as `%`, `_`, `*`, `(`, `.` and `\` match themselves.
- An answer matches when its text contains the query after both are case-folded and stripped of accents, so `bjork` finds `Björk`.
- Results include superseded answers, in ascending `id`, up to 100. `truncated` is true when more matched.
- `count` is the number of answers in the response's `answers` list, so it is never more than 100, even when more matched. The search success copy in Desk messages uses this same value.
- `round` narrows the search to one round.
- The body may nest at most 4 levels deep. The outer object is level 1, and each nested object or array adds a level. Deeper bodies get `422 fields.body:"too_deep"`.
- Every search, an 80-code-point pathological query included, answers within 1,500 milliseconds of receipt. A search that cannot finish in time answers `503 search_timeout` within that budget.

**Team names.**

- A captain may rename only their own team, at any time.
- A name that equals another team's name when both are case-folded gets `409 {"error":"name_taken"}`.

**Concurrency.** When requests race, the database decides the winner, and exactly one wins:

- Of simultaneous opens, at most one round ends up open. The others get `another_round_open`.
- Of simultaneous publishes of one round, exactly one gets 200. The others get `round_not_marked`.
- Of simultaneous rulings on one dispute, exactly one gets 200. The others get `dispute_already_ruled`.
- Of simultaneous disputes on one answer, exactly one gets 201. The others get `dispute_exists`.
- A submit racing a close is accepted only if it is stored before `closed_at`. A 201 always means the answers are stored.

### Services (DP-05, DP-07, DP-40, DP-41)

- **PostgreSQL** (`DATABASE_URL`) holds every record: the league, teams, desk codes, rounds, answers, marks, disputes, rulings, idempotency records, submit counts and published scores. The archive and the submit limit both read from it.
- **MinIO** (`S3_*`) holds the picture sheets.
  - The key is `sheets/night-4/round-<n>/<sha256>.<ext>`, where `<sha256>` is the lowercase hex digest of the bytes and `<ext>` is `png` or `jpg`.
  - Each object's content type is the upload's.
  - Calls to storage give up within 5 seconds.
  - While storage is unreachable:
    - Uploading a sheet answers `503 storage_unavailable`.
    - Opening a picture round whose sheet is stored also answers `503 storage_unavailable`.
    - The round card shows the sheet outage copy and the card outage line from Feedback states, and the round stays drafted.
    - A picture round with no stored sheet still gets `409 {"error":"sheet_not_stored"}` first, following the Open refusal order.
    - Everything else keeps working.
- **Mailpit** (`SMTP_HOST`, `SMTP_PORT`). Each ruling sends exactly one plain-text message:
  - **To:** the raising team's captain email from Seed data.
  - **From:** exactly the value of `MAIL_FROM`. The environment sets it to `Roundkeeper <rulings@snug-league.test>`.
  - **Subject:** `Ruling on round <n>, question <q>`.
  - **Body:** these four lines. For a dismissed dispute the last line reads `Ruling: Dismissed`.
    ```
    Round <n>: <title>
    Question: <q>
    Your answer: <answer as submitted>
    Ruling: Upheld
    ```
  - **Delivery.**
    - The dispute's `note` becomes `sent` only after the mail server accepts the message.
    - If the mail server is unreachable, the ruling still stands (200). `note` is `queued` and stays `queued` while the mail server is unreachable.
    - The server retries every 10 seconds until the mail server accepts the message.
    - A ruling never produces more than one accepted message.

### Seed data (DP-01, DP-46, DP-53)

Every person, team, pub and address here is invented. The seed is applied once, into an empty database, and is never duplicated.

- **League:** `Snug Thursday League`, season `Autumn 2026`, at the invented pub The Snug, Little Brampton. Nights 1 to 3 are published, and tonight is night 4.
- **Desk codes:** quizmaster `HOST-4417`, marker `MARK-2093`, and captains `CAP-01` to `CAP-12`, matching the team ids below.

**Teams.** The teams are listed in starting table order. Each team's id matches its desk code number. Its past night scores count in its total as published scores.

| id | Team | Captain email | Night 1 | Night 2 | Night 3 | Total |
|---|---|---|---|---|---|---|
| 1 | Tequila Mockingbird | captain01@snug-league.test | 51 | 48 | 53 | 152 |
| 2 | Les Quizérables | captain02@snug-league.test | 50 | 49 | 50 | 149 |
| 3 | Sherlock Ohms | captain03@snug-league.test | 47 | 52 | 46 | 145 |
| 4 | The Quizzly Bears | captain04@snug-league.test | 45 | 50 | 50 | 145 |
| 5 | The Mitochondriacs | captain05@snug-league.test | 44 | 46 | 48 | 138 |
| 6 | Universally Challenged | captain06@snug-league.test | 43 | 45 | 44 | 132 |
| 7 | Spelling Bees | captain07@snug-league.test | 41 | 44 | 43 | 128 |
| 8 | Norfolk Enchants | captain08@snug-league.test | 40 | 42 | 41 | 123 |
| 9 | Half Past Pints | captain09@snug-league.test | 38 | 40 | 41 | 119 |
| 10 | The Lemon Tops | captain10@snug-league.test | 36 | 39 | 40 | 115 |
| 11 | Dot's Lot | captain11@snug-league.test | 35 | 37 | 36 | 108 |
| 12 | Bad Losers | captain12@snug-league.test | 30 | 33 | 31 | 94 |

For example, with the seed data at start: Sherlock Ohms is 3rd and The Quizzly Bears 4th on equal totals, `version` is 1, and `last_published_round` is `null`.

**Tonight's rounds.** Every round is drafted, with 8 questions, no answers and no sheet.

| Round | Title | Kind |
|---|---|---|
| 1 | General Knowledge | standard |
| 2 | History | standard |
| 3 | Picture Round: Doorways | picture |
| 4 | Music | standard |
| 5 | Science and Nature | standard |
| 6 | Picture Round: Shop Fronts | picture |
| 7 | Sport | standard |
| 8 | Final Round: Local Knowledge | standard |

## Technical requirements

### Deployment (DP-52, DP-53)

- The runtime is Node.js 22 LTS with npm, and the app is written in TypeScript.
- `/app/run.json` holds the string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```

- The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when that is set.
- `GET /api/health` returns HTTP 200 JSON `{"status":"ok"}` once the app is ready.
- On every serve, the app applies its schema and seed idempotently to the database it is given, and makes sure its bucket exists and is reachable for writes. It never relies on the build step for either. Several copies of the app may run side by side, each with its own environment.

### Configuration and secrets (DP-59)

The app reads these environment variables at start:

- `DATABASE_URL`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`
- `SMTP_HOST`, `SMTP_PORT` and `MAIL_FROM`
- `ROUND_SECONDS`
- `APP_PUBLIC_PORT`

None of these values is hard-coded, and none is written into any asset, response or page sent to the browser. Sheet images reach the browser only through `GET /api/rounds/{n}/sheet`.

### Server boundary (DP-50, DP-56, DP-61)

- **Published surface.**
  - Only the routes in the API section answer under `/api`. Any other `/api` path gets `404 {"error":"not_found"}`.
  - A listed path called with an unlisted method gets `405 {"error":"method_not_allowed"}`. Its `Allow` header names exactly the methods the API section lists for that path, plus `HEAD` wherever `GET` is listed. `HEAD` is answered like `GET`.
  - There is no debug, test, reset, seed or admin endpoint.
- **Content types.**
  - A `POST`, `PUT` or `PATCH` whose body has a content type other than `application/json` gets `415 {"error":"unsupported_media_type"}`. A charset parameter is allowed.
  - The sheet upload is the one exception; Business rules gives its types.
  - Bodyless `POST` actions take no body.
- **Size.** JSON bodies up to 16,384 bytes, inclusive, are accepted. Larger bodies get `413 {"error":"too_large"}` before parsing.
- **Same origin.** The API is same-origin only. It sends no cross-origin permission headers and serves no cross-origin requests.
- **Sign-in landing.**
  - Opening a desk path (`/captain`, `/marker`, `/quizmaster` or `/archive`) without a session ends on exactly `/sign-in`, with no query string.
  - `/sign-in` ignores every query parameter, `next`, `return_to` and `redirect` included.
  - After sign-in, the browser goes only to the role's desk path: `/quizmaster`, `/marker` or `/captain`. It never goes to the page that was asked for. For example, `/archive` asked for while signed out lands the marker on `/marker`. The address afterwards is exactly the desk path, and the landing focus and scroll are as Feedback states gives them.
  - A signed-in visit to `/sign-in`, or to a desk path of another role, goes to that session's own desk path. The archive is open to both the marker and the quizmaster.
- **Never served.**
  - The server never serves source files, the run manifest, lockfiles, environment files or anything outside the built assets.
  - Those paths, and any other unknown page path, return HTTP 404 with the not-found screen.
- **Boot.**
  - If the database is unreachable at boot, the server keeps retrying. Health answers 503 until the database is ready, and the server then serves normally.
  - If storage or mail is unreachable at boot, the server starts anyway and behaves as Services describes.

### Browser support and performance (DP-54, DP-74, DP-80)

- The app supports current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800, and at every width from 320 px up, including one pixel either side of each published breakpoint.
- `/sign-in` and every desk also support a 320x568 touch phone and a 768x1024 touch tablet.
- The table view is usable within three seconds of opening on the seeded data.
- Screens reflect server changes within one polling delay.
- Fonts are self-hosted.

## Working rules

- IF-01: `/app/run.json` exists with exactly the string keys `_schema` (value `run-manifest-v1`), `install`, `build` and `serve`.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` names every shipped package with its version and licence, plus the Fraunces and Atkinson Hyperlegible typefaces. Shipped packages means the production dependency tree reported by `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package (the production dependency tree reported by `npm ls --omit=dev --all --json`) carries one of these licences: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or BlueOak-1.0.0. Every font carries the SIL Open Font License 1.1.
- IF-04: `package-lock.json` is committed, and the manifest's install command is `npm ci`.
- IF-05: State lives only in the provided PostgreSQL database and MinIO bucket. There is no other database, cache server, embedded database file or on-disk store.
- IF-06: The browser loads nothing from other origins. The app serves every font, script, style and image itself.
- IF-07: The provided service configuration (the dev compose files and service settings) stays unchanged.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript with no `any` escapes, and it compiles without type errors.
- Names in the code match this brief's domain terms: round, sheet, answer, mark, ruling, dispute, publish, table, desk code, captain, Desk messages.
- Each of these domain rules is decided in exactly one place in the source:
  - the round transitions and their refusals
  - the code-point limits and counting rule, shared by the server checks and the live counters
  - the submit allowance
  - the sheet content and dimension checks
  - the ruled score and the league total
  - the table order
  - the sign-in landing by role
  - the 6-second Desk messages lifetime
  - the archive time-sent format
  - the published easing curve and motion durations
- The browser code holds no score, total or position arithmetic, and no round-status or dispute-window decision taken from the device clock. Countdown and poll state never decide the identity of a form, its fields or a tile.
- No abstraction has only one implementation, and no wrapper only forwards calls.
- There is no dead, commented-out or unreachable code, and no defensive check for a state the rules make impossible.
- Every error leaves the server through one shared error shape and status mapping.
- No feature, endpoint, setting or screen goes beyond this brief.
