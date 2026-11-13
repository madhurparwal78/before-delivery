# Lowlamp Instruments Lowlamp Field Log

Lowlamp Field Log is a night-first observing log for one backyard deep-sky observer who works toward observing-program certificates. At the eyepiece, often with no signal, the observer logs each object with its UT time, seeing, transparency, optics and description, and sketches it on an eyepiece circle. The circle tracks the true field and the north and east directions for the optical train in use. The next morning, on a laptop, the same observer tidies the notes, checks what a program packet still lacks, renders the packet as a PDF and emails it to the program's volunteer coordinator. Programs revise their rules over time, so each observation is judged by the rule edition in force on the evening it was made. Build it as one web app backed by four services:

- Postgres for all records, including sign-in attempt counts.
- MinIO object storage for stroke files, sketch images and packet PDFs.
- The Gotenberg PDF renderer for packets.
- An SMTP mail server (Mailpit) for sending them.

Out of scope: coordinator accounts or any coordinator-side screen, sky charts, object finding or telescope control, social features, payments, and any datastore beyond Postgres and MinIO.

## Problem and users

Visual observers working toward a certificate record the same fields for every object: UT date and time, site, seeing, transparency, telescope, eyepiece and magnification, a written description and often a sketch. Some programs also ask for program-specific fields, such as a globular cluster's Shapley-Sawyer concentration class or a double star's measured separation and position angle. Programs revise their rules, and older observations count under the rules in force when they were made.

Most of this recording happens on red-lit paper at a dark site with no signal. The next day observers type it into a planner that sorts notes by session, so one object's notes from several years are hard to find. Sketches get redrawn onto templates or scanned separately. Nothing checks that the eyepiece circle's scale and the north/east marks match the optics used, and because optical trains flip or mirror the view, many sketches end up mislabelled. Local times after midnight, and on nights when clocks change, get written down wrong. Coordinators send packets back when fields are missing. The tools observers own today treat a sketch as an attachment, not as a measured drawing.

- **Observer (at the scope, weekly).** Logs and sketches each object at the eyepiece on a phone or a tablet mounted at the scope, often offline. Wears gloves and uses a dim red light, so works from the keyboard or with a finger or stylus. Wants to see progress toward a program certificate.
- **Home-desk observer (the same person the next morning, weekly).** On a laptop: signs in, tidies descriptions, looks at one object's history, sees what a packet still lacks, puts the pages in the coordinator's preferred order, renders the packet and sends it.
- **Program coordinator (occasional, no account).** Receives one complete, readable packet PDF by email and checks it without having to ask for missing fields. Relies on the sent PDF and the cited stroke files staying exactly as they were sent.

## Journeys

1. **Set up a kit.** A new observer starts on an empty account, signs up, and lands on Kit. They add a 10-inch telescope with its aperture typed in inches and watch the millimetre equivalent update as they type. They add an eyepiece and a Barlow. Pressing Enter repeatedly on a slow link adds one item, and focus returns to that form's first field. All three appear in the kit list and in the session optics pickers. Mistyped passwords on a later sign-in end in the published lock sentence, even for the right password. On a laptop another account used earlier, the kit, sites, programs and sessions on screen are only the signed-in account's own, online and offline, and an account change in one tab reaches every other open tab.
2. **Log and sketch at the scope.** The observer starts a session at a site, lands on its Session screen and picks the telescope, eyepiece, Barlow and train. Magnification, true field, exit pupil and orientation update with each pick, and a slow reply never undoes a newer pick. They start a new observation and enter the UT time, seeing, transparency and a description. They place stars on the eyepiece circle with the arrow keys, number keys and Enter, or draw with a finger or stylus. On a double star they switch to Measure and mark the pair, and the separation and position angle update as they mark. Pressing a bracket key swaps to the next eyepiece: the numbers count to their new values, the sketch rescales, and the compass and sketch turn or mirror when the train changes. Turning the phone or tablet on its side keeps every mark at its place on the sky. Opening another observation during a swap ends that swap at once and shows that observation's own optics. They save. After a reload the observation shows the same sketch and values.
3. **A night with no signal.** At a dark site the tablet has no signal, and the offline banner shows. Having been online once, the device already holds the whole account: every session, history and sketch opens, including ones never visited on this device. The observer starts a session and logs two sketched objects while the waiting-count line counts the queued changes, and the program counts, bar and checklist follow what they log. A reload keeps everything, including unsaved typing and marks. When signal returns:
   - the queue is sent in order;
   - one sentence per observation is announced;
   - the count line disappears;
   - each observation exists exactly once on the server.

   If storage refuses a queued sketch, the server changes nothing for that sketch, and it stays queued until storage is back. If their sign-in ended while they were away, the queue and any unsaved sketch stay on the device and the signed-out line offers Sign in. After signing in as the same account they land back on the same screen with their work restored, and the queue goes out.
4. **Two devices, one field.** The observer edits a description offline on the tablet. The next morning, before the tablet has synced, they edit the same description on the laptop. When the tablet reconnects, the newer laptop text is kept, the tablet announces that, and the tablet's form and history copy show the laptop's text without a reload. With two tabs open at the scope, both follow the same waiting count, each sync sentence appears once in each, and each change goes out once.
5. **Tidy notes at the home desk.** Signed out, the observer follows a saved link to M13's history on the laptop. Sign-in lands them on that same screen, which lists every M13 observation across years, newest first. They open the 2025 observation, which shows its own stored optics at once, lengthen its description and save. The history row and the observation show the new text.
6. **Follow a program and check a packet.** The observer follows a program and sees its checklist, counts, rule edition line and progress bar. They build a packet, and the packet screen lists the published problems for one observation made under the newer rule edition. Working only from the keyboard, they move a row into the coordinator's preferred order, remove the problem observation and check again, with focus landing on a published place after each action, and the packet shows as Checked. If another device changed the packet first, their action does nothing and the screen shows the packet's current state.
7. **Render and send.** The observer renders the checked packet. The Packet status panel moves from Rendering to Rendered and stays correct when they leave the screen, come back and reload. If they edit a cited observation while a render runs, check and render again, only the newest attempt becomes the packet's PDF. They look over the Paper preview pages, download the PDF, then press Send to coordinator and confirm in the dialog using only the keyboard. The panel shows Sending, then Sent, and the coordinator's message with the PDF attached is in the mail server, with the observer's name printed literally whatever it holds. If they leave the screen during a send, its answer waits for their return and the panel never offers a second send. If the renderer, mail server or storage is down, refusing or silent, they see the published outage copy and the packet stays in an honest state.
8. **Edit after sending, and delete a mistake.** After sending, the observer redraws a cited sketch. The sent packet still shows Sent, and its PDF and cited stroke file download byte for byte as sent. They build a new packet that cites the new stroke file. If storage refuses the redrawn sketch, it waits on the device and the observation stays as it was. They then find an observation they logged by mistake and delete it, at the scope or at home. Its row, stroke files and sketch images go, any unsent packet citing it loses the row and its PDF, a stale edit from the other device never brings it back, and an observation a sent packet cites is refused and its row returns.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Observer accounts** Observers sign up, sign in and sign out with a password and an email that is compared trimmed and lowercased, a sign-in session ends after its published lifetime, and every observer route except health, sign-up and sign-in answers 401 without a signed-in session, as specified in API.
- **DP-02 — Kit in millimetres or inches** Telescopes, eyepieces and Barlows are added to the observer's own kit, with telescope aperture accepted in millimetres or inches and stored in millimetres by the published conversion and ranges.
- **DP-03 — Setting up a kit** A newly signed-up observer adds a telescope in inches, an eyepiece and a Barlow on the Kit screen, sees the millimetre equivalent update while typing, and finds all three listed and offered in the session optics pickers.
- **DP-04 — Derived optics values and orientation** The server derives magnification, true field, exit pupil, aperture and orientation from the chosen telescope, eyepiece, optional Barlow and train with the published formulas, rounding and train table, and stores them on the session and the observation.
- **DP-05 — Live optics readout** Changing any optics picker updates the Optics readout in place with the published readout line before anything is saved, with no reload or submit.
- **DP-06 — Choosing optics at the scope** The observer starts a session, picks telescope, eyepiece, Barlow and train, watches the readout follow each pick, and finds the same values saved on the session by the server.
- **DP-07 — Field swap numerals** On an optics change the magnification and true-field numerals count from the old to the new values over the published count time.
- **DP-08 — Field swap scale and clipping** During the count all strokes and stars scale about the field centre by the ratio of old to new true field, and marks that fall outside the circle are clipped and reappear when a wider field returns.
- **DP-09 — Field swap orientation** Right after the scale change the north/east compass and every stroke, star and measured pair line turn and mirror to the new train's published orientation, and the compass's accessible name gives the new orientation sentence.
- **DP-10 — Field swap with reduced motion** With reduced motion the numerals, scale, compass and sketch orientation reach their new state in one frame and the Field announcements region reads the published swap sentence.
- **DP-11 — Swapping optics mid-sketch** The observer opens a sketched observation, swaps eyepiece with the bracket keys and changes the train; the field rescales, the compass and sketch reorient, the stroke file stays byte-identical and the new optics and derived values are saved.
- **DP-12 — Keyboard sketching and eyepiece keys** In the Field region the arrow keys move the sketch cursor by the published sky steps, 1 to 5 choose star brightness, Enter places a star or in Measure mode marks a pair point, Space activates a focused Sketch tools button, the bracket keys swap eyepieces and undo removes the last mark, whichever control in the region has focus, and none of these keys touch the field while a dialog is open.
- **DP-13 — Sketch tools** The Sketch tools toolbar offers Pencil and Star modes, Measure mode for double stars, three pencil widths, Undo and Clear sketch; Clear sketch asks for confirmation in a dialog that keeps keyboard focus inside it, where Enter acts on the focused dialog button, before erasing, and Undo after Clear restores all cleared marks in one step.
- **DP-14 — Touch and stylus sketching** A finger or stylus draws on the field circle, taps place stars in Star mode, and a two-finger pinch on the circle zooms neither the page nor the field.
- **DP-15 — Stroke files stored as submitted** Each sketch save stores the submitted stroke file and optional PNG byte for byte under content-addressed keys and serves the current stroke file back unchanged, and a save whose marks equal the last saved marks writes no new stroke file.
- **DP-16 — Sketching an object at the eyepiece** The observer logs a new object with its fields and a keyboard-placed star field, saves it, reloads, and sees the same sketch, fields and derived optics.
- **DP-17 — Offline banner and waiting count** Without signal the working screens show the published offline banner, and whenever changes are queued the published waiting-count line shows their number.
- **DP-18 — Usable without signal** After one online visit, the working screens open with no network, and sessions, observations and sketches saved offline survive a reload.
- **DP-19 — Logging a night without signal** Offline, the observer starts a session, logs and sketches two objects and reloads; on reconnecting the queue is sent in order, the count clears and both observations exist once on the server.
- **DP-20 — Ordered sync journal** The sync route applies a device's changes in array order and returns one result per change, and a batch the server refuses as too large splits and resends in order with the same op ids, as specified in API and Interactions.
- **DP-21 — Replayed changes never duplicate** A change replayed with the same client op id returns its stored result marked as replayed and never creates a second record, and a reused id with a different payload is rejected with 409.
- **DP-22 — Newest field edit wins and is reported** Observation fields edited on different devices resolve field by field to the latest edit time, and every value kept over, or replacing, another device's edit is reported in the change's result.
- **DP-23 — Sync results announced** When queued changes are sent, the Sync results region announces one published sentence per observation, including conflict and rejection sentences.
- **DP-24 — Reconciling tablet and laptop** A description edited offline on the tablet and later on the laptop resolves to the newer edit after the tablet syncs, and the tablet announces which value was kept and shows it without a reload.
- **DP-25 — UT times and evening dates** Observation times are entered and stored in UT within 18 elapsed hours of their session start and shown with the site's local time, and each session belongs to the published evening date.
- **DP-26 — One object's history** An object's history lists all of the observer's observations of it across every session and year, newest first, in the published row format with each row's local time and UTC offset.
- **DP-27 — Tidying notes at the home desk** On the laptop the observer opens M13's history, opens the 2025 observation, lengthens its description and sees the saved text in the observation and its history row.
- **DP-28 — Published completeness rule** An observation qualifies for a program only under the published completeness rule, and program progress, checklists and packet checks all use that same rule.
- **DP-29 — Program progress** Programs show each program's qualifying, total and required counts and whether the observer follows it, recomputed on every read.
- **DP-30 — Empty program list** An observer who follows no program sees the published empty-programs sentence in place of their program list.
- **DP-31 — Following a program** An observer with no followed programs follows Twelve Showpieces and sees its checklist, progress counts and progress bar reflect the observations they already have.
- **DP-32 — Packet drafts and rows** A packet is created as a draft from the observer's own observations for one program, and its rows can be replaced while it is a draft or checked.
- **DP-33 — Packet check and rejected reasons** Checking a packet moves it to checked only when every row passes the completeness rule and the certificate count is met, and otherwise answers 422 with the published reasons in the published order.
- **DP-34 — Edits return a packet to draft** Any applied edit to an observation cited by a packet that has not started sending returns that packet to draft, as qualified in Business rules.
- **DP-35 — Checking a packet** The observer builds a Globular Clusters by Hand packet, sees M2's problems listed, removes M2, checks again and sees the packet as Checked.
- **DP-36 — Packet PDF contents** A rendered packet is a PDF with a cover page and exactly one page per row carrying the published lines and the sketch drawn dark on white, as qualified in Services.
- **DP-37 — Rendered only when stored** A packet becomes rendered only after its PDF is written to storage under the published key and a follow-up read confirms its size and checksum, and its download returns those exact bytes.
- **DP-38 — Packet status that holds** The Packet status panel shows the newest packet state across its polling, a route change and a reload, and never lets an older answer replace a newer state or message, as qualified in Interactions.
- **DP-39 — Paper preview** The packet screen previews each packet page on a white paper field with the sketch in graphite strokes, in the same layout as the PDF.
- **DP-40 — Rendering a packet** The observer renders a checked packet, watches Packet status move from Rendering to Rendered, and downloads a PDF with the published pages.
- **DP-41 — Sending to the coordinator** Sending a rendered packet mails the stored PDF to the program coordinator with a copy to the observer, and the packet becomes sent only after the mail server accepts the message.
- **DP-42 — Send dialog by keyboard** Send to coordinator opens the Send packet dialog, where Tab and Shift+Tab wrap inside it, Escape closes it and focus returns to the opener, and Send now moves focus to the Packet status panel.
- **DP-43 — Exactly one render or send wins** Of simultaneous render requests, or simultaneous send requests, on one packet exactly one starts the transition and the others answer 409.
- **DP-44 — Sending a packet** The observer sends a rendered packet using only the keyboard, sees it as Sent, and finds the coordinator's message with the PDF attachment in the mail server.
- **DP-45 — Renderer outage** When the PDF renderer cannot be reached, rendering ends in render failed with the published renderer copy and a retry that succeeds once the renderer answers.
- **DP-46 — Mail outage** When the mail server cannot be reached, sending answers 503, the packet keeps its previous state and revision with nothing recorded as sent, and the published mail outage copy shows.
- **DP-47 — Storage outage** When storage cannot be reached, a sketch save that would apply answers 503 and stays queued on the device with the published storage copy, sketch reads answer 503, and rendering ends in render failed with the storage copy.
- **DP-48 — Starting and recovering with services down** The app starts and answers health while the renderer, mail server or storage is unreachable, and each feature recovers on the next action after its service returns, without a restart.
- **DP-49 — Meeting a mail outage** With the mail server down, the observer renders a packet, presses Send now, and sees the mail outage copy with the packet still Rendered, and no message is delivered.
- **DP-50 — Sent packets stay as sent, deleted observations leave** A sent packet's PDF and every stroke file it cites stay byte for byte as sent after later edits, which go into a new packet, while deleting an observation no sent or sending packet cites removes its stroke files, sketch images and any PDF that printed it, drops its row from citing packets and can never be undone by a late write, as qualified in Business rules.
- **DP-51 — Private to the owner** Every session, observation, kit item, site, stroke file, sketch image and packet answers the same 404 to any other account, including ids inside request bodies and sync changes.
- **DP-52 — Editing after sending and deleting a mistake** After sending, the observer redraws a cited sketch, finds the sent packet unchanged and still Sent, and builds a new packet that cites the new stroke file; then they delete a mistaken observation from a session row, see the row go and focus land on the next published row control, and find a delete of an observation the sent packet cites refused with its row back.
- **DP-53 — Run manifest and health** The app installs, builds and serves from the run manifest on the published port and answers the health route with the published body.
- **DP-54 — Server boundary** The server enforces the published body limits, content type, same-origin rule and error precedence, and never serves source, configuration or credentials.
- **DP-55 — Session screen at three widths** The session screen shows its published layout at 375x812, 768x1024 and 1280x800, and no screen overflows horizontally at those sizes.
- **DP-56 — Landing hero motion** The landing eyepiece view crossfades from M13 to Albireo to M51 on the published interval and holds still on M13 under reduced motion.
- **DP-57 — Feedback motion and focus** Buttons and rows give hover and press feedback within the published time, keyboard focus shows a visible white ring, and nothing else loops.
- **DP-58 — Night working screens** Working screens stay plum-black with surface-toned inputs, white sketches on the dark field, rows spaced without rules and at most one pink element per screen, as listed in Visual design.
- **DP-59 — Landing page composition** The landing page shows the wordmark, tagline, plinth with the eyepiece view, Start a log button and the white demonstration field in one column, as described in Visual design.
- **DP-60 — Real services from configuration** The source talks to Postgres, MinIO, the PDF renderer and the SMTP server through the configured environment variables, with no stand-in state and no credentials in the browser.
- **DP-61 — Sign-in lock** Five failed sign-ins for one email within the published rolling window lock that email, known or unknown, so every sign-in for it answers 429 with Retry-After and the published sentence until the lock ends, even with the correct password and under parallel attempts, as qualified in Business rules.
- **DP-62 — Latest optics pick wins** A server reply for an older optics change never repaints the pickers, readout, compass or field, and never starts a swap or announcement, while a newer optics change for that session or observation is queued or in flight, as qualified in Interactions.
- **DP-63 — Local times with their offset** Every session start and observation carries the site zone's UTC offset at that exact instant, shown beside its local time on screen, in history rows and in the PDF, so repeated local times on the night clocks fall back are told apart.
- **DP-64 — Program rule editions** Each program publishes dated rule editions, and every observation is judged by the edition in force on its session's evening date, including the concentration class and the measured pair where that edition requires them, as qualified in Business rules.
- **DP-65 — Simultaneous syncs keep every field** Simultaneous changes to different fields of one observation both apply with consecutive versions, and simultaneous changes to the same field resolve by edit time alone, whatever order they arrive in.
- **DP-66 — Honest Sending state** From Send now until the send answers, Packet status shows Sending with no Send to coordinator button and the browser makes exactly one send request; it shows Sent only after success and returns to the previous label with the mail outage copy on a 503.
- **DP-67 — Signed out with changes waiting** When a sync answers 401 the journal and unsaved work stay on the device, automatic sends stop and the published signed-out line offers Sign in, and after the same account signs in the app lands back on that screen, restores the unsaved work and sends the journal in its original order, under that account only.
- **DP-68 — Device copy follows the server** Each sync result's body replaces the device's copy of each field in the form, session list and history copy without a reload, except a field with unsaved typing or a later queued change, and a rejected update rolls back while a rejected create leaves no ghost row and keeps its values in an open form, as qualified in Interactions.
- **DP-69 — Client op ids per account** Client op ids are scoped per account, so one account's op id is a new change for another account and never returns the first account's stored result.
- **DP-70 — Published landing routes** Sign-in, sign-up, sign-out, Start session and every signed-out or signed-in visit to a guarded screen land on the published route, a sign-in honours only a safe next path, and reloading the landing address shows the same screen.
- **DP-71 — Opening an observation is not an optics change** Opening an observation sets the published address and shows its stored optics in one frame with no swap, no optics announcement and no queued change, and a reload keeps it open.
- **DP-72 — Follow and Unfollow keep the newest press** Follow and Unfollow respond at once, the newest press stands on screen and on the server even when replies arrive late, a failed press restores the last server state with the published sentence, and syncs refresh open program counts in place, as qualified in Interactions.
- **DP-73 — Stale packet actions and packet numbers** Rows, check, render and send carry the revision the observer saw, a legal action on an old revision answers 412 and an illegal one 409 with nothing changed and the screen showing the current state, and simultaneous creates receive distinct consecutive packet numbers with no gaps.
- **DP-74 — Only the newest render counts** A render's result applies only to the attempt that started it, whichever app instance started either attempt, so only the newest attempt can become the packet's state and its one stored PDF.
- **DP-75 — A stale tab cannot send the wrong thing** A page acting on a packet another device has already sent or re-rendered sends nothing, repaints the current state and shows the published sentence, while this device's own send answer always applies to its panel.
- **DP-76 — Sending with storage down** When the stored PDF cannot be read, sending answers 503, the packet keeps its state and revision, no message goes out, and the published storage sentence shows.
- **DP-77 — A failed sketch read is never an empty sketch** When a sketch cannot be read and the device holds no copy, the published sentence shows, marking is disabled, other fields still save without touching the stroke file, and a failed PDF download stays on the packet screen with the published sentence.
- **DP-78 — Interrupted Field swap** A new pick during a swap continues from the displayed values, scale and orientation, and only the newest pick ends with a compass name and an announcement.
- **DP-79 — Marks and pairs map back to the sky** Marks placed by pointer or keyboard under any train and field are stored at their correct sky coordinates by the published projection, the keyboard cursor keeps its sky position, and a measured pair's separation and position angle update as it is marked and come out the same under every train, as qualified in Business rules.
- **DP-80 — Second touches and stylus contacts** A second finger landing during a finger stroke discards that stroke with no undo entry, a pinch in Star mode places no star, and touches on the circle are ignored while a pen is down.
- **DP-81 — Published layouts on other screens** Object history, Program, Programs, Kit and Packet show their published layouts at 375x812, 768x1024 and 1280x800, and every tappable control on every working screen is at least 44 by 44 px at each size.
- **DP-82 — Kit and account copies belong to one account** Kit, site, program and session copies kept for offline use are stored and served per account, so after another account signs in on a device only that account's data shows, online and offline, a reply to a request made under an earlier account paints nothing, and authenticated reads follow the published caching rule.
- **DP-83 — A swap never outlives its subject** Open, New observation, a route change or a reload during a Field swap ends that swap in that frame with no later repaint, compass name change or announcement, its queued changes are still sent, and a session optics reply changes the display only while no saved observation is open.
- **DP-84 — Packet actions keep the keyboard's place** After Remove, check, render, Try again or a stale repaint keyboard focus lands on its published target and never on the page body, each packet has one action in flight so a repeated press sends nothing more, and a packet's only row has no Remove button.
- **DP-85 — Packet status announces each outcome once** Packet status stays one element while the packet screen is open and is written only when its label or sentence changes, and polling uses one timer with at most one request in flight, running only while that screen is open and the packet is rendering or sending.
- **DP-86 — A send outlives the screen that started it** Leaving the packet screen during a send keeps the answer for that packet and paints no other screen, the panel holds Sending until the answer or a server-confirmed sent arrives, a reload never re-sends, and a dialog reopened during its exit stays open.
- **DP-87 — A sketch that storage refused changed nothing** A sketch.put is decided in the published order, so a discarded sketch answers 200 without contacting storage, and a storage 503 leaves the observation, every cited packet and the op journal unchanged so a retry with that op id runs as new.
- **DP-88 — The device holds the whole account** Within 10 seconds of the first online visit to any working screen the device holds the account's kit, sites, programs, every session and observation, every object history and every current stroke file, so those screens and sketches open offline even if never visited, and an id the device doesn't hold shows the published sentence instead of the Not found screen.
- **DP-89 — Offline progress computed on the device** While offline or with changes queued, Programs and Program recompute counts, bar and checklist in place from the device's copy plus its queued changes under the same completeness and edition rule as the server, and a rejected change rolls them back.
- **DP-90 — Two tabs share one journal and one sender** Tabs of one browser profile share the journal, so each tab's count and copy follow within 2 seconds, no change is in two requests in flight at once, each sync sentence appears once in each tab, and another open tab takes over within 40 seconds if the sender closes.
- **DP-91 — An account change reaches every tab** A sign-out or a sign-in as another account in one tab reaches every other open tab within 2 seconds, which shows none of the earlier account's data and never sends its journal, and the owner's work returns on their next sign-in.
- **DP-92 — Marking while the view moves** A pointer or pen landing during a Field swap finishes that swap in that frame and its mark maps through the newest projection, an optics change during a stroke ends the stroke with its points in the projections they were drawn under, and a pointercancel discards the stroke with no undo entry.
- **DP-93 — Unsaved work kept per observation** Unsaved form values, marks and the undo stack persist on the device per account and observation at each change, and return with the published sentence after a reload, Back, a route change or an Open elsewhere, as qualified in Interactions.
- **DP-94 — One request per form press** Each account, kit and site form has one request in flight, so repeated Enter or a double-click sends one request and one mistyped password costs one failed attempt, and focus and field values after each answer follow the published rule.
- **DP-95 — Session screen on its side** At 812x375 and 1024x768 the Session screen shows its published side-on layout, and changing viewport while idle or during a swap keeps every mark and the cursor at their sky positions and ends on the same final state.
- **DP-96 — Moving packet rows by keyboard** Draft and checked packet rows have Move up and Move down buttons that persist the order through the rows route with its revision, announce the new position, keep focus on that row and return a checked packet to draft, and the check's reasons and the PDF's pages follow that order.
- **DP-97 — US Letter pages, on paper and in preview** Packet PDF pages are exactly US Letter and each Paper preview page keeps exact US Letter proportions at its published width with all its content inside the page, even with a 4,000-character unbroken description and a sketch.
- **DP-98 — Names stay literal** Sign-up refuses display names outside 1 to 60 characters or holding control characters or line separators, and any other name reaches the coordinator and the PDF literally with no added recipient or header.
- **DP-99 — Refusing and silent providers** Storage that refuses a request, a renderer that answers anything but a success with PDF bytes and an SMTP server that sends no greeting within the published limit are treated as down, with the exact published body and copy within that limit and no provider message, host or stack.

## Frontend

### Screens and layout (DP-03, DP-06, DP-16, DP-19, DP-27, DP-31, DP-35, DP-40, DP-52, DP-55, DP-70, DP-81, DP-84, DP-95, DP-96, DP-97)

Every screen uses one column. At 768x1024 and 1280x800 the column is 520 px wide and its left edge sits at 22% of the viewport width. At 375x812 it spans the viewport with 16 px margins on each side. The eyepiece circle, forms, lists and banners all share the column's left edge. Only the footer line spans the full width. No screen scrolls horizontally at any of these viewports or the two side-on sizes in DP-95.

- **Landing (`/`).** Public. Shows the hero and the white demonstration field described in Visual design. Start a log goes to Sign up, or to Tonight when the observer is already signed in.
- **Sign up (`/signup`) and Sign in (`/signin`).** Plain labelled forms in the column. Form-level errors appear in the Account problem alert directly above the submit button.
- **Working screens.** Tonight, Session, Object history, Programs, Program, Packet and Kit. Each one opens with a navigation line at the top of the column, in muted ink, holding the links Tonight, Programs and Kit and a Sign out button. Under it come the screen's heading, then the offline banner, the signed-out line, the not-on-this-device sentence and the waiting-count line when they apply, then the content.
- **Tonight (`/tonight`).** A form to start a session (site picker and Start session), then the observer's sessions, newest first. Tonight has no optics pickers. A new session takes the default optics from Business rules, and the observer changes them on the Session screen. When the kit or site list can't support a session, Start session shows the Tonight sentence from Feedback states instead. Each row shows the evening date and site in ink and the observation count in muted ink.
- **Session (`/sessions/<session id>`, or `/sessions/<session id>?observation=<observation id>` with an observation open).** The heading reads `Session <evening date> · <site name>`. Below it, in order:
  1. The Field region: eyepiece circle with compass, Sketch tools, Optics readout and, for a double star, the Pair readout.
  2. The optics pickers.
  3. The observation form. Beside the UT field sits the local time line from DP-63. The Concentration class picker shows only when the chosen object is a globular cluster.
  4. The list of this session's observations, each with an Open button and a Delete button.

  New observation clears the form and the circle for a new object. An `observation` id that isn't in this session, or isn't the observer's, or has been deleted, shows the Not found screen, subject to the offline rule in DP-88.
- **Object history (`/objects/<object id>`).** The heading is the object's designation and name. Below it, one row per observation of the object, in the API's history order. Each row holds:
  1. The designation, in ink.
  2. In muted ink, `<evening date> · <HH:MM> local, UTC<offset> · <aperture> mm · <magnification>×`. `<evening date>` is `YYYY-MM-DD`, `<HH:MM>` and `<offset>` are the observation's `local_time` and `local_offset`, `<aperture>` follows the display rule in Business rules, and `<magnification>` is the whole stored magnification. The ` · <HH:MM> local, UTC<offset>` part is left out for an observation with no time.
  3. On the next line, in ink, the observation's full current description, wrapping as needed. This line is left out when the description is empty.
  4. `link "Open"` and `button "Delete"`.

  The screen reads the history from the server each time it opens, so a saved edit shows on the next visit. Offline, it shows the device's copy with its queued changes applied.

  For example, with the seed data at start, Rowan's first M13 row reads `M13`, then `2026-07-17 · 21:20 local, UTC-06:00 · 254 mm · 120×`. Rowan's first M15 row is the evening 2026-10-31 observation. Rowan's two M27 rows read, in order, `2026-10-31 · 01:25 local, UTC-07:00 · 254 mm · 200×` and `2026-10-31 · 01:25 local, UTC-06:00 · 254 mm · 200×`.
- **Programs (`/programs`).** A "Your programs" list of followed programs, or the empty-programs sentence when there are none. Then an "All programs" list. Each row shows the program name in ink, its counts line in muted ink, and a Follow or Unfollow button.
- **Program (`/programs/<program id>`).** In order: the progress bar, the counts line, and the edition line from Feedback states when the program has more than one edition. Then the checklist, with one row per program object. Each row holds:
  1. In ink, `<designation>, <name>`.
  2. In muted ink, either the object's representative qualifying observation (Business rules) as `<evening date> · <aperture> mm · <magnification>×`, or `not yet` when none qualifies. `<evening date>` is that observation's session evening date as `YYYY-MM-DD`. Checklist rows carry no local time.

  The screen ends with Build packet.

  For example, with the seed data at start, Rowan's Globular Clusters by Hand checklist shows:
  - M13: `2026-07-17 · 254 mm · 120×`
  - M5: `2026-07-17 · 254 mm · 48×`
  - M15: `2026-10-31 · 254 mm · 200×`
  - M2: `not yet`
- **Packet (`/packets/<packet id>`).** The heading reads `Packet <number> · <program name>`. Below it, in order:
  1. The Packet status panel.
  2. The rows, each with Remove and Move buttons while the packet is a draft or checked, under the presence rules in Public screens and controls.
  3. The Packet problems list, when a check fails.
  4. The action buttons.
  5. Once the packet is rendered, Download PDF and the paper preview.
- **Kit (`/kit`).** Forms to add a telescope, an eyepiece and a Barlow, then the kit list, a form to add a site, and the This device name field.
- **Not found.** Any unknown route shows the not-found sentence from Feedback states. So does any packet, session, observation or object route the signed-in observer doesn't own.

**Landing routes (DP-70).** The address bar shows these routes, and reloading or opening that address shows the same screen.

| Action | Landing |
|---|---|
| Visit to a working screen while signed out, with the exception in Interactions → Signed out with changes waiting | `/signin?next=<path and query>` |
| Sign in | the `next` path, or `/tonight` by default |
| Sign up | `/kit` |
| Sign out | `/` |
| Visit to `/signin` or `/signup` while signed in | `/tonight` |
| Start session | `/sessions/<session id>` |

`next` is honoured only for a path on this origin. After decoding, a `next` that is absolute, starts with `//` or `/\`, or names `/signin` or `/signup`, falls back to `/tonight`.

**Session screen, per viewport (DP-55, DP-95).** Except on a phone on its side, the field circle is exactly as wide as the column.

| Viewport | Field circle | Sketch tools | Optics pickers | Observation form |
|---|---|---|---|---|
| 375x812 (phone) | 343 px across, full column | One horizontal row directly under the circle, wrapping to further rows if needed | Stacked, one per row, in the order Telescope, Eyepiece, Barlow, Train | All fields stacked, one per row; Save observation spans the column |
| 768x1024 (tablet at the scope) and 1024x768 (tablet on its side) | 520 px across, full column at 22% of the viewport width | A vertical strip of square buttons 16 px to the right of the circle, top-aligned with it, fully inside the viewport | A two-by-two grid: Telescope and Eyepiece, then Barlow and Train | Fields stacked, except Seeing and Transparency side by side on one row |
| 812x375 (phone on its side) | 343 px across, its left edge 16 px from the viewport edge | A two-column grid of square buttons 16 px to the right of the circle, top-aligned with it, with the Optics readout under the tools | Stacked in a 343 px column from the circle's left edge, below the circle | All fields stacked in that same 343 px column |
| 1280x800 (home desk) | 520 px across, full column | One horizontal row directly under the circle | One row of four: Telescope, Eyepiece, Barlow, Train | Seeing and Transparency side by side on one row; the rest stacked |

At every viewport the top-to-bottom order is the same:
1. navigation line
2. heading
3. banners
4. circle
5. Sketch tools (beside the circle at 768x1024, 1024x768 and 812x375)
6. Optics readout and Pair readout
7. pickers
8. observation form
9. session observation list

At 812x375, moving focus to the Eyepiece field scrolls the whole circle into the viewport.

**Other screens, per viewport (DP-81).** At 1024x768 and 812x375 these screens use the 768x1024 layout.

| Screen | 375x812 | 768x1024 and 1280x800 |
|---|---|---|
| Object history, Program | The designation or name on one line, and the muted details starting on the next line | The muted details start on the same line as the designation or name, wrapping only if they run out of column |
| Programs | The button below the row text, spanning the column | The button at the row's right edge, on the row's first line |
| Kit | Every field stacked, one per row | Aperture beside Aperture unit, and Latitude beside Longitude, on one row each; other fields stacked |
| Packet | Action buttons stacked, each spanning the column; Paper preview exactly 343 px wide | Action buttons on one row; Paper preview exactly 520 px wide |

**Paper preview pages (DP-97).** Inside the Paper preview, each page of the PDF, cover included, is one `article "Page <n> of <total>"`, in PDF order. Each page is exactly the preview's width and that width × 11 ÷ 8.5 tall, within 1 px. Its content stays inside the page with nothing scrolling or clipped, even for a row with a 4,000-character unbroken description and a sketch, so the last description character is within the page.

### Public screens and controls (DP-05, DP-09, DP-10, DP-12, DP-13, DP-17, DP-23, DP-30, DP-31, DP-33, DP-38, DP-42, DP-52, DP-61, DP-63, DP-64, DP-67, DP-71, DP-72, DP-77, DP-79, DP-84, DP-85, DP-88, DP-93, DP-96, DP-97)

Only these roles and names are public. Everything else is free.

| Screen | Role and accessible name | Visible copy or content |
|---|---|---|
| Landing | `link "Start a log"` | Start a log |
| Landing | `img "Eyepiece view of <designation>"` | the hero canvas; `<designation>` is M13, Albireo or M51 |
| Sign up | `textbox "Email"`, `textbox "Password"`, `textbox "Your name"`, `button "Create account"` | |
| Sign in | `textbox "Email"`, `textbox "Password"`, `button "Sign in"` | |
| Sign up, Sign in | `alert "Account problem"` | the form-level account sentence (email taken, sign-in failed, too many attempts) |
| Working screens | `navigation "Main"` with `link "Tonight"`, `link "Programs"`, `link "Kit"`, and `button "Sign out"` | |
| Working screens | `status "Connection"` | holds the offline banner, the signed-out line with its `link "Sign in"`, the not-on-this-device sentence and the waiting-count line |
| Working screens | `status "Sync results"` | sync sentences |
| Tonight | `combobox "Site"`, `button "Start session"` | one Site option per site, labelled with the site name, in the order the sites were added |
| Tonight | `status "Tonight status"` | the Tonight sentences |
| Session | `region "Field"` | contains the circle, compass, Sketch tools, Optics readout and Pair readout |
| Session | `application "Eyepiece field"` | the field circle; focusable |
| Session | `img "Compass: <orientation sentence>"` | the N/E marks |
| Session | `toolbar "Sketch tools"` with `button "Pencil"`, `button "Star"`, `button "Measure"` (all with pressed state; Measure present only when the chosen object's kind is `double_star`), `button "Fine"`, `button "Medium"`, `button "Broad"` (pressed state), `button "Undo"`, `button "Clear sketch"` | |
| Session | `status "Optics readout"` | the readout line |
| Session | `status "Pair readout"` | the pair sentences; present only when the chosen object's kind is `double_star` |
| Session | counting figures inside `region "Field"`, each with `aria-hidden="true"` and no role or name | present only during a Field swap, in the forms given in Motion and effects |
| Session | `status "Field announcements"` | swap, star, edge-of-kit and sketch-read sentences |
| Session | `combobox "Telescope"`, `combobox "Eyepiece"`, `combobox "Barlow"` (first option `No Barlow`), `combobox "Train"` (options `Straight through`, `Mirror diagonal`, `Erecting prism`) | Telescope, Eyepiece and Barlow options are labelled with the kit item names. Telescopes and Barlows appear in the order added; eyepieces longest focal length first. |
| Session | `combobox "Object"`, `textbox "UT date and time"` (format `YYYY-MM-DD HH:MM`), `spinbutton "Seeing (1–10)"`, `textbox "Transparency (limiting magnitude)"`, `textbox "Description"` | Object options are labelled with the catalogue designation alone (for example `M13`, `Albireo`), in the catalogue order given in Seed data |
| Session | `status "Local time"` | the local time line beside the UT field |
| Session | `combobox "Concentration class"` | options `Not recorded`, `I`, `II`, `III`, `IV`, `V`, `VI`, `VII`, `VIII`, `IX`, `X`, `XI`, `XII`; present only when the chosen object's kind is globular |
| Session | `button "Save observation"`, `button "New observation"`, `button "Open <designation>"` and `button "Delete <designation>"` per list row | |
| Session | `status "Save status"` | save sentences |
| Session | `alert "Fix these first"` | one link per field error, each moving focus to its field |
| Session | `dialog "Clear sketch?"` with `button "Clear"` and `button "Keep sketch"` | |
| Session, Object history | `dialog "Delete observation?"` with `button "Delete"` and `button "Keep observation"` | its text names the designation and the evening date |
| Object history | `list "Observations of <designation>"`, one `listitem` per observation, each with `link "Open"` and `button "Delete"` | |
| Programs | `list "Your programs"`, `list "All programs"`, `button "Follow <program name>"` / `button "Unfollow <program name>"` | |
| Programs | `status "Programs status"` | follow sentences |
| Program | `progressbar "Progress toward <program name>"` | value is the qualifying count, maximum is the object total |
| Program | `status "Program rules"` | the edition line, present only for programs with more than one edition |
| Program | `list "Checklist"`, `button "Build packet"` | |
| Packet | `status "Packet status"` | the state label, then the packet state sentence or the message from the observer's latest action; a focus target (DP-84) |
| Packet | `list "Packet rows"`, `button "Remove <designation>"` | no Remove button on a packet's only row |
| Packet | `button "Move <designation> up"`, `button "Move <designation> down"` | present on draft and checked rows, Move up absent on the first row, Move down absent on the last, neither on an only row |
| Packet | `status "Packet rows status"` | the row-moved sentence |
| Packet | `list "Packet problems"` | one reason per item; a focus target (DP-84) |
| Packet | `button "Check packet"`, `button "Render packet"`, `button "Try again"`, `button "Send to coordinator"`, `link "Download PDF"` | |
| Packet | `region "Paper preview"`, holding `article "Page <n> of <total>"` per page | |
| Packet | `dialog "Send packet"` with `button "Send now"` and `button "Cancel"` | its text names the coordinator and the address |
| Kit | `textbox "Telescope name"`, `spinbutton "Aperture"`, `combobox "Aperture unit"` (options `mm`, `in`), `spinbutton "Focal length (mm)"`, `button "Add telescope"` | |
| Kit | `status "Aperture in millimetres"` | `<aperture mm> mm`, updated while typing |
| Kit | `textbox "Eyepiece name"`, `spinbutton "Eyepiece focal length (mm)"`, `spinbutton "Apparent field (°)"`, `button "Add eyepiece"` | |
| Kit | `textbox "Barlow name"`, `spinbutton "Barlow factor"`, `button "Add Barlow"` | |
| Kit | `textbox "Site name"`, `spinbutton "Latitude"`, `spinbutton "Longitude"`, `combobox "Time zone"`, `button "Add site"` | Time zone options are the IANA names listed in Business rules, each labelled with its name, in that order |
| Kit | `textbox "This device"` | the device name used in sync reports; defaults to `phone` under 600 px wide, `tablet` under 1024 px wide, otherwise `laptop` |
| Kit | `status "Kit status"` | kit sentences |

A packet action button is present only in the states that allow it:

| Button | Present in |
|---|---|
| Check packet | `draft` |
| Render packet | `checked` |
| Try again | `render_failed` |
| Send to coordinator | `rendered` and `send_failed`, except while a send is in flight (DP-66, DP-86) |

### Interactions (DP-05, DP-12, DP-13, DP-14, DP-15, DP-17, DP-18, DP-20, DP-23, DP-38, DP-42, DP-52, DP-62, DP-63, DP-66, DP-67, DP-68, DP-71, DP-72, DP-73, DP-75, DP-77, DP-79, DP-80, DP-82, DP-84, DP-85, DP-86, DP-88, DP-89, DP-90, DP-91, DP-92, DP-93, DP-94, DP-95, DP-96)

**Moving between working screens (DP-86).** The links Tonight, Programs and Kit, Open, Build packet, and the browser's Back and Forward move between working screens without a document load.

**Optics pickers (DP-05, DP-62).** Changing Telescope, Eyepiece, Barlow or Train does three things:
- It updates the Optics readout in place, using the DP-04 formulas held in the browser, so it also works offline. Within 100 milliseconds of the pick, the text content of `status "Optics readout"` is the complete final readout line for the new optics, including the new orientation sentence. That text does not change again during the Field swap. The counting figures described in Motion and effects are a visual copy, hidden from assistive technology and kept outside the status region's element.
- It runs the Field swap (Motion and effects).
- It queues a session optics change, plus an optics change on the open observation, through the sync journal.

The pickers, readout, compass and field always show the observer's newest local pick. When the server answers a `session.optics` or optics `observation.update` change, its returned optics and derived values replace the local ones only when no newer optics change for that same session or observation is still waiting in the journal or in flight, and within the DP-83 rule in Motion and effects. Otherwise the reply is ignored for display: it changes no picker, readout, compass or field scale, starts no Field swap, and announces nothing. Because the journal sends changes in order, the server ends on the newest pick.

For example, with the seed data at start, flicking Eyepiece from `25 mm wide` to `10 mm wide` to `6 mm` on Rowan's 10-inch Dobsonian under Straight through leaves the readout on the 6 mm line even when the 10 mm reply arrives last.

**Opening an observation (DP-71).** `link "Open"` on a history row and `button "Open <designation>"` on a session row go to `/sessions/<session id>?observation=<observation id>`, and a reload keeps that observation open. Its pickers, readout, compass and field show its stored optics in one frame. Opening queues nothing, sends no sync request, starts no swap and writes nothing to Field announcements or Sync results, even when its optics differ from the session's. The only sentence an Open can write is the DP-93 Save status sentence. New observation returns the address to `/sessions/<session id>` and the pickers, readout, compass and field to the session's current optics, also in one frame and also with nothing queued or announced.

**Keyboard in the Field region (DP-12).** These keys work while focus is anywhere inside `region "Field"`, including on a Sketch tools button:
- When an observation is opened or started, a white crosshair cursor sits at the field centre. Each arrow key moves it one arcminute on the sky in the arrow's direction on screen, and Shift with an arrow moves it five arcminutes. The cursor stops at the circle's edge. Cursor rules across trains and fields are in Business rules → Projection.
- `1` to `5` set star brightness (1 faintest, 5 brightest) and announce it.
- Enter places a star at the cursor with the current brightness and announces it, including with focus on a Sketch tools button. In Measure mode Enter instead marks a pair point at the cursor. Space activates a focused Sketch tools button.
- `]` swaps to the next shorter-focal-length eyepiece in the kit, and `[` to the next longer one. At either end nothing changes and the edge-of-kit sentence is announced. A bracket-key swap is an optics change and follows the newest-pick rule above.
- Ctrl+Z, or Cmd+Z on macOS, removes the last mark, the same as Undo.

While a dialog is open, none of these keys touch the field or the optics, and Enter acts on the focused dialog button.

The circle itself is reached with Tab. The tab order on the session screen is:
1. navigation
2. Eyepiece field
3. Sketch tools
4. pickers
5. form fields
6. Save observation
7. the session list

**Pointer, finger and stylus (DP-14, DP-80, DP-92).**
- In Pencil mode, dragging on the circle draws a stroke at the chosen width: Fine, Medium or Broad.
- In Star mode, a tap places a star at the current brightness.
- A two-finger pinch or spread on the circle changes neither the page zoom nor the field scale, and in Star mode it places no star.
- A second finger landing during a finger stroke discards that stroke and draws nothing further until both fingers lift. The discarded stroke leaves no undo entry.
- While a pen is down on the circle, touch contacts on the circle are ignored, so a resting palm neither draws nor interrupts the pen's stroke.
- A contact the browser cancels discards the stroke with no undo entry.
- The page doesn't scroll while a stroke is being drawn on the circle.
- Pinch-zoom elsewhere on the page works as normal.

Every mark is stored by the DP-79 mapping for the train and field on screen at that moment. Marking during a Field swap follows the rule in Motion and effects.

**Measuring a double star (DP-13, DP-79).** Measure mode is available only while the chosen object's kind is `double_star`.
- In Measure mode, Enter or a tap marks a pair point. The first mark is the primary star, the second the secondary star, and a line joins them. A third mark starts a new pair with that mark as its primary.
- `status "Pair readout"` updates in place on every mark, before anything is saved, with the pair sentences from Feedback states.
- A second mark at the primary's exact sky position does nothing.
- Each pair mark is one Undo step, and Undo returns the pair to what it was before that mark.
- Clear sketch leaves the pair alone, and the pair is not part of the stroke file. A save carrying a changed pair queues the pair on `observation.update` and adds no `sketch.put`.

**Local time line (DP-63).** As the observer types a UT date and time, the line beside the UT field shows the site's local wall clock and the site zone's UTC offset at that exact instant, in the format given in Feedback states. The browser computes it from the site's time zone, so it also works offline. An unparseable or empty UT value shows nothing.

**Clear sketch (DP-13).** Clear sketch opens `dialog "Clear sketch?"` with focus on Keep sketch.
- Tab and Shift+Tab wrap between its two buttons and never leave the dialog.
- Escape or Keep sketch closes the dialog and changes nothing.
- Clear removes every stroke and star. One Undo after Clear restores all of them in one step.
- Either way, focus returns to Clear sketch.

**Send packet dialog (DP-42, DP-66, DP-75, DP-86).** Send to coordinator opens `dialog "Send packet"` with focus on Send now.
- Tab and Shift+Tab wrap inside the dialog.
- Escape or Cancel closes it without sending and returns focus to Send to coordinator at once, before the dialog has finished disappearing.
- Pressing the opener again during a dialog's exit, here or on Clear sketch or Delete, leaves a newly opened dialog open, with focus where its opening rule puts it. The earlier exit never hides it.
- Send now closes the dialog, sends exactly one `POST /api/packets/<id>/send` carrying the revision on screen and moves focus to the Packet status panel.

From that press until the request answers, the panel shows the `Sending` label with the Sending sentence, and `button "Send to coordinator"` is absent. Further Enter presses, key repeat or a double-click therefore send nothing more.
- On 200 the panel shows `Sent`.
- On 503 it immediately shows the label of the state the packet had before the press (`Rendered` for a first send), at the same revision, with the mail outage or storage sentence that matches the error, and Send to coordinator is present again.
- On 502 it shows `Send failed` with the refused sentence.
- On 412 or 409 it follows the stale-action rule below.

**Leaving during a send (DP-86).** Leaving the packet screen doesn't lose an unanswered send. Its answer is kept per packet and paints nothing on the screen the observer is now on, which keeps its address and content.
- On returning before the answer, the panel shows `Sending` with no Send to coordinator button. A server answer at the previous state doesn't replace that `Sending`, so no second send can start. An answer showing `sent` does apply, because the server has confirmed it.
- On returning after the answer, the panel shows that answer's label and sentence, under the Packet status message rule.
- The server finishes a send it has started even if the browser goes away. A reload during a send shows the server's state and never re-sends.

**Saving an observation (DP-15).** Save observation validates in the browser first. On error, the Fix these first alert lists each message as a link and takes focus, and following a link focuses its field. Otherwise the save's changes (listed under Offline and sync) go into the device's journal and are sent at once when online. Save status announces the result, as set out in Feedback states.

**Unsaved work (DP-93).** Unsaved form values, marks and the undo stack are written to the device at each change, per account and per observation. Reload, Back, a route change or an Open of another observation doesn't lose them.
- Returning to that observation restores its fields, marks and undo stack, and `status "Save status"` reads the restored sentence from Feedback states. No sync request goes out.
- A reload on the session address with a never-saved new observation restores that new observation the same way.
- Save clears the draft.
- New observation abandons a never-saved new draft. A saved observation's draft stays for its return.

**Deleting an observation (DP-52).** `button "Delete <designation>"` on a session row and `button "Delete"` on a history row open `dialog "Delete observation?"` with focus on Keep observation. Tab and Shift+Tab wrap inside it. Escape or Keep observation closes it, changes nothing and returns focus to the opener.

Delete closes the dialog and queues the change listed under Offline and sync, online or offline. At once and on this device:
- The row leaves the session list and history copy, and the session's count falls.
- Program counts follow DP-89.
- If that observation was open, the address returns to `/sessions/<session id>` and the form to a new observation.
- Its draft is dropped.
- Focus moves as follows.

| Deleted from | Focus moves to |
|---|---|
| A session row | the next row's `Open <designation>`, else the previous row's, else New observation |
| A history row | the next row's `link "Open"`, else the previous row's, else `link "Tonight"` |

A delete the server refuses with a 409 puts the row back from the observation in that answer, restores the counts, and moves no focus. A delete answered 503 stays queued and the row stays gone on this device, with the storage sentence from Feedback states. An update, a sketch or a create on an observation the server answers `observation_deleted` for leaves no row: the row leaves the device's copy, and an open form returns to a new observation.

**Offline and sync (DP-17, DP-18, DP-20, DP-23).** The app treats the device as offline when the browser reports no network, or when a sync request fails to reach the server. Every session and observation write, online or offline, becomes a change in the device's journal. Changes stay there in order, surviving reloads, until the server stores a result for them. The waiting-count line counts the changes in the journal.

Each action queues exactly these changes:
- **Start session:** 1 `session.create` carrying the default optics from Business rules. The Session screen then opens with its pickers showing those optics. When the kit has no telescope or no eyepiece, or there is no site, Start session queues nothing, creates no session, stays on Tonight and shows the matching Tonight sentence.
- **Each optics change, by picker or by a bracket key:** 1 `session.optics`, plus 1 `observation.update` carrying only `optics` when the open observation has been saved at least once. A bracket key that changes nothing queues nothing.
- **Save observation on a new observation:** 1 `observation.create` with every filled field, plus 1 `sketch.put` when the circle holds at least one stroke or star.
- **Save observation on a saved observation:** 1 `observation.update` carrying only the fields changed since its last save (none when no field changed), plus 1 `sketch.put` when the sketch changed since its last save. A sketch whose marks equal the last saved marks, such as after placing a star and pressing Undo, has not changed, so no `sketch.put` is queued and no stroke file is written.
- **Delete in the dialog:** 1 `observation.delete`.
- **Pencil strokes, stars, pair marks, Undo and Clear:** nothing until Save observation.
- **Kit, site, program and packet actions:** never queued. They go straight to the server and need signal.

For example, starting a session and then saving two new sketched observations with no optics change shows `5 changes waiting to sync.`

Within five seconds of the network returning, the app sends all queued changes in order in one sync request of up to 200 changes; more requests follow if more are queued. It then:
- drops each change that got a stored result;
- keeps any change answered with 503;
- applies the DP-68 rules;
- updates the waiting-count line;
- announces the results.

A sync request answered with anything but 200, 401 or 413 keeps every change for the next attempt. While online, a journal that still holds changes is sent again every 30 seconds and on each new save.

**Batches too large to send (DP-20).** No request body the browser starts exceeds the sync limit in Server boundary, so it divides the journal before sending when needed. A sync request answered 413 splits in half, with the earlier half getting the extra change when the count is odd, and each part is sent again in order with the same client op ids. A single change answered 413 becomes a rejected change with the error code `too_large`, and follows the DP-68 rejection rules. Later changes still go out.

**The whole account on the device (DP-88).** Within 10 seconds of the first online visit to any working screen, without any further navigation, the device holds these for the signed-in account: kit, sites and programs; every session and observation; every object history; and every current stroke file. The copy refreshes after each sync while online, so an observation deleted elsewhere leaves it.

Offline, `/objects/m13`, `/programs/globulars-by-hand` and `/sessions/<session id>?observation=<observation id>` open with the right content and sketch, even if they were never visited. Offline, an address whose id the device doesn't hold shows the not-on-this-device sentence in `status "Connection"`, and the Not found screen doesn't show.

**Progress on the device (DP-89).** While the device is offline, or while the journal holds changes, Programs and Program recompute counts, bar and checklist in place, with no navigation, from the device's copy plus its queued changes, including queued deletes. They use the same completeness and edition rule as the server (Business rules). Otherwise they show the server's answer. A change the server rejects rolls the counts, bar and checklist back at once.

For example, with the seed data at start, offline, giving Rowan's newest M2 class `IV` and an 80-character description shows `6 of 6 objects · certificate at 5` on the Program screen, and the M2 row reads `2026-10-31 · 254 mm · 200×`. If the server then rejects that change, the screen returns to `5 of 6 objects · certificate at 5` and `not yet`. A 79-character description with class `IV` on that same M2 stays at 5 of 6.

**Tabs of one browser (DP-90).** Tabs of one browser profile share one journal and one sender.
- Saving in one tab updates the waiting-count line in every other open tab within 2 seconds, without a reload.
- No change is ever in two requests in flight at once, across tabs.
- Each open tab's `status "Sync results"` shows each sentence exactly once.
- Each tab's form, list and history copy follow the sync result in place within 2 seconds, with no Field swap and no Field announcement. The DP-68 exemptions apply per tab.
- If the sending tab closes with changes unanswered, another open tab sends them within 40 seconds with the same client op ids.

**The device's copy follows the server (DP-68).** Each sync result's `body` replaces the device's copy of each field at once, without a reload, in the form, the session list and the device's history copy. Two kinds of field are exempt: one the observer has typed in and not saved, and one with a later change still queued. The next change on that observation carries the returned `version` as `base_version`. The optics fields also follow the DP-62 rule.

When a result rejects a change (any 4xx):
- **Rejected update.** The changed fields go back to the last server values. A rejected `session.optics` returns the pickers, readout, compass and field to the last server values without a swap.
- **Rejected observation create.** The row leaves the session list and the session's count. Changes queued on that same observation, such as its `sketch.put` or `observation.delete`, add no second sentence, so there is exactly one rejection sentence, carrying the first error code. If that observation is open, its values and marks stay in the form as an unsaved new observation with a new id, so a later save creates exactly one observation.
- **Rejected session create.** The session row leaves Tonight and the session rejection sentence is announced. Each observation queued in it then follows the rejected-create rule above.

**Signed out with changes waiting (DP-67).** Sessions can end while a device is away. When a `POST /api/sync` answers 401:
- Nothing leaves the journal and the screen does not navigate.
- `status "Connection"` keeps the waiting-count line and adds the signed-out line with `link "Sign in"`, which goes to `/signin?next=<current path and query>`. The offline banner does not show, because this is not an outage.
- Automatic sends stop. No sync request goes out until a sign-in, including after a reload or as time passes.

Any other request answered 401 follows the same rule while the journal holds changes: the device's copy stays on screen with the signed-out line. When the journal is empty, a 401 on any request goes to the sign-in route from the landing table. While the device's last sign-in has not ended in a sign out, a working-screen visit with no network shows the device's copy for the account the device last had signed in, and never goes to sign-in. After an explicit sign out, none of this paragraph applies, and the sign-out rule in Whose device data it is decides instead.

On signing in as the same account, the app lands on `next`, restores unsaved form values and unsaved marks on the circle, and sends the journal within five seconds with the same client op ids and in the same order.

**Whose device data it is (DP-67, DP-82, DP-91).** The journal, device copies and unsaved work belong to the account that made them. Another account signing in on that device sees none of them and sends none of them. They reappear when the owner signs in again. Sign out keeps them, but no account's device copy shows until someone signs in. After an explicit sign out, every visit to a working screen goes to the sign-in route from the landing table, online or with no network and with or without waiting changes, and no automatic send goes out. With no network the sign-in form still opens, and pressing Sign in shows the no-network sentence from Feedback states in the Account problem alert.

Kit, site, program and session reads kept for offline use, wherever the browser keeps them, are stored and served per account. After a sign-out and another account's sign-in on one device, Kit, the Tonight Site picker, the Session pickers and Programs show only the new account's data, online and offline. A reply to a request made under an earlier account paints nothing, even when it arrives after the new account's screen has opened.

An account change in one tab reaches every other open tab within 2 seconds:
- After a sign-out in one tab, each other tab keeps its unsaved work on the device and lands on `/`, with none of the earlier account's data on screen.
- After a sign-in as another account in one tab, each other tab shows `/tonight` under that account.
- From the moment of the change, no tab sends the earlier account's journal under the new session.

**A failed sketch read (DP-77).** When an opened observation has a sketch, its strokes read answers 503 and the device has no copy of that stroke file:
- `status "Field announcements"` reads the sketch-read sentence from Feedback states.
- Pencil, Star, Measure, Undo and Clear sketch are disabled, and mark keys and pointer marks do nothing.
- Optics changes and other fields still work, and saving them queues no `sketch.put`, so the stored stroke file is untouched.
- Reopening the observation after storage answers shows the sketch and enables the tools.

**Packet status (DP-38, DP-75, DP-85).** The `status "Packet status"` element stays the same element for as long as a packet's screen is open. Its text is written only when the label or the sentence changes. A change of label and sentence lands as one update, so an identical answer writes nothing and the region is never emptied or left half-written between states.

While the packet is rendering or sending, and only while that packet's screen is open, the screen asks the server for it once a second, with one timer and at most one request in flight. Asking stops on any other state and when the screen is left. Returning to the screen, or reloading, shows the server's current state at once and resumes asking if the packet is still rendering or sending, without adding a second timer.

The panel always shows the highest packet revision it has seen, and an answer with a lower revision is ignored, so a late reply never turns Rendered back into Rendering. There are two exceptions, both for the rollback in the state machine:
- This device's own send answer always applies, even at a lower revision.
- A panel showing a `Sending` it didn't start applies an answer at the revision just before that `Sending`.

A message from the observer's latest action on that packet, such as the mail outage sentence, a renderer sentence or the stale-action sentence, shows in place of the state sentence and stays until either the observer's next action on that packet or a newer revision arrives. That holds through polling, leaving the packet screen and returning, and a reload. The device keeps the message per packet so it can survive these.

**Stale packet actions (DP-73, DP-75).** Remove, Move, Check packet, Render packet, Try again and Send now send the revision on screen. On a 412 or 409 the Packet screen repaints the state, rows and buttons from the server's current packet and shows the stale-action sentence from Feedback states. Nothing else happens. For example, a page still showing Rendered presses Send now after another device has sent: the panel shows `Sent` with no Send to coordinator button, and the mail server still holds one message.

**Moving packet rows (DP-96).** Move up and Move down swap a row with its neighbour by sending the new order through the rows route with the revision on screen. On success, `status "Packet rows status"` shows the row-moved sentence. A move on a checked packet returns it to draft under the state machine. The packet's next check lists reasons in the new row order, and its PDF prints pages in that order.

**Focus after packet actions (DP-84, DP-96).** Each packet has one action in flight at a time. While Remove, Move, Check packet, Render packet or Try again is unanswered, the pressed control keeps focus, and further presses of any packet action send nothing. When the answer arrives, focus moves as follows:

| After | Focus moves to |
|---|---|
| Remove succeeds | the next row's Remove, else the previous row's Remove, else Check packet |
| Move succeeds | the same direction's Move button on that row, or that row's other Move button when the same direction has disappeared |
| Check Packet fails with the incomplete 422 | `list "Packet problems"` |
| Check Packet passes, or Render packet or Try again is answered | `status "Packet status"` |
| A 412 or 409 repaint | `status "Packet status"` |

`list "Packet problems"` and `status "Packet status"` can both receive focus from these actions while staying out of the Tab order. An answer that changes nothing else, such as a 500 or no network, leaves focus on the pressed control. A polling repaint never moves focus or drops it to the page body.

**Download PDF (DP-77).** On a 200 the browser downloads the exact stored bytes under the published file name. On a 503 the app stays on the packet screen at the same address, and Packet status shows the download sentence from Feedback states.

**Programs (DP-72).** A Follow or Unfollow press moves the row between the lists and flips its button at once, without a reload, and the button stays enabled.
- Each program has at most one follow request in flight. When its reply arrives, the app sends the newest wanted state only if it differs from that answer, so the server ends on the newest press.
- Only the newest press's sentence shows, and an older reply repaints nothing.
- On a network failure or a 5xx, the row returns to the last server state and `status "Programs status"` shows the no-signal sentence, or the 500 sentence for a 5xx, from Feedback states. No later repaint overwrites that sentence until the next press.

While Programs or Program is open, a sync that applies queued changes updates the counts line, bar and checklist in place.

Build packet creates a draft packet and opens the packet screen. For each program object, the draft holds that object's representative observation, as defined in Business rules.

**Account, kit and site forms (DP-94).** Each of these forms has one request in flight. While one is unanswered, Enter, key repeat or a double-click sends nothing more, so one press adds one row, and one mistyped password counts as one failed attempt.
- After a 201 on a kit or site form, its text and number fields clear and focus moves to that form's first field.
- After a 422, the values stay and focus moves to the first invalid field.
- After a 5xx or with no network, the values stay and focus stays.
- After a sign-in 401 or 429, the answer's sentence shows in the Account problem alert, the typed email stays and focus stays.

**Kit.** With the unit set to `in`, typing in Aperture updates the Aperture in millimetres line on each keystroke, using the DP-02 conversion.

**Turning the device (DP-95).** Changing viewport while idle or during a Field swap keeps every stroke, star, pair line and the keyboard cursor at their sky positions, at any device pixel ratio, and a swap in progress ends on the same final state it would have reached. For example, with the seed data at start, Rowan's 2026 M13 star 10′ north stays at about 59% of the circle's radius from the centre, on the side its train names, at 812x375 as at 1024x768.

### Visual design (DP-17, DP-39, DP-58, DP-59, DP-81)

The direction is a quiet instrument: a night page that holds one measured drawing.

- **Typefaces.** Sora for everything, headings and body. Each heading step is a quarter larger than the step below it, starting from body size. Every number uses tabular (equal-width) figures and carries its unit: ×, ′, °, mm.
- **Colour roles.**
  - Ground: a deep plum-black.
  - Surfaces, such as inputs and the plinth: a slightly lifted plum.
  - Ink: pure white.
  - Muted text: a dusty mauve-grey.
  - Accent: a hot pink, with plum-black text on it.
  - Landing only: the demonstration band below the hero is a white field with near-black blue-ink text.

  All text meets WCAG 2.2 AA contrast against its background.
- **Density.** Airy, with generous space between blocks. List rows are separated by about 24 px of empty space, never by lines or rules.
- **Composition and hero (landing).**
  - The first screen is about four-fifths plum-black.
  - The wordmark "Lowlamp" sits at the top left, 56 px in from the edges, in Sora semibold and about 400 px wide. At 375 it scales down to the column width.
  - At the top right, right-aligned in small type, sits the line "A field log for people who still draw what they see."
  - In the column sits a rounded-square plinth in the lifted plum. It is column-wide and 440 px tall at 768 and 1280, and proportionally shorter at 375. It holds one procedurally drawn eyepiece view: white star dots and a soft glow inside a field circle.
  - A 240 px pink Start a log button sits 40 px under the plinth.
  - The landing page has no navigation bar.
  - Below the hero, the white middle field holds three small, exact demonstrations in the same column: an optics readout for one telescope and eyepiece, a north/east compass shown before and after a mirror diagonal, and one packet page drawn in graphite on white.
  - The footer line spans the full width.
- **Working screens.**
  - They stay on the plum-black ground at all times, with no white panels except the packet's Paper preview.
  - The field circle fills the column, with the optics line under it in muted ink. The optics line is the Optics readout, or the counting figures in its place during a Field swap.
  - Observation fields are plain labelled inputs on the lifted plum.
  - Inputs and buttons have 8 px rounded corners; nothing else is rounded.
  - In list rows the object name is in ink, and the date, aperture and magnification follow in muted ink, placed as in the DP-81 table. Object history rows add the description line from Screens and layout.
  - Banners, the signed-out line, the empty-programs sentence, the edition line, the account problem and validation errors are full-ink sentences at a little above body size, set in the column, never toasts in a corner.
- **One pink element per screen.** Every button other than the one listed here is lifted plum with ink text. Dialogs carry no pink.

  | Screen | Pink element |
  |---|---|
  | Landing | Start a log |
  | Sign up | Create account |
  | Sign in | Sign in |
  | Tonight | Start session |
  | Session | Save observation |
  | Kit | Add telescope |
  | Program | the progress bar (Build packet is lifted plum) |
  | Packet in draft | Check packet |
  | Packet in checked | Render packet |
  | Packet in render failed | Try again |
  | Packet in rendered or send failed | Send to coordinator |

  Programs, Object history, Not found, and a packet in rendering, sending or sent have no pink element.
- **The sketch as a negative.** In the app the sketch is white pencil and white star dots on the near-black field, which is what the eyepiece shows and which keeps the observer's dark adaptation. Star brightness 1 to 5 maps to five clearly different dot sizes. A measured pair is a thin white line between two small open rings. In the Paper preview and in the PDF, the same strokes and pair line print inverted, graphite on white, the way observers have always handed in sketches, with the N/E compass beside them.
- **Controls.** Every tappable control on every working screen, including navigation links, is at least 44 by 44 px at each viewport, and the Sketch tools buttons are 56 by 56 px.

### Motion and effects (DP-07, DP-08, DP-09, DP-10, DP-56, DP-57, DP-78, DP-83, DP-92)

Motion is rare and always means something. There are no decorative loops; the landing crossfade is the only repeating motion.

**Field swap, the signature (DP-07 to DP-09).** The field circle stays fixed at column width while the optics change. Every step starts quickly and eases into a soft stop.
1. **Numerals.** Over 320 milliseconds, the visible magnification and true-field numerals count from the old values to the new ones, showing whole numbers along the way (for example 48× to 120× and 84′ to 34′). The exit pupil counts in tenths. These counting figures are a visual copy shown where the readout sits, inside `region "Field"`. There are three of them, each its own element with `aria-hidden="true"`, and each element's whole text is one figure with its unit: `<whole number>×`, `<whole number>′` and `<one-decimal number> mm`. Each exists only during a swap. A figure whose value doesn't change, as on a train-only swap, holds steady.

   From the pick until the swap ends, the readout's status line is visually hidden, so only the counting figures show in that place. It is clipped out of sight, not removed and not hidden from assistive technology, and its status text already holds the final line, as set out in Interactions. After the 320 milliseconds the figures hold their new values through the orientation step. When the swap ends, about half a second after the pick, the figures are removed and the status line is visible again, showing the same values.
2. **Scale.** Over the same 320 milliseconds, every stroke, star dot and pair line scales about the circle's centre by the old true field divided by the new one. Marks that end up outside the circle are clipped at its edge, not deleted, and come back when a wider field returns. One swap's animated scale factor is limited to between one fifth and five times. A larger jump animates to the limit and then shows the exact final scale in the last frame.
3. **Orientation.** Over the next 180 milliseconds, the compass and every stroke, star and pair line rotate together by the difference between the old and new trains' rotations. When the mirroring changes, they also flip horizontally by narrowing to a line and reopening. At the end, the sketch sits exactly in the new train's projection from Business rules. The compass's accessible name changes to the new sentence at this moment, about half a second after the pick (320 plus 180 milliseconds), and not before. The readout's status text carries the new sentence from the moment of the pick.

   For example, with the seed data at start, Rowan's 2026-07-17 M13 holds a bright star 10′ due north of centre. At 120× and a 34′ field it sits below the centre under Straight through and above it after switching to Mirror diagonal, about 59% of the circle's radius from the centre each time.
4. **Announcement.** After the swap, the Field announcements region reads the swap sentence from Feedback states. The stroke file is never touched.

A swap starts only from a local optics pick, never from a server reply (DP-62) and never from opening an observation (DP-71).

**A new pick during a swap (DP-78).** The swap in progress stops where it is. The new swap continues from the values, scale and orientation on screen at that moment, with no jump back to the older state, and ends on the newest pick's values. The counting figures stay on screen and the status line stays visually hidden until the newest swap ends. Only the newest pick ends with a compass name change and an announcement; an interrupted pick produces neither.

**Marking while the view moves (DP-92).**
- A pointer, finger or pen landing on the circle during a swap finishes that swap in that frame, as if it had run to its end: the figures are removed, the final projection applies, and the compass name and announcement come at that moment. The mark maps through the newest projection.
- An optics change during a stroke, such as a bracket key with a finger down, ends the stroke at that moment. Its points so far keep the projection each was drawn under, it takes one undo entry, and nothing more draws until the contact lifts.
- Arrow keys and Enter during a swap don't finish it. They act on the sky-position cursor.

**A swap ends with its subject (DP-83).** Open, New observation, a route change or a reload during a swap ends that swap in that frame.
- The counting figures are removed and the status line is visible again.
- The field, compass and readout show the new subject's optics. For an observation with a queued optics change, that means the device's copy.
- The ended swap never announces, renames the compass or repaints later.
- The queued optics changes it made are still sent.
- A `session.optics` reply changes the display only while no saved observation is open. With one open, it updates only the device's copy of the session, and New observation then shows the session's newest optics.

A dialog opened during a swap stays open with its focus unchanged while the swap finishes behind it, and that swap still ends with its compass name and announcement.

**Reduced motion (DP-10).** When the observer prefers reduced motion, the numerals, scale, compass and sketch orientation show their final state in a single frame, and the same swap sentence is announced for each pick. No counting figures appear, and the readout's status line stays visible throughout. Everything else works the same.

**Landing hero (DP-56).** The eyepiece view shows globular cluster M13, then the double star Albireo (a gold and a blue star), then galaxy M51, each drawn to the same visual weight. Every 6 seconds it moves to the next object through a crossfade lasting about one second, and the sequence repeats. The image's accessible name follows the object shown. Under reduced motion it shows M13 and never changes.

**Feedback (DP-57).** Buttons and list rows brighten slightly on hover and dim slightly on press, settling within 80 to 150 milliseconds. Keyboard focus shows a 2 px white ring outside the control, with no animation. Dialogs appear and disappear in under a fifth of a second. Banners and sentences appear without sliding.

### Feedback states (DP-10, DP-12, DP-17, DP-23, DP-30, DP-33, DP-38, DP-45, DP-46, DP-47, DP-52, DP-61, DP-63, DP-64, DP-66, DP-67, DP-68, DP-72, DP-73, DP-75, DP-76, DP-77, DP-79, DP-88, DP-93, DP-94, DP-96, DP-98, DP-99)

Every string below renders character for character, with straight apostrophes.

Placeholders:
- `<designation>` is the object's catalogue designation, for example `M13`.
- `<date>` is the session's evening date as `YYYY-MM-DD`.
- `<number>` is the packet's number.
- `<n>` is a count written in digits.
- `<p>` is a row's new position, counted from 1.
- `<device>` is the other device's name.
- `<field>` is one of `UT time`, `seeing`, `transparency`, `description`, `optics`, `sketch`, `concentration class`, `measured pair`.
- `<magnification>` is a whole number, `<true field>` is whole arcminutes, and `<exit pupil>` has one decimal.
- `<separation>` has one decimal, and `<position angle>` is a whole number.
- `<sentence>` is the train's orientation sentence from Business rules.
- `<HH:MM>` is the site-zone wall clock.
- `<offset>` is the site zone's UTC offset at that instant, as `+HH:MM` or `-HH:MM` with an ASCII hyphen-minus (`+00:00` for UTC).

**Connection and sync** (`status "Connection"`, `status "Sync results"`)

| State | Copy |
|---|---|
| Offline banner | `You're offline. Everything you log is kept on this device and syncs when signal returns.` |
| Waiting count (1 change) | `1 change waiting to sync.` |
| Waiting count (more than 1) | `<n> changes waiting to sync.` (hidden at zero) |
| Signed out (1 change) | `You're signed out. Sign in to send 1 waiting change.` |
| Signed out (more than 1) | `You're signed out. Sign in to send <n> waiting changes.` |
| Offline, an id the device doesn't hold | `This isn't on this device yet. It needs signal.` |
| Observation synced | `<designation> (<date>) synced.` |
| Observation deleted | `<designation> (<date>) deleted.` |
| Conflict, this device's value lost | `Newer <field> from <device> kept.` (one sentence per field, after the synced sentence) |
| Conflict, this device's value won | `Replaced <field> from <device>.` (one sentence per field, after the synced sentence) |
| Change rejected, including a refused delete | `<designation> (<date>) did not sync (<error code>).` where `<error code>` is the result's `error` value |
| Session change rejected | `Session <date> did not sync (<error code>).` |
| Storage outage (a `sketch.put` answered 503) | `Sketch storage isn't answering. Your sketch is kept on this device and will upload when storage is back.` |
| Storage outage (an `observation.delete` answered 503) | `Sketch storage isn't answering. Your delete is kept on this device and will finish when storage is back.` |

Sync results announces changes that waited in the queue, and every delete result. That includes the storage outage sentences when a queued change is answered 503 again. A save made while online is announced in Save status, and its conflict and rejection sentences go to Sync results. When a change of an online save is rejected, Save status is left empty. When any change of an online save is answered 503, Save status shows the storage outage sentence instead of the saved sentence, and that change stays in the journal and counts in the waiting-count line.

**Field** (`status "Optics readout"`, `status "Pair readout"`, `status "Field announcements"`, `status "Local time"`)

| State | Copy |
|---|---|
| Readout | `<magnification>× · <true field>′ field · <exit pupil> mm exit pupil · <sentence>` |
| Pair, no point marked | `Mark the primary star.` |
| Pair, one point marked | `Mark the secondary star.` |
| Pair, both points marked | `Separation <separation>′ · Position angle <position angle>°` |
| After a swap | `Field now <true field>′ at <magnification>×. <sentence>` |
| Brightness chosen | `Brightness <n>.` |
| Star placed | `Star placed, brightness <n>.` |
| Last mark removed | `Removed the last mark.` |
| No shorter eyepiece | `No shorter eyepiece in your kit.` |
| No longer eyepiece | `No longer eyepiece in your kit.` |
| Sketch can't be read | `This sketch can't be shown while storage isn't answering. Nothing was changed.` |
| Local time line | `<HH:MM> local, UTC<offset>`, for example `01:20 local, UTC-06:00` |

**Saving** (`status "Save status"`; field errors appear in `alert "Fix these first"`, next to the field, and in the API `fields` object)

| State | Copy |
|---|---|
| Pending | `Saving <designation>.` |
| Saved on the server | `<designation> saved.` |
| Saved while offline | `<designation> saved on this device.` |
| Saved online, a change answered 503 by storage | the storage outage sentence from Connection and sync, in place of the saved sentence |
| Unsaved work restored | `Unsaved changes restored.` |
| `observed_at` | `Use a UT time during this session.` |
| `seeing` | `Seeing is a whole number from 1 to 10.` |
| `transparency_nelm` | `Transparency is a limiting magnitude from 1.0 to 8.0.` |
| `description` | `Keep the description to 4,000 characters or fewer.` |
| `concentration_class` | `Concentration class is I to XII, for globular clusters only.` |
| `pair` | `A measured pair is two different points, for double stars only.` |
| `optics` | `Choose a telescope and an eyepiece from your kit.` |
| `train` | `Choose a train from the list.` |
| `strokes` | `The sketch file is not a Lowlamp stroke file.` |
| `raster` | `The sketch image must be a PNG of 2,000,000 bytes or fewer.` |
| `started_at` | `A session can't start in the future.` |
| `object_id` | `Choose an object from the catalogue.` |
| `edited_at` | `The edit time is in the future.` |

**Accounts, kit and sites** (`alert "Account problem"`, `status "Kit status"` and field errors)

| State | Copy |
|---|---|
| Kit item or site added | `Added <name>.` |
| `email` | `Enter an email address.` |
| `password` | `Use at least 10 characters.` |
| `display_name` | `Enter your name as it should appear on packets.` |
| Email taken (409) | `An account already uses that email.` |
| Sign-in failed (401) | `That email and password don't match an account.` |
| Too many attempts (429) | `Too many sign-in attempts for this email. Wait 15 minutes and try again.` |
| `name` | `Give it a name of up to 60 characters.` |
| `aperture` | `Aperture must be from 25 mm to 1,600 mm.` |
| `focal_length_mm` (telescope) | `Focal length must be from 100 mm to 20,000 mm.` |
| `focal_length_mm` (eyepiece) | `Eyepiece focal length must be from 2 mm to 60 mm.` |
| `apparent_field_deg` | `Apparent field must be from 30° to 120°.` |
| `factor` | `Barlow factor must be from 1.1× to 5.0×.` |
| `latitude` / `longitude` | `Latitude must be from -90 to 90.` / `Longitude must be from -180 to 180.` |
| `time_zone` | `Choose a time zone from the list.` |

**Tonight** (`status "Tonight status"`)

| State | Copy |
|---|---|
| Start session, kit has no telescope or no eyepiece | `Add a telescope and an eyepiece in Kit before starting a session.` |
| Start session, no site | `Add a site in Kit before starting a session.` |

When both apply, only the kit sentence shows.

**Programs** (`status "Programs status"`, `status "Program rules"`)

| State | Copy |
|---|---|
| Empty Your programs list | `You're not following any program yet. Choose one below to start counting toward its certificate.` |
| Counts line | `<qualifying> of <total> objects · certificate at <required>` |
| Edition line | `Rules: edition <n> from <effective_from>. Earlier evenings count under edition <n-1>.` where `<n>` is the newest edition's number and `<effective_from>` is its date as `YYYY-MM-DD` |
| Followed | `Following <program name>.` |
| Unfollowed | `Stopped following <program name>.` |
| Follow or Unfollow with no network | `That needs signal. <program name> wasn't changed.` |

**Packets** (`status "Packet status"`, `status "Packet rows status"`; reasons in `list "Packet problems"`)

| State | Copy |
|---|---|
| Draft, `returned_to_draft` false (on load, reload, polling and after rows replaced) | `Draft. Check it before rendering.` |
| Draft, `returned_to_draft` true (on load, reload and polling) | `An observation in this packet changed, so it is back to draft.` |
| Row moved | `<designation> moved to position <p> of <n>.` |
| Check failed | `This packet can't be checked yet: 1 problem.` / `This packet can't be checked yet: <n> problems.` |
| Checked | `Checked: <n> observations ready to render.` |
| Rendering | `Rendering packet <number>. This can take a few seconds.` |
| Rendered | `Packet <number> is rendered and stored (<n> pages).` |
| Render failed, renderer | `The PDF renderer isn't answering. Nothing was rendered; press Try again when it's back.` |
| Render failed, storage | `Packet storage isn't answering. Nothing was saved; press Try again when it's back.` |
| Sending | `Sending packet <number> to <coordinator name>.` |
| Sent | `Packet <number> was sent to <coordinator name>.` |
| Mail outage (503) | `The mail server isn't answering. Packet <number> is still rendered and nothing was sent; try again later.` |
| Send with storage down (503) | `Packet storage isn't answering. Packet <number> is still rendered and nothing was sent; try again later.` |
| Download with storage down (503) | `Packet storage isn't answering. Packet <number> is safe; try Download PDF again when it's back.` |
| Send failed (refused) | `The mail server refused packet <number>. Nothing was delivered; press Send to coordinator to try again.` |
| Stale action (412 or 409) | `This packet changed somewhere else. Nothing was done; this is its current state.` |
| `revision` field error (API only) | `Send the revision you are acting on.` |
| State labels | `Draft`, `Checked`, `Rendering`, `Rendered`, `Render failed`, `Sending`, `Sent`, `Send failed`, shown above the sentence |

Packet-rejected reasons (`code` → `message`):

| Code | Message |
|---|---|
| `not_on_program` | `<designation>, <date>: not on this program's list.` |
| `duplicate_object` | `<designation>, <date>: only one observation per object.` |
| `missing_ut_time` | `<designation>, <date>: add the UT time.` |
| `missing_seeing` | `<designation>, <date>: add seeing from 1 to 10.` |
| `missing_transparency` | `<designation>, <date>: add transparency as a limiting magnitude.` |
| `missing_concentration` | `<designation>, <date>: add the Shapley-Sawyer concentration class.` |
| `missing_pair` | `<designation>, <date>: add the measured pair for this double star.` |
| `short_description` | `<designation>, <date>: the description needs at least <minimum> characters.` (`<minimum>` is the minimum of that row's rule edition) |
| `missing_sketch` | `<designation>, <date>: this program needs a sketch.` |
| `too_few` | `This packet has <n> qualifying objects; the certificate needs <required>.` |

**Everywhere else**

| State | Copy |
|---|---|
| Not found screen | `We couldn't find that here.` |
| Unexpected server error (500) | `Something went wrong on our side. Nothing was lost; try again.` |
| A kit, site, packet or sign-out action with no network, shown in that screen's status region (`status "Connection"` for sign-out, `alert "Account problem"` on account forms) | `That needs signal. Nothing was changed.` |

## Backend

### API (DP-01, DP-02, DP-15, DP-20, DP-21, DP-32, DP-33, DP-37, DP-41, DP-46, DP-50, DP-51, DP-53, DP-61, DP-63, DP-64, DP-69, DP-73, DP-76, DP-79, DP-82, DP-87, DP-96, DP-98, DP-99)

All routes are under `/api`. Request and response bodies are `application/json` unless stated otherwise. Body limits are in Server boundary. Signing in sets an HttpOnly, SameSite=Lax session cookie that lasts until sign-out or until the sign-in session ends, with the `Max-Age` set out under Business rules.

**Caching and request scope (DP-82).** Every authenticated `GET` answers `Cache-Control: no-store`. Its answer is computed from that request's session alone, so interleaved requests from different accounts each get only their own data.

**Error shape.** Every error body is `{"error":"<code>"}`. Validation errors are `422 {"error":"validation","fields":{"<field>":"<message>"}}`, with the messages from Feedback states. The incomplete, invalid-transition, stale-revision and refused-delete errors below add their own named key.

**Error precedence**, for the whole API:
1. 413 too large
2. 415 wrong content type
3. 403 cross-origin
4. 429 `{"error":"too_many_attempts"}` (sign-in only)
5. 401 (`{"error":"unauthenticated"}`, or `bad_credentials` on sign-in)
6. 404 `{"error":"not_found"}`: an unknown id, or one owned by another account, in the path or anywhere in the body
7. 409 state conflicts
8. 412 stale revision
9. 422 validation

Inside sync, a replay of a client op id the same account has already used returns its stored result before any 404, 409 or 422 check for that change. The rows below list only each route's own extra errors.

**Health and accounts**
- `GET /api/health`, no session needed → `200 {"status":"ok"}`.
- `POST /api/auth/signup` `{"email","password","display_name"}` → `201 {"account":{"id","email","display_name"}}`, and signs in. `409 {"error":"email_taken"}`. The returned and stored `email` is the normalised form from Business rules.
- `POST /api/auth/signin` `{"email","password"}` → `200 {"account":{...}}`.
  - `401 {"error":"bad_credentials"}`.
  - `429 {"error":"too_many_attempts"}` with a `Retry-After` header in whole seconds, under the DP-61 rule.
- `POST /api/auth/signout` → `204`.
- `GET /api/auth/me` → `200 {"account":{...}}`.

**Kit and sites**
- `GET /api/kit` → `200 {"telescopes":[{"id","name","aperture_mm","focal_length_mm"}],"eyepieces":[{"id","name","focal_length_mm","apparent_field_deg"}],"barlows":[{"id","name","factor"}],"trains":[{"id","name","rotation_deg","mirrored","sentence"}]}`. Eyepieces are sorted by focal length, longest first.
- `POST /api/kit/telescopes` `{"name","aperture","aperture_unit":"mm"|"in","focal_length_mm"}` → `201` telescope.
- `POST /api/kit/eyepieces` `{"name","focal_length_mm","apparent_field_deg"}` → `201` eyepiece.
- `POST /api/kit/barlows` `{"name","factor"}` → `201` Barlow.
- `GET /api/sites` → `200 {"sites":[{"id","name","latitude","longitude","time_zone"}]}`.
- `POST /api/sites` `{"name","latitude","longitude","time_zone"}` → `201` site. `time_zone` is one of the IANA zone names listed in Business rules.

**Catalogue, sessions and observations**
- `GET /api/objects` → `200 {"objects":[{"id","designation","name","kind"}]}`. `kind` is one of `globular`, `open_cluster`, `nebula`, `planetary_nebula`, `galaxy`, `double_star`.
- `GET /api/objects/<object id>/history` → `200 {"object":{...},"observations":[observation, ...]}`, newest `observed_at` first, with observations that have no time last.
- `GET /api/sessions` → `200 {"sessions":[session, ...]}`, newest `started_at` first.
- `GET /api/sessions/<id>` → `200` session plus `"observations":[observation, ...]`.

A **session** is:

`{"id","site":{"id","name","time_zone"},"started_at","evening_date","local_start","local_start_offset","optics","derived","observation_count"}`

- `optics` is `{"telescope_id","eyepiece_id","barlow_id"|null,"train":"straight"|"mirror_diagonal"|"erecting_prism"}`.
- `derived` is `{"aperture_mm","magnification","true_field_arcmin","exit_pupil_mm","orientation":{"train","rotation_deg","mirrored","sentence"}}`.

`GET /api/observations/<id>` → `200` observation:

`{"id","session_id","object_id","designation","kind","observed_at"|null,"local_time"|null,"local_offset"|null,"evening_date","site":{...},"seeing"|null,"transparency_nelm"|null,"concentration_class"|null,"pair":{"primary":[<east>,<north>],"secondary":[<east>,<north>],"separation_arcmin","position_angle_deg"}|null,"description","optics","derived","sketch":{"strokes_sha256","strokes_size","has_raster"}|null,"version"}`

- `local_start_offset` and `local_offset` follow the offset rule in Business rules.
- `GET /api/observations/<id>/strokes` → `200 application/json`, the current stroke file's exact stored bytes. `404` when the observation has no sketch.
- `GET /api/observations/<id>/raster` → `200 image/png`, the exact stored bytes. `404` when there is none.
- Both sketch reads answer `503 {"error":"storage_unavailable"}` while storage is unreachable.
- A deleted observation answers the 404 on all three routes, and appears in no session, history, program or packet answer.

**Sync journal.** All session and observation writes go through this route, online and offline.

`POST /api/sync` takes `{"device":"<1–40 characters>","changes":[change, ...]}` with 1 to 200 changes; otherwise it answers `422` on `changes` or `device`. The response is always:

`200 {"results":[{"client_op_id","status","replayed","body","conflicts":[...]}, ...]}`

- There is one result per change, in the same order.
- Changes are applied one at a time, in array order.
- `status` and `body` are what that change alone would have answered.
- A failed change does not stop later ones.

Every change carries `client_op_id` (a UUID made by the device) and `kind`. The kinds are:

| Kind | Body | Success |
|---|---|---|
| `session.create` | `{"session_id":"<uuid>","site_id","started_at":"<ISO 8601 UTC ending in Z>","optics"}` | `201` session |
| `session.optics` | `{"session_id","optics"}` | `200` session |
| `observation.create` | `{"observation_id":"<uuid>","session_id","object_id","edited_at","fields":{...}}` | `201` observation |
| `observation.update` | `{"observation_id","base_version","edited_at","fields":{...}}` | `200` observation |
| `sketch.put` | `{"observation_id","base_version","edited_at","strokes":"<stroke file text>","raster_png_base64":"<base64>"\|null}` | `200` observation |
| `observation.delete` | `{"observation_id","base_version"}` | `200 {"id":"<observation id>","deleted":true}` |

- `session.create`: `optics` is required, and the browser fills it by the default-optics rule in Business rules.
- `observation.create`: `fields` may hold `observed_at`, `seeing`, `transparency_nelm`, `concentration_class`, `pair`, `description` and `optics`, all optional. Without `optics`, the observation takes the session's current optics.
- `observation.update`: `fields` takes the same keys, and `null` clears a value.
- `pair` in `fields` is `{"primary":[<east>,<north>],"secondary":[<east>,<north>]}`. The server derives `separation_arcmin` and `position_angle_deg`.

Rules for changes:
- `edited_at` is the device's ISO 8601 UTC time of the edit, in the input format from Time rules in Business rules.
- A `session.create` or `observation.create` whose new id already exists from a different op id of this account → `409 {"error":"id_conflict"}`. An id owned by another account answers the 404 instead.
- A `client_op_id` this account already used, with a different payload → `409 {"error":"op_conflict"}`.
- An `observation.create`, `observation.update` or `sketch.put` naming a deleted observation of this account → `409 {"error":"observation_deleted"}`.
- `observation.delete` also answers these, each with the observation as the server now holds it under the named key `observation`: `409 {"error":"cited_by_sent_packet","observation":<observation>}`, `409 {"error":"only_row_of_packet","observation":<observation>}` and `409 {"error":"edited_since","observation":<observation>}`. It answers `503 {"error":"storage_unavailable"}` when storage can't list its objects.
- Each `conflicts` entry is `{"field":"observed_at"|"seeing"|"transparency_nelm"|"concentration_class"|"pair"|"description"|"optics"|"sketch","outcome":"kept"|"replaced","other_device","other_edited_at"}`.
- `sketch.put` answers `503 {"error":"storage_unavailable"}` when storage is unreachable and the sketch would be applied, under the DP-87 rule in Business rules.

**Stroke file format.** The text of `strokes` is a JSON document:

`{"format":"lowlamp-strokes/1","strokes":[{"width":"fine"|"medium"|"broad","points":[[<east>,<north>], ...]}],"stars":[{"at":[<east>,<north>],"brightness":1-5}]}`

- `<east>` and `<north>` are arcminutes from the field centre, east and north positive, with up to two decimals.
- Points may lie outside the field.
- Text that doesn't parse as this format, or is over 2,000,000 bytes, fails on `strokes`.
- A raster that isn't a PNG, or decodes to over 2,000,000 bytes, fails on `raster`.
- Exactly 2,000,000 bytes is allowed for both.

**Programs**
- `GET /api/programs` → `200 {"programs":[{"id","name","required_count","sketch_required","min_description","concentration_required","pair_required","editions":[{"edition","effective_from":"YYYY-MM-DD","min_description","sketch_required","concentration_required","pair_required"}],"coordinator_name","following","progress":{"qualifying","total","required"}}]}`.
  - `editions` is oldest first.
  - The top-level `sketch_required`, `min_description`, `concentration_required` and `pair_required` are the newest edition's values.
- `GET /api/programs/<id>` → `200` program plus `"objects":[{"object_id","designation","name","qualifying_observation_id"|null}]`, in list order. `qualifying_observation_id` is the object's representative qualifying observation from Business rules, or `null` when none qualifies.
- `POST /api/programs/<id>/follow` → `200 {"following":true}`. `DELETE /api/programs/<id>/follow` → `200 {"following":false}`. Both are idempotent.

**Packets**

A **packet** is:

`{"id","number","program_id","state","label","revision","observation_ids":[...],"rows":[{"observation_id","designation","evening_date","edition","strokes_sha256"|null}],"pdf":{"size","sha256","pages"}|null,"failure":null|"renderer_unavailable"|"storage_unavailable"|"mail_rejected","sent_at"|null,"returned_to_draft","created_at"}`

- `observation_ids` is in row order.
- `rows` is the snapshot taken at the last successful check, and is empty before one. Each row's `edition` is the number of the rule edition it was judged by.
- `label` is the state label from Feedback states.
- `returned_to_draft` is a boolean set by the DP-34 rule in Business rules.

Routes:
- `POST /api/packets` `{"program_id","observation_ids":[...]}` → `201` packet in `draft`. It answers `422` on `observation_ids` for an empty list, more than 200 ids, or a repeated id.
- `GET /api/packets` → `200 {"packets":[...]}`, newest first.
- `GET /api/packets/<id>` → `200` packet.
- `PUT /api/packets/<id>/rows` `{"revision":<n>,"observation_ids":[...]}` → `200` packet in `draft`, with the rows in the order given, and the same 422s as create.
- `POST /api/packets/<id>/check` `{"revision":<n>}` → `200` packet in `checked`, or `422 {"error":"incomplete","reasons":[{"observation_id"|null,"code","message"}]}`.
- `POST /api/packets/<id>/render` `{"revision":<n>}` → `202` packet in `rendering`.
- `POST /api/packets/<id>/send` `{"revision":<n>}` →
  - `200` packet in `sent`;
  - `503 {"error":"mail_unavailable"}` with the packet in its previous state and revision;
  - `503 {"error":"storage_unavailable"}` with the packet in its previous state and revision, and no message sent;
  - `502 {"error":"mail_rejected"}` with the packet in `send_failed`.
- `GET /api/packets/<id>/pdf` → `200 application/pdf`, the exact stored bytes, with `Content-Disposition: attachment; filename="lowlamp-packet-<number>.pdf"`. It answers `409 {"error":"no_pdf"}` when the packet has no confirmed PDF, and `503 {"error":"storage_unavailable"}` while storage is unreachable.
- `GET /api/packets/<id>/strokes/<observation id>` → `200 application/json`, the exact stroke file cited in the packet's snapshot. It answers `404` when the observation isn't a snapshotted row or its row has no sketch.
- An illegal transition on rows, check, render or send → `409 {"error":"invalid_transition","state":"<current state>"}`.
- A legal action whose `revision` isn't the packet's current revision → `412 {"error":"stale_revision","packet":<packet>}`, where `<packet>` is the current packet. A missing or non-integer `revision` fails validation on `revision`.

The API never returns object-storage keys or presigned URLs. All stored bytes stream through these routes.

### Business rules (DP-04, DP-08, DP-09, DP-12, DP-21, DP-22, DP-25, DP-28, DP-33, DP-34, DP-37, DP-41, DP-43, DP-50, DP-51, DP-61, DP-63, DP-64, DP-65, DP-69, DP-73, DP-74, DP-75, DP-76, DP-79, DP-87, DP-96, DP-98)

**Accounts and the sign-in lock (DP-01, DP-61).**
- **Normalised emails.** An email is normalised by trimming surrounding white space and lowercasing it. Signup, sign-in and the lock all use the normalised form, and it is what the account stores.
  - Signing up as `Rowan@LOWLAMP.test ` when `rowan@lowlamp.test` exists answers the email-taken 409.
  - Signing in as `ROWAN@lowlamp.test` with Rowan's password succeeds.
- **Display names (DP-98).** `display_name` is 1 to 60 characters after trimming, with no control characters, DEL, C1 controls, U+2028 or U+2029. Anything else fails validation on `display_name`. Names such as `Pell, Rowan <x@evil.test>` and `Zoë "Ő" Nagy` are allowed and are used literally everywhere they appear.
- **Sign-in session lifetime.** A sign-in session ends `SIGNIN_SESSION_SECONDS` seconds after sign-in (default 2,592,000, which is 30 days). The session cookie set by sign-up or sign-in carries a `Max-Age` equal to this lifetime in whole seconds. After the session ends, every observer route answers its 401, even if the request still carries the cookie.
- **What counts.** Only a sign-in answered `401 bad_credentials` counts as a failure. Counts are kept in Postgres per normalised email, whether or not an account uses that email, and never per IP address or browser.
- **The lock.** When five failures for one email fall within a rolling window of `SIGNIN_LOCK_SECONDS` seconds (default 900, which is 15 minutes), that email is locked for `SIGNIN_LOCK_SECONDS` seconds from the fifth failure.
  - Rolling means rolling: failures older than the window never contribute to a later lock.
  - While the lock lasts, every sign-in for that email answers the API's 429, without checking the password, even when it is correct.
  - Attempts during a lock are not counted and do not extend the lock.
  - `Retry-After` is the remaining lock time in whole seconds, rounded up, and at least 1.
  - When the lock ends, the count starts again from zero.
  - Attempts for one email are counted one at a time: of twenty simultaneous wrong attempts on an unlocked email, at most five answer 401 and the rest answer 429.
- **Reset.** A successful sign-in before the fifth failure resets that email's count to zero.
- **Unknown emails.** They are counted and locked exactly like known ones, and their answers are identical.

**Derived optics (DP-04).** The server computes these values each time a session's or an observation's optics are set, and stores them with it. The browser uses the same rule for its live readout, but the stored values are the server's.
- **Aperture in millimetres:** the entered value, or inches × 25.4 exactly, rounded half up to one decimal.
- **Magnification:** telescope focal length ÷ eyepiece focal length × Barlow factor (1 with no Barlow), stored rounded half up to a whole number.
- **True field in arcminutes:** eyepiece apparent field in degrees × 60 ÷ the unrounded magnification, rounded half up to a whole arcminute.
- **Exit pupil in millimetres:** aperture in millimetres ÷ the unrounded magnification, rounded half up to one decimal.
- **Display:** aperture shows no decimal when it is whole (254 mm) and one decimal otherwise (203.2 mm). Exit pupil always shows one decimal.

**Train table (DP-04).** Orientation describes what the observer sees compared with the naked-eye view, which is north up and east left.

| Train id | Name | Rotation | Mirrored | Sentence |
|---|---|---|---|---|
| `straight` | Straight through | 180° | no | `North down, east right.` |
| `mirror_diagonal` | Mirror diagonal | 0° | yes | `North up, east right.` |
| `erecting_prism` | Erecting prism | 0° | no | `North up, east left.` |

**Projection (DP-08, DP-09, DP-79).** The app draws the sketch from sky coordinates:
1. Start from the naked-eye view.
2. Rotate by the train's rotation.
3. Mirror left-to-right when the train is mirrored.

The circle's radius on screen stands for half the stored, rounded true field. A star at 10′ north under a 34′ field therefore sits 10 ÷ 17 of the radius from the centre, on the north side named in the sentence. Changing optics changes only this projection and never rewrites the stroke file.

Every mark placed by pointer, finger, stylus or keyboard maps back through the projection on screen to sky coordinates, rounded to two decimals. For example, at a 34′ field a tap at half the radius right of centre and half the radius above it stores:

| Train | Stored `[<east>,<north>]` | Right arrow | Up arrow |
|---|---|---|---|
| `straight` | `[8.5,-8.5]` | adds east | subtracts north |
| `mirror_diagonal` | `[8.5,8.5]` | adds east | adds north |
| `erecting_prism` | `[-8.5,8.5]` | subtracts east | adds north |

The keyboard cursor keeps its sky position through optics and train changes. If a narrower field puts it outside the circle, it moves along its radius to the edge, and a wider field does not move it back. For example, ten presses of Right at a 34′ field under `straight`, then a swap to an 18′ field and Enter, stores a star at `[9,0]`.

**Measured pair (DP-79).** A pair is stored on the observation, outside the stroke file, with its two points in sky coordinates. One rule, shared by browser and server, derives its values:
- **Separation** is the Euclidean distance between the points in arcminutes, rounded half up to one decimal.
- **Position angle** is atan2(east difference, north difference) from primary to secondary, in degrees, normalised to at least 0 and under 360, then rounded half up to a whole degree, with 360 shown as 0.

The values are the same under every train and field. For example, primary `[0,0]` and secondary `[3,4]` give 5.0′ and 37°; secondary `[-1,0]` gives 1.0′ and 270°; secondary `[-0.01,10]` gives 10.0′ and 0°.

A `pair` is allowed only when the object's kind is `double_star`, and its two points must differ and have up to two decimals. Otherwise it fails validation on `pair`.

**Kit ranges (DP-02).** All limits are inclusive.
- Names: 1 to 60 characters.
- Telescope aperture after conversion: 25 mm to 1,600 mm.
- Telescope focal length: 100 mm to 20,000 mm.
- Eyepiece focal length: 2 mm to 60 mm.
- Apparent field: 30° to 120°.
- Barlow factor: 1.1 to 5.0.

Optics in a change must name the observer's own telescope and eyepiece, and their own Barlow or `null`. An id belonging to someone else answers 404.

**Default optics for a new session.**
- the telescope added first;
- the eyepiece with the longest focal length (the one added first among equal lengths);
- No Barlow;
- Straight through.

For example, with the seed data at start, Rowan's new session takes the 10-inch Dobsonian, 25 mm wide, no Barlow and straight through (48×, 84′, 5.3 mm).

A session can't start without a telescope, an eyepiece and a site, and the browser checks this before queueing anything. A `session.create` that reaches the server without a complete `optics` object fails validation on `optics`.

**Site time zones.** `time_zone` must be one of these IANA names, in this order: `UTC`, `America/New_York`, `America/Chicago`, `America/Denver`, `America/Phoenix`, `America/Los_Angeles`, `America/Anchorage`, `Pacific/Honolulu`, `Europe/London`, `Europe/Paris`, `Europe/Berlin`, `Europe/Budapest`, `Africa/Johannesburg`, `Asia/Tokyo`, `Australia/Sydney`, `Pacific/Auckland`. Any other value fails validation on `time_zone`.

**Observation fields.**
- `seeing` is a whole number from 1 (worst) to 10 (steadiest).
- `transparency_nelm` is the naked-eye limiting magnitude from 1.0 to 8.0, with one decimal.
- `concentration_class` is the Shapley-Sawyer class as one of the strings `I` to `XII`, or `null`. A non-null value is allowed only when the object's kind is `globular`; otherwise it fails validation on `concentration_class`.
- `description` is up to 4,000 characters (4,000 allowed), counted after trimming surrounding white space.
- `object_id` is a catalogue id and can't change after creation.
- An observation **has a sketch** when its current stroke file has at least one stroke or star.

**Time rules (DP-25, DP-63).**
- `observed_at` and `started_at` are ISO 8601 UTC ending in `Z`, and are stored in UT.
- **Timestamp formats.** Input `observed_at`, `started_at` and `edited_at` values must end in `Z`, as `YYYY-MM-DDTHH:MM:SSZ` or with a fraction of one to three digits after the seconds (`YYYY-MM-DDTHH:MM:SS.sssZ`). Any other form fails validation on that field. Every timestamp in an API response (`observed_at`, `started_at`, `created_at`, `sent_at` and `other_edited_at`) is exactly `YYYY-MM-DDTHH:MM:SSZ`, with no fractional seconds. A fraction received on input is dropped, not rounded, in responses, and is kept for every time comparison and time-limit check.
- `observed_at` must fall at or after the session's `started_at` and less than 18 elapsed hours after it, measured in real time rather than on the local clock. On the night clocks fall back, 17 hours 59 minutes after the start is accepted and exactly 18 hours fails.
- `started_at` may not be more than 60 seconds after the server's clock.
- `local_time` and `local_start` are the site-zone wall clock as `HH:MM`.
- `local_offset` and `local_start_offset` are the site zone's UTC offset at that exact instant (not at the session start), as `+HH:MM` or `-HH:MM` with an ASCII hyphen-minus, and `+00:00` for UTC.
- A session's `evening_date` is the site-zone calendar date of `started_at`, or the day before that date when the local start time is earlier than 12:00. A start at exactly 12:00 local belongs to that date. Observations after local midnight stay in the evening they began.

**Program rule editions (DP-64).** Each program has one or more dated editions, and each edition sets a minimum description length and whether a sketch, a concentration class and a measured pair for double stars are required. An observation is judged by the newest edition whose `effective_from` is on or before the observation's session `evening_date`. The UT date of `observed_at` is never used for this. Progress, the checklist, Build packet's choice of qualifying observations and the packet check all go through this one rule, on the server and on the device (DP-89).

**Completeness rule (DP-28).** An observation qualifies for a program when all of these hold, using the edition chosen for it:
1. Its object is on the program's list.
2. It has a UT time.
3. Its seeing is 1 to 10.
4. It has a transparency value.
5. It has aperture and magnification. Every session has optics, so this always holds.
6. Its trimmed description is at least the edition's minimum length.
7. When the edition requires a sketch, it has a sketch.
8. When the edition requires it, it has a concentration class.
9. When the edition requires it and the object's kind is `double_star`, it has a measured pair.

The site is always present through the session. Progress counts are:
- `qualifying`: the number of program objects with at least one qualifying observation;
- `total`: the list length;
- `required`: the certificate count.

Progress is computed on every read.

**Representative observation.** "Newest" always means the latest `observed_at`; when two observations share an `observed_at`, the one created later wins. For each program object:
- The checklist row, `qualifying_observation_id` and Build packet all use the newest of the observer's observations of that object that qualify under the completeness rule, each judged by its own edition.
- When none qualifies, the checklist shows `not yet` and `qualifying_observation_id` is `null`. In that case Build packet uses the newest observation of the object, with observations that have no time counted last.
- Objects the observer never observed are left out of the draft.

**Packet check (DP-33).** The check reads rows in packet order. For each row, reasons are listed in this order:
1. `not_on_program` (no other reasons are listed for that row)
2. `duplicate_object` (on the second and later rows for the same object)
3. `missing_ut_time`
4. `missing_seeing`
5. `missing_transparency`
6. `missing_concentration`
7. `missing_pair`
8. `short_description`
9. `missing_sketch`

After all rows comes `too_few`, when the number of distinct objects among passing rows is less than the program's required count. When there are no reasons, the packet becomes `checked`, and the server snapshots each row's current stroke file checksum and edition. A check racing an applied edit never leaves a `checked` packet whose snapshot predates that edit.

**Sync journal (DP-20 to DP-22, DP-65, DP-69, DP-87).**
- **Stored results.** The server stores each change's result under the account and its `client_op_id` when the status is 2xx or 4xx. Results with 503 are not stored, so a retry runs again.
- **Per account.** Client op ids are scoped per account. Another account sending the same op id makes a new change and never receives the first account's stored `status` or `body`.
- **Replays.** A replay of a stored op id with an identical payload returns the stored `status` and `body` with `"replayed":true` and changes nothing, so a replay never brings back a deleted observation. Payloads are compared as JSON values. Of two simultaneous requests carrying the same new op id for one account, exactly one creates the record, and the other gets the stored result with `"replayed":true`.
- **Session optics** are last-applied-wins.
- **Observation fields.** `observed_at`, `seeing`, `transparency_nelm`, `concentration_class`, `pair`, `description`, `optics` and `sketch` resolve one field at a time. For each field the server keeps the `edited_at` and device of its current value. An incoming value is applied when its `edited_at` is the same as or later than the stored one, and is otherwise discarded.
  - A value discarded because another device's value is newer is reported as `kept`.
  - A value applied over one that a different device set at a version after the change's `base_version` is reported as `replaced`.
  - Nothing else is reported.
- **Future edit times.** An `edited_at` more than 60 seconds after the server's clock fails validation on `edited_at`.
- **Versions.** A change that applies at least one field increments the observation's `version` by exactly one. A change whose every field is discarded leaves `version` unchanged.
- **Serialised changes.** Changes to one observation are serialised on the server, even when they arrive in simultaneous sync requests from different devices.
  - Two simultaneous changes touching different fields both apply. The observation ends holding both values, `version` rises by exactly 2, the two results carry the two consecutive versions, and neither reports a conflict.
  - Two simultaneous changes to the same field end with the value whose `edited_at` is later, whichever arrives first. If the older one is processed last it reports `kept`; if it is processed first, the newer one reports `replaced`.
  - A cited packet returned to draft by such changes moves to draft exactly once, and its revision rises by exactly one.
- **Deciding a `sketch.put` (DP-87).** Each one is decided in this order:
  1. replay of a stored op id;
  2. 404;
  3. 409;
  4. 422 on `edited_at`, `strokes` or `raster`;
  5. field resolution;
  6. storage write.

  A `sketch.put` discarded at field resolution answers 200, reported by the rule above, and contacts no storage, even during an outage. A 503 from the storage write changes nothing:
  - the observation's `version`, `sketch` and sketch edit time stay as they were;
  - no cited packet moves or changes revision, and its `pdf` is kept;
  - no result or op id is stored, so a retry with that op id runs as new with `"replayed":false`, and a later retry with a different payload is not an `op_conflict`.

  Changes applied earlier in the same request still stand.

**Deleting an observation (DP-50).** An `observation.delete` is decided in this order:
1. Replay of a stored op id.
2. 404.
3. Already deleted by this account: 200 with the success body.
4. `cited_by_sent_packet` 409, when any packet in `sending` or `sent` cites the observation.
5. `only_row_of_packet` 409, when it is the only row of any other citing packet.
6. `edited_since` 409, when a field's current value was set by a device other than this request's `device` at a version after the change's `base_version`.
7. Storage listing of its objects. A 503 here changes nothing and stores nothing, so the same op id can retry and runs as new.
8. Tombstone: the observation becomes deleted for good, and the change answers 200.

The tombstone step, in one revision step per packet:
- Removes the observation from every citing packet. A packet in `checked`, `rendering`, `rendered`, `render_failed` or `send_failed` returns to `draft` with its `pdf` cleared, its snapshot emptied and `returned_to_draft` true. A render in flight for it is discarded. A packet already in `draft` stays there with `returned_to_draft` unchanged. Each citing packet's `revision` rises by exactly one.
- Removes the observation's stroke files and sketch images, and everything under each of those packets' PDF prefixes, from storage before the change answers. A removal storage refuses after the tombstone is retried, at most 60 seconds apart, until storage confirms it.
- Drops it from history, its session's count, progress and checklists on the next read.

A tombstone is final. A late `observation.update`, `sketch.put` or new `observation.create` with that id answers the `observation_deleted` 409 and stores nothing else, and a packet create or rows change naming it answers the 404.

**Packet state machine.** Every committed change to a packet's state or rows increments `revision`, including rows replaced while the packet is already a draft. A failing check changes nothing.

| From | Action | To |
|---|---|---|
| `draft` | check passes | `checked` (a failing check stays `draft`) |
| `draft`, `checked` | rows replaced or moved | `draft` |
| `checked`, `render_failed` | render | `rendering` |
| `rendering` | newest attempt's PDF confirmed in storage | `rendered` |
| `rendering` | newest attempt's renderer or storage failure, or no answer within 60 seconds | `render_failed` |
| `rendered`, `send_failed` | send | `sending` |
| `sending` | SMTP accepted | `sent` |
| `sending` | SMTP refused | `send_failed` |
| `sending` | SMTP or the stored PDF unreachable | back to its previous state with the previous revision (the request answers 503) |
| any state but `sending` and `sent` | a cited observation is deleted | `draft`, as set out under Deleting an observation |

Every other action in every other state is the API's 409, even when the revision is also old. `sent` is final. A legal action on an old revision is the API's 412 and changes nothing, so a page confirming a send on revision n after a new render elsewhere sends nothing.

**Packet numbers (DP-73).** Packet numbers count up from 1 for each observer, distinct, consecutive and with no gaps. Eight simultaneous creates all answer 201 with eight consecutive numbers. A create that fails validation uses no number.

**Rendered only when stored (DP-37).** After the renderer returns the PDF, the server writes it to storage. It then reads the object's metadata back and requires the stored size to equal the byte count and the stored checksum to match. Only then does the packet become `rendered`, with `pdf.size`, `pdf.sha256` (the lowercase hex SHA-256 of the bytes) and `pdf.pages`. `pdf.pages` is read from the PDF itself.

**One render attempt counts (DP-74).** Each render request starts a new attempt, and its result, success or failure, applies only while that attempt is the packet's newest and the packet hasn't left `rendering`. A discarded attempt changes no state, stores no PDF and leaves no object. A newer attempt may have started on a different app instance on the same database, and the older attempt's completion still discards itself, including when that newer attempt ended in `render_failed`. On confirming `rendered`, the server removes any other object under that packet's PDF prefix, so the packet holds exactly one stored PDF. For example, render, edit a cited observation, check and render again ends with a PDF holding the edited text, however late the first attempt finishes.

**Sending reads storage first (DP-76).** The send reads the stored PDF before contacting SMTP. If storage is unreachable no message is sent and the send answers the API's `storage_unavailable` 503.

**Edits return a packet to draft (DP-34).** An applied observation change, to any field or the sketch, returns every packet citing that observation in `checked`, `rendering`, `rendered`, `render_failed` or `send_failed` to `draft`.
- The packet's `pdf` is cleared and its snapshot emptied.
- A render still in flight for it is discarded on completion.
- A change reported only as `kept` changes nothing.
- Packets already in `draft`, and packets in `sending` or `sent`, are never affected.

Each packet returned to draft this way gets `returned_to_draft` set to true. Creating a packet, replacing its rows and a passing check set it to false. A failing check leaves it unchanged.

**Concurrency (DP-43).** Of simultaneous render requests on one packet, exactly one gets 202 and the rest get 409. The same holds for send, where the winner gets 200, 502 or 503. At most one message is ever accepted per packet.

**Stored as submitted (DP-15, DP-50).** Stroke files, sketch images and packet PDFs are stored byte for byte as received or rendered, under keys derived from their SHA-256. Stroke files and sketch images are never overwritten, and are deleted only with their deleted observation. The only PDFs ever removed are the ones the DP-74 rule and the delete rule name. A sent packet's PDF is final, and it and the stroke files in its snapshot stay readable unchanged forever. Later edits produce new stroke files, and sending them requires a new packet.

**Ownership (DP-51).** Sessions, observations, kit items, sites, stroke files, sketch images and packets belong to one account. Any other account gets the same `404 {"error":"not_found"}` for them on every route, including ids inside packet bodies, optics and sync changes. Catalogue objects and programs are shared.

### Services (DP-15, DP-36, DP-37, DP-41, DP-45, DP-46, DP-47, DP-48, DP-50, DP-74, DP-76, DP-87, DP-97, DP-98, DP-99)

**What counts as down (DP-99).** Each of these takes the outage path set out for its service below, with the exact published body and copy, and the app still boots and answers health:
- Storage counts as unreachable when it can't be reached, refuses a request (any answer but a success, or a 404 for an object), or passes a limit of 10 seconds on any one storage call.
- The renderer counts as failed on anything but a 2xx answer whose body starts with `%PDF-`. Nothing is stored.
- SMTP counts as unreachable when it can't be reached or sends no greeting within 10 seconds. The whole SMTP exchange is limited to 10 seconds.

No API body and no screen ever holds a provider's message or code, a host, port or bucket name, or a stack trace.

**Postgres** holds:
- accounts and sign-in attempt counts and locks;
- sign-in sessions;
- kits and sites;
- observing sessions;
- observations, with their per-field edit times and devices, and deletion tombstones;
- stored sync results;
- program follows, programs and their editions;
- packets and their snapshots and render attempts.

The app applies its schema and seed data idempotently every time it serves, not only at build. Several instances may serve on one database at once, so this stays safe when two start together.

**MinIO** (bucket `S3_BUCKET`) holds three kinds of object. `<sha256>` is the lowercase hex SHA-256 of the object's bytes.

| Object | Key |
|---|---|
| Stroke files | `observers/<account id>/strokes/<observation id>/<sha256>.json` |
| Sketch images | `observers/<account id>/rasters/<observation id>/<sha256>.png` |
| Packet PDFs | `observers/<account id>/packets/<packet id>/<sha256>.pdf` |

A packet's PDF prefix is `observers/<account id>/packets/<packet id>/`.

While storage is unreachable:
- A `sketch.put` follows the DP-87 rule. When it answers the API's 503, the device keeps that change queued and shows the storage outage sentence in the region Feedback states names.
- An `observation.delete` follows the delete rule, with the same queueing.
- Sketch and PDF reads answer the API's 503.
- Rendering ends in `render_failed` with failure `storage_unavailable` and the storage render sentence.
- Sending follows the DP-76 rule.

Seeded stroke files that are missing at start are written once storage answers.

**Gotenberg** (`GOTENBERG_URL`) renders each packet from HTML the server builds. Every page is US Letter, 612 by 792 points (DP-97). Page 1 is the cover:
- `Observing log packet <number>`
- `<program name>`
- `Observer: <display name> (<email>)`
- `Objects: <row count>`
- `Coordinator: <coordinator name>`

Then comes one page per row, in row order:
- `<designation> — <object name>`
- `UT: <YYYY-MM-DD HH:MM> UT (<HH:MM> local, UTC<offset>, <time zone>)`
- `Site: <site name>`
- `Seeing: <seeing>/10`
- `Transparency: NELM <transparency>`
- `Telescope: <telescope name>, <aperture> mm aperture`
- `Eyepiece: <eyepiece name>`, followed by `, <Barlow name>` when there is one, then ` at <magnification>×`
- `True field: <true field>′ · Exit pupil: <exit pupil> mm`
- `Orientation: <sentence>`
- `Program rules: edition <n>`, where `<n>` is the row's edition
- for globular rows only, `Concentration: class <roman>` or `Concentration: not recorded`
- for double-star rows only, `Pair: <separation>′ at <position angle>°` or `Pair: not measured`
- `Description: <description>`

Rules for the pages (DP-36):
- Optics lines and the sketch use the observation's own stored optics and train, not the session's.
- When the row has a sketch or a measured pair, the page also shows it drawn in that train's projection, from the cited stroke file and the stored pair: dark graphite on white inside a circle, with the N/E compass for its train, in the same proportions as the on-screen circle.
- Every row occupies exactly one PDF page, even with a 4,000-character description and a sketch. The full description prints on that page, wrapping long unbroken text, so the page count is always 1 + rows.
- Description text and display names print literally. For example, `<img src=x onerror=alert(1)>` and `&` appear as typed, and nothing in them ever runs or loads.
- The PDF embeds the Sora font.

When the renderer can't be reached or errors, the packet goes to `render_failed` with failure `renderer_unavailable`, nothing is stored, and the renderer sentence shows. The render request is limited to 60 seconds.

**SMTP (Mailpit)** (`SMTP_HOST`, `SMTP_PORT`) receives one message per send:

| Part | Content |
|---|---|
| From | the value of `MAIL_FROM` |
| To | the program coordinator's name and address |
| Cc | the observer's account email only |
| Bcc | none |
| Subject | `Observing log packet <number>: <program name> — <display name>` |
| Plain text body | `Please find attached observing log packet <number> for <program name> from <display name>. It lists <row count> observations.` |
| Attachment | `lowlamp-packet-<number>.pdf`, `application/pdf`, whose bytes equal the stored PDF |

- `<display name>` reaches the decoded Subject and the body literally, and no name can add a header or a recipient (DP-98).
- `sent` and `sent_at` are recorded only after the server accepts the message.
- Unreachable SMTP leads to the API's 503 and the mail outage sentence.
- A refused message leads to `send_failed` with failure `mail_rejected`.

**Recovery (DP-48).** The app opens a fresh connection to the renderer, storage and SMTP for each action and keeps no remembered failure state. The first action after a service returns succeeds without a restart.

### Seed data (DP-26, DP-29, DP-31, DP-35, DP-63, DP-64, DP-71)

Every person, site, coordinator and email address below is invented. Object names are standard catalogue facts.

**Catalogue** (id, designation, name, kind):

| Id | Designation | Name | Kind |
|---|---|---|---|
| `m2` | M2 | Globular cluster in Aquarius | globular |
| `m3` | M3 | Globular cluster in Canes Venatici | globular |
| `m5` | M5 | Globular cluster in Serpens | globular |
| `m8` | M8 | Lagoon Nebula | nebula |
| `m11` | M11 | Wild Duck Cluster | open_cluster |
| `m13` | M13 | Great Globular Cluster in Hercules | globular |
| `m15` | M15 | Globular cluster in Pegasus | globular |
| `m27` | M27 | Dumbbell Nebula | planetary_nebula |
| `m31` | M31 | Andromeda Galaxy | galaxy |
| `m42` | M42 | Orion Nebula | nebula |
| `m45` | M45 | Pleiades | open_cluster |
| `m51` | M51 | Whirlpool Galaxy | galaxy |
| `m57` | M57 | Ring Nebula | planetary_nebula |
| `m81` | M81 | Bode's Galaxy | galaxy |
| `m82` | M82 | Cigar Galaxy | galaxy |
| `m92` | M92 | Globular cluster in Hercules | globular |
| `albireo` | Albireo | Beta Cygni | double_star |

**Programs**

`globulars-by-hand`, "Globular Clusters by Hand":
- Objects: m13, m92, m3, m5, m15, m2.
- Required count: 5.
- Coordinator: Odile Marsh, `globulars@coordinators.lowlamp.test`.
- Editions:

  | Edition | Effective from | Minimum description | Sketch | Concentration class | Measured pair |
  |---|---|---|---|---|---|
  | 1 | `2000-01-01` | 60 characters | required | not required | not required |
  | 2 | `2026-09-01` | 80 characters | required | required | not required |

`twelve-showpieces`, "Twelve Showpieces":
- Objects: m13, albireo, m51, m57, m27, m31, m42, m45, m81, m82, m8, m11.
- Required count: 10.
- Coordinator: Bram Ellery, `showpieces@coordinators.lowlamp.test`.
- Editions:

  | Edition | Effective from | Minimum description | Sketch | Concentration class | Measured pair |
  |---|---|---|---|---|---|
  | 1 | `2000-01-01` | 40 characters | not required | not required | not required |
  | 2 | `2026-10-01` | 40 characters | not required | not required | required for double stars |

**Account Rowan Pell.** `rowan@lowlamp.test`, password `dark-adapted-01`, follows Globular Clusters by Hand.
- Telescopes: "10-inch Dobsonian" (254 mm, focal length 1200 mm) and "80 mm refractor" (80 mm, 480 mm).
- Eyepieces: "25 mm wide" (25 mm, 67°), "10 mm wide" (10 mm, 67°) and "6 mm" (6 mm, 60°).
- Barlow: "2× Barlow" (factor 2.0).
- Sites: "Hollow Field" (38.95, -105.40, America/Denver) and "Back garden" (39.74, -104.99, America/Denver).

Rowan's observations have no concentration class and no measured pair unless one is stated, and take their session's optics unless others are stated.

Session 1, at Hollow Field, started `2025-06-22T03:30:00Z` (evening 2025-06-21). Optics: 10-inch Dobsonian, 10 mm wide, no Barlow, straight (120×, 34′, 2.1 mm).
- **M13** at `2025-06-22T04:10:00Z`. Seeing 6, NELM 6.2, sketch. Description: "Bright, large and grainy; resolved to the core with averted vision, three dark lanes forming the propeller."
- **M92** at `2025-06-22T04:45:00Z`. Seeing 6, NELM 6.2, sketch. Description: "Smaller and more concentrated than M13; outer stars resolved, core a tight bright knot at 120x."

Session 2, at Hollow Field, started `2026-07-18T02:45:00Z` (evening 2026-07-17), same optics as Session 1.
- **M13** at `2026-07-18T03:20:00Z`. Seeing 8, NELM 6.5, sketch. Description: "Steadier night than last year. Core fully resolved at 120x with chains of stars spilling to the northwest." Its stroke file includes a brightness-5 star at `[0, 10]`, 10′ due north of centre, and no other star of that file lies within 3′ of it.
- **M3** at `2026-07-18T03:55:00Z`. Seeing 7, NELM 6.5, sketch. Description (75 characters): "Round glow with a bright broad centre; edges resolved under averted vision."
- **M5** at `2026-07-18T04:30:00Z`. Seeing 7, NELM 6.5, sketch, logged at 25 mm wide, unlike its session (48×, 84′, 5.3 mm). Description: "Slightly oval with a very bright core; outer halo well resolved and a noticeable double star nearby."
- **M15** at `2026-07-18T08:05:00Z` (02:05 local, still evening 2026-07-17). Seeing 7, NELM 6.5, sketch. Description: "Small, intensely bright core like a star; halo partly resolved, low in the east after midnight."
- **M2** at `2026-07-18T08:40:00Z`. No seeing, NELM 6.5, no sketch. Description: "Faint, round, grainy."

Session 3, at Back garden, started `2026-11-01T01:30:00Z` (19:30 local, UTC-06:00, evening 2026-10-31; clocks fell back at 02:00 local that night). Optics: 10-inch Dobsonian, 6 mm, no Barlow, straight (200×, 18′, 1.3 mm).
- **M15** at `2026-11-01T07:20:00Z` (01:20 local, UTC-06:00). Seeing 7, NELM 6.3, concentration class `IV`, sketch. Description (95 characters): "Tiny blazing core like a bright star; halo resolved into many faint stars at 200x, very steady."
- **M27** at `2026-11-01T07:25:00Z` (01:25 local, UTC-06:00). Seeing 7, NELM 6.3, sketch. Description (23 characters): "Dumbbell shape, bright."
- **M2** at `2026-11-01T08:20:00Z` (01:20 local, UTC-07:00). Seeing 7, NELM 6.3, no concentration class, sketch. Description (70 characters): "Bright round glow with a grainy halo; core unresolved at 200x tonight."
- **M27** at `2026-11-01T08:25:00Z` (01:25 local, UTC-07:00). Seeing 7, NELM 6.3, sketch. Description: "Dumbbell shape, bright."

Each seeded sketch is a valid stroke file with at least three stars and one stroke. Rowan has no packets.

For example, with the seed data at start:
- Rowan's Globular Clusters by Hand progress is 5 of 6 with 5 required: Session 1 and 2 rows count under edition 1, Session 3 M15 qualifies under edition 2, and no M2 qualifies.
- Twelve Showpieces is 1 of 12 (M13); both M27 descriptions fall short of its minimum.
- Build packet for Globular Clusters by Hand cites Session 2 M13, Session 1 M92, Session 2 M3 and M5, and Session 3 M15 and M2. Its check lists exactly `M2, 2026-10-31: add the Shapley-Sawyer concentration class.` and then `M2, 2026-10-31: the description needs at least 80 characters.`

**Account Ines Varga.** `ines@lowlamp.test`, password `dark-adapted-02`, follows no program.
- Telescope "8-inch Dobsonian" (203.2 mm, 1200 mm); eyepiece "20 mm" (20 mm, 68°); no Barlow.
- Site "Ridge Lot" (47.50, 19.04, Europe/Budapest).
- Session at Ridge Lot, started `2026-08-09T19:30:00Z` (evening 2026-08-09). Optics: 8-inch Dobsonian, 20 mm, no Barlow, straight (60×, 68′, 3.4 mm).
  - **M13** at `2026-08-09T20:05:00Z`. Seeing 6, NELM 5.9, sketch. Description: "Large bright ball, resolved at the edges, core grainy with averted vision."
- Packet number 1 for Twelve Showpieces, in `draft`, citing that observation.

Seeded edits carry device `seed` and the observation's own time as `edited_at`. No email has any sign-in failures at start.

## Technical requirements

### Deployment (DP-53)

Node.js 22 with npm is available. Put `/app/run.json` at the app root with the string fields `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, for example:

`{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}`

The server binds `0.0.0.0` on the port in `APP_PUBLIC_PORT`, defaulting to 4173. `GET /api/health` is the health route (body in API). Health answers 200 only once Postgres is reachable. Until then the server retries the database every 2 seconds and answers health with `503 {"status":"starting"}`.

### Configuration and secrets (DP-01, DP-60, DP-61)

These are read at start from the environment, never hard-coded and never sent to the browser:
- `DATABASE_URL`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `GOTENBERG_URL`
- `SMTP_HOST`, `SMTP_PORT`
- `MAIL_FROM`: the From line of every packet message, set by the environment to `Lowlamp Field Log <packets@lowlamp.test>`; when it is unset, use that same value.
- `SIGNIN_LOCK_SECONDS`: optional whole seconds, default in Business rules. It sets both the rolling failure window and the lock length.
- `SIGNIN_SESSION_SECONDS`: optional whole seconds, default in Business rules.

`MAILPIT_URL` is present, but the app doesn't need it.

### Server boundary (DP-48, DP-54, DP-99)

- Request bodies are limited to 5,000,000 bytes for `POST /api/sync` and 100,000 bytes for every other route. A body of exactly the limit is accepted; a larger one gets `413 {"error":"too_large"}`.
- A request body that isn't `application/json` gets `415 {"error":"unsupported_media_type"}`.
- A state-changing request whose `Origin` header names another origin gets `403 {"error":"cross_origin"}`. The server sends no CORS headers.
- The browser loads nothing from other origins. Fonts, scripts and images are served by the app.
- The server never serves source files, source maps, `run.json`, package manifests, lockfiles, environment files or anything under `node_modules`. Those paths get the not-found answer.
- Unknown `/api` paths get `404 {"error":"not_found"}`. Unexpected failures get `500 {"error":"internal"}` with no stack trace.
- When the renderer, storage or SMTP is unreachable or refusing at boot, the app starts normally and answers health. The affected actions follow Services until the service returns.

### Browser support and performance (DP-05, DP-55)

- Current Chromium, Firefox and WebKit, at 375x812, 768x1024 and 1280x800, plus 812x375 and 1024x768 for the Session screen, with touch on the two smaller portrait sizes and both side-on sizes.
- Every working screen is usable within three seconds of navigation on a fresh load.
- Strokes appear under the finger or stylus as it moves.
- The Optics readout's text updates within the time set in Interactions.
- Packet status reflects a server state change within two seconds.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` fields and `"_schema":"run-manifest-v1"`, and nothing else starts the app.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package with its version and licence, plus the Sora font. Shipped packages are the production dependency tree from `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and every bundled font uses one of MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, CC0-1.0, Unlicense or OFL-1.1.
- IF-04: The app stores state only in Postgres and MinIO: no SQLite, no other database or cache server, no in-process store for sign-in counts, and no app data written to local files.
- IF-05: Application source is TypeScript, and the provided service configuration (the compose and environment files given to you) is left unchanged.
- IF-06: The Sora font is served from the app itself, and no page requests fonts, scripts or styles from another origin.

## Engineering standards

- The code is idiomatic TypeScript with strict type checking and no `any` in domain code. Names match this brief's domain terms: observation, session, evening date, train, true field, stroke file, measured pair, position angle, packet, completeness, rule edition, concentration class, tombstone.
- Each domain rule is decided in exactly one place in the source:
  - derived optics and orientation (shared by browser and server);
  - the projection and its inverse;
  - the measured pair's separation and position angle (shared by browser and server);
  - the completeness rule together with the choice of rule edition (shared by browser and server);
  - the packet state transitions and the revision check;
  - the evening-date and UTC-offset rules;
  - field-level conflict resolution;
  - the order that decides an observation delete;
  - the sign-in lock;
  - the safe `next` path.
- Every API error goes through one error shape, and validation messages come from one table of field messages.
- No abstraction has a single implementation, and no wrapper exists only to rename another call.
- There is no dead, commented-out or unreachable code, and no defensive check for a state the state machine makes impossible.
- Provider-dependent state (rendered, sent) is written only after the provider's confirmation, in the same code path that received it.
- There are no features, routes, settings or screens beyond this brief.
