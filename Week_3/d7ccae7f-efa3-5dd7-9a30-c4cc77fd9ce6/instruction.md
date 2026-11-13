# Corkline Works Lastbell

Lastbell is a live trivia night tool for independent quizmasters: pub quiz hosts and tutors who run their own paid nights on a venue screen while players answer on their phones. The quizmaster signs in, builds decks of timed questions with pictures, opens a room on the venue laptop, and runs each question from that screen through answering, lock, reveal, leaderboard and podium. Players join from a phone with a six-digit PIN and a nickname. They answer with one thumb and keep their seat through reloads and patchy wifi. The server decides every deadline, score and rank, so a disputed answer can be settled from the server's own numbers. Lastbell uses three backend services and no others: Postgres is the durable record (accounts, decks, rooms, seats, answers, standings and the room event log), Valkey carries live room state and fan-out, and MinIO stores question pictures. Out of scope: player accounts, teams, chat, audio rounds, payments or plans, email, public deck sharing, analytics, and any datastore beyond those three.

## Problem and users

Independent quizmasters run one to three paid nights a week in pubs, taprooms and community halls. The venue pays per night, and regulars come back only if the night feels fair. Most hosts get by on hosted quiz tools built for classrooms or corporate events. Free tiers cap the number of players or limit custom questions, and picture rounds sit behind paid plans. On crowded venue wifi those tools fall over. A phone stalls and its player says they answered in time, and the host can't prove otherwise. A phone reloads and loses its seat and points. If the laptop tab closes, the whole night is lost. So many hosts still carry printed answer sheets and mark by hand as a fallback, and each disputed round costs them goodwill with the venue and the regulars.

- **Quizmaster** (weekly): writes decks of timed questions with pictures, opens a room, runs question, lock, reveal, leaderboard and podium from the big screen without touching a mouse, and keeps the results of every night.
- **Player** (weekly): joins from a phone with a six-digit PIN and a nickname, answers within the window with one thumb, keeps their seat through reloads and flaky wifi, and always knows their own rank.

## Journeys

1. **Writing a deck.** The quizmaster starts signed out. They sign in, create a deck, and add a multiple-choice question, an estimate question and a sequence question. They attach a picture to one question. The editor shows "Uploading picture…" and only shows the thumbnail once the server confirms the stored picture. Back on the decks screen, after a reload, the deck is listed with its question count.
2. **Filling the room.** The quizmaster starts on the decks screen. They open a room for a deck, and the venue screen shows the stage lobby with a six-digit PIN. Players type the PIN and a nickname on their phones. Each nickname appears in the stage's player list, the connected count goes up, and each phone shows that it is in and waiting.
3. **Running the night from the keyboard.** The quizmaster starts in the lobby. Using only single keys, they open the first question. Phones show it with a countdown. The quizmaster locks the question, or the server locks it at the deadline. They reveal it, and the answer split rises on the stage as pillars and counts. They show the leaderboard, open the next question, and go on until the last one. Then they show the podium, confirm the end of the night, and the stage reads that the night has ended.
4. **Answering on a phone.** The player starts on the phone controller in the lobby. When a question opens, they answer with one thumb: tap a tile, set an estimate on a slider, or put items in order. The phone says "Locked in". An answer that reaches the server after the deadline is refused, and the phone shows by how many milliseconds it missed. At each reveal the phone shows the player's rank and score.
5. **A phone reloads mid-question.** The player starts seated, with a score and a streak. The phone reloads, or drops wifi and comes back. It returns to the same seat with the same nickname, score and streak. It shows the current question, or the reveal it missed. Any other tab that held that seat is told the seat has moved.
6. **The venue's live link fails.** The night starts in progress. The live service goes down. The stage and every phone switch to the backup link and say so, and questions, answers, reveals and the leaderboard carry on. When the service comes back, they return to live updates without anyone restarting anything.
7. **The stage tab closes.** A question is open when the laptop's tab closes. The server still locks the question at its deadline. The quizmaster reopens the stage while signed in and finds the room exactly where it stands, ready to reveal.
8. **Looking back.** The quizmaster starts on the decks screen. They open Past nights and pick a night. They see its final standings table with rank, nickname and score.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Quizmaster accounts** A quizmaster creates an account, signs in and signs out with email and password, and every host screen and host endpoint requires a signed-in session, as detailed in API.
- **DP-02 — Decks stay with their quizmaster** A quizmaster sees, edits and opens rooms only from their own decks, and another quizmaster's deck, question, room or night answers as if it did not exist.
- **DP-03 — Question types and their rules** A deck holds multiple-choice, estimate and sequence questions, each saved only when it meets the field rules in Business rules.
- **DP-04 — Edits never overwrite newer versions** Saving a deck title or a question with an out-of-date version is refused and changes nothing.
- **DP-05 — Authoring a deck** Signed in, the quizmaster creates a deck in the deck editor, adds one question of each type, attaches a picture, and finds the deck with its question count on the decks screen after a reload.
- **DP-06 — Pictures judged by their content** A question picture is accepted only when its bytes are a real PNG, JPEG or WebP, whatever its file name or declared type, and every other file is refused with a named reason.
- **DP-07 — Picture size limit** A question picture larger than the published byte limit, or an empty one, is refused with its named reason and nothing is stored.
- **DP-08 — Attached only once stored** A picture counts as attached only after the image store confirms the stored object, which then exists under the published key with the sniffed content type.
- **DP-09 — Editor shows the stored state** The deck editor shows a picture thumbnail only after the server reports it attached, and shows the uploading copy with no thumbnail while the upload is pending.
- **DP-10 — Picture storage outage** When the image store is unreachable, an upload is refused with the outage response and copy, the question stays without a picture, and decks and nights keep working.
- **DP-11 — Short-lived picture links** Every question opening issues fresh picture links that stop working once their configured lifetime has passed.
- **DP-12 — Opening a room** Opening a room from a deck freezes that deck's questions for the night and starts the room in the lobby with a fresh PIN.
- **DP-13 — Live PINs are unique** A PIN is six digits, never shared by two live rooms, and joins nothing once its room has ended.
- **DP-14 — Joining a room** A player joins a live room with its PIN and a nickname and receives a seat, a rejoin token and a client id, with each refusal named in API.
- **DP-15 — Nicknames unique in a room** Within one room nicknames are unique ignoring letter case, and of simultaneous joins with the same nickname exactly one succeeds.
- **DP-16 — Filling the lobby** With a room open on the stage, players who join from phones appear in the stage's player list and connected count, and each phone shows that it is in and waiting.
- **DP-17 — Forward-only room states** The room moves only along the published state machine, and a repeated or out-of-order host command is refused and changes nothing.
- **DP-18 — One winner per host command** Of several simultaneous identical host commands, exactly one succeeds and the room records one transition.
- **DP-19 — Server deadlines and auto-lock** Each open question has a server deadline, the room locks itself at that deadline whether or not the stage is connected, and a reopened stage resumes the room where it stands.
- **DP-20 — Stage runs from the keyboard** The quizmaster runs every step of the night with the published single-key shortcuts, which work whichever stage control has focus.
- **DP-21 — End-the-night dialog** Ending the night asks for confirmation in a dialog that keeps keyboard focus inside it, closes on Escape and returns focus to its opener.
- **DP-22 — Running a full night** The quizmaster opens, locks, reveals and shows the leaderboard for every question, then shows the podium and ends the night, and the stage reflects each step.
- **DP-23 — Answer window judged by the server** An answer counts only if the server receives it at or before the question's deadline, and a later one is refused with the server's remaining milliseconds.
- **DP-24 — One answer per seat per question** A seat records at most one answer per question, and of simultaneous answers from one seat exactly one is recorded.
- **DP-25 — Answers kept as received** Every recorded answer is stored with its server-measured latency and, from its reveal on, the points it earned, as published in Services.
- **DP-26 — Countdown and status from server time** Phones and stage draw the countdown from the server's deadline corrected for their own clock, and switch to the locked view only when the server says the question is locked.
- **DP-27 — Nothing correct before the reveal** Every player-facing payload carries only the published fields, so no correct option, estimate answer, tolerance or sequence order reaches a phone or the stage before the reveal.
- **DP-28 — One-thumb controller** At 375 by 812 the phone controller keeps every answer control in the bottom thumb zone at the phone touch size from Visual design, with the question echoed above.
- **DP-29 — Every answer type without a pointer** A player answers multiple-choice, estimate and sequence questions, including reordering items, with the keyboard alone and by touch.
- **DP-30 — Answer feedback on the phone** Sending, locked in, too late, already answered and seat-moved outcomes each show on the phone and are announced in its answer status region.
- **DP-31 — Points decay with response time** A correct answer earns integer points that fall linearly from the maximum at the opening to half at the deadline, by the formula in Business rules.
- **DP-32 — Streak multiplier** Consecutive fully correct answers raise a seat's streak and multiply its points by the published capped multiplier, and any other outcome resets the streak.
- **DP-33 — Sequence partial credit** A sequence answer earns the share of points given by its longest run of items in correct relative order.
- **DP-34 — Estimate tolerance** An estimate counts as correct when it lies within the question's tolerance of the answer, edges included.
- **DP-35 — Ranking and tie-breaks** Seats rank by total score, then by lower cumulative response time, then by earlier join.
- **DP-36 — Leaderboard matches stored standings** After every reveal the live leaderboard set and the stored standings hold the same score for every seat.
- **DP-37 — Leaderboard and own rank on screen** The stage shows the top ten at the leaderboard step and each phone shows its own rank, the seated count and its score, updated at each reveal.
- **DP-38 — Server-decided reveal numbers** The reveal event carries the counts, bins or buckets and the correct answer computed by the server, identical for every client.
- **DP-39 — Tally Pour reveal** At reveal the stage raises one pillar per option in tile order with staggered starts, counts each label up to the server count without overshoot, then marks the correct pillar in brass.
- **DP-40 — Replayed reveal shows final heights** A reveal shown after a reload or reconnect appears at its final heights and counts at once, with the correct answer already marked.
- **DP-41 — Reveal without motion or WebGL** Under reduced motion or without WebGL the stage shows the reveal as a still list of bars with the same counts, shares and correct-answer marking.
- **DP-42 — Podium** At the podium step the stage moves its view to the top three over the published duration, or under reduced motion or without WebGL shows them at once as a still ranked list with the same names and scores.
- **DP-43 — Stage look** The stage reads from across a room as a dark bottle-green space with chalk numerals, a wide serif question band in the upper third and answer tiles told apart by letter, tally mark and position.
- **DP-44 — Ordered events and exact replay** Each room's events carry strictly increasing ids, and a reconnect with the last seen id receives exactly the missed events in order without duplicates.
- **DP-45 — Rejoin restores the seat** A rejoin token restores exactly its own seat, nickname, score and streak until the room ends, after which it is refused.
- **DP-46 — One live client per seat** Each rejoin gives the seat a new client and retires the previous one, so two tabs racing on one token end with one seated client.
- **DP-47 — Streams released when a client leaves** When a phone or stage closes its stream, its client leaves the room's connected set and the server holds no work or database session for it.
- **DP-48 — A reload keeps the seat** A player reloads the phone mid-question and comes back to the same seat, score and streak, and sees the current question or any reveal they missed.
- **DP-49 — Backup link when the live service is down** When the live service is unreachable, streams are refused with the outage response and phones and stage carry on over the backup link, with every command, answer and reveal still working.
- **DP-50 — Back to live without a restart** When the live service returns, phones and stage move back to live streams and the leaderboard set is rebuilt, without restarting the app.
- **DP-51 — Backup link shown on stage and phone** While on the backup link, the stage and each phone show and announce the backup-link copy, and replace it with the return copy when back on live.
- **DP-52 — Ending a night closes every seat** Ending a night broadcasts the end, refuses its rejoin tokens and clients, and frees its PIN for a new room.
- **DP-53 — Idle rooms end themselves** A room with no connected client for the configured idle limit ends itself on the server.
- **DP-54 — Results of every night** Every ended night keeps its deck title, end time and final standings, listed newest first for its quizmaster.
- **DP-55 — Looking back at past nights** From the decks screen the quizmaster opens Past nights, picks a night and sees its final standings table.
- **DP-56 — Health check and run manifest** The app installs, builds and serves from its run manifest and answers the health check, even when the live service or image store is unreachable.
- **DP-57 — Credentials from the environment** Every service URL and credential is read from the environment at start and never hard-coded or sent to the browser, except the image store address and access key id inside presigned picture links as allowed in Server boundary.
- **DP-58 — Server boundary** The server answers same-origin requests only, refuses bodies over the published limit, and never serves source files, configuration or credentials.
- **DP-59 — No sideways scrolling at any size** Every screen fits 375 by 812, 768 by 1024 and 1280 by 800 without horizontal scrolling.
- **DP-60 — After-hours look** Every screen uses the bottle-green ground, chalk text, brass only for correct answers and the podium, coral only for lateness, Fraunces display numerals and Atkinson Hyperlegible body text.

## Frontend

### Screens and layout (DP-05, DP-16, DP-22, DP-28, DP-37, DP-55, DP-59)

Every screen fits 375x812, 768x1024 and 1280x800 with no horizontal scrolling. Long nicknames, prompts and options wrap or truncate with an ellipsis and never push the page sideways.

- **Join** (`/`): the player's front door. The Lastbell wordmark sits at the top. Below it are a large PIN field, a nickname field and the join button, stacked in one centred column at every size. A small "Quizmaster sign in" link sits at the foot of the page.
- **Sign in** (`/host/login`) and **Create account** (`/host/signup`): each is a single centred column holding its form.
- **Signed-out access.** A signed-out visit to `/host`, `/host/decks/<deckId>`, `/host/nights`, `/host/nights/<roomId>` or `/stage/<roomId>` redirects to `/host/login`. Signing in or creating an account always lands on Decks (`/host`). "Sign out" ends the session and lands on `/host/login`. A signed-in visit to `/host/login` or `/host/signup` redirects to `/host`.
- **Decks** (`/host`): the quizmaster's home. It shows a "Your decks" heading, a new-deck title field with its create button, and the list of decks. Each row shows the deck title, its question count and an "Open room" button. "Past nights" and "Sign out" sit in the header. At 375 each deck row stacks its title over its button. At 768 and above, the title and button share one line.
- **Deck editor** (`/host/decks/<deckId>`): the deck title with its save button, then one panel per question in deck order, then "Add question". Each panel holds the question's type, prompt, time limit, the fields for its type, and the picture area (file picker, state text, and the thumbnail once attached). At 1280 the panels sit in a centred column about two thirds of the page wide, with the picture area to the right of the fields. At 768 and 375 the picture area drops below the fields.
- **Stage** (`/stage/<roomId>`): the venue screen, designed for 1280x800 and larger. A full-bleed 3D room fills the screen. Over it, in the upper third, a wide band carries the question prompt in the display serif. Below that sits the answer area. For multiple choice it holds one tile per option, two to four, in a two-by-two grid filled left to right and top to bottom: two options make one row, and three options leave the last cell empty. For an estimate it holds one wide band showing the range. For a sequence it holds the items as a list of chalk cards in the order the server sent them. A slim control bar is pinned to the bottom edge. The lobby view shows the PIN in very large chalk numerals, the join address, the connected count and the player list. The question view adds the countdown and the answered count. The reveal view shows the pillars with their count labels. The leaderboard view shows the top ten. The podium view shows the top three. At 768 and 375 the same content stacks into one column: question band, then tiles in one column, then the control bar, which wraps onto two rows if needed.
- **Phone controller** (`/play/<roomId>`): the player's screen, designed at 375x812. The question prompt is echoed at the top, followed by the countdown. The answer controls sit in a thumb zone anchored to the bottom of the screen. At 375x812, every answer control lies wholly within the lower 60 percent of the viewport height and is fully visible without scrolling. That means its top edge is at or below 40 percent of the viewport height from the top. Answer controls are each option button, the estimate slider, each sequence item with its move buttons, and each lock-in button. The standing strip, question echo, countdown and the question's picture sit above that line. The picture, when there is one, is a small thumbnail beside the echo. A long prompt in the echo is clamped to three lines with an ellipsis. The player's standing ("Rank … of … · … pts") sits in a slim strip at the very top. At 768 and 1280 the controller stays a centred column no wider than a large phone.
- **Past nights** (`/host/nights`) and **Night results** (`/host/nights/<roomId>`): the first is a list of ended nights, newest first, each showing deck title, date and the top three. The second shows the final standings table. At 375 the table keeps its three columns and wraps nicknames.

The stage never shows correct-answer data before the reveal. The deck editor is the only screen that shows correct answers ahead of time.

### Public screens and controls (DP-01, DP-05, DP-09, DP-14, DP-16, DP-20, DP-21, DP-26, DP-29, DP-30, DP-37, DP-39, DP-41, DP-42, DP-51, DP-55)

Only the controls and regions below are public. Everything else is free. `<…>` marks a value that varies by record. Shortcuts are single keys with no modifier.

| Screen | Role and accessible name | Visible copy / content |
|---|---|---|
| Join | `textbox "Room PIN"` | six digits, numeric keypad on phones |
| Join | `textbox "Nickname"` | |
| Join | `button "Join the night"` | Join the night |
| Join | `status "Join status"` | copy from Feedback states |
| Join | `link "Quizmaster sign in"` | Quizmaster sign in |
| Sign in | fields labelled `Email` and `Password`, `button "Sign in"`, `link "Create an account"` | |
| Create account | fields labelled `Display name`, `Email`, `Password`, `button "Create account"` | |
| Sign in / Create account | `status "Account status"` | copy from Feedback states |
| Decks | `heading "Your decks"` | Your decks |
| Decks | `textbox "New deck title"`, `button "Create deck"` | |
| Decks | `list "Decks"`; each `listitem` holds `link "<deck title>"`, the text "<question count> questions" and `button "Open room for <deck title>"` | the button reads "Open room" |
| Decks | `link "Past nights"`, `button "Sign out"` | |
| Decks | `status "Decks status"` | copy from Feedback states |
| Deck editor | `textbox "Deck title"`, `button "Save title"` | |
| Deck editor | `group "Question <n>"`, one per question, `<n>` is its 1-based position | |
| Deck editor (in each group) | `combobox "Question type"` with options "Multiple choice", "Estimate", "Sequence"; `textbox "Prompt"`; `spinbutton "Time limit (seconds)"` | |
| Deck editor, multiple choice | `textbox "Option A"` … `textbox "Option D"`; `radio "Correct: A"` … `radio "Correct: D"` | |
| Deck editor, estimate | `spinbutton "Minimum"`, `spinbutton "Maximum"`, `spinbutton "Step"`, `spinbutton "Correct value"`, `spinbutton "Tolerance"`, `textbox "Unit"` | |
| Deck editor, sequence | `textbox "Item 1"` … `textbox "Item 6"`, entered in the correct order | |
| Deck editor (in each group) | `button "Save question"`, `button "Delete question"` | |
| Deck editor (in each group) | file field labelled `Picture for question <n>`; picture state text "No picture" or "Picture attached"; `img "Picture for question <n>"` present only when attached; `button "Remove picture"` only when attached | |
| Deck editor | `button "Add question"` | |
| Deck editor | `status "Editor status"` | copy from Feedback states |
| Stage | `region "Join details"` | the PIN as six digits, "Join at <origin>" where `<origin>` is the page's own origin, and "<connected> of <seated> phones connected" |
| Stage | `list "Players"`, one `listitem` per seat with its nickname | |
| Stage | `region "Question"` | "Question <n> of <total>", the prompt, the picture or "Picture unavailable", and "<answered> of <seated> answered" |
| Stage | `timer "Time left"` | whole seconds left |
| Stage, multiple choice | one answer tile per option (two to four), each labelled "<letter>: <option>" with letters from A in option order, each showing its letter and a tally mark with as many strokes as its position (one for A, up to four for D) | |
| Stage, estimate | the answer area shows the text "Estimate between <min> and <max> <unit>" | |
| Stage, sequence | `list "Items to order"`, one `listitem` per item label in the order the server sent them | |
| Stage control bar | `button "Open question"` (shortcut O), `button "Lock"` (L), `button "Reveal"` (R), `button "Leaderboard"` (B), `button "Podium"` (P), `button "End night"` (E). Each announces its shortcut as a keyboard shortcut. A button is disabled when its step is not legal from the room's state. | the label followed by its key in small caps |
| Stage | `list "Answer split"` during reveal; item formats in Interactions | |
| Stage | `list "Correct order"` during a sequence reveal | items in correct order |
| Stage | `list "Leaderboard"`, top ten, each "<rank>. <nickname> — <score>" | |
| Stage | `list "Podium"`, top three, each "<rank>. <nickname> — <score>" | |
| Stage | `dialog "End the night?"` with the text "Everyone's seat closes and the night moves to Past nights.", `button "Keep going"` and `button "End night"` | |
| Stage | `status "Stage status"`, `status "Connection status"` | copy from Feedback states |
| Phone | `region "Your standing"` | "Rank <rank> of <seated> · <score> pts" |
| Phone | `region "Question echo"` | "Question <n> of <total>" and the prompt |
| Phone | `timer "Time left"` | whole seconds left |
| Phone, multiple choice | `button "A: <option>"` … one per option | letter, tally mark, option text |
| Phone, estimate | `slider "Your estimate"` showing its value and unit, `button "Lock in estimate"` | |
| Phone, sequence | `list "Your order"`; each `listitem` holds the item label, `button "Move <label> up"`, `button "Move <label> down"`; then `button "Lock in order"` | |
| Phone | `status "Answer status"`, `status "Connection status"` | copy from Feedback states |
| Past nights | `list "Past nights"`; each `listitem` holds `link "<deck title> — <date>"` and the top three nicknames | `<date>` is the night's end date in the browser's time zone, written like "27 Oct 2026" |
| Night results | `table "Final standings"` with column headers "Rank", "Nickname", "Score" | |

### Interactions (DP-09, DP-20, DP-21, DP-26, DP-29, DP-37, DP-39, DP-40, DP-48)

- **Joining.** Enter in either join field submits the form. When the join succeeds, the phone stores the rejoin token on the device and moves to the phone controller. When the controller loads, it uses the stored token to rejoin. With no stored token it returns to the join page.
- **Phone lobby and question flow.** The phone shows the lobby, question, locked, reveal, leaderboard, podium and ended views according to the room state the server reports. The countdown shows whole seconds left, rounded up, and refreshes at least four times a second. It is drawn from the server's deadline and the server time (see Business rules), so a phone whose clock is hours wrong still shows the right number to within one second. When the countdown reaches zero the phone shows 0 and keeps its answer controls enabled. It moves to the locked view only when the server reports the lock or refuses an answer as late.
- **Multiple choice.** Tapping or activating a tile sends that answer at once. The chosen tile keeps a chalk outline and the others dim. Every tile is then disabled until the next question.
- **Estimate.** The slider moves by the question's step. Arrow keys move one step, Page Up and Page Down move ten steps, and Home and End jump to the minimum and maximum. Dragging the thumb works the same way. "Lock in estimate" sends the value.
- **Sequence.** Items first appear in the order the server sent them. Pressing and dragging an item moves it. "Move <label> up" and "Move <label> down" move it one place. After a move, focus stays on the same button of the moved item at its new position. When that button becomes disabled at the top or bottom of the list, focus moves to the item's other button. "Lock in order" sends the current order.
- **Phone Tab order.** Standing strip, question echo, the answer controls in tile or list order, then the lock-in button.
- **Stage keyboard.** The shortcuts in the controls table work whichever stage control has focus, and when focus is on the page body. Ctrl, Alt and Meta combinations are ignored, and so is the shortcut of a disabled step. E opens the end-the-night dialog. Every other shortcut sends its host command directly. The stage's Tab order follows the control bar from left to right.
- **End-the-night dialog.** The dialog opens with focus on "Keep going". Tab from the last button wraps to the first, and Shift+Tab from the first wraps to the last. Escape or "Keep going" closes it and returns focus to the control that opened it. "End night" sends the end command. While the dialog is open, stage shortcuts are ignored.
- **Stage resume.** When a signed-in quizmaster reopens `/stage/<roomId>`, the stage shows the room's current state: the open question with its live countdown, the locked question, the reveal at its final heights, or the leaderboard.
- **Answer split items** (`list "Answer split"`). The list is present in every mode. When the 3D room is drawn, it sits under the pillars as their label list. Under reduced motion or without WebGL, it is the still list of bars (DP-41). Each item's text starts as follows:
  - Multiple choice: one item per option in tile order, "<letter>: <option> — <count>".
  - Estimate: one item per bin, "<from> to <to> — <count>", followed by the text "Answer: <answer> <unit> ± <tolerance>" in the question region.
  - Sequence: one item per bucket from 0 to the item count, "<k> in place — <count>".
  - In the still list only, each item's text continues with " (<share>%)". To get `<share>`, divide the item's count by the sum of every count in the list, multiply by 100, and round to the nearest whole number, with halves rounded up. When that sum is 0, every share is 0. For multiple choice and estimates the sum equals the answered count. For sequences it equals the seated count, because seats without an answer sit in bucket 0. The list in 3D mode never shows a share.
  - The item or items that hold the correct answer end with " ✓ Correct answer": a space, the check glyph ✓, a space, then the words. In the still list this comes after the share. In 3D mode it appears when the correct pillar turns brass. For estimates the correct items are the in-tolerance bins. For sequences it is the top bucket.
  - For example, with 12 answers and 3 on the correct option A "Jupiter", the still-list item reads "A: Jupiter — 3 (25%) ✓ Correct answer", and the 3D-mode item reads "A: Jupiter — 3 ✓ Correct answer".
- **Deck editor uploads.** Choosing a file starts the upload at once. The picture area holds no thumbnail and no local preview until the server reports the picture attached. Then it shows the picture from the server's preview link.
- **Phone standing.** The standing strip updates at each reveal and on rejoin. Its seated count updates whenever a player joins.

### Visual design (DP-28, DP-43, DP-60)

- **Colour roles.** Every surface sits on a bottle-green near-black ground. Text, numerals and tile outlines are a warm chalk off-white. A single warm brass is reserved for the correct answer at reveal and for the podium, and appears nowhere else. A muted slate green-grey is used for dimmed options, secondary text, borders and disabled controls. A soft coral marks lateness only: the last five seconds of a countdown, the too-late message and refused-late states.
- **Type.** Fraunces, a soft high-contrast serif, carries display text: the question band, the PIN, every count, score and rank. Its numerals are drawn large and slightly rough, like chalk tallies. Atkinson Hyperlegible carries all body text and controls. Each heading step is about a third larger than the one below it. All numerals use tabular figures, so counts and scores never jitter as they change.
- **Density and composition.** The layout is airy, with generous space between groups. The stage is one full-bleed 3D room. The question sits in a wide-measure serif band across the upper third. Answer tiles, two to four of them, are told apart by letter, by a tally mark of one to four strokes, and by position, never by colour alone. The phone controller is a bottom-anchored thumb zone with the question echoed above it.
- **Touch size and contrast.** On the phone controller every answer control is at least 48 px in both directions. Elsewhere every control is at least 44 px. All text and controls meet WCAG 2.2 AA contrast against the ground, and every focused control shows a visible chalk focus ring.

### Motion and effects (DP-26, DP-39, DP-40, DP-41, DP-42)

- **Meaning of motion.** Phone views cross-fade between room states in about a quarter of a second. A pressed tile or button darkens within a tenth of a second. The countdown numeral simply changes. No element moves for decoration. The 3D room holds still between beats: no idle drift, no particles, no looping glow. Nothing moves in response to pointer movement.
- **Tally Pour (the reveal).** When the reveal arrives, one extruded pillar per option (per bin for estimates, per bucket for sequences) rises from the floor of the stage in tile order. Pillar starts are 90 milliseconds apart: the first starts at once, the second 90 ms later, the third 180 ms later, and each further pillar 90 ms after the one before it. Each pillar rises like a heavy damped spring, quick at first and easing into place with no bounce and no overshoot. It settles within 600 milliseconds of its own start. Its final height is its count divided by the largest count, times the full pillar height. When every count is zero, every pillar stays flat. A chalk count label rides on top of each pillar. It starts at 0 and counts up in whole numbers in step with the pillar, never passing the final count, and lands on the server's count as the pillar settles. After the last pillar settles, the correct pillar turns brass and the others dim to slate. At the same moment the correct item gains its check glyph and "Correct answer". For an estimate the bins are drawn along the floor, and a lit floor plate sits under the bins the tolerance covers. For a sequence the pillars are score buckets from 0 to the item count.
- **Replayed reveal.** A reveal shown after a stage reload, a stage reconnect or a resumed stage appears at its final heights and counts at once, with the brass marking in place.
- **Podium.** At the podium step the camera dollies from the wide stage to the podium framing over 1.4 seconds. It starts briskly and eases gently into place. Three plinths stand in brass, with the nicknames and scores of the top three in chalk. The `list "Podium"` labels appear when the camera arrives.
- **Reduced motion and no WebGL.** When the reduced-motion setting is on, or WebGL is unavailable, the stage draws no 3D room. The reveal becomes a still list of horizontal bars, one per item in the same order, each with its final count and share. The correct item is marked by the check glyph and "Correct answer". Nothing animates, and the reveal shows its end state at once. The podium becomes a still ranked list of the top three with their scores. Phone cross-fades become instant changes.

### Feedback states (DP-09, DP-10, DP-14, DP-26, DP-30, DP-51)

Every async action shows its pending, success and error states visibly, and announces them through the named live region. Field errors appear under their field, with the server's message for that field, and are linked to the field as its description.

| Action | Region | Pending | Success | Errors and outage |
|---|---|---|---|---|
| Sign in | `status "Account status"` | "Signing in…" | goes to Decks | `invalid_credentials`: "That email and password don't match." |
| Create account | `status "Account status"` | "Creating your account…" | goes to Decks | `email_taken`: "An account already uses that email."; field errors under fields |
| Create deck | `status "Decks status"` | "Creating deck…" | "Deck created" | field error under "New deck title" |
| Open room | `status "Decks status"` | "Opening room…" | goes to the stage | empty deck: "Add a question before opening a room." |
| Save title or question | `status "Editor status"` | "Saving…" | "Saved" | `version_conflict`: "A newer version was saved elsewhere. Reload to see it."; field errors under fields |
| Upload picture | `status "Editor status"` | "Uploading picture…" | "Picture attached" | `unsupported_type`: "That file isn't a PNG, JPEG or WebP picture."; `image_too_large`: "That picture is too large for a question."; `empty_file`: "That file is empty."; `image_store_unavailable`: "Picture storage is down. The question is saved without a picture." |
| Remove picture | `status "Editor status"` | "Removing picture…" | "Picture removed" | `image_store_unavailable` copy as above |
| Join | `status "Join status"` | "Joining…" | goes to the controller | `room_not_found`: "No live room has that PIN."; `nickname_taken`: "That nickname is taken in this room."; `room_full`: "This room is full."; `room_closed`: "This night has reached the podium. Joining is closed." |
| Phone lobby | `status "Answer status"` | | "You're in, <nickname>. Watch the big screen." | |
| Send answer | `status "Answer status"` | "Sending…" | "Locked in" | `window_closed` with negative `remainingMs`: "Too late — the server got it <late> ms after the bell.", where `<late>` is the absolute value of `remainingMs`; `window_closed` with zero or positive `remainingMs`: "Too late — the quizmaster locked this question."; `already_answered`: "Already answered — your first answer stands." |
| Phone state changes (each replaces the region's text) | `status "Answer status"` | | `question_open`: "Question <n> is open"; `locked`: "Time's up"; `reveal`: "Answers are in"; `leaderboard`: "Leaderboard is on the big screen"; `podium`: "Podium time — watch the big screen"; `ended`: the `room_ended` copy on this row | `client_superseded`: "This seat is now open on another screen."; `room_ended`: "The night is over. Thanks for playing." |
| Host command | `status "Stage status"` | | "Question <n> open", "Locked", "Revealed", "Leaderboard", "Podium", "Night ended" | `illegal_transition` or `no_more_questions`: "That step isn't available right now." |
| Idle end | `status "Stage status"` | | "Night ended because the room sat empty." | |
| Live link (stage and phone) | `status "Connection status"` | "Reconnecting…" | "Back on the live link" | backup link: "Backup link: live updates are down. Answers still count." |
| Picture in a question | the picture slot on stage and phone | | the picture | "Picture unavailable" when the picture fails to load; the question plays on |
| Past nights | `list "Past nights"` area | "Loading nights…" | the list | no nights: "No nights yet." |

"Locked in" means the server has recorded the answer. It stays true on the backup link, because answers are recorded in Postgres either way.

## Backend

### API (DP-01, DP-02, DP-03, DP-04, DP-06, DP-07, DP-08, DP-10, DP-12, DP-14, DP-17, DP-23, DP-24, DP-27, DP-38, DP-44, DP-45, DP-49, DP-54)

**Conventions.**
- JSON requests and responses use `application/json; charset=utf-8`. Ids (`deckId`, `questionId`, `roomId`, `seatId`) are UUID strings. `clientId` and `rejoinToken` are opaque random strings of at least 32 characters. Times are integer epoch milliseconds from the server clock.
- Every error body has the shape `{"error":"<code>"}`, with any extra fields named on its row. Validation failures are `422 {"error":"validation_failed","fields":{"<field>":"<message>"}}`.
- Host endpoints need the `lastbell_session` cookie. Without a valid session they answer `401 {"error":"not_signed_in"}`.
- Player endpoints take a `clientId`. An unknown client answers `401 {"error":"invalid_client"}`. A retired client answers `409 {"error":"client_superseded"}`. A client of an ended room answers `410 {"error":"room_ended"}`.

**Error precedence, the same for every endpoint:**
1. Cross-origin and body-size refusals from Server boundary.
2. 401 (not signed in, invalid credentials, invalid client or rejoin token).
3. 404 `{"error":"not_found"}` for an unknown resource or one owned by another quizmaster.
4. State conflicts: 409, 410 and 412.
5. Picture content refusals: 413 and 415.
6. 422 validation.

Endpoint rows below list only their own extra errors. Two rows refine this order for their own checks, and say so: join (format checked before the room lookup) and picture upload (the check order in Business rules).

**Accounts.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| POST `/api/auth/signup` | `{"email","password","displayName"}` | `201 {"quizmaster":{"id","email","displayName"}}` and sets the session cookie | `409 {"error":"email_taken"}` (email compared ignoring case); 422 when email is not an address, password is shorter than 10 characters, or displayName is not 1 to 60 characters after trimming |
| POST `/api/auth/login` | `{"email","password"}` | `200 {"quizmaster":{…}}` and sets the session cookie | `401 {"error":"invalid_credentials"}` |
| POST `/api/auth/logout` | none | `204`; clears the cookie and invalidates the session | |
| GET `/api/auth/me` | | `200 {"quizmaster":{…}}` | |

The session cookie is HttpOnly and SameSite=Lax and lasts 30 days.

**Decks and questions** (host).

Deck shape: `{"id","title","version","questions":[Question]}`. Question shape: `{"id","position","version","type","prompt","timeLimitSeconds","image"}` plus the type's fields:
- multiple choice: `"options"`, `"correctIndex"`
- estimate: `"min"`, `"max"`, `"step"`, `"answer"`, `"tolerance"`, `"unit"`
- sequence: `"items"`, in correct order

`image` is `null` or `{"status":"attached","contentType","bytes","previewUrl"}`.

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET `/api/decks` | | `200 {"decks":[{"id","title","version","questionCount","updatedAt"}]}`, most recently updated first | |
| POST `/api/decks` | `{"title"}` | `201 {"deck":Deck}` | 422 |
| GET `/api/decks/{deckId}` | | `200 {"deck":Deck}` | |
| PATCH `/api/decks/{deckId}` | `{"title","version"}` | `200 {"deck":Deck}` with version increased by one | `412 {"error":"version_conflict","currentVersion":<n>}`; 422 |
| POST `/api/decks/{deckId}/questions` | question fields without id, position and version | `201 {"question":Question}`, appended at the end | `409 {"error":"deck_full"}`; 422 |
| PUT `/api/decks/{deckId}/questions/{questionId}` | question fields plus `"version"` | `200 {"question":Question}` | `412 {"error":"version_conflict","currentVersion":<n>}`; 422 |
| DELETE `/api/decks/{deckId}/questions/{questionId}` | | `204`; later questions move up one position | |
| POST `/api/decks/{deckId}/questions/{questionId}/image` | `multipart/form-data` with one file field `image` | `201 {"question":Question}` with `image.status` `"attached"` | `422 {"error":"empty_file"}`; `413 {"error":"image_too_large"}`; `415 {"error":"unsupported_type"}`; `503 {"error":"image_store_unavailable"}`; checked in that order (Business rules) |
| DELETE `/api/decks/{deckId}/questions/{questionId}/image` | | `204` | `503 {"error":"image_store_unavailable"}` |

**Rooms** (host).

HostRoom shape: `{"id","pin","state","deckTitle","questionCount","questionIndex","question","answered","seated","connected","players":[{"seatId","nickname","score","rank","connected"}],"reveal","standings","transport","lastEventId"}`.
- `questionIndex` is 1-based and `null` in the lobby.
- `question` is the PlayerQuestion below or `null`, and `reveal` is a Reveal or `null`. Both follow the state table after the PlayerView shape.
- `standings` is the Standings list.
- `transport` is `"live"` or `"backup"`.

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| POST `/api/rooms` | `{"deckId"}` | `201 {"room":HostRoom}` in state `lobby` | `422 {"error":"validation_failed","fields":{"deckId":"Deck has no questions"}}` |
| GET `/api/rooms/{roomId}/host` | | `200 {"room":HostRoom}` (also for ended rooms) | |
| POST `/api/rooms/{roomId}/commands` | `{"command"}`: one of `open_question`, `lock`, `reveal`, `show_leaderboard`, `show_podium`, `end` | `200 {"room":HostRoom}` | `409 {"error":"illegal_transition","state":"<current state>","command":"<command>"}`; `409 {"error":"no_more_questions"}`; 422 for an unknown command |

**Players.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET `/api/time` | | `200 {"serverNow":<epoch ms>}` | |
| POST `/api/rooms/join` | `{"pin","nickname"}` | `201 {"roomId","seatId","nickname","rejoinToken","clientId"}` | `404 {"error":"room_not_found"}` when no live room has the PIN; `409 {"error":"room_closed"}` in podium; `409 {"error":"room_full"}`; `409 {"error":"nickname_taken"}`; 422 when pin is not exactly six digits or the nickname breaks the nickname rule. This format check runs before the room lookup and every 409, so a malformed PIN answers 422 and never `room_not_found` |
| POST `/api/rooms/rejoin` | `{"rejoinToken"}` | `200 {"roomId","seatId","nickname","score","streak","clientId"}` | `401 {"error":"invalid_rejoin_token"}`; `410 {"error":"room_ended"}` |
| GET `/api/rooms/{roomId}/state?clientId=<clientId>` | | `200` PlayerView | |
| POST `/api/rooms/{roomId}/answers` | `{"clientId","questionIndex"}` plus exactly one of `"choice"` (option index), `"estimate"` (number) or `"order"` (array of item ids) | `201 {"answer":{"questionIndex","latencyMs","remainingMs"}}` | `409 {"error":"window_closed","remainingMs":<integer>}`; `409 {"error":"question_not_open","state":"<current state>"}`; `409 {"error":"already_answered"}`; 422 when the field does not match the question type, choice is out of range, estimate is outside min to max, or order is not a permutation of the item ids |

PlayerView shape: `{"state","questionCount","questionIndex","question","reveal","standings","you":{"seatId","nickname","score","streak","rank","answeredCurrent"},"lastEventId"}`. PlayerView and HostRoom carry `question` and `reveal` by room state as follows. The table is the same for both views. A fresh link is one issued on that read.

| Room state | `question` | `question.imageUrl` | `reveal` |
|---|---|---|---|
| `lobby` | `null` | n/a | `null` |
| `question_open` | the current question | fresh link when it has a picture, else `null` | `null` |
| `locked` | the current question | fresh link when it has a picture, else `null` | `null` |
| `reveal` | the current question | fresh link when it has a picture, else `null` | that question's Reveal |
| `leaderboard` | `null` | n/a | the Reveal of the question just revealed |
| `podium` | `null` | n/a | `null` |
| `ended` | `null` | n/a | `null` |

**Live events.**

| Method and path | Success | Extra errors |
|---|---|---|
| GET `/api/rooms/{roomId}/stream?clientId=<clientId>` (phone), or `?role=stage` with the session cookie (stage) | `200 text/event-stream`. Each message has `id: <eventId>`, `event: <type>`, `data: <JSON>`. A `Last-Event-ID` request header replays every event with a greater id before live events. A comment line is sent every 15 seconds to keep the line open. | `503 {"error":"live_unavailable"}` while Valkey is unreachable |
| GET `/api/rooms/{roomId}/poll?after=<eventId>&clientId=<clientId>` (or `role=stage`) | `200 {"events":[{"id","type","data"}]}`. Returns at once when events with a greater id exist. Otherwise it waits up to 25 seconds and returns whatever arrived, possibly an empty list. Works whether or not Valkey is up. | |

The stream and poll carry exactly these event types. They are the same for the stage and every phone:
- `player_joined` `{"seatId","nickname","seated"}`
- `presence` `{"seated","connected","players":[{"seatId","nickname","connected"}]}`
- `question_open` PlayerQuestion
- `answer_count` `{"questionIndex","answered","seated"}`
- `locked` `{"questionIndex","reason"}`, where reason is `"host"` or `"deadline"`
- `reveal` Reveal
- `leaderboard` `{"standings"}`
- `podium` `{"top","standings"}`, where `top` is the first three standings, or fewer
- `ended` `{"reason"}`, where reason is `"host"` or `"idle"`

A retired client's stream also receives one `superseded` message with no id and is then closed. That message is never replayed.

**Published field lists.** Player-facing payloads carry exactly these keys, and no others:
- **PlayerQuestion** has `index`, `type`, `prompt`, `timeLimitMs`, `opensAt`, `deadlineAt`, `imageUrl` (string or `null`), plus:
  - multiple choice: `options` (array of option strings in tile order)
  - estimate: `min`, `max`, `step`, `unit`
  - sequence: `items`, an array of `{"id","label"}` in server-shuffled order, where each `id` is an opaque random string that reveals nothing about the item's position
- **Reveal** has `questionIndex`, `type`, `answered`, `seated`, `results` (array of `{"seatId","points","outcome","streak"}`, where outcome is `"correct"`, `"partial"`, `"wrong"` or `"none"`), plus:
  - multiple choice: `counts` (one per option in tile order) and `correctIndex`
  - estimate: `bins` (eight `{"from","to","count"}`), `answer`, `tolerance`, `inBandBins` (bin indexes)
  - sequence: `buckets` (counts for 0 up to the item count) and `correctOrder` (item ids)
- **Standings** is an array of `{"rank","seatId","nickname","score","streak"}` covering every seat, in rank order.

**Nights** (host).

| Method and path | Success |
|---|---|
| GET `/api/nights` | `200 {"nights":[{"roomId","deckTitle","endedAt","seated","podium":[{"rank","nickname","score"}]}]}`, newest end first, ended rooms only |
| GET `/api/nights/{roomId}` | `200 {"night":{"roomId","deckTitle","endedAt","standings":[{"rank","nickname","score"}]}}`; a room that has not ended answers 404 |

### Business rules (DP-03, DP-04, DP-06, DP-07, DP-08, DP-11, DP-12, DP-13, DP-15, DP-17, DP-18, DP-19, DP-23, DP-24, DP-26, DP-31, DP-32, DP-33, DP-34, DP-35, DP-36, DP-38, DP-44, DP-45, DP-46, DP-47, DP-49, DP-50, DP-52, DP-53)

**Question rules.**
- A deck title is 1 to 80 characters after trimming. A deck holds at most 50 questions.
- Every question has a prompt of 1 to 200 characters and a whole-number time limit from 5 to 120 seconds, both ends allowed.
- **Multiple choice** has 2 to 4 options of 1 to 80 characters each, and a `correctIndex` that points at one of them.
- **Estimate** needs `min` < `max`, `step` > 0, `answer` within min to max, `tolerance` from 0 to (max − min), and a `unit` of 0 to 20 characters.
- **Sequence** has 3 to 6 items of 1 to 80 characters each, unique ignoring case, saved in correct order.

**Versions.** Every deck and question starts at version 1. Each successful title save, question save, picture attach or picture removal raises that record's version by one. A save that carries any version other than the current one is refused with 412 and changes nothing.

**Pictures.**
- The server judges the type from the file's leading bytes alone and ignores the file name and the declared content type. It accepts only PNG, JPEG and WebP. Anything else, including SVG, GIF, HTML or text, is refused as `unsupported_type`.
- The file limit is 2,000,000 bytes. Exactly 2,000,000 bytes is allowed, and 2,000,001 is refused as `image_too_large`. A zero-byte file is refused as `empty_file`.
- After the Server boundary body limit, upload checks run in this order, and the first failure answers:
  1. A missing or zero-byte `image` field gives `empty_file` (422).
  2. A file over 2,000,000 bytes gives `image_too_large` (413).
  3. A file whose leading bytes are not PNG, JPEG or WebP gives `unsupported_type` (415).
  4. Only then is MinIO contacted, so `image_store_unavailable` (503) comes last.

  For example, a 2,000,001-byte text file is `image_too_large`.
- The uploaded file name is discarded.
- The question's `image` is set only after the object has been written and a stat of it in MinIO returns its size and type. The 201 response is sent after that. A failed write or stat leaves `image` unchanged.

**Picture links.**
- `previewUrl` and `imageUrl` are presigned links that work for `IMAGE_URL_TTL_SECONDS` seconds from issue (default 120). After that, MinIO refuses them.
- Every `open_question` issues new links for that question, and so does every PlayerView or HostRoom read whose `question` is set (see the state table in API).
- A replayed `question_open` event carries the link it was first sent with.

**Rooms and PINs.**
- Opening a room snapshots the deck's questions, including their versions and picture keys. Later edits to the deck do not change the room.
- A PIN is six digits and may start with 0. No two rooms that have not ended share a PIN, and a PIN may be reused once its room has ended.
- A room seats at most 200 players. The 201st join is `room_full`.
- Players may join in any state from `lobby` to `leaderboard`. A late joiner may answer the question that is open, if its window is still open.
- **Nicknames:** 1 to 20 characters after trimming, with no control characters, unique within the room ignoring case. Of simultaneous joins with the same nickname, exactly one gets 201 and the others get `nickname_taken`.

**Room state machine.** These are the only legal commands:

| Command | From | To |
|---|---|---|
| `open_question` | `lobby`, or `leaderboard` while questions remain | `question_open` (the next question) |
| `lock` | `question_open` | `locked` |
| `reveal` | `locked` | `reveal` |
| `show_leaderboard` | `reveal` | `leaderboard` |
| `show_podium` | `leaderboard` (any time, which ends the night early) | `podium` |
| `end` | `podium` | `ended` |

- `open_question` from `leaderboard` after the last question is refused with `no_more_questions`. Every other command from any other state, including a repeat of the command just applied, is refused with `illegal_transition` and changes nothing.
- Of simultaneous identical commands, exactly one succeeds. The room's transition log in Postgres holds one row per applied transition.
- The server may also make two transitions itself: auto-lock (`question_open` to `locked`) and idle end (any state to `ended`).

**Answer window.**
- `open_question` sets `opensAt` from the server clock and `deadlineAt` = `opensAt` + the time limit.
- An answer counts only if the server receives it at or before `deadlineAt`. One millisecond later, it is refused.
- `latencyMs` = receipt − `opensAt`. `remainingMs` = `deadlineAt` − receipt. The server measures both with its own monotonic clock.
- An answer for the current question that arrives after its deadline, or after it was locked, gets `window_closed` with that `remainingMs`. This can be zero or positive when the quizmaster locked early.
- An answer naming any other question index gets `question_not_open`.
- The server locks a question within one second after `deadlineAt`, with reason `deadline`, whether or not any stage is connected.
- Each seat records at most one answer per question. Of simultaneous answers from one seat, exactly one gets 201 and the others get `already_answered`.
- Answers carry no correctness or points until the reveal.

**Server time on clients.** Phones and the stage estimate their clock offset from `GET /api/time` round trips. They draw countdowns from `deadlineAt` and that offset. They never decide the lock, a late answer, or the room state from their own clock.

**Scoring.** Scores are worked out at reveal for every seat, from the question, the answer and `latencyMs` only. `window` is the time limit in milliseconds.
- `base` = 1000 − floor(500 × latencyMs / window). This gives 1000 at the opening and 500 at the deadline.
- **Fully correct** means the right option, an estimate within tolerance (|estimate − answer| ≤ tolerance, edges included), or a sequence with every item in place. The new streak is the previous streak + 1, and points = floor(base × (10 + min(streak − 1, 5)) / 10). The multiplier is ×1.0 on a first correct answer, ×1.1 on the second in a row, and up to ×1.5 from the sixth in a row on.
- **Sequence partial.** Map each submitted item to its correct position, and let k be the length of the longest strictly increasing subsequence of those positions. When k is below the item count n, points = floor(base × k / n), the outcome is `partial` and the streak resets to 0.
- **Wrong or no answer:** 0 points and the streak resets to 0.
- For example, with a 20-second window and an answer received 4,000 ms after opening, base is 900. On a third correct answer in a row that earns 1080. With a 30-second window and 6,000 ms, base is 900, and a 4-item sequence with k = 3 earns 675.

**Ranking.**
- Seats rank by total score, highest first. Ties go to the lower cumulative response time, then to the earlier join.
- Cumulative response time is the sum of `latencyMs` over the seat's recorded answers, plus the full window for each question opened after the seat joined that it did not answer.
- Ranks run 1 to N with no shared ranks.

**Reveal numbers.**
- Multiple-choice `counts` count recorded answers per option.
- Estimate bins split min to max into eight equal-width bins. Each bin includes its lower edge, and the last bin also includes max. `inBandBins` are the bins that overlap the closed band answer ± tolerance.
- Sequence `buckets[k]` counts seats whose k (as above) equals that bucket. Seats with no answer go in bucket 0.

**Leaderboard reconcile.** At every reveal the server writes each seat's total score to Postgres `standings` and to the Valkey leaderboard set. After the reveal returns, the two agree for every seat.

**Events and replay.**
- Every room state change writes exactly one event. Every recorded answer writes one `answer_count`. Every join writes one `player_joined`. Every change in connected count writes one `presence`.
- Event ids per room start at 1 and strictly increase, including across Valkey outages.
- A reconnect with a last event id receives every event with a greater id, however many, in order and with no duplicates. Events older than the Valkey replay buffer come from the Postgres event log.

**Rejoin and clients.**
- A rejoin token stays valid until its room ends and restores exactly its own seat, nickname, score and streak (the score and streak as of the last reveal).
- Each join or rejoin issues a new client id for the seat and retires the previous one. The retired client's open stream receives `superseded` and is closed. Its later requests get `client_superseded`.
- Rejoins on one token are applied one at a time, so of two racing tabs only the client issued last stays valid. Its stream is then the seat's only stream.

**Connected clients.**
- A client counts as connected while its stream is open. On the backup link, it counts as connected if it has polled within the last 30 seconds.
- Closing a stream removes its client from the room's connected set within two seconds and frees its subscription.
- After ten streams are opened and aborted, within five seconds no app database session is active or idle in a transaction, and the next page request is served.

**Ending.**
- `end` broadcasts `ended`, closes every stream, and frees the PIN. From then on, rejoin tokens get 410 `room_ended` and so do client requests.
- A room whose connected count has been zero for `ROOM_IDLE_SECONDS` seconds (default 1800) ends itself with reason `idle` within two seconds after that limit. A freshly opened room with no stage connected counts as empty from the moment it opens.
- An ended room becomes a night in the results list with its final standings.

**Live service outage (Valkey).**
- While Valkey is unreachable, at boot or mid-night, streams answer `live_unavailable` and any open streams are closed. Clients then poll from their last event id.
- Commands, answers, auto-lock, reveals and standings keep working from Postgres alone.
- The server retries Valkey at least every five seconds, and clients retry the stream every five seconds. Within ten seconds of Valkey's return, streams answer 200 again, clients switch back, and the leaderboard set is rebuilt from Postgres standings. No restart is needed.

### Services (DP-08, DP-10, DP-11, DP-25, DP-36, DP-47, DP-49, DP-50)

- **Postgres** is the durable source of truth: quizmaster accounts and sessions, decks, questions and their versions, rooms and their transition log, seats with rejoin-token hashes (never the raw token), answers, standings, nights, and the room event log used for backup-link polling and replay. Apply the schema and the seed idempotently every time the app serves. Two tables are published, unquoted, in the public schema. Every other table is free.
  - `answers`: one row per recorded answer, with columns `room_id`, `seat_id`, `question_index` (1-based), `latency_ms`, `points` (null until that question's reveal, then the points earned), `received_at`.
  - `standings`: one row per seat, with columns `room_id`, `seat_id`, `nickname`, `score`, `streak`, `cumulative_ms`, `rank`. Rewritten at every reveal.
- **Valkey** carries live room state and deadlines, the event-id counter, pub/sub fan-out with one subscription per open stream, the leaderboard and a capped replay buffer of the last 500 events per room. Published keys:
  - `lastbell:room:<roomId>:leaderboard`: a sorted set whose members are seat ids, scored by total score.
  - `lastbell:room:<roomId>:clients`: a set of the client ids that have an open stream, stage streams included.

  Every room key expires one hour after its room ends. Outage behaviour is the live service outage in Business rules, with the `live_unavailable` response from API and the backup-link copy from Feedback states.
- **MinIO** stores question pictures in the bucket named by `S3_BUCKET`, under the key `questions/<questionId>/<sha256 of the bytes, lowercase hex>.<png|jpg|webp>`, with the content type of the sniffed format. Pictures are served only through presigned GETs, as described under picture links in Business rules. Objects are not deleted, because past nights may refer to them. While MinIO is unreachable, uploads and removals answer `image_store_unavailable` (API) with its copy (Feedback states). Decks, rooms and nights keep working, and a picture that fails to load shows "Picture unavailable".

### Seed data (DP-02, DP-05, DP-12, DP-54)

Every seeded person, nickname and venue is invented. The seed is applied at serve if missing and is never duplicated.

- **Quizmaster Ines Talbot**: email `ines@corkline.example`, password `tally-pour-2026`, display name "Ines Talbot".
  - Deck "Tuesday at The Gilded Tap", version 1, with four questions, each at version 1 and without a picture:
    1. Multiple choice, 20 seconds: "Which planet has the shortest day?" Options: Jupiter, Mars, Earth, Venus. The correct option is A (Jupiter).
    2. Estimate, 25 seconds: "How many keys does a standard piano have?" min 40, max 120, step 1, answer 88, tolerance 4, unit "keys".
    3. Sequence, 30 seconds: "Put these inventions in order, earliest first." Items in correct order: Printing press, Steam engine, Telephone, World Wide Web.
    4. Multiple choice, 15 seconds: "What is the chemical symbol for gold?" Options: Ag, Au, Gd, Go. The correct option is B (Au).
  - Deck "Practice deck", version 1, with no questions.
  - One ended night from "Tuesday at The Gilded Tap", ended 2026-10-27 at 21:40 UTC, with 5 seats and these final standings: 1 Quizzly Bears 3120; 2 Les Quizerables 2980; 3 Pint Sized 2410; 4 Agatha Quiztie 1875; 5 The Lone Ranger 920.
- **Quizmaster Rowan Pike**: email `rowan@corkline.example`, password `second-round-77`, display name "Rowan Pike". Deck "Thursday Mix" with one multiple-choice question, 20 seconds: "How many sides does a hexagon have?" Options: 5, 6, 7, 8. The correct option is B (6).
- No live rooms exist at start.

## Technical requirements

### Deployment (DP-56)

- The runtime is Node.js 22 with npm. Write the app in TypeScript.
- `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, for example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```
- The server binds `0.0.0.0` on the port in `APP_PUBLIC_PORT`, defaulting to 4173.
- `GET /api/health` answers `200 {"status":"ok"}` as soon as the server listens, including when Valkey or MinIO is unreachable.
- The app may be started several times at once with different `DATABASE_URL`, `S3_BUCKET`, `VALKEY_URL`, `S3_ENDPOINT` and timer settings. Each instance creates its own schema and seed in its own database. Room keys in a shared Valkey never collide, because they are keyed by room id.

### Configuration and secrets (DP-57)

Read these at start from the environment, never hard-code them, and never send them to the browser, except as Server boundary allows inside presigned picture links:
- `DATABASE_URL`
- `VALKEY_URL`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `APP_PUBLIC_PORT`
- `ROOM_IDLE_SECONDS` and `IMAGE_URL_TTL_SECONDS` (defaults in Business rules)

Presigned links use `S3_ENDPOINT` as given.

### Server boundary (DP-49, DP-58)

- The app is same-origin only and sends no cross-origin headers. A state-changing request whose `Origin` header names another origin is refused with `403 {"error":"cross_origin"}`.
- JSON bodies are limited to 64,000 bytes, and exactly 64,000 is allowed. A picture upload body is limited to 2,100,000 bytes. A larger body is refused with `413 {"error":"payload_too_large"}` before it is read further.
- The server serves only the built client assets and the API. Requests for source files, source maps of server code, `.env` files, `run.json`, `package.json`, the lockfile or `node_modules` answer 404. Responses and client assets never contain `DATABASE_URL`, `VALKEY_URL`, `S3_SECRET_ACCESS_KEY`, any password, or any Postgres or Valkey host. The one exception is the presigned picture links (`previewUrl` and `imageUrl`). Each is a URL on `S3_ENDPOINT` as given, with the path `/<S3_BUCKET>/<object key>` and the standard signature query parameters. These carry `S3_ACCESS_KEY_ID` inside the credential parameter, along with the signing date, lifetime, signed headers and signature. Outside those links, the `S3_ENDPOINT` host and `S3_ACCESS_KEY_ID` never appear in any response or client asset. The secret key never appears anywhere, links included.
- If Valkey or MinIO is unreachable at boot, the app still starts and runs as described for their outages. If Postgres is unreachable at boot, the server still listens and answers health. Every other endpoint answers `503 {"error":"database_unavailable"}` until Postgres is reachable, with no restart.

### Browser support and performance (DP-26, DP-59)

- Support current Chromium, Firefox and Safari on desktop, and Chromium and Safari on phones. Grading runs in Chromium at 375x812, 768x1024 and 1280x800.
- The stage and the phone controller are usable within three seconds of loading.
- A host command or recorded answer reaches every connected client within one second on the live link, and within two seconds on the backup link.
- A tap on an answer shows "Sending…" within a tenth of a second.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, and the app runs from those commands alone.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package, meaning the production dependency tree from `npm ls --omit=dev --all --json`, with its name, version and licence, plus the two fonts.
- IF-03: Every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) is licensed MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or BlueOak-1.0.0, and the fonts are under the SIL Open Font License 1.1.
- IF-04: The app stores data only in the provided Postgres, Valkey and MinIO. It uses no other datastore, embedded database or data files written at runtime.
- IF-05: Fraunces and Atkinson Hyperlegible are served from the app itself, and no page loads fonts, scripts or styles from another origin.
- IF-06: `package-lock.json` is committed and `install` uses it.
- IF-07: The provided service configuration for Postgres, Valkey and MinIO (the dev compose files and their seed jobs) is left unchanged.

## Engineering standards

- The TypeScript compiles in strict mode. Untyped input (request bodies, events, service replies) is parsed and narrowed where it enters, and `any` does not appear.
- Names in the code use the domain terms of this brief: quizmaster, deck, question, room, seat, client, rejoin token, deadline, reveal, standings, streak, backup link.
- Each domain rule is decided in exactly one place: the room transition table, the answer-window check, the score formula, the rank order, the player payload projection and the picture sniffing.
- There is no abstraction with a single implementation: no interface with one class, and no wrapper with a single caller that only forwards.
- There is no dead, commented-out or unreachable code, and no defensive branch for a state the room machine cannot reach.
- Every error response is built in one place with the single error shape from API.
- There are no features beyond this brief.
