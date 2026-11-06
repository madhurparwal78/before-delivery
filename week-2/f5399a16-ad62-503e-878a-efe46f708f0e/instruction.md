# Noor Bakker Boards Clapstick

Clapstick is the one working desk of an independent storyboard artist who works alone from Amsterdam for advertising producers in New York, Toronto, Amsterdam and Dubai. It carries a commercial from script file to signed-off delivery and fee letter. Build it in TypeScript on Postgres, MinIO, Mailpit, Gotenberg and WireMock, where WireMock plays two invented third-party services: Hollowreed Music and Quaymill Render. Out of scope are payments of any kind (fee letters only state amounts), staff, roles and teams (one person runs a desk), video elements and codecs (a story reel is drawn frames with durations), and any datastore beyond those named. Every person, business, provider and data value in this brief is invented.

## Problem and users

An independent storyboard artist pays for the gaps between tools in unpaid hours. Scripts arrive as a file, drawings sit in a folder, timing lives in an editor, notes come back by mail with no frame attached, and calls are worked out by hand across every clock change. Board tools for agencies are priced and shaped for teams and speak one language, while the producer wants a private page on a phone in their own language. The costly mistakes are small and exact: a drop-frame timecode one label off in an edit decision list, a sign-off typed against a replaced cut, a temp music cue whose licence ended last Monday, a preview film paid for twice, a fee letter a cent out. Clapstick is the one desk where the frames, the reel, the notes, the sign-off, the calls in local wall time and the delivery files agree, and it reads the two third-party services honestly instead of pretending they answered.

- **Artist** (daily, all signed-in screens): runs every commercial from script file to signed-off delivery and fee letter, alone, from one desk.
- **Producer** (occasional, private pages only): reads a cut on a phone in English, Dutch, French or Arabic, pins notes, signs off and accepts a fee letter.
- **Visitor** (occasional, public site only): sees the artist's fictional work, learns how the work runs and sends an enquiry.

## Journeys

1. **From script file to timed reel.** The artist starts signed in with a new job. They bring in a script file, read the preview and save it, upload drawings, reorder frames on the board and trim each clip on the Slate strip. The end state is a strip that reads `exact` against the job's target length.
2. **A cut goes to a producer.** Starting from a timed board, the artist adds on-screen lines for a market, licenses a temp cue, makes a numbered cut, asks for a preview film and sends a private review page. The end state is a Ready film and a mail in the producer's inbox in the producer's language.
3. **A producer answers from a phone.** Starting from the mail, the producer opens the private page at phone size, places pins, suggests a length typed the local way and sends the notes once. The end state is each note on the artist's open Notes screen, in place, within the refresh.
4. **Notes become a signed-off cut.** Starting from open notes, the artist works through them, makes the next cut (a moved frame shows its new position, a removed one says it is gone) and asks for a sign-off. The producer types their name. The end state is a signed-off cut that can never change, shown on the artist's screen and in the job history.
5. **Calls across clock changes.** Starting from the Calls screen, the artist books a call in the producer's wall time on each side of a clock change, then moves one and cancels one. The end state is both times printed on screen and calendar files in the inbox with a stable identity.
6. **Delivery and fee letter.** Starting from a signed-off cut, the artist makes the package of boards PDF, edit decision list and shot list, then writes and sends a fee letter that the producer accepts on a private page. The end state is a Ready package and a locked letter whose cents are exact.
7. **Closing a client.** Starting from a client with jobs, the artist closes the client, may bring it back unchanged within the wait, and otherwise lets the wait end. The end state is `Erased` after MinIO has confirmed each deletion, with every address under the client answering 404.
8. **A visitor finds the work.** Starting from the home page, the visitor moves through the reel and how-it-works pages, filters the work, opens an accordion, copies the address and sends an enquiry. The end state is the published thanks on screen and one mail to the artist.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Starting a desk and signing in.** A new desk signs up; a wrong password gets 401 and the right one signs in; signing out gets 401 from the session endpoint; changing the password gets 401 on that person's other session and the new password signs in; and the browser's sign-in form lands on the published route with a live session and signs out.
- **DP-02 — Keeping clients.** The artist creates, reads, renames and deletes a client, a deleted client answers 404 from then on, and a client of another desk answers 404 exactly like an unknown id in the same shape.
- **DP-03 — Public site journey.** Each page's heading reveals line by line with one whole accessible name; routes change by the two-phase wipe with the old page inert, focus on the new heading and the new title, Back during a wipe ending on the newest address and Back restoring scroll, with no wipe under reduced motion; the reel filter is a radio group in the URL whose items move as the same elements, with the reel grid's columns as published on each side of 1100 px and at 768x1024 and 375x812; the client strip passes, pauses, stops and wraps as published; accordions open one at a time with the open one in the URL; city links land below the sticky header with focus on the heading; Copy address works with the clipboard allowed and refused; the header is solid from its published scroll depth, also straight after a reload; and its own screen and enquiry endpoint are checked for the earlier error of the ladder, whole-second instants and SR1 to SR24 with its accordion, a keyboard-only journey and a 375x812 touch journey with the per-action checks, its rare-state copy verbatim and its precision rule (the enquiry limit and the width at which columns change), and its screen meets the screen rules.
- **DP-04 — Enquiries.** An enquiry answers 202 with the published thanks and sends one mail to the artist, and the sixth enquiry in a window for one address given answers 429 with Retry-After.
- **DP-05 — Jobs list journey.** The artist filters and sorts Jobs, each committed change one history entry; pages by cursor; opens a job and presses Back to find the same filters, sort, page and scroll with focus on the link of the job just left; opens the row menu on the last row of a table scrolling in its frame uncut at 375 and 1280 with each item pressable where it shows; archives a job and finds focus on the level-one heading; searches after the published pause with the latest input winning; reads the Ad-ID refusals; and its own screen and job endpoint are checked for the earlier error of the ladder, whole-second instants, the session cookie's attributes and SR1 to SR24 with its row menu and Filters sheet, a keyboard-only journey and a 375x812 touch journey with the per-action checks, its rare-state copy verbatim and its precision rule (the folding table and the Ad-ID shape), and its screen meets the screen rules.
- **DP-06 — Paging and desk boundaries of the Jobs list.** Pages hold at most 25 whatever limit asks for, the next-page cursor never repeats or skips a job while new ones arrive, and search, its totals and every list never name or count another desk's data.
- **DP-07 — Script journey.** The artist brings in a script file with a byte order mark and CRLF, reads a preview of new, matched and refused rows with row numbers and reasons before anything is saved, and saves it with refused rows never blocking the others; at 375 the preview scrolls in its own focusable, named frame with Save in the bottom bar; and its own screen and save endpoint are checked for the earlier error of the ladder, whole-second instants, the session cookie's attributes and SR1 to SR24 with its file dialog-free form and Problems summary, a keyboard-only journey and a 375x812 touch journey with the per-action checks, its rare-state copy verbatim and its precision rule (frames from seconds at each rate), and its screen meets the screen rules.
- **DP-08 — Script rows.** Rows match on shot, saving the same file twice changes nothing, quoted commas survive, script text is stored exactly as written, and a refused file's error body holds no call stack, SQL, path or library name.
- **DP-09 — Frame upload journey.** The artist uploads several files by the file field, each row going through its own states with a per-file Try again and one refused file never stopping the others; a 120-character file name with no spaces wraps; and its own screen and upload endpoint are checked for the earlier error of the ladder, whole-second instants, the session cookie's attributes and SR1 to SR24, a keyboard-only journey and a 375x812 touch journey with the per-action checks, its rare-state copy verbatim on the MinIO-down copy and its precision rule (the size counted on the file alone), and its screen meets the screen rules.
- **DP-10 — Judging a frame file.** A file is judged by its own header bytes and by its width and height read on the server, is limited on the file alone as qualified in Business rules, answers 413 as JSON also with no session, is stored in MinIO byte for byte and shows Stored only after MinIO has confirmed.
- **DP-11 — Board editor journey.** The board is one composite with a single Tab stop for moving, extending, selecting all and clearing; Alt+Left, Alt+Right and the Move buttons keep focus on the moved frame's control, move the same elements and announce the move; the first frame's Move earlier stays focusable and aria-disabled; `Actions for frame <number>` opens uncut; a change arriving while the Edit dialog is open is refused on save with the dialog as typed; and its own screen and move endpoint are checked for the earlier error of the ladder, whole-second instants, the session cookie's attributes and SR1 to SR24 with its dialog and menu, a keyboard-only journey and a 375x812 touch journey with the per-action checks, its rare-state copy verbatim and its precision rule (a fixed frame number apart from its position), and its screen meets the screen rules.
- **DP-12 — The Undo window.** Remove opens an Undo window the server ends; holding the Undo control keeps it working past UNDO_SECONDS, Undo restores the frame in its exact place with focus on it, a refresh in the window never brings the frame back, and with the page closed the server still removes it.
- **DP-13 — Slate strip journey.** Every clip is 2 CSS pixels per frame with its published data attributes and the playhead's position matches the timecode; `[` and `]` trim by a frame, Shift by a nominal second and the target reads as published; Left, Right, Home, End and Space work in the single-Tab-stop composite; pausing shows the same timecode as data-position; scrubbing keeps working outside the strip until release; Enter grows the frame and Escape returns it with focus on the clip; the tip stays when the pointer moves onto it and closes on Escape without moving focus; at 375 the strip scrolls in its own frame, keeps the playhead's clip in view and the bottom bar holds Earlier, Play and Later; and its own screen and frame endpoint are checked for the earlier error of the ladder, whole-second instants, the session cookie's attributes and SR1 to SR24 with its large view and tip, a keyboard-only journey and a 375x812 touch journey with the per-action checks, its rare-state copy verbatim and its precision rule (timecode and half-up seconds), and its screen meets the screen rules.
- **DP-14 — Timecode and length arithmetic.** Timecode, real seconds, target frames and frame rate conversion follow the exact arithmetic printed in Business rules at each of the three rates, including every worked example printed there.
- **DP-15 — Strip motion.** Trimming moves the later clips as the same elements, changing the frame rate moves clip widths, numerals and playhead together for their published times, a change mid-way carries on with no jump, a refresh with no new data starts no motion and replaces no element, and under reduced motion everything changes at once while playback still steps.
- **DP-16 — On-screen lines journey.** The artist places a line by arrow keys and by drag at 1280, switches market through a radio group in the URL with typed text kept unsaved until Save, and reads an Arabic line right aligned and right to left inside the Lines frame; and its own screen and line endpoint are checked for the earlier error of the ladder, whole-second instants, the session cookie's attributes and SR1 to SR24 with its form and Problems summary, a keyboard-only journey and a 375x812 touch journey with the per-action checks, its rare-state copy verbatim and its precision rule (reading time), and its screen meets the screen rules.
- **DP-17 — Line geometry and reading time.** A line outside the safe area and a line with too little reading time are refused with their published copy, each with its exact number, and spanning enough clips passes.
- **DP-18 — Music cue journey.** The Add cue dialog's combobox works with Up, Down and Enter, is a full-height sheet at 375, shows the latest input when an earlier search answers later and sends the cursor on `More results`, and a library failure shows the published copy with nothing changed; and its own screen and cue endpoint are checked for the earlier error of the ladder, whole-second instants, the session cookie's attributes and SR1 to SR24 with its dialog and list, a keyboard-only journey and a 375x812 touch journey with the per-action checks, its rare-state copy verbatim and its precision rule (provider call count in the WireMock journal), and its screen meets the screen rules.
- **DP-19 — Library prices and licence state.** A cue exists only after the library's 201 and keeps its fee, a price row of today applies to new licences while a row of tomorrow does not, earlier licences keep theirs, the same search text calls the library once within CUE_CACHE_SECONDS, and licence state arrives from the server whatever the device clock says.
- **DP-20 — Preview film journey.** The artist asks for a film on a cut and reads its progress, Ready state and `Download film`; the busy, incomplete, unavailable and `Outdated` states show as published; and its own screen and render endpoint are checked for the earlier error of the ladder, whole-second instants, the session cookie's attributes and SR1 to SR24 with its dialog, a keyboard-only journey and a 375x812 touch journey with the per-action checks, its rare-state copy verbatim also with a device clock hours wrong and its precision rule (provider call count in the WireMock journal), and its screen meets the screen rules.
- **DP-21 — Render service calls.** Asking sends the published body and repeat key header, the same cut and settings make no second POST while other settings make one, the server polls one render at most once per 5 seconds with no screen open and obeys Retry-After, and Ready shows only after size and SHA-256 match and MinIO has confirmed an object equal to the film.
- **DP-22 — Cuts and compare journey.** The artist makes numbered cuts, reads the difference list in its published order and moves the wipe slider by arrow keys with its value in the URL and aria-valuetext while the same elements reveal; at 375 one frame shows at a time with the wipe in the bottom bar; and its own screen and cut endpoint are checked for the earlier error of the ladder, whole-second instants, the session cookie's attributes and SR1 to SR24 with its row menu and dialogs, a keyboard-only journey and a 375x812 touch journey with the per-action checks, its rare-state copy verbatim and its precision rule (frame differences by number), and its screen meets the screen rules.
- **DP-23 — Bringing a cut back and the job history.** Bringing an earlier cut back makes the board equal to it, frames included, while later cuts stay exactly as they were, and the job history lists who did what and when in order with no way to change it.
- **DP-24 — Review page journey.** A producer works the page at 375x812 in each language with the matching `lang`, in Arabic `dir="rtl"` with Left moving to the next step on the steps while on the film strip Left still moves earlier; from 768 px the Notes sheet comes from the left in Arabic and the right otherwise; every string of the copy table renders character for character; a tap places a pin and by keyboard the crosshair starts at the centre and moves in the direction pressed; the name is asked once; a draft survives a reload and with storage refused the page works and says its copy; pressing Send notes twice sends once; and its own screen and notes endpoint are checked for the earlier error of the ladder, whole-second instants and SR1 to SR24 with its Notes sheet, a keyboard-only journey and a 375x812 touch journey with the per-action checks, its rare-state copy verbatim and its precision rule (the edge instant), and its screen meets the screen rules.
- **DP-25 — What a private page reveals.** The review mail holds the private address and the due date in the producer's language with no fee and no other client's or producer's name, no private response holds a field beyond its published list, the private address gives no rights on any desk endpoint, and `Ask for a new link` answers the same for known and unknown addresses within its limit.
- **DP-26 — Private page lifetime.** A review page ends at its published instant, a request at that instant finding it ended, a new address ends the old one, the artist's ending applies on the next request, an ended page answers 410 with its language's copy, and exactly one reminder goes out only if no note was sent.
- **DP-27 — Suggested lengths.** A suggested length typed the local way is stored exactly and shows in frames at the job's rate, and the other language's form is refused with that language's number copy, as qualified in Business rules.
- **DP-28 — Notes journey.** A new note reaches the open Notes screen within the refresh in place with its published copy while an expanded row stays expanded; filters by state and producer live in the URL; a moved frame's note shows its new position and a removed frame shows its published copy; marking a note Done when the filter hides it moves focus to the level-one heading; and its own screen and note endpoint are checked for the earlier error of the ladder, whole-second instants, the session cookie's attributes and SR1 to SR24 with its Filters sheet and expanded row, a keyboard-only journey and a 375x812 touch journey with the per-action checks, its rare-state copy verbatim and its precision rule (the note's local time in the producer's town), and its screen meets the screen rules.
- **DP-29 — Marking many notes.** The header checkbox is indeterminate for a partial selection, Shift+click selects a range, and `Mark <count> notes done` is all or none on the server.
- **DP-30 — Sign-off journey.** The producer gets a private sign-off page by mail in their language and signs off by typing their name, a wrong name is refused, and the artist's screen shows the sign-off within the refresh; and its own screen and sign endpoint are checked for the earlier error of the ladder, whole-second instants and SR1 to SR24, a keyboard-only journey and a 375x812 touch journey with the per-action checks, its rare-state copy verbatim with the name and local time and its precision rule (the folding table on typed names and the edge instant), and its screen meets the screen rules.
- **DP-31 — Sign-off rules.** Signing a replaced cut answers 409 with its published copy, two presses from two windows sign off once with the second reading its published copy, the page ends at its instant with 410, and a signed-off cut refuses every change.
- **DP-32 — Calls journey.** The artist books, moves and cancels a call and reads both times in the published form; an overlapping call shows its published copy with the dialog as typed; the week view is a grid with a roving Tab stop from 1100 px, a two-column agenda at 768x1024 and one column at 375x812; and its own screen and call endpoint are checked for the earlier error of the ladder, whole-second instants, the session cookie's attributes and SR1 to SR24 with its dialog, a keyboard-only journey and a 375x812 touch journey with the per-action checks, its rare-state copy verbatim and its precision rule (local wall time across a clock change), and its screen meets the screen rules.
- **DP-33 — Wall-clock calls.** A call keeps its local time on each side of the next clock change in New York or Amsterdam, a time the change skips is refused, one that happens twice takes the first, and two bookings of one slot give one winner.
- **DP-34 — Calendar files.** Each call mails a calendar file with CRLF line ends, lines folded at 75 octets without splitting a character, escapes, UTC times with Z, the same UID with a higher SEQUENCE after a move, METHOD:REQUEST and METHOD:CANCEL after a cancel.
- **DP-35 — Delivery journey.** From a signed-off cut the artist makes the package and downloads its three files, Ready showing only as qualified in Services; and its own screen and package endpoint are checked for the earlier error of the ladder, whole-second instants, the session cookie's attributes and SR1 to SR24, a keyboard-only journey and a 375x812 touch journey with the per-action checks, its rare-state copy verbatim with the cue name and date, and its precision rule (edit decision list columns and the shot list cell), and its screen meets the screen rules.
- **DP-36 — Delivery file formats.** The boards PDF has six frames a page with captions matching the screen, the edit decision list matches its published columns byte for byte at 29.97 and 25 with CRLF and folded ASCII, and the shot list quotes every field, ends lines with CRLF and prefixes the published leading characters with an apostrophe.
- **DP-37 — Package refusals and outages.** On the Gotenberg-down and MinIO-down copies the published copy shows and nothing is half-written, a cue whose licence has ended refuses the package, and the sixth download in a window answers 429 with its published copy, keyed on the desk.
- **DP-38 — Fee letter journey.** The artist writes and sends a fee letter, and the producer reads and accepts it on a private fee page by typing their name, which locks the letter, with a letter changed meanwhile refused by its published copy; and its own screen and letter endpoint are checked for the earlier error of the ladder, whole-second instants, the session cookie's attributes and SR1 to SR24 with its form and Problems summary, a keyboard-only journey and a 375x812 touch journey with the per-action checks, its rare-state copy verbatim and its precision rule (milestone cents and tax half up), and its screen meets the screen rules.
- **DP-39 — Fee letter arithmetic.** Milestones sum exactly to the fee, tax is half up on each milestone by the client's place, amounts print in their published form, extra body fields change nothing, and the PDF is kept only after Gotenberg has answered and MinIO has confirmed, with the same amounts in its text.
- **DP-40 — Closing a client journey.** The artist closes a client from its screen, reads the wait and brings it back; and its own screen and close endpoint are checked for the earlier error of the ladder, whole-second instants, the session cookie's attributes and SR1 to SR24 with its dialog, a keyboard-only journey and a 375x812 touch journey with the per-action checks, its rare-state copy verbatim with `Erasing` on the MinIO-down copy, and its precision rule (the MinIO deletions behind `Erased` and the wait's edge instant), and its screen meets the screen rules.
- **DP-41 — Bring back and erasure.** A client brought back within the wait returns exactly as it was, and after the wait its producers, frames, notes, letters and files are gone with the MinIO objects deleted, `Erased` showing only then and every address under it answering 404, private pages included.
- **DP-42 — Starting data.** An untouched copy starts with exactly the published seed data and nothing else.
- **DP-43 — Route sweep.** SR4, SR5, SR6, SR14, SR15 and SR16 hold on every signed-in screen and private page.
- **DP-44 — Motion system.** Every motion is a browser-run transition or animation of exactly the published durations, never frames timed by script, playback steps excepted.
- **DP-45 — Landing routes and the Menu sheet.** Each create action with its own address lands there with its published heading, title and focus, and below 1100 px the Menu sheet is hidden and inert when closed.
- **DP-46 — Foreign origins.** A state-changing request with a foreign Origin answers 403 and no response echoes a foreign Origin with credentials allowed.
- **DP-47 — A session that ends mid-form.** The server answers 401 session_ended for that cookie, the open dialog stays as typed with the published copy announced, and signing in again returns to the same address with the draft kept.
- **DP-48 — One API shape.** One key convention, one error shape, one precedence ladder and whole-second UTC instants hold on every endpoint, and only the published endpoints exist.
- **DP-49 — Run manifest and health.** The app installs, builds and serves from its run manifest on the published port and answers the health path with the published JSON.
- **DP-50 — Copies start safely.** Several copies starting together each apply their schema and seed once on their own database and bucket, start with MinIO or Gotenberg down, and each deliver their own pending mail.
- **DP-51 — Credentials stay on the server.** Every service credential and address is read from its environment variable at start, is never hard-coded and never reaches the browser.
- **DP-52 — The striped card beside the room.** The home page shows the split hero as described in Visual design, with one enormous red slanted bar cropped by the viewport over a drawn frame, beside the grey printed card with its clapstick band.
- **DP-53 — Working screens in one language.** Working screens carry the slanted motif on buttons and masks, banded table rows, the cropped-bar empty state and the red-bar error mark as described in Visual design.
- **DP-54 — The look of the Slate strip.** The strip appears as the one full black band of a job, with a slanted red playhead and steady tabular numerals as described in Visual design.
- **DP-55 — The mirrored private page.** In Arabic the page's layout and slant mirror while the film strip, its playhead and every timecode stay left to right, as described in Visual design.
- **DP-56 — Procedural imagery only.** All imagery is generated or uploaded, with no video element, no codec and no stock image in the source.

## Frontend

### Screens and layout (DP-03, DP-05, DP-07, DP-09, DP-11, DP-13, DP-16, DP-18, DP-20, DP-22, DP-24, DP-28, DP-30, DP-32, DP-35, DP-38, DP-40, DP-43, DP-45)

Every screen has this level-one heading and the page title `<heading> — Clapstick`. The main action is what sits in the fixed bottom bar at 375x812 on signed-in and private screens.

| Address | Level-one heading | Main action |
|---|---|---|
| `/` | `Boards drawn to the frame` | link `See the reel` |
| `/reel` | `Work on the reel` | none |
| `/how-it-works` | `How the work runs` | button `Send enquiry` |
| `/sign-in` | `Sign in` | button `Sign in` |
| `/sign-up` | `Start a desk` | button `Start a desk` |
| `/desk/jobs` | `Jobs` | button `New job` |
| `/desk/clients` | `Clients` | button `New client` |
| `/desk/clients/<id>` | the client's name | button `New producer` |
| `/desk/calls` | `Calls` | button `Book a call` |
| `/desk/jobs/<id>` | the job's title | button `Upload frames` |
| `/desk/jobs/<id>/script` | `Script for <title>` | button `Save` |
| `/desk/jobs/<id>/reel` | `Reel for <title>` | bar of `Earlier`, `Play`, `Later` |
| `/desk/jobs/<id>/lines` | `Lines for <title>` | button `Save` |
| `/desk/jobs/<id>/cues` | `Cues for <title>` | button `Add cue` |
| `/desk/jobs/<id>/cuts` | `Cuts for <title>` | button `Make cut` |
| `/desk/jobs/<id>/compare?a=<n>&b=<n>&wipe=<0-100>` | `Compare cuts for <title>` | slider `Wipe` |
| `/desk/jobs/<id>/notes` | `Notes for <title>` | button `Mark <count> notes done`, while a note is selected |
| `/desk/jobs/<id>/delivery` | `Delivery for <title>` | button `Make package` |
| `/desk/jobs/<id>/letter` | `Fee letter for <title>` | button `Save letter` |
| `/r/<token>` | see Private page copy | step's `Next`; on the Send step `Send notes` |
| `/s/<token>` | see Private page copy | button from Private page copy |
| `/f/<token>` | `Fee letter for <title>` | button `Accept letter` |
| any unknown address | `Page not found` | none |

An ended private page keeps its address and has the ended copy as its level-one heading. Opening a signed-in address with no live session goes to `/sign-in?next=<address>`. An unknown page, an address of another desk and an erased client's address show `Page not found` with a 404 status.

**Signed-in frame.** From 1100 px wide, signed-in screens have a side rail with the links Jobs, Clients and Calls and the buttons `Change password` and `Sign out`. Below 1100 px a top bar has a `Menu` button opening a sheet that holds the same controls. Every job screen has a `navigation "This job"` with the links Board, Script, Reel, Lines, Cues, Cuts, Notes, Delivery and Fee letter, which at 375 scrolls sideways inside its own frame. Filters on Jobs and Notes is a sheet below 1100 px and an inline row from 1100 px.

**Layouts.** All screens are one column at 375x812, one or two columns at 768x1024, and rail plus content at 1280x800. No page scrolls sideways except the published frames: wide tables, the script preview, the strip and the job navigation.

- **Home.** The hero as described in Visual design, then a short list of three kinds of work.
- **Reel.** The kind filter, the work grid, the client strip. The grid has three columns from 1100 px wide, two from 768 px up to 1099 px and one below 768 px; 1100 and 1099 differ.
- **How it works.** Four accordions, then the contact section with three cities, the address with `Copy address`, and the enquiry form.
- **Jobs.** Search, filters, a table in its own scrolling frame (`region "Jobs table"`), then `Next page` and `Previous page` links. Each row shows the title as a link to the job, client, state, frame rate, due date and the row menu.
- **Clients.** A table of clients with state, plus the erased list below it. A client's screen shows the place, state, producers, jobs and the `Close client` or `Bring back` button.
- **Board.** The upload area with its rows, the board grid, then the frame tools.
- **Script.** The file field, the preview table in `region "Script preview"`, then `Save`.
- **Reel.** The Slate strip, the numerals line, the frame rate radio group.
- **Lines.** A frame selector, the market radio group, the frame with draggable lines, the line form.
- **Cues.** A list of cues with licence state and `Add cue`.
- **Cuts.** A list of cuts with a row menu, `region "Preview films"`, `region "Private pages"` and `region "Job history"`.
- **Compare.** Two side-by-side strips of frames with the wipe and `list "Differences"`. At 375 one frame shows at a time, with `Earlier frame`, `Later frame` and the wipe in the bottom bar.
- **Notes.** Filters, then a table in `region "Notes table"` with frame, timecode, pin, producer, state, an expandable text and a checkbox.
- **Calls.** From 1100 px a week grid in Amsterdam time. From 768 px to 1099 px a two-column agenda, its days flowing across two side-by-side columns. Below 768 px a one-column agenda. The week lives in the URL as `?week=<yyyy-mm-dd>`, the Monday of that week; with none in the URL the screen shows the week `GET /api/today` names, never one worked out from the device clock.
- **Delivery.** A cut selector, the package's state and its three files with download links.
- **Letter.** The letter form, three milestones, tax and total, the sending controls and the state.
- **Review page.** Steps Frames, Notes and Send; a film strip, a large frame with pins, and the Notes sheet. It is built for 375x812 touch first.
- **Sign-off page.** The cut's frames as a read-only list with captions, the name field and the button.
- **Fee page.** The amounts, a link to the PDF, the name field and the button.

### Public screens and controls (DP-03, DP-05, DP-07, DP-09, DP-11, DP-13, DP-16, DP-18, DP-20, DP-22, DP-24, DP-28, DP-30, DP-32, DP-35, DP-38, DP-40)

These roles, names and data attributes are the public surface. Everything else is free. Every page has `status "Announcements"` and every refused form has `region "Problems"`.

| Screen | Control or region |
|---|---|
| Public frame | `banner` with `data-solid="true"` once solid; links `Noor Bakker Boards`, `Reel`, `How it works`, `Sign in`; a wipe panel with `data-part="route-wipe"` while it plays; each heading line with `data-part="heading-line"` |
| Home | link `See the reel`; links `How it works`, `Contact` (to `/how-it-works#amsterdam`), `Sign in` |
| Reel | `radiogroup "Kind of work"` with `radio "All"`, `"Boards"`, `"Reels"`, `"Pitch frames"`, URL `?kind=boards`, `reels` or `pitchFrames` (All has no parameter); each item `data-part="work"`; `region "Clients"` with `data-part="client-strip"` |
| How it works | accordion `button "From script to frames"`, `"Timing the reel"`, `"Review and notes"`, `"Delivery and fee letter"`, URL `?open=script`, `timing`, `review` or `delivery`; links `Amsterdam`, `New York`, `Toronto`, to `#amsterdam`, `#new-york`, `#toronto` headings; `button "Copy address"`; `form "Enquiry"` with `textbox "Name"`, `"Email"`, `"Phone"`, `"Message"`, `button "Send enquiry"` |
| Sign-in, sign-up | `textbox "Name"` (sign-up only), `textbox "Email"`, `textbox "Password"`, `button "Sign in"` or `button "Start a desk"`; `link "Sign in again"` when a session ends |
| Signed-in frame | `button "Menu"`, `dialog "Menu"`, links `Jobs`, `Clients`, `Calls`, `button "Sign out"`, `button "Change password"`, `dialog "Change password"` with `textbox "Current password"`, `"New password"`, `button "Save"`; every dialog and sheet has `button "Close"` |
| Jobs | `searchbox "Search jobs and clients"`, `list "Search results"`; `button "Filters"`, `dialog "Filters"`; `combobox "Client"`, `"State"`, `"Frame rate"`, `"Sort by"`, URL `client`, `state`, `frameRate`, `sort` (`title` or `dueDate`), `cursor`; `button "New job"`, `dialog "New job"` with `combobox "Client"`, `textbox "Title"`, `"Ad-ID"`, `"Due date"`, `combobox "Target length"`, `"Frame rate"`, `"Aspect"`, `button "Save"`; `button "Actions for <job title>"`, `menu` with `menuitem "Open"`, `"Duplicate"`, `"Archive"`; links `Next page`, `Previous page` |
| Clients | `button "New client"`, `dialog "New client"` with `textbox "Name"`, `combobox "Place"`, `button "Save"`; `button "New producer"`, `dialog "New producer"` with `textbox "Name"`, `"Email"`, `combobox "Town"`, `"Language"`, `button "Save"`; each producer's `button "Edit producer <name>"`, `dialog "Edit producer"` with `textbox "Name"`, `"Email"`, `combobox "Town"`, `"Language"`, `button "Save"`; `button "Rename client"`, `dialog "Rename client"` with `textbox "Name"`, `combobox "Place"`, `button "Save"`; `button "Delete client"`, `button "Close client"`, `dialog "Close client"` with `button "Start closing"`; `button "Bring back"`; the state text `Closing`, `Erasing` or `Erased` |
| Board | `button "Edit job"`, `dialog "Edit job"` with `textbox "Title"`, `"Ad-ID"`, `"Due date"`, `combobox "Target length"`, `button "Save"`; `button "Upload frames"`, file field named `Frame files`; `list "Uploads"`, each row with state text and `button "Try again"`; `listbox "Board"` multi-selectable, with `option "Frame <number>"`, `data-part="board-frame"`, `data-frame`, `data-position`; `group "Frame tools"` for the focused frame with `button "Move earlier"`, `"Move later"`, `"Edit frame <number>"`, `"Actions for frame <number>"`; `menu` with `menuitem "Duplicate"`, `"Insert after"`, `"Remove"`; `button "Undo"`; `dialog "Edit frame <number>"` with `textbox "Duration in frames"`, `"Action note"`, `button "Save"` |
| Script | file field named `Script file`; `region "Script preview"` holding a table; `button "Save"` |
| Reel | `group "Slate strip"`; each clip `button "Frame <number>"` with `data-part="clip"`, `data-frame`, `data-duration`; `data-part="playhead"` with `data-position`; `data-part="timecode"`; `data-part="seconds"`; `data-part="target"`; `radiogroup "Frame rate"` with `radio "25"`, `"23.976"`, `"29.97"`; `button "Earlier"`, `"Play"` or `"Pause"`, `"Later"`; `tooltip` on a clip; `dialog "Frame <number>"` with `data-part="frame-large"` |
| Lines | `combobox "Frame"`; `radiogroup "Market"` with `radio "en"`, `"nl"`, `"fr"`, `"ar"`, URL `?market=`; `data-part="line"` with `data-x`, `data-y`; `textbox "Line text"`, `"X"`, `"Y"`, `"Width"`, `"Height"`, `"Clips"`; `button "Add line"`, `button "Save"`, `button "Remove line"` |
| Cues | `button "Add cue"`, `dialog "Add cue"` with `combobox "Search the library"`, `listbox` with `option` per track and `option "More results"`, `combobox "Market"`, `textbox "From"`, `"Until"`, `button "Save"`; `button "Remove cue <title>"` |
| Cuts | `button "Make cut"`, `dialog "Make cut"` with `textbox "Name"`, `button "Save"`; `button "Actions for Cut <n>"`, `menu` with `menuitem "Preview film"`, `"Send review page"`, `"Ask for sign-off"`, `"Compare"`, `"Bring back"`, `"Rename"`, `"Delete"`; `dialog "Rename Cut <n>"` with `textbox "Name"`, `button "Save"`; `dialog "Preview film"` with `radiogroup "Width"` (`radio "640"`, `"1280"`), `checkbox "Burn in timecode"`, `button "Ask for film"`; `link "Download film"`; `dialog "Send review page"` and `dialog "Ask for sign-off"`, each with `combobox "Producer"`, `button "Send"`; `button "End page"` on each open page in `region "Private pages"` |
| Compare | `combobox "First cut"`, `"Second cut"`; `slider "Wipe"` with `aria-valuetext` such as `50%`; each frame `data-part="compare-clip"`, `data-frame`; `list "Differences"` |
| Notes | `combobox "Note state"`, `"Producer"`, URL `state`, `producer`; `checkbox "Select all notes"`; `checkbox "Select note on frame <number>"`; `button "Expand note on frame <number>"`; `combobox "State of note on frame <number>"`; `button "Mark <count> notes done"` |
| Calls | `grid "Week in Amsterdam time"`; `button "Book a call"`, `dialog "Book a call"` with `combobox "Producer"`, `textbox "Date"`, `"Time"`, `combobox "Minutes"`, `textbox "Note"`, `button "Save"`; on each call `button "Move call"`, opening `dialog "Move call"` with `textbox "Date"`, `"Time"`, `combobox "Minutes"`, `button "Save"`, and `button "Cancel call"`; links `Earlier week`, `Later week` |
| Delivery | `combobox "Cut"`, `button "Make package"`, links `Download boards PDF`, `Download edit decision list`, `Download shot list` |
| Letter | `combobox "Currency"`, `textbox "Fee"`, `"Scope"`, `button "Save letter"`, `combobox "Producer"`, `button "Send letter"`, `button "End page"` |
| Review page | `group "<Steps>"` of buttons, the current with `aria-current="step"`; film strip with the same `data-part` values as the Slate strip; `data-part="frame-view"` with `data-part="pin"` and `data-part="crosshair"`, each with `data-x`, `data-y`; `button "<Open sheet>"` opening the Notes sheet, which is `dialog "<Step Notes>"` in the page's language (`Notes`, `Notities`, `Notes`, `الملاحظات`) with `button "<Close>"`; every other name in Private page copy |
| Sign-off and fee page | names in Private page copy; `textbox "Your full name"`, `button "Accept letter"`, `link "Open the letter"` on the fee page |

Date fields are plain text taking `2027-03-15`, and time fields take `09:00`, so no browser's language changes what they print. Those two values are examples of the form.

**Visible option labels.** Each combobox shows these labels, and the URL and the API hold the value given before the equals sign. The same labels print as the job, note and client state text in tables and on screens.

| Control or text | Value = visible label |
|---|---|
| `State`, job state text | `draft` = `Draft`, `inReview` = `In review`, `signedOff` = `Signed off`, `delivered` = `Delivered`, `archived` = `Archived` |
| `Note state`, `State of note on frame <number>`, note state text | `open` = `Open`, `done` = `Done`, `wontDo` = `Won't do` |
| Client state text | `active` = `Active`, `closing` = `Closing`, `erasing` = `Erasing`, `erased` = `Erased` |
| `Sort by` | `title` = `Title`, `dueDate` = `Due date` |
| `Target length` | `6` = `:06`, `15` = `:15`, `30` = `:30`, `60` = `:60` |
| `Frame rate` | `25` = `25`, `23.976` = `23.976`, `29.97` = `29.97` |
| `Aspect` | `16:9` = `16:9`, `1:1` = `1:1`, `9:16` = `9:16` |
| `Place` | `netherlands` = `Netherlands`, `ontario` = `Ontario`, `newYork` = `New York`, `dubai` = `Dubai` |
| `Town` | `amsterdam` = `Amsterdam`, `newYork` = `New York`, `toronto` = `Toronto`, `dubai` = `Dubai` |
| `Language` | `en` = `English`, `nl` = `Dutch`, `fr` = `French`, `ar` = `Arabic` |
| `Market` in `Add cue` | `NL` = `NL`, `US` = `US`, `CA` = `CA`, `AE` = `AE` |
| `Minutes` | `30` = `30`, `60` = `60` |
| `Currency` | `EUR` = `EUR`, `CAD` = `CAD`, `USD` = `USD` |
| `Client` | the client's id = the client's name |
| `Producer` | the producer's id = the name held on the producer |
| `Frame` | the frame's number = `Frame <number>` |
| `First cut`, `Second cut`, `Cut` | the cut's number = `Cut <number>` |
| `Search the library` options | the track's id = `<title> · <composer> · <seconds> s`, plus `More results` |

The filters on Jobs and Notes also start with an option for no filter, whose parameter is absent from the URL: `All clients` for `Client`, `All states` for `State` and `Note state`, `All frame rates` for `Frame rate` and `All producers` for `Producer`. `Sort by` has no such option; with no `sort` parameter it shows `Due date`.

### Interactions (DP-03, DP-05, DP-07, DP-09, DP-11, DP-12, DP-13, DP-16, DP-18, DP-22, DP-24, DP-28, DP-29, DP-30, DP-32, DP-45, DP-47)

**Public site.**
- Moving between routes plays the wipe: a panel covers the page, the new page is in place, the panel uncovers it. The old page is inert during the cover.
- Pressing Back or another link during a wipe is honoured at once and ends on the newest address with no stray page.
- Focus moves to the new level-one heading when the wipe ends, and the title changes with the route. Back returns to the earlier scroll position.
- The heading's first paint holds its text, and its accessible name is the whole sentence once.
- Each reel filter change is one history entry, and items that leave and enter move as the same elements.
- The client strip loops, pauses while hovered or focused, and at 375 wraps into rows.
- Accordions start closed, one is open at a time, and the open one is in the URL.
- A city link lands with its heading fully below the sticky header and focus on that heading.
- `Copy address` puts `desk@noorbakkerboards.example` on the clipboard. When the browser refuses, the address is selected as text in place and the second copy from Feedback states is announced; no error dialog opens.
- Navigation links grow a drawn underline on hover and on keyboard focus alike.
- The header is transparent at the top and solid once the page has scrolled 24 px, and is already solid after a reload or Back at a scrolled position.

**Jobs.**
- Each committed filter, sort or page change is one history entry.
- Browser Back from a job returns to the same filters, sort, page and scroll position with focus on the link of the job just left, once the list has loaded.
- Search waits a 300 ms pause after typing, then asks and shows the answer for the latest input, even when an earlier request answers later. An empty box asks nothing.
- The row menu opens uncut inside the viewport on any row, including the last row of the scrolling table, and each item can be pressed where it shows.
- Archive removes the row, and focus moves to the level-one heading.

**Script.** Choosing a file shows its preview with row numbers and reasons, and nothing is saved until `Save`. At 375 the preview scrolls sideways inside its own focusable, named frame.

**Uploads.** Dropping files at 1280 or choosing them with the file field makes one row per file. Each row sends on its own, one refused file never stops the others, and `Try again` resends that file only. File names up to 120 characters with no spaces always wrap.

**Board.**
- The board is one composite with a single Tab stop.
- Arrow keys move through it, Shift+arrow extends the selection, Ctrl+A selects all and Escape clears.
- Move earlier, Move later, Alt+Left and Alt+Right move the focused frame, and a mouse drag moves it at 1280. At 375 only the buttons exist.
- Focus stays on the control used: the tile after Alt+Left or Alt+Right, the button after pressing it. Tapping a tile focuses it, and `Frame tools` acts on the frame focused last, the frame at position 1 until then, its button names following that frame.
- Move earlier on the first frame and Move later on the last stay in the Tab order with `aria-disabled="true"`, never the disabled attribute.
- Remove takes the frame away and shows its copy with `button "Undo"`. Hovering or focusing Undo holds the window, and the page then renews it on the server every 2 seconds. Leaving lets it run out UNDO_SECONDS after the last renewal.
- Undo puts the frame back in its exact place with focus on it. A refresh during the window never brings the frame back.
- A stale save keeps `Edit frame <number>` open as typed with focus on its message.

**Slate strip.**
- One clip per frame holds its drawing and no text.
- The strip is one composite with a single Tab stop on the clip under the playhead. That clip is the selected clip and carries `aria-current="true"`.
- Left and Right step the playhead by a frame in every language, and Shift steps by one nominal second (25, 24 or 30 frames). Home and End jump to frame 0 and to the last frame. Space plays and pauses. Enter opens the selected frame large.
- `[` and `]` shorten and lengthen the selected clip by 1 frame, Shift by one nominal second, and a drag on the clip's end does the same at 1280. A clip is never under 1 frame.
- Playback steps the playhead frame by frame at the job's rate, stops on the last frame and pauses when the page is hidden. Pausing shows the same timecode as `data-position`.
- A press on a clip's body starts a scrub at that point, and scrubbing keeps working when the pointer leaves the strip, until release.
- Escape from the large view returns it to its clip with focus on that clip.
- A tip on each clip reads `Frame <number> · in <timecode> · out <timecode>`, where out is the first frame after the clip. It opens on hover and on keyboard focus, stays while the pointer moves onto it, and closes on Escape without moving focus.
- At 375 the strip scrolls sideways inside its own frame and keeps the playhead's clip in view. `Earlier` and `Later` step by a frame.
- Time runs left to right even in Arabic.

**Lines.** A focused line moves by arrow keys 1% and Shift 10%, and by drag at 1280. Each market radio change is one history entry. Text typed in the other markets stays, unsaved, until `Save`. An Arabic line is right aligned and reads right to left inside the Lines frame, its `data-part="line"` element carrying `dir="rtl"`.

**Cue dialog.** The combobox takes Up, Down and Enter. `More results` loads the next page. Escape closes the list first and then the dialog. At 375 it is a full-height sheet.

**Compare.** The slider takes arrow keys 1% and Shift 10%. Each committed value is one history entry and is held in `wipe`. It reveals one cut's frame over the other's by clip and never replaces elements.

**Notes.**
- A new note arrives in place, and an expanded row stays expanded.
- When an action removes a row's control, focus moves by SR12.
- The header checkbox is indeterminate for a partial selection, and Shift+click selects a range. `Mark <count> notes done` shows only while a note is selected and reads `Mark 1 note done` at 1, and its announcement reads `1 note marked done.` at 1.

**Review page.**
- The steps are one composite with a single Tab stop. Left and Right move through them, mirrored in Arabic so that Left moves to the next step, unlike the film strip. Home and End jump.
- At 375 each step also has its Next and Back buttons in the bottom bar.
- A tap on the frame places a pin at percent coordinates to one decimal. By keyboard, the place-a-pin button starts a crosshair at the centre, arrows move it by 1% and Shift by 10% in the direction pressed in every language, Enter places it and Escape cancels.
- Placing a pin opens the Notes sheet with focus on its first field, and closing a sheet a pin opened returns focus to `Place a pin`. At 375 the sheet rises from the bottom in every language.
- The name is asked once on the page, on the Send step, and never again once sent. A draft (pins, text, name) is kept on the device as typed and survives a reload.
- Pressing Send notes twice sends once.

**Refused forms.** Every form error also appears in `region "Problems"` with links that move focus to their fields (fields outside dialogs). A refused field has `aria-invalid="true"` and its message as its accessible description. Personal fields carry their autocomplete tokens: name, email, tel, current-password, new-password. A dialog refused by the server stays open as typed with focus on the message.

**Sessions.** Signing in lands on `/desk/jobs`, or on the `next` address when one is given. When a session ends, an open dialog stays as typed, the session copy from Feedback states is announced, and `link "Sign in again"` shows in the dialog if one is open and on the page otherwise. Signing in returns to the same address with the dialog open again and the typed draft kept on the device.

**Signed-in routes.** Moving between signed-in screens changes the page at once with no wipe, moves focus to the new level-one heading and changes the title. The wipe plays on public pages only.

**Create actions.** Creating a client or a job lands on its own address with focus on its level-one heading. Things with no address of their own (a producer, a cut, a call, a cue, a line) stay on their screen, with focus by SR12.

### Screen rules (DP-03, DP-05, DP-07, DP-09, DP-11, DP-13, DP-16, DP-18, DP-20, DP-22, DP-24, DP-28, DP-30, DP-32, DP-35, DP-38, DP-40, DP-43, DP-44)

Each rule applies to a screen wherever that screen has what the rule names. Every journey requirement names checks of these rules on its own screen. Every write action in a keyboard or touch journey is checked for SR8 focus on opening, SR11 with focus kept, SR12 focus afterwards and its Announcements copy, and every refused form for its Problems links and `aria-invalid`.

- **SR1** Every signed-in screen, the review page and the sign-off page re-read their data from the server every 5 seconds while open. A refresh changes only what changed, in place. Focus stays on the same control. An open dialog, sheet, menu or popover stays open with what was typed and does not play its opening again. A refused dialog keeps its message. An open accordion stays open, an expanded row stays expanded and the scroll position stays.
- **SR2** Closing a dialog, sheet or popover (Escape, its Close button or a tap outside a sheet) returns focus to its opener at once and leaves the page behind usable at once while the closing animation still runs. Pressing the opener again during the closing animation opens it again for good; no leftover close timer may undo that.
- **SR3** Under reduced motion every dialog, sheet, menu, popover and accordion opens and closes at once. A closed one is gone from the screen and the accessibility tree within 100 ms. Every loop stops and every sequence shows its end state at once with the same function.
- **SR4** At 375x812 every control offers a touch area of at least 44 by 44 CSS pixels: buttons, links (including links in list rows, table cells and back links), form fields, file inputs (by their own box unless visually hidden), menu items, accordion headers and the label of each radio and checkbox. Links inside a sentence of running text and the clips of a strip are the only exceptions.
- **SR5** An automated WCAG 2.2 AA check (axe-core, tags wcag2a, wcag2aa, wcag21aa, wcag22aa) reports no violation on every screen at 375x812 and 1280x800 with each dialog or sheet open and with all closed. A wide table at 375 scrolls sideways inside its own frame, and that frame takes keyboard focus and has an accessible name.
- **SR6** At 375x812 the main action of each signed-in and private screen sits in a bar fixed to the bottom. A control that receives focus by Tab or tap is scrolled fully into view between the top bar and the bottom bar.
- **SR7** All motion is browser-run transitions or animations (CSS or `element.animate()`) with exactly the durations 160, 320 and 640 ms, plus 64 seconds for one pass of the client strip. It is never frames timed by script and never any other duration, library defaults included. Playback's frame stepping is the only thing a script may step.
- **SR8** Every Tab stop shows a visible focus ring. Opening a dialog or sheet moves focus inside it to its first field (otherwise its first control) on every opening. Every dialog and sheet keeps Tab and Shift+Tab inside it (a native dialog element alone does not), closes on Escape even when it holds only links, and returns focus to its opener.
- **SR9** A closed accordion panel, menu, sheet or popover is hidden and inert. Its controls leave the Tab order the moment it starts closing, and it leaves the accessibility tree when its closing animation ends. Collapsing to zero height or moving off-screen is not closing.
- **SR10** Pointer and touch behaviour follow each event's pointer type, never hover or pointer media queries, so controls work the same for mouse and touch in one browser.
- **SR11** While a button's request is open, its visible text and accessible name both read `Working…` (on private pages the page language's form from Private page copy). It carries `aria-disabled="true"` and never the disabled attribute. A further press sends nothing, focus stays on it, and it reads its own name again afterwards.
- **SR12** When an action closes a dialog or removes the control that opened it, focus moves to the level-one heading if that control is gone, otherwise back to that control, and stays there through the following refresh and any list reload.
- **SR13** A menu, popover or combobox list opened inside a scrolling frame or at the end of a list is never cut off. Every item is fully on screen and can be pressed where it shows, at 375 and 1280.
- **SR14** Every screen prints the same characters whatever the browser's language, time zone and clock. Opened with German as the language, Pacific/Auckland as the zone and a device clock three days ahead, the same address shows the same visible text, because every date, number, count and time-dependent state is formatted in the published form and decided by the server.
- **SR15** At 320x568 no page scrolls sideways (only the published frames do), and a name of up to 80 characters with no spaces wraps wherever it prints.
- **SR16** No text is ever cut off, with an ellipsis or by clipping, on any screen at 375x812 or 1280x800, also with text spacing overridden (line height 1.5, letter spacing 0.12em, word spacing 0.16em, paragraph spacing 2em). Scrolling frames and visually hidden text are excepted.
- **SR17** At 812x375 every screen works. An open dialog or sheet scrolls inside itself so that each of its controls can be reached by Tab, and no bar covers the focused control.
- **SR18** With forced colours on, every Tab stop still shows a ring, and each selected, current, checked or pressed state still shows by a mark that is not a background colour: a border, outline, glyph or underline.
- **SR19** `status "Announcements"` is on the page from first paint, before any action, and one message made twice in a row is announced twice, with the region's content changing each time.
- **SR20** When one refresh fails (network or a 5xx), everything on the screen stays where it is, focus stays and no dialog opens. The refresh line from Feedback states shows directly under the level-one heading, and the next good refresh clears it.
- **SR21** Escape closes only the innermost open thing. A combobox list, menu or tip inside a dialog closes first, and the dialog stays open with focus inside it.
- **SR22** What a screen shows on arrival is right with no scroll or pointer event. After a reload or Back at a scrolled position, sticky and scroll-linked parts are already in their scrolled state.
- **SR23** Turning reduced motion on or off while a page is open applies from the next animation, with no reload.
- **SR24** Every dialog and sheet rises from the bottom edge at 375x812. From 768 px wide a dialog grows from its centre, and each named sheet (Filters, Menu, Notes) slides from the right edge, or from the left edge in Arabic. The Slate strip's large view is the one exception and grows from its clip at every size.

### Visual design (DP-52, DP-53, DP-54, DP-55, DP-56)

**Direction: one motif.** The one shape is the slanted stripe of a film clapstick, a parallelogram at a fixed 18 degrees. It runs at four scales: a viewport-cropped hero field, a full-width clapstick band, the cut ends of every button and mask, and a text-sized bullet. The layouts beneath it are simple one and two column arrangements on one left margin. The mood is blunt: one flat red slanted bar at a size no template would dare. It is exact: every timecode and sum sits in tabular figures that never shift. It is drawn: procedural pencil-line frames are the only imagery on white.

**Type.** Libre Franklin is the display face, set bold in capitals for the large headings. Source Serif 4 is the body face and carries every timecode and sum in tabular figures. Each step of the heading scale is a quarter larger than the one below it. Monospace is not used.

**Colour.**
- The ground is plain white, panels are a light surface grey, and text is a near-black ink.
- Secondary text is a mid muted grey that still meets contrast on both white and the grey panels.
- The single accent is a signal red, with white text on it.
- All text and control contrast meets WCAG 2.2 AA.

**Density.** Comfortable, with controls large enough to tap at 44 px or more.

**Hero: striped card beside the room.** The viewport splits half and half, with a narrow gap and margins of about 12 pixels. The right half is a sticky full-height generated storyboard frame, masked by one enormous red slanted bar, covering at least a quarter of that half and cropped by the viewport, standing in for a room photograph. The left half is the printed card in surface grey, with a clapstick band about 56 pixels tall of slanted ink and white bars across its top, the Noor Bakker Boards wordmark, the two-line level-one heading in Libre Franklin bold capitals, one Source Serif 4 sentence held to about 36 characters wide, one slant-cut action and three text links in its foot. At 375 the frame comes first at about half the screen's height, the card overlaps it by about 24 pixels and its band is about 40 pixels tall.

**Working screens.**
- White ground with surface-grey panels and no rounded rectangles.
- Primary buttons are solid red or ink blocks with one slanted end, drawn so that the focus ring is never cut.
- Drawings and thumbnails use the same slanted mask, except clips, whose boxes stay true to their frame counts.
- Table rows separate by alternating surface-grey bands, never thin lines, with long names wrapping.
- Empty states are one big cropped ink bar, its longer side at least a third of the content width, and one sentence.
- Loading is three slanted bars filling in turn.
- Errors and the Problems summary carry a text-sized red bar plus words, never colour alone.
- Selected, current and pressed states show a slanted ink glyph or an underline.
- The public pages' route wipe is a red slanted panel.
- The full black band appears once, as the Slate strip's stage on a job.

**Arabic.** The slant itself flips direction on the mirrored private review page, while the film strip and its playhead never do.

### Motion and effects (DP-03, DP-13, DP-15, DP-44)

All motion starts quick and settles softly, and only the three durations of SR7 exist.

| Motion | What it means | Time |
|---|---|---|
| Heading reveal | each line rises into place, each starting 80 ms after the one above (a delay, not a duration) | 320 ms |
| Route wipe, public pages | a panel covers, the new page is placed, the panel uncovers | 320 ms each |
| Reel filter | items that leave and enter move as the same elements | 320 ms |
| Client strip | one pass of the names | 64 seconds |
| Accordion | opens by height | 320 ms |
| Link underline, header going solid, menus, popovers, tips | feedback on hover, focus and scroll | 160 ms |
| Dialogs and sheets | enter and leave as in SR24 | 320 ms |
| Board frames | moved frames travel as the same elements, never redrawn or replaced | 320 ms |
| Loading bars | three slanted bars fill in turn, repeating while loading | 320 ms each |

**Signature: the Slate strip.**
- Trimming moves the later clips as the same elements in 160 ms.
- Changing the frame rate changes every clip's width in 320 ms, rolls the numerals (old up and out, new up into place, both start together) in 320 ms, and glides the playhead in 640 ms.
- Changing again while they move carries on from where they are, with no jump.
- Enter grows the selected clip's drawing into the large view in 320 ms, so that the clip's drawing appears to become the large view, and Escape shrinks it back in 320 ms.
- A refresh with no new data starts no motion and replaces no element.

**Reduced motion.** There is no wipe at all, the heading shows at once, the client strip stops, and everything on the strip changes at once, including opening and closing a frame large. Playback still steps the playhead frame by frame, and every value, focus target and timecode stays the same.

No other loop exists: decorative loops beyond the client strip and the loading bars are banned.

### Feedback states (DP-03, DP-04, DP-05, DP-07, DP-09, DP-11, DP-12, DP-13, DP-17, DP-18, DP-20, DP-22, DP-28, DP-29, DP-31, DP-32, DP-37, DP-38, DP-41, DP-47)

Every async action shows `Working…` on its button (SR11), announces its copy in `status "Announcements"` and keeps it until the next action. Problems summaries also stay until the next action. All copy renders character for character, with straight apostrophes and the published dashes.

**Placeholders.**
- `<date>` prints as `Mon 29 Mar 2027`, on the local date of the town named.
- `<time>` is 24-hour `HH:mm` in the town named. It is the minute of the instant, except that a time after which a person may try again is rounded up to the next whole minute.
- `<town>` is `Amsterdam`, `New York`, `Toronto` or `Dubai`.
- `<title>`, `<name>`, `<number>`, `<count>` and `<file name>` are the record's own values. A producer's `<name>` is always the name held on the producer, never the name typed on a page, so typing `zoe orsted` still prints `Zoë Ørsted`. This covers the note arrival, sign-off arrival and letter accepted announcements, a cut's `signedOffBy` and the job history's `actor`; only a note's `typedName` holds the typed name.
- A date-time prints as `<date>, <time> <town> time`.

**Always.**

| Case | Copy |
|---|---|
| Session ended | `Your session ended. Sign in again to keep going — what you typed is still here.` |
| One refresh failed | `Couldn't refresh. Trying again.` |
| Wrong sign-in | `That email and password don't match.` |
| Name, email, password fields | `Type a name.`, `Type a mail address such as name@example.test.`, `A password has at least 10 characters.` |
| Date, time and title fields | `Type a date such as 2027-03-15.`, `Type a time such as 09:00.`, `Type a title.` |

**Artist actions (success announcement, then refusals and outages).**

| Action | Success | Refusal or outage |
|---|---|---|
| Change password | `Password changed.` | `That current password doesn't match.` |
| Client | `Client added.`, `Client saved.`, `Client deleted.` | `A client with jobs has to be closed instead.` |
| Producer | `Producer added.`, `Producer saved.` | |
| Close client | `Closing <name>. You can bring it back until <date>.` (this `<date>` is the Amsterdam date of the client's `closesAt`), `<name> is back.` | `This client is closing and can't change.`, `The time to bring this client back has passed.`, `This client is not closing.` |
| Job | `Job added.`, `Job saved.`, `Job duplicated.`, `<title> archived.` | `That Ad-ID should end in H or D.`, `An Ad-ID has four letters, then seven letters or digits, then H or D.`, `This job is archived.` |
| Search | `<count> results.`, `1 result.`, `No results.` | |
| Script preview | `Preview ready: <count> new, <count> matched, <count> refused.` | `This file needs the header row shot,visual,audio,seconds.`, `This file is not UTF-8 text.` |
| Script row reasons | | `Row <number>: seconds should be a number such as 1.5.`, `Row <number>: shot is empty.`, `Row <number>: shot <shot> is already in row <number>.` |
| Script save | `Script saved: <count> new, <count> changed.` | |
| Upload, per file | `<file name>: Stored.` | `<file name>:` followed by one of the upload refusals below |
| Upload refusals | | `This file is not a PNG or JPEG.`, `This file is over 8,000,000 bytes.`, `This frame is <width> x <height>. This job is <aspect>.`, `Already on this board as frame <number>.`, `The file store is unavailable right now. Nothing was saved.` |
| Move frame | `Frame <number> moved to position <position> of <count>.` | |
| Duplicate, insert | `Frame <number> duplicated as frame <number>.`, `Frame <number> inserted after frame <number>.` | |
| Remove, Undo | `Frame <number> removed.`, `Frame <number> is back.` | `The time to undo has passed.` |
| Edit, trim | `Frame <number> saved.`, `Frame <number> is now <count> frames.` (`1 frame` at 1) | `This board was changed at <time> Amsterdam time in another window. Your changes are still here.` |
| Frame rate | `Frame rate is now <rate>.` | same stale copy |
| Line | `Line saved.`, `Line removed.` | `This line runs outside the safe area by <percent>%.`, `This line needs <count> frames on screen. It has <count>.`, `Type the line's text.`, `This line runs past the last frame.` |
| Cue | `Cue added: <title>.`, `Cue removed: <title>.` | `The music library is unavailable right now. Your cue stays.`, `The licence ends before it starts.` |
| Licence state | shown with each cue | `Licence ends in <count> days`, `Licence ends in 1 day`, `Licence ends today`, `Licence ended on <date>.` |
| Ask for film | `Film asked for.`, `The stored film is shown.`, then when ready `The film for Cut <number> is ready.` | `The render service is busy. You can try again at <time> Amsterdam time.`, `The render came back incomplete. Nothing was saved.`, `The render service is unavailable right now. Nothing changed.`, `The render service could not finish this film. Nothing was saved.`, `The file store is unavailable right now. Nothing was saved.` |
| Film state shown | `Queued`, `Running <progress>%`, `Ready`, `Outdated`, `Failed` | |
| Cuts | `Cut <number> made.`, `Cut <number> is the board again.`, `Cut <number> deleted.`, `Cut <number> saved.` | `A signed-off cut can't change.` |
| Compare, no differences | `These two cuts are the same.` | |
| Review page | `Review page ready. The mail to <name> is on its way.`, `Page ended.` | `This job's due date has passed.` |
| Notes | `Note marked done.`, `Note marked won't do.`, `Note reopened.`, `<count> notes marked done.` | |
| Note arrives | `<name> left a note on frame <number> at <time> <town> time.` | |
| Note position | `Position <position>`, `Frame gone in Cut <number>.` | |
| Sign-off | `Sign-off page ready. The mail to <name> is on its way.`, then on arrival `Cut <number> signed off by <name> at <time> <town> time.` | |
| Calls | `Call booked.`, `Call moved.`, `Call cancelled.` | `That time was just taken at <time> Amsterdam time. Pick another.`, `<time> does not exist in <town> on <date>.`, `That time has passed.` |
| Call line | `<date>, <time> <town> time · <time> Amsterdam time` | |
| Package | `Package ready.` | `The PDF service is unavailable right now. Nothing was saved.`, `The file store is unavailable right now. Nothing was saved.`, `The licence for <title> ended on <date>.`, `Only a signed-off cut can be delivered.`, `Frame <number> has no drawing yet.`, `Too many downloads for now. You can download again at <time> Amsterdam time.` |
| Letter | `Letter saved.`, `Fee page ready. The mail to <name> is on its way.`, on arrival `Letter accepted by <name>.` | `Type an amount such as 1835.50.`, `This letter is accepted and can't change.`, the PDF and file store copy above |
| Letter stale | | `This letter was changed at <time> <town> time. Read it again.` |

Worked examples: `02:30 does not exist in New York on Sun 14 Mar 2027.`, `Mon 15 Mar 2027, 09:00 New York time · 14:00 Amsterdam time`.

**Visitor.**

| Action | Copy |
|---|---|
| Copy address | `Address copied.`; when refused, `Press Ctrl+C to copy the address.` |
| Enquiry | `Thanks. I answer within two working days.`; limit `Too many enquiries from this address for now. You can send again at <time> Amsterdam time.`; field `Type your message.` |

### Private page copy (DP-24, DP-25, DP-26, DP-27, DP-30, DP-31, DP-38)

A review or sign-off page and its mail are in its producer's language, whatever the browser asks for, with the matching `lang` on the document, and in Arabic `dir="rtl"`. The film strip and every timecode stay left to right. Dates print as `2027-03-15`, and timecodes, clock times and counts use Western digits, left to right, on the pages and in their mail. `<when>` is `<time>` followed by the town's time phrase below.

| Key | English | Dutch | French | Arabic |
|---|---|---|---|---|
| Review heading | `Review of <title>` | `Beoordeling van <title>` | `Relecture de <title>` | `مراجعة <title>` |
| Steps group | `Steps` | `Stappen` | `Étapes` | `الخطوات` |
| Step Frames | `Frames` | `Beelden` | `Images` | `الإطارات` |
| Step Notes | `Notes` | `Notities` | `Notes` | `الملاحظات` |
| Step Send | `Send` | `Versturen` | `Envoyer` | `إرسال` |
| Next | `Next` | `Volgende` | `Suivant` | `التالي` |
| Back | `Back` | `Terug` | `Retour` | `السابق` |
| Open sheet | `Open notes` | `Notities openen` | `Ouvrir les notes` | `فتح الملاحظات` |
| Close | `Close` | `Sluiten` | `Fermer` | `إغلاق` |
| Film strip | `Film strip` | `Filmstrook` | `Bande de film` | `شريط الفيلم` |
| Clip | `Frame <number>` | `Beeld <number>` | `Image <number>` | `الإطار <number>` |
| Earlier | `Earlier` | `Eerder` | `Plus tôt` | `أبكر` |
| Later | `Later` | `Later` | `Plus tard` | `لاحقًا` |
| Play | `Play` | `Afspelen` | `Lire` | `تشغيل` |
| Pause | `Pause` | `Pauzeren` | `Pause` | `إيقاف مؤقت` |
| Place pin | `Place a pin` | `Speld plaatsen` | `Placer une épingle` | `وضع دبوس` |
| Note field | `Your note` | `Je notitie` | `Votre note` | `ملاحظتك` |
| Length field | `Suggested length in seconds` | `Voorgestelde lengte in seconden` | `Durée suggérée en secondes` | `المدة المقترحة بالثواني` |
| Length in frames | `<count> frames` | `<count> beelden` | `<count> images` | `<count> إطارًا` |
| Attachment | `Attach a drawing` | `Tekening toevoegen` | `Joindre un dessin` | `إرفاق رسم` |
| Add note | `Add note` | `Notitie toevoegen` | `Ajouter la note` | `إضافة الملاحظة` |
| Name field | `Your full name` | `Je volledige naam` | `Votre nom complet` | `اسمك الكامل` |
| Send notes | `Send notes` | `Notities versturen` | `Envoyer les notes` | `إرسال الملاحظات` |
| Notes sent | `Your notes were sent.` | `Je notities zijn verstuurd.` | `Vos notes ont été envoyées.` | `تم إرسال ملاحظاتك.` |
| Draft refused | `This draft is not kept on this device.` | `Dit concept wordt niet op dit apparaat bewaard.` | `Ce brouillon n'est pas conservé sur cet appareil.` | `لا يتم حفظ هذه المسودة على هذا الجهاز.` |
| Number copy | `Type a length such as 1.5.` | `Typ een lengte zoals 1,5.` | `Saisissez une durée comme 1,5.` | `اكتب مدة مثل ١٫٥.` |
| Empty note | `Type your note.` | `Typ je notitie.` | `Saisissez votre note.` | `اكتب ملاحظتك.` |
| Empty name | `Type your full name.` | `Typ je volledige naam.` | `Saisissez votre nom complet.` | `اكتب اسمك الكامل.` |
| Bad attachment | `This file is not a PNG or JPEG.` | `Dit bestand is geen PNG of JPEG.` | `Ce fichier n'est ni un PNG ni un JPEG.` | `هذا الملف ليس PNG أو JPEG.` |
| Big attachment | `This file is over 5,000,000 bytes.` | `Dit bestand is groter dan 5.000.000 bytes.` | `Ce fichier dépasse 5 000 000 octets.` | `حجم هذا الملف يتجاوز 5,000,000 بايت.` |
| Problems | `Problems` | `Problemen` | `Problèmes` | `المشكلات` |
| Working | `Working…` | `Bezig…` | `En cours…` | `جارٍ العمل…` |
| Refresh line | `Couldn't refresh. Trying again.` | `Vernieuwen is niet gelukt. We proberen het opnieuw.` | `Actualisation impossible. Nouvel essai en cours.` | `تعذر التحديث. جارٍ إعادة المحاولة.` |
| Ended | `This page has ended.` | `Deze pagina is verlopen.` | `Cette page est terminée.` | `انتهت هذه الصفحة.` |
| Ask link | `Ask for a new link` | `Vraag een nieuwe link aan` | `Demander un nouveau lien` | `طلب رابط جديد` |
| Mail field | `Mail address` | `E-mailadres` | `Adresse e-mail` | `عنوان البريد الإلكتروني` |
| Link answer | `If that address belongs to this page, a new link is on its way.` | `Als dit adres bij deze pagina hoort, is er een nieuwe link onderweg.` | `Si cette adresse correspond à cette page, un nouveau lien est en route.` | `إذا كان هذا العنوان مرتبطًا بهذه الصفحة، فسيصلك رابط جديد قريبًا.` |
| Link limit | `Too many requests for now. Try again later.` | `Te veel verzoeken. Probeer het later opnieuw.` | `Trop de demandes pour le moment. Réessayez plus tard.` | `طلبات كثيرة جدًا الآن. حاول مرة أخرى لاحقًا.` |
| Sign-off heading | `Sign-off for <title>` | `Akkoord voor <title>` | `Validation de <title>` | `اعتماد <title>` |
| Sign-off button | `Sign off` | `Akkoord geven` | `Valider` | `اعتماد` |
| Signed | `Signed off at <when>.` | `Akkoord gegeven om <when>.` | `Validé à <when>.` | `تم الاعتماد في <when>.` |
| Already signed | `Already signed off at <when>.` | `Al akkoord gegeven om <when>.` | `Déjà validé à <when>.` | `تم الاعتماد بالفعل في <when>.` |
| Newer cut | `A newer cut was made at <when>. Read it first.` | `Er is om <when> een nieuwere versie gemaakt. Lees die eerst.` | `Une version plus récente a été faite à <when>. Lisez-la d'abord.` | `تم إعداد نسخة أحدث في <when>. اقرأها أولاً.` |
| Wrong name | `That name doesn't match. Type your full name as it was given.` | `Die naam komt niet overeen. Typ je volledige naam zoals die is doorgegeven.` | `Ce nom ne correspond pas. Saisissez votre nom complet tel qu'il a été donné.` | `هذا الاسم غير مطابق. اكتب اسمك الكامل كما هو مسجل.` |
| Mail: review subject | `Your review page for <title>` | `Je beoordelingspagina voor <title>` | `Votre page de relecture pour <title>` | `صفحة المراجعة الخاصة بك لـ <title>` |
| Mail: reminder subject | `Reminder: your review page for <title>` | `Herinnering: je beoordelingspagina voor <title>` | `Rappel : votre page de relecture pour <title>` | `تذكير: صفحة المراجعة الخاصة بك لـ <title>` |
| Mail: new link subject | `Your new link` | `Je nieuwe link` | `Votre nouveau lien` | `رابطك الجديد` |
| Mail: due line | `Due <date>` | `Uiterlijk <date>` | `À rendre le <date>` | `الموعد النهائي <date>` |
| Mail: call subject | `Call on <date>` | `Gesprek op <date>` | `Appel le <date>` | `مكالمة في <date>` |
| Mail: cancelled call subject | `Call cancelled: <date>` | `Gesprek geannuleerd: <date>` | `Appel annulé : <date>` | `تم إلغاء المكالمة: <date>` |

The sign-off mail's subject is the Sign-off heading row. On these pages `<date>` is `2027-03-15` form. At 1 the Length in frames row reads `1 frame`, `1 beeld`, `1 image`, `إطار واحد`.

| Town's time phrase | English | Dutch | French | Arabic |
|---|---|---|---|---|
| New York | `New York time` | `tijd in New York` | `heure de New York` | `بتوقيت نيويورك` |
| Toronto | `Toronto time` | `tijd in Toronto` | `heure de Toronto` | `بتوقيت تورنتو` |
| Amsterdam | `Amsterdam time` | `tijd in Amsterdam` | `heure d'Amsterdam` | `بتوقيت أمستردام` |
| Dubai | `Dubai time` | `tijd in Dubai` | `heure de Dubaï` | `بتوقيت دبي` |

The fee page and the letter are in English for every producer, using the English column. Its subject is `Your fee letter for <title>`, and its accepted line is `Letter accepted.`.

## Backend

### API (DP-01, DP-02, DP-04, DP-06, DP-08, DP-10, DP-12, DP-14, DP-17, DP-19, DP-21, DP-23, DP-25, DP-26, DP-27, DP-29, DP-31, DP-33, DP-37, DP-39, DP-41, DP-46, DP-48)

**Conventions.**
- Requests and responses are JSON (`application/json`) with one key convention, camelCase, in every body, nested keys and every enum value included. The one exception is the error code `session_ended`, printed with its underscore.
- Every instant is UTC in whole seconds with a Z, for example `2027-03-29T04:20:00Z`, never milliseconds.
- Every id is a UUID string.
- A body's unknown fields are ignored and change nothing. A PATCH may hold only the fields it changes, and those left out keep their values; a `stamp` shown in its table is still required.
- A list with a published `limit` has its page size capped at 25 whatever `limit` asks for. `GET /api/calls` has none and lists every call asked for.
- A desk's writes and reads need its session cookie.
- The session cookie is HttpOnly, SameSite=Lax, never Secure, with no Max-Age or Expires.

**Error body.** `{"error":{"code":"...","message":"...","fields":{"name":"..."}}}`, with `fields` only for field errors and always inside `error`. No call stack, SQL, path or library name ever appears in one.

**Precedence ladder, for the whole API.**
1. Unknown route or wrong method (404, 405 with Allow).
2. A body or file over its size limit (413).
3. Rate limit (429 with Retry-After in whole seconds).
4. A foreign Origin on a state-changing request (403).
5. Authentication (401).
6. Unknown resource (404, or 410 for an ended private page).
7. Content type (415).
8. Malformed JSON (400).
9. Field validation (422).
10. State (409).
11. A stale edit (412).

A body limit is judged on Content-Length before the body is read, and a file limit while the upload is read. Both are always answered as JSON, never a dropped connection. The limits are 1,000,000 bytes for a JSON body (that size allowed) and 9,000,000 bytes for an upload's whole body (allowed), on top of each file limit. A rate limit keyed on the desk applies once a session identifies the desk.

A desk's id for another desk's thing, in a path or inside a body, answers 404 exactly like an unknown id in the same shape. A provider failure on one action answers 503, never 500, with the published copy as its message. A 401 for a cookie whose session has ended has the code `session_ended`; no cookie at all has the code `notSignedIn`. A refused action's message is its copy from Feedback states.

**Access.**

| Method and path | Body | Success |
|---|---|---|
| `GET /api/health` | | 200 `{"status":"ok"}` |
| `POST /api/sign-up` | `{"name":"Ana Reis","email":"ana@example.test","password":"frame-rate-2027"}` | 201 `{"id","name","email"}`, signed in; 409 when the mail address is held |
| `POST /api/sign-in` | `{"email":"noor@noorbakkerboards.example","password":"desk-pass-2027"}` | 200 `{"id","name","email"}`; 401 when wrong |
| `POST /api/sign-out` | | 204 |
| `GET /api/session` | | 200 `{"id","name","email"}` |
| `POST /api/password` | `{"currentPassword":"...","newPassword":"..."}` | 204; 422 when the current one is wrong; ends the other sessions, this one stays |

**Clients and producers.** A client is `{"id","name","place","state","closesAt","createdAt"}`. A producer is `{"id","clientId","name","email","town","language"}`.

| Method and path | Body | Success |
|---|---|---|
| `GET /api/clients` | | 200 `{"clients":[...],"total":n,"erasedClients":[{"id","name","erasedAt"}]}` |
| `POST /api/clients` | `{"name":"Lantern Row Films","place":"ontario"}` | 201 client |
| `GET`, `PATCH /api/clients/<id>` | `{"name":"...","place":"..."}` | 200 client |
| `DELETE /api/clients/<id>` | | 204; 409 when it has jobs |
| `POST /api/clients/<id>/close` | | 200 client, state `closing` |
| `POST /api/clients/<id>/bring-back` | | 200 client, state `active`; 409 outside the wait |
| `GET /api/clients/<id>/producers` | | 200 `{"producers":[...]}` |
| `POST /api/clients/<id>/producers` | `{"name":"Ana Reis","email":"ana.reis@example.test","town":"toronto","language":"fr"}` | 201 producer |
| `PATCH /api/producers/<id>` | same fields | 200 producer |

**Jobs and search.** A job is `{"id","clientId","clientName","title","adId","dueDate","targetSeconds","frameRate","aspect","state","createdAt"}`.

| Method and path | Body | Success |
|---|---|---|
| `GET /api/jobs?clientId=&state=&frameRate=&sort=&cursor=&limit=` | | 200 `{"jobs":[...],"total":n,"nextCursor":null}`; `archived` jobs only when `state=archived` |
| `POST /api/jobs` | `{"clientId":"<id>","title":"Night Ferry","adId":"NOOR1234567H","dueDate":"2027-03-15","targetSeconds":30,"frameRate":"25","aspect":"16:9"}` | 201 job |
| `GET`, `PATCH /api/jobs/<id>` | `{"title","adId","dueDate","targetSeconds"}` | 200 job |
| `POST /api/jobs/<id>/duplicate` | | 201 job, title `<title> copy`, frames copied, no cuts |
| `POST /api/jobs/<id>/archive` | | 200 job |
| `GET /api/search?q=` | | 200 `{"jobs":[{"id","title"}],"clients":[{"id","name"}],"producers":[{"id","name","clientId"}],"total":n}` |
| `GET /api/jobs/<id>/history` | | 200 `{"events":[{"at","actor","action","text"}]}`, oldest first; any other method on it answers 405 with `Allow: GET` |

**Board, frames and script.** A frame is `{"number","position","durationFrames","actionNote","audioNote","shot","visual","fileName","width","height","sha256","drawingUrl"}`, with null drawing fields when it has no drawing. The board is `{"jobId","stamp","frameRate","targetSeconds","targetFrames","totalFrames","secondsText","targetText","frames":[...]}`. `secondsText` is for example `5.01 s`, and `targetText` is `exact`, `<count> frames over` or `<count> frames under`, singular at 1. Board writes answer the whole board.

| Method and path | Body | Success |
|---|---|---|
| `GET /api/jobs/<id>/board` | | 200 board |
| `POST /api/jobs/<id>/frames` | multipart field `file`, one file per request | 201 `{"frame":{...},"stamp":"..."}`; takes no stamp |
| `PATCH /api/jobs/<id>/frames/<number>` | `{"durationFrames":38,"actionNote":"...","stamp":"..."}` | 200 |
| `GET /api/jobs/<id>/frames/<number>/drawing` | | 200 the drawing's bytes; 404 when it has none |
| `POST /api/jobs/<id>/frames/<number>/move` | `{"position":2,"stamp":"..."}` | 200 |
| `POST /api/jobs/<id>/frames/<number>/duplicate` | `{"stamp":"..."}` | 201 |
| `POST /api/jobs/<id>/frames/<number>/insert-after` | `{"stamp":"..."}` | 201, an empty slate of one nominal second |
| `POST /api/jobs/<id>/frame-rate` | `{"frameRate":"23.976","playhead":0,"stamp":"..."}` | 200 board plus `"playhead":n` |
| `POST /api/jobs/<id>/removals` | `{"frame":4,"stamp":"..."}` | 201 `{"frame":4,"position":4,"endsAt":"...Z","stamp":"..."}` |
| `GET /api/jobs/<id>/removals` | | 200 `{"removals":[...]}`, the open windows |
| `POST /api/jobs/<id>/removals/<number>/hold` | | 200 `{"frame","position","endsAt"}`; 409 once ended |
| `POST /api/jobs/<id>/removals/<number>/undo` | | 200 board; 409 once ended |
| `POST /api/jobs/<id>/script/preview` | multipart field `file` | 200 `{"rows":[{"row":2,"shot":"3A","result":"new","reason":null}]}`, saving nothing |
| `POST /api/jobs/<id>/script` | multipart field `file` | 200 `{"created":n,"updated":n,"unchanged":n,"refused":n,"rows":[...]}` |

A stale `stamp` answers 412. `result` is `new`, `matched` or `refused`. Uploads and script saves take no stamp, and any change they make gives the board a new one; a saved file that changes nothing leaves the stamp as it was.

**Lines.** A line is `{"id","frame","market","text","x","y","width","height","clips"}`.

| Method and path | Body | Success |
|---|---|---|
| `GET /api/jobs/<id>/lines?market=` | | 200 `{"lines":[...]}` |
| `POST /api/jobs/<id>/lines` | `{"frame":1,"market":"nl","text":"Vanaf vandaag in de winkel","x":10,"y":70,"width":60,"height":10,"clips":1}` | 201 line |
| `PATCH`, `DELETE /api/lines/<id>` | same fields | 200 line, 204 |

**Cues.** A cue is `{"id","trackId","title","composer","seconds","market","from","until","fee","licenceId","licenceText"}`.

| Method and path | Body | Success |
|---|---|---|
| `GET /api/cues/search?q=&cursor=` | | 200 `{"tracks":[...],"nextCursor":null}` |
| `GET /api/jobs/<id>/cues` | | 200 `{"cues":[...]}` |
| `POST /api/jobs/<id>/cues` | `{"trackId":"hr-1001","title":"Lantern Street","composer":"Ilse Voss","seconds":30,"market":"NL","from":"2027-03-01","until":"2027-03-31"}` | 201 cue |
| `DELETE /api/jobs/<id>/cues/<cue id>` | | 204 |

A `fee` sent in that body is ignored.

**Cuts, compare and renders.** A cut is `{"id","number","name","frameRate","createdAt","signedOffAt","signedOffBy"}`, and one read alone adds `"frames":[...]`. A render is `{"id","cut","width","burnTimecode","state","progress","message","size","sha256","filmUrl","createdAt"}`.

| Method and path | Body | Success |
|---|---|---|
| `GET /api/jobs/<id>/cuts` | | 200 `{"cuts":[...]}` |
| `POST /api/jobs/<id>/cuts` | `{"name":"Second pass"}` | 201 cut |
| `GET /api/jobs/<id>/cuts/<number>` | | 200 cut with frames |
| `PATCH /api/jobs/<id>/cuts/<number>` | `{"name":"..."}` | 200; 409 when signed off |
| `DELETE /api/jobs/<id>/cuts/<number>` | | 204; 409 when signed off |
| `POST /api/jobs/<id>/cuts/<number>/bring-back` | `{"stamp":"..."}` | 200 board |
| `GET /api/jobs/<id>/compare?a=&b=` | | 200 `{"differences":["..."],"a":{...},"b":{...}}` |
| `GET /api/jobs/<id>/renders` | | 200 `{"renders":[...],"busy":{"until":"...Z","message":"..."}}`, `busy` null when not busy |
| `POST /api/jobs/<id>/renders` | `{"cut":2,"width":1280,"burnTimecode":true}` | 202 render when started; 200 the stored render for the same cut and settings; 503 on provider failure or busy |
| `GET /api/jobs/<id>/renders/<id>/film` | | 200 the film's bytes |

**Private pages, as the artist.** A page is `{"id","producerId","cut","url":"/r/<token>","state":"open","endsAt"}`, where `state` is `open` or `ended`. A review or sign-off for a producer who is not on the job's client answers 404.

| Method and path | Body | Success |
|---|---|---|
| `GET`, `POST /api/jobs/<id>/reviews` | `{"producerId":"<id>","cut":2}` | 200 `{"reviews":[...]}`, 201 page; a further POST for that producer and job ends the old page; 409 when the due date has passed |
| `POST /api/reviews/<id>/end` | | 200 page |
| `GET`, `POST /api/jobs/<id>/sign-offs` | `{"producerId":"<id>","cut":2}` | 200 `{"signOffs":[...]}`, 201 page with `/s/<token>`; same new-address rule |
| `POST /api/sign-offs/<id>/end` | | 200 page |

**Notes, as the artist.** A note is `{"id","frame","position","goneText","timecode","x","y","producerId","producerName","typedName","state","text","suggestedSeconds","suggestedFrames","attachmentUrl","createdAt"}`.

| Method and path | Body | Success |
|---|---|---|
| `GET /api/jobs/<id>/notes?state=&producer=` | | 200 `{"notes":[...],"total":n}` |
| `PATCH /api/notes/<id>` | `{"state":"done"}` | 200 note |
| `POST /api/jobs/<id>/notes/mark` | `{"noteIds":["<id>"],"state":"done"}` | 200 `{"notes":[...]}`; any unknown id answers 404 and changes nothing |
| `GET /api/notes/<id>/attachment` | | 200 the attachment's bytes as stored, with type `image/png` or `image/jpeg`; 404 when the note has none. This path is the note's `attachmentUrl`, which is null with no attachment |

**Private pages, as the producer.** No cookie is needed. An ended page answers 410 with code `pageEnded` and its language's ended copy as the message. An unknown token answers 404.

| Method and path | Body | Success |
|---|---|---|
| `GET /api/r/<token>` | | 200 exactly `{"language","jobTitle","cut","frameRate","aspect","dueDate","endsAt","name","frames":[{"number","position","durationFrames","timecodeIn","actionNote","drawingUrl"}],"notes":[{"id","frame","x","y","text","suggestedSeconds","suggestedFrames","attachmentUrl","createdAt"}]}`, where `notes` are only that producer's own and `name` is null until given |
| `GET /api/r/<token>/frames/<number>/drawing` | | 200 bytes |
| `POST /api/r/<token>/length` | `{"length":"1,5"}` | 200 `{"seconds":"1.5","frames":36}`; 422 with `fields.length` |
| `POST /api/r/<token>/attachments` | multipart field `file` | 201 `{"attachmentId":"<id>"}` |
| `GET /api/r/<token>/attachments/<id>` | | 200 the attachment's bytes as stored, with type `image/png` or `image/jpeg`; 404 for an attachment this page's producer did not send. This path is the note's `attachmentUrl` on this page, which is null with no attachment |
| `POST /api/r/<token>/notes` | `{"sendKey":"7f1c...","name":"Élodie Tremblay","notes":[{"frame":4,"x":41.5,"y":62.0,"text":"Un peu plus long.","suggestedLength":"1,5","attachmentId":null}]}` | 201 `{"notes":[...]}`; the same `sendKey` again answers 200 with the first answer and stores nothing |
| `POST /api/r/<token>/new-link` | `{"email":"..."}` | 202 `{"message":"<link answer>"}`, the same for every address; works on an ended page |
| `GET /api/s/<token>` | | 200 exactly `{"language","jobTitle","cut","frameRate","endsAt","signedOffAt","signedOffText","frames":[...]}`, frames as above |
| `POST /api/s/<token>/sign` | `{"name":"zoe orsted"}` | 200 `{"signedOffAt","signedOffText"}`; 422 wrong name; 409 newer cut or already signed |
| `GET /api/s/<token>/frames/<number>/drawing` | | 200 bytes |
| `GET /api/f/<token>` | | 200 exactly `{"jobTitle","currency","feeText","taxText","totalText","milestones":[...],"state","stamp","endsAt","pdfUrl"}` |
| `GET /api/f/<token>/pdf` | | 200 the PDF |
| `POST /api/f/<token>/accept` | `{"name":"...","stamp":"..."}` | 200 `{"state":"accepted"}`; 422 wrong name; 412 stale |

No other field exists on those three reads. A private token gives no rights anywhere else: sent in any form to a desk endpoint, that endpoint answers 401.

**Calls.** A call is `{"id","producerId","producerName","town","date","time","minutes","note","startsAt","endsAt","text","uid","sequence","state"}`, with `state` `booked` or `cancelled`. On `GET /api/calls`, `from` and `to` are dates in `yyyy-mm-dd` form, read on the Amsterdam date of each call's `startsAt`, and both ends are included. `from` alone lists that date onward, `to` alone lists up to that date, and neither lists every call on the desk. Calls are ordered by `startsAt`, then id. A date in another form answers 422. The answer includes cancelled calls with their `state`; the Calls screen shows only booked ones, and a cancelled call holds no slot.

| Method and path | Body | Success |
|---|---|---|
| `GET /api/today` | | 200 `{"date":"2027-03-15","weekStart":"2027-03-15"}`, today's Amsterdam date and the Monday of its week |
| `GET /api/calls?from=&to=` | | 200 `{"calls":[...]}` |
| `POST /api/calls` | `{"producerId":"<id>","date":"2027-03-15","time":"09:00","minutes":30,"note":"First look, cut 2"}` | 201 call |
| `PATCH /api/calls/<id>` | `{"date":"2027-03-16","time":"09:00","minutes":30}` | 200 call |
| `POST /api/calls/<id>/cancel` | | 200 call |

**Delivery.** A package is `{"id","cut","state","files":[{"kind","fileName","size","sha256","url"}],"createdAt"}`, where `kind` is `boards`, `editDecisionList` or `shotList`.

| Method and path | Body | Success |
|---|---|---|
| `GET /api/jobs/<id>/packages` | | 200 `{"packages":[...]}` |
| `POST /api/jobs/<id>/packages` | `{"cut":1}` | 201 package, state `ready`; 200 the stored one for a cut that has one; 409 refusals; 503 outages |
| `GET /api/packages/<id>/files/<kind>` | | 200 the bytes; 429 with Retry-After at the limit |

**Fee letters.** A letter is `{"id","jobId","currency","scope","feeMinor","taxMinor","totalMinor","feeText","taxText","totalText","milestones":[{"number","amountMinor","taxMinor","amountText","taxText"}],"state","stamp","producerId","pageUrl","endsAt","pdfUrl"}`.

| Method and path | Body | Success |
|---|---|---|
| `GET /api/jobs/<id>/letter` | | 200 letter; 404 when there is none |
| `POST /api/jobs/<id>/letter` | `{"currency":"EUR","fee":"5506.50","scope":"Boards and story reel for one :30"}` | 201 letter, state `draft`; 409 when the job has one |
| `PATCH /api/letters/<id>` | `{"currency":"EUR","fee":"5506.50","scope":"...","stamp":"..."}` | 200; 412 stale; 409 accepted; a sent letter's PDF is rendered again first, so 503 leaves it as it was |
| `POST /api/letters/<id>/send` | `{"producerId":"<id>"}` | 200 letter, state `sent`; a further send ends the old page; 503 outages |
| `POST /api/letters/<id>/end-page` | | 200 letter |
| `GET /api/letters/<id>/pdf` | | 200 the PDF |

**Enquiries.** `POST /api/enquiries` with `{"name":"Ana Reis","email":"ana@example.test","phone":"+31 20 555 0100","message":"Do you board a :15?"}` answers 202 `{"message":"<thanks copy>"}`; `phone` is optional.

**Reference values.**
- `place`: `netherlands`, `ontario`, `newYork`, `dubai`.
- `frameRate`: `25`, `23.976`, `29.97`.
- `aspect`: `16:9`, `1:1`, `9:16`.
- `targetSeconds`: 6, 15, 30, 60.
- `language`: `en`, `nl`, `fr`, `ar`.
- town: `amsterdam`, `newYork`, `toronto`, `dubai`.
- line market: `en`, `nl`, `fr`, `ar`.
- licence market: `NL`, `US`, `CA`, `AE`.
- job state: `draft`, `inReview`, `signedOff`, `delivered`, `archived`.
- note state: `open`, `done`, `wontDo`.
- render state: `queued`, `running`, `done`, `failed`, `ready`, `outdated`.
- package state: `making`, `ready`.
- letter state: `draft`, `sent`, `accepted`.
- client state: `active`, `closing`, `erasing`, `erased`.

### Business rules (DP-02, DP-04, DP-05, DP-06, DP-08, DP-10, DP-12, DP-14, DP-17, DP-19, DP-21, DP-23, DP-25, DP-26, DP-27, DP-29, DP-31, DP-33, DP-36, DP-37, DP-39, DP-41)

**States.**
- Job: `draft` becomes `inReview` on a sent review page, `signedOff` on a sign-off and `delivered` on a Ready package; any state can become `archived`. Writes on an archived job answer 409.
- Private page (review, sign-off, fee): open, then ended at its instant, by a new address or by the artist. It is never reopened.
- Note: `open`, `done` and `wontDo`, free to move between them.
- Render: `queued`, `running`, then `done` or `failed`, then `ready` only after MinIO has confirmed; `outdated` as below.
- Package: `making`, then `ready`, or nothing saved.
- Letter: `draft`, `sent`, `accepted` (locked).
- Client: `active`, `closing` (can be brought back), `erasing`, `erased`.
- A signed-off cut never changes.

**Ad-ID.** Four capital letters, seven capital letters or digits, then H or D. `NOOR1234567H` is valid. Eleven characters of the right shape followed by any other twelfth character answer the end-in-H-or-D copy; any other shape answers the shape copy.

**Folding table (search, typed names, edit decision list).** The same applies to capitals, and comparison ignores case.

| Characters | Fold to |
|---|---|
| à á â ã ä å | a |
| æ | ae |
| ç | c |
| è é ê ë | e |
| ì í î ï ı İ | i |
| ñ | n |
| ò ó ô õ ö ø | o |
| œ | oe |
| ù ú û ü | u |
| ý ÿ | y |
| ß | ss |

Any other character stays as it is in search and typed names, so an Arabic name is typed exactly. In the edit decision list, printable ASCII (codes 32 to 126) stays as it is, case included, and a character still outside it after folding becomes `_`. There a capital folds to capitals and a small letter to small letters: `É` becomes `E`, `Æ` becomes `AE`, `Œ` becomes `OE`, `İ` becomes `I`, `ẞ` becomes `SS`, and `Zoë Ørsted` becomes `Zoe Orsted`.

**Search.** Search matches job titles, client names and the names of a client's producers anywhere in the name, by the folding table: `zoe orsted` finds `Zoë Ørsted`. It keeps to the desk: search, autocomplete and totals never reach, name or count another desk's data. Search returns and counts the clients, producers and jobs of `active`, `closing` and `erasing` clients, since those stay readable on the desk. It neither returns nor counts archived jobs, or deleted or `erased` clients with their producers and jobs. `total` is the number of jobs, clients and producers matched.

**Paging.** The Jobs list sorts by the chosen key, then by id ascending. With no `sort` given the key is `dueDate`. `dueDate` runs earliest first and `title` runs from A to Z. Titles compare after folding by the folding table and lower-casing, character by character in Unicode code point order. A next-page cursor follows that order, so a job present when paging began is never repeated or skipped while new ones arrive.

**Script files.**
- A script file is UTF-8 with or without a byte order mark, LF or CRLF, comma separated with double-quoted fields, with the header row `shot,visual,audio,seconds`. The header is row 1.
- `seconds` is a decimal above 0 with `.` as its point, turned into frames half up on the exact value at the job's rate: 1.5 s is 37.5, so 38 frames at 25; 35.96..., so 36 at 23.976; 44.95..., so 45 at 29.97.
- A script file has the same 8,000,000-byte limit as a frame.
- A refused row never blocks the others, and a later row repeating a shot is refused.
- Text is stored exactly as written, never trimmed or retyped.
- Saving makes one frame per new row (visual as its action note and its `visual`, audio as its audio note, duration from seconds, no drawing yet). A matched row updates that frame's notes and duration. Saving the same file twice changes nothing.

**Frames.**
- A frame's number is fixed when the frame is made: the next unused number on that job, never reused. Its position is its place on the board. Copy, `data-frame`, notes and differences all use the number.
- A file is judged in this order: size, content, aspect, repeat. Content is PNG or JPEG read from its own header bytes, never its name or declared type.
- At most 8,000,000 bytes are allowed, counted on the file alone, never on the multipart body: a 7,990,000-byte file in a bigger request is accepted, and an 8,000,001-byte one answers 413 before anything else, sign-in included.
- Width and height are read from the header on the server and must match the job's aspect exactly. All judged refusals answer 422.
- A file with the SHA-256 of a frame on this board is refused.
- An accepted file fills the lowest-numbered frame with no drawing, otherwise it makes a new frame of one nominal second.
- A frame on a cut keeps its drawing in MinIO after it leaves the board.

**Undo.** Removing opens a window of UNDO_SECONDS that the server ends. A hold renews it to UNDO_SECONDS from that request. Closing the page still removes the frame.

**Timecode.**
- At 25 fps, timecode has colons with base 25.
- At 23.976, timecode has colons with base 24: frame 720 is `00:00:30:00`.
- At 29.97, timecode is drop-frame with a semicolon before the frames, dropping frame numbers 00 and 01 at the start of every minute except each tenth minute.

| Frame at 29.97 | Timecode |
|---|---|
| 899 | `00:00:29;29` |
| 900 | `00:00:30;00` |
| 1799 | `00:00:59;29` |
| 1800 | `00:01:00;02` |
| 3598 | `00:02:00;02` |
| 17981 | `00:09:59;29` |
| 17982 | `00:10:00;00` |

**Real seconds.** Frames x 1001 / 24000 at 23.976, frames x 1001 / 30000 at 29.97, frames / 25 at 25, kept exact and shown half up to 0.01 s. 120 frames at 23.976 is exactly 5.005 s, shown `5.01 s`; 180 frames is `7.51 s`.

**Target length.** Nominal seconds x 25, 24 or 30: a :30 is 750 frames at 25, 720 at 23.976, 900 at 29.97.

**Changing the frame rate.** Each clip's real length is kept as near as whole frames allow: new frames = old frames x new rate / old rate, on the exact rates 25, 24000/1001 and 30000/1001, half up, never under 1. 38 frames at 25 is 36 at 23.976 and 46 at 29.97. The playhead converts the same way and never goes past the last frame. Cuts keep their own rate.

**Lines.**
- `x` and `y` are the box's top left. `width` and `height` are percent of the frame to one decimal. `clips` is how many clips the line spans from its own frame, default 1.
- The safe area is 5 to 95 on both axes. The message prints the largest distance outside it, half up to one decimal, so x 1.5 prints 3.5%.
- Reading time is words / 3 seconds, rounded up to a whole frame at the job's rate, counted across the clips spanned, with words separated by white space. 5 words is 42 frames at 25, 40 at 23.976 and 50 at 29.97.
- The safe area is judged before reading time, and both answer 422.

**Licences.**
- A licence has one market, whose local wall time is Amsterdam (NL), New York (US), Toronto (CA) or Dubai (AE), and a window with `until` included.
- State counts dates in that market's local wall time: `until` tomorrow is 1 day, `until` today ends today, and a past `until` has ended, printing that date.
- Each cue's text comes from the server with the data and changes with the date, within the 5-second refresh.
- A new cue takes the newest price row whose `validFrom` is on or before today's Amsterdam date. New licences alone take it, and a cue keeps the fee it was given.
- No row in effect counts as the library being unavailable.

**Renders.**
- A film is made from a numbered cut, and the same cut and settings never start a second render: the stored one is shown. A `failed` render does not count as stored, so asking again sends the POST again.
- A render shows `outdated` once the board's frames (order, durations or drawings) no longer equal its cut; its film stays downloadable. A newer film comes from a newer cut.
- A busy answer holds every call to the service until that instant, on every path. Asking meanwhile answers the same 503 with no call.
- The server does the polling, so a render finishes with no screen open, and it picks up unfinished renders after a restart.
- The render's state, its busy time and its `Outdated` come from the server with the data, within the 5-second refresh, whatever the device clock says, and `region "Preview films"` shows them.

**Cuts and differences.**
- Make cut keeps the board exactly as `Cut <number>` with a name. Cuts number from 1 on each job, and a deleted cut's number is not reused.
- Comparing takes the higher number as the newer cut. Frames are listed by position in the newer cut (for each: moved, then length, then drawing), then gone frames by number. Copy is `Frame <number> moved from position <position> to position <position>.`, `Frame <number> is <count> frames shorter.` or `longer.` (`1 frame` at 1), `Frame <number> is new.`, `Frame <number> has a new drawing.`, `Frame <number> is gone.`.
- Bringing back makes the board equal to that cut, frames, durations, notes, drawings and frame rate included, and leaves every later cut readable exactly as it was.

**Job history.** Every write on a job adds one event with who, what and when, in order; its actor is the artist's or the producer's name. `action` includes `cutMade`, `cutBroughtBack`, `reviewSent`, `noteSent`, `signedOff`. No screen or request can edit it.

**Private page lifetime.** A page lasts until 23:59:59 producer local wall time on the due date, or REVIEW_PAGE_SECONDS (sign-off: SIGN_OFF_PAGE_SECONDS; fee: FEE_PAGE_SECONDS) after sending, each default 1209600, whichever comes first, and ends exactly at that instant: a request at that instant finds it ended. A new address ends the old one. The artist's ending applies on the page's next request, with no wait.

**Reminder.** One reminder goes REMINDER_AFTER_SECONDS (default 604800) after sending, only if no note was sent and the page is still open, exactly one.

**New link.** `Ask for a new link` sits on the ended page. For an address matching a producer, it sends one mail holding a new address for each of that producer's open review pages and for the page it was asked from when that page is theirs, ending the old ones. A page the artist ended or whose due date has passed gets none. The answer's words and status are the same for known and unknown addresses. At most 3 per REVIEW_LINK_RATE_WINDOW_SECONDS (default 3600) per address, counted alike for both.

**Suggested length.** English `1.5`, Dutch and French `1,5`, Arabic `١٫٥` or `1.5` are all stored as `1.5`. `1.5` is refused in Dutch and French, and `1,5` in English and Arabic, with that language's number copy. A length is above 0, at most 60 (allowed), with at most 3 decimals. It shows in frames once the field is left, half up, at the job's rate: 1.5 is 36 at 23.976.

**Attachments.** Judged like a frame's content, PNG or JPEG, at most 5,000,000 bytes on the file alone.

**Notes.**
- A note's position is read against the job's newest cut. A frame that moved keeps its note and shows its new position. A frame not in the newest cut has `position` null and `goneText` naming that cut, such as `Frame gone in Cut 4.`.
- Marking many is all or none.
- `producerName` is the name held on the producer; `typedName` is the name asked on the page.

**Sign-off.** The name typed must equal the name held on the producer by the folding table. A cut with a newer one on its job answers 409, printing when that newer cut was made in the producer's town. Two presses from two windows sign off once: exactly one answers 200, and the other answers 409 with the already-signed copy. Name is judged before state. An open Cuts screen announces the arrival within the 5-second refresh. A signed-off cut refuses every rename and deletion with 409, and the board can move on as a later cut.

**Calls.**
- A call has a producer, a local date, a local time and 30 or 60 minutes, with the town taken from the producer. It keeps its wall-clock time across clock changes, and the desk calendar in Amsterdam time moves on its own.
- Wall times in the producer's town use Europe/Amsterdam, America/New_York, America/Toronto, Asia/Dubai.
- A wall time that does not exist on its day is refused (422); one that happens twice is the first of the two. A start in the past is refused (422). A call overlapping another on the desk answers 409, printing when that call was booked, and two bookings of one slot give exactly one winner.
- Worked instants for a 09:00 New York call:

| Date | UTC | Amsterdam time |
|---|---|---|
| Fri 12 Mar 2027 | 14:00:00Z | 15:00 |
| Mon 15 Mar 2027 | 13:00:00Z | 14:00 |
| Fri 26 Mar 2027 | 13:00:00Z | 14:00 |
| Mon 29 Mar 2027 | 13:00:00Z | 15:00 |
| Mon 1 Nov 2027 | 13:00:00Z | 14:00 |
| Mon 8 Nov 2027 | 14:00:00Z | 15:00 |

- An Amsterdam day has 23 hours on 28 Mar 2027 and 25 on 31 Oct 2027; a New York day has 23 hours on 14 Mar 2027 and 25 on 7 Nov 2027. 01:30 New York on Sun 7 Nov 2027 is 05:30:00Z, and 02:30 Amsterdam on Sun 31 Oct 2027 is 00:30:00Z.
- These 2027 dates are worked examples. Dates in checks count from the real current date.

**Calendar file (RFC 5545).** CRLF line ends. Lines are folded at 75 octets without ever splitting a UTF-8 character. `\\`, `\,`, `\;` and `\n` escapes in text. VERSION:2.0, a PRODID and METHOD:REQUEST. One VEVENT with `SUMMARY:Call with <producer name>`, DESCRIPTION as the call's note, ORGANIZER and ATTENDEE as `mailto:` addresses, DTSTART and DTEND in UTC with Z, a UID that stays the same across moves and a SEQUENCE that starts at 0 and grows by one on each move. A cancel sends METHOD:CANCEL with the same UID and SEQUENCE one higher.

**Boards PDF.** Six frames a page in position order, so 12 frames make 2 pages and 13 make 3. Each caption holds the frame number, timecode in and the action note exactly as on screen, and no caption pushes a frame to another page.

**Edit decision list.** CMX3600 text, ASCII only by the folding table, CRLF line ends.
- `TITLE: ` plus the folded title cut to 70 characters.
- `FCM: DROP FRAME` at 29.97, otherwise `FCM: NON-DROP FRAME`.
- A blank line.
- For each clip in position order: the event number in three digits from 001, two spaces, `AX`, seven spaces, `V`, five spaces, `C`, eight spaces, then source in (always zero), source out (the clip's duration as timecode), record in and record out, separated by one space. Record times count from frame 107892 at 29.97 and from `01:00:00:00` at the other rates.
- Then `* FROM CLIP NAME: ` plus the folded file name (`frame-<number>.svg` for a seeded drawing).

A first clip of 38 frames reads `001  AX       V     C        00:00:00;00 00:00:01;08 01:00:00;00 01:00:01;08` at 29.97 and `001  AX       V     C        00:00:00:00 00:00:01:13 01:00:00:00 01:00:01:13` at 25.

**Shot list.** Comma separated, UTF-8, every field in double quotes (a double quote inside is doubled), CRLF, with the header row `position,frame,timecodeIn,seconds,shot,visual,audio,actionNote`. `seconds` is half up to 0.01 with no unit. Any cell starting with =, +, -, @, a tab or a carriage return is prefixed with an apostrophe, because scripts and notes are typed by people.

**Package refusals.** A package is refused (409) when its cut is not signed off, when a frame has no drawing, or while a cue on the job has an ended licence, printing that cue's title and until date. Downloads are limited to 5 per desk per FILE_RATE_WINDOW_SECONDS (default 3600); the sixth answers 429, whose minute prints in Amsterdam time.

**Fee letters.** A value-priced letter in EUR, CAD or USD, with no hours and no payments.
- `fee` is a decimal string above 0 with `.` and at most two decimals, and amounts are stored in minor units.
- The fee splits across three milestones exactly, the earlier ones taking the extra cents: 12,500.00 is 4,166.67, 4,166.67 and 4,166.66.
- Tax follows the client's place: Netherlands 21%, Ontario 13%, New York none, Dubai none. It is worked out on each milestone on its own, half up to the cent on the exact amount, and the letter's tax is the sum of those. 1,835.50 at 21% is 385.455, shown `€385.46`; so 5,506.50 splits into three milestones of 1,835.50 and its tax is `€1,156.38`, not the `€1,156.37` that 21% of the whole gives.
- `totalMinor` is fee plus tax. Amounts print `€1,835.50`, `CA$1,835.50`, `US$1,835.50`.
- Fee, tax, total, state and ownership are decided only from the published fields: sending a total, a state or another desk's id in a body changes nothing.
- Accepting by typed name, compared by the folding table, locks the letter. A `stamp` read before a change answers 412, printing when it changed in the producer's town (Amsterdam for a letter with no producer yet).

**Enquiries.** At most 5 per ENQUIRY_RATE_WINDOW_SECONDS (default 3600) per address given, compared ignoring case; the sixth answers 429.

**Closing a client.**
- A client with no jobs can be deleted: it answers 204 and then 404 from then on. A client with jobs answers 409 and has to be closed.
- Closing starts CLOSURE_WAIT_SECONDS (default 2592000). While `closing` or `erasing` the client and its jobs stay readable on the desk, its writes answer 409 and its private pages answer 410, and no mail goes out for it.
- `closesAt` is the instant closing started plus CLOSURE_WAIT_SECONDS, and null on an `active` client. The wait ends exactly at `closesAt`: from that instant the client reads `erasing` or `erased`, never `closing`.
- Before `closesAt` the artist can bring it back exactly as it was, private pages whose lifetime still runs included. A bring-back at `closesAt` or later finds the wait ended and answers 409 with its copy from Feedback states, until the client is erased and answers 404. A bring-back on an `active` client answers 409 with `This client is not closing.`.
- When the wait ends the client goes to `erasing`. Erasure always asks MinIO first, even for a client with no files, tries again at least every 10 seconds while MinIO is down, and deletes the client's producers, frames, notes, letters, files and pending mail.
- The client becomes `erased` only after MinIO has confirmed each deletion. It then leaves `clients` and `total`, keeping one entry in `erasedClients` that shows `Erased`. Every address under it answers 404, private pages included.

**Dates and times on screens.** Dates are on the local date of the town named, never the UTC date. Every time-dependent state is decided by the server, because a device clock may be wrong. Every copy of the app reads its timers from the environment.

### Services (DP-10, DP-19, DP-21, DP-25, DP-26, DP-34, DP-36, DP-37, DP-39, DP-41, DP-50)

**Postgres** holds desks, clients, jobs, frames, clips, lines, cues, cuts, notes, sign-offs, calls, packages, fee letters, the job history and the pending mail. Each copy applies its schema and seed idempotently on serve, safely when several copies start together.

**MinIO** keeps every uploaded frame and attachment byte for byte, every finished film, the boards PDF, the edit decision list, the shot list and the fee letter PDF. The app makes its bucket when it is missing and MinIO is reachable. Object keys:
- `clients/<client id>/jobs/<job id>/frames/<sha256>`
- `clients/<client id>/jobs/<job id>/attachments/<id>`
- `clients/<client id>/jobs/<job id>/films/<render id>`
- `clients/<client id>/jobs/<job id>/packages/<package id>/boards.pdf`, `edit-decision-list.edl`, `shot-list.csv`
- `clients/<client id>/jobs/<job id>/letters/<letter id>/fee-letter.pdf`

`Stored`, `Ready` and `Erased` show only after MinIO has confirmed. While it is down, the upload, film, package and letter actions answer 503 with their copy and nothing is half-written, including rows pointing at missing objects. A closing client stays `Erasing`. Seeded drawings are generated SVG files, made when read and never kept in MinIO, so a copy starts with MinIO down.

**Mailpit.** All mail is sent over SMTP from the MAIL_FROM value `Noor Bakker Boards <desk@noorbakkerboards.example>`, through the pending mail in Postgres, each message once.

| Mail | To | Subject and content |
|---|---|---|
| Review page | producer | Subject from Private page copy; job title, full private address (`APP_PUBLIC_URL` + `/r/<token>`), due line; no fee and no other client's or producer's name |
| Reminder | producer | Same content, reminder subject |
| New link | producer | New link subject; each new address |
| Sign-off page | producer | Sign-off heading as subject; full address; no fee |
| Fee page | producer | English subject; full address |
| Call | producer | Call subject in the producer's language; attachment `call.ics`, type `text/calendar` with its method |
| Enquiry | `desk@noorbakkerboards.example` | `Enquiry from <name>`; the four fields |

**Gotenberg** renders the boards PDF and the fee letter PDF. Send HTML as `index.html` to `POST $GOTENBERG_URL/forms/chromium/convert/html`, with styles inline and drawings as data addresses; never ask it to fetch an address. A package or letter shows no finished state until it has answered and MinIO has confirmed. A package shows Ready only after Gotenberg has answered and MinIO has confirmed every file. With either down, the action answers 503 with its copy, nothing is saved, and any object written so far is removed. A letter's PDF text holds the same amounts as its screen.

**WireMock** plays two invented services at `$WIREMOCK_URL`. The app reads them only in answer to a person's action, never at start and never on a timer, except that the server polls a render it started. It waits at most 5 seconds for an answer; a later answer, a dropped connection or any status other than those published counts as unavailable.

*Hollowreed Music.*
- `GET /v2/tracks?q=<text>&cursor=<c>` gives 20 per page, answering `{"tracks":[{"id":"hr-1001","title":"Lantern Street","composer":"Ilse Voss","seconds":30}],"nextCursor":null}`. Every price is a decimal string read exactly. A `nextCursor` is sent back as `cursor` when `More results` is pressed, and an empty box calls nothing.
- The same search text and cursor never call the library twice within CUE_CACHE_SECONDS (default 300); only good answers are kept.
- Adding a cue reads `GET /v2/prices` every time, answered `{"prices":[{"validFrom":"2026-01-01","perMarket":"120.00"}]}`, and sends `POST /v2/licences` with `{"trackId":"hr-1001","market":"NL","from":"2027-03-01","until":"2027-03-31","fee":"120.00"}`, answered 201 `{"licenceId":"lic-501"}`. The cue exists only after that answer.
- The baseline tracks, whatever `q` asks, are hr-1001 Lantern Street (Ilse Voss, 30), hr-1002 Tidal Grid (Joost Amani, 15) and hr-1003 Paper Harbour (Mina Oduya, 60).

*Quaymill Render.*
- `POST /v1/renders` has the body `{"cutId":"c-1","frameRate":"29.97","width":1280,"burnTimecode":true,"clips":[{"frame":1,"durationFrames":38,"sha256":"..."}]}`, where `width` is 640 or 1280, `cutId` is the cut's id and each clip's `sha256` is its drawing's (null with none).
- It carries the literal header `Idempotency-Key` whose value is `<cut id>-<width>-<burnTimecode>`, for example `c-1-1280-true`.
- It answers 202 `{"id":"rnd-1","state":"queued"}`.
- `GET /v1/renders/<id>` answers `{"state":"queued"}`, `{"state":"running","progress":40}`, `{"state":"done","url":"/files/rnd-1.bin","size":28,"sha256":"a58537fe387c1985edd7165c243e84fec778a0c4e2766dabefe2157f966098ee"}` or `{"state":"failed","reason":"..."}`.
- `url` is a path on the same service. The baseline's body is the 28 bytes `QUAYMILL PREVIEW FILM rnd-1` and a line feed. The baseline answers the same id to every POST, so a provider id alone never identifies one of your renders.
- The app polls one render at most once per 5 seconds. A 429 with Retry-After in whole seconds, on POST or GET, means no call before that instant.
- A film is plain bytes: the app copies it into MinIO, offers `Download film` and never plays it. Size or SHA-256 not matching gives `failed` with the incomplete copy and nothing saved.
- A connection failure on asking answers the unavailable copy with nothing changed; during polling it simply polls again later.

### Seed data (DP-42)

Every seeded person and business is invented. Times count from when a copy first starts.

**Sign-ins.** `noor@noorbakkerboards.example` (Noor Bakker) and `theo@noorbakkerboards.example` (Theo Lindqvist), password `desk-pass-2027`.

**Noor's clients and producers.**

| Client | Place | Producer | Mail address | Town | Language |
|---|---|---|---|---|---|
| Hudson Yard Pictures | newYork | Marcus Hale | `marcus.hale@hudsonyard.example` | newYork | en |
| STICHTINGNOORDZEEPRODUCTIESENPARTNERSHOOFDKANTOORAMSTERDAM | netherlands | Zoë Ørsted | `zoe.orsted@noordzee.example` | amsterdam | nl |
| Maple & Lake Films | ontario | Élodie Tremblay | `elodie.tremblay@mapleandlake.example` | toronto | fr |
| Gulf Meridian Airways | dubai | ليلى حداد | `layla.haddad@gulfmeridian.example` | dubai | ar |

**Noor's jobs.** Each has twelve frames numbered 1 to 12, aspect 16:9, Cut 1 (`First pass`) and Cut 2 (`Second pass`), both equal to the board at start, and a due date 21 days after first start. Each frame's shot is its number as text, its action note and visual are `Action for frame <number>.`, its audio note is empty and its drawing is `frame-<number>.svg` at 1280 by 720.

| Job | Client | Rate | Target | Ad-ID | Frames | Target text | State |
|---|---|---|---|---|---|---|---|
| Harbour Light | Hudson Yard Pictures | 29.97 | :30 | `HUDS0000301H` | twelve of 75 (900) | `exact` | signedOff |
| Polder Run | the Stichting | 25 | :30 | `NOOR0000302H` | eleven of 62 and a last of 68 (750) | `exact` | draft |
| Maple Line | Maple & Lake Films | 23.976 | :15 | `MAPL0000303H` | twelve of 30 (360) | `exact` | inReview |
| Gulf Morning | Gulf Meridian Airways | 25 | :06 | `GULF0000304D` | twelve of 12 (144) | `6 frames under` | draft |

**Also on Noor's desk.**
- Harbour Light's Cut 1 is signed off by Marcus Hale. It has an open note `Hold the harbour light a beat longer.` and a done note `Bring the boat in from the left.`, both from Marcus Hale on frame 4.
- Maple Line has an open note `Le plan est un peu court.` from Élodie Tremblay on frame 4, sent from a review page on Cut 2 that is already `ended`, so no reminder is due.
- Polder Run has a cue for Lantern Street (hr-1001, Ilse Voss, 30 seconds, market NL, fee 120.00, `lic-401`), from 30 days before first start until yesterday.
- Maple Line has a cue for Tidal Grid (hr-1002, Joost Amani, 15 seconds, market CA, fee 120.00, `lic-402`), from 30 days before first start until 3 days after, on Toronto's date.
- There are two calls with Marcus Hale at 09:00 New York time, 30 minutes: one on the last weekday before the next clock change in New York or Amsterdam, and one on the first weekday after it.
- Maple Line has one fee letter in CAD, fee 6,000.00, scope `Boards and story reel`, state `sent`, for Élodie Tremblay. Its PDF is made when first read.

**Theo Lindqvist's desk.** One client, Fjordlight Studio (netherlands), no producers, with one job, Quiet Harbour (25, :15, Ad-ID `FJOR0000401H`, 16:9, no frames, draft).

**Public site.**
- Work: Boards `Ferry at First Light`, `The Long Bakery Shift`, `Cold Snap Cola`; Reels `Night Tram`, `Harbour Swimmers`, `Paper Kites`; Pitch frames `Rainline Coats`, `Orchard Bank`, `Salt and Thyme`.
- Client strip: `Tidewater Soda`, `Kestrel Air`, `Oak & Ember Bakers`, `Northquay Bank`, `Lumen Bicycles`, `Saffron Street Foods`.
- Mail address: `desk@noorbakkerboards.example`. The public site stays Noor's for every desk.

Seeding sends no mail. A new desk from `/sign-up` starts empty. Tests that change anything make their own clients and jobs.

## Technical requirements

### Deployment (DP-49, DP-50)

Node.js and npm are available. `/app/run.json` holds string `install`, `build` and `serve` with `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run serve"}
```

Serving binds `0.0.0.0` on port 4173, honouring `APP_PUBLIC_PORT`, and `GET /api/health` answers HTTP 200 JSON `{"status":"ok"}`. Full addresses in mail start with `APP_PUBLIC_URL`.

Extra copies run from the same manifest with a changed environment:

| Copy | What it changes |
|---|---|
| MinIO down | S3_ENDPOINT broken, `${DATABASE_URL}_storage`, `${S3_BUCKET}-storage`, CLOSURE_WAIT_SECONDS=5 |
| Gotenberg down | GOTENBERG_URL broken, `${DATABASE_URL}_render`, `${S3_BUCKET}-render` |
| Short timers | `${DATABASE_URL}_short`, `${S3_BUCKET}-short`, REVIEW_PAGE_SECONDS=20, SIGN_OFF_PAGE_SECONDS=20, FEE_PAGE_SECONDS=20, REMINDER_AFTER_SECONDS=10, UNDO_SECONDS=6, ENQUIRY_RATE_WINDOW_SECONDS=30, REVIEW_LINK_RATE_WINDOW_SECONDS=30, FILE_RATE_WINDOW_SECONDS=30, CUE_CACHE_SECONDS=10, CLOSURE_WAIT_SECONDS=20 |
| Short session | `${DATABASE_URL}_session`, `${S3_BUCKET}-session`, SESSION_SECONDS=20 |

Every copy starts with the seed data on its own database and bucket and delivers its own pending mail. The platform creates each `${DATABASE_URL}_<suffix>` database empty before that copy starts, so the app never creates a database; it applies its schema and seed to the database it is given.

### Configuration and secrets (DP-51)

Read at start, never hard-coded and never sent to the browser:
- `DATABASE_URL`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`
- `WIREMOCK_URL`, `GOTENBERG_URL`
- `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`

Timers, with defaults in seconds: SESSION_SECONDS 28800, UNDO_SECONDS 10, CUE_CACHE_SECONDS 300, and the others as named in Business rules. A session ends SESSION_SECONDS after sign-in, and the server alone decides that.

### Server boundary (DP-03, DP-10, DP-46, DP-48, DP-50)

The app is same-origin and served over plain http. A state-changing request whose Origin differs from the app's own answers 403, a request with no Origin is judged as same-origin, and no response echoes a foreign Origin with credentials allowed. The browser never calls MinIO, Gotenberg or WireMock directly; drawings, films and files come through the app.

The server never serves source files, credentials or service addresses. Unknown routes answer as the ladder says. When MinIO, Gotenberg or WireMock is unreachable at start, the app still starts and serves, and only the actions that need that service answer their published outage copy.

### Browser support and performance (DP-43, DP-49)

Current Chromium, Firefox and Safari at 320x568, 375x812, 768x1024, 812x375 and 1280x800. Fonts ship with the app. Each screen is usable within three seconds on a local connection, and a search answer shows within one second of the pause ending.

## Working rules

- **IF-01** `/app/run.json` exists with string `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`.
- **IF-02** `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package and font with its licence, where shipped packages means the production dependency tree (`npm ls --omit=dev --all --json`).
- **IF-03** Shipped packages (`npm ls --omit=dev --all --json`) use only MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, CC0-1.0, Unlicense or, for fonts, OFL-1.1 licences.
- **IF-04** No datastore or broker is added beyond Postgres and MinIO, and the only other services are Mailpit, Gotenberg and WireMock.
- **IF-05** The WireMock baseline and the service settings you were given stay untouched, and the app has no admin access to WireMock.
- **IF-06** The app is written in TypeScript and its source holds no video element, no codec and no stock image.
- **IF-07** Libre Franklin and Source Serif 4 ship with the app, and no page loads anything from another origin.

## Engineering standards

- Code is idiomatic TypeScript with strict type checking on, and names match the domain terms in this brief: frame, clip, cut, stamp, cue, licence, render, review page, sign-off, fee letter, milestone, desk.
- Each domain rule (a state transition, a timecode, a half-up rounding, a page's ending instant, a licence state, a folding) is decided in exactly one place in the source.
- Timecodes, real seconds and money use exact whole-number or rational arithmetic, and no floating point value reaches a shown amount or frame count.
- No abstraction has a single implementation, and no features exist beyond this brief.
- No dead, commented-out or unreachable code, and no defensive checks for impossible states.
- One error shape is produced in one way across every endpoint, and each refusal uses its published copy.
- Copy for the four languages lives together as data, and no published sentence is assembled from translated fragments beyond its printed placeholders.
- The refresh changes the page by updating existing elements in place, never by rebuilding a screen.
