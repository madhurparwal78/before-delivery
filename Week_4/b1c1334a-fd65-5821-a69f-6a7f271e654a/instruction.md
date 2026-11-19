# Fieldbook Labs Tallyframe

Tallyframe is a self-hosted relational spreadsheet for operations teams of 5 to 40 people, such as joinery workshops, caterers and installers. These teams track stock, orders, jobs and suppliers in linked tables. One document holds typed tables, formula columns, cross-table references, summary tables and per-person row access. Every value agrees after every edit, paste, rename and undo.

The build uses three services:

- **Postgres** holds all state.
- **Mailpit** is an SMTP sink. Each share sends one invite email through it.
- **MinIO** is object storage. Every CSV export is written there, and each download is served from there after the stored file is checked.

The following are out of scope:

- account creation and password reset (the seeded accounts are the only accounts)
- table deletion and removing a share
- imports, automations, charts and attachments
- live push of other people's edits
- any datastore other than Postgres and MinIO

## Problem and users

Small operations teams run their business on a pile of linked spreadsheets. An Orders sheet looks up prices from a Products sheet. A Customers sheet carries a region column. Someone rebuilds a totals tab every Friday.

These files fail in predictable ways:

- When two people edit the same cell, one change silently disappears.
- When one person deletes a row while another corrects it, nobody can tell which happened.
- Deleting a product leaves stale lookups that still show old numbers.
- Renaming a column or a sheet quietly breaks the formulas that used it.
- A bookkeeper who should see only their own clients gets the whole file in an export.
- A flaky connection leaves people unsure whether their last change was saved, so they type it twice.

Hosted no-code databases fix part of this. But they charge per seat and per row tier, cap records, cannot be self-hosted, and lose their linked records when a team leaves. The ops lead pays in weekly reconciliation hours, in wrong invoices built from stale totals, and in the risk of over-sharing client rows.

Tallyframe has three roles:

- **Owner** (weekly): sets up tables, column types, formulas, summary tables and row access. The Owner shares the document and exports CSV files the accountant can open safely.
- **Editor** (daily): enters and corrects orders, stock counts and job rows, and sees totals update without breaking anyone else's work. An Editor may be limited to the rows they own.
- **Viewer** (weekly): reads the rows and summaries they are allowed to see and downloads them as CSV. A Viewer cannot change anything.

## Journeys

1. **Owner sets up a ledger.**
   - **Start:** Mara is signed in on the documents list at 1280 by 800.
   - She creates a document. Only after the server answers does the address bar move to the new document's address. The empty-document state shows, focus is on Create first table, and she hears the creation announced once.
   - She creates an Items table with that button. She lands on the table's own address, the empty-table state shows, focus is on Add row, and the creation is announced once.
   - From the keyboard she adds a Text column Name and a Decimal column Cost, and each addition is announced once. She presses Add row twice and fills both rows.
   - She opens Add column, chooses Formula and types a formula that reads Cost. As she types, the dialog's preview shows its result for the active row.
   - She creates a summary of Items grouped by Name with the sum of Cost. She lands on the summary's own address with focus in its grid, and hears the creation once.
   - She opens Cost's column options menu with the keyboard and renames Cost to Unit Cost. Escape on the menu returns focus to the header button. The formula text and the summary's Sum column name follow the new name.
   - She renames the Items table to Stock_Items. The formula and the summary's name follow.
   - She presses Undo twice. Every name and formula text returns to how it was before.
   - Later, on her phone at 375 by 812, she opens Add column on Stock_Items. It opens as a full-height sheet. She pastes a 64-character name, which wraps without the page scrolling sideways, and adds a Text column Notes. That is announced with the same copy as an earlier Notes column in another table, and she hears it again. She switches on reduced motion mid-session, and the next sheet appears with no slide.
   - **End:** the rail lists both tables with their row counts. The summary shows one group row per distinct key, with the correct Count and Sum. Back and reload return to each screen she landed on.

2. **Editor enters a day's orders.**
   - **Start:** Priya has the seed Orders table open at 1280 by 800.
   - Using only the keyboard, she presses Add row. A row is appended and its Order No cell becomes active.
   - She types an order number, moves right with Tab, picks a customer and a product from their pickers, and enters a quantity. Enter on the last row commits and keeps her on that row.
   - She selects three quantities with Shift+Arrow Down and copies them, and hears how many cells were copied. She clears them with Delete as one batch, and Ctrl+Z brings all three back.
   - She pastes three quantities from a delivery note into the Qty column as one block. One Settle roll plays. Ctrl+Z reverts all three at once, and Ctrl+Shift+Z puts them back.
   - The answer to one quantity is slow. That cell stays muted and busy while she moves up and commits another quantity, which is sent at once. The second answer arrives first. When both have arrived, both cells show their stored values, and the status bar sentence and the one announcement she hears belong to the second commit.
   - The answer to one quantity she saves is lost on the way back, after the server has saved it. The workspace sends the same request again once. The cell keeps its new value and rolls, and the history holds one entry for it.
   - Later her connection drops completely while she commits a quantity. The cell returns to its earlier value with no roll, and she hears the connection copy. Once the connection is back, she retypes the quantity and it saves.
   - On her phone at 375 by 812 she does the same on record cards: a slow Save on one Qty field stays busy while she saves another Qty field, which is sent at once.
   - **End:** Line Totals and summary groups have settled in dependency order. The Products rail entry shows a changed badge. The status bar shows the recalculation sentence, and the workspace reports itself settled at the newest document revision.

3. **Editors and the Owner resolve conflicts.**
   - **Start:** Dev, Priya and Mara have the seed document open.
   - Dev and Priya both change Oak Shelf Bracket's Stock and commit at about the same time.
   - Priya deletes an order row while Dev corrects its quantity.
   - Priya saves a new Line Total formula from the formula bar while Dev saves a different one from the Edit formula dialog.
   - Mara renames Products Price while Priya saves a Line Total formula that names Price.
   - **End:** each race ends in one of the outcomes the brief states, and no change is lost silently. The loser sees and hears the matching copy with the current value, row or formula, and can act again on top of it. Every total matches a fresh recompute. The edit history lists exactly the edits that committed, in commit order.

4. **Editor deletes and restores a product.**
   - **Start:** Priya has just opened the seed document on Products and has made no edits.
   - In Orders, on ORD-1002's Product cell, she types `o`. The picker opens filtered and offers Oak Shelf Bracket and Walnut Floating Shelf. She closes it with Escape.
   - In Products she makes a cell in the Oak Shelf Bracket row active and presses Delete row. The row goes at once, and the deleted-row status names it and offers Undo delete.
   - Orders references to the product show #REF!, so do those Line Totals, and the summary updates. In Orders, typing `o` on ORD-1002's Product now offers only Walnut Floating Shelf. The rail shows one fewer product.
   - She presses Undo twice in quick succession, and the first response is slow to arrive. The deleted-row status closes on the first press.
   - The first press brings the row back in place under the same id, with its cells. Orders references point at it again, and Line Totals and summary groups settle back to their earlier values. The picker offers Oak Shelf Bracket again, first. The second press answers `Nothing to undo.`, Undo is disabled, and the late first response does not repaint over that.
   - On her phone at 375 by 812 she presses and holds ORD-1003's card heading. The row actions sheet opens and she chooses Delete row. The card leaves, at once when reduced motion is on. The deleted-row status stays while her finger rests on it. She presses Undo delete.
   - **End:** ORD-1003's card is back in place with focus on its heading, and the restore is announced once.

5. **Owner shares and resends.**
   - **Start:** Mara is signed in to the seed document while the mail server is unreachable.
   - In the Share dialog she pastes an address that carries a line break. The email field message shows and nothing is sent.
   - She shares with a valid new address as Viewer. The mail-outage banner shows and the person is listed as Not sent.
   - A resend request sent from another site is refused and sends nothing.
   - Once mail is reachable she presses Resend.
   - **End:** the person shows Sent, the share status confirms the invite, and exactly one invite reaches the inbox, addressed to that one person. For a document whose name has accented letters, such as Smörgås Café Ops, the invite's subject shows the name exactly.

6. **Owner exports for the accountant.**
   - **Start:** Mara has Customers open. One phone number begins with a plus sign, and an Editor has typed a customer name that begins with an equals sign.
   - An export request sent to Tallyframe from another site is refused, and no new export appears in her list.
   - From the keyboard she presses Export CSV. She hears once that the file is being written, while the writing indicator sweeps once, and then hears once that it is ready. She downloads it from its link.
   - She corrects a customer name and downloads the same export again.
   - The export record names Mara as its author and the document revision it read.
   - Later the stored file is damaged. Her download is refused with the refusal copy. That copy stays while she keeps editing, and it is still there when she switches to another table and back to Customers.
   - On her phone at 375 by 812 she switches on reduced motion and presses Export CSV. The writing indicator shows still and full. She opens the Exports sheet, whose download link wraps its file name without sideways scrolling, and downloads the file.
   - **End:** the downloads are the same stored file, with neutralised text cells, while the grid still shows each value as typed. The record's fields have never changed. On a server whose storage is unreachable, the same steps end with the export-failed message and no link, and the grid keeps working.

7. **Viewer reads and downloads.**
   - **Start:** Sam is signed out and opens a link to the Orders table of the seed document.
   - Sam is taken to sign-in, signs in, and returns to that same Orders address with focus on the grid's active cell.
   - The grid is announced as read-only, and each rail link is named with its table and row count. Pressing Enter or typing on a cell opens nothing and announces that the document is read-only.
   - Sam opens the Orders by Region summary and downloads it as CSV.
   - Sam signs out, lands on sign-in with focus on Email, and presses Back.
   - **End:** the file matches the summary on screen. Back shows sign-in again, never the grid. Any write Sam's browser might send is refused and nothing changes. A sign-in link whose return address points to another site lands Sam on the documents list instead.

8. **Editor counts stock on a phone.**
   - **Start:** Dev is on a 375 by 812 phone with the seed document open.
   - Dev opens the table drawer and switches to Products. The drawer closes, and nothing in it can be reached any more.
   - Dev taps a Stock field on a record card, enters a new count and saves. The card's Stock Left field settles to the new value, and the status bar shows the sentence. Dev's totals reflect only Dev's orders.
   - Meanwhile Mara changes Dev's share from own rows to all rows. Dev's very next action, without signing in again, shows all five orders and the full totals.
   - Dev opens ORD-1002's Qty field on its Orders card. Mara narrows Dev back to own rows, and Dev presses Save.
   - The two orders Dev no longer owns leave the list in place, the Orders rail count drops, and Dev hears once that 2 rows are no longer shown. Focus is on the first card's heading.
   - Dev saves a slow Stock change, then edits another Stock field. Before Dev presses Save, Mara makes Dev a Viewer.
   - **End:** the second Save is refused. That field returns to its earlier value, and the permission copy is announced. The cards turn read-only without a reload. The slow first save still settles its value, but it does not bring the editing controls back. When Mara makes Dev an Editor again, Dev switches table and the editing controls return.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Sign in without revealing accounts** Sign-in accepts a seeded email and password, starts a session, and answers both a wrong password and an unknown email with the identical 401 response from API.
- **DP-02 — Sessions and sign-out** Every API route except sign-in and health requires a session, the current-person route returns the signed-in person, and sign-out ends the session at once.
- **DP-03 — Documents** A signed-in person lists the documents shared with them and creates a new empty document that they own, with the name rules in API.
- **DP-04 — Tables and typed columns** The Owner creates tables and Text, Decimal, Date, Bool, Reference and Formula columns, renames columns and changes data column types, with the validation stated in API.
- **DP-05 — Typed cell values** Each cell write is validated against its column type and read from its exact decimal text, never through binary floating point, then stored and displayed in the canonical form from Business rules.
- **DP-06 — Cell revisions** Every cell write carries the cell's revision, and a stale revision gets the 409 response from API with the cell's current value and changes nothing.
- **DP-07 — One winner per cell** Of two or more simultaneous writes carrying the same revision of one cell, exactly one succeeds and every other gets the stale-revision 409.
- **DP-08 — Formula language** Formula columns evaluate the literals, operators, references and traversals defined in Business rules for every row.
- **DP-09 — Error values** Formula failures produce one of the five error values under the rules in Business rules, an error propagates to every dependent cell, and IFERROR never catches #CIRC!.
- **DP-10 — Circular formulas** A formula change that creates a cycle through one or more formulas saves, and every cell on the cycle and every cell depending on it shows #CIRC! whatever else it would show.
- **DP-11 — Recalculation in the same request** Every edit, paste, rename, undo and redo recalculates every dependent cell in every table and summary in the same request and transaction, evaluating each cell once, so the response and any later read agree.
- **DP-12 — Ordered recalculation list** Every edit response carries the recalculation list of changed cells with their dependency depth, in the order, with the counts, stacks, access, document revision and sentence, defined in API and Business rules.
- **DP-13 — Summary tables** The Owner creates a summary of a table grouped by one to three columns, with one group row per distinct key as keyed in Business rules, its Count, and the Sum of each chosen column.
- **DP-14 — Totals current after every row change** Adding, editing, pasting or deleting rows updates summary group rows, their Count and Sums, and every aggregate formula in the response to that same request.
- **DP-15 — Deleting a row** Deleting a row turns every Reference cell that pointed at it into #REF! and every formula that followed those references into #REF!.
- **DP-16 — Deleting a column** Deleting a column turns every formula that names it into #NAME?, and a column used by a summary or as the row owner cannot be deleted, as qualified in Business rules.
- **DP-17 — Personal undo and redo** Each person has their own undo and redo stacks per document, bounded as stated in Business rules, in which a pasted block or cleared range is one entry, and an undo never reverts anyone else's edit.
- **DP-18 — Exact restore of a deleted row** Undoing a row deletion restores the row in its place with its cells and revision, every reference still broken by that deletion, every formula that had turned #REF!, and every summary group it removed.
- **DP-19 — Restore of a deleted column** Undoing a column deletion restores the column in its position with all its values, and every formula that had turned #NAME? evaluates again, also when that undo follows the undo of a later rename.
- **DP-20 — Undo conflicts** An undo or redo whose target was changed since by anything other than that person's own later undos and redos gets a 409, changes nothing and drops that entry, and undo or redo on an empty stack gets a 409.
- **DP-21 — Role permissions enforced by the server** The server refuses every action a role may not take with 403 and changes nothing, so a Viewer cannot edit a cell, paste, add or delete a row, change a formula, rename, undo or redo.
- **DP-22 — Row access rules** The Owner marks a Text column as a table's row owner, and a member shared with own-row scope sees and reaches only the rows whose owner cell is their email.
- **DP-23 — Restricted views on totals and summaries** For a member with own-row scope, aggregate formulas, summary groups, row counts, the recalculation list and CSV exports are computed from their visible rows only, and they match that member's grid and API rows.
- **DP-24 — Rows under own-row scope** A member with own-row scope gets their email in the owner cell of every row they add and cannot assign a row to anyone else.
- **DP-25 — Sharing a document** The Owner shares a document with any valid email address as Editor or Viewer with a row scope, and the status and body are identical whether or not the address has an account.
- **DP-26 — Invite email** Each share action sends at most one invite email to exactly one recipient, holding the sharer's name, the document name, the role and the document link and nothing else.
- **DP-27 — Invite outage and Resend** A share made while mail is unreachable is saved as Not sent, and once mail is reachable Resend sends exactly one invite without a server restart.
- **DP-28 — Storage-confirmed exports** An export becomes Ready with a download only after object storage confirms the stored file's byte size and SHA-256, and an export request refused as cross-site creates no export record.
- **DP-29 — CSV format** Exports are RFC 4180 CSV with CRLF line endings, a header row, values exactly as displayed and rows in insertion order.
- **DP-30 — Text neutralised in CSV** Values of text origin that start with one of the six characters listed in Business rules are exported with a leading apostrophe, while the grid and API keep the value as typed.
- **DP-31 — Export with storage down** When object storage is unreachable an export ends Failed with no download, and grid editing keeps working.
- **DP-32 — Formula preview** The preview endpoint evaluates an unsaved formula against one row in the caller's view and returns its display, its error diagnosis or its located reading diagnosis without saving anything.
- **DP-33 — Error order and shape** Every API error uses the single JSON error shape and the precedence stated in API, and a request with several faults answers the first matching step and changes nothing.
- **DP-34 — Health and boot with services down** The health route answers 200 at all times, the app starts and serves while mail or storage is unreachable, and it recovers when they return without a restart.
- **DP-35 — Server boundary** The server rejects cross-origin writes, oversized bodies and non-JSON bodies as stated in Server boundary, and never serves source files or credentials.
- **DP-36 — Seed data** On first start against an empty database, the app creates exactly the accounts, document, tables, rows, summary and shares listed in Seed data.
- **DP-37 — Workspace at 1280** At 1280 by 800 the workspace shows the table rail, the pinned formula bar, the grid with sticky header row and first column, and the status bar, with no page-level horizontal scroll.
- **DP-38 — Workspace at 768** At 768 by 1024 the workspace shows the grid with a collapsible table rail and the status bar, and no pinned formula bar.
- **DP-39 — Record cards at 375** At 375 by 812 each row is a record card, tables are switched from a drawer, dialogs open as full-height sheets, and no grid is shown.
- **DP-40 — Touch targets** Every control in the 375 record view and its sheets meets the touch size stated in Visual design.
- **DP-41 — Grid keyboard model** The grid works from the keyboard alone with the navigation keys, focus rules and grid attributes in Interactions, including the undo and redo shortcuts from anywhere in the workspace.
- **DP-42 — Column options menu** A column header's options menu opens from its header button or from the active cell by the keys in Interactions, is operated by arrow keys, returns focus to its header button on close, and stays fully inside the viewport above the status bar.
- **DP-43 — Dialog focus** Every dialog, sheet and the table drawer keeps Tab and Shift+Tab inside itself, closes on Escape, and returns focus to the control named in Interactions.
- **DP-44 — Formula live preview** Typing in the formula bar or a formula dialog updates its preview on each keystroke without reloading the grid or moving focus, shows only the reply for the newest text, and announces the settled preview once after the typing pause stated in Interactions.
- **DP-45 — Settle roll** After each successful commit, changed cells animate in dependency order with the roll, crossfade and stamp timings in Motion and effects, and end on the stored display.
- **DP-46 — Recalculation markers and rail badges** Every changed visible cell carries its server depth in a data-recalc-depth attribute, and every table not on screen shows a badge with its changed-cell count, until the next successful commit.
- **DP-47 — Status bar tally** The status bar counts up to the number of changed cells and ends on the recalculation sentence.
- **DP-48 — Reduced motion** Under reduced motion, followed live without a reload, values swap instantly, sheets and leaving cards do not move, and changed cells keep a static accent or error bar, while badges, markers, the sentence and announcements stay the same.
- **DP-49 — Live announcements** Each commit announces the recalculation sentence politely, even when it repeats the previous one, only the newest-sent of several commits applied together is announced, and conflicts, circular results, hidden rows and lost permission are announced assertively with the copy in Feedback states.
- **DP-50 — Published copy verbatim** Every string in Feedback states renders and is announced character for character.
- **DP-51 — Journey: Owner sets up a ledger** The Owner creates a document, a table with typed and formula columns, rows and a summary, renames a column and the table, and adds a column from a full-height sheet at 375 by 812, entirely in the browser, as in journey 1.
- **DP-52 — Journey: Editor enters orders** An Editor enters orders from the keyboard alone, keeps committing while an earlier save is slow, selects, clears and pastes quantities, survives a lost response and a dropped connection, and corrects with undo while totals settle, on the grid and on record cards, as in journey 2.
- **DP-53 — Journey: Editors resolve conflicts** Two people race on one cell, one row, one formula and a rename against a formula, and each race ends in its published outcome with the loser seeing and hearing the current state, as in journey 3.
- **DP-54 — Journey: Editor deletes and restores a product** An Editor deletes a product row, finds it gone from the picker and counts, and undoes it so every reference, formula, summary group and picker option returns, then deletes and restores an order from the deleted-row status on a phone, as in journey 4.
- **DP-55 — Journey: Owner shares and resends** The Owner has an unsafe address refused, shares during a mail outage, sees Not sent, and later resends one invite, as in journey 5.
- **DP-56 — Journey: Owner exports for the accountant** The Owner exports Customers by keyboard, hears each status once, downloads the same neutralised stored file before and after later edits, keeps the refusal copy for a damaged file, uses the Exports sheet on a phone, and sees the failure path when storage is down, as in journey 6.
- **DP-57 — Journey: Viewer reads and downloads** A Viewer signs in from a workspace link, returns to it, reads the document read-only, downloads a summary CSV that matches the screen and signs out, as in journey 7.
- **DP-58 — Journey: Editor counts stock on a phone** An Editor with own-row scope updates a stock count from a record card at 375 by 812, sees restricted totals settle, sees the scope widened and narrowed on the next action, loses write access without a reload and regains it, as in journey 8.
- **DP-59 — Ledger look** The workspace reads as a paper ledger as described in Visual design, with hairline-ruled rows, serif table names, mono numbers aligned on the decimal point and a single cobalt accent.
- **DP-60 — Server-owned data and credentials** Service credentials and URLs come only from the environment, and all document state, recalculation and access decisions are made on the server against the real services.
- **DP-61 — Formula functions and date arithmetic** Formulas evaluate SUM, COUNT, SUMBY, COUNTBY, MIN, MAX, AVERAGE, ROUND, IF, IFERROR and date arithmetic over the caller's visible rows with the argument, blank and error rules in Business rules.
- **DP-62 — Column rename rewrites formulas** Renaming a column rewrites every formula token and summary name that names it, leaves every other character byte for byte, and one Undo restores the old texts exactly.
- **DP-63 — Paste a block** Pasting a block of cells writes them all or none in one request with one recalculation and one undo entry, as qualified in API and Interactions.
- **DP-64 — Honest optimistic commit** A pending commit shows its new value muted and busy without holding back later commits, and a failed one, after the single resend stated in Interactions, returns the cell, row and rail to their earlier state with no roll, no markers and no phantom row.
- **DP-65 — Column revisions** Every column change carries the column's revision, a stale one gets the 409 from API and changes nothing, and of simultaneous changes with one revision exactly one wins, whether made from the formula bar or a dialog.
- **DP-66 — Linearisable document edits** Parallel edits to one document apply one at a time, so the recalculation lists for a shared aggregate form one chain ending at the stored value and parallel row adds take distinct positions.
- **DP-67 — Landing and announcement after create** Creating a document, table, column or summary waits for the server's answer, then moves to the published address and focus target and announces the creation once in Workspace status, and Back and reload keep each landed address.
- **DP-68 — A deleted row is gone everywhere** Until it is undone, a deleted row is absent from reads, writes, the Reference picker, aggregates, formula preview, rail counts and new exports, and Undo brings it back under the same id.
- **DP-69 — Simultaneous undo takes distinct entries** Simultaneous undo or redo requests from one person each apply a distinct entry of their stack exactly once, and the extras get the empty-stack 409.
- **DP-70 — Permission changes apply at once** A change to a member's role or row scope applies on that member's very next request in every existing session, and an open workspace whose scope narrows drops the hidden rows in place, closes any editor on them and announces how many rows are no longer shown.
- **DP-71 — Invite header safety** An email address carrying whitespace, control characters or header punctuation, or a document name carrying line breaks or control characters, is refused, and an invite's Subject is RFC 2047 encoded and folded as stated in Services when the document name is not plain ASCII.
- **DP-72 — Exports are stored snapshots, verified on download** A download serves the export's stored bytes only after re-verifying their size and SHA-256, unaffected by later edits, and a changed or missing object answers 502 export_corrupt with no file.
- **DP-73 — Collapsed means unavailable** The collapsed rail at 768 and the closed Tables drawer at 375 cannot be tabbed into, clicked or found by assistive technology.
- **DP-74 — Settle roll survives a new commit** A commit response arriving while an earlier roll plays ends that roll at its final values at once and leaves only the new commit's markers, badges, tally and sentence.
- **DP-75 — Safe return after sign-in** Signing in from a workspace link returns to that same-origin path, and any next value that is not a same-origin path lands on the documents list.
- **DP-76 — Responses applied in send order** The workspace applies commit, undo and redo responses in send order, so the newest-sent response decides the Undo and Redo state, alerts, markers and tally as stated in Interactions.
- **DP-77 — Request-scoped restricted views** Every restricted value, aggregate, summary group, count and recalculation list is computed inside the caller's own request and never carries another person's view, even under interleaved parallel requests.
- **DP-78 — Losing write access mid-session** A commit refused with 403 after a role change reverts like a failed commit, announces the permission copy and switches the workspace to read-only without a reload.
- **DP-79 — Cross-site requests refused** Every state-changing request, sign-in and sign-out included, that is identified as cross-site by its Origin or Fetch Metadata answers 403 cross_origin before session lookup and changes and sends nothing.
- **DP-80 — Abandoned exports and downloads released** A client that leaves mid-export or mid-download never leaves an export writing for more than 15 seconds, never blocks edits, and releases its database connection and storage stream.
- **DP-81 — Exports read one point in the edit order** Every export reads its table at one point in the document's edit order and never mixes cells from before and after one edit, and its record names its author and that document revision and never changes once ready or failed.
- **DP-82 — Export status, progress and announcements** The Export status message belongs to the newest Export CSV or Download press of the shown table, announces each writing, ready and failed change exactly once, survives list refreshes, commits and table switches, and its writing indicator follows reduced motion live.
- **DP-83 — Accessible names and read-only grid** The grid announces read-only for Viewers and announces the read-only notice once per write attempt without moving focus, rail and download links carry the exact names in Public screens and controls, and every error cell describes itself with its tooltip copy, which Escape hides without moving focus.
- **DP-84 — Contrast and not colour alone** All text including the pending value meets 4.5:1 on the ground, bars and focus outlines meet 3:1, and a refused field shows a message, an icon and an invalid state.
- **DP-85 — Row revisions and delete conflicts** Deleting a row carries the row's revision, so of a row delete and a cell write racing on one row exactly one succeeds and the other gets the 404 or 409 stated in Business rules.
- **DP-86 — Concurrent schema and data changes** A column rename racing a formula change, and a cell write racing its column's type change, resolve as one serial order with the exact outcome Business rules states for each order.
- **DP-87 — Table rename rewrites formulas** Renaming a table rewrites every formula token and summary name that names it, leaves every other character byte for byte, and one Undo restores the name and every text.
- **DP-88 — Cycle order and recovery** Cells of a cycle share one recalculation depth and order as stated in Business rules, the rest of the document keeps computing, and breaking the cycle recomputes those cells in the same request.
- **DP-89 — Document revision and edit history** Every committed edit raises the document revision by exactly one and adds one history entry in commit order, and refused or replayed requests add nothing.
- **DP-90 — Settled marker** The workspace carries the document revision of the newest applied response and a settled flag that turns true only after its Settle roll and tally finish.
- **DP-91 — Editing keys at the grid edges** While editing a cell, Enter, Tab, Shift+Tab and Escape commit or cancel and move the active cell exactly as stated in Interactions, including on the last row, last column and first column.
- **DP-92 — Counts current after rapid changes** Row counts, column counts, summary groups, formula results and stack counts in every edit response equal a fresh read, including after rapid successive edits, deletes and undos.
- **DP-93 — Settle roll phases** Every changed visible cell reports its waiting, rolling and settled phase, and a Decimal cell marks exactly its differing characters while rolling, on the depth timing stated in Motion and effects.
- **DP-94 — Range selection** Shift+Arrow and Shift+click select a rectangular range that can be copied as tab and CRLF text with a copy announcement, cleared as one undoable batch and filled by a one-cell paste, as stated in Interactions.
- **DP-95 — Idempotent commits** Every commit route replays a stored success for a repeated Idempotency-Key without applying the edit again and refuses a key reused for a different change, and the workspace resends a commit once with its key after a lost response, as stated in API, Business rules and Interactions.
- **DP-96 — Reference picker** Reference cells are picked from a keyboard-operable combobox and listbox that offers only visible, undeleted target rows read afresh at each opening, with the keys and copy in Interactions.
- **DP-97 — Access follows the newest response** The workspace's read-only state follows only the newest applied response that reports access, so a late earlier success, timers and list refreshes never re-enable editing, and a later read reporting Editor restores it without a reload.
- **DP-98 — Sign-in and sign-out landings** Sign-in, sign-out and Back after sign-out land on the published address with focus on the published control, and no document data is ever shown from history after sign-out.
- **DP-99 — Deleted-row status** Deleting a row shows the deleted-row status naming it with an Undo delete button for 8 seconds, paused while focused or hovered, whose Undo restores the row, focuses its cell and announces the restore once, and at 375 a long press on a card opens its row actions.

## Frontend

### Screens and layout (DP-37, DP-38, DP-39, DP-51, DP-57, DP-58, DP-67, DP-73, DP-75, DP-90, DP-98, DP-99)

The app has three screens:

- **Sign-in** (`/sign-in`, optionally `/sign-in?next=<path>`): a centred form on the paper ground, with the product name in the display serif. A signed-out visit to any workspace URL goes to `/sign-in?next=<path>`, where `<path>` is the visited path, URL-encoded. The return and landing rules are in Interactions.
- **Documents** (`/`): a ruled list of the documents shared with the person. Each entry shows the document's name and the person's role.
- **Workspace** (`/d/<document id>`, and `/d/<document id>/t/<table id>` for a given table or summary): `/d/<document id>` opens on the first table in document order and keeps that address. Every workspace address can be reloaded or opened directly and shows the same screen.

The workspace stacks five regions from top to bottom: the top bar, the table toolbar, the formula bar, the grid or record cards, and the status bar. The table rail sits to the left of the toolbar, formula bar and grid. The whole workspace sits inside the main landmark "Workspace", which carries the settled marker described in Interactions.

**Overlay layer.** Menus, Reference pickers, error tooltips, cell conflict notices, the deleted-row status, sheets and dialogs all render in one overlay layer. That layer is the last element in the page body, outside every scrolling area and above every other layer, the status bar included. A gridcell's own text is only its display. A tooltip or conflict notice is a separate element in the overlay layer, linked to its cell by `aria-describedby`.

- **Top bar:** the document name as the page heading, then Share (Owner only), Undo, Redo and Sign out. Viewers, and members who have just lost write access, also see the read-only notice here. The top bar is shown at every viewport.
- **Table rail:** one entry per table and summary, in document order. Each entry shows the name in the display serif, its visible row count in mono and, when it applies, a changed-cell badge. Below the entries, New table and New summary are shown to the Owner only.
- **Table toolbar:**
  - the table name as a second-level heading;
  - Rename table (Owner only, not on summaries), Add row, Delete row, Export CSV and Add column (Owner only);
  - the Exports region, holding the export status, the export progress indicator and the download links.

  Rename table is shown at 768 and 1280 only. Delete row is in the toolbar at 768 and 1280, and on each record card at 375.
- **Formula bar:** a single line holding the active cell's raw content, with the formula preview to its right.
- **Grid:** one column per table column in position order and one row per visible row in insertion order. The header row and the first column stay put while the grid scrolls inside its own area. Hairline rules separate every row and column.
- **Status bar:** a thin strip carrying the recalculation tally.
- **Deleted-row status:** a ruled strip just above the status bar, in the overlay layer, shown only while it holds a message.

There are exactly three layouts. The width picks the layout: under 768 pixels, 768 to 1279, and 1280 and wider. At no published size does the page itself scroll sideways. A wide grid scrolls inside its own area, and long text such as an email address, a long table name, a long file name or a long formula wraps within its region.

- **1280 by 800:**
  - The rail is always open at about one sixth of the width, with no toggle.
  - The formula bar is pinned above the grid, and the grid fills the rest of the width.
  - The status bar runs along the bottom.
- **768 by 1024:**
  - The rail starts collapsed. The Tables button opens and closes it, and when open it pushes the grid narrower.
  - While collapsed, the rail is fully unavailable: it is not shown, not reachable by Tab, not clickable where it would sit, and absent from the accessibility tree.
  - There is no formula bar. Formulas are edited in the Edit formula dialog.
  - The status bar runs along the bottom.
- **375 by 812:**
  - There is no grid, no rail and no formula bar.
  - The top bar keeps the document heading and its buttons, wrapping onto a second line when needed.
  - Below it, a table bar shows the table name as the level 2 heading and the Switch table button. Switch table opens the Tables drawer from the left. The drawer holds navigation "Tables" and, for the Owner, New table and New summary below the links. While the drawer is closed, nothing in it is shown, reachable by Tab, clickable or in the accessibility tree.
  - Below the table bar, one wrapped row holds Add row, Export CSV, Exports and, for the Owner, Add column. Under that row sit the export status and the export progress indicator. Rename table is not shown at this size, for any role.
  - Below that is a vertical list with one record card per visible row.
    - Each card is headed by the row's first-column value in the display serif.
    - Under the heading come one labelled field per column. Numbers are in mono and right-aligned, and long values wrap inside the card.
    - For writers, each data field has an Edit button and each Formula field has an Edit formula button.
    - Each card has a Delete row button for writers.
  - The status bar stays fixed at the bottom of the screen.
  - Every dialog except the Tables drawer opens as a full-height sheet. The sheet covers the whole viewport, 375 wide and 812 tall, above the status bar, and its content scrolls vertically inside it. A 64-character name in a name field and a 200-character formula in the Formula textbox wrap inside the sheet, and nothing scrolls sideways.
  - Column options, pasting, range selection, and renaming tables and columns are not available at this size.

What each role sees, among the controls shown at their viewport:

- **Owners** see every control.
- **Editors** see every control except Share, New table, New summary, Rename table, Add column and the Owner-only menu items.
- **Viewers** see no writing control: no Add row, Delete row, Undo, Redo, editors, Edit formula buttons or menu actions. Their grid and cards are read-only.

### Public screens and controls (DP-37, DP-38, DP-39, DP-41, DP-42, DP-43, DP-44, DP-49, DP-50, DP-64, DP-67, DP-73, DP-82, DP-83, DP-90, DP-94, DP-96, DP-99)

Only the controls below are public. Everything else is up to you. Copy in angle brackets is a placeholder:

- `<document name>`, `<table name>`, `<column name>` and `<email>` are the record's own text.
- `<row display>` is the row's first-column display, or `(blank)` when that display is empty.
- `<n>` is a whole number.
- `<file name>` is the export's file name.

| Where | Role and accessible name | Visible copy |
|---|---|---|
| Sign-in | heading "Sign in to Tallyframe" | Sign in to Tallyframe |
| Sign-in | textbox "Email", password field labelled "Password" | Email, Password |
| Sign-in | button "Sign in" | Sign in |
| Sign-in | alert | the sign-in failure copy |
| Documents | heading "Documents"; link "<document name>" per document | document name, role in words (Owner, Editor, Viewer) |
| Documents | button "New document" opening dialog "New document" with textbox "Document name" and button "Create document" | same |
| Workspace | main "Workspace" carrying `data-doc-revision` and `data-settled` | none |
| Workspace | status "Workspace status" (polite, visually hidden) | creation, copy and restore copy |
| Top bar | heading level 1 "<document name>"; buttons "Share", "Undo", "Redo", "Sign out" | same |
| Top bar | note holding the read-only notice | read-only notice |
| Rail | navigation "Tables" with one link per table. Each link is named exactly `<table name>, <n> rows`, or `<table name>, 1 row` for one row, with `, <n> changed` appended while a badge shows | table name, `<n> rows` (`1 row`), badge `<n> changed` |
| Rail | button "New table" opening dialog "New table" with textbox "Table name" and button "Create table" | same |
| Rail | button "New summary" opening dialog "New summary" (contents below) | same |
| 768 only | button "Tables" with `aria-expanded` `true` or `false` | Tables |
| 375 only | button "Switch table" opening dialog "Tables" containing navigation "Tables" and, for the Owner, buttons "New table" and "New summary" | Switch table |
| Toolbar | heading level 2 "<table name>"; buttons "Rename table" (768 and 1280 only), "Add row", "Delete row" (768 and 1280 only), "Export CSV", "Add column" (Owner) | same |
| Rename table | dialog "Rename table" with textbox "Table name", buttons "Save name" and "Cancel" | same |
| Add column | dialog "Add column" holding: textbox "Column name"; radiogroup "Type" with radios "Text", "Decimal", "Date", "Bool", "Reference", "Formula", with "Text" checked when it opens; combobox "Target table" (Reference only); textbox "Formula" and status "Formula preview" (Formula only); button "Create column" | same |
| Formula bar (1280) | textbox "Formula"; status "Formula preview" | preview copy |
| Formula | status "Formula announcements" (polite, visually hidden), one per workspace | the settled preview copy |
| Grid | grid "<table name>", with `aria-readonly="true"` for Viewers and read-only members only | values as displayed |
| Grid | a row per header and data row; a columnheader per column, each holding button "<column name> options"; a gridcell per cell. Grid attributes are in Interactions | values as displayed |
| Overlay layer | tooltip per error cell, referenced by that cell's `aria-describedby` | error tooltip copy |
| Overlay layer | cell conflict notice, referenced by its cell's `aria-describedby` while shown | cell conflict copy |
| Reference picker | combobox "<column name>" (the filter textbox) with `aria-expanded`, `aria-controls` and `aria-activedescendant`, controlling listbox "<column name> choices" with one option per choice | `Blank`, row displays, picker no-match copy |
| Column menu | menu "Column options for <column name>" (items below) | same |
| Formula dialog | dialog "Edit formula" with textbox "Formula", status "Formula preview", buttons "Save formula" and "Cancel" | same |
| Rename dialog | dialog "Rename column" with textbox "Column name", buttons "Save name" and "Cancel" | same |
| Grid or cards | empty-table text | empty-table copy |
| Workspace | empty-document text and, for the Owner, button "Create first table" opening dialog "New table" | empty-document copy, Create first table |
| Cards (375) | list "Records" with a listitem per row (contents below) | values as displayed |
| Cards (375) | dialog "Row actions for <row display>" with buttons "Delete row" and "Cancel" | same |
| Overlay layer | status "Deleted row" holding the deleted-row copy and button "Undo delete" | deleted-row copy, Undo delete |
| Status bar | the visible tally text | tally and recalculation sentence |
| Status bar | status "Recalculation announcements" (polite, visually hidden) | recalculation sentence |
| Status bar | alert "Grid alerts" (assertive, visually hidden) | conflict, circular, undo, paste, field-error, read-only, permission, hidden-row, row-gone and connection copy |
| Toolbar (768, 1280) | region "Exports" holding status "Export status", progressbar "Export progress" while an export is writing, and, per ready export, link "Download <file name>" | export copy |
| 375 only | status "Export status" and progressbar "Export progress" under the action row; button "Exports" opening dialog "Exports" holding list "Exports" with link "Download <file name>" per ready export | export copy, Exports |
| Share | dialog "Share document" holding: textbox "Email"; radiogroup "Role" with radios "Editor" and "Viewer", "Editor" checked when it opens; radiogroup "Rows" with radios "All rows" and "Only their own rows", "All rows" checked when it opens; button "Send invite" | same |
| Share | status "Share status"; alert "Mail outage" | share and mail-outage copy |
| Share | list "People" with a listitem per share showing email, role and invite status `Sent` or `Not sent`, plus button "Resend invite to <email>" on Not sent shares | same |

**New summary dialog.** Dialog "New summary" holds:

- combobox "Source table", listing each non-summary table by name, in creation order;
- group "Group by", holding comboboxes "Group by column 1", "Group by column 2" and "Group by column 3";
- group "Sum columns", holding one checkbox per Decimal or Formula column of the source table, named by column name, in column position order;
- button "Create summary".

**Column menu items.** Each item shows only where it applies:

- menuitemradio "Text", "Decimal", "Date" and "Bool": on data columns of those types, disabled for Editors;
- menuitem "Edit formula": on Formula columns;
- menuitemcheckbox "Use as row owner": on Text columns, Owner only;
- menuitem "Rename column" and menuitem "Delete column": Owner only.

**Record card contents.** Each listitem holds:

- a level 3 heading with the first-column value, focusable from script;
- for writers, a button "Edit <column name>" for each data field, and a button "Edit <column name> formula" for each Formula field;
- while a field is being edited, a textbox "<column name>" (or the Reference picker for a Reference field) with buttons "Save" and "Cancel";
- for writers, a button "Delete row".

**New summary controls.**

- Each Group by combobox lists the source table's columns by name, in position order.
- "Source table" starts on the first non-summary table. "Group by column 1" starts on the first column. "Group by column 2" and "Group by column 3" start on an extra first option, "None".
- The summary groups by the chosen columns in combobox order, skipping None. That order is the `group_by` order, the summary's column order and its name order.
- Changing the source table resets all three comboboxes and the Sum columns checkboxes. The checkboxes start unchecked.

**Table creation buttons.**

- Exactly one button is named "New table": the one in the rail, which sits in the Tables drawer at 375. It can be reached only where the rail is shown: always at 1280, at 768 only while the rail is open, and at 375 only while the drawer is open.
- While a document has no tables, the Owner also sees button "Create first table" in the grid area, next to the empty-document copy, at every viewport. It opens the same dialog "New table", and it disappears once the document has a table.
- Editors and Viewers never see either button.

### Interactions (DP-41, DP-42, DP-43, DP-44, DP-49, DP-51 to DP-58, DP-63, DP-64, DP-65, DP-67, DP-68, DP-69, DP-70, DP-73, DP-75, DP-76, DP-78, DP-82, DP-83, DP-90, DP-91, DP-94, DP-95, DP-96, DP-97, DP-98, DP-99)

**Grid focus.** The grid is one Tab stop. Focus lands on the active cell, which starts as the top-left data cell. The grid's attributes stay correct after every move, row add, row delete, column change, re-read and reload:

- The grid carries `aria-rowcount`, equal to the number of visible rows plus one, and `aria-colcount`, equal to the number of columns.
- The grid carries `aria-multiselectable="true"`.
- Every row carries `aria-rowindex`. The header row is 1, and data rows count from 2 in display order.
- Every gridcell and columnheader carries `aria-colindex`, counting from 1.
- While no range is shown, exactly one data gridcell, the active cell, has `aria-selected="true"`. While a range is shown, every gridcell in it has `aria-selected="true"` and no other has.
- Exactly one element inside the grid has `tabindex="0"`: the active cell, or the header options button when the active position is on a header. Every other gridcell and header button has `tabindex="-1"`.

**Viewing keys** (a cell is active and no editor is open):

- **Arrow keys:**
  - An arrow key moves the active position one step, stops at the edges, and collapses any range.
  - Arrow Up from the first data row moves onto that column's header options button.
  - Arrow Left and Arrow Right move between header buttons.
  - Arrow Down from a header returns to the first data row, when there is one.
- **Home and End** move to the first or last column of the active row.
- **Ctrl+Home and Ctrl+End** (Cmd on macOS) move to the first data cell of the first row and to the last data cell of the last row.
- **Enter or F2:**
  - On a Text, Decimal, Date or Bool cell, it opens the editor with the current value and the caret at the end.
  - On a Reference cell, it opens the Reference picker with an empty filter.
  - On a Formula cell, it moves focus into the formula bar at 1280, or opens the Edit formula dialog at 768.
- **Typing a printable character:**
  - On a Text, Decimal, Date or Bool cell, it opens the editor and replaces the value with that character.
  - On a Reference cell, it opens the picker with that character as its filter.
  - On a Formula cell, it does nothing.
- **Delete or Backspace with no range:**
  - On a data cell, Reference included, it commits the cell as blank.
  - On a Formula cell, it does nothing and sends nothing.
- **Tab** leaves the grid for the next focusable element after it.
- **Shift+Tab** leaves the grid for the previous focusable element: the formula bar's textbox at 1280, or the last toolbar control at 768.
- **Escape** collapses a shown range. With no range, it clears a shown conflict notice. Otherwise it hides the active error cell's tooltip. Focus stays on the active cell in every case.
- **Shift+F10** opens the column options menu of the active cell's column.

An error cell's tooltip shows whenever the cell is active or hovered, so moving onto it by keyboard shows it. After Escape hides it, it shows again the next time the cell becomes active.

**Read-only workspace.** A Viewer, and a member whose workspace is read-only, can move with every viewing key, select a range and copy it. These keys open no editor or picker, send nothing, and keep focus on the active cell:

- Enter or F2 on a data cell;
- a typed character;
- Delete or Backspace;
- paste.

Each such press or paste announces the read-only notice in "Grid alerts", once per attempt.

**Range selection (768 and 1280).**

- **Selecting:** Shift+Arrow extends a rectangular range from the anchor, one row or column per press. The anchor is the active cell, and it keeps focus. Shift+click on a cell extends the range from the anchor to that cell.
- **Collapsing:** a plain arrow key, a plain click or Escape collapses the range.
- **Copying:** Ctrl+C (Cmd+C), or the browser's copy event while the grid has focus, writes plain text to the clipboard. The text holds the range's displays, with cells joined by a tab and rows joined by CRLF, no trailing line break, and an empty string for a blank cell. A copy with no range copies the active cell. Only once the clipboard write has completed does "Workspace status" announce the copy copy from Feedback states, with `<n>` the number of cells copied.
- **Clearing:** Delete or Backspace on a range sends one paste request.
  - The request blanks every non-blank Text, Decimal, Date, Bool and Reference cell in the range, and skips Formula cells.
  - When nothing in the range is left to blank, nothing is sent.
  - The clear is one `cell_batch` undo entry. It plays one Settle roll, and the range stays shown.
- **Pasting onto a range:**
  - A clipboard holding exactly one cell fills every cell of the range.
  - Any other block must have exactly the range's rows and columns.
  - If the range covers a Reference or Formula column, or the block's shape differs, the paste is a no-fit (see Paste).

**Editing keys** (an editor is open):

- **Arrow Left, Arrow Right, Home and End** move the caret inside the text. Arrow Up and Arrow Down do nothing.
- **Enter** commits and moves the active cell one row down in the same column. On the last row it commits and the active cell stays on that row. No row is added.
- **Tab** commits and moves one column right. On the last column it moves to the first column of the next row. On the last cell of the last row it stays.
- **Shift+Tab** commits and moves one column left. On the first column it moves to the last column of the previous row. On the first cell of the first row it stays.
- **Escape** cancels. The editor closes, the cell shows the value it had before editing, and the active cell stays where it was.
- **Committing unchanged text** sends nothing, but the move still happens.
- **Clicking another cell** while editing commits, then moves to the clicked cell.

After a commit-and-move, the editor is closed and focus is on the new active cell. The active cell moves at once, before the server answers. If the server then refuses the commit:

- On a 422, the active cell returns to the failed cell and its editor reopens holding the typed text.
- On a 409, the active cell returns to the conflicting cell, not editing, showing the current value.

**Reference picker.** The picker opens in place of a Reference cell's editor (or a Reference card field's editor at 375).

- **Structure:** its filter is the combobox named after the column. The combobox has `aria-expanded="true"` and `aria-controls` naming the listbox "<column name> choices". Focus stays in the filter, and `aria-activedescendant` names the highlighted option.
- **Options:** each time the picker opens, it reads the target table afresh in the person's own view.
  - The first option is `Blank`, shown only while the filter is empty.
  - Then comes one option per visible, undeleted target row, in insertion order, named by that row's display.
  - The filter keeps the options whose display contains the filter text, ignoring case.
- **Highlight:** it starts on the option of the cell's current value when that option is shown, and otherwise on the first option. Arrow Down and Arrow Up move it one option and stop at the ends.
- **Keys:**
  - Home and End move the caret in the filter.
  - Enter picks the highlighted option, commits it, and moves the active cell down, like the editor's Enter.
  - Tab picks it, commits it and moves right, like the editor's Tab.
  - Escape cancels and returns focus to the cell, which keeps its value.
- **No match:** when no option matches, the listbox is empty and the picker shows the picker no-match copy. Enter then sends nothing.
- **Refused write:** on a 422 for the write, the picker reopens with its filter as typed, its options read afresh, and the field message in "Grid alerts".

**Add row and Delete row (768 and 1280).**

- **Add row** appends one row at the end of the table once the server answers. That row's first cell becomes active, and focus moves into the grid on it, not editing.
- **Delete row** deletes the active cell's row at once, without a confirmation dialog. It sends the row's revision as last read, and Undo brings the row back.
  - Afterwards the active cell moves to the same column of the row that followed. When the deleted row was last, it moves to the same column of the new last row. Focus moves into the grid on that cell.
  - When the table is left with no rows, focus moves to Add row. Delete row is disabled while the table has no rows.
  - On a 409, the row reappears in place showing the current values from the response, the row conflict copy goes to "Grid alerts", and the active cell returns to that row.

**Deleted-row status.** When a row delete succeeds, by the toolbar, a card or the row actions sheet, status "Deleted row" shows the deleted-row copy naming that row, with button "Undo delete". Its text is written once, so it is announced once.

- **Timing:** it stays for 8 seconds of unpaused time and then closes. The timer pauses while focus is inside the status or the pointer is over it, and resumes with its remaining time when both have left.
- **Tab order:** "Undo delete" comes after the grid or card list and before the status bar in Tab order.
- **Undo delete** sends the same undo request as the Undo button, under every rule for undo.
  - On success the status closes and the row is back in place. Focus moves to the restored row's cell in the column that was active when the row was deleted, which becomes the active cell. At 375 focus moves to the restored card's heading instead.
  - "Workspace status" then announces the restore copy once.
  - On a 409 or failure, the status closes and the matching copy goes to "Grid alerts", as for any undo.
- **Closing early:** the status closes at once when the person sends any other commit, undo or redo. A later row delete replaces its message.
- Closing never moves focus, except that focus inside the status at that moment moves to the grid's active cell, or at 375 to the first card heading.

**Paste (768 and 1280).** When the grid has focus and no editor is open, the browser's paste event pastes the clipboard's plain text as a block:

1. The text is split into lines on CRLF or LF, ignoring one trailing line break. Each line is split into cells on tab characters.
2. With no range shown, the block's top-left cell lands on the active cell. With a range shown, the range rules above apply.
3. Nothing is sent, and "Grid alerts" carries the paste no-fit copy, when any of these holds:
   - the lines have different numbers of cells;
   - the block runs past the last visible row or the last column;
   - the block covers a Reference or Formula column;
   - the block does not fit the shown range.
4. Otherwise the block is sent as one paste request. Each pasted text goes as the cell's value exactly as copied, and an empty text goes as blank.
5. On success, one Settle roll plays for the whole block, and the active cell stays on the block's top-left cell.
6. On a 409, every stale cell shows its current value from the response, and the conflict notice appears under the first stale cell.
7. On a 422, nothing changes, and the first field message appears under its cell and in "Grid alerts".

**Undo and redo shortcuts.** Ctrl+Z (Cmd+Z on macOS) undoes. Ctrl+Shift+Z or Ctrl+Y (Cmd+Shift+Z) redoes.

- The shortcuts work whichever workspace control has focus: the grid, a toolbar or top-bar button, a rail link or a record card.
- They do not apply inside an open editor or text field, where the browser's own text undo applies, or while a dialog, sheet, menu or picker is open.
- Each press sends its own request, even while an earlier one is pending, so a quick double press sends two.
- The Undo and Redo buttons do the same. Pressing either keeps focus on the button, unless the button becomes disabled. Then focus moves to the grid's active cell.

**Send order and the one resend.** Every commit, undo and redo is numbered in the order the workspace sends it, and it gets its own new `Idempotency-Key`.

- **Nothing waits:** each commit is sent the moment it is made, even while earlier commits are pending. Nothing is queued behind a pending request. Every pending cell or card field keeps its muted value and `aria-busy="true"` until its own response is applied, while the person moves on and edits elsewhere.
- **Resending:** if a request fails at the network level, or has no answer after 10 seconds, the workspace at once sends the identical request again: same method, address, body and key. The resend holds the same place in the send order. Only if the resend also fails, or also has no answer after 10 seconds, does the request count as a connection failure.
- **No resend for server answers:** a 5xx answer is a failure at once, with no resend.
- **Holding answers:** responses are applied strictly in send order. A response that arrives early is held until every earlier-sent request has answered or failed. Then the held responses are applied together.

When the responses are applied, they settle the screen as follows:

- **Cells:** every response applies its own cell values, oldest-sent first, and clears its own pending state.
- **Responses applied together:** when several responses are applied at once, only the newest-sent success among them plays a Settle roll, sets markers and badges, runs the tally and makes its polite announcement. Earlier successes in the same batch apply only their cell values, and announce nothing.
- **Undo and Redo buttons:** disabled exactly when the newest-sent response's `stacks` report `undo_count` 0 (or `redo_count` 0). Every response sets this, success or 409.
- **Markers, badges, tally and announcement:** those of the newest-sent successful commit. A 409 or a failure never replaces them.
- **"Grid alerts":** ends on the alert of the newest-sent response that has one.

For example, with the seed data at start, Priya commits ORD-1001's Qty as `5`, and its answer is held back. She commits ORD-1003's Qty as `11`, and that answer arrives first. Until the first answer arrives:

- ORD-1001's Qty cell shows `5` muted, with `aria-busy="true"`;
- the second commit's request has already been sent;
- ORD-1003's cell is also still pending, because its answer is held;
- the status bar shows the pending copy.

When the first answer arrives, both cells show their stored values. The markers and the status bar sentence are those of the second commit, and "Recalculation announcements" carries only that sentence, written once.

For another example, with the seed data at start, Priya deletes Oak Shelf Bracket and then double-presses Undo, and the first undo's response arrives 800 milliseconds after the second's. In the end:

- "Grid alerts" reads `Nothing to undo.`;
- Undo is disabled and Redo is enabled;
- the status bar shows the restore's sentence;
- the `data-recalc-depth` markers match the restore's list.

**Read-only state.** The workspace is read-only or writable. Only these responses set that state:

- a 403 `forbidden` answer to a commit, which makes it read-only;
- a table read or document read, which makes it read-only when its access role is viewer and writable otherwise.

Table and document reads take part in the same send order. A response that sets the state applies only if no later-sent response has already set it.

- A commit success never changes the state. A success sent before a 403 still applies its cells, markers and roll, but editing stays off.
- Roll steps, exports-list refreshes, the deleted-row timer and other timers never change the state, and never clear the permission copy from "Grid alerts".
- When the state turns writable again, Add row, Delete row, card Edit buttons, Undo and Redo return without a reload. Undo and Redo are enabled from the read's `stacks`.

**Access changes and hidden rows.** The workspace remembers the last access (role and row scope) it applied. A 403 `forbidden` counts as reporting role viewer.

- **When it re-reads:** the workspace at once reads the document and the shown table again, in send order, in two cases:
  - a response's `access` (in a table read, a document read or an edit response's `recalc`) differs from the last applied access;
  - a commit is answered 404 `not_found`.
- **Applying the re-read:** the re-read is applied in place, without a page reload. The grid or card list drops rows the read no longer has and adds rows it newly has. The rail counts, summary groups and the grid attributes follow.
- **Open editors:** an editor, picker or card field editor open on a row the re-read no longer shows closes, discarding its text. Focus then moves to the grid's first visible data cell, which becomes the active cell. At 375 it moves to the first card heading. With no rows left, it moves to Add row, or to the level 2 heading for a read-only member. Editors on rows that are still shown stay open with their text and focus.
- **What "Grid alerts" says:** `<n>` is the number of rows the previous read of the shown table showed and the re-read lacks.
  - If the re-read reports a narrower access than before and `<n>` is at least 1, "Grid alerts" carries the hidden-rows copy, once.
  - Otherwise, if a 404 caused the re-read, it carries the row-gone copy.
  - The 404'd cell or field returns to its pre-edit state as on a connection failure, with no roll and no marker.

For example, with the seed data at start: Mara moves Dev to `all`, and Dev's workspace has read Orders with 5 rows. Mara then moves Dev back to `own` while Dev has ORD-1002's Qty editor open, and Dev commits it. The commit answers 404. ORD-1002 and ORD-1004 leave the grid in place, the Orders rail link reads `Orders, 3 rows`, and "Grid alerts" says `2 rows are no longer shown to you.` once. Focus is on ORD-1001's Order No cell, or at 375 on the first card's heading.

**Settled marker.** The main landmark "Workspace" carries two attributes:

- `data-doc-revision`: the `document_revision` of the newest applied response, or of the last page load or table read when that is newer.
- `data-settled`: `"false"` from the moment a commit is sent until two things are true: every sent request has been applied, and the last applied Settle roll and tally have finished. It then turns `"true"` at the instant stated in Motion and effects.
  - Under reduced motion, it turns `"true"` as soon as the last response is applied.
  - A failed or refused commit also ends with `"true"`, with the revision unchanged.

**Column options menu.**

- **Opening:** with a header options button focused, Enter, Space or Alt+Arrow Down opens its menu. Clicking the button also opens it, and Shift+F10 opens it from an active data cell. The first enabled item gets focus.
- **Moving:** Arrow Up and Arrow Down move through the items and wrap at both ends. Home and End jump to the first and last item.
- **Choosing:** Enter or Space activates the focused item. Disabled items can be focused but do nothing.
- **Closing:** Escape, Tab, choosing an item without a dialog, or clicking outside closes the menu. Focus returns to that column's header options button, which becomes the grid's `tabindex="0"` element with the active position on that header.
- **After a type change or "Use as row owner":** focus is on the header options button.
- **After "Delete column":** focus moves to the header options button of the column now in the same position. If the deleted column was last, focus goes to the new last column's button. If no columns remain, it goes to Add column.
- **Placement:** the menu sits in the overlay layer, so the grid never clips it.
  - It opens below its header and shifts left or flips up as needed to stay fully inside the viewport and above the status bar. This includes a header next to the right edge of a grid scrolled sideways.
  - Every item can be reached by pointer and keyboard.
  - Error tooltips, conflict notices and Reference pickers follow the same placement rule, including on the last record card at 375. Each of their options can be hit at its centre and never overlaps the status bar.

**Dialogs, sheets and drawer.**

- **Opening:** every dialog and sheet, and the Tables drawer, opens with focus on its first field, or on its first button when it has no field.
- **Focus trap:** Tab from the last control wraps to the first, and Shift+Tab from the first wraps to the last.
- **Cancel:** Escape or Cancel closes it, and focus returns to the control that opened it. For a dialog opened from a column menu, that is the column's header options button. A sheet opened from the Tables drawer covers the drawer, and closing it returns focus to its opener inside the drawer.
- **Submit:** Enter in the last single-line text field, or the main button, submits. On a 422 the dialog stays open with field messages, and focus moves to the first invalid field.
- **Pending creates:** while a create request is pending, its main button is busy and disabled and the address does not change. The address and focus move only after the server answers with success.
- **Focus after success:**
  - New document, New table, Create first table and New summary land as described under Landing after create.
  - Add column closes and focuses the new column's header options button. At 375 it focuses the first card's Edit button for the new column, or Add row when the table has no rows.
  - Rename column closes and focuses button "<new column name> options".
  - Edit formula closes and focuses that column's header options button. At 375 it focuses the "Edit <column name> formula" button it was opened from.
  - Rename table closes and focuses button "Rename table". The heading and the rail link show the new name.
  - Share document stays open, clears its Email field and keeps focus there.
- **Formula textboxes:**
  - The Edit formula dialog's textbox "Formula" opens holding the column's stored formula exactly as the API returns it, without a leading equals sign.
  - The Add column dialog's textbox "Formula" starts empty.
  - Either textbox accepts text with or without a leading equals sign and sends it as typed.
  - At 375 the textbox wraps its text over several lines, and Enter inserts nothing. Save formula or Create column submits.
- **409 on a column or table change:** the dialog stays open and refills from the response. The Edit formula textbox gets `current.column.formula`, without a leading equals sign. The Rename column textbox gets the current column name, and the Rename table textbox the current table name. The dialog shows the matching conflict copy.

**Landing after create.** Each create waits for the server's success. Only then does it move the address bar, with a new history entry, and announce the creation once in "Workspace status" with the creation copy:

- Create document lands on `/d/<new document id>`, showing the empty-document state with focus on button "Create first table", at every viewport.
- Create table lands on `/d/<document id>/t/<new table id>`, with the level 2 heading set to the table name and focus on Add row.
- Create summary lands on `/d/<document id>/t/<new summary id>`, with focus on the grid's active cell, or at 375 on the first card heading.
- Add column keeps the address and moves focus as stated above.

Two creations in a row with identical copy are each announced. Browser Back from each landing returns to the previous address with no dialog reopened. Reloading a landed address shows the same screen.

**Sign-in, sign-out and history.**

- **Where sign-in goes:** after a successful sign-in, the app goes to `next` only when its decoded value starts with a single `/` that is not followed by another `/` or by `\`. Every other `next` value, and a missing one, lands on `/`.
- **Focus after sign-in on a workspace path:** focus lands on the grid's active cell, or at 375 on the first card heading. If the shown table has no rows, focus goes to Add row, or to the level 2 heading for a read-only member. If the document has no tables, focus goes to "Create first table", or to the level 1 heading for a non-Owner.
- **Focus after sign-in on `/`:** focus lands on the first document link, or on "New document" when there is none.
- **Sign out:** lands on `/sign-in` with no `next` and focus on Email.
- **Back after sign-out:** whenever the browser shows an earlier app page again, from the back-forward cache included, the app checks the session before showing any document data. With no session it lands on `/sign-in?next=<that page's path>`, and no gridcell, card or row value appears.
- **Back and Forward while signed in:** they show the address's screen with the shown table read afresh, never rows kept from an earlier visit.

**Formula bar (1280).**

- The textbox "Formula" shows the active cell's raw content. For a data cell that is its value. For a Formula cell it is the column formula with a leading equals sign.
- On each keystroke the formula preview updates in place from the preview endpoint for the active row. The grid does not reload, and focus stays in the textbox.
- **Latest input wins:** "Formula preview" only ever shows the reply for the textbox's current text. A reply for older text that arrives after a newer reply, or after the text has changed again, is discarded.
- Enter saves.
  - For a data cell, it writes the cell's value.
  - For a Formula cell, it saves the column formula as a column change carrying the column's revision, exactly like the Edit formula dialog. On a 409 the textbox refills with the current formula, with a leading equals sign, and the column conflict copy goes to "Grid alerts".
- Escape reverts the text and returns focus to the active cell.
- For Viewers the bar is read-only.

**Formula preview in dialogs.** The Edit formula dialog, and the Add column dialog with Formula chosen, update their own "Formula preview" on each keystroke in the same way, under the same latest-input rule, without moving focus.

- The preview uses the active cell's row when the active cell is in the dialog's table. At 375, an Edit formula sheet uses the row of the card it was opened from. Otherwise it uses that table's first visible row.
- When the table has no visible rows, the preview shows the no-rows copy and sends no request.
- When the textbox is empty, the preview sends no request.

**Formula announcement.** When typing in the formula bar or a formula dialog pauses for 500 milliseconds and "Formula preview" shows the reply for the current text, "Formula announcements" announces that preview's text once. The text is the result, the error copy, a formula-reading copy or the no-rows copy. Each pause announces at most once. An empty textbox announces nothing. A keystroke within the 500 milliseconds starts the wait again.

**Commit flow.** A commit is a cell write, paste, row add, row delete, undo, redo, column change or table rename.

- **While pending:**
  - the edited cell shows the new value muted, and its gridcell, or its card field at 375, has `aria-busy="true"`;
  - a deleted row is removed from view at once;
  - the status bar shows the pending copy.
- **On success:**
  - `aria-busy` is removed and the cell shows the stored display;
  - the Settle roll plays on the response's recalculation list, the status bar runs its tally, and the polite announcement goes out, under the rule for responses applied together;
  - rail counts follow `row_counts`;
  - after an undo, a redo or a rename, the shown table reloads its rows and columns in place, without a page reload, before the roll plays.
- **On 422:** the cell returns to its pre-edit display, its editor or picker reopens holding the typed text, and the field message shows.
- **On 404:** as stated under Access changes and hidden rows.
- **On a connection failure (after the one resend) or any 5xx:**
  - the cell returns to its pre-edit display and keeps its earlier revision, so the next commit is sent with that revision;
  - a failed Add row leaves no row behind, and a failed Delete row puts the row back in its place;
  - no roll plays and no `data-recalc-depth` marker is added, and earlier markers, rail counts and badges stay as they were;
  - `aria-busy` is removed and the connection copy goes to "Grid alerts".
- **On 403 `forbidden`:**
  - everything reverts exactly as on a connection failure, and the permission copy goes to "Grid alerts";
  - the workspace turns read-only without a reload: the read-only notice appears; Add row, Delete row, Undo, Redo, card Edit and Edit formula buttons, open editors, Rename table and Add column disappear; and the grid gets `aria-readonly="true"`;
  - the shown table is read again, so any scope change shows in the same switch.

**Conflict on a cell.** On a 409 for a cell write:

- The cell shows the current value and revision from the response.
- The cell conflict notice appears directly under that cell, in the overlay layer, and goes to "Grid alerts".
- The person can retype at once on top of the current value. The notice clears on their next commit or on Escape.

**Rail and drawer.**

- Clicking a rail link, or pressing Enter on it, opens that table and clears its badge.
- At 768, the Tables button toggles the rail and reports `aria-expanded`. The Tab order is the top bar, the Tables button, the rail links (only while open), the toolbar, then the grid.
- At 375, Switch table opens the drawer.
  - Choosing a table closes the drawer and moves focus to that table's first card heading, or to Add row when the table has no rows.
  - Closing the drawer with Escape returns focus to Switch table.

**Record cards (375).**

- **Editing a field:**
  - Tapping a field's Edit button turns it into a labelled textbox, or into the Reference picker for a Reference field.
  - Save commits and Cancel restores. Enter and Escape do the same from the keyboard.
  - After Save or Cancel, focus returns to that field's Edit button. After a 403, the Edit buttons are gone and focus moves to the card's heading.
  - A Save is sent at once even while another field's Save is pending. Each pending field shows its value muted with `aria-busy="true"`, and the person may open and save other fields meanwhile.
- **Formula fields** are read-only text. An error field shows its tooltip when tapped. For writers, "Edit <column name> formula" opens the Edit formula sheet.
- **Add row** appends a card at the end of the list once the server answers, and moves focus to that card's first Edit button.
- **Delete row** on a card deletes that card's row at once, without a confirmation dialog. Focus moves to the next card's heading, or to Add row when no card follows.
- **Long press:** for writers, pressing and holding a card heading for 500 milliseconds, by touch or pointer, without moving more than 10 pixels, opens dialog "Row actions for <row display>" as a sheet. Focus is on its "Delete row".
  - "Delete row" closes the sheet and deletes that row exactly as the card's Delete row does, with the same focus result.
  - "Cancel" or Escape closes it and returns focus to the card heading.
  - A shorter press does nothing. For Viewers and read-only members a long press does nothing.

**Exports region.**

- **List:** the region lists the person's exports for the shown table, newest first. At 375 the list is in dialog "Exports". The list refreshes after every commit, on every table switch and on page load.
- **Downloading:** activating a "Download <file name>" link, by click or by Enter, asks the download route for the file. On a 200 the browser saves the received bytes under `<file name>`. Every answer, 200 or refusal, writes its matching copy from Feedback states to "Export status". Focus stays on the link.
- **Status ownership:** the "Export status" message belongs to the newest Export CSV press or Download activation of the shown table. It changes only when that press's own responses arrive.
- **One announcement per change:** an Export CSV press writes the writing copy once, at the press. When its answer arrives it writes the ready copy or the failed copy once. A download writes its one answer's copy once. A list refresh, commit, roll step or table switch writes nothing to "Export status", so each change is announced exactly once.
- **Progress indicator:** from an Export CSV press until its answer, progressbar "Export progress" shows, with no value, as stated in Motion and effects. It is removed when the answer arrives.
- **Per-table memory:**
  - Each table keeps its own message for as long as the page stays loaded. A list refresh, a commit or a table switch never rewrites it.
  - While another table is shown, "Export status" shows that table's own message. It is empty if that table has had no Export CSV press or Download activation since the page loaded.
  - Switching back to a table shows its message again, exactly as before the switch, without announcing it again.
- **Two quick presses:** two quick Export CSV presses create two exports. The status follows the second press, even if the first press's response arrives later.

**Freshness.** Other people's edits appear when the person opens a table, reloads the page, opens a Reference picker, re-reads after an access change or a 404, or gets a 409 for that cell, row, column or table. A change to the person's own role or row scope shows on their next request, as stated in Business rules.

### Visual design (DP-59, DP-40, DP-84)

- **Ground and ink:** a warm paper off-white page, with near-black ink for all text.
- **Rules:** warm grey-beige hairlines between every row and column and under the header. There are no shadows, cards float on nothing, and corners are square or nearly square. Sheets are paper-toned with a hairline along their top edge.
- **Accent:** one cobalt blue, used only for the focus outline, the active cell, range highlight, recalculation markers, the rolling digits and the export progress rule. Links and buttons are ink, and turn cobalt only when focused.
- **Errors:** burnt vermilion, for error cell values, error bars and field messages.
- **Type:**
  - Table names and page headings use a high-contrast editorial serif (Instrument Serif).
  - Body text and labels use a plain humanist sans (IBM Plex Sans).
  - Every number, count and Decimal uses a monospaced face (IBM Plex Mono), right-aligned so decimal points line up down each column.
  - Each heading level is about a fifth larger than the one below it.
- **Density:** compact. Grid rows are close to the height of one line of text plus a little breathing room, so the grid at 1280 is as dense as a spreadsheet.
- **Composition:** a paper-toned ledger.
  - A narrow left rail lists tables as serif headings with mono row counts.
  - The formula bar is a single ruled line above the grid.
  - The status bar is a thin ruled strip below the grid, and the deleted-row status is a ruled strip just above it.
- **Pending:** a pending cell's value shows in a muted grey ink until the server answers. That grey still meets 4.5:1 against the paper ground, and so does every grey label.
- **Touch:** at 375 every control is at least 44 by 44 pixels. This includes:
  - card Edit, Edit formula, Save, Cancel and Delete row buttons;
  - Switch table, Add row, Export CSV, Exports and Add column;
  - every control inside a sheet;
  - picker options, download links and Undo delete.
- **Contrast and focus:**
  - All text meets WCAG 2.2 AA contrast of 4.5:1 on the paper ground.
  - The cobalt changed bar, the vermilion error bar and the focus outline each meet 3:1 against the colours next to them.
  - The focus outline is at least two pixels wide, and every focusable element shows it.
- **Not colour alone:**
  - A refused field shows its message as text, a Lucide error icon inside the field, and `aria-invalid="true"`, never only a vermilion border.
  - Error cells read as errors without colour, because their text is the error string.
- **Icons:** Lucide only, always paired with visible text or an accessible name.

### Motion and effects (DP-45, DP-46, DP-47, DP-48, DP-74, DP-82, DP-93, DP-99)

All motion starts briskly and eases to a soft stop. Nothing loops and nothing moves for decoration: there is no idle shimmer, no pulsing and no animated background.

- Dialogs and menus at 768 and 1280 fade in and out in about a seventh of a second.
- The 375 drawer slides in from the left, and back out, in under a quarter of a second.
- **Sheets at 375:** slide up from the bottom edge in about a fifth of a second (200 milliseconds). While sliding, the sheet carries `data-entering="true"`. It loses the attribute when it reaches its place.
- **Leaving cards at 375:** a deleted card folds shut in about a fifth of a second (200 milliseconds). It carries `data-leaving="true"` while folding and is then removed.
- **Export progress:** progressbar "Export progress" is a thin cobalt rule that sweeps once from left to right over 1.2 seconds and then holds full until the answer arrives. It never restarts. It carries `data-motion="sweep"`.
- **Deleted-row status:** the status fades in and out in about a seventh of a second.

**Settle roll (signature).** After every successful commit, including a paste, a cleared range, an undo, a redo or a rename, the person sees which cells their change rippled into, across tables, in dependency order, and how many. Times below count from the moment the response is applied. Each cell's start is its depth × 60 milliseconds. `<last start>` is the greatest depth in the whole list × 60 milliseconds, counting cells that are off screen.

1. **Phases.** Every visible changed cell, gridcell or card field, carries `data-roll`:
   - `waiting` before its start, still showing its old display;
   - `rolling` from its start for 220 milliseconds, or 120 milliseconds for an error stamp;
   - `settled` from then on, showing its stored display.

   Depth 1 starts at 60 milliseconds, depth 2 at 120 and depth 3 at 180. Each depth has nearly settled before the next has gone far.
2. **Decimal digits.** Every Decimal display is rendered as one span per character, each with `data-char` holding its character. The cell's text is the spans' text in order.
   - While a cell rolls, the old and new displays are aligned on the decimal point.
   - A position differs when the characters differ there, or when the position exists in only one of the two displays. If the old display is blank or not a Decimal, every position differs.
   - Exactly the spans at differing positions carry `data-rolling="true"`. They roll their digit from old to new in cobalt and settle into ink. No other span carries `data-rolling`.
   - For example, `50.0000` to `52.0000` rolls one span, and `99.0000` to `101.0000` rolls the first three.
3. **Text, Date and Bool results** crossfade from old to new while rolling.
4. **Error results** do not roll. They stamp in vermilion, starting about 8 percent larger and settling to normal size, over their 120-millisecond rolling phase.
5. **Summary group rows** that appear fade in, and group rows that disappear fade out, on the same depth timing.
6. **Depth markers.** Every changed visible cell carries `data-recalc-depth` equal to its depth in the list. It keeps that attribute, and its `data-roll`, until the next successful commit, or until the table reloads for another reason.
7. **Rail badges.** Every rail entry for a table not on screen shows the changed badge with its number of cells in the list. The badge stays until that table is opened or until the next successful commit.
8. **Tally.** The status bar's count rises from 0 to the list length and never goes down. It takes min(600, `<last start>` + 220) milliseconds and ends on the recalculation sentence. The table count in the sentence shows its final value from the start. An empty list shows the sentence at once.
9. **Settled flag.** `data-settled` turns `"true"` at the later of two moments: the end of the tally, and the moment the last visible cell turns `settled`.
10. **Off-screen cells.** Cells scrolled out of view, and cells in tables not on screen, take their new value without animation and carry no `data-roll`.

For example, with the seed data at start, Mara has Orders on screen at 1280 by 800 and commits ORD-1001's Qty as `4.16`. The list holds five cells:

- at depth 1: Products Oak Shelf Bracket Units Ordered (`10.0000` to `10.1600`), Orders ORD-1001 Line Total (`50.0000` to `52.0000`) and Orders by Region North Sum of Qty (`17.0000` to `17.1600`);
- at depth 2: Products Oak Shelf Bracket Stock Left (`30.0000` to `29.8400`) and Orders by Region North Sum of Line Total (`271.1000` to `273.1000`).

The sentence is `Recalculated 5 cells in 3 tables.`. ORD-1001's Line Total is the only listed cell on screen:

- ORD-1001's Qty cell is the seed. It is not listed, carries no `data-roll`, and shows `4.1600` once the response is applied.
- ORD-1001's Line Total is `waiting` at 59 milliseconds, showing `50.0000`.
- It is `rolling` at 170 milliseconds, with exactly one span carrying `data-rolling`: the `0` before the point.
- It is `settled` from 280 milliseconds, showing `52.0000`.
- From the moment the response is applied, the rail links read `Products, 4 rows, 2 changed` and `Orders by Region, 2 rows, 2 changed`. Orders is on screen and shows no badge.
- `data-settled` is `"false"` at 339 milliseconds and `"true"` from 340, because the deepest listed cell, though off screen, is at depth 2.

**A new commit mid-roll.** When a commit's response is applied while an earlier roll is still playing, the following happens in the same frame:

- Every cell of the earlier roll shows its final value.
- Every earlier `data-recalc-depth`, `data-roll`, bar and badge is removed.
- The new list's markers and badges are set.
- The tally restarts from 0 for the new list.

No pending step of the earlier roll changes any text, marker, badge or sentence afterwards. A failed or refused commit plays nothing and leaves the earlier roll's state alone.

**Reduced motion.** When the person's system asks for reduced motion:

- Values swap instantly. Every changed cell is `data-roll` `settled` at once, and no roll, crossfade, stamp or fade plays.
- Each changed cell gets a static two-pixel cobalt bar along its left edge. Error cells get a two-pixel vermilion bar instead. The bars stay as long as the markers do.
- Rail badges and the full status sentence appear at once.
- The `data-recalc-depth` attributes and the live announcement are the same as with motion.
- Dialogs, menus, the drawer and the deleted-row status appear and disappear without movement.
- Sheets appear in place in their first frame and never carry `data-entering`.
- A deleted card is removed in the same frame and never carries `data-leaving`.
- "Export progress" shows full and still from its first frame, with `data-motion="static"`.

The app follows the system setting live, without a reload, and the next commit, sheet, card delete or export after a change uses the new mode. Anything moving when reduced motion turns on jumps to its end state in that same frame:

- a roll already playing ends, with the bars;
- a sliding sheet is in place and loses `data-entering`;
- a folding card is removed;
- a sweeping "Export progress" shows full and switches to `data-motion="static"`.

### Feedback states (DP-49, DP-50, DP-31, DP-27, DP-06, DP-09, DP-10, DP-32, DP-44, DP-63, DP-64, DP-65, DP-67, DP-70, DP-78, DP-82, DP-83, DP-85, DP-94, DP-96, DP-99)

Every string below is published copy. Render it character for character, with straight apostrophes and quotes, and announce it in the named region with the same characters.

Every announcement and status message first empties its region and then fills it within 100 milliseconds, so a message identical to the previous one is announced again. This applies to "Recalculation announcements", "Grid alerts", "Workspace status", "Formula announcements", "Deleted row", "Share status", "Mail outage" and "Export status". Each message is written once per event it reports.

**Sign-in**

| State | Copy and region |
|---|---|
| Pending | button "Sign in" is busy and disabled |
| Failure | the API's 401 message, in the sign-in alert |

**Workspace**

| State | Copy and region |
|---|---|
| Empty document | `This document has no tables yet.` |
| Empty table | `This table has no rows yet.` (grid area or card list) |
| Read-only notice | `You can view this document but not change it.` in the top bar note, and in "Grid alerts" for each write attempt in a read-only workspace |
| Picker no match | `No matching rows.` inside the open picker |
| Document created | `Created document <document name>.` in "Workspace status" |
| Table created | `Created table <table name>.` in "Workspace status" |
| Column added | `Added column <column name>.` in "Workspace status" |
| Summary created | `Created summary <summary name>.` in "Workspace status" |
| Cells copied | `Copied <n> cells.`, or `Copied 1 cell.`, in "Workspace status", after the clipboard write completes |
| Row deleted | `Deleted row <row display>.` in "Deleted row", next to button "Undo delete" |
| Row restored | `Restored row <row display>.` in "Workspace status" after Undo delete succeeds |

**Commits**

| State | Copy and region |
|---|---|
| Pending (any commit) | the status bar shows `Saving changes`, and the edited value is muted and busy. Nothing is announced. |
| Success | the status bar tally ends on the recalculation sentence from Business rules, announced once in "Recalculation announcements" |
| Field error | the API's field message under the editor or dialog field, also in "Grid alerts" |
| Cell conflict | `Someone else changed this cell. It now shows <current>. Your edit was not saved.` in the cell's conflict notice and in "Grid alerts". `<current>` is the cell's current display, or the word `blank` when it is empty. |
| Row conflict | `Someone else changed this row first. It was not deleted.` in "Grid alerts" |
| Row gone | `This row no longer exists. Your change was not saved.` in "Grid alerts" |
| Rows hidden | `<n> rows are no longer shown to you.`, or `1 row is no longer shown to you.`, in "Grid alerts" |
| Column conflict | `Someone else changed this column first. Your change was not saved.` in the open dialog and in "Grid alerts" |
| Table conflict | `Someone else renamed this table first. Your change was not saved.` in the open dialog and in "Grid alerts" |
| Circular result | `This change makes a formula depend on itself. Affected cells show #CIRC!.` in "Grid alerts". Sent whenever the applied list holds a cell whose new display is #CIRC! and whose old display was not. |
| Paste does not fit | `The pasted block does not fit here. Nothing was changed.` in "Grid alerts" |
| Undo or redo conflict | `This undo no longer applies because the cells changed since. Nothing was changed.` in "Grid alerts" |
| Empty stack | `Nothing to undo.` or `Nothing to redo.` in "Grid alerts", for the shortcut, the button, Undo delete, and the extra press of a double press |
| Permission lost | `You no longer have permission to change this document.` in "Grid alerts" |
| Connection or server failure | `Could not reach Tallyframe. Your last change was not saved.` in "Grid alerts" |

When a response carries both a circular result and a successful sentence, the sentence goes to "Recalculation announcements" and the circular copy goes to "Grid alerts".

**Error tooltips and formula diagnoses**

| State | Copy and region |
|---|---|
| Tooltip on a #DIV/0! cell | `#DIV/0! Division by zero.` |
| Tooltip on a #TYPE! cell | `#TYPE! A value has the wrong type for this operation.` |
| Tooltip on a #NAME? cell | `#NAME? This formula uses a name that does not exist.` |
| Tooltip on a #REF! cell | `#REF! This formula points at a row that was deleted.` |
| Tooltip on a #CIRC! cell | `#CIRC! This formula depends on itself.` |
| Preview result | `Result: <display>` in "Formula preview". A blank result shows `Result: ` followed by nothing. |
| Preview error | the matching error tooltip copy above, in "Formula preview" |
| Formula cannot be read | `Check the formula: it could not be read at character <n>.` |
| Formula ends early | `Check the formula: it ended too early.` |
| Formula too long | `Check the formula: use at most 2,000 characters.` |
| No rows to preview | `Add a row to see a preview.` in "Formula preview" |
| Empty formula textbox | "Formula preview" is empty |
| Settled preview | the same text as "Formula preview", in "Formula announcements", after the typing pause |

The three formula-reading copies show in "Formula preview" (from the preview's `diagnosis`). They are also the 422 field message for a formula on column create or update. `<n>` is defined in Business rules.

Each error cell and error card field carries `aria-describedby` pointing at its tooltip, a separate element in the overlay layer. The tooltip holds the copy above, and it is in the page whenever the cell is active or hovered, also while it is hidden by Escape. The gridcell's own text stays its display only.

**Sharing**

| State | Copy and region |
|---|---|
| Pending | button "Send invite" is busy and disabled |
| Invite sent | `Invite sent to <email>.` in "Share status". The same copy follows a successful Resend. |
| Mail outage | `Invite not sent: the mail server is unreachable. The share is saved. Press Resend when mail is back.` in "Mail outage", shown while any share in the list is Not sent |
| Resend still failing | `Still not sent: the mail server is unreachable. Try Resend again later.` in "Mail outage" |
| Already sent | `This invite was already sent.` in "Share status" |
| Field error | the API's field message under the Email field |

Further rules for the share dialog:

- The Invite sent copy names the address as stored. It is the same whether or not the address has an account.
- An Email field message sits in an element referenced by the textbox's `aria-describedby`. The textbox gets `aria-invalid="true"`, and focus returns to it. Both clear on the next input.
- "Mail outage" is removed in the same repaint in which the last Not sent share turns Sent.

**Exports**

| State | Copy and region |
|---|---|
| Writing | `Writing <file name>` in "Export status", with progressbar "Export progress" |
| Ready | `<file name> is ready.` in "Export status", plus link "Download <file name>" |
| Failed | `Export failed: the file could not be stored. Your edits are safe. Try again later.` in "Export status", with no link |
| Downloaded | `<file name> downloaded.` in "Export status" when a download answers 200 |
| Download not ready | `This file is not ready to download yet.` in "Export status" when a download answers 409 |
| Download store unreachable | `Download failed: the file store is unreachable. Try again later.` in "Export status" when a download answers 503 |
| Download refused | `This file no longer matches what was exported. Export again.` in "Export status" when a download answers 502 |

## Backend

### API (DP-01, DP-02, DP-03, DP-04, DP-06, DP-12, DP-13, DP-22, DP-25, DP-28, DP-32, DP-33, DP-63, DP-65, DP-71, DP-72, DP-81, DP-85, DP-87, DP-89, DP-92, DP-95, DP-97)

All routes live under `/api`. Every request body is `application/json`. Every response is `application/json; charset=utf-8`, except a successful CSV download. Ids are opaque strings made by the server. The session is a cookie named `tf_session`, HttpOnly and SameSite=Lax.

**Error shape.** Every error uses this one shape:

```json
{"error":{"code":"<code>","message":"<sentence>"}}
```

Some errors add fields inside `error`:

- **422:** adds `"fields":{"<field>":"<message>"}`, listing every invalid field of the request.
- **Cell stale-revision 409:** adds `"current":{"value":<value>,"display":"<display>","revision":<n>}`.
- **Paste stale-revision 409:** adds that same `current` for the first stale write. It also adds `"conflicts":[{"row_id","column_id","current":{"value","display","revision"}}]`, listing every stale write in request order.
- **Row stale-revision 409:** adds `"current":{"row":<row>}`.
- **Column stale-revision 409:** adds `"current":{"column":<column>}`.
- **Table stale-revision 409:** adds `"current":{"table":{"id","name","revision"}}`.
- **Undo or redo 409:** adds `"stacks":{"undo_count":<n>,"redo_count":<n>}`, the caller's stacks after the request.

Tests read `code`, `fields`, `current`, `conflicts` and `stacks`. `message` is free wording, except for sign-in.

**Error precedence.** One order covers the whole API:

1. Server-boundary checks, in the order given in Server boundary.
2. 401 `unauthenticated`.
3. 404 `not_found`. This covers:
   - an unknown document, or one not shared with the caller;
   - an unknown, deleted or hidden table, row, column, share or export named in the path, query or a paste write;
   - another person's export.
4. 403 `forbidden`: the caller's role may not take this action.
5. The idempotency step, on commit routes that carry an `Idempotency-Key`, as stated in Business rules:
   - a malformed key, or a key already stored for a different request, answers 422 `idempotency_key`;
   - a key stored for the same request replays its stored answer.
6. 409 state conflicts. Within this step, stale revisions come first, then the route's other 409s in the order its row lists them.
7. 422 `invalid`.
8. 503 for a provider that is unreachable.
9. 502 `export_corrupt` for a stored export that no longer matches its record.

A request with several faults answers the first matching step and changes nothing. For example:

- A cell write with a stale revision and an invalid value answers 409 `stale_revision`.
- A Viewer's write to an unknown table answers 404.
- An Editor's column rename carrying a stale revision answers 403.
- A Viewer's undo on an empty stack answers 403.
- A repeated cell write whose key is stored, sent by a member who has since become a Viewer, answers 403.
- The same repeat from an Editor replays the stored 200, even if the cell has changed since.
- A paste naming a hidden row and a stale cell answers 404.
- A paste with one stale cell and one invalid value answers 409, listing only the stale cell.
- A signed-out sign-out request with `Origin: null` answers 403 `cross_origin`.
- An Export CSV request with `Origin: http://other.example` and no session answers 403 `cross_origin`.

The tables below list only each route's own errors.

**Cells and rows.**

- A cell is `{"value":<value>,"display":"<text>","kind":"decimal|text|date|bool|reference|error|blank","revision":<n>}`.
- A blank cell has `"value":null`, `"display":""` and kind `blank`.
- Formula cells and summary cells have `"revision":null`.
- A row is `{"id":"<row id>","revision":<n>,"cells":{"<column id>":<cell>}}`. Summary rows have `"revision":null`.

**Columns.** A column is:

```json
{"id","name","type":"text|decimal|date|bool|reference|formula","formula":<string|null>,"target_table_id":<id|null>,"position":<n>,"revision":<n>}
```

**Recalculation object.** Every successful edit response, including paste, undo, redo, renames, table and summary creation, column adds and access updates, carries:

```json
{"cells":[{"table_id","row_id","column_id","old_display":<string|null>,"new_display":<string|null>,"new_kind","depth":<n>}],
 "count":<n>,"tables":<n>,"sentence":"<sentence>",
 "row_counts":{"<table id>":<n>},"column_counts":{"<table id>":<n>},
 "stacks":{"undo_count":<n>,"redo_count":<n>},
 "access":{"role":"owner|editor|viewer","row_scope":"all|own"},
 "document_revision":<n>}
```

- `row_counts` and `column_counts` list each table whose visible row count or column count the request changed, with the new count in the caller's view. A newly created table or summary is always listed in both.
- `stacks` is the caller's own stacks after the request.
- `access` is the caller's role and row scope as read for this request.
- `document_revision` is the document's revision after the request.
- The list's content and order are defined in Business rules.

**Idempotency-Key.** Every commit route accepts the optional request header `Idempotency-Key`. The commit routes are every route in the tables below that writes cells, rows, columns, tables, access or summaries, plus undo and redo.

- A key is 1 to 100 characters (100 is allowed), each a letter A to Z or a to z, a digit, `-` or `_`.
- A malformed key gets 422 with `"code":"idempotency_key"` and `"fields":{"idempotency_key":"Send a key of 1 to 100 letters, digits, hyphens or underscores."}`.
- A key reused for a different request gets the same code with the field message `This key was already used for a different change.`.
- A replayed answer carries the response header `Idempotent-Replayed: true`. Other answers do not carry it.

**Auth and documents**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| POST `/api/auth/sign-in` | `{"email","password"}` | 200 `{"user":{"id","email","display_name"}}`, and sets the cookie | 401 `{"error":{"code":"invalid_credentials","message":"Email or password is incorrect."}}`, byte-identical for an unknown email and a wrong password |
| POST `/api/auth/sign-out` | none | 204; the session ends | none |
| GET `/api/me` | none | 200 `{"user":{...}}` | none |
| GET `/api/documents` | none | 200 `{"documents":[{"id","name","role":"owner|editor|viewer"}]}`, by name | none |
| POST `/api/documents` | `{"name"}` | 201 `{"document":{"id","name","role":"owner"}}`, with no tables and revision 0 | 422 `name`: `Use 1 to 80 characters without line breaks or control characters.` |
| GET `/api/documents/<doc>` | none | 200 `{"document":{"id","name","role","row_scope":"all|own","revision","undo_count","redo_count"},"tables":[{"id","name","kind":"table|summary","revision","row_count","column_count","source_table_id"}]}`. Tables are in creation order, and counts are in the caller's view | none |
| GET `/api/documents/<doc>/history` | none | 200 `{"entries":[{"revision","kind","actor_id","table_id"}]}`, every entry in commit order, oldest first | none |

A document name is 1 to 80 characters (80 is allowed). It contains no line break and no control character (U+0000 to U+001F and U+007F to U+009F). Any Unicode letter is allowed, accented letters included.

**Tables, columns, rows and cells**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| POST `/api/documents/<doc>/tables` | `{"name"}` | 201 `{"table":{"id","name","kind":"table","revision":1,"owner_column_id":null,"columns":[],"rows":[]},"recalc":{...}}` | 422 `name` |
| GET `/api/documents/<doc>/tables/<table>` | none | 200 `{"table":{"id","name","kind","revision","owner_column_id","columns":[...],"rows":[...]},"access":{"role":"owner|editor|viewer","row_scope":"all|own"},"stacks":{"undo_count","redo_count"},"document_revision":<n>}`. Rows are the caller's visible rows in insertion order, with values in the caller's view | none |
| PATCH `/api/documents/<doc>/tables/<table>` | `{"name","revision"}` | 200 `{"table":{"id","name","revision"},"recalc":{...}}` | 409 `stale_revision` with `current.table`; 422 `name`; 422 `revision`: `Send the table's revision.`; 422 `table` for a summary |
| POST `.../tables/<table>/columns` | `{"name","type","target_table_id"?,"formula"?}` | 201 `{"column":{...},"recalc":{...}}` | 422 `name`, `type`, `target_table_id`, `formula` |
| PATCH `.../tables/<table>/columns/<col>` | `{"revision":<n>}` plus any of `"name"`, `"type"`, `"formula"` | 200 `{"column":{...},"recalc":{...}}` | 409 `stale_revision` with `current.column`; 422 as for create; 422 `revision`: `Send the column's revision.` |
| DELETE `.../tables/<table>/columns/<col>` | none | 200 `{"recalc":{...}}` | 409 `column_in_summary`; 409 `column_is_row_owner` |
| PUT `.../tables/<table>/access` | `{"owner_column_id":<Text column id or null>}` | 200 `{"table":{"id","owner_column_id"},"recalc":{...}}` | 422 `owner_column_id`: `Choose a Text column.` |
| POST `.../tables/<table>/rows` | `{"cells":{"<column id>":<value>}}` (may be empty) | 201 `{"row":{...},"recalc":{...}}`; the row goes at the end of insertion order | 422 per column id |
| DELETE `.../tables/<table>/rows/<row>?revision=<n>` | none | 200 `{"recalc":{...}}` | 409 `stale_revision` with `current.row`; 422 `revision`: `Send the row's revision.` |
| PUT `.../tables/<table>/rows/<row>/cells/<col>` | `{"value":<value>,"revision":<n>}` | 200 `{"cell":{...},"recalc":{...}}` | 409 `stale_revision` with `current`; 422 `value`, `revision` |
| POST `.../tables/<table>/cells` | `{"writes":[{"row_id","column_id","value","revision"}]}` | 200 `{"cells":[{"row_id","column_id","cell":{...}}],"recalc":{...}}`, cells in request order | 409 `stale_revision` with `current` and `conflicts`; 422 `writes`; 422 per write, keyed `"<row id>:<column id>"` |

**Table names:**

- 1 to 40 characters: letters A to Z or a to z, digits and underscores, starting with a letter. The message is `Use 1 to 40 letters, digits or underscores, starting with a letter.`.
- Unique in the document, ignoring case; a rename does not count the table itself. A duplicate gets `A table with this name already exists.`.
- Renaming a summary gets 422 `table`: `Summary names follow their source table and columns.`.

**Column names:**

- 1 to 60 characters, without `[` or `]`. The message is `Use 1 to 60 characters without square brackets.`.
- Unique in the table, ignoring case, not counting the column itself. A duplicate gets `A column with this name already exists.`.

**Column types:** a PATCH may change `type` only between text, decimal, date and bool. Any other change gets 422 `type`: `This column's type cannot be changed.`.

**Formulas on column create and PATCH:**

- `formula` is accepted only for Formula columns.
- If its very first character is an equals sign, that one character is removed before any other check. The rest is stored and returned byte for byte. So `=[Qty] * 2` and `[Qty] * 2` store the same text, and no response ever carries the removed equals sign.
- A formula that is too long, empty or unreadable gets 422 `formula` with the matching formula-reading copy from Feedback states, located as in Business rules.
- The preview endpoint handles these cases as stated below.

**Summary tables:** a write to any row, cell or column of a summary table, a paste included, gets 422 `table`: `Summary tables are calculated and cannot be edited.`.

**Revisions on writes:**

- A cell `revision` is required on cell writes and on each paste write. A missing one gets 422 `Send the cell's revision.`, under `revision` for a single write or under the write's key for a paste.
- The row delete's `revision` query value is required and must be a whole number.

**Paste limits:**

- `writes` holds 1 to 500 writes (500 is allowed). Any other count, or a write missing `row_id` or `column_id`, gets 422 `writes`: `Send 1 to 500 cell writes.`.
- A cell named twice gets 422 `writes`: `Each cell can be written once per paste.`.
- A paste is all or nothing: on any error, no cell changes.

**Undo, redo, summaries and preview**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| POST `/api/documents/<doc>/undo` | none | 200 `{"undone":{"kind":"cell_write|cell_batch|row_add|row_delete|column_add|column_update|column_delete|table_rename"},"recalc":{...}}` | 409 `nothing_to_undo`; 409 `undo_conflict` |
| POST `/api/documents/<doc>/redo` | none | 200 `{"redone":{"kind":...},"recalc":{...}}`, with the same kinds | 409 `nothing_to_redo`; 409 `undo_conflict` |
| POST `/api/documents/<doc>/summaries` | `{"source_table_id","group_by":[1 to 3 distinct column ids of the source table, in grouping order],"sum_columns":[0 to 5 Decimal or Formula column ids of the source table]}` | 201 `{"table":{...},"recalc":{...}}` with kind `summary` | 422 `source_table_id`, `group_by`, `sum_columns` |
| POST `.../tables/<table>/formula-preview` | `{"formula","row_id"}` (`row_id` required) | 200 `{"display":<string|null>,"kind":<kind|null>,"diagnosis":<string|null>}` | 422 `row_id`: `Choose a row in this table.` for a missing, unknown, hidden or deleted row |

The preview never saves anything and never answers 422 because of its `formula`. It removes one leading equals sign exactly as column saves do, then answers 200:

- **Unreadable formula:** if the formula is too long, empty or unreadable, the answer is `{"display":null,"kind":null,"diagnosis":"<formula-reading copy>"}`, located against the text as sent.
- **Error result:** a formula whose result is an error returns that error string as `display`, with kind `error` and its tooltip copy as `diagnosis`.
- **Any other result:** returns its display and kind with `"diagnosis":null`. A blank result's display is the empty string.

**Sharing and exports**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| GET `/api/documents/<doc>/shares` | none | 200 `{"shares":[<share>]}`, in share order | none |
| POST `/api/documents/<doc>/shares` | `{"email","role":"editor|viewer","row_scope":"all|own"}` | 201 for a new share, 200 for an address already shared: `{"share":{"id","email","role","row_scope","invite_status":"sent|not_sent"}}` | 422 `email`: `Enter a valid email address.` or `You already own this document.`; 422 `role`, `row_scope` |
| POST `/api/documents/<doc>/shares/<share>/resend` | none | 200 `{"share":{...}}`, with `invite_status` `sent` | 409 `invite_already_sent`; 503 `mail_unavailable` |
| POST `.../tables/<table>/exports` | none | 201 `{"export":<export>}`, with status `ready` or `failed` | none |
| GET `/api/documents/<doc>/exports` | none | 200 `{"exports":[<export>]}`: the caller's own, newest first | none |
| GET `/api/exports/<export>` | none | 200 `{"export":<export>}` | none |
| GET `/api/exports/<export>/download` | none | 200 `text/csv; charset=utf-8` with the `Content-Disposition` header stated under Download file name, and exactly the stored bytes | 409 `export_not_ready`; 503 `storage_unavailable`; 502 `export_corrupt` with the JSON error body only |

**Shares:**

- A share POST's status and body depend only on the request and the document's existing shares, never on whether the address has a Tallyframe account.
- Emails are stored and returned lower-cased.

**Valid email addresses:**

- At most 254 characters (254 is allowed).
- Exactly one `@`, with a non-empty part on each side.
- No whitespace, no control character, and none of `,` `;` `<` `>` `"` `(` `)`.

So an address carrying a line break, a tab or a space is refused with the email message above.

**Export records** have this shape:

```json
{"id","table_id","file_name":"<table name>.csv","status":"writing|ready|failed","byte_size":<n|null>,"sha256":<lowercase hex|null>,"download_url":<"/api/exports/<id>/download"|null>,"created_by":"<person id>","document_revision":<n>,"created_at"}
```

- `byte_size`, `sha256` and `download_url` are non-null only when the status is `ready`.
- `<table name>` is the table's name when the export was made, or the summary's name for a summary. A summary's name embeds column names, so `file_name` may hold any Unicode character a column name may hold.

**Download file name.** A successful download carries exactly one `Content-Disposition` header of the form:

```
attachment; filename="<ascii name>"; filename*=UTF-8''<encoded name>
```

- `<ascii name>` is `file_name` with every character that is not printable ASCII (U+0020 to U+007E), and every `"` and `\`, replaced by one underscore `_` per character.
- `<encoded name>` is `file_name` in UTF-8, with every byte percent-encoded as `%` and two uppercase hex digits, except the letters A to Z and a to z, the digits 0 to 9, and `!` `#` `$` `&` `+` `-` `.` `^` `_` `` ` `` `|` `~`, which stay as they are.
- The header is always plain ASCII on one line, whatever the column names hold, line breaks and control characters included.
- The browser saves the file under the name `filename*` gives, which equals `file_name`.

For example, with the seed data at start, the Orders by Region download carries `attachment; filename="Orders by Region.csv"; filename*=UTF-8''Orders%20by%20Region.csv`. A summary named `Orders by Café` gives `filename="Orders by Caf_.csv"; filename*=UTF-8''Orders%20by%20Caf%C3%A9.csv`.

**Health:** GET `/api/health` answers 200 `{"status":"ok"}` without a session, at all times.

### Business rules (DP-05, DP-07 to DP-24, DP-28, DP-29, DP-30, DP-32, DP-61 to DP-66, DP-68 to DP-70, DP-72, DP-77, DP-80, DP-81, DP-85 to DP-89, DP-92, DP-95)

**Roles.** A document's creator is its Owner. Shares make Editors and Viewers.

- An **Owner** may do everything.
- An **Editor** may write data cells, paste, add and delete rows, change the formula of an existing Formula column, undo and redo, read history, preview formulas and export.
- A **Viewer** may read, read history, preview formulas and export.

These actions are Owner-only, and Editors get 403 `forbidden` for them:

- creating and renaming tables;
- adding, renaming, retyping and deleting columns (an Editor PATCH that carries `name` or `type` is refused whole);
- creating summaries;
- setting the row owner;
- sharing.

A Viewer gets 403 `forbidden` on every write, and nothing changes: cell writes, pastes, row add and delete, column and table changes (formula changes included), undo, redo, access, summaries and shares. Hiding a button is never the only guard.

**Permission changes.** Role and row scope are read from the share on every request. They are never cached in the session or anywhere else. A share POST that changes a member's role or row scope applies to that member's very next request, in every session they already hold, without signing in again.

- A member moved to Viewer keeps their undo and redo stacks, but undo and redo answer 403 while they are a Viewer. The stacks become usable again if they are made an Editor again.
- A member moved from `own` to `all` sees every row on their next read. This covers table reads, previews, summary groups, rail counts and exports. Moving them back to `own` hides those rows again on their next request, and a write to a now-hidden row answers 404.

For example, with the seed data at start, after Mara moves Dev to `all`, Dev's next Orders read has 5 rows, both summary groups show, and Dev's preview of `COUNT(Orders)` is `5.0000`.

**Row access.** A table may name one Text column as its row owner. A member shared with row scope `own` sees, in every such table, only the rows whose owner cell equals their email, ignoring case and surrounding spaces. Owners, and members with scope `all`, see every row.

A hidden row does not exist for that member:

- It is absent from the table read and the Reference picker.
- It answers 404 to cell writes, paste writes and deletes, and 422 `row_id` to previews.
- A Reference to it displays blank and reads as blank through traversals.
- It is left out of row counts, every aggregate function, summary groups, the recalculation list and that member's exports.

The member's aggregates, and everything that depends on them, are computed from their visible rows only. Stored values are the unrestricted values. For example, with the seed data at start, Dev sees Units Ordered `4.0000` for Oak Shelf Bracket, where Mara sees `10.0000`.

**Request-scoped views.** Every restricted view is computed inside the caller's own request, by the same evaluator, from the stored values as of that request's point in the edit order. This covers the caller's values, aggregates, summary groups, row and column counts, recalculation list, sentence, access and export. No cache, memo or shared variable carries one person's view into another person's response, even when requests from several people interleave.

- A recalculation list returned for a member's own edit never names a hidden row, a hidden summary group, or a table in which the member has no visible changed cell.
- `tables` counts only tables with a visible changed cell.

For example, with the seed data at start, while Mara's Price edits run in parallel with Dev's reads:

- every Dev Products read shows Units Ordered from Dev's three orders only;
- every Dev Orders by Region read holds the North group only;
- every Dev `COUNT(Orders)` preview is `3.0000`.

**Rows under own-row scope.** When a member with scope `own` adds a row to a table that has a row owner, the owner cell is set to their email. Writing any other value to an owner cell gets 422 with `You can only assign rows to yourself.`. This applies at creation, later, and by paste or clear. A member may write a Reference only to a row they can see. Any other id gets the Reference 422 below.

**Typed values.** Writes accept these values. For every type, `null` or an empty string is blank.

| Type | Accepts | Stored and displayed as | 422 message |
|---|---|---|---|
| Text | a JSON string up to 10,000 characters (10,000 is allowed). Any other JSON type is rejected | as typed | `Text can be at most 10,000 characters.` for a long string; `Enter text.` for a non-string |
| Decimal | a JSON number without an exponent, or a string `-?digits[.digits]`, either with at most 15 digits before the point | value: a string rounded half away from zero to exactly 4 decimal places. Display: the same string | `Enter a number with up to 15 digits before the decimal point.` |
| Date | a string `YYYY-MM-DD` naming a real calendar date from 0001-01-01 to 9999-12-31 | the same string | `Enter a date as YYYY-MM-DD.` |
| Bool | JSON `true` or `false`, or the string `true` or `false` in any letter case | value: a JSON boolean. Display: `TRUE` or `FALSE` | `Enter true or false.` |
| Reference | the row id of a visible, undeleted row in the target table | value: the row id. Display: that row's first-column display | `Choose a row from <target table name>.` |

**Exact decimals.** A Decimal is read from its exact decimal characters.

- A JSON number is taken from its characters in the request body and is never converted through binary floating point. The same holds inside paste writes and row creation.
- Rounding is half away from zero to 4 places.
- A result that rounds to zero is `0.0000`, never `-0.0000`.
- Any exponent form is rejected with the Decimal message: JSON `1e3`, and strings such as `"1e3"` or `"1E-2"`.

For example:

| Written | Stored |
|---|---|
| `1.00005` | `1.0001` |
| `0.00005` | `0.0001` |
| `-1.00005` | `-1.0001` |
| `-0.00004` (as a number or a string) | `0.0000` |
| `12.5` | `12.5000` |

A Formula cell cannot be written. A write to one gets 422 with `Formula cells are calculated. Edit the column formula instead.`. A table's first column by position is its display column.

**Type changes.** When a data column changes type, each non-blank cell is converted from its old display text. Surrounding spaces are trimmed, and the text is read by the new type's string rule above. A value that reads as the new type is stored in its canonical form, and every other value becomes blank.

- A change to Text keeps each display exactly (`12.5000`, `TRUE` or `FALSE`, `2026-03-14`).
- A change from Text to Bool turns `true`, `True` or `TRUE` into `TRUE`.
- A change between Decimal, Date and Bool blanks every non-blank value, because no display of one type reads as another.
- Every converted or blanked cell's revision rises by one, and so does its row's revision.
- Undo restores the old type, values and displays.

**Formula language.** A Formula column holds one formula, stored without a leading equals sign and evaluated for every row.

- **Tokens:** a formula is read as a sequence of tokens. Spaces, tabs, CR and LF between tokens are ignored. The tokens are:
  - decimal numbers: one or more digits 0 to 9, optionally followed by a point and one or more digits, with no exponent (`12`, `12.5`);
  - strings in double quotes, where a doubled quote stands for a quote character;
  - bracketed names `[...]`, holding one or more characters other than `[` and `]`;
  - plain names: a letter A to Z or a to z, followed by any number of letters A to Z or a to z, digits 0 to 9 and underscores;
  - the operators below, `(`, `)`, `,` and the point `.` that joins a name to a following `[`.

  No other character starts a token. In particular, accented and other non-ASCII letters may appear only inside strings and bracketed names.
- **Plain names** are read in this order:
  1. A plain name immediately followed by `(` is a function name. Function names match ignoring case.
  2. Otherwise a plain name equal to `TRUE` or `FALSE`, ignoring case, is a Bool literal. So `true` and `False` read as TRUE and FALSE.
  3. Otherwise a plain name is a table name. Table names match ignoring case.
- **Same-row reads:** `[Column]` reads the same row's cell. Column names match ignoring case. A bare Reference column reads as its display, which is Text.
- **Traversals:** `[Ref].[Column]` follows a Reference column to the target row and reads its cell there.
  - Traversals may chain, as in `[Ref].[Ref2].[Column]`.
  - Following a blank Reference reads blank.
  - Following a Reference that is #REF! gives #REF!.
- **Where a table name may appear:** a table name is allowed in exactly two places:
  - on its own as the whole argument of COUNT, naming that table;
  - as `Table.[Column]`, naming a whole column, forming the whole argument of SUM, MIN, MAX, AVERAGE or COUNTBY, or either whole argument of SUMBY.

  Anywhere else, a table name, on its own or followed by `.[Column]`, makes the formula unreadable at the table name's first character. This holds whether or not the name matches a table in the document, so `Foo + 1` and `Orders + 1` are both unreadable. In its two allowed places, a table name that matches no table evaluates to #NAME?, and so does a column name that matches no column of that table. Any other expression in those argument places is readable and evaluates to #TYPE!, so `SUM([Qty])` and `COUNT([Qty])` give #TYPE!.
- **Operators,** from tightest to loosest. All group left to right, and parentheses group.
  1. unary minus
  2. `*` and `/`
  3. `+` and `-`
  4. `&` (text join)
  5. `=`, `<>`, `<`, `>`, `<=` and `>=`, which give a Bool
- **Arithmetic** needs Decimal or blank operands, apart from date arithmetic; anything else gives #TYPE!.
  - Blank counts as the Decimal `0`.
  - Arithmetic is exact decimal arithmetic, and division is carried to at least 20 significant digits.
  - Only a cell's final Decimal result is rounded half away from zero to 4 places. So `10/3` gives `3.3333` and `2/3` gives `0.6667`, while `0 * -1` and `-0.00001 + 0` both give `0.0000`.
- **Date arithmetic** treats dates as plain calendar days, with no time of day and no time zone.
  - `Date - Date` gives the Decimal number of days between them.
  - `Date + Decimal`, `Decimal + Date` and `Date - Decimal` give a Date. The Decimal must be a whole number, otherwise the result is #TYPE!.
  - A Date result outside 0001-01-01 to 9999-12-31 gives #TYPE!.
  - `Decimal - Date`, `Date + Date`, unary minus on a Date, and `*` or `/` with a Date operand give #TYPE!.
- **Text join (`&`)** turns each operand into its display text and gives Text:
  - a Decimal becomes its 4-place display, so `[Price] & " each"` gives `12.5000 each` for Oak Shelf Bracket;
  - a Bool becomes `TRUE` or `FALSE`;
  - a Date becomes `YYYY-MM-DD`;
  - Text stays as it is;
  - blank becomes an empty string.
- **Comparisons** need two operands of the same type, after the blank rules below. Any other pairing gives #TYPE!.
  - Decimal against Decimal compares by value.
  - Text against Text compares exactly, character by character by Unicode code point, so it is case-sensitive: `"oak" = "Oak"` is FALSE and `"B" < "a"` is TRUE.
  - Date against Date compares in calendar order.
  - Bool against Bool: FALSE is less than TRUE.
  - Blank counts as `0` against a Decimal, as an empty string against Text, and as FALSE against a Bool. Against a Date it counts as earlier than every date. Blank equals blank.

**Reading a formula.** A formula is read after the optional leading equals sign is removed. The text must be 1 to 2,000 code points long (2,000 is allowed). Longer text gets the too-long copy. Otherwise it is read from left to right, and the first problem found decides the diagnosis.

These problems give the could-not-be-read copy, at the position named:

| Problem | Position |
|---|---|
| a string with no closing quote | its opening quote |
| a `[` with no closing `]` | the `[` |
| a `)` with no matching `(` | the `)` |
| a character no token starts with | that character |
| a point followed by neither a digit nor `[` | the point |
| a token the grammar cannot accept at that place | the token's first character |
| a table name, on its own or as `Table.[Column]`, outside the two allowed places | the table name's first character |

Reaching the end of the text while the formula is still incomplete gives the ended-too-early copy. Empty text counts as incomplete.

`<n>` is the problem's 1-based position counted in Unicode code points in the text as sent, so a leading equals sign is counted. For example:

| Formula as sent | Diagnosis |
|---|---|
| `1e3` | at character 2 |
| `=1e3` | at character 3 |
| `[Qty] * * 2` | at character 9 |
| `[Qty] * 2)` | at character 10 |
| `[Qty] & "each` | at character 9 |
| `[Qty` | at character 1 |
| `[Qty] # 2` | at character 7 |
| `5. + 1` | at character 2 |
| `"é" & é` | at character 7 |
| `Orders` | at character 1 |
| `Foo + 1` | at character 1 |
| `Foo.[Qty] + 1` | at character 1 |
| `=Orders.[Qty] + 1` | at character 2 |
| `SUM(Orders.[Qty] + 1)` | at character 5 |
| `[Qty] *` | ended too early |
| `SUM(` | ended too early |
| `SUM(Orders.[Qty]` | ended too early |
| `=` | ended too early |

An unknown function, table or column that is otherwise readable is not a reading problem. It evaluates to #NAME?. For example, `SUM(Foo.[Qty])`, `COUNT(Foo)`, `[Nope] + 1` and `FOO(1)` each give #NAME?, and `true` gives `TRUE`.

**Functions.** A wrong number of arguments gives #TYPE!, and an unknown function gives #NAME?. Every aggregate reads only the caller's visible, undeleted rows. When an aggregated column holds errors, the result is the error of the first such row in insertion order, before any type check.

- `SUM(T.[C])`: the sum of C. Blank counts as zero, and any other non-Decimal value gives #TYPE!.
- `COUNT(T)`: the number of rows, as a Decimal.
- `SUMBY(T.[C], T.[R])`: the sum of C over the rows whose Reference R points at the current row.
  - R must be a Reference to the formula's own table, otherwise the result is #TYPE!.
  - With no matching rows the result is `0.0000`.
- `COUNTBY(T.[R])`: the number of such rows, as a Decimal.
- `MIN(T.[C])` and `MAX(T.[C])`: the smallest or largest non-blank Decimal. Blanks are ignored, and with no non-blank value the result is blank. A non-blank value that is not a Decimal gives #TYPE!.
- `AVERAGE(T.[C])`: the sum of the non-blank values divided by their count, carried to at least 20 significant digits, then rounded.
  - Blanks are ignored, and with no non-blank value the result is #DIV/0!.
  - A non-blank value that is not a Decimal gives #TYPE!.
- `ROUND(x, n)`: x must be a Decimal or blank, and blank counts as `0`. n must be a whole Decimal from 0 to 4. Anything else gives #TYPE!.
  - The result is x rounded half away from zero to n places, shown with 4 places.
  - So `ROUND(2.345, 2)` gives `2.3500`, `ROUND(-2.345, 2)` gives `-2.3500`, and `ROUND(10/3, 2)` gives `3.3300`.
- `IF(cond, a, b)`: cond must be a Bool, or blank, which counts as FALSE. Anything else gives #TYPE!. Only the chosen branch is evaluated.
- `IFERROR(x, fallback)`: gives fallback when x is #DIV/0!, #TYPE!, #NAME? or #REF!, and gives x otherwise. It never catches #CIRC!. fallback is evaluated only when it is used.

For example, with the seed data at start, Dev's preview of `MAX(Orders.[Qty])` is `10.0000`, and Dev's preview of `AVERAGE(Orders.[Qty])` is `5.6667`.

**Error values.** The five error values are exactly `#DIV/0!`, `#TYPE!`, `#NAME?`, `#REF!` and `#CIRC!`.

| Error | When |
|---|---|
| `#DIV/0!` | division by zero or by blank, or AVERAGE of no values |
| `#TYPE!` | an operand or argument of the wrong type, a wrong number of arguments, or a date out of range |
| `#NAME?` | an unknown column, table or function |
| `#REF!` | following a Reference whose row was deleted |
| `#CIRC!` | the cell lies on a cycle or depends on one |

- An operation with an error operand gives that error, except as IF and IFERROR state. With several error operands it gives the leftmost one.
- Error values store and display as their exact string, with kind `error`.
- Saving a formula never fails because of an error value. Only the formula text rules reject a formula.

**Cycles.**

- **Dependencies:** a formula depends on every name its text mentions, in every branch, whether or not that branch is chosen. Names that do not resolve add no dependency.
- **Cycle cells:** every cell that lies on a cycle is #CIRC!, and so is every cell that depends on a cycle cell, IFERROR included. This holds whatever else the formula would give, #NAME? and #REF! included.
- **Cycle shapes:** a cycle may run through one formula (`[A] + 1` in column A) or through several, across columns and tables.
- **Saving:** a formula change that creates a cycle saves with 200. Every cell outside the cycle and its dependents keeps computing normally.
- **Breaking a cycle:** a later change that breaks the cycle recomputes the former cycle cells normally, in that same request.

**Dependencies and recalculation.** A cell depends on:

- the same-row cells its formula reads;
- each Reference cell it follows, and the cell it reads in the target row;
- every cell of each aggregated column, and the table's set of visible rows.

A Reference cell's display depends on its target row's display-column cell. A summary cell depends on the group-by and sum cells of the source rows in its group.

Every edit, paste, rename, undo and redo recomputes every affected cell across all tables and summaries. It does so in the same database transaction as the edit, together with the edit's history entry and idempotency record, or not at all. Cells are evaluated in topological order, each exactly once per request.

**One edit at a time.** Edits to one document apply one at a time, in a single order, across every app instance. A concurrent request waits, then sees the result of the one before it. So the response, a later table read, a later history read and a later export always agree.

- When parallel requests write different cells that feed the same aggregate cell, that cell's entries across the responses form one chain:
  - each entry's `old_display` is either the value before the first request or the `new_display` of exactly one other response;
  - the last `new_display` in the chain equals a fresh read.
- Parallel row adds to one table each take a distinct insertion position. Their `row_counts` values for that table are all different, and together they run from the starting count plus 1 to the starting count plus N.

**Idempotent commits.** A commit that carries an `Idempotency-Key` is remembered per person, document and key. Its record is written in the edit's own transaction and kept for 24 hours. The `IDEMPOTENCY_TTL_SECONDS` environment variable, default 86,400, overrides that.

- **Storing:** only 2xx answers are stored, as their exact status and body bytes. An error answer is not stored and leaves the key unused, so a later request with that key is evaluated afresh.
- **Replaying:** a request with a stored key and the same method, path, query and body bytes replays the stored status and body byte for byte, with `Idempotent-Replayed: true`.
  - The replay adds no revision, history entry, undo entry or email.
  - Permissions are checked again before any replay, at the 403 step of the precedence.
- **Reusing for a different request:** the same key with a different method, path, query or body answers 422 `idempotency_key`, and changes nothing.
- **Duplicates in flight:** a request whose key is in flight on any instance waits for the first to finish. It then replays the stored answer, or, if the first ended in an error, is evaluated afresh. An edit never applies twice for one key.

For example, two identical cell writes with one key return two identical bodies. The document revision rises by one and the history gains one entry. Undo sent twice with one key lowers `undo_count` by exactly one.

**Document revision and history.**

- Every document has a revision, starting at 0. Every request that commits an edit raises it by exactly one and appends one history entry carrying the new revision.
- Committing edits are cell writes, pastes, row adds and deletes, column adds, updates and deletes, table creation, table rename, summary creation, access changes, undo and redo.
- An entry's `kind` is one of `cell_write`, `cell_batch`, `row_add`, `row_delete`, `column_add`, `column_update`, `column_delete`, `table_add`, `table_rename`, `summary_add`, `access_update`, `undo` and `redo`.
- `actor_id` is the person's id. `table_id` is the table the edit touched: the new table or summary for creations, and the undone entry's table for undo and redo.
- A request that answers an error, and a replay, commits nothing and adds no entry. Shares and exports are not edits.
- History entries carry no cell values, so every member may read them.
- A refused request leaves the revision unchanged, so revisions have no gaps and the entries are in commit order.

**Recalculation list.** Every cell an edit touches falls into one of three kinds.

**Seed cells** have depth 0 and are never listed. They are the cells the person's action writes, creates or removes outright:

- the written cell of a cell write, and every written cell of a paste or cleared range;
- the data cells of a new or restored row;
- every cell, data and formula, of a deleted row;
- every cell of a deleted or restored column;
- every cell of a newly added Text, Decimal, Date, Bool or Reference column, all blank.

**Direct cells** have depth 1. They are cells the edit changes by rule rather than through a formula:

- every cell of a Formula column that is added, or whose formula changes or is rewritten by a column or table rename;
- every cell of every group row of a newly created summary;
- every data cell converted or blanked by a type change;
- every Reference cell that turns #REF! because its row was deleted;
- every Reference cell that an undo or redo points back at a restored row;
- every formula cell that was #NAME? because it named a column or table that does not exist, when a column add or a rename makes that name exist.

**Affected cells** are formula cells, summary cells and Reference displays that the request recomputes because one of their direct inputs is a seed cell, a direct cell or a changed affected cell.

- An affected cell is changed when its display or kind differs from before the edit, or when it newly exists.
- A recomputed cell that comes out the same is unchanged. It is not listed and does not count as an input for depth.
- A changed affected cell's depth is one more than the greatest depth among its direct inputs that are seed cells, direct cells or changed affected cells.

**Cycle depth:** the cells of one cycle share one depth. It is 1 if any of them is a direct cell. Otherwise it is one more than the greatest depth among their inputs outside the cycle that are seed, direct or changed affected cells. Cells that depend on the cycle take their depths from it in the usual way.

**Undo and redo** classify cells by the edit they apply:

- undoing a cell write or a paste writes those cells;
- undoing a row add deletes a row, and undoing a row delete restores one;
- undoing a column or table update changes that column or table again;
- undoing a column add deletes the column, and undoing a column delete restores it.

**Listing rules:**

- The list holds every direct cell and changed affected cell whose display or kind changed.
- Cells that newly exist are listed with `old_display` null: a new or restored row's formula cells, a new Formula column's cells, and a new summary group's cells, a new summary's included.
- Cells of a summary group that disappears are listed with `new_display` null.
- Order: by depth, then by table creation order in the document, then by row insertion order (group order for summaries), then by column position.
- `count` is the list length, and `tables` is the number of distinct tables in it, both in the caller's view.
- The sentence is `Recalculated <count> cells in <tables> tables.`, with `cell` when count is 1 and `table` when tables is 1. For example, `Recalculated 1 cell in 1 table.` or `Recalculated 0 cells in 0 tables.`.

**Lists for edits that add structure or change access.**

- **Creating a table:** the list is empty, `count` and `tables` are 0, and the sentence is `Recalculated 0 cells in 0 tables.`. `row_counts` and `column_counts` give the new table 0.
- **Adding a Text, Decimal, Date, Bool or Reference column:** its blank cells are seeds and are never listed. Only formulas that now resolve, and their changed dependents, are listed, so the list is usually empty. `column_counts` gives the table its new count.
- **Adding a Formula column:** its cells are direct cells, listed with `old_display` null, as above.
- **Creating a summary:** every cell of every group row is listed at depth 1 with `old_display` null, in group order, then by column position. `row_counts` gives the summary its number of groups, and `column_counts` its number of columns.
- **Setting or clearing a table's row owner:** only the Owner can do this, and the Owner sees every row, so the list is empty and the sentence is `Recalculated 0 cells in 0 tables.`. Members whose view changes see it on their next read.

For example, with the seed data at start, Mara creates a summary of Orders grouped by Customer with the sum of Qty. The list holds nine cells at depth 1, with `old_display` null:

| # | Group | Column | New display |
|---|---|---|---|
| 1 | Pell & Daughters Catering | Customer | `Pell & Daughters Catering` |
| 2 | Pell & Daughters Catering | Count | `2.0000` |
| 3 | Pell & Daughters Catering | Sum of Qty | `7.0000` |
| 4 | Greyfield Installers, Ltd | Customer | `Greyfield Installers, Ltd` |
| 5 | Greyfield Installers, Ltd | Count | `2.0000` |
| 6 | Greyfield Installers, Ltd | Sum of Qty | `8.0000` |
| 7 | Moss Street Bakery | Customer | `Moss Street Bakery` |
| 8 | Moss Street Bakery | Count | `1.0000` |
| 9 | Moss Street Bakery | Sum of Qty | `10.0000` |

The sentence is `Recalculated 9 cells in 1 table.`, and `row_counts` gives the summary 3.

**Example: a price change.** With the seed data at start, Mara sets Oak Shelf Bracket's Price to `13`. The list, in order:

| # | Cell | New display | Depth |
|---|---|---|---|
| 1 | Orders ORD-1001 Line Total | `52.0000` | 1 |
| 2 | Orders ORD-1004 Line Total | `78.0000` | 1 |
| 3 | Orders by Region North Sum of Line Total | `273.1000` | 2 |
| 4 | Orders by Region South Sum of Line Total | `214.0000` | 2 |

The sentence is `Recalculated 4 cells in 2 tables.`. The same edit by Dev lists only ORD-1001 and North, with the sentence `Recalculated 2 cells in 2 tables.`.

**Example: deleting a product.** With the seed data at start, Priya deletes the Oak Shelf Bracket row in Products. The row's own cells are seeds. The list, in order:

| # | Cell | Change | Depth |
|---|---|---|---|
| 1 | Orders ORD-1001 Product | `Oak Shelf Bracket` to `#REF!` | 1 |
| 2 | Orders ORD-1004 Product | `Oak Shelf Bracket` to `#REF!` | 1 |
| 3 | Orders ORD-1001 Line Total | `50.0000` to `#REF!` | 2 |
| 4 | Orders ORD-1004 Line Total | `75.0000` to `#REF!` | 2 |
| 5 | Orders by Region North Sum of Line Total | `271.1000` to `#REF!` | 3 |
| 6 | Orders by Region South Sum of Line Total | `211.0000` to `#REF!` | 3 |

The sentence is `Recalculated 6 cells in 2 tables.`, and `row_counts` gives Products 3. The other products' Units Ordered and Stock Left are recomputed, come out the same, and are not listed.

**Example: undoing that delete.** When Priya then presses Undo, the restored row's data cells are seeds. The list, in order:

| # | Cell | Change | Depth |
|---|---|---|---|
| 1 | Orders ORD-1001 Product | `#REF!` to `Oak Shelf Bracket` | 1 |
| 2 | Orders ORD-1004 Product | `#REF!` to `Oak Shelf Bracket` | 1 |
| 3 | Products Oak Shelf Bracket Units Ordered | null to `10.0000` | 2 |
| 4 | Orders ORD-1001 Line Total | `#REF!` to `50.0000` | 2 |
| 5 | Orders ORD-1004 Line Total | `#REF!` to `75.0000` | 2 |
| 6 | Products Oak Shelf Bracket Stock Left | null to `30.0000` | 3 |
| 7 | Orders by Region North Sum of Line Total | `#REF!` to `271.1000` | 3 |
| 8 | Orders by Region South Sum of Line Total | `#REF!` to `211.0000` | 3 |

The sentence is `Recalculated 8 cells in 3 tables.`, and `row_counts` gives Products 4.

**Example: making and breaking a cycle.** With the seed data at start:

1. Mara adds a Formula column `A` to Products with formula `[B] + 1`. Its four cells are `#NAME?`.
2. She adds a Formula column `B` with formula `[A] + 1`. The list holds eight depth-1 entries, row by row: each row's A goes from `#NAME?` to `#CIRC!`, then that row's B goes from null to `#CIRC!`. The sentence is `Recalculated 8 cells in 1 table.`, and the circular copy is sent.
3. She changes B's formula to `5`. The list holds the four B cells, `#CIRC!` to `5.0000`, at depth 1, then the four A cells, `#CIRC!` to `6.0000`, at depth 2. The sentence is `Recalculated 8 cells in 1 table.`.

**Paste and clear.**

- A paste writes every listed cell, or none. It runs in one transaction with one recalculation, in which each dependent cell is evaluated and listed once.
- Each write is checked as a single cell write would be.
- If any write is stale, the answer is the paste 409 listing every stale write, and nothing changes.
- A paste is one undo entry, of kind `cell_batch`. Clearing a range is a paste of blanks.
- Undoing a paste applies under the same rule as any other undo entry, below.

**Summary tables.**

- **Name:** `<source table name> by <group column names joined with " and ">`, in grouping order.
- **Columns:**
  - first the group columns, in grouping order, with ids equal to the source column ids;
  - then `count`, named `Count`;
  - then one `sum:<source column id>` per sum column, named `Sum of <column name>`, in source column position order.

  Count and the Sums are Decimals.
- **Group keys:** each group column contributes one key part, computed in the viewer's view.
  - A Reference keys on the target row id, so two customers with the same Name form two group rows showing the same display.
  - A Reference showing #REF!, like any error value, keys on the error string, so all #REF! cells form one group.
  - A Decimal keys on its canonical display, so `5` and `5.0000` are one group.
  - Text, Date and Bool key on their display.
  - Blank forms its own group.
- **Group cells:** each group cell shows the same value and display as the source cells of its group.
- **Group rows:** there is one group row per distinct key among the viewer's visible source rows, ordered by each group's first row in insertion order.
  - The same key always has the same group row id in that summary, also when a key disappears and later returns.
  - A group row exists exactly while it has at least one row. It appears and disappears in the same request as the row change that causes it.
- **Sums** follow the SUM rule, errors included.

**Column rename.** Renaming a column rewrites every formula in the document that names it. Name tokens match ignoring case. The rewritten tokens are:

- `[Old]` in formulas of the column's own table;
- `[X].[Old]` at any link of a traversal chain whose preceding Reference targets the column's table. A chain whose earlier link does not resolve is left as written;
- `T.[Old]` inside an aggregate argument, where `T` names the column's table.

What changes and what stays:

- Each rewritten token's bracketed name becomes the new name exactly as given.
- Every other character of the formula keeps its bytes: spacing, function-name case, table-name case and string literals. So `"[Price]"` stays as written.
- A same-named column in another table is never touched. Renaming Products Price leaves `[Customer].[Price]` as written.
- Summary names, and every `Sum of <name>` column name, follow the rename.
- The renamed column's revision rises by one, and so does the revision of each Formula column whose text was rewritten.

A rename changes no cell display, with one exception: formulas that were #NAME? because they named the new name now resolve. Those cells are direct cells, and their dependents follow the usual list rules. Undo restores the old name, every rewritten formula text and every summary name byte for byte, and the resolved cells return to #NAME?.

For example, with the seed data at start:

- Renaming Products Price to `Unit Price` makes Line Total's formula exactly `[Qty] * [Product].[Unit Price]`. Price and Line Total each go to revision 2, and the list is empty.
- Renaming Orders Qty to `Quantity` makes the formulas `SUMBY(Orders.[Quantity], Orders.[Product])` and `[Quantity] * [Product].[Price]`, and turns the summary column `Sum of Qty` into `Sum of Quantity`.

**Table rename.** Renaming a table rewrites every formula in the document that names it. Table tokens match ignoring case.

- Every `T` of a `T.[Column]` aggregate argument, and every `T` of `COUNT(T)`, becomes the new name exactly as given. Every other character keeps its bytes, string literals included.
- Every summary whose source is that table is renamed with the new source name.
- The table's revision rises by one, and so does each rewritten Formula column's revision.
- Formulas that were #NAME? because they named the new name now resolve, as direct cells.
- New exports use the new name in their file name.
- One Undo restores the table name, every rewritten text and every summary name.

For example, with the seed data at start, renaming Orders to `Sales` makes Units Ordered `SUMBY(Sales.[Qty], Sales.[Product])` and the summary `Sales by Region`.

**Row and column deletion.**

- **Deleting a row** removes its cells.
  - Every Reference cell that pointed at it becomes #REF!, with kind `error`, and that cell's revision and its row's revision rise by one.
  - Formulas that follow those references become #REF!, and aggregates recompute.
- **A deleted row is gone everywhere until undone:**
  - its id is absent from table reads and from the Reference picker;
  - cell writes, paste writes and deletes on it answer 404;
  - a Reference write to it gets the Reference 422, and a preview naming it gets 422 `row_id`;
  - it is left out of every aggregate, summary group, rail count and new export;
  - exports made before the delete keep their stored bytes.
- **Deleting a column** removes it and its values. Formula text is kept as written, so every formula that names the column becomes #NAME?.
- **Protected columns:**
  - Deleting a column used by a summary gets 409 `column_in_summary`.
  - Deleting the table's row-owner column gets 409 `column_is_row_owner`.
  - When both apply, `column_in_summary` is answered.

**Undo and redo.**

- **Stacks:** each person has their own undo and redo stacks per document, holding their last 50 edits. A 51st edit drops their oldest entry.
- **Undoable edits:** a cell write, a paste or cleared range (one entry), a row add, a row delete, a column add, a column update (name, type or formula), a column delete, and a table rename. Table creation, summary creation and access changes are not undoable.
- **Moving entries:** undo moves the entry to that person's redo stack, and redo moves it back. Any new edit by that person clears their redo stack.
- **Ownership:** undo and redo apply only the person's own entries.
- **Undo is an edit:** an undo or redo rewrites its cells, rows, columns and tables like any other edit. Revisions rise by one, so it can make another person's in-flight write stale, and history records it.
- **When an entry still applies:** an undo or redo entry applies when each of its targets (cell, row, column or table, and for a rename every rewritten Formula column) still has the revision the entry's edit produced, or a revision produced since then only by that same person's own undos and redos. So a person can undo several of their own edits to one cell in a row. For example, with the seed data at start, Priya writes Oak Shelf Bracket's Price as `13`, then `14`, then presses Undo three times. The first two undos answer 200, leaving Price at `13.0000` and then `12.5000`, and the third answers 409 `nothing_to_undo`.
- **Parallel undos:** simultaneous undo or redo requests from one person each apply a distinct entry exactly once, newest first. With k entries and more than k parallel undos, k answer 200 with all-different `stacks.undo_count` values, and the rest get 409 `nothing_to_undo`. The redo stack then holds those k entries in order. Redo behaves the same way.

What each kind of undo does:

- **Cell writes and pastes:** undo restores the previous values.
- **Row deletion:** undo restores the row.
  - The row keeps the same id and its original insertion position, with the same values, cell revisions and row revision.
  - Every Reference that still holds the #REF! from that deletion points at the row again, and that cell's revision rises by one. References someone has changed since keep their new value.
  - Formulas and summary groups recompute to what they showed before, with the same group row ids.
- **Row adds:** undoing a row add deletes the row under the deletion rules above. Redo brings the row back with the same id.
- **Column and table updates:** undoing one changes the column or table back, and for a rename restores every rewritten text.
- **Column deletion:** undo restores the column with the same id, at its position, with all its values. Formulas that name it evaluate again.
- **Conflicts:** an undo or redo whose entry no longer applies gets 409 `undo_conflict`, changes nothing and drops the entry. That covers anyone else's change, or the person's own change other than an undo or redo, to a target, a row or column that is gone, and a restored name that is now taken.
- **Empty stacks:** an empty stack gets 409 `nothing_to_undo` or `nothing_to_redo`.

**Example: undo across a rename.** With the seed data at start, Mara:

1. deletes Products Stock. Each Stock Left goes to `#NAME?` at depth 1, and the sentence is `Recalculated 4 cells in 1 table.`;
2. renames Orders Qty to `Quantity`;
3. presses Undo. Qty and both formula texts return byte for byte, and the list is empty;
4. presses Undo again. Stock returns with its values, Stock Left goes back to `30.0000`, `10.0000`, `140.0000` and `22.0000` at depth 1, and the sentence is `Recalculated 4 cells in 1 table.`.

**Revisions and the winner rule.**

- **Cells:** every data cell has a revision. It starts at 1 when the row is created and rises by one on every write to that cell, whoever makes it.
- **Rows:** every data row has a revision. It starts at 1 and rises by one whenever any of its data cells' revisions rises.
- **Columns:** every column has a revision. It starts at 1 and rises by one on every name, type or formula change, a rewrite by a rename included.
- **Tables:** every table has a revision. It starts at 1 and rises by one on every rename.
- **Stale requests:** a request whose revision differs from the current one gets 409 `stale_revision` with the matching `current`, and changes nothing.
- **Simultaneous writes:** of several simultaneous writes to one cell, one column or one table carrying the same current revision, exactly one is applied. Every other gets the 409, whose `current` shows the winner's result. A formula saved from the formula bar and one saved from the Edit formula dialog are both column changes and follow this rule.

**Races between different kinds of change.** Each race below resolves as one serial order. The outcome of each order is exact. In every case every dependent value equals a fresh recompute, and history lists only the committed edits, in commit order.

- **Row delete against a cell write in that row:** exactly one succeeds.
  - Delete first: the write gets 404 `not_found`.
  - Write first: the row's revision has risen, so the delete gets 409 `stale_revision` with `current.row`.
- **Column rename against a formula change that names the old name:**
  - Rename first: the rename has raised the formula column's revision, so the formula change gets 409 `stale_revision`, with `current.column` showing the rewritten formula.
  - Formula change first: the rename then rewrites the newly saved text, and both answer 200.
  - A new Formula column created after the rename with the old name saves and shows #NAME?.
- **Cell write against a type change of that cell's column:**
  - Type change first, and it converted or blanked that cell: the write gets 409 `stale_revision`, with the converted value as `current`.
  - Type change first, and the cell was blank: the write applies and is checked against the new type.
  - Write first: the type change converts the newly written value, and both answer 200.
- **Undo against another person's write to the same target:** exactly one wins.
  - Write first: the undo gets 409 `undo_conflict` and drops its entry.
  - Undo first: the write gets 409 `stale_revision`, with `current` showing the undone value.

**Shares and invites.** A share action is a share POST. It creates a share, or updates the role and row scope of the address's existing share, and attempts exactly one invite email.

- `invite_status` is `sent` if the mail server accepted the message, and `not_sent` otherwise. The share is saved either way.
- Resend applies only to `not_sent` shares and sends at most one email:
  - when the mail server accepts, the status moves to `sent`;
  - otherwise it stays `not_sent` and the answer is 503;
  - on a `sent` share it gets 409 `invite_already_sent`.
- Of simultaneous Resends of one share, exactly one sends an email and gets 200. The others get 409.
- A share to an address with no account takes effect if that account ever exists. Responses never reveal whether it does.

**Exports.** An export is a file of one table, in the caller's view, as of one point in the document's edit order.

- **States:** `writing` moves to `ready` or `failed`. There are no other transitions.
- **Refused requests:** an export request refused at the boundary or by any error step creates no export record and no stored object. For example, a POST carrying `Origin: http://other.example` answers 403 `cross_origin`, and the caller's export list is unchanged.
- **Snapshot:**
  - The server reads the table's rows and their evaluated values at one point in the edit order, and records that point's document revision as `document_revision`.
  - The file equals the caller's table read at exactly that revision. Every Formula, Reference and summary value in it matches that read, and no file mixes cells from before and after one edit, paste, rename or undo.
  - The export never holds the document's edit order while it writes. Edits never wait on an export, and storage calls never run inside an edit transaction.
- **Storing:** the server writes the CSV to object storage, then reads back the stored object's byte size and SHA-256.
  - It moves to `ready` only when both match what it generated.
  - Any storage error, timeout or mismatch moves it to `failed`.
  - The POST returns once the export has reached `ready` or `failed`.
- **The record:**
  - `created_by` is the person who pressed Export, whatever their role.
  - Once the record is `ready` or `failed`, every field stays identical on every later read: after more edits, after a refused or 502 download, and after a table rename.
- **Abandoned requests:** a client that disconnects mid-POST does not stop the export. It still reaches `ready` or `failed` within 15 seconds and never stays `writing`.
- **Downloads:**
  - A download before `ready`, or after `failed`, gets 409 `export_not_ready`.
  - For a `ready` export, the server reads the stored object and checks its byte size and SHA-256 against the record before sending any byte. On a match it serves exactly those bytes, so edits made after the export never change its download.
  - If the object is missing, or its size or hash differs, the answer is 502 `export_corrupt` with no CSV bytes, and the record does not change.
  - A download the client abandons part-way releases its storage stream and database connection at once. After repeated abandoned downloads, every other request is still served within the limits in Browser support and performance.

**CSV format.**

- RFC 4180, UTF-8 without a byte-order mark.
- A header row of column names in position order, then one record per visible row in insertion order (group order for summaries).
- Every record ends with CRLF, the last included.
- A field containing a comma, a double quote, CR or LF is wrapped in double quotes, with inner quotes doubled. Other fields are not quoted.
- Each field is the cell's display exactly: Decimals with 4 places, `TRUE` or `FALSE`, dates as `YYYY-MM-DD`, References as the target's display, errors as their string, and blank as an empty field.

**Neutralising text.** A value of text origin that starts with `=`, `+`, `-`, `@`, a tab (U+0009) or a carriage return (U+000D) gets one apostrophe before that first character, in the file only.

- Text origin means a Text cell, a Formula cell whose result is Text, a Reference showing Text, or a header name.
- The apostrophe goes inside any quoting. A value of CR followed by `=Note` is written as a double quote, an apostrophe, CR, `=Note` and a double quote. A value of tab followed by `Note` is written unquoted, as an apostrophe, the tab and `Note`.
- Decimal, Date, Bool and error values are never prefixed, so `-3.2500` stays as it is.

### Services (DP-26, DP-27, DP-28, DP-31, DP-34, DP-71, DP-72, DP-80, DP-95)

**Postgres** is the single store of record. It holds:

- accounts and sessions;
- documents with their revision and history;
- tables, columns, rows and cell values, with their revisions;
- formulas and the dependency graph;
- undo and redo stacks;
- row access;
- summary groups with their stable ids;
- shares with their invite status;
- export records;
- idempotency keys with their stored answers.

How the database is used:

- Create the schema idempotently every time the server starts. Insert the seed only when the database has no accounts.
- Several app instances may start against the same database at once and serve it together. Schema setup, seeding, the edit order, the idempotency rules and the winner rules must hold across instances.
- While the database is unreachable, every route except health answers 503 `database_unavailable`. Once it is reachable again the app serves normally, finishing schema setup first if it was still pending.
- No request leaves a session active or idle in a transaction after it has answered or been abandoned.

**Mailpit (SMTP).** Each share action and each Resend opens a fresh SMTP connection to `SMTP_HOST`:`SMTP_PORT` and gives up after 5 seconds. A failure is never remembered between attempts, so delivery recovers as soon as the server answers, without a restart. Each message has:

- **From:** the `MAIL_FROM` value.
- **To:** the shared address as the only recipient, with no Cc or Bcc.
- **Subject:** `<sharer display name> shared <document name> with you`.
  - When it contains any non-ASCII character, it is encoded per RFC 2047 as a run of UTF-8 encoded-words.
  - Each encoded-word is at most 75 characters long and decodes on its own to whole characters, so no character is split.
  - The words are joined by CRLF SPACE, and no Subject header line is longer than 76 characters.
  - The raw header block is plain ASCII. The decoded Subject equals the text above exactly, for document names up to the 80-character limit.
- **Body:** plain text in UTF-8, exactly two lines:
  - `<sharer display name> shared "<document name>" with you as <Editor|Viewer>.`
  - `Open it here: <APP_PUBLIC_URL>/d/<document id>`

The email never contains row data or any token. When mail is unreachable, a share still answers its normal 201 or 200 with `not_sent`, and Resend answers 503 `mail_unavailable`. The UI copy is in Feedback states.

**MinIO (S3).** Each export is one object at key `exports/<document id>/<export id>.csv` in `S3_BUCKET`, with content type `text/csv; charset=utf-8`. Each storage call gives up after 10 seconds.

When storage is unreachable:

- the export POST still answers 201, with status `failed`;
- a download answers 503 `storage_unavailable`;
- every other route, cell edits included, works normally and within its usual limits;
- the next export press after storage returns is attempted afresh.

When storage is reachable but reports the object missing, the download gets the 502 from Business rules, not a 503.

### Seed data (DP-36)

Every seeded person and business is invented. All accounts share the password `ledger-demo-2026`.

| Display name | Email | Access to Harbour Lane Ops |
|---|---|---|
| Mara Lindqvist | mara@harbourlane.test | Owner |
| Dev Okafor | dev@harbourlane.test | Editor, row scope `own`, invite `sent` |
| Priya Raman | priya@harbourlane.test | Editor, row scope `all`, invite `sent` |
| Sam Whitlock | sam@harbourlane.test | Viewer, row scope `all`, invite `sent` |
| Jonah Reyes | jonah@harbourlane.test | no access |

The document **Harbour Lane Ops** starts at revision 0, with an empty history.

- It has four tables, created in the order listed below.
- No email is sent for seeded shares.
- Every seeded table, column, data row and data cell has revision 1.
- Every seeded person starts with empty undo and redo stacks.

**Products.** Columns: Name (Text), SKU (Text), Price (Decimal), Stock (Decimal), Units Ordered (Formula `SUMBY(Orders.[Qty], Orders.[Product])`), Stock Left (Formula `[Stock] - [Units Ordered]`). No row owner.

| Name | SKU | Price | Stock | Units Ordered | Stock Left |
|---|---|---|---|---|---|
| Oak Shelf Bracket | OSB-01 | 12.5000 | 40.0000 | 10.0000 | 30.0000 |
| Walnut Floating Shelf | WFS-02 | 68.0000 | 12.0000 | 2.0000 | 10.0000 |
| Brass Hinge Pair | BHP-03 | 9.7500 | 150.0000 | 10.0000 | 140.0000 |
| Birch Ply Sheet | BPS-04 | 41.2000 | 25.0000 | 3.0000 | 22.0000 |

**Customers.** Columns: Name (Text), Region (Text), Phone (Text), Owner (Text, the row owner).

| Name | Region | Phone | Owner |
|---|---|---|---|
| Pell & Daughters Catering | North | +1-555-0142 | dev@harbourlane.test |
| Greyfield Installers, Ltd | South | 555-0199 | priya@harbourlane.test |
| Moss Street Bakery | North | +1-555-0178 | dev@harbourlane.test |

**Orders.** Columns: Order No (Text), Customer (Reference to Customers), Product (Reference to Products), Qty (Decimal), Owner (Text, the row owner), Line Total (Formula `[Qty] * [Product].[Price]`), Region (Formula `[Customer].[Region]`).

| Order No | Customer | Product | Qty | Owner | Line Total | Region |
|---|---|---|---|---|---|---|
| ORD-1001 | Pell & Daughters Catering | Oak Shelf Bracket | 4.0000 | dev@harbourlane.test | 50.0000 | North |
| ORD-1002 | Greyfield Installers, Ltd | Walnut Floating Shelf | 2.0000 | priya@harbourlane.test | 136.0000 | South |
| ORD-1003 | Moss Street Bakery | Brass Hinge Pair | 10.0000 | dev@harbourlane.test | 97.5000 | North |
| ORD-1004 | Greyfield Installers, Ltd | Oak Shelf Bracket | 6.0000 | priya@harbourlane.test | 75.0000 | South |
| ORD-1005 | Pell & Daughters Catering | Birch Ply Sheet | 3.0000 | dev@harbourlane.test | 123.6000 | North |

**Orders by Region.** A summary of Orders grouped by Region, with the sums of Qty and Line Total. Columns: Region, Count, Sum of Qty, Sum of Line Total.

| Region | Count | Sum of Qty | Sum of Line Total |
|---|---|---|---|
| North | 3.0000 | 17.0000 | 271.1000 |
| South | 2.0000 | 8.0000 | 211.0000 |

**Dev's view at start:**

- Orders shows only ORD-1001, ORD-1003 and ORD-1005.
- Customers shows only Pell and Moss.
- Orders by Region shows only the North group.
- In Products, Units Ordered reads 4.0000, 0.0000, 10.0000 and 3.0000, and Stock Left reads 36.0000, 12.0000, 140.0000 and 22.0000.

## Technical requirements

### Deployment (DP-34)

The runtime is Node.js 22 with npm, and the app is written in TypeScript. Put a manifest at `/app/run.json` with string fields `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

- `serve` starts the built app without rebuilding.
- The app binds `0.0.0.0` on the port in `APP_PUBLIC_PORT`, defaulting to 4173.
- `GET /api/health` answers HTTP 200 with JSON `{"status":"ok"}` as soon as the process is listening, whatever the state of its dependencies.

### Configuration and secrets (DP-60)

Read these from the environment at start. Never hard-code them, and never send them to the browser.

| Variable | Use |
|---|---|
| `DATABASE_URL` | the Postgres connection |
| `SMTP_HOST`, `SMTP_PORT` | the mail server |
| `MAIL_FROM` | the From line. The environment sets it to `Tallyframe <invites@harbourlane.test>`; use it as-is |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | object storage |
| `APP_PUBLIC_PORT` | the listening port |
| `APP_PUBLIC_URL` | the origin used in invite links, defaulting to `http://localhost:<APP_PUBLIC_PORT>` |
| `IDEMPOTENCY_TTL_SECONDS` | how long idempotency keys are kept, defaulting to 86,400 |

- Passwords are stored only as salted slow hashes.
- Sessions are random tokens stored in Postgres, and they last until sign-out.
- A session identifies a person only. Role and row scope are looked up on every request.

### Server boundary (DP-35, DP-34, DP-79, DP-98)

These checks come first in the API's error precedence, in this order:

1. A request body over 1,000,000 bytes gets 413 `payload_too_large`. Exactly 1,000,000 bytes is allowed.
2. A body sent with any content type other than `application/json` gets 415 `unsupported_media_type`.
3. A state-changing request gets 403 `cross_origin` in any of these cases. State-changing means every POST, PUT, PATCH and DELETE, sign-in, sign-out and Export CSV included.
   - It has an `Origin` header whose scheme, host and port do not exactly equal either the request's own origin (`http://` plus its Host header) or the origin of `APP_PUBLIC_URL`. A foreign host such as `http://other.example`, a differing scheme, a differing port or a trailing dot on the host is a mismatch.
   - Its `Origin` header is `null`.
   - It has no `Origin` header but carries `Sec-Fetch-Site` with the value `cross-site` or `same-site`.

These checks run before any session lookup, so an unauthenticated cross-site sign-in also gets 403, not 401. A refused request changes nothing, creates no record, sets no cookie, sends no email and moves no invite status. A request with neither `Origin` nor a cross-site `Sec-Fetch-Site` passes this check.

What the server serves and sends:

- The app is same-origin only. It never sends `Access-Control-Allow-Origin` or any other cross-origin header.
- The app shell, and every `/api` response, carries `Cache-Control: no-store`.
- Unknown `/api` paths answer 404 `not_found` as JSON. Other unknown paths get the app shell.
- The server serves only the built client assets and the app shell. It never serves TypeScript source, source maps, the run manifest, package files, environment files or any credential.
- No response body or client bundle contains a credential.
- Every response header is plain ASCII on one line, including the download's `Content-Disposition`.

A dependency that is unreachable at boot never stops the server from starting. Each later request retries that dependency and recovers once it answers, as described in Services.

### Browser support and performance (DP-37, DP-38, DP-39, DP-80)

Support current Chromium, Firefox and Safari at 375 by 812, 768 by 1024 and 1280 by 800.

- The seeded workspace is usable within three seconds of navigation.
- A commit's response arrives within one second for documents of up to 5,000 cells, a 500-cell paste included. This holds while exports and downloads are running or have been abandoned, and while storage is unreachable.
- A formula preview reply arrives within half a second.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, and `serve` runs the built app without a build step.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package with its name, version and licence, plus each bundled font and the icon set. Shipped packages means the production dependency tree from `npm ls --omit=dev --all --json`.
- IF-03: Shipped packages (the production dependency tree from `npm ls --omit=dev --all --json`) and bundled fonts use only the MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1 licences.
- IF-04: The app stores state only in Postgres and MinIO, sends mail only over SMTP, and uses no SQLite, Redis, embedded database or state files on disk.
- IF-05: The provided service definitions and dev credentials are used unchanged.
- IF-06: All server and browser source is TypeScript compiled with strict type checking turned on.
- IF-07: Fonts and icons are bundled and served from the app's own origin, and icons come only from Lucide.

## Engineering standards

- Code is idiomatic, strictly typed TypeScript. Names use this brief's domain terms: document, table, column, row, cell, revision, formula, summary, group, paste, range, rename, history, share, invite, export, recalculation, idempotency key, access, sheet.
- Each domain rule is decided in exactly one place in the source. That covers decimal parsing and rounding, formula reading and its located diagnosis, formula evaluation, rename rewriting, recalculation order and depth, row visibility, role permission, the revision winner rule, undo applicability, idempotent replay, export state transitions, CSV neutralisation, download file-name encoding, and on the client the send-order rule for applying responses. The client never re-implements the evaluator or the access rules.
- Decimal values never pass through binary floating-point numbers on the server, from request parsing to storage.
- There is no abstraction with a single implementation, and no interface written only for a possible future second provider.
- There is no dead, commented-out or unreachable code, and no defensive check for a state the types and rules already make impossible.
- Every API error goes through the one error shape and the precedence from API.
- Every database change for an edit happens in one transaction: the edit, its recalculation, its history entry and its idempotency record. Provider calls never run inside that transaction.
- The source has no feature, route, setting or screen beyond this brief.
