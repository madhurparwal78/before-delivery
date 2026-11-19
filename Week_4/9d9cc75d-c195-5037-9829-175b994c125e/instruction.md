# Fizzwick Works Lozenge

Lozenge is a browser workbook for anyone who keeps numbers in a spreadsheet: shop owners, club treasurers, teachers. You upload CSV files, relate two tables with one left join, and build charts by placing fields on shelves with a pointer or the keyboard. Charts are drawn as SVG. Calculations use a small language that Lozenge publishes in full, including level-of-detail expressions and table calculations. Every result follows a published query order. You build dashboards from sheets and link them with actions, then publish workbooks to private projects where row-level security holds on every number. Sources refresh as scheduled extract snapshots, threshold alerts land in an in-app inbox, and you can export PDF, PNG and crosstab CSV files. The backend uses PostgreSQL for every record and extract snapshot, and MinIO object storage for every uploaded file and exported file. Accounts are local usernames with passwords. Out of scope: email, outside sign-in, paid plans, AI or agent features, natural-language queries, data preparation flows, metrics products, marketplaces, extensions, maps, embedding, outside integrations, database connectors, other products' workbook formats, sound, stories, forecasting, dual axes, dashboards inside dashboards, web page objects, co-editing, service workers and any datastore other than PostgreSQL and MinIO. All data in Lozenge, including the sample, is invented.

## Problem and users

Anyone who keeps numbers in a spreadsheet eventually has to show them to other people. Today they export two CSV files, join them by hand, rebuild the same pivot charts every week and send screenshots around. Each reader may see only their own rows, so the person keeps one copy per reader, and the copies drift apart. Nobody can explain why a share changes when a filter is applied, because the order in which filters and aggregations run is not written down anywhere. Lozenge is one workbook in the browser. It has a published calculation language and a published order of operations with worked examples. You publish once, and row-level security then holds on every mark, total, filter list and export.

- **Creator** (daily): uploads and relates CSV files, builds sheets and dashboards with calculations, publishes them to projects, and sets who sees which rows.
- **Explorer** (weekly): opens a published workbook, changes filters and parameters, writes and checks calculations in their own copy of a sheet, and schedules extract refreshes when the project allows it.
- **Viewer** (weekly): opens a published dashboard at a desk or on a phone, selects marks to filter it, receives threshold alerts in the in-app inbox, and exports their own rows.

## Journeys

1. **Upload and relate.** A creator with an empty project opens the upload page, chooses `orders.csv` and checks the preview's column types. They upload it, add `stockists.csv` as a second table and relate the two on `Stockist ID`. The source page shows both tables, the relation and the field list. If storage is down, the upload shows the outage copy, and Try again succeeds once storage is back.
2. **Build a sheet.** A creator opens a new sheet on the sample. They place Region on Rows and Sales on Columns by keyboard (the field list, then the Add to shelf menu), and by dragging a chip. They see four bars, the axis ticks, a tooltip and the data table twin. They then drill Region down to Stockist and back.
3. **Explain a number.** An explorer copies a published sheet and writes `{AT [Region] : SUM([Sales])}`, fixing a typo reported at its line and column. They add a dimension filter, then turn it into a context filter, and watch the AT value change only in the second case. They add a share of total and a rank filter, and read every value in the data table.
4. **Dashboard at a desk.** A viewer opens a published dashboard of three sheets and selects East on the region sheet. Two target sheets filter and highlight, show `Updating...` and then announce how many sheets updated. Escape clears the selection.
5. **Dashboard on a phone.** A viewer opens the same dashboard on a 375 pixel wide phone. The sheets stack in the phone order. Tapping a bar opens its details in a bottom sheet, and Filters opens in another bottom sheet. With reduced motion on, every change lands at once.
6. **Two readers, one workbook.** A creator secures the sample by Region and publishes it. `south_rep` sees only South rows in marks, totals, filter lists and exports. `north_rep` sees only North rows. Neither can find the other's private workbook by id.
7. **Refresh and alert.** A creator schedules a refresh every 60 minutes. When the server clock passes the due time, the extract refreshes and a subscriber's alert crosses its threshold, creating one inbox item. A failed refresh keeps the last good data, and a second user's open tab shows each state live.
8. **Export.** A viewer exports a filtered sheet as PDF, PNG and crosstab. They watch Queued, Rendering and Ready, then download each file. Text that looks like a spreadsheet formula is neutralised in the CSV.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Uploading a source** A creator chooses a CSV file on the upload page, sees a preview of its first 20 rows with each column's inferred type, uploads it, and adds a second table to the same source, as qualified in Data sources.
- **DP-02 — Published type inference** Every column gets the type the published inference rule gives, and that type is identical in the preview, in the stored source and after every later refresh of the same bytes.
- **DP-03 — Upload errors at their line** An empty, malformed, oversized or overlong file stores nothing and lists every published upload error with its line, in line order.
- **DP-04 — Files kept as submitted** Each uploaded table file is stored in object storage byte for byte under its published key, and a download returns exactly the bytes submitted.
- **DP-05 — Upload during a storage outage** When object storage is unreachable, an upload stores nothing and shows the published outage copy with the preview kept, and Try again succeeds once storage returns, with no restart.
- **DP-06 — Left join without double counting** Relating two tables is a left join that keeps unmatched left rows, keeps the first of any duplicated right keys with the published join notice, and aggregates a right-table measure once per distinct right key in each mark.
- **DP-07 — Shaping a related source** A creator relates the sample tables, creates bins and a group, renames one field and hides another, and the source and its sheets show the published results and notices.
- **DP-08 — Field kinds, dates, bins and groups** Field kinds, date levels, date parts and truncation in UTC with weeks starting on Monday, bins and groups follow the published rules and their worked examples.
- **DP-09 — Building a sheet by pointer and keyboard** A creator builds a sheet by dragging field chips and by keyboard alone, and the chart, its data table, ticks, colours and tooltips match the published sample values.
- **DP-10 — Keyboard shelf editing and drill** The field list, the Add to shelf menu, removing and reordering pills, and drill expand and collapse all work by keyboard with the published focus moves and announcements.
- **DP-11 — Automatic chart type and refusals** Automatic picks the chart by the published table, and an invalid shelf combination shows the first applicable published refusal while the last good chart stays.
- **DP-12 — Axis ticks, colours and sort** Axis ticks, categorical and sequential colours, the legend and sorting follow the published chart rules and worked examples.
- **DP-13 — Marks, tooltips and the data table** Every mark is a focusable SVG element with the published attributes, label, keyboard movement, selection and tooltip, and every view has a data table twin with one row per mark.
- **DP-14 — Writing a calculation** An explorer writes a calculation in their own copy of a sheet using keyboard suggestions, sees the published check result, saves it, and sees a field rename carried into the formula.
- **DP-15 — Calculation language** Formulas follow the published grammar, null rules and exactly 27 functions, and each function matches its worked example.
- **DP-16 — Formula errors at line and column** An invalid formula reports the first error in the published check order, with its exact text, line and column, and saving a cycle is refused with the chain.
- **DP-17 — Bounded query work** Formulas over the length or depth limit, and views over the work, time or mark limit, answer with the published text within the query time budget, while another user's view keeps answering.
- **DP-18 — Level-of-detail expressions** AT, PLUS, MINUS and whole-table expressions compute at their published level and match their worked examples.
- **DP-19 — Published query order** Every query applies row-level security and then the published steps in order, and matches each worked example for neighbouring steps.
- **DP-20 — Filters, top N and totals in the view** A creator adds dimension, context, top N, measure and table calculation filters and totals through the view's dialogs, with the published focus moves and announcements, and the data table shows the published values.
- **DP-21 — Table calculation rules** Running total, difference from previous, percent of total and rank follow the published partitioning, addressing, null and tie rules and their worked examples.
- **DP-22 — Choosing how a table calculation computes** A creator sets a table calculation and its compute-using choice on a pill, and the data table shows the published values for each choice.
- **DP-23 — Parameters and sets** Parameters and sets follow the published types, controls and Top N rule, and one parameter drives a calculation, a set and a constant line together.
- **DP-24 — Reference and trend lines** Average, median and constant reference lines and the least-squares trend line give the published values and text.
- **DP-25 — Driving a view with a parameter** A viewer changes a parameter control, and the calculation, the set members and the constant line all update to the published values with the published announcement.
- **DP-26 — Dashboard layout** Dashboard objects get the published desktop positions and sizes from the container sizing rule, and hiding or showing an object reflows the layout.
- **DP-27 — Phone dashboard** Below 768 pixels wide a viewer gets the dashboard's phone layout with no horizontal scroll at 360 pixels, taps marks to open their details in a bottom sheet, opens filters in a bottom sheet, and sees every end state at once under reduced motion.
- **DP-28 — Dashboard actions in published order** Filter, highlight, set parameter and change set actions run in the published order with the published effects, action log and clearing rules.
- **DP-29 — Latest selection wins** A response for an older selection is dropped and never overwrites a newer one, and each affected sheet stays busy until its newest answer is applied.
- **DP-30 — Selecting across a dashboard** A viewer selects marks on a dashboard, and the target sheets filter, highlight and update with the published loading text and announcements.
- **DP-31 — Accounts, sessions and access checks** Local accounts, the session cookie, rate limits and the published error order hold on every route, and an id in a private project answers exactly like an id that does not exist.
- **DP-32 — Projects, roles and certification** A creator publishes a workbook to a project, adds members with roles and certifies the workbook, a second user sees exactly what their role allows, and a later publish removes the certification.
- **DP-33 — Row-level security on every surface** A secured source shows each user only their entitled rows on marks, totals, filter lists, tooltips, set members, level-of-detail values, reference and trend lines, alerts and exports, with no exception for any role.
- **DP-34 — Two readers, one workbook** Two viewers with different entitlements open the same published dashboard and export it, and each sees and downloads only their own rows.
- **DP-35 — Scheduled extract refresh** Extract refreshes run on the server clock at the published interval, swap in one transaction, append or replace rows according to their kind, and keep the last good snapshot when a refresh fails.
- **DP-36 — Threshold alerts and inbox** After each successful refresh, an armed alert whose value for the subscriber's rows is above its threshold creates exactly one inbox item and disarms, and it rearms once the value is at or below the threshold.
- **DP-37 — Watching an extract from two tabs** A scheduled refresh, a failed refresh and staleness show the server-reported extract state live in a second user's open tab, and the inbox link count updates live, whatever the device clock says.
- **DP-38 — Export jobs confirmed by storage** Export jobs move through the published states, show Ready with a download only after object storage confirms the file, fail with a retry during a storage outage, and return the running job when the same request is repeated.
- **DP-39 — Export contents** PDF, PNG and crosstab exports hold the published content for the requesting user's rows and filters and never include a hidden field, and the crosstab neutralises text that looks like a formula.
- **DP-40 — Exporting a view** A viewer exports a filtered sheet as PDF, PNG and crosstab, follows the export state and progress, and downloads each file.
- **DP-41 — Regions, dialogs, focus and announcements** F6 and Tab move between regions without traps, every dialog keeps Tab inside it and returns focus to its opener on Escape, and every published result is announced in its named polite live region.
- **DP-42 — Mark Glide** After a shelf, filter or selection change, each mark that stays runs one 240 ms animation with id mark-glide that ends at its published place, new and gone marks run none, and reduced motion creates none.
- **DP-43 — Platform, settings and grading routes** The run manifest, health path, configuration and time endpoints, server events, published settings and grading routes behave as published.
- **DP-44 — Settings and credentials from the environment** Every service URL, credential and published setting is read from the environment at start, and none is hard-coded or sent to the browser.
- **DP-45 — Visual design and home page** Every screen carries the candy-shift look with the published palette roles, typefaces, round pills and depth colour fields, and the home page shows the published hero.

## Frontend

### Screens and layout (DP-01, DP-07, DP-09, DP-14, DP-26, DP-27, DP-32, DP-37, DP-45)

All screens share a header with `link "Lozenge"` (home), `link "Workbooks"`, the inbox link and `button "Sign out"` when signed in, or `link "Sign in"` when not. At 375x812 the header wraps to two rows. No screen scrolls sideways at 360, 375, 768 or 1280 pixels wide. The page's scroll width never exceeds its client width.

- **Home `/`.** This page needs no account. It shows the hero headline, a live sample sheet in `region "Sample sheet"` (SUM(Sales) by Region from the sample with the source filter Region is not null, four bars with their data table twin), and `link "Open a workbook"`, which leads to `/workbooks` (or to sign-in first). At 1280 the sheet is centred at about 40% of the width. At 768 it is about 70%. At 375 the page shows the headline, then the sheet at full width, then the link.
- **Sign in `/signin`.** One centred card holds `textbox "Username"`, a password field labelled `Password`, `button "Sign in"` and `button "Create account"`. A `next` query parameter returns the user to the page they asked for.
- **Workbooks `/workbooks`.** A single column of white cards, one per workbook the user can open. Each card has `link "{workbook name}"`, its project name, its state (`Draft` or `Published`), a certified mark when certified, and a procedural thumbnail drawn from its first sheet. `button "New workbook"` opens `dialog "New workbook"`. The column is 720 pixels wide at most and full width at 375. The empty state comes from Feedback states.
- **Project `/projects/<id>`.** Shows the project name, `table "Members"`, the add-member controls, a sources list (`link "{source name}"`), a workbooks list, `link "Upload a source"` and the explorers-schedule checkbox. At 1280 members and sources sit in two columns. At 768 and 375 they stack.
- **Upload `/sources/new` and source page `/sources/<id>`.** On the pale data ground. The upload page has `combobox "Project"`, `textbox "Source name"`, `textbox "Table name"`, `button "Choose file"`, `button "Upload"`, `table "Preview"` and `list "Upload errors"`. The source page lists each table with its row count and `link "Download {table}"`. It also shows the relation, the fields table (`table "Fields"` with rename, hide, change-kind, bin and group buttons per field), `table "Entitlements"`, and the schedule and extract controls. At 1280 the fields table takes the left two thirds and schedule and entitlements the right third. At 768 and 375 they stack.
- **Sheet `/workbooks/<id>/sheets/<sheet id>`.** On the mid-pink sheet field when editable. A viewer, or anyone on a sheet they may not edit, sees the published view on the plum field. The editable layout at 1280 has three columns. The left column holds `region "Fields"` (the field list and `list "Calculations"`) and, beneath it, the Rows, Columns and Filters shelves. The centre stage holds `region "View"` (the chart on a white card), with `region "Data table"` below it. The right column holds the Marks card: Chart type, Color, Size, Label and Detail. The shelves and the Marks card together form `region "Shelves"`. At 768 there are two columns: Fields and Shelves on the left, View and Data table on the right. At 375 there is one column in the order Fields, Shelves, View, Data table. The published view has `region "Controls"` (filters and parameters), View and Data table. These sit in two columns at 1280 and 768 and in one column at 375, with Controls behind `button "Filters"`.
- **Dashboard `/dashboards/<id>`.** On the bubblegum field with plum text. It shows `list "Dashboard objects"` (show and hide buttons), `region "Controls"`, the extract and export controls, `log "Action log"`, and one `region "{sheet name}"` per sheet holding that sheet's chart and twin. From 768 pixels up, the desktop layout from DP-26 is drawn on a stage that is 1280 by 800 in its own coordinates. The stage scales down to fit the available width with no sideways scroll. Below 768 the phone layout from DP-27 applies, and `region "Controls"` is reached through `button "Filters"`. On dashboards each twin stays in the accessibility tree but is tucked visually behind `button "Table for {sheet name}"`, which toggles `aria-expanded`.
- **Inbox `/inbox`.** `region "Inbox"` holds `list "Inbox items"`, newest first, one card per item.
- **Not found and forbidden pages.** One plump headline with a single sticker, using the page copy from Feedback states.

### Public screens and controls (DP-01 to DP-41)

Only these roles, names and data attributes are public. Anything not listed is up to you. Every accessible name contains the control's visible text. `{...}` is filled from the record shown.

| Where | Role and accessible name | Visible copy or content |
|---|---|---|
| Header | `link "Inbox, {n} unread"` | `{n}` is the user's unread count |
| Home | `heading "Charts you can explain."` (level 1), `region "Sample sheet"`, `link "Open a workbook"` | as named |
| Sign in | `textbox "Username"`, password field labelled `Password`, `button "Sign in"`, `button "Create account"`, `status "Sign-in state"` | as named |
| Workbooks | `button "New workbook"`, `dialog "New workbook"` with `textbox "Workbook name"`, `combobox "Project"`, `combobox "Source"`, `button "Create workbook"`; `link "{workbook name}"` per card | as named |
| Project | `table "Members"`, `textbox "Member username"`, `combobox "Role"` (Viewer, Explorer, Creator), `button "Add member"`, `button "Remove {username}"`, `checkbox "Explorers may schedule refreshes"`, `link "Upload a source"`, `status "Announcements"` | as named |
| Upload | `combobox "Project"`, `textbox "Source name"`, `textbox "Table name"`, `button "Choose file"`, `button "Upload"`, `button "Try again"`, `table "Preview"` (each `columnheader` carries `data-type` of `boolean`, `number`, `date` or `text`), `list "Upload errors"` (one `listitem` per error), `status "Upload state"` | as named |
| Source page | `button "Add table"` (opens `dialog "Add table"` with `textbox "Table name"`, `button "Choose file"`, `button "Upload"`, `button "Try again"`, `table "Preview"`, `list "Upload errors"` and `status "Upload state"`, which behave as on the upload page; on success the dialog stays open, shows `Uploaded {table}: {n} rows.` in its status and the table list behind it gains the table; closing returns focus to `button "Add table"`), `link "Download {table}"`, `button "Relate tables"`, `dialog "Relate tables"` with `combobox "Left key"`, `combobox "Right key"`, `button "Save relation"`; `status "Join notice"`; `table "Fields"`; per field `button "Rename {field}"`, `button "Hide {field}"` (then `button "Show {field}"`), `button "Change kind of {field}"`, `button "Create bins for {field}"`, `button "Create group for {field}"`; `dialog "Rename field"` with `textbox "Name"`, `button "Save name"`; `dialog "Bins"` with `spinbutton "Bin size"`, `button "Save bins"`; `dialog "Group"` with `textbox "Group name"`, one `checkbox "{member}"` per member, `button "Save group"` | as named |
| Source page | `table "Entitlements"`, `combobox "Security field"`, `textbox "Entitled username"`, `textbox "Values"` (comma separated), `button "Add entitlement"`, `button "Remove entitlement for {username}"` | as named |
| Source, sheet, dashboard | `status "Extract state"`; on the source page also `status "Next refresh"`, `spinbutton "Every minutes"`, `combobox "Refresh kind"` (Full, Incremental), `combobox "Key"`, `button "Save schedule"`, `button "Refresh now"` | Feedback states |
| Workbook page `/workbooks/<id>` | `link "{sheet name}"`, `link "{dashboard name}"`, `button "New sheet"`, `button "New dashboard"`, `dialog "New dashboard"` with `textbox "Dashboard name"`, one `checkbox "{sheet name}"` per sheet, `combobox "Arrangement"` (Horizontal, Vertical), `button "Create dashboard"`; `button "Publish"`, `dialog "Publish"` with `combobox "Project"`, `button "Publish workbook"`; `button "Certify"`, `status "Certified"`, `status "Publish state"` | as named |
| Sheet, editing | `region "Fields"`, `listbox "Fields"` with `option "{field}, {kind}"` (`{kind}` is `dimension` or `measure`), `menu "Add to shelf"` with `menuitem` Rows, Columns, Color, Size, Label, Detail, Filters; `list "Calculations"` with `button "Edit {name}"`; `button "New calculation"`; `button "Copy sheet"` (explorers, on sheets they cannot edit) | as named |
| Sheet, editing | `region "Shelves"`, `list "Rows"`, `list "Columns"`, `list "Color"`, `list "Size"`, `list "Label"`, `list "Detail"`, `list "Filters"` (each list carries `data-drop="true"` while a dragged chip is over it); pill `button "{caption} on {shelf}"`; on measure pills `button "Aggregation of {caption}"` (menu SUM, AVG, MEDIAN, MIN, MAX, COUNT, COUNT_UNIQUE) and `button "Table calculation of {caption}"`; on dimension pills `button "Sort {field}"`; on date pills `button "Date level of {field}"` (menu Year, Month, Week, Day); on hierarchy pills `button "Expand {field}"` / `button "Collapse {field}"`; `combobox "Chart type"` (Automatic, Bar, Line, Scatter, Text table, Heat map); `checkbox "Show totals"`; `button "Add reference line"`; `checkbox "Trend line"`; `button "New set"`; `button "New alert"` | as named |
| Table calculation | `dialog "Table calculation"` with `combobox "Calculation"` (None, Running total, Difference from previous, Percent of total, Rank), `combobox "Compute using"` (Table across, Table down, Pane down, Chosen fields), one `checkbox "{field}"` per view dimension when Chosen fields is selected, `button "Apply"` | as named |
| Filter | `dialog "Filter {field}"`. For a dimension: `radio "Members"`, `radio "Top N"`, one `checkbox "{member}"` per member, `spinbutton "Top N"`, `combobox "Use parameter"` (None and each number parameter), `combobox "By"` (each measure in the view), `checkbox "Data source filter"`, `checkbox "Context filter"`. For a measure: `spinbutton "At least"`, `spinbutton "At most"`, plus `combobox "Calculation"` and `combobox "Compute using"` as in the table calculation dialog. Always `button "Apply"` | as named |
| Calculation | `dialog "Calculation"` with `textbox "Calculation name"`, `combobox "Formula"` (multi-line, `aria-autocomplete="list"`, `aria-expanded`, `aria-activedescendant`), `listbox "Suggestions"` with `option "{function or field name}"`, `button "Save calculation"`, `status "Formula check"` | as named |
| Set | `dialog "Set"` with `textbox "Set name"`, `combobox "Field"`, `radio "Chosen members"`, `radio "Top N"`, one `checkbox "{member}"` per member, `spinbutton "Top N"`, `combobox "Use parameter"`, `combobox "By"`, `button "Save set"` | as named |
| Reference line | `dialog "Reference line"` with `combobox "Line type"` (Average, Median, Constant), `spinbutton "Value"`, `combobox "Parameter"` (None and each number parameter), `button "Save line"` | as named |
| Alert | `dialog "Alert"` with `textbox "Alert name"`, `combobox "Measure"`, `spinbutton "Above"`, `button "Save alert"` | as named |
| View | `region "View"`, one SVG mark per value (attributes in Business rules, chart grammar), plot rectangle carrying `data-plot`, axis tick labels carrying `data-tick`, reference lines carrying `data-ref="{Average|Median|Constant}"`, `list "Legend"` with `listitem` per entry, exactly one `tooltip` while shown, `status "View notice"`, `status "View announcements"` | Feedback states |
| Data table | `region "Data table"`, `grid "{sheet name} table"` with `columnheader`, `rowheader`, `gridcell` (with `data-value`); twin rows of highlighted marks carry `data-highlight="true"` | values per the display rule |
| Controls | `region "Controls"`, a parameter is `spinbutton "{name}"` (number) or `combobox "{name}"` (text or list); on phones `button "Filters"` opens `dialog "Filters"` | as named |
| Dashboard | `list "Dashboard objects"` with `button "Hide {name}"` / `button "Show {name}"`; `region "{sheet name}"` with `data-x`, `data-y`, `data-w`, `data-h` and `aria-busy`; `button "Table for {sheet name}"`; `log "Action log"`; `button "Add action"`, `dialog "Action"` with `textbox "Action name"`, `combobox "Action type"` (Filter, Highlight, Set parameter, Change set), `combobox "Source sheet"`, one `checkbox "{sheet name}"` per target, `combobox "Field"`, `combobox "Parameter"`, `combobox "Set"`, `button "Save action"`; on phones `dialog "Mark details"` (carries `data-sheet="bottom"`) | as named |
| Exports | `button "Export PDF"`, `button "Export PNG"`, `button "Export crosstab"`, `status "Export state"`, `progressbar "Export progress"` (`aria-valuenow` 0, 50 or 100), `link "Download {kind}"` (`{kind}` is `PDF`, `PNG` or `crosstab`), `button "Try again"` | Feedback states |
| Inbox | `region "Inbox"`, `list "Inbox items"` with one `listitem` per item | Feedback states |
| Any page | `status "Announcements"` on pages without a view | Feedback states |

The body element carries `data-pending`, which holds the number of the page's API requests in flight. A change has settled when it reads `0`. Server-event streams (`GET /api/events` and the export event streams) are never counted in it, only ordinary API requests.

### Interactions (DP-09, DP-10, DP-13, DP-14, DP-20, DP-27, DP-30, DP-41)

**Pointer on shelves.** Shelves use pointer events only (`pointerdown`, `pointermove`, `pointerup`) and never HTML5 drag events. A drag starts after the pointer moves 4 pixels while pressed on a field chip (an option in the field list) or on a pill. While the dragged item is over a shelf list, that list carries `data-drop="true"`. Releasing places the field there: a chip adds a pill, and a pill moves to that shelf. Releasing elsewhere cancels. A press that moves less than 4 pixels is a plain click.

**Keyboard on the field list.** `listbox "Fields"` has one tab stop. ArrowDown and ArrowUp move between options and stop at the ends. Enter opens `menu "Add to shelf"`, where arrows move between items and Escape closes the menu and returns focus to the option. Choosing a shelf other than Filters adds the pill, returns focus to the option and announces the added copy. Choosing Filters opens `dialog "Filter {field}"`: Apply adds the filter pill and puts focus on it, and Escape adds nothing and returns focus to the option.

**Keyboard on pills.** Each pill is a button in Tab order. Delete removes the pill. Focus then moves to the next pill on that shelf, or else the previous one, or else the first option in the field list, and the removed copy is announced. Alt+ArrowRight or Alt+ArrowDown moves the pill one place later on its shelf, and Alt+ArrowLeft or Alt+ArrowUp moves it one place earlier. Focus stays on the pill and the moved copy is announced. Enter on a filter pill reopens its filter dialog. Expand and Collapse keep focus on the same button, which changes its name, and announce the drill copy.

**Marks.** Marks use a roving tab stop: one mark has tabindex 0 and the rest have -1. Tab into the chart lands on the first mark, or on the last mark focused. ArrowRight and ArrowDown move to the next mark in mark order and ArrowLeft and ArrowUp to the previous one, stopping at the ends. Focus on a mark shows its tooltip. Enter or a click selects the mark (`aria-pressed="true"`, and every other mark false). Escape clears the selection and hides the tooltip while focus stays on the mark. A real mouse hover shows that mark's tooltip, and leaving hides it. Clicking empty plot space clears the selection. On a dashboard, selecting and clearing run the actions in DP-28.

**Calculation editor.** Typing a word of one or more letters, or a `[`, opens `listbox "Suggestions"` (`aria-expanded="true"`). It holds the names that start with the typed text, compared without regard to case: function names first in alphabetical order, then field names in alphabetical order. After `[`, all field names are listed and narrowed as you type. ArrowDown and ArrowUp move the active option through `aria-activedescendant` while focus stays in the box. Enter replaces the typed word (including any `[`) with `NAME(` for a function or `[Name]` for a field, closes the list and leaves the caret just after the inserted text. Escape closes the list without inserting. Tab closes the list without inserting and moves focus on. Enter with the list closed inserts a new line. After `LOZ_FORMULA_DEBOUNCE_MS` without typing, measured on page timers, the formula is checked. A check result for older text is never shown over a newer one.

**Dialogs and bottom sheets.** Opening any dialog puts focus on its first control. Tab from the last control wraps to the first, and Shift+Tab from the first wraps to the last. Escape closes the dialog and returns focus to the control that opened it, and so does any close or save. Apply in a filter dialog is the one exception: it puts focus on that filter's pill (the new pill when the dialog was opened from the field-list menu, the same pill when it was reopened from it). Escape in a filter dialog still returns focus to the opener. On phones, `dialog "Mark details"` and `dialog "Filters"` are bottom sheets and follow the same rules.

**Regions.** F6 moves focus to the first focusable element of the next region in the order Fields, Shelves, View, Data table (on published views and dashboards: Controls, then each sheet region in layout order). Shift+F6 goes back, and both wrap. F6 works whichever control in a region has focus, including a button, a pill or a mark. Tab and Shift+Tab always leave a region at its edges, and no region keeps Tab.

**Touch.** Below 768 pixels wide, tapping a mark selects it and opens `dialog "Mark details"`, which shows the mark's tooltip text. Tapping `button "Filters"` opens `dialog "Filters"` holding the Controls. Below 768 pixels each bar is at least 44 pixels thick across the bar, and each point and cell has a tap area of at least 44 by 44 pixels.

**Parameters.** A parameter control applies its new value on Enter or when it loses focus, never on each keystroke, and announces the parameter copy.

**Dashboard objects.** `button "Hide {name}"` hides that object, becomes `button "Show {name}"`, keeps focus and announces the hide copy. Show reverses it. Hiding is per page and is not saved.

### Visual design (DP-45)

The direction is candy-shift: sweet, exact and plump.

- **Typefaces.** Headings, the hero and big numbers use Stack Sans Headline. Everything else uses Stack Sans Text. Both are bundled font files the app serves itself. Each heading level is a third larger than the one below it, so body, small heading, heading and display steps grow by the same ratio. Figures on every axis, total and table use tabular (equal-width) digits, and numbers are right-aligned in tables.
- **Palette roles, in words.** The ground is a pale blush pink. Surfaces are white. Ink is a near-black plum. Muted text is a dusty mauve. The accent is a saturated bubblegum pink, carrying plum text when it is a background. A mid pink between the ground and the accent is the sheet field. A sharp lime appears only on controls (pills, primary buttons, focusable chips) and never as a background field.
- **Depth fields.** Each layer of the work has its own floor-to-ceiling colour field, so the colour shows where you stand in the order of operations. Raw data pages (upload and source) sit on the pale ground. Editable sheets sit on the mid pink. Dashboards sit on bubblegum with plum text. Published views opened by a viewer sit on plum with pale blush text.
- **Shapes.** Every field chip and shelf pill is a fully round pill with a lime outline: dimensions are outlined and measures are filled lime. Cards and panels are white with large, soft 28 pixel corners on the stage field. Inputs are white with a thick plum focus ring.
- **Composition.** A centred stage holds the chart on a white rounded card. The data pane and shelves sit in a left column of pills, and the Marks card in a right column.
- **Hero.** `Charts you can explain.` is set centred in a light weight of Stack Sans Headline at about nine percent of the viewport width. Its first words are grey and its last words full ink. It sits over the pale ground, with the live sample sheet centred beneath it and one large lime pill link, `Open a workbook`. Four SVG stickers in palette colours (a rounded shelf pill, a sum lozenge, a round chart blob and an AT badge) are cropped by the viewport edges, tilted slightly (a few degrees each way) and given solid plum offset shadows. On a phone the page shows the headline, then the sheet, then the pill, with two stickers left in the corners.
- **Working screens.** The workbook list is a column of white cards on the pale ground, each with a procedural thumbnail of its first sheet. The calculation editor is a white card. Above the formula it shows the published query order as a strip of plump chips, one per step, and the step a formula's result lands at deepens to bubblegum. Tables and crosstabs sit on white cards with tabular figures and zebra rows tinted pale blush, with no rules between rows. Empty states are one plump headline plus a single sticker. Error and outage banners are full-width mid-pink bars with plum text.
- **Marks.** Mark colours come from the published colour rule. Every mark has a plum outline and a distinct SVG pattern fill, so colour is never the only cue.
- **Comfort.** Density is comfortable: generous padding and roomy rows. Every control is at least 44 pixels in each direction it can be tapped. Text and controls meet WCAG 2.2 AA contrast on every field, including pale blush text on plum and plum text on bubblegum.

### Motion and effects (DP-27, DP-42)

- **Mark Glide** (the signature). When a shelf, filter or selection change redraws a view, every mark that existed before and still exists (same `data-mark`) runs exactly one Web Animation with id `mark-glide` lasting 240 ms. It moves and resizes the mark from its old place and size to its new place and size. It starts quickly and settles gently with no overshoot, then stops. Read it with `element.getAnimations()`. When it ends, the mark's place and size equal what the published scale rules give. A mark that is new appears at once in place, and a mark that is gone disappears at once, so neither has an animation. This lets a person follow a value while the chart redraws.
- **Bottom sheets.** On phones, `dialog "Mark details"` and `dialog "Filters"` slide up from the bottom edge using one Web Animation with id `sheet-open` lasting 240 ms, with the same quick start and gentle settle.
- **Hover and press.** Pills and buttons darken a step on hover and press within a tenth of a second. Focus shows the thick plum ring at once.
- **Loading.** A busy sheet region shows `Updating...` (copy from Feedback states). There is no spinner loop.
- **No decorative loops.** Nothing animates on its own or repeats: stickers are still, and there are no idle loops, parallax or scroll-linked effects.
- **Reduced motion.** When the operating system asks for reduced motion, no `mark-glide`, `sheet-open` or any other animation or transition is created. Every mark, sheet and panel takes its final place at once, with the same values in its data attributes and in the data table twin.

### Feedback states (DP-03, DP-05, DP-10, DP-11, DP-16, DP-17, DP-20, DP-23, DP-26, DP-30, DP-31, DP-32, DP-33, DP-37, DP-38, DP-41)

Every live region is polite (`aria-live="polite"`). All copy uses straight ASCII apostrophes and quotes and three ASCII dots, never an ellipsis character. `{...}` fields use the display rule in Business rules.

**`status "View announcements"`** (sheet and dashboard pages):
- `Added {field} to {shelf}.`
- `Removed {field} from {shelf}.`
- `Moved {field} to position {n} on {shelf}.` (`{n}` is 1-based)
- `Expanded {field}.` / `Collapsed {field}.`
- `Filtered: {n} marks.` after any filter dialog's Apply (`{n}` is the view's mark count once it has settled)
- `{name} set to {value}.` after a parameter change
- `{name} hidden.` / `{name} shown.` for dashboard objects
- `Saved {name}.` after saving a calculation, set, alert, action or reference line (`{name}` is its name, or the line type for a line)
- After a dashboard selection, once every affected sheet has applied its newest answer: `Filtered to {member}: {n} sheets updated` when any filter action ran, otherwise `Highlighted {member}: {n} sheets updated` when any highlight ran, otherwise `Selected {member}: {n} sheets updated`. After clearing: `Selection cleared: {n} sheets updated`. `{member}` is the selected mark's dimension values joined by `, `, and `{n}` is the number of target sheets the actions changed.

**`status "View notice"`** shows at most one notice at a time, the first that applies in this order:
1. `{field} is hidden.` when the sheet uses a hidden field
2. `No rows for your account.` when row-level security leaves the user no rows
3. the shelf refusals, in the order given in Business rules (view builder)
4. `This view needs too much work. The limit is {max} steps.`
5. `This view took too long. The limit is {s} seconds.` (`{s}` is `LOZ_QUERY_BUDGET_MS` in seconds per the display rule)
6. `This view would draw {n} marks. The limit is {max}. Add a filter or remove a field.`

When it is empty, the region is empty. A refused view keeps its last good chart and twin.

**View empty state.** With nothing on Rows or Columns, `region "View"` shows the headline `Place a field on Rows or Columns.`

**Busy sheets.** While a sheet region waits for its newest answer, it carries `aria-busy="true"` and shows the visible text `Updating...`. Both clear when that answer is applied.

**`status "Formula check"`** shows `Formula is valid.` or the first formula error from Business rules. While a save is refused, it shows the save's error.

**`status "Upload state"`** shows `Uploading...` while an upload is in flight. On success it shows `Uploaded {table}: {n} rows.`. During a storage outage it shows `Storage is unavailable. Your file was not saved. Try again.` as a full-width banner, and `button "Try again"` resends the same file while the preview stays. Each upload error goes in `list "Upload errors"` as one item.

**`status "Join notice"`**: `{table} has {n} duplicate keys. First line kept: {key}.` `{n}` is the number of distinct key values that appear more than once in the right table, and `{key}` is the first such value in file order.

**`status "Extract state"`**: `Fresh, refreshed {YYYY-MM-DD HH:mm} UTC`, or `Stale, refreshed {YYYY-MM-DD HH:mm} UTC`. After a failed refresh it shows `Refresh failed at {failure time} UTC. Showing data from {last success time} UTC.` until the next success. Times are 24-hour UTC as `YYYY-MM-DD HH:mm`. **`status "Next refresh"`**: `Next refresh {YYYY-MM-DD HH:mm} UTC` or `No schedule.`

**`status "Export state"`**: `Queued`, `Rendering`, `Ready` or `Failed. Try again.`. `progressbar "Export progress"` reads 0 while queued or failed, 50 while rendering and 100 when ready. `link "Download {kind}"` appears only with `Ready`, and `button "Try again"` only with `Failed. Try again.`. If a download hits a storage outage, a banner shows `Storage is unavailable. Try again.` and the job stays Ready.

**`status "Publish state"`**: `Publishing...`, then `Published to {project name}.`. A version conflict shows `This workbook changed since you opened it. Reload and publish again.`. **`status "Certified"`**: `Certified by {username}`, or empty.

**`status "Sign-in state"`**: `Wrong username or password.`; `Too many sign-in attempts. Try again in {s} seconds.` (`{s}` is the `Retry-After` value).

**`status "Announcements"`** (other pages, including the source page): `Schedule saved.`; `{field} hidden.` / `{field} shown.` after Hide or Show of a field; `Member added: {username} as {role}.` (`{role}` is `viewer`, `explorer` or `creator`); `Renamed {old} to {new}.`; `Created {field}.` for bins and groups; `Related {left table} to {right table}.`; `Entitlements saved.`; `Refresh finished.` or `Refresh failed.` after Refresh now.

**Field errors** appear next to their field and in the status region of the page or dialog. These are the `errors` messages in API bodies:
- username: `Username must be 3 to 24 letters, digits or _.`
- password: `Password must be at least 8 characters.`
- username taken: `That username is taken.`
- any required name: `Name is required.`
- name clash: `A field named {name} already exists.`
- bin size: `Bin size must be a whole number of at least 1.`
- every minutes: `Every minutes must be a whole number from 1 to 10080.`
- incremental key: `Incremental refresh needs a number or date key.`
- relation keys: `Keys must have the same type.`
- unknown member: `No such user.`
- dashboard sheets: `A dashboard holds 2 to 4 sheets.`
- nesting: `Containers nest at most one level.`
- highlight field: `Highlight needs {field} in every target view.`
- alert threshold: `Above must be a number.`

**Pages and general errors.** An unknown or inaccessible id shows the page headline `Not found.`. A role too low shows `You do not have access to this.`. A 429 shows `Too many requests. Try again in {s} seconds.`. Any 5xx shows `Something went wrong. Try again.`. Empty states: `No workbooks yet.` on the workbook list and `Your inbox is empty.` on the inbox.

**Inbox items** read `{alert name} crossed {threshold}: now {value}.`

## Backend

### API (DP-01 to DP-40, DP-43)

**Shared rules.**
- Every route is under `/api` and speaks JSON (`application/json`), except the CSV upload routes, which take `text/csv` bodies, and file downloads.
- A JSON body is at most 1,000,000 bytes, and that size is allowed. A CSV body is at most `LOZ_CSV_MAX_BYTES` bytes, and that size is allowed.
- Every error body is `{"error":"<code>"}`. A validation error adds `"errors":{"<field>":"<message>"}`, using the field messages from Feedback states.
- **Error precedence**, checked in this order on every route:
  1. 429 rate limited (with `Retry-After` in whole seconds, body `{"error":"rate_limited"}`), 413 too large (`{"error":"too_large"}`), 415 wrong content type (`{"error":"unsupported_media_type"}`)
  2. 401 not signed in (`{"error":"unauthenticated"}`)
  3. 404 no such id, or an id inside a project the user is not a member of, or a draft workbook a viewer or explorer asks for, or another user's sheet copy, export job or inbox item. All give the same body `{"error":"not_found"}`, including for ids nested inside request bodies.
  4. 403 role too low (`{"error":"forbidden"}`)
  5. 409 state or version conflict
  6. 422 invalid input

  An export replay (the same running request) returns its job before any state check.
- Ids are opaque strings. Times are ISO 8601 UTC with a `Z`.

**Platform**
- `GET /api/health` → 200 `{"status":"ok"}`. While object storage is unreachable, really or by the grading switch, it is still 200 but with `{"status":"unavailable"}`. Before PostgreSQL is reachable at boot it is 503 `{"status":"starting"}`.
- `GET /api/config` → 200 `{"formula_max_chars":n,"formula_max_depth":n,"mark_max":n,"formula_debounce_ms":n,"row_max":n,"csv_max_bytes":n,"sse_heartbeat_ms":n}`. No sign-in needed.
- `GET /api/time` → 200 `{"server_now":"<ISO>"}`.
- `GET /api/events` (signed in) → `text/event-stream` with events `clock` `{"server_now"}`, `extract` `{"source","state","stale","last_success_at","last_failure_at","next_run_at"}`, `export` `{"id","status","progress"}` and `inbox` `{"unread":n}`. A comment line `: heartbeat` is sent every `LOZ_SSE_HEARTBEAT_MS`. A user receives `extract` events only for sources they can read, and only their own `export` and `inbox` events. On every connection, including the browser's automatic reconnect, the server first sends `clock`, an `extract` event for each readable source and `inbox`. A page applies each event to the screen in its message handler, with no timer or animation-frame wait. Queries, selections and shelves never travel over this stream.

**Accounts**
- `POST /api/auth/register {"username","password"}` → 201 `{"user":{"id","username"}}` and sets the session cookie. 409 `{"error":"username_taken","errors":{"username":"..."}}`. 422 for username or password.
- `POST /api/auth/login {"username","password"}` → 200 `{"user":{...}}` and sets the cookie. 401 `{"error":"invalid_credentials"}`.
- `POST /api/auth/logout` → 204 and clears the cookie.
- `GET /api/me` → 200 `{"user":{"id","username"},"projects":[{"id","name","role"}]}`.

**Projects**
- `POST /api/projects {"name"}` → 201 `{"id","name","role":"creator","explorers_schedule":false}`. The caller becomes its creator.
- `GET /api/projects/<id>` → 200 `{"id","name","role","explorers_schedule","members":[{"username","role"}],"sources":[{"id","name"}],"workbooks":[{"id","name","state","certified_by"}]}`. Viewers and explorers see only published workbooks in this list.
- `PATCH /api/projects/<id> {"explorers_schedule":bool}` → 200 project (creator only).
- `PUT /api/projects/<id>/members/<username> {"role":"viewer|explorer|creator"}` → 200 `{"username","role"}`. 422 `errors.username` for an unknown user. `DELETE /api/projects/<id>/members/<username>` → 204. Both are creator only.

**Sources** (creator only, except the reads explorers may make)
- `POST /api/projects/<id>/sources/preview` (`text/csv`) → 200 `{"columns":[{"name","type"}],"rows":[[...]],"row_count":n,"errors":[{"line":n|null,"message"}]}`. `rows` holds the first 20 data rows as text, with null for null cells. Nothing is stored. Errors come back in this list with status 200, except for a body over `LOZ_CSV_MAX_BYTES` bytes, which gets 413 `{"error":"too_large","columns":[],"rows":[],"row_count":0,"errors":[{"line":null,"message":"<size error>"}]}` under the shared precedence rules.
- `POST /api/projects/<id>/sources?name=<source name>&table=<table name>` (`text/csv`) → 201 `{"id","name","version":1,"tables":[{"name","rows","sha256","columns":[{"id","name","type","kind","continuous"}]}]}`. 422 `{"error":"invalid_csv","errors":[{"line","message"}]}`. 413 `{"error":"too_large","errors":[{"line":null,"message"}]}`. 503 `{"error":"storage_unavailable"}`.
- `POST /api/sources/<id>/tables?table=<name>` (`text/csv`) adds the second table, with the same responses. A third table gets 422 `errors.table` `A source holds at most 2 tables.`
- `PUT /api/sources/<id>/tables/<table>` (`text/csv`) stores a new file for an existing table and bumps the version. The extract picks the file up on its next refresh. Same responses as upload, with 200.
- `GET /api/sources/<id>` (creator or explorer) → 200 `{"id","name","version","tables":[...],"relation":null|{...},"fields":[{"id","name","table","type","kind","continuous","hidden"}],"hierarchy":null|{"name","fields":[...]},"entitlements":{"field":null|"<name>","users":{"<username>":[...]}},"schedule":null|{...},"notices":[...]}`.
- `GET /api/sources/<id>/tables/<table>/file` (creator) → 200 `text/csv`, the exact stored bytes. 503 `{"error":"storage_unavailable"}`.
- `PUT /api/sources/<id>/relation {"left_table","left_key","right_table","right_key"}` → 200 `{"relation":{...},"notices":["<join notice>"]}`. 422 `errors.right_key` when the key types differ.
- `PATCH /api/sources/<id>/fields/<field id> {"name"?,"hidden"?,"kind"?}` → 200 field. 422 `errors.name`.
- `POST /api/sources/<id>/bins {"field","size"}` → 201 field. `POST /api/sources/<id>/groups {"field","groups":[{"name","members":[...]}]}` → 201 field. `PUT /api/sources/<id>/hierarchy {"name","fields":[...]}` → 200.
- `PUT /api/sources/<id>/entitlements {"field":"<name>"|null,"users":{"<username>":["<value>"]}}` → 200 entitlements.
- `PUT /api/sources/<id>/schedule {"every_minutes":n,"kind":"full|incremental","key":"<field>"|null}` → 200 `{"every_minutes","kind","key","next_run_at"}`. Explorers may call it when the project allows, otherwise 403. `DELETE /api/sources/<id>/schedule` → 204.
- `POST /api/sources/<id>/refresh` (creator, or explorer when allowed) → 200 extract state once the refresh has finished, whether it succeeded or failed.
- `GET /api/sources/<id>/extract` (any member) → 200 `{"state":"live|refreshing|refresh_failed","stale":bool,"last_success_at","last_failure_at","next_run_at","rows":n}`.

**Workbooks, sheets, calculations**
- `GET /api/workbooks` → 200 `[{"id","name","project","state","certified_by"}]` for every workbook the user can open.
- `POST /api/projects/<id>/workbooks {"name","source"}` → 201 `{"id","name","project","source","state":"draft","version":1,"certified_by":null,"sheets":[],"dashboards":[]}`.
- `GET /api/workbooks/<id>` → 200 the same shape with `"sheets":[{"id","name"}]`, `"dashboards":[{"id","name"}]`, `"parameters":[...]`, `"sets":[...]`.
- `POST /api/workbooks/<id>/publish {"project"}` with `If-Match: <version>` → 200 `{"state":"published","project","version","certified_by":null}`. The caller must be a creator in both projects.
- `POST /api/workbooks/<id>/certify` → 200 `{"certified_by":"<username>"}`. 409 `{"error":"not_published"}` on a draft. Certifying again returns the same body.
- **Sheet shape** `{"name","rows":[pill],"columns":[pill],"color":pill|null,"size":pill|null,"label":[pill],"detail":[pill],"filters":[filter],"chart":"automatic|bar|line|scatter|text_table|heat_map","totals":bool,"reference_lines":[{"type":"average|median|constant","value":n|null,"parameter":"<name>"|null}],"trend":bool,"sort":{"<field>":"asc|desc|measure"}}`.
  - A dimension pill is `"<field>"`, or for a date `{"field","level":"year|month|week|day"}`.
  - A measure pill is `{"field","agg":"SUM|AVG|MEDIAN|MIN|MAX|COUNT|COUNT_UNIQUE","table_calc":null|{"kind":"run_total|prev_diff|share|rank","using":"table_across|table_down|pane_down|chosen","fields":[...]}}`.
  - A filter is `{"field","step":"source|context|dimension|top|measure|table_calc","values":[...],"n":n|"@<parameter>","by":measure pill,"min":n|null,"max":n|null,"agg","table_calc"}`.
- `POST /api/workbooks/<id>/sheets` (sheet shape, `If-Match`) → 201 `{"id","version",...sheet}`. `GET /api/sheets/<id>` → 200 sheet with `"calculations":[{"id","name","formula"}]`. `PUT /api/sheets/<id>` (sheet shape, `If-Match`) → 200. A wrong or missing `If-Match` gets 409 `{"error":"stale_version","version":n}`. Workbook sheets compare against the workbook version, and copies against their own version.
- `POST /api/sheets/<id>/copy` (explorer or creator) → 201 a personal copy owned by the caller with `"version":1`. It is visible only to them and does not change the workbook version.
- `POST /api/sheets/<id>/query?gen=<n> {"filters":[filter],"parameters":{"<name>":value},"sets":{"<name>":[member]}}`. `filters` adds to the sheet's saved filters.
  - 200 `{"gen":n,"chart":"none|bar|line|scatter|text_table|heat_map","columns":[{"name":"<caption>","role":"dimension|measure"}],"rows":[[...]],"total":null|[...],"reference_lines":[{"type","value"}],"trend":null|{"slope","intercept"},"notices":["<notice>"]}`. `rows` holds one row per mark in mark order, with raw values (shares as fractions, null as null, dates `YYYY-MM-DD`, months `YYYY-MM`).
  - A shelf refusal or limit gets 422 `{"error":"view_refused","message":"<View notice copy>"}`.
  - Every sheet query from a page uses this route, with `gen` counting up from 1 per sheet per page load.
- `POST /api/sheets/<id>/members {"field","step","filters","parameters"}` → 200 `{"members":[...]}`, the field's members from rows that pass every step before the filter's step.
- `POST /api/sheets/<id>/calculations {"name","formula"}` → 201 `{"id","name","formula"}`. `PUT /api/calculations/<id> {"name","formula"}` → 200. 422 `{"error":"invalid","errors":{"formula":"<formula error>"}}` or `errors.name`. Explorers write only to their own copies, otherwise 403.
- `POST /api/formula/check {"sheet","formula"}` → 200 `{"valid":true,"type":"number|text|date|boolean","aggregate":bool}` or `{"valid":false,"message","line":n|null,"column":n|null}`. Rate limited by `LOZ_FORMULA_RATE`.
- `POST /api/workbooks/<id>/parameters {"name","type":"number|text|list","value","values":[...]}` → 201. `PUT /api/parameters/<id>` → 200.
- `POST /api/workbooks/<id>/sets {"name","field","members":[...]}` or `{"name","field","top":{"n":n|"@<parameter>","by":measure pill}}` → 201. `PUT /api/sets/<id>` → 200.

**Dashboards**
- `POST /api/workbooks/<id>/dashboards {"name","layout","floating":[{"sheet","x","y","w","h"}],"phone_order":[sheet id],"phone_heights":{"<sheet id>":n},"actions":[action]}` → 201 `{"id",...,"objects":[{"sheet","name","x","y","w","h","floating":bool}]}`.
  - `layout` is `{"type":"horizontal|vertical","children":[{"sheet","fixed":n|null}|{"type","children":[...]}]}`.
  - An action is `{"name","type":"filter|highlight|set_parameter|change_set","source","targets":[...],"field","parameter":null|"<name>","set":null|"<name>"}`.
  - 422 `errors.sheets`, `errors.layout` or `errors.actions` with their messages.
- `GET /api/dashboards/<id>` → 200 the same shape with computed `objects`. `PUT /api/dashboards/<id>` (`If-Match`) → 200.

**Alerts and inbox**
- `POST /api/sheets/<id>/alerts {"name","measure":measure pill,"above":n}` → 201 `{"id","name","above","armed":true}`. Any member who can open the sheet may subscribe themselves.
- `GET /api/inbox` → 200 `{"unread":n,"items":[{"id","text","created_at","read"}]}`, newest first. `POST /api/inbox/read` → 200 `{"unread":0}`. Opening `/inbox` calls it.

**Exports**
- `POST /api/exports {"kind":"pdf|png|csv","sheet"|"dashboard":id,"filters":[filter],"parameters":{...}}` → 202 `{"id","kind","status":"queued","progress":0}`. When the same user sends the same kind, target, filters and parameters while that job is queued or rendering, the answer is 200 with that job.
- `GET /api/exports/<id>` → 200 `{"id","kind","status":"queued|rendering|ready|failed","progress":0|50|100,"download":null|"/api/exports/<id>/file"}`.
- `GET /api/exports/<id>/events` → `text/event-stream`. It sends one `state` event `{"status","progress"}` for the current state and each later state, then a final event `end` with data `{"status":"<ready|failed>"}`, and closes.
- `POST /api/exports/<id>/retry` → 202 job back in `queued`. 409 `{"error":"not_failed"}` unless the job has failed.
- `GET /api/exports/<id>/file` → 200 with `application/pdf`, `image/png` or `text/csv; charset=utf-8` and `Content-Disposition: attachment; filename="<target name>.<pdf|png|csv>"`. 409 `{"error":"not_ready"}`. 503 `{"error":"storage_unavailable"}`.

**Grading routes** (exist only when `LOZ_GRADING=1`; otherwise every one answers 404 `{"error":"not_found"}`; no sign-in needed):
- `POST /api/grading/seed` → 201 with ids. The body may contain any of:
  - `"users":[{"username","password"}]`
  - `"projects":[{"name","members":{"<username>":"<role>"},"explorers_schedule":bool}]`
  - `"sources":[{"name","project","sample":"fernhollow"}|{"name","project","rows":n}|{"name","project","tables":[{"name","csv"}],"relation":{...}}]`
  - `"entitlements":[{"source","field","users":{"<username>":[...]}}]`
  - `"workbooks":[{"name","project","source","state":"draft|published","certified_by":null|"<username>","parameters":[...],"sets":[...],"sheets":[sheet shape plus "calcs":[{"name","formula"}]],"dashboards":[dashboard body with sheets named]}]`
  - `"schedules":[{"source","every_minutes","kind","key"}]`
  - `"alerts":[{"username","workbook","sheet","name","measure","above"}]`
  - `"extracts":[{"source","state":"live|refresh_failed","last_success_at","last_failure_at"}]`

  Records refer to each other by name, and the call adds to what exists. It returns `{"users":{"<name>":"<id>"},"projects":{...},"sources":{...},"workbooks":{...},"sheets":{"<workbook>/<sheet>":"<id>"},"dashboards":{"<workbook>/<dashboard>":"<id>"},"parameters":{...},"sets":{...},"alerts":{...}}`.
- `POST /api/grading/session {"username"}` → 200 and sets the session cookie for that user in the calling browser context.
- `POST /api/grading/clock {"set":"<ISO>"}` or `{"advance_ms":n}` → 200 `{"now":"<ISO>"}`. After a `set`, the server clock stays fixed and moves only by `advance_ms`. Due refreshes and alert checks run before the answer, then a `clock` event is broadcast.
- `POST /api/grading/storage {"down":bool}` → 200 `{"down":bool}`, which simulates an object storage outage without a restart.
- `POST /api/grading/source-file {"source","table","csv"}` → 200. It stores those bytes as the table's current file, as `PUT /api/sources/<id>/tables/<table>` does.
- `POST /api/grading/refresh-failure {"source","times":n}` → 200. The next `n` refreshes of that source fail.
- `POST /api/grading/exports {"paused":bool}` → 200. While paused, jobs stay `queued`.

### Business rules (DP-02 to DP-40)

#### Display (owning rule for every number)

- **Numbers** show comma thousands and at most 2 decimals, rounded half away from zero, with no trailing zeros: `1,320`, `101.67`, `108.33`, `-135`.
- **Shares** show as a percent with at most 1 decimal and no trailing zero: `33.5%`, `25%`.
- **Null** shows as `(null)` and sorts last. Dates show as `YYYY-MM-DD`, months as `YYYY-MM`, years as `YYYY`, and weeks as the date of their Monday.
- **Calculation.** Every computed value is an IEEE double, first rounded to 9 decimals, before any display rounding.
- **`data-value`.** On marks and twin cells, `data-value` holds the value rounded half away from zero to 4 decimals with no thousands separator and no trailing zeros. Shares are fractions (`0.3346`). It is empty for null.
- **Captions.** A measure's caption is the field name when aggregated with SUM, otherwise `{AGG} {field}` (for example `AVG Sales`). With a table calculation it is `{Calculation} of {caption}`, using the Calculation menu words (for example `Percent of total of Sales`, `Rank of Sales`). A calculation's own name is its field name. Captions are used in pills, twin headers, tooltips, mark labels, the legend, PDFs and CSVs.

#### Data sources (DP-01 to DP-06)

- **Parsing.** Files are UTF-8 with RFC 4180 quoting, and the first line is the header. A final empty line after the last line break is ignored.
- **Nulls and types.** A null is an empty cell, or `NA` or `null` in any case. Each column's type is inferred from its non-null values, taking the first rule that holds:
  1. Every value is one of `true false yes no` in any case: boolean.
  2. Every value matches an optional `-`, digits, then optionally `.` and digits: number.
  3. Every value is `YYYY-MM-DD` or an ISO 8601 timestamp with an offset: date.
  4. Otherwise: text.

  A column of all nulls is text. Inference depends only on the bytes, so the same file always gives the same types.
- **Defaults.** Number columns default to measures and every other column to dimensions. Dates default to continuous, numbers on a dimension are discrete, and everything else follows its kind.
- **Upload errors.** A file with any error stores nothing. If the size is over the limit, the only error is `File is {n} bytes. The limit is {max}.`. Otherwise, if the file has no bytes or only a header, the only error is `File is empty.`. Otherwise the list holds, in line order:
  - `Line 1: duplicate column name "{x}".` (exact, case-sensitive match)
  - `Line 1: column {n} has no name.` (an empty header cell, 1-based)
  - `Line {n}: expected {m} fields, found {k}.`
  - `Line {n}: unterminated quote.` (at the line where the quote opened; parsing stops there)

  Then comes `Table has {n} rows. The limit is {max}.` when data rows exceed `LOZ_ROW_MAX`. Each line has at most one error. `{n}` is the physical line where the record starts. Exactly `LOZ_CSV_MAX_BYTES` bytes and exactly `LOZ_ROW_MAX` rows are allowed.
- **Versions.** A source holds one or two tables. Each successful upload or file replacement stores the bytes and bumps the source version by 1. The first upload of a table loads its extract snapshot at once.
- **Join.** Relating two tables is a left join from the first table to the second on one key column from each, and the key types must match. A left row with no match keeps every left field and gets null right fields. If a right key appears more than once, the first line is kept and the source shows the join notice. A measure from the right table is aggregated once per distinct right key within each mark, never once per joined row. For example, with the seed data at start, SUM(Target) by Region is East 700, North 1,400, South 400, West 600 and (null) (null), never North 4,600.
- **Rename and hide.** Renaming changes a field's name everywhere at once, because formulas store field ids and show current names. A hidden field leaves the field list and every export, and any sheet using it shows the hidden-field notice.

#### Fields (DP-08, DP-10)

- **Kind.** `button "Change kind of {field}"` switches a field between dimension and measure.
- **Date levels.** A date pill has a level, Month by default. All date work uses UTC, and a timestamp with an offset is converted to UTC first. Weeks start on Monday. For example, `2027-01-03T23:30:00-05:00` falls in the week starting 2027-01-04.
- **Bins.** A bin size is a whole number of at least 1. A value's bin start is `floor(x / size) * size`, and its label is `{start} to {start + size - 1}`. Null stays `(null)`. The bin field is named `{field} (bin)` and is a discrete dimension sorted by start. For example, with the seed data at start, Units at size 3 gives `0 to 2` 5 rows, `3 to 5` 6 rows, `6 to 8` 4 rows and (null) 1 row.
- **Groups.** A group field named `{field} (group)` shows each grouped member as its group's name and leaves the other members as they are. For example, with the seed data at start, `Morning teas` = Ember Assam + Dusk Blend gives SUM(Sales) 600, with Moss Sencha 450 and Quiet Mint 270 unchanged.
- **Drill.** A source has at most one drill hierarchy. The sample's is `Geography`: Region, then Stockist. Expanding a hierarchy pill inserts the next level right after it on the same shelf. Collapsing removes the lower levels.

#### View builder (DP-09 to DP-11)

- **Placing measures.** A measure placed on a shelf defaults to SUM. Rows and Columns each hold at most one measure. Label and Detail hold any number of fields. Color and Size hold one each.
- **Automatic chart type.** Automatic picks the chart from this table, first match. D is a discrete field, M a measure and T a continuous date.

| Rows | Columns | Color | Draws |
|---|---|---|---|
| empty | empty | any | nothing (the view empty state) |
| M | M | any | Scatter |
| M | T | any | Line |
| M | D | any | Bar |
| D | M | any | Bar |
| D | D | M | Heat map |
| anything else | | | Text table |

- **Refusals.** Checked in this order, the first that applies shows in `status "View notice"`:
  1. `One measure per axis. Remove {field} or place it on Label.`
  2. `Line needs a date on Columns and a measure on Rows.`
  3. `Scatter needs a measure on Rows and on Columns.`
  4. `Heat map needs a measure on Color.`
  5. `Size works with Scatter only.`
  6. `Size needs a measure.`

  Refusals 2 to 4 apply only when that chart type is chosen explicitly.
- **Dimensions of a mark.** A view's dimensions are the dimension pills on Rows, Columns, Detail and Color, and each mark is one combination of their values that exists in the rows. A Color dimension on a bar chart stacks the bars in Color member order along the value axis, and each segment is one mark.

#### Chart grammar (DP-12, DP-13)

- **Ticks.** Value axes always include 0. With `lo` = min(0, smallest value) and `hi` = max(0, largest value):
  - `raw = (hi - lo) / 4` and `e = 10^floor(log10(raw))`.
  - The step is the first of 1, 2, 5 or 10 times `e` that is at least `raw`.
  - Ticks run from `floor(lo / step) * step` to `ceil(hi / step) * step`.
  - When every value is 0 or null, the ticks are 0 and 1.

  Each tick label is an SVG text element carrying `data-tick`, using the display rule. For example, 435, 480, 60, 325 gives step 200 and ticks 0, 200, 400, 600.
- **Scale.** The plot area is the SVG rectangle carrying `data-plot`. A bar runs from 0 to its value. Its length divided by the plot's length along the value axis equals `value / (last tick - first tick)` when the first tick is 0 (generally `(value - first tick) / (last tick - first tick)` for its far end), within 1 pixel. Bands follow mark order, with equal thickness. Points sit at their values on both axes.
- **Categorical colour.** Members take colours in member order, cycling through these red, green, blue channel triples:
  1. bubblegum `233, 71, 159`
  2. plum `26, 10, 20`
  3. lime `217, 225, 63`
  4. mauve `110, 74, 94`
  5. mid pink `234, 160, 205`

  Patterns cycle in the same order: `solid`, `dots`, `stripes`, `checks`, `rings`. Without a Color field every mark takes the first colour and `solid`. Each mark carries `data-color` (its channel triple, written as above) and `data-pattern`.
- **Sequential colour.** A Color measure gives `t = (v - min) / (max - min)` over the non-null values. Each channel is `low + (high - low) * t`, rounded half up, with low = blush `253, 241, 247` and high = bubblegum `233, 71, 159`. The result goes in `data-color`. For example, with the seed grid over 30 to 280, 150 gives `243, 159, 205` and 210 gives `239, 119, 184`. A null mark is drawn as an outline only, with empty `data-color` and the text `(null)`.
- **Legend.** `list "Legend"` has one `listitem` per member with the text `{member}`, or for a sequential scale one item `{min} to {max}`.
- **Sort.** Dimensions sort ascending by default: text by Unicode code point, numbers numerically, dates by time, false before true, nulls last. `button "Sort {field}"` cycles ascending, then descending, then by the first measure descending, then back to ascending. Ties sort by the dimension ascending.
- **Marks.** Each mark is one SVG element with:
  - `role="button"` and a roving `tabindex`
  - `data-mark`: its dimension values joined by ` | `, or `all` when the view has no dimension
  - `data-dims`: the same values
  - `data-measure`: the axis measure's caption (on a heat map the Color measure, on a text table the first measure)
  - `data-value`
  - `aria-pressed`
  - `aria-label`: `{dimension values joined by ", "}, {caption} {display value}, {shape} {i} of {n}`, for example `East, Sales 435, bar 1 of 4`

  Shapes are `bar`, `point` (line and scatter), `cell` (heat map) and `text` (text table). Mark order is top to bottom by Rows, then left to right by Columns, following the sort.
- **Tooltip.** The tooltip text is every dimension then every measure as `{caption}: {value}`, joined by `; `, for example `Region: East; Sales: 435`. Exactly one tooltip exists while shown.
- **Data table twin.** `grid "{sheet name} table"` in `region "Data table"`:
  - Column headers are the dimensions (Rows, Columns, Detail, Color order), then the measures (Rows, Columns, Color, Size, Label, Detail order).
  - Each mark is one row in mark order: a `rowheader` per dimension value and a `gridcell` per measure carrying `data-value`.
  - With totals on, a row follows with `rowheader "Grand total"` and one cell per measure. Every dimension cell after the first in that row is empty.
  - Then each reference line is a row, with rowheader `Average`, `Median` or `Constant` and its value under its measure.
  - Then, with the trend line on, a row with rowheader `Trend` and one cell `y = {slope}x + {intercept}`, using `- ` before a negative intercept, for example `y = -90x + 530` and `y = 24.92x - 10.02`.

#### Calculation language (DP-14 to DP-17)

- **Grammar**, precedence lowest first: `OR`; `AND`; `NOT`; comparisons `= <> < <= > >=`; `+ - &` (`&` joins text); `* / %`; unary `-`. Parentheses group.
- **Literals.** Numbers, `'text'` (with `''` for a quote), `TRUE`, `FALSE`, `NULL`. A field is `[Name]`, a parameter `[@Name]` and a set `[Set name]` (true when the row's member is in the set).
- **Case.** Keywords and functions are upper case only. A lower-case name followed by `(` is an unknown function.
- **Types.** Number, text, date and boolean.
- **Null rules.** Arithmetic, `&` and comparisons with null give null. `x / 0` and `x % 0` give null. `NOT NULL` is null, `TRUE OR NULL` is true and `FALSE AND NULL` is false. `IF` treats a null condition as false. `%` keeps the dividend's sign (`-7 % 3` is -1).
- **The 27 functions.** Examples use the sample.
  - **Aggregates** ignore nulls. SUM, AVG, MEDIAN, MIN and MAX over no values give null, and COUNT gives 0.
    - `SUM([Sales])` 1,320
    - `AVG([Sales])` 88
    - `MEDIAN([Sales])` 80
    - `MIN([Sales])` 20
    - `MAX([Sales])` 210
    - `COUNT([Sales])` 15 (and `COUNT([Order])` 16)
    - `COUNT_UNIQUE([Product])` 4
  - **Logic**
    - `IF([Units] > 4, 'big', 'small')` gives `small` on Order 1 and on Order 16
    - `IFNULL([Sales], 0)` gives 0 on Order 16
    - `ISNULL([Units])` is true on Order 16
  - **Number**
    - `ABS(-135)` 135
    - `ROUND(-2.5, 0)` -3 (half away from zero)
  - **Text** (case-sensitive)
    - `UPPER('Moss Sencha')` `MOSS SENCHA`
    - `LOWER('Moss Sencha')` `moss sencha`
    - `LEN('Quiet Mint')` 10
    - `LEFT('Ember Assam', 5)` `Ember`
    - `RIGHT('Ember Assam', 5)` `Assam`
    - `CONTAINS('Dusk Blend', 'Blend')` true
  - **Date**
    - `PART_OF(d, 'year|month|week|day|weekday')`. The week is the ISO week number, and weekday runs Monday 1 to Sunday 7. On Order 5 (2027-01-20) it gives year 2027, month 1, week 3, day 20, weekday 3.
    - `TRUNC_TO(d, 'year|month|week')` gives the first date of the period: Order 5 gives 2027-01-01, 2027-01-01 and 2027-01-18.
    - `DAYS_BETWEEN(a, b)` gives whole UTC days from a to b: `DAYS_BETWEEN(TRUNC_TO([Date], 'month'), [Date])` on Order 16 is 15.
  - **Convert**
    - `NUM('12.5')` 12.5, `NUM('tea')` null
    - `TEXT(12.5)` `12.5`, and a date gives `YYYY-MM-DD`
  - **Table calculations** take one aggregate and follow the table calculation rules: `RUN_TOTAL(agg)`, `PREV_DIFF(agg)`, `SHARE(agg)`, `RANK_OF(agg)`. In a formula they compute Table across unless the pill says otherwise.
- **Nodes and depth.** Each field, parameter, set reference, literal, operator and function call is one node. Parentheses are not nodes. Depth counts open levels: each parenthesis group, function argument list and level-of-detail brace opens one level.
- **Errors.** Checks run in this order, and only the first error found is reported. Line and column are 1-based and point at the start of the offending token. A calculation named in another formula counts in place.
  1. `Formula is {n} characters. The limit is {max}.` (`LOZ_FORMULA_MAX_CHARS`; exactly the limit is allowed; no line or column)
  2. `Line {l}, column {c}: unexpected "{token}".`, or at the end of the text `Line {l}, column {c}: formula ended early.` (the column just after the last character)
  3. `Line {l}, column {c}: nested deeper than {max} levels.` (at the token opening level `LOZ_FORMULA_MAX_DEPTH` + 1)
  4. `Line {l}, column {c}: unknown field "{name}".`, `Line {l}, column {c}: unknown function "{name}".`, `Line {l}, column {c}: unknown parameter "{name}".`
  5. `Line {l}, column {c}: {fn} expects {n} arguments, found {m}.`
  6. `Line {l}, column {c}: {fn} argument {i} must be {type}, found {type}.`, where operators use their symbol as `{fn}` and level-of-detail dims use `AT`, `PLUS` or `MINUS` with type `dimension`; and `Line {l}, column {c}: cannot compare {type} with {type}.`
  7. `Line {l}, column {c}: cannot mix aggregate and row values.`, at the first row-level field outside every aggregate in a formula that has an aggregate, at an aggregate inside another aggregate, or at a non-aggregate argument of a table calculation
  8. `Line {l}, column {c}: a level-of-detail expression cannot contain another.`, and `Line {l}, column {c}: a table calculation cannot appear inside a level-of-detail expression.`
  9. `Cycle: {a} -> {b} -> {a}.`, on save only, listing the chain from the calculation being saved back to itself, for example `Cycle: A -> B -> C -> A.`

  For example:
  - `SUM([Salez]) +` gives `Line 1, column 15: formula ended early.`
  - `SUM([Salez])` gives `Line 1, column 5: unknown field "Salez".`
  - `SUM([Product])` gives `Line 1, column 5: SUM argument 1 must be number, found text.`
  - `SUM([Sales]) / [Units]` gives `Line 1, column 16: cannot mix aggregate and row values.`
- **Saving.** Calculations may refer to other calculations on the same sheet. Saving a cycle is refused with 422.
- **Bounded work.**
  - **Work.** Before a query runs, its work is the source's row count times the nodes in the row-level part of every formula the view uses. The row-level part is the whole formula when it has no aggregate, otherwise the nodes inside aggregate arguments. Above `LOZ_QUERY_WORK_MAX` the query is refused with the work notice, and exactly the limit is allowed. For example, on a 50,000-row source a formula with 101 nodes is 5,050,000 steps and is refused, while one with 100 nodes runs.
  - **Time.** A query still running at `LOZ_QUERY_BUDGET_MS` stops with the time notice.
  - **Marks.** More than `LOZ_MARK_MAX` marks gives the mark notice, and exactly the limit draws.
  - **Speed.** Every refusal answers within `LOZ_QUERY_BUDGET_MS`. A formula check answers within one second for any formula up to the JSON body limit.
  - **Isolation.** While one user's query runs, another user's query on a small source answers within one second.

#### Level of detail (DP-18)

- **Forms.** Only four forms exist: `{AT dims : agg}`, `{PLUS dims : agg}`, `{MINUS dims : agg}` and `{agg}`. `dims` is a comma list of dimension fields.
- **Levels.** AT computes at exactly those dims. PLUS computes at the view's dimensions plus those. MINUS computes at the view's dimensions minus those. `{agg}` is AT with no dims. Each gives one number per source row at its level.
- **On a shelf** the result is a measure with default aggregation AVG, and rows whose value is null are ignored.
- **Worked examples**, with Rows Region and the source filter Region is not null:
  - `{AT [Region] : SUM([Sales])}` gives East 435, North 480, South 60, West 325.
  - `{SUM([Sales])}` gives 1,300 on every mark.
  - `{PLUS [Product] : SUM([Sales])}` with AVG gives East 145, North 135, South 30, West 108.33. North's six rows hold 210, 50, 210, 100, 120, 120. With MAX, North is 210.
  - With Rows Region and Columns Category, `{MINUS [Category] : SUM([Sales])}` gives East/Black 435 and North/Herbal 480.

#### Table calculations (DP-21, DP-22)

- **Compute using.** With view Rows r1..rk and Columns c1..cm:
  - Table across partitions by the Rows dimensions and addresses the Columns.
  - Table down partitions by the Columns and addresses the Rows.
  - Pane down partitions by the Columns and every Rows dimension but the innermost, and addresses the innermost.
  - Chosen fields addresses the checked fields and partitions by the rest.

  Order within a partition is the view's sort. Only existing marks take part, and nothing restarts other than the partition.
- **Running total** (`RUN_TOTAL`) is the sum so far in the partition. A null cell shows null and adds nothing.
- **Difference from previous** (`PREV_DIFF`) is the value minus the previous mark's value. The first mark of a partition is null, and any null operand gives null.
- **Percent of total** (`SHARE`) is the value divided by the partition's sum of non-null values.
- **Rank** (`RANK_OF`) ranks by value descending. Ties take the same rank and the next rank skips (1, 2, 2, 4). Null is unranked and shows null.
- **Worked examples** on the seed Region by Category grid with the source filter Region is not null:
  - Running total, Table across: East 150, 360, 435; South (null), 30, 60; West 280, 325.
  - Running total, Table down: Black 150, 300, (null), 580; Herbal 75, 195, 225, 270.
  - Difference from previous, Table across: East (null), 60, -135; South (null), (null), 0; West (null), -235.
  - Percent of total, Table down, Black: 25.9%, 25.9%, (null), 48.3%.
  - Rank, Table down, Black: East 2, North 2, South (null), West 1.
  - Rank, Chosen fields Region and Category: 280 is 1, each 210 is 2, each 150 is 4, 120 is 6, 75 is 7, 45 is 8, each 30 is 9, and South Black is (null).
  - Rows Tier then Stockist with SUM(Sales), Running total, Pane down: Gold 300, 735, 1,060; Silver 180, 240. Table down on the same view: 300, 735, 1,060, 1,240, 1,300.

#### Query order (DP-19, DP-20)

**Steps.** Every query, for every surface, runs in exactly this order:
1. row-level security
2. data source filter
3. context filter
4. AT expressions and `{agg}`
5. dimension filter and top N (one step)
6. PLUS and MINUS expressions
7. aggregation
8. measure filter
9. table calculation
10. table calculation filter
11. totals and reference lines

**Filter rules.**
- **Member lists.** A filter's member list comes from rows that pass every step before the filter's step.
- **Context filters.** A sheet has one context filter set: every filter marked as context forms it.
- **Top N and dimension filters.** Top N and dimension filters in step 5 do not see each other, and a row stays only when it passes both. Top N ties at the cut-off are broken by the member, ascending, so exactly N members stay.
- **Ranges.** Measure and table calculation filters keep marks whose value is at least "At least" and at most "At most" (both inclusive, either may be empty).
- **Totals.** A total applies the pill's aggregation to the underlying rows of the marks left, never adding visible values. A table calculation column's total shows `n/a`.
- **Reference lines** use the marks left.
- **Dashboard filters.** A dashboard filter action is a dimension filter on its target.

**Worked examples**, one per neighbouring pair. Each uses Rows Region and SUM(Sales) with the source filter Region is not null, unless stated:
1. A source filter Category Green leaves only `Moss Sencha` in a context filter's Product list.
2. Context filter Product Quiet Mint: `{AT [Region] : SUM([Sales])}` gives East 75, North 120, South 30, West 45.
3. Dimension filter Product Quiet Mint: SUM(Sales) gives 75, 120, 30, 45 while the AT value stays 435, 480, 60, 325.
4. Top 1 Region by SUM(Sales) with a dimension filter Category Black gives North 150. Moving the Category filter to context gives West 280.
5. Dimension filter Category Black: `{PLUS [Product] : SUM([Sales])}` with AVG gives East 150, North 75, South (null), West 140. With Rows Region, Columns Category and a dimension filter Product Quiet Mint, `{MINUS [Category] : SUM([Sales])}` gives East/Herbal 75, against an AT value of 435.
6. The unfiltered PLUS gives North 135 with AVG and 210 with MAX.
7. A measure filter SUM(Sales) at least 300 removes South. No single row reaches 300, because the filter reads the mark.
8. Percent of total, Table down, after that filter gives East 35.1%, North 38.7%, West 26.2%. Without the filter it gives East 33.5%, North 36.9%, South 4.6%, West 25%.
9. With SUM(Sales) on Columns and, on Label, SUM(Sales) as Rank and SUM(Sales) as Percent of total (both Table down), a table calculation filter Rank at most 2 leaves North 1 and East 2, and the share alongside stays 36.9% and 33.5%.
10. On that view with totals on, the Sales total is 915 and the rank and share totals show `n/a`. Adding AVG(Sales) on Label shows North 80 and East 145 with a total of 101.67 (915 over 9 rows), never 112.5. An Average reference line of the SUM marks is 457.5.

#### Parameters, sets and lines (DP-23 to DP-25)

- **Parameters** are number, text or list (a fixed list of text values). A parameter can be used as `[@name]` in formulas, as a filter value, as a Top N count and as a constant line value. A viewer's value change applies to their page only and is sent with each query.
- **Sets** are chosen members of one dimension, or Top N members of it by a measure, where N may be a parameter. A Top N set is computed at the top N step from rows passing the steps before it. In a formula, `[Set name]` is true or false. On a shelf, a set shows the members `In` and `Out`.
- **Reference lines.** Average is the mean of the mark values, Median the middle value (the mean of the middle two for an even count), and Constant a number or a number parameter. Each is an SVG line carrying `data-ref`.
- **Trend line.** Least squares over non-null points: `slope = sum((x - mx)(y - my)) / sum((x - mx)^2)` and `intercept = my - slope * mx`. On a Line chart x is the 0-based mark index. On a Scatter x is the Columns value.
- **Worked examples:**
  - Bars 435, 480, 60, 325 have Average 325 and Median 380.
  - Monthly SUM(Sales) over all rows (485, 530, 305) gives `y = -90x + 530`.
  - A Scatter of SUM(Units) on Columns against SUM(Sales) on Rows, with Detail Order and all rows, gives `y = 24.92x - 10.02`.
  - With parameter `Top count` at 2, set `Top regions` is Top `[@Top count]` Region by SUM(Sales), so In is North and East. Calculation `COUNT([Order]) - [@Top count]` with Rows Region and the source filter Region is not null gives East 1, North 4, South 1, West 1, and a Constant line on `Top count` reads 2.
  - At 3, In is North, East and West, the calculation gives 0, 3, 0, 0, and the line reads 3.

#### Dashboards (DP-26, DP-27)

- **Size.** A dashboard holds 2 to 4 sheets on a desktop stage of 1280 by 800. Containers are horizontal or vertical and nest at most one level.
- **Sizing.** The gap between children is 8. A container's inner length is `length - 8 * (children - 1)`. Fixed children take their size, and the flexible children split what remains equally, rounded down. Any leftover pixels go one each to the first flexible children. A hidden child takes no length and no gap. Floating objects keep their own x, y, w and h above the tiled ones.
- **Attributes.** Every object region carries whole-pixel `data-x`, `data-y`, `data-w` and `data-h` in stage coordinates.
- **Worked example.** Three flexible sheets across 1280 are 422, 421 and 421 wide, at x 0, 430 and 859. Hiding the middle one gives 636 and 636.
- **Phone layout.** Below 768 pixels wide, each object listed in `phone_order` stacks in that order in one full-width column at its `phone_heights` height. Objects not listed are absent. From 768 up, the desktop layout applies. At 360 pixels the page's scroll width is at most its client width.

#### Actions (DP-28 to DP-30)

- **Effects.** Each action has a name, a source sheet, target sheets and a field.
  - A filter action limits targets to the selected values as a dimension filter.
  - A highlight action leaves target marks in place. It marks those not matching with `data-dim="true"` and the matching twin rows with `data-highlight="true"`. The field must be a dimension in every target view.
  - A set parameter action puts the mark's field value in the parameter.
  - A change set action makes the mark's member the set's only member.
- **Order.** Selecting a mark runs the source sheet's actions in this order: set parameter, change set, filter, highlight, alphabetically by name within each type.
- **Action log.** `log "Action log"` lists the last selection's runs as `{n}. {type}: {name}`, with type words `Set parameter`, `Change set`, `Filter` and `Highlight`, for example `1. Set parameter: Pick region`.
- **Clearing** (Escape or a click on empty plot space) removes filters and highlights, returns sets to their members from before the selection, keeps parameters at their last value and empties the log.
- **Latest selection wins.** Every affected sheet is queried with a new `gen`. A response whose `gen` is lower than that sheet's newest is dropped and never applied. The sheet stays busy until its newest answer arrives. The selection announcement is made once every affected sheet has applied its newest answer.

#### Publishing, roles and row-level security (DP-31 to DP-34)

- **Accounts.** A username is 3 to 24 characters of `a-z 0-9 _`, stored in lower case, and the password is at least 8 characters. The session cookie is `loz_session` (`HttpOnly; SameSite=Lax`, no `Secure`). Sign-ins are limited per username per minute by `LOZ_LOGIN_RATE`, formula checks per user per minute by `LOZ_FORMULA_RATE`, and queries per user per minute by `LOZ_QUERY_RATE`.
- **Projects** are private and seen only by members. Roles:
  - **Viewer:** opens published workbooks and dashboards, filters, selects, changes parameters, exports and subscribes to alerts.
  - **Explorer:** as viewer, plus copies sheets, edits their own copies and their calculations, reads source pages, and schedules or refreshes extracts when the project's explorers-schedule setting is on.
  - **Creator:** everything, including uploads, fields, relations, entitlements, workbooks, dashboards, members, publishing and certifying.
- **Workbook states.** A workbook starts as `draft`, seen only by creators. Publishing moves `draft -> published` into the chosen project. Publishing a published workbook again keeps it `published` and clears its certification. There is no path back to draft. Publishing needs `If-Match` with the current workbook version, and every change to the workbook or its sheets, dashboards, parameters, sets or calculations bumps that version by 1.
- **Certification.** A creator certifies a published workbook. The certification holds until the next publish.
- **Row-level security.** A source can be secured by one field (the security field) and a table of usernames to allowed values.
  - A user sees only rows whose security field is one of their values. A user with no entry sees no rows and the no-rows notice. A null security value is shown to nobody. No role is exempt.
  - Security applies first in the query order, so it holds for marks, totals, filter lists, tooltips, set members, AT and `{agg}` values, reference and trend lines, alerts, CSV, PDF and PNG.
  - For example, with the seed data at start and `south_rep` entitled to South: by Category, Black (null), Green 30 and Herbal 30, total 60. The Stockist filter list is only `Dune Mug`. The Product list is `Ember Assam`, `Moss Sencha` and `Quiet Mint`. `{SUM([Sales])}` is 60, `{AT [Region] : SUM([Sales])}` is 60, and a Top 2 Stockist set holds only `Dune Mug`.

#### Extracts and alerts (DP-35 to DP-37)

- **States.** `live -> refreshing -> live` on success, and `refreshing -> refresh_failed` on failure, with the last good snapshot staying in use. `refresh_failed -> refreshing` on the next attempt. A refresh asked for while one runs waits for it and does not start a second.
- **Schedule.** A source's schedule has `every_minutes` (whole, 1 to 10080), a kind and an optional key.
  - Time is the server clock, never the device clock, which may be wrong.
  - A refresh is due when `now >= last run + interval`. The last run is the last attempt's start, or the schedule's save time if none has run.
  - Several missed intervals run once. `next_run_at` is the last run plus the interval.
  - The server checks due work every second of real time and at once on any grading clock change, and pushes any resulting change within one second.
- **Kinds.** A full refresh replaces the snapshot with the table's current file. An incremental refresh appends rows whose key (a number or date field) is above the snapshot's current maximum and ignores the rest. Either way the new snapshot swaps in within one transaction, so readers see all of it or none of it.
- **Stale.** An extract is stale once `now - last success >= LOZ_STALE_MS`, as computed by the server.
- **Alerts.** An alert watches a measure's whole-table value on a sheet for its subscriber's rows. It is armed when created. After each successful refresh:
  - when the value is above the threshold and the alert is armed, exactly one inbox item is created and the alert disarms
  - when the value is at or below the threshold, the alert rearms

  For example, with the seed data at start and a threshold of 1,400, SUM(Sales) is 1,320 and no item is created. A refresh adding Order 17 with Sales 100 gives 1,420 and `Total sales crossed 1,400: now 1,420.`. A later refresh at 1,500 adds no item. Going down to 1,300 rearms the alert, and 1,450 then gives a second item.

#### Exports (DP-38 to DP-40)

- **States.** `queued -> rendering -> ready`, or `rendering -> failed`. Retry takes `failed -> queued`, and any other retry gets 409. Each step pauses `LOZ_EXPORT_STEP_MS`.
- **Confirmation.** A job becomes `ready` only after object storage confirms the file's write. A failed write, including during an outage, gives `failed`, and a retry succeeds once storage returns, with no restart.
- **Rows and filters.** Every export uses the requesting user's rows and the sent filters and parameters, and never includes a hidden field.
- **PDF.** Real text, line by line:
  1. the sheet or dashboard name
  2. one line per filter: `Filters: {field} is {values joined by ", "}`, `Filters: {field} is at least {min}`, `Filters: {field} is at most {max}`, `Filters: {field} is {min} to {max}` or `Filters: {field} is top {n} by {caption}`; or `Filters: none`
  3. for each sheet, its name, then its twin's header and rows, one row per line with cells joined by ` | `
- **PNG.** `image/png`, 1200 by 800 pixels, drawn on the server from the same marks.
- **Crosstab CSV.** UTF-8 without a byte order mark, with CRLF line ends. The header is followed by the rows exactly as the twin shows them, including `Grand total`, with display numbers written without thousands separators. Fields holding a comma, quote, CR or LF are quoted, with quotes doubled. A text cell beginning with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading `'`. Number cells are never changed. A dashboard crosstab writes each sheet's table in layout order, each block starting with a line holding the sheet name, with one empty line between blocks.

### Services (DP-04, DP-05, DP-35, DP-38)

- **PostgreSQL** (`DATABASE_URL`) holds users, sessions, projects, members, sources, fields, relations, entitlements, workbooks, sheets, calculations, parameters, sets, dashboards, actions, schedules, alerts, inbox items, export jobs and the extract snapshot rows that queries run against. Snapshots swap in one transaction. The app applies its schema idempotently every time it starts.
- **MinIO** (`S3_*`) holds three kinds of object, each written once and read back by the route that serves it:
  - every uploaded file, at `uploads/<source id>/<table>/<sha256>.csv` (the lowercase hex SHA-256 of the exact bytes)
  - images, at `images/<id>`
  - exports, at `exports/<job id>.<pdf|png|csv>`

  An upload or export counts as complete only once the write is confirmed. While MinIO is unreachable:
  - uploads answer 503 `{"error":"storage_unavailable"}` with the upload outage copy
  - refreshes fail and keep the last good snapshot
  - export jobs end `failed`
  - downloads answer 503
  - the health path reports `unavailable`

  Everything else, including queries, keeps working. Each operation tries storage afresh, so service resumes as soon as storage answers, with no restart.

### Seed data (DP-01 to DP-40)

At first start the database holds no users, projects or workbooks. The home page's sample sheet reads the bundled Fernhollow Tea sample. The grading seed route loads the same sample as a source with `{"sample":"fernhollow"}`. Fernhollow Tea, its stockists and every person in it are invented.

`orders.csv`:

```
Order,Date,Stockist ID,Product,Category,Units,Sales
1,2027-01-04,S1,Moss Sencha,Green,4,120
2,2027-01-06,S1,Ember Assam,Black,2,50
3,2027-01-11,S2,Moss Sencha,Green,3,90
4,2027-01-13,S3,Quiet Mint,Herbal,5,75
5,2027-01-20,S3,Ember Assam,Black,6,150
6,2027-02-02,S4,Quiet Mint,Herbal,2,30
7,2027-02-03,S4,Moss Sencha,Green,1,30
8,2027-02-09,S5,Ember Assam,Black,8,200
9,2027-02-10,S5,Dusk Blend,Black,4,80
10,2027-02-17,S1,Dusk Blend,Black,5,100
11,2027-02-24,S2,Quiet Mint,Herbal,6,90
12,2027-03-01,S3,Moss Sencha,Green,7,210
13,2027-03-03,S5,Quiet Mint,Herbal,3,45
14,2027-03-08,S1,Quiet Mint,Herbal,2,30
15,2027-03-15,S9,Dusk Blend,Black,1,20
16,2027-03-16,S4,Ember Assam,Black,,
```

`stockists.csv`:

```
Stockist ID,Stockist,Region,Tier,Target
S1,Alder Cup,North,Gold,900
S2,Birch Kettle,North,Silver,500
S3,Cedar Pot,East,Gold,700
S4,Dune Mug,South,Silver,400
S5,Elm Leaf,West,Gold,600
```

**How the sample loads.** The sample source is named `Fernhollow Tea`. Its tables are `orders` and `stockists`, left joined on `Stockist ID`, with the hierarchy `Geography` (Region, then Stockist). `Order` is set to a discrete dimension. `Date` is a continuous date. `Units`, `Sales` and `Target` are measures.

**Facts at start.**
- 16 rows. SUM(Sales) is 1,320.
- By Region: East 435, North 480, South 60, West 325, (null) 20.
- By Category: Black 600, Green 450, Herbal 270.
- By Product: Dusk Blend 200, Ember Assam 400, Moss Sencha 450, Quiet Mint 270.
- By Stockist: Alder Cup 300, Birch Kettle 180, Cedar Pot 435, Dune Mug 60, Elm Leaf 325.
- By Month: 2027-01 485, 2027-02 530, 2027-03 305.
- Order 15 has no stockist. Order 16 has null Units and Sales.

Region by Category SUM(Sales), with `(no mark)` where no row exists:

| | Black | Green | Herbal |
|---|---|---|---|
| East | 150 | 210 | 75 |
| North | 150 | 210 | 120 |
| South | (null) | 30 | 30 |
| West | 280 | (no mark) | 45 |

**Generated sources.** `{"rows":n}` adds a source with one table `data` holding columns `Id`, `Group` and `Value`. `Id` runs from 1 to n, `Group` is `G` followed by (Id mod 10), and `Value` is Id mod 100.

## Technical requirements

### Deployment (DP-43)

Backend: TypeScript on Node 22 with npm. Frontend: TypeScript built with Node 22 in the same `build` step.

`/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run serve"}
```

The server binds `0.0.0.0` on `APP_PUBLIC_PORT` (4173 when unset), serves the browser app and the API from one origin, and answers the health path at `/api/health`. The lockfile is committed.

### Configuration and secrets (DP-44)

The app reads all of the following once at start:
- `DATABASE_URL`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`
- the published settings below

None is hard-coded, logged or sent to the browser. The bucket is provisioned already, and the app creates it only if it is missing. All timers and limits are read at start:

| Setting | Env var | Default |
|---|---|---|
| Grading routes on (404 when unset) | `LOZ_GRADING` | unset |
| Formula length, characters | `LOZ_FORMULA_MAX_CHARS` | 2000 |
| Formula nesting depth, levels | `LOZ_FORMULA_MAX_DEPTH` | 16 |
| Marks per view | `LOZ_MARK_MAX` | 2000 |
| Query work, steps | `LOZ_QUERY_WORK_MAX` | 5000000 |
| Query time budget, milliseconds | `LOZ_QUERY_BUDGET_MS` | 5000 |
| Rows per table | `LOZ_ROW_MAX` | 50000 |
| CSV size, bytes | `LOZ_CSV_MAX_BYTES` | 20000000 |
| Formula check debounce on page timers, milliseconds | `LOZ_FORMULA_DEBOUNCE_MS` | 300 |
| Stale after, milliseconds | `LOZ_STALE_MS` | 7200000 |
| Export step pause, milliseconds | `LOZ_EXPORT_STEP_MS` | 200 |
| Server events heartbeat, milliseconds | `LOZ_SSE_HEARTBEAT_MS` | 15000 |
| Sign-ins per username per minute | `LOZ_LOGIN_RATE` | 10 |
| Formula checks per user per minute | `LOZ_FORMULA_RATE` | 120 |
| Queries per user per minute | `LOZ_QUERY_RATE` | 600 |

### Server boundary (DP-31, DP-38, DP-43)

- **Origin.** The app is same-origin only: it sends no CORS headers, and state-changing requests must carry the session cookie.
- **Content.** It never serves source files, maps of the source, environment values, credentials or anything outside the built browser bundle, bundled fonts and API answers. App configuration reaches the browser only through `GET /api/config`, never as raw JSON inside an inline script.
- **Boot.** If object storage is unreachable at boot, the app still starts and serves, and recovers on its own as described in Services. If PostgreSQL is unreachable at boot, the app retries the connection every second and answers the health path with its starting response until connected.
- **Clocks.** Business time comes only from the server: a page takes `server_now` from `GET /api/time` and from each `clock` event, and never decides fresh, stale, due or late from the device clock, which may be wrong. Page timers drive only the formula debounce, and Web Animations run on the document timeline.
- **Rendering.** Charts are SVG with one element per mark, never canvas or WebGL. The app registers no service worker.

### Browser support and performance (DP-27, DP-41)

- **Browsers and viewports.** The app works in current Chromium, Firefox and WebKit, at 360x740, 375x812, 768x1024 and 1280x800.
- **Speed.** The home page and a sheet on the sample are usable within three seconds, and a query on the sample answers within one second.
- **Input.** Keyboard, mouse and touch all reach every action.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`.
- IF-02: `THIRD_PARTY_NOTICES.md` names every shipped package and bundled font with its licence. Shipped packages are the production dependency tree from `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package is licensed MIT, Apache-2.0, BSD or ISC, and the bundled fonts are SIL OFL.
- IF-04: The only datastores are the provided PostgreSQL and MinIO. There is no SQLite, embedded database, cache server, queue or state kept in local files.
- IF-05: The browser loads nothing from another origin: fonts, scripts, styles and images are served by the app.
- IF-06: The provided service configuration and its credentials are left as given.
- IF-07: Server and browser source is written in TypeScript.
- IF-08: The PDF and PNG exports are produced by npm libraries inside the app, with no external renderer service.

## Engineering standards

- Code is idiomatic TypeScript with strict typing: no `any` in domain code and no unchecked casts of request bodies.
- Names match this brief's domain terms: source, table, field, shelf, pill, mark, sheet, dashboard, action, extract, snapshot, entitlement, export job, alert, inbox item.
- Each domain rule is decided in exactly one place: the query order, each state machine transition, the display rule, the colour and tick rules, the sizing rule and the error precedence.
- There is no abstraction with a single implementation and no interface that exists only for tests.
- There is no dead, commented-out or unreachable code, and no defensive check for a state the types already rule out.
- Every API error uses the one published error shape.
- Nothing is built beyond this brief: no extra chart types, functions, roles, settings or endpoints.
