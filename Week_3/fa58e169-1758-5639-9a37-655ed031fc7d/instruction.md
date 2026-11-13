# Wale & Course Twinrow

Twinrow is a shared web workspace for anyone who writes their own knitting and crochet patterns. One chart is the single source of truth: the server checks each row's stitch arithmetic, writes the instructions from the chart, reads typed instructions back into the chart, and lets two designers edit together and testers work a saved version row by row on their phones. It uses three backend services: Postgres for everything lasting, Mailpit for all mail, and Valkey for presence, live chart updates and the shared row counter. It has its own email-and-password accounts. Out of scope: image-to-chart conversion, AI pattern writing, a marketplace, a yarn shop, payments, outside sign-in, a pixel-art editor, and any other datastore, queue or PDF service.

## Problem and users

People who design their own patterns keep two copies of one truth: a chart and its written rows. Desktop chart programs can generate text, but they run on one person's machine, so a second designer works from emailed files. Free web grids draw symbols but do not check stitch arithmetic. A yarn over with no matching decrease, a wrong-side row whose knits and purls were not swapped, or a mirrored panel that kept k2tog where it needed ssk usually survives until a tester is halfway through a shawl. Testing then runs on PDFs, group threads and spreadsheets. Notes say "row 42, I think" against a draft that has already changed, and row counts live in a phone app that knows nothing about the pattern. The designer pays in tech-edit hours and corrected re-releases, and volunteer testers rip back real work.

- **Designer** (daily): draws a chart, gets every row balanced, and publishes a chart and instruction sheet that match exactly.
- **Co-designer** (weekly): edits the same pattern live, by chart or by text, without overwriting the designer's work.
- **Tester** (daily): works a saved version row by row on a phone, keeps one row count across devices, and leaves notes tied to exact rows.

## Journeys

1. **Rib swatch by keyboard.** A designer opens a blank flat chart with 2 rows of 10 columns. Using only the keyboard they enter a rib on both rows. Each placed symbol is announced, the written lines appear as the cells change, and the error list reports that all rows check out. A reload shows the same chart and lines.
2. **Balancing a shaped chart.** A designer and a co-designer have a shaped chart open on two screens. The designer removes a stitch, and both screens show the same row error at once. The designer fixes the row, hears it cleared, and can then publish.
3. **Writing a row as text.** A designer opens a row's text box and types instructions. Good text rewrites the cells and returns in canonical form. Bad text leaves the chart alone and names the row and position. A push from the co-designer lands while they type and costs them nothing.
4. **Designing together.** Two designers work on one pattern and see each other's cursors. When both change one cell, the first edit stands, and the second person sees the conflict notice and the kept value.
5. **Testing on two devices.** A designer invites a tester. The tester joins from the mail on a phone, steps through rows by touch and swipe, and picks up on a second device on the same row. The designer's tester table follows along.
6. **Notes and a new version.** A tester saves a note on a row. It reaches the designer at once and by mail. The designer saves a new version, and the tester sees the notice without losing their place, then moves to the new version on the same row number.
7. **Compare, restore, publish.** A designer compares two versions, restores an older one as a new version, publishes it, and a signed-out visitor reads the page and downloads the PDF sheet. Neither carries any tester's details.
8. **Working through a Valkey outage.** With Valkey unreachable, a designer and a tester keep saving. The page shows the live-updates notice, and other open pages catch up when reloaded.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Blank chart by keyboard.** Tab reaches the one cursor cell of `grid "Stitch chart"` with its exact label, and the arrow keys move it one cell at a time, stopping at the chart's edges, with row 1 at the bottom.
- **DP-02 — Stitch entry follows the reading direction.** Each letter key places its symbol on the cursor and moves the cursor one cell in that row's reading direction, as qualified in Interactions.
- **DP-03 — Placed symbols are announced.** `status "Cell announcement"` reads each cursor move and each placed symbol in the published words.
- **DP-04 — Written lines change with the cells.** Each edit shows the affected written lines in the same render as its cells, and cells and lines survive a reload.
- **DP-05 — Crochet swatch by keyboard.** A crochet chart takes the crochet letter keys and its written lines swap nothing between sides.
- **DP-06 — Row rule and error list.** Every non-empty row's used stitches are checked against the nearest non-empty row below or the cast-on, and `list "Row errors"` shows each error in row order.
- **DP-07 — Row counts on the chart.** Each chart row shows the server's used, made and state values, and the same values reach every other designer's page with no reload.
- **DP-08 — Row check announcements.** `status "Row check"` reads each row error as it appears and each cleared row, in the same words the error list shows.
- **DP-09 — Publishing refused with row errors.** Publish is refused with the exact count of row errors while any remain, and colour warnings never block it.
- **DP-10 — Shaping lines.** The worked shaping chart reads as its seven printed lines, with wrong-side texts on wrong-side rows.
- **DP-11 — Counts follow each edit.** A keyboard edit changes that row's made count at once, gives the rows above their errors, and undo restores the earlier lines.
- **DP-12 — Cable cells.** The cable key places four cells that read as one item, and both cable row errors appear as published.
- **DP-13 — Crochet terms.** One crochet chart writes the printed US lines in US terms and the printed UK lines in UK terms.
- **DP-14 — Repeat detection.** Every printed repeat example reads exactly as printed from the cells given.
- **DP-15 — Repeat boxes by keyboard.** A selection and the box key make a repeat box, its times spinbutton changes counts and lines at once, and an overlapping box is refused.
- **DP-16 — Expanding a repeat.** Expanding a box widens the chart without changing any line or count, undo brings the box back, and an expansion past the column limit is refused.
- **DP-17 — Twin lift through repeats.** A token inside a repeat lifts its position in every worked repeat, following its row's working direction, exactly as in the printed example.
- **DP-18 — Text applies to the chart.** Typed text commits through the published grammar into cells, returns in canonical form, and reports the cells changed with focus back on the edit button.
- **DP-19 — Text errors name the row and position.** Text that cannot parse leaves the chart unchanged, stays as typed with the caret at the failing position, and shows the exact error.
- **DP-20 — Repeat text fills the row.** A typed repeat is worked as many whole times as the row's needed stitches allow, and one that does not fit is refused at its star.
- **DP-21 — Typing survives pushed edits.** An open text box keeps its text, caret and shown error while pushed edits land, and warns when its own row changed.
- **DP-22 — Text edits reach the co-designer.** An applied text changes the other designer's chart and written lines with no reload, and the changed cells flash.
- **DP-23 — Range selection and clipboard.** Shift and the arrow keys select a rectangle, and copy, cut and paste work on it with the published paste rule and status.
- **DP-24 — Mirror.** Mirror reverses a selection row by row, swaps the published partners and carries colours with their cells, and is refused on a selection touching a repeat box.
- **DP-25 — Undo and redo.** The undo and redo keys step through a person's actions one whole action at a time.
- **DP-26 — Paint and select by pointer.** A fast Paint drag fills every cell along its line as one undo step and one request, and a Select drag selects a rectangle with the published status.
- **DP-27 — Paint by touch.** On a 390 by 844 touch screen, taps and drags paint cells of at least 32 by 32 px, and the grid rather than the page takes the gesture.
- **DP-28 — Colour key and colour keys.** Colours are added in `list "Colour key"` up to the limit, and the digit keys colour the cursor cell or selection.
- **DP-29 — Colour in written lines.** A row of more than one colour names a colour on every item and run, and colours count when items are compared for runs and repeats.
- **DP-30 — Colour warnings.** `list "Colour warnings"` shows each colour-count and float warning in row order and clears when the row is fixed.
- **DP-31 — Presence.** `list "Here now"` and the `data-peer` mark show who is on the pattern and where, backed by the published Valkey hash.
- **DP-32 — Live edits in place.** One designer's edits, cursor moves and row checks reach the other designer's page with no reload and no scroll jump.
- **DP-33 — Conflict notice.** When two designers change one cell, the first accepted edit stands, and the refused person sees the exact notice and the server's value until the notice clears.
- **DP-34 — Undo leaves a later change alone.** Undo skips a cell another designer changed after your step and says so in the published words.
- **DP-35 — Inviting and joining.** A designer's invitation sends one mail with one link, and the tester joins from it onto the follow page, as qualified for expired and used links in Business rules.
- **DP-36 — Follow page by touch.** At 375 by 812 a tester steps rows by tap and swipe on buttons of at least 44 by 44 px, with the counter, line and buttons kept on screen.
- **DP-37 — Shared row counter.** Two devices stepping from one row move the counter once, a replayed step changes nothing, and every device of that tester shows the new row and pin with no reload.
- **DP-38 — Testers table follows live.** The designer's `table "Testers"` shows each tester's version, row and note count as they change, and each tester keeps their own row.
- **DP-39 — Tester and stranger access.** A tester reads only the version they follow and their own notes, and a stranger gets not found for any private pattern, page or API.
- **DP-40 — Row notes and notice mail.** A saved note reaches the designer's page live and sends one mail to the owner after saving, and no other tester sees it.
- **DP-41 — New-version notice.** A newly saved version shows the notice on every open follow page without changing the row, the chart or focus.
- **DP-42 — Moving to a new version.** Moving keeps the row number and shows the new line, or goes to the last row with the published status if the new version is shorter, on all of that tester's devices.
- **DP-43 — Comparing versions.** The compare page shows the exact summary line and marks every cell of the later version, by the published rule.
- **DP-44 — Restoring a version.** A restore makes a new version with cells, colours, repeats and lines identical to the original, destroys nothing later, and reaches other designers live.
- **DP-45 — Published page.** A published pattern reads at `/p/<id>` to anyone, and an unpublished one answers not found.
- **DP-46 — PDF sheet.** The app builds the PDF from the published version with the published page order, lines, key and footers.
- **DP-47 — No private data on copies.** The published page and the PDF carry no tester name, tester email address or note text.
- **DP-48 — Live notice under outage.** With Valkey unreachable the app starts, health answers 200, and every signed-in page shows the published notice in `status "Live"`.
- **DP-49 — Saved work under outage.** With Valkey unreachable, saved patterns open, and cell edits, text edits and versions save and survive a reload, while other pages get nothing until reloaded.
- **DP-50 — Counter and notes under outage.** With Valkey unreachable, counter moves save with the same from-row rule, notes save and their mail goes out, and `list "Here now"` shows only the viewer.
- **DP-51 — Accounts.** Sign-up, mail verification and sign-in work with the published fields, copy, expiry and return to the page asked for.
- **DP-52 — Published layout widths.** Designer and follow pages change `data-layout` exactly at 600 and 1024 px, with the published layout for each and no sideways page scroll.
- **DP-53 — Twin lift.** Pointer or focus on a cell or token lifts exactly that twin set at once, leaving reverses it at once, no-stitch cells never lift, and a pin stays after leaving.
- **DP-54 — Reduced motion.** Under reduced motion, from the system or from `checkbox "Reduce motion"`, every published state stays with no shift, no moving highlight and a static outline in place of flashes.
- **DP-55 — Named motion.** The follow highlight, the change flash and the version notice run for their published times with their published marks, and nothing else on the page moves.
- **DP-56 — Dialogs and focus.** Every dialog keeps Tab inside it, Escape closes it, focus returns to its opener, and focus is always visible on cells, lines and controls.
- **DP-57 — Accessibility checks.** Designer, follow and compare pages have no automated accessibility violations at 375, 768 and 1280 px wide.
- **DP-58 — Workspace look.** Every screen carries the pale shell, single bordered panel, lead line, pastel tiles and original stitch glyphs described in Visual design.
- **DP-59 — Platform and configuration.** Health, public configuration, published limits, the error order, the edit rate limit and the replayed edit behave as published in every instance.
- **DP-60 — Credentials and same origin.** Every credential is read from the environment, the browser talks only to its own origin, and fonts and icons come from the app itself.

## Frontend

### Screens and layout (DP-52, DP-58)

The three checked viewports are 375x812, 768x1024 and 1280x800. No page scrolls sideways at any of them.

The root of each page carries `data-layout`: `desktop` at 1024 px and wider, `tablet` from 600 to 1023 px, `phone` below 600 px. Those two widths are the only layout changes.

Every page uses one shell:

- The **pattern top bar** runs across the top of every page and stays pinned during scroll. It holds the **rail toggle** at its far left, the product name, and the **New pattern button** at its far right. It is a slim white bar a little taller than a comfortable tap target, with a hairline along its bottom edge, no shadow, and no change on scroll.
- The **workspace rail** sits left of the content in `desktop`. It is a narrow pale column, about a fifth of a 1280-pixel window, running to the bottom of the window. In `tablet` and `phone` it becomes the **stacked workspace nav**, a full-width pale block after the panel with the same rows, taking the place of a footer.
- A fluid main column sits beside the rail with a small even gutter. It holds the **row status lead line** and, under it, one **chart panel**.

Pages:

- `/` signed in: heading `Your patterns`, then `list "Patterns"` of links as cards. Cards run in one column in `phone` and two columns in `tablet` and `desktop`. A tester's followed patterns link to `/follow/<id>`, and all others link to `/patterns/<id>`. Signed out, `/` goes to `/signin`.
- `/signup`, `/signin`, `/verify`, `/invite/<token>`: one narrow form in the chart panel.
- `/settings`: profile, password and `checkbox "Reduce motion"`.
- `/patterns/<id>`, the designer page: `region "Chart"` holds the grid and tools, and `region "Instructions"` holds the written rows. The side panels are `Repeats`, `Colour key`, `Row errors`, `Colour warnings`, `Here now`, `Versions`, `Testers` and `Row notes`.
  - `desktop` shows chart, instructions and side panels together, with no tabs: chart and instructions side by side, side panels beneath in two columns.
  - `tablet` and `phone` show `tablist "Pattern"` with `tab "Chart"`, `tab "Instructions"` and `tab "Testers"`, `Chart` first and selected at start. The `Chart` tab shows `region "Chart"` and the panels `Repeats`, `Colour key`, `Row errors`, `Colour warnings` and `Here now`. The `Instructions` tab shows `region "Instructions"`. The `Testers` tab shows `Versions`, `Testers` and `Row notes`. The `Versions` panel holds `button "Save version"`, `button "Publish"`, `alert "Publish error"`, `combobox "From version"`, `combobox "To version"` and `button "Compare"`. The `Testers` panel holds the tester invitation form and, for the owner, the co-designer form (`textbox "Co-designer email"`, `button "Add co-designer"`, `alert "Co-designer error"`). In `desktop` the same panels show in the side panels.
  - Live regions stay in the page whichever tab is open.
- `/patterns/<id>/compare`: the two version pickers, `status "Compare result"` and `grid "Compare chart"`.
- `/follow/<id>`, the tester's page: `desktop` has the grid on the left, and the counter, current row, buttons and `list "Your notes"` on the right. `tablet` and `phone` have the grid scrolling above a dock pinned to the bottom of the window, holding the counter, current row and buttons within thumb reach.
- `/p/<id>`: the public read-only page with grid, written lines and `link "Download sheet"`.

The grid scrolls inside its own region and never makes the page scroll sideways. In `phone`, grid cells are at least 32 x 32 px.

### Public screens and controls (DP-01, DP-03, DP-04, DP-06, DP-07, DP-28, DP-31, DP-36, DP-38, DP-43, DP-53)

Only these are public. A `status`, `alert`, `region` or `list` named below carries that accessible name. Password fields written as `textbox "Password"` are masked password inputs, found by their label, because browsers give them no textbox role.

| Where | Role and name | Notes and visible copy |
|---|---|---|
| Every signed-in page | `status "Live"` | Sits just below the top bar. Reads `Live`, or the live-updates notice from Feedback states |
| Top bar | `button "Toggle workspace rail"` | The rail toggle, with `aria-expanded` |
| Top bar | `button "New pattern"` | The New pattern button. Hidden in `phone`, where the panel on `/` carries the same button |
| Rail | `navigation "Workspace"` | Workspace nav rows as links: `Your patterns`, `Settings`. On a designer page also `Chart`, `Instructions`, `Versions`, `Testers`, `Row notes` |
| `/` | `heading "Your patterns"`, `list "Patterns"` | Empty text: `No patterns yet. Start one from the sample or a blank chart.` Each entry is a `link` named by the pattern |
| `/` | `button "Use the sample"` | Shown with the empty text |
| New pattern | `dialog "New pattern"` | Holds `textbox "Pattern name"`, `radiogroup "Chart kind"`, `spinbutton "Rows"`, `spinbutton "Columns"`, `spinbutton "Cast on"`, `button "Create"`, `button "Cancel"`, `alert "Pattern error"` |
| New pattern | `radio` in `radiogroup "Chart kind"` | Chart-kind cards: `Flat knitting`, `Knitting in the round`, `Stranded in the round`, `Crochet rows in US terms`, `Crochet rows in UK terms`, `Tapestry crochet`. Defaults are `Flat knitting` and 24 rows, 24 columns, cast on 24 |
| `/signup` | `textbox "Name"`, `textbox "Email"`, `textbox "Password"`, `button "Create account"`, `alert "Sign-up error"` | |
| `/signin` | `textbox "Email"`, `textbox "Password"`, `button "Sign in"`, `alert "Sign-in error"` | |
| `/invite/<token>` | `textbox "Name"`, `textbox "Password"`, `button "Join as tester"`, `alert "Invite error"` | For an email with an account, only the password field shows |
| `/settings` | `textbox "Name"`, `button "Save profile"`, `textbox "Current password"`, `textbox "New password"`, `button "Change password"`, `checkbox "Reduce motion"`, `button "Sign out"`, `status "Settings"`, `alert "Settings error"` | Field errors show in `alert "Settings error"`, and the failing field gets `aria-invalid="true"` |
| Any unopenable page | `heading "Not found."` | |
| Designer | `region "Chart"`, `region "Instructions"` | |
| Designer | `grid "Stitch chart"` | See the chart contract below |
| Designer | `radiogroup "Tool"` | `radio "Paint"` (selected at start), `radio "Select"` |
| Designer | `radiogroup "Symbols"` | One `radio` per symbol of the craft, named by its symbol name. The first is selected at start |
| Designer | `radiogroup "Colours"` | One `radio` per colour, named `<letter> <name>` |
| Designer | `button "Add repeat"`, `button "Mirror"` | |
| Designer | `status "Cell announcement"`, `status "Row check"`, `status "Chart sync"`, `alert "Conflict"` | |
| Designer | `list "Written instructions"` | One `listitem` per line with `data-row`. Each is a row card (below) |
| Designer | `button "Edit row <n>"`, `button "Pin row <n>"` | |
| Designer | `textbox "Row <n> instructions"`, `button "Apply text"`, `alert "Text error"`, `status "Row changed"` | |
| Designer | `list "Row errors"` | One `listitem` per row error in row order with `data-row`. Its text is the message, and it holds one button with that same text that moves the cursor to the row's first cell. With none, the single item `All rows check out.` |
| Designer | `list "Colour warnings"` | One `listitem` per warning with `data-row`. With none, the single item `No colour warnings.` |
| Designer | `list "Repeats"` | One item per box, reading `Repeat <id>`, with `spinbutton "Times for <id>"` and `button "Expand repeat <id>"`. With none, the single item `No repeats yet.` |
| Designer | `list "Colour key"`, `textbox "Colour name"`, `textbox "Colour hex"`, `button "Add colour"`, `alert "Colour error"` | Item text is `<letter> <name>`. A hex is a number sign and six hex digits |
| Designer | `list "Here now"` | One `listitem` per designer on the page. The viewer comes first, as `<name> (you)`, and the rest follow in name order |
| Designer | `textbox "Co-designer email"`, `button "Add co-designer"`, `alert "Co-designer error"` | Owner only |
| Designer | `button "Save version"` | Opens `dialog "Save version"` with `textbox "Version note"`, `button "Save"`, `button "Cancel"`, `alert "Version error"` |
| Designer | `table "Versions"` | Columns `Version`, `Note`, `Saved on`, `Stitches`. Each row has `button "Restore version <n>"` |
| Designer | `dialog "Restore version <n>?"` | Text `This makes version <next> from version <n>. Nothing is deleted.` where `<next>` is the number the restore will take. Holds `button "Restore"`, `button "Cancel"` |
| Designer | `combobox "From version"`, `combobox "To version"`, `button "Compare"` | |
| Designer | `button "Publish"`, `alert "Publish error"` | |
| Designer | `textbox "Tester email"`, `button "Invite tester"`, `alert "Tester error"` | |
| Designer | `table "Testers"` | Columns `Name`, `Version`, `Row`, `Notes` |
| Designer | `list "Row notes"` | Items `Row <n>: <text> (<tester name>)` in row order, then oldest first |
| Compare | `combobox "From version"`, `combobox "To version"`, `button "Compare"`, `status "Compare result"`, `grid "Compare chart"` | |
| Follow | `heading "<pattern name>"`, `status "Row counter"`, `region "Current row"`, `status "Version"`, `status "Row announcement"`, `status "Note status"` | `status "Row counter"` reads `Row <row> of <height>`, always with the word Row |
| Follow | `button "Previous row"`, `button "Next row"`, `button "Add note"` | |
| Follow | `button "Move to version <n>"` | Shown with the new-version notice |
| Follow | `dialog "Add note"` | Holds `textbox "Note for row <n>"`, `button "Save note"`, `button "Cancel"`, `alert "Note error"` |
| Follow | `list "Your notes"` | The tester's own notes on the followed version, as `Row <n>: <text>` |
| Follow | `grid "Stitch chart"` | Read-only |
| Public | `grid "Stitch chart"`, `list "Written instructions"`, `link "Download sheet"` | Read-only, with `Pin row` buttons but no `Edit row` buttons |

**Chart contract.**

- `grid "Stitch chart"` has `role="grid"`, `aria-rowcount` and `aria-colcount` (the chart's width). It holds one `row` per chart row, highest row number first so that row 1 is at the bottom.
- Each `row` element carries `data-row`, `data-side` (`RS`, `WS` or `RND`), `data-used`, `data-made` and `data-count-state` (`ok`, `error` or `empty`). It carries `data-notes="<count>"` when the row has notes, and `data-follow` on the follow page.
- Each `row` starts with a `rowheader` reading `Row <n>`, or `Rnd <n>` in the round.
- Stitch cells are the `gridcell`s with `data-col`. Each has `data-row`, `data-col`, `data-stitch`, `data-colour` (a colour letter), `data-repeat` (a repeat id, or empty) and `data-rev` (the cell's revision).
- Each stitch cell's `aria-label` is exactly `Row 3, column 5: Knit, colour A`, with `, repeat A` added when it has one, and it always uses the word Row. `aria-selected="true"` marks selected cells only.
- The drawn symbol is `aria-hidden` decoration. Tests read attributes and text.
- Each `row` ends with a `gridcell` that has no `data-col` and carries `[data-count]`. It sits at the row's right end and shows the row's made count in tabular figures.
- Exactly one stitch cell has `tabindex="0"` and `data-cursor="true"`. It is the cursor, and focus sits on it while in the grid. It starts at row 1, column 1.
- A peer's cursor cell has `data-peer="<name>"`, updated as they move.

`grid "Compare chart"` has the same attributes, is read-only, and adds `data-diff` on each stitch cell.

**Row card.** Each `listitem` of `list "Written instructions"` is a compact card holding:

- a stitch family tile reading `RS`, `WS` or `Rnd`;
- the line in an element `[data-line]` whose text is the line exactly;
- `button "Edit row <n>"`;
- the row pin arrow, `button "Pin row <n>"`.

Empty rows have no card.

Each `[data-line]` is built of token elements: one `[data-token]` per printed run or item, in printed order, its text exactly that run (`k2`, `2/2 LC`, `k2tog x3`, `k2 in A`). Punctuation, the label, the repeat words and the closing count sit outside tokens. Each line is one tab stop: its first token has `tabindex="0"`, and ArrowLeft and ArrowRight move between that line's tokens.

### Interactions (DP-01, DP-02, DP-05, DP-12, DP-15, DP-18, DP-21, DP-23, DP-24, DP-25, DP-26, DP-27, DP-28, DP-36, DP-56)

**Keyboard in the grid.**

- Arrow keys move the cursor one cell and stop at the edges. ArrowUp goes to a higher row number. A plain arrow also clears any selection.
- Letter keys come from the symbol tables in Business rules. Each places its symbol on the cursor, and the cursor then moves one cell in that row's reading direction: left on right-side rows and rounds, right on wrong-side rows. At the row's end it stays put. A key outside the pattern's craft does nothing.
- With a selection, a letter key fills every selected cell and the cursor stays.
- `c` places `c22` on the cursor cell and the three cells to its left in the same row. Cells past the chart's edge are dropped. The cursor then moves to the next cell past those four in the row's reading direction, or stays put if there is none.
- Digit keys `1` to `6` set the colour of the cursor cell or selection to A to F, with no move. A digit for a colour not in the key does nothing.
- `Delete` makes the cursor cell or selection `ns`, keeping its colour, with no move.
- Shift+arrows extend a rectangular selection from the cell where it began. The cursor moves with the far corner. `Escape` clears the selection.
- `Ctrl+C` and `Ctrl+X` copy and cut the selection, or the cursor cell if nothing is selected. Cut cells become `ns`, colour A.
- `Ctrl+V` pastes. The app uses its own clipboard in page state, never the system clipboard, and that clipboard holds stitches and colours. A paste puts the block's bottom-left cell on the cursor, and cells past the chart's edge are dropped.
- `m` mirrors and `b` draws a repeat box on the selection, or on the cursor cell if nothing is selected.
- `Ctrl+Z` undoes. `Ctrl+Y` or `Ctrl+Shift+Z` redoes. Meta counts as Ctrl.
- `Enter` pins the cursor cell's twin pair.
- `m`, `b`, undo and redo also work with focus on any button or radio inside `region "Chart"`. In a text box or dialog none of these keys touch the chart.

A person's edits are sent at once and in the order made, with no autosave timer. Each carries the revision its cell has after that person's earlier edits. Cells and lines change together when the server answers.

**Pointer and touch in the grid.**

- With `Paint`, a press paints that cell with the chosen symbol and colour. Dragging paints every cell entered, whatever the speed: cells skipped between two pointer events are filled along the straight line between them.
- A drag shows on release as one request and one undo step. Pointer painting sets one cell at a time, including with `2/2 cable`.
- With `Select`, dragging selects the rectangle.
- Touch works the same way: a gesture that starts on a stitch cell belongs to the grid, not the page. A gesture that starts on a row header or outside the cells scrolls as normal.
- Mouse and touch never start text selection in the grid.

**Editing a row as text.** `button "Edit row <n>"` opens `textbox "Row <n> instructions"` holding the line, with focus in it. Enter or `button "Apply text"` applies it. Escape closes it with nothing changed and returns focus to the button.

- On success the box closes, focus returns to `button "Edit row <n>"`, and the changed cells flash.
- On an error, nothing changes, the text stays as typed, the box gets `aria-invalid="true"`, and the message shows in `alert "Text error"`. Focus stays in the box, and the caret moves to the failing position (`selectionStart` is the position less 1). The error stays until the next apply or until the box closes.
- On a row that passes through a repeat box, the box opens and `alert "Text error"` shows the repeat-box text at once. Apply changes nothing.
- While a box is open, pushed updates change the chart and other lines but never its text, its caret, its focus or a shown error. If a push touches the box's own row, `status "Row changed"` shows until the box closes.

**Dialogs.** Tab and Shift+Tab wrap inside every open dialog. Escape closes it. Focus returns to the control that opened it.

**Follow page.**

- `n` or Space steps to the next row and `p` to the previous, with focus on any control except a text box or dialog. Space on a focused button presses only that button.
- `Next row` is disabled at the last row and `Previous row` at row 1.
- Swiping left on `region "Current row"` is next row and swiping right is previous. A swipe travels at least 50 px sideways and more across than down.
- A row with no stitches shows `This row has no stitches.` in `region "Current row"`.
- Dialogs on this page keep the row they opened on, even if the counter moves.

**Tabs.** In `tablet` and `phone`, ArrowLeft and ArrowRight move between tabs. A workspace nav row for a panel selects the tab that holds it.

**Rail toggle.** In `desktop` it hides and shows the workspace rail. In `tablet` and `phone` it hides and shows the stacked workspace nav. The rail is open at start.

### Visual design (DP-58)

The direction is `seed`: a calm, exact, still working tool. The ground is white with no shadows anywhere. The only colour comes from small pastel tiles, the blue accent and the yarn colours a designer chooses.

**Type.** Two typefaces, both self-hosted: Manrope for all text, and Open Sans for the product name in the top bar. Everything is sentence case and nothing is uppercase. Row counts and every other number use Manrope's tabular figures. Panel headings are about 1.4 times body text, the lead line sits a step above body in semibold, and card labels sit a step below body in bold.

**Colour roles.**

- Ground: pure white, for page, top bar, panel and cards.
- Surface: a very pale blue-white, for the rail and lifted cells.
- Ink: a soft slate blue-grey, for all body text.
- Line: a barely-there pale blue, for hairline borders.
- Accent: a mid blue, used only for borders and icons.
- Accent-strong: a deep blue, for all accent text and the primary button fill.
- On-accent: a near-white, for labels on that fill.
- Active pill: a pale blue, behind the active nav row.
- Muted arrow: a blue-grey, for arrows at rest.
- Tiles: ten pastel tints in green, rose, tan, butter, blue, lilac, sage, pink, teal and periwinkle.

All text meets WCAG 2.2 AA contrast.

**Density and composition.** Compact. A fixed shell of the slim top bar and pale left rail, with small even gutters around a fluid main column. That column holds one hairline-bordered, softly rounded chart panel, led by the accent lead line in place of a hero. There is no marketing hero.

**Components.**

- The **New pattern button** has a deep blue fill with a near-white semibold label and softly rounded corners. It nearly fills the bar's height.
- The **rail toggle** is a plain three-line icon with no container.
- A **workspace nav row** is a small line icon and label. The active row sits on a pale blue pill with accent-strong label and accent icon, and the pill runs flush to the rail's right edge. Nav icons come from an openly licensed set.
- The **row status lead line** is one semibold line in accent-strong that wraps to two lines on a phone. It carries the current state: on the designer page, the first row error or the text `All rows check out.`; elsewhere, the page's purpose.
- A **chart-kind card** is a flat white card about twice a tap target tall, softly rounded with a hairline border. It holds a stitch family tile on the left, its label, and a fine trailing arrow on the right. The six cards in `dialog "New pattern"`, the entries of `list "Patterns"` and, at a compact height, the row cards all use this anatomy.
- A **stitch family tile** is a slightly upright rounded rectangle in one pastel tint, holding one centred glyph or side label in a darker muted shade of the same hue. Each stitch family in `radiogroup "Symbols"` has its own tint.
- Stitch glyphs are original drawn vector shapes following common chart conventions.
- The **row pin arrow** is a thin blue-grey right arrow, turning accent when lifted or pinned. It never slides.

**Working screens.** Every working screen is the same panel in the same shell. Empty, loading and error states are lead line plus panel text, never illustrations or spinners over the grid. Tables use hairline row rules and tabular figures. Forms sit in one column inside the panel.

Every control is at least 44 px in its tappable size, except grid cells, which follow their own size rule in Screens and layout.

**The deliberate risk.** On a grid whose whole value is alignment, the focused row and its twin break alignment by a small step while their neighbours stay put. Knitters keep their place with a ruler or sticky note, and one row standing proud of the chart is the digital form of that habit.

### Motion and effects (DP-17, DP-53, DP-54, DP-55)

The chart never animates. Motion here is stillness: the twin lift is an instant step change, and exactly three things move. There are no entrances, no decorative loops and no animated scrolling.

**Follow highlight.** When the counter changes, a highlight band moves to the new row over `ROW_MOTION_MS`, with `data-motion="row"` on the grid while it runs. The grid's scroll position changes in one step at the start, so after the move the current row sits in the middle third of the grid's scroll area. That area has blank space above and below the rows, so every row, including row 1 and the top row, can reach the middle third.

**Change flash.** Cells changed by a peer or by an applied text flash a pale tint for 0.6 seconds, with `data-motion="flash"` on each such cell. A new flash on a cell restarts its time.

**Version notice.** A new-version notice slides down in about a quarter of a second, with `data-motion="notice"` on `status "Version"`.

**Twin lift, the signature.** It shows which written words and which chart cells are the same stitches, in reading order, so a designer can check a row and a tester can keep their place in chart and text at once.

1. The pointer enters, or keyboard focus lands on, a chart cell or a token. If pointer and focus are on different things, the pointer's source shows. When the pointer leaves, the focused source shows.
2. In one frame, with no in-between step, the token and each of its cells get `data-lift="twin"`. Each one's hairline border turns from pale line blue to accent blue and its fill turns to the pale surface colour. A colourwork cell keeps its yarn colour and takes only the border. The row card's arrow turns accent, and each lifted element moves up by exactly 2 px.
3. Neighbours stay still, so the row visibly misaligns.
4. Leaving reverses all of it at once.

Twins follow reading order: a token's cells are the cells its items came from.

- The first token of a right-side row or round maps to the rightmost stitch cell. The first token of a flat wrong-side row maps to the leftmost.
- `k5` lifts five cells, and `2/2 LC` lifts its four.
- A token between `*` and `;` lifts that position in every worked repeat. A tail token lifts its own cells.
- A cell as the source lifts its whole token and all that token's cells.
- A repeat box's cells are drawn once, so they lift once.
- An `ns` cell has no twin and never lifts.

Worked example, cells from column 1 `k k p p k k p p k k`. On row 1, the first token `k2` lifts columns 10, 9, 6 and 5; token `p2` lifts 8, 7, 4 and 3; the tail token `k2` lifts 2 and 1. The same cells on row 2 read `*p2, k2; rep from * to last 2 sts, p2.`: the first token `p2` lifts columns 1, 2, 5 and 6; `k2` lifts 3, 4, 7 and 8; the tail `p2` lifts 9 and 10.

**Pinning.** Enter on a focused token or grid cell pins that pair. `button "Pin row <n>"` pins the whole line with all its stitch cells. A pin sets `aria-current="true"` on the token or line and on its cells, and they keep `data-lift="twin"` and the lifted look after leaving. One pin at a time: a new pin replaces the old, and pinning the same thing again clears it.

In the follow view, the current row's line and all its cells are always pinned, on each of that tester's devices, and the pin moves with the counter.

**Follow marks.** The current row has `data-follow="current"`, lower rows `data-follow="done"`, the rest `data-follow="todo"`.

**Reduced motion.** It applies when the system asks for it, or when `checkbox "Reduce motion"` is on, whatever the system says.

- `data-lift`, the border, fill, arrow colour and pinning all stay, and no 2 px shift occurs.
- The highlight jumps at once and no `data-motion` ever appears.
- Flashes become a static outline for 2 seconds, with `data-outline="static"` on the cell.
- Notices appear in place.
- Live regions are unchanged.

### Feedback states (DP-03, DP-08, DP-09, DP-19, DP-21, DP-33, DP-34, DP-40, DP-41, DP-42, DP-48, DP-51)

All copy uses straight apostrophes and quotes (U+0027, U+0022), the ASCII hyphen-minus and three full stops, never an ellipsis character. Every string in backticks renders character for character, and announcements carry the same characters. A placeholder such as `<maxColours>` takes its value from the running configuration. Row-error, colour-warning, text-error and written-line copy is owned by Business rules.

A follow-up repaint never overwrites a status or error the action just showed, and a stale timer never clears a newer notice.

**Cell announcement** (`status "Cell announcement"`):

- After each move: the cell's `aria-label` with a full stop.
- After placing a symbol, or `Delete`: `Placed Purl at row 3, column 5.` This wording is built from the symbol's name and the cell it was placed on, and is not replaced by the following cursor move. `Delete` announces `No stitch`.

**Row check** (`status "Row check"`), on every designer's page, including for pushed changes:

- It reads a row's error as soon as it appears, and `Row 12 is correct.` (with that row's number) when a row's last error clears.
- If one change makes several, new errors come first, in row order, then cleared rows, joined by one space.
- With no change to any row's errors, the text stays as it was.

**Chart sync** (`status "Chart sync"`). Each text stays until the next one replaces it:

| Event | Copy |
|---|---|
| Text applied | `Row 3 updated: 4 cells changed.` (`1 cell changed.`, `0 cells changed.`), counting cells whose stitch or colour differs |
| Paste, all in | `Pasted 8 cells.` (`Pasted 1 cell.`) |
| Paste, some dropped | `Pasted 6 of 8 cells. 2 were past the edge.` (`1 was past the edge.`) |
| Select drag | `Selected 3 rows by 4 columns.` (`1 row`, `1 column`) |
| Overlapping box | `Repeat boxes cannot overlap.` |
| Box expanded | `Repeat A expanded: 4 columns added.` (`1 column added.`) |
| Expansion too wide | `That is wider than the <maxChartCols> column limit.` |
| Times out of range | `Times must be from 2 to 20.` |
| Mirror across a box | `Mirror cannot cross a repeat box.` |
| Undo skips a cell | `1 cell left as Lena Holt changed it.` (`2 cells left as Lena Holt changed them.`), naming the person who changed the first such cell in row then column order |
| Version saved | `Version 3 saved.` |
| Version restored | `Restored version 2 as version 5.` |
| Published | `Published version 3.` |
| Tester invited | `Invitation sent to <email>.` |
| Co-designer added | `<name> can now edit this pattern.` |
| Rate limited | the 429 message from API |
| Save failed (network or 5xx) | `That change was not saved. Try again.` The cell shows its last saved value |

**Conflict** (`alert "Conflict"`): one line per refused cell, in row then column order, up to 3: `Lena Holt changed row 12, column 5 first. Your change was not kept.`, naming the person whose edit stands. Then `and 2 more cells.` (`and 1 more cell.`) on a last line. It clears after `NOTICE_SECONDS` browser seconds. A newer conflict replaces it and restarts that time.

**Row changed** (`status "Row changed"`): `Row 3 changed while you were typing.`

**Publish error** (`alert "Publish error"`): `Fix 2 row errors before publishing.` (`Fix 1 row error before publishing.`), or `Save a version before publishing.` (shown when there is no saved version, which is checked before row errors).

**Field errors** (each in the alert named in the controls table, and the field gets `aria-invalid="true"`):

- Pattern: `Give the pattern a name.`, `A pattern name can be 120 characters at most.`, `Rows must be from 1 to <maxChartRows>.`, `Columns must be from 1 to <maxChartCols>.`, `Cast on must be at least 1.`
- Colour: `Enter a colour name.`, `Enter a colour as # and six hex digits.`, `A pattern can have <maxColours> colours.`
- Co-designer: `No Twinrow account has that email.`
- Tester: `Enter a valid email address.`, `That person is already testing this pattern.`, `Save a version before inviting testers.`
- Version note: `A version note can be 200 characters at most.`
- Note: `Write a note first.`, `A note can be <noteMaxChars> characters at most.`
- Sign-up: `Enter your name.`, `Enter a valid email address.`, `A password needs at least 10 characters.`, `That email already has an account.`
- Sign-in: `Email or password is incorrect.`, `Verify your email first.`
- Settings, in `alert "Settings error"`: `That password is not right.` (on `textbox "Current password"`), the sign-up password text for a new password that is too short (on `textbox "New password"`), and `Enter your name.` (on `textbox "Name"`)

**Accounts and invitations.**

- Sign-up success replaces the form with the panel text `Check your email to verify your account.`
- `/verify` shows `Your email is verified.` with `link "Sign in"`, or `This link has expired. Sign up again to get a new one.`
- `/invite/<token>` shows `This invitation has expired. Ask the designer for a new one.` or `This invitation has already been used.` in place of the form.
- If mail cannot be sent, the action fails with `The mail could not be sent. Try again.`
- Settings saved: `status "Settings"` reads `Saved.`

**Follow page.**

- `status "Row announcement"` reads the new row's written line, or the no-stitches copy from Interactions.
- `status "Note status"` reads `Note saved on row 5.`
- `status "Version"` reads `Version 2`. When a newer version exists it reads `Version 3 is out. You are following version 2.`, with row, chart and focus unchanged.
- After moving, it reads `Version 3`. If the row is gone, it reads `Version 3. Row 14 is not in this version.`

**Compare** (`status "Compare result"`): the summary string from Business rules.

**Live** (`status "Live"`): `Live`, or with Valkey unreachable: `Live updates are off. Your work is still saved.`

**Pending, loading and page errors.**

- Save, Publish, Restore, Invite, Save note, Create and sign-in buttons are disabled with `aria-busy="true"` until the server answers. A second press does nothing.
- A page loading its data shows the lead line `Loading...` with an empty panel.
- A page whose data call fails shows the lead line `This page could not be loaded. Reload to try again.`

## Backend

### API (DP-35, DP-37, DP-39, DP-59)

All bodies are JSON (`application/json`), with limits and exceptions in Server boundary. Routes under `/api/grading` are described last.

**Error order.** Every API request is checked in this order, and each later check runs only if the earlier passed:

1. Authentication: `401 {"error": "unauthenticated"}`.
2. Existence and access: `404 {"error": "not_found"}` for anything missing or that this user may not open, including another person's private pattern, an id inside a body or a path, a tester calling a designer route, a co-designer calling an owner route and a designer calling a tester route. Never 403.
3. Replay and rate limit: a replayed `opId` or `stepId` answers as Business rules says. Over `EDITS_PER_MINUTE`, edit routes answer `429 {"error": "rate_limited", "message": "Too many edits. Wait a moment."}`.
4. Parse and validation: `422 {"error": "invalid", "field": "<field>", "message": "<exact text>"}`, where the text is the matching field error from Feedback states. Fields with no printed error there (`cells`, `kind`, `opId`, `from`, `step`, `stepId`, a note's `row`, and the other fields of the edit, mirror, repeat and note routes) carry a free-text `message`, and checks read only `error` and `field` for them. An invitation's `name` and `password` use the sign-up copy for those fields.
5. State conflict: `409 {"error": "<code>", "message": "<exact text>"}`.

A page that cannot be opened shows the Not found heading.

**Shared shapes.**

- Cell: `{"row", "col", "stitch", "colour", "repeat", "rev"}`.
- Row: `{"row", "side", "used", "made", "state", "errors": ["<message>"], "text", "notes"}`, where `state` is `ok`, `error` or `empty`, `text` is the written line (empty on an empty row) and `notes` is the note count.
- Colour: `{"letter", "name", "hex"}`.
- Repeat: `{"id", "fromCol", "toCol", "fromRow", "toRow", "times"}`.

Every `rows` value below is all rows of the chart.

**Public.**

- `GET /api/health` → `200 {"status": "ok"}`, in every instance, including with Valkey unreachable.
- `GET /api/config` (no sign-in) → `200 {"today", "timeZone", "limits"}`, where `limits` holds every value of the limits table in Configuration by env name in camelCase (`maxChartRows`, `maxChartCols`, `maxColours`, `coloursPerRow`, `maxFloat`, `undoDepth`, `noteMaxChars`, `editsPerMinute`, `sheetLinesPerPage`, `noticeSeconds`, `rowMotionMs`, `presenceTtlSeconds`, `inviteTtlHours`, `verifyTtlHours`).
- `GET /api/public/<id>` → `200 {"id", "name", "craft", "mode", "terms", "version", "castOn", "width", "height", "colours", "repeats", "cells", "rows"}` for the published version, each row without `notes`. Unpublished: 404.
- `GET /api/patterns/<id>/sheet.pdf` (no sign-in) → `200` with type `application/pdf`, streamed. Unpublished: 404.

**Accounts.**

- `POST /api/signup` `{"name", "email", "password"}` → `201 {"id"}`. 422 on `name`, `email`, `password`. `409 email_taken`. `503 {"error": "mail_unavailable", "message": "<mail copy>"}`.
- `POST /api/verify` `{"token"}` → `200 {"verified": true}`. Unknown token 404. `409 link_expired`.
- `POST /api/session` `{"email", "password"}` → `200 {"id", "name", "email"}` and sets the session cookie. `401 {"error": "invalid_credentials", "message"}`. `401 {"error": "unverified", "message"}`.
- `DELETE /api/session` → `204`.
- `GET /api/me` → `200 {"id", "name", "email", "reduceMotion"}`.
- `PATCH /api/me` `{"name"?, "reduceMotion"?}` → `200`, same shape.
- `POST /api/me/password` `{"current", "next"}` → `204`. 422 on `current`, `next`.

**Patterns (designer routes unless marked).**

- `GET /api/patterns` (any signed-in user) → `200 {"patterns": [{"id", "name", "state", "role"}]}`, with `state` `draft` or `published` and `role` `owner`, `co-designer` or `tester`.
- `POST /api/patterns` (any signed-in user) `{"name", "kind", "rows", "columns", "castOn"}`, where `kind` is a chart-kind label, or `{"sample": true}` → `201 {"id"}`. 422 on `name`, `kind`, `rows`, `columns`, `castOn`.
- `GET /api/patterns/<id>` → `200 {"id", "name", "craft", "mode", "terms", "castOn", "width", "height", "colours", "repeats", "cells", "rows", "colourWarnings": [{"row", "message"}], "version", "state"}`, where `version` is the latest saved number, 0 if none.
- `POST /api/patterns/<id>/cells` `{"opId", "cells": [{"row", "col", "stitch", "colour", "rev"}]}` → `200 {"applied": [{"row", "col", "rev"}], "conflicts": [{"row", "col", "by", "stitch", "colour", "rev"}], "rows"}`. `by` is the name of the person whose edit stands, and the other values are the server's. 422 on `cells` for a stitch outside the craft, a colour not in the key or a cell off the chart.
- `POST /api/patterns/<id>/mirror` `{"opId", "fromRow", "toRow", "fromCol", "toCol"}` → `200 {"applied": [{"row", "col", "stitch", "colour", "rev"}], "conflicts": [], "rows"}`. `409 crosses_repeat`.
- `POST /api/patterns/<id>/text` `{"row", "text"}` → `200 {"changed", "cells", "rows"}`, or `422` with `"field": "text"`, the exact error and `"position"` (null when the message has none).
- `POST /api/patterns/<id>/repeats` `{"fromCol", "toCol", "fromRow", "toRow", "id"?, "times"?}` → `201 {"id", "times", "cells", "rows"}`. `409 overlap`.
- `PATCH /api/patterns/<id>/repeats/<repeat id>` `{"times"}` → `200 {"rows"}`. 422 on `times`.
- `DELETE /api/patterns/<id>/repeats/<repeat id>` → `200 {"cells", "rows"}`.
- `POST /api/patterns/<id>/repeats/<repeat id>/expand` → `200 {"added", "width", "cells", "rows"}`. `409 too_wide`.
- `POST /api/patterns/<id>/repeats/undo-expand` `{"id", "fromCol", "toCol", "fromRow", "toRow", "times"}` → `200 {"width", "cells", "rows"}`, removing the added columns and restoring the box.
- `POST /api/patterns/<id>/colours` `{"name", "hex"}` → `201 {"letter"}`. 422 on `name`, `hex`. `409 too_many_colours`.
- `POST /api/patterns/<id>/co-designers` (owner) `{"email"}` → `200 {"id", "name"}`. 422 on `email`.
- `GET /api/patterns/<id>/versions` → `200 {"versions": [{"version", "note", "savedOn", "stitches"}]}`.
- `POST /api/patterns/<id>/versions` `{"note"}` → `201 {"version"}`. 422 on `note`.
- `GET /api/patterns/<id>/versions/<n>` (designers, or a tester for the version they follow) → `200 {"version", "note", "savedOn", "castOn", "width", "height", "colours", "repeats", "cells", "rows"}`.
- `POST /api/patterns/<id>/versions/<n>/restore` → `201 {"version", "restoredFrom"}`.
- `GET /api/patterns/<id>/compare?a=&b=` → `200 {"a", "b", "rowsChanged", "rowsAdded", "rowsRemoved", "cellsChanged", "stitchesFrom", "stitchesTo", "summary", "cells": [{"row", "col", "stitch", "colour", "diff"}]}`.
- `POST /api/patterns/<id>/publish` → `200 {"state": "published", "version"}`. `409 {"error": "no_version", "message": "Save a version before publishing."}` is checked first. Then `409 {"error": "row_errors", "message": "Fix <n> row errors before publishing."}` (`row error` for 1), with `<n>` counted as Publishing in Business rules says.
- `POST /api/patterns/<id>/testers` `{"email"}` → `201 {"id", "email", "status": "sent"}`. 422 on `email`. `409 already_testing`. `409 no_version`. `503 mail_unavailable`.

**Invitations and testers.**

- `GET /api/invites/<token>` (no sign-in) → `200 {"patternName", "hasAccount", "status"}`, with `status` `sent`, `accepted` or `expired`. Unknown: 404.
- `POST /api/invites/<token>/accept` (no sign-in) `{"name"?, "password"}` → `200 {"patternId"}` and sets the session cookie. 422 on `name`, `password`. `401 invalid_credentials`. `409 invite_expired`. `409 invite_used`.
- `GET /api/patterns/<id>/follow` (tester) → `200 {"id", "name", "craft", "mode", "terms", "castOn", "width", "height", "colours", "repeats", "cells", "rows", "version", "latestVersion", "row"}`, for the followed version, each row's `notes` counting that tester's own notes.
- `POST /api/patterns/<id>/follow` (tester) `{"version"}` → `200 {"version", "row", "movedFrom"}`, with `movedFrom` the old row if it was gone, otherwise null. 422 on `version`, with `Only the latest version can be followed.`
- `GET /api/patterns/<id>/counter` (tester) → `200 {"row", "version", "total"}`.
- `POST /api/patterns/<id>/counter` (tester) `{"from", "step", "stepId"}`, where `step` is 1 or -1 → `200 {"row"}`. 422 on `from`, `step`, `stepId`.
- `POST /api/patterns/<id>/notes` (tester) `{"row", "text"}` → `201 {"id", "row", "text", "version"}`. 422 on `row`, `text`.
- `GET /api/patterns/<id>/notes` → `200 {"notes": [{"row", "text", "tester", "version"}]}`: all notes for designers, only their own for a tester.

**Live socket.** Live updates reach the browser over a WebSocket on the same origin, in the server's order. Its messages are private to the app. Its first message tells the page whether live updates are on.

**Grading routes.** Every grading route needs the header `X-Grading-Key: <GRADING_KEY>`. A wrong or missing key, or an unset `GRADING_KEY`, gives 404. They never return tokens.

`POST /api/grading/setup` with:

```json
{"users": [{"email": "", "name": "", "password": "", "verified": true}],
 "patterns": [{"key": "", "owner": "<email>", "name": "", "craft": "knit", "mode": "flat", "terms": null,
   "castOn": 10, "width": 10, "height": 2,
   "rows": {"1": "k k p p k k p p k k"},
   "colours": [{"letter": "A", "name": "Main", "hex": "<hex>"}],
   "colourRows": {"1": "A A B B B B B B A A"},
   "repeats": [{"id": "A", "fromCol": 2, "toCol": 3, "fromRow": 1, "toRow": 1, "times": 3}],
   "coDesigners": ["<email>"],
   "versions": [{"note": "", "rows": {}, "colourRows": {}, "height": 2, "width": 10, "castOn": 10, "repeats": [], "colours": []}],
   "published": false,
   "testers": [{"email": "", "version": 1, "row": 1, "notes": [{"row": 1, "text": ""}]}],
   "invites": [{"email": "", "sentHoursAgo": 0, "status": "sent"}]}]}
```

It answers `200 {"users": {"<email>": "<id>"}, "patterns": {"<key>": "<id>"}}`.

- `rows` and `colourRows` describe the working chart: each row's symbol keys or colour letters from column 1. Unlisted rows are all `ns` and colour A, and a row with no colour row is all colour A.
- `versions` are saved versions in order, numbered from 1, each a full snapshot. Its `repeats` default to none and its `colours` to the pattern's.
- `published: true` publishes the latest version.
- `testers` become accepted testers, and their row is written to Postgres and Valkey.
- Each entry of `invites` makes an invitation and sends its real mail, dated `sentHoursAgo` hours back. `status` is `sent` or `accepted`.
- A user whose email already exists is kept, with the given name and password. Every pattern is new.

`POST /api/grading/patterns/<id>/hold-updates` with `{"email", "hold"}` → `200 {"held"}`. While held, pushes to that person queue up, and releasing sends them in order. Edits are unaffected. This lets a test make one designer act on an old view.

### Business rules (DP-02, DP-05 to DP-07, DP-09 to DP-20, DP-24, DP-25, DP-28 to DP-30, DP-33 to DP-35, DP-37 to DP-47)

Worked examples are part of the rule they follow. The server owns the chart, the counts, the checks and the written text. Each row count, closing count and note count is derived once on the server, so grid, text, compare view and sheet never disagree. The browser decides none of them.

#### Pattern settings

A pattern has a `craft` (`knit` or `crochet`), a `mode` (`flat` or `round`; crochet is `flat` only) and, for crochet, `terms` (`us` or `uk`). All are fixed at creation by the chart kind, and crochet terms are a stored setting of the pattern.

| Kind | craft | mode | terms | Starting colours |
|---|---|---|---|---|
| `Flat knitting` | knit | flat | none | A `Main` |
| `Knitting in the round` | knit | round | none | A `Main` |
| `Stranded in the round` | knit | round | none | A `Main`, B `Contrast` |
| `Crochet rows in US terms` | crochet | flat | us | A `Main` |
| `Crochet rows in UK terms` | crochet | flat | uk | A `Main` |
| `Tapestry crochet` | crochet | flat | us | A `Main`, B `Contrast` |

A new pattern is all `ns`, colour A. A chart's height is set at creation, and its width changes only by expanding a repeat. A restore brings back the size of the version it restores. Charts are capped at `MAX_CHART_ROWS` by `MAX_CHART_COLS`.

The chart shows the right side. A symbol's key is the value of `data-stitch`.

#### Symbol tables

Knit symbols:

| Key | Name | Letter key | Right-side text | Wrong-side text | Uses | Makes |
|---|---|---|---|---|---|---|
| `k` | Knit | `k` | `k` | `p` | 1 | 1 |
| `p` | Purl | `p` | `p` | `k` | 1 | 1 |
| `yo` | Yarn over | `o` | `yo` | `yo` | 0 | 1 |
| `k2tog` | Knit two together | `t` | `k2tog` | `p2tog` | 2 | 1 |
| `ssk` | Slip slip knit | `s` | `ssk` | `ssp` | 2 | 1 |
| `cdd` | Centred double decrease | `d` | `cdd` | `cdp` | 3 | 1 |
| `m1l` | Make one left | `l` | `m1l` | `m1lp` | 0 | 1 |
| `m1r` | Make one right | `r` | `m1r` | `m1rp` | 0 | 1 |
| `ns` | No stitch | `x` | (nothing) | (nothing) | 0 | 0 |
| `c22` | 2/2 cable | `c` | `2/2 LC` | not allowed | 1 per cell | 1 per cell |

A 2/2 cable takes four neighbouring cells of one row, all `c22`, and reads as one item, `2/2 LC`, which uses 4 and makes 4.

Crochet symbols. A crochet pattern uses only these. The text is the same on both sides and nothing is swapped. `terms` chooses the text column, and keys, names and letter keys never change.

| Key | Name | Letter key | US text | UK text | Uses | Makes |
|---|---|---|---|---|---|---|
| `sc` | Single crochet | `s` | `sc` | `dc` | 1 | 1 |
| `hdc` | Half double crochet | `h` | `hdc` | `htr` | 1 | 1 |
| `dc` | Double crochet | `d` | `dc` | `tr` | 1 | 1 |
| `inc` | Increase | `i` | `inc` | `inc` | 1 | 2 |
| `dec` | Decrease | `e` | `dec` | `dec` | 2 | 1 |
| `ns` | No stitch | `x` | (nothing) | (nothing) | 0 | 0 |

#### Rows, sides and reading direction

- Columns are numbered from 1 at the left edge. Rows are numbered from 1 at the bottom.
- Flat: odd rows are right-side (`RS`) and even rows wrong-side (`WS`). Round: every row is a round (`RND`) and is read as right-side.
- Right-side rows and rounds read from the highest column down to column 1. Wrong-side rows read from column 1 up, and each symbol uses its wrong-side text. `ns` cells are skipped.
- A row whose cells are all `ns` is an empty row. It has no written line and no count check, and the next row up is compared with the nearest non-empty row below it.

#### Row rule

Stitches used by a row must equal the stitches made by the nearest non-empty row below. The first non-empty row must use the pattern's cast-on. Repeat boxes count as expanded, and no-stitch cells count zero.

A row can hold these errors, in this order. Each counts as one row error, and each appears at most once per row:

1. `Row <n> needs <needed> stitches, found <used>.` (the same words for 1 stitch), for example `Row 12 needs 24 stitches, found 23.`
2. `Row <n>: a 2/2 cable needs 4 cells.` when a run of `c22` cells has a length that is not a multiple of 4.
3. `Row <n>: 2/2 LC can only be worked on a right-side row.` when a wrong-side row of a flat chart has any `c22` cell.

In a broken run, cells read in groups of four in reading order, and any shorter leftover also reads as one `2/2 LC` item, using and making its own cell count. A wrong-side row still prints `2/2 LC` in its line. All messages use the word Row, also in the round.

Worked examples:

- Flat, cast on 24. Row 1 is 24 `k`. Row 2 is 23 `k` and one `ns`. Row 2 has the error `Row 2 needs 24 stitches, found 23.`
- Flat, cast on 12, width 12, cells from column 1: rows 1 and 2 all `k`; row 3 `ns k k2tog k k k k k k ssk k ns`; row 4 `ns k ssk k k k k k2tog k ns ns ns`; rows 5 and 6 `ns k k k k k k k k ns ns ns`; row 7 `ns k m1r k k k k k k m1l k ns`. No errors. The rows read: `Row 1 (RS): k12. (12 sts)`, `Row 2 (WS): p12. (12 sts)`, `Row 3 (RS): k1, ssk, k6, k2tog, k1. (10 sts)`, `Row 4 (WS): p1, ssp, p4, p2tog, p1. (8 sts)`, `Row 5 (RS): k8. (8 sts)`, `Row 6 (WS): p8. (8 sts)`, `Row 7 (RS): k1, m1l, k6, m1r, k1. (10 sts)`.
- Crochet, flat, cast on 6, width 8, cells from column 1: row 1 `sc sc sc sc sc sc ns ns`; row 2 `sc inc sc sc inc sc ns ns`; row 3 eight `dc`; row 4 `dec dc dc dc dec dc ns ns`. They read: `Row 1 (RS): sc6. (6 sts)`, `Row 2 (WS): *sc1, inc, sc1; rep from * to end. (8 sts)`, `Row 3 (RS): dc8. (8 sts)`, `Row 4 (WS): dec, dc3, dec, dc1. (6 sts)`. The same chart in UK terms reads: `Row 1 (RS): dc6. (6 sts)`, `Row 2 (WS): *dc1, inc, dc1; rep from * to end. (8 sts)`, `Row 3 (RS): tr8. (8 sts)`, `Row 4 (WS): dec, tr3, dec, tr1. (6 sts)`.

#### Written instructions

The server generates one line per non-empty row, in row order. Each line is `<label> <body> <count>`.

- **Label:** `Row 3 (RS):`, `Row 4 (WS):`, or `Rnd 3:` in the round.
- **Items:** the row's stitches in reading order, repeat boxes expanded, `ns` skipped, each four-cell cable one item.
- **Runs:** neighbouring equal items join. `k`, `p` and every crochet text except `inc` and `dec` always take their count, even for one (`k1`, `p12`, `sc6`, `tr8`). Any other item stands alone when single (`yo`, `k2tog`, `inc`), and takes ` x<n>` for a run (`k2tog x3`, `2/2 LC x2`). Runs are joined by `, `, and the body ends in a full stop: `k2, p2, yo, k2tog x3.`
- **Repeat detection:** over the item list, before runs join, try each period `p` from 2 up to half the list's length, rounded down. For each `p`, try each start `a` from 0 upward. The first `(p, a)` wins where the `p` items from `a` are not all the same and are followed at once by the same `p` items. Let the repeat run as far as it matches. Then the body is: the items before `a` as runs, then `*`, the unit as runs, `; rep from * to `, and the ending. The ending is `end.` when nothing is left; `last st, <tail>.` when the tail uses 1 stitch; `last <n> sts, <tail>.` when it uses `n`; `end, <tail>.` when it uses none. A repeat box makes no change to detection, which reads the expanded items.
- **Closing count:** ` (<n> sts)`, or ` (1 st)`: the stitches the row makes.
- **Colours:** a row uses more than one colour when its stitches, `ns` aside, do. Then every item and run carries its colour letter (`k2 in A, k6 in B, k2 in A.`), and two items are equal only if their colours match too. A one-colour row prints no colour. A cable item takes the colour of its first cell in reading order, and the letter comes last (`k2tog x3 in B`).

Worked examples, each with its cells from column 1:

- `k k p p k k p p k k`, flat, row 1: `Row 1 (RS): *k2, p2; rep from * to last 2 sts, k2. (10 sts)`; the same cells on row 2: `Row 2 (WS): *p2, k2; rep from * to last 2 sts, p2. (10 sts)`.
- `k k p p` six times, in the round, rounds 1 and 2: `Rnd 1: *p2, k2; rep from * to end. (24 sts)` and the same on `Rnd 2:`.
- `k yo k2tog yo k2tog yo k2tog yo k2tog k`, flat, row 3: `Row 3 (RS): k1, *k2tog, yo; rep from * to last st, k1. (10 sts)`.
- `k k k k p k p k`, flat, row 1 (`k1, p1` read first): `Row 1 (RS): *k1, p1; rep from * to last 4 sts, k4. (8 sts)`.
- `k p k p k p p k`, flat, row 1: `Row 1 (RS): k1, p1, *p1, k1; rep from * to end. (8 sts)`.
- `yo k p k p`, flat, row 1: `Row 1 (RS): *p1, k1; rep from * to end, yo. (5 sts)`.
- `p c22 c22 c22 c22 p p c22 c22 c22 c22 p`, flat, row 1: `Row 1 (RS): *p1, 2/2 LC, p1; rep from * to end. (12 sts)`.
- Ten `k`, colours `A A B B B B B B A A`, in the round, round 1: `Rnd 1: k2 in A, k6 in B, k2 in A. (10 sts)`.
- Eight `k`, colours `A B A B A B A B`, in the round, round 1: `Rnd 1: *k1 in B, k1 in A; rep from * to end. (8 sts)`.

#### Text grammar

Grammar: `[label] body [count]`, read exactly as typed, case included.

- `label` and `count` are optional and have the forms above. A label is followed by one space, and a closing count by nothing. Only a label's number is checked. The row decides the side.
- `body` is items joined by `, ` and ended by a full stop.
- An item is a run, optionally followed by ` in <letter>`, or one repeat.
- A run is `k4`, `p1`, `sc6` (those texts always with a count of at least 1), `yo`, `k2tog`, `2/2 LC`, or those with ` x<n>` (`k2tog x3`).
- A repeat is `*<items>; rep from * to end`, `*<items>; rep from * to last st, <items>`, `*<items>; rep from * to last <n> sts, <items>` or `*<items>; rep from * to end, <items>`. `to last 1 st, <items>` is also read.
- A repeat is worked as many whole times as the row's needed stitches allow, at least once. It fits when the stitches used before it, plus a whole number of units, plus the tail equal the row's needed stitches, and the `<n>` it names equals what its tail uses (zero for `to end`). A unit that uses no stitches does not fit.
- The row's side decides which texts are valid: a wrong-side row takes wrong-side texts. `k` and `p` are valid on both sides, and on a wrong-side row they become the opposite chart symbol.

Each error names the row and a position, which counts characters of the typed text from 1 and points at the first character of the failing part.

The first pass reads left to right, the label then each item, and the first failure is shown. For each item it checks the stitch, then the terms, then the side, then the colour, then what follows the item. Only if that pass succeeds does the second pass run, in this order: repeat fit, then cell count, then closing count.

| Check | Message | Worked example, typed text and result |
|---|---|---|
| Label number | `Row <n>, position 1: the label says Row <m>.` | On row 3, `Row 4 (WS): k4.` gives `Row 3, position 1: the label says Row 4.` |
| Unknown word | `Row <n>, position <p>: unknown stitch "<word>".` | On row 3, `yo, k2tog, k2t.` gives `Row 3, position 12: unknown stitch "k2t".` |
| Separator | `Row <n>, position <p>: expected a comma or a full stop.` | On row 3, `k1, p1, k10 p1.` gives `Row 3, position 12: expected a comma or a full stop.` |
| Wrong side | `Row <n>, position <p>: <text> is not valid on a wrong-side row.` | On row 4, `p1, k2tog, p1.` gives `Row 4, position 5: k2tog is not valid on a wrong-side row.` |
| Right side | `Row <n>, position <p>: <text> is not valid on a right-side row.` | On row 3, `k1, p2tog.` gives `Row 3, position 5: p2tog is not valid on a right-side row.` |
| Terms | `Row <n>, position <p>: <text> is not valid in <US or UK> terms.` | In UK terms on row 2, `hdc4.` gives `Row 2, position 1: hdc is not valid in UK terms.` |
| Colour | `Row <n>, position <p>: colour <letter> is not in the key.` | On row 1 with colours A and B only, `k2 in C.` gives `Row 1, position 7: colour C is not in the key.` |
| Repeat fit | `Row <n>, position <p>: the repeat does not fit <needed> stitches.` | On row 3 needing 24, `k1, *k5; rep from * to end.` gives `Row 3, position 5: the repeat does not fit 24 stitches.` |
| Cell count | `Row <n>, position 1: the text needs <cells> cells, the chart is <width> wide.` | On a 24-wide chart's row 3, `k26.` gives `Row 3, position 1: the text needs 26 cells, the chart is 24 wide.` |
| Closing count | `Row <n>, position <p>: the closing count says <m> sts, the row makes <made>.` | On row 3 needing 24, `Row 3 (RS): ssk, k2tog, k20. (24 sts)` gives `Row 3, position 30: the closing count says 24 sts, the row makes 22.` |

Details of those checks:

- A word runs from its first character up to the next space, comma, semicolon or full stop.
- `sc` and `hdc` are terms errors in UK terms, and `tr` and `htr` in US terms. Any other word that is not a text of the pattern's craft is an unknown stitch, including a text that needs a count and has none.
- The separator error points at the first character after an item that is neither a comma followed by one space nor the full stop. If the text ends where one is needed, it points one past the last character. Anything after the full stop other than a closing count is also this error, at its first character.
- The closing count error points at the count's opening bracket, and the count reads `1 st` when it says 1.

A row that passes through a repeat box cannot be edited as text: `Row 3: expand repeat A before editing this row as text.` This comes before every other check and has no position.

**Which cells change.** Items go into the row's cells in reading order, starting at the first cell in reading order that is not `ns` (on an empty row, the row's first cell in reading order: the highest column on a right-side row or round, column 1 on a wrong-side row), each item one cell and a cable four. An empty row has no written line, so it has no row card and no `button "Edit row <n>"`; text for it can only be applied through the text route. If the items would run past the row's last cell, they start just early enough to end on it. Wrong-side texts become their chart symbols. Cells after the last item in reading order become `ns`, and so do cells before the first. Each cell's colour stays unless its item names one.

After applying, the row's line is regenerated, so `k1, k1, p2.` comes back as `k2, p2.`

Worked example: width 10, flat, row 1 `k k p p k k p p k k`. Typing `k4, p6.` gives cells from column 1 `p p p p p p k k k k`, with the status `Row 1 updated: 6 cells changed.`

A balanced row with no `ns` between its stitches and no repeat box returns identical cells when its own line is applied, for every symbol.

#### Repeat boxes

- A box takes the next free id from `A` onward and starts at 2 times. Times run from 2 to 20. It covers the selected rows and columns, and its cells get `data-repeat`. A box that overlaps another is refused.
- The rows of a box count and read as if its columns came `times` times in place. So cells from column 1 `k p p k` with a box on columns 2-3, 3 times, read as `k p p p p p p k`: used 8. A row outside the box's rows is unchanged.
- Expand: the box's columns are copied `times - 1` more times straight to the right of it. The chart grows by that many columns' width, cells to the right move right, other boxes move with their cells, new cells in rows outside the box are `ns`, colours are copied, the box goes and `data-repeat` is cleared. Expanding past `MAX_CHART_COLS` is refused.
- Worked example: width 4, row 1 `k p p k` with box A on columns 2-3, 3 times. Before and after expanding, the row's line is `Row 1 (RS): k1, p6, k1. (8 sts)`, so expanding never changes any line or count. The chart goes from width 4 to width 8, row 1 reading `k p p p p p p k`, with `Repeat A expanded: 4 columns added.`

#### Mirror

Mirror reverses each selected row left to right inside the selection, cells carrying their colours, and swaps `k2tog` with `ssk` and `m1l` with `m1r`. `yo`, `cdd`, `k`, `p`, `ns` and `c22` stay. A selection touching a repeat box is refused. The server applies mirror to its current cells.

Worked example: cells from column 1 `k2tog k yo ssk m1r`, all selected, become `m1l k2tog yo k ssk`.

#### Colourwork

Letters go A to F in order, up to `MAX_COLOURS`. Warnings never block saving or publishing. They are listed in row order, and within a row the colour-count warning comes first, then floats in colour-letter order.

- More colours in a row than `COLOURS_PER_ROW`: `Row 7 uses 3 colours, the limit is 2.`
- A float is a run of stitches between two neighbouring cells of one colour, in the row's items (`ns` skipped, repeat boxes expanded), all in other colours. Each item counts as one stitch and each cable as 4. A float longer than `MAX_FLOAT` gives `Row 7: float of 6 stitches in colour A.`, with the longest float per colour.

Worked example: ten `k`, colours `A A B B B B B B A A`, on row 1: A floats 6, giving `Row 1: float of 6 stitches in colour A.` B has no float, since a float needs a cell of that colour at each end. With `MAX_FLOAT` 6 there is no warning.

#### Edit order and conflicts

- Every edit carries each cell's `rev`. The server handles edits per pattern in arrival order. A cell whose `rev` matches is changed and its `rev` rises by 1. A cell whose `rev` is stale is refused, the earlier edit stands, and the refused person's cell shows the server's value and the Conflict notice. An accepted edit is never lost. Two edits at different cells of one row both survive.
- Replaying an `opId` changes nothing and returns the first answer, whatever the body.
- An applied text and a mirror are based on the server's current cells, and each changed cell's `rev` rises by 1.

#### Undo and redo

Undo is per person and per pattern. Each step is one action: a symbol placed, a selection filled, a delete, a colour set, a drag, a paste, a cut, a mirror, a repeat box, an expand or an applied text. Changing a box's times or adding a colour is not a step.

`UNDO_DEPTH` steps are kept, and a new action clears the redo steps. Undo history ends at reload and on a restore.

Undo sends the earlier values through the same edit route, with the revisions left by your step. A cell another designer changed after your step is left as it is, and the Chart sync copy reports it in place of the Conflict notice.

#### Co-design

A pattern has one owner and any number of co-designers, all designers on the page. Only the owner adds co-designers. A co-designer's account must already exist. Designers on the page are shown with their peers' cursors. A person stays in `list "Here now"` while any of their sockets on the pattern is open, and is removed at once when the last closes.

#### Testers and invitations

An invitation goes `sent` → `accepted` or `sent` → `expired`.

- It expires on the server clock `INVITE_TTL_HOURS` after sending.
- An expired or accepted link cannot be used and answers its 409.
- A new invitation to the same email makes a new link.
- An existing account joins with its password. A new account joins with a name and a password, and is verified by the mail link.
- Joining starts the tester on the latest saved version at row 1 and lands on `/follow/<pattern id>`. A reload stays there.

A tester reads only the version they follow and their own notes. `/patterns/<id>` is not found for them.

#### Row counter

- The counter belongs to one tester on one pattern, and is shared by all that tester's devices. Another tester has their own.
- A step carries its from-row. The server compares `from` with the current row and moves it atomically. A step whose `from` is not the current row changes nothing, so two devices stepping from row 14 end on row 15.
- A step past row 1 or the last row changes nothing.
- Replaying a `stepId` changes nothing. Every such step answers `200` with the current row.
- Every device of that tester shows the new row with no reload, and the designer's `table "Testers"` follows live.
- The row counts every chart row of the followed version, from 1 to its height.

#### Notes

- A note belongs to its tester, row and followed version, and is at most `NOTE_MAX_CHARS` characters, that limit included.
- A saved note appears at once on every designer's page: in `list "Row notes"`, in the chart row's `data-notes`, in the `Notes` cell. On that tester's own devices it appears in `list "Your notes"` and `data-notes`, and on no other tester's page.
- `data-notes` on a designer's chart row counts all testers' notes on that row number, across versions. The `Notes` cell counts all of that tester's notes.
- Notes stay with the version they were written on: a tester who moves version no longer sees earlier notes on the follow page, and designers still do.

#### Versions

- A saved version is a full snapshot of cells, colours, repeats, size and cast-on, numbered from 1 per pattern. A note is optional and at most 200 characters.
- `Saved on` is today, as `YYYY-MM-DD`. `Stitches` is what the top non-empty row makes.
- When a designer saves or restores a version, every open follow page shows the new-version notice without changing the row, the chart or focus.
- Moving keeps the same row number, and the row's new line shows. If the new version has fewer rows, the counter moves to the last row and the row-gone copy shows.

#### Compare

Rows pair by row number and columns by column number.

`combobox "From version"` and `combobox "To version"` list every saved version as an option reading `Version <n>` with value `<n>`, in number order. `/patterns/<id>/compare?a=<n>&b=<n>` opens with those two versions selected and the comparison already shown. `button "Compare"` goes to that address for the chosen pair. With no query, From is the second-latest version and To the latest (both the only version when there is one), and the comparison is shown. With no saved version both pickers are empty and `button "Compare"` is disabled. A query naming a version that does not exist shows the Not found heading, and the API answers 404.

- A paired row is changed if any cell differs in stitch or colour. A cell past the narrower version's width counts as differing, even if it is `ns`.
- Added or removed rows are those past the shorter version's height.
- `cells changed` counts differing cells in paired rows only.
- `Stitches` compares what the top non-empty row makes in each version.

The summary is `3 rows changed, 1 row added, 0 rows removed, 7 cells changed. Stitches 24 to 26.`, with singular `1 row changed`, `1 row added`, `1 row removed`, `1 cell changed`.

`grid "Compare chart"` shows version b, with `data-diff` on each stitch cell: `added` for a cell in an added row or past version a's width, `changed` for a differing paired cell, `same` otherwise. Removed cells are not shown.

Worked example: version a is 1 row of `k k`, cast on 2. Version b has row 1 `k p k` and row 2 `k k k`. The summary is `1 row changed, 1 row added, 0 rows removed, 2 cells changed. Stitches 2 to 3.` Row 1 reads `same`, `changed`, `added`, and row 2 is all `added`.

#### Restore

A restore saves a new version with the same cells, colours, repeats, size and cast-on as the original, and so the same written lines, with the note `Restored from version <n>`. It also becomes the working chart, and every cell's `rev` rises by 1. Nothing later is destroyed. Other designers' pages show it live, and undo history clears.

#### Publishing

A pattern goes `draft` → `published`, and never back.

- Checks run in this order. First, with no saved version, publishing is refused as `no_version`, whatever the working chart holds. Second, if the working chart has any row error, it is refused as `row_errors` and the count is the working chart's row errors. Third, if the working chart is clean but the latest saved version has row errors, it is refused as `row_errors` and the count is that version's row errors. Each error counts once. Colour warnings do not block it.
- Publishing again moves the public page to the latest saved version. Later edits do not reach `/p/<id>` until then.
- The public page and sheet show the published version.
- They carry no tester name, tester email address or note text, and no count of notes.

#### PDF sheet

The app builds the sheet itself from the published version, with open-licensed libraries, and streams it. It uses no headless browser and no separate service.

- Page 1 lines, in order: `<pattern name>`, `Version <n>`, `Cast on <n> stitches` (`Cast on 1 stitch`), `Chart`, the chart itself scaled to fit, `Key`, and one line `<text> <name>` for each symbol used, in symbol-table order, with right-side text or the active terms' text. `ns` is not listed.
- Then pages headed `Instructions`, with the written lines in order, `SHEET_LINES_PER_PAGE` lines to a page.
- Every page ends with the line `<pattern name> - page <n> of <total>`.
- A long line may wrap at a space, and all text is real, extractable text.

So a 24-row chart with 10 lines to a page has 1 + 3 = 4 pages.

#### Accounts

An email address is one account. A password has at least 10 characters. Until verified, sign-in is refused. The verification link lasts `VERIFY_TTL_HOURS`. After sign-in the person returns to the page they asked for, carried by `/signin?next=<path>`. Asking for a private page signed out goes to `/signin`.

### Services (DP-31, DP-35, DP-37, DP-40, DP-48 to DP-50)

**Postgres** holds accounts, patterns, cells, versions, testers, counters and notes. Every save and every reload reads from here, so all saved work survives a Valkey outage.

**Mailpit** receives all mail over SMTP, from `MAIL_FROM`. Links in mail are built from `APP_PUBLIC_URL`.

| Mail | To | Subject | Body |
|---|---|---|---|
| Verification | the new account | `Verify your Twinrow email` | one link to `/verify?token=<token>` |
| Invitation | the invited email | `Test <pattern name> on Twinrow` | one link to `/invite/<token>` |
| Note notice | the pattern's owner | `Note on row 5 of <pattern name>` (with the note's row) | the note text, sent only after the note is saved |

One note gives exactly one notice. If a notice cannot be sent, the note stands.

**Valkey.** Every presence entry, every live edit broadcast and every row counter move passes through Valkey, even with one app process.

- `presence:<pattern id>`: a hash of user id to name. The server keeps a field alive while that person has a socket open, and a field left with no live socket expires after `PRESENCE_TTL_SECONDS`.
- `counter:<pattern id>:<user id>`: the tester's row. Each move is compared and set atomically here, then written to Postgres, then published. If the key is missing it is loaded from Postgres.
- Channel `pattern:<pattern id>`: edits, presence, counters, notes and versions. Pages get pushes from this channel through the app's socket. The browser applies each pushed update as soon as it arrives, with no timer or debounce, and never needs a browser timer to keep the socket alive.

**With Valkey unreachable:**

- Every signed-in page shows the live-updates notice in place of its usual `Live`.
- Every saved pattern still opens.
- Cell edits, text edits, versions, notes and counter moves still save to Postgres and show on the page that made them.
- Another open page gets nothing until it reloads.
- `list "Here now"` shows only the viewer.
- Note mail still goes out.
- Counter moves use the Postgres value with the same from-row rule, and a reload on the other device shows it.
- No page shows an error, a spinner that never ends or a blank chart, and no save waits on Valkey for more than one second.
- When Valkey returns, the app reconnects with no restart and `status "Live"` reads `Live` again within 5 seconds.

### Seed data (DP-59)

The app starts with no accounts or patterns. Every record a check needs is made through the setup route. Every person below is invented, and all sample patterns are original to this task.

| Person | Email |
|---|---|
| Asha Verma, designer | `asha@twinrow.test` |
| Lena Holt, co-designer | `lena@twinrow.test` |
| Tomas Reed, tester | `tomas@twinrow.test` |
| Mei Lin, second tester | `mei@twinrow.test` |
| Sam Ortiz, outsider | `sam@twinrow.test` |

`button "Use the sample"`, or `{"sample": true}`, makes a new flat knit pattern named `Sample swatch` for the signed-in person, using the 12-wide, 7-row shaping chart from the Row rule's worked examples, with cast on 12.

## Technical requirements

### Deployment (DP-59)

Backend: TypeScript on Node 22 with npm. Frontend: TypeScript React built with Node 22.

Node 22 and npm are the runtime available. `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

The server binds `0.0.0.0` on port 4173, honouring `APP_PUBLIC_PORT` when set. `GET /api/health` answers as published in API. The app applies its database schema idempotently on serve, not only at build.

### Configuration and secrets (DP-59, DP-60)

Read every value from the environment at start. Never hard-code a credential or send one to the browser.

Services: `DATABASE_URL`, `VALKEY_URL`, `SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL`, `MAIL_FROM`.

App: `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`, `GRADING_KEY`.

Today: `APP_TODAY` (`YYYY-MM-DD`) is today for every date shown. When unset, today is the current date in `APP_TIME_ZONE` (an IANA name, default `UTC`).

Timers and limits are whole numbers, and each grading instance may set them:

| Env | Default | Meaning |
|---|---|---|
| `MAX_CHART_ROWS` | 120 | most rows in a chart |
| `MAX_CHART_COLS` | 80 | most columns in a chart |
| `MAX_COLOURS` | 6 | colours in a colour key |
| `COLOURS_PER_ROW` | 2 | colours a row may use before the warning |
| `MAX_FLOAT` | 5 | longest float in stitches before the warning |
| `UNDO_DEPTH` | 100 | undo steps kept per person per pattern |
| `NOTE_MAX_CHARS` | 500 | longest row note, in characters |
| `EDITS_PER_MINUTE` | 600 | cell-edit and text requests per person, wall clock |
| `SHEET_LINES_PER_PAGE` | 40 | instruction lines per PDF page |
| `NOTICE_SECONDS` | 6 | browser seconds a notice stays before it clears |
| `ROW_MOTION_MS` | 200 | follow highlight move, in milliseconds |
| `PRESENCE_TTL_SECONDS` | 30 | life of a presence entry in Valkey without a live socket |
| `INVITE_TTL_HOURS` | 168 | tester invitation life |
| `VERIFY_TTL_HOURS` | 24 | verification link life |

### Server boundary (DP-48, DP-59, DP-60)

- Everything is same-origin. The browser makes no external request: fonts, icons and all code are served by the app from open-licensed packages.
- JSON bodies are at most 1,000,000 bytes, that size allowed. A larger body answers `413 {"error": "too_large"}`. A write with another content type answers `415 {"error": "unsupported_media_type"}`. Both are checked before the error order. Malformed JSON answers the 422 shape with `"field": "body"` and `The request body is not valid JSON.`
- The server never serves source files, environment files or credentials.
- Session cookies are HTTP-only.
- With Valkey unreachable at boot, the app still starts, stays up and answers health. Postgres is required.

### Browser support and performance (DP-52, DP-55)

Support current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800, by mouse, keyboard and touch.

The verifier pauses the browser clock, advances it by hand, and blocks service workers. So the app must not depend on a service worker, and pushed updates and server replies must render without any browser timer. Every screen motion and browser timer runs on `requestAnimationFrame`, `performance.now()` and browser timers, which the paused clock controls.

A 120 by 80 chart is usable within three seconds of opening, and a placed stitch shows its cell and line within half a second of the keypress.

## Working rules

- IF-01: `/app/run.json` has string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` names every shipped package, font and icon set with its licence. Shipped packages means the production dependency tree (`npm ls --omit=dev --all --json`).
- IF-03: Every shipped package, font and icon set uses an open licence: MIT, BSD, ISC, Apache-2.0 or SIL OFL.
- IF-04: The app uses only Postgres, Mailpit and Valkey, with no other datastore, queue or PDF service.
- IF-05: No page loads anything from another origin, and no web font, script or icon is fetched from a hosted service.
- IF-06: All server and client source is TypeScript.
- IF-07: No shipped package is a headless browser.
- IF-08: Provisioned service configuration is left as given, and no credential is committed to source.

## Engineering standards

- The code is idiomatic TypeScript with strict type checking on, and React components that hold only presentation and interaction state.
- Names match the domain terms in this brief: row, cell, stitch, cast-on, repeat box, float, version, tester, counter, twin.
- Each domain rule is decided in exactly one place in the source: the symbol table, the row rule, the text generator, the text grammar, and each state transition. Every view uses that one result.
- No abstraction has only a single implementation.
- No dead, commented-out or unreachable code remains.
- There are no defensive checks for impossible states.
- All API errors use the one error shape published in this brief.
- There are no features beyond this brief.
