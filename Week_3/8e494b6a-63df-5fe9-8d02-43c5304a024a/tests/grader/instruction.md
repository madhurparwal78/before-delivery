# Fenwick Signal Spoorline

Spoorline is a log search and observability console for any team that runs software, from a two-person shop to a forty-person company. Teams send it newline-delimited events, test ingest pipelines before events go through them, keep events in data streams that roll over into numbered generations and age into an archive tier, search them with a published query language and a published score, alert on grouped rules, follow an alert into a case and a trace, and read error budgets per service objective. Every rule and formula the product uses is published with a worked example, so anyone can check any number it shows without knowing search or observability beforehand. It is one TypeScript web app (a Node server plus a browser client) that uses two backend services: Postgres holds events, the term index the app builds itself, and all product state, and MinIO stores uploaded files byte for byte and the segment of every archived generation. Out of scope, and absent from the product: AI, assistants and agents, machine learning and anomaly detection, maps, dashboards, a chart builder, security detection content, outside connectors, synthetic checks, real-user monitoring, paid plans, sound, email, outside sign-in, any upload format other than the published one, and any datastore, queue, cache or search service other than Postgres and MinIO. No other product's name, query language or upload format is named, copied or supported. Every service, host, log line and person in the product and its data is invented.

## Problem and users

Any team that runs software has to find out what its software did, and the questions in a bad hour are always the same: which requests failed, which host started it, and how much of this month's error budget went with it. Today's tools give numbers nobody can check. A search result is ranked by a score nobody can take apart. Pages shift under the reader while new events arrive, so the person on call loses their place. An alert fires for a whole rule and hides which group is failing, or flaps all night. Old data disappears or gets slow for reasons written down nowhere. Spoorline publishes every rule: the upload format, the pipeline processors, the query language and its scoring, the lifecycle of a data stream, the alert state machine, trace self time and critical path, and burn rates.

- **Space admin** (weekly): defines streams, field types, pipelines, lifecycle policies and scoped API keys, and tests a pipeline on sample events before any real event goes through it.
- **On-call engineer** (daily): searches, pages and tails events during an incident, narrows the time range on the histogram, then follows an alert group into a case and a trace, at a desk or on a phone.
- **Service owner** (weekly): reads error budgets and burn rates for each service objective and tunes alert rules, snoozes and maintenance windows.
- **Upload key holder** (daily): sends newline-delimited events to the upload API with a scoped key and reads the result for each line.

## Journeys

1. **Triage in Explore.** Start: `tomas` is signed in on `/explore` in space `ops` with the seed data. Tomas types a query with help from the suggestions, presses Enter, hears the result count, includes a value from the field statistics as a filter pill, moves between regions with F6, opens an event in the document panel, reads its surrounding events and closes the panel. End: focus is back on the same grid row and the grid, histogram and count match the query and the pill.
2. **Narrow with Bucket Brush.** Start: a stream with events across a daylight saving day, viewer zone `America/New_York`. The engineer sets an absolute range for that day, reads the interval and bucket labels, drags across three buckets (or uses Shift+arrows and Enter), and watches the bars settle. End: the range is the outer edges of the chosen buckets, and the count, field statistics and grid all follow it. Under reduced motion the same happens with no animation.
3. **An alert through its life.** Start: a service owner and an on-call engineer in two browsers on the same space. The owner creates a grouped rule; checks run; group `host-7` goes pending, then active, then recovered; another group flaps; the owner snoozes one group and sets a maintenance window. End: both browsers show each group's state and overlays in place, the inbox gets the published items, the engineer acknowledges one, and each state change is announced.
4. **Triage on a phone.** Start: the engineer on a phone 360 pixels wide, a colleague at a desk. The engineer opens a rule's alert cards, swipes a card to acknowledge it, opens the time range sheet, adds the group to a case, opens the linked trace and taps through spans. End: the desk browser shows the acknowledgement and the case item without a reload.
5. **Prove a pipeline, then upload.** Start: a space admin with a stream and a pipeline. The admin pastes sample events into the simulation and sees each processor's result, a skipped condition and a failure, saves a change, then the upload key holder sends a file. End: the file is kept in storage, progress shows in both the admin's and a colleague's browser, each bad line is named with its line number, and the failure store lists them.
6. **Age a stream.** Start: a stream with a lifecycle policy. Steps run on the server clock; the stream rolls over; generations turn warm and then archived; an edit to a warm event is refused; storage goes down and a search shows the partial results banner. End: when storage returns, the same search is complete, and the timeline shows each generation's phase and next step.
7. **Page through a moving result set.** Start: an engineer runs a search while a colleague uploads. The engineer pages to the end, then tails the stream, pauses, lets events buffer past the limit and resumes. End: the pages had no duplicates and no gaps, `Show new events` counts the new arrivals, and the tail shows the published buffer messages.
8. **Hand out a key and share a search.** Start: a space admin in `ops` and a member of `harbor`. The admin creates a scoped key that is shown once, the key holder is refused outside its scope, and the admin copies a saved search into a space that lacks its stream. End: the copy is marked `Needs attention`, and nothing from one space ever shows in the other.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest, health and boundary** `/app/run.json` installs, builds and serves the app on the published port, `/api/health` answers as published in Deployment, and the rules in Server boundary hold.
- **DP-02 — Accounts and sign-in** Local username and password accounts use the `spoor_session` cookie, the sign-in rate limit and a landing on `/explore` after sign-in or sign-up, as qualified in Business rules.
- **DP-03 — Grading routes and live settle signal** With `SPOOR_GRADING=1` the grading routes seed data, sign in, set the server clock, run checks, run lifecycle steps and switch storage as published, and every page shows `data-seq` and `data-pending` and applies live messages from `GET /api/events`.
- **DP-04 — One error shape and order** Every API error uses the one published body and code list and is decided in the one published order.
- **DP-05 — Drafted console look** The console carries the published visual design: a warm paper ground, one deep green accent, mono data and numerals with Inter interface text, outlined cards, and every named console component in its published place.
- **DP-06 — Built-in index and secrets from env** The term index, text analysis and scoring are written in the app's own source with no search engine or search library, and every service credential is read from the environment and never reaches the browser.
- **DP-07 — Query bar suggestions** `combobox "Query"` follows the published combobox keys and suggests field names, operators and values by cursor position, from the current space only.
- **DP-08 — Virtual events grid** `grid "Events"` keeps at most 60 rows in the page, publishes its row count, row indexes and row labels, sorts in the published order, and follows the published grid keys, column resizing and Tab exit.
- **DP-09 — Document panel and surrounding events** Opening an event shows `region "Document"` with the `panel-in` animation and focus on its close button, closing returns focus to the same row, and surrounding events list the published 5 before and 5 after.
- **DP-10 — Explore triage journey** An on-call engineer searches, works filter pills, moves between Explore regions with F6 and Tab, and hears the published result count after every search.
- **DP-11 — Time range and viewer zone** `dialog "Time range"` sets quick, relative and absolute ranges in the viewer's time zone with server time as now, and every displayed time uses the published format.
- **DP-12 — Histogram buckets across daylight saving** The histogram picks the published interval and aligns buckets in the viewer's zone, including the published 23-hour and 25-hour days.
- **DP-13 — Bucket Brush** Dragging over `group "Histogram"`, or Shift+arrows then Enter, sets the range to the selected buckets' outer edges, each changed bar runs `bar-settle`, and reduced motion shows final heights with no animation.
- **DP-14 — Range-following statistics journey** After a Bucket Brush change, the event count, field statistics, filter pills and grid follow the new range with no query text, and the published range announcement is made.
- **DP-15 — Alert rules and group windows** A structured alert rule measures each group over the published window, which never starts before the group's last change to active or recovered, so no event counts toward two state changes.
- **DP-16 — Group states and flapping** Each group moves through inactive, pending, active and recovered by the published transitions, keeps its state on a failed check, and is marked flapping with its actions held, as published.
- **DP-17 — Snoozes and maintenance windows** Snoozes and weekly maintenance windows in an IANA time zone hold actions on the server clock, and the first check after a window ends fires the published single action.
- **DP-18 — Live alert journey** In two browsers, a service owner and an on-call engineer see group states, overlays and the inbox change in place, acknowledge items and hear each state change announcement.
- **DP-19 — Published breakpoints and sheets** Phone, tablet and desk layouts change exactly at 768 and 1100 pixels with no horizontal page scroll at 360 pixels, and on a phone the time range and filters dialogs open as bottom sheets with `sheet-rise`.
- **DP-20 — Swipe to acknowledge** On a phone, swiping a group card left past 80 pixels with under 40 pixels of vertical travel acknowledges the group, and a shorter swipe springs back and changes nothing.
- **DP-21 — Cases** Cases move through open, investigating, resolved and closed by the published steps, collect groups, inbox items and traces, and the recent cases row shows the 3 newest.
- **DP-22 — Phone triage journey** At 360 pixels wide, an on-call engineer triages from alert cards, acknowledges by swipe, sets a range in the sheet, adds a group to a case and taps through spans, while a desk browser sees each change live.
- **DP-23 — Spoor Query syntax** Spoor Query matches fields, phrases, existence, ranges, relative dates, wildcards, grouped values, object scopes and escapes with NOT, AND and OR precedence and the published multi-value range rule.
- **DP-24 — Query errors at their position** Each malformed query answers 422 with the published sentence and 1-based position, shown in `alert "Query error"` with the caret moved to that position.
- **DP-25 — Query limits and work budget** Queries over the length, nesting or work limit, or past the result window, get the published refusal within the time budget while uploads keep being answered.
- **DP-26 — Text analysis** The three published analyzers give the published tokens, positions and offsets, shown in `table "Tokens"` on the analyze page.
- **DP-27 — Published scoring and explanation** Every result's score follows the published formula and rounding, and `tree "Score explanation"` and the explain JSON list parts that add up exactly to the score.
- **DP-28 — Phrases and highlights** Phrases match by position with stopwords holding their slot, and matched tokens are highlighted at their published offsets.
- **DP-29 — Pipeline processors** The six published processors, their single condition form and the one failure handler change, drop or refuse each event exactly as published.
- **DP-30 — Pipeline simulation** The simulate page shows each processor's result for every sample event, marks changed fields, and stores nothing.
- **DP-31 — Editing a pipeline in use** Saving a pipeline raises its version by one and affects only events stored afterwards.
- **DP-32 — Rollover and phases on the server clock** Lifecycle steps roll over the write generation once and move each generation forward to the furthest phase its age allows, measured from rollover on the server clock, as shown in the generation timeline.
- **DP-33 — Read-only generations** An edit to an event in a warm or archived generation answers 409 with the published text before any check of its body.
- **DP-34 — Archive confirmed by storage** A generation becomes archived only after storage confirms its segment object, searches read it back, and during a storage outage searches return the rest with the published partial results banner and skipped count.
- **DP-35 — Snapshot paging** A snapshot freezes one result list, and its pages never repeat or skip an event while others upload or roll over.
- **DP-36 — Snapshot expiry** A snapshot left unused for the published time on the server clock answers 410, and the grid shows the published expiry text with a way to start a new search.
- **DP-37 — Live tail** The live tail follows new events, pauses with a counted buffer of the published size, discards the oldest events past it, resumes, and shows the published rate limit text.
- **DP-38 — Bulk upload line results** Each newline-delimited line gets its own created, duplicate, dropped or failed result with the published line errors, a client `_id` never makes a second event, and type conflicts across generations are reported as published.
- **DP-39 — File uploads** A file of the wrong kind or over the size limit is refused before anything is stored; otherwise the file is kept in storage byte for byte before parsing, with live progress in every browser in the space.
- **DP-40 — Spoor Pipe commands** Spoor Pipe runs the six published commands with typed columns, the published rounding and the published sort tie-break.
- **DP-41 — Pipe errors** A malformed pipe shows the published sentence in `alert "Pipe error"`.
- **DP-42 — Trace view** The trace tree orders spans, places orphans, corrects clock skew, and shows self time, critical path and latency percentiles exactly as published.
- **DP-43 — Error budgets and burn rates** Each objective shows budget remaining, long and short burn rates and a status by the published formulas on the server clock.
- **DP-44 — Scoped API keys** A key is shown once, stored only as a hash, and gets the published 401, 404 and 403 refusals for expiry, revocation, other spaces and scope.
- **DP-45 — Space isolation and saved search copy** No surface shows another space's data, and a saved search copied into another space lands with its missing references reported as published.

## Frontend

### Screens and layout (DP-05, DP-10, DP-19, DP-22)

Every signed-in page has, from top to bottom: the **ingest status bar** (`region "Ingest status"`), a thin bar that stays fixed at the very top; the **workspace header** (`banner`), which stays fixed under it with the product name, the server time, `button "Space"` and `button "Account"`; the **workspace tabs** (`navigation "Workspace"`); the one-line `status "Announcements"` strip; the view inside `<main>`; and the **workspace footer** (`contentinfo`), a dark band with the product name and a link to `/rules`. There is no marketing page. Signed-out visitors to any page are sent to `/signin`.

Routes: `/signin`, `/signup`, `/explore` (the default tab), `/pipes`, `/streams`, `/streams/<stream>`, `/streams/<stream>/analyze`, `/streams/<stream>/lifecycle`, `/pipelines`, `/pipelines/<name>`, `/pipelines/<name>/simulate`, `/alerts`, `/alerts/new`, `/alerts/<rule id>`, `/alerts/maintenance`, `/inbox`, `/cases`, `/cases/<number>`, `/traces`, `/traces/<trace id>`, `/objectives`, `/spaces`, `/keys`, `/rules`. Any other path shows the not-found screen from Feedback states.

Layout bands, decided by the viewport width only: **phone** below 768 pixels, **tablet** from 768 to 1099 pixels, **desk** from 1100 pixels up. The published viewports are 375x812 (phone), 768x1024 (tablet) and 1280x800 (desk). No page scrolls sideways at any width from 360 pixels up; wide content (tables, the tab strip) scrolls inside its own box.

- **Sign-in and sign-up** (`/signin`, `/signup`). Desk and tablet: the form on the left half; on the right half, one line of product statement above an inline drawing (`img "Lifecycle: hot, warm, archive, delete"`) of four ruled bands side by side, labelled hot, warm, archive and delete, drawn by the app. Phone: the statement and drawing sit above the form in one column.
- **Explore** (`/explore`). Order: the **query bar** row (`combobox "Stream"`, the pill-shaped query bar holding `combobox "Query"`, `button "Time range"` and the range text), filter pills (`list "Filters"`), the histogram (`Interval: <interval>` text above `group "Histogram"`), then the field list beside the grid. Desk: the field list is a narrow left column (about a fifth of the width) with `region "Field statistics"` under the selected field; the grid fills the rest; `region "Document"` opens at the right of the grid and the grid narrows to make room. Tablet: the same columns, but `region "Document"` covers the right half of the grid as an overlay. Phone: one column with the query bar full width, then a row with `button "Time range"` and `button "Filters"`, then the histogram full width, then the events as `list "Events"` of `article` cards; the field list, its statistics and the filter pills live in `dialog "Filters"`; `region "Document"` covers the full width. `button "Live tail"`, `button "Save search"` and `button "Columns"` sit on the grid's toolbar; `region "Live tail"` replaces the grid while the tail runs.
- **Pipes** (`/pipes`): `textbox "Spoor Pipe"` full width, `button "Run"`, then `table "Result"`.
- **Streams** (`/streams`): `table "Streams"`. **Stream page** (`/streams/<stream>`): `table "Mapping"`, the upload controls with `progressbar "Upload progress"`, `table "Uploads"`, and `region "Failure store"`; on desk the mapping and uploads sit side by side above the failure store, and on tablet and phone they stack. **Analyze** and **Lifecycle** pages are single columns; the lifecycle page shows the policy form above the **generation timeline** (`list "Generation timeline"`), drawn as ruled bands, one per generation, in order.
- **Pipelines** (`/pipelines`, `/pipelines/<name>`, `/pipelines/<name>/simulate`): a list table; an editor with `textbox "Processors JSON"`; the simulate page with `region "Simulate"`, where each sample event's steps stack under it.
- **Alerts** (`/alerts`): the **recent cases row** (`region "Recent cases"`, three outlined cards side by side on desk and tablet, stacked on phone) above `table "Rules"`. **Rule page**: `status "Last check"`, then the groups (`table "Groups"` on desk and tablet; on phone a column of `article` cards), then `table "State history"`. **New rule** and **Maintenance** pages are single-column forms.
- **Inbox** (`/inbox`): `feed "Inbox"`, one outlined `article` per item, newest first.
- **Cases** (`/cases`, `/cases/<number>`): `table "Cases"`; the case page shows status controls above `list "Case items"`.
- **Traces** (`/traces`, `/traces/<id>`): `table "Traces"`; the trace page shows `tree "Spans"` with a time bar per span (desk and tablet: tree and bars side by side; phone: each span's bar under its label), then `table "Latency"`.
- **Objectives** (`/objectives`): the **service strip** (`list "Services"`, a row of service tiles that wraps on phone) above the **objective panel** (`region "Objective"`).
- **Spaces** (`/spaces`): `table "Spaces"`, `table "Members"`, `list "Saved searches"`. **Keys** (`/keys`): `button "New key"` above `table "Keys"`.
- **Published rules** (`/rules`): the **published rules accordion**, fourteen numbered rows, one per rule A to N in Business rules.
- Any view with no data shows the **empty state band** (`region "Empty"`) with one line and one action, from Feedback states.

Every page's `<main>` carries `data-seq`, the last live `seq` the page applied, and `data-pending`, the number of writes the page sent that have not answered yet. A write has settled when `data-pending` is `0`. After a search finishes, the grid (or the phone's `list "Events"`) carries `data-search-state="done"`; while it loads, `loading`; after a failure, `error`.

### Public screens and controls (DP-07, DP-08, DP-09, DP-11, DP-13, DP-19, DP-20, DP-21, DP-30, DP-37, DP-44, DP-45)

Only these roles and names are public; everything else is free. Every accessible name contains the control's visible text. `<n>`, `<field>` and the other placeholders are filled from the record shown.

| Where | Role and accessible name | Visible copy or content |
|---|---|---|
| Every page | `region "Ingest status"` | the ingest line from Feedback states |
| Every page | `banner` | `Spoorline`, `Server time <time>`, `button "Space"`, `button "Account"` |
| Header | `menu "Spaces"` with one `menuitemradio "<space name>"` per membership | space names |
| Header | `dialog "Account"`: `combobox "Time zone"`, `button "Save account"`, `button "Sign out"` | IANA zone names |
| Every page | `navigation "Workspace"`: links `Explore`, `Pipes`, `Streams`, `Pipelines`, `Alerts`, `Inbox`, `Cases`, `Traces`, `Objectives`, `Spaces`, `Keys`; the current one has `aria-current="page"` | link text |
| Every page | `status "Announcements"` (the one polite announcement region) | the latest announcement |
| Every page | `contentinfo` with `link "Published rules"` | `Spoorline` |
| Empty views | `region "Empty"` with one action | Feedback states |
| Forms and dialogs | `alert "Error"` listing each field error as a link to its field | API `message` and `fields` |
| Page load failure | `alert "Load failed"` with `button "Retry"` | Feedback states |
| `/signin` | `textbox "Username"`, password field labelled `Password`, `button "Sign in"`, `link "Create an account"` | |
| `/signup` | `textbox "Username"`, password field labelled `Password`, `button "Create account"`, `link "Sign in instead"` | |
| Explore | `combobox "Stream"` | stream names |
| Explore | `combobox "Query"` with `listbox "Suggestions"` of `option`s; `alert "Query error"` | |
| Explore | `button "Time range"`; the range text beside it | `Showing <from> to <to>` |
| Time range | `dialog "Time range"` with `tablist "Range kind"` and tabs `Quick`, `Relative`, `Absolute`; Quick: `radio "Last 15 minutes"`, `radio "Last 1 hour"`, `radio "Last 24 hours"`, `radio "Last 7 days"`; Relative: `textbox "Amount"`, `combobox "Unit"` (`seconds`, `minutes`, `hours`, `days`, `weeks`); Absolute: `textbox "From"`, `textbox "To"`; `button "Apply"`, `button "Cancel"` | |
| Explore | `list "Filters"`; each pill `button "Filter <field>: <value>, <include or exclude>, <enabled or disabled>"` opening `menu "Filter actions"` with `menuitem "Invert"`, `menuitem "Disable"` or `menuitem "Enable"`, `menuitem "Remove"` | `<field>: <value>` |
| Explore | `group "Histogram"` with one `button "Bucket <bucket time>, <n> events"` per bucket (`1 event` for one); selected buckets carry `data-selected="true"` | `Interval: <interval>` above |
| Explore | `list "Fields"`; each item `button "Field <field>, <type>"` (type `conflict` for a conflict) | field name, type, and for a conflict `Conflict` and the conflict sentence |
| Explore | `region "Field statistics"` with `table "Top values"` (columns `Value`, `Count`, `Share`), and per row `button "Include <value>"` and `button "Exclude <value>"` | `In <present> of <total> events` |
| Explore | `button "Columns"` opening `dialog "Columns"` with one `checkbox "<field>"` per field and `button "Done"` | |
| Explore | `grid "Events"` with `aria-rowcount`; header row `aria-rowindex="1"`; each `columnheader` holds `button "Sort by <column>"` and `separator "Resize <column>"`, and carries `data-width`; each event `row` has `aria-rowindex` from 2 and the label `Event <i> of <total>, <time>, <host>, <level>` | cells: `@timestamp`, `host`, `level`, `message` by default |
| Explore, phone | `list "Events"` of `article`s with the same labels as the rows; `button "Filters"` opening `dialog "Filters"` (holding `list "Filters"`, `list "Fields"`, `region "Field statistics"`, `button "Done"`) | |
| Explore | `region "Document"`: `button "Close document"`, `button "Surrounding events"`, `button "Explain score"` (only when the query has scoring parts), `button "Edit event"`; `table "Surrounding events"`, with the chosen event's row marked `aria-current="true"`; `tree "Score explanation"` | the event as indented JSON |
| Explore | `dialog "Edit event"`: `textbox "Fields JSON"`, `button "Save event"` | |
| Explore | `button "Save search"` opening `dialog "Save search"`: `textbox "Search name"`, `button "Save"` | |
| Explore | `button "Show new events"` (only when at least one) | `<n> new events since this search` (`1 new event since this search`) |
| Explore | `alert "Snapshot expired"` with `button "Start a new search"`; `status "Partial results"`; `alert "Search failed"` with `button "Retry"`; `alert "Saved search error"` | Feedback states |
| Explore | `button "Live tail"`; `region "Live tail"` with `button "Pause"` or `button "Resume"` | one line per event: `<time> <host> <level> <message>` |
| `/pipes` | `textbox "Spoor Pipe"`, `button "Run"`, `table "Result"` (each `columnheader` has `data-type`), `alert "Pipe error"` | |
| `/streams` | `table "Streams"` (link per stream), `button "New stream"` opening `dialog "New stream"`: `textbox "Stream name"`, `button "Create stream"` | |
| Stream page | `table "Mapping"` (columns `Field`, `Type`, `Generation`, `Explicit`); `button "Add field"` opening `dialog "Add field"`: `textbox "Field name"`, `combobox "Field type"`, `button "Add"`; `combobox "Pipeline"` (first option `None`); `button "Upload file"`; `progressbar "Upload progress"` with `aria-valuenow` and `aria-valuemax` in lines; `table "Uploads"` (columns `File`, `Bytes`, `Status`); `region "Failure store"` with one `article` per failure; `link "Analyze"`, `link "Lifecycle"` | |
| Analyze | `textbox "Text"`, `combobox "Analyzer"`, `button "Analyze"`, `table "Tokens"` (columns `Token`, `Position`, `Start`, `End`) | |
| Lifecycle | `textbox "Rollover max age (ms)"`, `textbox "Rollover max events"`, `textbox "Warm after (ms)"`, `textbox "Archive after (ms)"`, `textbox "Delete after (ms)"`, `button "Save policy"`; `list "Generation timeline"`, one `listitem` per generation | timeline text from Business rules J |
| `/pipelines` | `table "Pipelines"`; `button "New pipeline"` opening `dialog "New pipeline"`: `textbox "Pipeline name"`, `button "Create pipeline"` | |
| Pipeline editor | `textbox "Processors JSON"`, `button "Save pipeline"`, `link "Simulate"` | `Version <n>` |
| Simulate | `region "Simulate"`: `textbox "Sample events"`, `button "Run simulation"`; per sample `group "Event <n>"` holding `group "Step <k> <processor>"` per step, changed fields carrying `data-changed="true"` | Business rules C |
| `/alerts` | `region "Recent cases"`, `table "Rules"`, `link "New rule"`, `link "Maintenance windows"` | |
| `/alerts/new` | `textbox "Rule name"`, `combobox "Stream"`, `textbox "Filter field"`, `combobox "Filter operator"`, `textbox "Filter value"`, `combobox "Measure"`, `textbox "Measure field"`, `textbox "Group by"`, `textbox "Window (ms)"`, `combobox "Comparison"`, `textbox "Threshold"`, `combobox "Action frequency"` (`On status change`, `Every check`, `At most every <n> ms`), `textbox "Interval (ms)"` (only with the third), `button "Save rule"` | |
| Rule page | `status "Last check"`; `table "Groups"`, rows labelled `Group <group>, <state>` followed by `, flapping`, `, snoozed`, `, in maintenance` only when each is true; per group `button "Acknowledge"`, `button "Snooze group"`, `button "Add to case"`; `table "State history"` (columns `Check`, `Group`, `From`, `To`) | |
| Rule page, phone | one `article` per group with the same label and the same three buttons | |
| Snooze | `dialog "Snooze"`: `radio "For 1 hour"`, `radio "For 1 day"`, `radio "Until recovered"`, `button "Snooze"` | |
| `/alerts/maintenance` | `textbox "Name"`, `combobox "Window time zone"`, checkboxes `Monday` to `Sunday` in a `group "Weekly days"`, `textbox "Start (HH:MM)"`, `textbox "Duration (ms)"`, `combobox "Rule"`, `button "Save window"`, `table "Maintenance windows"` (columns `Name`, `Rule`, `Next start`) | |
| `/inbox` | `feed "Inbox"`, each `article` labelled with its item text, holding `button "Acknowledge"` and `button "Add to case"` | `Acknowledged by <username>` once acknowledged |
| Add to case | `dialog "Add to case"`: `combobox "Case"` (open cases, then `New case`), `button "Add"` | |
| `/cases` | `button "New case"` opening `dialog "New case"`: `textbox "Case title"`, `button "Create case"`; `table "Cases"` rows labelled `Case <n>: <title>, <status>` | |
| Case page | `combobox "Case status"`, `button "Update status"`, `list "Case items"`, `textbox "Trace id"`, `button "Link trace"` | items: `Group <group> on rule <rule>`, `Inbox item: <text>`, `link "Trace <id>"` |
| `/traces` | `table "Traces"` with `link "Trace <id>"` | |
| Trace page | `tree "Spans"`; each `treeitem` labelled `Span <name>, <duration> ms, self time <self> ms`, then `, on critical path` and `, shifted +<d> ms` only when each is true; `treeitem "Missing parent"`; `table "Latency"` (columns `Service`, `Spans`, `p50 ms`, `p95 ms`, `p99 ms`) | |
| `/objectives` | `list "Services"` with one `button "<service>"` per service; `region "Objective"` | objective lines from Business rules M |
| `/spaces` | `table "Spaces"`; `button "New space"` opening `dialog "New space"`: `textbox "Space name"`, `textbox "Space slug"`, `button "Create space"`; `table "Members"`; `button "Add member"` opening `dialog "Add member"`: `textbox "Member username"`, `combobox "Role"`, `button "Add"`; `list "Saved searches"` with `link "<name>"` and `button "Copy to space"` per item; `dialog "Copy to space"`: `combobox "Target space"`, `button "Copy"`; `status "Copied"` | `Needs attention` on flagged items |
| `/keys` | `button "New key"` opening `dialog "New key"`: `textbox "Key name"`, `textbox "Stream pattern"`, `group "Actions"` with `checkbox "read"`, `checkbox "upload"`, `checkbox "manage"`, `textbox "Expires in (days)"`, `button "Create key"`, then `textbox "New key value"` (read-only) and `button "Done"`; `table "Keys"` with `button "Revoke <key name>"` per row | the last 4 characters as `...<last4>` |
| `/rules` | fourteen `button`s with `aria-expanded`: `01 Streams and mappings`, `02 Bulk upload`, `03 Pipelines`, `04 Text analysis`, `05 Relevance`, `06 Spoor Query`, `07 Explore`, `08 Moving data`, `09 Spoor Pipe`, `10 Lifecycle`, `11 Alert rules`, `12 Alert handling`, `13 Traces and objectives`, `14 Spaces and keys` | each opens that rule's formula and worked example in the product's own words |

### Interactions (DP-07, DP-08, DP-09, DP-10, DP-11, DP-13, DP-18, DP-19, DP-20, DP-22, DP-37)

**Keyboard map** (one table; each key works whichever control in its region has focus):

| Region | Keys |
|---|---|
| `combobox "Query"` | ArrowDown and ArrowUp move the highlight through `listbox "Suggestions"` (shown with `aria-activedescendant`); Tab accepts the highlighted suggestion and keeps focus in the bar, and with nothing highlighted Tab leaves the bar; Enter always runs the query as typed and closes the list; Escape closes the list. Suggestions refresh as the text or the caret moves. |
| `group "Histogram"` | One Tab stop. ArrowLeft and ArrowRight move focus between buckets; Shift+ArrowLeft and Shift+ArrowRight extend the selection from where it started; Enter applies Bucket Brush (with no selection, Enter applies it to the focused bucket alone) and puts focus on the first bucket of the new range; Escape clears the selection. |
| `grid "Events"` | One Tab stop, a roving cell; Tab into the grid lands on the last focused cell, or the first cell of the first event. ArrowUp and ArrowDown move rows; ArrowLeft and ArrowRight move cells; Home and End go to the first and last event; PageUp and PageDown move 20 rows; Enter opens `region "Document"` for that row with focus on `button "Close document"`; Alt+ArrowLeft and Alt+ArrowRight make the focused cell's column 16 pixels narrower or wider, updating its header's `data-width` (never below 60). Rows are added to the page as focus moves, so focus never lands on a missing row. Tab leaves the grid. |
| `region "Document"` | Escape closes it, and so does `button "Close document"`; focus returns to the same event row it was opened from. |
| `tree "Spans"`, `tree "Score explanation"` | One Tab stop. ArrowDown and ArrowUp move between visible items; ArrowRight opens a closed item or moves to its first child; ArrowLeft closes an open item or moves to its parent; Home and End go to the first and last visible item. |
| Explore page | F6 moves focus to the next region in this order, and Shift+F6 to the previous, wrapping: `combobox "Query"`, `group "Histogram"` (its focused bucket), `list "Fields"` (its first field), `grid "Events"` (its current cell), then `region "Document"` (its close button) when open. No region keeps Tab inside it. |
| Every dialog and sheet | Focus moves into it on opening; Tab and Shift+Tab wrap inside it; Escape closes it; closing by any means returns focus to the control that opened it. |
| Tabs and menus | `tablist "Range kind"` follows the ARIA tabs pattern (arrows move between tabs). Menus follow the ARIA menu pattern; Escape closes a menu with focus back on its button. |

**Pointer and touch.**
- Clicking a suggestion accepts it. Clicking a grid row or tapping a card opens the document panel.
- On the histogram, press on a bucket and drag across others: each covered bucket gets `data-selected="true"`. Releasing applies Bucket Brush. A press and release on one bucket applies it to that bucket alone.
- Dragging `separator "Resize <column>"` sets that column's width.
- **Swipe to acknowledge (phone):** a group card follows a left swipe. On release, if it moved more than 80 pixels left and less than 40 pixels up or down, the group is acknowledged. Otherwise it springs back and nothing changes. `button "Acknowledge"` on the card does the same by tap or keyboard.
- On a phone, tapping a span with children opens or closes it, and its label always keeps its critical path and self time text.
- Scrolling up inside `region "Live tail"` pauses the tail, like `button "Pause"`.

**Flows.**
- `button "Time range"`: choose a quick, relative or absolute range, press Apply, and the dialog closes, focus returns to `button "Time range"`, and the search runs again. Cancel or Escape closes it with no change.
- Field statistics: selecting a field in `list "Fields"` shows its statistics. `button "Include <value>"` adds an include pill, `button "Exclude <value>"` adds an exclude pill, and the search runs again. A pill's menu inverts, disables or enables, or removes it.
- Explore keeps its stream, query, range and filters in the address, so reloading the page or opening the same address shows the same search. The address `/explore?stream=<stream>&from=<ISO time>&to=<ISO time>` always opens that stream and range. Opening it runs that search and announces its count. Each part left out takes its default, and opening `/explore` with no query string uses the same defaults:
  - `stream`: the first stream of the current space by name, ascending by character code. When the space has no stream, Explore shows its empty state band.
  - `to`: server now.
  - `from`: 15 minutes (900000 ms) before `to`, so with both left out the range is `Last 15 minutes`.
- `button "Space"` switches the current space. The page stays on the same route and reloads its data for that space.
- Every live message is applied to the page in its message handler, with no wait on a timer or an animation frame. Updates arrive in place without a reload: group states and overlays, inbox items and acknowledgements, cases, upload progress, the ingest line, generation phases and the server time.

### Visual design (DP-05)

The card's direction is the seed direction, recast as a working console: **exact** (every number on screen links to its published rule), **plain** (a warm paper ground and one deep green accent), and **drafted** (mono numerals and hairline rules). It should read as a drafted technical record in warm paper tones, not as a dark terminal.

- **Type.** JetBrains Mono for field names, log text, numerals, time stamps, bucket labels and the accordion's index numbers. Inter for interface copy. Both are font files bundled with the app. Each heading step is about one and a half times the size of the step below it, so a view title is roughly two and a half times the body text. Sentence case everywhere.
- **Colour roles.** The page ground is a warm off-white paper. A slightly deeper wash marks bands such as the empty state band and the selected field. A sand-toned surface sits behind tables, skeletons and the histogram well. Borders are a warm khaki grey, and dividers are fainter warm hairlines. Text is a near-black ink with a green cast, and secondary text is a muted grey-green. One deep forest green is the accent, used only for actions, links, selection, the tab underline and selected buckets. It turns a shade deeper on hover, and labels on it are white. Brick red marks critical states (active groups, errors, outage boxes), dark ochre marks warnings (pending, flapping), forest green marks healthy states (recovered, `OK`), and slate blue marks information (in maintenance, snoozed, `From archive`). The footer is a near-black green band with light text. Every text and control meets WCAG 2.2 AA contrast.
- **Density and composition.** Comfortable density: a full-width working console with the thin ingest status bar, the header (a little under twice that bar's height), the tabs with a 2-pixel accent underline under the current tab, then the view.
- **Shape.** **Action buttons** come in one shape across the app, nearly square-cornered: filled green with white text for the one main action of a view, and green-outlined with green text for the others. Cards and panels are outlined with a thin border and a heavier ink rule along the bottom edge. Tables sit on the surface tone with hairline row dividers. The query bar is a pill with a thin border that turns green while focused. Focus always shows a green ring set slightly outside the control.
- **States.** An empty state is the wash-toned band with one line and one action. Loading is a still skeleton on the surface tone. Errors and outages are an outlined box with a brick red left edge, the verbatim published copy and a Retry button.
- **Targets.** Every control you can tap is at least 44 pixels in both directions on every layout.
- **Signed-out page.** No marketing hero: the sign-in form sits beside a one-line product statement and the four-band lifecycle drawing.

### Motion and effects (DP-09, DP-13, DP-19)

Motion is quiet and short. Each motion means one thing and finishes in a quarter of a second or less. The page runs these animations through the Web Animations API, each with an `id` that `element.getAnimations()` reports:

| id | On | What it shows | Duration and feel |
|---|---|---|---|
| `bar-settle` | each histogram bar whose height changes after a range change or a live update (bars are matched by position; a new bar grows from nothing) | the bar's height glides from its old value to its new one | 200 ms, starts fast and slows into place, then stops |
| `panel-in` | `region "Document"` when it opens | slides in from a short distance (16 pixels) toward the grid while fading in | 160 ms, starts fast and slows into place |
| `sheet-rise` | a bottom sheet (phone `dialog "Time range"`, `dialog "Filters"`) when it opens | rises from the bottom edge to its resting place | 240 ms, an even ease in and out |
| `tab-slide` | the tab underline when the current tab changes | slides from the old tab to the new one | 240 ms, starts fast and slows into place |

**Bucket Brush, step by step.** (1) The engineer drags across, or Shift+arrows across, a run of buckets, and those buckets turn accent green. (2) Releasing, or pressing Enter, sets the range to the selected buckets' outer edges. (3) When the new data arrives, the interval label changes and each bar whose height changed runs `bar-settle` once. (4) At the same moment the count, the field statistics and the grid show the new range, and the range announcement from Feedback states is made. Hover and press feedback changes colour in under a fifth of a second, and the swipe spring-back takes about a fifth of a second.

Nothing loops: no marquee, no shimmer on skeletons, no pulsing badges, no moving tail lines, and no decorative motion of any kind beyond what this section names.

**Reduced motion.** Under the reduced-motion preference no animation or transition is ever created, so `element.getAnimations()` on any element returns nothing. Bars, panels, sheets and the underline take their final state at once, and a swiped card snaps back. Every label, count and announcement is the same as with motion.

### Feedback states (DP-02, DP-10, DP-14, DP-18, DP-24, DP-34, DP-36, DP-37, DP-39, DP-45)

**General rules.**
- While a write is in flight, its button carries `aria-busy="true"`, ignores repeat presses, and `data-pending` counts it.
- Validation errors appear in that form's `alert "Error"` and next to each field.
- A page that cannot load its data shows `alert "Load failed"` with `Spoorline can't reach the server. Retry when your connection is back.` and `button "Retry"`.
- An API error shows its `message` verbatim in the named alert of the place that made the request. All interface text and API messages use straight ASCII apostrophes and quotes, never curly ones.
- Every announcement below goes to `status "Announcements"` (polite). When one live message carries several of them, they are joined by one space in the order the message lists them.

**Announcements** (each sentence's placeholders are filled from the record):

| When | Sentence |
|---|---|
| A search finishes (Enter, Apply, pill change, stream change) | `<n> events found` (`1 event found`, `0 events found`) |
| Bucket Brush applies | `Time range set: <n> events found` (`1 event found`) |
| The live tail is paused, and again on each buffered event | `Live tail paused: <n> new events` (`1 new event`) |
| A group changes state | `Group <group> is now <state>` |
| An upload or bulk request ends | `Upload done: <c> created, <d> duplicates, <f> failed` (`1 duplicate`), with `, <x> dropped` added only when some were dropped |
| A case changes status | `Case <n> is now <status>` |
| An inbox item or group is acknowledged | `Acknowledged Group <group>` |

**Success notices**, also announced in `status "Announcements"`, and shown on the page until the next notice:

`Stream <name> created.` · `Field <field> added as <type>.` · `Pipeline saved. Only new events are affected.` · `Policy saved. It applies from the next step, and no generation moves backward.` · `Rule <name> saved.` · `Maintenance window <name> saved.` · `Group <group> snoozed until <time>.` · `Group <group> snoozed until it recovers.` · `Search <name> saved.` · `Event saved.` · `Case <n> created.` · `Added to case <n>.` · `Time zone set to <zone>.` · `Space <name> created.` · `<username> added as <role>.` · `Key <name> revoked.`

**Named states with exact copy:**

| Place | State | Copy |
|---|---|---|
| `region "Ingest status"` | always, live | `<stored> events stored, <failed> in failure store` for the current space |
| Header | always, live | `Server time <time>` |
| Grid | loading | still skeleton rows; `data-search-state="loading"` |
| `alert "Search failed"` | search request failed (network or 503) | the API `message`, or the load-failure sentence above, and `button "Retry"` |
| `status "Partial results"` | a search skipped archived generations | `Partial results: <k> archived generations skipped because storage is unavailable.` (`1 archived generation`) |
| `alert "Snapshot expired"` | the snapshot answered 410 | the `snapshot_expired` message from API, with `button "Start a new search"` |
| `region "Live tail"` | paused | the paused sentence above, and when events were discarded, `Buffer full: oldest <n> events discarded.` (`1 event`) |
| `region "Live tail"` | rate limited | `Live tail slowed: rate limit reached.` |
| Stream page | upload running | `Upload: <done> of <total> lines` beside `progressbar "Upload progress"` |
| Stream page | upload ended | the upload done sentence above |
| `table "Uploads"` | file status | `kept` (storage confirmed), `parsing`, `done` |
| Search results | row read from a segment | `From archive` |
| Lifecycle page | archive failed | `Archive failed. It will retry on the next step.` |
| Lifecycle page | delete failed | `Delete failed. It will retry on the next step.` |
| `status "Last check"` | after a check | `Last check at <time>: ok`, or `Check failed at <time>: state kept.` |
| `textbox "New key value"` | key just created | `This key is shown once. Copy it now.` beside it |
| `status "Copied"` | saved search copied | `Copied with no missing references.`, or `Copied with <n> missing references: <list>.` (`1 missing reference`), where `<list>` is each missing reference as `stream <name>`, joined by `, ` |
| `alert "Saved search error"` | opening a saved search whose stream is missing | `Stream <name> doesn't exist in this space.` |
| Not-found screen | unknown route | heading `Page not found.` with `link "Go to Explore"` |

**Empty state band** (`region "Empty"`), one line and one action per view:

| View | Line | Action |
|---|---|---|
| Explore | `No events in this range.` | `button "Widen to last 7 days"` |
| Streams | `No streams in this space yet.` | `button "New stream"` |
| Pipelines | `No pipelines yet.` | `button "New pipeline"` |
| Alerts | `No alert rules yet.` | `link "New rule"` |
| Inbox | `Nothing in the inbox.` | `link "Alerts"` |
| Cases | `No cases yet.` | `button "New case"` |
| Traces | `No traces yet.` | `link "Published rules"` |
| Objectives | `No objectives yet.` | `link "Published rules"` |
| Keys | `No API keys yet.` | `button "New key"` |

## Backend

### API (DP-01, DP-02, DP-03, DP-04, DP-07, DP-11, DP-25, DP-27, DP-33, DP-34, DP-35, DP-36, DP-37, DP-38, DP-39, DP-44)

All bodies are JSON (`application/json`) unless stated. Times in requests and responses are ISO 8601 UTC with milliseconds (for example `2026-03-01T10:00:00.000Z`). Every write answers with `seq`, the space's live sequence number after that write.

**Body limits.** A JSON body may be at most 1000000 bytes; exactly 1000000 is allowed. Over that: 413 `body_too_large`. Bulk and file upload bodies may be at most `SPOOR_UPLOAD_MAX_BYTES` bytes, limit included. Over that: 413 `upload_too_large`. Lengths of names and query text count Unicode characters, so an emoji counts as 1.

**Space selection.** Every space-scoped endpoint takes `space=<slug>`. Without it, a session uses its current space. A key always uses its own space, and a key request naming any other space answers 404.

**Error body.** Every error answers `{"error":"<code>","message":"<sentence>"}`. A query or pipe error adds `"position":<1-based>`. A form validation error adds `"fields":{"<field>":"<sentence>"}`.

**Error order.** The API decides errors in this order, and the first that applies answers:
1. 413 or 415 (body size or kind)
2. 401 (not signed in, or the key is missing, invalid, expired or revoked)
3. 429 (rate limit)
4. 404 or 410 (the resource is unknown, belongs to a space the caller cannot reach, or has expired)
5. 403 (role or key scope)
6. 409 (state conflict)
7. 422 (validation)

Sign-in is the one exception: its 429 comes before its 401. A resource in another space answers 404 to anyone without access to that space, never 403. Endpoint rows below list only their own extra errors.

**Error codes:**

| Status | Code | Message |
|---|---|---|
| 401 | `unauthenticated` | `Sign in to continue.` |
| 401 | `bad_credentials` | `Username or password is wrong.` |
| 401 | `key_invalid` | `This API key isn't valid.` |
| 401 | `key_expired` | `This API key has expired.` |
| 401 | `key_revoked` | `This API key was revoked.` |
| 403 | `forbidden` | `Your role in this space can't do this.` |
| 403 | `key_scope` | `This key can't upload to stream <name>.`, `This key can't read stream <name>.`, or `This key can't manage stream <name>.` |
| 404 | `not_found` | `Not found.` |
| 409 | `name_taken` | `That name is already used.` |
| 409 | `mapping_exists` | `Field <field> already has a type in generation <g>.` |
| 409 | `generation_read_only` | `Generation <g> is <phase> and read-only.` |
| 409 | `case_flow` | `A case can't go from <from> to <to>.` |
| 410 | `snapshot_expired` | `This snapshot expired. Results may have changed. Start a new search.` |
| 413 | `body_too_large` | `Request body is larger than 1000000 bytes.` |
| 413 | `upload_too_large` | `Upload is larger than <SPOOR_UPLOAD_MAX_BYTES> bytes.` |
| 415 | `upload_kind` | `Only .ndjson files can be uploaded.` |
| 422 | `invalid` | `Check the highlighted fields.` (with `fields`) |
| 422 | `query_too_long` | `Query is longer than <SPOOR_QUERY_MAX_LEN> characters.` |
| 422 | `query_too_deep` | `Query nests deeper than <SPOOR_QUERY_MAX_DEPTH> levels.` |
| 422 | `query_work_limit` | `Query stopped: work limit of <SPOOR_QUERY_WORK_MAX> reached.` |
| 422 | `query_time_budget` | `Query stopped: time budget of <SPOOR_QUERY_BUDGET_MS> ms reached.` |
| 422 | `query_syntax` | a sentence from Business rules F |
| 422 | `result_window` | `Results past <SPOOR_RESULT_WINDOW> need a snapshot.` |
| 422 | `field_conflict` | the conflict sentence from Business rules A |
| 422 | `pipe_syntax` | a sentence from Business rules I |
| 422 | `unknown_pipeline` | `Pipeline <name> doesn't exist.` |
| 422 | `trace_invalid` | a sentence from Business rules M |
| 429 | `rate_limited` | `Too many requests. Try again in <n> seconds.`, with header `Retry-After: <n>` |
| 503 | `storage_unavailable` | `Storage is unavailable. Nothing was stored.` |
| 503 | `database_unavailable` | `The event store is unavailable. Try again shortly.` |

For example, with the grading values, `Query is longer than 2000 characters.`, `Results past 200 need a snapshot.` and `Upload is larger than 200000 bytes.`

**Platform and accounts:**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/health` | | 200 `{"status":"ok"}` when Postgres and storage answer; 200 `{"status":"unavailable"}` when storage does not; never 503 | |
| `GET /api/config` | | 200 `{"grading":bool,"settings":{"page_size":n,"tail_buffer":n,"query_max_len":n,"query_max_depth":n,"upload_max_bytes":n,"sse_heartbeat_ms":n}}` | |
| `GET /api/time` | | 200 `{"now":"<iso>","now_ms":n}` (server clock) | |
| `POST /api/signup` | `{"username","password"}` | 201 `{"username","space":"<slug>"}` and the session cookie | 409 `name_taken` (`fields.username`: `That username is taken.`); 422 |
| `POST /api/signin` | `{"username","password"}` | 200 `{"username","space":"<slug>"}` and the session cookie | 401 `bad_credentials`; 429 |
| `POST /api/signout` | | 204, cookie cleared | |
| `GET /api/me` | | 200 `{"username","time_zone","space":{"slug","name","role"},"spaces":[{"slug","name","role"}],"seq":n}` | |
| `PATCH /api/me` | `{"time_zone"?,"space"?}` | 200, same body as `GET /api/me` | 404 for a space that isn't the user's; 422 `fields.time_zone`: `Unknown time zone <name>.` |
| `GET /api/events?space=<slug>` | | `text/event-stream`, as described in Business rules | |

**Grading routes** (only when `SPOOR_GRADING=1`; otherwise every one answers 404 `not_found`):

| Method and path | Request | Success |
|---|---|---|
| `POST /api/grading/seed` | the seed body below | 201 `{"users":[{"username","id"}],"spaces":[{"slug","id"}],"keys":[{"name","id","key"}],"streams":[{"space","name","id","generations":[{"number","id","phase"}]}],"pipelines":[{"name","id","version"}],"saved_searches":[{"name","id"}],"rules":[{"name","id"}],"maintenance":[{"name","id"}],"cases":[{"number","id"}],"traces":[{"trace_id"}],"objectives":[{"name","id"}],"seq":n}`. 409 `name_taken` when a name already exists. 422 for an invalid section. 503 `storage_unavailable` for an archived generation while storage is down. |
| `POST /api/grading/session` | `{"username"}` | 200 `{"username"}` with the session cookie set for the calling browser context |
| `POST /api/grading/clock` | `{"set_ms":n}` or `{"advance_ms":n}` | 200 `{"now","now_ms"}`. It sends a `clock` message to every space, and an `alert` message for each group whose snooze or maintenance overlay changed. It does not run checks or lifecycle steps. |
| `POST /api/grading/check` | `{"rule":"<id>"}`, optionally with `"fail":true` | 200 `{"rule","checked_at","failed":bool,"groups":[{"group","state","value","flapping","snoozed","in_maintenance","action":"fired"|"held"|"none"}],"seq"}` |
| `POST /api/grading/lifecycle` | `{"stream":"<name>","space":"<slug>"}` | 200 `{"stream","generations":[<generation>],"seq"}` |
| `POST /api/grading/storage` | `{"down":true}` or `{"down":false}` | 200 `{"storage":"down"|"up"}`. While down, every storage call the app makes fails as if storage were unreachable; restoring needs no restart. |

The seed body: every top-level section is optional and independent, and the response lists ids only for the sections given.

```json
{
  "users": [{"username": "ana", "password": "pass-word-1", "time_zone": "UTC"}],
  "spaces": [{"slug": "s1", "name": "S1", "members": [{"username": "ana", "role": "admin"}]}],
  "keys": [{"space": "s1", "name": "k1", "stream_pattern": "web*", "actions": ["upload"], "expires_in_days": 30}],
  "streams": [{"space": "s1", "name": "web", "mappings": {"host": "keyword"},
    "lifecycle": {"rollover_max_age_ms": 60000, "rollover_max_events": null, "warm_after_ms": 60000, "archive_after_ms": 120000, "delete_after_ms": null},
    "generations": [{"number": 1, "phase": "warm", "created_at": "<iso>", "rolled_over_at": "<iso>",
      "events": [{"_id": "e1", "@timestamp": "<iso>", "host": "host-7", "message": "..."}]}]}],
  "pipelines": [{"space": "s1", "name": "p1", "processors": []}],
  "saved_searches": [{"space": "s1", "name": "q1", "stream": "web", "q": "", "filters": [], "from": "<iso>", "to": "<iso>"}],
  "rules": [{"space": "s1", "name": "High errors", "stream": "web", "filter": null, "measure": "count", "measure_field": null,
    "group_by": "host", "window_ms": 300000, "comparison": ">", "threshold": 5, "frequency": {"kind": "change"},
    "groups": [{"group": "host-7", "state": "active", "since": "<iso>", "history": [{"at": "<iso>", "from": "pending", "to": "active"}]}]}],
  "maintenance": [{"space": "s1", "name": "Nightly", "time_zone": "America/New_York", "days": ["mon"], "start": "02:00", "duration_ms": 3600000, "rule": "High errors"}],
  "cases": [{"space": "s1", "title": "Checkout errors", "status": "open"}],
  "traces": [{"space": "s1", "trace_id": "t1", "spans": []}],
  "objectives": [{"space": "s1", "service": "web", "name": "Web availability", "stream": "web", "target": 99.5,
    "objective_window_ms": 2592000000, "bad": {"field": "level", "op": "eq", "value": "error"},
    "counts": {"objective": {"bad": 2000, "total": 1000000}, "long": {"bad": 240, "total": 12000}, "short": {"bad": 30, "total": 1000}}}],
  "rates": {"upload": 3, "login": 3, "search": 3, "tail": 5}
}
```

Seed semantics:
- Seeded events are written straight into the chosen generation, skipping pipelines and the bulk line checks. They are still indexed and typed by Business rules A, and a value that does not fit its field answers 422.
- The highest-numbered generation must be `hot`; it is the write generation.
- An `archive` generation is written to storage and confirmed before the seed answers.
- `counts` on an objective, when given, fixes its counts instead of computing them from events.
- `rates` replaces the four rate settings for this running server until the next seed with `rates`.

**Streams, events and search** (all space-scoped; a session needs a role, and a key needs the named action):

| Method and path | Request | Success | Role or key action | Extra errors |
|---|---|---|---|---|
| `GET /api/streams` | | 200 `{"streams":[{"name","write_generation","events","failures"}]}` | viewer, read | |
| `POST /api/streams` | `{"name"}` (1 to 40 of `a-z 0-9 -`) | 201 `{"name","write_generation":1,"seq"}` | admin, manage | 409 `name_taken` |
| `GET /api/streams/<s>` | | 200 `{"name","mapping":[{"field","type","generation","explicit"}],"generations":[<generation>]}` | viewer, read | |
| `POST /api/streams/<s>/mappings` | `{"field","type"}` | 201 `{"field","type","generation","seq"}` | admin, manage | 409 `mapping_exists` |
| `POST /api/streams/<s>/bulk?pipeline=<name>` | body `application/x-ndjson` | 200 `{"created","duplicates","dropped","failed","lines":[{"line","status","id"?,"error"?}],"seq"}` | editor, upload | 415 `upload_kind` for any other content type; 422 `unknown_pipeline` |
| `POST /api/streams/<s>/uploads` | `multipart/form-data` with part `file`, optional part `pipeline` | 202 `{"id","file","bytes","sha256","status":"kept","seq"}` | editor, upload | 413, 415 as in Business rules B; 422 `unknown_pipeline`; 503 `storage_unavailable` |
| `GET /api/streams/<s>/uploads` | | 200 `{"uploads":[{"id","file","bytes","sha256","status","done_lines","total_lines","created","duplicates","dropped","failed"}]}` | viewer, read | |
| `GET /api/streams/<s>/failures` | | 200 `{"failures":[{"id","reason","raw","at"}]}`, newest first, ties by `id` descending | viewer, read | |
| `PATCH /api/streams/<s>/events/<id>` | `{"fields":{"<field>":<value>}}` | 200 `<event>` | editor | 409 `generation_read_only`; 422 |
| `GET /api/streams/<s>/events/<id>/surrounding` | | 200 `{"before":[<event>],"event":<event>,"after":[<event>]}` | viewer, read | |
| `GET /api/streams/<s>/generations` | | 200 `{"generations":[<generation>]}` | viewer, read | |
| `PUT /api/streams/<s>/lifecycle` | the five policy fields (whole milliseconds or `null`; `rollover_max_events` a count or `null`) | 200 `{"policy","message","seq"}` | admin, manage | 422 |
| `GET /api/search` | query `stream`, `q`, `from`, `to`, `filters` (a JSON list of `{"field","op","value"}`, `op` one of `eq` `ne` `exists` `gt` `gte` `lt` `lte`), `sort` (`<field>:asc` or `<field>:desc`), `size` (1 to 100, default 50), `offset` (default 0), `explain=true`, `id` | 200 `{"total","events":[<event>],"partial","skipped_generations"}` | viewer, read | 422 `query_*`, `query_syntax`, `result_window`, `field_conflict` |
| `GET /api/histogram` | `stream`, `q`, `from`, `to`, `filters`, `tz` | 200 `{"interval","buckets":[{"start","end","count","label"}],"total","partial","skipped_generations"}` | viewer, read | as search |
| `GET /api/fields` | `stream`, `from`, `to` | 200 `{"fields":[{"field","type","conflict"?}]}` (alphabetical; `conflict` holds the sentence) | viewer, read | |
| `GET /api/fields/stats` | `field`, `stream`, `q`, `from`, `to`, `filters` | 200 `{"field","present","total","top":[{"value","count","share":"62.5"}]}` | viewer, read | 422 `field_conflict` |
| `GET /api/suggest` | `stream`, `q`, `cursor` (0-based character index), `from`, `to` | 200 `{"kind":"field"|"operator"|"value"|"none","items":[{"label","insert","count"?}]}` (item rules in Business rules F) | viewer, read | |
| `POST /api/analyze` | `{"analyzer","text"}` | 200 `{"tokens":[{"token","position","start","end"}]}` | viewer, read | 422 |
| `POST /api/snapshots` | `{"stream","from","to","q","filters","sort"?}` | 201 `{"id","total","partial","skipped_generations"}` | viewer, read | as search |
| `GET /api/snapshots/<id>?after=<cursor>` | | 200 `{"events":[<event>],"next":"<cursor>"|null,"total","new_events"}` | viewer, read | 410 `snapshot_expired` |
| `GET /api/tail?stream=<s>` | | `text/event-stream` (Business rules H) | viewer, read | |
| `POST /api/pipe` | `{"pipe"}` | 200 `{"columns":[{"name","type"}],"rows":[[...]]}` | viewer, read | 422 `pipe_syntax`, `query_*`, `field_conflict` |

`<event>` is `{"_id","@timestamp","_generation":n,"_phase":"hot"|"warm"|"archive","_pipeline":"<name>@<version>"|null,"_score":n|null,"fields":{<flattened fields>},"highlights":{"<field>":[[start,end]]}}`.

`<generation>` is `{"number","phase","created_at","rolled_over_at"|null,"events","next":{"step","at"}|null,"segment":{"key","bytes"}|null,"timeline":"<timeline text>"}`.

Searches without a snapshot refuse `offset + size` over `SPOOR_RESULT_WINDOW`; exactly the window is allowed. `id` restricts the returned events to that one event while N, df and avgdl stay those of the whole search. With `explain=true` each event in `events` carries `explanation` (there is no top-level explanations key): `{"value","text":"Score <value>","children":[{"value","leaf","field","idf","tf_norm","boost","text"}]}`.

**Pipelines:**

| Method and path | Request | Success | Role | Extra errors |
|---|---|---|---|---|
| `GET /api/pipelines` | | 200 `{"pipelines":[{"name","version","processors"}]}` | viewer | |
| `PUT /api/pipelines/<name>` | `{"processors":[...]}` | 201 on create, 200 on change: `{"name","version","processors","message","seq"}` | admin | 422 with `fields`: `Processor <k>: <reason>.` |
| `POST /api/pipelines/<name>/simulate` | `{"lines":"<newline-delimited sample events>"}` | 200 `{"results":[{"event":n,"outcome":"stored"|"dropped"|"failed","error"?,"steps":[{"step","processor","status":"applied"|"skipped"|"failed"|"dropped","event","changed":[...],"text"?}]}]}` | editor | |

**Alerts, inbox and cases:**

| Method and path | Request | Success | Role | Extra errors |
|---|---|---|---|---|
| `GET /api/rules` · `GET /api/rules/<id>` | | 200 rules, each with `groups:[{"group","state","flapping","snoozed","snoozed_until","in_maintenance","acknowledged_by"}]`, `last_check:{"at","failed"}` and `history` | viewer | |
| `POST /api/rules` | `{"name","stream","filter":{"field","op","value"}|null,"measure","measure_field","group_by","window_ms","comparison","threshold","frequency":{"kind":"change"}|{"kind":"check"}|{"kind":"throttle","every_ms":n}}` | 201 `{"id",...,"seq"}` | editor | 409 `name_taken`; 422 |
| `POST /api/rules/<id>/groups/<group>/snooze` | `{"for":"1h"|"1d"|"recovered"}` | 200 `<group>` | editor | |
| `POST /api/rules/<id>/groups/<group>/ack` | | 200 `<group>` | editor | |
| `GET /api/maintenance` · `POST /api/maintenance` | `{"name","time_zone","days":["mon".."sun"],"start":"HH:MM","duration_ms","rule":"<id>"}` | 200 list with `next_start` · 201 `{"id",...,"next_start","seq"}` | viewer · editor | 422 |
| `GET /api/inbox` | | 200 `{"items":[{"id","rule","group","text","at","acknowledged_by"}]}`, newest first | viewer | |
| `POST /api/inbox/<id>/ack` | | 200 the item | editor | |
| `GET /api/cases` · `POST /api/cases` | `{"title"}` | 200 list · 201 `{"number","title","status":"open","seq"}` | viewer · editor | 422 |
| `GET /api/cases/<n>` · `PATCH /api/cases/<n>` | `{"status"}` | 200 `{"number","title","status","items"}` | viewer · editor | 409 `case_flow` |
| `POST /api/cases/<n>/items` | `{"rule","group"}`, `{"inbox_item"}` or `{"trace_id"}` | 201 the case | editor | 422 |

**Traces, objectives, spaces, keys and saved searches:**

| Method and path | Request | Success | Role | Extra errors |
|---|---|---|---|---|
| `POST /api/traces` | `{"trace_id","spans":[{"span_id","parent_id"|null,"service","name","start_ms","duration_ms"}]}` | 201 `{"trace_id","spans":n}` | editor | 409 `name_taken`; 422 `trace_invalid` |
| `GET /api/traces` · `GET /api/traces/<id>` | | 200 list · 200 `{"trace_id","roots":[<span node>],"missing_parent":[<span node>],"critical_path":["<span_id>"],"latency":[{"service","spans","p50","p95","p99"}]}`; `<span node>` is `{"span_id","name","service","start_ms","duration_ms","shift_ms","self_ms","on_critical_path","children"}` | viewer | |
| `GET /api/objectives` · `POST /api/objectives` | the seed objective fields without `counts` | 200 `{"objectives":[{"id","service","name","target","budget_remaining":"60.00","long":{"bad","total","burn":"4.00"},"short":{"bad","total","burn":"6.00"},"status":"OK"}]}` · 201 | viewer · editor | 409 `name_taken` (one objective per service); 422 |
| `GET /api/spaces` · `POST /api/spaces` | `{"slug","name"}` | 200 list · 201 `{"slug","name","seq"}`, creator is admin | any signed-in user | 409 `name_taken`; 422 |
| `POST /api/spaces/<slug>/members` | `{"username","role"}` | 201 `{"username","role"}` | admin | 404 unknown user; 409 already a member |
| `GET /api/keys` · `POST /api/keys` | `{"name","stream_pattern","actions":[...],"expires_in_days":n|null}` | 200 `{"keys":[{"id","name","stream_pattern","actions","expires_at","revoked","last4"}]}` · 201 the same fields plus `"key":"spk_<32 lower-case hex>"` | admin | 422 |
| `DELETE /api/keys/<id>` | | 200 the key without `key`, `revoked:true` | admin | |
| `GET /api/saved-searches` · `POST /api/saved-searches` | `{"name","stream","q","filters","from","to"}` | 200 list with `needs_attention` · 201 | viewer · editor | 422 |
| `GET /api/saved-searches/<id>` | | 200 the saved search, plus `problem` (the missing-stream sentence) when its stream is missing | viewer | |
| `POST /api/saved-searches/<id>/copy` | `{"space":"<target slug>"}` | 201 `{"id","space","missing":["stream <name>"],"needs_attention":bool,"message"}` | editor in both spaces | 404 for a target the user isn't in |

### Business rules (DP-02, DP-03, DP-12 to DP-17, DP-20, DP-21, DP-23 to DP-45)

**Accounts and roles.**
- A username is 3 to 24 characters of `a-z 0-9 _`. It is stored lower case, so sign-in ignores case. Field error: `Use 3 to 24 characters: a-z, 0-9 or _.`
- A password is at least 8 characters, stored only as a salted slow hash. Field error: `Use at least 8 characters.`
- Sign-up creates a personal space whose slug and name are the username, makes the user its admin, and sets it as the current space.
- The session cookie is `spoor_session` with `HttpOnly; SameSite=Lax` and no `Secure` flag.
- After sign-in or sign-up the address bar shows `/explore`, and reloading it shows the same screen.
- Roles per space: `viewer` reads everything in the space. `editor` also uploads, edits hot events, saves searches, creates rules, maintenance windows, snoozes, acknowledgements, cases, traces and objectives, and simulates pipelines. `admin` also manages streams, mappings, pipelines, lifecycle policies, keys and members.
- Sign-ins are limited per username to `SPOOR_LOGIN_RATE` per server-clock minute, counting right and wrong passwords.

**Server clock.**
- With `SPOOR_GRADING=1` the server clock starts at `2026-03-01T00:00:00Z` when the server boots and stands still except when `POST /api/grading/clock` moves it. Rule checks and lifecycle steps then run only through their grading routes.
- Without grading, the server clock is the system clock, a check runs every `SPOOR_CHECK_INTERVAL_MS`, and a lifecycle step runs every `SPOOR_LIFECYCLE_INTERVAL_MS`.
- The device clock may be wrong. Everything time-dependent comes from the server: rule checks, snooze ends, maintenance windows, lifecycle phases and next steps, key expiry, snapshot expiry, rate windows, and "now" in every relative time and quick range. The page shows the last server time it received, from `GET /api/time` and each `clock` message, and fetches it again before each search.

**Display time.** Every time on screen reads `YYYY-MM-DD HH:MM:SS +HH:MM` in the viewer's time zone, a profile setting holding an IANA name (default `UTC`, shown as `+00:00`).

**Live messages.**
- `GET /api/events?space=<slug>` sends messages of types `clock`, `alert`, `inbox`, `case`, `upload` and `lifecycle`, each with `id: <seq>` and JSON data carrying `seq`.
- `seq` is per space: it starts at 0 and rises by one for each message.
- An `upload` message carries the upload or bulk counts, `stored_total` and `failure_total`. A `lifecycle` message carries the stream's generations and the same two totals.
- Both event streams (this one and the live tail) send a comment line every `SPOOR_SSE_HEARTBEAT_MS`, and the server stops its work for a stream when the client disconnects.
- A non-member asking for a space's events gets 404.

**Rate limits.** Each limit counts per fixed server-clock minute:
- uploads (bulk and file) per key, or per user for a session, against `SPOOR_UPLOAD_RATE`
- searches per session against `SPOOR_SEARCH_RATE`, where each call to search, histogram, fields, field statistics, suggestions, snapshot creation and pipe counts one
- sign-ins as above

The first request over a limit and every later one in that minute answer 429 `rate_limited`. `<n>` in its message and `Retry-After` is the whole number of seconds left until the next server-clock minute, rounded up, at least 1. For example, at `2026-03-01 00:00:00 +00:00` it is 60.

**Concurrency.**
- Of two lines with the same `_id` in a stream, sent at the same time, exactly one is `created` and the other is `duplicate`.
- Two lifecycle steps on one stream at the same time roll it over at most once.
- Of two acknowledgements of the same item at the same time, the first committed names the acknowledger; both answer 200 with that name, and a repeated acknowledgement answers 200 unchanged.
- Of two case status changes from the same status at the same time, one succeeds and the other answers 409 `case_flow`.

#### A. Streams and mappings
- A stream holds at most 100,000 events. It has generations numbered 1, 2, 3 upward. Exactly one, the write generation (the highest number), is hot and takes new events. There are no clusters, nodes, shards or replicas.
- Field types are `number`, `date`, `boolean`, `text` and `keyword`. A new field's type is inferred from its first value in the generation, trying in order: number (a JSON number), date (a string in ISO 8601 form with a time and a zone), boolean (JSON `true` or `false`), then text.
- A value fits a field when: a string fits `text` and `keyword`; an ISO date string also fits `date`; a number fits `number`; `true` and `false` fit `boolean`.
- An explicit mapping can only be added for a field the write generation does not have yet, and it then wins over inference.
- Nested objects flatten into dotted paths, so `{"request":{"status":500}}` is field `request.status`. An array is a multi-value field whose values must all be of one type. An array of objects keeps each object together for object scopes (rule F).
- Each generation keeps its own mapping. Explicit mappings carry over at rollover; inferred ones are inferred again.
- A field with different types across the generations a search covers is a conflict. It shows `Field <field> is <type a> in generation <a> and <type b> in generation <b>. It can't be sorted or counted.`, where `<a>` is the lowest generation with the field and `<b>` the lowest generation whose type differs from it. For example: `Field status is number in generation 1 and text in generation 2. It can't be sorted or counted.`
- A conflict field is excluded from sort and statistics; sorting by it or counting it answers 422 `field_conflict` with that sentence. Querying it still works, using each generation's own type.

#### B. Bulk upload
- The only upload format is newline-delimited JSON. Each line is one JSON object with a required `@timestamp` and an optional client id `_id`; without `_id` the server assigns one. Lines succeed independently.
- Each line is processed in this order: parse, the chosen pipeline, the `@timestamp` check, the duplicate check, the type check, the stream size check, then store.
- A blank line is ignored but still counts in the numbering, which starts at 1.
- Line errors, exactly:
  - `Line <n>: not valid JSON.`
  - `Line <n>: not an object.`
  - `Line <n>: @timestamp is missing.`
  - `Line <n>: @timestamp is not a date.`
  - `Line <n>: field <field> expects <type>, got <type>.` (for example `Line 5: field status expects number, got text.`)
  - `Line <n>: field <field> mixes types in one array.`
  - `Line <n>: stream <name> is full at 100000 events.`
  - the pipeline failure sentence from rule C
- A line whose `_id` already exists in the stream, in any generation, is `duplicate` and stores nothing, however many times it is sent. A line that a `drop` processor removes is `dropped`.
- Each failed line goes to the failure store with its raw text, its reason and the server time. `region "Failure store"` lists them newest first.
- **File upload.** The file kind is judged before anything is stored, at the same point as the size check. A file is accepted only when all of these hold:
  - its name ends in `.ndjson` (any case)
  - its bytes are valid UTF-8 with no NUL byte
  - its first character that isn't whitespace is `{`

  Anything else answers 415 `upload_kind`. Only the last part of the file name is kept for display; the name never chooses the storage key.
- An accepted file is stored in storage and confirmed (the store reports the same byte size) before the 202 answer. Only then does `table "Uploads"` show it as `kept`, and only then does parsing start.
- Progress goes out as an `upload` message every `SPOOR_UPLOAD_PROGRESS_LINES` lines and at the end. Total lines count every line, blank lines included, with no trailing empty line after a final newline. Every browser in the space shows the same progress.
- A bulk request sends one `upload` message when it ends.

#### C. Pipelines
- A pipeline is an ordered list of processors, written as JSON objects with a `type`. There are no nested pipelines, and no processor writes `_id`.

| Processor | Settings | Effect | Fails when |
|---|---|---|---|
| `split` | `field`, `pattern` (a literal separator), `targets` (list of field names) | writes the parts to `targets` in order and keeps `field` | the field is missing (`field <field> is missing`), or the number of parts differs from the number of targets (`split made <k> parts, expected <t>`) |
| `rename` | `from`, `to` | moves the value, replacing any existing `to` | `from` is missing (`field <from> is missing`) |
| `set` | `field`, `value` (any JSON) | sets the field | never |
| `parse_date` | `field`, `format` (`iso` or `epoch_ms`) | writes `@timestamp` from the field | the field is missing (`field <field> is missing`) or unparsable (`<value> is not a date`) |
| `drop` | | removes the event (`dropped`); later processors don't run | never |
| `redact` | `field`, `pattern` (`ipv4`, `email`, `digits`) | replaces each match in a string value with `[hidden]`; a missing or non-string field is unchanged | never |

- `ipv4` is four dot-separated groups of 1 to 3 digits, each 0 to 255, not touching other digits. `email` is a local part of letters, digits and `. _ % + -`, then `@`, then a domain of letters, digits, `-` and `.` ending in a dot and at least two letters. `digits` is each run of one or more ASCII digits.
- Each processor may have one condition, `"if":{"field","op","value"}`, with `op` one of `eq`, `ne` or `exists`. `eq` and `ne` compare JSON values exactly, and `ne` is true for a missing field. A false condition skips the processor.
- Each pipeline has one failure handler: on any processor failure the event goes to the failure store with `Pipeline <name> failed at processor <k>: <reason>.` (`<k>` is 1-based), and nothing else from it is stored.
- **Simulation** runs the saved version on the sample lines, each line one JSON object. A bad sample line shows `Event <n>: not valid JSON.`
  - Each step shows the event JSON after it. Fields it changed carry `data-changed="true"` and the text `changed`.
  - A skipped step says `Skipped: condition false`, a `drop` step says `Dropped`, and a failed step shows the failure handler sentence, after which no further steps run.
  - Simulation stores nothing, and the stream's event count does not change.
- Saving a pipeline raises its version by one. Only events stored afterwards use the new version. Stored events are never touched, and each event records `<name>@<version>` in `_pipeline`.

#### D. Text analysis
- There are three analyzers:
  - `standard` splits the value into runs of ASCII letters and digits (anything else separates them), lower-cases each run, drops stopwords, and applies the suffix table. Every run takes a position, dropped stopwords included.
  - `keyword` keeps the whole value as one token, unchanged.
  - `whitespace` splits on whitespace and keeps case, with no stopwords.
- Stopwords: `a an and are as at be but by for from in is it of on or that the to was with`.
- Suffix table, tried in this order: `ies` becomes `y`, `ing` is removed, `ed` is removed, `es` is removed, `s` is removed. The first row whose suffix ends the token and leaves at least 3 characters applies; if none does, the token is unchanged.
- A `text` field uses `standard` and matches by tokens. A `keyword` field matches the whole value exactly.
- Positions are 0-based. Offsets are 0-based character offsets into the original value, start included and end excluded.
- **Worked example.** `The servers failed, retrying 2 connections` under `standard` gives:

  | Token | Position | Start | End |
  |---|---|---|---|
  | `server` | 1 | 4 | 11 |
  | `fail` | 2 | 12 | 18 |
  | `retry` | 3 | 20 | 28 |
  | `2` | 4 | 29 | 30 |
  | `connection` | 5 | 31 | 42 |

  `The` held position 0 and was dropped as a stopword.

#### E. Relevance
- Each scoring leaf (a term or a phrase on a text field, not under NOT) has `value = idf * tf_norm * boost`, where:
  - `idf = ln(1 + (N - df + 0.5) / (df + 0.5))`
  - `tf_norm = tf * (k1 + 1) / (tf + k1 * (1 - b + b * dl / avgdl))`
  - `k1 = 1.2` and `b = 0.75`
  - boost is 2.0 for `message` and 1.0 for every other text field
- `N` is the number of events in the stream within the time range that have that field; filters and the query don't change it. `df` is how many of them match the leaf. `dl` is the event's token count in that field after stopwords. `avgdl` is the mean `dl` over the N events. `tf` is the number of occurrences in the event.
- There is one formula with these constants. There is no vector, semantic or hybrid search, no fuzzy matching and no synonyms.
- Each leaf's value is rounded to 4 decimals, half away from zero, and the score is the sum of the rounded values, so the parts always add up to the score.
- A leaf on a non-text field, an existence test, a range, a wildcard and anything under NOT each add 0.
- Results with a query sort by score descending, then `@timestamp` descending, then `_id` ascending.
- **Worked example.** Four events in `message`: e1 `payment gateway timeout`, e2 `gateway timeout, timeout again`, e3 `disk full on node`, e4 `retry scheduled`.
  - Token counts are 3, 4, 3 and 2 (`on` is a stopword), so `N = 4` and `avgdl = 3`.
  - For `gateway OR timeout` each term has `df = 2`, so `idf = 0.6931`.
  - e1: `gateway` 1.3863 + `timeout` 1.3863 = 2.7726.
  - e2: `gateway` 1.2199 (`tf_norm` 0.88) + `timeout` 1.7428 (`tf = 2`, `tf_norm` 1.2571) = 2.9627.
  - So e2 ranks first.
- `tree "Score explanation"` has a root reading `Score <score>` and one child per leaf, reading `<leaf> in <field>: <value> = idf <idf> x tf_norm <tf_norm> x boost <boost>`. A phrase leaf is shown in double quotes. Every number shows up to 4 decimals with no trailing zeros, for example `gateway in message: 1.2199 = idf 0.6931 x tf_norm 0.88 x boost 2`. The explain JSON holds the same values.
- **Highlights.** In the message cell and the document panel, each token matched by a term, phrase or wildcard leaf on a text field, not under NOT, is wrapped in a `<mark>` at its rule D offsets.
- **Phrases.** A phrase matches where its tokens sit at the same relative positions they have in the phrase, with stopwords holding their slot. So `"full node"` does not match `Disk full on node-7`, but `"full on node"` does. For a phrase, `tf` is the number of occurrences in the event and `df` the number of events containing it.

#### F. Spoor Query
- **Forms:**
  - `field:value`; `field:"a phrase"`; a bare word or phrase, which searches `message`.
  - An unquoted value on a text field is analyzed, and several tokens are treated as a phrase.
  - On a keyword field the whole value must match. On number, date and boolean fields `:` means equal.
- **Existence:** `field:*`.
- **Ranges:** `field>v`, `field>=v`, `field<v` and `field<=v` on number and date fields. A date is an ISO date or a relative date: `now`, `now-30s`, `now-15m`, `now-2h`, `now-1d` or `now-2w` (units s, m, h, d, w), measured from the server clock.
- **Wildcards:** `*` inside a value on text and keyword fields matches any run of characters within one token (text) or the whole value (keyword).
- **Grouped values:** `status:(500 OR 503)`.
- **Object scope:** `request{method:GET AND status>=500}` matches only when one object of the array `request` meets all of it. Fields inside are relative to `request`.
- **Escapes:** a backslash before `: ( ) { } " * \` makes that character literal.
- **Operators:** `NOT`, `AND` and `OR` with parentheses. NOT binds tightest, then AND, then OR. There are no regular expressions and no scripts.
- **Multi-value ranges.** A range on a multi-value field tests each condition against each value separately. Worked example: `latency` holding `[500, 10]` matches `latency>300 AND latency<400`, because 500 meets the first condition and 10 meets the second.
- **Syntax errors** (422 `query_syntax`). The position `<n>` is 1-based and counts characters, so an emoji counts as 1.
  - The caret in `combobox "Query"` is placed just before the character at position `<n>`: its `selectionStart` is `<n> - 1`. When `<n>` is the length of the text plus 1, the caret sits at the end of the text.
  - When the text has several errors, the one with the smallest position is reported.
  - The sentences are:
  - `Expected AND or OR at position <n>.` (two terms with no operator; `<n>` is where the second term starts)
  - `Unknown field <field> at position <n>.`
  - `Unclosed quote at position <n>.` (`<n>` is the position of the opening double quote that never closes)
  - `Unclosed parenthesis at position <n>.` (`<n>` is the position of the opening `(` or `{` that never closes)
  - `Expected a value at position <n>.` (`<n>` is the position of the first character after the operator and any spaces that is not a value, such as `)` or `AND`; when the text ends right after the operator, `<n>` is the length of the text plus 1)
  - `Expected a number at position <n>.`
  - `Wildcard not allowed on <type> field <field> at position <n>.` (for example `status:5*` gives `Wildcard not allowed on number field status at position 9.`)
  - `Range not allowed on <type> field <field> at position <n>.`
- **Limits**, checked in this order before any matching:
  1. Length: at most `SPOOR_QUERY_MAX_LEN` characters, limit included.
  2. Nesting: the deepest count of open `(` and `{` around any character, at most `SPOOR_QUERY_MAX_DEPTH`, limit included.
- **Work.** While matching, each term looked up and each posting or dictionary entry examined counts one unit. Reaching `SPOOR_QUERY_WORK_MAX` stops the query with 422 `query_work_limit`. Every query answer, refusal included, arrives within `SPOOR_QUERY_BUDGET_MS` of the request (otherwise 422 `query_time_budget`), and uploads and other requests keep being answered while a query runs.
- **Suggestions**, by the text before the caret:
  - inside a field name: field names starting with the typed text, alphabetical, up to 10
  - right after a field name: `:`, `>`, `>=`, `<`, `<=` for number and date fields, and only `:` for others
  - after an operator: up to 10 values from the time range in view that start with the text already typed after the operator (compared ignoring case), by count descending, then value ascending. On a `text` field the values are its analyzed tokens (rule D), counted by events containing them; on every other field they are the stored values, counted by events.

  Each item is `{"label","insert","count"?}`; `count` is present only for `value`. The `listbox "Suggestions"` shows one `option` per item, named by its `label`. Accepting an item (Tab with it highlighted, or a click) replaces the fragment just before the caret with its `insert` text, puts the caret right after it, and adds nothing else: no `:` after a field name, no space after a value.
  - For `field` and `operator` items, `label` and `insert` are the field name or the operator text, and the fragment replaced is the field-name text typed so far or the operator characters typed so far.
  - For `value` items, `label` is the value, and `insert` is the value, wrapped in double quotes (with `"` and `\` escaped by a backslash) when it contains anything other than letters, digits, `-`, `_`, `.` and `/`. The fragment replaced is the value text typed so far.

  Suggestions only ever come from the current space and the key's or user's reachable streams.
- **No-parser path.** A search with an empty `q` never runs the Spoor Query parser. The time picker, filter pills, field list and histogram work on that path, so they keep working when the query text has an error.

#### G. Explore
- **Time picker.** Quick and relative ranges end at server now and start the stated amount earlier. Absolute `From` and `To` are entered as `YYYY-MM-DD HH:MM:SS` in the viewer's zone. A wall time that occurs twice takes the earlier instant. The range includes its start and excludes its end. Field errors:
  - `Enter a time as YYYY-MM-DD HH:MM:SS.`
  - `That time doesn't exist in <zone>.`
  - `From must be before To.`
- **Histogram interval.** The interval is the smallest of `1s 5s 10s 30s 1m 5m 10m 30m 1h 3h 12h 1d 1w` for which at most 60 buckets touch the range.
- **Bucket boundaries.** For intervals under `1d`, boundaries are the local midnight of the day holding the range start, plus whole multiples of the interval in elapsed time. A `1d` bucket runs from one local midnight to the next, and a `1w` bucket from Monday's local midnight. The first and last buckets cover only their part of the range.
- **Bucket labels.** A bucket's time label is its start in the viewer's zone: `HH:MM +HH:MM` (intervals of 1m and up) or `HH:MM:SS +HH:MM` (under 1m) when the range lies within one local day, and `YYYY-MM-DD HH:MM +HH:MM` otherwise.
- **Daylight saving worked example.** In `America/New_York`:
  - 2026-03-08 is a 23-hour day: the interval is `30m`, there are 46 buckets, and the bucket after `01:30 -05:00` is `03:00 -04:00`.
  - 2026-11-01 is a 25-hour day with 50 buckets: `01:30 -04:00` is followed by `01:00 -05:00`, then `01:30 -05:00`.
- **Bucket Brush** sets the range from the first selected bucket's start to the last selected bucket's end. The count, histogram, field list, field statistics and grid then all use that range.
- **Grid.**
  - Default sort is `@timestamp` descending, then `_id` ascending (`_id` compares by character code). With a scoring query the sort is rule E. `button "Sort by <column>"` sorts by that column, descending first and then ascending, with missing values last, then `@timestamp` descending, then `_id` ascending.
  - `aria-rowcount` is the event total plus 1.
  - In the row label, `<i>` is the event's 1-based place in the order, and `<host>` and `<level>` read `none` when missing.
  - Default column width is 160 pixels (message 480), kept in each header's `data-width`.
- **Surrounding events** are the 5 events before and 5 after the chosen one in the same stream, by `@timestamp` ascending then `_id` ascending, ignoring the query, filters and range.
- **Field statistics.** Statistics cover the events matching the current range, query and filters.
  - `<present>` is how many have the field and `<total>` how many there are.
  - The top 5 values are ordered by count descending, then value ascending.
  - `share` is a value's count divided by `<present>`, as a percentage with 1 decimal, half away from zero (for example `62.5%`).
  - A multi-value field counts each distinct value once per event.
- **Filter pills.** An include pill is `eq` and an exclude pill is `ne`. On a multi-value field, `eq` matches when any value equals and `ne` when none does. A disabled pill doesn't apply, and inverting flips include and exclude.

#### H. Moving data
- **Snapshots.**
  - Running a search in the grid creates a snapshot, and the result count is its `total`.
  - A snapshot freezes its whole ordered result list when created. Pages of `SPOOR_PAGE_SIZE` follow `next` cursors until `next` is `null`.
  - Later uploads, rollovers, archiving and deletion never change a snapshot's list or pages, so pages have no duplicates and no gaps.
  - `new_events` counts events stored since the snapshot that match its stream, range, query and filters. The page refreshes it on each `upload` message.
  - A snapshot expires once the server clock reaches its last use plus `SPOOR_SNAPSHOT_TTL_MS`; a request at exactly that moment is already expired and answers 410.
- **Live tail.** `GET /api/tail?stream=<name>` sends `event: start` with `{"stream"}`, then one `event: line` with the event JSON for each newly stored event, plus comment heartbeats.
  - A tail sends at most `SPOOR_TAIL_RATE` lines per server-clock second. Lines over that are not sent, and the tail sends `event: slowed` with `{"skipped":n}`.
  - While paused, the page keeps up to `SPOOR_TAIL_BUFFER` of the newest arrivals. The paused count includes every event that arrived since the pause, discarded ones too, and the discarded count is how many fell out of the buffer.
  - Resume writes out the buffer in arrival order and follows again.
  - For example, with the grading buffer of 50, 55 arrivals give `Live tail paused: 55 new events` and `Buffer full: oldest 5 events discarded.`

#### I. Spoor Pipe
- **Commands**, separated by `|`:
  - `FROM <stream>`, which is required and must come first
  - `WHERE <Spoor Query>`
  - `STATS <agg> AS <name>, ... BY <field>`, where `<agg>` is `count(*)`, `avg(f)`, `max(f)`, `min(f)` or `sum(f)` and `BY` takes one optional field
  - `SORT <col> ASC|DESC, ...` (ASC by default)
  - `LIMIT <n>` (default 1000, at most 10000)
  - `KEEP <col>, ...`

  There are no joins and no computed columns.
- **Columns.**
  - Without STATS, rows are events and the columns are `_id`, `@timestamp`, then every other field alphabetically.
  - With STATS, the BY field comes first, then the aggregates in order.
  - Each column header carries `data-type` (`number`, `date`, `boolean`, `text` or `keyword`); count, avg and sum are `number`.
- **Values.** `avg` shows at most 4 decimals, half away from zero, with no trailing zeros. A multi-value field counts each value: an event appears in each BY group of its values, and each value enters the aggregates.
- **Order.**
  - SORT puts missing values last and finally breaks ties on all kept columns ascending, left to right.
  - Without SORT, STATS rows go by BY value ascending and event rows by `@timestamp` descending, then `_id` ascending.
  - Dates show in the display time format, missing values as `null`, and multi-values joined by `, `.
- **Errors** (422 `pipe_syntax`, shown in `alert "Pipe error"`). Positions are 1-based in the whole pipe text, and WHERE errors use rule F sentences at their position in the pipe:
  - `Unknown command <word> at position <n>.` (for example `Unknown command JOIN at position 12.`)
  - `Unknown column <name> at position <n>.`
  - `FROM must come first.`
  - `Stream <name> doesn't exist.`
  - `<agg> needs a number field: <field> is <type>.` (avg and sum)
  - `LIMIT can be at most 10000.`
  - the rule A conflict sentence

  The pipe text obeys the rule F length limit.

#### J. Lifecycle
- **Policy.** A policy has `rollover_max_age_ms`, `rollover_max_events`, `warm_after_ms`, `archive_after_ms` and `delete_after_ms`, each a whole number or unset. The last three are measured from the generation's rollover time on the server clock. The phases are hot, warm, archive and delete only.
- **One lifecycle step** works on each stream in this order:
  1. Roll over the write generation when its age since it became the write generation is at least `rollover_max_age_ms`, or its event count is at least `rollover_max_events`. An empty write generation never rolls over. The next number becomes the write generation, and the old one's rollover time is now.
  2. Move each rolled-over generation, oldest first, straight to the furthest phase its age allows, as one action. A phase never moves backward.
- **Worked example.** With `warm_after_ms` 60000 and `archive_after_ms` 120000, a generation rolled over at 10:00:00 turns warm at the first step at or after 10:01:00, and archived at the first step at or after 10:02:00. If the first step after rollover comes at 10:02:00, it goes from hot straight to archive.
- **Policy changes** apply at the next step to every generation. Saving shows the policy saved notice.
- **Read-only.** Warm and archived generations are read-only. An event edit there answers 409 `generation_read_only` (for example `Generation 3 is warm and read-only.`) before any 422 about its body. The same request on a hot generation with a bad body answers 422.
- **Archive.**
  1. The app writes the segment object (rule Services) and confirms that the store reports its byte size equal to what was written.
  2. Only then does the generation become `archive` and its rows leave Postgres.
  3. A failed write or confirmation leaves the generation `warm` and shows the archive failed copy.
- **Delete** removes the rows, or the segment object for an archived generation. A failed object delete keeps the generation `archive` and shows the delete failed copy.
- **Timeline.** Each item reads `Generation <g>, <phase>, next: <step> at <time>`:
  - The write generation shows `next: rollover at <time>` when a max age is set, otherwise `next: rollover at <n> events`, otherwise `next: none`.
  - Every other generation shows its next phase and the time it becomes due, or `next: none` when nothing further is set.
  - A deleted generation shows `Generation <g>, deleted, next: none`.
  - For example: `Generation 3, warm, next: archive at 2026-03-01 10:02:00 +00:00`.
- **Archived reads.**
  - Searches, histograms, field statistics and pipes read archived generations back from their segments whenever the range overlaps them, and those results carry `_phase` `archive`, shown as `From archive` with `data-source="archive"` on the row.
  - While storage is unavailable, such a request returns the rest with `partial:true` and `skipped_generations` equal to the number of archived generations it could not read, and shows the partial results banner. It never fails and never silently returns fewer results.
  - When storage returns, the same request is complete again with no restart.

#### K. Alert rules
- There is one rule type, with a structured form and no query language. A rule has:
  - a stream
  - an optional filter `{field, op, value}` (`op` one of `eq` `ne` `exists` `gt` `gte` `lt` `lte`)
  - a measure (`count`, or `avg`, `max`, `min` or `sum` of a number field)
  - an optional group-by field (no group-by gives one group named `all`; a missing value gives group `none`)
  - a window in milliseconds
  - a comparison (`>`, `>=`, `<` or `<=`) and a threshold
  - an action frequency
- **Value.** At check time `T`, each group's value covers events with `@timestamp` in `(max(T - window, B), T]`, where `B` is when the group last entered `active` or `recovered` (no limit if never). So no event counts toward two state changes. With no events in that span, `count` is 0 and other measures are not breached.
- **Groups.** Groups come into being at the first check where they have events, and stay.
- **Transitions:**

  | From | Breached | Not breached |
  |---|---|---|
  | `inactive` | `pending` (or `active` when `SPOOR_PENDING_CHECKS` is 1) | stays `inactive` |
  | `pending` | `active` on the `SPOOR_PENDING_CHECKS`-th breached check in a row, otherwise stays `pending` | `inactive` |
  | `active` | stays `active` | `recovered` |
  | `recovered` | `pending` | `inactive` |

  No other transition exists.
- **Worked example.** Window 5 minutes, count above 5, and 6 events on `host-7` between 09:57 and 09:59 on 2026-03-01 UTC, with no more:

  | Check | Value | State | Note |
  |---|---|---|---|
  | 10:00 | 6 | `pending` | |
  | 10:01 | 6 | `active` | `B` becomes 10:01 |
  | 10:02 | 0 | `recovered` | those 6 events are before `B` |
  | 10:03 | 0 | `inactive` | |

- **Failed checks.** A failed check keeps every group's state, history and counters as they were, and the next successful check continues normally.
- **Actions.** Each action writes one inbox item with text `<group> is <state> on rule <rule>`, for example `host-7 is active on rule High errors`, and sends `inbox` and `alert` messages. Action frequency:
  - `On status change` fires on entering `active` and on entering `recovered`.
  - `Every check` fires on each check where the group is `active`.
  - `At most every <n> ms` fires on a check where the group is `active` and its last action was at least `<n>` ms earlier, or there was none.
- **Acknowledging** an inbox item records the acknowledger. Acknowledging a group acknowledges each of its unacknowledged inbox items.

#### L. Alert handling
- **Flapping.** A group is flapping while its state changed on at least `SPOOR_FLAP_CHANGES` of its last `SPOOR_FLAP_CHECKS` successful checks, the current one included. It clears when that count falls below. While flapping, no action fires for the group, and tracking goes on.
- **Snooze.** A snoozed group fires no actions. `For 1 hour` ends 3600000 ms and `For 1 day` 86400000 ms after snoozing, on the server clock. Any snooze also ends when the group enters `recovered`.
- **Maintenance windows.** A window has a name, an IANA time zone, weekly days, a local start `HH:MM` and a duration in milliseconds, and applies to one rule.
  - A group is in maintenance at time `T` when, on one of the window's days, its local start in that zone is at or before `T` and `T` is before the start plus the duration.
  - The start is local wall time, so daylight saving moves its UTC time. A start that does not exist that day begins at the same distance after the gap (02:30 becomes 03:30); one that occurs twice uses the first.
  - Inside a window no action fires, tracking goes on, and groups show `in maintenance`. `next_start` and `Next start` come from the server.
- **Fire rule.** At the first successful check after a window ends, each group that is still `active` and had an action held by the window fires exactly one action, whatever the frequency, with the text `<group> is still active after maintenance window <window> on rule <rule>`. A group that recovered inside the window fires nothing. A snoozed or flapping group fires nothing, and the held action is not kept for later.
- **Cases.**
  - Cases are numbered 1, 2, 3 per space and start `open`.
  - Legal moves are one step forward (`open` to `investigating` to `resolved` to `closed`) or `resolved` back to `investigating`. Every other change, a change to the same status included, answers 409 `case_flow`, for example `A case can't go from closed to open.`
  - A case collects groups, inbox items and traces.
  - The recent cases row shows the 3 newest cases by number descending, labelled like their `table "Cases"` rows.

#### M. Traces and objectives
- **Trace input.** A trace has at most `SPOOR_TRACE_MAX_SPANS` spans, with whole-millisecond `start_ms` and `duration_ms` (0 or more). There is one trace at a time on the page and no service map. 422 `trace_invalid` sentences:
  - `A trace can hold at most <SPOOR_TRACE_MAX_SPANS> spans.`
  - `Span <id> appears twice.`
  - `Span <id> is part of a parent loop.` (the lowest `span_id` in the loop)
- **Tree.**
  - Children are ordered by `start_ms`, then `span_id`.
  - Orphans, whose parent id is not in the trace, hang under a `Missing parent` item placed after the real roots, ordered the same way.
- **Clock skew.** Working top down, a child that starts `D` ms before its (already corrected) parent moves with its whole subtree by `+D` and shows `shifted +D ms`. Ends that run past the parent are not changed. Self time and critical path use the corrected times.
- **Self time** is a span's duration minus the length of the union of its children's intervals, clipped to the span.
- **Critical path.**
  1. Start at the real root with the latest end (orphans are never on the path), with the cursor at its end.
  2. Among its children, choose the one with the latest end at or before the cursor (ties: lowest `span_id`), put it on the path, and walk into it the same way with the cursor at its end.
  3. Then set the cursor to that child's start and repeat among the remaining children.
- **Worked example.** `checkout` runs 0 to 240 ms and has children `auth` 20 to 60, `pay` 50 to 150 and `render` 150 to 220.
  - The union of the children is 20 to 220, which is 200 ms, so self time is 40 ms.
  - Critical path: `render`; the cursor becomes 150; then `pay`; the cursor becomes 50; `auth` ends at 60, so it is not on the path.
  - The path is `checkout`, `pay`, `render`, and its label reads `Span checkout, 240 ms, self time 40 ms, on critical path`.
- **Percentiles.** Per service, over its spans' durations, nearest rank: the value at rank `ceil(p / 100 * n)` of the sorted list, for p 50, 95 and 99. With 20 values, p50 is the 10th, p95 the 19th and p99 the 20th.
- **Objectives.** There is one objective type, one per service. Its total counts the stream's events whose `service` equals the objective's service, and its bad events are those that also match its `bad` filter. The objective window is `objective_window_ms` (default 30 days).
  - All windows end at server now and include their end.
  - `target` is a percentage with up to 3 decimals, above 0 and below 100.
  - `error budget = 1 - target / 100`.
  - `budget remaining = 1 - (bad / total) / budget` over the objective window, as a percentage with 2 decimals, half away from zero. It may fall below 0, and is 100.00% with no events.
  - `burn rate = (bad / total) / budget` in a window, with 2 decimals, half away from zero, over a long window of 1 hour and a short window of 5 minutes. A window with no events has burn rate 0.00.
- **Status.** `Burning fast` when both burn rates are at least 14.40, `Burning` when both are at least 6.00, otherwise `OK`.
- **Worked example.** Target 99.5% gives a budget of 0.005.
  - 30 days: 2000 bad of 1000000, so budget remaining is 60.00%.
  - 1 hour: 240 of 12000, burn 4.00.
  - 5 minutes: 30 of 1000, burn 6.00.
  - Status is `OK`, because the long window is under 6.00.
- **Objective panel.** Selecting a service tile fills `region "Objective"` with the lines `Budget remaining <pct>%`, `Long burn <rate>`, `Short burn <rate>`, `Status <status>` and `<bad> bad of <total>` per window. It refreshes on load, on each `clock` message and on each `upload` message. The service strip never moves by itself.

#### N. Spaces and keys
- **Isolation.** A space isolates its streams, events, mappings, pipelines, saved searches, rules, groups, inbox, cases, traces, objectives, keys and live messages. It also isolates every derived surface: search, counts, histograms, field lists and statistics, suggestions, pipes, the tail and the ingest line.
- **Keys.**
  - Format `spk_<32 lower-case hex>`. The full key appears only in the create response and `textbox "New key value"`. A request carries a key in the header `Authorization: Bearer <key>`. A key belongs to the space it was made in and resolves stream names there, so a request with a key needs no `space` parameter.
  - A key is stored only as a SHA-256 hash; lists show the name, pattern, actions, expiry and last 4 characters. No API or page returns the key again.
  - `Stream pattern` matches whole stream names, with `*` standing for any run of characters.
  - Actions: `read` (search, histogram, fields, statistics, suggestions, snapshots, tail, pipe), `upload` (bulk, uploads) and `manage` (streams, mappings, lifecycle).
  - `Expires in (days)` is a whole number from 1 to 365, or empty for never. A key expires when the server clock reaches creation plus that many days.
- **Key refusals.**
  - expired: 401 `key_expired`
  - revoked: 401 `key_revoked`
  - unknown: 401 `key_invalid`
  - a stream in another space: 404, decided before 403
  - a stream in the space outside the pattern, or an action not granted: 403 `key_scope`, for example `This key can't upload to stream web.`
- **Saved search copy.** Copying a saved search into another space checks one reference: its stream must exist there. A missing reference does not block the copy; it lands with `needs_attention` true and is marked `Needs attention`. Opening it shows the saved search error from Feedback states.

### Services (DP-34, DP-39, DP-57-free wording: storage)

- **Postgres** (`DATABASE_URL`) holds events and the app's own term index, mappings, generations and lifecycle state, failure store, pipelines with versions, uploads, snapshots, rules with per-group state and history, maintenance windows, inbox, cases, spans, objectives, spaces, members, session records, saved searches and key hashes. The app applies its schema and the start seed idempotently every time it serves. If Postgres stops answering after boot, affected requests answer 503 `database_unavailable`, and the page shows it in its alert with Retry.
- **MinIO** (the `S3_*` variables) holds two kinds of object in the bucket `S3_BUCKET`:
  - `uploads/<space slug>/<sha256 of the file, lower-case hex>.ndjson`: the uploaded file byte for byte, written and confirmed before parsing.
  - `segments/<space slug>/<stream>/<generation number>.ndjson`: one archived generation, one event JSON per line, ordered by `@timestamp` ascending then `_id` ascending, written and confirmed before the generation counts as archived.

  When storage is unreachable (or switched down by the grading route):
  - file uploads answer 503 `storage_unavailable` and store nothing
  - archive and delete steps fail with their lifecycle copy
  - searches over archived generations return partial results as in rule J
  - `/api/health` reports `unavailable`

  Everything else keeps working, and recovery needs no restart.

### Seed data (DP-02, DP-10)

Present at start on every boot, applied idempotently. Every person, space, service, host and log line here is invented.

- **Users**, all with password `spoorline-demo-1`: `ines` (zone `UTC`), `tomas` (zone `America/New_York`), `ruth` (zone `UTC`), `wren` (zone `UTC`).
- **Spaces:** `ops` named `Ops`, with `ines` admin, `tomas` editor and `ruth` viewer; `harbor` named `Harbor`, with `wren` admin. Current space is `ops` for ines, tomas and ruth, and `harbor` for wren.
- **Key** in `ops`: name `edge-shipper`, pattern `web*`, actions `upload`, no expiry, value `spk_5eedc0de5eedc0de5eedc0de5eedc0de`.
- **Pipeline** in `ops`: `web-clean`, version 1, processors `redact` (`field` `message`, `pattern` `ipv4`) then `set` (`field` `env`, `value` `prod`).
- **Stream** `web` in `ops`: explicit mappings `host` keyword, `level` keyword, `service` keyword; generation 1 hot; no lifecycle policy. Events:

| `_id` | `@timestamp` | host | level | service | status | latency | message |
|---|---|---|---|---|---|---|---|
| `e-001` | `2026-02-28T23:46:10.000Z` | host-3 | info | web | 200 | 41 | `GET /cart served` |
| `e-002` | `2026-02-28T23:48:30.000Z` | host-7 | error | web | 500 | 912 | `payment gateway timeout` |
| `e-003` | `2026-02-28T23:50:05.000Z` | host-7 | error | web | 503 | 1204 | `gateway timeout, timeout again` |
| `e-004` | `2026-02-28T23:51:40.000Z` | host-2 | warn | web | 200 | 388 | `retry scheduled` |
| `e-005` | `2026-02-28T23:53:15.000Z` | host-7 | error | web | 500 | 77 | `disk full on node-7` |
| `e-006` | `2026-02-28T23:55:00.000Z` | host-3 | info | web | 200 | 35 | `GET /search served` |
| `e-007` | `2026-02-28T23:57:20.000Z` | host-2 | info | web | 200 | 52 | `GET /cart served` |
| `e-008` | `2026-02-28T23:59:45.000Z` | host-7 | error | web | 502 | 640 | `upstream reset by peer` |

`status` and `latency` are inferred as number and `message` as text.

- **Stream** `pay` in `harbor`, generation 1 hot, events `h-001` (`2026-02-28T23:40:00.000Z`, host `dock-1`, level `info`, message `refund queued`), `h-002` (`2026-02-28T23:50:00.000Z`, host `dock-1`, level `error`, message `ledger write failed`), `h-003` (`2026-02-28T23:58:00.000Z`, host `dock-2`, level `info`, message `refund sent`).

For example, with the seed data at start and the grading clock, `tomas` choosing `Last 15 minutes` on `web` sees `8 events found`.

## Technical requirements

### Deployment (DP-01)

Backend: TypeScript on Node 22 with npm. Frontend: TypeScript built with Node 22 in the same `build`.

- The app is installed and run from `/app`. `/app/run.json` holds the string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```

- The server binds `0.0.0.0` on the port in `APP_PUBLIC_PORT`, defaulting to 4173.
- `GET /api/health` answers HTTP 200 with JSON `{"status":"ok"}` when Postgres and storage answer, and 200 `{"status":"unavailable"}` while storage does not. It never answers 503.
- The lockfile `package-lock.json` is committed.

### Configuration and secrets (DP-03, DP-06)

The server reads these at start. Credentials are never hard-coded and never sent to the browser.

- Postgres: `DATABASE_URL`.
- MinIO: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
- Port: `APP_PUBLIC_PORT`.
- Settings (each a whole number in the stated unit; a missing variable uses its default):

| Setting | Env var | Default | Grading value |
|---|---|---|---|
| Grading routes on (404 when unset) | `SPOOR_GRADING` | unset | `1` |
| Rule check interval, ms | `SPOOR_CHECK_INTERVAL_MS` | 60000 | 60000 |
| Breached checks in a row before active | `SPOOR_PENDING_CHECKS` | 2 | 2 |
| Flapping changes threshold | `SPOOR_FLAP_CHANGES` | 4 | 4 |
| Flapping look-back, checks | `SPOOR_FLAP_CHECKS` | 10 | 10 |
| Lifecycle step interval, ms | `SPOOR_LIFECYCLE_INTERVAL_MS` | 60000 | 60000 |
| Snapshot expiry after last use, ms | `SPOOR_SNAPSHOT_TTL_MS` | 300000 | 300000 |
| Page size in a snapshot, events | `SPOOR_PAGE_SIZE` | 100 | 10 |
| Live tail buffer while paused, events | `SPOOR_TAIL_BUFFER` | 1000 | 50 |
| Live tail rate, events per second per tail | `SPOOR_TAIL_RATE` | 200 | 100000 |
| Heartbeat on event streams, ms | `SPOOR_SSE_HEARTBEAT_MS` | 15000 | 2000 |
| Query length, characters | `SPOOR_QUERY_MAX_LEN` | 2000 | 2000 |
| Query nesting, levels | `SPOOR_QUERY_MAX_DEPTH` | 8 | 8 |
| Query work limit, units | `SPOOR_QUERY_WORK_MAX` | 2000000 | 20000 |
| Query time budget, ms | `SPOOR_QUERY_BUDGET_MS` | 3000 | 3000 |
| Result window without a snapshot, events | `SPOOR_RESULT_WINDOW` | 10000 | 200 |
| Upload size, bytes | `SPOOR_UPLOAD_MAX_BYTES` | 10000000 | 200000 |
| Upload progress step, lines | `SPOOR_UPLOAD_PROGRESS_LINES` | 500 | 10 |
| Uploads per key per minute | `SPOOR_UPLOAD_RATE` | 120 | 100000 |
| Sign-ins per username per minute | `SPOOR_LOGIN_RATE` | 10 | 100000 |
| Searches per session per minute | `SPOOR_SEARCH_RATE` | 600 | 100000 |
| Spans per trace | `SPOOR_TRACE_MAX_SPANS` | 500 | 500 |

The browser gets its settings from `GET /api/config` as JSON. Raw JSON is never placed inside an inline script tag.

### Server boundary (DP-01, DP-04, DP-06)

- One origin serves the pages, the bundled fonts and assets, and the API. The server sends no cross-origin headers, and the browser loads nothing from any other origin.
- The server never serves source files, `run.json`, environment values, lockfiles or anything outside the built assets and the API.
- Request size limits are those in API.
- The app registers no service worker and uses no WebSocket.
- At boot the server retries Postgres every second for up to 60 seconds, then exits with a non-zero status if it still cannot connect. Unreachable storage at boot does not stop it from serving; health reports `unavailable` until storage answers.

### Browser support and performance (DP-19)

- Current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800, and down to 360 pixels wide, with touch input on phones.
- Pages work with a paused page clock. Client timers use the page's own timers and `Date`, and Web Animations run on the document timeline.
- With the seed data, Explore is usable within three seconds of opening.
- A search over 10,000 events answers within two seconds.
- A live message shows on screen within one second of the write that caused it.

## Working rules

- IF-01: `/app/run.json` holds exactly the string keys `install`, `build` and `serve` plus `"_schema":"run-manifest-v1"`, and those commands alone install, build and serve the app.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package (the production dependency tree, as `npm ls --omit=dev --all --json` reports it) and the two bundled font families, each with its licence.
- IF-03: Every shipped package and font uses one of these licences: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0 or (fonts only) OFL-1.1. None is AGPL, GPL, SSPL, BUSL or another source-available licence.
- IF-04: The app uses only Postgres and MinIO as backing services, and no shipped package is a search engine, full-text index or search ranking library.
- IF-05: The app loads no font, script or style from outside its own origin and registers no service worker.
- IF-06: The provided service configuration and the environment variable names it sets are left unchanged.
- IF-07: `package-lock.json` is committed, and all backend and frontend source is TypeScript.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript, with no `any` used to silence the compiler.
- Names in code match this brief's domain terms: stream, generation, write generation, rollover, segment, snapshot, pipeline, processor, analyzer, leaf, group, flapping, maintenance window, case, span, self time, critical path, objective, burn rate, space, key.
- Each domain rule is decided in exactly one place in the source, and every caller uses it: each state transition (group, case, generation), each derived value (score, interval and bucket edges, burn rate, self time, critical path, percentile) and each limit check.
- There is no abstraction with a single implementation, and no dead, commented-out or unreachable code.
- There are no defensive checks for states the rules make impossible.
- Every error leaves the server through one error shape and one ordering point.
- There are no features beyond this brief.
