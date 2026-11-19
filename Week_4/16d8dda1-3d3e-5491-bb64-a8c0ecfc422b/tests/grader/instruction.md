# Corbel & Slate Slatehall

Slatehall is a live 3D classroom in the browser for independent teachers of adult learners: evening-course tutors, adjuncts running a seminar on the side, and freelance trainers selling professional workshops. A teacher arranges a classroom from ready-made pieces, loads each week's lesson as slide images and 3D models, and runs the session live. During the session they work with seats, the board, raised hands, polls, breakout tables, spotlight and a room lock. Afterwards they read an attendance sheet and a session summary. Learners join with a class code and a display name, take a seat, follow the board, take part, and review the slides after class. Slatehall is written in TypeScript and uses three backing services and no others. Postgres is the durable record. MinIO holds the lesson files. Valkey is the live bus that keeps two app instances in step. Teachers have email-and-password accounts with no email confirmation and no mail of any kind. Learners have no password. Out of scope: voice and video, screen sharing, whiteboard drawing, sticky notes on the canvas, grading and gradebooks, course catalogues, booking, payments, AI features, learning-platform integrations, outside sign-in, friends, communities, avatar uploads, proximity chat, games and scores. Every user is an adult. There are no pupils, minors, parents or schools anywhere in the product.

## Problem and users

Independent teachers of adults teach live online in general meeting tools that were not built for teaching. Breakout rooms close on a countdown that learners miss, and the "minutes left" notice is a small toast nobody sees. The teacher can be in only one room at a time. Raised hands lose their order. A poll needs a separate app. Attendance is pieced together by hand from join logs, so nobody can say who was late or who left early. The slides end up as a separate email attachment. Every week breakouts run over, the end of the session is spent getting people back, and learners who pay full evening-course fees drift into watching. Afterwards the teacher re-uploads decks and re-types attendance for the course provider.

- **Teacher** (weekly): builds a classroom once, loads each week's lesson, and runs the session live with slides, hands, polls, breakouts, spotlight and lock. Afterwards they read the attendance sheet and the session summary. A teacher can add other teacher accounts as **co-teachers** who help run a class.
- **Learner** (weekly): joins by class code, takes a seat, follows the board, raises a hand, answers polls, and works and chats at a breakout table. After class they review the slides.

## Journeys

1. **Arranging a classroom.** Start state: a teacher has just signed up and created a class. They open the room editor, set the grid size, place the board, tables and seats by keyboard (arrow keys to a cell, Enter to place, Delete to remove) or by pointer, and save. A wrong placement shows the server's refusal in the editor's alert. End state: `Room saved.` shows and the class page reflects the saved room.
2. **Joining and taking a seat.** Start state: a live session in a class with a saved room, and the teacher watching on one app instance. A learner on the other instance enters the class code and a name, lands in the classroom, moves the seat cursor with the arrow keys and presses Enter. End state: the learner sits in that seat on their own screen and on the teacher's screen within one second. If two learners press the same empty seat at once, exactly one gets it and the other hears the seat-taken notice.
3. **Teaching from the board.** Start state: a ready lesson and a live session. The teacher presses PageDown and PageUp, and every learner's board follows and announces the slide. A learner who joins mid-class sees the current slide straight away. Learners raise hands with H, and the teacher takes them in order with T. End state: the hand queue reads `No hands raised.` once everyone has been taken.
4. **Preparing a lesson.** Start state: a class with an empty lesson. The teacher adds slide images and a 3D model. Each file shows as pending until the store confirms it, then as confirmed. A file that is too large or of the wrong kind is refused with its name in the message, and nothing from that upload is kept. The teacher reorders slides and marks the lesson ready to teach. End state: the lesson status reads Ready.
5. **A poll, then breakout tables.** Start state: a live session with seated learners. The teacher opens a poll. Learners answer by number key or option button, and the teacher watches the counts change. Closing the poll announces the rounded percentages to everyone. The teacher then starts breakouts. Each table's ring and the rail timer count down from the server's deadline. Table chat stays within each table, and Add 2 minutes extends the time. The warning sounds 30 seconds out. End state: at the server deadline everyone walks back to their seat (Bell Return), the board brightens on the current slide, and chat is disabled.
6. **Spotlight, lock and roles.** Start state: a live session with a co-teacher. The co-teacher advances slides and spotlights a learner. The owner locks the class, a newcomer is refused with the locked notice, and a learner already in the class reloads and comes straight back. A learner who tries a teacher action is refused, and nobody can open another teacher's class. End state: the class is unlocked and announced as unlocked.
7. **Live bus outage.** Start state: a live class whose instance loses the live bus. The live-paused banner appears, live actions are refused with the paused message, and the room on that instance freezes rather than drifting from the other instance. End state: when the bus returns, with no restart, the banner goes, `Live updates are back.` is announced, and the current state shows.
8. **After class.** Start state: an ended session. The teacher opens the session summary and reads attendance (present, late, left early, both, absent), poll results, hands taken and breakout rounds. A learner who attended opens the review page and steps through the slides by buttons or arrow keys. A learner who did not attend gets not found. End state: the review shows `Slide <n> of <total>` for the slide in view.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Teacher accounts** Teachers sign up with an email, a password and a display name, sign in and out, and stay signed in across reload and on both instances.
- **DP-02 — Classes and class codes** A teacher creates classes with a title, a time zone and a server-made class code, lists the classes they own or co-teach, and adds co-teachers by email.
- **DP-03 — Classroom layout rules** Saving a room enforces the grid size, piece placement and seat and table ids from Business rules, and refuses the first offending piece with its published text.
- **DP-04 — Arranging the room by keyboard** The teacher builds and saves a room in the room editor with the keyboard alone (arrow keys, Enter, Delete) or with the pointer, and a refused save shows the server's text in the editor's alert.
- **DP-05 — Joining by class code** A learner joins with a class code and a display name only while that class's session is open or live and unlocked, and is otherwise refused with the published copy.
- **DP-06 — Taking a seat, seen everywhere** A learner who takes or moves to a seat appears in it in the seat mirror of every connected page on both instances within one second.
- **DP-07 — Classroom keyboard** Inside the classroom the published arrow keys and shortcuts move the seat cursor, take seats, raise hands, open chat, answer polls, change slides, spotlight and take hands, and they never act while focus is in a text field.
- **DP-08 — One seat, one learner** Across both instances a seat holds at most one learner and a learner holds at most one seat, and when several learners claim one empty seat at once exactly one wins.
- **DP-09 — Seat-taken notice** A learner who loses a seat stays where they were, and sees and hears the published seat-taken copy.
- **DP-10 — Session lifecycle** Sessions move through scheduled, open, live, breakouts and ended only along the published edges, and every other request answers 409 with the published copy.
- **DP-11 — Live slides on every instance** When the teacher or a co-teacher sets the slide, every board on both instances shows it and announces it.
- **DP-12 — Following the board** A learner's board follows the teacher's PageDown and PageUp live, and a learner who joins mid-session sees the current slide straight away.
- **DP-13 — Raised-hand queue** Raised hands queue in the order the server receives them, lowering removes a hand, and raising again goes to the back, the same on both instances.
- **DP-14 — Taking hands in order** The teacher takes the first raised hand by button or T key, everyone hears who has the floor, and an empty queue shows the published empty copy.
- **DP-15 — Lesson file uploads** Uploads accept PNG and JPEG slides and glTF binary models, judged by content, within the published size and count limits, and if any file is refused the request saves nothing.
- **DP-16 — Store-confirmed files** Each file is stored byte for byte in the object store and counts in its lesson only after the store confirms it, and a lesson can be marked ready to teach only when every file is confirmed.
- **DP-17 — Preparing a lesson** On the lesson page the teacher uploads files, sees each one pending until confirmed, reorders slides, sees refusals in the page alert and marks the lesson ready to teach.
- **DP-18 — File storage outage** While the object store is unreachable, uploads answer the published 503 with nothing half-saved, and the next upload after it returns works without a restart.
- **DP-19 — Polls** A teacher or co-teacher opens one poll at a time within the published limits, each learner's latest answer counts, the teacher sees live counts, and learners see results only once the poll closes.
- **DP-20 — Poll percentages** Closing a poll writes its final tally once and reports each option's percentage rounded half up to a whole number, as in the published examples.
- **DP-21 — Running a poll live** Learners answer an open poll by option button or number key, the teacher's counts change on the other instance, and closing the poll announces the results to everyone.
- **DP-22 — Breakout split** Starting breakouts at k tables deals seated learners, in seat-id order, to tables T1 to Tk in turn.
- **DP-23 — Server-held breakout deadline** The server holds the breakout deadline, Add 2 minutes extends it by exactly the published extension, and the warning and the return happen at server-decided edges whatever the device clock says.
- **DP-24 — Table chat** During breakouts each learner reads and posts only to their own table, the teacher reads every table, and after the deadline chat answers 409 and the field is disabled.
- **DP-25 — Bell Return** Each breakout table shows a draining ring and its seconds left, the rail timer turns urgent at the warning, and at the deadline the class walks back to their home seats table by table with the published timings.
- **DP-26 — Sessions in the class time zone** Session start and end are wall times in the class's time zone, stored and shown in that zone whatever the server's or the browser's zone.
- **DP-27 — Attendance statuses** Attendance marks each learner present, late, left early, late and left early, or absent from server presence times, using the published edges and reconnect grace.
- **DP-28 — Session summary** After a session ends, the teacher reads its attendance table, poll results, hands taken and breakout rounds, unchanged by the device clock or time zone.
- **DP-29 — Phone panels** At 375 by 812 the room sits above a Class panels tab bar whose Seats tab lists every seat as a button, and closed panels are hidden and inert.
- **DP-30 — Learning by touch on a phone** A learner on a phone takes a seat, raises a hand and answers a poll by tapping, and every touch target is at least 44 by 44 pixels.
- **DP-31 — Spotlight** The teacher or a co-teacher spotlights one learner at a time, every page shows and announces it, and it clears when that learner leaves.
- **DP-32 — Locking the room** When the teacher locks a live class, newcomers are refused on the join page with the locked copy, while learners already in the session can still reload and reconnect.
- **DP-33 — Roles and co-teachers** Owners, co-teachers and learners can each do only the actions the Roles rule gives them, and any other action inside a class they can open answers 403 with the published copy.
- **DP-34 — Private by default** Anything a caller cannot open answers 404 Not found: another teacher's class, another world's records, a session a learner cannot open or a lesson file they may not review, and another table's chat.
- **DP-35 — Live updates paused** When an instance cannot reach the live bus, its pages show the live-paused banner, live actions answer 503, and the room freezes instead of diverging, then resumes on its own when the bus returns.
- **DP-36 — Reviewing after class** A learner who attended an ended session steps through its slides on the review page by buttons or arrow keys.
- **DP-37 — Reduced motion** With reduced motion requested, the camera cuts, avatars jump to their seats, rings become a stepped number, no loop runs, and every function, announcement and timing stays the same.
- **DP-38 — Run manifest and health** The app installs, builds and serves from run.json on the published port, and the health route answers 200 with ok or unavailable as published.
- **DP-39 — Grading routes and worlds** The grading setup, sign-in, clock and outage routes work as published behind the grading key, and records never cross worlds.
- **DP-40 — Configuration and server boundary** Credentials, URLs and every timer and limit come from the published environment variables, and the server enforces same-origin requests and size limits and never serves source or secrets.
- **DP-41 — 3D classroom and its mirror** The classroom shows a WebGL 3D room with a DOM mirror of seats, tables and board that follows server messages, and shows still text in its place without WebGL.
- **DP-42 — Class announcements** The polite Class announcements region speaks every published announcement once, newest last, and keeps the latest 20.
- **DP-43 — Tablet and desktop layout** At 1280 by 800 the room and a ruled right rail sit side by side, at 768 by 1024 the rail is a bottom sheet behind the Class panel button, and no published viewport has horizontal overflow.
- **DP-44 — Lamplit scholarly look** Pages use a warm paper ground, a deep slate-green board, a single brick accent for time pressure and the live state, serif headings and monospace numerals, as described in Visual design.
- **DP-45 — Real live bus and real 3D** The source carries live state between instances through valkey and draws the room as a real WebGL scene, with no faked state endpoints and no prerendered images.

## Frontend

### Screens and layout (DP-29, DP-41, DP-43)

Every screen fits the three published viewports, 375x812, 768x1024 and 1280x800, with no horizontal overflow: nothing scrolls sideways. No other breakpoint changes what these viewports get.

- **Sign up** (`/sign-up`) and **Sign in** (`/sign-in`): one narrow centred form on the paper ground.
- **Your classes** (`/classes`): the classes the teacher owns or co-teaches, each with its title, time zone, class code and the teacher's role, plus a New class button that opens a dialog.
- **Class page** (`/classes/<classId>`): the class title and code, and four stacked regions. Room shows a small plan of the saved room with a link to the editor. Lessons lists each lesson with its status and has an add form. Sessions lists each session with its local start, end and state and has a Schedule session button. Co-teachers has an add-by-email form.
- **Room editor** (`/classes/<classId>/room`): column and row inputs, a piece picker, and the room grid drawn as a plan seen from above, with the front wall at the top. A Save room button sits under the grid. At 375 the grid scrolls inside its own box and the page itself never scrolls sideways.
- **Lesson page** (`/lessons/<lessonId>`): the lesson title and status, an Add files button, the ordered file list (slides first, then models) with per-file status and move and remove controls, and a Mark ready to teach button.
- **Join** (`/join`): class code and name fields, and a Join button.
- **Classroom** (`/sessions/<sessionId>`), the same page for teacher, co-teacher and learner:
  - **1280x800**: the 3D classroom region takes the left part of the window, a little under two-thirds of its width. A thin ruled line separates it from the rail on the right, which stacks the Hands, Poll, Breakout and Chat panels in that order and scrolls on its own. Teacher controls (Open class, Start class, End class, Previous slide, Next slide, Lock class) sit in a bar above the classroom.
  - **768x1024**: the classroom fills the top of the screen. The rail becomes a bottom sheet with a visible handle bar, opened by the Class panel button. Open, the sheet covers about the lower three-fifths of the screen and holds the same four panels.
  - **375x812**: the board strip and the canvas fill the top of the screen, a little over half its height. Below them is the Class panels tab bar with Seats, Hands, Poll and Chat tabs, and the selected tab's panel underneath. Teacher controls sit in a row between the canvas and the tab bar. While breakouts run, the breakout timer sits directly above the tab bar.
- **Session summary** (`/sessions/<sessionId>/summary`): attendance counts, the attendance table, poll results, hands taken and breakout rounds, on one scrolling page. At 375 the attendance table scrolls inside its own box.
- **Review** (`/review/<sessionId>`): one slide at a time on a board-green frame, its position text, Previous and Next buttons, and the lesson's models as download links.
- **Not found**: any page the visitor cannot open, or that does not exist, shows the not-found heading and text from Public screens and controls.

**The classroom region and its mirror.** The `region "Classroom"` holds a canvas with `role="img"` and the accessible name `Classroom view`, and beside it a DOM mirror of the room. The mirror is always in the accessibility tree. At 1280 and 768 it shows as a compact seat key under the canvas. At 375 it is visually hidden, because the Seats tab offers the same seats as buttons. Tests read only the mirror and never pixels or colours. The mirror contains:

- `list "Seats"` with one `listitem` per seat, carrying these attributes: `data-seat-id`, `data-table` (the seat's table id, or empty), `data-row`, `data-column`, `data-occupant` (learner id, or empty), `data-occupant-name`, `data-hand` (`raised` or `down`), `data-spotlit` (`true` or `false`), `data-selected` (`true` or `false`, marking the keyboard seat cursor), and `data-breakout-table` (the table id where that seat's learner sits during breakouts, or empty).
- `list "Tables"` with one `listitem` per table, carrying `data-table-id`, `data-row`, `data-column` and `data-breakout-remaining` (whole seconds left in breakouts, or empty when no breakout is running).
- The board element, marked `data-board`, carrying `data-slide` (1-based current slide, or 0 when the lesson has no slides), `data-slide-total` and `data-dimmed` (`true` while breakouts run, otherwise `false`). Its visible text is `Slide <n> of <total>`, and it shows the current slide image with the alt text `Slide <n>`.
- The model element, marked `data-model`, carrying `data-model-id` (the file id of the model on show, or empty).
- The region itself carries `data-motion` (`animated` or `reduced`), `data-webgl` (`on` or `off`) and `data-returning` (`true` while Bell Return walks are running, otherwise `false`).

The mirror changes when the server's message arrives, never on an animation frame, so it is correct while the page clock is paused. The canvas then animates towards that state. Two values count down with the page clock between server messages: `data-breakout-remaining` and the breakout timer (see DP-23 in Business rules). No control and no mirror value ever needs a rendered WebGL frame. Without WebGL, `data-webgl="off"` is set, the canvas is replaced by the WebGL fallback text from Feedback states, and the mirror and every control keep working.

### Public screens and controls (DP-04, DP-05, DP-07, DP-14, DP-17, DP-21, DP-24, DP-29, DP-30, DP-31, DP-32, DP-36, DP-43)

Only these roles and names are public. Everything else is free. `<placeholders>` are filled from the record they belong to.

| Screen | Role and accessible name | Visible copy and notes |
|---|---|---|
| Sign up | `heading "Create your teacher account"`, `textbox "Email"`, `textbox "Password"`, `textbox "Your name"`, `button "Create account"`, `link "Sign in"` | Errors in an `alert` |
| Sign in | `heading "Sign in"`, `textbox "Email"`, `textbox "Password"`, `button "Sign in"`, `link "Create an account"` | Errors in an `alert` |
| Your classes | `heading "Your classes"`, `list "Classes"` (each item a `link "<class title>"`), `button "New class"`, `button "Sign out"` | Each item also shows `Code <code>` and `Owner` or `Co-teacher` |
| New class | `dialog "New class"`, `textbox "Title"`, `combobox "Time zone"`, `button "Create class"`, `button "Cancel"` | Time zone lists IANA zone names |
| Class page | `heading "<class title>"`, `region "Room"` with `link "Edit room"`, `region "Lessons"` with `list "Lessons"`, `textbox "Lesson title"`, `button "Add lesson"`, `region "Sessions"` with `list "Sessions"`, `button "Schedule session"`, `region "Co-teachers"` with `textbox "Co-teacher email"`, `button "Add co-teacher"` | Shows `Class code <code>`. Each session item is a `link` to its classroom |
| Schedule session | `dialog "Schedule session"`, `combobox "Lesson"`, `textbox "Starts"`, `textbox "Ends"`, `button "Schedule"`, `button "Cancel"` | Times typed like `2027-03-09T19:00`, read in the class time zone, which the dialog names |
| Room editor | `heading "Arrange the room"`, `spinbutton "Columns"`, `spinbutton "Rows"`, `radiogroup "Piece"` with `radio "Board"`, `radio "Table"`, `radio "Seat"`, `grid "Room grid"` with one `gridcell "Cell <column>,<row>"` per cell, `button "Save room"` | Each gridcell carries `data-piece` (`board`, `table`, `seat` or empty). The cell cursor has `aria-selected="true"`. Refusals in an `alert` |
| Lesson page | `heading "<lesson title>"`, `button "Add files"` (opens the file chooser; the file input is labelled `Add files`), `list "Lesson files"`, `button "Move <file name> up"`, `button "Move <file name> down"`, `button "Remove <file name>"`, `button "Mark ready to teach"` | Shows `Status: Draft`, `Status: Uploading` or `Status: Ready`. Each file item carries `data-file-id` and `data-file-status` (`pending` or `confirmed`) and shows the file name and `Pending` or `Confirmed`. Refusals in an `alert` |
| Join | `heading "Join a class"`, `textbox "Class code"`, `textbox "Your name"`, `button "Join"` | Refusals in an `alert` |
| Classroom | `heading "<class title>"`, `region "Classroom"` (canvas `img "Classroom view"`, `list "Seats"`, `list "Tables"`, board), `status "Class announcements"`, the live-paused `alert` | See Screens and layout |
| Classroom, teacher bar | `button "Open class"`, `button "Start class"`, `button "End class"`, `button "Previous slide"`, `button "Next slide"`, `switch "Lock class"` | Each button shows only when its action is legal in the session's state. Co-teachers see only the slide buttons |
| Hands panel | `region "Hands"`, `list "Raised hands"`, `button "Raise hand"` / `button "Lower hand"` (learner; one button whose name follows the hand's state), `button "Take next hand"` (teacher, co-teacher), `list "Learners in seats"` with `button "Spotlight <name>"` (teacher, co-teacher; `aria-pressed` shows who is spotlit), `button "Clear spotlight"` | Empty queue copy from Feedback states |
| Poll panel | `region "Poll"`, `button "New poll"`, `group "Poll"` holding the question, one `button "<option text>"` per option for learners (`aria-pressed="true"` on their answer), `list "Poll counts"` for teacher and co-teacher (items `<option>: <count>`), `button "Close poll"`, `list "Poll results"` (items `<option> <p>%`) | With no poll, shows `No poll is open.` |
| New poll | `dialog "New poll"`, `textbox "Question"`, `textbox "Option <n>"` (1-based), `button "Add option"`, `button "Open poll"`, `button "Cancel"` | Refusals in an `alert` inside the dialog |
| Breakout panel | `region "Breakout"`, `button "Start breakouts"`, `timer "Breakout time left"`, `button "Add 2 minutes"`, `list "Breakout tables"` (items `T<k>: <names>`) | The timer shows `<mm>:<ss>`, two digits each, in monospace numerals, and carries `data-urgent` (`true` or `false`) |
| Start breakouts | `dialog "Start breakouts"`, `spinbutton "Tables"`, `button "Start"`, `button "Cancel"` | Refusals in an `alert` inside the dialog |
| Chat panel | `region "Table chat"`, `combobox "Table"` (teacher only), `log "Table messages"`, `textbox "Message your table"`, `button "Send"` | Outside breakouts, shows `Chat opens when breakouts start.` with the field disabled |
| 768 sheet | `button "Class panel"`, `dialog "Class panel"`, `button "Close panel"` | |
| 375 tabs | `tablist "Class panels"` with `tab "Seats"`, `tab "Hands"`, `tab "Poll"`, `tab "Chat"`; in Seats, one `button "Seat <id>"` per seat, named `Seat <id>, taken by <name>` when taken | |
| Summary | `heading "Session summary"`, `list "Attendance counts"` (items `Present <n>`, `Late <n>`, `Left early <n>`, `Late, left early <n>`, `Absent <n>`), `table "Attendance"` with columns `Learner`, `Status`, `First joined`, `Last left`, `list "Poll results"`, text `Hands taken: <n>`, text `Breakout rounds: <n>` | Times show as `HH:MM:SS` in the class time zone. Absent rows show `-` in both time cells |
| Review | `heading "Review: <lesson title>"`, `img "Slide <n>"`, text `Slide <n> of <total>`, `button "Previous slide"`, `button "Next slide"`, `list "Models"` with `link "Download model <n>"` | |
| Ended class (learner) | text `This class has ended.`, `link "Review the slides"` | Shown on the classroom page once the session has ended |
| Not found | `heading "Page not found"`, text `We couldn't find that page.` | |
| Other pages | `status "Page status"` | Pending and success copy for forms |

### Interactions (DP-04, DP-07, DP-12, DP-21, DP-29, DP-30, DP-36, DP-43)

**Room editor.** The cell cursor starts at cell 0,0. Arrow keys move it one cell at a time and stop at the edges. Enter places the piece chosen in the Piece radio group at the cursor (a board takes the cursor's column as its left column). Delete or Backspace removes the piece covering the cursor cell. Clicking or tapping a cell places the chosen piece there. Changing Columns or Rows redraws the grid. Pieces that fall outside the new size are kept, so the server can refuse them on save. Save room sends the pieces in the order they were placed. A refusal puts the server's text in the editor's alert and leaves the plan as it was. Tab order: Columns, Rows, Piece, the grid (one tab stop; arrow keys move inside it), Save room.

**Classroom keyboard.** These keys act whenever focus is anywhere inside `region "Classroom"` or the rail, as long as focus is not in a text field. They work while focus sits on any button there.
- Arrow keys move the seat cursor (`data-selected="true"`) to the nearest seat in that direction. A seat in the same row (for Left and Right) or the same column (for Up and Down) wins first, then the nearest seat by straight-line distance among seats lying in that direction, with ties going to the lower seat id. At the edge the cursor stays put. The cursor starts on your own seat, or otherwise on the lowest seat id.
- `Enter` takes the cursor's seat (learner).
- `H` raises or lowers your hand (learner).
- `C` opens the Chat panel and focuses `textbox "Message your table"`.
- `1` to `6` answer the open poll with the option of that number (learner).
- Teacher and co-teacher: `PageDown` next slide, `PageUp` previous slide, `T` takes the next hand, `S` spotlights the learner in the cursor's seat.
- Arrow keys and shortcuts never act while focus is in a text field. In `textbox "Message your table"`, Enter sends the message and Escape leaves the field, returning focus to whatever had it before `C`.

**Dialogs and sheet.** Every dialog (New class, Schedule session, New poll, Start breakouts, and the Class panel sheet) moves focus to its first field when it opens. Tab and Shift+Tab wrap inside it: Tab past the last control goes to the first, and Shift+Tab before the first goes to the last. Escape closes it, and focus returns to the control that opened it. Cancel and Close panel do the same.

**Tabs at 375.** The Class panels tab bar follows the usual tabs pattern. Left and Right move between tabs, and Enter, Space or a tap selects one. Seats is selected when the page opens. Tapping `Seat <id>` takes that seat. The Hands tab holds Raise hand. The Poll tab holds the option buttons.

**Touch and pointer.** Dragging on the canvas with a finger or the pointer orbits the camera around the room's centre, up to about a third of a right angle either side of the starting view and a little up or down. Releasing leaves the view where it is. This works the same under reduced motion. Tapping or clicking an empty seat in the canvas takes it, the same as Enter on the cursor.

**Live following.** Every page shows the session as the server last reported it. Seats, slide, hands, poll counts, spotlight, lock, breakouts and chat reach every connected page on either instance within one second of the server accepting the change. A page that loads or reloads mid-session starts from the server's current snapshot, so a late joiner sees the current slide and a learner who reloads during Bell Return appears directly in their home seat.

**Review.** Previous slide and Next slide, or the Left and Right arrow keys anywhere on the page, step through the slides. The buttons are disabled at the first and last slide.

### Visual design (DP-44)

- **Mood:** scholarly, lamplit and calm, like a well-kept seminar room in the evening.
- **Colour roles:** a warm paper off-white for the page ground, a near-black ink with a hint of green for text, a deep slate-green for the board, the classroom floor rings and primary buttons, and a soft greige for ruled lines and panel dividers. One brick red is the only accent, used only for time pressure (the urgent breakout timer and rings) and the live state (a small "Live" marker beside the class title while the session is live or in breakouts). Nothing else uses brick red.
- **Type:** headings use the platform's built-in serif face, body text the platform's built-in sans-serif, and timers, counts, seat ids and codes the platform's built-in monospace with figures of equal width, so numbers do not shift as they count. No web fonts are loaded. Each heading level is about a quarter larger than the level below it, and body text is comfortable reading size.
- **Density:** comfortable, with generous space around panels and between list rows. A rail panel never feels crowded.
- **Composition:** the classroom on the left reads as the room, and the ruled rail on the right reads as the teacher's notebook margin. In the 3D room the floor is pale wood-toned paper, the walls are faint, the board is slate-green, and tables, seats and avatars are simple low-poly shapes the app makes itself. Each avatar is a rounded body with a sphere head in a muted per-learner tint, and its display name floats above it.
- **Controls:** every button and touch target is at least 44 by 44 pixels at every viewport. A focused control shows a clearly visible slate-green focus ring at least two pixels thick.
- **Contrast:** all text and every control boundary meet WCAG 2.2 AA contrast against the background they sit on, including white text on slate-green and brick red.

### Motion and effects (DP-25, DP-37, DP-41)

All motion starts quickly and settles softly. No motion lasts longer than one second, except the model's slow turn and the breakout rings, which follow the server's time. Motion only ever shows a change of state. There are no decorative loops other than the model turn named below.

- **Camera.** On entering the classroom, the camera glides from the back of the room to the viewer's place in 0.5 to 0.8 seconds: behind a learner's seat facing the board, or front-right overlooking the room for a teacher. Taking a new seat glides the camera to it in the same time.
- **Avatars.** When a learner takes a seat, their avatar walks there in about two-thirds of a second. A raised hand lifts the avatar's arm within a quarter of a second, and lowering it reverses the motion.
- **Spotlight.** A soft warm pool of light fades onto the spotlit seat in about a third of a second, and fades off when it clears.
- **Model.** The model on show stands on a plinth beside the board and turns once every 20 to 40 seconds. It turns only while the session is live or in breakouts, and this is the only idle loop. Otherwise the scene is still when nothing changes: no camera drift, no flicker, no looping effects.
- **Sheet and panels.** The 768 bottom sheet slides up in about a quarter of a second and slides down the same way before it becomes hidden. Opening a dialog fades it in within a fifth of a second. These finish when the page clock advances.
- **Hover and press.** Buttons darken slightly on hover and press down slightly on press, within a tenth of a second.

**Bell Return (the signature).** The teacher and the learners can see on the room itself how long each breakout table has left. When the server's deadline passes, the whole class is back in its home seats facing the teacher's current slide.
1. When breakouts start, each learner's avatar walks from its home seat to its breakout table in about two-thirds of a second. Each breakout table gets a slate-green ring on the floor, which drains clockwise from full to empty as the server's remaining time runs down. The ring's fullness is the remaining time divided by the round's whole length, extensions included. The board dims to about two-fifths strength (`data-dimmed="true"`). The rail timer shows `<mm>:<ss>`, and each table's mirror item shows `data-breakout-remaining`.
2. When the teacher presses Add 2 minutes, every ring on both instances refills to its new fullness in a little over a quarter of a second, and the timer jumps to the new time.
3. At the server's warning (DP-23), every ring and the rail timer turn brick red, the timer carries `data-urgent="true"`, and the warning is announced.
4. At the server's deadline, `data-returning="true"` is set. The avatars walk back along the aisles to their home seats, table T1's learners first, then each later table starting about 0.12 seconds after the one before. Each walk takes about two-thirds of a second. `data-returning` goes back to `false` when the last walk ends, which with k tables is (k − 1) × 0.12 + 0.64 seconds after the return began. At the same moment as the walks start, the board brightens from about two-fifths to full strength in about a third of a second (`data-dimmed="false"`), showing the teacher's current slide. The rings disappear, the chat field becomes disabled, and the return is announced.
5. The mirror reflects each step as soon as the server's message arrives: `data-breakout-table` empties at the return, before the walks finish. A learner who reloads during the walks renders straight into their home seat, with no walk.

**Reduced motion.** When the browser asks for reduced motion, `data-motion="reduced"` is set. The camera cuts instead of gliding, and avatars appear in their new seat or table at once (`data-returning` never becomes `true`). The rings are replaced by a stepped whole-second countdown on each table's floating label. The board appears at full strength on the current slide without a fade, the model does not turn, and no animation is left running once the page has settled. Dragging still orbits the camera. Every function, mirror value, announcement and server timing stays exactly the same.

**Without WebGL.** If WebGL is unavailable, the canvas is replaced by the WebGL fallback text, and the board element still shows the current slide image.

### Feedback states (DP-09, DP-14, DP-17, DP-18, DP-21, DP-25, DP-32, DP-35, DP-41, DP-42)

**Class announcements.** The classroom's `status "Class announcements"` is a polite live region holding one paragraph per announcement, newest last, keeping the latest 20. When the same text would follow itself within 2 seconds of page clock, it is not added again. The announcement texts are:

| When | Text |
|---|---|
| The slide changes | `Slide <n> of <total>.` |
| A hand is raised | `<name> raised a hand.` |
| The teacher takes a hand | `<name> has the floor.` |
| A poll closes | `Poll results: <option> <p>%, <option> <p>%.` (every option in its order, joined by comma and space) |
| Breakouts start (a dealt learner) | `Breakouts started. You are at table <T>.` |
| Breakouts start (teacher, co-teacher, learner without a seat) | `Breakouts started at <k> tables.` |
| The warning fires | `Breakouts end in <s> seconds.` |
| The deadline passes | `Breakouts are over. Everyone is back in their seat.` |
| Someone is spotlit | `<name> is in the spotlight.` |
| The class is locked | `The class is locked.` |
| The class is unlocked | `The class is unlocked.` |
| A live action from this page is refused | the response's `error` text, for example the seat-taken text |
| The live bus returns | `Live updates are back.` |

`<name>` is the learner's display name, `<T>` a table id, `<k>` the number of tables, `<s>` the whole seconds the server reports left when the warning fires, and `<p>` a percentage from DP-20 in Business rules.

**Classroom states.**
- Live bus paused (DP-35): an `alert` banner across the top of the classroom reads `Live updates are paused. Your class will resume on its own.` It disappears when the bus returns.
- Empty hand queue: the Hands panel reads `No hands raised.`
- No WebGL: a `status` in place of the canvas reads `3D view unavailable. The class still works.`
- Pending live action: the pressed button is disabled and marked `aria-busy="true"` until the answer arrives. No announcement is made.

**Forms on other pages.** While a request is pending, the submit button is disabled and marked `aria-busy="true"`, and `status "Page status"` reads `Saving...`. Field errors and refusals show the response's `error` text in the page's `alert` (or the dialog's). An outage 503 shows its text from Services the same way. Success copy:

| Action | Success |
|---|---|
| Create account, sign in | go to Your classes |
| Create class | go to the new class page |
| Save room | `Room saved.` |
| Add lesson | go to the lesson page |
| Add files | each chosen file appears at once as `Pending`, then as `Confirmed` when the answer arrives, and Page status reads `Files added: <count>.` |
| Reorder or remove a file | `Lesson updated.` |
| Mark ready to teach | `Lesson ready to teach.` |
| Schedule session | `Session scheduled.` |
| Add co-teacher | `<name> can now co-teach this class.` |
| Join | go to the classroom |

A refused upload removes that request's pending rows, and the alert shows the refusal. A refused join shows its text in the join page's alert, including the locked text from DP-32 in Business rules.

## Backend

### API (DP-01, DP-02, DP-05, DP-10, DP-15, DP-19, DP-24, DP-28, DP-33, DP-34, DP-36, DP-39)

All endpoints take and return `application/json` unless stated otherwise. Errors always have the shape `{"error":"<text>"}`. The 401 body is `{"error":"Sign in first."}`, and the not-found body everywhere is `{"error":"Not found."}`.

**Error order (the whole API).** The first check that applies decides the answer:
1. 401 when not signed in.
2. 404 for anything the caller cannot open. This covers an unknown id, another world's id, another teacher's class or lesson (to anyone who is not its owner or co-teacher), a session a learner cannot open and a file of a session a learner may not review (both as defined in DP-33 and DP-36), and another breakout table's chat, including ids nested in paths or bodies. These answer 404, never 403 and never 422. The one exception is the `slideIds` list of `PUT .../order`, which DP-15 checks as a whole.
3. 403 `{"error":"Only the teacher can do that."}` for a role refusal inside a class the caller can open.
4. 409 for state conflicts.
5. 413 for size and 415 for content type (Server boundary).
6. 422 for validation.
7. 503 when the action needs a service that is down.

Within one upload, the per-file order in DP-15 decides between 413 and 422. The cross-site refusal and the grading key check come before all of these.

**Accounts**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `POST /api/teachers` | `{"email","password","displayName"}` | `201 {"id","email","displayName"}`, sets the session cookie | `409 {"error":"An account with that email already exists."}` (emails compared ignoring case); `422 {"error":"Enter a valid email address."}`, `422 {"error":"Use at least 10 characters for your password."}`, `422 {"error":"Enter a name of 1 to 60 characters."}`, checked in that order |
| `POST /api/sign-in` | `{"email","password"}` | `200 {"id","email","displayName"}`, sets the cookie | `401 {"error":"Email or password is wrong."}` |
| `POST /api/sign-out` | none | `204` | |
| `GET /api/me` | | teacher: `200 {"role":"teacher","id","email","displayName"}`; learner: `200 {"role":"learner","id","displayName"}` | |

The session cookie is `slatehall_session` (HttpOnly, SameSite=Lax, path `/`). Sessions are stored in Postgres, so a cookie set by either instance is valid on both.

**Classes** (owner and co-teachers can open them)

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/classes` | | `200 {"classes":[{"id","title","timeZone","code","role":"owner"\|"co-teacher"}]}` | |
| `POST /api/classes` | `{"title","timeZone"}` | `201 {"id","title","timeZone","code","layout"}` | `422 {"error":"Give the class a title of 1 to 80 characters."}`, `422 {"error":"Choose a time zone from the list."}` (not an IANA zone name) |
| `GET /api/classes/<classId>` | | `200 {"id","title","timeZone","code","layout","seats","tables","coTeachers":[{"id","displayName","email"}],"lessons":[{"id","title","state"}],"sessions":[{"id","lessonId","state","startsAt","endsAt"}]}` | |
| `PUT /api/classes/<classId>/layout` | the layout JSON | `200 {"layout","seats":[{"seatId","table","row","column"}],"tables":[{"tableId","row","column"}]}` | the 409 and 422 layout refusals in DP-03 |
| `POST /api/classes/<classId>/co-teachers` | `{"email"}` | `201 {"id","displayName","email"}`; adding someone already added answers `200` with the same body | `422 {"error":"No teacher has that email."}`, `422 {"error":"You already own this class."}` |

A new class gets the starting layout `{"columns":8,"rows":6,"pieces":[{"kind":"board","column":2,"row":0}]}`.

**Lessons and files**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `POST /api/classes/<classId>/lessons` | `{"title"}` | `201` lesson | `422 {"error":"Give the lesson a title of 1 to 120 characters."}` |
| `GET /api/lessons/<lessonId>` | | `200` lesson | |
| `POST /api/lessons/<lessonId>/files` | `multipart/form-data`, one or more parts named `files` | `201` lesson | DP-15 refusals; storage 503 from Services |
| `DELETE /api/lessons/<lessonId>/files/<fileId>` | | `200` lesson | DP-16 live-lesson 409 |
| `PUT /api/lessons/<lessonId>/order` | `{"slideIds":["<fileId>", ...]}` | `200` lesson | DP-15 order refusal |
| `POST /api/lessons/<lessonId>/ready` | none | `200` lesson | DP-16 ready refusals |
| `GET /api/files/<fileId>` | | `200`, the stored bytes, `Content-Type` `image/png`, `image/jpeg` or `model/gltf-binary` | storage 503 from Services |

A lesson body is `{"id","classId","title","state":"draft"|"uploading"|"ready","slides":[{"fileId","name","number","bytes","status":"pending"|"confirmed"}],"models":[{"fileId","name","number","bytes","status"}]}`. `number` is 1-based within slides, or within models.

**Sessions**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `POST /api/classes/<classId>/sessions` | `{"lessonId","startsAt","endsAt"}` (local wall times) | `201` snapshot | DP-26 time refusals |
| `GET /api/sessions/<sessionId>` | | `200` snapshot | |
| `POST /api/sessions/<sessionId>/open`, `/start`, `/end` | none | `200` snapshot | DP-10 refusals |
| `POST /api/join` | `{"code","displayName"}` | `201 {"sessionId","learnerId"}`, sets the cookie; a learner already in that session answers `200` with the same body | DP-05 refusals |
| `POST /api/sessions/<sessionId>/seat` | `{"seatId":"B3"}` | `200` snapshot | DP-08 refusals |
| `DELETE /api/sessions/<sessionId>/seat` | | `200` snapshot | |
| `POST /api/sessions/<sessionId>/slide` | `{"slide":2}` | `200` snapshot | `422 {"error":"No such slide."}` (outside 1 to total) |
| `POST /api/sessions/<sessionId>/hand` | `{"raised":true}` | `200` snapshot; repeating the current state changes nothing | DP-13 refusal |
| `POST /api/sessions/<sessionId>/hands/next` | none | `200 {"took":{"learnerId","displayName"},"snapshot":<snapshot>}` | DP-14 refusal |
| `POST /api/sessions/<sessionId>/polls` | `{"question","options":["...", "..."]}` | `201 {"pollId","question","options","state":"open"}` | DP-19 refusals |
| `POST /api/polls/<pollId>/answer` | `{"option":1}` (1-based) | `200 {"pollId","yourAnswer":1}` | DP-19 refusals |
| `POST /api/polls/<pollId>/close` | none | `200 {"pollId","total":<n>,"results":[{"option","count","percent"}]}` | DP-19 refusals |
| `POST /api/sessions/<sessionId>/spotlight` | `{"learnerId":"..."}` or `{"learnerId":null}` | `200` snapshot | DP-31 refusal |
| `POST /api/sessions/<sessionId>/lock` | `{"locked":true}` | `200` snapshot | |
| `POST /api/sessions/<sessionId>/breakouts` | `{"tables":2}` | `201` snapshot | DP-22 refusal |
| `POST /api/sessions/<sessionId>/breakouts/extend` | none | `200` snapshot | DP-23 refusal |
| `GET /api/sessions/<sessionId>/tables/<tableId>/chat` | | `200 {"messages":[{"messageId","author","text","sentAt"}]}`, oldest first | |
| `POST /api/sessions/<sessionId>/tables/<tableId>/chat` | `{"text"}` | `201 {"messageId","author","text","sentAt"}` | DP-24 refusals |
| `GET /api/sessions/<sessionId>/attendance` | | `200 {"rows":[{"learnerId","displayName","status","firstJoined","lastLeft","visits"}]}` | DP-27 refusal |
| `GET /api/sessions/<sessionId>/summary` | | `200 {"attendance":{"present","late","leftEarly","lateLeftEarly","absent"},"polls":[{"pollId","question","total","results":[{"option","count","percent"}]}],"handsTaken":<n>,"breakoutRounds":<n>}` | DP-28 refusal |
| `GET /api/sessions/<sessionId>/review` | | `200 {"lessonTitle","slides":[{"fileId","number","url":"/api/files/<fileId>"}],"models":[{"fileId","number","url"}]}` | DP-36 refusal |

**Session snapshot.** Every session answer uses one shape, seen from the caller's role:

```json
{
  "id": "ses_1", "classId": "cls_1", "lessonId": "les_1", "state": "live",
  "timeZone": "America/Chicago",
  "startsAt": "2027-03-09T19:00:00", "endsAt": "2027-03-09T20:30:00",
  "startsAtUtc": "2027-03-10T01:00:00Z", "endsAtUtc": "2027-03-10T02:30:00Z",
  "slide": {"current": 1, "total": 3, "fileId": "fil_1"},
  "modelFileId": "fil_4",
  "locked": false, "spotlight": null,
  "seats": [{"seatId": "B1", "table": "T1", "row": 2, "column": 0, "learnerId": "lrn_1", "displayName": "Mira Okafor", "hand": "down", "breakoutTable": null}],
  "tables": [{"tableId": "T1", "row": 2, "column": 1}],
  "hands": [{"learnerId": "lrn_3", "displayName": "Priya Raman"}],
  "poll": {"pollId": "pol_1", "question": "Which word means the bill?", "options": ["La cuenta", "La mesa", "La carta"], "state": "open", "counts": [2, 1, 0], "yourAnswer": null},
  "breakout": null,
  "you": {"role": "teacher", "learnerId": null},
  "live": true
}
```

`seats` lists every seat in the layout, with `learnerId` and `displayName` null when the seat is empty. `poll` is the open poll, or the latest closed one, or null. For learners, `counts` is null while the poll is open. While breakouts run, `breakout` is `{"tables":[{"tableId","learnerIds":[...]}],"remainingSeconds":<whole seconds>,"warning":true|false}`. `remainingSeconds` is worked out on the server from the world clock when the answer is made. `you.role` is `teacher`, `co-teacher` or `learner`. `live` is false when the answering instance cannot reach Valkey; in that case seats, slide and hands are the last state that instance saw. The illustrative ids here and elsewhere are opaque strings.

**WebSocket.** `GET /ws/sessions/<sessionId>` upgrades to a WebSocket only for a signed-in teacher, co-teacher or learner of that session. Anyone else gets 404. The socket only pushes messages; every command goes through REST. Each message is a JSON object with `event` (a short name for what changed) and `snapshot` (that recipient's session snapshot). Chat messages also carry `message`. Every accepted change and every change of the world clock pushes a message to every connected page of that session on both instances.

**Grading routes.** Every grading route requires the header `X-Grading-Key` equal to the environment variable `GRADING_KEY`, and none needs a session. A wrong or missing key, or an unset `GRADING_KEY`, answers `404 {"error":"Not found."}`.

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `POST /api/grading/setup` | the world JSON (shape below; literal example in Seed data) | `201` the ids JSON | `409 {"error":"Class code <code> is already in use."}`; `422 {"error":"<the first problem, naming its field>"}`; storage 503 from Services |
| `POST /api/grading/sign-in` | `{"token":"..."}` | `200 {"role":"teacher"\|"learner","id"}`, sets the session cookie on the instance that receives it (valid on both); each token works once, and a used or unknown token answers 404 | |
| `POST /api/grading/clock` | `{"worldId":"...","now":"2027-03-09T19:04:59-06:00"}` or `{"worldId":"...","now":null}` | `200 {"worldId","now":"<ISO instant in UTC>"}` | |
| `POST /api/grading/outage` | `{"service":"valkey"\|"minio","down":true\|false}` | `200 {"service","down"}` | `422 {"error":"Choose valkey or minio."}` |

The world JSON has these fields. `now` (optional ISO instant with offset) sets and holds the new world's clock from the start, as the clock route does; without it the world runs on real time. Then:

- `teachers`: `[{key, email, password, displayName}]`
- `classes`: `[{key, teacher, coTeachers, title, timeZone, code?, layout?}]`
- `lessons`: `[{key, class, title, slideCount, modelCount}]`
- `sessions`: `[{key, class, lesson, startsAt, endsAt, state: "scheduled"|"open"|"live"|"ended", currentSlide, locked}]`
- `learners`: `[{key, displayName, session, seat (a seat id or null), presence: [{joinedAt, leftAt or null}]}]`
- `hands`: `[{session, learners: [keys in queue order]}]`
- `polls`: `[{key, session, question, options, answers: {learnerKey: optionNumber}, state: "open"|"closed"}]`
- `breakouts`: `[{session, tables}]`

Keys are unique within one request across every list. People and classes refer to each other by key. When a class `code` is omitted, the server makes one. For each lesson the server generates `slideCount` slides, each a valid PNG showing its number and named `slide-<n>.png`, and `modelCount` models, each a valid small glTF binary named `model-<n>.glb`. It stores them in MinIO and marks them confirmed, so the lesson is ready. A `breakouts` entry starts a round for that session at the world's current time and deals it by the DP-22 split. A session created as `ended` counts as having ended at its `endsAt`. The ids JSON returns `worldId` and maps every key to what was created:

- `teachers: {key: id}`
- `classes: {key: {id, code}}`
- `lessons: {key: {id, slides: [fileIds], models: [fileIds]}}`
- `sessions: {key: id}`
- `learners: {key: id}`
- `polls: {key: id}`
- `signInTokens: {personKey: token}` for every teacher and learner

The clock route sets the world's clock to `now` and holds it there until it is set again, or back on real time with `null`. Every server time rule in that world reads the world's clock. Before answering, the route runs everything that has become due in that world (breakout warnings and returns, and presence leaves past the reconnect grace) and pushes the resulting live messages, so their results are visible when it answers. The outage route makes only the receiving instance treat that service as unreachable, through the same code path as a real failure, until it is set back to false.

### Business rules (DP-03, DP-05, DP-08, DP-10, DP-13, DP-14, DP-15, DP-16, DP-19, DP-20, DP-22, DP-23, DP-24, DP-26, DP-27, DP-31, DP-32, DP-33)

**Worlds.** Everything a setup call creates belongs to its world. Lists, codes, joins, presence and counts never cross worlds. People and classes created through normal sign-up belong to the default world, which always runs on real time. A class code is unique across all worlds, so a join finds exactly one class.

**Server time.** Every decision about time is made on the server from the world's clock: whether something is open, due, late or over. The browser only shows what the server reports. The device clock may be wrong, and it never changes a status, a deadline, a warning or an attendance mark. Pages under test run with a paused browser clock that the test moves forward. Countdowns and the other browser-timer behaviour (ring drain, sheet exit, announcement spacing) complete when that clock advances. On real-time worlds the server runs due work at least once a second.

**DP-03 Classroom layout.** A room is a grid of `columns` 4 to 12 by `rows` 3 to 10 cells. Row 0 is the front wall. There are three kinds of piece:
- `board`: exactly one, in row 0, 4 cells wide, placed by its left `column`.
- `table`: 1 cell, row 1 or higher.
- `seat`: 1 cell, row 1 or higher.

Example layout JSON: `{"columns":8,"rows":6,"pieces":[{"kind":"board","column":2,"row":0},{"kind":"table","column":1,"row":2},{"kind":"seat","column":0,"row":2}]}`.

A seat's id is its row letter (row 1 is `A`, row 2 is `B`, up to row 9, which is `I`) followed by its 1-based column number, so the seat at column 0, row 2 is `B1`. Seat ids sort by row letter, then by column number as a number (so `B9` comes before `B10`). Table ids are `T1`, `T2` and upwards, numbered in row order, then column order. A seat belongs to the table in the cell directly to its left or right, the left one winning if both are tables. Otherwise it has no table.

A grid outside the size range answers `422 {"error":"A room is 4 to 12 columns by 3 to 10 rows."}`. Otherwise pieces are checked in list order, and the first piece that fails decides the refusal. Each piece n (1-based) is checked in this order:
1. Its kind: `Piece <n> isn't a board, table or seat.`
2. Inside the grid: `Piece <n> is outside the room.`
3. Front wall: a board not in row 0 gives `The board must sit on the front wall.`, and a seat or table in row 0 gives `Seats and tables can't go on the front wall.`
4. Cells shared with an earlier piece m (the earliest such piece): `Piece <n> overlaps piece <m>.`

After every piece passes, a room without exactly one board gives `A classroom needs exactly one board.` All of these answer `422 {"error":"<text>"}`. A layout cannot change while the class has a session that is open, live or in breakouts: `409 {"error":"The room can't change during a live session."}`.

**DP-10 Session lifecycle.** A session is `scheduled`, then `open` (learners may arrive and sit), then `live`, which can go to `breakouts` and back to `live`, then `ended`.
- `open` is allowed from `scheduled`.
- `start` is allowed from `open`, and only when the lesson is `ready`, otherwise `409 {"error":"The lesson isn't ready to teach."}`.
- The return from `breakouts` to `live` happens only at the breakout deadline.
- `end` is allowed from `open`, `live` or `breakouts`.

Any other move answers `409 {"error":"That can't be done while the session is <state>."}`, where `<state>` is the current state. A class has at most one session that is open, live or in breakouts. Opening a second answers `409 {"error":"This class already has a session running."}`. Which actions each state allows:
- Seats: `open` and `live`. In `breakouts`: `409 {"error":"Seats are fixed during breakouts."}`.
- Slides, hands, polls, spotlight and lock: `live` and `breakouts`.
- Starting breakouts: `live`.
- Extending breakouts and posting to table chat: `breakouts` only. In any other state they answer `Breakouts are over.` from DP-23 and DP-24, never the state 409.
- Anything else in a state that does not allow it gets the state 409 above.

Ending a session does four things once, in this order. It closes any open poll and writes its final tally. It ends any breakout round (no return walk; everyone is shown in their home seat). It closes every open presence interval at the end time. It writes the attendance intervals and the summary to Postgres. Spotlight and lock clear.

**DP-05 Joining.** The code is matched ignoring case and spaces.
- An unknown code answers `404 {"error":"Not found."}`, and the join page shows `That code doesn't match a class.`
- A class with no open or live session (breakouts count as live) answers `409 {"error":"This class isn't open right now."}`.
- A locked class answers as in DP-32.
- A display name must be 1 to 40 characters after trimming, otherwise `422 {"error":"Enter a name of 1 to 40 characters."}`.

The first join enrols the learner in that class. A learner whose cookie already belongs to a learner record keeps that record (and its display name) when joining another class's session. The join is judged at the moment the server receives it: a join arriving after the session ends, or after the lock, is refused.

**DP-08 Seats.** Taking a seat while holding another moves the learner, freeing the old one. Taking the seat you already hold answers 200 and changes nothing. One seat holds at most one learner and one learner holds at most one seat, across both instances. The decision is made atomically in Valkey, and the claim the server receives first wins. A losing or later claim on a taken seat answers `409 {"error":"Seat <id> was just taken. Pick another seat."}`, and that learner stays where they were. An unknown seat id answers `422 {"error":"No such seat."}`. A learner in no seat sees and follows the class, but cannot raise a hand.

**DP-13 Raised hands.** The queue is ordered by the time the server receives each raise, held in Valkey. Lowering a hand removes it, and raising again puts it last. A learner without a seat gets `409 {"error":"Take a seat to raise your hand."}`. A learner who leaves the session (past the reconnect grace) leaves the queue.

**DP-14 Taking hands.** `hands/next` (teacher or co-teacher) takes the first hand in the queue. That learner's hand goes down on every page, and everyone hears that they have the floor. With an empty queue it answers `409 {"error":"No hands are raised."}`. Every hand taken counts towards the summary's `handsTaken`.

**DP-15 Lesson files.** `POST .../files` appends files in request order: slides after the existing slides, models after the existing models.
- A file's kind is judged by its first bytes, never by its name or declared type. A slide is PNG or JPEG. A model is a glTF binary (starting with `glTF` and declaring version 2).
- A slide may be up to `SLIDE_MAX_BYTES` bytes and a model up to `MODEL_MAX_BYTES` bytes, each limit itself allowed.
- A lesson holds at most `SLIDES_MAX_PER_LESSON` slides, counting existing and new.

Files are checked one at a time in request order, and the first refused file decides the answer. For each file, its kind is judged first, then its size against the limit of that kind, then the slide count:
- `422 {"error":"<file> isn't a PNG, JPEG or glTF binary."}` for a file of no accepted kind, whatever its size.
- `413 {"error":"<file> is larger than the limit."}` for a slide over `SLIDE_MAX_BYTES` or a model over `MODEL_MAX_BYTES`. A PNG or JPEG is always a slide and is judged by the slide limit, even when it would fit the model limit.
- `422 {"error":"A lesson holds at most <max> slides."}`

`<file>` is the file name as sent, and `<max>` is the configured slide limit. A request with no file parts answers `422 {"error":"Choose at least one file."}`. If any file is refused, the request saves nothing. `PUT .../order` must list every slide id of the lesson exactly once, otherwise `422 {"error":"List every slide once."}`. An id in `slideIds` that is not a slide of this lesson (unknown, another lesson's, another world's, or a model's) is part of that check and answers the same 422, never 404.

**DP-16 Confirmed files and the ready state.** A lesson is `draft` until marked ready. It is `uploading` while any of its files is pending, then returns to `draft`. It is `ready` once marked. Each accepted file is written to MinIO, and its record stays `pending` until MinIO confirms the object is stored with the same byte count. Only then does it become `confirmed` and count in the lesson. If any write in a request fails, every pending record and stored object from that request is removed. Marking ready answers:
- `409 {"error":"Some files aren't confirmed yet."}` while any file is pending.
- `409 {"error":"Add at least one slide first."}` with no slides.

Adding files to a `ready` lesson makes it `uploading` and then `draft` until it is marked ready again. Reordering keeps its state. Removing the last slide makes it `draft`. While a session of the lesson is live or in breakouts, adding, removing or reordering files answers `409 {"error":"This lesson is being taught right now."}`. The model on show in a session is the lesson's first model, or none.

**DP-19 Polls.** A teacher or co-teacher opens a poll while the session is live or in breakouts. The question must be 1 to 200 characters. There must be 2 to 6 options of 1 to 80 characters each, all different when compared ignoring case. The checks run in this order:
- `422 {"error":"Write a question of 1 to 200 characters."}`
- `422 {"error":"Give 2 to 6 options."}`
- `422 {"error":"Each option needs 1 to 80 characters."}`
- `422 {"error":"Options must be different."}`

A session has at most one open poll, and opening another answers `409 {"error":"Close the open poll first."}`. A learner answers once, and answering again replaces the earlier answer. Answering a closed poll answers `409 {"error":"This poll is closed."}`, and an option number outside 1 to the option count answers `422 {"error":"No such option."}`. Live counts are kept in Valkey. The teacher and co-teachers see them change, and learners see results only after the poll closes. Closing a closed poll answers the same closed 409.

**DP-20 Poll percentages.** Closing a poll writes its final tally to Postgres once, from the live counts. Each option's percentage is its answers divided by all answers, times 100, rounded half up to a whole number. The percentages may not add up to 100. With no answers, every option is 0%. Worked examples: 1 of 3 → 33%, 2 of 3 → 67%, 1 of 8 → 13% (12.5 rounds up), 3 of 8 → 38%, 4 of 8 → 50%.

**DP-22 Breakout split.** The teacher chooses k tables, from 2 up to the number of tables in the room, otherwise `422 {"error":"Choose 2 to <n> tables."}` where `<n>` is the room's table count. Learners in seats are ordered by seat id and dealt one at a time to T1, T2, up to Tk, then back to T1. Worked examples: 7 learners into 3 tables gives T1 3, T2 2 and T3 2. 5 into 2 gives T1 3 and T2 2. Learners keep their home seats throughout. Each round counts towards the summary's `breakoutRounds`.

**DP-23 Breakout deadline.** The server sets the deadline `BREAKOUT_SECONDS` after the start, on the world clock, and holds it in Valkey and Postgres. Each Add 2 minutes (teacher only) moves the deadline later by exactly `BREAKOUT_EXTEND_SECONDS`. An extend that arrives while the session is not in `breakouts` answers `409 {"error":"Breakouts are over."}` in place of the DP-10 state 409. This covers an extend that arrives at or after the deadline, including after the clock route has already returned the session to `live`, and an extend when no round is running.
- **Warning.** When the time left first becomes `BREAKOUT_WARNING_SECONDS` or less (that edge included), the server announces the warning to everyone and sets `warning` true. An extension that takes the time left back above the edge clears `warning`, and the warning fires again at the new edge. If the clock jumps past the deadline itself, only the return happens.
- **Return.** At the deadline (that instant included), the session goes back to `live`, everyone is back in their home seat, and the return is announced.
- **Browser timer.** The page counts down from the server's `remainingSeconds`, using page-clock time elapsed since that message. It never compares the device clock with the deadline. It stops at `00:00` and waits for the server's return. The timer's urgency follows the server's `warning` only.

**DP-24 Table chat.** While breakouts run, a dealt learner reads and posts only to their own table's chat. Another table's chat answers 404, and so does any table chat for a learner who was not dealt. The teacher and co-teachers read every table, and the teacher may post to any table. Text must be 1 to `CHAT_MAX_CHARS` characters after trimming, otherwise `422 {"error":"Write 1 to <max> characters."}` where `<max>` is the configured limit. A post arriving at or after the deadline, or when no breakout is running, answers `409 {"error":"Breakouts are over."}`. Messages are stored in Postgres and stay readable by the teacher after the round.

**DP-26 Class time zone.** A class's `timeZone` is an IANA zone name. A session's `startsAt` and `endsAt` are local wall times in that zone, sent as `YYYY-MM-DDTHH:MM` with optional `:SS`, and returned with seconds alongside their UTC instants. The server runs in UTC but decides every class time in the class's own zone. For example, 2027-03-09T19:00 in America/Chicago is 2027-03-10T01:00:00Z. The refusals are:
- A badly formed time: `422 {"error":"Use a date and time like 2027-03-09T19:00."}`
- An end not after the start: `422 {"error":"End the session after it starts."}`
- A local time skipped by a daylight-saving change: `422 {"error":"That time doesn't exist in <timeZone>."}`

A local time that happens twice takes its first occurrence.

**DP-27 Attendance.** The roster of a session is every learner who joined it, plus any learner the grading setup lists for it. A learner is present while at least one of their WebSocket connections to the session is open on either instance. Their presence intervals come from the server's connection times on the world clock. When the last connection closes, the leave is final only once `RECONNECT_GRACE_SECONDS` have passed without a reconnect. Until then the seat, hand and spotlight are kept. A presence interval that the grading setup creates with `leftAt` null stays open with no grace running. That learner counts as present (online, keeping their seat and hand, and able to be spotlit) until a real WebSocket connection of theirs to the session opens and then closes. After that, the grace applies as usual. Ending the session closes such an interval at the end time, like any open interval.

When intervals are worked out, a gap shorter than `RECONNECT_GRACE_SECONDS` joins two intervals into one visit. A gap of exactly the grace counts as leaving. `visits` is the number of visits after joining gaps. A learner still connected when the session ends leaves at the end and is never left early. The marks are decided as follows:
- **On time:** the first join is at or before the start plus `LATE_AFTER_MINUTES` minutes.
- **Late:** the first join is after that.
- **Left early:** the last leave is before the end minus `LEFT_EARLY_MINUTES` minutes (exactly that many minutes before is not early).
- **Absent:** the learner never joined.

The status is `present`, `late`, `left_early`, `late_left_early` or `absent`, shown as `Present`, `Late`, `Left early`, `Late, left early` and `Absent`. `firstJoined` and `lastLeft` are local wall times with seconds in the class zone, or null for absent learners. Worked examples for a 19:00–20:30 session in America/Chicago, with the default settings: joined 19:05:00 → on time, joined 19:05:01 → late, last left 20:20:00 → not early, last left 20:19:59 → left early. Attendance and the summary are available only after the session ends, otherwise `409 {"error":"Attendance is ready when the session ends."}`.

**DP-28 Summary.** The summary has the count of each status, each poll's final tally and percentages in the order the polls were opened, `handsTaken` and `breakoutRounds`, all read from what Postgres recorded when the session ended. Attendance, the summary and the summary page are open to the owner and co-teachers. A learner who can open the session (DP-33) gets the role 403 from both APIs, and the summary page shows its text in the page's alert. Any other learner, whether enrolled in the class or not, gets 404 from both APIs and the not-found page.

**DP-31 Spotlight.** A teacher or co-teacher spotlights one learner of the session at a time. Spotlighting another moves it, and `null` clears it. A `learnerId` that is not on the session's roster answers 404. A learner on the roster who is not currently present answers `409 {"error":"That learner isn't in the room."}`. The spotlight clears when that learner leaves, past the reconnect grace.

**DP-32 Lock.** Only the owner locks and unlocks. While the class is locked, `POST /api/join` from anyone not already in the session answers `409 {"error":"This class is locked. Ask your teacher to let you in."}`. Learners already in the session can still reload and reconnect.

**DP-33 Roles.**
- **Owner:** everything in their class.
- **Co-teacher** (another teacher account the owner added): advance slides, take hands, run polls (open and close), spotlight, read attendance, summary, review and every table's chat. Not the room layout, uploads or lesson changes, scheduling, opening, starting or ending sessions, breakouts and extensions, posting to table chat, lock, or adding co-teachers.
- **Learner:** take and leave a seat, raise and lower their own hand, answer polls, read and post to their own table's chat, and review sessions they attended.

**What each person can open.**
- **Owner and co-teachers** can open their class and everything in it. A co-teacher's refused action answers the 403 from the error order.
- **Everyone else, learners included**, gets 404 from the class-level APIs (every path under `/api/classes/<classId>` and `/api/lessons/<lessonId>`) and the not-found page on the class page, room editor and lesson page. A teacher who is neither owner nor co-teacher also gets 404 from every session-level API and page of that class.
- **A learner** can open a session when they joined it through `POST /api/join`, or when the grading setup lists them for it with at least one presence interval. On a session they can open, the session-level APIs (every path under `/api/sessions/<sessionId>`, and `/api/polls/<pollId>` for that session's polls) answer a refused role with the 403 from the error order. The classroom page then shows that text in Class announcements. On a session they cannot open, every session-level API answers 404.
- **Reviews and file reads** follow DP-36.

**DP-36 Review.** A learner may open `/review/<sessionId>` and its API only for an ended session of a class they are enrolled in, where they have at least one presence interval. A session they did not attend answers 404, and so does any of its files. A session that has not ended answers `409 {"error":"Review opens when the class ends."}`. The owner and co-teachers may review any session of their class.

### Services (DP-16, DP-18, DP-35, DP-45)

**Postgres** (`DATABASE_URL`) is the durable record: teachers and their password hashes, sign-in sessions, worlds and their clocks, classes, enrolments, co-teachers, layouts, lessons and file records with their status, sessions in the class zone, learners, attendance intervals, polls and final tallies, breakout rounds and assignments, chat, and summaries. The app creates its schema idempotently every time it starts to serve.

**MinIO** (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`) stores every lesson file byte for byte as submitted, under the key `lessons/<lessonId>/<fileId>` in the private bucket, with the content type of its detected kind. The browser never loads MinIO addresses. It reads files only through `GET /api/files/<fileId>`, which checks access first. Removing a file deletes its object. When MinIO is unreachable, or the outage route says so:
- Uploads answer `503 {"error":"Files can't be saved right now. Try again in a minute."}`, with nothing half-saved.
- File reads and grading setup answer `503 {"error":"Files can't be loaded right now. Try again in a minute."}`.
- Health reports unavailable.

The first upload after MinIO returns works with no restart.

**Valkey** (`VALKEY_URL`) is the live bus that keeps both instances in step. The keys are:
- `sh:<sessionId>:seats`: hash of seat id → learner id.
- `sh:<sessionId>:seat-of`: hash of learner id → seat id.
- `sh:<sessionId>:slide`: string holding the current slide number.
- `sh:<sessionId>:hands`: list of learner ids in queue order.
- `sh:<sessionId>:poll:<pollId>`: hash of option number → count.
- `sh:<sessionId>:flags`: hash with `locked` (`0` or `1`) and `spotlight` (a learner id or empty).
- `sh:<sessionId>:breakout`: hash with `deadline` (ISO instant) and `tables`.
- `sh:<sessionId>:breakout:members`: hash of learner id → table id.
- `sh:<sessionId>:online`: set of currently connected learner ids.
- `sh:<sessionId>:heartbeat:<instance>`: key with an expiry of 30 seconds, refreshed every 10 seconds by each instance that has connections to the session.

Changes cross instances on the channel `sh:events`. A session's keys are deleted within 5 seconds after it ends, once Postgres has been written.

When Valkey is unreachable on an instance, or the outage route says so:
- Live actions there (seat, slide, hand, polls, spotlight, lock, breakouts, extend, chat posts) answer `503 {"error":"Live updates are paused. Try again in a moment."}`.
- That instance pushes a paused message to its own pages, which show the live-paused banner from Feedback states. Their board, seats and hands stay frozen on the last state they saw, instead of diverging.
- The other instance keeps working normally.

When Valkey returns, the instance reconnects within 5 seconds with no restart, or at once when the outage route sets `down` back to false. Its pages then receive the current snapshot, the banner goes, and `Live updates are back.` is announced.

### Seed data (DP-39)

The database, bucket and live bus start empty. Tests build worlds through `POST /api/grading/setup`. Every person, class and lesson below is invented. This is the reference world as a literal setup request:

```json
{
  "now": "2027-03-09T19:10:00-06:00",
  "teachers": [
    {"key": "ana", "email": "ana.reyes@corbel-slate.test", "password": "lamplight-0423", "displayName": "Ana Reyes"},
    {"key": "ben", "email": "ben.achebe@corbel-slate.test", "password": "lamplight-0424", "displayName": "Ben Achebe"},
    {"key": "clara", "email": "clara.holt@corbel-slate.test", "password": "lamplight-0425", "displayName": "Clara Holt"}
  ],
  "classes": [
    {"key": "spanish", "teacher": "ana", "coTeachers": ["ben"], "title": "Evening Spanish B1", "timeZone": "America/Chicago",
     "layout": {"columns": 8, "rows": 6, "pieces": [
       {"kind": "board", "column": 2, "row": 0},
       {"kind": "table", "column": 1, "row": 2},
       {"kind": "table", "column": 5, "row": 2},
       {"kind": "table", "column": 1, "row": 4},
       {"kind": "seat", "column": 0, "row": 2},
       {"kind": "seat", "column": 2, "row": 2},
       {"kind": "seat", "column": 4, "row": 2},
       {"kind": "seat", "column": 6, "row": 2},
       {"kind": "seat", "column": 0, "row": 4},
       {"kind": "seat", "column": 2, "row": 4},
       {"kind": "seat", "column": 7, "row": 5}]}},
    {"key": "law", "teacher": "clara", "coTeachers": [], "title": "Contract Law Seminar", "timeZone": "Europe/London",
     "layout": {"columns": 6, "rows": 4, "pieces": [
       {"kind": "board", "column": 1, "row": 0},
       {"kind": "table", "column": 1, "row": 2},
       {"kind": "seat", "column": 0, "row": 2},
       {"kind": "seat", "column": 2, "row": 2}]}}
  ],
  "lessons": [
    {"key": "week3", "class": "spanish", "title": "Week 3: At the restaurant", "slideCount": 3, "modelCount": 1},
    {"key": "week1", "class": "law", "title": "Week 1: Offer and acceptance", "slideCount": 2, "modelCount": 0}
  ],
  "sessions": [
    {"key": "tue", "class": "spanish", "lesson": "week3", "startsAt": "2027-03-09T19:00", "endsAt": "2027-03-09T20:30", "state": "live", "currentSlide": 1, "locked": false},
    {"key": "lastweek", "class": "spanish", "lesson": "week3", "startsAt": "2027-03-02T19:00", "endsAt": "2027-03-02T20:30", "state": "ended", "currentSlide": 3, "locked": false},
    {"key": "lawmon", "class": "law", "lesson": "week1", "startsAt": "2027-03-08T18:30", "endsAt": "2027-03-08T20:00", "state": "ended", "currentSlide": 2, "locked": false}
  ],
  "learners": [
    {"key": "mira", "displayName": "Mira Okafor", "session": "tue", "seat": "B1", "presence": [{"joinedAt": "2027-03-09T18:55:00-06:00", "leftAt": null}]},
    {"key": "jonas", "displayName": "Jonas Lindqvist", "session": "tue", "seat": "B3", "presence": [{"joinedAt": "2027-03-09T18:56:00-06:00", "leftAt": null}]},
    {"key": "priya", "displayName": "Priya Raman", "session": "tue", "seat": "B5", "presence": [{"joinedAt": "2027-03-09T18:57:00-06:00", "leftAt": null}]},
    {"key": "tomas", "displayName": "Tomas Ferreira", "session": "tue", "seat": "B7", "presence": [{"joinedAt": "2027-03-09T18:58:00-06:00", "leftAt": null}]},
    {"key": "hana", "displayName": "Hana Sato", "session": "tue", "seat": "D1", "presence": [{"joinedAt": "2027-03-09T18:59:00-06:00", "leftAt": null}]},
    {"key": "leo", "displayName": "Leo Brandt", "session": "tue", "seat": null, "presence": [{"joinedAt": "2027-03-09T19:06:00-06:00", "leftAt": null}]},
    {"key": "rosa", "displayName": "Rosa Delgado", "session": "lastweek", "seat": null, "presence": [{"joinedAt": "2027-03-02T19:05:00-06:00", "leftAt": "2027-03-02T19:40:00-06:00"}, {"joinedAt": "2027-03-02T19:41:29-06:00", "leftAt": null}]},
    {"key": "sam", "displayName": "Sam Whitfield", "session": "lastweek", "seat": null, "presence": [{"joinedAt": "2027-03-02T19:05:01-06:00", "leftAt": null}]},
    {"key": "tess", "displayName": "Tess Moreau", "session": "lastweek", "seat": null, "presence": [{"joinedAt": "2027-03-02T18:58:00-06:00", "leftAt": "2027-03-02T19:30:00-06:00"}, {"joinedAt": "2027-03-02T19:31:30-06:00", "leftAt": "2027-03-02T20:20:00-06:00"}]},
    {"key": "omar", "displayName": "Omar Haddad", "session": "lastweek", "seat": null, "presence": [{"joinedAt": "2027-03-02T18:59:00-06:00", "leftAt": "2027-03-02T20:19:59-06:00"}]},
    {"key": "yuki", "displayName": "Yuki Tanaka", "session": "lastweek", "seat": null, "presence": [{"joinedAt": "2027-03-02T19:07:00-06:00", "leftAt": "2027-03-02T20:15:00-06:00"}]},
    {"key": "ines", "displayName": "Ines Duarte", "session": "lastweek", "seat": null, "presence": []},
    {"key": "felix", "displayName": "Felix Grant", "session": "lawmon", "seat": null, "presence": [{"joinedAt": "2027-03-08T18:29:00+00:00", "leftAt": "2027-03-08T20:00:00+00:00"}]}
  ],
  "hands": [{"session": "tue", "learners": ["priya", "jonas"]}],
  "polls": [
    {"key": "bill", "session": "tue", "question": "Which word means the bill?", "options": ["La cuenta", "La mesa", "La carta"], "answers": {"mira": 1, "jonas": 1, "priya": 2}, "state": "open"}
  ],
  "breakouts": []
}
```

The answer has this shape (ids and codes are illustrative):

```json
{
  "worldId": "wld_7q2k",
  "teachers": {"ana": "tch_1", "ben": "tch_2", "clara": "tch_3"},
  "classes": {"spanish": {"id": "cls_1", "code": "K7M2QX"}, "law": {"id": "cls_2", "code": "R4TZ9P"}},
  "lessons": {"week3": {"id": "les_1", "slides": ["fil_1", "fil_2", "fil_3"], "models": ["fil_4"]},
              "week1": {"id": "les_2", "slides": ["fil_5", "fil_6"], "models": []}},
  "sessions": {"tue": "ses_1", "lastweek": "ses_2", "lawmon": "ses_3"},
  "learners": {"mira": "lrn_1", "jonas": "lrn_2", "priya": "lrn_3", "tomas": "lrn_4", "hana": "lrn_5", "leo": "lrn_6",
               "rosa": "lrn_7", "sam": "lrn_8", "tess": "lrn_9", "omar": "lrn_10", "yuki": "lrn_11", "ines": "lrn_12", "felix": "lrn_13"},
  "polls": {"bill": "pol_1"},
  "signInTokens": {"ana": "tok_a1", "ben": "tok_b2", "clara": "tok_c3", "mira": "tok_m4", "jonas": "tok_j5", "priya": "tok_p6",
                   "tomas": "tok_t7", "hana": "tok_h8", "leo": "tok_l9", "rosa": "tok_r10", "sam": "tok_s11", "tess": "tok_t12",
                   "omar": "tok_o13", "yuki": "tok_y14", "ines": "tok_i15", "felix": "tok_f16"}
}
```

Class codes are 6 characters drawn from the letters A to Z without I, L and O, and the digits 2 to 9.

For example, with the reference world at start:
- Evening Spanish B1 has seats B1, B3, B5, B7, D1, D3 and E8, and tables T1 (column 1, row 2), T2 (column 5, row 2) and T3 (column 1, row 4). B1 and B3 belong to T1, B5 and B7 to T2, D1 and D3 to T3, and E8 to no table.
- In `tue`, the hand queue is Priya Raman then Jonas Lindqvist. The teacher's poll counts are 2, 1, 0, and closing the poll gives 67%, 33% and 0%.
- Starting breakouts at 2 tables deals B1, B5 and D1 to T1, and B3 and B7 to T2.
- `lastweek` attendance reads:
  - Rosa Delgado: Present, 1 visit.
  - Sam Whitfield: Late.
  - Tess Moreau: Present, 2 visits.
  - Omar Haddad: Left early.
  - Yuki Tanaka: Late, left early.
  - Ines Duarte: Absent.
- Rosa may review `lastweek`. Ines and Felix get 404 there, and Mira gets 404 for `lawmon`.

## Technical requirements

### Deployment (DP-38)

The runtime is Node.js 22 with npm, and the source is TypeScript. `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm start"}
```

`serve` binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set. `GET /api/health` answers `200 {"status":"ok"}`. An instance that cannot reach Valkey or MinIO, or that the outage route has marked down, answers `200 {"status":"unavailable"}`, never 503. Every HTTP response carries the header `X-Slatehall-Instance: <INSTANCE_NAME>`.

Grading runs four extra serve instances alongside the primary, all sharing the same Postgres, MinIO and Valkey unless stated:

| Instance | Environment change | Tests reach it at | Purpose |
|---|---|---|---|
| second instance | `INSTANCE_NAME=b` | `APP_SECOND_URL` | healthy, for two-instance tests |
| short timers | `BREAKOUT_SECONDS=20`, `BREAKOUT_WARNING_SECONDS=5`, `RECONNECT_GRACE_SECONDS=3` | `APP_TIMERS_URL` | healthy, for real-time timer tests |
| MinIO down | `S3_ENDPOINT=http://127.0.0.1:9` | `APP_MINIO_DOWN_URL` | file storage unreachable from boot |
| Valkey down | `VALKEY_URL=redis://127.0.0.1:9` | `APP_VALKEY_DOWN_URL` | live bus unreachable from boot |

A teacher and learners may be connected to different instances. Everyone in a live session sees the same seats, slide, hands, poll counts, spotlight, lock and breakouts, whichever instance they use.

### Configuration and secrets (DP-40)

All configuration is read from the environment at start. No credential is hard-coded, and none is ever sent to the browser.

| Variable | Meaning | Default |
|---|---|---|
| `DATABASE_URL` | Postgres connection | none |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | none |
| `VALKEY_URL` | Valkey connection | none |
| `GRADING_KEY` | grading routes key; when unset, the grading routes answer 404 | none |
| `INSTANCE_NAME` | this instance's name | `a` |
| `APP_PUBLIC_PORT` | listen port | `4173` |
| `TZ` | process zone; the server runs in UTC | `UTC` |
| `BREAKOUT_SECONDS` | length of a breakout round, in seconds | `480` |
| `BREAKOUT_WARNING_SECONDS` | warning edge before the deadline, in seconds | `30` |
| `BREAKOUT_EXTEND_SECONDS` | Add 2 minutes extension, in seconds | `120` |
| `LATE_AFTER_MINUTES` | late edge after the local start, in minutes | `5` |
| `LEFT_EARLY_MINUTES` | left-early edge before the local end, in minutes | `10` |
| `RECONNECT_GRACE_SECONDS` | reconnect grace, in seconds | `90` |
| `SLIDE_MAX_BYTES` | largest slide, in bytes, inclusive | `5000000` |
| `MODEL_MAX_BYTES` | largest model, in bytes, inclusive | `10000000` |
| `SLIDES_MAX_PER_LESSON` | most slides in one lesson, inclusive | `40` |
| `CHAT_MAX_CHARS` | longest chat message, in characters, inclusive | `300` |

### Server boundary (DP-40)

- **Same origin only.** A state-changing request, or a WebSocket upgrade, whose `Origin` header names another origin answers `403 {"error":"Cross-site requests are refused."}` before any other check. There is no CORS.
- **JSON bodies.** A JSON body over 100,000 bytes answers `413 {"error":"That request is too large."}`. A JSON endpoint sent another content type answers `415 {"error":"Send JSON."}`.
- **Uploads.** An upload request over 250,000,000 bytes in total answers the same 413 before any file is read.
- **Files served.** The server never serves source files, the run manifest, package files, lockfiles, environment files, source maps or dependency folders. Those paths and every unknown `/api` path answer `404 {"error":"Not found."}`, and unknown pages show the not-found page. No page or script contains a credential or a service URL.
- **Boot without a service.** If Valkey or MinIO is unreachable at boot, the app still starts and serves, reports unavailable on health, and recovers on its own when the service returns, without a restart.

### Browser support and performance (DP-41, DP-43)

The app targets current Chromium at 375x812, 768x1024 and 1280x800, with pointer, keyboard and touch input, and with service workers blocked. With the reference world, the classroom page shows its mirror and controls within three seconds of navigation. The 3D view may finish loading after that, without blocking any control. Live changes reach every connected page within one second.

## Working rules

- IF-01: `/app/run.json` exists at the app root with string `install`, `build` and `serve` fields and `"_schema":"run-manifest-v1"`, and those commands alone install, build and serve the app.
- IF-02: `THIRD_PARTY_NOTICES.md` at the app root names every shipped package, meaning the production dependency tree from `npm ls --omit=dev --all --json`, with its version and licence.
- IF-03: Every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) is licensed MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or BlueOak-1.0.0.
- IF-04: The app uses only Postgres, MinIO and Valkey as backing services: no other database, cache, broker, mail or PDF service, and no file or in-memory stand-in for them.
- IF-05: The provided service configuration and its dev credentials are left untouched, and the app reads every service setting from the environment.
- IF-06: The browser loads nothing from outside the app's origin: no CDN scripts, web fonts, analytics or remote images.
- IF-07: A committed npm lockfile pins the dependency tree that `install` uses.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript, with no `any` used to get around the type checker.
- Names in the code match the domain terms of this brief: class, lesson, session, seat, table, hand, poll, breakout, spotlight, lock, attendance, world.
- Each domain rule is decided in exactly one place in the source, for example a session state change, the seat winner, the breakout split, poll rounding or an attendance status, and every caller uses that one decision.
- Every refusal comes from one consistent error shape, `{"error":"<text>"}`, with the texts this brief publishes.
- There is no abstraction with a single implementation, and no defensive check for a state the rules make impossible.
- There is no dead, commented-out or unreachable code.
- There are no features, endpoints or screens beyond this brief, and no state endpoint that fakes what the live bus or the object store hold.
