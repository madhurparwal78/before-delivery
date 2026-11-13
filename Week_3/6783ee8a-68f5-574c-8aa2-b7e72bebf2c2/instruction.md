# Wrenmoor Software Brackenpad

Brackenpad is a small hosted notebook service from Wrenmoor Software, a one-person company. It is for people who think in code: analysts, students, teachers, hobby data tinkerers and independent researchers. They write notebooks of JavaScript code cells and markdown cells, run them, and bring one or two other people in to edit and run them too. Each open notebook tab runs its code cells in its own kernel, a dedicated Web Worker inside the browser. No code ever runs on the server. One execution counter per notebook lives on the server and every collaborator shares it. Outputs, counts, cell edits, presence and kernel status reach everyone who has the notebook open. Checkpoints are stored as exact snapshots, compared cell by cell and reverted. Notebooks are imported and exported in a published subset of the open notebook JSON format, version 4. The backend uses PostgreSQL as the system of record, MinIO for checkpoint snapshots, original imported files, exported files, working copies and markdown image attachments, Mailpit for sign-up verification and share invitations, and Meilisearch for the file browser's search. The following are out of scope: terminals, extensions, widgets, AI assistants, any language other than JavaScript, server-side execution, outside sign-in providers, paid plans and billing, and any datastore beyond these four services.

## Problem and users

People who work in code usually write notebooks alone. Later, one or two others need to edit and run them. Self-hosting a notebook server with real-time collaboration is still a prototype-grade setup. Hosted team notebooks charge per editor every month and limit free projects to a handful. Merging notebook files through version control produces conflicts over execution counts and metadata even when people edited different cells. The hardest part is runtime state: one person re-runs a cell and quietly changes a value that another person's cell depends on. Today people cope with emailed copies, lost outputs, "which version is right?" threads and seats they cannot justify. Brackenpad keeps one shared notebook with one shared execution counter, visible presence, cell locks, exact checkpoints and an open file format, so a notebook never gets trapped.

- **Notebook owner** (daily): creates notebooks, writes and runs code and markdown cells from the keyboard, saves checkpoints, compares and reverts, imports and exports files, decides who may edit or only view, and finds any notebook by searching its title, cells and headings.
- **Collaborator** (weekly, an editor): edits and runs cells live in a notebook shared with them, sees the owner's presence marker and queued runs, and never silently overwrites another person's cell edit.
- **Viewer** (occasional): reads a shared notebook with its rendered markdown, table of contents and outputs, and cannot edit or run anything.
- **Founder operator** (daily): keeps checkpoint storage and invitation mail healthy, sets the published limits through environment variables, and sees from the health endpoint when storage is down, without reading anyone's notebook contents.

## Journeys

1. **Build a notebook from the keyboard.** Start: the owner is signed in, and a notebook with one empty code cell is open in command mode. The owner presses B, A, M and Y to add cells and change their types, Enter to type, Escape to leave, D,D to delete and Z to bring the cells back. End: the cells sit in the order the owner built, and "Notebook status" has announced each mode change.
2. **Run cells together.** Start: the owner and an editor have the same notebook open in two browsers. The owner runs cells with Shift+Enter, Ctrl+Enter and Alt+Enter. One cell ends in an expression, one logs to the console and one calls display(). End: both screens show the same execution counts and outputs, and the editor never reloaded.
3. **Stop runaway code.** Start: the owner has a notebook with a variable already set, and an editor is watching. The owner runs an endless loop, which stops at the execution time limit. The owner runs another loop and interrupts it with I,I, so the variable still exists. Then the owner restarts with 0,0 and confirms, and the variable is gone. End: the editor saw each kernel status as it happened.
4. **Write and navigate prose.** Start: the owner has an empty notebook. The owner writes markdown with headings, math, a table, raw HTML and links. End: only allowed markup renders, for the viewer too. The table of contents renumbers as headings change, and activating an entry moves focus to that heading's cell.
5. **Conflict without loss.** Start: the owner has the same notebook open in two tabs. One tab saves a change to a cell while the other tab holds an unsaved edit to the same cell. End: the second tab's save is refused and the conflict dialog keeps focus. "Reload latest" shows the first tab's text.
6. **Checkpoint, compare and revert.** Start: the owner and an editor have a notebook open. The owner saves a checkpoint, changes cells, compares the checkpoint with the current notebook and reverts. End: the comparison showed exact tags and counts, a "Before revert" checkpoint appeared, and the editor's screen shows the checkpoint's cells.
7. **Bring a notebook in and take it out.** Start: the owner is in the file browser with three files at hand. An oversized file is refused before it is checked. A malformed file lists each error at its JSON path. A good file imports with its outputs intact. End: "Download original" returns the uploaded bytes and the export reads back with the same cells.
8. **Share, read on a phone, and survive an outage.** Start: the owner invites an editor and a viewer by email. Each opens the invitation from their inbox. The viewer reads on a phone and the editor runs a cell from the phone's cell action sheet. Later, storage becomes unreachable during autosave. End: the edits stay on screen, are saved once storage answers again, and the notebook can be found by search.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health** /app/run.json installs, builds and serves the app on port 4173 (or APP_PUBLIC_PORT), and GET /api/health answers 200 with the storage state described under API.
- **DP-02 — Published limits** Every limit in the Business rules table is read from its environment variable at start and published by GET /api/config, and the browser applies the client-side limits from that response.
- **DP-03 — One error order** Every endpoint applies the single error precedence and the single error body shape stated under API.
- **DP-04 — Grading setup route** When BRACKENPAD_GRADING=1, POST /api/grading/seed creates verified users, notebooks, cells, outputs, checkpoints and active shares in one call and returns their ids and session cookies; otherwise it answers 404.
- **DP-05 — Server boundary** The server is same-origin only, enforces the request size limits, never serves source, configuration or credentials, and keeps serving when a service is unreachable at boot, as stated under Server boundary.
- **DP-06 — Credentials from the environment** Every service URL and credential is read from the environment variables named under Configuration and secrets and never appears in source, built assets or any response.
- **DP-07 — Landing page in the house language** The landing page shows the workspace header with menus, the Brackenpad mark with glyph cloud, the landing tagline, the recent notebook cards, the checkpoint cascade row, the feature grid, the disc arc, the wordmark wall, the format and plan cards and the two-tone footer with the sign-up form, as described under Visual design.
- **DP-08 — Working screens in the house language** The file browser, notebook, dialogs, empty states, error outputs and outage banner use the same alternating bands, typefaces, single orange accent, bordered cards and embossed buttons described under Visual design.
- **DP-09 — Quiet motion with a reduced-motion path** The hero fades in once, buttons and cards answer hover almost instantly, cell insert, move and delete animate briefly, nothing loops, and reduced motion shows every end state at once, with the timings given under Motion and effects.
- **DP-10 — Three viewports without overflow** At 375x812, 768x1024 and 1280x800 every screen fits the viewport width with no horizontal scrolling, and every control people tap is at least 44 px in both directions.
- **DP-11 — Building a notebook from the keyboard** The owner builds, retypes, deletes and restores cells using only the published command-mode keys, and every mode change is announced.
- **DP-12 — Published keyboard shortcuts** Every key and double press listed under Interactions does exactly what is published there whichever notebook control has focus, including the command palette.
- **DP-13 — Announced mode, kernel and run results** The polite live region "Notebook status" announces each mode change in the tab where it happens, and each kernel status change and run result on every open screen, with the exact words in Feedback states.
- **DP-14 — Running cells seen live** The owner runs cells in the three published ways and a collaborator with the notebook open sees the execution counts, outputs and kernel status arrive without reloading.
- **DP-15 — JavaScript kernel evaluation** Each open notebook tab runs code cells in its own browser kernel following the declaration, result, console and display() rules under Business rules, and no code runs on the server.
- **DP-16 — One shared execution counter** Each started run that ends takes the next number from the notebook's single server counter, simultaneous results get distinct consecutive numbers, and a replayed result returns its stored number.
- **DP-17 — Errors and Run all** The owner runs a cell that throws and then Run all, and sees the error's name, message and line, and every later code cell marked as not run.
- **DP-18 — Error outputs and skipped cells** An uncaught error becomes an error output with its name, message and line number within the cell, and Run all leaves the later code cells not run with the published label.
- **DP-19 — Runaway code** The owner stops an endless loop by the time limit and by I,I with variables kept, restarts with 0,0 and finds them gone, while a collaborator sees each kernel status.
- **DP-20 — Time limit, interrupt and restart** A run stops at the published execution time limit or on interrupt with the kernel's variables kept, restart clears every variable but keeps stored outputs, and kernel status follows the published state machine.
- **DP-21 — Markdown and contents** The owner writes headings, math, a table, raw HTML and links, sees only allowed markup rendered for every role, and navigates by the live table of contents.
- **DP-22 — Allowlisted markdown** Markdown cells render headings, tables and math, keep only the published tags, attributes and link schemes, and strip everything else the same way for every role.
- **DP-23 — Live table of contents** The "Table of contents" navigation lists every heading with its hierarchical number, updates as markdown cells change, and moves focus to a heading's cell when an entry is activated.
- **DP-24 — Cell surgery** The owner splits, merges, extends a selection, cuts, pastes and drags cells, and a collaborator sees the same order live.
- **DP-25 — Split, merge and one cell order** Splitting a cell and merging the halves restores the original source exactly, and every insert, move, paste, delete and restore keeps one server-ordered sequence that every open screen shows.
- **DP-26 — Presence and locks** Two collaborators see each other's presence markers and new cells live, and a cell one of them is editing is locked for the other with the published copy.
- **DP-27 — Presence expiry and cell locks** The server drops a presence marker after the published presence timeout, and exactly one open tab at a time may edit a cell while others see it locked.
- **DP-28 — Stale save** The owner saves from a stale tab, gets the conflict dialog with focus kept inside it, and "Reload latest" shows the other tab's work.
- **DP-29 — Revision conflicts** Every cell save carries its base revision, and a stale one answers 409 without changing anything and opens the conflict dialog, as qualified under Business rules.
- **DP-30 — Checkpoint compare and revert** The owner saves a checkpoint, changes cells, compares and reverts, and a collaborator sees the checkpoint's cells restored live.
- **DP-31 — Checkpoints confirmed by storage** A checkpoint is listed as Saved only after its MinIO put succeeds, at most the published number are kept, and a storage failure lists nothing.
- **DP-32 — Compare and revert rules** Compare pairs cells by id with the published tags and counts, and revert writes a "Before revert" checkpoint first, then restores the checkpoint's cells for the whole notebook or one cell.
- **DP-33 — Checkpoint diptych** The checkpoint panel stacks up to three checkpoint windows in a cascade, and Compare moves the chosen one into a side-by-side split with the timings and reduced-motion path under Motion and effects.
- **DP-34 — Import and export** The owner is refused an oversized file, sees each format error at its JSON path, imports a good file with outputs intact, downloads the original and reads back the export.
- **DP-35 — Import limits and error paths** An import above the published size answers 413 before any format check, and a malformed file answers 422 listing every error at its JSON path with the published messages.
- **DP-36 — Stored as imported** An imported file's bytes come back unchanged from Download original, its outputs are kept exactly as imported, and export writes the published format with ids, types, sources, outputs and counts.
- **DP-37 — Phone notebook** At 375 px a viewer reads a notebook and its contents drawer, and an editor runs and moves a cell from the touch cell action sheet, with reduced motion removing cell transitions.
- **DP-38 — Phone layout and cell action sheet** Below 768 px the notebook is one column, the contents move into a drawer, each cell's "Cell actions" button opens a bottom sheet, and a closed drawer or sheet cannot be reached.
- **DP-39 — Sharing by invitation** The owner invites an editor and a viewer, each opens the notebook from the invitation in their inbox, the viewer cannot edit or run, and the editor runs a command from the palette.
- **DP-40 — Accounts and invitation mail** Sign-up sends a verification message and sharing sends an invitation through Mailpit, and an invitation grants access only when the invited account opens its link.
- **DP-41 — Viewer and editor permissions** A viewer reads rendered cells, contents and outputs and appears in presence but cannot edit or run, every write by a viewer except the presence heartbeat answers 403, and a notebook a person may not open answers 404.
- **DP-42 — Big output and outage** The owner expands a truncated stream, pages a table output, keeps editing through a storage outage until the edits save, and finds the notebook by a cell's text.
- **DP-43 — Output caps and table paging** Stream outputs over the line cap show only the first lines and a show-more button, outputs over the byte cap are replaced by the published notice, and table outputs page at the published rows without repeating or skipping a row.
- **DP-44 — Autosave through a storage outage** Autosave fires after the published delay, pauses with the outage copy when storage is unreachable, keeps every edit in the page, and saves them once storage answers again.
- **DP-45 — Search by title, cells and headings** File-browser search runs through Meilisearch, returns only notebooks the searcher may open, and shows the published notice when search is unavailable while the list still works.

## Frontend

### Screens and layout (DP-07, DP-08, DP-10, DP-38)

Routes: `/` is the landing page, `/signin` signs in, `/signup` creates an account (`/signup?invitation=<token>` for an invited person who has no account), `/verify/<token>` confirms an email address, `/invite/<token>` opens an invitation, `/notebooks` is the file browser and `/notebooks/<id>` is a notebook. A signed-out person who opens `/notebooks` or a notebook is sent to `/signin` and returns there after signing in.

**Landing page.** The page is a stack of full-width bands that alternate white and very light grey, in this order:
1. The **workspace header with menus**, in its signed-out form.
2. The **Brackenpad mark with glyph cloud**.
3. The **landing tagline**.
4. An **accent-tail section heading** reading "Recent from the notebook log", with "notebook log" in the accent.
5. Three **recent notebook cards**.
6. The **checkpoint cascade row**.
7. The **notebook feature line-icon grid**.
8. The **cell lifecycle disc arc**.
9. The **fictional workspace wordmark wall**.
10. The **format and plan cards**.
11. The **two-tone footer columns** with the **underline-field sign-up form** in the lower band.

- At 1280x800, the header, hero, tagline, heading and cards fit within the first screen and a half. Product rows split into two equal halves, with the picture on the left and the text on the right.
- At 768x1024, product rows still split in half. The feature grid has two columns and the cards stay three across or wrap to two.
- At 375x812, every grid is one column. Product rows stack with the picture first and buttons stacked. The disc arc's curve disappears and the discs stack centred. Footer columns and form fields stack full width.

**Sign-in and sign-up.** A single centred white card on the light grey band, using the underline-field style.

**File browser.** The workspace header, then a band with:
- the heading "Your notebooks";
- the search box with the "New notebook" and "Import notebook" buttons beside it;
- the list of notebook cards, newest modified first. Each card shows the title, the owner's display name, the person's role and an italic modified date.

At 375 px the search box spans the width and the buttons sit on their own row under it.

**Notebook.**
- The workspace header holds the File, Edit, Cell, Kernel and Share menus, the notebook title, the "People here" list, the mode indicator and the kernel status text.
- A toolbar sits under the header.
- At 1280x800, the table of contents is a left column about a quarter of the width. The cells fill the rest on a light grey band, each cell a white block. The checkpoint panel opens as a right-hand column over the cells.
- At 768x1024, the notebook uses the same layout as at 1280 px. The header menus show in full, the table of contents is a left column about a third of the width, and there is no "Show table of contents" button, "Contents" drawer, "Open menu" button or "Cell actions" button. The phone rules below apply only below 768 px. Exactly 768 px uses this wide layout.
- At 375x812 (and anywhere below 768 px), there is one column. The header menus fold into the "Open menu" button. The toolbar wraps to two rows and every button stays at least 44 px. The table of contents is in the "Contents" drawer, and each cell shows a "Cell actions" button.

**Checkpoint comparison.** At 1280 px and wider, it is a 50/50 split with the chosen checkpoint on the left and the current notebook on the right. Below 1280 px, the two halves stack with the checkpoint first.

No screen scrolls sideways at any of the three viewports. Long code lines wrap or scroll inside their own cell or output box.

### Public screens and controls (DP-07, DP-11, DP-12, DP-13, DP-23, DP-29, DP-33, DP-38, DP-39, DP-43, DP-44, DP-45)

Only the controls and regions in this table are public. Everything else is free. `<n>` is a cell's 1-based position in the notebook, `<k>` is a checkpoint's sequence number, `<label>` is a checkpoint label and `<N>` is a count.

| Screen | Role and accessible name | Visible copy or content |
|---|---|---|
| All | `banner` (workspace header) | brand mark and wordmark |
| All | `link "Brackenpad home"` | the mark |
| All, below 768 px | `button "Open menu"` | three-bar icon |
| Landing | `button "Resources"` (with caret) opening `menu "Resources"` | items "Keyboard shortcuts", "Published limits", "Open format" |
| Landing | `link "Features"`, `link "Open format"`, `link "Limits"`, `link "Sign in"` | same |
| Landing | `img "Brackenpad"` | hero mark and glyph cloud |
| Landing | `heading "Recent from the notebook log"` | accent on "notebook log" |
| Landing | `link` per recent notebook card, named by its title | title, italic date, summary |
| Landing | `heading "Checkpoints: every version, side by side"` | lead and two buttons |
| Landing | `form "Create your account"` with fields labelled "Display name", "Email", "Password" and `combobox "I mostly use notebooks for"` (Teaching, Research, Analysis, Tinkering) | placeholders with an asterisk |
| Landing, sign-up | `button "Create account"` | CREATE ACCOUNT |
| Sign-in | fields "Email", "Password", `button "Sign in"`, `link "Create an account"` | same |
| Forms | `alert` error summary with one `link` per field error | Feedback states |
| File browser | `heading "Your notebooks"` | same |
| File browser | `searchbox "Search notebooks"` | placeholder "Search titles, cells and headings" |
| File browser | `status "Search status"` | Feedback states |
| File browser | `list "Notebooks"` with one `link` per notebook named by title | title, owner, role, italic "Modified <date>" |
| File browser | `button "New notebook"` opening `dialog "New notebook"` with `textbox "Title"` and `button "Create"` | same |
| File browser | `button "Import notebook"` opening `dialog "Import notebook"` with file field "Notebook file", `textbox "Title"` and `button "Import"` | same |
| Import dialog | `list "Import errors"` | one line per error |
| File browser | `button "Sign out"` | same |
| Notebook header | `button "File"`, `button "Edit"`, `button "Cell"`, `button "Kernel"` (with caret), each opening a `menu` of the same name; `button "Share"` | menu items listed under Interactions |
| Notebook header | `heading` level 1 | notebook title |
| Notebook header | `list "People here"` | one item per present person, by display name |
| Notebook header | mode indicator | "Command mode", "Edit mode" or "View only" |
| Notebook header | kernel status text | Feedback states |
| Notebook | `status "Notebook status"` (polite) | Feedback states |
| Notebook | `status "Save status"` (polite) | Feedback states |
| Notebook | `alert` outage banner | Feedback states |
| Notebook | `toolbar "Notebook actions"` with `button "Run"`, `button "Run all"`, `button "Interrupt kernel"`, `button "Restart kernel"`, `button "Save checkpoint"`, `button "Checkpoints"`, `button "Export"`, and `button "Download original"` for imported notebooks only | same |
| Notebook | `navigation "Table of contents"` with one `link` per heading named "<number> <heading text>" | same |
| Notebook, below 768 px | `button "Show table of contents"` opening `dialog "Contents"` that holds the navigation and `button "Close"` | same |
| Notebook | `region "Cells"` with one `article` per cell named "Code cell <n>" or "Markdown cell <n>" | same |
| Cell | `textbox "Cell <n> source"` (read-only, marked as read-only, for viewers and locked cells) | source |
| Cell | execution count | "[ ]", "[*]" or "[<N>]" |
| Cell | `button "Move cell <n>"` (drag handle, editors and owner only) | grip icon |
| Cell, below 768 px | `button "Cell actions"` | three-dot icon |
| Cell | `region "Output of cell <n>"` | outputs |
| Output | `button "Show <N> more lines"` | same |
| Output | `table "Table output"`, `button "Previous page"`, `button "Next page"` and the range text | Feedback states |
| Dialog | `dialog "Cell actions"` (bottom sheet) with `button "Run"`, `button "Insert below"`, `button "Change type"`, `button "Move up"`, `button "Move down"`, `button "Delete"`, `button "Close"` | same |
| Dialog | `dialog "Command palette"` with `combobox "Search commands"` and `listbox "Commands"` | options under Interactions |
| Dialog | `dialog "Restart kernel?"` with `button "Restart"` and `button "Cancel"` | "All variables will be cleared. Outputs stay." |
| Dialog | `dialog "Notebook changed elsewhere"` with `button "Reload latest"` and `button "Keep my version"` | "Someone saved this notebook after you started editing. Choose which version to keep." |
| Dialog | `dialog "Share notebook"` with `textbox "Email"`, `radiogroup "Role"` (`radio "Editor"`, `radio "Viewer"`), `button "Send invitation"`, `list "People with access"` with `button "Remove <display name or email>"` | same |
| Checkpoints | `region "Checkpoints"` with one `button "Compare #<k> <label>"` per cascade window and `list "Older checkpoints"` holding the same button for older checkpoints | title bar shows label, "#<k>", italic time and "Saved" |
| Checkpoints | `region "Checkpoint comparison"` with a level 2 heading of counts, `region "Checkpoint #<k>"`, `region "Current notebook"`, one `group` per row named "Row <r>: <tag>", `button "Revert this cell"` per row, `button "Revert notebook"`, `button "Close comparison"` | tags from Business rules |
| Dialog | `dialog "Revert to <label>?"` with `button "Revert"` and `button "Cancel"` | "A checkpoint named Before revert is saved first." |
| Invitation | `/invite/<token>`: `heading` level 1, with `button "Open notebook"`, `link "Sign in"`, `link "Create an account"` or `button "Sign out"`, each shown in the state named under Feedback states | Feedback states |
| Sign-up from an invitation | `textbox "Email"` filled with the invited address and marked read-only | same |

### Interactions (DP-11, DP-12, DP-23, DP-24, DP-29, DP-33, DP-38, DP-39)

**Modes.** A notebook opens in command mode with the first cell selected. Escape enters command mode. Enter enters edit mode on the selected cell: the editor gets focus and the selected cell's bar becomes a border. A viewer always stays in command-style navigation, and the mode indicator reads "View only". A locked cell, or any cell for a viewer, ignores Enter.

**Where shortcuts work.** Command-mode keys work while focus is on the cells region, on any cell, or on any toolbar or header button. They do not work inside text fields, inside the editor in edit mode, inside an open menu or inside a dialog. Enter or Space on a focused button activates that button instead of entering edit mode. Keys that change cells or run code do nothing for a viewer.

**Command-mode keys.**
- Up and K select the cell above. Down and J select the cell below.
- Shift+Up and Shift+Down extend a contiguous selection.
- A inserts an empty code cell above the selected cell. B inserts one below. The new cell becomes selected.
- M changes the selected cells to markdown and Y changes them to code.
- D then D deletes the selected cells. Z restores the most recent deletion made in this tab, with the same ids, types, sources and outputs, at the positions they had. A second Z does nothing.
- C copies the selected cells into the page's own clipboard. X copies them and then deletes them; a cut counts as a deletion for Z. V pastes the copied cells below the selected cell as new cells with the same types and sources, new ids and no outputs.
- Shift+M merges the selected cells. With only one cell selected, it merges that cell with the cell below.
- I then I interrupts the kernel. 0 then 0 opens "Restart kernel?".

**Double press.** D,D, I,I and 0,0 count only when the second press lands within the double-press window after the first. A single press does nothing.

**Edit-mode keys.** Ctrl+Shift+Minus splits the cell at the start of the cursor's line. The cursor's line and everything after it go to a new cell below, and that new cell keeps edit mode.

**Keys in both modes.**
- Shift+Enter runs the selected cell and selects the next cell in command mode. If the cell was the last one, it first inserts an empty code cell.
- Ctrl+Enter or Cmd+Enter runs the cell in place and enters command mode.
- Alt+Enter runs the cell, inserts an empty code cell below and enters edit mode in it.
- Ctrl+S or Cmd+S saves a checkpoint instead of the browser's own save.
- Ctrl+Shift+C opens "Command palette".

For a markdown cell, "running" means rendering it. It takes no execution count.

**Command palette.**
- Focus starts in "Search commands". Typing filters the options by case-insensitive substring as each key is typed.
- Up and Down move the active option. Enter runs the active option and closes the palette.
- Escape closes the palette. Focus returns to the control that had it before.
- The options are "Run all cells", "Run selected cell", "Interrupt kernel", "Restart kernel", "Save checkpoint", "Insert code cell below", "Insert markdown cell below", "Export notebook" and "Show table of contents". A viewer sees only the last two.

**Menus.**
- File: New notebook, Import notebook, Export, Download original (imported notebooks only), Save checkpoint.
- Edit: Cut cells, Copy cells, Paste cells below, Delete cells, Undo delete, Merge selected cells, Split cell.
- Cell: Run, Run all, Change to code, Change to markdown, Move cell up, Move cell down, Insert code cell below.
- Kernel: Interrupt kernel, Restart kernel.

Menus open on click, Enter, Space or Down. Arrow keys move between items and Escape closes the menu, returning focus to its button. Share opens "Share notebook".

**Drag reorder.** Dragging a cell's "Move cell <n>" handle with a mouse or by touch shows a drop line between cells. Dropping moves the cell there. Keyboard users move cells with "Move cell up" and "Move cell down" in the Cell menu.

**Table of contents.** Activating an entry selects that heading's markdown cell, scrolls it into view, puts the notebook in command mode and moves focus to the cell.

**Dialogs and sheets.** Every dialog and sheet keeps Tab and Shift+Tab cycling inside it, wrapping from the last control to the first and back.
- Escape closes every dialog and sheet except "Notebook changed elsewhere", which closes only through one of its two buttons.
- Closing returns focus to the control that opened the dialog. After the conflict dialog closes, focus returns to the cell that was being saved.
- A closed drawer or sheet is inert and hidden: none of its controls can be focused, clicked or found by a screen reader.
- Tapping the dimmed area outside the sheet or drawer closes it.

**Phone cell actions.** Tapping a cell's "Cell actions" button opens the "Cell actions" sheet from the bottom edge for that cell. Run, Insert below, Change type (toggles code and markdown), Move up, Move down and Delete each act on that cell and close the sheet. A viewer's sheet shows only "Close".

**Checkpoint panel.** "Checkpoints" opens the panel. The three newest checkpoints stand as overlapping windows, newest in front. Tab reaches each window. Hover or focus darkens a window's frame. Clicking a window, or pressing Enter on it, opens the comparison. "Close comparison" or Escape returns to the cascade, and focus returns to the window that was chosen. "Revert notebook" and "Revert this cell" open "Revert to <label>?". Confirming reverts the notebook and closes the comparison.

**Share.** The owner types an email, picks a role and sends. The person appears in "People with access" as invited, then as active after they accept. "Remove <name>" ends their access at once, and their open notebook page shows the not-found screen within two seconds.

**Invitation.** The invitation link opens `/invite/<token>`. The page reads the invitation through `GET /api/invitations/<token>` and shows one of the states under Feedback states.
- Signed in as the invited account: activating "Open notebook" accepts the invitation and opens `/notebooks/<id>`.
- Signed out, with an existing account for the invited address: "Sign in" goes to `/signin`. After signing in, the person returns to the invitation page.
- Signed out, with no account for the invited address: "Create an account" goes to `/signup?invitation=<token>`. The form shows the invited address read-only and sends the token as `invitation_token`. On success the person is signed in and the notebook opens.
- Signed in as another account: "Sign out" signs out and shows the signed-out state.

**Search.** The list filters through search half a second after typing stops, with no submit button. Clearing the box shows the full list again.

### Visual design (DP-07, DP-08)

The direction is a plain, utilitarian, open-source project look. There are full-width bands alternating between pure white and a very light grey. A very light grey hairline runs at the top and bottom edge of each grey band. Text is dark charcoal on white. A single warm orange accent is used only on buttons, inline links, the selected cell's marker and the closing words of section headings.

**Colour roles.**
- Ground: white.
- Surface: very light grey.
- Band edge: a slightly darker very light grey.
- Ink: dark charcoal.
- Muted ink and lines: mid grey, used for card frames, line icons, the glyph cloud and the execution count.
- Accent: warm orange. It has a slightly darker orange edge and turns a step darker on hover.
- The footer's submit button uses a brighter orange.
- Text on the accent is white.
- The footer's upper band is a mid-dark grey and its lower band a darker grey, both with white text.

**Type.**
- Display and headings: Source Sans 3 at semibold, in sentence case. Section titles are centred. Product-row headings are left-aligned.
- Body: Inter regular, with Inter italic for dates and meta lines and Inter bold for footer heads and the submit label.
- Code: Fira Code, used only in code cells and code output.
- Execution counts are Inter with figures of equal width, in muted grey.
- Each heading step is about one eighth larger than the step below. Section headings are about one and a half times body size, so there are no large display jumps. The hero graphic is the largest thing on the page.
- All fonts are bundled with the app.

**Density.** Comfortable spacing, with generous vertical padding in every band.

**Composition.** A centred container a little narrower than a laptop screen, on a twelve-column grid with narrow gutters and a steady vertical rhythm. Every feature is told as a 50/50 product row: a cascade of overlapping mock notebook windows on the left, and a heading, lead paragraph and orange buttons on the right.

**Hero.** The **Brackenpad mark with glyph cloud** is an original inline drawing in a wide box at the top of the page.
- In the middle, two thick orange brackets surround a lowercase "brackenpad" wordmark, with three grey satellite dots of different sizes.
- Around it, about thirty hand-drawn generic pictograms sit on a loose ellipse in mid grey, faint to medium strength: braces, sigma, lambda, a leaf, a hexagon, a cube, a gear and a bar glyph.
- Under it are the **landing tagline** in one centred line ("Notebooks for people who think in code, with room for one or two more at the table."), the accent-tail heading, and three **recent notebook cards** (all invented):
  - "Tide gauge warm-up", "Oct 28.", "Hourly heights from an invented gauge, plotted against the spring and neap cycle."
  - "Rubric totals checker", "Oct 21.", "A teacher's notebook that totals rubric rows and flags missing marks."
  - "Moth counts by lamp night", "Oct 14.", "Three volunteers compare weekly trap counts without emailing a single copy."

  Each card is white with a thin mid-grey frame, barely rounded corners and an italic date before the summary. Each card links to the sign-up form.

**Landing rows.**
- The **checkpoint cascade row** shows three mock notebook windows: grey title bars with three small dots, Fira Code cell blocks and a drawn line chart. Its text is the heading in the controls table, the lead "Save a checkpoint with one key, compare any version cell by cell, and put back exactly what was there.", and the orange buttons "Create account" and "Read the format".
- The **notebook feature line-icon grid** has four items with thin-stroke grey icons:
  - "Runs in your browser" ("Your code runs in a private worker in your own tab. Nothing runs on our server.")
  - "Edit together" ("See who is here, which cell they are in, and every run as it lands.")
  - "Open format in and out" ("Import and export the open notebook format version 4. Your original file stays byte for byte.")
  - "Find anything" ("Search every notebook you can open by its title, its cells and its headings.")
- The **cell lifecycle disc arc** has four grey discs with white glyphs on a shallow smile-shaped grey line: "Write", "Queue", "Run", "Checkpoint". Each has a one-line blurb, and an orange "Start a notebook" button sits below.
- The **fictional workspace wordmark wall** sits under the small heading "Notebooks kept at". It shows sixteen invented wordmarks in flat grey, five per row with one centred last: Fernhollow Primary, Saltmarsh Survey Co-op, Quillon Labs, Larchgate College, Okapi & Thistle, Brimstone Allotments, Northcott Readers, Ember Valley Stats, Pell & Rook, Harrowgate Moth Group, Tamsin Weir Studio, Ledgerfield, Corvid Analytics, Mossbank Tutors, Kestrel Row, Wickham Fen Trust.
- The **format and plan cards** are three centred white cards with thin grey frames and an outlined icon:
  - "Open notebook format" (version 4 in and out)
  - "One free plan" (the published limits, no seats)
  - "Your file leaves with you" (Download original)
- The **two-tone footer columns** sit on the mid-dark band with white bold heads: "Product" (Features, Limits, Open format), "Wrenmoor Software" (About, Contact), "Policies" (Privacy, Terms). Links are underlined on hover.
- The **underline-field sign-up form** sits on the darker band under the bold white heading "Make your first notebook". Its fields have only a light underline that turns white on focus. The bright orange CREATE ACCOUNT button has an uppercase bold label. A one-line footnote reads "© 2026 Wrenmoor Software".

**Working screens.**
- The **workspace header with menus** is a white bar with a thin light grey rule underneath. It has plain text menus, and Kernel carries a small solid caret.
- File browser cards follow the recent notebook card style.
- Cells are white blocks on the light grey band. In command mode the selected cell gets a thick orange bar on its left edge. In edit mode it gets a thin orange border instead.
- The **run and checkpoint buttons** (Run, Save checkpoint, Revert notebook, Revert this cell, Revert) are embossed orange: barely rounded, with a white label that has a small dark shadow under it. They press in with an inner shadow when active and drop to about two thirds strength when disabled.
- Other buttons are plain grey-framed text buttons.
- The share dialog and sign-in use the underline-only field style.
- Empty states show a grey line icon over centred copy (Feedback states).
- Error output is charcoal text on the light grey surface. The error name is in semibold and the word "Error" sits as a label before it, so colour never carries the meaning alone.
- The outage banner is a full-width darker grey band with white text.
- Corners follow one rule everywhere: cards and fields are barely rounded, and buttons are a touch more rounded.
- Every pair of text and background meets WCAG 2.2 AA contrast.
- Every tappable control is at least 44 px in both directions.
- Focus shows a clear orange ring set slightly outside the control.

### Motion and effects (DP-09, DP-33)

Motion is almost absent on purpose: output must never move under the reader.

- **Entrance.** On landing, the hero mark and glyph cloud fade from invisible to fully visible once, over one second, starting slowly. Nothing else enters with motion.
- **Hover and press.** Buttons darken one step within a twentieth of a second of the pointer arriving and press in with an inner shadow when held. Cards and checkpoint windows darken their frame to charcoal within a twentieth of a second. Header links shift toward orange over about a sixth of a second.
- **Menus.** A dropdown, and the phone menu that the "Open menu" button reveals, open by growing to full height over about a third of a second.
- **Cells.** Inserting, moving and deleting a cell animates over about a fifth of a second. The cell grows into place, slides to its new place or shrinks away. Running a cell and arriving outputs never animate.
- **Sheets and drawer.** The cell action sheet rises from the bottom and the contents drawer slides from the left, each over about a fifth of a second.
- **Signature: checkpoint diptych.**
  1. In the checkpoint panel, up to three checkpoint windows overlap as a cascade. Each sits well to the right of the one behind it and slightly lower, about three times as far right as down. Each has a grey title bar with three small dots, the label and an italic time.
  2. Hover or focus darkens the window's frame within a twentieth of a second.
  3. Compare slides the chosen window from its cascade place to the left half of a side-by-side split over about a third of a second. The current notebook fills the right half, and the other windows fade to invisible over the same time.
  4. The rows pair up top to bottom with their tags.
  5. Revert presses in. On confirmation, the right half is replaced by the checkpoint's cells, and a new "Before revert" window joins the front of the cascade.
  6. Closing the comparison reverses the slide over the same time, and the other windows fade back in.
- **No loops.** Nothing loops, pulses or spins. Kernel busy is shown by text alone.
- **Reduced motion.** When the person prefers reduced motion:
  - The hero shows at full strength at once.
  - Hover changes are instant.
  - Menus, sheets and the drawer appear and disappear at once.
  - Cells are inserted, moved and deleted with no animation.
  - The diptych split appears at once with no slide or fade.

  Every tag, count, diff, label and Revert step is unchanged.

### Feedback states (DP-13, DP-18, DP-29, DP-31, DP-43, DP-44, DP-45)

This section owns every message and label copy string. `<n>` is a cell's position, `<N>` a count, and `<name>` a display name.

**"Notebook status" announcements** (polite; each replaces the previous one).
- Mode messages, structure messages, the "output replaced" message, "Reconnecting…" and "Live again" are announced only in the tab where they happen.
- Kernel status and run results are shared. Every open screen of the notebook announces them, whoever caused them.
- A viewer's tab never announces a mode.

The messages are:
- Mode: "Command mode", "Edit mode".
- Kernel status: "Kernel starting", "Kernel idle", "Kernel busy", "Kernel interrupted", "Kernel restarting". The same words are the visible kernel status text in the header.
- Run results:
  - "Cell <n> ran as [<N>]" when finished, where `<N>` is its execution count.
  - "Cell <n> failed with <error name>".
  - "Cell <n> interrupted".
  - "Cell <n> not run".

  These come from anyone's run.
- Structure: "Cannot merge code and markdown cells" when a merge mixes types. "Cell <n> is being edited by <name>" when Enter is pressed on a locked cell.

**"Save status"** (polite):
- "Unsaved changes" right after an edit.
- "Saving…" while a save is in flight.
- "All changes saved" after a save succeeds.
- "Saving paused: storage unavailable" while storage refuses.
- "Saving checkpoint…" while a checkpoint is pending.
- "Checkpoint saved" after the 201.
- "Checkpoint not saved: storage unavailable" after a 503.
- "Reverted to <label>" after a revert.
- "Exported <title>.ipynb" after an export.

**Outage banner** (`alert`, shown while any storage write in this page is failing, and removed after the next success): "Storage is unavailable. Your edits are kept in this page and will be saved when storage returns."

**Cell labels.**
- A locked cell shows "Being edited by <name>" above its editor.
- A cell skipped by Run all shows "Not run: an earlier cell failed" under its source until it next runs.

**Error output.** The word "Error", the error name in semibold, the message, and "line <N>" where N is the 1-based line within the cell.
- Interrupted runs show the name "Interrupted" with the message "Run interrupted".
- Runs stopped by the limit show the name "Interrupted" with the message "Execution time limit reached (<limit> s)". `<limit>` is the configured execution limit in seconds, written without trailing zeros (10000 milliseconds gives "10", 1500 gives "1.5").

**Outputs.**
- A truncated stream ends with the button "Show <N> more lines", where N is the number of hidden lines. The word "lines" is used even when N is 1.
- An over-cap output is replaced by the text "Output removed: larger than <cap> bytes", with `<cap>` written with thousands commas, for example "1,000,000".
- A table output shows "Rows <A>–<B> of <N>" (en dash) beside its page buttons.
- When a table output is replaced by a re-run while someone is paging it, that person's page announces "This output was replaced; showing rows from the start." in "Notebook status" and shows the new output's first page.

**Import dialog.**
- While importing: "Importing…".
- On 413: an `alert` with the response's message.
- On 422: "This file has <N> problems:" (or "This file has 1 problem:") followed by "Import errors", one line each, exactly "<path>: <message>" as returned.
- On 503: "Import failed: storage unavailable".

**File browser.**
- Empty: "No notebooks yet. Create one or import a file."
- "Search status" reads "<N> notebooks found" or "1 notebook found" after each search.
- No results: "No notebooks match “<query>”."
- Search outage: the notice "Search is unavailable" replaces the results, and the list of notebooks stays visible and usable.

**Forms.**
- A failed sign-up or sign-in shows an `alert` error summary at the top: "Please fix the following:", then one link per field error with the field's message, each moving focus to its field. Each field also shows its message under it.
- After sign-up: "Check your inbox to verify your email."
- After an invited sign-up: "You are in. Opening the notebook…"
- Wrong credentials: "Email or password is wrong."
- Unverified: "Verify your email first. We sent you a link."
- Mail outage: "We could not send email right now. Try again in a minute."

**Verification page.** "Email verified. You can sign in now." or "This verification link is not valid."

**Invitation page** (level 1 heading per state; `<owner>` is the owner's display name, `<title>` the notebook title):
- Signed in as the invited account: "<owner> shared “<title>” with you", the line "Role: Editor" or "Role: Viewer", and the button "Open notebook".
- Signed out, account exists: "Sign in as <email> to open the shared notebook." and the link "Sign in".
- Signed out, no account: "Create an account to open “<title>”" and the link "Create an account".
- Wrong account: "This invitation is for another account." and the button "Sign out".
- Unknown: "This invitation is not valid."

**Share dialog.**
- Pending: "Sending invitation…". Success: "Invitation sent to <email>".
- Already shared: "<email> already has access".
- Mail outage: "Invitation not sent: email is unavailable".

**Not found.** A notebook that is missing or not shared with the person shows the heading "Notebook not found" and a link "Back to your notebooks".

**Live connection.** While the live connection is down, "Notebook status" announces "Reconnecting…" and the header shows the same words. On recovery it announces "Live again" and the page refetches the notebook.

## Backend

### API (DP-01, DP-02, DP-03, DP-04, DP-16, DP-29, DP-31, DP-32, DP-35, DP-36, DP-40, DP-41, DP-43, DP-45)

**Common rules.**
- Requests and responses are JSON (`application/json`, UTF-8) unless a row says otherwise.
- Times are ISO 8601 UTC.
- Ids are opaque strings. Cell ids follow the open format rule: 1 to 64 characters of letters, digits, "-" or "_".
- Every character count counts Unicode code points, so an emoji counts as 1. The limit itself is allowed.
- Sessions use the `bp_session` cookie (HttpOnly, SameSite Lax).
- `tab_id` is a random id each open notebook page makes for itself.

**Error shape** (one for the whole API): `{"error":"<code>","message":"<sentence>"}`. A 422 also carries `"errors":[{"path":"<path>","message":"<text>"}]`. Some 409s carry the extra fields named in their row.

**Error precedence** (one rule for every endpoint):
1. 401 `{"error":"unauthenticated","message":"Sign in to continue."}` for a missing or ended session.
2. 404 `{"error":"not_found","message":"Notebook not found."}` for an unknown notebook, cell, checkpoint or run, or a notebook the caller may not open. A private notebook is never revealed by a 403.
3. 403 `{"error":"forbidden","message":"Your role does not allow this."}` for a person who may open the notebook but not do this, such as a viewer editing or running, or an editor managing shares.
4. 413 `{"error":"too_large","message":"<text>"}` for an oversized body, decided before any format check.
5. A replayed run result returns its stored response here, before any state check.
6. 409 for a stale base revision or a state conflict.
7. 422 `{"error":"validation_failed","message":"Some fields are not valid.","errors":[{"path","message"}]}` for validation.
8. 503 `{"error":"storage_unavailable" | "search_unavailable" | "mail_unavailable","message":"..."}` when a provider call fails after every check has passed. In that case nothing is changed.

Rows name only their own extra errors.

**Shapes.**
- `<user>` = `{"id","email","display_name","verified"}`.
- `<cell>` = `{"id","position","cell_type":"code"|"markdown","source","revision","execution_count":int|null,"run_state":"idle"|"queued"|"running"|"finished"|"failed"|"interrupted"|"not_run","outputs":[<output>],"outputs_version":int,"metadata":{},"locked_by":<display name>|null}`.
  - `position` is 0-based.
  - `source` is one string.
  - `revision` starts at 1 and rises by 1 on every change to the cell's source or type.
- `<output>` is an open-format output object: `stream` `{"output_type":"stream","name":"stdout"|"stderr","text"}`, `execute_result` `{"output_type","execution_count","data","metadata"}`, `display_data` `{"output_type","data","metadata"}`, or `error` `{"output_type","ename","evalue","traceback":[string]}`.
- `<notebook>` = `{"id","title","role":"owner"|"editor"|"viewer","owner_display_name","imported":bool,"execution_counter":int,"kernel_status","cells":[<cell>]}`.
- `<checkpoint>` = `{"id","number","label","created_at","status":"saved"}`.

**Health and configuration.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/health` | none, public | 200 `{"status":"ok"}`, or 200 `{"status":"unavailable"}` when the latest storage probe failed. The probe is at most 5 seconds old. | 503 `{"status":"starting"}` until PostgreSQL is reachable at boot |
| `GET /api/config` | none, public | 200 `{"double_press_ms","exec_limit_ms","autosave_ms","output_line_cap","output_byte_cap","table_page_rows","import_max_bytes","checkpoints_kept","presence_timeout_ms"}`, all integers from the limits table | none |

**Accounts.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/auth/signup` | `{"display_name","email","password","use"?,"invitation_token"?}` | 201 `{"user":<user>}`. Unverified, with a verification mail sent. When `invitation_token` belongs to this email, the account is verified, no verification mail is sent, the invitation is accepted and `bp_session` is set. | 422 paths `display_name` "must be 1 to 40 characters", `email` "must be a valid email address" or "is already registered", `password` "must be 10 to 128 characters", `invitation_token` "is not valid for this email"; 503 `mail_unavailable` (no account kept) |
| `POST /api/auth/verify` | `{"token"}` | 200 `{"user":<user>}` | 422 path `token` "is not valid" |
| `POST /api/auth/signin` | `{"email","password"}` | 200 `{"user":<user>}` and sets `bp_session` | 401 `{"error":"invalid_credentials"}`; 403 `{"error":"email_not_verified"}` |
| `POST /api/auth/signout` | none | 204, clears the cookie | none |
| `GET /api/me` | none | 200 `{"user":<user>}` | none |

**Notebooks and cells** (all paths under `/api/notebooks`).

Response bodies:
- Save returns only the cells it saved.
- Insert, paste, delete, restore, move, split and merge return `cells` as the whole notebook in server order.
- Insert, paste and split also return `new_ids`: the ids of the cells they created, in notebook order. For split, this is the new lower cell.
- Merge keeps the first cell's id. Restore brings back the ids it was given.

Lock checks are stated under Business rules.

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/notebooks` | none | 200 `{"notebooks":[{"id","title","role","owner_display_name","modified_at"}]}`, every notebook the caller can open, newest modified first | none |
| `POST /api/notebooks` | `{"title"}` | 201 `{"notebook":<notebook>}` with one empty code cell | 422 path `title` "must be 1 to 120 characters" |
| `GET /api/notebooks/<id>` | none | 200 `{"notebook":<notebook>}` | none |
| `DELETE /api/notebooks/<id>` | none | 204. Removes the notebook, its MinIO objects, its search document and its pending invitations. | 403 for anyone but the owner |
| `POST /api/notebooks/<id>/save` | `{"tab_id","cells":[{"id","base_revision","source","cell_type"}]}` | 200 `{"cells":[<cell>]}` (the saved cells), all or nothing | 409 `{"error":"stale_revision","cells":[<cell>]}` with the current state of every stale cell; 409 `{"error":"cell_locked","cell_id","holder"}`; 422 paths `cells[i].source` "must be at most 1,000,000 characters", `cells[i].cell_type` "must be \"code\" or \"markdown\""; 503 `storage_unavailable` |
| `POST /api/notebooks/<id>/cells` | `{"position","cell_type","source"?}` | 201 `{"cells":[<cell>],"new_ids":[<id>]}` | 422 path `position` "must be between 0 and <cell count>" |
| `POST /api/notebooks/<id>/cells/paste` | `{"position","cells":[{"cell_type","source"}]}` | 201 `{"cells":[<cell>],"new_ids":[<id>, ...]}` | 422 as for insert |
| `POST /api/notebooks/<id>/cells/delete` | `{"tab_id","ids":[...]}` | 200 `{"cells":[<cell>]}` | 409 `cell_locked`; 422 path `ids` "must name cells of this notebook" |
| `POST /api/notebooks/<id>/cells/restore` | `{"ids":[...]}` | 200 `{"cells":[<cell>]}` | 409 `{"error":"not_deleted"}` |
| `POST /api/notebooks/<id>/cells/<cellId>/move` | `{"tab_id","position"}` | 200 `{"cells":[<cell>]}` | 409 `cell_locked`; 422 path `position` "must be between 0 and <cell count − 1>" |
| `POST /api/notebooks/<id>/cells/<cellId>/split` | `{"tab_id","base_revision","line"}` | 200 `{"cells":[<cell>],"new_ids":[<id>]}` | 409 `cell_locked`; 409 `stale_revision`; 422 path `line` "must be between 2 and <line count>" |
| `POST /api/notebooks/<id>/cells/merge` | `{"tab_id","ids":[...],"base_revisions":{"<id>":<revision>}}` | 200 `{"cells":[<cell>]}` | 409 `cell_locked`; 409 `stale_revision`; 422 path `ids` "must be two or more adjacent cells in order" or "must all be the same cell type" |
| `POST /api/notebooks/<id>/cells/<cellId>/lock` | `{"tab_id"}` | 200 `{"cell_id","holder"}` | 409 `{"error":"cell_locked","cell_id","holder"}` |
| `DELETE /api/notebooks/<id>/cells/<cellId>/lock` | `{"tab_id"}` | 204 | none |
| `POST /api/notebooks/<id>/presence` | `{"tab_id","cell_id":<id>|null}` | 200 `{"present":[{"tab_id","user_id","display_name","cell_id"}]}` | none |
| `GET /api/notebooks/<id>/presence` | none | 200 as above | none |

**Runs and kernel status.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/notebooks/<id>/runs` | `{"run_id","cell_id","tab_id"}` (`run_id` is a UUID the page makes) | 202 `{"run":{"run_id","cell_id","state":"queued"}}` | 409 `{"error":"illegal_transition","from","to"}` when the cell is already queued or running; 409 `{"error":"run_id_reused"}`; 422 path `cell_id` "must be a code cell" |
| `POST /api/notebooks/<id>/runs/<runId>/start` | none | 200 `{"run":{...,"state":"running"}}` | 409 `illegal_transition` |
| `POST /api/notebooks/<id>/runs/<runId>/result` | `{"status":"finished"|"failed"|"interrupted"|"not_run"|"cancelled","outputs":[<output>]}` (`not_run` and `cancelled` send `[]`) | 200 `{"run":{...,"state","execution_count":int|null},"cell":<cell>}` | 409 `illegal_transition`; 409 `{"error":"result_conflict"}` when a different result for this run is already stored; 422 paths `outputs[k]...` with the output messages from the import list |
| `POST /api/notebooks/<id>/kernel` | `{"tab_id","status":"starting"|"idle"|"busy"|"interrupted"|"restarting"}` | 200 `{"kernel_status"}` (the notebook's shown status) | 409 `illegal_transition` |
| `GET /api/notebooks/<id>/cells/<cellId>/outputs/<index>/rows?version=<v>&offset=<o>&limit=<l>` | query only. `<index>` is the output's 0-based place in the cell's outputs. `version` is the cell's `outputs_version` the page holds and is required. `offset` defaults to 0. `limit` defaults to the table page rows, and a larger `limit` is reduced to it. An `offset` at or past `total` returns no rows. | 200 `{"columns":[string],"rows":[[...]],"offset","total","version"}` | 409 `{"error":"output_replaced","version":<current>}`; 422, one entry per failure: path `index` "must name an output of this cell" when no output has that index, or "must be a table output" when the output there is not a table; path `version` "must be a whole number" when it is missing or is not one; path `offset` "must be a whole number of at least 0"; path `limit` "must be a whole number of at least 1" |

**Live connection.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/notebooks/<id>/events?tab_id=<tab_id>` | Server-Sent Events, query only | 200 `text/event-stream`, kept open. Event names and data are the app's own. Every role that may open the notebook is admitted. The server ends the stream when the person loses access. | 422 path `tab_id` "is required"; 401 and 404 are sent as JSON in the one error shape before any stream starts |

**Checkpoints.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/notebooks/<id>/checkpoints` | none | 200 `{"checkpoints":[<checkpoint>]}`, newest first | none |
| `POST /api/notebooks/<id>/checkpoints` | `{"label"?}` (1 to 60 characters, default "Checkpoint <number>") | 201 `{"checkpoint":<checkpoint>}`, only after MinIO confirms | 422 path `label`; 503 `storage_unavailable` |
| `GET /api/notebooks/<id>/checkpoints/<cpId>/compare` | none | 200 `{"counts":{"modified","added","removed","moved"},"rows":[{"tag","checkpoint_cell":<cell>|null,"current_cell":<cell>|null,"source_diff":[{"op":"same"|"removed"|"added","line"}],"output_changed":bool}]}` | 503 `storage_unavailable` |
| `POST /api/notebooks/<id>/checkpoints/<cpId>/revert` | `{"cell_id"?}` | 200 `{"before_revert":<checkpoint>,"cells":[<cell>]}` | 422 path `cell_id` "is in neither version"; 503 `storage_unavailable` |

**Import, export and files.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/notebooks/import?title=<title>` | the raw file bytes, any content type | 201 `{"notebook":<notebook>}`. The title defaults to "Imported notebook". | 413 `{"error":"too_large","message":"File is larger than <limit> bytes"}`, with `<limit>` the import limit with thousands commas; 422 with every format error; 503 `storage_unavailable` |
| `GET /api/notebooks/<id>/export` | none | 200 `application/x-ipynb+json`, `Content-Disposition: attachment; filename="<title>.ipynb"`. Stored in MinIO first. | 503 `storage_unavailable` |
| `GET /api/notebooks/<id>/original` | none | 200 `application/octet-stream`, the exact uploaded bytes | 404 `{"error":"no_original"}` for a notebook that was not imported; 503 |
| `GET /api/notebooks/<id>/attachments/<cellId>/<name>` | none | 200, the image bytes with their content type judged from the bytes | 503 |

**Import format errors.** Errors are listed in document order, every error found, each `{"path","message"}`. Paths use dots and zero-based brackets, for example `cells[2].cell_type`. Attachment names use quoted brackets, for example `cells[1].attachments["chart.png"]`.

**Missing keys.** A missing required key is reported at the path it would have, with "is required". For example: `cells[0].outputs[1].text: is required`.

Required keys:
- top level: `nbformat`, `nbformat_minor`, `metadata`, `cells`;
- every cell: `cell_type`, `source`, `metadata`, and `id` when `nbformat_minor` is 5;
- code cells: `execution_count` and `outputs`;
- `stream` outputs: `output_type`, `name`, `text`;
- `execute_result` outputs: `output_type`, `execution_count`, `data`, `metadata`;
- `display_data` outputs: `output_type`, `data`, `metadata`;
- `error` outputs: `output_type`, `ename`, `evalue`, `traceback`.

**What is checked.**
- A cell whose `cell_type` is missing or invalid is checked only for the keys every cell needs.
- An output whose `output_type` is missing or invalid is checked for nothing else.
- When `nbformat_minor` is missing or invalid, `id` is optional.
- A value that is not the required object or array gets its own message, and its contents are not checked.
- When the file is not valid JSON, `file: is not valid JSON` is the only error.

The complete message list:
- `file`: "is not valid JSON"
- any required key: "is required"
- `nbformat`: "must be 4"
- `nbformat_minor`: "must be 4 or 5"
- `metadata` and `cells[i].metadata`: "must be an object"
- `cells`: "must be an array"
- `cells[i]`: "must be an object"
- `cells[i].cell_type`: "must be \"code\" or \"markdown\""
- `cells[i].id`: "must be 1 to 64 characters of letters, digits, \"-\" or \"_\"", or "duplicates cells[j].id"
- `cells[i].source` and `cells[i].outputs[k].text`: "must be a string or a list of strings"
- `cells[i].outputs[k].traceback`: "must be a list of strings"
- `cells[i].execution_count` and `cells[i].outputs[k].execution_count`: "must be null or a whole number of at least 0"
- `cells[i].outputs`: "must be an array", or "is not allowed on a markdown cell"
- `cells[i].outputs[k].output_type`: "must be \"stream\", \"execute_result\", \"display_data\" or \"error\""
- `cells[i].outputs[k].name`: "must be \"stdout\" or \"stderr\""
- `cells[i].outputs[k].data` and `cells[i].outputs[k].metadata`: "must be an object"
- `cells[i].outputs[k].ename` and `.evalue`: "must be a string"
- `cells[i].attachments["<name>"]`: "must be a PNG, JPEG or GIF image"

**Sharing and search.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/notebooks/<id>/shares` | none | 200 `{"shares":[{"id","email","display_name":<name>|null,"role","status":"invited"|"active"}]}` | 403 for anyone but the owner |
| `POST /api/notebooks/<id>/shares` | `{"email","role":"editor"|"viewer"}` | 201 `{"share":{...,"status":"invited"}}` | 403 for anyone but the owner; 409 `{"error":"already_shared"}`; 422 paths `email` "must be a valid email address" or "is the owner", `role`; 503 `mail_unavailable` (no share kept) |
| `DELETE /api/notebooks/<id>/shares/<shareId>` | none | 204 | 403 for anyone but the owner |
| `GET /api/invitations/<token>` | none, public | 200 `{"email","role","notebook_title","owner_display_name","account_exists":bool}` | 404 for an unknown token |
| `POST /api/invitations/<token>/accept` | none | 200 `{"notebook_id"}` | 404 for an unknown token; 403 `{"error":"invitation_for_another_account"}` |
| `GET /api/search?q=<query>` | query only | 200 `{"results":[{"id","title"}]}` | 422 path `q` "must be 1 to 200 characters"; 503 `search_unavailable` |

**Grading.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/grading/seed` | `{"users":[{"key","email","display_name","password"}],"notebooks":[{"key","owner","title","cells":[{"id"?,"cell_type","source","outputs"?,"execution_count"?}],"execution_counter"?,"shares":[{"user","role"}],"checkpoints":[{"label","cells":[...]}]}]}` | 201 `{"users":{"<key>":{"id","cookie":"bp_session=<value>"}},"notebooks":{"<key>":{"id","cell_ids":[...],"checkpoint_ids":[...]}}}`. Users are verified, shares are active, checkpoints are stored in MinIO, and search documents are confirmed before the response. | 404 `not_found` unless `BRACKENPAD_GRADING=1`; 422 with paths |

### Business rules (DP-02, DP-15, DP-16, DP-18, DP-20, DP-22, DP-23, DP-25, DP-27, DP-29, DP-31, DP-32, DP-36, DP-41, DP-43, DP-44)

**Published limits.** Each limit is read from its environment variable at start, falling back to the default shown. `GET /api/config` publishes the values. Every browser timer (double press, autosave, execution limit, retry) runs on the page's clock.

| Env var | Default | Meaning |
|---|---|---|
| `BRACKENPAD_DOUBLE_PRESS_MS` | 500 | D,D, I,I and 0,0 count only when the second press lands within this many milliseconds of the first. Exactly this many counts. |
| `BRACKENPAD_EXEC_LIMIT_MS` | 10000 | A single cell run is stopped after this many milliseconds. |
| `BRACKENPAD_AUTOSAVE_MS` | 2000 | Autosave fires this many milliseconds after the last edit. |
| `BRACKENPAD_OUTPUT_LINE_CAP` | 200 | Lines of one stream output shown before truncation. A stream of exactly this many lines is shown whole. |
| `BRACKENPAD_OUTPUT_BYTE_CAP` | 1000000 | Largest size of one run output, as UTF-8 bytes of its JSON. Exactly this size is kept. |
| `BRACKENPAD_TABLE_PAGE_ROWS` | 25 | Rows per page of a table output. |
| `BRACKENPAD_IMPORT_MAX_BYTES` | 5000000 | Largest notebook file accepted for import. Exactly this size is accepted. |
| `BRACKENPAD_CHECKPOINTS_KEPT` | 10 | Checkpoints kept per notebook. Saving one more drops the oldest and deletes its object. |
| `BRACKENPAD_PRESENCE_TIMEOUT_MS` | 20000 | The server drops a presence marker, and that tab's lock, this long after the tab's last heartbeat. |

**Roles.** The owner may do everything. An editor may read, edit, run, checkpoint, compare, revert, import into their own file browser and export. A viewer may read, see presence and status, open the table of contents, use the palette's two allowed commands and export. Only the owner manages shares and deletes the notebook. An invited person reaches the notebook only after accepting through the invitation link.

Presence (`POST` and `GET .../presence`) and the live connection are open to every role, so viewers appear in "People here". For a viewer, these answer 403:
- the lock endpoints;
- every run endpoint (queue, start, result);
- kernel reports;
- every other write except the presence heartbeat.

A viewer's tab runs no kernel.

**Kernel evaluation.**
- Each open notebook tab has its own kernel. Variables live only in that tab's kernel. Outputs, counts and status are shared through the server.
- Top-level `const`, `let`, `var`, `function` and `class` declarations persist across cells in the same kernel session. A later cell may declare the same `let` or `const` name again, and the new value wins.
- Top-level `await` is allowed. The run ends when the awaited work settles.

Worked example: cell 1 is `let rate = 2;` and cell 2 is `let rate = 3;\nrate * 10`. Run in order, cell 2's result is `30`.

**Results.** If a cell's last statement is an expression statement, its value becomes an `execute_result` with `text/plain` set as follows:
- strings in double quotes with JSON escapes (`"hi"`);
- numbers, booleans and `null` as written (`42`, `true`, `null`);
- bigints with a trailing `n`;
- arrays and plain objects as JSON with two-space indentation;
- functions as `[Function <name>]` (`[Function anonymous]` when unnamed);
- dates as their ISO text;
- anything else as its string form.

`undefined` produces no result.

**Console.** `console.log` and `console.error` become stream outputs named `stdout` and `stderr`. Arguments are joined by one space, with strings written as-is and other values formatted as above. Each call adds one line ending in a newline. Consecutive calls to the same stream join into one stream output.

**display().** `display(value, mimeType?)` adds a `display_data` output. The default type is `text/plain`, formatted like a result. The allowed types are `text/plain`, `text/markdown` (rendered with the markdown rules), `text/html` (filtered by the same allowlist), `image/svg+xml` (shown as an image, never inline script) and `application/vnd.brackenpad.table+json`. The table type takes `{"columns":[string],"rows":[[value]]}`. Any other type raises a `TypeError` with the message "display(): unsupported type <type>".

**Errors.** An uncaught error becomes an `error` output: `ename` is the error's name, `evalue` its message, and `traceback` is `["<ename>: <evalue>", "line <N>"]`, where N is the 1-based line in that cell. Syntax errors report the line of the fault.

Worked example: `const a = 1;\nnull.x` gives `TypeError`, the browser's message for reading `x` of null, and `line 2`.

**Run states.** A run's state moves `queued -> running -> finished | failed | interrupted`. It may also move `queued -> not_run`, when an earlier cell in the same Run all failed, or `queued -> cancelled`, after an interrupt, the time limit or a restart in that tab.

The cell's `run_state` follows its latest run, with two rules:
- A cancelled run returns its cell to the `run_state` it had before it was queued, with its outputs and count unchanged.
- A cancelled run announces nothing.

A new run may be queued from any cell state except `queued` and `running`.

The server rejects every other move with 409 `illegal_transition` naming `from` and `to`:
- starting a run that is not queued;
- a finished, failed or interrupted result for a run that never started;
- `not_run` or `cancelled` for a run that is not queued;
- queuing a cell that is queued or running.

The page shows "[*]" while queued or running, "[<N>]" once a count exists and "[ ]" for a cell never run.

**Execution counter.**
- Each notebook has one counter on the server, starting at 0.
- A run that ends finished, failed or interrupted takes the next number. A `not_run` or `cancelled` result takes none.
- Simultaneous results get distinct, consecutive numbers with no gap.
- The number is stored as the cell's `execution_count` and on its `execute_result`, and every open screen shows it within two seconds.
- Posting the same result again for a `run_id` returns the stored response with the same number. A different result for the same run answers 409 `result_conflict`.
- Revert and restart keep the counter. An import sets it to the highest imported count, or 0.

**Run all.**
- Run all queues every code cell top to bottom and renders every markdown cell.
- After a cell fails, every remaining queued code cell gets `not_run` and its label. Those cells keep their previous outputs and counts.
- After an interrupt, the time limit or a restart, the tab posts the result `cancelled` for every remaining queued run in that tab, as stated under Run states.

**Kernel status.** Each tab reports its own kernel's status. Legal moves are:
- Starting -> Idle;
- Idle -> Busy;
- Busy -> Idle (when its queue empties);
- Busy -> Interrupted (on interrupt or the limit);
- Interrupted -> Busy;
- Interrupted -> Idle;
- any status -> Restarting;
- Restarting -> Idle.

Any other report answers 409 `illegal_transition`. The status every screen shows is "Kernel busy" while any tab's kernel is busy, otherwise the most recent report from any tab.

**Time limit and interrupt.**
- A run still going at the execution limit is stopped. Its cell gets the time-limit error and becomes `interrupted`, and the kernel becomes Interrupted.
- I,I, the toolbar's "Interrupt kernel" or the menu item does the same at once with the interrupt error. I,I when nothing is running does nothing.
- In both cases every variable the kernel held before the run is kept.

**Restart.** Restart, after confirmation, stops any running cell as interrupted and clears every kernel variable. The kernel shows Restarting and then Idle. Stored outputs stay on every cell.

**Markdown.**
- Markdown cells render headings `#` to `######`, emphasis, lists, code spans and blocks, links, images, pipe tables, inline math `$...$` and display math `$$...$$`.
- Each rendered formula contains a MathML `math` element. Display math sets `display="block"` on it. The TeX source is kept as its annotation. The math renderer's own output is added after the allowlist filter.
- Inline math needs a non-space character right after the opening `$` and right before the closing `$`, both in the same paragraph. A `$` without such a partner, or written as `\$`, renders as a literal dollar sign. For example, `$5 and $10` renders as plain text.
- Dollar signs inside code spans and code blocks are never math. TeX that cannot be parsed renders as its source text.
- Raw HTML is filtered to this allowlist of tags: b, i, em, strong, code, pre, br, p, ul, ol, li, a, img, table, thead, tbody, tr, th, td, sub, sup. Every other tag is removed and its text content kept as plain text.
- Every attribute except `href`, `src`, `alt` and `title` is removed.
- Links keep only the schemes https, http and mailto. Any other link renders its text without a link.
- Images keep `src` only for https, http and `attachment:<name>` references to the cell's imported attachments.
- The same filtered result is shown to owner, editor and viewer.

**Table of contents.** The table of contents lists every markdown heading, outside code blocks, in document order. Each heading is numbered by the counters of each level from the shallowest heading level used in the notebook down to its own level, joined by dots. A level that has not yet appeared under its parent counts as 0. Example: `# A`, `## B`, `## C`, `# D`, `### E` are numbered "1", "1.1", "1.2", "2", "2.0.1". The list updates within two seconds of any markdown change on any screen.

**Cell structure and order.**
- PostgreSQL holds one order per notebook. Every insert, paste, move, delete, restore, split and merge is applied in the order the server receives it, and every open screen shows that order within two seconds.
- Deleting every cell leaves one new empty code cell.
- Restore puts cells back at the positions they had when deleted, clamped to the end, in their old order.
- Split at line L (lines are the source split on newline characters): the upper cell keeps its id and lines 1 to L−1, and a new cell of the same type below gets lines L to the end. Both lose their outputs and counts.
- Merge joins the sources with exactly one newline, keeps the first cell's id and type, and clears outputs and count. Splitting and then merging the two halves gives back the original source exactly.
- Changing a cell to markdown clears its outputs and count.

**Revisions, saves and conflicts.**
- Every save of a cell's source or type carries the base revision the page last received for that cell.
- If any cell's current revision differs, the whole save answers 409 `stale_revision` and changes nothing.
- When a live change arrives for a cell the page holds unsaved edits on, the page keeps its own text and its old base revision, so the next save is refused and the conflict dialog opens.
- "Reload latest" drops this page's unsaved edits to those cells and shows the server's cells.
- "Keep my version" saves the page's text again against the current revisions.
- Of N simultaneous saves with the same base revision for a cell, exactly one succeeds and the rest answer 409.

**Locks and presence.**
- Entering edit mode claims the cell's lock for that tab, and leaving edit mode releases it.
- Of simultaneous claims, exactly one succeeds. The lock belongs to the `tab_id` that claimed it.
- Save, split, merge, delete and move each carry the page's `tab_id`. When any cell they touch is locked by a different `tab_id`, they answer 409 `cell_locked` and change nothing. This check comes before `stale_revision`.
- The holder's own writes pass, and so do writes to unlocked cells.
- Another tab of the same person has its own `tab_id` and counts as someone else.
- Claiming a lock the same tab already holds answers 200 again. Releasing a lock the tab does not hold answers 204 and changes nothing.
- Every open page sends a presence heartbeat (`POST .../presence`) every third of `presence_timeout_ms` from `GET /api/config`, rounded down to whole milliseconds. That is 6,666 ms by default, or 1,000 ms when the timeout is 3,000 ms.
- A presence marker, and any lock that tab held, disappears when the tab's live connection closes, or at the latest when the presence timeout has passed since its last heartbeat, as decided by the server.

**Autosave.**
- Autosave sends every unsaved cell edit in one save after the autosave delay following the last edit. Running a cell first saves its pending edit.
- A save answering 503 leaves every edit in the page. The page retries every 5 seconds and on each new edit until a save succeeds.
- Reloading discards unsaved edits after the browser's leave-page warning.

**Outputs.**
- A run output over the byte cap is replaced by the server, before storing, with a `display_data` output whose `text/plain` is the over-cap notice.
- An imported output over the cap is stored as imported, and the page shows the same notice in its place.
- Stream outputs over the line cap show the first lines up to the cap and the show-more button. Activating it shows every line and removes the button.
- Table outputs are paged at the table page rows in stored order: page 1 holds rows 1 to the page size, and each later page starts right after the previous one ends.
- A stored output never changes. A re-run gives the cell new outputs and a higher `outputs_version`. Rows requested for an older version answer 409 `output_replaced`, so no page mixes two versions and paging never repeats or skips a row.

**Checkpoints.**
- A checkpoint stores the whole notebook (ids, types, sources, outputs, counts, metadata) in the export format as one MinIO object.
- It gets the next sequence number in the notebook.
- It is listed as "Saved" only after MinIO confirms the put. Before that it does not exist in any list.

**Compare.** Compare pairs cells by cell id.
- A cell only in the checkpoint is "Removed". A cell only in the current notebook is "Added".
- A cell in both with a different source or type is "Modified" and carries a line diff of its source in `source_diff`:
  - Both sources are split on newline characters, so a trailing newline gives a final empty line.
  - The `same` lines are a longest common subsequence of the two line lists. When several exist, each checkpoint line, earliest first, is matched to the earliest current line that still allows a longest one.
  - Between two `same` lines (and before the first or after the last), every `removed` line (checkpoint text) comes before every `added` line (current text), each group in its own order.
  - For example, checkpoint `a\nb\nc` against current `a\nx\nc` gives same `a`, removed `b`, added `x`, same `c`.
  - Every row that is not "Modified" has an empty `source_diff`.
- Otherwise, a cell in both is "Moved" when it is outside the longest run of shared cells that keep their relative order. When there is a tie, the run that keeps cells appearing earliest in the current notebook is chosen.
- Otherwise the cell is "Unchanged".
- A cell that is both moved and modified is tagged and counted only as "Modified".
- `output_changed` is true for any row present in both versions whose outputs differ, and the page shows the note "Output changed" on it. Outputs never change the tag.
- The JSON `tag` is exactly the label shown: "Unchanged", "Modified", "Added", "Removed" or "Moved".
- Rows follow the current notebook's order. Each removed row is placed right after the row of the nearest cell above it in the checkpoint that is also in the current notebook, or at the very top when there is none. Removed rows that share a place keep their checkpoint order.
- In the group name "Row <r>: <tag>", `<r>` is the row's 1-based place in `rows`.
- The heading reads "<m> modified, <a> added, <r> removed, <v> moved".

**Revert.**
- Revert first stores a checkpoint labelled "Before revert" of the current notebook. If that put fails, nothing changes.
- Revert of the notebook then replaces every cell with the checkpoint's cells: ids, order, types, sources, outputs and counts.
- Revert of one cell restores that cell's checkpoint version. A cell only in the checkpoint is re-inserted at its checkpoint position, clamped to the end. A cell only in the current notebook is deleted.
- The notebook's execution counter and every kernel's variables are kept.
- Every open screen shows the result within two seconds. A tab holding unsaved edits to a reverted cell gets the conflict dialog on its next save.

**Import.**
- The size check comes first. A body of more than the import limit answers 413 before any parsing. The server stops reading at the limit plus one byte.
- The accepted subset is:
  - top-level `nbformat` 4, `nbformat_minor` 4 or 5, `metadata` and `cells`;
  - each cell has `cell_type` (code or markdown), `source` (string or list of strings) and `metadata`;
  - `id` is required when `nbformat_minor` is 5. When it is 4 and absent, the working copy gets a new id;
  - code cells have `execution_count` and `outputs` with output types stream, execute_result, display_data and error;
  - markdown cells may have `attachments` mapping a name to a single image (`image/png`, `image/jpeg` or `image/gif`, base64). The type is judged from the decoded bytes, never the declared type.
- Unknown keys are ignored in the working copy.
- The original bytes are stored unchanged.
- Each output's JSON text is kept exactly as it appears in the file. The API, checkpoints and export return those outputs with the same keys, order and values.
- Sources given as lists are joined into one string for the working copy.

**Export.** Export writes `{"nbformat":4,"nbformat_minor":5,"metadata":{"kernelspec":{"name":"brackenpad-js","display_name":"JavaScript (Brackenpad)","language":"javascript"},"language_info":{"name":"javascript"}},"cells":[...]}`. Each cell has `id`, `cell_type`, `source` (one string) and `metadata`. Code cells also have `execution_count` and `outputs`. Importing an export gives back the same ids, types, sources, outputs and counts.

**Search.**
- A notebook's search document is updated after each title change, content save, structural change, revert, import, share change and deletion. The app retries until Meilisearch confirms the task. A notebook appears in results only after that.
- Results come only from Meilisearch. Before returning, each result is checked against the caller's current access, so a notebook the person cannot open never appears, even before the index catches up.

**Accounts.** Emails are compared case-insensitively. Verification and invitation tokens are random, single-use for verification, and reusable by the invited account itself for opening the notebook.

### Services (DP-31, DP-36, DP-40, DP-44, DP-45)

**PostgreSQL** is the system of record for users, sessions, notebooks, cells with revisions and the server order, deleted cells for restore, share grants and invitations, the execution counter, run records with their stored responses, stored outputs, checkpoint metadata, presence and locks. The schema is applied idempotently on every start.

**MinIO** (bucket from `S3_BUCKET`). Object keys:
- `notebooks/<notebook id>/checkpoints/<checkpoint id>.json`: the checkpoint snapshot in export format.
- `notebooks/<notebook id>/original.ipynb`: the exact imported bytes.
- `notebooks/<notebook id>/exports/<export id>.ipynb`: each export.
- `notebooks/<notebook id>/attachments/<cell id>/<name>`: each imported image attachment.
- `notebooks/<notebook id>/working.json`: the whole notebook as of the latest save, rewritten by every successful save before it commits.

When MinIO is unreachable:
- saves, checkpoints, reverts, imports, exports, Download original, attachments and compare answer 503 `storage_unavailable` and change nothing;
- running cells, structural edits, reading, sharing and search keep working;
- the page shows the outage copy from Feedback states;
- `/api/health` reports `unavailable`.

**Mailpit** (SMTP at `SMTP_HOST`:`SMTP_PORT`). Every message is sent with the From line read from `MAIL_FROM`, whose value is "Brackenpad <hello@brackenpad.test>".
- Sign-up sends one message to the new address with the subject "Verify your Brackenpad email" and a link `<APP_PUBLIC_URL>/verify/<token>`.
- Sharing sends one message to the invited address with the subject "<owner display name> shared “<title>” with you". It names the role and has a link `<APP_PUBLIC_URL>/invite/<token>`.

When SMTP refuses, the request answers 503 `mail_unavailable` and no account or share is kept.

**Meilisearch** (at `MEILISEARCH_URL` with `MEILISEARCH_API_KEY`).
- Index `notebooks`, primary key `id`.
- Documents: `{"id","title","cells":[cell sources],"headings":[markdown heading texts],"reader_ids":[user ids who may open it]}`.
- Searchable attributes: `title`, `headings`, `cells`. Filterable: `reader_ids`.
- Index settings are applied idempotently on start.
- Searches filter by the caller's id.

When Meilisearch is unreachable, search answers 503 `search_unavailable`, the file browser shows its notice, the list still works, and pending index updates are retried.

### Seed data (DP-04)

On every start, if they are absent, the app creates these invented records. The people and organisations are fictional.
- Owner "Ada Thornquist", `ada@wrenmoor.test`, password `tidewater-2026`, verified.
- Editor "Bram Okonkwo-Lisle", `bram@wrenmoor.test`, password `saltmarsh-2026`, verified, with an active editor share on the notebook below.
- Viewer "Cleo Varga", `cleo@wrenmoor.test`, password `larchgate-2026`, verified, with an active viewer share.
- Notebook "Tide gauge warm-up", owned by Ada, execution counter 0, no outputs, four cells in this order:
  1. markdown `# Tide gauge warm-up\n\nHourly heights from an invented gauge.`
  2. code `const heights = [1.2, 1.9, 2.6, 2.1, 1.4, 0.8];\nheights.length`
  3. markdown `## Range`
  4. code `Math.max(...heights) - Math.min(...heights)`

  Its search document is created and confirmed.

For example, with the seed data at start, running every cell in order shows `[1]` with `6` and `[2]` with `1.8`. The text shown for that second result follows the browser's number formatting (`1.8000000000000003` in JavaScript).

## Technical requirements

### Deployment (DP-01)

Backend: TypeScript on Node 22 with npm. Frontend: TypeScript built with Node 22 in the same `build` step and served by the backend.

`/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

The server binds `0.0.0.0` on port 4173, or `APP_PUBLIC_PORT` when it is set. `GET /api/health` answers as stated under API. Absolute links in mail use `APP_PUBLIC_URL`. The schema and Meilisearch settings are applied on serve, not only at build.

### Configuration and secrets (DP-02, DP-06)

All of these are read from the environment at start, never hard-coded, never logged, and never sent to the browser:
- `DATABASE_URL`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL`, `MAIL_FROM` (the From line of every message, printed under Services)
- `MEILISEARCH_URL`, `MEILISEARCH_API_KEY`
- `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`
- `BRACKENPAD_GRADING`
- the nine `BRACKENPAD_*` limits

The bucket is created if missing.

### Server boundary (DP-05)

- The app is same-origin only and sends no cross-origin permission headers. A state-changing request whose `Origin` header is present and differs from the app's own origin answers 403 `{"error":"cross_origin","message":"Cross-origin requests are refused."}` before any other check.
- JSON request bodies above 8,000,000 bytes answer 413 `{"error":"too_large","message":"Request body is larger than 8,000,000 bytes"}`. Exactly 8,000,000 is accepted. The import endpoint uses the import limit instead.
- The server never serves source files, source maps, `run.json`, package manifests, environment files or credentials. Those paths answer 404.
- The live connection (`GET /api/notebooks/<id>/events`, under API) is served by the app itself on the same origin. It admits every role that may open the notebook and refuses everyone else as stated there.
- No user code is evaluated on the server.
- At boot, an unreachable PostgreSQL is retried every second while health answers `starting`. An unreachable MinIO, Mailpit or Meilisearch never stops the server. Each affected request answers its 503, and later requests succeed once the service answers again.

### Browser support and performance (DP-10)

The app supports current Chromium, Firefox and Safari at 375x812, 768x1024 and 1280x800, with mouse, keyboard and touch. A notebook of 100 cells is usable, with cells shown and keys answering, within three seconds of opening. A key press in command mode changes the screen within a tenth of a second. Live changes reach other open screens within two seconds.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, and nothing else is needed to start the app.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and every bundled font, each with its licence.
- IF-03: Every shipped package and font uses one of these licences: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, CC0-1.0 or OFL-1.1.
- IF-04: No datastore other than the provided PostgreSQL, MinIO and Meilisearch holds application state. There is no SQLite, Redis, local files or in-memory store that outlives a request, except presence, locks and live connections.
- IF-05: The pages load no asset, font or script from any other origin at runtime.
- IF-06: No user cell code is evaluated on the server in any form.
- IF-07: The provided service configuration and dev compose files are left unchanged.
- IF-08: No real notebook product's name or logo appears in the UI, copy or source.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript with no `any` escapes on domain data.
- Names match this brief's domain terms: notebook, cell, revision, run, execution count, kernel status, checkpoint, compare, revert, import, export, share, invitation, presence, lock.
- Each domain rule is decided in exactly one place in the source: the run-state and kernel-status transitions, the execution counter, revision checking, the markdown allowlist, compare tagging, the output caps and the error precedence.
- There is no abstraction with only one implementation, and no wrapper that only forwards calls.
- There is no dead, commented-out or unreachable code, and no defensive check for states the rules make impossible.
- Every error response uses the one error shape from the API section.
- There are no features, endpoints or screens beyond this brief.
- Provider effects (MinIO puts, Meilisearch tasks, sent mail) are confirmed before the state that depends on them is recorded or shown.
