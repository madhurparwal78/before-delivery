# Larkspur Lane Software Kinfold

Kinfold is a shared care board that one adult child keeps for an ageing parent and shares with their siblings, a paid home aide and a neighbour who helps. Each board is a row of lists holding cards: refills, rides, bills and visit checklists. Members move cards by pointer, touch or keyboard. Every move appears live in everyone else's open board along with who made it, and each person sees and changes only what their role allows. Build Kinfold as a TypeScript web application with a browser front end and a JSON API. PostgreSQL is the system of record. MinIO stores card attachments. Valkey relays live board events between the app's two web workers. Out of scope: self sign-up, password reset by email, email or push notifications, comments, creating or deleting workspaces, deleting boards or lists, reordering lists, and any datastore other than those three services.

## Problem and users

About 63 million Americans give unpaid care to a family member, for around 27 hours a week on average. In most families one adult child becomes the organiser and holds the work together through a group text, a shared document and memory. Prescription refills, rides to appointments, bills and aide shifts get lost between channels. Nobody can tell who owns what, and the organiser quietly does most of it. General-purpose boards show who owns each task, but they show everything to everyone. A paid aide or a helpful neighbour should see the week's tasks, not the parent's diagnosis notes, the insurance card scan or the siblings' argument about selling the house. When a sibling falls out or an aide leaves, the organiser needs that person's access gone at once, not after their next page refresh. Dedicated caregiver apps charge extra for sharing with several people, and they offer plain task lists rather than a board that works by keyboard and on a phone. Several people often share one device, such as the tablet in the parent's kitchen, so one person's details must never be left behind for the next person.

- **Organiser** (daily): sets up the care boards for one parent, moves cards as work gets done, decides who may see and change what, and removes or demotes someone the moment circumstances change.
- **Sibling** (daily): picks up and moves cards from a phone between work and school runs, and sees another sibling's moves arrive without reloading.
- **Aide** (weekly): reads this week's visit tasks and checklists on a tablet in the parent's kitchen, without seeing private notes or documents.

## Journeys

1. **Ruth sets up the week.** Start: Ruth Hale (organiser) is signed out at 1280x800, and Sam has "Weekly care" open in another browser.
   - Ruth signs in and lands on "Weekly care" under the editorial title "Margaret Hale". The empty "Waiting on others" list shows the empty-list copy.
   - She adds the card "Collect blood pressure cuff" to that list.
   - She creates the private board "Paperwork for Mum". She lands on that board's own address, which shows the no-lists-yet copy, with focus on Add a list. She adds the list "Paperwork", and focus moves to that list's add-card button.
   - Back on "Weekly care", she opens Board settings. The Add a person picker offers only Theo Marsh. She adds Theo and sets his role to Observer. The role change sends only the role. It never changes anyone's colour, initials or email, and a request that tries to set any other key is refused.
   - She opens "Money and house" from the drawer and changes Sam's role to Observer.
   - End: Sam's open "Weekly care" shows the new card and the new count without a reload. The permission log shows attributed entries for Ruth as the new board's admin, for Theo's addition and role change, and for Sam's role change on "Money and house".
2. **Sam moves a refill by keyboard.** Start: Sam Hale (sibling) is signed in on "Weekly care" at 1280x800, and Priya has the same board open in a second browser.
   - Sam tabs to "Refill lisinopril" and presses Space, Right Arrow, Down Arrow, Space. He hears the drop announcement for Pharmacy, position 2 of 4.
   - In Priya's browser the card glides from Inbox to Pharmacy, carrying Sam's colour and his initials chip for two seconds. Both browsers show the new list counts.
   - Doing the same move through the card's "Move to…" menu item gives the same list and position.
   - Sam lifts "Dental cleaning" in Appointments, where he cannot see the private "Memory clinic results", and presses Up Arrow then Space. He hears position 1 of 2. Ruth's board shows the card at position 1 of 3, before "Ride to cardiology on Thursday".
   - He marks "Pick up eye drops" done and then archives it from its actions menu. His drawer count, list counts and announcements follow the server's replies, and focus lands on the card that took its place.
   - Later, on his phone at 375x812 between school runs, he adds "Ask for the 50% copay card" to Pharmacy. He types "re" in the workspace search, pauses, then finishes typing "refill". Then he searches `50%`.
   - End: the results and the announced count always belong to the text in the box. The slow reply for "re" is never painted. `50%` finds only the copay card.
3. **Two siblings grab the same card.** Start: Sam and Priya both have "Weekly care" open, with "Pick up eye drops" at the same version in both browsers.
   - Each moves it to a different list at the same moment. Exactly one move is saved.
   - Priya's browser loses. The card glides back to where the server put it, and she is told who moved it first.
   - Priya presses Space, Right Arrow, Space on the card again. Her drop is accepted first time.
   - End: both browsers agree on the card's place, and every list's positions run without gaps.
4. **Dolores reads Tuesday's visit.** Start: before the visit, Ruth opened "Move metformin to mail order" on the parent's kitchen tablet, searched "discuss" and signed out. Dolores Vance (aide, observer) then signs in on the same tablet. The tablet is 768x1024, set to the Pacific/Honolulu time zone, with reduced motion on. Ruth's laptop is set to Pacific/Kiritimati.
   - Pressing Back shows Dolores nothing of Ruth's board, search or notes.
   - Dolores sees two lists side by side, switches to "Aide visits", opens "Tuesday visit" and reads its checklist.
   - Meanwhile Ruth, on her laptop, sets "Tuesday visit" due today and moves "Friday visit" from "Aide visits" to "Waiting on others". Both lists are in the pair that Dolores's tablet shows.
   - End: Dolores sees no notes, attachments, privacy controls or phone numbers, and her drawer counts only the cards she may see. "Tuesday visit" shows the due label the server decides for today in the workspace's time zone, on Dolores's tablet in "Aide visits" and on Ruth's laptop alike. On Dolores's tablet, "Friday visit" jumps straight into "Waiting on others" with Ruth's initials chip and a still outline for two seconds, and the remote-move sentence is announced.
5. **Ruth attaches a discharge sheet.** Start: Ruth has "Insurance card scan" open on "Money and house".
   - She first picks a PNG photo that her phone labelled as a PDF. It is refused, and nothing is stored.
   - She then attaches the PDF `Entlassung Müller "final".pdf`. The card shows it as uploading, and it becomes an attachment only once file storage confirms it.
   - End: downloading the file returns exactly the same bytes, under its own name.
   - On the instance where file storage is down, the board shows the storage banner and the upload fails with its copy. Nothing appears as attached, and moves and checklists keep working.
6. **Ruth's week away, and access that ends at once.** Start: Ruth is signed in on a phone at 375x812 using a screen reader. Sam left a laptop signed in at his mother's house with the "Ride to cardiology on Thursday" dialog open on "Weekly care", and his own phone shows "Money and house". Dolores has "Weekly care" open on the parent's kitchen tablet.
   - Ruth finds the "Appointments" tab by name and opens "Dental cleaning" from the list of buttons. She presses Back: the dialog closes to Appointments with focus on that card. She reloads, and Appointments is still selected.
   - For the week she is away, Ruth makes Sam a workspace admin. On his phone, still on "Money and house", Sam drags "Renew home insurance" to another position. While his move request is in flight, Ruth makes that card private to herself and Priya. The request answers 404, so the card leaves his board, the move is not applied and the no-longer-shared notice appears. Sam then opens the permission log from his phone, where the card's entry shows the label `Private card`.
   - Sam then changes his password from the Account menu on his phone, which keeps that phone signed in. Next, from the Boards sheet on the same phone, he opens "Weekly care" and then the "Dental cleaning" dialog, and leaves it open. Ruth opens Board settings on "Weekly care", opens Sam's role picker and chooses Observer, then removes Dolores from the board.
   - End: the laptop's next request gets the signed-out response, and the laptop goes to sign-in carrying its return path. Signing in again there reopens the card Sam had open, while a return path pointing to another site lands on the home route. Sam's open "Dental cleaning" dialog on his phone becomes read-only within two seconds. Dolores's open "Weekly care" on the kitchen tablet shows the board not-found page. Each change appears in the permission log.
7. **Live updates pause honestly.** Start: Priya opens "Weekly care" on the instance whose live relay is unreachable. She opens "Tuesday visit" and types notes without saving.
   - The board shows the paused banner. Her moves still save and announce, with counts from the server.
   - Neither the minute refresh nor the relay coming back wipes her draft, her notices or her selected list.
   - Her banner, notices and failed actions show only published copy, never a server address or error detail.
   - End: when the relay returns, the banner clears and the board refreshes itself, with no reload and no app restart.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health check** The app installs, builds and serves from /app/run.json and answers the health check, as set out in Deployment.
- **DP-02 — Two web workers on one port** The serve command runs two web worker processes behind the one app port, and every response names the worker that answered.
- **DP-03 — Credentials from the environment** Every service URL and credential is read from the environment at start and never appears in source, built assets or responses to the browser.
- **DP-04 — Same-origin server boundary** The server enforces the body-size, content-type, caching and cross-origin rules in Server boundary and never serves source, configuration or credentials.
- **DP-05 — Sign in, sign out and safe return** Seeded people sign in with email and password and sign out, and a request without a live session sends the browser to sign-in carrying its return path, which sign-in follows only when it is a safe same-origin path, as qualified in Business rules.
- **DP-06 — Password change ends other sessions** Changing a password keeps the current session and ends every other session of that account and its open live streams, as qualified in Business rules.
- **DP-07 — Workspace people** Workspace admins add people with a starting password, change their workspace role and remove them, and a workspace always keeps at least one admin.
- **DP-08 — Set up boards and lists** An organiser creates a board and lands on its own address with the no-lists-yet state and focus on Add a list, each new list takes focus to its add-card button, and new cards, visibility changes and added people show in every open copy of the board.
- **DP-09 — Attributed read-only permission log** Every access change writes one permission-log entry with actor, target, before, after and time, readable only by workspace admins and editable by nobody.
- **DP-10 — Effective board access** Each person's board role follows from their membership state and the board's visibility exactly as Business rules defines.
- **DP-11 — Board membership changes** Board admins add, re-role and remove board members, and the demotion or removal of a board's last admin is refused.
- **DP-12 — Access changes apply on the next request** A demoted, removed or signed-out person's very next API request is answered with their new rights.
- **DP-13 — Open boards follow access changes** A person whose access changes while their board is open sees the new role, locked edits or the board gone without reloading, as qualified in Interactions.
- **DP-14 — Role-shaped responses** Every card, board, member, search and event payload carries exactly the fields published for the caller's role and nothing more.
- **DP-15 — Hidden means not found** A private board, a private card or another workspace's record answers exactly like an id that does not exist, in the API and on screen.
- **DP-16 — Private cards** People named on a card can make it private to chosen board members, after which it disappears from everyone else's lists, list counts, drawer open-card counts, positions, search and events.
- **DP-17 — Workspace isolation** Search, the Add a person picker, member lists, board lists and every count never include anything from another workspace.
- **DP-18 — Workspace search keeps up with typing** Search returns matching cards from boards the caller can see, and the results and the announced count on screen always belong to the search box's current text, as qualified in Feedback states.
- **DP-19 — Create cards without duplicates** Adding a card appends it to its list, and repeating the request with the same idempotency key creates nothing new.
- **DP-20 — Versioned card edits** Card edits carry the card's version, and a stale version is rejected with the card's current state and who changed it.
- **DP-21 — Card status lifecycle** Cards move between open, done and archived only along the published edges, and members can restore archived cards.
- **DP-22 — Due labels in the workspace time zone** The server decides each card's due state in the workspace's time zone, and the board shows the matching label and re-reads it at least once a minute.
- **DP-23 — Checklists** Members add, rename, tick, untick and delete checklist items on a card, and each change shows on every open copy of the board.
- **DP-24 — Card dialog by keyboard** The card dialog opens with Enter, keeps Tab and Shift+Tab inside itself, saves, and closes with Escape back to the card.
- **DP-25 — Dense card ranks on every move** A move places the card at the requested list and position, and every list's positions stay unique and gap-free after any sequence of moves.
- **DP-26 — Keyboard lift, move and drop** A card can be lifted with Space, moved within and across lists with the arrow keys, and then dropped or cancelled, following the published key map.
- **DP-27 — Move card dialog** The card's Move to… menu item opens a dialog that moves the card to the chosen list and position, with the same result as a keyboard or pointer move.
- **DP-28 — Move announcements** Every lift, move, drop, cancel, remote move, card creation, status change and checklist change is announced with its published sentence in the board's announcement region.
- **DP-29 — One winner for simultaneous moves** When two people move the same card at the same version, exactly one move succeeds and the other is rejected as stale.
- **DP-30 — Live board events across workers** Every change to a board reaches every open live stream of that board on either worker, shaped for each recipient, as qualified in Business rules.
- **DP-31 — Board updates in place** With two people on the same board, one person's move, new card or rename appears in the other's open board with updated list counts and no reload.
- **DP-32 — Stale move snaps back** When the server rejects a move as stale, the card returns on screen to the server's position and the board says who moved or edited it first.
- **DP-33 — Hand-off glide** A remote move glides the card from its current place to its newest one with the mover's tint and initials chip for the published time, restarting the chip for a later mover and retargeting a glide still in flight, as described in Motion and effects.
- **DP-34 — Aide's visit view** An observer on a tablet reads the week's visit cards and checklists in a read-only card dialog that shows no notes, attachments, privacy controls or phone numbers.
- **DP-35 — Reduced-motion hand-off** With reduced motion on, cards jump into place with no animation, while the mover's chip, a still outline and the announcement remain as published.
- **DP-36 — Attachments only after storage confirms** An attachment exists on a card only after file storage confirms the stored object, and a failed upload never shows as attached.
- **DP-37 — Byte-exact attachment downloads** Attachments download byte for byte, and only through the app's own authorised route.
- **DP-38 — Deleting removes stored objects** Deleting an attachment or a card removes its stored objects, as qualified in Business rules.
- **DP-39 — File storage outage** When file storage is down, the board stays usable, shows the storage banner and refuses only attachment actions, then recovers by itself.
- **DP-40 — Live updates pause and resume** When the live relay is down, open boards show the paused banner while every change still saves, and live updates resume by themselves when the relay returns.
- **DP-41 — Boot and recover without restart** The app starts and serves while file storage or the live relay is unreachable, and recovers when they return, with no restart.
- **DP-42 — Published breakpoints** The board shows one list, two lists or all lists at the widths published in Screens and layout, at every published viewport.
- **DP-43 — Closed panels are inert** A closed board drawer, sheet, menu or dialog has nothing visible, focusable or clickable at any viewport.
- **DP-44 — Menus open uncut** The card actions menu and the member role picker open fully inside the viewport, above every other layer, and close with Escape back to their button.
- **DP-45 — Verbatim published copy** Every backticked string in this brief renders and is announced character for character.
- **DP-46 — Calm visual identity** The board uses the oat, cream, ink, sage and brick colour roles and the Literata and Atkinson Hyperlegible type described in Visual design, with no gradients and no shadows at rest.
- **DP-47 — Editorial board composition** The parent's name heads the board as an editorial title over cream list columns with ruled headings, card counts and an even spacing rhythm.
- **DP-48 — Re-reads keep unsaved work** When the board re-reads itself, an open dialog's unsaved fields, every undismissed notice, the selected list and focus all stay, as qualified in Feedback states.
- **DP-49 — List and card in the address** Below 1200 pixels the selected list is kept in the address across reloads, and an opened card has its own address that browser Back closes to its list with focus on the card, as qualified in Feedback states.
- **DP-50 — Only published request keys** Every JSON endpoint refuses any request key outside its published list with a 422 on that key, and changes, logs and broadcasts nothing.
- **DP-51 — Counts after your own action come from the server** After a person's own drop, move, mark done, reopen or archive, their list counts, drawer open count and announced position come from the server's reply, even while live updates are paused, and focus lands as published.
- **DP-52 — Mover shown by more than colour** Mover chips, owner chips and the Overdue label meet the published contrast, and a tinted or outlined card always carries the mover's named initials chip.
- **DP-53 — Exactly one winner and no merged edits** Of any number of same-version writes to one card on either worker exactly one succeeds, a stale write is refused even when it touches other fields, and the losing browser takes the server's version so its next attempt succeeds.
- **DP-54 — Nothing survives sign-out** Every response is uncacheable and sign-out discards all in-page state, so Back after sign-out and the next person on the same browser never see the earlier person's data.
- **DP-55 — Safe attachment files** Uploaded bytes must match the declared PDF, JPEG or PNG type, file names with control characters are refused, and downloads carry the published safe file-name and no-sniff headers.
- **DP-56 — Hidden cards never reach copies** Permission-log labels, event streams and write replies never carry a card or board the reader cannot see, and a person whose write meets a newly hidden card sees it leave their board with the published notice.
- **DP-57 — Literal, bounded search** Search treats every character literally, ignores case across Unicode, counts length in code points from 2 to 100, and reports totals above 50 with the published sentence.
- **DP-58 — Opaque errors** No response, header, event or on-screen message reveals a service address, driver error, stack or environment value, unexpected errors answer the published 500, and malformed ids answer the plain not-found.
- **DP-59 — Exact accessible names** List tabs, card buttons, the lock icon, the owner chip and the Boards button carry exactly the published accessible names and states at every viewport.
- **DP-60 — Server decides due dates** The browser never derives a due date or label from its own clock or time zone, and a workspace time-zone change shows on open boards at their next minute re-read.

## Frontend

### Screens and layout (DP-08, DP-16, DP-34, DP-42, DP-43, DP-47)

Page routes:

| Path | Shows |
|---|---|
| `/signin` | Sign-in form; may carry `?next=<return path>` |
| `/` | Goes to the first board by name that is visible to the whole workspace, in the signed-in person's first workspace. If there is none, it goes to the first visible board by name. With the seed data, Ruth, Sam and Priya land on "Weekly care" |
| `/boards/<boardId>` | The board; below 1200 pixels the address may carry `?list=<listId>` |
| `/cards/<cardId>` | The card's board with that card's dialog open |
| `/workspaces/<workspaceId>/permission-log` | The permission log (workspace admins) |

Every page route returns the app with HTTP 200. Not-found states are drawn from the API's 404 (DP-15). Business rules owns the signed-out redirect and its return path (DP-05).

**Board screen.**
- **Top bar:** the parent's name as `heading level 1`, the workspace search box and the Account button.
- **Board header:** the board name as `heading level 2`, the Board settings button (board admins only) and the Keyboard shortcuts button.
- **Board drawer:** lists the workspace boards the person can see. The current board's link is marked as the current page. Each link's accessible name is exactly the board name. The open-card count text from Feedback states sits next to the link, outside it, and is built from the caller's `openCards` value. Workspace admins also see the New board button.
- **List columns:** each has its name as `heading level 3`, a hairline rule, the card count, its cards in order and an add-card button.
- **Card face:** shows the title, labels, due label, owner chip, checklist progress (`<done>/<total>`) and a Done mark on done cards. Private cards carry a small lock icon. Only the title is inside the card's main button. Labels, due label, owner chip, lock and progress sit beside it (DP-59).
- **Empty states:** an empty list shows the empty-list copy. A board with no lists shows the no-lists-yet copy in the board area.
- **Add a list:** shown to board admins. At 1200 pixels and wider it follows the last list column. Below that it sits beside the list switcher. On a board with no lists it sits under the no-lists-yet copy.

These are the published breakpoints. No width in between may change the layout that a published viewport gets.

| Width | Lists shown | List switcher | Board drawer |
|---|---|---|---|
| below 768 pixels (published viewport 375x812) | exactly one list, filling the width | `tablist "Lists"` above the list; the selected tab picks the list | collapsed into a sheet that the Boards button opens; closed at load |
| 768 to 1199 pixels (published viewport 768x1024) | two neighbouring lists side by side: the selected list and the one after it (the last list pairs with the one before it) | shown | slim drawer, always visible on the left |
| 1200 pixels and wider (published viewport 1280x800) | every list side by side in order. With the seed data at start, all five lists sit fully inside the viewport. Boards with more lists scroll sideways inside the board area only | hidden | slim drawer visible on the left |

Lists always appear in list order, left to right. No published viewport scrolls the page sideways. During a keyboard move, if the lifted card's list moves out of view, the switcher follows the lifted card.

**Card dialog.** A modal dialog. Below 768 pixels it fills the screen. At wider sizes it is centred and takes at most about two thirds of the width.
- Members and admins see editable title, notes, due date, owner, labels, checklist, privacy and attachments.
- Observers see title, labels, due date, owner and checklist as read-only text with disabled checkboxes. They get no notes, attachments, privacy or delete controls (DP-34).

**Other screens:**
- the New board, Move card, Board settings (visibility, a member table with role pickers, Add a person), Keyboard shortcuts and Change password dialogs
- the Boards sheet below 768 pixels
- the search results region under the search box
- the permission log page: a full-width table that scrolls sideways inside itself on phones
- the not-found state, which replaces the board area and keeps the top bar

A closed drawer sheet, dialog, menu or picker is not shown. Nothing inside it can be focused or clicked, and it is absent from the accessibility tree at every viewport. Moving a panel off-screen does not count as closing it (DP-43).

### Public screens and controls (DP-05, DP-08, DP-13, DP-18, DP-24, DP-26, DP-27, DP-28, DP-33, DP-44, DP-52, DP-59)

Only these roles and names are public. Everything else is up to you. Feedback states defines `<title>`, `<list name>`, `<name>`, `<item>` and `<filename>`.

| Where | Role and accessible name | Visible copy and notes |
|---|---|---|
| Sign-in | `heading level 1 "Sign in to Kinfold"` | same |
| Sign-in | `textbox "Email"`, `textbox "Password"` (password field) | labels as named |
| Sign-in | `button "Sign in"` | `Sign in` |
| Top bar | `heading level 1` | the workspace's parent name, for example `Margaret Hale` |
| Top bar | `button "Boards"` | shown only below 768 pixels; opens the Boards sheet; carries `aria-expanded` set to `true` while the sheet is open and `false` while it is closed |
| Boards sheet | `dialog "Boards"` containing `navigation "Boards"` and `button "New board"` (workspace admins) | links named by board name |
| Drawer | `navigation "Boards"` | one `link` per board, named exactly by the board name; the current board's link has `aria-current="page"`; the count text sits beside it |
| Drawer | `button "New board"` | workspace admins only |
| New board | `dialog "New board"` with `textbox "Board name"`, `radiogroup "Who can see this board"` (`radio "Everyone in this workspace"`, `radio "Only board members"`, the latter selected by default), `button "Create board"`, `button "Cancel"` | |
| Board | `button "Add a list"`, then `textbox "New list name"` | board admins only |
| Top bar | `searchbox "Search this workspace"` | placeholder `Search cards` |
| Search | `region "Search results"` | one `link` per result, named by the card title |
| Search | `status "Search results status"` | polite, visually hidden, outside the results region |
| Top bar | `button "Account"` opening `menu "Account"` | `menuitem "Change password"`, `menuitem "Permission log"` (workspace admins only), `menuitem "Sign out"` |
| Board | `heading level 2` | board name |
| Board | `button "Board settings"` | board admins only |
| Board | `button "Keyboard shortcuts"` | opens `dialog "Keyboard shortcuts"` with the key map table |
| Board | `tablist "Lists"` with one `tab` per list, named exactly by the list name with no count in it; each tab's `aria-controls` names the `region "<list name>"` it shows | below 1200 pixels |
| List | `region "<list name>"` containing `heading level 3 "<list name>"`, the count text and `list "<list name> cards"` | |
| Card | `listitem` containing `button "<title>"`, named exactly by the title, and `button "Actions for <title>"` | each Actions button opens its own menu |
| Card | `img "Private card"` | the lock icon on private cards |
| Card | `img "Owner <name>"` | the owner chip, showing the owner's initials |
| Card actions | `menu "Actions for <title>"` | `menuitem "Move to…"` (one ellipsis character), `menuitem "Mark done"` or `menuitem "Reopen"`, `menuitem "Archive"`; members and admins only |
| List | `button "Add a card to <list name>"`, then `textbox "New card title"` | members and admins only |
| Remote mover | `img "Moved by <name>"` | the initials chip on the moved card, with the initials as its visible text |
| Card dialog | `dialog "<title>"` | |
| Card dialog | `textbox "Title"`, `textbox "Notes"`, `textbox "Due date"` (date field), `combobox "Owner"`, `group "Labels"` with one `checkbox` per label | members and admins |
| Card dialog | `group "Checklist"` with one `checkbox "<item>"` per item, `textbox "New checklist item"`, `button "Add item"`, `button "Delete <item>"` | checkboxes disabled for observers |
| Card dialog | `group "Who can see this card"` with `checkbox "Everyone on this board"` and one `checkbox "<name>"` per eligible member | members and admins |
| Card dialog | `button "Attach a file"`, `list "Attachments"` with `link "<filename>"` and `button "Remove <filename>"` per attachment | members and admins |
| Card dialog | `button "Save changes"`, `button "Close"` | `Save changes` / `Close` |
| Card dialog | `button "Delete card"` opening `alertdialog "Delete this card?"` with `button "Delete"` and `button "Keep card"` | board admins only |
| Move | `dialog "Move card"` with `combobox "List"`, `combobox "Position"`, `button "Move"`, `button "Cancel"` | Position offers 1 up to the end of the chosen list |
| Settings | `dialog "Board settings"` | |
| Settings | `radiogroup "Who can see this board"` with `radio "Everyone in this workspace"` and `radio "Only board members"` | |
| Settings | `table "Board members"`; per row `button "Role for <name>"` opening `menu "Role for <name>"` | `menuitemradio "Admin"`, `menuitemradio "Member"`, `menuitemradio "Observer"`, `menuitem "Remove from board"` |
| Settings | `combobox "Add a person"`, `button "Add to board"` | options are the board's candidates from the API, named by display name; new people join as Member |
| Password | `dialog "Change password"` with `textbox "Current password"`, `textbox "New password"`, `button "Change password"` | |
| Permission log | `heading level 1 "Permission log"`, `table "Permission log"` | columns `When`, `Who`, `What`, `Target`, `Before`, `After`; the Target cell shows the entry's `target.label` |
| Not found | `heading level 1` | the not-found copy from Feedback states |
| Board | `status "Board announcements"` | polite, visually hidden |
| Board | `status "Service status"` | a visible banner strip under the top bar; empty when everything is up |
| Board | `region "Notices"` with one `button "Dismiss notice"` per notice | visible, not live; holds conflict and access notices until they are dismissed |

### Interactions (DP-08, DP-13, DP-18, DP-24, DP-26, DP-27, DP-31, DP-32, DP-43, DP-44, DP-49, DP-51, DP-53, DP-54, DP-56)

**Published key map.** Show this table verbatim in the Keyboard shortcuts dialog:

| Key | When | Effect |
|---|---|---|
| Space | focus on a card button | lifts the card |
| Up Arrow / Down Arrow | card lifted | one position up or down in the current list, stopping at the ends |
| Left Arrow / Right Arrow | card lifted | to the previous or next list, keeping the same position number when it exists, otherwise last |
| Space or Enter | card lifted | drops the card where it is |
| Escape | card lifted | cancels; the card returns to where it started |
| Tab | card lifted | cancels, then moves focus as usual |
| Enter | focus on a card button, not lifted | opens the card dialog |
| ? | focus on any control in the board area that is not a text field | opens the Keyboard shortcuts dialog |
| Escape | a dialog, sheet or menu is open | closes it and returns focus to the control that opened it |

A lifted card keeps focus. Each arrow press updates its list and position on screen and plays the over-announcement. A drop where the card started counts as a cancel and sends nothing. A drop anywhere else sends one move request.

**Pointer and touch.**
- Pressing a card with a mouse and moving more than 4 pixels lifts it, and the card follows the pointer. Releasing over a slot drops it there. Releasing after moving 4 pixels or less opens the card dialog.
- On touch, pressing and holding a card for half a second lifts it, and a short tap opens it.
- Escape during a pointer drag cancels it.

**Move to….** Choosing `Move to…` opens the Move card dialog with the card's current list and position preselected. Choosing a list resets Position to the end of that list. `Move` sends the same move request as a keyboard drop, then closes the dialog, and focus returns to the card at its new place.

**Status from the actions menu.** `Mark done`, `Reopen` and `Archive` each send one status request.
- After `Mark done` or `Reopen`, focus returns to the card's button.
- After `Archive`, focus goes to the card that now holds the archived card's position in that list. If there is none, it goes to the card before it. If the list is now empty, it goes to `Add a card to <list name>`.

**Counts after your own action (DP-51).** After the person's own drop, Move card dialog move, `Mark done`, `Reopen`, `Archive` or card creation, three things are taken from the server's reply and never from local arithmetic or from the person's own event echo:
- both list counts, from the reply's `counts`
- the drawer's open count for the current board, from the reply's `openCards`
- the position and total in the announced sentence, from the reply's `card.position` and `counts`

These match a fresh read of the board and of the board list within 1 second, including on an instance where live updates are paused.

**Dialogs, sheets and menus.**
- Each opens with its first control focused. A card dialog focuses `Title` for members and `Close` for observers.
- Tab from the last control wraps to the first, and Shift+Tab from the first wraps to the last. Focus never leaves an open dialog or sheet.
- Escape or `Close` closes it and returns focus to the opener. Clicking outside a menu closes it.
- Menus open with their first item focused, and the arrow keys move between items.
- Every menu and picker opens fully inside the viewport and above every other layer at 375 and 1280 pixels wide, and each item can be clicked at its centre (DP-44).
- In the card dialog, `Save changes` sends the edited fields once, Enter in `New checklist item` adds the item, and ticking or unticking a checklist checkbox saves at once.

**New board and lists.** `New board` opens the New board dialog, and `Create board` sends the create request. `Add a list` reveals `New list name`. Enter there creates the list, hides the field and moves focus as described in Feedback states. Escape hides the field and returns focus to `Add a list`.

**Add a card.** `Add a card to <list name>` reveals `New card title`. Enter creates the card and keeps the field open for the next one. Escape hides the field and returns focus to the button.

**Search.** Typing updates the results with no submit, following the search rules in Feedback states. Choosing a result opens `/cards/<cardId>`. Escape in the search box clears it and empties the results region and the search status.

**List switcher and card addresses.** Choosing a tab selects that list. Opening a card from the board adds a history entry for its card address. Back and Forward follow the address rules in Feedback states (DP-49).

**Sign out (DP-54).**
- `Sign out` ends the session. It then discards everything the page holds: board state, search text and results, notices, open dialogs and drafts, and drawer counts.
- It goes to `/signin` with no `next` and with no signed-out notice.
- If a page is shown again by browser Back or Forward after sign-out, it checks the session before painting anything. With no session, it goes to `/signin` with no `next` and never shows the earlier person's board, even briefly.
- The next person to sign in on that browser sees only their own data.

**Live board.**
- The open board keeps one live stream. Remote moves, new cards, renames, checklist changes, status changes and list changes are applied in place, with list counts updated and no reload (DP-31).
- A remote move of the card someone currently has lifted first cancels their lift. Two sentences are announced in this order: the cancel sentence for the card's new place, then the remote-move sentence.
- A remote event that removes the lifted card cancels the lift with the removed-card cancel sentence.
- If a remote event changes the card open in someone's dialog, the fields they have not edited take the new values, and the fields they have edited keep their draft (DP-48).

**Optimistic move and stale replies (DP-32, DP-53).**
- On drop, the card settles into its new slot at once.
- If the server answers `stale`, the card glides back to the place in the reply's `card`. The stale sentence chosen by the reply's `change` is announced and added to Notices.
- The board adopts the reply's card, including its `version`, so the person's next move or save of that card succeeds first time.
- No copy of the card stays at the optimistic place.
- On a stale save, the card dialog stays open. The fields the person edited keep their drafts, and the fields they did not edit take the server's values.

**Own write meets a hidden card (DP-56).** When the person's own move, save, status, checklist or attachment request on a card answers 404, the card leaves their board and any open dialog for it closes to the board. The no-longer-shared sentence is announced and added to Notices.

**Access change while the board is open (DP-13).** When the live stream reports a new role, the board re-reads itself and shows the access notice.
- On demotion to observer, an open card dialog becomes read-only and its unsaved edits are discarded.
- If an edit was saved before the change arrived and the server answered 403, the dialog shows the locked-edit copy and becomes read-only.
- When access is removed, the board area shows the board not-found state.
- When the session ends, the browser goes to sign-in as Business rules describes.

### Visual design (DP-46, DP-47, DP-52)

**Colour roles:**
- a warm oat page ground with no gradients
- cream for list columns, dialogs and cards
- a deep, warm near-black ink for text
- a deep sage green for primary actions, links, the selected tab and focus rings
- a brick red used only for the `Overdue` label, field errors and destructive actions
- six mover colours named sage, clay, plum, ochre, slate and rose, used for mover chips, mover tints and outlines, and owner chips

Contrast rules (DP-52):
- Each mover colour is a deep, muted shade with at least 3 to 1 contrast against the cream surface.
- The initials in a mover chip or owner chip are cream on the person's mover colour, at 4.5 to 1 or more.
- The `Overdue` label is brick text with at least 4.5 to 1 contrast against cream, and always shows the word.
- The mover is never shown by colour alone. A card with a mover tint or outline always carries the `img "Moved by <name>"` chip, with the initials as visible text.

**Type:**
- Literata, a bookish serif, for the parent's name, board name and list headings. Atkinson Hyperlegible, a sans designed for legibility, for everything else.
- Card text is never smaller than 16 pixels.
- Each heading step is about a quarter larger than the one below it, so the parent's name reads as an editorial masthead.
- The app serves both fonts itself.

**Composition:**
- The parent's name runs across the top like a magazine masthead.
- Lists are cream columns on the oat ground, each with its serif heading, a hairline rule beneath it and a plain card count.
- The slim board drawer sits on the left.
- All spacing is a multiple of a small 4-pixel step, at a comfortable density: three to five cards fit in a column at 1280x800 without crowding.

**Surfaces and details:**
- Surfaces have no drop shadow at rest. Colour and hairline borders separate them, and only a lifted card has a shadow.
- Icons are simple line icons. Avatars and owner chips show initials on the person's mover colour.
- Controls are at least 44 by 44 pixels to tap. Focus shows as a 2-pixel sage ring set slightly apart from the control.
- Text and controls meet WCAG 2.2 AA contrast. State never relies on colour alone: overdue cards also carry the word label, and private cards carry the lock icon.

### Motion and effects (DP-33, DP-35)

All motion starts quickly and settles gently. Motion appears only on cards that actually moved, on the slots they move into and out of, and on overlays as they open. Decorative or idle loops are not allowed. The only repeating motion is the upload progress indicator, and reduced motion replaces it with static text. Dialogs and menus fade and settle in under a fifth of a second.

**Signature: Hand-off glide.** It shows, in every open browser, which member moved which card, from where to where.
1. **Lift (in the mover's browser).** On Space, or after a pointer drag of more than 4 pixels, the card rises: it grows about 3% and its shadow deepens from barely there to soft. A dashed placeholder the card's size stays in the slot it started from.
2. **Travel.** As the target changes, the destination slot opens from nothing to the card's height in 120 to 250 milliseconds. The slot the card leaves closes just as fast.
3. **Drop.** The card settles into the open slot in 120 to 250 milliseconds and shrinks back to rest with no shadow. The placeholder closes. The drop sentence is announced once the server accepts the move.
4. **Every other open browser.** When the move event arrives, the same card glides in one movement of 250 to 400 milliseconds from its current place on screen to its new one. Neighbouring cards make room smoothly. The card's left edge is tinted in the mover's colour, and the mover's initials chip sits on it. Both stay for 2 seconds, fade out over the final 0.4 seconds, and are gone 2.5 seconds after the event arrived. List counts update when the glide starts.
5. **Moved again before the chip ends.** If another move event for the same card arrives while its chip is showing, the chip and tint switch at once to the new mover. The full 2 seconds restart from that event, so the chip is gone 2.5 seconds after the latest event. The earlier mover's chip never shows again.
   - If the card is still gliding when the event arrives, it glides from where it currently is on screen to the newest place, finishing 250 to 400 milliseconds after the second event. It never jumps back to the first origin or snaps to the first target. Counts update at the start of each glide.
   - Each card's chip keeps its own time. One card's chip ending never removes or shortens another card's chip.
6. **Rejected move.** In the losing browser, the card glides back from its optimistic place to the server's position in 250 to 400 milliseconds.

The glide runs on time, not on scrolling.

**Reduced motion (when the device asks for reduced motion):**
- Cards jump straight to their new position. No card, slot or placeholder animates or transitions, and nothing scales.
- The mover's initials chip and a still 2-pixel outline in the mover's colour show for 2 seconds, then disappear without fading. They follow the same restart rule.
- Every announcement is identical.
- Lifting still shows the dashed placeholder, which appears at once.

### Feedback states (DP-05, DP-08, DP-13, DP-15, DP-16, DP-18, DP-28, DP-32, DP-39, DP-40, DP-45, DP-48, DP-49, DP-51, DP-55, DP-56, DP-57)

**Placeholders:**
- `<title>` is the card title as stored, and `<list>` is the list's name.
- `<n>` is the card's 1-based position among the cards in that list that the viewer can see.
- `<total>` is the number of non-archived cards in that list that the viewer can see, including the card itself.
- `<name>` is a person's display name, and `<item>` is a checklist item's text.
- `<filename>` is the attachment's file name as the person chose it. Any control character in it is shown as `?`.
- `<role>` is `Admin`, `Member` or `Observer`.
- `<query>` is the search box's text exactly as typed.
- `<count>` is a whole number of 2 or more.

All copy uses straight apostrophes and straight double quotes.

Announcements in `status "Board announcements"`:

| Event | Copy |
|---|---|
| Keyboard lift | `Picked up <title> in <list>, position <n> of <total>. Use the arrow keys to move, Space to drop, Escape to cancel.` |
| Pointer or touch lift | `Picked up <title>.` |
| Each arrow step while lifted | `<title> is over <list>, position <n> of <total>.` |
| Own move accepted (keyboard, pointer or Move card dialog) | `Moved <title> to <list>, position <n> of <total>.` |
| Cancel, or drop where it started | `Move cancelled. <title> is back in <list>, position <n> of <total>.` (the card's starting place) |
| Lift cancelled because a remote event moved the lifted card | the same cancel sentence, giving the card's new place as the server now has it for this viewer; announced first, then the remote-move sentence |
| Lift cancelled because a remote event removed the lifted card (archived, deleted or no longer visible to this viewer) | `Move cancelled. <title> is no longer on this board.` and nothing else for that removal |
| Remote move arrives | `<name> moved <title> to <list>, position <n> of <total>.` |
| Stale reply with `change` `moved` | `<name> moved <title> first. It's back in <list>, position <n> of <total>.` |
| Stale reply with `change` `edited` | `<name> edited <title> first. It's back in <list>, position <n> of <total>.` |
| Own write answered 404 | `<title> is no longer shared with you.` |
| Card created by me | `Added <title> to <list>.` |
| Card saved | `Saved changes to <title>.` |
| Marked done / reopened / archived | `Marked <title> done.` / `Reopened <title>.` / `Archived <title>.` |
| Checklist item ticked / unticked / added | `Checked off <item>.` / `Unchecked <item>.` / `Added <item> to the checklist.` |
| Attachment confirmed | `Attached <filename>.` |
| Live relay back | `Live updates are back.` |

The stale sentence depends on the reply's `change`, not on what the losing person was doing. For example, Priya saving notes after Sam's move hears the `moved` sentence. Both stale sentences and the no-longer-shared sentence are also added to `region "Notices"`. A notice never dismisses itself: each stays until its own `Dismiss notice` is pressed, and newer notices sit above older ones.

Search sentences in `status "Search results status"`, one for each settled query:
- `<count> cards match "<query>".`
- `1 card matches "<query>".`
- `No cards match "<query>".`
- `Showing 50 of <count> cards that match "<query>".` when the reply's `total` is above 50, where `<count>` is that total
- `Search is limited to 100 characters.` when the text is longer than 100 code points

**Search rules (DP-18, DP-57).**
- The results region and the search status show results only for the text currently in the box.
- A query settles within half a second of the last keystroke.
- Once newer text is typed, any request for earlier text is abandoned. A reply for earlier text that arrives after a later one is discarded and never painted, not even briefly, and nothing is announced for it.
- The browser counts length in Unicode code points, the same way the server does.
- Text shorter than 2 code points, including an empty box, empties the results region and the search status at once and sends no request. A late reply for earlier text does not refill them.
- Text longer than 100 code points sends no request, empties the results region and sets the limit sentence.
- Every settled query announces its sentence, even when it is the same as the previous one.

States for each async action:

| Action | Pending | Success | Field error | Outage or refusal |
|---|---|---|---|---|
| Sign in | button reads `Signing in…` | goes to the reply's `redirectTo` | `That email and password don't match.` under the form, in an `alert`; the page keeps its `next` value | — |
| Signed out (any 401) | — | the sign-in page shows `You've been signed out. Sign in again to continue.` in a `status` | — | — |
| Change password | button reads `Changing…` | `Password changed. Every other session is now signed out.` in the dialog's `status` | `That isn't your current password.` / `Use 12 to 200 characters.` under the field | — |
| Create board | button reads `Creating…` | lands on the new board as described below | under `Board name`: `Give the board a name.` / `Keep the name to 60 characters or fewer.` | — |
| Add a list | field disabled until the reply | the new list appears at the end as described below | under `New list name`: `Give the list a name.` / `Keep the name to 40 characters or fewer.` | — |
| Create card | field disabled until the reply | the card appears and the creation sentence is announced | `Give the card a title.` / `Keep the title to 120 characters or fewer.` under the field | — |
| Save card | button reads `Saving…` | saved sentence | the same title messages under `Title`; other fields show the server's field message | stale: the stale sentence; 403: `You can no longer edit this card.` in Notices; 404: the no-longer-shared sentence |
| Move or status change | the card settles at once | drop or status sentence | — | stale: the stale sentence; 404: the no-longer-shared sentence |
| Checklist change | checkbox disabled until the reply | checklist sentences | `Give the item some text.` | 403: as Save card |
| Upload | row `Uploading <filename>…` with a progress indicator | the row becomes the attachment link and the confirmation sentence is announced | `<filename> is too large. Files can be up to 10,000,000 bytes.` / `<filename> isn't a PDF, JPEG or PNG.` / `<filename> has a name that can't be stored.`; the row is removed | `Couldn't attach <filename>. Attachments are unavailable right now.`; the row is removed |
| Download | — | the browser saves the file | — | `Couldn't open <filename>. Attachments are unavailable right now.` in Notices |
| Delete card or attachment | button reads `Deleting…` | the card or row disappears | — | `Couldn't delete while attachments are unavailable. Try again shortly.` in Notices |
| Role change, removal, visibility | menu item disabled until the reply | the table and radio update | — | last admin: `A board needs at least one admin.` in the settings dialog's `alert` |

**Landing after creating (DP-08).**
- When the create-board request succeeds, the dialog closes and the browser adds a history entry for `/boards/<newBoardId>`.
- The board name shows as `heading level 2`, and the drawer link for the new board is marked as the current page.
- The board area shows the no-lists-yet copy, with focus on `Add a list`. Reloading or opening that address directly shows the same screen.
- A newly created list appears at the end, and focus moves to its `Add a card to <list name>` button. Below 1200 pixels its tab becomes the selected tab, and the address follows the rules below.

**Board re-reads (DP-48, DP-60).** The open board re-reads itself:
- at least once every 60 seconds of page time, for due labels
- on every remote event
- on `live.resumed`
- on `access.changed` to a role that can still edit

A re-read never discards any of the following:
- an open card dialog and the values of every field the person changed but has not saved
- the field holding the caret
- the selected list
- focus
- every undismissed notice

Dialog fields the person has not changed take the server's values. A lifted card stays lifted unless the re-read moves or removes it. When it does, the lift is cancelled with the matching cancel sentence from the announcements table. The only re-read that discards drafts is the demotion to observer described under Interactions.

**Address rules (DP-49).**
- Below 1200 pixels the selected list is in the address as `/boards/<boardId>?list=<listId>`. Changing the tab replaces the current history entry; it does not add one.
- Reloading or opening such an address shows that list selected. A `list` that names an unknown list or a list on another board falls back to the first list, and the address is rewritten without `list`. At 1200 pixels and wider, `list` stays in the address and changes nothing.
- Opening a card from the board adds a history entry for `/cards/<cardId>`. Browser Back closes the dialog, returns to the board address it was opened from (including its `list`) and puts focus on that card's button. Forward reopens the dialog. Closing with `Close` or Escape does the same as Back.
- When the page was loaded directly at `/cards/<cardId>`, the card's list is selected underneath it. Closing then replaces the address with `/boards/<boardId>?list=<the card's listId>`.

**Fixed copy:**
- Empty list: `Nothing here yet. Add a card when something needs doing.`
- Board with no lists: `This board has no lists yet. Add a list to get started.`
- List count: `<count> cards`, `1 card` or `0 cards`, from the server's `count`.
- Drawer count next to each board link: `<count> open`, `1 open` or `0 open`, from that board's `openCards`. The counts refresh when the open board re-reads, when it receives a card event, and after the person's own action (DP-51).
- Card not found (missing, hidden, private or another workspace's card): heading `We couldn't find that card`, body `It may have been archived, or it isn't shared with you.`
- Board not found (missing, hidden, removed or another workspace's board): heading `We couldn't find that board`, body `It may have been made private, or it isn't shared with you.`
- Access changed while open: `Your access to this board is now <role>.` in Notices.
- Live relay down, in `status "Service status"`: `Live updates are paused. Your changes still save, but others' changes won't appear until live updates are back.`
- File storage down, in `status "Service status"`: `Attachments are unavailable right now. Cards, moves and checklists still work.`
- Due labels on cards: `Due today` and `Overdue`, shown only from the card's `dueState`.

Banners appear within 5 seconds of a service going down while a board is open, and clear within 10 seconds of it coming back. An unexpected error shows the action's own refusal copy above, or `Something went wrong. Try again.` in Notices when the action has none. No banner, notice or announcement ever adds detail from the server (DP-58).

**Dates (DP-60).** Every device clock and time zone may be wrong. The browser never works out a due label or a date from the device's clock or time zone. `textbox "Due date"` holds the stored `YYYY-MM-DD` value exactly, and Save sends that value unchanged, in any device time zone.

## Backend

### API (DP-04, DP-05, DP-06, DP-07, DP-08, DP-09, DP-11, DP-14, DP-15, DP-16, DP-17, DP-18, DP-19, DP-20, DP-21, DP-23, DP-25, DP-30, DP-36, DP-37, DP-38, DP-50, DP-51, DP-55, DP-57, DP-58)

All requests and responses are `application/json; charset=utf-8`, with three exceptions: uploads (`multipart/form-data`), downloads (the stored type) and the event stream (`text/event-stream`). Authentication uses the cookie `kinfold_session`, which is HttpOnly and SameSite=Lax with path `/`. Ids are opaque strings.

**Published request keys (DP-50).**
- Every JSON endpoint accepts only the request keys printed in its row; `?` marks an optional key.
- Any other top-level key answers 422 `validation`, with one `fields` entry for each unknown key, named by that key. This applies whatever the key's value is, even another workspace's id.
- A refused request changes nothing, writes no permission-log entry and sends no event.
- A PATCH that carries none of its optional keys answers 422 on `body`.

For example, all of the following answer 422 on the extra key: `workspaceId` on `PATCH /api/boards/<id>`, `position`, `listId` or `status` on `PATCH /api/cards/<id>`, `email` on `PATCH /api/workspaces/<id>/members/<userId>`, and `version` on `POST /api/lists/<id>/cards`.

**Error catalogue.** Every error has the shape `{"error":"<code>"}`, plus any extra keys listed here.

| Status | Body |
|---|---|
| 401 | `{"error":"signed_out"}` |
| 401 | `{"error":"invalid_credentials"}` (sign-in only) |
| 403 | `{"error":"forbidden"}` |
| 403 | `{"error":"cross_origin"}` |
| 404 | `{"error":"not_found"}`, byte-identical for every reason |
| 405 | `{"error":"method_not_allowed"}` with header `Allow` |
| 409 | `{"error":"stale","card":<card>,"changedBy":{"displayName":"<name>"},"change":"moved"\|"edited"}` |
| 409 | `{"error":"invalid_transition","from":"<status>","to":"<status>"}` |
| 409 | `{"error":"archived"}` |
| 409 | `{"error":"last_admin"}` |
| 409 | `{"error":"already_member"}` |
| 409 | `{"error":"no_change"}` |
| 409 | `{"error":"email_taken"}` |
| 409 | `{"error":"idempotency_conflict"}` |
| 413 | `{"error":"too_large"}` |
| 415 | `{"error":"unsupported_media_type"}` |
| 422 | `{"error":"validation","fields":{"<field>":"<message>"}}`; the keys are request field names, and the messages are free text that never echoes server internals |
| 500 | `{"error":"internal"}` for every unexpected failure |
| 503 | `{"error":"storage_unavailable"}` |

**Error precedence.** One rule covers the whole API, and the first failing step answers:
1. Server boundary checks: 413, 415 (including an upload whose bytes don't match its declared type) and `cross_origin`.
2. Missing or ended session: 401.
3. A method the path does not support: 405.
4. An idempotent replay returns its stored response.
5. Not found: an unknown or malformed id, another workspace's resource, a hidden board or card, or a hidden or other-workspace id among the published id keys (`toListId`, `userId`, `userIds`, `ownerUserId`): 404.
6. Insufficient role: 403.
7. State conflicts: 409.
8. Validation, including unknown keys and malformed JSON: 422.
9. Unreachable file storage: 503.

**Payload shapes by role.** These are the exact keys, with nothing extra.

Card for an observer: `id, boardId, listId, title, position, labels, dueDate, dueState, status, version, owner, checklist`.
- `owner` is `{"displayName","initials","colour"}` or null.
- `checklist` is `[{"id","text","done"}]`, in order.

Card for a member or admin: the observer keys plus `notes, isPrivate, privateMembers, attachments`.
- `owner` also carries `userId`.
- `privateMembers` is `[{"userId","displayName"}]`, sorted by display name, and empty for a shared card.
- `attachments` is `[{"id","filename","contentType","size","uploadedAt","uploadedBy":{"displayName"}}]`.

Card field values:
- `position` is the 1-based place among the cards in the list that the caller can see. It is null for archived cards.
- `dueDate` is `YYYY-MM-DD` or null.
- `dueState` is `"overdue"`, `"due_today"`, `"upcoming"` or null.
- `labels` is a subset of `Medication`, `Appointment`, `Bills`, `Visit`, `Paperwork`, in that order.
- `status` is `"open"`, `"done"` or `"archived"`.
- Times are ISO 8601 UTC.

People:
- **Board member:** for an observer caller, `displayName, initials, colour`. For a member caller, those plus `userId, role, phone`. For an admin caller, those plus `email`.
- **Workspace person:** for a non-admin, `displayName, initials, colour`. For a workspace admin, those plus `userId, role, email, phone`.
- `colour` is one of `sage`, `clay`, `plum`, `ochre`, `slate` or `rose`.
- `initials` are the uppercased first letters of the display name's first and last words, or a single letter for a one-word name.

**Sessions and account**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `POST /api/session` | `{"email","password","next"?}` | 200 `{"user":{"userId","displayName","initials","colour"},"redirectTo":"<path>"}` and sets the cookie | 401 `invalid_credentials`, 422 |
| `DELETE /api/session` | — | 204; ends this session only | |
| `GET /api/me` | — | 200 `{"userId","displayName","initials","colour","email","workspaces":[{"id","name","parentName","timeZone","role"}]}` | |
| `POST /api/account/password` | `{"currentPassword","newPassword"}` | 200 `{"signedOutSessions":<count of other sessions ended>}` | 422 (`currentPassword` wrong; `newPassword` outside 12 to 200 characters inclusive) |
| `GET /api/service-status` | — | 200 `{"live":"up"\|"paused","storage":"up"\|"down"}` | |

**Workspaces.** The caller must be a current workspace member; otherwise the answer is 404.

| Method and path | Who | Request | Success | Own errors |
|---|---|---|---|---|
| `GET /api/workspaces/<id>` | any member | — | 200 `{"id","name","parentName","timeZone","role"}` | |
| `PATCH /api/workspaces/<id>` | admin | `{"timeZone"}` (an IANA zone name) | 200, same shape | 422 |
| `GET /api/workspaces/<id>/members` | any member | — | 200 `{"members":[<workspace person>]}` sorted by display name | |
| `POST /api/workspaces/<id>/members` | admin | `{"displayName" (1–60),"email","phone"? (up to 30),"password" (12–200),"role":"admin"\|"member"}` | 201 `{"member":<workspace person>}`; the server assigns initials and the next colour after the colour of the most recently added person in that same workspace, in the order sage, clay, plum, ochre, slate, rose, wrapping round. Seeded people count as added in the order of the seed table. For example, with the seed data at start, the first person added to "Hale family" gets rose, because Theo Marsh, slate, is the last person seeded there | 409 `email_taken`, 422 |
| `PATCH /api/workspaces/<id>/members/<userId>` | admin | `{"role"}` | 200 `{"member":<workspace person>}`; changes only the role | 409 `no_change`, `last_admin`; 422 |
| `DELETE /api/workspaces/<id>/members/<userId>` | admin | — | 204 | 409 `last_admin` |
| `GET /api/workspaces/<id>/boards` | any member | — | 200 `{"boards":[{"id","name","visibility","role","openCards"}]}` sorted by name; only boards the caller can see | |
| `POST /api/workspaces/<id>/boards` | admin | `{"name" (1–60 after trimming),"visibility":"workspace"\|"private"}` | 201 `{"board":{"id","name","visibility"}}`; the creator becomes the board's admin | 422 |
| `GET /api/workspaces/<id>/search?q=<text>` | any member | `q`, 2 to 100 code points inclusive | 200 `{"results":[{"cardId","boardId","boardName","listName","title"}],"total":<all matches>}`, with at most 50 results | 422 on `q` |
| `GET /api/workspaces/<id>/permission-log` | admin | — | 200 `{"entries":[<entry>]}`, newest first | 403 |
| `GET /api/workspaces/<id>/permission-log/<entryId>` | admin | — | 200 `{"entry":<entry>}` | 403 |

The permission-log paths support only GET; every other method answers 405 with `Allow: GET`.

`openCards` is the number of cards with status `open` on that board that the caller can see.

A permission-log entry is `{"id","at","actor":{"userId","displayName"},"action","target":{"type":"user"|"board"|"card","id","label"},"board":{"id","name"}|null,"before","after"}`. The rules for `label` and `board.name` are in Business rules.

**Boards and lists.** A board the caller cannot see answers 404.

| Method and path | Who | Request | Success | Own errors |
|---|---|---|---|---|
| `GET /api/boards/<id>` | any role | — | 200 `{"board":{"id","name","visibility","workspaceId","parentName"},"role","lists":[{"id","name","count","cards":[<card>]}]}`, with lists in order and cards by position | |
| `PATCH /api/boards/<id>` | admin | `{"name"?,"visibility"?}` | 200 `{"board":{"id","name","visibility"}}` | 409 `no_change`; 422 |
| `GET /api/boards/<id>/members` | any role | — | 200 `{"members":[<board member>]}`: current observer, member and admin rows, sorted by display name | |
| `GET /api/boards/<id>/candidates` | admin | — | 200 `{"people":[{"userId","displayName"}]}`, sorted by display name | |
| `POST /api/boards/<id>/members` | admin | `{"userId","role"}` | 201 `{"member":<board member>}` | 409 `already_member`; 422 |
| `PATCH /api/boards/<id>/members/<userId>` | admin | `{"role"}` | 200 `{"member":<board member>}` | 409 `no_change`, `last_admin`; 422 |
| `DELETE /api/boards/<id>/members/<userId>` | admin | — | 204 | 409 `last_admin`, `no_change` (already removed) |
| `POST /api/boards/<id>/lists` | admin | `{"name"}` (1–40 after trimming) | 201 `{"list":{"id","name","count":0,"cards":[]}}`, added at the end | 422 |
| `PATCH /api/lists/<id>` | admin | `{"name"}` | 200 `{"list":{"id","name"}}` | 422 |
| `GET /api/boards/<id>/archived` | member, admin | — | 200 `{"cards":[<card>]}`, newest archived first | 403 |
| `GET /api/boards/<id>/events` | any role | — | 200 event stream (described below) | |

**Cards.** Every reply with `counts` lists `[{"listId","count"}]` for the lists touched. `count` is the number of non-archived cards in the list that the caller can see. `openCards` is the caller's open-card count for the board.

| Method and path | Who | Request | Success | Own errors |
|---|---|---|---|---|
| `POST /api/lists/<id>/cards` | member, admin | `{"title"}`, with optional header `Idempotency-Key` (1–100 characters) | 201 `{"card":<card>,"counts","openCards"}`; the card goes last | 409 `idempotency_conflict`; 422 |
| `GET /api/cards/<id>` | any role that can see it (archived cards: member, admin) | — | 200 `{"card":<card>}` | |
| `PATCH /api/cards/<id>` | member, admin | `{"version","title"? (1–120 after trimming),"notes"? (up to 4,000 characters),"dueDate"? (date or null),"labels"?,"ownerUserId"? (or null)}` | 200 `{"card":<card>}` | 409 `archived`, `stale`; 422 |
| `POST /api/cards/<id>/move` | member, admin | `{"toListId","position","version"}` | 200 `{"card":<card>,"counts","openCards"}` | 409 `archived`, `stale`; 422 `position` |
| `POST /api/cards/<id>/status` | member, admin | `{"status","version"}` | 200 `{"card":<card>,"counts","openCards"}` | 409 `invalid_transition`, `stale`; 422 |
| `PUT /api/cards/<id>/private-members` | member, admin who can see the card | `{"userIds":[…]}` (an empty list makes the card shared) | 200 `{"card":<card>}` | 409 `no_change`; 422 `userIds` |
| `DELETE /api/cards/<id>` | admin | — | 204 | 503 |
| `POST /api/cards/<id>/checklist` | member, admin | `{"text"}` (1–200) | 201 `{"item":{"id","text","done"}}` | 409 `archived`; 422 |
| `PATCH /api/checklist-items/<id>` | member, admin | `{"text"?,"done"?}` | 200 `{"item":{"id","text","done"}}` | 409 `archived`; 422 |
| `DELETE /api/checklist-items/<id>` | member, admin | — | 204 | 409 `archived` |
| `POST /api/cards/<id>/attachments` | member, admin | a multipart field `file`, declared as `application/pdf`, `image/jpeg` or `image/png`, with a file name of 1 to 200 code points | 201 `{"attachment":{…}}`, sent once storage confirms | 409 `archived`; 413; 415; 422 on `file`; 503 |
| `GET /api/attachments/<id>` | member, admin who can see its card | — | 200 with the exact stored bytes, the stored `Content-Type`, `Content-Length`, `X-Content-Type-Options: nosniff` and the `Content-Disposition` from Business rules | 503 |
| `DELETE /api/attachments/<id>` | member, admin | — | 204 | 503 |

Attachments are not part of an observer's view, so observers get 404 on every attachment route.

**Event stream** (`GET /api/boards/<id>/events`). Each event is an `event: <type>` line followed by a `data: <json>` line. The stream sends a comment line at least every 15 seconds. Every payload is shaped for its recipient: role fields, the positions they can see and their own counts.

| Type | Data |
|---|---|
| `card.created` | `{"card","counts"}` (also sent when a card becomes visible to the recipient) |
| `card.updated` | `{"card"}` (edits, renames, checklist changes, status changes, and privacy changes that keep the card visible) |
| `card.moved` | `{"card","from":{"listId","position"},"to":{"listId","position"},"mover":{"displayName","initials","colour"},"counts"}` |
| `card.removed` | `{"cardId","counts"}` (archived, deleted, or no longer visible to the recipient) |
| `list.created`, `list.updated` | `{"list":{"id","name"}}` |
| `board.updated` | `{"board":{"id","name","visibility"}}` |
| `access.changed` | `{"role":"observer"\|"member"\|"admin"\|null}`; the server then closes the stream |
| `session.ended` | `{}`; the server then closes the stream |
| `live.paused`, `live.resumed` | exactly `{}` |

### Business rules (DP-05, DP-06, DP-07, DP-09, DP-10, DP-11, DP-12, DP-15, DP-16, DP-17, DP-19, DP-20, DP-21, DP-22, DP-25, DP-29, DP-30, DP-38, DP-53, DP-55, DP-56, DP-57)

**Signed-out redirect and safe return path.**
- When an API request answers 401, or a page route other than `/signin` is opened without a live session, the browser goes to `/signin?next=<path and query of the page it was on>`. The value is percent-encoded as a query value, so a slash becomes `%2F`.
- When that page was `/`, the browser goes to plain `/signin`. A deliberate sign-out also goes to `/signin` with no `next`.
- The sign-in page sends its `next` value, after the normal single decoding, in the sign-in request. The value survives a failed attempt.
- `redirectTo` is that value only when all four of these hold:
  - it starts with exactly one `/`, and its second character is neither `/` nor `\`
  - it contains no `\` anywhere
  - it contains no control characters (code points 0 to 31 and 127)
  - it is at most 2,000 characters long
- In every other case `redirectTo` is `/`. This includes a missing `next` and any value carrying a scheme or a host.
- If `redirectTo` names a card or board the person can no longer see, they land there and see the matching not-found state; they are not sent to `/`.

**Effective board access.** A person must be a current member of the board's workspace; otherwise they have no access. Their board membership state is none (no record), observer, member, admin or removed.

| Membership state | Board visible to the workspace | Private board |
|---|---|---|
| none | observer | no access |
| observer / member / admin | that role | that role |
| removed | no access | no access |

No access means three things:
- every board, list, card, attachment, member, candidate, archive and stream route answers 404
- the board is left out of board lists, search and counts (DP-15)
- the board's name never reaches that person by any route (DP-56)

What each role may do:
- **Observers** only read.
- **Members** create, edit, move and change the status of cards, and manage checklists, private members and attachments.
- **Board admins** can also change the board, its lists and its memberships, and can delete cards.
- **Workspace admins** manage workspace people, the time zone, board creation and the permission log. This gives them no extra board rights.

**Board membership state machine.**
- **Add:** none → observer, member or admin.
- **Change role:** observer, member or admin → either of the other two.
- **Remove:** any state, including none, → removed. Removing a person in state none from a workspace-visible board takes away their implicit observer view.
- **Add again:** removed → observer, member or admin.

Rejections:
- Adding someone who already holds a role answers `already_member`.
- Setting the role a person already holds, or removing someone already removed, answers `no_change`.
- A change that would leave a board with no admin, whether by demotion, removal or workspace removal, answers `last_admin` and changes nothing.
- A `userId` that is not a current member of the board's workspace answers 404.
- A `role` other than `observer`, `member` or `admin` answers 422 on `role`.

**Candidates.** A board's candidates are the current members of its workspace who hold no current observer, member or admin role on it. This includes people with no record and people previously removed. For example, with the seed data at start, the only candidate for "Weekly care" is Theo Marsh.

**Card owners.** The owner must be a current member or admin of the card's board.
- An `ownerUserId` outside the board's workspace answers 404.
- An `ownerUserId` in the workspace who is not a member or admin of the board answers 422 on `ownerUserId`.

**Workspace roles.** The workspace roles are admin and member.
- Removing a workspace person moves every board membership they hold in that workspace to removed. This writes one log entry per board plus the workspace entry.
- The removal is refused with `last_admin` if the person is the workspace's only admin or the only admin of any board.
- A workspace always keeps at least one admin.

**Permission log.** Each of the following changes writes exactly one entry, in the same database transaction as the change itself:
- `workspace.member_added` (before null, after the role)
- `workspace.role_changed`
- `workspace.member_removed` (after null)
- `board.member_added` (before `"none"` or `"removed"`, after the role). This is also written for the board's creator, so the entry exists by the time the create-board reply is sent.
- `board.role_changed`
- `board.member_removed` (after `"removed"`)
- `board.visibility_changed` (`"workspace"` / `"private"`)
- `card.private_members_changed` (before and after are sorted lists of display names; an empty list means shared)

`board` is null for workspace actions. `target.label` is the person's display name, the board's name or the card's title, with two exceptions decided for the reader at read time:
- For a reader who cannot currently see the card, a card target's label reads `Private card`.
- For a reader who cannot currently see the board, a board target's label and `board.name` read `Private board`.

`before` and `after` are never altered. Nothing in the app updates or deletes an entry.

**Access changes take effect immediately.**
- Roles, memberships, visibility and sessions are checked on every request and never cached for the session. The next request after a change is answered with the new rights (DP-12).
- Every open event stream affected by a change gets `access.changed`, or `card.removed` for cards that left its view.
- A stream whose access changed is closed within 2 seconds of the change. This holds on whichever worker holds the stream, including while the live relay is down.

**Sessions.**
- Signing in creates a new session. Signing out ends only the current session.
- A password change keeps the calling session and ends every other session of that account at once.
- An ended session's next request answers 401 `signed_out`. Its open streams get `session.ended` and close within 2 seconds.

**Private cards.**
- A card is private when its private member list is not empty. It is then visible only to the listed people who hold member or admin rights on the board. Observers never see private cards.
- Only people who can see a private card may change its list. Any member or admin may set the list of a shared card.
- Every person named must be a current member or admin of the board; otherwise the answer is 422 on `userIds`. A non-empty list must include the caller; otherwise the answer is 422.
- Hidden private cards are left out of other people's lists, list counts, positions, `openCards`, search, events and archived lists, and their ids answer 404 (DP-15).
- When someone is demoted to observer, the private cards they were named on leave their view.

**Hidden cards never reach copies (DP-56).**
- When a card leaves a recipient's view, that recipient gets only `card.removed`. They never first get a `card.updated` carrying its new title, its private members or its notes. Later changes to the hidden card send them nothing.
- Visibility is checked against the card's current state before the version. A move, save, status, checklist or attachment write on a card hidden from the caller answers the byte-identical 404, never a 409 carrying `card`.

**Card status.**
- The legal edges are open → done, done → open, open → archived, done → archived, and archived → open. The last one is a restore, which places the card last in its list.
- Every other request answers `invalid_transition`, including archived → done and setting the current status.
- Archived cards cannot be moved or edited, and their checklists and attachments cannot be changed (`archived`). Archiving keeps attachments.

**Versions, stale writes and the winner rule (DP-20, DP-29, DP-53).**
- Every card starts at version 1. Each successful edit, move or status change adds 1. Checklist, privacy and attachment changes do not change the version.
- A write whose `version` is not the current one is rejected with `stale`, even when it touches fields the winning write left alone. Fields are never merged.
- The stale reply carries the card's current state and the display name of whoever made the latest versioned change. `change` is `"moved"` if that change was a move, otherwise `"edited"`.
- Of any number of simultaneous writes to one card at the same version, sent to either worker, exactly one succeeds. Every other one gets `stale`, naming the winner and the winner's `change`.
- Simultaneous moves of different cards into the same list all succeed. Afterwards the order is dense and unique, and so are every viewer's positions.

**Ranks and moves.**
- The server keeps each list's non-archived cards in one dense, unique order 1..N, counting every card whether or not a given viewer can see it.
- `toListId` must be a list on the card's own board; otherwise the answer is 404.
- `position` must be a whole number from 1 to the number of cards in the target list that the caller can see (not counting the moving card) plus 1. Anything else answers 422 on `position`.
- The card goes immediately before the visible card that holds that position. If the position is past the last visible card, the card goes after the list's last card.
- Archiving, deleting or moving a card out of a list closes the gap it leaves.

**Idempotent card creation.**
- Keys are scoped to the person and kept indefinitely.
- Repeating a request with the same key, list and title replays the stored 201 response with the header `Idempotent-Replay: true`, even if the card has changed since, and creates nothing.
- The same key with a different list or title answers `idempotency_conflict`.
- Simultaneous requests with one key create exactly one card.

**Due state (DP-22, DP-60).**
- The server decides the due state from the current date in the workspace's time zone at request time. It is `due_today` when the due date is today, `overdue` when it is earlier and `upcoming` when it is later.
- It is null when there is no due date, or when the card is done or archived.
- A time-zone change applies from the next read. Open boards show it at their next minute re-read, with no reload.

**Search (DP-17, DP-18, DP-57).**
- Search finds cards whose title contains the text. On boards where the caller is a member or admin, it also searches notes.
- Every character matches only itself; `%`, `_` and `\` are not special.
- Matching ignores case for every Unicode letter, so `ÉCHO` matches `Écho cardiaque`.
- `q` is counted in Unicode code points and must be 2 to 100 inclusive.
- Search covers only boards and cards the caller can see in that workspace, and leaves out archived cards.
- Results are ordered by board name, then list order, then position. A reply carries at most 50 results and `total`, the number of all matches.
- Candidate pickers, member lists and counts follow the same scope.

**Live events.** While the relay is up, every change listed under the event stream is delivered within 2 seconds to every open stream of the board on both workers (DP-30). While the relay is down, streams stay open and get `live.paused`, and changes still save. `live.resumed` follows once the relay is back.

**Attachments (DP-36, DP-38, DP-55).**
- **Content check.** The uploaded bytes must start with the signature of the declared type:
  - PDF: the five characters `%PDF-`
  - JPEG: the bytes FF D8 FF
  - PNG: the bytes 89 50 4E 47 0D 0A 1A 0A

  A mismatch, or any declared type outside those three, answers 415, and nothing is written to storage.
- **File names.** A name containing a control character (code points 0 to 31 or 127), or one outside 1 to 200 code points, answers 422 on `file`. The attachment list shows the name exactly as uploaded.
- **Download header.** For a name made only of printable ASCII (code points 32 to 126) with no `"` and no `\`, `Content-Disposition` is exactly `attachment; filename="<filename>"`. Otherwise it is `attachment; filename="<fallback>"; filename*=UTF-8''<encoded>`:
  - `<fallback>` is the name with each non-ASCII character, `"` and `\` replaced by `_`.
  - `<encoded>` is the name's UTF-8 bytes, with every byte other than ASCII letters, digits and ``!#$&+-.^_`|~`` written as `%` followed by two uppercase hex digits.
  - For example, `Entlassung Müller "final".pdf` downloads with `attachment; filename="Entlassung M_ller _final_.pdf"; filename*=UTF-8''Entlassung%20M%C3%BCller%20%22final%22.pdf`.
- **Confirmation.** The upload's 201 is sent only after storage has accepted the object and reading back its stored size matches the upload. Only then is the attachment recorded. If storage fails at any step, nothing is recorded, any partial object is removed where possible, and the answer is 503.
- **Deletion.** Deleting an attachment removes its object before its record. Deleting a card removes all its objects first, then the card. While storage is unreachable, either deletion is refused with 503 and nothing changes. A card with no attachments deletes normally during a storage outage.

### Services (DP-30, DP-36, DP-37, DP-38, DP-39, DP-40, DP-41)

**PostgreSQL** (`DATABASE_URL`) is the system of record.
- It holds accounts, sessions, workspaces, boards, lists, cards with ranks and versions, checklists, memberships, private-card member lists, idempotency keys, attachment records and the permission log.
- Apply the schema and seed on every serve start. This step must be idempotent and safe when several instances start at once against the same database.

**MinIO** (`S3_*`) stores each attachment byte for byte in the provided private bucket.
- Object keys are `attachments/<workspaceId>/<cardId>/<attachmentId>`, stored with the uploaded content type.
- Do not create, reconfigure or open up the bucket. Never give the browser a storage URL; downloads go only through `GET /api/attachments/<id>`.
- While storage is unreachable:
  - uploads, downloads and deletions that touch objects answer 503 `storage_unavailable`
  - within 5 seconds, `GET /api/service-status` reports `"storage":"down"` and the storage banner shows
  - everything else keeps working
- Within 10 seconds of storage returning, the status reports `"up"` and the banner clears without a reload.

**Valkey** (`VALKEY_URL`) relays events between the two workers.
- Board events go on the channel `kinfold:board:<boardId>`, and access and session events on `kinfold:user:<userId>`. Valkey never holds the only copy of any data.
- While Valkey is unreachable:
  - `"live":"paused"` is reported within 5 seconds
  - open streams get `live.paused` and boards show the paused banner
  - the app retries the connection on its own at least every 5 seconds
- Within 10 seconds of Valkey returning, streams get `live.resumed`. Open boards re-read their state while keeping unsaved work (DP-48), announce the live-back sentence and clear the banner.

### Seed data (DP-05, DP-08, DP-15, DP-16, DP-17, DP-18, DP-34, DP-51)

Every person, family and organisation below is invented. Seed only when the database has no workspaces. Seeded people are added to their workspace in the order of the table below. Every seeded card is open, at version 1, with no due date and no attachments.

| Display name | Email | Password | Phone | Colour | Initials |
|---|---|---|---|---|---|
| Ruth Hale | `ruth@kinfold.test` | `Kinfold-ruth-2026` | `+1 312 555 0140` | sage | RH |
| Sam Hale | `sam@kinfold.test` | `Kinfold-sam-2026` | `+1 312 555 0141` | clay | SH |
| Priya Hale | `priya@kinfold.test` | `Kinfold-priya-2026` | `+1 312 555 0142` | plum | PH |
| Dolores Vance | `dolores@kinfold.test` | `Kinfold-dolores-2026` | `+1 312 555 0143` | ochre | DV |
| Theo Marsh | `theo@kinfold.test` | `Kinfold-theo-2026` | `+1 312 555 0144` | slate | TM |
| Grace Ng | `grace@kinfold.test` | `Kinfold-grace-2026` | `+1 206 555 0150` | rose | GN |

**Workspace "Hale family"**: parent name `Margaret Hale`, time zone `America/Chicago`. Ruth is admin; Sam, Priya, Dolores and Theo are members.

Board **"Weekly care"** is visible to the workspace. Ruth is admin, Sam and Priya are members, and Dolores is an observer. Theo has no membership, so he is an implicit observer. Its lists, in order:
1. **Inbox**
   - "Refill lisinopril": Medication; owner Ruth; notes `10 mg once a day. Pharmacy closes at 6 pm on Saturdays.`
   - "Call about hearing aid batteries": owner Sam
   - "Book podiatry follow-up": Appointment
2. **Pharmacy**
   - "Pick up eye drops": Medication; owner Priya
   - "Ask about a weekly pill organiser": Medication
   - "Move metformin to mail order": Medication; notes `Member ID is on the insurance card scan.`
3. **Appointments**
   - "Ride to cardiology on Thursday": Appointment; owner Sam; notes `Dr. Feld, second floor. Bring the medication list.`
   - "Memory clinic results": private to Ruth and Priya; notes `Discuss results with Mum before telling Sam.`
   - "Dental cleaning": Appointment
4. **Aide visits**
   - "Tuesday visit": Visit; checklist `Lunch and fluids`, `Evening pills set out`, `Short walk to the mailbox`, none ticked
   - "Friday visit": Visit; checklist `Change bed linen`, `Groceries from the list`, none ticked
5. **Waiting on others**: empty.

Board **"Money and house"** is private. Ruth is admin; Sam and Priya are members. Its lists, in order:
1. **Bills**
   - "Pay Medicare Part B premium": Bills; owner Ruth
   - "Renew home insurance": Bills
2. **House**
   - "Fix the back step railing": owner Sam
   - "Talk to an estate agent": private to Ruth and Priya
3. **Documents**
   - "Insurance card scan": Paperwork; notes `Attach the front and back.`

**Workspace "Ng family"**: parent name `Walter Ng`, time zone `America/Los_Angeles`. Grace is admin. Board **"Dad's week"** is visible to the workspace, with Grace as admin. It has one list, **To do**, holding the card "Call Dr. Ito's office".

The permission log starts empty.

For example, with the seed data at start:
- Ruth sees Appointments with 3 cards and Sam sees it with 2. Ruth moving "Refill lisinopril" to Pharmacy position 2 makes it position 2 of 4.
- Ruth's drawer reads `11 open` for "Weekly care" and `5 open` for "Money and house". Sam's reads `10 open` and `4 open`. Dolores's reads `10 open` for "Weekly care" and has no "Money and house" link.
- A search for "refill" settles on `1 card matches "refill".`. A search for "discuss" gives Ruth `1 card matches "discuss".` and gives Sam `No cards match "discuss".`.

## Technical requirements

### Deployment (DP-01, DP-02)

Node.js 22 with npm is available. Write the app in TypeScript and compile it in the build step. `/app/run.json` holds the string commands `install`, `build` and `serve` together with the schema tag. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run serve"}
```

- **Listening:** `serve` listens on `0.0.0.0`, on the port in `APP_PUBLIC_PORT`, defaulting to 4173.
- **Workers:** it runs exactly two web worker processes that share that port. Fresh connections are spread between them, so both workers answer within any 20 new connections.
- **Worker header:** every HTTP response carries the header `X-Kinfold-Worker` with the value `1` or `2`, naming the worker that answered.
- **Health check:** `GET /api/health` needs no session. It answers HTTP 200 `{"status":"ok"}` once the app is serving, whether or not MinIO or Valkey can be reached.

### Configuration and secrets (DP-03)

Read every setting from the environment at start: `DATABASE_URL`; `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`; `VALKEY_URL`; `APP_PUBLIC_PORT`.
- Never hard-code a credential, URL or bucket name.
- Never put any of these values in built browser assets or in any response.
- Store passwords only as salted, slow hashes.
- Session tokens are random values of at least 128 bits.

### Server boundary (DP-04, DP-41, DP-54, DP-58)

**Origins and requests.**
- **Same origin only.** The browser calls only the app's own origin, and the app serves its own fonts, icons and scripts.
- **Cross-origin writes.** A state-changing request (POST, PUT, PATCH or DELETE) answers 403 `cross_origin` when its `Origin` header is present and names a host other than the request's `Host`.
- **Size limits.** These are checked before authentication. A JSON body may be up to 65,536 bytes, and an uploaded file up to 10,000,000 bytes; both limits are inclusive. Anything larger answers 413.
- **Content types.** A JSON endpoint called with any other content type answers 415. Malformed JSON answers 422 with field `body`.

**Caching and isolation.**
- **No caching.** Every API response, page response and event stream carries `Cache-Control: no-store`.
- **Request isolation.** Concurrent requests from different people never see each other's identity, workspace or data. Nothing about one request is kept where another request can read it.

**Never served.** Source files, source maps, `run.json`, `package.json`, lockfiles, `.env` files, dependency folders and anything outside the built browser assets. Such paths answer 404, as does any path containing `..`.

**Opaque errors.**
- No response body, header, event frame, banner or notice ever contains any of these:
  - a service host, address or port
  - a URL scheme of a backing service
  - a driver or system error name or code
  - a stack frame
  - an environment variable's name or value
- An unexpected failure answers 500 `{"error":"internal"}`.
- An id of any shape answers the byte-identical 404 when it matches nothing. Examples include ids that are not well formed, ids containing encoded control characters and ids 300 characters long.

**Boot.** PostgreSQL is required: the app retries it every second and starts listening once connected. A MinIO or Valkey that is unreachable, refuses the connection or is configured with an unusable address never stops boot. The app serves at once in the degraded states described in Services and recovers on its own when they come back, with no restart.

### Browser support and performance (DP-31, DP-42)

Support current Chromium, Firefox and Safari, with mouse, touch and keyboard, at 375x812, 768x1024 and 1280x800. With the seed data:
- a board is usable within three seconds of navigation
- a drop is confirmed and announced within one second
- while the live relay is up, a change made in one browser shows in another open browser within two seconds
- a search settles within half a second of the last keystroke

## Working rules

- IF-01: `/app/run.json` is a single JSON object with exactly the string keys `_schema` (value `run-manifest-v1`), `install`, `build` and `serve`.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` names every shipped package and every bundled font and icon set, each with its licence. Shipped packages are the production dependency tree from `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package, font and icon set is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1.
- IF-04: The app stores data only in PostgreSQL, MinIO and Valkey: no SQLite, no other datastore and no application data written to local disk.
- IF-05: The provided service configuration (compose files, environment names and the seeded dev credentials) is left unchanged.
- IF-06: All application source is TypeScript; plain JavaScript appears only in tool configuration files.
- IF-07: The browser loads no resource from any origin other than the app's own, so fonts and icons are bundled locally.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript with no `any` escapes. Names match this brief's domain terms: board, list, card, observer, member, admin, private members, candidates, permission log, mover.
- Each domain rule is decided in exactly one place in the source: effective board access, card status edges, the stale-version check, rank placement, response shaping per role, the published request keys, due state, the last-admin guard, the safe return-path check, the open-card count, the attachment content check and the download file-name header.
- Every error response is built through one error shape that matches the error catalogue; no endpoint builds its own variant, and no error path forwards an underlying error's message.
- Every access change and its permission-log entry are written in one database transaction, and no code path updates or deletes log entries.
- On the client, one place owns board state and merges re-reads into it, keeping drafts, notices, selection and focus. Each card's mover chip owns its own timer, and sign-out clears all of that state in one step.
- No abstraction has a single implementation, and nothing is dead, commented out or unreachable.
- There are no defensive checks for states the data model already rules out, and no features beyond this brief.
- Live fan-out, storage calls and their outage handling each sit behind one clear seam per service, with retry and recovery decided once.
