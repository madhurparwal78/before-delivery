# Lintelworks Lintel Drive

Lintel Drive is the company file drive for Lintelworks, a 60-person structural engineering consultancy in Tucson. It is also used by the firm's outside partners: architects, surveyors, subcontractors and client reviewers. Staff file, move, lock and share calculation packages, drawing sets and site photos in project folders. Outside partners see only what they were granted, and only until the date the grant ends. The server is the only judge of time. Grants end, editor access falls back to the parent folder's access, binned files are purged and folder handovers lapse on the server clock in the company's time zone, America/Phoenix. Every open screen hears about each change at once, with no email at all. The app uses three backend services. PostgreSQL is the system of record. MinIO object storage holds the file bytes. PocketBase is the people directory and handles sign-in. Out of scope: email of any kind, public or anonymous links, file versions and version restore, billing, self sign-up, deleting, renaming or moving folders, partners sharing with other partners, comments, and any datastore other than these three services.

## Problem and users

Today the practice shares work through a general cloud drive and guest access. Partners keep access for years after a job closes because nobody does the removal work. Timed editor access either lapses to nothing or quietly stays on as viewer access. Outside access to a folder can only be viewer access. Guests are locked out with no warning, and files that were taken away stay on a partner's open screen until they reload. The document controller spends every Friday on a manual access review. The principals carry the risk that a subcontractor builds from a superseded drawing set that is still visible to them. When two engineers move the same set at once, the team argues about where the issued set went.

Users:

- **Project engineer** (staff, daily). Files, moves and shares drawing and calculation sets across project folders by keyboard and by drag, and sees every move land in one agreed place.
- **Outside partner** (weekly). Views or edits only what was granted, until the date it ends, and is told in the app the moment it ends. A partner may sit in another time zone, for example Sydney.
- **Document controller** (staff, daily). Locks issued sets, hands folders to new owners, deletes binned files for good, and trusts that timed grants and the bin clean themselves up on time.
- **Office administrator** (staff, occasional). Schedules the bin retention period and the default partner grant length from an effective date, and watches company storage.

## Journeys

In these journeys `S` is the seed date defined in Seed data, and every journey starts from the seed state.

1. **Filing drawings.** Marisol Okafor (project engineer) signs in. Marisol opens 2614 Saguaro Medical Office › Drawings from the folder tree, which shows five drawings, two of them locked. Marisol tabs into the file list, which focuses the first drawing, and presses Shift and Down four times to select all five. Marisol presses Ctrl X, moves to Saguaro's Reports node in the tree and presses Ctrl V. The five rows dim. The three free drawings lift as name chips and fly to the Reports node. The two locked rows return to full strength with a Stayed badge. The Drawings count steps from 5 to 2 and the Reports count from 0 to 3. Marisol hears one announcement of the result. Dev Halvorsen, who has the same folder open in another tab, sees the same three chips fly from Dev's own rows.
2. **Two engineers, one file.** Marisol and Dev both have Saguaro › Calculations open. At the same moment Marisol moves Wind load summary.pdf to Reports and Dev moves it to Issued. Exactly one move wins. On the loser's screen, the chip flies to the winner's folder instead of the one the loser chose, and a notice names that folder and the person who moved it. Both screens end with the file in one folder and with matching counts.
3. **Uploading a calculation package.** Dev uploads a calculation package of several parts into 2631 Rillito Bridge Retrofit › Calculations, pauses it, reloads the page and resumes it from the last confirmed part. The file appears in the list, the folder count and the storage meter only once storage confirms the finished file, and Dev hears the finish announced once. If object storage is unreachable, the outage banner shows, new uploads are refused, an upload that was sending waits for storage while one Dev paused stays paused, and the preview pane says previews are unavailable. When storage comes back, the waiting upload carries on by itself.
4. **Timed access that ends on time.** Marisol opens Share on Saguaro › Site photos, picks Aiko Brandt by keyboard, chooses Editor and an end date, and sees the grant listed with its end date. Callum Reyes-Tran, a reviewer in Sydney, holds the seeded editor grant on Saguaro › Calculations ending `S`+14, and viewer access to the whole project until `S`+60. At Phoenix midnight after `S`+14, not Sydney midnight, Callum's open screen loses its edit actions and shows a notice that Callum can still view the folder. Rosa Tilden's seeded editor grant on Rillito › Reports, ending `S`+3, ends the same way with no parent access behind it. Rosa's open list empties, the open preview closes, and a download link Rosa's tab already holds is refused.
5. **Locking and live permission changes.** Ines Whitcombe (document controller) locks IFC Set 2026-10-01.pdf in Saguaro › Issued. Marisol then selects both files in Issued and moves them to Reports: the transmittal flies, and the IFC set stays with its Stayed badge. Ines lowers Aiko Brandt from editor to viewer on Saguaro › Drawings. Aiko's open screen loses Rename and Move to at once and shows a notice. Aiko's next write is refused. Ines deletes the binned site photo forever, and the storage meter drops on every open staff screen.
6. **Shortening the bin.** Tomas Achterberg (office administrator) schedules bin retention to change from 30 to 14 days, starting on a future date. Files binned before that date keep 30 days. Files binned on or after it get 14 days. Each bin row shows its days left and which rule applies.
7. **Handing a project over.** Marisol offers 2614 Saguaro Medical Office to Dev, open for seven days. Dev accepts it from Handovers, and both screens show Dev as owner. Separately, Dev's seeded offer of 2631 Rillito Bridge Retrofit to Marisol is left unanswered past its lapse date `S`+7. It lapses at Phoenix midnight, Rillito stays with Dev, and Dev is told in the app.
8. **A partner on a phone.** Aiko opens Lintel Drive on a 375 px wide phone. Aiko opens the navigation drawer, chooses a shared folder, long-presses a drawing to start a selection, and downloads it from the bottom action bar. The page never scrolls sideways.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health check** /app/run.json installs, builds and serves the app on the public port, and the health path answers ok while storage or the directory is down, as set out in Deployment.
- **DP-02 — Credentials from the environment** Every service URL and credential is read from the environment at start and is never hard-coded, logged or sent to the browser.
- **DP-03 — Schema and seed on every start** Each start applies the database schema, the bucket and the directory collection fields idempotently, and seeds an empty database exactly once with the records in Seed data.
- **DP-04 — Same-origin server boundary** The server enforces the body limits, content types, origin check, response headers and never-served paths in Server boundary.
- **DP-05 — Server clock in Phoenix time** The server publishes its clock and the company date in America/Phoenix and judges every expiry on that clock, and the clock-control instance can move it, as qualified in Business rules.
- **DP-06 — One error shape and order** Every error response uses the single JSON error shape and the check order stated at the top of API.
- **DP-07 — Drafting-table layout** At desktop width the signed-in screen has three panes separated by hairline rules with no shadows: a rail with the tree and meter, a path bar over the list, and a details panel with activity.
- **DP-08 — Blueprint palette and Plex type** The screen uses the warm paper ground, dark ink, one blueprint-blue accent, rust for warnings and the IBM Plex faces, sets every numeral in tabular mono, and meets WCAG 2.2 AA contrast.
- **DP-09 — Three viewports without sideways scroll** At 375x812, 768x1024 and 1280x800 every screen fits the viewport width with the pane arrangement given in Screens and layout.
- **DP-10 — Homing flight** After a move is acknowledged, name chips fly on a curved path from the moved rows to the destination with the timing, stagger, cap and count steps given in Motion and effects.
- **DP-11 — Reduced-motion homing** Under reduced motion no chip flies and nothing animates: moved rows leave at once and the destination shows a static plus badge until focus next moves.
- **DP-12 — One polite announcements region** Selection counts, move results, upload results and every other async result are announced once each, through the single polite status region, with the exact copy in Feedback states.
- **DP-13 — Live updates on every open screen** Every state change reaches every open screen allowed to see it within the delays in Business rules, updating lists, tree counts, activity and the meter without a reload.
- **DP-14 — Honest storage and time wiring** File bytes live only in object storage and people only in the directory, no browser code decides whether a grant, bin item, handover, link or upload has expired, and storage and directory health are re-probed on a timer so recovery needs no restart.
- **DP-15 — Sign in through the people directory** Email and password are checked against the directory, a server-side session cookie is set, and wrong credentials get the rejection in API.
- **DP-16 — Staff and partner capabilities** Each action is allowed only to the people listed for it in Business rules, and every other caller is refused with the status stated there.
- **DP-17 — People picker search** The share and handover pickers search the directory as the person types, work by keyboard as a combobox, and show each person's name, firm and kind.
- **DP-18 — Directory outage** While the directory is unreachable, sign-in and the pickers show the directory outage copy and the service status reads down, while existing sessions, access checks and grant changes keep working.
- **DP-19 — Folder tree with item counts** The rail tree shows every folder the person can see, each with a mono count of the live files directly inside it, always matching the API.
- **DP-20 — File list with sort, view and search** The centre shows the open folder as a list or a grid in any of the six sort orders, and search finds files by name across everything the person can see.
- **DP-21 — State kept in the address** The open folder, view, sort and search live in the address, so Back, reload and a copied address in a second tab show the same state.
- **DP-22 — Recent files** Recent lists the 50 most recently active live files the person can see, each with its current folder, and drops files that are binned or purged.
- **DP-23 — Keyboard folder tree and file list** The tree and list follow the key map in Interactions, including expand, collapse, typeahead, extending and toggling selection, cut, paste and Enter.
- **DP-24 — Details panel and activity ledger** The details panel shows the selected item's facts, its preview and its activity from the ledger, newest first, with mono Phoenix times.
- **DP-25 — Browse a project journey** A project engineer signs in, opens a project folder from the tree, switches to grid, sorts newest first, searches, opens a file's details, and gets the same state back after a reload.
- **DP-26 — Resumable multipart upload** Uploads run through server-tracked multipart sessions in fixed-size parts, and a paused upload resumes after a page reload from its last confirmed part.
- **DP-27 — Storage confirms every upload** A file's row, list entry, activity and bytes on the meter appear only after storage confirms the completed object, and cancelled or abandoned uploads leave no row and no object.
- **DP-28 — Pause, resume and cancel** Upload sessions follow the state machine in Business rules, and each illegal step gets its exact rejection.
- **DP-29 — Abandoned uploads expire** An upload left paused or idle for the configured period (24 hours by default) becomes expired on the server, and its parts are removed.
- **DP-30 — Storage meter** Staff see a company storage meter equal to the sum of confirmed object sizes, bin included, which changes only when an upload completes or a file is purged.
- **DP-31 — Upload journey** A project engineer uploads a multi-part file into a folder, pauses it, reloads, resumes, and sees the file land in the list, the folder count, the meter and the announcement together.
- **DP-32 — Uploads refused during a storage outage** While object storage is unreachable, the outage banner shows, the service status reads down, and starting an upload is refused with the storage outage copy while nothing is created.
- **DP-33 — Previews during a storage outage** While object storage is unreachable, previews and content links show the storage outage state while lists, details and activity keep working.
- **DP-34 — Move files with replay safety** A move takes a selection and a destination, moves the free files, reports locked and lost files, and returns the stored result when an idempotency key is repeated.
- **DP-35 — One winner for concurrent moves** When several people move the same file at once exactly one move wins, and every loser's response and screen show the winning folder.
- **DP-36 — Counts, ledger and meter move together** Each action changes folder counts, the activity ledger and the storage figures in one step, never one without the others.
- **DP-37 — Move to dialog** The Move to dialog offers a destination tree that works by keyboard, keeps Tab inside the dialog, closes on Escape and returns focus to its opener.
- **DP-38 — Cut, paste and drag journey** A project engineer moves a mixed selection by Ctrl X and Ctrl V, by dragging onto a tree node and by Move to, and a second open screen sees the same result.
- **DP-39 — Lock and unlock issued files** Document controllers lock and unlock files, and a locked file shows its lock badge on every open screen within the push delay.
- **DP-40 — Locked files stay put** Locked files are never moved, renamed or binned, and mixed selections act on the free files and report how many stayed.
- **DP-41 — Issue a set journey** A document controller locks an issued set, then an engineer moves it together with free files and sees the free files fly while the locked rows show Stayed.
- **DP-42 — Timed partner grants** Project owners and document controllers give outside partners viewer or editor access to a folder or file until an end date in the company zone, and can change or remove it.
- **DP-43 — Default grant length** A new grant made without an end date gets the default length in force on the day it is made.
- **DP-44 — Shared with me** A partner sees only granted items, each with its role, Phoenix end date and server-given days left, and every other id answers not found.
- **DP-45 — Share dialog journey** A project engineer opens Share on a folder, picks a partner by keyboard, sets editor access until a date, and sees the grant listed with its end date.
- **DP-46 — Grants end at Phoenix midnight** A grant gives access through the whole of its end date in Phoenix and gives nothing from the next Phoenix midnight, whatever the partner's own zone or device clock.
- **DP-47 — Fallback to inherited access** When a timed editor grant ends, the partner keeps only what other active grants on parent folders give, or nothing, and never a leftover role.
- **DP-48 — Ended access refused everywhere** After a grant ends, every route for that item refuses the partner as not found, including content links issued earlier.
- **DP-49 — Access-ended notice** When a grant ends, the partner's open screen removes the items, closes their preview and shows the in-app notice within the expiry delay in Business rules, with no email.
- **DP-50 — Downgrade and removal on next request** A partner lowered from editor to viewer, or removed, is refused on their very next write or read, mid-session.
- **DP-51 — Edit actions drop live** The partner's open screen loses its edit actions or items as soon as the change is pushed, and shows the notice in Feedback states.
- **DP-52 — Bin with days left** Staff bin free files, and each binned row shows its original folder, binned date, server-given days left and the retention rule that applies.
- **DP-53 — Restore and delete forever** Staff restore binned files to their folder, and document controllers delete them forever, which removes the object and lowers the meter on every screen.
- **DP-54 — Scheduled purge** A binned file is purged for good at the start of its purge date in Phoenix, which removes its object and lowers the meter live, as qualified in Business rules.
- **DP-55 — Effective-dated policies** The office administrator schedules bin retention and default grant length from a future date, earlier items keep the rule in force when they were binned or granted, and a scheduled change can be withdrawn before it starts.
- **DP-56 — Policy settings journey** The office administrator schedules a shorter bin retention and sees it in the schedule, and once it applies the bin shows the old and new rules side by side.
- **DP-57 — Handover offers** Project owners and document controllers offer a project folder to another staff member, who accepts or declines it, and each illegal step gets its exact rejection.
- **DP-58 — Handover lapse** An offer not accepted by the end of its Phoenix lapse date lapses on the server, ownership stays with the giver, and the giver is told in the app.
- **DP-59 — Handover journey** A project engineer offers a project to a colleague, the colleague accepts it from Handovers, and both screens show the new owner.
- **DP-60 — Phone layout and touch selection** At 375 px wide the rail opens as a drawer, a long press starts a selection, the action bar's targets are at least 44 px, and the homing flight aims at the path bar.

## Frontend

### Screens and layout (DP-07, DP-09, DP-19, DP-20, DP-22, DP-24, DP-44, DP-52, DP-55, DP-57, DP-60)

Screens and their addresses:

- **Sign in** (`/sign-in`). The wordmark, the email and password fields and the Sign in button sit centred on the paper ground. A signed-out visit to any other address redirects here, and a successful sign-in returns to the exact address that was asked for, with its folder, view, sort and search. Signing out ends the session in every tab: another open tab of the same browser shows Sign in on its next load.
- **Drive** (`/drive`). The three-pane working screen. With no folder chosen, the centre lists the project folders under the heading "Projects". Partners land on Shared with me instead.
- **Recent** (`/recent`), **Shared with me** (`/shared`, partners only), **Bin** (`/bin`, staff only), **Handovers** (`/handovers`, staff only) and **Settings** (`/settings`, office administrator only). Each uses the same frame with its own content in the centre.

Frame at 1280x800:

- A thin top bar spans the width. It holds the wordmark "Lintel Drive", the search box and the account button.
- The **left rail**, about a fifth of the width, holds from top to bottom: the New button, the rail destinations, the folder tree (which scrolls on its own) and, for staff, the storage meter pinned at the bottom.
- The **centre** holds the path bar, then a slim toolbar with the view switch and the sort control, then the list or grid. When anything is selected, a selection action bar replaces the toolbar.
- The **details panel**, about a quarter of the width, shows the selected item. Its parts are: name; facts (kind, size, modified, location, owner, lock state and, for partners, access end); the preview area; for staff, the people with access; and the activity list.
- The uploads panel docks at the bottom of the centre pane whenever an upload exists.
- The notices region sits at the top of the centre pane, under the path bar.

At 768x1024 the rail stays visible but narrower, and folder names truncate with an ellipsis and their full name as a tooltip. The details panel is closed by default. The Details button opens it as a sheet over the right half.

At 375x812:

- The rail is hidden. The Open navigation button opens it as a drawer from the left with the same contents.
- The centre takes the full width. Each list row shows the name on one line, with the mono size and modified time on a second line.
- The selection action bar is fixed to the bottom edge. Details open as a full-screen sheet.
- The path bar collapses middle segments into an ellipsis button and always keeps the first and last segments.

No screen at any of the three viewports scrolls sideways.

Other screens:

- **Recent** lists files with an extra Location column.
- **Shared with me** lists the partner's directly granted folders and files in the File list (`listbox "Files"`), one `option` per item named exactly its name, as in a folder. Each row shows its role and the line "Ends `<date>` · `<days left>`". A new grant joins an open Shared with me within the push delay.
- **Bin** is a table: Name, From (original folder), Binned (date), Days left (with the rule), and actions.
- **Handovers** is a table: Folder, From, To, Offered, Status ("Open until `<date>`" while offered), and actions. Accept and Decline show only on open offers made to the person viewing. When an offer lapses, its buttons leave every open Handovers screen within the expiry delay.
- **Settings** has two small forms, Bin retention and Partner grant length, over a Policy schedule table: Kind, Days, Effective from, State (In force, Scheduled or Past), and actions. Scheduling or withdrawing a change shows on every open Settings screen within the push delay, and a withdrawn row leaves the table.

### Public screens and controls (DP-12, DP-17, DP-19, DP-20, DP-23, DP-24, DP-26, DP-30, DP-37, DP-42, DP-44, DP-49, DP-52, DP-55, DP-57, DP-60)

These roles and accessible names are public. Tests and judges use them, and everything else is free. Copy marked FS is defined in Feedback states.

| Region / control | Role and accessible name | Visible copy |
|---|---|---|
| Sign-in heading | `heading "Sign in to Lintel Drive"` | same |
| Email field | `textbox "Email"` | label "Email" |
| Password field | password field labelled `Password` | label "Password" |
| Sign-in button | `button "Sign in"` | "Sign in" |
| Search box | `searchbox "Search files"` | placeholder "Search files" |
| Account menu | `button "Account"` opening `menu "Account"` with `menuitem "Sign out"` | person's name and firm |
| Skip link | `link "Skip to files"` | same |
| Rail destinations | `navigation "Drive"` with links "Projects", "Recent", "Shared with me", "Bin", "Handovers", "Settings" (each only for those allowed, per Business rules) | same |
| New button | `button "New"` opening `menu "New"` with `menuitem "Upload files"` and `menuitem "New folder"` | "New" |
| File chooser | file input labelled `Upload files` (multiple) | hidden |
| Folder tree | `tree "Folders"`. Each folder is a `treeitem` named exactly the folder name, with `aria-expanded` on folders that have subfolders, a visible mono count, and the description "`<n>` files" | name and count |
| Storage meter | `meter "Company storage"`, value = used bytes, maximum = quota bytes (staff only) | FS meter copy |
| Path bar | `navigation "Folder path"` of links, with `aria-current="page"` on the last segment | folder names, root "Projects" (staff) or "Shared with me" (partner) |
| View switch | `radiogroup "View"` with `radio "List"` and `radio "Grid"` | same |
| Sort | `combobox "Sort by"` with options "Name A–Z", "Name Z–A", "Newest first", "Oldest first", "Largest first", "Smallest first" | same |
| File list | `listbox "Files"` (multi-select). Each subfolder and file is an `option` named exactly its name, with `aria-selected`. Pending rows carry `aria-busy="true"` | name, mono size, mono modified time, "Locked" badge, "Stayed" badge, "Cut" marker |
| Selection bar | `toolbar "Selection actions"` with buttons "Move to", "Rename", "Share", "Lock", "Unlock", "Move to bin", "Download", "Details", "Clear selection" (each shown only when allowed) | same |
| Move dialog | `dialog "Move to"` with `tree "Destination folders"`, `button "Move here"`, `button "Cancel"` | title "Move to" |
| Rename dialog | `dialog "Rename"` with `textbox "Name"`, `button "Save"`, `button "Cancel"` | same |
| New folder dialog | `dialog "New folder"` with `textbox "Folder name"`, `button "Create"`, `button "Cancel"` | same |
| Share dialog | `dialog "Share <item>"` with `combobox "Person"` controlling `listbox "People"` (options "`<name>` — `<firm>`"), `radiogroup "Access"` (`radio "Viewer"`, `radio "Editor"`), date field labelled `Access ends`, `button "Share"`, `list "People with access"` whose items hold `combobox "Access for <person>"` and `button "Remove <person>"` | same |
| Details panel | `complementary "Details"` at 1280 px; `dialog "Details"` at 768 and 375 px | facts and activity |
| Preview | `region "Preview"` inside Details | image or PDF, or FS preview copy |
| Activity | `list "Activity"` inside Details | mono time, actor, sentence |
| Hand over | `button "Hand over"` in Details for a project folder, opening `dialog "Hand over <folder>"` with `combobox "New owner"`, a spin button labelled `Days to accept`, `button "Offer"`, `button "Cancel"` | same |
| Uploads | `region "Uploads"`. Each row has `progressbar "<file name>"` and buttons "Pause `<name>`", "Resume `<name>`", "Cancel `<name>`", "Dismiss `<name>`" as allowed | FS upload copy |
| Announcements | `status "Announcements"` (polite, the only live region) | FS announcements |
| Notices | `region "Notices"`, items each with `button "Dismiss"` | FS notices |
| Service status | `region "Service status"` banner | FS outage copy |
| Bin table | `table "Binned files"` with buttons "Restore `<name>`" and "Delete `<name>` forever" | days left and rule |
| Delete confirm | `alertdialog "Delete forever?"` with `button "Delete forever"` and `button "Cancel"` | "`<name>` will be removed for good." |
| Handovers table | `table "Handovers"` with buttons "Accept `<folder>`" and "Decline `<folder>`" | status column |
| Settings forms | `form "Bin retention"` and `form "Partner grant length"`, each with a spin button labelled `Days`, a date field labelled `Effective from`, and `button "Schedule bin retention"` / `button "Schedule grant length"` | same |
| Policy schedule | `table "Policy schedule"` with `button "Withdraw <kind> from <date>"` on scheduled rows, where `<kind>` is "bin retention" or "grant length" | same |
| Phone navigation | `button "Open navigation"`, `dialog "Navigation"`, `button "Close navigation"` | icons with visible labels |

Every homing chip carries `data-homing-chip="<file id>"`, and the summary chip carries `data-homing-chip="more"`. The reduced-motion badge on a destination is visible text "+`<n>`".

### Interactions (DP-17, DP-21, DP-23, DP-37, DP-38, DP-45, DP-60)

**Address state.** The address carries `folder=<folder id>`, `view=list|grid`, `sort=<key>` and `q=<text>`. The sort keys `name-asc`, `name-desc`, `modified-desc`, `modified-asc`, `size-desc` and `size-asc` match the six sort options in order. Defaults are no folder (Projects), list view and `name-asc`, and a default value is left out of the address. Opening a folder, switching view, changing sort or submitting a search pushes exactly one new history entry. Back and Forward restore each earlier state. Reload, or the same address in a second tab, shows the same state. An address naming a folder the person cannot see shows the FS unavailable-folder state.

**Search.** Typing in the search box changes nothing on its own. Pressing Enter submits the search: it shows the results and pushes one history entry. Pressing Enter in an empty box clears the search the same way. Submitting the same text again pushes nothing.

**Folder tree** (`tree "Folders"`, a single Tab stop with roving focus):

- Down and Up move to the next or previous visible node.
- Right expands a collapsed node, or on an expanded node moves to its first child.
- Left collapses an expanded node, or otherwise moves to the parent.
- Home and End go to the first and last visible node.
- Enter opens the focused folder in the centre.
- Typing letters moves to the next visible node whose name starts with the typed string. The string resets after half a second without typing.
- A click on the expand marker toggles the node. A click on the name opens the folder.

**File list** (`listbox "Files"`, a single Tab stop with roving focus; in grid view Left and Right also move):

- Tabbing into the list focuses the item that last had focus in the open folder, or the first item when none has. Entering never changes the selection.
- The anchor is the item that had focus when the selection was last set by a plain arrow, Space, Ctrl and Space, a click or a Ctrl-click. When focus enters the list with nothing selected, the anchor is the focused item.
- Down and Up move focus and select only the newly focused item, which becomes the anchor.
- Shift with Down or Up moves focus and selects every item from the anchor to the new focus, both included, and nothing else. For example, from the first of five items with nothing selected, four presses of Shift and Down select all five.
- Ctrl with Down or Up moves focus without changing the selection.
- Ctrl and Space adds or removes the focused item.
- Space selects only the focused item. Ctrl A selects everything in the folder.
- Home and End move to the first and last item. Typeahead works as in the tree.
- Enter on a folder opens it. Enter on a file opens its details and preview while focus stays in the list.
- Mouse: click selects one item, Ctrl-click toggles, Shift-click extends from the anchor. Double-click opens.
- Each change of selection announces once.
- When selected rows leave the list because of someone else's change, for example a move into a folder the person cannot see, they leave the selection. If the selection becomes empty, the selection action bar leaves, phone selection mode ends and "Selection cleared" is announced once.

**Shortcuts.** These work while focus is anywhere in the tree, the list, the path bar or the selection action bar, but never inside a text field. On macOS the Command key works in place of Ctrl.

- Ctrl X marks the selected files as cut. They show a "Cut" marker and keep it while the person browses other folders. A new cut, Escape or a paste ends it.
- Ctrl V moves the cut files into the open folder, or into the focused node when focus is in the tree.
- F2 opens Rename for a single selected file. If someone else locks the file while Rename is open, its Locked badge shows in the list behind the dialog within the push delay, and Save keeps the name unchanged and announces "`<name>` is locked and was not renamed." with the file's current name.
- Delete moves the selected files to the bin (staff only).
- Escape clears the selection and any cut.
- Folders in a selection are skipped by every file action.

**Drag.** Dragging a selected row, or an unselected row on its own, shows a small stack chip that follows the pointer. A valid drop target (a tree node, a folder row or a path-bar segment) gets an accent outline. Dropping moves the files. Dropping on the folder they are already in does nothing. Dragging files from the desktop onto the centre uploads them into the open folder.

**Move to.** The Move to button opens `dialog "Move to"`. Focus goes to the destination tree, which uses the tree keys above. Enter or Move here confirms. Tab and Shift Tab cycle only within the dialog, wrapping from last to first and back. Escape or Cancel closes it. Focus then returns to the control that opened the dialog. All other dialogs behave the same way, and focus starts in the first field. With a combobox popup open, Escape closes only the popup.

**People picker** (`combobox "Person"` and `combobox "New owner"`):

- Typing queries the directory after a pause of at most 300 milliseconds. Results appear in the listbox as "`<name>` — `<firm>`" with a Staff or Partner tag.
- Down opens the list and moves through it, Up moves back, and Enter picks.
- The share picker lists only partners. The handover picker lists only staff other than the current owner.

**Share dialog.**

- Pick a person, choose Viewer or Editor, and pick an end date in the date field. The field is pre-filled with the default end date the server returns, and its range is the server's today to its maximum.
- Share submits the grant. On success the grant joins the "People with access" list with its "Ends `<date>`" line, and the form resets.
- Changing a row's access combobox applies at once. "Remove `<person>`" removes the grant at once.
- While the dialog is open, its People with access list follows changes other people make to the same item's access, within the push delay. Sharing with a person who already has access, for example one someone else added a moment before, keeps the existing grant and announces "`<person>` already has access to `<item>`. Change it in the list below."

**Upload.**

- New › Upload files opens the system file chooser.
- Each file gets a row in the uploads panel with a progress bar. Parts are sent one at a time.
- Pause stops after the current part. Resume continues from the next unconfirmed part. Cancel ends the upload.
- The browser keeps the chosen file's bytes in its own storage while the upload is unfinished. After a reload, the panel lists the person's unfinished uploads from the server, and Resume continues without asking for the file again.
- When an upload expires on the server (see Uploads in Business rules), its row turns to "Expired" in place within the expiry delay, Pause and Resume leave it, and "Upload of `<name>` expired" is announced once. The Expired row offers "Dismiss `<name>`" and stays in the panel, after a reload too, until the person dismisses it.
- When a part or a complete answers the storage 503, the browser marks that upload "Waiting for storage" and stops sending. When the pushed service status turns storage back to up, the browser resumes only the uploads marked Waiting for storage. Uploads the person paused stay paused until they press Resume.

**Bin, Handovers and Settings.**

- Restore acts at once. "Delete `<name>` forever" asks for confirmation in the alert dialog first.
- Accept and Decline act at once.
- Settings forms submit on their Schedule button. Field errors appear under the field, and focus moves to the first field with an error.
- Pressing Withdraw on a change whose date has already arrived, for example on a Settings screen loaded before that midnight, keeps the row and announces "This change has already started."
- Pressing Accept on an offer that has already lapsed, for example on a Handovers screen that has not heard yet, announces "This handover lapsed at the end of `<date>`." with its lapse date.

**Touch, phone width.**

- Open navigation slides the drawer in. Choosing a destination or folder closes it, and so do Escape and Close navigation.
- A long press of half a second on a row starts selection mode with that row selected. After that, taps toggle rows until the selection is empty.
- A tap outside selection mode opens a folder, or opens a file's Details sheet.
- The selection action bar shows Move to, Share, Download and, behind a More button, the other actions allowed.

**Tab order.** Skip link, top bar (search, account), rail (New, destinations, tree, meter), centre (notices, path bar, view, sort, list, selection actions), details, uploads. Focus is always visible as an accent ring.

### Visual design (DP-07, DP-08, DP-60)

- **Colour.** The page is a warm, drafting-paper off-white. Text and icons are a near-black, slightly blue-grey ink. One blueprint blue is the only saturated colour. It marks the primary button (the New button), the focus ring, the selected-row tint, drop targets, links and the homing chips. Hairline rules between every list row, around panes and under the path bar are a warm mid-grey. A rust red-orange is kept for warnings only: outage banners, expired uploads, "Last day", "Purge pending" and refused actions.
- **Contrast.** Every text and control colour pair meets WCAG 2.2 AA.
- **Type.** Headings, the wordmark and pane titles use IBM Plex Sans Condensed. Body text and controls use IBM Plex Sans. Every numeral uses IBM Plex Mono with tabular figures: sizes, dates, times, days left, counts and meter figures. Each heading step is a fifth larger than the one below it, and body text is small and dense. All fonts are bundled with the app.
- **Composition.** The layout reads like a drafting table: three panes, flat surfaces, hairline rules and no drop shadows anywhere. Spacing follows a small four-pixel step, so rows line up across the panes. Every list row carries a mono timestamp or days-left figure at its right edge. Icons are simple line icons.
- **Density.** Compact, with desktop rows about two text lines tall. Every tappable target is at least 44 by 44 px at 375 px wide, and every control at every width is at least 24 by 24 px.
- **Badges.** Lock badges are small outlined labels in ink. "Stayed" badges are outlined in rust.

### Motion and effects (DP-10, DP-11, DP-60)

Motion explains where things went. Nothing moves for decoration, and there are no unnamed looping animations. The pending marker is a static hollow dot, and progress bars only fill.

- Dialogs and sheets fade in within about 150 milliseconds. The phone drawer slides in from the left in about 200 milliseconds.
- Row hover tints the row faintly in the accent. Pressing a button darkens it for the duration of the press.
- Upload progress bars fill as each part is confirmed.
- The phrase "settles gently" below means each movement starts quickly and eases into its end position.

**Signature: the homing flight.** This runs on Ctrl V, a drop or Move here.

1. The moving rows dim to about half strength, show the pending marker and stay where they are while the request is out.
2. When the server replies, each file that moved, and each file a rival move won, lifts its name chip out of its row. The chip flies to the centre of the destination's node in the folder tree. If that node sits inside a collapsed folder, the chip flies to the nearest visible ancestor node. A lost file's chip flies to the winner's folder instead.
3. The path is a curve that bows away from the straight line between start and end by at least a tenth of that distance. Each chip takes about 420 milliseconds and settles gently.
4. Chips leave 40 milliseconds apart in list order. At most 8 chips fly. The remaining files travel as a single chip reading "+`<n>`", which leaves after the eighth.
5. Each source row collapses over about 180 milliseconds after its chip leaves.
6. When the last chip lands, the destination node's mono count steps up and the source folder's count steps down, each as a 180-millisecond step.
7. Locked files never lift. Their rows lose the dim and show the "Stayed" badge until the selection next changes.
8. The whole flight for up to 8 chips finishes within one second of the reply.
9. At 375 px wide the tree is hidden, so chips fly to the destination's segment in the path bar. If that segment is not shown, they fly to the deepest shown segment that is an ancestor of the destination, or else to the first segment.
10. Anyone else whose open screen shows the moved rows sees the same flight from their own rows when the move is pushed. If the destination is not visible to them, those rows just collapse.

**Reduced motion.** When the person prefers reduced motion:

- No chip flies, no row collapses and no count animates.
- Moved rows are removed at once.
- The destination's tree node, or its path-bar segment at phone width, shows a static outlined "+`<n>`" badge until focus next moves.
- Counts change in one step. Dialogs, sheets and the drawer appear without fading or sliding.
- The announcements stay exactly the same.

### Feedback states (DP-12, DP-18, DP-29, DP-32, DP-33, DP-49, DP-51, DP-58)

**Copy rules.**

- All copy below appears in the `status "Announcements"` region exactly once per event, and nowhere else is announced.
- Loading or reloading a screen announces nothing about events that happened before it loaded: an upload that already expired, a grant that already ended or a handover that already lapsed just shows its current state.
- Notices also stay visible in `region "Notices"` until they are dismissed, five at most, newest first.
- The outage text also stays in `region "Service status"` while the outage lasts.
- Watchers are not sent announcements for other people's moves. They see the flight only.
- Placeholders:
  - `<n>`, `<k>` and `<m>` are whole numbers.
  - `<name>` is a file name, `<folder>` a folder name and `<item>` a folder or file name.
  - `<person>` is a person's name.
  - `<date>` is a company-zone date written `YYYY-MM-DD`.
  - `<role>` is "viewer" or "editor".
  - `<days>` is a whole number of days.
- Plural rule: "`<n>` files" becomes "1 file" when n is 1. "locked files" becomes "locked file" when k is 1. "`<n>` days left" becomes "1 day left" when n is 1.
- Every pending state below shows the static pending marker on the control or row involved and is not announced.

| Action | Success | Error or field error | Outage |
|---|---|---|---|
| Sign in | page changes, no announcement | "Email or password is incorrect." | "Sign-in is unavailable while the people directory is unreachable. Anyone already signed in can keep working." |
| Selection change | "`<n>` selected", or "Selection cleared" when it becomes empty | — | — |
| Cut | "`<n>` files cut" | — | — |
| Move | "Moved `<n>` files to `<folder>`". When files stayed, add ". `<k>` locked files stayed". For each of up to three lost files, add ". `<name>` was already moved to `<folder>` by `<person>`". For more than three, name three, then add ". `<m>` more were moved by others first". When nothing moved, the first sentence is "No files moved". Lost-file sentences also appear as a notice. | "Move failed. Nothing was moved." (rows restore) | same error copy |
| Upload | "Uploaded `<name>`". Row states: "Uploading `<p>`%", where `<p>` is the whole percentage of confirmed bytes, then "Paused", "Waiting for storage", "Done" | "Files can be up to 2,000,000,000 bytes." "Cancelled upload of `<name>`". Expired row "Expired" and announcement "Upload of `<name>` expired" | see storage outage |
| Rename | "Renamed to `<name>`" | "Enter a name." / "Names can be up to 120 characters." / "Names cannot contain / or \\." / "`<name>` is locked and was not renamed." | — |
| New folder | "Created `<folder>`" | same name errors as Rename | — |
| Lock / unlock | "Locked `<n>` files" / "Unlocked `<n>` files" | — | — |
| Move to bin | "Moved `<n>` files to the bin", plus the locked-files sentence when files stayed | — | — |
| Restore | "Restored `<name>` to `<folder>`" | — | — |
| Delete forever | "Deleted `<name>` forever" | — | "File storage is unreachable. `<name>` was not deleted." |
| Share | "Shared `<item>` with `<person>` until `<date>`" | "Only outside partners get timed access." / "Choose a date from `<today>` to `<max date>`." / "`<person>` already has access to `<item>`. Change it in the list below." | picker outage copy |
| Change / remove grant | "`<person>` is now `<role>` on `<item>`" / "Removed `<person>` from `<item>`" | — | — |
| Schedule policy | "Bin retention changes to `<days>` days from `<date>`" / "Partner grant length changes to `<days>` days from `<date>`" | "Choose a date after today." / "Enter whole days from 1 to 90." (bin) / "Enter whole days from 1 to 365." (grant length) / "A change is already scheduled for `<date>`." | — |
| Withdraw policy | "Withdrew the change from `<date>`" | "This change has already started." | — |
| Offer handover | "Offered `<folder>` to `<person>` until `<date>`" | "`<folder>` already has an open handover." / "Choose a staff member other than the current owner." / "Enter whole days from 1 to 14." | picker outage copy |
| Accept / decline | "You now own `<folder>`" / "Declined `<folder>`" | "This handover lapsed at the end of `<date>`." / "This handover was already `<accepted or declined>`." | — |
| Any other failure | — | "Something went wrong. Nothing was changed." | — |

**Notices pushed to the person concerned** (notice and announcement):

- Grant ended, nothing behind it: "Your access to `<item>` ended at the end of `<date>`, Phoenix time."
- Editor grant ended, parent access remains: "Your editor access to `<item>` ended at the end of `<date>`, Phoenix time. You can still view it."
- Lowered to viewer: "Your access to `<item>` is now view only."
- Removed: "Your access to `<item>` has been removed."
- A write refused as forbidden: "You no longer have edit access to `<item>`."
- An open item answering not found: "`<item>` is no longer available to you."
- To the giver when a handover is accepted: "`<person>` accepted `<folder>`."
- To the giver when declined: "`<person>` declined `<folder>`."
- To the giver when lapsed: "Your handover of `<folder>` to `<person>` lapsed. You still own it."

**Storage outage.**

- Banner and announcement: "File storage is unreachable. Uploads are paused and previews are unavailable until it returns."
- Starting an upload during the outage: the upload row reads "Waiting for storage" and the banner copy is announced again. No upload is created on the server.
- On recovery: "File storage is back." When at least one upload was waiting for storage, add " Waiting uploads have resumed."
- Preview region during the outage: "Preview unavailable while file storage is unreachable."
- Download pressed during the outage: the banner copy is announced again.

**Directory outage.**

- Picker: "The people directory is unreachable. Existing access is unchanged. Try again in a moment."
- The picker retries on the next keystroke or opening and clears this state on the first success.

**Fixed texts.**

- Meter: "`<used>` of `<quota>` used". Sizes everywhere use powers of 1,000 with two decimals: B (whole numbers under 1,000 bytes), KB, MB, GB, TB. For example "12.48 MB".
- Days-left texts:
  - Grants: "`<n>` days left", or "Last day" when n is 0.
  - Bin: "`<n>` days left · `<r>`-day rule", where `<r>` is the retention that applies. When the purge is overdue: "Purge pending · `<r>`-day rule".
  - Handovers: "Open until `<date>`".
- Empty states:
  - Empty folder: "This folder is empty."
  - Search with no results: "No files match `<q>`."
  - Shared with me empty: "Nothing is shared with you right now."
  - Bin empty: "The bin is empty."
  - Unknown or hidden folder in the address: "This folder is not available to you."
  - Preview for any type other than PNG, JPEG or PDF: "No preview for this file type."
- Hidden folder name shown to partners: "another folder".
- Dates in Details carry the footnote "All dates and times are Phoenix time."

## Backend

### API (DP-04, DP-05, DP-06, DP-15, DP-16, DP-17, DP-19, DP-20, DP-22, DP-24, DP-26, DP-28, DP-30, DP-34, DP-35, DP-39, DP-42, DP-44, DP-48, DP-52, DP-53, DP-55, DP-57)

**Format.**

- All endpoints are under `/api`. Request bodies and responses are JSON unless a row says otherwise; the content-type rule is in Server boundary.
- Ids are opaque strings. Instants are ISO 8601 UTC with `Z`. Dates are company-zone calendar dates written `YYYY-MM-DD`.
- Authentication is the `lintel_session` cookie.

**Error shape and check order.**

- Every error body is `{"error":"<code>"}`, plus extra keys only where a row lists them. Validation errors are `422 {"error":"validation","fields":{"<field>":"<message>"}}`.
- Checks run in this order, and the first failure answers:
  1. Body too large: `413 {"error":"too_large"}`. Wrong content type: `415 {"error":"unsupported_media_type"}`.
  2. Cross-origin write: `403 {"error":"cross_origin"}`.
  3. No valid session: `401 {"error":"unauthenticated"}`.
  4. Not found: `404 {"error":"not_found"}`. This covers any id in the path, query or body that is malformed, unknown, binned (outside the bin routes, and on every route for partners) or not visible to the caller.
  5. Visible but not allowed for this caller: `403 {"error":"forbidden"}`.
  6. A repeated idempotency key: the stored response is returned here.
  7. The current state forbids the step: `409`.
  8. Field validation: `422`.
  9. A needed service is unreachable: `503 {"error":"storage_unavailable"}` or `503 {"error":"directory_unavailable"}`.
- The rows below name only their own extra errors.

**Shared objects.**

- Person: `{"id","name","email","firm","kind":"staff"|"partner","staffRole":"engineer"|"controller"|"admin"|null}`
- Folder: `{"id","name","parentId":id|null,"projectId":id|null,"owner":{"id","name"},"fileCount","access":"editor"|"viewer"}`
- File: `{"id","name","folderId":id|null,"folderName","size","contentType","modifiedAt","locked","access":"editor"|"viewer","previewable","accessEnds":date|null}`.
  - `accessEnds` is null for staff. For a partner it is the end date of the active grant that gives the partner's current role on the file. When several active grants give that role, it is the latest of their end dates. For example, with the seed data at start, Callum's files in Saguaro › Calculations show `S`+14 (editor), and `S`+60 once the editor grant has ended.
- Grant: `{"id","itemType":"folder"|"file","itemId","itemName","person":{"id","name","firm"},"role":"viewer"|"editor","endDate","daysLeft","status":"active"|"ended","endedReason":null|"date"|"removed"|"purged"}`
- Upload: `{"id","folderId","name","size","contentType","state":"started"|"uploading"|"paused"|"confirmed"|"cancelled"|"abandoned","partSize":5242880,"partCount","confirmedParts":[int],"expiresAt":instant|null}`
- BinItem: `{"file":File,"fromFolder":{"id","name"},"binnedDate","retentionDays","purgeDate","daysLeft","purgePending"}`
- Handover: `{"id","folder":{"id","name"},"from":{"id","name"},"to":{"id","name"},"offeredDate","lapseDate","status":"offered"|"accepted"|"declined"|"lapsed"}`
- Policy: `{"id","kind":"bin_retention_days"|"partner_grant_days","days","effectiveFrom","state":"in_force"|"scheduled"|"past"}`
- LedgerEntry: `{"id","at","actor":{"id","name"}|null,"action","fileId":id|null,"folderId":id|null,"detail":{}}`. The actor is null for server-run steps.
- `path`: the folders from the top down to the item, each `{"id","name"}`. For a folder it ends with the folder itself. For a file it ends with the file's folder. For staff it starts at the project folder.

**What partners see of hidden folders.** For a partner, a folder is hidden when no active grant of theirs covers it.

- Wherever a response would name a hidden folder, its id is `null` and its name is "another folder". This applies to `Folder.parentId` and `projectId`, `File.folderId` and `folderName`, `lostTo` folders in move results, and folder names in ledger entries and their `detail`.
- A partner's `path` holds only visible folders, starting at the highest visible one. For a file directly granted in a hidden folder, `path` is empty. For example, with the seed data at start, Rosa's `path` for Saguaro › Issued is just `[{"id":<Issued id>,"name":"Issued"}]` and that folder's `parentId` is null.
- The path bar then shows "Shared with me" followed by those segments.

**Endpoints.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/health` (no session) | — | `200 {"status":"ok"}` | `503 {"status":"starting"}` until the database answers |
| `GET /api/status` (no session) | — | `200 {"storage":"up"|"down","directory":"up"|"down"}` | — |
| `GET /api/clock` (no session) | — | `200 {"now":instant,"today":date,"zone":"America/Phoenix"}` | — |
| `PUT /api/clock` (no session) | `{"now":"<ISO 8601 instant with offset>"}` | `200`, same body as GET, after the expiry sweep has run | `404` unless clock control is on; `422` bad instant |
| `POST /api/session` (no session) | `{"email","password"}` | `200 {"person":Person}` and sets `lintel_session` | `401 {"error":"invalid_credentials"}`; `503` directory |
| `GET /api/session` | — | `200 {"person":Person}` | — |
| `DELETE /api/session` | — | `204` and clears the cookie | — |
| `GET /api/events` (WebSocket) | — | `101`, upgrading to a WebSocket that the server keeps open. Each message is one JSON text frame `{"type":"<type>","data":<JSON>}`. One message per state change the session may see, plus a `status` message carrying the `/api/status` body whenever a service changes between up and down | — |
| `GET /api/people?q=&kind=staff|partner` | `q` 1–100 characters | `200 {"people":[Person]}`, up to 20, whose name, firm or email contains `q`, case-insensitive | `403` partners; `422` q; `503` directory |
| `GET /api/folders` | — | `200 {"folders":[Folder]}`, every folder visible to the caller | — |
| `GET /api/folders/{id}` | — | `200 {"folder":Folder,"path":path}` | — |
| `POST /api/folders` | `{"parentId":id|null,"name"}` | `201 {"folder":Folder}` | `403` per capabilities; `422` name |
| `GET /api/folders/{id}/activity` | — | `200 {"entries":[LedgerEntry]}`: the folder's own entries plus those of its direct files, newest first, up to 200 | — |
| `GET /api/files?folderId=&sort=&q=` | `sort` is one of the six keys, default `name-asc`. `q` is 1–100 characters and matches a case-insensitive substring of the file name | `200 {"folders":[Folder],"files":[File]}`. With `folderId`: direct children. With `q`: matching live files anywhere visible, no folders. With neither: the caller's top-level folders and no files | `422` sort or q |
| `GET /api/files/recent` | — | `200 {"files":[File]}` | — |
| `GET /api/files/{id}` | — | `200 {"file":File,"path":path}` | — |
| `PATCH /api/files/{id}` | `{"name"}` | `200 {"file":File}` | `409 {"error":"locked"}`; `422` name |
| `GET /api/files/{id}/activity` | — | `200 {"entries":[LedgerEntry]}`, newest first | — |
| `POST /api/files/{id}/links` | `{"purpose":"preview"|"download"}` | `201 {"url":"/api/content/<token>","expiresAt":instant}` | `422` purpose (preview of a type that cannot be previewed); `503` storage |
| `GET /api/content/{token}` | — | `200` with the file bytes and the headers in Server boundary | `404` bad token, a token from another session, or no current access; `410 {"error":"link_expired"}`; `503` storage |
| `POST /api/files/{id}/lock` / `DELETE /api/files/{id}/lock` | — | `200 {"file":File}` | `409 {"error":"already_locked"}` / `409 {"error":"not_locked"}` |
| `POST /api/moves` (optional `Idempotency-Key` header, 1–100 characters) | `{"toFolderId","items":[{"fileId","fromFolderId"}]}`, 1–500 items, distinct fileIds | `200 {"toFolder":{"id","name"},"moved":[{"fileId","fromFolderId"}],"stayed":[{"fileId","reason":"locked"}],"lostTo":[{"fileId","folder":{"id","name"},"by":{"id","name"}}],"unchanged":[fileId],"folderCounts":{"<folderId>":int}}`. A replay adds the header `Idempotent-Replayed: true` | `409 {"error":"idempotency_key_reused"}`; `422` items |
| `POST /api/uploads` (optional `Idempotency-Key`) | `{"folderId","name","size","contentType"}` | `201 {"upload":Upload}` | `409 {"error":"idempotency_key_reused"}`; `422` name, size, contentType; `503` storage |
| `GET /api/uploads` | — | `200 {"uploads":[Upload]}`: the caller's uploads in started, uploading, paused or abandoned | — |
| `GET /api/uploads/{id}` | — | `200 {"upload":Upload}` | — |
| `PUT /api/uploads/{id}/parts/{n}` | raw bytes, `application/octet-stream` | `200 {"upload":Upload}` | `409 {"error":"upload_<state>"}`; `422 fields.part`; `503` storage |
| `POST /api/uploads/{id}/pause` / `.../resume` | — | `200 {"upload":Upload}` | `409 {"error":"upload_<state>"}` |
| `POST /api/uploads/{id}/complete` | — | `201 {"file":File}`, or `200 {"file":File}` when already confirmed | `409 {"error":"parts_missing","missing":[int]}`; `409 {"error":"upload_<state>"}`; `503` storage |
| `DELETE /api/uploads/{id}` | — | `204` | `409 {"error":"upload_confirmed"}` |
| `GET /api/storage` | — | `200 {"usedBytes","binBytes","quotaBytes"}` | `403` partners |
| `GET /api/bin` | — | `200 {"items":[BinItem]}`, soonest purge first | `403` partners |
| `POST /api/bin` | `{"fileIds":[id]}`, 1–500 | `200 {"binned":[fileId],"stayed":[{"fileId","reason":"locked"}]}` | `403` partners naming files they can see; `422` fileIds |
| `POST /api/bin/{fileId}/restore` | — | `200 {"file":File}` | none beyond the check order (partners get its 404) |
| `DELETE /api/bin/{fileId}` | — | `204` once the object is deleted | `403` staff who are not document controllers; `503` storage |
| `GET /api/grants?itemType=&itemId=` | — | `200 {"grants":[Grant]}`, active grants on that item | `403` partners |
| `POST /api/grants` | `{"itemType","itemId","personId","role","endDate"?}` | `201 {"grant":Grant}` | `403` per capabilities; `409 {"error":"grant_exists"}`; `422` personId, role, endDate; `503` directory |
| `PATCH /api/grants/{id}` | `{"role"?,"endDate"?}` | `200 {"grant":Grant}` | `403`; `409 {"error":"grant_ended"}`; `422` |
| `DELETE /api/grants/{id}` | — | `204` | `403`; `409 {"error":"grant_ended"}` |
| `GET /api/grants/defaults` | — | `200 {"today","defaultEndDate","maxEndDate"}` | `403` partners |
| `GET /api/shared` | — | `200 {"items":[{"itemType","folder":Folder|null,"file":File|null,"role","endDate","daysLeft"}]}` | `403` staff |
| `GET /api/policies` | — | `200 {"today","policies":[Policy]}` | `403` partners |
| `POST /api/policies` | `{"kind","days","effectiveFrom"}` | `201 {"policy":Policy}` | `403` non-admins; `409 {"error":"policy_exists"}`; `422` days, effectiveFrom |
| `DELETE /api/policies/{id}` | — | `204` | `403` non-admins; `409 {"error":"policy_started"}` |
| `GET /api/handovers` | — | `200 {"handovers":[Handover]}`, newest first | `403` partners |
| `POST /api/handovers` | `{"folderId","toPersonId","days"}` | `201 {"handover":Handover}` | `403`; `409 {"error":"handover_open"}`; `422` toPersonId, days, folderId (not a project folder); `503` directory |
| `POST /api/handovers/{id}/accept` / `.../decline` | — | `200 {"handover":Handover}` | `403` non-recipients; `409 {"error":"handover_accepted"|"handover_declined"|"handover_lapsed"}` |

### Business rules (DP-05, DP-13, DP-16, DP-26 to DP-30, DP-34 to DP-36, DP-39, DP-40, DP-42, DP-43, DP-46 to DP-48, DP-50, DP-52 to DP-55, DP-57, DP-58)

**Company time.**

- The company zone is America/Phoenix, which keeps the same offset all year: seven hours behind UTC. "Today" is the Phoenix calendar date of the server clock. A day ends at 00:00 Phoenix time on the following date.
- The server clock is real time plus an offset. The offset is zero unless clock control is on. In that case `PUT /api/clock` sets it so that "now" is the given instant, and the clock keeps running from there.
- Every rule below reads only the server clock. Ledger times, link expiry, upload idleness, grants, the bin, handovers, policies and "today" all come from it.
- The browser never computes expiry, days left or "today". It shows the figures the API returns.

**Timeliness.**

- The server runs an expiry sweep at least every 5 seconds, and once more before replying to `PUT /api/clock`.
- Access checks compare against the clock on every request, so a grant is refused from its edge even before the sweep runs.
- An event reaches open screens within 2 seconds of the change being committed. Screens apply it in place.
- Changes driven by expiry (grant end, purge, lapse, upload expiry) reach open screens within 10 seconds of their edge.
- When the company date changes, every open screen refreshes its days-left figures within 10 seconds.
- An event never names an item, person or folder the receiving session cannot see.

**People and capabilities.**

- **Staff**, any role, can:
  - see every folder and every live file;
  - upload, create folders, rename and move files;
  - move files to the bin and restore them;
  - see grants, the bin, handovers, the policy schedule and storage.
- Only a **project's owner** or a **document controller** can share items inside that project, or offer that project in a handover. Ownership belongs to top-level project folders, and every item inside follows its project's owner.
- Only **document controllers** can lock, unlock and delete forever.
- Only **office administrators** can schedule or withdraw policies, and only they see Settings.
- Any staff member may create a top-level project folder, and becomes its owner.
- **Partners** see only items their active grants cover, and only Recent and Shared with me in the rail.
  - Viewer access allows viewing, preview, download and activity.
  - Editor access also allows uploading, creating subfolders and renaming. A move needs editor access to each source file's folder and to the destination, so a partner cannot move a file whose folder is hidden from them.
  - Partners never bin, restore, lock, share, offer handovers, or see grants, the bin, handovers, policies or storage.
- When an action is refused, the caller gets 404 if they cannot see the item and 403 if they can. Binned files are visible to no partner, so a partner naming a binned file on any route, the bin routes included, gets 404.

**Partner access.**

- A partner's access to an item is the highest role among the partner's active grants on that item and on every folder above it. Access to a folder covers everything in it, including files moved in later.
- Ended grants count for nothing. A file moved out of a covered folder disappears from the partner's view, and that is pushed to their screen.
- Access is checked on every request, from the live grants. A role change or removal applies to the partner's very next request in the same session. The partner's screen is then told by a pushed event and drops edit actions or items in place.

**Grants.**

- Grants go only to partners. A staff person in `personId` gets 422 with the field message "Only outside partners get timed access."
- `endDate` must fall from today to today plus 365 days, both inclusive. Outside that range it gets 422 with the field message from Feedback states.
- With no `endDate`, the end date is today plus the partner grant length in force today. `GET /api/grants/defaults` reports that date and the maximum.
- One active grant per person and item. A second gets 409 `grant_exists`.
- States: `active` → `ended`.
  - A grant ends with reason `date` when the clock reaches 00:00 Phoenix on the day after its `endDate`. It is active through every instant of its end date.
  - `DELETE` ends it with reason `removed`.
  - Purging the file ends it with reason `purged`.
  - Ended grants cannot be changed or removed (409 `grant_ended`).
- `PATCH` may change the role and the end date, within the same range rules.
- `daysLeft` is `endDate` minus today, in whole days. It is 0 on the last day.
- When a grant ends, the partner keeps exactly what their remaining grants give. If the partner has an open screen, it receives the matching notice.

**Content links.**

- A link token names the file, the purpose, the session and the instant it was issued.
- A link is valid for 60 seconds after issue (exclusive: refused from second 60 with `410 link_expired`). It is valid only for the session that requested it.
- On every use, the server checks the caller's current access before checking expiry. A link requested while access was active is refused with 404 once access has ended.

**Moves.**

- For each item, in request order:
  - A locked file goes into `stayed`.
  - A file whose current folder equals `toFolderId` and also equals `fromFolderId` goes into `unchanged`.
  - A file whose current folder differs from `fromFolderId` goes into `lostTo`, naming its current folder and the person whose move put it there.
  - Otherwise the file's folder changes to `toFolderId` through a conditional update that succeeds only if the folder is still `fromFolderId`. If that update fails, the file goes into `lostTo`.
- So among any number of simultaneous moves of one file, exactly one wins. Each file ends with exactly one folder.
- The whole request commits as one transaction. It writes one `moved` ledger entry per moved file and updates the counts. `folderCounts` reports the new counts of the destination and of every source folder.
- **Idempotency.** A repeated `Idempotency-Key` from the same person with the same body returns the stored status and body without changing anything. The same key with a different body gets 409 `idempotency_key_reused`. Keys are kept for at least 24 hours. Uploads follow the same rule.

**Locks.**

- Only files can be locked.
- Locked files cannot be renamed (409 `locked`), are put in `stayed` by moves and by binning, and can still be viewed, downloaded and shared.
- Locking a locked file gets 409 `already_locked`. Unlocking an unlocked file gets 409 `not_locked`.

**Uploads.** The file id is the upload id.

- `POST` creates the storage multipart session in state `started`, with `partCount` = ceil(size ÷ 5,242,880). When storage is unreachable it answers 503 and creates nothing.
- Parts are numbered from 1. Every part except the last must be exactly 5,242,880 bytes. The last part carries the remainder. Anything else gets 422 `fields.part`. Re-sending a confirmed part replaces it.
- A part is accepted in `started` or `uploading`, and moves the upload to `uploading`.
- Legal steps:
  - started or uploading → paused, by pause;
  - paused → uploading, by resume;
  - uploading → confirmed, by complete, once every part is in;
  - started, uploading or paused → cancelled, by DELETE;
  - started, uploading or paused → abandoned, by the server, when the time since the upload's last accepted part or state change reaches `UPLOAD_PAUSE_TTL_SECONDS` (default 86,400 seconds, that is 24 hours).
- Idempotent steps: pause on paused and resume on uploading or started return 200 unchanged.
- Illegal steps answer 409 `upload_<current state>`:
  - a part, or complete, on `paused`;
  - any step on `confirmed`, `cancelled` or `abandoned`, except as noted below.
- Complete on `started`, or with parts missing, gets 409 `parts_missing`.
- **Storage outage.** While storage is unreachable, a part or a complete answers 503 and the upload's server state does not change. There is no server-side waiting state. The idle period toward abandonment keeps running. Only the person's own Pause moves an upload to `paused`.
- Complete asks storage to finish the object and then reads back its stored size. Only then, in one transaction, does the app create the file row, the `uploaded` ledger entry, the folder count change and the storage total change. If storage fails, the upload keeps its state and nothing is created. A repeated complete on `confirmed` returns 200 with the file.
- `DELETE` on an abandoned upload dismisses it from the list. After that, and after a cancel, its id answers 404. DELETE on confirmed gets 409 `upload_confirmed`.
- Cancelled and abandoned uploads have their parts removed from storage. If storage is down, that is retried until it succeeds.
- Size must be 1 to 2,000,000,000 bytes inclusive. Names follow the file-name rules below.

**Names.**

- File and folder names are 1 to 120 characters after trimming and contain no `/` or `\`. Breaking a rule gets 422 with the matching message from Feedback states.
- Names need not be unique within a folder.

**Bin and purge.**

- Binning a free file records its folder, the binned date (today) and the retention days in force on that date. Purge date = binned date + retention days. `daysLeft` = purge date minus today.
- At 00:00 Phoenix on the purge date, the sweep deletes the object from storage. Only once storage confirms the deletion does it remove the file row, end its grants, write a `purged` ledger entry on the former folder and lower the storage total.
- An open Bin shows each row's new days left in place when the company date changes, and at the purge the row leaves every open Bin and every open staff meter drops, within the expiry delay.
- If storage is unreachable, the item stays in the bin with `purgePending` true and is retried on every sweep.
- Restore returns the file to its recorded folder with a `restored` entry.
- Delete forever does the same as a purge at once, and gets 503 with nothing changed when storage is down.
- Binned files are counted in the storage total but not in folder counts or Recent.

**Policies.**

- Two kinds: `bin_retention_days` (1 to 90) and `partner_grant_days` (1 to 365).
- The rule in force on a date is the row of that kind with the latest `effectiveFrom` on or before that date.
- New rows must take effect after today. Today or earlier gets 422.
- Two rows of one kind on the same date get 409 `policy_exists`.
- A row may be withdrawn only while it is scheduled. Once its date has arrived, withdrawal gets 409 `policy_started`.
- Bin items keep the retention in force on their binned date. Grants keep the end date they were given. A later change never alters either.
- `state` is `in_force` for the row currently applying, `scheduled` for future rows and `past` for older ones.

**Handovers.**

- Only top-level project folders are offered. `toPersonId` must be a staff member other than the current owner. `days` is 1 to 14 (default 7 in the dialog). Lapse date = offered date + days.
- One open offer per folder. A second gets 409 `handover_open`.
- States: `offered` → `accepted` or `declined`, by the recipient only (others who can see it get 403). `offered` → `lapsed`, by the server at 00:00 Phoenix on the day after the lapse date. The offer stays acceptable through all of its lapse date.
- Accepting changes the project's owner in the same transaction as its ledger entry.
- Any step on a decided or lapsed offer gets 409 `handover_<status>`.
- The giver, the recipient and document controllers can see an offer. Anyone else gets 404.
- Lapse, accept and decline are pushed as notices to the giver.

**Derived values.**

- A folder's `fileCount` is the number of live (not binned) files directly inside it.
- The storage total is the sum of the confirmed sizes of every stored file, bin included. It changes only when an upload is confirmed or a file is purged.
- Recent is the caller's visible live files, ordered by their latest ledger entry, newest first, 50 at most, each with its current folder.
- Every API figure equals a fresh count of the stored files.

**Ledger.**

- Every change to files, folders, grants, handovers and policies writes exactly one ledger entry per item affected, in the same transaction as the change and its count and total updates.
- Actions:
  - files: `uploaded`, `renamed`, `moved`, `locked`, `unlocked`, `binned`, `restored`, `purged`;
  - folders: `folder_created`;
  - grants: `shared`, `access_changed`, `access_removed`, `access_ended`;
  - handovers: `handover_offered`, `handover_accepted`, `handover_declined`, `handover_lapsed`;
  - policies: `policy_scheduled`, `policy_withdrawn`.
- Partners see only file entries of the actions `uploaded`, `renamed`, `moved`, `locked` and `unlocked`, with hidden folders named as stated in API.
- The details panel shows each entry as its mono Phoenix time ("YYYY-MM-DD HH:MM"), the actor's name (or "Lintel Drive" for server steps) and one sentence naming the action and the folders or people involved.

### Services (DP-03, DP-14, DP-18, DP-27, DP-32, DP-33)

- **PostgreSQL** (`DATABASE_URL`) holds the system of record: folders, files, grants with end dates, locks, handovers, bin entries with their applied retention, the policy table, uploads, sessions, idempotency records, the ledger and storage totals. Sessions live here, so they keep working while the directory is down.
- **MinIO** (`S3_*`) holds file bytes at the key `files/<file id>`. Multipart sessions write to that same key. After a completed upload, exactly one object exists per stored file, bin included, and nothing else exists under `files/`. Purge, delete forever, cancel and abandon leave no object and no parts.
  - Previews and downloads stream through the app (Server boundary). The browser never receives a storage URL.
  - When storage is unreachable, the actions that need it answer 503 `storage_unavailable`, the service status reads `down`, and the outage copy in Feedback states shows. Lists, details, activity, moves, renames, locks, grants and handovers keep working.
  - The server probes storage every 5 seconds and recovers without a restart. Within 10 seconds of storage returning, the status reads `up` and is pushed to open screens, which resume their uploads waiting for storage as stated in Interactions. Uploads the person paused stay paused.
- **PocketBase** (`POCKETBASE_*`) is the people directory. The app uses the `users` auth collection and adds, idempotently, the fields `name` (text), `firm` (text), `kind` (`staff` or `partner`), `staffRole` (`engineer`, `controller`, `admin` or empty) and `avatar` (optional file). The picker shows initials in a circle when there is no avatar. Sign-in checks the password against this collection.
  - When the directory is unreachable, sign-in, people search, new grants and new handovers answer 503 `directory_unavailable`, and the service status reads `down`. Existing sessions, access checks, grant changes and removals keep working.
  - The server probes the directory every 5 seconds and recovers without a restart.

### Seed data (DP-03)

Every seeded person, firm and project is invented. The seed runs once, when the database holds no folders. It is all or nothing, only one process seeds a given database, and it upserts directory people by email.

`S` is the company date (today) when the seed runs. Every seeded person uses the password `Lintel-demo-2026!`.

| Name | Email | Kind | Firm | Staff role |
|---|---|---|---|---|
| Marisol Okafor | marisol.okafor@lintelworks.test | staff | Lintelworks | engineer |
| Dev Halvorsen | dev.halvorsen@lintelworks.test | staff | Lintelworks | engineer |
| Ines Whitcombe | ines.whitcombe@lintelworks.test | staff | Lintelworks | controller |
| Tomas Achterberg | tomas.achterberg@lintelworks.test | staff | Lintelworks | admin |
| Aiko Brandt | aiko.brandt@mesquiterow.test | partner | Mesquite Row Architects | — |
| Callum Reyes-Tran | callum.reyes-tran@southerncross-review.test | partner | Southern Cross Review | — |
| Rosa Tilden | rosa.tilden@pimasteel.test | partner | Pima Steel Erectors | — |

Folders and files. Locked files are marked (L); every other seed file is unlocked. Counts are direct live files.

- **2614 Saguaro Medical Office** (owner Marisol Okafor, 0 files)
  - Calculations (3): Gravity calcs rev B.pdf, Lateral calcs rev A.pdf, Wind load summary.pdf
  - Drawings (5): S-101 Foundation Plan.pdf (L), S-201 Second Floor Framing.pdf (L), S-202 Roof Framing.pdf, S-501 Typical Details.pdf, S-502 Moment Frame Details.pdf
  - Site photos (2): Footing pour 2026-10-14.png, Rebar inspection 2026-10-21.png
  - Issued (2): IFC Set 2026-10-01.pdf, Transmittal 2026-10-01.pdf
  - Reports (0)
- **2631 Rillito Bridge Retrofit** (owner Dev Halvorsen, 0 files)
  - Calculations (1): Pier capacity check.pdf
  - Drawings (1): B-101 General Arrangement.pdf
  - Reports (1): Condition survey 2026-09.pdf

Seed file contents:

- Each PDF is a one-page drawing sheet whose title block shows the file name.
- Each PNG is a procedural blueprint-style line drawing.
- Every seed file is under 200,000 bytes and is stored in storage before its row is written.
- Each seed file has one `uploaded` ledger entry by its project's owner.

Bin:

- "Old site photo 2026-08-30.png", from Saguaro › Site photos, binned on `S` under the 30-day rule, so it has 30 days left.

Grants (all active):

- Aiko Brandt: editor on Saguaro › Drawings, ends `S`+30.
- Callum Reyes-Tran: viewer on 2614 Saguaro Medical Office, ends `S`+60. Editor on Saguaro › Calculations, ends `S`+14.
- Rosa Tilden: viewer on Saguaro › Issued, ends `S`+7. Editor on Rillito › Reports, ends `S`+3.

Policies:

- `bin_retention_days` 30 from 2026-01-01.
- `partner_grant_days` 30 from 2026-01-01.

Handover:

- Dev Halvorsen offers 2631 Rillito Bridge Retrofit to Marisol Okafor on `S` for 7 days (lapse date `S`+7), status `offered`. 2614 Saguaro Medical Office has no open offer.

## Technical requirements

### Deployment (DP-01, DP-03)

- Node.js 22 LTS with npm is available. Server and browser code are TypeScript.
- `/app/run.json` holds the strings `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, for example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```

- The server binds `0.0.0.0` on the port in `APP_PUBLIC_PORT`, defaulting to 4173.
- `GET /api/health` answers as stated in API.
- Each start applies the schema, makes sure the bucket exists, adds the directory fields idempotently and runs the seed rule. Nothing is applied only at build time.
- During grading, extra instances of the app may run beside the main one. Some get a `DATABASE_URL` and an `S3_BUCKET` naming a database and a bucket that the harness has already created, empty. The app treats them like any other: it applies its schema and seeds them on start. Other instances get a service URL that points at an unreachable address for the whole run.

### Configuration and secrets (DP-02, DP-05, DP-29, DP-30)

The server reads these at start:

- `DATABASE_URL`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `POCKETBASE_URL`, `POCKETBASE_ADMIN_EMAIL`, `POCKETBASE_ADMIN_PASSWORD`
- `APP_PUBLIC_PORT`
- `STORAGE_QUOTA_BYTES` (default 100,000,000,000)
- `UPLOAD_PAUSE_TTL_SECONDS` (default 86,400)
- `LINTEL_CLOCK_CONTROL` (`on` enables `PUT /api/clock`; anything else or unset disables it)

The key that signs content links is generated at each start. No credential or key is hard-coded, logged, written to the browser bundle or returned by any endpoint.

### Server boundary (DP-04, DP-14, DP-48)

- **Same origin.** Pages, assets, fonts and the API come from one origin. No CORS headers are sent. A state-changing request whose `Origin` header is present and differs from the app's own origin gets the cross-origin 403 from API.
- **Body limits.** JSON bodies may be up to 65,536 bytes (65,536 allowed). Upload part bodies may be up to 5,242,880 bytes (5,242,880 allowed). Anything larger gets 413.
- **Content types.** The check applies only to requests that carry a body. JSON bodies must be `application/json`, and parts must be `application/octet-stream`; any other media type gets 415. Media-type parameters are accepted, so `application/json; charset=utf-8` passes. A request without a body (for example lock, pause, resume, complete, restore, accept, decline and every DELETE) needs no `Content-Type`, and any it sends is ignored.
- **Session cookie.** `lintel_session` is `HttpOnly` and `SameSite=Lax`, and lasts until sign-out.
- **Content responses.** They carry `Cache-Control: no-store`, the stored `Content-Type`, `X-Content-Type-Options: nosniff` and `Content-Disposition`. Preview responses also carry `Content-Security-Policy: sandbox`.
  - Previews use `inline`.
  - Downloads use `attachment; filename="<name>"`.
- **Never served.** The server never serves TypeScript sources, source maps, `.env` files, the lockfile, server configuration or anything outside the built browser assets and the API. Every other path answers the app shell for known screens and 404 otherwise.
- **Boot.**
  - The server starts and answers `/api/health` with 200 within 30 seconds even when storage or the directory is unreachable. It then reports them `down` and recovers as stated in Services.
  - Until PostgreSQL answers, health returns its 503 and the server keeps retrying.

### Browser support and performance (DP-09, DP-13)

- Current Chromium is the reference browser. Current Firefox and WebKit must also work.
- Viewports covered are 375x812, 768x1024 and 1280x800.
- The signed-in drive is usable within three seconds of navigation.
- A folder of 500 files renders within one second, and keyboard movement in it responds within a tenth of a second.
- The live WebSocket at `/api/events` reconnects within 5 seconds after a drop and refetches the open screen's data when it does.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`, and nothing else is needed to start the app.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package with its version and licence, plus the IBM Plex fonts and the Lucide icons. Shipped packages means the production dependency tree from `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package (same definition) and bundled asset is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1.
- IF-04: The only datastores are PostgreSQL, MinIO and PocketBase. There is no SQLite, Redis, in-memory store treated as the record, or state kept in files on disk.
- IF-05: The browser loads no script, font, style or icon from any origin other than the app's own.
- IF-06: The provided service definitions and dev credentials are left unchanged.
- IF-07: Application source for the server and the browser is written in TypeScript.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript. There is no `any` on domain values and no type assertions that hide a possible null.
- Names match the domain terms in this brief: grant, end date, fallback, bin, retention, purge, handover, lapse, lock, homing flight, storage meter, ledger.
- Each domain rule is decided in exactly one place in the source. That includes the grant end edge, effective access, a partner's access end date, hidden-folder naming, bin days left, the policy in force, upload transitions, the move winner and handover lapse.
- Folder counts, the ledger and storage totals change only inside the same transaction as the action that causes them.
- There are no abstractions with a single implementation, no dead, commented-out or unreachable code, and no defensive checks for states the rules make impossible.
- Every error leaves the server through one error shape and one check order.
- There are no features, settings or endpoints beyond this brief.
