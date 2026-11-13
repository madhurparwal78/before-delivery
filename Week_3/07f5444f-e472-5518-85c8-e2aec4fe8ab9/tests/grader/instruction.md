# Quirewell Stand Desk

Quirewell Stand Desk is the working desk of a regional orchestra's music library. Librarians use it to build each concert programme: they choose its works, set the string count and mark the conductor's cuts on each work's bar map. They also record copies on hand, file marked-part and bowing scans, publish a folder to each player and get rental sets back to the publisher on time. Section principals confirm cuts and file their section's bowing masters. Players open their own folder on a phone or tablet before rehearsal. The server stores everything in Postgres. MinIO (S3-compatible object storage, called "the score store" in the product) holds every uploaded scan. Mailpit receives every email the product sends. Out of scope: self-registration or account management (every person is seeded), any datastore besides Postgres and MinIO, editing bar maps or the catalogue, annotating PDFs in the browser, payments, publisher integrations, and changing the orchestra's time zone.

## Problem and users

Every concert goes through the library first. Two or three trained librarians collect the conductor's cuts, the concertmaster's bowings, the string count for each programme and the publisher's rental terms. Then they hand each player a correct folder before the first rehearsal. Today this work is split across spreadsheets, a catalogue module that only lists holdings, emailed PDFs and pencil marks.

- When a cut changes the night before, nobody knows which parts still need it marked, or who said a part was already marked.
- When the string count rises from 8-7-6-5-4 to 10-8-6-5-4 (first violins, second violins, violas, cellos, basses), the missing copies only show up on the stand. When the count drops, players who are no longer seated still open last week's folder.
- A rental set returned late costs a fee for an extra rental period, and the due date counts from the final performance in the orchestra's own time zone. Two assistants counting the same returned bundle overwrite each other's tallies.
- Rehearsal times entered around the October and March clock changes land an hour out. A laptop whose clock or time zone is set somewhere else tells the librarian a folder can be published when it can't.
- Marking bowings takes 5 to 50 hours per symphony, so a lost, renamed or overwritten scan of marked parts is expensive.

Users:

- **Principal librarian** (daily): builds each programme's works, string count and cuts, publishes folders to players, and keeps rental sets on time.
- **Assistant librarian** (daily): records copies on hand, uploads marked-part scans, records parts as hand-marked, and checks returned rental copies back in against the rental slip. Two assistants often count different bundles of the same returned set at the same time.
- **Section principal** (weekly): sits in chair 1 of a string section. Uploads the section's bowing master for each work and confirms the cuts the section's part carries. Also has a folder like any player.
- **Player** (weekly): opens their own folder on a phone or tablet before rehearsal and sees the parts, cuts and rehearsal letters for their chair.

## Journeys

1. **Build a programme.** The principal librarian is signed in on the programme desk. They choose `New programme` and enter a title, a first rehearsal and performances in London time, one of them in the repeated hour of the October clock change. They add two catalogue works and start preparation. The new programme appears in the rail with the next season number. Its header shows the London dates, the running time and the copy figures, and the parts table lists every part with its copies needed. A time typed inside the missing hour of the March clock change is refused in the dialog before anything is sent.
2. **Raise the string count.** The principal librarian opens Programme 01, changes the string count from 8-7-6-5-4 to 10-8-6-5-4 and saves. Without a reload, the rail, the header and the parts table all show the higher copies needed and the new shortfall. The assistant librarian then tabs quickly through the copies-on-hand cells, changing one value twice in a row on a slow connection. The row, rail and header end on the figures from the last value typed, and the shortfall returns to 0 on every surface.
3. **Mark a cut with the keyboard.** The principal librarian tabs to the bar ruler of The Weir, moves the caret to bar 120, holds Shift and moves to bar 184, and presses Enter. The span hatches and collapses to a splice mark. Later rehearsal letters slide left, the running time counts down from 38:40 to 34:12, and 14 parts show a `Mark cut` flag. They reload and see the same result. They restore the cut from its splice mark, and everything returns.
4. **Confirm cuts and file a bowing master.** The Violin I section principal opens the section desk and confirms that the Violin I part of The Weir carries the new cut. At the same moment the assistant librarian records the same part as marked on the desk. One mark is stored, naming whoever stored it first, and both screens show that one name. The section principal uploads a bowing master PDF whose file name has accents, a dash and quotes. Its status reads `Uploading`, then `Filed`, and the filed version is listed under its exact file name.
5. **File a marked-part scan, then lose the score store.** The assistant librarian uploads a marked scan for a part from the parts table. The upload start, its progress and the filed result are announced. Months later they download the scan and get the same file under the same name. One afternoon the score store goes offline while the desk is open: on the next status check the outage banner appears and every upload button turns unavailable in place, without a reload and without losing focus. When the store comes back, the buttons work again.
6. **Publish folders.** The principal librarian's laptop clock is set to the wrong year and the wrong time zone. They open `Publish folders` for Programme 01. The dialog lists what the server says blocks publishing, which is nothing, so they publish. Each seated player gets one email that lists only their chair's parts and the first rehearsal time, and the notices list shows each one as `Sent`. On a programme whose first rehearsal has already started, the same dialog lists that blocker and keeps `Publish` unavailable.
7. **Open a folder on a phone, and lose a seat.** A second-violin player signs in on a phone and opens their folder for Programme 02. They swipe between part pages and see the cut `vi–de 97–128` and the remaining rehearsal letters. They tap `Open marked part` to download the filed scan. When a status check reports the score store down, that link becomes the unavailable copy on the page they are reading, and comes back when the store returns. A Violin I player in chair 09 has the folder open when the principal librarian lowers Violin I to 8. Within 30 seconds, or as soon as they turn a page or come back to the tab, their phone shows the not-in-folder page. When the count goes back up, the folder returns with no second email. A Harp player who has no published folder sees the empty-state copy.
8. **Rentals: reminders and returns.** The principal librarian creates a rental set from a hire library with an accented name. Each assistant librarian receives one reminder from seven days before the due date, with the work and the hire library's name in the subject exactly as typed. A name pasted with a line break is refused in the dialog, and no mail goes out. Later an assistant librarian opens Rentals, sees Orchard Serenade marked `Overdue`, opens its check-in dialog and starts typing counts. The minute reload and the status check pass without closing the dialog or losing what they typed. A colleague saves the same line first, so their save is refused with a message naming the changed line, which now shows the colleague's count. Marking the set returned is refused while one cello copy is missing. Once the count is corrected, the set is marked returned, and the principal librarian confirms the publisher's receipt.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Passcode sign-in** Seeded people sign in with email and passcode, receive a session cookie, and land on the screen for their role, as qualified in API.
- **DP-02 — Role-scoped access** Every endpoint enforces the role table and the single error order in API, so a role that may not act gets the stated 403 or 404 and nothing changes.
- **DP-03 — Create a programme** The principal librarian creates a draft programme with a single-line title, first rehearsal, performances and string count, and it takes the next two-digit season number.
- **DP-04 — Add works from the catalogue** The principal librarian adds a catalogue work to a programme, which copies the work's bar map, rehearsal letters and parts with no copies on hand and no cuts.
- **DP-05 — Programme status changes** A programme moves only along the legal edges in Business rules, and every other change is refused with 409 and leaves the programme unchanged.
- **DP-06 — Programme desk breakpoints** The programme desk shows three panes at 1280 by 800, the works rail as a drawer at 768 by 1024, and one stacked column at 375 by 812, with no horizontal page scrolling.
- **DP-07 — Build a programme on the desk** Using only the desk's dialogs, the principal librarian creates a programme from London wall-clock times, adds a work and starts preparation, and the rail, header and parts table show the result without a reload.
- **DP-08 — Copies-needed rule** Copies needed, copies on hand and shortfall for every part, work and programme follow the desk rule in Business rules and are computed by the server.
- **DP-09 — Copies on hand** Librarians record copies on hand per part, the response and every later read carry the recomputed figures, and when several saves of one part are in flight the screen shows only the latest request's figures.
- **DP-10 — String count limits** A string count with a non-integer, a negative number or more players than the section's roster is refused with 422 field errors and nothing changes.
- **DP-11 — Counts agree on every surface** After the principal librarian saves a new string count, the works rail, parts table, programme header and Desk status show the same new figures together, matching the API, and of several saves in flight only the latest one's response is rendered.
- **DP-12 — Stored cuts and running time** A cut is stored once as a bar span, and the server derives from it each work's running time, the programme's running time and the cut's saving, all of which survive a reload.
- **DP-13 — One cut per bar** A cut that shares any bar with an existing cut on the work is refused with 409, and when overlapping cuts are submitted at the same time exactly one is stored.
- **DP-14 — Keyboard cut marking** On the bar ruler, arrow keys move the caret, Shift with an arrow extends the span, Enter commits the cut, Escape clears the selection, and focus stays on or returns to the ruler.
- **DP-15 — Cut splice motion** Committing a cut hatches the span, collapses it to a narrow splice mark labelled with its bars, slides later letters and ticks left and counts the running time down, all within one second.
- **DP-16 — Reduced-motion splice** With reduced motion the ruler redraws already spliced, the new total shows at once, and the Ruler status line carries the cut summary.
- **DP-17 — Restore a cut** The principal librarian restores a cut from its splice mark's dialog or with Undo cut, the splice plays back in reverse, the bars, total and flags return, and focus returns to the ruler.
- **DP-18 — Parts to mark** Each part whose printed bars overlap an unmarked cut shows a Mark cut flag, each stored mark shows as one attributed line in the part's Marking cell, and the desk shows the count of parts to mark, all derived from stored cuts and marks.
- **DP-19 — Confirm a part carries its cuts** Librarians, and section principals for their own section's part, record that a part carries a cut, which clears that part's flag for that cut, and of simultaneous confirmations of one part and cut exactly one stores the mark with 201 and the rest get 200 with the same body.
- **DP-20 — Section desk** A section principal sees their section's part in each active programme, and confirms its cuts and files its bowing master from one screen.
- **DP-21 — File a marked-part scan** A marked-part scan counts as filed only after the score store confirms the write, and the catalogue never lists a scan whose object does not exist.
- **DP-22 — Upload announcements** Upload start, completion and failure are each announced in the polite Upload status region with the part label and the result copy from Feedback states.
- **DP-23 — Scan type and size** Only PDF, PNG and JPEG files whose bytes match their type and whose size is within the limit are filed, and others are refused with the API's 413, 415 or 422.
- **DP-24 — Upload replay** Repeating an upload with the same Idempotency-Key returns the stored response without a second object, and reusing the key for different content gets 409.
- **DP-25 — Bowing master filing status** A section principal's bowing master upload reads Uploading until the server confirms filing, then Filed, or Not filed after any failure.
- **DP-26 — Every version kept as uploaded** Each filed scan keeps its exact bytes, UTF-8 file name and type permanently, a later upload adds a new version, and download returns the original bytes under the Content-Disposition built from the stored name as stated in API.
- **DP-27 — Publish guards** Folders publish only from in preparation, while the first rehearsal is in the future by the server's clock, with at least one work and no copies short, and a refused publish answers the 409 of the first failing guard.
- **DP-28 — Folder-ready emails** Publishing sends each seated player one email listing only their chair's parts and the first rehearsal time, and players seated later by a string count rise get theirs at that point.
- **DP-29 — One publish wins** A publish replayed with its Idempotency-Key returns the stored result with no new email, and when publishes arrive at the same time exactly one succeeds.
- **DP-30 — Notice delivery status** A notice reads sent only after the mail server accepts it, and while mail is down publishing still succeeds and notices stay queued and are retried, as qualified in Services.
- **DP-31 — Folder scope by chair** A player reaches only the published folders and parts of their own chair, decided from stored data on every request, and every other programme, part or scan answers 404 by URL and shows the not-in-folder page in the browser.
- **DP-32 — Folder on a phone** At 375 by 812 a player's folder shows one part page at a time that swipes with touch, has buttons and arrow keys as equivalents, shows a page position status, and asks the server for its current page again on every page change, status check and tab return.
- **DP-33 — Folder under reduced motion** With reduced motion, page changes in the folder are instant and show the same pages, cuts and letters.
- **DP-34 — Folder empty and unavailable states** A player with no published folder, a part with no filed scan, and a folder whose latest folder response or status check says scans are unavailable each show their exact copy from Feedback states.
- **DP-35 — Rental set lifecycle** A rental set moves through requested, received, in use, returned and checked in only along the legal edges, and illegal moves are refused with 409.
- **DP-36 — Return-due date in the business zone** Each rental set's return-due date and Overdue status follow the business-zone rule in Business rules and are decided by the server, whatever the browser's time zone.
- **DP-37 — Check-in against the slip** Librarians record copies checked back in per slip line without losing another line saved at the same moment, a save whose expected count for any named line is stale is refused whole with 409 count_changed, a set is never marked returned while any copy on the slip is missing, and of simultaneous returns exactly one succeeds.
- **DP-38 — Return reminder email** Each assistant librarian gets one reminder per rental set from seven days before its due date, with the work and publisher in the subject, queued and retried while mail is down, as qualified in Services.
- **DP-39 — Score store outage** With the score store unreachable, uploads answer 503 with no catalogue row, status reports storage down, librarian and section screens show the outage banner word for word, and catalogue, counts and cuts keep working.
- **DP-40 — Dialogs keep focus** Every dialog and the drawer keeps Tab and Shift+Tab inside itself, closes on Escape, and returns focus to the control that opened it.
- **DP-41 — Health and run manifest** The app installs, builds and serves from /app/run.json on the published port and answers the health check with 200 and the stated body.
- **DP-42 — Server boundary** The server answers same-origin requests only, enforces body limits and content types, never serves source or credentials, and starts without the score store or mail.
- **DP-43 — Engraved look** Screens use the warm paper ground, ink text, oxblood accent, hairline rules between every row and tabular mono numbers described in Visual design.
- **DP-44 — Cut splice craft** A spliced ruler shows boxed serif rehearsal letters, per-bar ticks, accent hatching collapsed to a labelled splice mark, and mono bar numbers at each viewport's label interval that stay legible and never overlap.
- **DP-45 — Service wiring from the environment** Database, storage and mail credentials and URLs are read from the environment at start, never hard-coded or sent to the browser, and every displayed figure comes from server data.
- **DP-46 — Seating changes apply at once** When a lower string count unseats a player, their very next folder, page or scan request answers 404 and their open folder shows the not-in-folder page at its next refresh, and raising the count again restores access without a second email.
- **DP-47 — Refreshes keep work in progress** The Rentals screen's reloads and every screen's status check update figures in place without closing an open dialog, discarding unsaved values, moving focus or clearing the ruler selection, and a changed check-in line keeps the expected count it had when first changed, as qualified in Interactions.
- **DP-48 — One-line text in mail** A publisher or programme title containing a line break or other control character is refused with 422 and its field copy and sends no mail, non-ASCII text reaches mail subjects exactly as typed, and every message has exactly one recipient and no Cc or Bcc.
- **DP-49 — London wall-clock times** Rehearsal and performance times typed in London time are sent with London's offset for that date, a repeated hour takes the earlier offset, a missing hour is refused in the dialog with its Feedback states copy, and the server orders times as instants.
- **DP-50 — Attributed marks** Every stored mark records who stored it and when, is never updated, and every simultaneous or later confirmation returns that first attribution, which the desk and the section desk display.
- **DP-51 — Publish blockers from the server clock** Every programme read carries the publish blockers the server's own publish check finds at that moment, and the Publish folders dialog lists them and allows Publish only when the list is empty, whatever the browser's clock or time zone.
- **DP-52 — Storage state updates screens in place** Each status check that reports the score store down or back up disables or re-enables upload buttons and swaps a player's Open marked part link for the unavailable copy in place, keeping the page, focus, open dialogs and typed values.

## Frontend

### Screens and layout (DP-06, DP-07, DP-11, DP-20, DP-32)

All screens share one application. Client routes:

- `/` — **Sign in.** A centred form on the paper ground with the product name in the display face.
- `/desk/<programme id>` — **Programme desk** (principal and assistant librarians). The optional `?work=<work id>` selects a work; by default the programme's first work is selected. A bare `/desk` opens the lowest-numbered programme that is not closed.
- `/rentals` — **Rentals** (principal and assistant librarians).
- `/section` — **Section desk** (section principals).
- `/folder` and `/folder/<programme id>` — **Folders** (players and section principals). `/folder/<programme id>/<part id>` opens that page of the folder.

After sign-in, librarians land on `/desk`, section principals on `/section` and players on `/folder`. Signed-out visits to any route except `/` go to `/`.

**Programme desk.** It has four regions:

- the works rail: every season programme as a large display numeral (01, 02, 03) with its title and status, and under the current programme its works, each with its own `Needed`, `On hand` and `Short` figures and parts-to-mark count;
- the programme header: title, status, first rehearsal, final performance, string count, running time, the programme's `Needed`, `On hand` and `Short` figures, and the status actions;
- the bar ruler of the selected work: full width, with a tick per bar, bar numbers at the label interval given below, and rehearsal letters in boxed serif capitals above;
- the parts table: one hairline-ruled row per part of the selected work.

Layouts, which must match exactly at the published viewports:

- **1280 by 800 and wider:** three panes. The works rail is a fixed left column the full height of the screen. The right column holds the programme header at the top, the bar ruler pane below it, and the parts table pane below that. All three panes are visible at once without scrolling the page to reach the ruler.
- **768 to 1279 wide (published size 768 by 1024):** the works rail is not shown in the page and is out of the tab order. The button `Programmes and works` at the top left opens it as a drawer from the left edge. The header, ruler and parts table fill the width in that order.
- **Below 768 wide (published size 375 by 812):** one stacked column in this order: programme header, works rail (shown inline as a list, no drawer button), bar ruler, parts table. Each part row becomes a stacked card with the same cells, each cell labelled.

At every width the ruler scales so that the whole uncut work fits the ruler pane, and nothing scrolls the page sideways. Bar numbers are printed on bar 1 and then at an interval set by the browser viewport's width (not the ruler pane's width), using the same three bands as the layouts above:

- every tenth bar when the viewport is 1280 wide or wider;
- every twenty-fifth bar when it is 768 to 1279 wide;
- every fiftieth bar when it is below 768 wide.

For example, with the seed data at start, The Weir at 1280 by 800 is labelled at bar 1 and at every multiple of ten from bar 10 to bar 300. Labels never overlap one another or a rehearsal letter. Bar spacing is fixed for the current pane width. After a cut the ruler is shorter by the removed width, so the space to the right of the last bar stays empty.

**Rentals.** A heading, a `New rental set` button and the rental sets table with the columns Work, Publisher, Programme, Due, Status, Copies (checked in out of on slip) and Reminder. Below 768 wide each row becomes a card.

**Section desk.** One card per work for each programme that is in preparation, published or in performance, grouped under the programme's number and title. Each card shows the section's part, its cuts (each with a confirm button or an attributed confirmed mark), the bowing master upload, its status and the list of filed bowing masters.

**Folders.** `/folder` lists the player's visible folders. `/folder/<programme id>` shows the folder heading (programme number, title and the player's chair label) and a page carousel with one page per part. Each page shows:

- the work title and composer;
- the part name and the part's printed bars;
- the cut list;
- a strip of the remaining rehearsal letters with their bar numbers;
- the marked-part link or its state copy.

At 375 by 812 a page fills the width. Only one page is visible at a time at every size.

### Public screens and controls (DP-01, DP-06, DP-11, DP-14, DP-17, DP-18, DP-20, DP-22, DP-25, DP-31, DP-32, DP-34, DP-37, DP-39, DP-40, DP-46, DP-47, DP-48, DP-49, DP-50, DP-51, DP-52)

Only these roles and names are public. Everything else is up to you. `<part label>` is `<work title> — <part name>`, for example `The Weir — Violin I`. A string written as `<from>–<to>` uses an en dash. `<name>` is a person's full name as stored, for example `Hester Quayle`.

| Screen | Role and accessible name | Visible copy or content |
|---|---|---|
| Sign in | `textbox "Email"`, `textbox "Passcode"`, `button "Sign in"` | labels as named |
| Sign in | `alert` inside the form | sign-in error copy |
| All signed-in | `navigation "Library"` with `link "Programme desk"` and `link "Rentals"` (librarians), `link "Section desk"` (section principals), `link "Folders"` (players and section principals), `button "Sign out"` | as named |
| All signed-in | `alert` banners | score store and mail outage copy |
| Desk | `complementary "Programmes and works"` (the works rail) | |
| Desk rail | `link "Programme <nn> · <title>"` per programme | numeral `<nn>`, title, status label |
| Desk rail | `list "Works in programme"`, one `listitem` per work with `link "<work title>"` | `Needed <n>`, `On hand <n>`, `Short <n>`, `<n> to mark` |
| Desk 768–1279 | `button "Programmes and works"` opens `dialog "Programmes and works"` | |
| Desk | `region "Programme header"` with `heading` level 1 `<programme title>` | number, status label, dates |
| Desk header | `group "Running time"` | `<M:SS>` |
| Desk header | `group "Programme copies"` | `Needed <n>`, `On hand <n>`, `Short <n>` |
| Desk header | `spinbutton "Violin I"`, `spinbutton "Violin II"`, `spinbutton "Viola"`, `spinbutton "Cello"`, `spinbutton "Bass"`, `button "Save string count"` | |
| Desk header | `button "New programme"` opens `dialog "New programme"`: `textbox "Title"`, `textbox "First rehearsal (London time)"`, `textbox "Performance 1 (London time)"` (more via `button "Add performance"`, named `Performance <n> (London time)`), the five string-count spinbuttons, `button "Create programme"`, `button "Cancel"` | field descriptions carry the field copy |
| Desk header | `button "Add work"` opens `dialog "Add work"`: `combobox "Catalogue work"`, `button "Add"`, `button "Cancel"` | |
| Desk header | `button "Start preparation"`, `button "Return to draft"`, `button "Start performances"`, `button "Close programme"` (each shown only when its edge is legal); `button "Publish folders"` (shown whenever the programme is in preparation) | |
| Desk header | `dialog "Publish folders"`: `list "Publish blockers"` (one `listitem` per blocker), `button "Publish"`, `button "Cancel"` | seated players, first rehearsal, blocker messages or the no-blockers line |
| Desk header | `link "Player notices"` opens `dialog "Player notices"` with `table "Player notices"` | statuses `Sent`, `Queued` |
| Desk | `status "Desk status"` (polite) | desk action copy |
| Desk ruler | `slider "Bar ruler"`, value range 1 to the work's bars; value text `Bar <n>` or `Bars <from>–<to> selected` | ticks, letters, splice marks |
| Desk ruler | `button "Mark cut"` (enabled while a span is selected) | `Mark cut <from>–<to>` |
| Desk ruler | `button "Undo cut"` | |
| Desk ruler | `button "Restore bars <from>–<to>"` per splice mark opens `dialog "Restore bars <from>–<to>"` with `button "Restore bars"` and `button "Keep cut"` | mark label `vi–de <from>–<to>` |
| Desk ruler | `status "Ruler status"` (polite), a text line under the ruler | cut and restore copy |
| Desk | `table "Parts"`; its heading shows `Parts` and `<n> to mark` | columns `Part`, `Bars`, `Needed`, `On hand`, `Short`, `Marking`, `Scan` |
| Desk parts | `spinbutton "Copies on hand <part name>"` per row | |
| Desk parts | Marking cell: flag text `Mark cut` with `button "Record marked <part name>"` while the part has cuts to mark; below it one line per stored mark | mark line `<from>–<to> · <name>` |
| Desk parts | `button "Upload scan <part name>"` (opens the file chooser), `link "Download <file name>"` for the latest filed marked-part scan | |
| Desk parts | `progressbar "Upload progress"` while uploading, `status "Upload status"` (polite) | upload copy |
| Rentals | `table "Rental sets"`; status cell shows a status label or `Overdue` | |
| Rentals | `button "New rental set"` opens `dialog "New rental set"`: `combobox "Work"`, `textbox "Publisher"`, `spinbutton "Slip copies <part name>"` per part, `button "Create rental set"`, `button "Cancel"` | Publisher's description carries its field copy |
| Rentals | per row: `button "Mark received <work title>"`, `button "Mark in use <work title>"`, `button "Check in <work title>"`, `button "Confirm publisher receipt <work title>"` (each shown only when legal) | |
| Rentals | `dialog "Check in <work title>"`: `spinbutton "Returned <part name>"` per slip line, `button "Save counts"`, `button "Mark returned"`, `button "Close"` | |
| Rentals | `status "Rental status"` (polite) | rental copy |
| Section desk | `heading` level 2 per work: `<work title>` | |
| Section desk | `button "Confirm cut <from>–<to>"` per unconfirmed cut on the section's part | confirmed cuts read `Confirmed <from>–<to> by <name>` |
| Section desk | `button "Upload bowing master <work title>"`, `status "Bowing master status: <work title>"` (polite), `list "Filed bowing masters: <work title>"` with `link "Download <file name>"` per version | `Uploading`, `Filed`, `Not filed` |
| Section desk | `status "Section status"` (polite) | confirm copy |
| Folders | `list "Your folders"` with `link "Programme <nn> · <title>"` | |
| Folder | `region "Folder pages"` (carousel); each page a `group "<part label>"` | |
| Folder | `button "Previous part"`, `button "Next part"`, `status "Page position"` | `Part <i> of <n>` |
| Folder page | `link "Open marked part"` | or a state copy |
| Not in folder | `heading` level 1 | not-in-folder copy; no `Folder pages` region and no `Page position` status |

`<file name>` in every `Download <file name>` link is the scan's stored file name, character for character.

### Interactions (DP-07, DP-09, DP-11, DP-14, DP-17, DP-19, DP-20, DP-25, DP-32, DP-37, DP-40, DP-46, DP-47, DP-49, DP-51, DP-52)

**Sign in.** Enter in either field submits. On success the browser goes to the role's landing route. On failure the alert shows the error, and focus moves to the Email field.

**Works rail.** Choosing a programme link opens its desk. Choosing a work link selects that work in the ruler and parts table without a full reload. In the 768–1279 drawer, choosing a work also closes the drawer.

**String count.** The five spinbuttons accept whole numbers. Arrow Up and Arrow Down step by 1. `Save string count` sends all five. On success the rail work items, the header's `Programme copies`, and the parts table's `Needed`, `On hand` and `Short` cells all update from the one server response, in the same rendered frame. No surface ever shows a figure from before the save next to one from after it. Saving twice in a row follows the latest-save rule in Feedback states.

**Copies on hand.** Changing a part's spinbutton and then pressing Enter or leaving the field (Tab included) saves it. Leaving or pressing Enter on a spinbutton whose value equals the value it held when it gained focus sends nothing. The row, the rail and the header update from the server response together. Changing the same spinbutton again before the first save has answered sends a second save at once; the latest-save rule in Feedback states decides what shows.

**Bar ruler, keyboard.** The ruler is one tab stop. When it gains focus the caret sits on bar 1, or on the last bar the caret was on.

- Arrow Right and Arrow Left move the caret one bar. Home goes to bar 1 and End to the last bar. The caret skips over bars inside existing cuts.
- Shift with Arrow Right or Arrow Left extends the selection from where the caret was when the extension started. The selection never crosses into an existing cut; the caret stops at the last bar before it.
- Enter with a selection commits the cut. Enter with no selection does nothing.
- Escape clears the selection and leaves the caret where it is.
- Focus stays on the ruler through the commit and its animation. When the cut is committed with the `Mark cut` button, focus returns to the ruler once the animation ends.
- The slider's value text always names the caret bar or the selected span.

**Bar ruler, pointer and touch.** Pressing on a bar and dragging selects the span between the press and the release. A drag across an existing cut stops at the last bar before it. After the drag, `Mark cut` shows the span; choosing it commits. Escape or a tap outside the ruler clears the selection.

**Undo and restore.**

- `Undo cut` removes the most recent cut committed on this work in this browser session and plays the splice in reverse.
- Choosing a splice mark's `Restore bars <from>–<to>` button opens its dialog. `Restore bars` removes the cut and plays the reverse animation. `Keep cut` closes the dialog.
- After a restore, focus returns to the ruler, because the splice mark is gone. After `Keep cut` or Escape, focus returns to the splice mark.

**Recording a part as marked.** On the desk, `Record marked <part name>` records the part against every cut it still has to mark, and the flag, mark lines and counts update from the responses. On the section desk, `Confirm cut <from>–<to>` records the section's part against that one cut, and the button is replaced by the confirmed copy naming the mark's stored `marked_by`, never the signed-in person unless they stored it. A 200 answer is a success like a 201.

**Uploads.**

- On the desk, choosing `Upload scan <part name>` opens the file chooser for a marked-part scan. The `Upload progress` bar follows the bytes sent.
- On the section desk, choosing `Upload bowing master <work title>` opens the file chooser. Its status reads `Uploading` from the moment a file is chosen until the server answers. It reads `Filed` only after a 201 response, and `Not filed` after any other outcome, including a network failure. The filed list then shows the new version above the earlier ones. Earlier versions stay listed and downloadable.
- The chosen file is sent under its own file name, unchanged by the client.
- While upload buttons are unavailable under the storage rule in Feedback states, activating one by click, tap, Enter or Space does nothing and opens no file chooser.

**New programme.**

- The `First rehearsal (London time)` and each `Performance <n> (London time)` textbox accept a date and time typed as `YYYY-MM-DD HH:MM` in 24-hour London time, for example `2026-12-01 10:00`. Leading and trailing spaces are ignored.
- The client turns each value into a timestamp written exactly as `YYYY-MM-DDTHH:MM:00±HH:MM`. It uses London's offset for that wall-clock time on that date, following the wall-clock rule in Business rules. It never uses today's offset or a fixed offset. For example, `2026-12-01 10:00` is sent as `2026-12-01T10:00:00+00:00`, and `2027-04-01 10:00` as `2027-04-01T10:00:00+01:00`.
- When a textbox holds text that is not in the accepted form, or names a wall-clock time that does not exist in London, the dialog describes that textbox with its field copy from Feedback states. Nothing is sent, and focus moves to the first such field.
- The `Title` textbox sends exactly what was typed or pasted, line breaks included, under the line-break rule below. A 422 describes the textbox with its field message from Feedback states and keeps the dialog open with the typed values.

**Publishing.**

- `Publish folders` opens its dialog and, at that moment, re-reads the programme. The dialog shows the seated players, the first rehearsal and the `Publish blockers` list, all from the latest programme read's `seated_players`, `first_rehearsal` and `publish_blockers`.
- The list is replaced from every later programme read while the dialog is open: each status check's re-read and the response to each string-count or copies-on-hand save. The dialog never works out a blocker from the browser's clock, time zone or its own copy figures.
- While the list has any item, `Publish` is disabled. While it is empty, `Publish` is enabled.
- `Publish` sends one request with a fresh Idempotency-Key. A retry after a network failure reuses the same key.
- If the publish still answers 409 (for example because the first rehearsal started after the last read), Desk status shows the 409's message, the dialog stays open, and the programme is re-read so the list shows the server's current blockers.

**Rentals.**

- `Check in <work title>` opens its dialog, with one spinbutton per slip line prefilled with the stored counts.
- Each line carries an expected count, the stored count the dialog last showed for it:
  - it is set from the stored count when the dialog opens;
  - for a line the user has not changed, it is refreshed with the shown value on every reload;
  - it is set from the server response after each save;
  - a line the user has changed keeps the expected count it had at the moment of the first change, through every reload, until a save or a `count_changed` refusal settles it.
- `Save counts` sends only the lines the user changed since the dialog opened or since the last save, each with its expected count.
- On a `count_changed` refusal, each stale line's spinbutton shows its stored value from the 409 body and counts as unchanged, with that value as its expected count. Every other typed value and the focused control stay as they were, and the dialog stays open.
- `Mark returned` attempts the return. If copies are missing, the Rental status names them and the dialog stays open.

**New rental set.** The `Publisher` textbox sends exactly what was typed or pasted, line breaks included, under the line-break rule below. A 422 describes the textbox with its field message from Feedback states and keeps the dialog open with the typed values.

**Line breaks in Title and Publisher.** A plain single-line text input silently removes pasted line breaks, so `Title` and `Publisher` each use a text control that keeps them while still being exposed as a `textbox` with the same name. Neither the client nor the control strips, trims or replaces a line break or other control character; only leading and trailing spaces are left for the server to trim. The text is sent as it stands and the server decides validity. For example, pasting `Hartwell` and `Rye` on two lines into `Publisher` and choosing `Create rental set` sends both lines, and the dialog shows the server's 422 field message.

**Dialogs and the drawer.** Every dialog and the drawer is modal:

- Tab from the last control goes to the first, and Shift+Tab from the first goes to the last. Focus never reaches the page behind.
- Escape closes the dialog. Closing returns focus to the control that opened it, except after a cut restore as described above.
- Opening a dialog puts focus on its first field or, if it has none, on its first enabled button.

**Folder pages.**

- On touch, a horizontal swipe longer than one quarter of the page width, or a quick flick, moves to the next or previous page. A shorter drag returns to the current page. Vertical scrolling inside a page still works.
- `Previous part` and `Next part` do the same. Arrow Left and Arrow Right do it while focus is anywhere inside `Folder pages`, including on a page's link or on either button.
- `Page position` updates on every change.
- The URL follows the current page (`/folder/<programme id>/<part id>`), so reloading keeps the page.
- `Open marked part` downloads the filed marked-part scan.

**Folder access follows seating.**

- The open folder asks the server for its current page (`GET /api/folders/{programme id}/parts/{part id}`) at three moments:
  - on every page change;
  - on each 30-second status check;
  - whenever the tab becomes visible again.
- When that request answers 404, the screen replaces the carousel with the not-in-folder heading from Feedback states and removes `Page position`. It never goes on showing a page the server has just refused.
- Any other failure leaves the current page as it is.
- `/folder` reloads its list on each status check and when the tab becomes visible again. It shows the folder-list empty copy as soon as the list comes back empty.

**Status refresh.**

- Every signed-in screen, player screens included, asks the server for service status on load and every 30 seconds after that. Banners, upload buttons and folder links follow the storage rule in Feedback states on the next check.
- The programme desk also re-reads its current programme and selected work on each status check and when the tab becomes visible again. Another librarian's changes, including another person's marks, therefore appear within 30 seconds.
- The section desk re-reads its cards on each status check and when the tab becomes visible again.
- The Rentals screen reloads its sets every 60 seconds and whenever the tab becomes visible again, so `Overdue` appears within one minute of local midnight.
- Every one of these refreshes updates the screen in place:
  - An open dialog stays open, and its entrance does not replay.
  - A spinbutton or textbox the user has changed but not saved keeps the typed value. Controls the user has not touched show the newest stored value.
  - Focus stays on the control that had it.
  - The ruler keeps its caret and selection.
  - The `Desk status`, `Rental status`, `Section status` and `Ruler status` text stays until the user's next action on that screen.
  - Figures behind a dialog (for example the Rentals `Copies`, `Status` and `Overdue` cells, or the desk's copy figures) may update.
- For example, with the seed data at start: an assistant librarian opens `Check in Orchard Serenade`, types 3 into `Returned Violin I` without saving, and moves focus to `Returned Viola`. After the minute reload, a status check and a tab return, the dialog is still open, Violin I still reads 3 and `Returned Viola` still has focus.
- On the desk, a string-count spinbutton changed to 10 and not yet saved, and a selection of bars 120–130, are both still there after a status check.

### Visual design (DP-43, DP-44)

- **Colour roles.**
  - Paper: a warm, slightly yellowed off-white for every surface.
  - Ink: a warm near-black for all text and ticks.
  - Accent: a deep oxblood for primary actions, the ruler caret and selection, the cut hatching and the splice mark.
  - Rule: a warm mid-grey for hairlines only, never for text.
  - Caution: a burnt orange for shortfall and overdue markers.

  Caution never carries information alone. Every shortfall and overdue marker also has its word (`Short`, `Overdue`) in ink. Text and its background meet WCAG 2.2 AA contrast: at least 4.5 to 1 for body text and 3 to 1 for large text and control borders. Keyboard focus shows a 2-pixel oxblood focus ring with a small gap. An unavailable button keeps its label legible, drawn in ink on a paper fill with a dashed hairline border, so it still reads as a control.
- **Type.**
  - Fraunces, a soft high-contrast serif, for display: programme numerals in the rail (the largest type on screen), headings and the boxed rehearsal letters.
  - IBM Plex Sans for body text and controls.
  - IBM Plex Mono with tabular figures for every bar number, string count, copy figure, date and duration, so columns of figures line up.

  Each heading step is a quarter larger than the step below it, starting from body text.
- **Engraved rules.** A single hairline in the rule colour separates every table row, rail item and list row, like staff lines on a page. No shadow is deeper than a 1-pixel hairline, and there are no gradients.
- **Density.** Compact: rows are tight and labels short. Every interactive control still has a target at least 44 by 44 pixels, including spinbutton steppers, splice marks and folder buttons.
- **Composition.** The rail numerals run 01, 02, 03 down the left like section numbers in a score. The ruler is a long horizontal staff: ink ticks per bar, a longer numbered tick at each labelled bar (the viewport-based label interval in Screens and layout), and boxed serif letters standing above their bars. A spliced cut is a narrow oxblood mark four pixels wide, labelled `vi–de` with its first and last bar numbers in mono. The parts table sits below the ruler in hairline rows, and each mark line in the Marking cell sets its bars in mono and the name in the body face.
- **Icons.** Lucide outline icons, always paired with text.

### Motion and effects (DP-15, DP-16, DP-17, DP-33)

Motion only ever means a change of state. No decorative loop, idle animation, parallax or background movement exists anywhere.

- **Hover and press feedback.** Buttons and links darken their fill or underline within about a tenth of a second on hover and on press. Unavailable buttons show no hover or press change.
- **Dialogs and the drawer.** Dialogs fade in, and the drawer slides in from the left edge, each in about a quarter of a second, settling softly with a fast start and a gentle stop. They leave in the same time in reverse. A refresh never replays an open dialog's entrance.
- **Upload progress.** The progress bar fills with the bytes sent. It has no animated stripes.
- **Folder pages.** During a swipe the page follows the finger. On release it settles to the current or next page in about a third of a second, with the same fast start and gentle stop. The buttons and arrow keys play the same slide.
- **In-place swaps.** A link swapped for its unavailable copy, a button turning unavailable, a blocker appearing in the publish list: each changes at once, with no movement.

**Signature: the cut splice.** When the server confirms a new cut (a 201 response), these steps play in order:

1. Oxblood diagonal hatching sweeps left to right across the selected span in about a tenth of a second.
2. The span's width shrinks from its full width to the four-pixel splice mark in about a third of a second. Every tick and rehearsal letter after the cut slides left by the removed width at the same time. Rehearsal letters inside the span disappear with it. The `vi–de <from>–<to>` label appears on the mark as it lands.
3. The `Running time` figure counts down in whole seconds from the old programme total to the new one in about a third of a second. With the seed data at start, cutting bars 120–184 of The Weir counts from 38:40 to 34:12. Every intermediate value is a whole-second `M:SS`, and the count never goes up.
4. When the count ends, the `Mark cut` flags appear on the affected parts, and the parts table's `<n> to mark` changes to the new count.

The whole sequence finishes within one second of the response. The Ruler status line is set at the end. Undo and restore play the same steps in reverse: the flags go, the time counts up, the mark widens back to the full span while later ticks and letters slide right, and the hatching clears. Reloading at any point shows the stored end state with no animation. A cut that arrives through a status-check refresh appears already spliced, with no animation.

**Reduced motion.** When the operating system asks for reduced motion:

- The splice has no sweep, collapse, slide or count. The ruler redraws already spliced, or restored, the total shows the new value, the flags and counts change at once, and the Ruler status line is set and announced as usual.
- Dialogs and the drawer appear and disappear without movement.
- Folder page changes are instant. A swipe still changes the page, but the new page appears immediately without following the finger. Every page shows the same cuts, letters and links.
- Hover and press feedback changes colour instantly.

### Feedback states (DP-01, DP-09, DP-11, DP-12, DP-13, DP-17, DP-18, DP-19, DP-22, DP-25, DP-27, DP-30, DP-34, DP-36, DP-37, DP-38, DP-39, DP-46, DP-48, DP-49, DP-50, DP-51, DP-52)

Every string below renders exactly as written, with straight apostrophes, the dashes shown and the same case and digits. Announcements built from these strings carry the same characters. `−` in the cut line is the true minus sign, not a hyphen.

Placeholders:

- `<saved>` is a cut's saving and `<M:SS>` a running time: whole minutes, a colon and two-digit seconds (`4:28`, `0:42`, `38:40`).
- `<count>` is a string count written as five numbers joined by hyphens in section order (`10-8-6-5-4`).
- `<nn>` is the programme number with two digits.
- `<status label>` is one of `Draft`, `In preparation`, `Published`, `In performance` or `Closed` for programmes, and one of `Requested`, `Received`, `In use`, `Returned` or `Checked in` for rental sets.
- `<date>` is a business-zone date written like `Sat 14 Nov 2026`.
- `<date-time>` is written like `Tue 1 Dec 2026, 10:00` (24-hour time, London time).
- `<HH:MM>` is the time exactly as typed in the textbox.
- `<name>` is the stored full name of the person a mark's `marked_by` names.
- Where a count is 1, the singular noun is used (`1 part to mark`, `1 copy missing`), and a verb that follows the count is singular too. With a shortfall of 1 the publish refusal reads `Folders can't be published while 1 copy is short.`

**Field messages.** The API returns these sentences as the values in a 422 body's `errors`. The dialogs show them as the descriptions of the matching fields:

- `title`: `Title must be one line of text.` when it contains a control character (this check comes first), otherwise `Title must be 1 to 120 characters.`
- `publisher`: `Publisher must be one line of text.` when it contains a control character (this check comes first), otherwise `Publisher must be 1 to 120 characters.`
- `counts`: `Returned copies must be from 0 to the slip count.`
- A date-time textbox whose text is not in the accepted form: `Enter a date and time like 2026-12-01 10:00.` (client only).
- A date-time textbox naming a time that does not exist in London: `There is no <HH:MM> on <date> in London time.` (client only). For example, `2027-03-28 01:30` gives `There is no 01:30 on Sun 28 Mar 2027 in London time.`

| Action | Region | Pending | Success | Errors |
|---|---|---|---|---|
| Sign in | alert in form | `Signing in` (on the button) | (navigates) | `That email and passcode don't match.` |
| Save string count | Desk status | `Saving string count` | `String count saved: <count>. Short <programme shortfall>.` | `String count not saved. Check the highlighted sections.`, with each failing spinbutton described by `The roster has <n> players in <section name>.` or `Enter a whole number from 0 to <n>.` |
| Save copies on hand | Desk status | `Saving copies for <part label>` | `Copies on hand saved for <part label>: <n>.` | `Copies on hand must be a whole number from 0 to 99.` |
| Any edit on a closed programme | Desk status | | | `This programme is closed. Its counts and cuts can't change.` |
| Commit cut | Ruler status | `Marking cut <from>–<to>` | `Cut bars <from>–<to> · −<saved> · <n> parts to mark` | `Bars <from>–<to> overlap an existing cut.` / `A cut can't remove every bar of a work.` |
| Undo or restore cut | Ruler status | `Restoring bars <from>–<to>` | `Restored bars <from>–<to> · +<saved>` | `That cut was already restored.` |
| Record marked (desk) or confirm cut (section) | Desk status / Section status | `Recording` | `<part label> carries cut <from>–<to>.` (one line per cut, for a 201 or a 200) | `<part label> doesn't play in bars <from>–<to>.` / `That cut was restored before the mark was recorded.` (a 404 for the cut) |
| Upload marked-part scan | Upload status | `Uploading scan for <part label>` | `Scan filed for <part label>.` | `Scan not filed for <part label>: <reason>.` |
| Upload bowing master | Bowing master status: `<work title>` | `Uploading` | `Filed` | `Not filed`, followed by a second line `<reason>.` with its first letter capitalised |
| Publish folders | Desk status | `Publishing folders` | `Folders published. Player notices: <sent> sent, <queued> queued.` | the 409's message, which is one of the blocker messages below |
| Programme status change | Desk status | `Updating programme` | `Programme <nn> is now <status label>.` | `Programme <nn> can't move from <status label> to <status label>.` |
| New programme | Desk status, field descriptions in the dialog | `Creating programme` | `Programme <nn> created.` | `Check the highlighted fields.` with the field messages |
| Add work | Desk status | `Adding work` | `<work title> added to Programme <nn>.` | `<work title> is already in this programme.` |
| New rental set | Rental status, field descriptions in the dialog | `Creating rental set` | `Rental set created for <work title>.` | `<work title> already has an open rental set.` / `Check the highlighted fields.` with the field messages |
| Rental status change | Rental status | `Updating rental set` | `<work title> set is now <status label>.` | `<work title> set can't move from <status label> to <status label>.` |
| Save check-in counts | Rental status | `Saving counts` | `Check-in counts saved for <work title>.` | `Counts changed while you were typing: <part name> is now <n>.` (one `<part name> is now <n>` clause per stale line in slip order, joined by `; `, for example `Counts changed while you were typing: Violin II is now 5; Cello is now 3.`) / the `counts` field message / `Counts can't change: <work title> set is already <status label>.` |
| Mark returned | Rental status | `Marking returned` | `<work title> set is now Returned.` | `Can't mark returned: <n> copies missing (<part name> <k>, <part name> <k>).` listing every short slip line in slip order |

**Publish blocker messages.** These are the `message` of each `publish_blockers` entry and of the matching publish 409, and the text of each `listitem` in `Publish blockers`, in guard order:

1. `illegal_transition`: `Folders can only be published while the programme is in preparation.`
2. `first_rehearsal_passed`: `Folders can't be published after the first rehearsal has started.`
3. `no_works`: `Add a work before publishing folders.`
4. `copies_short`: `Folders can't be published while <n> copies are short.`, where `<n>` is the programme shortfall.

While the list is empty the dialog shows `Nothing blocks publishing.` outside the list. The dialog also shows `Seated players: <n>` and `First rehearsal <date-time>`.

**Marks.** A Marking-cell mark line reads `<from>–<to> · <name>`, for example `120–184 · Hester Quayle`. A section desk confirmed cut reads `Confirmed <from>–<to> by <name>`, for example `Confirmed 120–184 by Hester Quayle`. Both always name the mark's stored `marked_by`.

`<reason>` for upload failures:

- `the score store is offline` (a 503);
- `only PDF, PNG or JPEG files can be filed` (a 415);
- `the file is larger than 20,000,000 bytes` (a 413);
- `the file is empty` (a 422 for an empty file);
- `the upload did not finish` (any other failure).

**Screens follow the latest server answer.**

- *Latest save wins (DP-09, DP-11).* When several saves of one part's copies on hand, or several string-count saves, are in flight, the screen renders only the response to the request sent last. That covers the row's cells, the rail's work figures, the header's `Programme copies`, the publish dialog's blockers and the Desk status line. A response to an earlier request that arrives after it is ignored, including its Desk status copy. While a save is in flight, re-read responses from status checks do not repaint those figures; once the latest save answers, its figures show, and later re-reads render as usual. For example, with the seed data at start (The Weir's Cello has 3 copies on hand): setting `Copies on hand Cello` to 4, then 5, with the first answer delayed until after the second, ends with `On hand` 5 on the row, the stored count 5, and Desk status `Copies on hand saved for The Weir — Cello: 5.`
- *Storage state in place (DP-39, DP-52).* Each screen applies the `storage` value of its latest status check without a reload:
  - While it is `down`: the score store outage banner shows on librarian and section desk screens; every `Upload scan <part name>` and `Upload bowing master <work title>` button stays visible and in the tab order, is marked unavailable to assistive technology (`aria-disabled="true"`), opens no file chooser, and has the score store outage banner text as its accessible description.
  - When a later check reports `up`: the banner goes, the buttons work again, and their outage description is removed.
  - A player's open folder uses whichever answer about scans arrived most recently: the folder response's `scans_available`, or the latest status check's `storage`. While that answer says unavailable, every page shows the unavailable copy below in place of `Open marked part`. When it says available again, each page shows `Open marked part` or the no-scan copy.
  - None of these swaps reloads the page, moves to another folder page, changes the URL, moves focus, closes a dialog or discards typed values.
  - An upload that started while the status was `up` and then fails still shows its failure copy and `Not filed`.
  - A status check that itself fails changes nothing.

Other fixed copy:

- **Score store outage banner** (`alert`): `The score store is offline. Scans can't be uploaded or opened right now. Catalogue, counts and cuts still work.`
- **Mail outage banner** (`alert`, on librarian screens while status reports mail down): `Mail is offline. Notices are queued and will be sent when it's back.`
- **Programme header dates:** `First rehearsal <date-time>` and `Final performance <date>`. The final performance date is the programme's `final_performance_date`, whatever the browser's time zone. For example, a latest performance at `2026-10-25T23:30:00+00:00` reads `Final performance Sun 25 Oct 2026`.
- **Rental Due cell:** `<date>` for the set's due date, for example `Sun 8 Nov 2026`.
- **Rental Copies cell:** `<checked in> of <on slip>`, where `<checked in>` is the set's copies checked in and `<on slip>` its copies on the slip, for example `16 of 17`.
- **Rental status cell:** the stored status label, or `Overdue` while the set is overdue.
- **Reminder cell:**
  - `Reminder sent <date>` when every assistant librarian's reminder was accepted, where `<date>` is the business-zone date the last of them was accepted;
  - `Reminder queued` while any reminder is queued;
  - `No reminder yet` before the reminder date.
- **Player notices table status:** `Sent` or `Queued`.
- **Folder list empty:** `No folders are published for your chair yet.`
- **Folder page while scans are unavailable:** `This marked part can't be opened right now. Its cuts and rehearsal letters are shown below.` It shows on every page whether or not that part has a filed scan.
- **Folder page with no filed marked-part scan, while scans are available:** `No marked part has been filed yet.`
- **Not-in-folder page heading:** `That part isn't in your folder.` It is shown for any `/folder/...` URL the player cannot see, and whenever a refresh of the open folder answers 404.
- **Folder loading:** the heading area shows `Opening your folder`, then the folder or one of the copies above.

## Backend

### API (DP-01, DP-02, DP-03, DP-04, DP-09, DP-10, DP-12, DP-19, DP-21, DP-23, DP-24, DP-26, DP-27, DP-29, DP-31, DP-37, DP-41, DP-48, DP-50, DP-51)

All endpoints are under `/api`. Requests with a body send `Content-Type: application/json`, except scan uploads, which send `multipart/form-data`. Responses are JSON (`application/json; charset=utf-8`) unless stated otherwise. Ids are opaque URL-safe strings.

**Timestamps.** Request timestamps are ISO 8601 with an explicit offset or `Z`, and the server reads each one as an instant. Response timestamps are ISO 8601 with the business zone's offset for that instant, for example `2026-12-01T10:00:00+00:00`. Business-zone dates are `YYYY-MM-DD`.

**Error shape.** Every error has the body `{"error":"<code>","message":"<sentence>"}`, with extra keys only where stated. Validation errors are `422 {"error":"validation","message":"Check the highlighted fields.","errors":{"<field>":"<sentence>"}}`. Malformed JSON is a 422 with the field `body`.

**Error order** for every endpoint:

1. The server-boundary checks: 403 `cross_origin`, 413 and 415.
2. 401 `unauthenticated` when no valid session exists.
3. 404 `not_found` for an unknown id, or an id the signed-in person may not see, in the path or anywhere in the body.
4. 403 `forbidden` when the person can see the resource but their role may not take the action.
5. An idempotent replay returns its stored response.
6. 409 state conflicts.
7. 422 validation.

A state check compares only values that are present and of the right type; anything missing, malformed or of the wrong type is refused at step 7.

**Visibility.** For a player, the only visible things are their visible folders, the parts in those folders, and the marked-part scans of those parts. Visibility is decided as described in Business rules. Every other programme, work, part, cut, scan and rental set is unknown to a player and answers 404. Routes without an id that a player may not use answer 403. Section principals see every programme, work, part, cut and scan, plus their own folders. Rental sets and notices are forbidden to them (403).

**Role table.** P = principal librarian, A = assistant librarian, S = section principal, Y = player. Section principals also have Y access for their own chair.

| Method and path | Roles |
|---|---|
| `POST /api/session`, `GET /api/health` | anyone |
| `GET /api/session`, `DELETE /api/session`, `GET /api/status` | any signed-in person |
| `GET /api/catalogue`, `GET /api/programmes`, `GET /api/programmes/{id}`, `GET /api/works/{id}`, `GET /api/parts/{id}/scans` | P, A, S |
| `POST /api/programmes`, `PUT /api/programmes/{id}/string-count`, `POST /api/programmes/{id}/works`, `POST /api/programmes/{id}/transition`, `POST /api/programmes/{id}/publish`, `POST /api/works/{id}/cuts`, `DELETE /api/cuts/{id}`, `POST /api/rental-sets` | P |
| `GET /api/programmes/{id}/notices`, `PUT /api/parts/{id}/holdings`, `GET /api/rental-sets`, `POST /api/rental-sets/{id}/transition` (see Business rules for which edges), `PUT /api/rental-sets/{id}/check-in` | P, A |
| `POST /api/parts/{id}/marks` | P, A, and S for parts of their own section only |
| `POST /api/parts/{id}/scans` | `marked_part`: P, A. `bowing_master`: S for parts of their own section only. |
| `GET /api/scans/{id}/file` | P, A, S; Y for marked-part scans of parts in their visible folders |
| `GET /api/folders`, `GET /api/folders/{programme id}`, `GET /api/folders/{programme id}/parts/{part id}` | Y, S |

**Shapes.**

- **User:** `{"id","name","email","role":"principal_librarian"|"assistant_librarian"|"section_principal"|"player","chair":null|{"key","section","number","label"}}`. `label` is like `Violin II · chair 03`; for single-player chairs it is the part name, for example `Flute 2`.
- **Copies:** `{"needed":int,"on_hand":int,"shortfall":int}`.
- **Programme summary:** `{"id","number":"01","title","status":"draft"|"in_preparation"|"published"|"in_performance"|"closed","first_rehearsal","performances":[timestamp],"final_performance_date","string_count":{"violin_1","violin_2","viola","cello","bass"},"running_time_seconds":int,"running_time":"M:SS","copies":Copies,"parts_to_mark":int,"seated_players":int,"publish_blockers":[{"error","message"}]}`.
  - `performances` is in ascending instant order.
  - `final_performance_date` is the business-zone date of the latest performance.
  - `seated_players` counts the players seated in the programme now.
  - `publish_blockers` follows the publish rule in Business rules. Empty means a publish made now would succeed.
- **Programme detail:** the summary plus `"works":[WorkSummary]` in programme order.
- **WorkSummary:** `{"id","programme_id","catalogue_work_id","title","composer","bars":int,"running_time_seconds","running_time","copies":Copies,"parts_to_mark":int}`.
- **Work detail:** WorkSummary plus `"full_running_time_seconds"`, `"bar_map":[{"from_bar","to_bar","bar_ms"}]`, `"rehearsal_letters":[{"letter","bar","cut":bool}]`, `"cuts":[Cut]` (ascending by bar) and `"parts":[Part]`.
- **Cut:** `{"id","work_id","from_bar","to_bar","saved_seconds","saved":"M:SS","parts_to_mark":int,"created_at"}`.
- **Part:** `{"id","work_id","name","chair_key","bars_from","bars_to","copies":Copies,"cuts_to_mark":[cut id],"mark_cut":bool,"marks":[Mark],"latest_marked_scan":Scan|null,"latest_bowing_master":Scan|null}`. `marks` is ascending by `from_bar`.
- **Mark:** `{"cut_id","from_bar","to_bar","marked_by":{"id","name","role"},"marked_at"}`.
- **Scan:** `{"id","part_id","kind":"marked_part"|"bowing_master","file_name","content_type","size_bytes","sha256","object_key","filed_at","uploaded_by":{"id","name"}}`.

**Endpoints.**

- **`POST /api/session`** `{"email","passcode"}` → `200 {"user":User}` and sets the session cookie described in Server boundary. Errors: `401 {"error":"invalid_credentials",...}`, and 422 for a missing field.
- **`GET /api/session`** → `200 {"user":User}`. **`DELETE /api/session`** → `204` and clears the cookie.
- **`GET /api/health`** → see Deployment. **`GET /api/status`** → `200 {"storage":"up"|"down","mail":"up"|"down"}`. Each probe gives up after 2 seconds and reports `down`.
- **`GET /api/catalogue`** → `200 {"works":[{"id","title","composer","bars","running_time_seconds","parts":[{"name","chair_key","bars_from","bars_to"}]}]}`.
- **`GET /api/programmes`** → `200 {"programmes":[Programme summary]}` ascending by number. **`GET /api/programmes/{id}`** → `200` Programme detail.
- **`POST /api/programmes`** `{"title","first_rehearsal","performances":[...],"string_count":{...}}` → `201` Programme detail with status `draft` and no works.
  - `title`: one line of text (the single-line rule in Business rules), 1 to 120 characters inclusive after trimming spaces.
  - Timestamps: per Timestamps above. A first rehearsal in the past is allowed.
  - `performances`: 1 to 10 entries, no two at the same instant, each a later instant than `first_rehearsal`.
  - `string_count`: per the DP-10 rule in Business rules.
  - 422 field keys: `title`, `first_rehearsal`, `performances`, and `string_count.<section key>`. The `title` messages are the field messages in Feedback states.
- **`PUT /api/programmes/{id}/string-count`** `{"violin_1","violin_2","viola","cello","bass"}` → `200` Programme detail. 422 field keys are the section keys.
- **`POST /api/programmes/{id}/works`** `{"catalogue_work_id"}` → `201` Work detail. An unknown catalogue id is a 404.
- **`POST /api/programmes/{id}/transition`** `{"to":"draft"|"in_preparation"|"in_performance"|"closed"}` → `200` Programme detail. Any other `to` value is a 422.
- **`POST /api/programmes/{id}/publish`**, no body, header `Idempotency-Key` (1 to 80 visible ASCII characters; missing or malformed is a 422 with field `idempotency_key`) → `200 {"programme":Programme detail,"notices":{"sent":int,"queued":int}}`. A refusal is a 409 whose `error` and `message` equal the first entry of `publish_blockers` at that moment; a `copies_short` refusal also carries `"shortfall":<n>`.
- **`GET /api/programmes/{id}/notices`** → `200 {"notices":[{"player_id","name","email","chair_label","status":"sent"|"queued","sent_at":timestamp|null}]}`.
- **`GET /api/works/{id}`** → `200` Work detail.
- **`POST /api/works/{id}/cuts`** `{"from_bar","to_bar"}` → `201 {"cut":Cut,"work":Work detail,"programme":Programme summary}`. 422 when either value is not an integer, when `from_bar` is greater than `to_bar`, or when either is outside 1 to the work's bars (field keys `from_bar` and `to_bar`).
- **`DELETE /api/cuts/{id}`** → `200 {"work":Work detail,"programme":Programme summary}`. A cut that was already deleted is a 404.
- **`PUT /api/parts/{id}/holdings`** `{"copies_on_hand"}` (integer 0 to 99 inclusive) → `200 {"part":Part,"work":WorkSummary,"programme":Programme summary}`.
- **`POST /api/parts/{id}/marks`** `{"cut_id"}` → `201 {"part":Part}` when this request stores the mark. When the mark already exists, the response is `200` with the same body, whose `marks` entry for that cut carries the stored `marked_by` and `marked_at`, never the caller's. A cut of another work, or a cut that no longer exists, is a 404. A cut that does not overlap the part's printed bars is a 422 with field `cut_id`.
- **`POST /api/parts/{id}/scans`**, multipart fields `kind` (`marked_part` or `bowing_master`) and `file`, optional header `Idempotency-Key` (same format as publish) → `201 {"scan":Scan}`.
  - The `file` part's `filename` parameter is read as UTF-8. Browsers and form-data libraries write a double quote as `%22`, a carriage return as `%0D` and a line feed as `%0A` inside that parameter, so the server decodes exactly these three sequences (either letter case) back to the characters they stand for and decodes nothing else. The result is stored as `file_name` character for character. For example, a browser uploading `Bögen – The Weir "v2".pdf` sends `filename="Bögen – The Weir %22v2%22.pdf"`, and `file_name` is `Bögen – The Weir "v2".pdf`.
  - 413 `file_too_large` above the limit in Server boundary.
  - 415 `unsupported_file_type` when the file part's type is not `application/pdf`, `image/png` or `image/jpeg`, or when the bytes do not begin with that type's signature (`%PDF-`, the PNG signature, or the JPEG start-of-image marker).
  - 422 for an empty file, a missing field, an invalid `kind`, or a decoded file name that is empty, longer than 255 UTF-8 bytes, contains `/` or `\`, or contains any character from U+0000 to U+001F or U+007F (field `file`).
  - 503 `storage_unavailable` when the write is not confirmed.
- **`GET /api/parts/{id}/scans`** → `200 {"scans":[Scan]}`, newest first, both kinds.
- **`GET /api/scans/{id}/file`** → `200` with the stored bytes, `Content-Type` set to the stored type, `Content-Length`, and `Content-Disposition: attachment; filename="<ASCII fallback>"; filename*=UTF-8''<encoded name>`.
  - `<ASCII fallback>` is the stored file name with every character outside U+0020 to U+007E, and every `"` and `\`, replaced by one `_` each.
  - `<encoded name>` is the stored name's UTF-8 bytes percent-encoded with uppercase hex, leaving unencoded only letters, digits and `!#$&+-.^_`|~`.
  - Worked example: `Bögen – The Weir "v2".pdf` gives `Content-Disposition: attachment; filename="B_gen _ The Weir _v2_.pdf"; filename*=UTF-8''B%C3%B6gen%20%E2%80%93%20The%20Weir%20%22v2%22.pdf`.
  - Returns 503 `storage_unavailable` when the object cannot be read.
- **`GET /api/folders`** → `200 {"folders":[{"programme_id","number","title","status","first_rehearsal","chair_label","part_count"}]}`, or `200 {"folders":[]}` when none is visible.
- **`GET /api/folders/{programme id}`** → `200 {"programme":{"id","number","title","status","first_rehearsal"},"chair":{...},"scans_available":bool,"pages":[Page]}`. **`GET /api/folders/{programme id}/parts/{part id}`** → `200` Page.
  - **Page:** `{"part_id","work_id","work_title","composer","part_name","bars_from","bars_to","cuts":[{"from_bar","to_bar"}],"rehearsal_letters":[{"letter","bar"}],"marked_scan":{"id","file_name","content_type","size_bytes"}|null}`.
  - `rehearsal_letters` leaves out letters inside cuts.
  - `scans_available` is false when a storage probe fails within 2 seconds.
- **`GET /api/rental-sets`** → `200 {"rental_sets":[RentalSet]}` ascending by due date.
  - **RentalSet:** `{"id","work_id","work_title","programme_id","programme_number","publisher","status","display_status","overdue":bool,"final_performance_date","due_date","due_at","slip":[{"part_id","part_name","copies","checked_in"}],"copies_on_slip","copies_checked_in","copies_missing","reminder":{"status":"none"|"queued"|"sent","sent_at":timestamp|null},"returned_at":timestamp|null,"returned_late":bool}`. `slip` is in the part order of the work.
- **`POST /api/rental-sets`** `{"work_id","publisher","slip":[{"part_id","copies"}]}` → `201` RentalSet with status `requested`.
  - `publisher`: one line of text (the single-line rule in Business rules), 1 to 120 characters inclusive after trimming spaces, stored exactly as sent apart from that trimming. The messages are the field messages in Feedback states.
  - `slip`: at least one line, each part at most once, `copies` 1 to 99.
  - A part of another work is a 404.
  - A 422 creates no rental set and sends no mail.
- **`POST /api/rental-sets/{id}/transition`** `{"to":"received"|"in_use"|"returned"|"checked_in"}` → `200` RentalSet.
- **`PUT /api/rental-sets/{id}/check-in`** `{"counts":[{"part_id","copies","expected"}]}` → `200` RentalSet.
  - `expected` is the stored count the client last showed for that line, an integer.
  - Stale counts: `409 {"error":"count_changed","message":"Counts changed while you were typing.","lines":[{"part_id","part_name","checked_in"}]}` as described in Business rules; `lines` names each stale line with its stored count, in slip order.
  - 422 with field `counts` and its field message when a `copies` value is outside 0 to that line's slip copies inclusive, or a `copies` or `expected` is missing or not an integer.
  - Lines left out keep their stored count. A part not on the slip is a 404.
- Any other `/api/...` path is `404 {"error":"not_found",...}`.

### Business rules (DP-05, DP-08, DP-10, DP-12, DP-13, DP-18, DP-19, DP-26, DP-27, DP-28, DP-29, DP-31, DP-35, DP-36, DP-37, DP-46, DP-48, DP-49, DP-50, DP-51)

**Business time zone.** The orchestra's time zone is Europe/London, and every date rule uses it. The server decides every cutoff and every time-dependent status from its own clock. A device's clock or time zone may be wrong, so screens show the statuses the server returns and never decide one from the device. Every date and time on screen is shown in London time, whatever the browser's time zone.

**Wall-clock times (DP-49).** Librarians type rehearsal and performance times as London wall-clock times.

- A wall-clock time that occurs twice, in the hour after the clocks go back, means the earlier of the two instants, which carries British Summer Time's offset. For example, `2026-10-25 01:30` is `2026-10-25T01:30:00+01:00`.
- A wall-clock time that does not occur, in the hour skipped when the clocks go forward, is refused in the dialog with its field message from Feedback states, and nothing is sent. For example, `2027-03-28 01:30` is refused.
- The server compares, orders and stores times as instants, never as text. For example, a `first_rehearsal` of `2026-10-25T01:30:00+01:00` with a performance at `2026-10-25T01:10:00+00:00` is valid, because the performance is 40 minutes later.

**Single-line text and mail headers (DP-48).**

- A programme `title` and a rental set `publisher` are single-line text. Either one containing any character from U+0000 to U+001F or U+007F (line breaks and tabs included) is a 422 with its field message. Nothing is stored and no mail is sent.
- Text outside ASCII is allowed and is stored exactly as typed, for example `Éditions Côte-Rôtie Location`.
- Wherever such text reaches an email subject, it is written as encoded UTF-8 on the single subject line, so a mail client's decoded subject equals the stored text character for character.
- Every message has exactly one `To` (its one recipient) and the `From` in `MAIL_FROM`, and has no `Cc` or `Bcc` header.

**Programme states.**

- Legal edges through `POST /api/programmes/{id}/transition`:
  - draft → in preparation;
  - in preparation → draft;
  - published → in performance;
  - in performance → closed.
- in preparation → published happens only through publish. A transition request with `to` set to `published` is a 422.
- Every other edge, including a request to the current state, is `409 {"error":"illegal_transition",...}`, and the programme is unchanged.
- While a programme is `closed`, changing its string count, cuts, holdings or marks is `409 {"error":"programme_closed",...}`.
- Adding a work is allowed only in `draft` or `in_preparation`; otherwise it is `409 {"error":"wrong_status",...}`.
- Adding a catalogue work that is already in the programme is `409 {"error":"work_already_in_programme",...}`.
- A new programme's number is one more than the highest existing number, with two digits.

**String count (DP-10).** Each of the five sections is a whole number from 0 up to and including the number of players on that section's roster: Violin I 10, Violin II 8, Viola 6, Cello 5, Bass 4. A value outside that range, a non-integer or a missing section is a 422 and nothing is stored. The message is `The roster has <n> players in <section name>.` when the value exceeds the roster, and `Enter a whole number from 0 to <n>.` otherwise. Saves are stored in arrival order.

**Seating.** A string player is seated in a programme when their chair number is at or below their section's count. A wind, brass, percussion or harp player is seated when any work in the programme has a part for their chair. A seated player's chair parts are the parts whose `chair_key` matches their chair.

**Copies (DP-08).**

- Copies needed for a string part is the section's count divided by 2, rounded up (one copy per desk of two). One spare copy is added when the section has 8 or more players.
- Every other part needs 1 copy.
- Shortfall for a part is copies needed minus copies on hand, or 0 if that is negative.
- A work's figures are the sums over its parts, and a programme's figures are the sums over its works. Its shortfall is the sum of the part shortfalls, not needed minus on hand.
- The server computes all of these from the stored string count and holdings on every read. Every surface shows the server's numbers. Holdings saves are stored in arrival order.
- For example, with the seed data at start, Programme 01 shows needed 57, on hand 57, short 0. After the count changes to 10-8-6-5-4, it shows needed 61, on hand 57, short 4.

**Running time (DP-12).**

- A work's bar map gives each bar a duration in milliseconds.
- A work's running time is the sum of its uncut bars' durations, rounded to the nearest whole second (half a second rounds up).
- A programme's running time is the sum of its works' exact millisecond totals, rounded once.
- A cut's saving is the exact duration of its bars, rounded to the nearest whole second.
- None of these is stored. They are derived from the stored cuts on every read.

**Cuts (DP-12, DP-13).**

- A cut is one stored bar span on one programme work.
- A new cut that shares any bar with an existing cut on the same work is `409 {"error":"cut_overlaps",...}`. Adjacent cuts are allowed.
- A cut that would leave a work with no uncut bars is `409 {"error":"cut_removes_whole_work",...}`.
- When overlapping cuts arrive at the same time, exactly one is stored and every other one gets the `cut_overlaps` 409.
- Deleting a cut also deletes its marks, in the same transaction.
- Cuts are allowed in every state except closed, because cuts change up to the night before a concert.

**Parts to mark and marks (DP-18, DP-19, DP-50).**

- A part needs marking for a cut when the part's printed bars (`bars_from` to `bars_to`) share any bar with the cut and no mark records that part against that cut. `mark_cut` is true when `cuts_to_mark` is not empty.
- A work's `parts_to_mark` counts its parts with `mark_cut` true, and a programme's is the sum over its works.
- A cut's `parts_to_mark` counts the parts that overlap it and are unmarked for it.
- Marks are stored as at most one row per part and cut. Each row records `marked_by` (the person whose request stored it) and `marked_at` (the server time it was stored), and is never updated afterwards.
- When marks for the same part and cut arrive at the same time, from any mix of librarians and the section principal, exactly one gets 201 and every other one gets 200 with the same body. One row is stored, and the part's, the work's and the programme's figures each change once.
- Every response for an existing mark, at the same moment or any time later and from any person, reports the stored row's `marked_by` and `marked_at` unchanged.
- A mark that arrives at the same time as the deletion of its cut either is stored before the deletion and is deleted with it, or gets the 404. No mark ever refers to a cut that no longer exists.

**Scans (DP-21, DP-26).**

- A scan is filed only after the score store confirms the write: the server writes the object, then reads back its size and checksum and checks them against the upload. Only then does it create the catalogue row and answer 201. If the catalogue row cannot be created, the server deletes the new object and answers with the error.
- A filed scan's object, bytes, file name and type never change and are never deleted.
- Each upload creates a new scan with a new id and a new object key. The newest filed scan of each kind is the part's latest, and every earlier version stays listed and downloadable.
- Upload idempotency (DP-24): a key is scoped to the person.
  - Repeating a key with the same part, kind, file name and bytes returns the stored 201 response and writes nothing new.
  - Repeating a key with anything different is `409 {"error":"idempotency_key_reused",...}`.
  - A request that failed is not stored, so its key can be used again.

**Publishing (DP-27, DP-28, DP-29, DP-51).** The publish guards, in order:

1. The programme is `in_preparation`, else `illegal_transition`.
2. The server's current time is before the first rehearsal, else `first_rehearsal_passed`.
3. The programme has at least one work, else `no_works`.
4. The programme shortfall is 0, else `copies_short`.

- One check decides the guards. Every programme read reports in `publish_blockers` every guard that fails at the moment of the read, in this order, with the messages in Feedback states. For example, a draft programme with no works and a first rehearsal in the future has `illegal_transition` then `no_works`.
- Publish runs the same check at the moment of the request and, if any guard fails, answers the 409 described in API for the first one, changing nothing.

On success:

- The status becomes `published`. Each seated player gets one notice row and one folder notice email, attempted before the response is sent.
- Publish idempotency: a key is scoped to the programme. Replaying it returns the stored 200 response with no new notice. The same key sent for a different programme is `409 {"error":"idempotency_key_reused",...}`.
- When publishes arrive at the same time with different keys, exactly one gets 200 and the rest get the `illegal_transition` 409. Requests with the same key arriving at the same time all receive the single stored result.
- When a string count change on a `published` or `in_performance` programme seats a player who has no notice row for that programme, that player gets their notice row and folder notice at that point.
- A player with a notice row for the programme never gets a second folder notice for it, however often they are unseated and seated again.

**Folder visibility (DP-31, DP-46).**

- A folder is visible to a player only while the programme is `published` or `in_performance` and the player is seated in it.
- Only the player's chair parts are visible in it, and only their marked-part scans can be downloaded. Draft, in-preparation and closed programmes, other sections' parts and every bowing master are 404 to the player.
- Seating and visibility are worked out from the stored string count and programme status on every request. They are never held in the session, the cookie or server memory.
- When the principal librarian lowers a count on a `published` or `in_performance` programme, an unseated player's very next request with the session they already hold is refused:
  - `GET /api/folders` leaves that programme out;
  - `GET /api/folders/{programme id}`, `GET /api/folders/{programme id}/parts/{part id}` and `GET /api/scans/{id}/file` for that folder's marked-part scans answer the 404.
- When the count is raised again, the player's next request sees the folder again. No email is sent to them on either change, and their notice row stays.

**Rental sets (DP-35, DP-36, DP-37).**

- Stored statuses: `requested`, `received`, `in_use`, `returned`, `checked_in`.
- Legal edges:
  - requested → received (P);
  - received → in use (P);
  - in use → returned (P or A);
  - returned → checked in (P; the publisher has confirmed receipt).
- Every other edge is `409 {"error":"illegal_transition",...}`.
- A programme work may have only one set that is not `checked_in`; creating another is `409 {"error":"rental_set_open",...}`.
- Check-in counts are stored one per slip line. Saving them is allowed only while the set is `in_use`; otherwise it is `409 {"error":"wrong_status",...}`.
- A save holds the set row locked while it compares and writes. If any named line's stored count differs from its `expected`, the whole save is the `count_changed` 409 and nothing is written. Otherwise it changes only the lines it names, so saves of different lines made at the same moment all persist.
- The checks come in this order: `wrong_status`, then `count_changed`, then the 422 range check.
- in use → returned requires every slip line's checked-in count to equal its slip copies. Otherwise it is `409 {"error":"copies_missing","message":...,"missing":[{"part_id","part_name","missing":int}]}` and the set is unchanged.
- The move to returned holds the set locked while it checks the counts and changes the status, in one transaction. A count saved at the same moment either lands first and is part of the check, or gets the `wrong_status` 409 because the set is already `returned`. A set is never `returned` while `copies_missing` is greater than 0.
- When moves to returned arrive at the same time, exactly one gets 200 and every other one gets the `illegal_transition` 409.
- `returned_at` is the server time of the move. `returned_late` is true when that is after `due_at`.

**Due date and overdue (DP-36).**

- A set's due date is the business-zone calendar date of its programme's latest performance plus 14 days, due at 23:59 London time on that date. `due_at` carries London's offset for that date.
- A set is overdue when today's business-zone date is after its due date and its stored status is `requested`, `received` or `in_use`. It becomes overdue at 00:00 London time on the day after the due date. `display_status` is then `Overdue`, and otherwise the stored status label.
- For example, a final performance at `2026-10-24T23:30:00+00:00` is 00:30 on 25 October in London (British Summer Time). The due date is 2026-11-08, `due_at` is `2026-11-08T23:59:00+00:00`, and the set is overdue from 00:00 London time on 9 November. A UTC-based date would wrongly give 7 November.

**Return reminder date.** The reminder date is the due date minus 7 calendar days in the business zone. From that date, while the stored status is `requested`, `received` or `in_use`, every assistant librarian has one reminder per set, as described in Services.

### Services (DP-21, DP-26, DP-28, DP-30, DP-38, DP-39, DP-48)

**Postgres** is the system of record for people, sessions, programmes, works, bar maps, cuts, marks, string counts, holdings, scan catalogue rows, notices, rental sets, check-in counts, reminders and idempotency records. Apply the schema idempotently on every start. Seed the records below only when the database is empty.

**The score store (MinIO).** Each filed scan is one object in `S3_BUCKET` at the key `scans/<programme id>/<work id>/<part id>/<scan id>`. The object has the uploaded bytes exactly and the uploaded content type, and the key is reported as the scan's `object_key`. When the store is unreachable or a write is not confirmed:

- uploads answer `503 {"error":"storage_unavailable","message":"The score store is offline."}` and create no catalogue row;
- downloads of a filed scan answer the same 503 (an unknown scan id is still a 404 under the error order);
- `GET /api/status` reports `"storage":"down"`;
- folder responses carry `"scans_available":false`;
- every catalogue, count, cut, mark, publish and rental endpoint works as usual.

**Mail (Mailpit over SMTP).** Every message is plain text from `MAIL_FROM`, whose value at grading is `Quirewell Library <library@quirewell.test>`. Headers follow the single-line text rule in Business rules.

- **Folder notice:** to the player's email, subject `Your folder is ready: <programme title>`. The body has these lines:
  - `<player name>, your folder for Programme <nn> · <programme title> is ready.`
  - `Chair: <chair label>`
  - `Parts:`
  - one line `<work title> — <part name>` per chair part, in programme order, listing only that player's chair parts
  - `First rehearsal: <date-time> (London time)`
- **Return reminder:** one message to each assistant librarian, subject `Rental return due <date>: <work title> · <publisher>`, where `<date>` is the due date and `<publisher>` the set's publisher as stored. The body has these lines:
  - `Publisher: <publisher>`
  - `Programme <nn> · <programme title>`
  - `Copies on slip: <n>`
  - `Copies checked in: <n>`
  - `Due: <date> at 23:59 (London time)`

**Delivery rules.**

- A notice or reminder is `sent` only after the SMTP server accepts the message. Until then it is `queued`.
- Each queued message is retried on every reminder sweep until accepted, and is sent at most once.
- The reminder sweep runs at start, right after each rental set is created, and every `REMINDER_SWEEP_SECONDS`. It claims each due reminder in the database, so exactly one email goes to each assistant librarian per set even when several server processes share the database. A set whose reminder date has already passed when it is created gets its reminders on the first sweep.
- While mail is unreachable, publishing still returns 200 with the queued count, reminders queue, and `GET /api/status` reports `"mail":"down"`.

### Seed data (DP-01, DP-03, DP-08, DP-11, DP-12, DP-18, DP-31, DP-34, DP-36, DP-37, DP-46, DP-50)

Every person, orchestra, composer, publisher and work below is invented. `S` is the business-zone date on the day the seed is written. Seed times are London time, for example `S+21 10:00`. Every seeded person's passcode is `stand-desk-26`.

**Library staff:**

- Rowan Achterberg, `rowan@quirewell.test`, principal librarian;
- Priya Lindqvist, `priya@quirewell.test`, assistant librarian;
- Tomasz Ebdon, `tomasz@quirewell.test`, assistant librarian.

**Roster.** Chair keys and part names:

- `vn1` Violin I, `vn2` Violin II, `va` Viola, `vc` Cello, `cb` Bass;
- `fl1` Flute 1, `fl2` Flute 2, `ob1` Oboe 1, `ob2` Oboe 2, `cl1` Clarinet 1, `cl2` Clarinet 2, `bn1` Bassoon 1, `bn2` Bassoon 2, `hn1` Horn 1, `hn2` Horn 2, `tp1` Trumpet 1, `timp` Timpani, `hp` Harp.

String players sign in as `<key>-<two-digit chair>@players.quirewell.test`. Chair 01 of each string section is that section's section principal (role `section_principal`); every other roster member is a `player`.

- Violin I: 01 Hester Quayle, 02 Anouk Brennan, 03 Felix Ottaway, 04 Mireille Sato, 05 Joachim Varley, 06 Dagny Moss, 07 Kwame Ashdown, 08 Lior Pennick, 09 Saoirse Thalberg, 10 Bram Ellery.
- Violin II: 01 Odile Farrant, 02 Casimir Rook, 03 Yusra Penhaligon, 04 Ewan Strickland, 05 Noor Castellane, 06 Pip Hadley, 07 Ilse Marchetti, 08 Tobiah Crane.
- Viola: 01 Ruairi Delacourt, 02 Maren Okafor, 03 Silas Wren, 04 Agathe Lowry, 05 Dev Kingsmill, 06 Juno Halvorsen.
- Cello: 01 Clemency Arkwright, 02 Matthias Obi, 03 Wren Takahashi, 04 Esther Galloway, 05 Leopold Ince.
- Bass: 01 Ottilie Brace, 02 Rafferty Nakamura, 03 Gwen Abernethy, 04 Idris Fairweather.

Single chairs sign in as `<key>@players.quirewell.test`: `fl1` Sunniva Pike, `fl2` Hollis Drummond, `ob1` Marguerite Esk, `ob2` Cyrus Bellamy, `cl1` Tamsin Vey, `cl2` Arlo Mendes, `bn1` Philippa Groat, `bn2` Emeric Shaw, `hn1` Bettany Lusk, `hn2` Ansel Morrow, `tp1` Kit Ravensworth, `timp` Delphine Oakes, `hp` Isolde Fenn.

**Catalogue works** (bar maps as `bars: duration per bar`; parts cover every bar unless noted):

| Id | Title | Composer | Bar map | Rehearsal letters | Parts |
|---|---|---|---|---|---|
| `cw-the-weir` | The Weir | Edith Marrow | 1–119: 2400 ms; 120–184: 4123 ms; 185–300: 2500 ms | A 25, B 61, C 97, D 133, E 169, F 205, G 241, H 277 | Violin I, Violin II, Viola, Cello, Bass, Flute 1, Flute 2, Oboe 1, Oboe 2, Clarinet 1, Clarinet 2, Bassoon 1, Bassoon 2, Horn 1; Timpani bars 1–110; Harp bars 185–300 |
| `cw-fen-country-dances` | Fen Country Dances | Tobias Fenwick | 1–410: 3600 ms | A 41, B 81, C 121, D 161, E 201, F 241, G 281, H 321, J 361 | the five strings, Flute 1, Flute 2, Oboe 1, Oboe 2, Clarinet 1, Clarinet 2, Bassoon 1, Bassoon 2, Horn 1, Horn 2, Trumpet 1, Timpani |
| `cw-lantern-procession` | Lantern Procession | Ines Halloran | 1–240: 2750 ms | A 33, B 65, C 97, D 129, E 161, F 193, G 225 | the five strings, Flute 1, Oboe 1, Clarinet 1, Bassoon 1, Horn 1, Horn 2, Trumpet 1, Timpani |
| `cw-ferry-at-dusk` | Ferry at Dusk | Edith Marrow | 1–180: 2000 ms | A 31, B 61, C 91, D 121, E 151 | the five strings, Flute 1, Flute 2, Oboe 1, Clarinet 1, Bassoon 1, Horn 1 |
| `cw-orchard-serenade` | Orchard Serenade | Ines Halloran | 1–200: 3000 ms | A 41, B 81, C 121, D 161 | the five strings |

**Programmes.**

- Programme work ids are `<programme id>-<catalogue id without "cw-">`, for example `p01-the-weir`. Works added later to new programmes follow the same pattern.
- Part ids are `<programme work id>-<chair key>`, for example `p01-the-weir-vn1`.
- The string count is written in section order.

| Id | No. | Title | Status | First rehearsal | Performances | String count | Works |
|---|---|---|---|---|---|---|---|
| `p01` | 01 | Rivers and Weirs | in preparation | S+21 10:00 | S+25 19:30, S+26 19:30 | 8-7-6-5-4 | The Weir, Fen Country Dances |
| `p02` | 02 | Winter Lanterns | published | S+5 10:00 | S+8 19:30, S+9 14:30 | 10-8-6-5-4 | Lantern Procession |
| `p03` | 03 | Spring Overtures | draft | S+60 10:00 | S+64 19:30 | 8-7-6-5-4 | Ferry at Dusk |
| `p04` | 04 | Harvest Serenades | closed | S−24 10:00 | S−20 19:30, S−16 19:30 | 8-7-6-5-4 | Orchard Serenade |

**Holdings (copies on hand):**

- Programme 01, both works: Violin I 5, Violin II 4, Viola 3, Cello 3, Bass 2, every other part 1.
- Programme 02: Violin I 6, Violin II 5, Viola 3, Cello 3, Bass 2, every other part 1.
- Programme 03: every part 0.
- Programme 04: Violin I 5, Violin II 4, Viola 3, Cello 3, Bass 2.

**Cuts and marks.**

- Programme 02's Lantern Procession has one cut, bars 97–128, created at S−4 10:00. Marks are recorded for all 13 of its parts, each with `marked_by` Priya Lindqvist and `marked_at` S−3 10:00.
- No other work has cuts or marks.
- For example, with the seed data at start:
  - Programme 01's running time is 38:40;
  - cutting bars 120–184 of The Weir saves 4:28 and flags 14 parts;
  - Programme 02's running time is 9:32.

**Notices.** Programme 02's 41 notice rows (one per seated player, Violin I chairs 01 to 10 included) are recorded as `sent` at seed time, and no email is sent for them. The Flute 2, Oboe 2, Clarinet 2, Bassoon 2 and Harp players have no visible folder at start.

**Scans.** None exist; every scan list starts empty.

**Rental sets:**

- `rs-lantern`: Lantern Procession in Programme 02, publisher `Hartwell & Rye Music Hire`, status `in_use`.
  - Slip: Violin I 6, Violin II 5, Viola 3, Cello 3, Bass 2, and 1 each for Flute 1, Oboe 1, Clarinet 1, Bassoon 1, Horn 1, Horn 2, Trumpet 1 and Timpani (27 copies). All checked-in counts are 0.
  - Due date S+23, reminder date S+16.
- `rs-orchard`: Orchard Serenade in Programme 04, publisher `Calder Press Hire Library`, status `in_use`.
  - Slip: Violin I 5, Violin II 4, Viola 3, Cello 3, Bass 2 (17 copies). Checked in: Violin I 5, Violin II 4, Viola 3, Cello 2, Bass 2, so 1 cello copy is missing.
  - Due date S+(−2), so it is `Overdue` at start.
  - Its reminders are recorded as `sent` at seed time, and no email goes out for it.

## Technical requirements

### Deployment (DP-41)

- The runtime is Node.js 22 LTS with npm. Write the server and client in TypeScript.
- `/app/run.json` holds the string commands `install`, `build` and `serve` plus `"_schema":"run-manifest-v1"`, for example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```

- `serve` binds `0.0.0.0` on the port in `APP_PUBLIC_PORT`, default 4173.
- `GET /api/health` returns HTTP 200 `{"status":"ok"}` once the schema is applied and Postgres answers. Score store and mail outages do not change it.
- The grader may start several copies of the app at once, each with its own `DATABASE_URL`, and sometimes with one dependency pointed at an unreachable address. Every copy applies its schema and seeds its empty database on start.

### Configuration and secrets (DP-45)

Read these environment variables at start:

- `DATABASE_URL`;
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`;
- `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`;
- `APP_PUBLIC_PORT`;
- `REMINDER_SWEEP_SECONDS`: a whole number of seconds from 1 to 60 inclusive, default 30.

`MAILPIT_URL` may be present and is not needed. The bucket already exists; never create or reconfigure buckets. Never hard-code a credential, URL or bucket name. Never send any of these values to the browser or include them in responses or client bundles.

### Server boundary (DP-42)

- **Same origin only.** The server sends no CORS headers. A state-changing request (POST, PUT or DELETE) whose `Origin` header names a different origin is `403 {"error":"cross_origin",...}`.
- **Session cookie.** It is named `qw_session` and is HttpOnly, SameSite=Lax, Path=/, and expires after 12 hours of inactivity. It identifies the person only. Roles and seating are read from the database on every request.
- **JSON bodies.** They are accepted up to and including 65,536 bytes. Larger bodies get `413 {"error":"body_too_large",...}`. A JSON endpoint called with any other content type is `415 {"error":"unsupported_media_type",...}`.
- **Scan uploads.** A `file` of up to and including 20,000,000 bytes is accepted. A larger file, or a multipart request over 20,100,000 bytes, gets `413 {"error":"file_too_large",...}`.
- **What is served.** The server serves only the built client assets and the API. It never serves source files, source maps, `run.json`, package manifests, lockfiles, environment files or anything under `node_modules`; requests for them get 404. Non-API paths the client does not route get the app shell, which shows the client's own not-found handling.
- **Boot.**
  - If Postgres is unreachable at start, the server keeps retrying and answers `GET /api/health` with `503 {"status":"starting"}` until it connects.
  - If the score store or mail is unreachable at start, the server starts normally and degrades as described in Services.

### Browser support and performance (DP-06, DP-32)

- Supported browsers are current Chromium, Firefox and WebKit, at 375 by 812 (touch), 768 by 1024 (touch) and 1280 by 800 (mouse and keyboard). Any browser time zone and any device clock setting is supported.
- With the seed data, the programme desk is usable, with ruler and parts table rendered and interactive, within three seconds of navigation.
- The ruler caret responds to a key press within a tenth of a second.
- A folder page is readable within two seconds on a phone.
- Fonts are self-hosted, and the browser loads nothing from another origin.

## Working rules

- IF-01: `/app/run.json` exists, is valid JSON with exactly the keys `_schema` (value `run-manifest-v1`), `install`, `build` and `serve`, and every value is a string.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` names every shipped package, meaning the production dependency tree reported by `npm ls --omit=dev --all --json`, with its version and licence, plus each bundled font and the Lucide icon set.
- IF-03: Every shipped package (the production dependency tree reported by `npm ls --omit=dev --all --json`), font and icon set is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or SIL OFL 1.1.
- IF-04: Application state is stored only in the provided Postgres database and MinIO bucket: no SQLite, Redis, embedded database, or state files on local disk.
- IF-05: The provided service configuration (the compose files and the dev credentials in them) is left unchanged.
- IF-06: Server and client source is TypeScript. JavaScript files appear only as build output or tool configuration.
- IF-07: The client loads no script, style, font or image from a third-party origin at run time.

## Engineering standards

- Code is idiomatic, strictly typed TypeScript: no `any` in domain code, and no type assertions that hide a mismatch between request data and domain types.
- Names in code match the domain terms of this brief: programme, work, part, chair, string count, seating, copies needed, shortfall, cut, mark, marked by, scan, bowing master, folder, publish blocker, rental set, slip, check-in, expected count, due date, wall-clock time.
- Each domain rule is decided in exactly one place in the source: each programme and rental set transition guard, the publish guards and their blockers, copies needed and shortfall, running time and cut saving, parts to mark, seating and folder visibility, single-line text, the upload file-name decoding and the download file-name encoding, London wall-clock conversion, overdue, and the reminder date. The client only displays what the server returns and never re-derives a status from the device clock.
- Concurrency rules (one cut per bar, one mark per part and cut with its first attribution, one return, per-line check-in counts with stale-count refusal, one publish) are enforced by the database's constraints and locks, not by checks made in application memory before a write.
- There are no abstractions with a single implementation, no dead, commented-out or unreachable code, and no defensive checks for states the data model makes impossible.
- Every API error goes through one error shape and one ordering, matching the API section.
- Provider effects are confirmed before state changes: no catalogue row before a confirmed object write, and no `sent` before SMTP acceptance.
- The code has no features, endpoints or screens beyond this brief.
