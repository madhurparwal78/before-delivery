# TRUTH - Fizzwick Works Lozenge

The brief made concrete, never reinterpreted. `instruction.md` is the only product authority.
Every value says where it came from:

- `brief: <section>` - copied verbatim from that heading of `instruction.md` (headings without their DP list).
- `decided: <why>` - the brief is silent; the value is what `app/src` builds, and the reason ties it to the brief's intent.

Where `DESIGN.md` and `app/src` disagree on a value the brief does not fix, this file records what the code does and
marks the difference.

Provider names used below:

- PostgreSQL tables (from the `CREATE TABLE IF NOT EXISTS` lists in `app/src/server/**`): `users`, `sessions`,
  `projects`, `project_members`, `sources` (holds `relation`, `hierarchy`, `security_field`, `entitlements` as columns),
  `source_tables`, `source_fields`, `extracts` (holds the schedule as `schedule_every`, `schedule_kind`, `schedule_key`,
  `schedule_saved_at`), `snapshot_tables`, `snapshot_rows`, `workbooks`, `parameters`, `sets`, `sheets`,
  `calculations`, `dashboards` (actions live in `body`), `alerts`, `inbox_items`, `export_jobs`.
- MinIO keys (brief: Services; built in `server/sources/ingest.ts` and `server/exports/jobs.ts`):
  `uploads/<source id>/<table>/<sha256>.csv` and `exports/<job id>.<pdf|png|csv>`. `images/<id>` is reserved by the
  brief; no flow writes it.

## 1. Journeys

### J1 Upload and relate (DP-01 to DP-07)

Start: a creator signed in, member of an empty project (no sources). Source: brief: Journeys.

| # | Action | Visible result | Source |
|---|---|---|---|
| 1 | Open `/sources/new` (from `link "Upload a source"` on `/projects/<id>`) | pale ground field; `combobox "Project"`, `textbox "Source name"`, `textbox "Table name"`, `button "Choose file"`, `button "Upload"` | brief: Screens and layout |
| 2 | Choose `orders.csv` | `POST /api/projects/<id>/sources/preview` (`text/csv`) answers 200; `table "Preview"` shows the first 20 data rows; each `columnheader` carries `data-type`: Order `number`, Date `date`, Stockist ID `text`, Product `text`, Category `text`, Units `number`, Sales `number`; `list "Upload errors"` is empty | brief: Data sources, API |
| 3 | Type Source name and Table name `orders`, press `button "Upload"` | `status "Upload state"` shows `Uploading...`, then `Uploaded {table}: {n} rows.` (`Uploaded orders: 16 rows.`); a link to the new source page `/sources/<id>` appears beside it | brief: Feedback states; decided: table name `orders` matches the sample's table names (Seed data); the page stays put so the status stays readable (`pages/upload/index.tsx`) |
| 4 | On the source page press `button "Add table"`, choose `stockists.csv`, name it `stockists`, press `button "Upload"` | `dialog "Add table"` stays open, its status shows `Uploaded stockists: 5 rows.`; the table list behind it gains `stockists` with `link "Download stockists"`; closing returns focus to `button "Add table"` | brief: Public screens and controls |
| 5 | Press `button "Relate tables"`; choose `Stockist ID` in `combobox "Left key"` and `combobox "Right key"`; press `button "Save relation"` | `status "Announcements"` shows `Related {left table} to {right table}.` (`Related orders to stockists.`); `status "Join notice"` stays empty (no duplicate keys in the sample); `table "Fields"` lists the fields of both tables | brief: Feedback states, Data sources |
| 6 | Outage branch: storage down, press `button "Upload"` | API 503 `{"error":"storage_unavailable"}`; `status "Upload state"` shows `Storage is unavailable. Your file was not saved. Try again.` as a full-width banner; the preview stays; `button "Try again"` appears | brief: Feedback states, Services |
| 7 | Storage back, press `button "Try again"` | the same file is resent; `Uploaded {table}: {n} rows.`; no restart | brief: Mandatory requirements (DP-05) |

End state, provider:

| Step | PostgreSQL | MinIO |
|---|---|---|
| preview | nothing | nothing |
| upload `orders` | `sources` insert (version 1); `source_tables` insert (sha256, row_count 16, columns); `extracts` insert (state `live`, `last_success_at` = server now); `snapshot_tables` and `snapshot_rows` written in one transaction; `source_fields` rewritten | `uploads/<source id>/orders/<sha256>.csv` written byte for byte before the transaction |
| add `stockists` | `source_tables` insert; `sources.version` + 1 (to 2); snapshot of `stockists` swapped in; `source_fields` rewritten | `uploads/<source id>/stockists/<sha256>.csv` |
| relate | `sources.relation` set to `{left_table, left_key, right_table, right_key}`; `source_fields` rewritten (and `sources.rev` + 1) | nothing |
| outage upload | nothing (the write fails before any row) | nothing |

Source: brief: Services, Data sources (Versions); decided: table and column names read from `server/sources/ingest.ts`, `server/sources/edits.ts`, `server/sources/repo.ts`.

### J2 Build a sheet (DP-09 to DP-13, DP-42)

Start: a creator on a workbook over the sample source `Fernhollow Tea` (tables `orders` and `stockists`, hierarchy
`Geography`); brief: Seed data.

| # | Action | Visible result | Source |
|---|---|---|---|
| 1 | `button "New sheet"` on `/workbooks/<id>`, sheet opens at `/workbooks/<id>/sheets/<sheet id>` | mid-pink sheet field; `region "View"` shows `Place a field on Rows or Columns.` | brief: Screens and layout, Feedback states |
| 2 | Tab to `listbox "Fields"`, ArrowDown to `option "Region, dimension"`, Enter | `menu "Add to shelf"` opens | brief: Interactions |
| 3 | Arrow to Rows, Enter | pill `button "Region on Rows"`; focus returns to the option; `status "View announcements"` shows `Added Region to Rows.` | brief: Interactions, Feedback states |
| 4 | Drag the `Sales` chip (move at least 4 pixels) over `list "Columns"`, release | `list "Columns"` carries `data-drop="true"` while over it; pill `button "Sales on Columns"` (SUM, caption `Sales`); announcement `Added Sales to Columns.` | brief: Interactions, Display |
| 5 | Read the chart | Automatic draws Bar; with the source filter Region is not null, four bars East 435, North 480, South 60, West 325; ticks for 435, 480, 60, 325 are 0, 200, 400, 600; each bar `data-color="233, 71, 159"` `data-pattern="solid"`; first bar `aria-label` `East, Sales 435, bar 1 of 4` | brief: View builder, Chart grammar |
| 6 | Tab into the chart, focus a mark | exactly one `tooltip`, text `Region: East; Sales: 435` | brief: Chart grammar |
| 7 | Read `region "Data table"` | `grid "{sheet name} table"`, one row per mark, `rowheader` per Region, `gridcell` with `data-value` | brief: Chart grammar |
| 8 | `button "Expand Region"` | Stockist pill inserted after Region on Rows; button becomes `button "Collapse Region"` with focus kept; announcement `Expanded Region.` | brief: Fields (Drill), Feedback states |
| 9 | `button "Collapse Region"` | Stockist pill removed; announcement `Collapsed Region.` | brief: Fields (Drill) |
| - | each redraw | every surviving mark runs one `mark-glide` (240 ms); new and gone marks run none | brief: Motion and effects |

Note: the brief's "four bars" come from the source filter Region is not null used on the home sample (brief: Screens and layout); without it Region has five members. decided: the journey's four bars hold when that source filter is on the sheet.

End state, provider: `sheets` insert (`POST /api/workbooks/<id>/sheets`), then `sheets.shape` updated by each
`PUT /api/sheets/<id>` with `If-Match`; `workbooks.version` + 1 per change. Queries read `snapshot_rows` only.
MinIO: nothing. Source: brief: Publishing (Workbook states), API; decided: `server/sheets/edit.ts`, `server/workbooks/store.ts`.

### J3 Explain a number (DP-14 to DP-22)

Start: an explorer on a published sheet with Rows Region, SUM(Sales) and the source filter Region is not null;
plum field, `button "Copy sheet"`. Source: brief: Screens and layout, Public screens and controls.

| # | Action | Visible result | Source |
|---|---|---|---|
| 1 | `button "Copy sheet"` | `POST /api/sheets/<id>/copy` 201, `"version":1`; the copy opens editable on the mid-pink field | brief: API |
| 2 | `button "New calculation"`, type `{AT [Region] : SUM([Salez])}` | `listbox "Suggestions"` opens on `[`; after `LOZ_FORMULA_DEBOUNCE_MS` (300) `status "Formula check"` shows `Line 1, column 20: unknown field "Salez".` (the `[` of `[Salez]`, as in the brief's `SUM([Salez])` example at column 5) | brief: Interactions, Calculation language |
| 3 | Fix to `{AT [Region] : SUM([Sales])}` | `Formula is valid.`; `button "Save calculation"` -> `Saved {name}.` | brief: Feedback states |
| 4 | Place the calculation on Label (AVG by default) | East 435, North 480, South 60, West 325 | brief: Level of detail |
| 5 | Add a dimension filter Product Quiet Mint (`dialog "Filter Product"`, Apply) | `Filtered: {n} marks.`; SUM(Sales) 75, 120, 30, 45; AT value stays 435, 480, 60, 325; focus on the filter pill | brief: Query order (example 3) |
| 6 | Reopen the pill (Enter), tick `checkbox "Context filter"`, Apply | AT value becomes East 75, North 120, South 30, West 45 | brief: Query order (example 2) |
| 7 | `button "Table calculation of Sales"`, Percent of total, Table down, Apply | caption `Percent of total of Sales`; values as the brief's worked examples | brief: Table calculations, Display |
| 8 | Add a rank table calculation filter (Rank at most 2) | per Query order example 9; every value readable in `region "Data table"` | brief: Query order |

End state, provider: `sheets` insert with `owner_id` = the explorer (copy) and its `calculations` copied;
`calculations` insert for the new calculation; the copy's `sheets.shape` and `sheets.version` updated per change
(the workbook version is untouched). `POST /api/formula/check` writes nothing. MinIO: nothing.
Source: brief: API (copy does not change the workbook version); decided: `server/sheets/edit.ts`.

### J4 Dashboard at a desk (DP-26, DP-28 to DP-30)

Start: a viewer opens `/dashboards/<id>` of three sheets at 1280x800; bubblegum field with plum text.

| # | Action | Visible result | Source |
|---|---|---|---|
| 1 | Page loads | three `region "{sheet name}"` with `data-x`, `data-y`, `data-w`, `data-h`; three flexible sheets across 1280 are 422, 421, 421 wide at x 0, 430, 859 | brief: Dashboards |
| 2 | Click (or Enter on) the East bar on the region sheet | `aria-pressed="true"` on it; actions run in order set parameter, change set, filter, highlight; `log "Action log"` lists `{n}. {type}: {name}` | brief: Actions |
| 3 | While waiting | each target region `aria-busy="true"` and visible `Updating...` | brief: Feedback states |
| 4 | Newest answers applied | filter target shows East only; highlight target marks non-matching marks `data-dim="true"` and matching twin rows `data-highlight="true"`; `status "View announcements"` shows `Filtered to East: 2 sheets updated` | brief: Feedback states, Actions |
| 5 | Escape | filters and highlights removed, log empty; `Selection cleared: {n} sheets updated` | brief: Actions (Clearing) |

Latest selection wins: each target query carries a new `gen`; an answer with a lower `gen` is dropped. brief: Actions.
End state, provider: nothing written (queries read `snapshot_rows`); MinIO nothing. decided: selection is page state only.

### J5 Dashboard on a phone (DP-27)

Start: the same viewer at 375x812.

| # | Action | Visible result | Source |
|---|---|---|---|
| 1 | Page loads | header wraps to two rows; sheets stack in `phone_order` at their `phone_heights`, full width; no sideways scroll | brief: Dashboards, Screens and layout |
| 2 | Tap a bar | mark selected; `dialog "Mark details"` (`data-sheet="bottom"`) slides up with `sheet-open` (240 ms) showing the tooltip text | brief: Interactions (Touch), Motion and effects |
| 3 | Close, tap `button "Filters"` | `dialog "Filters"` bottom sheet holds `region "Controls"` | brief: Interactions |
| 4 | Reduced motion on, repeat | no `mark-glide`, `sheet-open` or any other animation; every end state lands at once | brief: Motion and effects |

Bars at least 44 pixels thick, points and cells at least 44 by 44 tap area. brief: Interactions.
End state, provider: nothing written.

### J6 Two readers, one workbook (DP-31 to DP-34)

| # | Action | Visible result | Source |
|---|---|---|---|
| 1 | Creator on the source page: `combobox "Security field"` Region; `textbox "Entitled username"` `south_rep`, `textbox "Values"` `South`, `button "Add entitlement"`; same for `north_rep` / `North` | `status "Announcements"` shows `Entitlements saved.`; `table "Entitlements"` lists both | brief: Public screens and controls, Feedback states |
| 2 | Workbook page: `button "Publish"`, `dialog "Publish"`, `combobox "Project"`, `button "Publish workbook"` | `status "Publish state"` shows `Publishing...`, then `Published to {project name}.` | brief: Feedback states |
| 3 | `south_rep` opens the sheet (by Category) | Black (null), Green 30, Herbal 30, total 60; Stockist filter list only `Dune Mug`; exports hold only South rows | brief: Publishing, roles and row-level security |
| 4 | `north_rep` opens it | only North rows | brief: Journeys |
| 5 | Either asks for the other's private workbook id | 404 `{"error":"not_found"}`, page `Not found.` (same as an unknown id) | brief: API (Error precedence), Feedback states |

End state, provider: `sources.security_field` = `Region`, `sources.entitlements` = `{"south_rep":["South"],"north_rep":["North"]}`;
publish sets `workbooks.state` `published`, `project_id`, `certified_by` NULL and bumps `workbooks.version`.
Exports add `export_jobs` rows and `exports/<job id>.<kind>` objects per reader. Source: brief: Services; decided: `server/sources/edits.ts`, `server/workbooks/store.ts`.

### J7 Refresh and alert (DP-35 to DP-37)

Start: creator on the source page; a subscriber has an alert (`button "New alert"`, `dialog "Alert"`) e.g. Total sales above 1,400; a second user has the source page open.

| # | Action | Visible result | Source |
|---|---|---|---|
| 1 | `spinbutton "Every minutes"` 60, `combobox "Refresh kind"` Full, `button "Save schedule"` | `Schedule saved.`; `status "Next refresh"` `Next refresh {YYYY-MM-DD HH:mm} UTC` | brief: Feedback states |
| 2 | Server clock passes `next_run_at` | `extract` event; both tabs show `status "Extract state"` `Fresh, refreshed {YYYY-MM-DD HH:mm} UTC` with the new time | brief: Extracts and alerts, API (events) |
| 3 | Value crosses the threshold (1,320 -> 1,420) | one inbox item `Total sales crossed 1,400: now 1,420.`; header `link "Inbox, {n} unread"` updates live from the `inbox` event | brief: Extracts and alerts |
| 4 | A refresh fails | `Refresh failed at {failure time} UTC. Showing data from {last success time} UTC.`; queries keep the last good snapshot | brief: Feedback states |
| 5 | Staleness | `Stale, refreshed {YYYY-MM-DD HH:mm} UTC` once `now - last success >= LOZ_STALE_MS` by the server clock | brief: Extracts and alerts |

End state, provider:

| Moment | PostgreSQL | MinIO |
|---|---|---|
| save schedule | `extracts.schedule_every`, `schedule_kind`, `schedule_key`, `schedule_saved_at` | nothing |
| refresh start | `extracts.state` `refreshing`, `last_run_at` | reads `uploads/<source id>/<table>/<sha256>.csv` |
| success | one transaction: `snapshot_tables` and `snapshot_rows` swapped (old snapshot rows deleted), `source_fields` resynced, `extracts.state` `live`, `last_success_at`; then `alerts.armed` false and one `inbox_items` insert | nothing written |
| failure | `extracts.state` `refresh_failed`, `last_failure_at`; snapshot untouched | nothing written |
| inbox opened | `inbox_items.read` true (`POST /api/inbox/read`) | nothing |

Source: brief: Extracts and alerts, Services; decided: `server/extracts/refresh.ts`, `server/extracts/schedule.ts`, `server/alerts/*.ts`.

### J8 Export (DP-38 to DP-40)

Start: a viewer on a filtered published sheet (plum field) with `button "Export PDF"`, `button "Export PNG"`, `button "Export crosstab"`.

| # | Action | Visible result | Source |
|---|---|---|---|
| 1 | `button "Export PDF"` | `POST /api/exports` 202; `status "Export state"` `Queued`, `progressbar "Export progress"` 0 | brief: API, Feedback states |
| 2 | Worker steps (`LOZ_EXPORT_STEP_MS` each) | `Rendering` / 50, then `Ready` / 100 with `link "Download PDF"` | brief: Exports |
| 3 | Same for PNG and crosstab | `link "Download PNG"`, `link "Download crosstab"` | brief: Public screens and controls |
| 4 | Download each | `application/pdf`, `image/png`, `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="<target name>.<pdf|png|csv>"` | brief: API |
| 5 | CSV content | a text cell beginning with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading `'`; number cells unchanged; CRLF, no BOM | brief: Exports |
| - | storage outage | job ends `Failed. Try again.` with `button "Try again"`; a download during an outage shows `Storage is unavailable. Try again.` and the job stays Ready | brief: Feedback states |

End state, provider: `export_jobs` insert (`status` `queued`, `progress` 0, `request_key` for replay), then
updates to `rendering`/50 and `ready`/100 only after the MinIO write `exports/<job id>.pdf` (`.png`, `.csv`) is
confirmed; a failed write sets `failed`/0. Retry sets `queued`/0. Source: brief: Exports, Services; decided: `server/exports/jobs.ts`.

## 2. Palette roles

Hex values are the tokens in `app/src/client/styles/tokens.css`; mark triples in `app/src/shared/chart/palette.ts`.

| Role | Brief words | Hex / value in the build | Used for | Source |
|---|---|---|---|---|
| ground | pale blush pink | `#FDF1F7` | raw data pages and default field; zebra rows; sequential low | brief: Visual design; decided: hex from BUILD.md/DESIGN.md, matches tokens.css |
| surface | white | `#FFFFFF` | cards, dialogs, inputs, chart card | brief: Visual design |
| ink | near-black plum | `#1A0A14` | text on ground, surface, sheet, accent; mark outlines; focus ring | brief: Visual design |
| muted | dusty mauve | `#6E4A5E` | secondary text, input borders, tick labels, table headers on white | brief: Visual design |
| accent | saturated bubblegum pink, plum text on it | `#E9479F` | dashboard field; live inbox count; highlight rows tint; landed query-order chip | brief: Visual design |
| sheet | mid pink between ground and accent | `#EAA0CD` | editable sheet field; error and outage banners (`.status`) | brief: Visual design |
| lime | sharp lime, controls only | `#D9E13F` | measure chips and pills (fill), dimension chips and pills (3px outline), primary buttons | brief: Visual design |
| plum field | plum with pale blush text | `#2B1325` | published view field; sticker offset shadows; dialog scrim `rgba(43, 19, 37, 0.55)` | brief: Visual design; decided: hex from BUILD.md |
| hero grey | first words grey | `color-mix(in srgb, var(--ink) 60%, var(--ground))` = `#75666F` | `Charts you` | brief: Visual design (Hero); decided |
| lime hover / press | darken a step | `#C8D12A` / `#B6C01B` | lime controls | brief: Motion and effects; decided (DESIGN.md lists `#C2C73A` / `#AFB236`; the build uses these) |
| surface hover / press | darken a step | `#F8E3EE` / `#F1CFE1` | white buttons, menu items, dimension chips | brief: Motion and effects; decided (DESIGN.md lists `#E4E2E3` / `#CDC9CB`) |
| pill hover / press | darken a step | `color-mix(in srgb, var(--ink) 10%, transparent)` / `20%` | pill main and side buttons | decided: one step over either pill fill |
| field error | none in brief | `#8A0E4B` | field error text and invalid input border | decided: AA on white for inline errors |
| gridline | none | `color-mix(in srgb, var(--ink) 14%, var(--surface))` (`#DFDDDE`) | chart gridlines | decided |
| twin highlight | none | `color-mix(in srgb, var(--accent) 22%, var(--surface))` plus 6px accent inset bar | `data-highlight="true"` rows | decided: highlight in the accent family |

Field tokens (`body[data-field]`, set by `client/shell/depth-field.ts`):

| `data-field` | `--field` | `--field-ink` | `--field-muted` | Pages | Source |
|---|---|---|---|---|---|
| `pale` (default) | ground | ink | muted | home, sign-in, workbooks, workbook, project, upload, source, inbox, not found | brief: Visual design (Depth fields); decided for non-data pages |
| `sheet` | sheet | ink | `#3F1F33` | editable sheet | brief: Visual design |
| `dashboard` | accent | ink | `#2A0F20` | dashboards | brief: Visual design |
| `plum` | plum field | ground | `#E6CADB` | sheet a user may not edit | brief: Visual design |

DESIGN.md names the field values `ground`/`accent`; the build uses `pale`/`dashboard`. decided: names are internal.

Marks (brief: Chart grammar): categorical cycle `233, 71, 159` / `26, 10, 20` / `217, 225, 63` / `110, 74, 94` /
`234, 160, 205` with patterns `solid`, `dots`, `stripes`, `checks`, `rings`; sequential low `253, 241, 247`, high
`233, 71, 159`, rounded half up; null mark outline only, empty `data-color`, text `(null)`. Outline 2px ink
(`26, 10, 20`); patterns are 10x10 SVG `<pattern>` tiles. Chart tooltip: ink background, ground text, 16px radius.

## 3. Type, space and layout per viewport

Type (brief: Visual design; values from `tokens.css`, `base.css`):

| Token | Family | Weight | Size / line height | Used for | Source |
|---|---|---|---|---|---|
| hero | Stack Sans Headline | 300 | `9vw` / 1, letter-spacing `-0.025em`, centred; `Charts you` grey, `can explain.` ink, each on its own line | `heading "Charts you can explain."` level 1 | brief: Visual design (Hero) |
| h1 / display | Stack Sans Headline | 500 (sheet name 700) | `--step-3` 2.369rem / 1.1 | page headings | brief: each level a third larger; decided: weight 500 (DESIGN.md says 700) |
| h2 / heading | Stack Sans Headline | 500 | `--step-2` 1.777rem / 1.1 | dialog titles, brand (700) | brief: Visual design |
| h3 / small heading | Stack Sans Headline | 500; panel titles 700 | `--step-1` 1.333rem | panel and card titles | brief: Visual design |
| body | Stack Sans Text | 400 | `--step-0` 1rem / 1.5 | text, inputs, cells | brief: Visual design |
| label | Stack Sans Text | 600 | 1rem / 1.2 | buttons, pills, chips | decided: plump labels |
| small | Stack Sans Text | 600 | `--small` 0.875rem | field labels, table headers, compact buttons, chips | decided (DESIGN.md says 0.75rem) |
| empty headline | Stack Sans Headline | 300 | `--step-3` / 1.1, max 20ch | empty, not-found and error pages | brief: one plump headline |

`font-variant-numeric: tabular-nums` on `body`, tables, ticks, labels; `td.num`/`th.num` right-aligned. brief: Visual design.

Space and shape (decided unless marked):

| Token | Value | Source |
|---|---|---|
| hit size `--hit` | 48px (chips, pills, shelf targets 44px) | brief: at least 44 pixels |
| card radius | 28px | brief: Visual design |
| field radius (inputs, tooltips, thumbnails) | 16px | decided |
| pill radius | 999px | brief: fully round pill |
| chip/pill border | 3px solid lime; measures lime fill, dimensions white fill | brief: Visual design (Shapes) |
| button border | 2px ink; big hero link 3px, min-height 76px | decided |
| input | white, 2px muted border | brief: inputs are white |
| focus | `outline: 3px solid var(--ink)`, `outline-offset: 2px`, `box-shadow: 0 0 0 8px var(--surface)` | brief: thick plum focus ring; decided: white halo for the plum field |
| card lip | `0 4px 0 0 color-mix(in srgb, var(--ink) 18%, transparent)` | decided |
| sticker shadow | `drop-shadow(8px 8px 0 var(--plum))`, 5px below 768 | brief: solid plum offset shadows |
| page gutter `--page-pad` | `clamp(12px, 3vw, 32px)` | decided |
| screen max width | 78rem (sheet page 90rem; home and dashboard unbounded) | decided |
| table cell | padding 0.8rem 1rem, twin row height 3.25rem, zebra ground, no borders | brief: roomy rows, no rules |

Layout per viewport:

| Screen | 360 | 375 | 768 | 1280 | Source |
|---|---|---|---|---|---|
| header | two rows: brand + inbox, Workbooks + Sign out | same | one row | one row | brief: Screens and layout (375 wraps); decided for 360 |
| gutter | 12px | 12px | about 23px | 32px | decided |
| home | headline, sheet at 100%, pill link; stickers `pill` top left and `at` bottom right | same | sample sheet `70vw` | sample sheet `40vw` (from 1200) | brief: Screens and layout |
| workbooks | full width | full width | column max 45rem (720px) | 720px | brief: Screens and layout |
| project | stacked | stacked | stacked | members and sources in two columns (from 1024) | brief: Screens and layout |
| upload / source | stacked | stacked | stacked | `2fr 1fr` (fields left two thirds, schedule and entitlements right) from 1024 | brief: Screens and layout |
| editable sheet | one column: Fields, Shelves, View, Data table | same | two columns: Fields and Shelves left (15-19rem), View and Data table right | three columns from 1200: Fields over Rows/Columns/Filters, stage, Marks card (14-16rem) | brief: Screens and layout |
| published view | one column, Controls behind `button "Filters"` | same | two columns | two columns | brief: Screens and layout |
| dashboard | phone layout: `phone_order` stack | same | 1280x800 stage scaled `(width - 16) / 1280` (about 0.59) | stage 1:1 when the frame is at least 1280 wide, else scaled | brief: Dashboards; decided: 8px gutter each side when scaled (`stage.tsx`) |

## 4. Motion

| Element | Trigger | Duration | Easing | Reduced-motion substitute | Source |
|---|---|---|---|---|---|
| `mark-glide` (each mark with the same `data-mark` before and after) | new query result after a shelf, filter or selection change | 240 ms | `cubic-bezier(0.2, 0.8, 0.2, 1)` | none created; mark at final place at once | brief: Motion and effects; decided: easing from `client/chart/glide.ts` |
| `mark-glide` keyframes | same as above | 240 ms | same | none | decided: `translate(dx, dy) scale(sx, sy)` to `translate(0px, 0px) scale(1, 1)` from the old tap box to the new one; a running glide on the same mark is cancelled first; skipped on first draw |
| `sheet-open` (`dialog "Mark details"`, `dialog "Filters"` on phones) | bottom sheet opens | 240 ms | `cubic-bezier(0.2, 0.8, 0.2, 1)` | none created; sheet docked at once | brief: Motion and effects; decided: `client/ui/dialog.tsx`, `translateY(100%)` to `translateY(0)` |
| hover and press (buttons, nav links, chips, pills, menu items, shelf lists) | pointer hover / active | `--press-ms` 90 ms | `linear`, `background-color` only (shelf lists also `border-color`) | CSS rule sets `transition: none !important`; colour changes at once | brief: within a tenth of a second; decided: linear |
| focus ring | focus-visible | 0 | none | same | brief: Focus shows the thick plum ring at once |
| busy sheet | waiting for newest answer | static | none | same | brief: `Updating...`, no spinner loop |
| stickers, page, lists, dialogs on desktop | - | none | none | same | brief: No decorative loops; decided: desktop dialogs open at once (DESIGN.md's 120 ms fade is not built) |

Reduced motion: `matchMedia('(prefers-reduced-motion: reduce)')` read at call time in `glide` and `Modal`; CSS
`*, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }`.
brief: Motion and effects (Reduced motion).

## 5. States per async action

All live regions polite. Copy from brief: Feedback states unless marked.

| Action | Region | Busy | Success | Failure | Source |
|---|---|---|---|---|---|
| CSV preview | `table "Preview"`, `list "Upload errors"` | - | rows with `data-type` headers | one `listitem` per error, line order: `Line 1: duplicate column name "{x}".`, `Line 1: column {n} has no name.`, `Line {n}: expected {m} fields, found {k}.`, `Line {n}: unterminated quote.`, `Table has {n} rows. The limit is {max}.`; alone: `File is {n} bytes. The limit is {max}.` or `File is empty.` | brief: Data sources |
| upload / add table | `status "Upload state"` | `Uploading...` | `Uploaded {table}: {n} rows.` | `Storage is unavailable. Your file was not saved. Try again.` + `button "Try again"`; third table: `A source holds at most 2 tables.` | brief: Feedback states, API |
| relate | `status "Announcements"`, `status "Join notice"` | - | `Related {left table} to {right table}.`; `{table} has {n} duplicate keys. First line kept: {key}.` when duplicates | `Keys must have the same type.` | brief: Feedback states |
| rename / hide / bins / group | `status "Announcements"` | - | `Renamed {old} to {new}.`; `{field} hidden.` / `{field} shown.`; `Created {field}.` | `Name is required.`, `A field named {name} already exists.`, `Bin size must be a whole number of at least 1.` | brief: Feedback states |
| entitlements | `status "Announcements"` | - | `Entitlements saved.` | - | brief: Feedback states |
| add member | `status "Announcements"` | - | `Member added: {username} as {role}.` | `No such user.` | brief: Feedback states |
| save schedule | `status "Announcements"`, `status "Next refresh"` | - | `Schedule saved.`; `Next refresh {YYYY-MM-DD HH:mm} UTC` / `No schedule.` | `Every minutes must be a whole number from 1 to 10080.`, `Incremental refresh needs a number or date key.` | brief: Feedback states |
| refresh now / scheduled | `status "Extract state"`, `status "Announcements"` | state `refreshing` | `Fresh, refreshed {YYYY-MM-DD HH:mm} UTC`; `Refresh finished.` | `Refresh failed at {failure time} UTC. Showing data from {last success time} UTC.`; `Refresh failed.`; stale `Stale, refreshed {YYYY-MM-DD HH:mm} UTC` | brief: Feedback states |
| export | `status "Export state"`, `progressbar "Export progress"` | `Queued` (0), `Rendering` (50) | `Ready` (100) + `link "Download {kind}"` | `Failed. Try again.` (0) + `button "Try again"`; download outage `Storage is unavailable. Try again.` | brief: Feedback states |
| publish | `status "Publish state"` | `Publishing...` | `Published to {project name}.` | `This workbook changed since you opened it. Reload and publish again.` | brief: Feedback states |
| certify | `status "Certified"` | - | `Certified by {username}` | empty | brief: Feedback states |
| sign-in / create account | `status "Sign-in state"` | - | navigates to `next` or `/workbooks` | `Wrong username or password.`; `Too many sign-in attempts. Try again in {s} seconds.`; `Username must be 3 to 24 letters, digits or _.`, `Password must be at least 8 characters.`, `That username is taken.` | brief: Feedback states; decided: default destination `/workbooks` |
| formula check | `status "Formula check"` | after `LOZ_FORMULA_DEBOUNCE_MS`; older results never shown over newer | `Formula is valid.` | first error in check order, e.g. `Line 1, column 15: formula ended early.`; save cycle `Cycle: {a} -> {b} -> {a}.` | brief: Calculation language |
| save calc / set / alert / action / line | `status "View announcements"` | - | `Saved {name}.` | `Name is required.`, `Above must be a number.`, `Highlight needs {field} in every target view.`, `A dashboard holds 2 to 4 sheets.`, `Containers nest at most one level.` | brief: Feedback states |
| shelf edit | `status "View announcements"` | - | `Added {field} to {shelf}.`, `Removed {field} from {shelf}.`, `Moved {field} to position {n} on {shelf}.`, `Expanded {field}.`, `Collapsed {field}.` | refusal in `status "View notice"`, last good chart kept | brief: Feedback states |
| filter Apply | `status "View announcements"` | - | `Filtered: {n} marks.` | view notice | brief: Feedback states |
| parameter change | `status "View announcements"` | - | `{name} set to {value}.` | - | brief: Feedback states |
| dashboard object hide/show | `status "View announcements"` | - | `{name} hidden.` / `{name} shown.` | - | brief: Feedback states |
| dashboard selection | `status "View announcements"`, each target `aria-busy` | `Updating...` | `Filtered to {member}: {n} sheets updated` / `Highlighted {member}: {n} sheets updated` / `Selected {member}: {n} sheets updated`; clear `Selection cleared: {n} sheets updated` | - | brief: Feedback states |
| sheet query | `status "View notice"` (one at a time, in order) | `Updating...` | chart + twin | `{field} is hidden.`, `No rows for your account.`, refusals (`One measure per axis. Remove {field} or place it on Label.`, `Line needs a date on Columns and a measure on Rows.`, `Scatter needs a measure on Rows and on Columns.`, `Heat map needs a measure on Color.`, `Size works with Scatter only.`, `Size needs a measure.`), `This view needs too much work. The limit is {max} steps.`, `This view took too long. The limit is {s} seconds.`, `This view would draw {n} marks. The limit is {max}. Add a filter or remove a field.` | brief: Feedback states, View builder |
| inbox | `region "Inbox"` | static skeleton | `{alert name} crossed {threshold}: now {value}.` | empty `Your inbox is empty.` | brief: Feedback states |
| any page | page headline | - | - | `Not found.`, `You do not have access to this.`, `Too many requests. Try again in {s} seconds.`, `Something went wrong. Try again.`; empty list `No workbooks yet.` | brief: Feedback states |

`body[data-pending]` counts in-flight API requests (never event streams); `0` means settled. brief: Public screens and controls.
Error banners are full-width mid-pink bars with plum text (`.status-banner`, `--sheet` background, ink text). brief: Visual design.

## 6. Breakpoints

All media queries use literal values (`app/src/client/**/*.css`, `client/ui/phone.ts`).

| Query | What changes | Source |
|---|---|---|
| `max-width: 767.98px` | phone: header two rows; dashboard phone layout; Filters and Mark details as bottom sheets (`usePhone`); one-column sheet page; home shows two stickers (`pill`, `at`), sheet 100%, sticker shadow 5px; smaller dialog padding and title `--step-1`; bars at least 44px thick | brief: below 768 pixels |
| `min-width: 768px` | sheet page two columns; published view two columns; dashboard stage drawn | brief: Screens and layout |
| `min-width: 1024px` | project two columns; source page `2fr 1fr`; dashboard tools three columns | brief: at 1280 two columns, at 768 stacked; decided: 1024 is between |
| `min-width: 1200px` | editable sheet three columns; home sample `40vw` | brief: at 1280 three columns, about 40%; decided: 1200 keeps the chart card wide |
| 1280 | dashboard stage 1:1 when the frame has 1280 pixels | brief: Dashboards |

Viewports tested: 360x740, 375x812, 768x1024, 1280x800; scroll width never exceeds client width (`body { overflow-x: clip }`). brief: Browser support and performance, Screens and layout.

## 7. Media and licences

| Media | What | Licence / origin | Source |
|---|---|---|---|
| Stack Sans Headline 300, 500, 700 | `app/public/fonts/stack-sans-headline-latin-{300,500,700}-normal.woff2`, served from `/fonts/`, `@font-face` in `client/index.html`, `font-display: swap` | OFL-1.1, from `https://www.npmjs.com/package/@fontsource/stack-sans-headline` (`app/assets.json`, sha256 listed); `OFL-StackSansHeadline.txt` | brief: Visual design (bundled font files) |
| Stack Sans Text 400, 600, 700 | `stack-sans-text-latin-{400,600,700}-normal.woff2`, plus 400 and 600 `.woff` | OFL-1.1, from `https://www.npmjs.com/package/@fontsource/stack-sans-text`; `OFL-StackSansText.txt` | brief: Visual design |
| hero and empty-state stickers | inline SVG in `client/ui/sticker.tsx`: `pill` (white rounded shelf pill, lime outline, `Region`), `sum` (lime lozenge, `SUM`), `blob` (bubblegum blob with three bars), `at` (mid-pink badge, `AT`); `aria-hidden`; tilts -6, 5, -4, 7 degrees; cropped at -3rem from the edges | drawn in code, no licence needed | brief: Visual design (Hero); decided: shapes and tilts |
| sticker use on other pages | `Your inbox is empty.` blob; `No workbooks yet.` blob; `Place a field on Rows or Columns.` pill; `Not found.` blob; `You do not have access to this.` sum; 429 at; 5xx pill | drawn in code | brief: one plump headline plus a single sticker; decided: which sticker |
| chart marks, legend swatches, thumbnails | SVG, one element per mark, `<pattern>` tiles from `shared/chart/palette.ts`; workbook thumbnails procedural from the first sheet | drawn in code | brief: Chart grammar, Visual design |
| PDF export | the Skia PDF backend of `@napi-rs/canvas@1.1.0` (`PDFDocument`, the same package as the PNG), embeds `stack-sans-text-latin-400-normal.woff` (text) and `-600-` (headings) as subset CID fonts with a Unicode map | MIT; fonts OFL-1.1 | brief: Exports, IF-08 |
| PNG export | `@napi-rs/canvas@1.1.0`, 1200 by 800, registers `stack-sans-text-latin-400-normal.woff` | MIT; fonts OFL-1.1 | brief: Exports (PNG) |
| other shipped packages | `react`/`react-dom` 19.3.1, `pg` 8.23.1 (MIT); `@aws-sdk/client-s3` 3.1163.0 (Apache-2.0); full tree in `app/THIRD_PARTY_NOTICES.md` | MIT, Apache-2.0, BSD, ISC, 0BSD | brief: Working rules IF-02, IF-03 |

No image, photo or icon font is loaded from another origin. brief: Working rules IF-05.
