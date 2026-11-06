# Oddment Workspace

Oddment Workspace is a local-first personal workspace for ordinary people organising their own writing and records: block documents, an infinite canvas of the same blocks, record tables with live totals, a daily journal and templates. It works with no account and no network, and every change is saved on the device first. After sign-in it uses Postgres for accounts, sessions, the device list, each account's synced change log and share links, and MinIO for attachments and imported files. Out of scope: AI features, real-time cursors, multi-user collaboration, teams, billing, marketing pages, mail, and any datastore beyond these two services. The server never fetches a URL a person supplies.

## Problem and users

People keep their writing, lists and records in cloud workspaces that stop being trustworthy away from a good connection. In one popular block workspace, offline editing leaves out uploads and sharing, and only part of a table is available offline, so table edits made there can be silently overwritten. People who move to file-based notes with third-party sync get duplicate pages, and daily notes with the template pasted in once per device. They work around it by waiting a minute after opening the app or by deleting the extra text by hand. They pay in lost trust, repeated tidying, and subscriptions that still cannot say what is safe.

Oddment saves every change on the device first, says exactly what has not yet left it, and brings two devices to the same workspace without dropping either side's words.

- **Everyday writer** (daily): writes block documents and lays the same blocks out on a canvas to think them through.
- **Record keeper** (weekly): keeps books, bills or trips in tables with live totals, and moves them in and out as CSV.
- **Two-device owner** (daily): uses a laptop and a phone, often offline, and trusts that both end up with the same workspace.
- **Link reader** (occasional): reads one document someone sent them, without an account.

## Journeys

1. **First open, no account.** A person opens Oddment in a new browser with no account. There is no sign-in screen and no spinner. They land on the document list of a starter workspace, turn the network off, reload, and everything is still there.
2. **Writing and laying out.** From the list, a writer creates a document and writes it in mixed blocks with the keyboard, then presses the view control. The blocks lift off the sheet in reading order and land as cards on the green table. They move cards, connect two, press the control again and are back on the page with focus on the same block and page order unchanged.
3. **Keeping records.** A record keeper opens the seeded table, adds a typed column and rows, filters it, and watches the row count and total change in place. They switch to the board, move a card to another column, export a CSV and import it again. A bad row is reported by number and the good rows arrive.
4. **The daily note.** A person opens today's journal note with its template body, moves to another day in the calendar, writes there and returns. Each day keeps its own note. On two signed-in devices that were offline, the same date ends as one note with both sets of writing and one template body.
5. **Second device.** A person signs up from the sign-in dialog and chooses to upload the device's workspace. On a second device they sign in, make the same choice, and see the merged workspace with nothing doubled. An edit on one device appears on the other with no reload, and the sync sentence reports each stage.
6. **Two edits, both kept.** The same block is edited on two offline devices. After they reconnect, both devices show both values under the Both kept marker. The person picks one by keyboard, and both devices settle on it.
7. **Sharing and retiring.** A writer on an account shares a document. A link reader with no account reads that document alone. The writer revokes the link and the reader's next load shows the published page. The writer later deletes the document forever, and a device that was offline cannot bring it back.
8. **Losing a phone.** A person on a laptop opens Settings and removes the lost phone from the device list. The phone's session ends at its next request, and its screen says so.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — First open main journey: exact seed on the list.** With no account, opening the landing route in a new browser shows the document list of a starter workspace holding exactly the Seed data records, with no sign-in screen and no spinner.
- **DP-02 — First open offline: reload keeps everything.** After the device is ready for offline use, a reload with no network opens the app shell, the same seeded list and every workspace route.
- **DP-03 — First open keyboard path: skip control and list order.** The first Tab stop is the skip control, which moves focus to the main region, and every list control and row is then reachable by Tab in visual order.
- **DP-04 — First open phone path: navigation closed and unreachable.** At the phone width the navigation starts closed, and while closed none of its links can be reached by Tab or found in the accessibility tree.
- **DP-05 — Block editing main journey: mixed blocks survive reload.** A document written with every text block type, a divider and a record table block shows the same blocks in the same order after a reload.
- **DP-06 — Block editing keyboard path: slash menu.** The slash menu opens from an empty block, filters as the person types, inserts the highlighted block with Enter, and closes with Escape with focus restored to the block.
- **DP-07 — Block editing keyboard path: indent and outdent.** Tab and Shift+Tab indent and outdent a list item within the published depth, and the published way out of the list leaves the editor by keyboard.
- **DP-08 — Block editing screen-reader path: saved announcement.** After an edit is durable on the device, the Announcements live region carries the published saved sentence, and never before that.
- **DP-09 — New document opens at once.** New document, online or offline, puts the document at the top of the list and opens it with focus in the title, with no spinner and no way to fail for connectivity.
- **DP-10 — Attachment block on the device.** A file added to a document while signed out shows the published waiting state and is still there after an offline reload.
- **DP-11 — Document list main journey: narrow, star, density.** Search, folder and tag narrow the list together, starring persists, and the chosen list density is remembered on this device across reloads.
- **DP-12 — Document list live update: count and rows in place.** The list and its count update in place on each keystroke, with no reload and with the scroll position kept.
- **DP-13 — Document list keyboard path: row action menu.** Every row is operable by keyboard, and its action menu works with arrow keys, Enter and Escape, with focus back on the opener.
- **DP-14 — Document list phone path: reduced row and tap targets.** At the phone width each row drops the published fields, and every control in the row meets the published tap size.
- **DP-15 — Saved filters.** The current search, folder and tag can be saved under a name, choosing the saved filter sets those controls to the saved values, and saved filters survive a reload.
- **DP-16 — Trash main journey: move and restore.** A document moved to trash leaves the list and appears on the Trash route, and Restore returns it to the list with its blocks intact.
- **DP-17 — Trash keyboard path: delete-forever dialog.** The delete-forever dialog names the document, keeps Tab inside it in both directions, closes on Escape and returns focus to the opener.
- **DP-18 — Trash live update: two tabs.** Moving, restoring or deleting a document in one tab updates a second tab of the same browser within the published tab limit, with no reload.
- **DP-19 — Trash phone path: screen and confirmation.** The Trash screen and its confirmation fit the phone width with no sideways scrolling and with every control at the published tap size.
- **DP-20 — Deleted forever leaves the device.** A document deleted forever answers the published not-found screen at its address and is gone from the list, search, Trash and the canvas after a reload.
- **DP-21 — Page and canvas main journey: the Deal.** Pressing the view control deals the blocks from the sheet to their stored canvas positions in reading order, draws connectors only after the last card lands, and updates the URL view and selected block.
- **DP-22 — Page and canvas keyboard path: shortcut and focus.** The published shortcut switches views from any control in the document view, and focus stays on the same block in both views.
- **DP-23 — Page and canvas reversing motion: no jump mid-flight.** A second press during the motion reverses every card from where it is, with no jump, and ends in the other view with the URL and focus to match.
- **DP-24 — Page and canvas reduced motion: crossfade only.** With reduced motion on, no card travels, a short crossfade swaps the views, connectors appear at once, and end positions, URL, focus and announcement match the full motion.
- **DP-25 — Canvas arrange main journey: move, connect, independence.** Cards moved and connected keep their positions after a reload, reordering the page never moves a card, and moving a card never reorders the page.
- **DP-26 — Canvas arrange keyboard path: step, move, announce.** Every card is reached in reading order by Tab, is named with its type and label, moves by arrow keys, and each move is announced.
- **DP-27 — Canvas arrange phone path: pan and pinch.** One finger pans and two fingers pinch, zoom stays inside the published range, and the point under the fingers stays fixed.
- **DP-28 — Canvas arrange fit and zoom readout.** Fit to view brings every card inside the canvas region, and the zoom readout updates in place on every zoom change.
- **DP-29 — Deterministic card slots.** A block first opened on the canvas with no stored position gets the slot given by the published grid rule.
- **DP-30 — Records main journey: rows, typed columns, totals, board and back.** Rows and columns of every type can be added, the published totals are correct, and switching to the board and back keeps the data.
- **DP-31 — Records keyboard path: grid navigation and edit.** Arrow keys move between cells, Enter edits, and Escape cancels with the old value back and focus on the cell.
- **DP-32 — Records live update: totals and open editor.** The row count and column totals update in place on a filter or cell change, and an open cell editor keeps its caret and draft while a change arrives from another tab.
- **DP-33 — Records phone path: table scrolls in its own region.** At the phone width the table scrolls sideways inside its own region and the page never scrolls sideways.
- **DP-34 — Board main journey: moving a card changes the row.** The board groups rows by a single-select column, and moving a card changes that row's value in the table.
- **DP-35 — Board keyboard path: published move keys.** The published keys move a focused card between columns, focus stays on the card, and each move is announced.
- **DP-36 — Board phone path: touch drag and move menu.** On a touch device a card moves by dragging its grip or by the published non-drag menu, and both give the same result.
- **DP-37 — CSV round trip through the visible controls.** A table exported and imported through the visible controls keeps its values, and bad rows are skipped and reported with the published row-error copy.
- **DP-38 — CSV cells cannot run as formulas.** In an exported CSV every text, single-select and heading cell beginning with one of the published characters is neutralised as Business rules states.
- **DP-39 — Journal main journey: template once and days kept.** Today's note opens with the template body once, and moving between days keeps each day's writing.
- **DP-40 — Journal keyboard path: calendar grid.** Arrow keys move through the calendar grid, Enter opens the focused day, and focus stays on that day.
- **DP-41 — Journal two devices: one note, template once.** Two signed-in offline devices that open and write the same date end with one note holding both sets of writing and the template body once.
- **DP-42 — Journal phone path: calendar and note arrangement.** At the phone width the calendar sits above the note in one column with no sideways scrolling.
- **DP-43 — Journal date reads the same everywhere.** A note's date is the plain calendar date from the creating device and shows unchanged on a device in another time zone.
- **DP-44 — Templates main journey: browse, preview, copy.** The `Use this template` control adds a copy to the workspace and moves focus to that copy's title, and editing the copy leaves the original unchanged.
- **DP-45 — Templates keyboard path: preview dialog.** The preview dialog keeps Tab inside it, and Escape closes it with focus back on the card's preview control.
- **DP-46 — Templates exact text on card, preview and copy.** The card, the preview and the copied document show the published template text character for character.
- **DP-47 — Templates phone path: one column and chip row.** At the phone width the gallery is one column, and the category chips scroll sideways inside their own row while the page does not.
- **DP-48 — Sign-in and sync main journey: upload and second device.** A person signs up in the dialog and chooses upload, and a second context that signs in and chooses upload sees the merged workspace with nothing doubled.
- **DP-49 — Sign-in and sync keep-on-device choice.** Choosing to keep the workspace on this device sends none of it to the server, and a second context on the account sees none of it.
- **DP-50 — Sign-in and sync live update: edit reaches the other device.** An edit on one signed-in context appears in the other with no reload within the published online limit, and the sync sentence moves through its states.
- **DP-51 — Sign-in and sync keyboard path: dialogs by keys only.** The sign-in dialog and the upload choice can be completed by keys alone, with Tab kept inside each dialog and focus managed as published.
- **DP-52 — Account and session API.** The session, sign-up, sign-in and sign-out endpoints answer as the API section states, and being signed out is a normal 200 state.
- **DP-53 — Attachment storage API.** An attachment is reported stored only after object storage confirms it, is readable only by its owner, and is refused at the published limits.
- **DP-54 — Both kept main journey: both values on both devices.** The same block edited on two offline contexts shows both values under the Both kept marker on both after reconnecting, with neither lost.
- **DP-55 — Both kept keyboard path: choose by keys.** One value can be chosen with keys alone, focus lands on the published place, and both contexts settle on that value.
- **DP-56 — Both kept notice and unsynced mark.** The published Both kept notice shows word for word, and a block with unsynced changes carries the notch and its accessible-name text in both views.
- **DP-57 — Both kept screen-reader path: name and announcement.** The marker is part of the block's accessible name and the resolution is announced politely with the published sentence.
- **DP-58 — Share link API.** A share link reads one document only, cannot change anything, and stops working when revoked, regenerated, expired or its document is trashed or deleted.
- **DP-59 — Delete forever beats offline edits.** A document deleted forever stays gone after an offline device reconnects with edits to it, that device shows the published notice naming it, and its text and objects leave the server.
- **DP-60 — Storage outage screen.** While object storage is unavailable an attachment stays waiting on the device with the published sentences, and it becomes stored with no reload once storage returns.
- **DP-61 — Sync outage screen.** While the sync service is unreachable every local action still works and the published sentence shows with no error styling.
- **DP-62 — Share link reader page.** A link reader with no account sees the shared document alone, read-only, and the owner's Share dialog creates and copies the link.
- **DP-63 — Revoked link page.** After the owner revokes a link or makes a new one, the old address shows the published page in place of the document.
- **DP-64 — Device list screen.** Settings lists the account's devices, marks the current one, and removes another device through a confirmation, and that device then shows the published notice.
- **DP-65 — Device removal API.** Removing a device ends its session at its next request, and another account's device id answers not-found.
- **DP-66 — Sync status sentences.** The Sync status region always shows one of the four published states with its exact sentence, and each change of sentence reaches the Announcements region.
- **DP-67 — Accessibility on the main screens.** The main screens pass automated WCAG 2.2 AA checks with no violations and show a visible focus mark on every focusable control.
- **DP-68 — Published pane layouts.** Each published viewport shows exactly the pane layout published for it.
- **DP-69 — No sideways scrolling.** No main screen scrolls the page sideways at any of the three published viewports.
- **DP-70 — Closed panels are unavailable.** A closed navigation drawer or inspector is not visible, not reachable by Tab and not in the accessibility tree, at each viewport where it can close.
- **DP-71 — Colour scheme remembered.** Light, dark and system schemes apply at once and are remembered on this device across reloads.
- **DP-72 — Health, status and boot.** The health and status endpoints answer as published on every instance, and the app boots and serves its local features with either dependency unreachable.
- **DP-73 — Server boundary.** The server is same-origin only, enforces the published size limits and never serves source files or credentials.
- **DP-74 — Credentials stay on the server.** Every service credential and URL is read from the environment at start and is never hard-coded or sent to the browser.
- **DP-75 — The green table composition.** The dark green table is the one constant surface, with one paper sheet centred on it in page view and separate paper cards on it in canvas view.
- **DP-76 — Paper, type and single accent.** Screens use hard-edged paper, a serif display face over a highly legible body face, and one accent used only for selection and focus.

## Frontend

### Screens and layout (DP-01, DP-04, DP-14, DP-19, DP-28, DP-33, DP-42, DP-47, DP-62, DP-63, DP-68, DP-69, DP-70, DP-75)

Every route below opens directly by address, online or offline, except `/s/<token>`, which needs the server.

| Route | Screen |
|---|---|
| `/` | Document list. The address stays `/`; there is no redirect. |
| `/trash` | Trash |
| `/doc/<documentId>?view=page&block=<blockId>` | Document. `view` is `page` or `canvas`; `block` is the selected block. A missing `view` means `page`. |
| `/records` | List of tables |
| `/records/<tableId>?view=table` | Table. `view` is `table` or `board`. |
| `/journal` | Today's note, at the address of `/journal/<YYYY-MM-DD>` |
| `/journal/<YYYY-MM-DD>` | That day's note and the calendar |
| `/templates` | Template gallery |
| `/settings` | Colour scheme, account and, when signed in, the device list |
| `/s/<token>` | Shared document for a link reader. It shows no workspace, navigation or sync status, and creates no workspace on the reader's device. |

Every workspace screen has a banner with the brand, the Sync status sentence and the sign-in control, the Workspace navigation, and the main region. Screens with an inspector are Document and Table.

| Viewport | Panes |
|---|---|
| 1280x800 | Navigation as a rail on the left is always shown, with no `Open navigation` button. Main sits beside it. On Document and Table an always-open inspector sits on the right, making three columns. In canvas view the inspector closes and `Open inspector` appears so the table fills the width. |
| 768x1024 | Navigation is a closed drawer behind `Open navigation`. Main fills the left. On Document and Table the inspector is always open on the right, making two columns. In canvas view it behaves as at 1280x800. |
| 375x812 | One column. Navigation is a closed drawer. The inspector is a closed full-screen sheet behind `Open inspector`. |

- **Document list:** the search and filter row is above the density choice and the count, then the rows. In List density each row shows title, folder, tags, last updated date, star and actions on one line. Card density shows the same fields on a stacked paper card with the first line of text. Grid density is a grid of those cards, with two or more columns at 768x1024 and above and one at 375x812. At 375x812 every density drops folder and tags, which are not hidden visually only but gone from the accessibility tree. Title, updated date, star and actions stay.
- **Document, page view:** a single paper sheet centred on the table, holding the title, the Document state and the blocks.
- **Document, canvas view:** the sheet is gone. Cards fill the `Canvas` region, with zoom controls and the readout in a small paper strip fixed to the region's bottom edge.
- **Table:** a header row with the table name, view choice, filter and row count, then the rows in the `Table rows` region. That region scrolls in both directions and keeps the column headings in view. Every column is at least 140 pixels wide, so the five seeded columns are wider than the screen at 375x812. The footer row holds column totals.
- **Board:** one column per select option in option order, then `No value`. The board scrolls sideways inside its own region. At 375x812 each column is close to the full width of the screen.
- **Journal:** at 1280x800 and 768x1024 the note is on the left and the calendar on the right. At 375x812 the calendar is above the note, one column, full width.
- **Templates:** a chip row above a card grid, with three columns at 1280x800, two at 768x1024, one at 375x812. The chips stay on one line. At 375x812 each chip is at least 120 pixels wide, so the four chips are wider than the screen and the row scrolls sideways inside itself.
- **Trash:** rows with title, the date it was trashed, `Restore` and `Delete forever`. At 375x812 the two buttons sit under the title.

### Public screens and controls (DP-03, DP-05, DP-13, DP-15, DP-17, DP-22, DP-26, DP-30, DP-31, DP-35, DP-36, DP-40, DP-45, DP-51, DP-55, DP-57, DP-62, DP-64)

Only these are public; everything else is free. Accessible names are exact. Each placeholder is defined once in this section or in Feedback states.

**Shell**

| Role and name | Notes |
|---|---|
| `link "Skip to main content"` | First Tab stop on every workspace screen; visible while focused |
| `banner`, `main`, `navigation "Workspace"` | Navigation holds `link` items `Documents`, `Journal`, `Records`, `Templates`, `Trash`, `Settings` |
| `button "Open navigation"`, `button "Close navigation"` | Open sets the first link as focus |
| `complementary "Inspector"`, `button "Open inspector"`, `button "Close inspector"` | |
| `button "Sign in"` | In the banner when signed out; replaced by the email text when signed in |
| `status "Sync status"` | Visible; carries the published sentence and `data-sync-state` of `synced`, `syncing`, `offline` or `error` |
| `status "Announcements"` | Polite live region; visually hidden but in the accessibility tree |
| `region "Notices"` | Visible notices; each has `button "Dismiss notice"` |

The root element carries `data-offline-ready="true"` once a reload with no network will work, and `data-colour-scheme` of `light` or `dark` showing the scheme in force.

**Document list**

| Role and name | Notes |
|---|---|
| `button "New document"` | |
| `searchbox "Search documents"` | |
| `combobox "Folder filter"` | `All folders`, then each folder |
| `combobox "Tag filter"` | `All tags`, then each tag in alphabetical order |
| `combobox "Saved filter"` | `All documents`, then saved filters |
| `button "Save this filter"`, `dialog "Save filter"`, `textbox "Filter name"`, `button "Save filter"` | |
| `radiogroup "List density"` with `radio "List"`, `radio "Card"`, `radio "Grid"` | |
| `status "Document count"` | Text `<shown> of <total> documents`. `<shown>` matches the filters; `<total>` is all documents not in trash. |
| `list "Documents"` with one `listitem` per row | |
| `link "<title>"`, `button "Star <title>"` (pressed when starred), `button "Actions for <title>"` | `<title>` shows `Untitled` when empty |
| `menu "Actions for <title>"` | `menuitem "Open"`, `menuitem "Star"` or `menuitem "Unstar"`, `menuitem "Move to trash"` |

**Trash**

| Role and name | Notes |
|---|---|
| `button "Restore <title>"`, `button "Delete forever <title>"` | |
| `dialog "Delete forever"` with `button "Delete forever"` and `button "Cancel"` | Body text is in Feedback states |

**Document**

| Role and name | Notes |
|---|---|
| `textbox "Document title"` | |
| `group "Document state"` | Text is in Feedback states |
| `button "Switch view"` | Visible text `Switch view`; pressed when in canvas view |
| `region "Table"` | The table surface; carries `data-view-state` of `page`, `dealing`, `canvas` or `gathering` |
| Tags, folder in the inspector | `textbox "Tags"` (comma separated), `combobox "Folder"` (`No folder`, then each folder), `button "New folder"`, `button "Star this document"`, `button "Share"`, `button "Move to trash"` |
| `listbox "Insert block"` with `option` items | `Paragraph`, `Heading 1`, `Heading 2`, `Heading 3`, `Bulleted list`, `Numbered list`, `To-do`, `Quote`, `Divider`, `Image`, `File`, `Record table` |
| `checkbox "Done"` | On each to-do block |
| `button "Move block"` | Drag handle on each block; Alt-key alternatives are in Interactions |
| File input labelled `Attach a file` | In Image and File blocks |
| `link "Open <table name>"` | In each Record table block |
| `group "Both kept"` with one `button "Keep <value>"` per value | `<value>` is the full text of that version |

Blocks: each block's element in either view carries `data-block-id` and `data-block-type`, the type being `paragraph`, `heading1`, `heading2`, `heading3`, `bulleted`, `numbered`, `todo`, `quote`, `divider`, `image`, `file`, `table` or, on the canvas only, `note`. List and to-do blocks also carry `data-indent` of `0`, `1` or `2`. During the Deal and the Gather exactly one visible element carries each block's id.

- On the page, text blocks are `textbox "<block name>"`; divider, image, file and table blocks are focusable `group "<block name>"`.
- `<block name>` is `<type label>: <label>`, then `, not yet synced` when the block has the notch, then `, Both kept` when it has the marker.
- `<type label>` is the option name above, or `Note`. `<label>` is the first 40 characters of the block's text, or the file name, or the table name. While a block has the marker, its text for this purpose is the first value in `Keep` order. A block with no text is named `<type label>` with no colon.

**Canvas**

| Role and name | Notes |
|---|---|
| `region "Canvas"` | Carries `data-zoom` (1 means 100 percent), `data-pan-x`, `data-pan-y` in screen pixels |
| `button "<block name>"` | Each card; carries `data-world-x`, `data-world-y` for its top-left corner |
| `button "Connect <label>"` | Shown on the selected card |
| Connectors | Each drawn line carries `data-connector-id`, `data-from` and `data-to` with block ids |
| `button "Zoom in"`, `button "Zoom out"`, `button "Fit to view"`, `button "New note"` | |
| `status "Zoom level"` | Text `<percent>%`, with `<percent>` the zoom as a whole number |

A card's on-screen left is the left of the `Canvas` region plus world x times zoom plus pan x, and its top likewise. Cards are 240 world units wide and as tall as their content.

**Records**

| Role and name | Notes |
|---|---|
| `button "New table"`, `link "<table name>"` | On `/records` |
| `textbox "Table name"` | In the table's header row |
| `radiogroup "Table view"` with `radio "Table"`, `radio "Board"` | |
| `searchbox "Filter rows"`, `button "Add row"`, `button "Add column"`, `button "Export CSV"`, `button "Import CSV"` | |
| `status "Row count"` | Text `<shown> of <total> rows` |
| `region "Table rows"` containing `grid "<table name>"` | With `columnheader`, `row`, `gridcell` |
| `gridcell "Total <column name>"` | Footer, number columns only; text is the total |
| `textbox "Edit <column name>"`, `combobox "Edit <column name>"` | The open cell editor |
| `dialog "Add column"` | `textbox "Column name"`, `combobox "Column type"` (`Text`, `Number`, `Date`, `Checkbox`, `Single select`), `textbox "Options"`, `button "Add column"` |
| `textbox "Options"` | Shown only when `Column type` is `Single select`. Options are comma separated. Each is trimmed, empty entries and repeats are dropped, and they stay in the order typed. |
| `dialog "Import CSV"` | File input labelled `Choose CSV file`, `button "Import"`, `region "Import result"` |
| `combobox "Group by"` | Single-select columns of the table |
| `group "<option>"` | A board column, with a heading and its card count |
| `button "<row title>"` | A board card. `<row title>` is the row's first text column, or `Untitled`. |
| `button "Drag <row title>"`, `button "Move <row title>"`, `menu "Move <row title>"` | Grip, and the non-drag alternative with `menuitem "<option>"` |

**Journal**

| Role and name | Notes |
|---|---|
| `grid "Calendar"` | `gridcell` named `<long date>`, then `, has a note` when one exists |
| `button "Previous month"`, `button "Next month"` | |
| `region "Journal note"` | Holds `heading` level 1 with `<long date>` and the note's blocks |

`<long date>` is weekday, month name, day and year in English, for example `Friday, October 30, 2026`.

**Templates**

| Role and name | Notes |
|---|---|
| `group "Template categories"` | `button` chips `All`, `Journal`, `Planning`, `Reading`, pressed when chosen |
| `button "Preview <template name>"` | On each card, with the name, category and description as text |
| `dialog "<template name>"` | The preview, with `button "Use this template"` and `button "Close"` |

**Accounts, sharing, settings**

| Role and name | Notes |
|---|---|
| `dialog "Sign in"` | `textbox "Email"`, password field labelled `Password`, `button "Sign in"`, `button "Create account"`, `button "Close"` |
| `dialog "Upload this workspace?"` | `button "Upload this workspace"`, `button "Keep it on this device"` |
| `dialog "Share"` | `button "Create link"`, read-only `textbox "Share link"`, `button "Copy link"`, `button "New link"`, `button "Revoke link"`, `button "Close"` |
| `radiogroup "Colour scheme"` | `radio "Light"`, `radio "Dark"`, `radio "System"` |
| `list "Devices"` | Each `listitem` holds the device name; the current one adds `This device` |
| `button "Remove <device name>"`, `dialog "Remove device"` | Dialog has `button "Remove device"` and `button "Cancel"` |
| `button "Upload this workspace"`, `button "Sign out"` | On Settings when signed in; the upload button shows only after a keep choice |

### Interactions (DP-03, DP-04, DP-05, DP-06, DP-07, DP-13, DP-17, DP-22, DP-26, DP-27, DP-30, DP-31, DP-35, DP-36, DP-40, DP-45, DP-51, DP-55)

`Mod` is Command on a Mac and Control elsewhere. A shortcut works with focus on any control in its region, buttons included.

| Region | Keys | Action |
|---|---|---|
| Whole app | Mod+Alt+N | New document |
| Document, either view | Mod+Shift+C | Switch view |
| Page, in a block | Enter | New block after this one; in a list, a new item of the same type and indent |
| Page, in a block | Backspace in an empty block | Delete the block; focus moves to the block above |
| Page, on a divider, image, file or table block | Backspace, Delete | Delete the block; focus moves to the block above |
| Page, in a block | `/` in an empty block | Open the slash menu |
| Page, in a list or to-do block | Tab, Shift+Tab | Indent, outdent |
| Page, in a list or to-do block | Escape, then Tab | Leave the list; Tab moves to the next control |
| Page, in a block | Alt+ArrowUp, Alt+ArrowDown | Move the block up or down the page |
| Canvas | Tab, Shift+Tab | Next or previous card in reading order |
| Canvas, card focused | Arrow keys | Move 10 world units |
| Canvas, card focused | Shift+Arrow keys | Move 50 world units |
| Canvas, card focused | Enter, Escape | Edit the card's text; leave editing with focus on the card |
| Canvas, card focused | C, then Tab to another card and Enter | Connect the two; connecting a joined pair removes the connector. Escape cancels. |
| Canvas, card focused | Delete | Delete a free note; blocks are not deleted from the canvas |
| Canvas | Alt+Arrow keys | Pan by 50 screen pixels |
| Canvas | `+` or `=`, `-`, `0` | Zoom in, zoom out, back to 100 percent |
| Canvas | Shift+1 | Fit to view |
| Canvas | N | New note |
| Grid | Arrow keys | Move one cell |
| Grid, cell focused | Enter | Open the editor; on a Both kept cell, move focus to its first `Keep` button |
| Grid, cell focused | Space | Toggle a checkbox cell |
| Grid, editor open | Enter, Tab | Save; Enter keeps focus on the cell, Tab moves to the next cell |
| Grid, editor open | Escape | Cancel with the old value back and focus on the cell |
| Board, card focused | Alt+ArrowRight, Alt+ArrowLeft | Move the card to the next or previous column |
| Calendar | Arrow keys | One day; Up and Down one week |
| Calendar | PageUp, PageDown | Previous or next month |
| Calendar | Enter | Open that day; focus stays on the day |
| Menu | ArrowDown, ArrowUp, Home, End | Move the highlight; arrows wrap |
| Menu | Enter, Escape | Choose, or close; focus returns to the opener in both cases unless the choice navigates |
| Any dialog or sheet | Tab, Shift+Tab, Escape | Wrap inside it; Escape closes and returns focus to the opener |

- **Skip control:** moves focus to `main`. On the list, Tab order after that is `New document`, search, `Folder filter`, `Tag filter`, `Saved filter`, `Save this filter`, density, then for each row its link, star and actions.
- **Menus:** Enter, Space or a click on the opener opens a menu with focus on its first item, which is highlighted.
- **Slash menu:** focus stays in the block while the listbox is open. The first option is highlighted when the menu opens and again after every change to the filter text, and the highlighted option carries the selected state. Typing after `/` filters the options by a case-insensitive match on the start of any word. ArrowDown and ArrowUp move the highlight and wrap.
- **Slash menu choice:** Enter turns the block into the highlighted type, removes the slash text and keeps focus in it. `Divider` and `Record table` also add an empty paragraph after the block and move focus there. `Image` and `File` move focus to the block's `Attach a file` input. With no match, Enter adds nothing and the menu stays open. Escape closes and leaves the typed text with the caret where it was.
- **Lists:** a list or to-do item indents one level under the item above, to a deepest `data-indent` of `2`. Tab on the first item of a list or at the deepest level changes nothing and keeps focus. Shift+Tab at `0` changes nothing.
- **New document:** after creation, Enter in the title moves focus to the first block, an empty paragraph.
- **Switch view:** the selected block is the last focused block, or the first block if there is none. After a switch, focus goes to the selected block's element in the new view, however the switch was started. The address is updated with `view` and `block` without adding a reload. Focusing a block updates `block`.
- **Cards by pointer:** click selects, drag moves, and double-click edits. Plain wheel pans. Control or Command with the wheel zooms, keeping the point under the pointer fixed. `Zoom in` and `Zoom out` step by a factor of 1.25 about the region's centre.
- **Cards by touch:** one finger on the table or on an unselected card pans. A tap selects. One finger on the selected card moves it. Two fingers pinch, keeping the point midway between the fingers fixed. The browser's own page zoom and scrolling do not take over inside the region.
- **Page drag:** dragging `Move block` reorders blocks; it never changes a card position.
- **Tables:** `New table` opens the new table with focus on `Table name`. `Add row` adds an empty row at the bottom with focus on its first cell. `Add column` adds the column at the right end. A click focuses a cell, and a double-click opens its editor.
- **Board by pointer and touch:** drag a card by its grip to a column. On touch, `Move <row title>` is the alternative.
- **Sign-in dialog:** focus opens on `Email`. `Sign in` and `Create account` both submit the two fields. Enter in a field means `Sign in`.
- **Upload choice:** the dialog opens right after a successful first sign-in on a device, with focus on `Upload this workspace`. Escape closes it without a choice, so the device stays as it was and the dialog comes back at the next load.
- **Both kept:** the `Keep` buttons are reached by Tab in the block's group. After a choice, focus lands on the block's textbox on the page or on the card on the canvas.
- **Two tabs:** two tabs of a browser are one device and show one workspace.

### Visual design (DP-14, DP-19, DP-67, DP-75, DP-76)

- **Composition:** a deep bottle-green table is the one constant surface behind every view. In page view a single cream paper sheet sits centred on it. In canvas view the sheet is gone and its blocks lie on the same table as separate paper cards. Lists, grids and dialogs are also paper laid on the table.
- **Colour roles:** near-black green-tinged ink for text; warm cream paper; deep bottle green for the table; a warm stone rule for thin edges and dividers; one burnt-orange accent used only for selection and focus, never for ordinary buttons, headings or errors. In the dark scheme the paper becomes a dark grey-green with cream text and the table becomes close to black-green, with the same accent.
- **Edges:** paper has hard one-pixel edges, no rounded corners beyond a barely visible softening, and no blurred shadows.
- **The notch:** a block with unsynced changes has one corner visibly cut away, like a clipped card.
- **Type:** headings use Newsreader, a bookish serif. Body text uses Atkinson Hyperlegible. Each heading step is a quarter larger than the one below, so the largest heading is close to twice the body size.
- **Density:** comfortable, with room around each block and at least 44 px for every control a finger can reach. Grid rows and list rows also meet 44 px.
- **Icons:** Lucide line icons, always beside text or with an accessible name. Status is never a lone icon.
- **Media:** all imagery is drawn in SVG or CSS. Fonts ship with the app.
- **Contrast:** WCAG 2.2 AA in both schemes. Focus shows as a thick accent ring with a pale paper edge around it, so it stands out on paper and on the dark table alike.

### Motion and effects (DP-21, DP-22, DP-23, DP-24, DP-75)

**The Deal.** This shows the writer that page and canvas are the same blocks: page order is reading order, canvas position is where each block was laid, and neither changes the other.

1. Pressing `Switch view` or the shortcut in page view sets the table's view state to `dealing`, and the view, the block in the address and focus update at once.
2. Blocks lift off the sheet in reading order, one every 30 milliseconds. Long documents close this gap so the last block starts no later than 600 milliseconds after the first.
3. Each block travels from its rect on the page to its stored rect on the canvas in about a third of a second (320 milliseconds), starting quickly and easing out to a soft stop with no overshoot. The sheet fades away over about a fifth of a second (180 milliseconds).
4. Each card's box moves steadily closer to its target on every frame, never backing away, and settles within 1 pixel of the screen position rule in Public screens and controls.
5. Connectors are absent until the last card lands, then draw in over about a fifth of a second. The view state becomes `canvas`.

**The Gather** is the same in reverse: the state is `gathering`, connectors vanish first, and blocks return to page order, in reading order, as the sheet fades back. The state becomes `page`.

**Reversal.** A press during either motion reverses at once. Every card turns back from where it is at that moment, with no jump, and finishes at the other end in no more than a third of a second. Reversing changes the view, address and focus to the new target immediately. Cards that had not started stay in place.

**Reduced motion.** With the reduced-motion setting, no card travels. A crossfade of about a tenth of a second (120 milliseconds) swaps the views, connectors appear at once, and end positions, address, focus and announcement are identical.

**Other motion.**

- Dialogs, sheets and the drawer come in within a quarter of a second and leave faster. A panel reopened during its exit stays open.
- Buttons shift by a pixel when pressed. Hover deepens the edge line.
- With reduced motion these become instant changes.
- There are no unnamed decorative loops, and nothing moves while the person is idle.

### Feedback states (DP-05, DP-08, DP-10, DP-12, DP-15, DP-16, DP-17, DP-20, DP-29, DP-30, DP-32, DP-35, DP-37, DP-46, DP-50, DP-51, DP-54, DP-56, DP-57, DP-59, DP-60, DP-61, DP-62, DP-63, DP-64, DP-66)

All published copy uses straight apostrophes and straight quotes and renders character for character. Local actions show no pending state: they finish at once. Offline is information and has no error styling; nor does the `error` sync state, which uses plain ink on paper.

`<count>` is `1 item` or `<n> items`, where `<n>` counts records with changes not yet on the account. Each of these records is one item, however many times it changed:

- a block, covering its text, type, indent, page position and card position, an assigned slot included;
- a free note;
- a connector;
- a table row;
- a document's or journal note's own details, including a document's title, folder, tags, star and trash state;
- a table's own details, covering its name and columns;
- a file not yet stored.

A record never appears twice: a block and its card are one item. A `refused` file is not counted. A seed record with no edits and no assigned slot is not counted.

| Changes not yet on the account | `<n>` |
|---|---|
| Several edits to the text of one block | 1 |
| One document title edit | 1 |
| One card moved that already had a stored position | 1 |
| One block edited and that same block's card moved | 1 |
| A document opened on the canvas with three blocks given slots | 3 |
| One of those three cards then moved | 3 |
| One block edited in an existing journal note | 1 |
| Two blocks edited in one journal note | 2 |
| Two cells edited in one table row | 1 |
| One cell edited in each of two rows | 2 |
| One new document, with its first block | 2 |
| One new journal note from the `Daily note` template | 5 |
| One file attached to a new block | 2, then 1 once the block is on the account and the file is not |

**Sync status** (always one row applies; the first match wins)

| State | When | Sentence |
|---|---|---|
| `offline` | Syncing is on, and the browser reports no network | `You are offline. <count> waiting to sync.` |
| `offline` | Not syncing, and the browser reports no network | `You are offline. This workspace is only on this device.` |
| `error` | Syncing is on, the browser reports a network, and the sync service is unavailable | `Sync is unavailable. <count> waiting to sync.` |
| `error` | Not syncing, and the sync service is unavailable | `Sync is unavailable. This workspace is only on this device.` |
| `offline` | Not syncing, service reachable | `This workspace is only on this device.` |
| `syncing` | Syncing is on with items waiting or being sent | `Syncing <count>.` |
| `synced` | Syncing is on with nothing waiting | `All changes are synced.` |

"Syncing is on" means signed in and having chosen to upload. The sync service is unavailable when the check in Business rules says so. The `syncing` sentence stays for at least half a second so it can be read. A file that cannot yet be stored keeps the `syncing` row until it is stored or refused, and the storage notice says why.

**Document state** text: `On this device`, `Waiting to sync`, `Synced`.

**Announcements.** The region takes messages in order, each staying at least one second, so none replaces another unread. Every change of Sync status sentence is announced with that same sentence.

| Trigger | Announcement |
|---|---|
| An edit is durable on this device, within one second after typing stops | `Saved on this device.` |
| Indent, outdent | `Indented.`, `Outdented.` |
| Block moved on the page | `Moved block to position <n>.` with `<n>` counted from 1 |
| Switch to canvas | `Canvas view. <n> cards.` with `<n>` all cards |
| Switch to page | `Page view. <n> blocks.` |
| Card moved | `Moved <label> to <x>, <y>.` with world coordinates |
| Connector added, removed | `Connected.`, `Connection removed.` |
| List count change | `Showing <shown> of <total> documents.` |
| Filter saved | `Saved filter "<filter name>".` |
| Row count change | `Showing <shown> of <total> rows.` |
| Board card moved | `Moved <row title> to <option>.` |
| Moved to trash, restored | `Moved "<title>" to trash.`, `Restored "<title>".` |
| Deleted forever | `Deleted "<title>" forever.` |
| Attachment waiting, stored, refused | `<file name> is waiting on this device.`, `Stored <file name>.`, `Refused <file name>.` |
| Signed in, signed out | `Signed in as <email>.`, `Signed out. This workspace stays on this device.` |
| Upload finished, after the server accepted all of it | `Workspace uploaded.` |
| Keep choice | `Keeping this workspace on this device.` |
| Both kept resolved | `Kept one version.` |
| Link created, regenerated, revoked, copied | `Link created.`, `New link created. The old link no longer works.`, `Link revoked.`, `Link copied.` |
| Device removed | `Removed <device name>.` |

**Attachment block text** (the card shows the same)

| State | Text |
|---|---|
| Waiting | `Waiting. This file is only on this device.` |
| Stored | `Stored.` |
| Refused, too large | `Refused. This file is larger than 5,000,000 bytes.` |
| Refused, account full | `Refused. Your account storage is full.` |

**Record table block text** (the card shows the same)

A Record table block shows the table name, then `1 row` or `<n> rows` counting every row, then `<column name> total: <total>` for the table's first number column, then the `Open <table name>` link. The total line is left out when the table has no number column. The block updates in place when its table changes. `<total>` follows the column total format in Business rules. For example, with the seed data at start, the block on `seed-overview` shows `8 rows` and `Amount total: 393.95`.

**Notices**

| When | Text |
|---|---|
| Storage is unavailable and a signed-in device has a waiting file | `Attachment storage is unavailable. Waiting files stay on this device.` |
| A document was deleted forever elsewhere | `"<title>" was deleted forever on another device, so your changes to it were not kept.` |
| This device was removed | `This device was removed from your account. Your work here stays on this device.` |

**Both kept**

The group shows `Both kept. Two devices changed this block. Pick the one to keep.` For a cell the sentence is `Both kept. Two devices changed this cell. Pick the one to keep.`

**Empty states and screens**

| Where | Copy |
|---|---|
| No documents at all | `No documents yet.` |
| No document matches | `No documents match.` |
| Trash empty | `Trash is empty.` |
| No slash menu match | `No blocks match.` |
| No row matches | `No rows match.` |
| Board with no single-select column | `Add a single select column to use the board.` |
| Unknown, trashed or deleted document | heading `We could not find that document.`, `link "Back to documents"` |
| Unknown path | heading `We could not find that page.`, `link "Back to documents"` |
| Share dialog, signed out | `Sign in to share this document.` |
| Share dialog, document not yet on the account | `Sync this document before sharing it.` |
| Shared page footer | `Shared from Oddment. Read only.` |
| Dead link | heading `This link no longer works.` |
| Delete dialog body | `Delete "<title>" forever? This cannot be undone.` |
| Upload dialog body | `This device holds <n> documents. Nothing leaves this device until you choose.` with `<n>` the documents not in trash |

**Pending** (each on the pressed control, which is disabled meanwhile)

`Signing in...`, `Creating account...`, `Creating link...`, `Removing...`.

**Sign-in**

| When | Copy, shown in the dialog with the dialog left open, and announced |
|---|---|
| Server unreachable, network absent or answering 503 | `We could not reach the server. Nothing has changed on this device.` |
| 4xx errors | The API section's field message beside its field, or above the buttons for `form`; focus moves to the first field in error |

**Saved filter fields** (beside `Filter name`, announced, with the dialog left open and focus on the field)

| Case | Copy |
|---|---|
| Empty name | `Enter a filter name.` |
| Name in use | `That filter name is already used.` |

**Record fields** (beside the editor or field, announced, with the editor or dialog left open)

| Case | Copy |
|---|---|
| Not a number | `Enter a number.` |
| Not a date | `Enter a date as YYYY-MM-DD.` |
| Empty column name | `Enter a column name.` |
| Column name in use | `That column name is already used.` |
| Single select with no options | `Enter at least one option.` |

**CSV import**

| Case | Copy, in `Import result` |
|---|---|
| Summary | `Imported <n> rows. Skipped <m> rows.` |
| Bad number | `Row <r>: <column> must be a number.` |
| Bad date | `Row <r>: <column> must be a date as YYYY-MM-DD.` |
| Bad option | `Row <r>: <column> must be one of the listed options.` |
| Bad checkbox | `Row <r>: <column> must be true or false.` |
| Wrong columns | `The first row must match this table's columns: <names>.` with `<names>` comma-and-space separated |
| Too large | `That CSV is larger than 1,000,000 bytes.` |

`<r>` counts data rows from 1, not counting the heading row. The summary is also announced.

## Backend

### API (DP-52, DP-53, DP-58, DP-65, DP-72)

All JSON endpoints take and return `application/json` with camelCase field names. Sync traffic is yours to design, stays same-origin and lives under `/api/`; tests never call it. The session is a cookie named `oddment_session`, HttpOnly and SameSite=Lax.

Every error body is `{"errors":{"<field>":"<message>"}}`, using the key `form` when no field applies.

**Error order, for every endpoint.** 503 if a dependency the request needs is unreachable, then 401 unauthenticated, then 404 unknown or another account's resource, including ids in paths, headers and bodies, then 409 state conflict, then 413 or 507 limits, then 422 validation. An idempotent replay returns its stored response before any state check.

Generic bodies:

- 401 `{"errors":{"form":"Sign in again."}}`
- 404 `{"errors":{"form":"Not found."}}`
- 503 `{"errors":{"form":"The server is unavailable."}}`

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/health` | | Owned by Server boundary | |
| `GET /api/status` | | 200 `{"sync":"ok","storage":"ok"}`, each `ok` or `unavailable`; always 200 | |
| `GET /api/session` | | 200 `{}` signed out or with an ended session; signed in 200 `{"user":{"id":"...","email":"..."},"device":{"id":"...","name":"..."}}` | 503 only with a cookie present |
| `POST /api/accounts` | `{"email":"...","password":"..."}` | 201 with the signed-in session body; sets the cookie and adds a device | 409 `{"errors":{"email":"That email already has an account."}}`; 422 `{"errors":{"email":"Enter a valid email address."}}`; 422 `{"errors":{"password":"Use at least 8 characters."}}` |
| `POST /api/sessions` | `{"email":"...","password":"..."}` | 200 with the signed-in session body; sets the cookie and adds a device | 401 `{"errors":{"form":"That email and password do not match."}}` |
| `DELETE /api/session` | | 204; clears the cookie and removes that device | |
| `GET /api/devices` | | 200 `{"devices":[{"id":"...","name":"...","current":true,"lastSeenAt":"<ISO 8601>"}]}` | |
| `DELETE /api/devices/<deviceId>` | | 204 | 409 `{"errors":{"form":"Use Sign out on this device."}}` for the current device |
| `PUT /api/attachments/<attachmentId>` | Raw file bytes. Headers: `Content-Type`, `X-File-Name` (percent-encoded), `X-Document-Id` | 201 `{"id":"...","name":"...","size":<bytes>,"contentType":"...","state":"stored"}`; a replay answers 200 with the same body | 409 `{"errors":{"form":"That attachment id is already used."}}` for the same id with different bytes; 413 `{"errors":{"file":"That file is larger than 5,000,000 bytes."}}`; 507 `{"errors":{"file":"Your account storage is full."}}`; 422 `{"errors":{"id":"Use a UUID."}}`; 422 `{"errors":{"documentId":"Enter a document id."}}` |
| `GET /api/attachments/<attachmentId>` | | 200 with the bytes, the stored content type and a download disposition | |
| `DELETE /api/attachments/<attachmentId>` | | 204; the object is gone | |
| `GET /api/documents/<documentId>/share` | | 200 `{"share":{"token":"...","url":"...","expiresAt":"<ISO 8601>"}}` or `{"share":null}` | |
| `POST /api/documents/<documentId>/share` | `{}` | 201 with the `share` object's fields at top level; an active link dies | |
| `DELETE /api/documents/<documentId>/share` | | 204 | 404 when there is no active link |
| `GET /api/shared/<token>` | No session needed | 200 `{"title":"...","blocks":[{"id":"...","type":"...","text":"...","indent":0,"checked":false}],"attachments":[{"id":"...","name":"...","contentType":"..."}]}` | 404 `{"errors":{"form":"This link no longer works."}}` for any dead or unknown token |
| `GET /api/shared/<token>/attachments/<attachmentId>` | No session needed | 200 with the bytes, for attachments of that document only | Same 404 |
| `POST`, `PUT`, `PATCH`, `DELETE` on `/api/shared/<token>` or anything under it | | | 405 `{"errors":{"form":"This link is read only."}}` |

The size limit of 5,000,000 bytes itself is allowed. An unknown `/api/` path answers 404 with the generic body. Attachment ids are created by the device. A file may reach the server before its document, so an `X-Document-Id` the account has not yet seen is accepted. Document ids are scoped to the account, so one account's id never reaches another account's document.

### Business rules (DP-02, DP-05, DP-09, DP-15, DP-18, DP-20, DP-25, DP-29, DP-30, DP-32, DP-37, DP-38, DP-39, DP-41, DP-43, DP-48, DP-49, DP-50, DP-53, DP-54, DP-55, DP-56, DP-58, DP-59, DP-60, DP-61, DP-65)

**Durability.** Every edit is written to device storage that survives reloads and works offline before the interface confirms it. A reload while offline loses nothing. Blocks hold plain text.

**Sign-in state.** Before sign-in the workspace stays on the device. Being signed out is never an error and nothing redirects to sign-in. Sign-out leaves the workspace on the device, and a later sign-in on that device for the same account does not ask again.

**First sign-in on a device.** Nothing leaves the device until the person chooses.

- Upload merges this device's workspace into the account and starts syncing. It never loses or doubles a document, because every record keeps one id everywhere.
- Seed records keep their published ids on every device. Upload puts each seed record on the account if the account has never held it, edited or not. Once the upload finishes, every document on the device is on the account and shows `Synced`.
- An unedited seed record never changes what the account already holds. It does not overwrite the account's edits. A seed document the account deleted forever stays deleted and leaves the device with no notice, since no writing is lost.
- Keep leaves the device working with syncing off. Nothing from the device goes to the account and nothing from the account comes down, until `Upload this workspace` on Settings.

**Sync timing.** A change is sent as soon as it is saved, and a syncing device also checks every 5 seconds, including checking status with `GET /api/status`. Two online devices show each other's change within 10 seconds. After both reconnect, both show the same workspace within 10 seconds. Two tabs of a device show each other's change within 2 seconds. Any account's rebuilt device gets the whole workspace from the server.

**Sync service unavailable.** The sync service is unavailable when, with the browser reporting a network, `GET /api/status` fails or says `"sync":"unavailable"`, or a sync request fails or answers 503. Every device makes this check at load and every 5 seconds, signed in or not. Recovery needs no reload.

**Convergence.** After reconnecting, both devices show identical documents, block order, canvas positions and table rows.

- The same block's text, a table cell or a document title changed on two devices from the same starting value keeps both values under the Both kept marker until the person picks one. A title's marker shows on the page, under the title.
- Nothing is silently overwritten. A local edit to a marked item is not offered until a choice is made, so a marked block's textbox shows the first value in `Keep` order and is read-only.
- The `Keep` buttons run in alphabetical order of value, ignoring case and then by exact text, so both devices match. The chosen value syncs like any change. If two devices pick differently, the pick that reaches the account first stands.
- Blocks inserted on two devices are all kept, in the same order on both.
- A block deleted on one device and edited on another comes back with the edit.
- For block order, card positions, connectors, star, folder and tags, the change that reaches the account last wins, except that an automatic slot follows the Card slot rule.

**Document change state.** `On this device` > `Waiting to sync` > `Synced`.

- A signed-out or keep-choice device stays at `On this device`.
- On a syncing device a saved change moves to `Waiting to sync`, and to `Synced` only after the account confirms it.
- A new edit restarts at `On this device`. No other move is legal.
- The notch and `, not yet synced` appear on a block on a syncing device from its first saved change until the account confirms it.

**Attachment state.** `waiting` > `stored` or `waiting` > `refused`.

- A file enters `waiting` on the device. Signed out or keep-choice, it stays there.
- On a syncing device it is sent, and a failed or 503 send stays `waiting` and retries at every 5-second check, including with no reload.
- `stored` appears only after a 200 or 201 reply. The server gives that reply only after object storage confirms the object.
- 413 and 507 lead to `refused`, which is final for that file.
- Files over 5,000,000 bytes are refused on the device as well.

**Share link state.** `active` > `revoked`, and revoked never returns.

- One document has at most one active link. A new link revokes the old one at once. An expired link counts as revoked.
- Links expire `SHARE_LINK_SECONDS` seconds after creation, default 604800.
- Tokens hold at least 128 bits of randomness. `url` uses the request's origin and the `/s/<token>` route.
- A link answers its 404 while the document is in trash and works again after restore.
- A link shows the account's latest synced content of that one document.

**Who can share.** The Share dialog offers `Create link` for any document the account holds, edited or not, and unedited seed documents are shared like any other after upload. For a document the account does not yet hold, including every document on a keep-choice device, the dialog shows the not-yet-on-the-account copy from Feedback states and the share endpoints answer the generic 404.

**Storage quota.** An account's stored bytes may reach `ACCOUNT_STORAGE_BYTES`, default 50,000,000. An upload that would pass it is answered 507; reaching it exactly is allowed.

**Delete forever.** It removes the document from search, the canvas, Trash and any share link, and it beats any offline edit from any device. Once it reaches the account:

- every attachment object of that document is deleted from storage;
- no Postgres row holds its title or block text; only its id may remain, so it cannot return;
- an offline device that reconnects drops the document and its edits and shows the published notice;
- a tab with it open goes to the list.

On a signed-out device it is final on that device. Move to trash keeps everything and hides the document from the list, search and direct address.

**Document list.** Rows are ordered by most recent content change first, with ties in seed order. Starring is not a content change. Search is a case-insensitive substring match on title, tags and block text of documents not in trash. A row shows when it matches the search, the folder, the tag and, when on, the star condition. Journal notes and templates are not in the list. Density, colour scheme and saved filters stay on this device and do not sync.

**Saved filters.** A saved filter stores four values: search, folder, tag and star condition.

- Choosing a saved filter replaces all four current values with the stored ones, and the search and filter controls show them. It does not narrow on top of them.
- Choosing `All documents` empties the search, sets `All folders` and `All tags`, and turns the star condition off.
- Changing search, folder or tag afterwards changes only that value. The star condition stays, and `Saved filter` keeps showing its choice until another is chosen.
- `Save filter` stores the current four values under the name, closes the dialog, shows the new filter as chosen and returns focus to `Save this filter`.
- The name is trimmed. An empty name, or one matching an existing name when case is ignored, is rejected with the Feedback states copy.
- New filters follow the existing ones in the order saved. A reload starts at `All documents`.

**Canvas.** Positions are world coordinates. Zoom runs from 25 to 400 percent inclusive. Zooming by pointer or pinch keeps the point under it fixed. Fit to view sets zoom and pan so every card, free notes included, is inside the region with 40 screen pixels spare, within the zoom range. A new document's canvas opens at 100 percent with pan 40, 40. Zoom and pan stay on this device. Reordering blocks on the page never moves a card, and moving a card never reorders the page. Reading order is blocks in page order, then free notes oldest first. Free notes exist only on the canvas. A block's text is one record in both views.

**Card slot rule.** Whenever a document opens in or switches to canvas view, and whenever a block arrives while it is showing there, each block with no stored position gets a slot, in reading order, and that slot is stored as the block's position. With `<i>` counting these blocks from 0, and `<right>` being the largest stored x of any card plus 280, or 0 when no card has a position: x is `<right>` plus 280 times the whole part of `<i>` divided by 5, and y is 200 times the remainder of `<i>` divided by 5.

- Assigning a slot is a syncable change to that block's card position, on every block that gets one, whether or not the person then touches its card. On a syncing device, each such block adds one item to `<count>`, carries the notch and `, not yet synced`, and moves its document's Document state, until the account confirms it. On a signed-out or keep-choice device it stays at `On this device` with no notch, as for any other change.
- A slot is not a content change: it leaves list order and the updated date alone and gives no `Saved on this device.` announcement.
- A slot only fills an empty position. If the account already holds a position for that block when the slot arrives, the slot is dropped and the device takes the account's position. This holds whichever change reaches the account last, so a person's move is never undone by another device's slot.
- A seed record whose only change is a slot still counts as unedited under First sign-in on a device, apart from that slot filling an empty position on the account.

**Records.**

- A new table comes from `New table` or from choosing `Record table` in the slash menu, which always creates a new table and binds the block to it for good. Its name is `Untitled table`, or `Untitled table <n>` with `<n>` the lowest number from 2 upward that leaves the name unused. It has a text column `Name`, a number column `Amount` and no rows, and it appears on `/records`.
- Deleting a Record table block leaves its table on `/records`. Clearing `Table name` puts the previous name back.
- A row count is the rows matching the filter. Filter is a case-insensitive substring match on any cell's text.
- A valid number is an optional minus sign, digits and an optional decimal part, with no thousands separator or currency sign, and it is rounded to two decimals when saved. Number cells show two decimals.
- A column total is the sum of the number column over rows matching the filter, shown with two decimals and no thousands separator, with empty cells counted as 0.
- Dates are real calendar dates written `YYYY-MM-DD`. Checkbox values are true or false.
- An edit in another tab to a cell with an open editor leaves the editor and draft alone, and saving then wins as the newer action.
- Moving a board card sets that row's select value; moving to `No value` empties it.

**CSV.**

- Export downloads `<table name>.csv`, UTF-8, with a heading row of column names, all rows regardless of filter, and standard quoting. Checkbox cells are `true` or `false`. Number cells are written with two decimals, exactly as the cell shows them, for example `64.20`, and date cells as `YYYY-MM-DD`. Number and date cells never get an apostrophe.
- Any text cell, single-select cell or heading that begins with `=`, `+`, `-` or `@`, or with one or more apostrophes followed by one of those characters, is written with one extra leading apostrophe.
- On import, the same check runs in reverse on headings, text cells and single-select cells: one leading apostrophe is removed when one of those characters, or more apostrophes and then one of those characters, follows it. This happens before headings are matched and before option values are checked, so a table's own export always imports and a round trip gives back the original text.
- Import needs the heading row to name exactly the table's columns in any order, and appends rows. Good rows are added and bad rows are skipped. An empty cell is an empty value, and false in a checkbox column.
- The size limit of 1,000,000 bytes itself is allowed.

**Journal.** A note's date is a plain calendar date taken from the device when the note is created. It is stored and shown with no time-zone conversion, so it reads the same on every device. Opening a day with no note creates it from the `Daily note` template; moving the calendar highlight does not. Each date has one note. Two devices that created the same date end with one note holding both sets of writing and the template body exactly once. If both wrote in the same block, both values show under the Both kept marker inside that note.

**Templates.** Using a template copies its blocks into a new document titled with the template's name, at the top of the list, with no folder or tags. The copy shares nothing with the original. Templates cannot be edited.

**Devices.** Each sign-in or sign-up adds a device, named `Device <n>`, counting that account's devices from 1 without reusing a number. Removing a device ends that device's session at its next request: its `GET /api/session` answers `{}`, and other account requests answer 401. Its workspace stays on it with syncing off, and it shows the published notice within 10 seconds.

**Passwords.** They are stored only as a salted slow hash.

**Seed start.** The workspace is created on the device at first open and only then. Reloading never reseeds, and deleting a seeded record never brings it back.

### Services (DP-53, DP-59, DP-60, DP-61, DP-72)

**Postgres** holds accounts, sessions, the device list, each account's change log, and share links. Apply the schema idempotently at every start and again when Postgres returns.

- Down: endpoints that need it answer the generic 503. `GET /api/session` with no cookie still answers 200 `{}`, and `GET /api/status` says `"sync":"unavailable"`.
- The UI shows the matching Sync status sentence and every local feature keeps working. A sign-in attempt shows the sign-in failure copy from Feedback states.

**MinIO** holds every attachment object at key `attachments/<userId>/<attachmentId>`, in the bucket from `S3_BUCKET`, private.

- Imported CSV content is applied to the table on the device and is not stored as an object.
- Down: `PUT` and `GET` on attachments answer the generic 503, nothing is recorded as stored, `GET /api/status` says `"storage":"unavailable"`, and sync is unaffected.
- The UI keeps the file `waiting`, shows the storage notice from Feedback states, and recovers with no reload once a retry succeeds.

### Seed data (DP-01, DP-05, DP-15, DP-30, DP-34, DP-39, DP-46)

Every seeded person, place of business and record is invented. The list order below is the first-open order. Document list density starts at `List`, colour scheme at `System`, and Trash is empty. The one folder is `Plans`. Saved filters at start: `All documents`, which is the starting choice, and `Starred`, which stores an empty search, `All folders`, `All tags` and the star condition on.

| Id | Title | Folder | Tags | Starred |
|---|---|---|---|---|
| `seed-welcome` | Welcome to Oddment | none | guide | yes |
| `seed-lisbon` | Trip to Lisbon | Plans | travel | yes |
| `seed-shelf` | Kitchen shelf ideas | Plans | home | no |
| `seed-overview` | Household overview | none | home | no |
| `seed-note-05` | Library books to return | none | reading | no |
| `seed-note-06` | Birthday list | none | family | no |
| `seed-note-07` | Garden jobs | none | home | no |
| `seed-note-08` | Recipes to try | none | home | no |
| `seed-note-09` | Car notes | none | home | no |
| `seed-note-10` | Books I lent | none | reading | no |
| `seed-note-11` | Packing list | Plans | travel | no |
| `seed-note-12` | Questions for the dentist | none | family | no |

Block ids are `<document id>-<n>`, counting from 1 in page order.

`seed-welcome`, all with canvas positions:

| n | Type | Text | x, y |
|---|---|---|---|
| 1 | Heading 1 | Everything here lives on this device | 0, 0 |
| 2 | Paragraph | Write first and worry later. Each change is saved here before anything else happens. | 0, 140 |
| 3 | Heading 2 | Try these | 320, 0 |
| 4 | To-do, not done | Switch this page to the canvas | 320, 140 |
| 5 | To-do, done | Open this document | 320, 280 |
| 6 | Quote | The table stays put. The blocks move. | 640, 0 |
| 7 | Divider | | 640, 180 |
| 8 | Paragraph | Sign in only if you want a second device. | 640, 320 |

It also has free note `seed-welcome-note` reading `This note is only on the canvas.` at 0, 320, and one connector `seed-welcome-link` from block 2 to block 4.

`seed-lisbon`, no canvas positions: Heading 1 `Three days in Lisbon`; Bulleted `Tram 28 before nine` (indent 0); Bulleted `Walk down through Alfama` (indent 0); Bulleted `Stop at the viewpoint` (indent 1); Heading 2 `Still to book`; To-do not done `Ferry to Cacilhas`; To-do done `Room near the river`; Quote `Bring shoes with grip.`

`seed-shelf`: Paragraph `Measure the alcove twice.` at 0, 0; Heading 2 `Options` at 300, 100; Numbered `Oak board on brackets` and Numbered `Steel rail with hooks`, both with no position.

`seed-overview`, no positions: Paragraph `Bills for the month, pulled from the table.`; Record table block on `seed-bills`.

Each `seed-note-*` holds one paragraph, no positions:

| Id | Text |
|---|---|
| `seed-note-05` | Two books are due back on Saturday. |
| `seed-note-06` | Ask what size the new gloves should be. |
| `seed-note-07` | Cut back the lavender before the first frost. |
| `seed-note-08` | Lentil soup with lemon, and the plum cake. |
| `seed-note-09` | Tyres were last rotated in the spring. |
| `seed-note-10` | The atlas is with the neighbours at number 12. |
| `seed-note-11` | Adapters, rain jacket, and the blue notebook. |
| `seed-note-12` | Ask about the crown on the upper left. |

Table `seed-bills`, named `Household bills`. Columns: Name (text), Amount (number), Due (date), Paid (checkbox), Category (single select, options Home, Travel, Leisure). The Amount total at start is `393.95`.

| Name | Amount | Due | Paid | Category |
|---|---|---|---|---|
| Electricity | 64.20 | 2026-11-03 | false | Home |
| Water | 31.75 | 2026-11-05 | true | Home |
| Broadband | 39.00 | 2026-11-07 | false | Home |
| Library fine | 2.40 | 2026-11-09 | true | Leisure |
| Train pass | 88.00 | 2026-11-12 | false | Travel |
| Gym | 27.50 | 2026-11-15 | false | Leisure |
| Ferry tickets | 46.10 | 2026-11-21 | false | Travel |
| Boiler service | 95.00 | 2026-11-28 | false | Home |

Journal: one note, for the device's date at first open, created from `Daily note`.

Templates, in gallery order. `Blocks` are in page order; a paragraph marked empty has no text.

| Name | Category | Description | Blocks |
|---|---|---|---|
| Daily note | Journal | A short note for one day. | Heading 2 `Today`; To-do `One thing to finish`; Heading 2 `Notes`; Paragraph empty |
| Weekly review | Journal | Look back at the week in ten minutes. | Heading 2 `What went well`; Paragraph empty; Heading 2 `What to change`; To-do `Pick one change for next week` |
| Meeting notes | Planning | Who came, what was decided, what is next. | Heading 2 `Who was there`; Bulleted `Name`; Heading 2 `Decisions`; To-do `Next step` |
| Trip plan | Planning | Travel, beds and bookings on one page. | Heading 2 `Getting there`; Heading 2 `Where to stay`; To-do `Book the first night` |
| Book notes | Reading | Keep the lines and thoughts from a book. | Heading 2 `Why I picked it up`; Quote `A line worth keeping`; Heading 2 `What stays with me` |
| Reading list | Reading | Books to read next, ticked off as you go. | To-do `First book on the list`; To-do `Second book on the list` |

## Technical requirements

### Deployment (DP-72)

Node.js 22 with npm is available; write the product in TypeScript. Put `/app/run.json` at the app root with string fields `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run serve"}
```

Bind `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set. Nothing may be left in `/app` that breaks copying it: no virtual environment and no absolute symlinks.

### Configuration and secrets (DP-74)

Read these at start, never hard-code them, and never send them to the browser: `DATABASE_URL`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. `SHARE_LINK_SECONDS` and `ACCOUNT_STORAGE_BYTES` are optional, with the defaults Business rules gives.

The environment provisions the database named by `DATABASE_URL` and the bucket named by `S3_BUCKET` for every running instance, each starting empty. The app applies its schema there and never needs to create the database or the bucket.

### Server boundary (DP-72, DP-73)

- `GET /api/health` always answers 200: `{"status":"ok"}` normally and `{"status":"unavailable"}` when Postgres or object storage cannot be reached, never 503, and it answers within two seconds.
- The app boots with Postgres or storage unreachable, including when `DATABASE_URL` or `S3_ENDPOINT` is an address that refuses connections or is not a database URL, such as `http://127.0.0.1:9`. The shell and local features load there with no account. It keeps trying and starts using the dependency once it answers.
- Same-origin only: no cross-origin headers, and a state-changing `/api/` request with a foreign `Origin` answers 403 `{"errors":{"form":"Cross-origin requests are not allowed."}}`.
- JSON bodies may be up to 5,000,000 bytes, that size allowed. Beyond it the server answers 413 `{"errors":{"form":"That request is too large."}}`.
- Never serve source files, the run manifest, package files, environment files or credentials; those paths answer as an unknown path. Any path outside `/api/` that is not a built asset serves the app.
- Serve attachments with the stored type, a download disposition and no content sniffing. The server never fetches a URL a person supplies.

### Browser support and performance (DP-02, DP-12, DP-21, DP-67)

Cover current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800, with touch at the phone width. No font, script or style loads from another origin.

- The list is usable within two seconds of first open.
- The device is ready for offline use within three seconds of first open.
- List and table filters respond within a fifth of a second.
- The Deal starts within a tenth of a second of the press and keeps a steady frame rate on a 30-block document.

## Working rules

- IF-01: `/app/run.json` has string `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`.
- IF-02: `THIRD_PARTY_NOTICES.md` at the app root lists every shipped package with its version and licence; shipped packages means the production dependency tree from `npm ls --omit=dev --all --json`.
- IF-03: Shipped packages and bundled assets use only MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, CC0-1.0 or OFL-1.1 licences.
- IF-04: The product uses no datastore or external service beyond the provided Postgres and MinIO and the browser's own device storage.
- IF-05: The provided service configuration and credentials are left as given.
- IF-06: `/app` holds no virtual environment and no absolute symlinks.
- IF-07: The source language is TypeScript, and fonts and icons ship with the app and load from its own origin.

## Engineering standards

- The source is idiomatic, strictly typed TypeScript, with no untyped escape hatches in domain code.
- Names match the domain terms in this brief: block, card, world position, change, both kept, attachment, share link, device.
- No abstraction has a single implementation unless an external boundary needs it.
- Each domain rule, such as a state transition, the card slot rule or a derived total, is decided in exactly one place in the source.
- There is no dead, commented-out or unreachable code, and no defensive check for an impossible state.
- All API errors use the one error shape from this brief, built in one place.
- The source has no features beyond this brief.
