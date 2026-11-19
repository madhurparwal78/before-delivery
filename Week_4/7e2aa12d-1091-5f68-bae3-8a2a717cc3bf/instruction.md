# Transom Works Mullion

Mullion is a hosted visual editor for CSS grid layouts. Solo founders, the freelance designers they bring in, and the contract developers who build the result use it. A designer shapes column and row tracks, gaps and named areas by mouse, touch or keyboard. They set separate overrides for wider screens, step a live preview across widths, and get exact HTML and CSS. Anyone can edit that CSS by hand and apply it back to the visual grid. Two designers can edit one layout at the same time and see each other's presence and changes live. The server keeps every layout, its ordered change history and its saved versions. A developer reads the layout through a read-only view link. Mullion uses two backend services: Postgres keeps everything that must survive a restart, and Valkey keeps live presence and carries every applied change to every open editor and view page. Out of scope: email, outside sign-in, paid plans, generated layout suggestions, page or site building (Mullion builds one CSS grid layout and nothing else), file uploads, any datastore besides Postgres and Valkey, and any font, script, image or stylesheet from another origin.

## Problem and users

Solo founders design their own dashboards, pricing pages and app shells. Many hire a freelance designer for a few days and then hand the result to a contract developer. CSS Grid is the right tool for these layouts, but free generators stop where the real work starts. They handle only equal columns, or they leave named areas, unequal tracks and per-width overrides to hand-editing. None of them reads hand-edited CSS back into a visual grid. Two serious errors show up only after publishing. An area that is not a rectangle silently invalidates the whole area template. A wider-screen override that changes the column count without redefining its areas breaks the layout at that width. The founder and the freelancer often work at the same hours from two places. Each needs to see who else is in the layout and every change the other makes within two seconds, without reloading, and two changes to the same column must never silently overwrite each other. Layouts also live in screenshots and pasted snippets, so nobody can say which version the developer built from, or restore it.

- **Founder-designer** (daily): owns the layout library and starts layouts from starter templates. Shapes tracks and areas for each breakpoint by mouse, touch or keyboard, shares the layout, and restores an earlier version when an experiment goes wrong.
- **Guest designer** (weekly): joins a layout through the founder's co-edit link and edits it live alongside the founder. Sees the founder's presence and changes as they happen, without silently overwriting them.
- **Developer** (occasional): opens a read-only view link, steps the preview width to see each breakpoint, and copies the exact HTML and CSS.

## Journeys

1. **Build by keyboard.**
   - Start: a new visitor on `/signup`.
   - Actions: they create an account, land on the empty library, and create a Blank layout. Using only the keyboard, they move the cell cursor, extend a selection with Shift+arrow keys, press Enter, name the area, add and remove columns and rows with the grid keys, and undo and redo.
   - End state: the grid, the preview and the code show the area. After a reload, the layout is in "Your layouts" with the same CSS.
2. **Shape tracks and areas.**
   - Start: the founder has a Holy Grail layout open.
   - Actions: they type track sizes such as `minmax(200px, 1fr)`, get refusals for sizes that are not valid, drag across cells to paint an area, extend it, rename it, add and remove columns inside areas, and clear cells.
   - End state: every surface shows the new grid at once, and the column ruler shows each column's resolved width.
3. **Paste CSS back.**
   - Start: the founder has a layout open with the code pane showing.
   - Actions: they paste grid CSS from an existing stylesheet into "Layout CSS" and apply it, fix a reported line error, and apply the same CSS again.
   - End state: the areas are matched by name, the added and removed areas are announced, and the second apply reports `No changes.` with no new revision.
4. **Fold through breakpoints.**
   - Start: the founder has a layout with no breakpoints.
   - Actions: they add a "From 768px" breakpoint, rearrange its areas, set its own gap, and step "Preview width" across 768 by keyboard and by drag.
   - End state: the active tab, the area blocks, the resolved widths and the announcement follow the width in both directions, and the generated CSS holds the exact media block.
5. **Co-edit live.**
   - Start: the founder shares the co-edit link and the guest designer opens it.
   - Actions: both edit the same layout. Each sees the other in "Designers here" and sees the other's changes within two seconds. Both change column 2 at the same moment.
   - End state: the founder's change arrives at the server first and wins. The guest designer's change is refused, and they see the notice `<founder username> changed column 2 first. Your change was not applied.`, where `<founder username>` is the founder's username.
6. **Restore a version.**
   - Start: the founder has saved versions 1 to 3 and the guest designer has the layout open.
   - Actions: the founder compares versions in the "Versions" drawer and restores version 3.
   - End state: the layout returns exactly to version 3, a new version `Restored from version 3` exists, and the guest designer's editor shows the restored layout with a notice.
7. **Read as a developer.**
   - Start: the founder creates a view link and sends it.
   - Actions: the developer opens it signed out, steps the preview width, copies the code, and watches the founder's next change arrive live. The founder then regenerates the link and later revokes it.
   - End state: each old link shows `This layout is not available.` on the next load.
8. **Edit on a phone.**
   - Start: the founder opens a Dashboard Shell layout on a phone.
   - Actions: they switch between the "Editor panes" tabs, tap a cell, drag a finger across cells and name the area. Reduced motion is on.
   - End state: every motion ends at once, with the same end state and announcements.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Keyboard-built layout** A designer who signs up through the UI builds a named area on a Blank layout with only the keyboard. The layout, with its canonical CSS and HTML, is stored and still listed in their library after a reload.
- **DP-02 — Accounts and sessions** Sign-up, sign-in and sign-out follow the username and password rules and answer with the statuses, bodies and messages published in API and Business rules, carrying the session in the mullion_session cookie.
- **DP-03 — Layout library** The library lists every layout the designer owns or has joined, newest first, and keeps them after a reload and a server restart. The New layout dialog checks the layout name and the starter template.
- **DP-04 — Grid keyboard and dialogs** The grid cells are one Tab stop whose arrow, Shift+arrow, Enter, Delete, Backspace and track keys work as published. Every dialog keeps Tab and Shift+Tab inside it, closes on Escape and returns focus to its opener.
- **DP-05 — Undo and redo** Control+Z and Control+Shift+Z (Command on macOS) undo and redo the designer's own last change as new changes, with the published announcements, from any editor control except a text field.
- **DP-06 — Track sizing journey** The founder types sizes into the column and row size fields and sees the grid, the preview, the resolved widths and the generated CSS change in place. Refused sizes leave the layout as it was, confirmed through the API.
- **DP-07 — Track size forms** Every published track size form is accepted and stored, shown and generated in its canonical form.
- **DP-08 — Track size refusals** A track size that fails a check is refused with the message of the first failing check, in the published order, as a 422 from the API and in the Edit problem alert, and the field keeps the old size.
- **DP-09 — Resolved widths** Each column header's resolved-width readout equals that column's computed width in the live preview at the current preview width, rounded half up.
- **DP-10 — Painted area journey** The founder drags across cells to name an area, extends it by dragging an adjacent rectangle with the same name, and renames it. The result shows in every surface and in the stored layout.
- **DP-11 — Grid and area block markup** The editor grid publishes its cells, headers and area blocks with the roles, accessible names and data attributes given in Screens and layout.
- **DP-12 — Area rename everywhere** Renaming an area changes its name at once in every scope, in the grid, the preview, the generated HTML and CSS and every open editor and view of the layout. Saved versions keep the old name.
- **DP-13 — Canonical generated code** The Layout CSS and Layout HTML text and the API's css and html fields follow the generation rules byte for byte.
- **DP-14 — Area rules journey** A designer working by keyboard selection meets the name, overlap and shape refusals with the dialog left open, and clears cells. The stored layout changes only for accepted edits.
- **DP-15 — Area names** Area names follow the published name rule and the reserved name, with their exact messages.
- **DP-16 — Overlap and shape refusals** An area save that would overlap another area or leave an area that is not one rectangle is refused with the exact message, and nothing changes.
- **DP-17 — Clearing cells** Delete or Backspace empties the selected cells and removes any area left with no cells, unless the clear would leave an area that is not one rectangle, as qualified in Business rules.
- **DP-18 — Track add and remove journey** By grid keys and by buttons, the founder adds columns and rows inside areas and removes tracks that areas use. The stored layout matches the published rule.
- **DP-19 — Adding tracks inside areas** A new column or row joins an area wherever that area spans both neighbouring tracks, and every other new cell is empty.
- **DP-20 — Removing tracks** Removing a column or row removes those cells from every area, removes any area left with no cells, and announces each removed area.
- **DP-21 — Track count and gap limits** Track counts stay from 1 to MAX_TRACKS and gaps stay whole pixels from 0 to 200, each refusal with its exact message.
- **DP-22 — CSS round trip journey** The founder edits Layout CSS, applies it with the button or Control+Enter, fixes a line error, and sees the grid, the preview and the stored layout follow the CSS.
- **DP-23 — Accepted CSS** Apply CSS accepts the published rules, properties, whitespace and comments, and treats the CSS as the whole layout.
- **DP-24 — CSS errors by line** CSS with an error is refused with only the first error by line, in the exact published copy, while the typed text and the layout stay as they were.
- **DP-25 — Areas matched by name** Applied CSS keeps areas whose names already exist, reports added and removed areas by name, and CSS whose result equals the current layout creates no revision.
- **DP-26 — Breakpoint journey** The founder adds a breakpoint, rearranges its areas, sets its own gap, and steps the preview width across it in both directions. The stored layout and the generated media block follow.
- **DP-27 — Breakpoint limits and inheritance** Breakpoints follow the published width range, uniqueness and count limit. Each starts with its own copy of the grid in effect just below it and inherits its gap until set.
- **DP-28 — Breakpoint CSS** Each breakpoint renders as one exact media block, including its gap only when it has its own and the published display rules for areas it hides or shows.
- **DP-29 — Preview width and scope in effect** The Preview width slider resizes the preview by pointer and by the published keys. The tab in effect and its announcement follow the width, and selecting a tab moves the width.
- **DP-30 — Breakpoint Fold glide** When the scope in effect changes, each area block present before and after glides from its old cells to its new cells within the published time, and new blocks appear at once.
- **DP-31 — Track resize journey** The founder resizes columns and rows with the separators by keyboard, mouse and finger. The stored sizes match the steps taken.
- **DP-32 — Separator keys** Separator arrow keys change a track by one unit step within its range, aria-valuetext shows the canonical size, and separators of auto and minmax tracks are disabled.
- **DP-33 — Separator drag** Dragging a separator by mouse, pen or finger changes the track one step per whole 20 pixels of travel, shows the size during the drag, and sends one change on release.
- **DP-34 — Co-editing journey** Two designers in one layout see each other in Designers here and see each other's changes live. When both change one column at the same moment, the first arrival wins and the other sees the conflict notice.
- **DP-35 — Presence** Designers here lists every designer with the layout open, backed by an expiring Valkey presence key, and drops a designer as qualified in Business rules.
- **DP-36 — Live delivery** Every applied change shows in every other open editor and view page of the layout within 2 seconds, without reload, with the published announcement.
- **DP-37 — Server order and conflicts** Changes apply in server arrival order with revisions counting up by one. A stale change that touches a target another designer changed since its base revision is refused with 409 and never dropped silently.
- **DP-38 — Editor notices** Conflict and restore notices slide in at the top of the editor, stay 8 seconds, slide away, and can be dismissed early.
- **DP-39 — Version restore journey** The founder saves versions, compares them in the drawer, and restores one while the guest designer edits. Both editors and the API show the restored layout and the new version.
- **DP-40 — Saving versions and the drawer** Save version stores the whole layout as the next numbered version without changing the revision, and the Versions drawer lists versions oldest first and slides in and out within the published time.
- **DP-41 — Version differences** Compare lists the differences between two versions in the exact published order and wording.
- **DP-42 — Exact restore** Restoring a version brings back its tracks, gaps, areas and every breakpoint exactly, as one new revision and one new version. History is never rewritten, and older collaborator changes are refused as conflicts.
- **DP-43 — Developer view journey** A signed-out developer opens the view link, steps the preview width, reads the exact code, and sees the founder's change live. After the link is regenerated or revoked, the old link shows the not-available page.
- **DP-44 — Read-only view** The view page renders no editing control, its keys change nothing, and no request made through a view link can change the layout.
- **DP-45 — Link lifecycle** View links move from none to active to revoked or replaced, and co-edit links can be regenerated. Each change takes effect on the very next request, and the co-edit link adds the visitor as a collaborator whom the owner can remove.
- **DP-46 — Not found and request limits** The API follows the single published error order, answers 404 and never 403 for anything a visitor cannot open, refuses oversize bodies with 413, and never serves source files or credentials.
- **DP-47 — Phone editing journey** At 375 by 812 the founder switches editor panes, taps to place the cursor, and drags a finger across cells to name an area. The stored layout gains that area.
- **DP-48 — Editor widths** The editor uses three panes at 1280 by 800, two columns at 768 by 1024 and the Editor panes tabs at 375 by 812, with no horizontal page overflow and touch targets of at least 44 by 44 pixels.
- **DP-49 — Starter templates** A layout created from Blank, Holy Grail, Dashboard Shell or Magazine Spread holds exactly that template's published tracks, gaps, areas, breakpoints and code and nothing else, and the shipped app starts with no designers and no layouts.
- **DP-50 — Reduced motion** With reduced motion on, the drawer slide, the notice slide and the Breakpoint Fold glide happen at once, with the same end state and announcements.
- **DP-51 — Drafting-table look** The editor reads as a drafting table: a warm off-white page, blueprint-blue hairline gridlines on every canvas, heavy sans headings, monospace equal-width numerals for every track value, a burnt-orange accent and no gradients.
- **DP-52 — Valkey outage journey** On the copy whose Valkey is unreachable, the founder opens and edits a layout. Changes save and survive a reload, while the paused notice shows and another open editor stays unchanged until it reloads.
- **DP-53 — Health and live flag** /api/health and the layout's live field report whether Valkey answers, and the editor shows the live-paused notice as soon as it loads when live is false.
- **DP-54 — Saving without live delivery** With Valkey unreachable, changes, versions and links still save through Postgres, nothing is pushed live, and Designers here lists only the designer themself.
- **DP-55 — Grading setup route** POST /api/grading/setup with the right key creates the published users, layouts, versions, collaborators and links in one call. With any other key it looks absent.
- **DP-56 — Configuration from the environment** Every service URL, credential, limit and the grading key are read from the published environment variables at start, never hard-coded and never sent to the browser.

## Frontend

### Screens and layout (DP-03, DP-11, DP-44, DP-48, DP-51)

- **`/signup` and `/signin`**: a small centred card on the off-white page with a heavy heading (`Create your account` or `Sign in`), the two textboxes and the submit button, plus a link to the other page (link "Sign in" or link "Create an account").
- **`/` (library)**:
  - a top bar with the wordmark "Mullion" and button "Sign out";
  - heading `Your layouts` with button "New layout" beside it;
  - below it, a list of links, one per layout, each showing the layout name in heavy type and, under it in monospace, its column tracks in the base scope (for example `200px 1fr 200px`).
  - With no layouts the list is replaced by the text `No layouts yet.`
- **`/layouts/<id>` (editor)**, a drafting table:
  - **Top bar**: link "Your layouts"; the layout name as the page heading; status "Save state"; buttons "Save version", "Versions" and "Share" (Share for the owner only).
  - **Notice area**: the "Editor notice" alert and the "Live status" status sit at the top, under the bar.
  - **Rail (left)**:
    - tablist "Breakpoints";
    - buttons "Add breakpoint" and "Remove breakpoint";
    - textboxes "Row gap" and "Column gap";
    - buttons "Add column" and "Add row";
    - list "Designers here".
  - **Canvas (centre)**: the "Layout grid" with its column headers along the top and row headers down the left. Each column header holds the size field, the resize separator, the remove button and the resolved-width readout of the ruler. Each row header holds the size field, separator and remove button. The area blocks are drawn over the cells.
  - **Preview and code (right)**: slider "Preview width" with its readout, the iframe "Layout preview", then tablist "Code" with the CSS and HTML panels.
- **Editor widths**:
  - 1280 by 800 (any viewport 1200 pixels wide or more): rail, canvas and preview-with-code side by side.
  - 768 by 1024 (700 to 1199 pixels wide): rail and canvas side by side, with preview and code stacked below them.
  - 375 by 812 (under 700 pixels wide): the top bar and notice area stay visible. Below them, tablist "Editor panes" with tabs "Grid" (canvas), "Tracks" (rail), "Preview" (slider and frame) and "Code" (code pane) shows one panel at a time.
  - At every width the page itself never scrolls sideways. The canvas and the preview frame scroll inside their own panels when they are wider than the panel, and the preview frame keeps the preview width as its own width.
- **`/view/<token>` (view page)**:
  - heading with the layout name;
  - the read-only "Layout grid" with column headers showing sizes and resolved widths as text (no size fields, separators or remove buttons);
  - tablist "Breakpoints" for reading;
  - slider "Preview width", the "Layout preview" frame, and tablist "Code" with read-only "Layout CSS" and "Layout HTML";
  - status "Layout updates".
  - It uses the same three widths as the editor, with tabs "Grid", "Preview" and "Code" at 375 by 812.
  - No editing button, field, separator, dialog or "Designers here" list is rendered.
- **`/join/<token>` (join page)**: it has no content of its own. It either joins the layout and moves on to the editor, or shows the not-available page. Where it sends signed-in and signed-out visitors is stated once in Business rules.
- **Not-available page**: any layout, view or join page the visitor cannot open shows only heading `This layout is not available.` and link "Your layouts". Layout and join pages send a signed-out visitor to sign in first, so the only not-available page a signed-out visitor reaches is a view page whose link is unknown, revoked or replaced. That page shows link "Sign in" instead of link "Your layouts".

### Public screens and controls (DP-02, DP-03, DP-04, DP-11, DP-29, DP-35, DP-40, DP-41, DP-45, DP-48)

Only these roles and names are public. Everything else is the builder's choice. `<n>`, `<r>`, `<c>`, `<name>` and `<username>` are filled per record as stated in their sections.

**Sign-up, sign-in and library**

| Where | Role and accessible name | Visible copy or content |
|---|---|---|
| `/signup` | textbox "Username", textbox "Password" (password type), button "Create account" | |
| `/signin` | textbox "Username", textbox "Password", button "Sign in" | |
| sign-up and sign-in | alert "Form problem" | the refusal message |
| library | heading "Your layouts" (level 1) | `Your layouts` |
| library | link per layout, named by the layout name | |
| library | button "New layout", button "Sign out" | |
| dialog "New layout" | textbox "Layout name", radiogroup "Starter template" with radios "Blank", "Holy Grail", "Dashboard Shell", "Magazine Spread" (Blank checked), button "Create layout", button "Cancel" | |

**Editor: top bar and notices**

| Where | Role and accessible name | Visible copy or content |
|---|---|---|
| editor | link "Your layouts" | |
| editor | heading level 1 | the layout name |
| editor | status "Save state" | see Feedback states |
| editor | buttons "Save version", "Versions", "Share" | |
| editor | alert "Editor notice", with button "Dismiss notice" while a notice shows | conflict and restore notices |
| editor | status "Live status" | the live-paused copy |
| editor | status "Layout updates" (polite) | every announcement |
| editor | alert "Edit problem" | refusals made outside a dialog |
| every dialog | alert "Dialog problem" | refusals made inside that dialog |

**Editor: rail and canvas**

| Where | Role and accessible name | Visible copy or content |
|---|---|---|
| editor and view | tablist "Breakpoints" with tab "Base" and one tab `From <n>px` per breakpoint, narrowest first | |
| editor | buttons "Add breakpoint", "Remove breakpoint" (disabled on Base) | |
| editor | textboxes "Row gap", "Column gap" | whole pixels; in a breakpoint tab that inherits its gap, the inherited value and the word `inherited` under the fields |
| editor | buttons "Add column", "Add row" | |
| editor | list "Designers here" | one listitem per username, alphabetical |
| editor and view | grid "Layout grid" with rows of gridcells | each cell's name is `Row <r>, column <c>, <area name>` or `Row <r>, column <c>, empty` |
| editor and view | columnheader "Column <n>", rowheader "Row <n>" | the column header shows the resolved width, for example `336px` |
| editor | textbox "Column <n> size", textbox "Row <n> size" | the canonical size |
| editor | separator "Resize column <n>", separator "Resize row <n>" | |
| editor | button "Remove column <n>", button "Remove row <n>" | |
| dialog "Name area" | textbox "Area name", buttons "Save area", "Cancel" | |
| dialog "Add breakpoint" | textbox "Minimum width", buttons "Add", "Cancel" | |

**Editor: preview and code**

| Where | Role and accessible name | Visible copy or content |
|---|---|---|
| editor and view | slider "Preview width" (320 to 1440, `aria-valuetext` `<n>px`) and its readout | `<n>px` |
| editor and view | iframe titled "Layout preview" | |
| editor and view | tablist "Code" with tabs "CSS", "HTML" | |
| editor and view | textbox "Layout CSS" (multi-line; read-only on the view page), textbox "Layout HTML" (read-only) | the canonical code |
| editor | button "Apply CSS" | |

**Versions and sharing**

| Where | Role and accessible name | Visible copy or content |
|---|---|---|
| dialog "Save version" | textbox "Version name", buttons "Save", "Cancel" | |
| dialog "Versions" (the drawer) | button "Close versions"; list "Saved versions" with listitems `Version <n>: <name>`, each with button "Restore version <n>"; comboboxes "Compare from" and "Compare to" with options `Version <n>: <name>`; button "Compare"; list "Differences" | |
| dialog `Restore version <n>?` | buttons "Restore", "Cancel" | |
| dialog "Share" | button "Create view link"; read-only textbox "View link"; buttons "Regenerate view link", "Revoke view link"; read-only textbox "Co-edit link"; button "Regenerate co-edit link"; list "Collaborators" with a listitem per username, each with button "Remove <username>" | |
| editor at 375 by 812 | tablist "Editor panes" with tabs "Grid", "Tracks", "Preview", "Code" | |
| not-available page | heading level 1 | `This layout is not available.` |

**Published grid attributes (editor and view page):**

- Every gridcell carries:
  - `data-row` and `data-column` (from 1);
  - `data-area` (the area name, or empty for an empty cell);
  - in the editor, `aria-selected="true"` when selected and `aria-selected="false"` when not; on the view page, where nothing can be selected, cells carry no `aria-selected`.
  - The cursor cell is the one with focus.
- Every column and row header carries:
  - `data-track-index` (from 1);
  - `data-track-size` (canonical size);
  - `data-track-unit` (`fr`, `px`, `%`, `auto` or `minmax`).
- Column headers also carry `data-resolved-px`: the column's computed width in the preview at the current preview width, rounded half up to a whole pixel. The attribute holds the bare whole number with no unit (for example `data-resolved-px="180"`). The header shows the same value as text with the unit (`180px`). Both update on every preview width change and every layout change.
- Each area placed in the scope shown on the canvas is drawn as one block over its cells. The block carries `data-area-name`, `data-row-start`, `data-column-start`, `data-row-end` and `data-column-end`. These are grid line numbers with an exclusive end, so an area over row 2, columns 1 to 3 has `2`, `1`, `3`, `4`.
- The scope shown and edited is the selected tab of "Breakpoints". Track, gap and area edits apply to that scope only, except renames (every scope).

### Interactions (DP-01, DP-04, DP-05, DP-10, DP-14, DP-17, DP-29, DP-31, DP-32, DP-33, DP-44, DP-47)

**Cursor and selection**

- The grid's cells are a single Tab stop. The header controls (size fields, separators, remove buttons) are their own Tab stops, in reading order before the cells. Tab order elsewhere follows the reading order of the screen.
- When the cells get focus, the cursor cell (row 1, column 1 at first) takes focus and shows a solid burnt-orange focus ring.
- Arrow keys move the cursor one cell, stopping at the edges without wrapping. A plain arrow key also moves the anchor, so the selection is the cursor cell alone.
- Shift+arrow keys move only the cursor. The selection is always the rectangle from the anchor cell to the cursor cell, and its cells carry `aria-selected="true"`.
- Enter opens "Name area" for the selection.
- Delete or Backspace clears the selection, following the clearing rule in Business rules.

**Track keys and undo**

- With focus in the grid:
  - `c` adds a column after the cursor's column;
  - Shift+`C` removes the cursor's column;
  - `r` adds a row after the cursor's row;
  - Shift+`R` removes the cursor's row.
  - After a removal the cursor stays at the same position, clamped to the grid.
- Control+Z undoes the designer's own last change and Control+Shift+Z redoes it (Command instead of Control on macOS). This works with focus on any editor control, including buttons, separators, tabs and grid cells. Inside a text field these keys edit the text instead.

**Pointer and touch on the grid**

- Pressing a cell with mouse, pen or finger and releasing on the same cell places the cursor and anchor there.
- Pressing a cell and moving into other cells selects the rectangle from the pressed cell to the cell under the pointer, highlighted live. Releasing opens "Name area" for that rectangle.
- While a finger drags across the grid, the page does not scroll. On a phone, the canvas panel scrolls with two fingers or with its own scrollbar.

**Dialogs**

- In every dialog, Tab past the last control wraps to the first and Shift+Tab before the first wraps to the last.
- Escape or "Cancel" closes the dialog without a change.
- Focus returns to the control that opened the dialog: the cursor cell for "Name area", the "Versions" button for the drawer, the "Restore version <n>" button for the restore confirmation.
- "Name area" opens with focus in "Area name". The field is pre-filled with the area's name when the selection is exactly one existing area, and empty otherwise. Enter in the field saves.
- A refusal inside a dialog keeps it open, with the message shown and announced (Feedback states).

**Track sizes, gaps and code**

- In "Column <n> size", "Row <n> size", "Row gap" and "Column gap", Enter or leaving the field applies the value if it differs from the stored one.
- Control+Enter inside "Layout CSS" does the same as "Apply CSS".

**Separators**

- Arrow Right and Arrow Down grow the track one step. Arrow Left and Arrow Up shrink it one step.
- Steps: 10 pixels for a px track, 0.25 for an fr track, 1 for a % track.
- A step that would leave the range in Business rules does nothing and sends nothing.
- Dragging a separator (mouse, pen or finger) changes the size by one step for every whole 20 pixels of pointer travel along its axis (right and down grow). The size field and `aria-valuetext` show the new size while dragging, and one change is sent on release (none if the size did not change).
- Separators of `auto` and minmax tracks carry `aria-disabled="true"` and ignore keys and drags.
- Separators and cells give a touch target of at least 44 by 44 pixels.

**Preview width**

- "Preview width" runs from 320 to 1440 and starts at 1280 each time the editor or view page opens.
- Keys:
  - Arrow Right and Arrow Up add 10;
  - Arrow Left and Arrow Down subtract 10;
  - Page Up jumps to the next edge above and Page Down to the next edge below, among 320, every breakpoint's minimum width and 1440;
  - Home goes to 320 and End to 1440.
- Dragging the thumb works with mouse, pen or finger.
- Each change resizes the preview frame to that width, updates the readout and every resolved-width readout.
- Scope in effect:
  - The tab in effect is the widest breakpoint whose minimum width is at or below the preview width, or Base.
  - That tab becomes the selected tab, and the canvas shows that scope.
  - Selecting a tab sets the preview width to its minimum width (375 for Base).

**Versions, sharing and view pages**

- "Versions" opens the drawer from the right edge. "Close versions" or Escape closes it.
- "Restore version <n>" opens `Restore version <n>?`. "Restore" there applies the restore and closes the confirmation, leaving the drawer open.
- "Share" opens the "Share" dialog. Its buttons act at once, and the link fields update in place.
- On the view page, arrow keys move the cursor over the read-only grid. No key, click or drag selects, names, resizes or clears anything.

**Phone tabs**

- At 375 by 812, selecting a tab in "Editor panes" shows its panel at once. Arrow Left and Arrow Right move between the tabs.

### Visual design (DP-51, DP-48)

- **Colour**:
  - The page is a warm off-white, like drafting paper, with near-black graphite ink for text and rules.
  - Gridlines are fine blueprint-blue hairlines, one pixel wide. They are visible on every canvas: the editor grid, the view page grid and the area outlines in the preview.
  - One burnt-orange accent marks primary buttons, the selection outline, the cursor ring and the active breakpoint tab.
  - A deep wine red marks only invalid fields and refusal messages.
  - Area blocks are pale washes of the blueprint blue with their names in ink.
  - Surfaces are flat, with no gradients and no drop shadows. Panels are separated by hairline rules.
- **Type**:
  - Headings use the system sans-serif in a heavy weight.
  - Body text uses the system sans-serif at a regular weight.
  - Code, track sizes, gaps, widths, readouts and revision numbers use the system monospace with equal-width numerals, so columns of numbers line up.
  - Each heading level is about one fifth larger than the level below it, and body text sits one such step below the smallest heading.
- **Density**: compact. Tight rows and narrow padding, so the whole layout fits on a 1280 by 800 screen without page scrolling. Every tappable control is still at least 44 by 44 pixels.
- **Composition**: a drafting table. Tracks and breakpoint tabs sit in the rail, the editable grid with its ruler of resolved widths sits in the centre, and the live preview and code sit on the right.
- **Contrast**: all text and control boundaries meet WCAG 2.2 AA contrast against the off-white page, including the hairlines around inputs.

### Motion and effects (DP-30, DP-38, DP-40, DP-50)

Only these three motions exist. Nothing else animates, fades or loops, and there is no idle or decorative motion.

1. **Versions drawer**: it slides in from the right edge in 200 to 350 milliseconds, moving fast at first and settling softly. It slides back out the same way.
2. **Notice**: a notice in "Editor notice" slides down into place in 150 to 300 milliseconds. It stays 8 seconds from the moment it appears, then slides up and away in 150 to 300 milliseconds and is removed. "Dismiss notice" starts the exit at once.
3. **Breakpoint Fold** (the signature):
   - Whenever the scope in effect changes, by the slider or by selecting a tab, the canvas switches to the new scope's grid.
   - Each area block present in both the old and new scope glides from its old cells to its new cells in 150 to 300 milliseconds, starting fast and settling.
   - Blocks for areas new to the scope appear at once in place, and blocks for areas the new scope does not place disappear at once.
   - At the same moment, the matching tab becomes selected and the readouts update.
   - Stepping back across the boundary reverses every step: the blocks glide back to their former cells and the narrower tab becomes selected again.
   - For example, with the Holy Grail at 768, pressing Arrow Left on "Preview width" glides header, nav, main, aside and footer from their three-column positions into the single stacked column. Arrow Right glides them back.
- **Reduced motion**: when the device asks for reduced motion, all three happen at once with no movement. The drawer is simply open or closed, notices appear and disappear in place (still after 8 seconds), and area blocks jump to their new cells. End states, the selected tab, readouts and announcements are exactly as with motion.

### Feedback states (DP-05, DP-08, DP-12, DP-16, DP-20, DP-24, DP-25, DP-29, DP-36, DP-38, DP-53)

**Where feedback appears**

- **"Edit problem"** (alert): every refusal of an edit made outside a dialog, using the exact message from Business rules. Examples are a track size, a gap, a grid key, a separator, "Apply CSS" and "Remove breakpoint". A refused size or gap also marks its field invalid and shows the message under the field. The layout stays at its last valid state, the field keeps the stored value, and "Layout CSS" keeps the typed text.
- **"Dialog problem"** (alert in each dialog): every refusal inside a dialog, with the exact message. The dialog stays open.
- **"Form problem"** (alert): sign-up and sign-in refusals.
- **"Save state"** (status):
  - shows `Saving…` from the moment a change, version or link request is sent until its reply arrives;
  - then shows `All changes saved.`, which is also its text at load;
  - when a request gets no reply because the server cannot be reached, it shows `Not saved. Check your connection.` and "Edit problem" announces `Mullion could not be reached. Your last change was not saved.`

**Announcements in "Layout updates"**

The author's editor announces each accepted action with this exact copy. `<n>` is a 1-based track number or a width in pixels, `<size>` is the canonical size, and `<names>` are names joined by `, `.

Some announcements name several areas: a repeated ` Area <name> removed.`, `Areas added:` and `Areas removed:`. These names follow the area order of the generated code (Business rules). Removed areas use that order in the layout before the change. Added areas use that order in the layout after the change.

| Action | Announcement |
|---|---|
| Track size set | `Column <n> set to <size>.` / `Row <n> set to <size>.` |
| Track added | `Column added after column <n>.` / `Row added after row <n>.` |
| Track removed | `Column <n> removed.` / `Row <n> removed.`, then ` Area <name> removed.` for each area it removed |
| Gap set | `Row gap set to <n>px.` / `Column gap set to <n>px.` |
| Area created | `Area <name> created.` |
| Area renamed | `Area <old> renamed to <new>.` |
| Area extended | `Area <name> extended.` |
| Cells cleared | `Cells cleared.`, then ` Area <name> removed.` for each area it removed |
| Any change the server answers as unchanged (Business rules), for example an area saved over exactly itself or CSS whose result equals the layout | `No changes.` |
| Breakpoint added or removed | `Breakpoint From <n>px added.` / `Breakpoint From <n>px removed.` |
| CSS applied | `CSS applied.`, then ` Areas added: <names>.` and ` Areas removed: <names>.` when there are any |
| Undo or redo | `Undone.` / `Redone.` |
| Version saved | `Version <n> saved.` |
| Version restored | `Restored version <n>.` |
| Scope in effect changed | `Showing <tab name> at <n>px.` (for example `Showing From 768px at 768px.`) |
| View link | `View link created.` / `View link regenerated.` / `View link revoked.` |
| Co-edit link | `Co-edit link regenerated.` |
| Collaborator removed | `<username> removed from collaborators.` |

**Live updates and notices**

- **Other editors**: every other open editor of the layout announces an applied change as `<username>: <the announcement the author saw>`, within the 2-second live window from Business rules, for example `bob-1: Column 2 set to 2fr.`
- **View pages** announce `Layout updated.` for each applied change.
- **Conflict notice** ("Editor notice"): `<username> changed <target> first. Your change was not applied.` The editor then shows the current layout from the 409 body. `<username>` and `<target>` are defined in Business rules.
- **Restore notice** ("Editor notice") in every other open editor: `<username> restored version <n>.`
- A newer notice replaces the one showing.
- **Live paused** ("Live status"): `Live updates are paused. Your changes are still saved.`
  - It shows as soon as an editor or view page loads with `"live": false` and stays while the page is open.
  - When `live` is true the region is empty.
  - The page decides this only from the server's `live` field, never from a browser timer.

## Backend

### API (DP-02, DP-03, DP-13, DP-37, DP-40, DP-41, DP-45, DP-46, DP-53, DP-55)

**Format**

- Every request and response body is JSON (`application/json; charset=utf-8`). Bodies may be up to 65,536 bytes; exactly 65,536 is allowed.
- A body that is not valid JSON, or a request field of the wrong type, answers 422 `{"error":"invalid","message":"The request body is not valid."}`.
- Every error body has the field `error`. Validation errors also carry `message`, and conflicts carry `revision` and `layout`.

**Error order** (every route, stated once). The first that applies wins:

1. 413 `{"error":"too_large"}` for a body over 65,536 bytes.
2. 401 `{"error":"sign_in_required"}` when the route needs a session and none is valid.
3. 404 `{"error":"not_found"}` for an unknown route, an unknown layout, link or version, or anything this visitor cannot open (including owner-only routes called by a collaborator).
4. 422 `{"error":"invalid","message":"<message>"}` for the request's own form and values (sizes, names, widths, CSS, lengths).
5. 409 for state conflicts (a stale change, a missing view link).
6. 422 for rules checked against the current layout (overlap, shape, track and breakpoint limits, a missing track or breakpoint, nothing to undo).

Endpoint rows below list only their own extra errors. The API never answers 403. There are no cross-origin permission headers.

**Layout object.** It appears in every response that carries a layout. For example, a Holy Grail layout at start:

```json
{
  "id": "<layout id>",
  "name": "<layout name>",
  "role": "owner",
  "revision": 1,
  "columns": ["1fr"],
  "rows": ["auto", "auto", "1fr", "auto", "auto"],
  "gap": {"row": 16, "column": 16},
  "areas": [
    {"name": "header", "row_start": 1, "column_start": 1, "row_end": 2, "column_end": 2},
    {"name": "nav", "row_start": 2, "column_start": 1, "row_end": 3, "column_end": 2},
    {"name": "main", "row_start": 3, "column_start": 1, "row_end": 4, "column_end": 2},
    {"name": "aside", "row_start": 4, "column_start": 1, "row_end": 5, "column_end": 2},
    {"name": "footer", "row_start": 5, "column_start": 1, "row_end": 6, "column_end": 2}
  ],
  "breakpoints": [
    {"min_width": 768, "columns": ["200px", "1fr", "200px"], "rows": ["auto", "1fr", "auto"],
     "areas": [
       {"name": "header", "row_start": 1, "column_start": 1, "row_end": 2, "column_end": 4},
       {"name": "nav", "row_start": 2, "column_start": 1, "row_end": 3, "column_end": 2},
       {"name": "main", "row_start": 2, "column_start": 2, "row_end": 3, "column_end": 3},
       {"name": "aside", "row_start": 2, "column_start": 3, "row_end": 3, "column_end": 4},
       {"name": "footer", "row_start": 3, "column_start": 1, "row_end": 4, "column_end": 4}],
     "gap": null}
  ],
  "live": true,
  "css": "<the generated CSS>",
  "html": "<the generated HTML>"
}
```

- `id` is an opaque string.
- `role` is `owner`, `collaborator` or `viewer`.
- Track sizes are canonical strings.
- `areas` are in reading order of their top-left cell (rows top to bottom, then columns left to right). Area lines are grid line numbers with an exclusive end.
- `breakpoints` are narrowest first.
- A breakpoint's `gap` is `{"row","column"}` when set in that breakpoint, else `null` (inherited).
- `live` is whether Valkey answered at the time of the request.

**Accounts**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/signup` | `{"username","password"}` | 201 `{"username"}` and sets `mullion_session` | 422 with the username or password message; 409 `{"error":"taken","message":"That username is taken."}` |
| `POST /api/session` | `{"username","password"}` | 200 `{"username"}` and sets `mullion_session` | 401 `{"error":"wrong_credentials","message":"Wrong username or password."}` |
| `DELETE /api/session` | none | 204, clears the cookie and ends the session on the server | |
| `GET /api/me` | none | 200 `{"username"}` | 401 |

`mullion_session` is an opaque random value, HttpOnly, SameSite=Lax, Path `/`.

**Library and layouts** (session required)

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/layouts` | | 200 `{"layouts":[{"id","name","role","columns"}]}`, newest first by when the layout entered this designer's library (created or joined); `columns` is the base column list | |
| `POST /api/layouts` | `{"name","template"}`, `template` one of `blank`, `holy-grail`, `dashboard-shell`, `magazine-spread` (default `blank`) | 201 layout object at revision 1 | 422 layout-name message; 422 `Choose a starter template.` |
| `GET /api/layouts/<id>` | | 200 layout object | |
| `POST /api/layouts/<id>/changes` | `{"base_revision": <n>, "change": {...}}` | 200 `{"revision": <n>, "layout": {...}}`; for any change of any kind with no effect (Business rules), 200 `{"revision": <current>, "unchanged": true}` | 409 `{"error":"conflict","revision": <current>, "layout": {...}}`; 422 with the rule's message |

**Change objects.** `scope` is `"base"` or a breakpoint's minimum width as a number. `axis` is `"column"` or `"row"`. Track indexes are 1-based.

- `{"kind":"set_track","scope","axis","index","size"}`
- `{"kind":"add_track","scope","axis","after"}`, where `after` is 1 to the track count and the new track is `1fr`
- `{"kind":"remove_track","scope","axis","index"}`
- `{"kind":"set_gap","scope","row","column"}`
- `{"kind":"set_area","scope","name","row_start","column_start","row_end","column_end"}`
- `{"kind":"rename_area","name","new_name"}`
- `{"kind":"clear_cells","scope","row_start","column_start","row_end","column_end"}`
- `{"kind":"add_breakpoint","min_width"}`, `{"kind":"remove_breakpoint","min_width"}`
- `{"kind":"apply_css","css"}`
- `{"kind":"restore_version","number"}`
- `{"kind":"undo"}`, `{"kind":"redo"}`

Change errors that are not in Business rules:

- an unknown `kind`: 422 `Unknown change.`
- a scope that does not exist: 422 `There is no breakpoint at <n>px.`
- an index outside the tracks: 422 `There is no column <n>.` / `There is no row <n>.`
- a `base_revision` above the current revision: 422 `Unknown base revision.`
- an unknown version number in `restore_version`: 422 `There is no version <n>.`

**Versions** (session required, owner or collaborator)

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/layouts/<id>/versions` | `{"name"}` | 201 `{"number","name"}` | 422 version-name message |
| `GET /api/layouts/<id>/versions` | | 200 `{"versions":[{"number","name"}]}` oldest first | |
| `GET /api/layouts/<id>/versions/<n>` | | 200 `{"number","name","layout": {...}}` (the layout as saved, `revision` being the revision at save time) | 404 |
| `GET /api/layouts/<id>/compare?from=<n>&to=<m>` | | 200 `{"differences": ["<line>", ...]}` | 404 for an unknown version |

**Sharing**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/layouts/<id>/share` | owner only | 200 `{"view_path": "/view/<token>" or null, "join_path": "/join/<token>", "collaborators": ["<username>", ...]}` (alphabetical) | |
| `POST /api/layouts/<id>/view-link` | owner only | 201 `{"view_path"}`; creates a link when there is none, replaces the active one otherwise | |
| `DELETE /api/layouts/<id>/view-link` | owner only | 204 | 409 `{"error":"no_view_link"}` when no link is active |
| `POST /api/layouts/<id>/join-link` | owner only | 201 `{"join_path"}` (replaces the co-edit link) | |
| `DELETE /api/layouts/<id>/collaborators/<username>` | owner only | 204 | 404 when that username is not a collaborator |
| `POST /api/join/<token>` | session required | 200 `{"layout_id"}` | 404 for an unknown or replaced token |
| `GET /api/view/<token>` | no session | 200 layout object with `role` `viewer` | 404 for an unknown, revoked or replaced token |

**Live connections**

- These are WebSockets served by the app on its own port:
  - `/api/layouts/<id>/live` for editors (the session cookie is required and the designer must be able to open the layout);
  - `/api/view/<token>/live` for view pages.
- The server refuses the upgrade for anyone who could not `GET` the same layout, and for an `Origin` other than the app's own.
- The server only pushes on these connections. Their message format is the builder's choice; only what the pages show is checked.

**Health and grading**

- `GET /api/health`:
  - 200 `{"status":"ok"}` when Postgres is ready and Valkey answers a PING within 1 second;
  - 200 `{"status":"unavailable"}` when Postgres is ready but Valkey does not answer;
  - 503 `{"status":"starting"}` until Postgres is ready.
- `POST /api/grading/setup` with header `X-Grading-Key` equal to `GRADING_KEY`. Any other value, a missing header, or an unset `GRADING_KEY` answers 404 `{"error":"not_found"}`, so the route looks absent.

Grading setup request body:

```json
{"users": [{"username": "ana-1", "password": "drafting-01"}],
 "layouts": [{"ref": "L1", "owner": "ana-1", "name": "Pricing page", "template": "holy-grail",
              "columns": ["1fr"], "rows": ["1fr"], "gap": {"row": 16, "column": 16},
              "areas": [{"name": "main", "row_start": 1, "column_start": 1, "row_end": 2, "column_end": 2}],
              "breakpoints": [{"min_width": 768, "columns": ["1fr", "1fr"], "rows": ["1fr"], "areas": [], "gap": null}],
              "versions": [{"name": "First pass", "template": "blank"}],
              "collaborators": ["bob-1"], "view_link": true}]}
```

- Each layout gives either `template` or the fields `columns`, `rows`, `gap`, `areas`, `breakpoints` (`template` wins when both are present). The same applies to each version. These fields give the layout's current state at revision 1.
- `versions` are saved in order as versions 1 to n. `collaborators` must be users in this call or existing users. `view_link` creates an active view link.
- Every value is checked with the same rules and messages as the editor: 422 `{"error":"invalid","message":"..."}`, and nothing is created.
- A username that already exists is reused when its password matches, else 409 `{"error":"taken","message":"That username is taken."}`.
- Success: 201 `{"sessions": {"<username>": "<mullion_session cookie value>"}, "layouts": {"<ref>": {"id","revision","view_path" or null,"join_path"}}}`. Each session is valid like a sign-in session.

### Business rules (DP-02, DP-03, DP-05, DP-07, DP-08, DP-12, DP-15–DP-17, DP-19–DP-21, DP-23–DP-25, DP-27, DP-28, DP-35–DP-37, DP-40–DP-42, DP-44, DP-45, DP-49, DP-54)

**Accounts**

- Usernames are 3 to 24 characters of lowercase letters, digits and hyphens, starting with a letter: `Usernames use 3 to 24 lowercase letters, digits and hyphens and start with a letter.`
- Passwords are 8 to 128 characters: `Passwords are 8 to 128 characters.`
- Both limits are inclusive. Passwords are stored only as salted slow hashes.
- Where the browser lands:
  - A signed-out visit to `/`, `/layouts/<id>` or `/join/<token>` sends the visitor to `/signin?next=<that path>`.
    - Link "Create an account" on that page carries the same `next` to `/signup`.
    - `next` is honoured only when it is a path on the app's own origin starting with a single `/`. Any other value is ignored.
  - After sign-up or sign-in, the browser goes to `next` when it is present, else to `/`.
  - After "Create layout", the browser goes to the new layout's `/layouts/<id>`.
  - After "Sign out", the browser goes to `/signin`.
  - A signed-in visit to the current co-edit link `/join/<token>` makes the designer a collaborator (the owner's visit changes nothing) and lands on `/layouts/<layout id>`.
    - A signed-in visit to an unknown or replaced co-edit link shows the not-available page.
    - A signed-out visitor to a join link therefore signs in, returns to `/join/<token>`, joins and lands on the layout.
  - A visitor who signs in and returns to a `/layouts/<id>` they cannot open sees the not-available page.
  - `/view/<token>` never redirects.

**Layout names**

- 1 to 80 characters after trimming: `Layout names are 1 to 80 characters.`

**Track sizes**

- A size is one of these forms, lowercase. Spaces around the whole value and around the parts inside minmax are ignored. A number is digits, optionally followed by a point and digits.
  - `<n>fr`, with n from 0.25 to 100 and at most two decimals;
  - `<n>px`, with n a whole number from 1 to 4000, written without a point;
  - `<n>%`, with n from 1 to 100 and at most two decimals;
  - `auto`;
  - `minmax(<min>, <max>)`, where min is a px, % or auto size and max is a px, %, fr or auto size.
- **Canonical form**, used everywhere a size is shown, stored or generated: numbers have no trailing zeros and no trailing point, and minmax has exactly one space after the comma. For example `1.50fr` → `1.5fr`, `2.0fr` → `2fr`, `minmax( 200px , 300px )` → `minmax(200px, 300px)`.
- Checks, in this order; the first failing check gives the message:
  1. Not one of the forms: `Use a size like 1fr, 200px, 25%, auto or minmax(100px, 1fr).` For example `10em`, `200.5px`, `fit-content(200px)`, `1FR`.
  2. A number out of its range: `Sizes run from 0.25fr to 100fr, 1px to 4000px and 1% to 100%.` For example `0fr`, `0.2fr`, `101fr`, `0px`, `4001px`, `150%`, `minmax(1fr, 0.1fr)`.
  3. fr as the minimum of minmax: `A flexible size (fr) can only be the maximum in minmax.` For example `minmax(1fr, 200px)`.
  4. Both parts px, or both %, with the minimum above the maximum: `The minimum is larger than the maximum.` For example `minmax(300px, 200px)`, `minmax(50%, 20%)`.

**Track counts and gaps**

- A scope has 1 to `MAX_TRACKS` columns and 1 to `MAX_TRACKS` rows. Messages:
  - `A layout can have at most <MAX_TRACKS> columns.` / `A layout can have at most <MAX_TRACKS> rows.`
  - `A layout needs at least one column.` / `A layout needs at least one row.`
- Gaps are whole pixels from 0 to 200, inclusive: `Gaps are whole pixels from 0 to 200.`
- Setting a gap in a breakpoint makes that breakpoint's gap its own.

**Adding and removing tracks**

- **Adding.** A column inserted after column k joins an area in every row where that area has cells in both column k and column k+1. Every other new cell is empty. Rows work the same way.
  - Worked example on the Holy Grail "From 768px" grid (`"header header header" "nav main aside" "footer footer footer"`, columns `200px 1fr 200px`):
  - adding after column 1 gives `"header header header header" "nav . main aside" "footer footer footer footer"` with columns `200px 1fr 1fr 200px`;
  - adding after column 3 gives `"header header header ." "nav main aside ." "footer footer footer ."` with columns `200px 1fr 200px 1fr`.
- **Removing.** Every area loses its cells in that track, and an area left with no cells is removed from that scope. Removing column 3 of the same grid gives `"header header" "nav main" "footer footer"` with columns `200px 1fr`, and removes area aside.

**Areas**

- Every area in every scope is one rectangle, and every area row has as many cells as the scope has columns. An edit that would break this is refused and the last valid grid stays.
- Names are 1 to 24 characters of lowercase letters, digits and hyphens, starting with a letter: `Area names use 1 to 24 lowercase letters, digits and hyphens and start with a letter.`
- The name `layout` is reserved: `The name layout is reserved.`
- An area is identified by its name across all scopes. It may be placed in some scopes and not others.
- **Saving a name over a selection** (`set_area`) is decided in this order:
  1. The name rule, then the reserved name.
  2. Rename: the selection is exactly one placed area A and the name is used in no scope. A is renamed in every scope, and saved versions keep the old name.
  3. Overlap: the selection contains cells of any area other than the named one, which is refused with `Area <name> would overlap area <other>.` `<other>` is the first such area in reading order.
  4. Extend: the name is already placed in this scope. The area grows to the union of its cells and the selection when that union is one rectangle (extended). It is refused with `Area <name> must stay one rectangle.` otherwise. A selection exactly equal to the area has no effect, as defined under Revisions and server order.
  5. Otherwise the area is placed over the selection in this scope (created).
- A rename through the API (`rename_area`) follows the name rule, the reserved name, and `There is no area <name>.` for an unknown name. If `new_name` is already used it is refused with `The name <new_name> is already used.`
- **Clearing** (`clear_cells`) empties the selected cells and removes any area left with no cells in that scope. A clear that would leave an area that is not one rectangle is refused with `Area <name> must stay one rectangle.`, naming the first such area in reading order.

**Generated code** (the single source of the code pane, the preview and the API `css` and `html`)

- The container class is `layout`, and each area's class is its name.
- **CSS, in order:**
  1. The base `.layout { … }` rule with `display: grid;`, `grid-template-columns`, `grid-template-rows` and `gap`. The gap is one value when the row and column gaps are equal, else `<row>px <column>px`; zero is `0px`. When the base scope places any area, the rule ends with `grid-template-areas`, one quoted row per line, cells joined by one space, `.` for an empty cell, no alignment padding. Properties are indented two spaces and area rows four spaces.
  2. A blank line, then one `.<name> { grid-area: <name>; }` per area, in order of first appearance: base reading order, then each breakpoint narrowest first in its reading order.
  3. Then `.<name> { display: none; }` for every area the base scope does not place, in the same order.
  4. Then, per breakpoint narrowest first, a blank line and `@media (min-width: <n>px) {`. Inside it, a `.layout` rule indented two spaces (its properties four, area rows six) holds:
     - that breakpoint's `grid-template-columns` and `grid-template-rows`;
     - `gap` only when the breakpoint sets its own gap;
     - `grid-template-areas`, or `grid-template-areas: none;` when it places no area.
     After the `.layout` rule, the block has `  .<name> { display: none; }` for each area it does not place that the next narrower scope places, then `  .<name> { display: block; }` for each area it places that the next narrower scope does not, each in area order, then `}`.
  5. The text ends with exactly one newline.
- **HTML:** `<div class="layout">`, then one `  <div class="<name>"><name></div>` per area in the same order as the area rules, then `</div>` and one newline. With no areas it is `<div class="layout"></div>` and one newline.
- **Worked example 1, a hidden area.** A Holy Grail whose "From 768px" grid drops aside (columns `200px 1fr`, areas `"header header" "nav main" "footer footer"`) keeps the base part unchanged, and its breakpoint block is:

```css
@media (min-width: 768px) {
  .layout {
    grid-template-columns: 200px 1fr;
    grid-template-rows: auto 1fr auto;
    grid-template-areas:
      "header header"
      "nav main"
      "footer footer";
  }
  .aside { display: none; }
}
```

- **Worked example 2, hide-then-show and an inherited gap.**
  - The layout: base `1fr` / `auto 1fr` / `"header" "main"` with gap 16px; a 600px breakpoint with the same grid and its own gap 24px; a 1024px breakpoint `1fr 300px` / `auto 1fr` / `"header header" "main promo"`.
  - The base part ends with `.promo { grid-area: promo; }` then `.promo { display: none; }`.
  - The 600px block holds its grid plus `gap: 24px;` and no display rule.
  - The 1024px block holds its grid with no `gap` line and ends with `  .promo { display: block; }`.
  - The HTML lists header, main, promo.

**CSS back to the grid** (`apply_css`)

- The CSS is at most 20,000 characters (20,000 allowed): `The CSS is longer than 20,000 characters.`
- **Accepted:**
  - the `.layout` rule;
  - `.<name> { grid-area: <name>; }` rules, where both names are the same;
  - `.<name> { display: none; }` and `.<name> { display: block; }` rules (accepted and then recomputed);
  - `@media (min-width: <n>px)` blocks holding a `.layout` rule and those area rules.
- Properties inside `.layout`: `display: grid`, `grid-template-columns`, `grid-template-rows`, `grid-template-areas`, `gap` (one or two values), `row-gap`, `column-gap`. Gap values are `<n>px` or `0`.
- Any whitespace, line breaks and property order are accepted, and `/* comments */` are dropped.
- The CSS describes the whole layout. Breakpoints and areas missing from it are removed.
- A `@media` block missing tracks or areas copies them from the next narrower scope, and a block without a gap inherits it.
- If the base `.layout` rule lacks columns or rows, they become `1fr` tracks, as many as its area rows have cells (or rows), or one when it has no areas. A missing base gap is 0.
- **Errors.** Only the first error by line is reported (lines count from 1). Nothing changes and the typed text stays.
  - `Line <n>: unknown property <property>.`
  - `Line <n>: <track-size message>` (the line of the property; the message is the track-size check's message)
  - `Line <n>: Gaps are whole pixels from 0 to 200.`
  - `Line <n>: every area row needs <k> cells.` (the line of the first row with the wrong count; `<k>` is the column count)
  - `Line <n>: grid-template-areas needs <k> rows.` (`<k>` is the row count)
  - `Line <n>: area <name> is not one rectangle.` (the line of the first row holding that area)
  - `Line <n>: <name message>` (the message is the area name rule's message or the reserved-name message; the line is the first row holding the bad name)
  - `Line <n>: area <name> is not in any grid-template-areas.`
  - `Line <n>: only .layout and area rules are allowed.`
  - `Line <n>: breakpoints use @media (min-width: <n>px).`
  - `Line <n>: Breakpoints start between 400px and 1440px.`
  - `Line <n>: There is already a breakpoint at <n>px.`
  - `Line <n>: A layout can have at most <MAX_BREAKPOINTS> breakpoints.`
  - `Line <n>: A layout can have at most <MAX_TRACKS> columns.` / `rows.`
  - `Line <n>: .layout needs display: grid.` (the line of the `.layout` selector, or line 1 when there is no base `.layout` rule)
  - `Line <n>: missing }.` (the last line)
- **Matching by name:**
  - An area whose name is in both the current layout and the CSS stays the same area.
  - Areas added are names in the CSS but not in the layout. Areas removed are names in the layout but not in the CSS.
  - When the result equals the current layout in every scope, nothing changes, no revision is created, and the answer is the `unchanged` reply from API.
  - Applying the generated CSS unchanged always has this result, and every accepted edit renders the same canonical CSS.

**Breakpoints**

- Minimum widths are whole pixels from 400 to 1440, inclusive: `Breakpoints start between 400px and 1440px.`
- One breakpoint per width: `There is already a breakpoint at <n>px.`
- At most `MAX_BREAKPOINTS` per layout: `A layout can have at most <MAX_BREAKPOINTS> breakpoints.`
- A new breakpoint starts with its own copy of the columns, rows and areas in effect just below its width. From then on its grid is its own, and later edits in other scopes never change it.
- Its gap is inherited from the next narrower scope until set in that tab.
- A scope applies from its minimum width up to the next breakpoint, and Base applies below the first breakpoint. A breakpoint that changes a track count therefore always carries its own areas.
- Removing a breakpoint removes its grid. Areas placed nowhere else disappear from the code.

**Resolved widths**

- Resolved widths are the preview's computed column widths at the frame width. With column gap g and frame width W, percentages are of W, fixed and auto tracks are sized as the browser does, and fr tracks share what remains after the gaps.
- Worked examples (tracks, column gap, frame width → widths):
  - `200px 1fr 200px`, 16, 768 → `200px 336px 200px`; the same at 1280 → `200px 848px 200px`;
  - `240px 1fr`, 12, 1024 → `240px 772px`;
  - `2fr 1fr 1fr`, 16, 1280 → `624px 312px 312px`;
  - `minmax(200px, 1fr) 2fr`, 16, 375 → `200px 159px`; the same at 1216 → `400px 800px`;
  - `25% 1fr 100px`, 20, 800 → `200px 460px 100px`;
  - `minmax(100px, 300px) 1fr`, 0, 1000 → `300px 700px`;
  - `1fr 1fr`, 16, 375 → `179.5px 179.5px`, shown as readouts `180px`.

**Revisions and server order**

- A new layout starts at revision 1. Every applied change adds exactly 1, in the order the server receives changes for that layout. Changes are serialised per layout.
- A change has no effect when the layout after it would equal the layout before it in every scope. Examples are an area saved over exactly itself, a track size or gap equal to the stored one, and CSS whose result equals the layout.
  - Such a change is checked like any other change, so a refusal still answers 409 or 422.
  - When accepted, it is not applied. It gets no revision, no change-log entry and no live fan-out, does not enter the undo history, and answers the `unchanged` reply from API.
- Saving a version, link actions and collaborator actions do not change the revision.
- Every applied change is written to the layout's change log in Postgres with its revision, author and change object.

**Conflicts**

- A change whose `base_revision` is older than the current revision still applies, unless a change applied after its base revision by another designer touched the same target. Targets:
  - the same track (same scope, axis and index);
  - any track added or removed in the same scope, which touches every track and cell of that scope;
  - the same area, or overlapping cells in the same scope;
  - the gaps of the same scope;
  - the whole layout: `apply_css`, `restore_version`, breakpoint add or remove, and an undo or redo of any of these.
- A designer's own earlier changes never conflict with their later ones.
- A refused stale change gets 409 with the current layout. The refusal is recorded nowhere else and is never dropped silently.
- In the conflict notice, `<username>` is the author of the first such winning change. `<target>` names it:
  - `column <n>` or `row <n>` for a track size (its index in that change);
  - `area <name>` for `set_area` (its name), `rename_area` (the old name) or `clear_cells` (the first area it emptied cells of in reading order);
  - `the gaps` for a gap change;
  - `the layout` for anything else, including a clear that emptied no area cells.

**Undo and redo**

- Each designer has their own undo and redo history per layout, kept by the server for that layout while the server runs.
- `undo` puts back what the designer's last applied change replaced: the track size, the gaps, the areas it touched, or the whole scope or layout for track adds and removes, breakpoints, CSS and restores. It is applied as a new change with a new revision.
- `redo` re-applies the last undone change. A new change by that designer empties their redo history.
- Undo and redo are refused as conflicts under the same target rules, measured from the change being undone. With nothing to undo or redo they answer 422 `Nothing to undo.` / `Nothing to redo.`

**Versions**

- Version names are 1 to 60 characters: `Version names are 1 to 60 characters.`
- Versions are numbered from 1 per layout and store the whole layout (tracks, gaps, areas, every breakpoint). No dates or times are shown anywhere in the product.
- **Differences** between two versions, one line each, in this order:
  1. Base: `Columns: <old> → <new>`, `Rows: <old> → <new>`, `Gap: <old> → <new>` (gap written as in the generated code, for example `24px 16px`).
  2. Base areas by name, alphabetical: `Area <name> added: <r1> / <c1> / <r2> / <c2>`, `Area <name> removed`, `Area <name>: <old lines> → <new lines>`.
  3. Each breakpoint narrowest first: `Breakpoint From <n>px added` or `Breakpoint From <n>px removed`. Otherwise its own lines with the prefix `From <n>px ` and the word `inherited` for an inherited gap (for example `From 768px Gap: inherited → 24px`).
  - The arrow is → with one space each side. Equal versions give the single line `No differences.`
  - Worked example: Blank (version 1) to Holy Grail (version 2) gives `Columns: 1fr 1fr 1fr → 1fr`, `Rows: 1fr 1fr 1fr → auto auto 1fr auto auto`, `Area aside added: 4 / 1 / 5 / 2`, `Area footer added: 5 / 1 / 6 / 2`, `Area header added: 1 / 1 / 2 / 2`, `Area main added: 3 / 1 / 4 / 2`, `Area nav added: 2 / 1 / 3 / 2`, `Breakpoint From 768px added`.
  - Worked example: Holy Grail to the same layout with gap 24px 16px and "From 768px" column 1 at 240px gives `Gap: 16px → 24px 16px` and `From 768px Columns: 200px 1fr 200px → 240px 1fr 200px`.
- **Restore** (`restore_version`):
  - It replaces the whole layout (tracks, gaps, areas, every breakpoint) with the version's content as one change (revision + 1).
  - It saves a new version named `Restored from version <n>` with the next number.
  - It is fanned out like any change. Any collaborator change based on a revision before the restore is refused as a conflict on `the layout`.
  - History is never rewritten: the change log and every earlier version stay as they were.

**Links and collaborators**

- A view link moves from none to active, then from active to revoked or replaced:
  - "Create view link" makes a new active link from none or revoked;
  - "Regenerate view link" replaces the active link with a new token;
  - "Revoke view link" ends it, and revoking with no active link answers 409.
- The co-edit link exists from creation and is only ever replaced by "Regenerate co-edit link".
- Regenerating or revoking takes effect on the very next request: the old token answers 404 and its page shows the not-available heading.
- Tokens are at least 128 random bits.
- A collaborator moves from joined to removed. Joining the current co-edit link adds a signed-in designer as a collaborator (again, after a removal). The owner joining is a no-op.
- A removed collaborator's next request for that layout answers 404, and the layout leaves their library.
- A view link authorises only reading. It never changes a layout, and `POST /api/layouts/<id>/changes` without a session answers 401.
- Only the owner sees "Share" and may call the sharing routes.

**Starter templates**

- Creating a layout from a template gives exactly that template's tracks, gaps, areas and breakpoints from Seed data, at revision 1, with no versions, no view link and nothing else.

**Presence and live delivery**

- While a designer has an editor connection open to a layout, the server keeps the Valkey key `presence:<layout id>:<username>` with an expiry between 1 and `PRESENCE_SECONDS` seconds. It renews the key at least every third of `PRESENCE_SECONDS` while any of that designer's connections to the layout is open.
- When the designer's last connection closes, the server deletes the key and removes them from "Designers here" at once.
- When a connection is lost without closing, the key expires, and the designer leaves "Designers here" in every editor at most `PRESENCE_SECONDS` seconds after the last renewal.
- Clients never decide on their own that a peer has left.
- "Designers here" is alphabetical, includes the viewer themself, and updates live in every editor within 2 seconds of a join or leave.
- Every applied change, including a restore, is published on the Valkey channel `layout:<layout id>`. Every app process forwards it to every open editor and view page of that layout, which show the new layout within 2 seconds without reload.

### Services (DP-35, DP-36, DP-52–DP-54)

- **Postgres** (`DATABASE_URL`) is the system of record. It holds designers and sessions, layouts with their tracks, gaps, areas and breakpoints, the ordered change log with per-layout revisions, versions, collaborators, and view and co-edit link records. All of it is still there after a reload or a server restart. Apply the schema idempotently every time the server starts.
- **Valkey** (`VALKEY_URL`) holds only presence and the live fan-out: the presence keys and channels from Business rules. Losing Valkey's contents loses no saved work.
- **When Valkey cannot be reached:**
  - every layout still opens and every change, version, link and collaborator action saves through Postgres with its normal status;
  - the layout object's `live` is `false`, and the health route answers its unavailable body;
  - nothing is pushed live, so another designer's open editor and view pages change only when reloaded;
  - "Designers here" lists only the designer themself;
  - the editor and view page show the live-paused copy from Feedback states;
  - no request waits more than 1 second on Valkey.
  - The server keeps retrying Valkey every few seconds, and live delivery resumes for pages loaded after it answers again.

### Seed data (DP-49)

- The shipped app starts with no designers, no layouts, no versions and no links. No people or businesses are seeded. The usernames in this brief are invented examples.
- The four starter templates are built in and exact. Their HTML follows the generation rules.

**Blank** (gap 16px, no areas, no breakpoints). HTML: `<div class="layout"></div>`.

```css
.layout {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  grid-template-rows: 1fr 1fr 1fr;
  gap: 16px;
}
```

**Holy Grail**

```css
.layout {
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: auto auto 1fr auto auto;
  gap: 16px;
  grid-template-areas:
    "header"
    "nav"
    "main"
    "aside"
    "footer";
}

.header { grid-area: header; }
.nav { grid-area: nav; }
.main { grid-area: main; }
.aside { grid-area: aside; }
.footer { grid-area: footer; }

@media (min-width: 768px) {
  .layout {
    grid-template-columns: 200px 1fr 200px;
    grid-template-rows: auto 1fr auto;
    grid-template-areas:
      "header header header"
      "nav main aside"
      "footer footer footer";
  }
}
```

```html
<div class="layout">
  <div class="header">header</div>
  <div class="nav">nav</div>
  <div class="main">main</div>
  <div class="aside">aside</div>
  <div class="footer">footer</div>
</div>
```

**Dashboard Shell**

```css
.layout {
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: 56px auto 1fr;
  gap: 12px;
  grid-template-areas:
    "top"
    "side"
    "content";
}

.top { grid-area: top; }
.side { grid-area: side; }
.content { grid-area: content; }

@media (min-width: 1024px) {
  .layout {
    grid-template-columns: 240px 1fr;
    grid-template-rows: 56px 1fr;
    grid-template-areas:
      "top top"
      "side content";
  }
}
```

```html
<div class="layout">
  <div class="top">top</div>
  <div class="side">side</div>
  <div class="content">content</div>
</div>
```

**Magazine Spread**

```css
.layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: auto auto auto;
  gap: 24px 16px;
  grid-template-areas:
    "lead lead"
    "story-a story-b"
    "story-c story-c";
}

.lead { grid-area: lead; }
.story-a { grid-area: story-a; }
.story-b { grid-area: story-b; }
.story-c { grid-area: story-c; }

@media (min-width: 1280px) {
  .layout {
    grid-template-columns: 2fr 1fr 1fr;
    grid-template-rows: auto 1fr;
    grid-template-areas:
      "lead story-a story-b"
      "lead story-c story-c";
  }
}
```

```html
<div class="layout">
  <div class="lead">lead</div>
  <div class="story-a">story-a</div>
  <div class="story-b">story-b</div>
  <div class="story-c">story-c</div>
</div>
```

## Technical requirements

### Deployment (DP-53, DP-56)

- Runtime: TypeScript on Node 22. `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema": "run-manifest-v1", "install": "npm ci", "build": "npm run build", "serve": "npm run start"}
```

- The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set. It serves the pages, the API and the live WebSockets on that one port.
- `GET /api/health` answers as published in API.

### Configuration and secrets (DP-55, DP-56)

These are read once at start, never hard-coded, and never sent to the browser:

- `DATABASE_URL`
- `VALKEY_URL`
- `GRADING_KEY` (no default; without it the grading route is absent)
- `PRESENCE_SECONDS` (default 30)
- `MAX_TRACKS` (default 12)
- `MAX_BREAKPOINTS` (default 3)
- `APP_PUBLIC_PORT`

### Server boundary (DP-46)

- Same-origin only: pages, assets, API and WebSockets come from the app's origin. No cross-origin permission headers are sent, and WebSocket upgrades from another origin are refused.
- The 65,536-byte body limit from API applies to every route.
- The server serves only built client assets and the routes in this brief. It never serves source files, the run manifest, package manifests, lockfiles, dependency folders, environment files or credentials; such paths answer 404.
- **Boot:**
  - If Postgres is unreachable, the server still listens, answers health with its starting body, and retries every second until Postgres answers.
  - If Valkey is unreachable, the server starts normally in the paused state described in Services.

### Browser support and performance (DP-36, DP-48)

- Current Chromium, Firefox and WebKit, at 375 by 812, 768 by 1024 and 1280 by 800, with touch input on the phone size.
- The editor is usable within three seconds of navigation.
- An accepted change shows in the author's editor within one second and in other open pages within the 2-second live window.

## Working rules

- IF-01: `/app/run.json` exists with exactly the string keys `_schema` (`run-manifest-v1`), `install`, `build` and `serve`.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` names every shipped package and its licence. Shipped packages are the production dependency tree, `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package is licensed MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or BlueOak-1.0.0.
- IF-04: The app stores data only in the provided Postgres and Valkey. It uses no other database, file-based store or extra service.
- IF-05: The app loads no font, script, stylesheet or image from another origin.
- IF-06: The provided service configuration and dev compose files are left unchanged.
- IF-07: Server and client source is written in TypeScript.

## Engineering standards

- Code is idiomatic, strictly typed TypeScript, and names use the domain terms of this brief: track, gap, area, scope, breakpoint, revision, version, view link, co-edit link, collaborator, presence.
- Each domain rule is decided in exactly one place in the source, and the client and server reuse that one decision. This covers track-size checks and canonical form, the area rectangle rules, CSS generation, CSS reading, the conflict target rule, the link states and version differences.
- There is no abstraction with a single implementation and no wrapper that only forwards calls.
- There is no dead, commented-out or unreachable code, and no defensive check for a state the rules make impossible.
- Every API error uses the one published error shape and the one published error order.
- Database access uses parameterised queries, and changes to a layout are serialised so revisions never repeat or skip.
- The code contains no feature beyond this brief.
