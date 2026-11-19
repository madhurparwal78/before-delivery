# Marrowpop Software Jarful

Jarful is a web workspace where one developer keeps JSON documents in collections. They write filters and aggregation pipelines, add indexes and validation rules, load and download files, and invite a few people to look at or edit the data. Build it as a single TypeScript web app. It uses three services: PostgreSQL for every account, project, document, index, rule, saved query and change record; MinIO-compatible object storage for every uploaded file and every generated download; and a Mailpit SMTP sink for sign-up codes and invitation notices. The app runs its own query and aggregation engine over the stored documents. Queries and pipelines are JSON only: there is no JavaScript, no `$where`, no `$function` and no `$expr`. Live changes travel over server-sent events from the app server itself. You may use an open-source code-editor component for the JSON editor. Out of scope: cluster provisioning, sharding, replication, backups, regions, billing and paid plans, charts, full-text or vector search, AI assistants, drivers and connection strings, sign-in through outside providers, extra datastores or caches, and anything loaded from another origin, fonts included.

## Problem and users

Independent developers, hobbyist builders and freelancers keep app data, side-project data or a client's catalogue as JSON documents, and none of their tools fits well. A desktop document GUI lives on one machine and cannot be shared. A cloud data explorer is tied to one hosted vendor and its account model. A professional client costs about $499 per person per year, which is a lot for one person who also needs a friend or a client to see the data. So people paste filters into chat, send spreadsheets by hand and debug pipelines from a preview of ten random documents. They cannot see how many documents survive each stage, why a document was rejected, or whether a query used an index. Bad documents get in before anyone writes a validator. When two people edit the same document, one person's change silently overwrites the other's.

- **Builder (owner), daily.** Owns projects and collections. Writes filters and pipelines, adds indexes and validation rules, loads and downloads files, and invites people.
- **Collaborator (editor), weekly.** Edits documents and saved queries in a project they were invited to as editor, and sees the builder's changes live.
- **Reviewer (reader), occasional.** Browses and queries a project they were invited to as reader, for example a client checking their catalogue, and cannot change anything.

## Journeys

1. **Fill a first jar.** A visitor on the landing page watches the sample Stage Sieve run, then chooses Start a project. They sign up, type the code from their email, create a project with its first collection, and land on that collection's empty screen. They insert a document with the keyboard and see it in the list.
2. **Find the right documents.** With a seeded collection open, the builder types a filter that reaches into arrays, runs it with Ctrl+Enter, and hears and reads the exact match count. They switch between List, Table and JSON, move through the table with the arrow keys, and open a document with Enter.
3. **Shape a pipeline with the Stage Sieve.** The builder adds match, unwind, group and sort stages by keyboard. Each band shows exact server counts, with bars that thin out or overflow. They pin one document to see which stage drops it, reorder stages with Alt+Arrow, disable one, and delete one through a confirmation dialog.
4. **Guard the data.** The builder's query reports a full scan. They add a unique index, and the same query now reports the index. They set a validation rule, and a collaborator's bad insert is refused with the failing path. A filter that would scan too much is stopped with a clear message until an index narrows it.
5. **Invite a collaborator and a client.** The builder invites one address as editor and another as reader. Each invitee reads the email, signs up, accepts at the invitations screen and lands on the project's collection list. The reader sees the read-only note. When the builder changes a role, it applies to the person's very next action.
6. **Edit together.** The builder and a collaborator have the same document open. One saves first; the other gets the clash notice and picks Reload or Overwrite. A reader with a filter applied watches rows appear, change and disappear, and the count update, with no reload.
7. **Load and hand over files.** The builder loads a JSON-lines file with mistakes and sees every bad line by number, with nothing added. They fix it and load it, load a CSV, download the original upload byte for byte, and download a spreadsheet-safe CSV of the current filter for a client. When file storage is down, a banner explains it and queries keep working.
8. **Work from a phone.** On a phone the collaborator switches between Query, Results and Pipeline tabs, opens a document by touch, edits it full screen and saves it.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Comparison operators** Filters support the equality, inequality, range and set operators with the type-class rules and worked results given in Business rules.
- **DP-02 — Logical operators** Filters combine conditions with `$and`, `$or`, `$nor` and `$not` as worked in Business rules, and any other operator is refused with `unknown_operator`.
- **DP-03 — Array matching** Dot paths, array positions, whole-array and any-element matching, `$size` and `$elemMatch` give the results worked in Business rules.
- **DP-04 — Missing and null fields** `$exists`, null equality and `$ne: null` treat missing fields exactly as Business rules states.
- **DP-05 — Document rules** Inserts, edits and loads enforce the `_id` format, allowed values, field names, the size limit and the depth limit, refusing each with its API error.
- **DP-06 — Query status announcement** After every run the Query status live region carries the exact match text from Feedback states.
- **DP-07 — Results grid keyboard** The Table view is a grid with one tabbable cell, where the arrow keys, Home and End move focus and Enter opens that row's document.
- **DP-08 — Array filter journey** A builder runs an array filter with Ctrl+Enter on a seeded collection, reads the announced count and the matched rows, and opens a matched document from the grid by keyboard.
- **DP-09 — Comparison order** Values of mixed types compare and sort in the single type order and within-type rules of Business rules.
- **DP-10 — Multi-key sort** Sorts take several keys in order, sort arrays by their smallest or largest element, and break ties by `_id` ascending.
- **DP-11 — Result pages** Query results are paged at `JARFUL_PAGE_SIZE` with `limit` capping the match count, and the pager moves by keyboard.
- **DP-12 — Phone workspace tabs** Below 768 CSS pixels the query bar, results and pipeline become the Query, Results and Pipeline tabs, moved with the arrow keys.
- **DP-13 — Mixed sort journey** A builder sorts a mixed-type collection by two keys, reads the row order, pages forward by keyboard, and sees the same order in the phone Results tab.
- **DP-14 — Projection rules** Projections include, exclude or drop `_id` as worked in Business rules, and a mix is refused with `invalid_projection`.
- **DP-15 — Number and date display** List, Table, JSON view, stage previews and schema show numbers and dates under the one display rule in Business rules.
- **DP-16 — View switch** The View radio group switches results between List, Table and JSON with the arrow keys, without running the query again.
- **DP-17 — Query error alerts** Refused queries show the exact Query error copy from Feedback states.
- **DP-18 — Projection views journey** A builder applies inclusion, exclusion and `_id`-free projections, gets the mixed-projection alert, and checks that the same number text appears in all three views.
- **DP-19 — Stage preview counts** The preview route returns exact counts and first documents for every stage prefix, honouring disabled stages and the stage limit.
- **DP-20 — Shaping stages** `$match`, `$project`, `$sort`, `$limit`, `$skip` and `$count` behave as worked in Business rules.
- **DP-21 — Unwind stage** `$unwind` emits one document per array element, drops missing, null and empty arrays, and passes non-arrays through unchanged.
- **DP-22 — Pipeline draft** Each person's working pipeline for a collection, including stage order and disabled stages, is kept on the server and survives reload, with the most recent save winning.
- **DP-23 — Keyboard stage editing** Stages are added, moved with Alt+Up and Alt+Down, disabled and deleted through the confirmation dialog by keyboard, with focus going back to the stage acted on.
- **DP-24 — Drag reorder** Dragging a stage by its move handle reorders it with the same result, announcement and persistence as the keyboard move.
- **DP-25 — Pipeline announcements** Every stage card shows its status text, and moves and recomputes are announced in the polite Pipeline status region with the copy from Feedback states.
- **DP-26 — Keyboard pipeline journey** A builder builds a match, unwind, group and sort pipeline by keyboard only, reads each stage's count, reorders a stage with Alt+Up, and deletes a stage through the dialog.
- **DP-27 — Group keys and order** `$group` accepts null, a path or an object of paths as its key and orders its output by key in the comparison order.
- **DP-28 — Accumulators** `$sum`, `$avg`, `$min`, `$max`, `$count`, `$push`, `$first` and `$last` compute the values worked in Business rules, including the `$avg` rounding.
- **DP-29 — Stage Sieve bars** Each enabled stage band draws a bar whose width follows the published log ratio to within 1 pixel, with an overflow notch above the input and a thin pass-through band for a disabled stage.
- **DP-30 — Stage Sieve motion** When stage k changes, bands k to n animate width and numeral from old to new with the published stagger and duration while earlier bands stay still.
- **DP-31 — Stage Sieve under reduced motion** With the reduced-motion setting on, bars, numerals and the pin marker take their final state in the first frame, and the announcements still happen.
- **DP-32 — Pinned document** Pinning a document by `_id` places a marker at the first stage that drops it, and that stage's label says so.
- **DP-33 — Grouping journey** A builder groups a seeded collection with every accumulator, checks the group order and rounded averages in the preview, and watches the Stage Sieve settle, mid-way with the clock and instantly under reduced motion.
- **DP-34 — Index management** Owners create single and compound indexes with default or given names, list them and drop them, and `_id_` is always present.
- **DP-35 — Unique index enforcement** A unique index refuses a second equal value on insert, edit and load with `duplicate_key`, and exactly one of two simultaneous equal inserts succeeds.
- **DP-36 — Unique index over existing data** Creating a unique index over existing duplicates is refused with the value of the first document, in `_id` order, whose key value already appeared earlier.
- **DP-37 — Index choice and examined counts** Every query plan picks an index or a full scan and counts the examined documents by the rules in Business rules.
- **DP-38 — Explain readout** The Query plan region shows and announces the plan's index or full scan and its examined and returned counts for the query that ran.
- **DP-39 — Duplicate notice in the editor** A save that hits a unique index shows the duplicate text naming the value and index in the editor's Save status.
- **DP-40 — Index and explain journey** An owner sees a full scan, creates a unique index from the Indexes form by keyboard, sees the index used, and an editor in another browser gets the duplicate notice on Ctrl+S.
- **DP-41 — Validator rules** Owners set a validator of required fields and per-path type, minimum, maximum and enum, which is checked on insert, edit and load but never against stored documents.
- **DP-42 — Validation check order** The first failing rule, in the published check order, is reported with its path and rule name.
- **DP-43 — Validation notice** A refused save shows the exact validation text from Feedback states as an icon chip in the editor and announces it politely.
- **DP-44 — Rules screen by role** Only owners can change rules on the Rules screen; editors and readers see the rules read-only with no save control.
- **DP-45 — Validation journey** An owner sets a rule, an editor in another browser is refused at the first failing path with the exact text, and the editor's fixed document then saves.
- **DP-46 — Schema summary values** The schema summary reads the first `JARFUL_SCHEMA_SAMPLE` documents and reports each path's presence and type shares as rounded whole percents.
- **DP-47 — Schema screen** The Schema screen lists every path with its presence text and proportional type segments that print their percentages.
- **DP-48 — Schema journey** A builder reads presence and type shares on a seeded collection, another person inserts a document, and reopening the Schema screen shows the changed shares, also on the phone layout.
- **DP-49 — Document versions** Every document has a server-kept version that starts at 1 and rises by 1 on each save, and a save with a stale version is refused with `version_conflict`.
- **DP-50 — Edit clash notice** A stale save shows the clash alert, where Reload loads the server copy and Overwrite saves the draft over it.
- **DP-51 — Editor keyboard** In the document editor Ctrl or Cmd+S saves, Tab indents, Escape then Tab leaves it, and closing the editor returns focus to the document that opened it.
- **DP-52 — Document deletion** Editors and owners delete a document through a confirmation dialog, and a later save of that document shows the deleted notice.
- **DP-53 — Edit clash journey** Two people open one document, the first saves with Ctrl+S, the second gets the clash alert, Reload shows the first person's text, and Overwrite then wins with the next version.
- **DP-54 — Change feed** Every insert, edit and delete in a collection is sent on that collection's event stream with its collection sequence number, which rises by 1 with no gaps.
- **DP-55 — Feed catch-up** A client that reconnects from its last sequence receives every missed change once, in order, with no duplicates or gaps.
- **DP-56 — Live results** An open results view shows other people's changes within 2 seconds, without a reload, moving focus or touching the editor draft, as qualified in Interactions.
- **DP-57 — Reader workspace** A reader sees the read-only note, a read-only editor and no insert, save, delete, load or rules controls.
- **DP-58 — Live collection journey** A reader with a filter active watches an editor's inserts, edits and deletes appear, change and leave, with the status count updating and no reload.
- **DP-59 — Sign-up with an emailed code** Sign-up emails a six-digit code, and the account works only after that code is entered.
- **DP-60 — Sign-in and sessions** People sign in with email and password, get an HTTP-only session cookie, land on the projects screen, and sign out from the Account menu.
- **DP-61 — Invitations** Owners invite an address as editor or reader, and an invitation moves only from pending to accepted or revoked, refusing every other move.
- **DP-62 — Invitation email** Each invitation sends one Mailpit message to the invited address with the published subject and the line naming the inviter, project and role.
- **DP-63 — Role checks per request** Every request checks the caller's current role, so readers cannot write and only owners manage members, indexes, rules, collections and the project.
- **DP-64 — Not found for outsiders** A project, collection, document, saved query, file or invitation the caller cannot open answers exactly like one that does not exist, in the API and on screen.
- **DP-65 — Downgrade in an open editor** After an owner downgrades an editor to reader, that person's next save is refused and their open editor becomes read-only within 2 seconds.
- **DP-66 — Landing routes** Creating a project lands on its first collection's address, accepting an invitation lands on the project's collection list, and reloading either address shows the same screen.
- **DP-67 — Members screen** Owners see members and pending invitations, change roles, remove members and revoke invitations on the Members screen.
- **DP-68 — Invitation journey** An owner invites an address, the invitee reads the email, signs up with the code and accepts, sees the read-only note as reader, gets Not found for another project, and saves after the owner raises their role.
- **DP-69 — File stored before parsing** A loaded file is parsed only after object storage confirms it holds the exact bytes, and a download is offered only after it is stored.
- **DP-70 — JSON lines loading** JSON-lines files load one document per non-blank line under the document and validation rules.
- **DP-71 — CSV loading** CSV files need a header row, follow standard CSV quoting, build nested fields from dotted headers and infer cell types as Business rules states.
- **DP-72 — All-or-nothing load report** A load with any bad line or too many lines adds nothing and reports up to 20 numbered line errors, and a clean load reports its exact count.
- **DP-73 — Original file download** Every stored upload can be downloaded byte for byte as uploaded, next to its load report.
- **DP-74 — Collection downloads** Downloads hold every document matching the current filter and sort, as JSON lines or as CSV with the published columns.
- **DP-75 — Spreadsheet-safe CSV** CSV download cells that start with a formula character get a leading apostrophe so a spreadsheet runs nothing.
- **DP-76 — File storage outage** When object storage is unreachable, file routes are refused and the banner shows, while browsing, editing and queries keep working.
- **DP-77 — File journey** A builder loads a file with known bad lines and sees the exact line list with nothing added, loads the fixed file and a CSV, downloads and reads back the data, and sees the outage banner on the storage-down instance.
- **DP-78 — Scan guard** A query, pipeline or download that would examine more than `JARFUL_SCAN_LIMIT` documents is refused with the guard message, and the Stage Sieve shows every count as at most the limit.
- **DP-79 — Bounded requests** Over-deep queries are refused, and every query, preview and download within the published limits answers within 3 seconds.
- **DP-80 — Saved queries** Editors and owners save named queries that survive reload and show their last run's server time and match count, and readers can run them.
- **DP-81 — Phone editor by touch** On a phone, tapping a document opens the editor full screen with Save and Close, and every action stays reachable by touch.
- **DP-82 — Closed panels are inert** A closed drawer, menu, dialog or hidden tab panel is hidden, cannot receive focus or pointer input, and is absent from the accessibility tree at every viewport.
- **DP-83 — Guard and phone journey** A builder hits the scan guard on a large collection, adds an index and runs it, saves the query and finds it with its count after reload, then edits and saves a document by touch on a phone.
- **DP-84 — Run manifest and health** The app installs, builds and serves from the run manifest and answers the health route as Deployment states.
- **DP-85 — Grading seed route** The key-protected grading route creates confirmed users, projects, members, collections, documents, indexes, validators and saved queries in one call and returns their ids.
- **DP-86 — Projects and collections** Owners create and delete projects and collections, and every screen agrees with the stored document counts, also after reload.
- **DP-87 — Error shape and order** Every API error uses the one published body shape, and the first applicable error in the published order wins.
- **DP-88 — Server boundary** The server is same-origin only, enforces body-size and content-type limits, never serves source or credentials, and keeps starting when a dependency is down.
- **DP-89 — Configuration from the environment** Every service address, credential and limit is read from the published environment variables at start and never hard-coded or sent to the browser.
- **DP-90 — Published breakpoints** The workspace shows rail, list and editor side by side from 1280 CSS pixels, rail with stacked panes from 768, and the phone layout below 768.
- **DP-91 — Resizable panes** The query and pipeline pane separators resize by pointer and by arrow keys in steps of 5 percent and report their value.
- **DP-92 — Dialog keyboard handling** Every open dialog and drawer keeps Tab and Shift+Tab inside it, closes on Escape and returns focus to its opener.
- **DP-93 — Landing hero sample** The landing page's hero card runs the published sample pipeline over the built-in houseplant collection with exact server counts in the Stage Sieve.
- **DP-94 — Empty, loading and not-found screens** Empty collections, loading panes and unreachable pages show the published headline, a layout-holding skeleton and the Not found heading.
- **DP-95 — Pink field look** Every screen sits on the bubblegum pink field with TikTok Sans display and body type, a single lime primary action and the published corner rule.
- **DP-96 — Working screens look** Lists, tables, editors, previews, chips, banners and schema bars follow the working-screen language in Visual design.
- **DP-97 — Hero look** The landing hero shows the stretched JARFUL wordmark with its lime swipe beside the black glowing Stage Sieve card, with text first on a phone.

## Frontend

### Screens and layout (DP-12, DP-57, DP-81, DP-90, DP-94, DP-97)

Routes, with `<pid>` a project id, `<cid>` a collection id and `<did>` a document `_id`:

| Route | Screen |
|---|---|
| `/` | Landing page with the hero |
| `/signup`, `/confirm`, `/signin` | Account screens |
| `/projects` | Project list and new-project form |
| `/invites` | The signed-in person's pending invitations |
| `/p/<pid>` | Project home: collection list with counts |
| `/p/<pid>/members` | Members and invitations |
| `/p/<pid>/c/<cid>` | Documents: query bar, results, document editor |
| `/p/<pid>/c/<cid>/d/<did>` | Documents with that document open in the editor |
| `/p/<pid>/c/<cid>/queries` | Saved queries (the Query section) |
| `/p/<pid>/c/<cid>/pipeline` | Pipeline builder with the Stage Sieve |
| `/p/<pid>/c/<cid>/indexes` | Indexes |
| `/p/<pid>/c/<cid>/schema` | Schema summary |
| `/p/<pid>/c/<cid>/rules` | Validation rules |

A signed-out visitor who opens any route except the landing and account screens goes to `/signin`, and after signing in comes back to the route they asked for. Any `/p/...` route the person cannot open, or that does not exist, shows the not-found screen.

Every signed-in screen has a top bar with the product name, an Invitations link and the Account menu. Inside a project, a left rail holds the project name, the list of collections and a small tag naming the current section (Documents, Query, Pipeline, Indexes, Schema, Rules or Members). The Sections navigation sits at the top of the content on every screen inside a project. On collection screens its links go to: Documents → `/p/<pid>/c/<cid>`, Query → `/p/<pid>/c/<cid>/queries` (the saved queries screen), Pipeline → `/p/<pid>/c/<cid>/pipeline`, Indexes → `/p/<pid>/c/<cid>/indexes`, Schema → `/p/<pid>/c/<cid>/schema` and Rules → `/p/<pid>/c/<cid>/rules`, all for the current collection, and Members → `/p/<pid>/members`. Project home and Members have no current collection, so they show only the Members link. A document route belongs to the Documents section. The section tag names the current section in the same words as its link, and is absent on project home.

Workspace layouts. Apply them exactly at these widths, with nothing in between changing which layout a published viewport gets:

- **1280 CSS pixels and wider (checked at 1280x800).** The rail is fixed at the left, 16 percent of the width. Documents shows the query bar above the results list, and the document editor is a third column to the right of the list. Rail, list and editor sit side by side, left to right, with their tops aligned. When no document is open, the editor column shows its placeholder text. Pipeline shows the stage list on the left and the selected stage's preview on the right. Landing, account, project list, invitations and project home content starts at 30 percent of the width and runs to the right edge.
- **768 to 1279 CSS pixels (checked at 768x1024).** The rail stays at the left, about a quarter of the width. Panes stack in the content column: the query bar, then the results, then the editor below the results when a document is open. The pipeline preview sits under the stage list.
- **Below 768 CSS pixels (checked at 375x812).** The rail collapses behind the Collections button in the top bar and opens as a drawer. On Documents and Pipeline the content becomes a tablist with the Query, Results and Pipeline tabs. Documents opens with Query selected and Pipeline opens with Pipeline selected. Tabs switch in place without changing the address. Opening a document shows the editor as a full-screen dialog with Save and Close buttons. Indexes, Schema, Rules, Members and Saved queries stack in one column. The landing page shows the hero text first and the sample card under it.

No screen scrolls sideways at any of the three viewports. Wide tables scroll inside their own pane.

Screens:
- **Landing.** The hero (Visual design), a Start a project link to `/signup` and a Sign in link.
- **Project list.** The projects heading, a list of the person's projects with their role, and the new-project form under its own heading.
- **Project home.** The project name, the Collections list with each collection's document count, the owner's new-collection form and the Delete project button.
- **Documents.** The query bar, the View switch, the Query status and Query plan regions, the results in the chosen view, the pager, and the Insert document, Load file, Download and Save query buttons, each shown only to roles allowed to use it. Then the editor.
- **Saved queries.** The list of saved queries, each with its filter text, last-run line, a Run button and, for editors and owners, a Delete button.
- **Pipeline.** The Add stage button, the pin field, the Pipeline stages list of stage cards (each a Stage Sieve band), the Pipeline status region and the preview pane.
- **Indexes.** The index list and, for owners, the create form.
- **Schema.** One row per field path with its presence text and its type segments.
- **Rules.** The validator JSON and, for owners, Save rules.
- **Members.** The members list, role controls, the invite form and pending invitations, all for owners only. Other roles see the members list read-only.
- **Readers** see the read-only note at the top of every collection screen. They get no Insert document, Load file, Save query, Delete or Save controls, and their editor is read-only.

### Public screens and controls (DP-06, DP-07, DP-12, DP-16, DP-23, DP-25, DP-38, DP-47, DP-67, DP-91, DP-93)

Only the roles, names, attributes and copy below are public. Everything else is up to you. `<n>` is a 1-based stage position, `<total>` the number of stages, `<$stage>` the stage operator such as `$unwind`, and `<email>` an address.

| Where | Role and accessible name | Visible copy or notes |
|---|---|---|
| Landing | `heading "JARFUL"` (level 1) | The wordmark |
| Landing | text under the wordmark | `Keep, shape and share your JSON documents in one bright jar.` |
| Landing | `link "Start a project"`, `link "Sign in"` | Start a project is the lime primary action |
| Landing | `region "Stage Sieve sample"` | The hero card. Its bands carry the stage-card attributes below |
| Sign-up | `textbox "Name"`, `textbox "Email"`, `textbox "Password"`, `button "Create account"` | |
| Confirm | `textbox "Code"`, `button "Confirm"`, `button "Send a new code"` | |
| Sign-in | `textbox "Email"`, `textbox "Password"`, `button "Sign in"` | |
| Account status | `status "Account status"` | Copy in Feedback states |
| Top bar | `link "Jarful"`, `link "Invitations"`, `button "Account"` opening `menu "Account"` with `menuitem "Sign out"` | |
| Top bar, phone | `button "Collections"` opening `dialog "Collections"` with `button "Close collections"` | The rail as a drawer |
| Rail | `navigation "Project"` holding the project name, `link "<collection name>"` per collection, and the section tag | The current collection is lime |
| Section navigation | `navigation "Sections"` with links `Documents`, `Query`, `Pipeline`, `Indexes`, `Schema`, `Rules`, `Members` | The current link has `aria-current="page"` |
| Project list | `heading "YOUR JARS"`, `list "Projects"` | |
| Project list | `heading "PUT IT IN THE JAR"`, `textbox "Project name"`, `textbox "First collection name"`, `button "Create project"` | |
| Project home | `list "Collections"`, `textbox "Collection name"`, `button "Create collection"`, `button "Delete project"` opening `dialog "Delete project <name>?"` with `button "Delete"` and `button "Cancel"` | |
| Invitations | `heading "Invitations"`, `list "Invitations"`; each item reads `<project> as <role> from <inviter name>` and has `button "Accept"` | |
| Query bar | `search "Query bar"` holding `textbox "Filter"`, `textbox "Projection"`, `textbox "Sort"`, `spinbutton "Limit"`, `button "Run"` | Run is the lime primary action on Documents |
| Results | `radiogroup "View"` with `radio "List"`, `radio "Table"`, `radio "JSON"` | List is selected at first |
| Results | `list "Documents"` (List), `grid "Documents"` (Table), `region "JSON results"` (JSON) | |
| Results | `button "Previous page"`, `button "Next page"`, and the text `Page <p> of <q>` | `<q>` is at least 1 |
| Results | `status "Query status"`, `status "Query plan"`, `alert "Query error"` | Copy in Feedback states |
| Documents | `button "Insert document"`, `button "Load file"`, `button "Download"`, `button "Save query"` | |
| Panes | `separator "Resize query pane"`, `separator "Resize pipeline pane"` | Value in percent, from 768 CSS pixels up |
| Phone | `tablist` with `tab "Query"`, `tab "Results"`, `tab "Pipeline"` and their `tabpanel`s | |
| Editor | `region "Document editor"` (desktop and tablet) or `dialog "Document"` (phone) | Placeholder when empty: `Open a document to see it here` |
| Editor | `textbox "Document JSON"`, `button "Save"`, `button "Close"`, `button "Delete document"` opening `dialog "Delete this document?"` with `button "Delete"` and `button "Cancel"` | |
| Editor | `status "Save status"`, `alert` clash notice with `button "Reload"` and `button "Overwrite"` | Copy in Feedback states |
| Read-only note | text at the top of collection screens for readers | Copy in Feedback states |
| Save query | `dialog "Save query"` with `textbox "Query name"` and `button "Keep query"` | |
| Saved queries | `list "Saved queries"`; each item has `button "Run <name>"` and `button "Delete <name>"` | |
| Load file | `dialog "Load file"` with `button "Choose file"`, `radiogroup "Format"` (`radio "JSON lines"`, `radio "CSV"`), `button "Load"`, `status "Import status"`, `list "Line errors"`, `link "Download original file"` | |
| Download | `dialog "Download"` with `radiogroup "Format"` (`radio "JSON lines"`, `radio "CSV"`) and `button "Download file"` | |
| Pipeline | `button "Add stage"`, `textbox "Pin document"`, `button "Pin"`, `button "Unpin"`, `list "Pipeline stages"`, `status "Pipeline status"`, `alert "Pipeline error"`, `region "Stage preview"` | |
| Stage card | focusable `group "Stage <n>: <$stage>"` holding `textbox "Stage <n> JSON"`, `switch "Enable stage <n>"`, `button "Move stage <n>"` (drag handle), `button "Delete stage <n>"` and a `status` with the stage status text | |
| Stage delete | `dialog "Delete stage <n> (<$stage>)?"` with `button "Delete"` and `button "Cancel"` | |
| Indexes | `list "Indexes"` with `button "Drop <name>"` per index except `_id_`; `textbox "Index keys"`, `checkbox "Unique"`, `textbox "Index name"`, `button "Create index"`, `status "Index status"` | |
| Schema | `list "Schema fields"`, one item per path | |
| Rules | `textbox "Validator JSON"`, `button "Save rules"`, `status "Rules status"` | |
| Members | `list "Members"`, `combobox "Role for <email>"` (options `editor`, `reader`), `button "Remove <email>"`, `textbox "Invite email"`, `combobox "Invite role"`, `button "Send invitation"`, `list "Pending invitations"` with `button "Revoke <email>"`, `status "Members status"` | |
| Outage | `alert` banner under the top bar | Copy in Feedback states |
| Not found | `heading "Not found"` (level 1) | |

DOM contract:

| Element | Attributes |
|---|---|
| List items, grid rows, JSON view blocks | `data-doc-id="<_id>"` |
| Grid cells and column headers | `data-doc-id` (cells only) and `data-field-path="<top-level field>"` |
| Stage cards and hero bands | `data-stage-index` (0-based), `data-stage-count` (the settled output count shown, which is the limit when capped), `data-capped` (`true` or `false`), `data-disabled` (`true` or `false`) |
| Each band's bar track and bar | `data-sieve-track` and `data-sieve-bar`; the bar also carries `data-overflow` (`true` or `false`) |
| Pin marker | `data-pin-marker` with `data-stop-index` (0-based stage index, or `end`) |
| Query plan region | `data-plan-kind` (`index` or `full_scan`) and `data-plan-index` (index name, empty for a full scan) |
| Schema rows | `data-field-path="<path>"` and `data-present` (whole percent); their type chips carry `data-type` and `data-share` (whole percent) |
| Every pane while its data loads (results, stage preview, schema, indexes, saved queries, collections) | `aria-busy="true"`, removed when the data lands |

List view items show the top-level fields in document order as `<field>: <value>` lines. The grid has one header row of column headers, then one row per document. Columns are `_id` first, then the union of the page's other top-level field names in code-unit order. When the projection drops `_id`, the `_id` column is left out. List items, grid rows and cells, and JSON blocks always carry `data-doc-id` taken from the query answer's `ids`, so Enter and tapping still open the full stored document. The JSON view shows each document as its own block, indented by two spaces.

### Interactions (DP-07, DP-11, DP-12, DP-16, DP-23, DP-24, DP-51, DP-56, DP-81, DP-82, DP-91, DP-92)

Query bar
- Ctrl+Enter (Cmd+Enter on macOS) runs the query when focus is on any control inside the query bar, buttons included, just like pressing Run. Tab in the query fields moves focus. It never indents.
- Opening Documents or a document route runs the empty query at once (empty filter, no projection, no sort, no limit, page 1) and shows its answer. Until the answer arrives, Query status shows its pending copy. When the collection holds more than `JARFUL_SCAN_LIMIT` documents, that run is refused like any other: Query error shows the guard message, the results are empty and Query status shows its refused copy, while the rail and project home still show the stored count.
- A run sends the filter, projection, sort and limit with page 1. The results, Query status and Query plan update in place. On a phone, the Results tab becomes selected and takes focus.
- The pager's Previous page and Next page run the same query for the neighbouring page. They are disabled at the first and last page. Focus stays on the button pressed.

View switch and grid
- The View radios follow the radio pattern: the arrow keys move the selection and the view changes at once, using the results already loaded.
- In the grid, exactly one cell is in the tab order at a time, the first cell of the first data row at first. The arrow keys move focus one cell. Home and End move to the first and last cell of the row. Enter opens that row's document in the editor. Pressing a row or a list item does the same.

Editor
- Opening a document sets the address to its document route. Opening that address directly shows the same screen with the document open.
- The editor shows the stored document exactly, pretty-printed with two-space indents: full number precision, dates as `{"$date":"..."}`, `_id` first and fields in their stored order. The display rule does not apply inside the editor.
- Ctrl+S (Cmd+S) saves when focus is anywhere in the editor region, and the browser's own save dialog never opens. Tab inserts two spaces. Escape followed by Tab moves focus to the next control after the editor.
- Close, or Escape on the phone dialog, closes the editor and returns focus to the row, cell or item that opened it. With no opener, focus goes to the first result.
- Insert document opens the editor with `{}`. The first save inserts the document and changes the address to the new document's route.
- Delete document opens its confirmation dialog. Delete removes the document, closes the editor and moves focus to the first result. Cancel returns focus to Delete document.

Pipeline
- Add stage appends a stage holding `{"$match":{}}` and moves focus to its JSON textbox.
- A stage's preview recomputes 300 milliseconds after its text stops changing, if the text is valid JSON. Moving, disabling, enabling and deleting recompute at once. Every change is saved as the person's pipeline draft.
- Alt+Up and Alt+Down move the stage whose card contains focus by one position, when focus is on the card itself or any control inside it. Focus stays on the moved card at its new position. A move at either end does nothing.
- Delete, with focus on the card itself, opens the stage delete dialog. Delete stage <n> does the same from anywhere. Confirming removes the stage and moves focus to the card now at that position, or to Add stage when none is left. Cancel returns focus to the opener.
- The Enable switch toggles the stage. Focus stays on the switch.
- Dragging a stage by its move handle and dropping it between other cards moves it with the same result as the keyboard. On touch devices a long press on the handle starts the drag.
- Pin takes the `_id` typed in Pin document and draws the marker. Unpin removes it. Focusing a stage card shows that stage's first documents in the Stage preview.

Live results
- While a collection screen is open, the app listens to the collection's event stream. Within 2 seconds of any change by anyone, the shown page, Query status and counts become what running the current query again would show. Focus stays where it was, the scroll position of the results is kept, and an editor draft is never touched. A new or edited document appears only if it matches the current filter, and an edit that stops a shown document matching removes its row. If the connection drops, the app reconnects and catches up from the last sequence it applied (Business rules).
- A role event changes the open screen within 2 seconds: the editor turns read-only and the read-only note appears, or the reverse.

Panes, dialogs, drawers and menus
- Each separator is in the tab order. Arrow Down and Arrow Right add 5 to its value. Arrow Up and Arrow Left take 5 away. Home and End go to 20 and 80. The value stays between 20 and 80 percent, and dragging with a pointer does the same. Resize query pane starts at 30 and sets the query bar's share of the Documents column. Resize pipeline pane starts at 50 and sets the stage list's share.
- Every dialog, the Collections drawer and the Account menu keep Tab and Shift+Tab inside themselves, wrapping at both ends. Escape closes them and focus returns to the control that opened them. Choosing a collection in the drawer navigates and closes it.
- A closed drawer, menu or dialog, and every unselected tab panel, is hidden and inert. Nothing inside it is visible, focusable, reachable by pointer or present in the accessibility tree, at every viewport. Sliding it off screen does not count as closed.
- Phone tabs follow the tabs pattern: the arrow keys move between tabs and select them.
- On touch screens every list and pane scrolls by finger, and every control is at least 44 pixels in both directions.

### Visual design (DP-95, DP-96, DP-97)

The direction is royal-field: loud, exact and friendly.

- **Colour.** Every screen is a full-bleed bubblegum pink field from the first pixel to the last, the working data screens included. Panels for lists, tables and saved-query lists use a slightly deeper, warmer pink. Text is near-black ink. Secondary text uses a deep plum that reads clearly on the pink. Acid lime is used only in these places: the single primary action on each screen, the current rail item, the hero's highlighter swipe behind JAR, the hero card's lit edge and its glow, and the Stage Sieve bars with their overflow notches. Nothing else is lime. Text on lime is near-black. Dense code and data panes (the JSON editor, the JSON results view, the stage preview and the explain readout) switch to a near-black field with pink monospace text. No other saturated hue appears anywhere in the product.
- **Type.** TikTok Sans for display and body, and Martian Mono only inside the black code and data panes. Bundle both with the app. Each heading step is a quarter larger than the step below. The project name in the rail is medium weight. Every count and every stage number uses tabular figures, so columns of numbers line up.
- **Voice.** Headlines speak in plain verbs and capitals, such as the new-project heading. No jargon in headings.
- **Composition.** On landing and account screens the rail area is empty pink and content starts at 30 percent of the width. Inside a project the fixed left rail carries the project name, collections and the section tag. Density is comfortable: generous row spacing, never cramped.
- **Corners.** Panels have square corners. Buttons, chips and tags are full pills.
- **Dividers.** Rows are separated by spacing and by the step between the two pinks, never by hairlines.
- **Syntax.** In code panes, keys are white against pink values, and structure is shown by weight, never by a second hue.
- **Validation errors** show inline as a black chip with pink text, an icon and the failing path, so they never depend on colour alone.
- **Schema rows** show each type's share as a proportional segment, alternating near-black and deep plum, with the percentage printed on or beside each segment.
- **The empty collection screen** is a giant stretched headline in capitals (copy in Feedback states), with Load file and Insert document under it for editors and owners.
- **Loading** shows pink skeleton blocks that keep the final layout: when data lands, the loading pane and everything above or beside it keep their position and width to within 1 pixel.
- **Outage banners** are full-width near-black strips under the top bar, with pink text and an icon from the Lucide set.
- **Hero.** The left half holds JARFUL in the heaviest weight of TikTok Sans, stretched to one and a half times its normal width, in capitals, about a twentieth of the screen width tall. One lime highlighter swipe sits behind the letters JAR. Under it are the body-size line, the lime Start a project link and the plain Sign in link. The right half holds a near-black card whose edge is lit with a lime-to-pink gradient, with a soft lime glow spilling past its top-right corner. Inside it the sample Stage Sieve runs. On a phone the text comes first, then the card.
- **Stage Sieve bands** are full-width. Each has a lime bar on a near-black track, its stage label and its tabular count. A disabled stage collapses to a thin dashed band reading the pass-through copy. The overflow notch is a small lime tab past the track's right end.
- **Controls** are at least 44 pixels in both directions. All text and controls meet WCAG 2.2 AA contrast. Focus is shown by a thick near-black ring that is visible on pink, lime and black.

### Motion and effects (DP-29, DP-30, DP-31, DP-93)

- **Interface transitions.** Dialogs, the drawer, menus and the editor column fade and slide in over about a quarter of a second and leave a little faster. Buttons darken slightly on hover and press within a tenth of a second.
- **Stage Sieve.** When a change to stage k lands, bands k to the last band update from the top down. Band j starts 40 milliseconds after band j−1, so band j waits 40 × (j − k) milliseconds. Each bar then moves from its old width to its new width over 320 milliseconds, starting quickly and settling softly, while its numeral counts in whole numbers from the old value to the new one. Bands above k do not move. When the motion settles, every numeral equals the server's count and every bar width is exact. On first load the old width and count of every band are zero, so the bars grow from the left in the same stagger starting with the first band.
- **Pin marker.** A black marker slides down the bands over the same staggered timing and stops at the stage that drops the pinned document.
- **Hero card.** It runs the same first-load motion once when the landing page opens. After that it is still.
- **No loops.** Nothing moves on its own except these one-off transitions: no shimmer, pulse, idle animation or decorative loop.
- **Reduced motion.** With the operating system's reduced-motion setting on, every bar, numeral and marker takes its final state in the first frame after the data lands, with no stagger. Transitions become instant. Announcements are unchanged.

Bar geometry: `input` is the number of documents entering the pipeline (the preview's `input`) and `out` is a band's output count. The bar's width is the track width × min(1, ln(1 + out) ÷ ln(1 + input)), and zero when `input` is 0. When `out` is greater than `input`, the bar fills the track and its overflow attribute is true. A capped band uses the limit as `out`. Settled bar widths match the formula to within 1 pixel. When a preview is refused with `scan_limit`, the answer has no `input`, so `input` is the collection's `count` from the collection route. A disabled band draws no bar: it keeps its track but has no `data-sieve-bar`, and its `data-stage-count` is the count it passes through (the API's stage `count`). In a capped run every band, disabled ones included, has `data-stage-count` equal to the limit and `data-capped="true"`.

### Feedback states (DP-06, DP-17, DP-25, DP-32, DP-38, DP-39, DP-43, DP-50, DP-52, DP-57, DP-72, DP-76, DP-78, DP-94)

Every async action shows a pending state and then exactly one result. Polite regions use `status`. Assertive ones use `alert`. Placeholders: `<matched>` and `<shown>` are the run's `matched` and the number of documents on the page; `<N>` is the limit named in the error; `<count>` is a stage's output count; `<path>` a dot path; `<name>` an index name; `<value>` the conflicting value as compact JSON; `<n>` a line or stage position. Every number follows the display rule. A noun is singular when its number is 1 ("1 document").

| Region | State | Exact copy |
|---|---|---|
| Query status | pending | `Running query` |
| Query status | run refused | `Query not run` |
| Query status | result | `<matched> documents matched, <shown> shown`; `No documents matched` when matched is 0 |
| Query plan | result | first line `Used index <name>` or `Full scan`; second line `Examined <docs_examined> documents, returned <returned>` |
| Query error | invalid JSON in a field | `<Field> is not valid JSON` (Filter, Projection or Sort) |
| Query error | `unknown_operator` | `Unknown operator <operator>` |
| Query error | `invalid_projection` | `Projection cannot mix inclusion and exclusion` |
| Query error / Pipeline error | `scan_limit` | `Query stopped: more than <N> documents would be scanned. Add an index or narrow the filter.` |
| Query error | `query_too_deep` | `Query is nested deeper than <N> levels` |
| Query error | `invalid_query`, field `filter` / `projection` / `sort` | `Filter is not valid` / `Projection is not valid` / `Sort is not valid` |
| Query error | `invalid_query`, field `limit` / `page` | `Limit must be a whole number of 0 or more` / `Page must be a whole number of 1 or more` |
| Pipeline error | `too_many_stages` | `Pipeline has more than <N> stages` |
| Pipeline error | `unknown_stage` / `invalid_stage` | `Unknown stage <stage>` / `Stage <n> is not valid` |
| Stage card | stage status | `Stage <n> of <total>: <count> documents out`; capped: `Stage <n> of <total>: ≤<N> documents out` |
| Stage card | disabled | `pass through` |
| Stage card | text is not valid JSON | the document message `not valid JSON` |
| Stage card | pin | `Pinned document stops here` on the stopping stage; `Pinned document reaches the end` on the last band when nothing drops it |
| Pipeline status | after a move | `Stage moved to position <n> of <total>` |
| Pipeline status | after a delete | `Stage <n> deleted` |
| Pipeline status | after another recompute | the status text of the stage acted on |
| Save status | pending / success | `Saving` / `Saved` |
| Save status | refusal | a document message (below), shown in the error chip with its icon and path |
| Save status | 403 | the read-only note |
| Save status | document gone | `This document no longer exists` |
| Clash alert | stale save | `This document was changed by someone else.` with Reload and Overwrite |
| Read-only note | reader | `You have read access` |
| Import status | pending | `Loading file` |
| Import status | success | `Imported <inserted> documents` |
| Import status | `too_many_lines` | `File has more than <N> lines` |
| Import status | `import_failed` | `Import failed`, with each error as an item `Line <n>: <message>` in Line errors |
| Index status | pending / success | `Creating index` / `Index <name> created` |
| Index status | `invalid_index` / `duplicate_key` | `Index keys are not valid` / the duplicate text |
| Rules status | success / `invalid_validator` | `Rules saved` / `Rules are not valid` |
| Members status | invitation created | `Invitation created for <email>` |
| Members status | `already_member` / `already_invited` | `Already a member` / `Already invited` |
| Save query dialog | `name_taken` | `A saved query with this name already exists` |
| Saved query item | last run | `Last run <YYYY-MM-DD HH:MM> UTC, <count> documents matched`; before any run `Never run` |
| Account status | sign-up sent | `Check <email> for your code` |
| Account status | `invalid_code` / `invalid_credentials` / `not_confirmed` / `email_taken` | `That code is not right` / `Email or password is not right` / `Confirm your email first` / `An account with this email already exists` |
| Invitations | none pending | `No invitations` |
| Schema row | presence | `Present in <present>% of documents`, with `<present>` the row's `present` |
| Schema type segment | share | `<type> <share>%`, with `<type>` and `<share>` from the row's types |
| Empty collection | no documents | `NOTHING IN THIS JAR YET` |
| Outage banner | storage unreachable | `File storage is unavailable. Try again later.` |

Document messages are one shared set, used in Save status and after `Line <n>: ` in load reports:
- `not valid JSON`
- `not an object`
- `invalid _id`
- `invalid field name at <path>`
- `document is larger than <N> bytes`
- `document is nested deeper than <N> levels`
- `row has <X> cells, header has <Y>`
- `missing header row`
- `duplicate header <header>`
- `conflicting header <header>`
- the validation text: `Document failed validation at <path>: ` followed by `required field is missing`, `expected <bsonType>`, `must be at least <n>`, `must be at most <n>` or `must be one of <compact JSON list>`
- the duplicate text: `Duplicate value <value> for unique index <name>`

The outage banner shows on every collection screen while storage is unreachable. It is checked against the health route when the screen opens and again whenever a file route answers `storage_unavailable`. The stage card's capped form is used when a preview is refused with `scan_limit`: every enabled band then reads it and is drawn with `out` equal to the limit, and disabled bands read `pass through`.

## Backend

### API (DP-05, DP-11, DP-14, DP-19, DP-22, DP-34, DP-41, DP-46, DP-49, DP-54, DP-59, DP-60, DP-61, DP-63, DP-64, DP-67, DP-69, DP-73, DP-74, DP-80, DP-85, DP-86, DP-87, DP-93)

All bodies are JSON (`application/json; charset=utf-8`) except file uploads, file downloads and the event stream. `<C>` stands for `/api/projects/:pid/collections/:cid`. Ids are opaque strings. Times are UTC text `YYYY-MM-DDTHH:MM:SSZ`.

**Error shape and order.** Every error body is `{"error":"<code>"}` plus the extra fields listed below. When several errors apply, the first in this order wins:
1. the Server boundary refusals;
2. `unauthenticated`;
3. `not_found` for any project, collection, document, saved query, file load, download or invitation the caller cannot open (never `read_only`);
4. `read_only`;
5. state conflicts: `version_conflict`, `invitation_closed`, `already_member`, `already_invited`, `not_confirmed`;
6. 422 errors, in each rule's check order;
7. data conflicts: `duplicate_key`, `name_taken`, `email_taken`;
8. `storage_unavailable`.

| Code | Status | Body extras |
|---|---|---|
| `unauthenticated` | 401 | none |
| `invalid_credentials` | 401 | none |
| `not_found` | 404 | none |
| `read_only` | 403 | none (a reader writing, or a non-owner doing an owner action) |
| `version_conflict` | 409 | `"current_version":N,"current":{document}` |
| `invitation_closed`, `already_member`, `already_invited`, `not_confirmed` | 409 | none |
| `duplicate_key` | 409 | `"index":"<name>","value":<value>` (for a compound index, the object of its key values in key order) |
| `name_taken`, `email_taken` | 409 | none |
| `invalid_field` | 422 | `"field":"<request field>"` |
| `invalid_id`, `id_mismatch`, `invalid_projection`, `invalid_index`, `invalid_validator`, `cannot_drop_id_index`, `owner_role_fixed`, `invalid_code` | 422 | none |
| `invalid_field_name` | 422 | `"path":"<dot path>"` |
| `document_too_large`, `document_too_deep`, `scan_limit`, `too_many_stages`, `too_many_lines`, `query_too_deep` | 422 | `"limit":N` |
| `validation_failed` | 422 | `"path":"<path>","rule":"required"\|"bsonType"\|"minimum"\|"maximum"\|"enum"` |
| `invalid_query` | 422 | `"field":"filter"\|"projection"\|"sort"\|"limit"\|"page"` |
| `unknown_operator` | 422 | `"operator":"$x"` |
| `unknown_stage` | 422 | `"stage":"$x","index":i` |
| `invalid_stage` | 422 | `"index":i` |
| `import_failed` | 422 | `"import_id":"<id>","errors":[{"line":n,"message":"<document message>"}]` |
| `storage_unavailable` | 503 | none |

**Accounts**
- `POST /api/auth/signup` `{"email","password","name"}` → 201 `{"status":"code_sent"}`. The email is a valid address and is lowercased. The password has at least 8 characters (8 is allowed). The name has 1 to 80 characters. Each failure gives `invalid_field`. A confirmed address gives `email_taken`. An unconfirmed address gets a new code and 201.
- `POST /api/auth/confirm` `{"email","code"}` → 200 `{"user":{"id","email","name"}}` and sets the session cookie. A wrong or replaced code gives `invalid_code`.
- `POST /api/auth/resend` `{"email"}` → 202 `{"status":"code_sent"}`, for an unconfirmed address, and otherwise the same answer with nothing sent.
- `POST /api/auth/signin` `{"email","password"}` → 200 `{"user":{...}}` with the cookie. A wrong pair gives `invalid_credentials`. An unconfirmed account gives `not_confirmed`.
- `POST /api/auth/signout` → 204. `GET /api/me` → 200 `{"user":{...}}`.

**Projects, members, invitations**
- `GET /api/projects` → `{"projects":[{"id","name","role"}]}`, ordered by name.
- `POST /api/projects` `{"name","collection"}` → 201 `{"project":{"id","name"},"collection":{"id","name","count":0}}`. Project names have 1 to 80 characters and collection names follow the collection rule. A project name already used by the same owner gives `name_taken`.
- `GET /api/projects/:pid` → `{"id","name","role","owner":{"email","name"}}`. `DELETE /api/projects/:pid` → 204 (owner only).
- `GET /api/projects/:pid/members` → `{"members":[{"user_id","email","name","role"}],"invitations":[{"id","email","role","state"}]}`. Members are ordered owner first, then by email. Invitations are the pending ones, listed for owners only and empty for everyone else.
- `PATCH /api/projects/:pid/members/:uid` `{"role":"editor"|"reader"}` → 200 member. Another role value gives `invalid_field`. The owner's own row gives `owner_role_fixed`. `DELETE` on the same path → 204, and the owner's row gives `owner_role_fixed`.
- `POST /api/projects/:pid/invitations` `{"email","role":"editor"|"reader"}` → 201 `{"invitation":{"id","email","role","state":"pending"}}`. A member's address gives `already_member`. An address with a pending invitation to this project gives `already_invited`.
- `DELETE /api/projects/:pid/invitations/:iid` → 200 `{"invitation":{...,"state":"revoked"}}`.
- `GET /api/invitations` → `{"invitations":[{"id","project":{"id","name"},"role","inviter":{"name"}}]}`: the caller's pending invitations.
- `POST /api/invitations/:iid/accept` → 200 `{"project_id":"<pid>"}`. An invitation for a different address than the caller's is `not_found`.

**Collections and documents**
- `GET /api/projects/:pid/collections` → `{"collections":[{"id","name","count"}]}`, ordered by name. `POST` `{"name"}` → 201 `{"collection":{...}}` (owner only). Names have 1 to 64 characters, each a letter, digit, `_` or `-`; anything else gives `invalid_field`. A name already used in the project gives `name_taken`.
- `GET <C>` → `{"id","name","count","sequence","validator"}`. `DELETE <C>` → 204 (owner only).
- `POST <C>/documents` `{"document":{...}}` → 201 `{"document":{...},"version":1}`.
- `GET <C>/documents/:did` → 200 `{"document":{...},"version":N}`.
- `PUT <C>/documents/:did` `{"document":{...},"version":N}` → 200 `{"document":{...},"version":N+1}`. A body `_id` other than `:did` gives `id_mismatch`. A missing or non-integer `version` gives `invalid_field`.
- `DELETE <C>/documents/:did` → 204.

**Query, aggregation, pipeline draft**
- Every stage index in API bodies (`disabled`, the stage `index`, `stopped_at`, and the `index` of `unknown_stage` and `invalid_stage`) is 0-based, the same as `data-stage-index`. On screen, `Stage <n>` is 1-based, so `<n>` is the index plus 1.
- `POST <C>/query` `{"filter":{},"projection":{}|null,"sort":{}|null,"limit":0,"page":1}` → 200 `{"matched":N,"page":P,"page_size":S,"documents":[...],"ids":["<_id>",...],"plan":{"kind":"index"|"full_scan","index":"<name>"|null,"docs_examined":N,"returned":N}}`. Every field is optional. `filter` must be an object, `projection` and `sort` an object or null, `limit` an integer of 0 or more, and `page` an integer of 1 or more. Each failure gives `invalid_query`. `ids` lists the `_id` of each returned document in the same order, whatever the projection.
- `POST <C>/aggregate` `{"pipeline":[...],"disabled":[i,...],"preview":true,"pin":"<_id>"}` → 200 `{"input":N,"stages":[{"index":i,"count":N,"disabled":bool,"documents":[...]}],"pin":{"_id":"<_id>","stopped_at":i|null}}`. `pin` is optional, and `"pin"` in the answer is null without it. A pinned `_id` that is not in the collection is `not_found`.
- `POST <C>/aggregate` `{"pipeline":[...],"disabled":[...],"page":1}` → 200 `{"count":N,"page":P,"page_size":S,"documents":[...]}`.
- `GET <C>/pipeline` → `{"stages":["<stage text>",...],"disabled":[i,...]}`, empty at first. `PUT <C>/pipeline` with the same shape → 200 with the same body. Each stage text is a string of at most `JARFUL_MAX_DOC_BYTES` bytes. More texts than `JARFUL_MAX_STAGES` gives `too_many_stages`. Any member may keep their own draft, readers included.

**Indexes, rules, schema, saved queries**
- `GET <C>/indexes` → `{"indexes":[{"name","keys":{...},"unique":bool}]}`, with `_id_` first and then by name. `POST <C>/indexes` `{"keys":{"path":1|-1,...},"unique":false,"name":"<optional>"}` → 201 `{"index":{...}}`. Keys must be a non-empty object with values 1 or -1, otherwise `invalid_index`. A name already used gives `name_taken`. `DELETE <C>/indexes/:name` → 204. Dropping `_id_` gives `cannot_drop_id_index`.
- `GET <C>/validator` → `{"validator":{...}|null}`. `PUT <C>/validator` `{"validator":{...}|null}` → 200 with the same body (owner only). A malformed validator gives `invalid_validator`.
- `GET <C>/schema` → `{"sampled":N,"fields":[{"path","present":P,"types":[{"type","share":S}]}]}`.
- `GET <C>/saved-queries` → `{"saved_queries":[{"id","name","filter","projection","sort","limit","last_run_at":"<time>"|null,"last_count":N|null}]}`, ordered by name. `POST` with `{"name","filter","projection","sort","limit"}` → 201 `{"saved_query":{...}}`. `PUT <C>/saved-queries/:qid` with the same shape → 200. `DELETE` → 204. Names have 1 to 80 characters. A name already used in the collection gives `name_taken`. The query fields follow the query route's rules.
- `POST <C>/saved-queries/:qid/run` `{"page":1}` → 200, the query answer plus `"saved_query":{...}` with the updated `last_run_at` and `last_count`. Readers may run saved queries.

**Live feed**
- `GET <C>/events` → `text/event-stream`. Each change is sent as `id: <seq>`, `event: change` and `data: {"seq":N,"op":"insert"|"update"|"delete","_id":"<_id>","document":{...}|null,"version":N|null}`. `document` and `version` are null for deletes. A role change for the listening member is sent as `event: role` with `data: {"role":"owner"|"editor"|"reader"}`. A comment line is sent every 15 seconds to keep the connection open. The stream resumes from the `Last-Event-ID` header or the `after` query parameter. Without either, it starts after the current sequence.

**Files**
- `POST <C>/imports?format=jsonl|csv` with the raw file bytes as the body and the file name in the `X-File-Name` header → 201 `{"import_id":"<id>","inserted":N}`. A `format` that is missing or wrong gives `invalid_field`.
- `GET <C>/imports/:iid` → `{"id","file_name","format","state","bytes","inserted","errors":[...],"created_at"}`. `GET <C>/imports` lists the same objects, newest first.
- `GET <C>/imports/:iid/original` → 200 with the stored bytes, `Content-Type: application/octet-stream` and `Content-Disposition: attachment; filename="<file name>"`.
- `POST <C>/exports` `{"format":"jsonl"|"csv","filter":{},"sort":{}|null}` → 201 `{"export_id":"<id>","download_url":"/api/projects/<pid>/exports/<id>"}`.
- `GET /api/projects/:pid/exports/:eid` → 200 with the stored bytes and `Content-Disposition: attachment; filename="<collection name>.<jsonl|csv>"`.

**Public routes**
- `GET /api/sample/sieve` → the preview answer for the sample pipeline over the houseplant collection (Seed data). No sign-in needed.
- `POST /api/grading/seed` with header `X-Grading-Key: <GRADING_KEY>`. A missing or wrong key answers `not_found`. The body is:
  `{"users":[{"email","password","name"}],"projects":[{"name","owner":"<email>","members":[{"email","role"}],"collections":[{"name","documents":[...],"indexes":[{"name","keys":{...},"unique":bool}],"validator":{...}|null,"saved_queries":[{"name","filter","projection","sort","limit"}]}]}]}`.
  It answers 201 `{"users":{"<email>":"<user id>"},"projects":{"<project name>":{"id","collections":{"<name>":{"id","documents":["<_id>",...],"saved_queries":{"<name>":"<id>"}}}}}}`, with document `_id`s in the given order.
  Seeded users are confirmed. Owners and members are users from this body or existing users. Documents keep a given `_id` and obey the document rules, but are not checked against the validator. Indexes are built after the documents. Each refusal uses the matching error from this catalogue, and a refused call adds nothing.

### Business rules (DP-01, DP-02, DP-03, DP-04, DP-05, DP-09, DP-10, DP-11, DP-14, DP-15, DP-19, DP-20, DP-21, DP-22, DP-27, DP-28, DP-32, DP-34, DP-35, DP-36, DP-37, DP-41, DP-42, DP-46, DP-49, DP-54, DP-55, DP-61, DP-63, DP-65, DP-66, DP-69, DP-70, DP-71, DP-72, DP-74, DP-75, DP-78, DP-79, DP-80, DP-86)

**Documents**
- `_id` is a string of exactly 24 lowercase hexadecimal characters. The server assigns a random one when none is given. A given `_id` in another form gives `invalid_id`.
- Allowed values are string, number, boolean, null, object, array, and a date written exactly as `{"$date":"YYYY-MM-DDTHH:MM:SSZ"}`, optionally with three digits of milliseconds before the `Z`. Any other key starting with `$`, or a field name containing `.`, gives `invalid_field_name` with the path of the first offending field in document order.
- Size is the length in UTF-8 bytes of the document's compact JSON text: `_id` first, no whitespace, fields in stored order, non-ASCII characters written raw. A size above `JARFUL_MAX_DOC_BYTES` gives `document_too_large`. The limit itself is allowed.
- Depth: the document is level 1, and each nested object or array adds 1, so `{"a":[{"b":1}]}` has depth 3. A date counts as a plain value, not a level. A depth above `JARFUL_MAX_DEPTH` gives `document_too_deep`. The limit itself is allowed.
- Check order for a document: `_id`, then field names, then size, then depth, then the validator, then unique indexes.
- Documents keep their field order exactly as written, with `_id` first. Every API answer and view shows fields in that order.
- Numbers are stored by value. Every API answer, the editor, JSON-lines downloads and CSV downloads write each number as the shortest JSON text that reads back as the same double-precision value, so `1.0` becomes `1`, `2.50` becomes `2.5` and `1e3` becomes `1000`. Document size is measured on that text. Only the original file download keeps the uploaded text.
- Every document has a `version` kept outside its body. It is 1 on insert and rises by 1 on every successful save, including a save that changes nothing.

**Example collection E** (used by the worked examples below; not seeded):
- E1 `e00000000000000000000001`: `{"sku":"POT-1","price":12,"tags":["red","blue"],"items":[{"sku":"S1","qty":2},{"sku":"S2","qty":5}],"note":null}`
- E2 `e00000000000000000000002`: `{"sku":"POT-2","price":7.5,"tags":["green"],"items":[{"sku":"S2","qty":1}]}`
- E3 `e00000000000000000000003`: `{"sku":"POT-3","price":"12","tags":[],"items":[],"note":"chipped"}`
- E4 `e00000000000000000000004`: `{"sku":"POT-4","price":20,"tags":["red"],"items":[{"sku":"S3","qty":5},{"sku":"S1","qty":9}],"made":{"$date":"2026-03-01T00:00:00Z"}}`

**Filters**
- A filter is an object of field conditions. Several fields mean all must hold. A condition is either a value (implicit `$eq`) or an object of operators. In a filter, `{"$date":"..."}` is a date value, not an operator.
- Operators: `$eq $ne $gt $gte $lt $lte $in $nin $exists $and $or $nor $not $size $elemMatch`. Any other key starting with `$`, at any level, gives `unknown_operator`. `$and`, `$or` and `$nor` take non-empty arrays of filters. `$in` and `$nin` take arrays. `$size` takes a whole number of 0 or more. `$exists` takes a boolean. `$not` takes an operator object. Each wrong shape gives `invalid_query` with field `filter`.
- Equality: numbers are equal by value (`2` equals `2.0`). Objects and arrays are equal when their compact JSON text matches, field order included. Dates are equal by instant.
- `$gt`, `$gte`, `$lt` and `$lte` compare only within one type class: numbers with numbers, strings with strings, dates with dates. A value of another type never matches.
- Paths: `a.b` reaches into nested objects and `items.0.sku` reaches an array position. A path through an array of objects, such as `items.sku`, reaches every element's field.
- Arrays: a field holding an array matches when the whole array matches the condition or when any element does. Each operator in one condition object may be met by a different element. `$elemMatch` requires one single element to meet every condition inside it. `$size` matches arrays of exactly that length.
- Missing fields: `{"f":null}` and `$in` with `null` match where `f` is null or missing. `{"f":{"$ne":null}}` matches neither. `{"f":{"$exists":false}}` matches only missing, and `$exists: true` matches any present value, null included.
- `$ne`, `$nin`, `$not` and `$nor` match exactly the documents that `$eq`, `$in`, the inner condition and `$or` do not.

Worked examples over E:

| Filter | Matches |
|---|---|
| `{"price":12}` (same with `$eq`) | E1 |
| `{"price":{"$ne":12}}` | E2, E3, E4 |
| `{"price":{"$gt":10}}` | E1, E4 |
| `{"price":{"$gte":12}}` | E1, E4 |
| `{"price":{"$lt":12}}` | E2 |
| `{"price":{"$lte":7.5}}` | E2 |
| `{"sku":{"$in":["POT-1","POT-3"]}}` | E1, E3 |
| `{"tags":{"$nin":["red"]}}` | E2, E3 |
| `{"note":{"$exists":true}}` | E1, E3 |
| `{"note":{"$exists":false}}` | E2, E4 |
| `{"note":null}` | E1, E2, E4 |
| `{"note":{"$ne":null}}` | E3 |
| `{"$and":[{"price":{"$gt":5}},{"tags":"red"}]}` | E1, E4 |
| `{"$or":[{"price":7.5},{"note":"chipped"}]}` | E2, E3 |
| `{"$nor":[{"tags":"red"},{"price":7.5}]}` | E3 |
| `{"price":{"$not":{"$gt":10}}}` | E2, E3 |
| `{"tags":{"$size":1}}` | E2, E4 |
| `{"tags":{"$size":0}}` | E3 |
| `{"tags":"red"}` | E1, E4 |
| `{"tags":["red","blue"]}` | E1 |
| `{"tags":["blue","red"]}` | none |
| `{"items.0.sku":"S2"}` | E2 |
| `{"items.sku":"S1","items.qty":5}` | E1, E4 |
| `{"items":{"$elemMatch":{"sku":"S1","qty":5}}}` | none |
| `{"items":{"$elemMatch":{"sku":"S1","qty":{"$gt":5}}}}` | E4 |
| `{"items.qty":{"$gt":3,"$lt":4}}` | E1 |
| `{"items":{"$elemMatch":{"qty":{"$gt":3,"$lt":4}}}}` | none |
| `{"made":{"$gte":{"$date":"2026-01-01T00:00:00Z"}}}` | E4 |

**Comparison order** (used by sort, `$min`, `$max`, `$group` output and index ranges)
- Type order: null and missing < numbers < strings < objects < arrays < booleans < dates.
- Within a type: numbers by value, strings by UTF-16 code unit, objects and arrays by their compact JSON text in code-unit order, false before true, and dates by instant.

**Sort**
- A sort is an object of keys in order, each 1 (ascending) or -1 (descending). Any other value gives `invalid_query` with field `sort`.
- A missing field sorts as null. An array sorts by its smallest element when ascending and by its largest when descending. An empty array sorts as null. Ties after the last key go by `_id` ascending, whichever direction the last key has.
- With no sort, results come in `_id` ascending order.

Worked example: S1 to S9 have `_id`s `b00000000000000000000001` to `b00000000000000000000009`. Their `v` is missing in S1, then null, 3, `"3"`, `[5,1]`, true, `{"$date":"2026-01-01T00:00:00Z"}`, `{"a":1}` and `[]` in S2 to S9.
- `{"v":1}` gives S1, S2, S9, S5, S3, S4, S8, S6, S7.
- `{"v":-1}` gives S7, S6, S8, S4, S5, S3, S1, S2, S9.

**Projection**
- An inclusion lists paths with 1 or true, such as `{"a":1,"b.c":1}`, and keeps `_id` unless it has `"_id":0`. An exclusion lists paths with 0 or false. The two never mix, except `"_id":0` inside an inclusion. A mix, or any other value, gives `invalid_projection`.
- Inclusion output has `_id` first, then the included fields in document order. A path through an array of objects keeps that field in each element. Missing paths are left out. Exclusion keeps document order without the excluded paths.
- Worked examples on E1:
  - `{"sku":1,"items.sku":1}` gives `{"_id":"e00000000000000000000001","sku":"POT-1","items":[{"sku":"S1"},{"sku":"S2"}]}`.
  - `{"sku":1,"_id":0}` gives `{"sku":"POT-1"}`.
  - `{"items":0,"tags":0,"note":0}` gives `{"_id":"e00000000000000000000001","sku":"POT-1","price":12}`.
  - `{"sku":1,"price":0}` is refused.

**Query runs and pages**
- `matched` is the number of matching documents, capped by `limit` when `limit` is above 0. Pages hold `JARFUL_PAGE_SIZE` documents of the sorted, limited matches. A page past the end is empty. The projection applies to returned documents only.
- `returned` equals `matched`.
- The Query plan text and the run's answer describe the same run.

**Index choice and examined counts**
- A filter condition qualifies for an index when it sits on the index's first key, at the top level of the filter or inside a top-level `$and` (never inside `$or`, `$nor` or `$not`), and uses equality, `$eq`, `$in` or any of `$gt`, `$gte`, `$lt`, `$lte`. Other operators in the same condition object are ignored for this choice.
- The plan kind is `index` when some index qualifies. When several qualify, the one with more leading keys constrained wins, and a tie goes to the name that sorts first by code unit. `_id_` takes part like any index. `docs_examined` is then the number of documents whose first-key value meets the qualifying operators under the filter rules, with arrays matching by any element and missing values counting as null.
- Otherwise the kind is `full_scan` and `docs_examined` is the collection's document count.
- Worked examples over E: with an index `sku_1`, `{"sku":"POT-1","price":12}` uses `sku_1`, examines 1 and returns 1. `{"price":12}` is a full scan that examines 4 and returns 1.

**Scan guard and bounds**
- A query, saved-query run, download or pipeline whose `docs_examined` would exceed `JARFUL_SCAN_LIMIT` is refused with `scan_limit`. The limit itself is allowed.
- For a pipeline, `docs_examined` is worked out from its first enabled stage when that is `$match`, and is the collection size otherwise.
- The houseplant sample is exempt from the guard.
- Filters, projections, sorts and pipeline stages nested deeper than 32 levels (counted like document depth) are refused with `query_too_deep`, limit 32. The limit itself is allowed.
- Every query, preview, aggregation and download within these limits answers within 3 seconds.

**Aggregation**
- Stages: `$match` (filter rules), `$project` (projection rules, plus `"<new name>":"$<path>"` to copy a field under a new name, which goes with inclusion only), `$group`, `$sort` (sort rules), `$limit` (an integer of 1 or more), `$skip` (an integer of 0 or more), `$unwind` and `$count`.
- Each stage is an object with exactly one key. An unknown stage name gives `unknown_stage`. A wrong shape gives `invalid_stage`. Every error inside a stage's own filter, sort or projection (an unknown operator, a wrong operator shape, a sort value other than 1 or -1, a mixed projection) also gives `invalid_stage` with that stage's index, never `unknown_operator`, `invalid_query` or `invalid_projection`. More than `JARFUL_MAX_STAGES` stages, disabled ones included, gives `too_many_stages`. The limit itself is allowed. The first failing stage in pipeline order is reported.
- Documents enter the pipeline in `_id` ascending order. `input` is the collection's document count. Disabled stages pass their input through unchanged and report the previous count (or `input` for the first stage).
- The preview gives each stage's exact output count and its first `JARFUL_PREVIEW_DOCS` documents.
- `$project` copies: a `"$path"` whose path is missing leaves the field out. Computed fields follow the included ones in projection order. On E1, `{"$project":{"sku":1,"first_item":"$items.0.sku"}}` gives `{"_id":"e00000000000000000000001","sku":"POT-1","first_item":"S1"}`.
- `$unwind: "$path"` outputs one document per array element, with the field replaced by that element. Missing, null and empty arrays are dropped. A non-array value passes through unchanged. Over E, `$unwind:"$tags"` gives 4 documents (E1 twice, E2 and E4), and `$unwind:"$made"` gives 1 (E4).
- `$group`: `_id` is null, a `"$path"`, or an object of `"$path"` values, and a missing path counts as null.
  - Accumulators are `$sum $avg $min $max $count $push $first $last`.
  - `$sum` and `$avg` ignore non-numbers. `$sum` of nothing is 0 and `$avg` of nothing is null. `$avg` is rounded half away from zero to 10 decimal places.
  - `$min` and `$max` use the comparison order and ignore missing values.
  - `$push` collects present values. `$first` and `$last` take input order, giving null for a missing value. `$count: {}` counts the group.
  - Output is ordered by `_id` ascending in the comparison order.
  - Worked over E: `{"$group":{"_id":null,"total":{"$sum":"$price"},"avg":{"$avg":"$price"},"lo":{"$min":"$price"},"hi":{"$max":"$price"},"skus":{"$push":"$sku"},"first":{"$first":"$sku"},"last":{"$last":"$sku"},"n":{"$count":{}}}}` gives `{"_id":null,"total":39.5,"avg":13.1666666667,"lo":7.5,"hi":"12","skus":["POT-1","POT-2","POT-3","POT-4"],"first":"POT-1","last":"POT-4","n":4}`.
  - After `$unwind:"$tags"`, `{"$group":{"_id":"$tags","n":{"$count":{}}}}` gives `blue` 1, `green` 1, `red` 2, in that order.
- `$sort` over E with `{"price":-1}` gives E3, E4, E1, E2. `$limit: 2` keeps the first two. `$skip: 1` drops the first.
- `$count: "<name>"` gives one document `{"<name>":N}`, and no document when its input is empty. The name must be non-empty, without `$` at the start and without `.`, otherwise `invalid_stage`.
- Pin: a document survives a stage when some output document came from it. `$unwind` keeps the source. A `$group` or `$count` output counts as coming from every input in it. `stopped_at` is the first enabled stage after which no output came from the pinned document, and null when it reaches the end.

**Pipeline draft**
- Each person has one draft per collection, holding the stage texts and disabled positions.
- The latest save wins as a whole. Another tab of the same person shows it when that screen next opens or reloads.
- A reader's draft is their own and never visible to others.

**Number and date display** (list, table, JSON view, stage previews, schema percentages and every count)
- Numbers with no fractional part show as whole numbers with no decimal point and no separators.
- Other numbers are rounded half away from zero to 6 significant digits, with trailing zeros removed, in plain decimal notation.
- Examples: `1234567` shows `1234567`; `3.14159265` shows `3.14159`; `0.000123456789` shows `0.000123457`; `2.50` shows `2.5`; `2.0` shows `2`; `13.1666666667` shows `13.1667`; `1234567.891` shows `1234570`; `-0.5` shows `-0.5`.
- In list and table, dates show as their `YYYY-MM-DDTHH:MM:SSZ` text (with milliseconds when stored), strings show without quotes, and objects and arrays show as compact JSON with numbers under this rule. The JSON view shows dates as `{"$date":"..."}`.

**Indexes**
- Each key is 1 or -1, in the order given. The default name joins each key and direction with `_`, as in `sku_1` and `a_1_b_-1`. Every collection has the unique index `_id_` on `_id`.
- A missing field is indexed as null. An array field is indexed by each element, and an empty array as null.
- Under a unique index, no two documents may share a key value (a compound index uses the tuple of values). So only one document may lack the field. A write that would break this gives `duplicate_key`, reporting the first conflicting value. For an array, that is the first conflicting element in array order.
- When two writes race for one value, exactly one succeeds and the other gets `duplicate_key`.
- Creating a unique index over existing duplicates gives `duplicate_key`, and no index is created. The documents are scanned in `_id` order, and the reported value is that of the first document whose key value already appeared in an earlier document. For example, with key values 5, 7, 7, 5 in `_id` order, the reported value is 7.

**Validation**
- Shape: `{"required":["path",...],"properties":{"path":{"bsonType":"string"|"number"|"int"|"boolean"|"null"|"object"|"array"|"date","minimum":n,"maximum":n,"enum":[...]}}}`. Every part is optional, paths are dot paths through nested objects, and anything else gives `invalid_validator`.
- Validation applies to inserts, edits and file loads, and never to documents already stored.
- Check order: required paths in listed order, then properties by path ascending, and within a property `bsonType`, `minimum`, `maximum`, `enum`. The first failure gives `validation_failed`.
- A required path is present when it holds any value, null included. A path through an array counts as absent. Property rules apply only where the path is present. `int` means a number with no fractional part. `minimum` and `maximum` are inclusive and apply to numbers only. `enum` uses filter equality.

**Schema summary**
- It reads the first `JARFUL_SCHEMA_SAMPLE` documents in `_id` order, and is computed each time the Schema screen opens.
- Paths descend into nested objects (`a.b`). Arrays are reported as type `array` and not descended. Rows are ordered by path in code-unit order.
- `present` is documents having the path ÷ sampled documents. Each `share` is documents with that type at the path ÷ documents having the path. Both are whole percents rounded half up. Types within a row are ordered by share descending, then by name.
- Type names: string, number, boolean, null, object, array, date.
- Worked over E: `_id` present 100 (string 100), `made` 25 (date 100), `note` 50 (null 50, string 50), `price` 100 (number 75, string 25).

**Edits and the live feed**
- A save carries the version the editor loaded. A different stored version gives `version_conflict`. Of two simultaneous saves with the same version, exactly one succeeds.
- Overwrite resends the draft with `current_version` and succeeds with the next version, unless the document changed again.
- Each collection has a change sequence that starts at 1 and rises by 1 for every insert, edit and delete, in commit order, with no gaps. A file load's documents get consecutive numbers in line order.
- Resuming after sequence s delivers every change above s, once and in order. The whole history of a collection is kept while the collection exists.

**Roles and membership**
- The owner (the project's creator) does everything. Editors write documents, saved queries, file loads and their own drafts. Readers browse, query, aggregate, run saved queries and download.
- Owner-only actions: members, invitations, collections, indexes, validators and deleting the project.
- Roles are read on every request, so a change applies to the very next request, including the event stream's role event.
- Removing a member makes that person's next request `not_found`.

**Invitations**
- An invitation is `pending` until it becomes `accepted` (by the invited address) or `revoked` (by the owner). Accepting or revoking anything other than a pending invitation gives `invitation_closed`.
- Accepting adds the person with the invitation's role. Addresses are matched lowercased.
- Sign-up codes are six digits. Only the latest code for an address works, and it works until it is used.

**Files**
- State machine of a load: uploading → stored → parsing → finished, or uploading → refused when storage is unreachable. Nothing else is legal.
- Parsing starts only after storage confirms it holds the exact uploaded bytes.
- A load is all or nothing. Lines are numbered from 1 by physical line, counting the CSV header and blank lines. Data lines are the non-blank lines, without the CSV header. A CSV record that spans several physical lines through a quoted line break is numbered by its first physical line and counts as one data line, and the next record's number continues from the physical line after it. A blank physical line outside quotes is skipped.
- More than `JARFUL_IMPORT_MAX_LINES` data lines gives `too_many_lines`, and nothing else is checked. The limit itself is allowed.
- Otherwise every data line is checked: parsing, then the document check order, then unique indexes against stored documents and earlier lines of the same file. Each failing line gives one error, its first failure. Any error gives `import_failed` with up to 20 errors in line order, and nothing is added.
- The load record keeps `inserted` and the same errors. `inserted` always equals the documents actually added.
- JSON lines: each non-blank line is one JSON object, otherwise `not valid JSON` or `not an object`. Lines end at LF, and a trailing CR is removed.
- CSV: a header row is required (`missing header row`) and standard CSV quoting applies (quoted fields may hold commas, quotes written twice and line breaks).
  - A header `a.b` builds a nested field. A repeated header gives `duplicate header`. A header that is a prefix path of another gives `conflicting header`. Header errors are on line 1.
  - Each row needs as many cells as the header.
  - Cell types: an empty cell leaves the field out; `true` and `false` are booleans; `null` is null; text matching `-?\d+(\.\d+)?` is a number; text of the form `YYYY-MM-DDTHH:MM:SSZ` is a date; anything else is a string. Quoting does not change this.
  - A leading UTF-8 byte order mark is ignored for parsing.
- Files are UTF-8.
- Downloads hold every document matching the given filter and sort, never just one page.
  - JSON lines: one compact document per line, with LF endings and a final LF.
  - CSV: CRLF line endings and standard quoting. Columns are the code-unit-sorted union of the documents' scalar leaf paths, descending into objects. Arrays and empty objects are leaves, written as compact JSON. Missing values are empty, null is `null`, booleans are `true` and `false`, numbers are their JSON text under the number-text rule in Documents, and dates are their text.
  - Every CSV cell, header included, whose text starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading `'`, except cells holding a number value.
- Saved queries record the server time and `matched` of their last run through the run route. The list shows them whenever it opens.

**Projects and collections**
- Creating a project makes the creator its owner and creates its first collection.
- Deleting a project or collection removes everything in it.
- Every count shown (rail, project home, the collection route's `count`, and Query status after an empty-filter run with no limit that is not refused) is the stored document count at the time of the request.

### Services (DP-35, DP-54, DP-59, DP-62, DP-69, DP-73, DP-74, DP-76)

- **PostgreSQL** is the system of record for accounts, sessions, codes, projects, memberships, invitations, collections, documents with their versions, indexes, validators, drafts, saved queries, load and download records, and each collection's change sequence. Unique indexes are enforced by real database constraints, so the rule holds across simultaneous requests and several app processes. Apply the schema idempotently every time the server starts.
- **MinIO** holds every uploaded file at key `imports/<import id>` and every download at `exports/<export id>.<jsonl|csv>`, in bucket `S3_BUCKET`, byte for byte. Create the bucket at start if it is missing.
  - Upload: the 201 or `import_failed` answer comes only after the store succeeds.
  - Download: the export answer comes only after the file is stored, and the download route serves the stored bytes.
  - When storage is unreachable, every file route (load, original, export create and export download) answers `storage_unavailable`, a refused load is recorded with state `refused`, and the banner shows. Browsing, editing, queries, pipelines, indexes, schema and members keep working.
- **Mailpit** receives mail over SMTP from the `MAIL_FROM` address, which is `Jarful <hello@jarful.test>`.
  - Sign-up: one message to the address with subject `Your Jarful code` and the body line `Your code is <six digits>`.
  - Invitation: one message to the invited address with subject `You're invited to <project> on Jarful`, the body line `<inviter name> invited you to <project> as <role>.` (role `editor` or `reader`), and a link to `<APP_PUBLIC_URL>/invites`.
  - If mail cannot be sent, the invitation still exists and the published copy still holds.

### Seed data (DP-85, DP-93)

The database starts empty. Tests create people and data through the grading route. The only built-in data is the houseplant sample, generated identically on every start and never stored as a project. Every seeded person and business is invented.

The houseplant sample has 1240 documents, for i = 1 to 1240:
- `_id`: i written in lowercase hex, left-padded with zeros to 24 characters.
- `name`: `Plant <i>`.
- `family`: `["Araceae","Cactaceae","Marantaceae","Moraceae","Asparagaceae"][i mod 5]`.
- `light`: `["low","medium","bright"][i mod 3]`.
- `water_days`: 3 + (i mod 12).
- `pots`: the first (i mod 4) values of `[12,15,18]`.

The sample pipeline is `[{"$match":{"light":"bright"}},{"$unwind":"$pots"},{"$group":{"_id":"$family","pots":{"$count":{}}}},{"$sort":{"pots":-1,"_id":1}}]`. For example, its input is 1240 and its stage counts are 413, 620, 5 and 5.

## Technical requirements

### Deployment (DP-84)

- The runtime is Node.js 22 LTS with npm. `/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, for example:
  `{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}`
- The server listens on `0.0.0.0`, on port `APP_PUBLIC_PORT` when it is set, otherwise `PORT`, otherwise 4173.
- `GET /api/health` answers 200 `{"status":"ok"}`. When object storage is unreachable it still answers 200, with `{"status":"unavailable"}`, never 503. Health checks storage with a time limit of 2 seconds.
- Until the database is reachable, health answers 503 `{"status":"starting"}`.

### Configuration and secrets (DP-89)

Read at start, never hard-coded and never sent to the browser:
- Database: `DATABASE_URL`.
- Storage: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
- Mail: `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`.
- The public base for links: `APP_PUBLIC_URL`.
- The grading key: `GRADING_KEY`. Without it, the grading route is always `not_found`.

| Variable | Meaning | Default |
|---|---|---|
| `JARFUL_MAX_DOC_BYTES` | largest document in bytes | 16384 |
| `JARFUL_MAX_DEPTH` | deepest document nesting | 20 |
| `JARFUL_SCAN_LIMIT` | most documents one run may examine | 10000 |
| `JARFUL_PAGE_SIZE` | documents per results page | 20 |
| `JARFUL_IMPORT_MAX_LINES` | most data lines in one load | 5000 |
| `JARFUL_SCHEMA_SAMPLE` | documents the schema summary reads | 1000 |
| `JARFUL_PREVIEW_DOCS` | documents in each stage preview | 5 |
| `JARFUL_MAX_STAGES` | most stages in one pipeline | 20 |

### Server boundary (DP-79, DP-88)

- Same-origin only: no cross-origin headers and no cross-origin requests from the browser. Sessions are an HTTP-only, SameSite=Lax cookie.
- Requests that change data and carry a body, other than file loads, must send `Content-Type: application/json`, otherwise 415 `{"error":"unsupported_media_type"}`. Requests with no body (for example deleting a document or project, signing out and accepting an invitation) need no content type.
- Body limits, each inclusive: 1,000,000 bytes for JSON bodies, 10,000,000 bytes for the grading route, and 5,000,000 bytes for file loads. Larger bodies get 413 `{"error":"too_large","limit":<bytes>}`.
- The server serves only the built browser assets and the API. Source files, the manifest, package files, environment files and credentials are never served, and such paths answer 404.
- If storage or mail is unreachable at boot, the server still starts.

### Browser support and performance (DP-90)

- The current Chromium, Firefox and WebKit, at 375x812, 768x1024 and 1280x800, with touch on phones.
- Every screen is usable within three seconds of navigation with the local services, and query results appear within one second of Run for collections within the limits.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, and nothing else is needed to start the app.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and every bundled font, each with its licence.
- IF-03: Every shipped package and bundled font uses one of MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0 or OFL-1.1.
- IF-04: Data lives only in PostgreSQL and MinIO: no SQLite, no file-based database, no extra cache or queue service.
- IF-05: The provided service configuration and dev credentials stay as provided.
- IF-06: The browser loads nothing from another origin: fonts, icons, scripts and styles are bundled.
- IF-07: Application source is TypeScript, and the npm lockfile is committed.

## Engineering standards

- TypeScript is compiled with strict checks, and domain code has no `any` and no non-null assertions used to silence the compiler.
- Names in the code match this brief's terms: project, collection, document, version, filter, stage, index, validator, saved query, invitation, file load, download.
- Each domain rule (the comparison order, filter matching, the number display rule, the validation check order, the error order, the invitation states, the index choice) is decided in exactly one place in the source.
- Every API error is produced through one path into the one published error shape.
- SQL is parameterised, and user values are never pasted into SQL text.
- There is no abstraction with a single implementation, and no defensive check for a state that cannot happen.
- There is no dead, commented-out or unreachable code, and no feature beyond this brief.
