# Pinewick Labs Joinery

Joinery is a schema design studio where the text comes first. You write tables in Mortise, a small text language. As you type, an entity diagram builds itself next to the text. When you draw a link on the diagram, Joinery types the matching line back into the text and leaves every other character as it was. Joinery exports PostgreSQL or MySQL DDL that is identical byte for byte each time, and it imports existing DDL with a report of how each statement was handled. Each project keeps numbered versions. The owner can hand out view or edit links and take them back at any time, and several people can edit the same schema live. Joinery is built for indie developers, students, analysts and freelancers who design relational schemas alone. The server uses three backend services. PostgreSQL holds accounts, projects, the server-ordered edit log, versions, shares and memberships, and it is the source of truth for text and layout. MinIO object storage holds exported DDL files and the original bytes of imported DDL. Mailpit receives sign-in codes and share invitations. One app server process handles presence, cursors and the fan-out of edits to other people, over its own WebSocket. The following are out of scope: AI schema generation (the starter templates panel is a fixed template matcher), third-party sign-in, passwords, paid plans, connecting to anyone's live database, image or SVG export, fonts or scripts loaded from other origins, and any datastore, cache or queue beyond the three services named here.

## Problem and users

Today, people who design schemas work in two halves that don't fit together. Drag-and-drop diagram canvases hide the schema in canvas state that cannot be diffed, reviewed or versioned. Text-first tools draw the picture but fail in three ways:

- A relationship drawn on the canvas is not written back into the text, or the write-back reformats the file and loses the author's comments.
- Parser errors point at the wrong place.
- Exporting to a second dialect silently drops enum, index, identifier-length or type differences.

The results are hand-rewritten migrations, stale screenshots pasted into pull requests, and review links that nobody can edit or safely revoke. Individuals carry this cost. Freelancers and solo builders do the rework themselves, with no team admin or data-modelling department behind them.

- **Schema owner** (daily): writes a schema in Mortise, shapes the diagram, exports PostgreSQL or MySQL DDL and keeps numbered versions on their own dashboard.
- **Invited editor** (weekly): opens an edit link or an emailed invitation and changes the same schema live alongside the owner.
- **Link viewer** (occasional): reads a shared diagram and its text without an account and cannot change anything.
- **Migrating importer** (occasional): brings existing DDL in, sees which statements were understood, merged or skipped, and gets a clean diagram.

## Journeys

1. **Type a schema.** A signed-in owner has an empty project. Using only the keyboard, they type two entities and a link. Each entity appears on the diagram when its closing brace is typed, and the link connector appears when its line is complete. They reload the page and find the project on the dashboard with the same text and diagram.
2. **Shape the diagram.** The owner of a project with four entities moves one entity with the arrow keys, groups two entities, colours one, and draws a link by dragging from one column to another. The text gains exactly one link line and one group block. Moving and colouring leave the text untouched, and everything survives a reload.
3. **Export DDL.** The owner opens the export panel, watches the PostgreSQL preview follow their typing, saves a PostgreSQL export and then a MySQL export, and downloads each file. Both files sit in object storage, and the MySQL file lists every lossy lowering as a note.
4. **Import legacy DDL.** A migrating importer pastes a PostgreSQL dump into an existing project. One unsupported statement stops the import with an exact line-and-column message and changes nothing. They remove that statement and import again. The report marks each statement added, merged or skipped, the diagram shows the merged entities without duplicates, and the original DDL can be downloaded byte for byte.
5. **Share and take back.** The owner creates a view link and an emailed edit link. The invited editor joins and edits live. A link viewer watches the changes on a read-only page. The owner downgrades the editor, whose next keystroke is refused and whose session turns read-only. The owner then turns off the view link: the open viewer sees a notice, and on reload they get the not-found page.
6. **Keep and restore versions.** The owner saves named versions and compares two of them. They restore an earlier one, which brings back its text, positions and colours as a new numbered version. A co-editor sees the restored text appear without reloading.
7. **Read on a phone.** A link viewer opens a shared diagram on a phone, switches between the Text and Diagram tabs, pans with one finger, pinch-zooms within the limits, and taps an entity to read its columns. With reduced motion turned on, entities appear in place with no animation.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Entities and columns in Mortise** Build the Mortise language so that entity blocks with typed columns and the published column settings parse into the model the diagram shows.
- **DP-02 — Diagram DOM contract** Render every entity, column and link with the published data attributes, roles and accessible names, and place each new entity in the next free grid cell by the published rule.
- **DP-03 — Editor keyboard rules** In the schema text editor, Tab inserts two spaces, Shift+Tab removes up to two leading spaces, Escape lets the next Tab move focus to the diagram, and the save shortcut opens the save-version dialog.
- **DP-04 — Live in-place updates** Typing updates the diagram, the error list and the DDL preview in place within the published parse delay, with no reload, no submit button and no lost caret or selection.
- **DP-05 — Entity entrance motion** An entity that appears after a parse fades and grows into place within the published range while its rows fill in one after another, and under reduced motion it appears in place at once.
- **DP-06 — Hero type-to-table demo** The landing page sample editor types the published sample once when it comes into view, building three linked entities in about six seconds before handing over to live editing, and under reduced motion it shows the final state at once.
- **DP-07 — Projects autosave and survive reload** An owner's typed schema is saved by the server without a save button, and after a reload and from the dashboard the same text and diagram are back.
- **DP-08 — Error format and messages** Every language error uses the published line-and-column format and the published message list, the same way in the editor, the check API and the import API.
- **DP-09 — Error order, cap and gutter markers** The error list shows errors sorted by line then column, at most 20 followed by a count of the rest, and every line with an error carries a gutter marker named after its line and message.
- **DP-10 — Last valid diagram while the text has errors** While the text has errors, the diagram keeps its last valid parse under the published out-of-date banner, and the banner and the error list clear within the parse delay once the text is valid.
- **DP-11 — Editor status announcements** After each parse, the editor status live region announces the error count and the first error's line and column in the published copy.
- **DP-12 — Published parser limits** Text over the byte limit, schemas over the entity or statement limits, and DDL over the statement or nesting limits stop with the published error inside the published time budget instead of hanging.
- **DP-13 — Choices** Choice blocks define enums that columns can use as types, defaults are checked against the choice's values, and duplicate values are reported.
- **DP-14 — Composite keys and indexes** Several key columns form one composite primary key and index lines form plain or unique indexes; both show in each column's key marker, and indexes naming a missing column are reported.
- **DP-15 — Diagram outline** A visually hidden diagram outline lists every choice, entity, link and group in text order, using the published item names for screen readers.
- **DP-16 — Links and cardinalities** Link lines and inline link settings join two columns with one of four cardinality tokens and show as connectors carrying the published cardinality value.
- **DP-17 — Canonical text** Everything Joinery writes into the text (drawn links, groups, renames through the diagram, imports and templates) follows the published canonical printing rules.
- **DP-18 — Drawn links write back one line** Dragging from a column handle to another column inserts exactly one canonical many-to-one link line after the owning entity's block and its existing link lines, and leaves every other byte unchanged.
- **DP-19 — Keyboard link drawing** A keyboard user starts a link on a focused column with L, chooses the target with arrow keys or Tab, and completes with Enter or cancels with Escape, and each step is announced in the published copy.
- **DP-20 — Write-back and connector motion** A written-back link line is typed in at the published rate while the new connector draws itself and its endpoint rows flash; under reduced motion the line appears in one step and the rows are highlighted without animation.
- **DP-21 — Moving entities never changes the text** Arrow keys move a focused entity one grid step (five with Shift) and pointer drags snap to the grid; positions are saved in the layout, survive reload and never change the text.
- **DP-22 — Groups** Grouping selected ungrouped entities writes one canonical group block at the end of the text with the chosen group colour, and ungrouping removes exactly that block.
- **DP-23 — Layout-only colours** Entity and group colours come from the published list of six names, are stored only in the layout and never change the text.
- **DP-24 — Renaming entities** Renaming through the diagram rewrites the entity's name and every reference to it and keeps its position, while renaming in the text gives the new name the next free cell.
- **DP-25 — Arrange** The arrange action moves every entity to the published grid cells in text order, gliding there within the published range, or jumping there under reduced motion.
- **DP-26 — PostgreSQL export** PostgreSQL export follows the published statement shapes, quoting, type mapping, enum types, and constraint and index names.
- **DP-27 — MySQL export and reported lowering** MySQL export follows the published statement shapes, quoting and type mapping, and records every lossy lowering, including identifiers shortened to fit the dialect's limit, as a note in the file.
- **DP-28 — Export order and determinism** Exports order tables by dependency with ties broken by name and break cycles with ALTER TABLE statements, and identical text always gives byte-identical files.
- **DP-29 — Exports confirmed in storage** An export becomes downloadable, and its Download link appears, only after object storage confirms the file under the published key; the download then works through the app until the published lifetime ends.
- **DP-30 — Storage outage** While object storage is down, editing keeps saving, exports and imports answer the published 503 with the diagram-is-safe copy, health and the status strip report the outage, and everything recovers without a restart once storage returns.
- **DP-31 — Supported DDL subset** Import accepts the published subset of PostgreSQL and MySQL statements, rejects everything else with published messages in the shared line-and-column format, and changes nothing on rejection.
- **DP-32 — Merge by table name** A merge import matches tables by exact name, replaces matched entities, adds new ones and reports every statement as added, merged, skipped or ambiguous, and repeating the import changes nothing.
- **DP-33 — Original DDL kept as submitted** Every successful import stores the submitted DDL byte for byte in object storage, and the owner can download exactly those bytes again.
- **DP-34 — Export and import round trip** Importing Joinery's own export of a schema gives back the same model for every construct, apart from the lossy lowerings that the export's notes report.
- **DP-35 — Numbered versions** Saving a named version snapshots the text and layout under the next gapless number, starting at 1, even when two saves arrive at the same moment.
- **DP-36 — Exact restore** Restoring version N brings back exactly its text, entity positions, and entity and group colours as a new numbered version, keeps every earlier version, and reaches everyone in the project live.
- **DP-37 — Version comparison** Comparing two versions lists the entities added, removed and changed between them in the published copy.
- **DP-38 — Share links and invitations** The owner creates view or edit links, optionally emailed through the mail provider, and an invitation is shown as sent only after the provider has accepted it.
- **DP-39 — View-only access** A view link or a viewer role shows the diagram and a read-only editor with edit controls hidden, and every write from such a caller is refused with the published 403.
- **DP-40 — Rotating, turning off and expiry** When a link is rotated, turned off or reaches its expiry instant on the server clock, the old URL immediately answers the generic not-found response, and anyone viewing through it sees the published notice.
- **DP-41 — Immediate role changes** Downgrading an editor to viewer or removing them takes effect on their next request, and their open session turns read-only or closes within the live delay.
- **DP-42 — Invitations during a mail outage** When mail is down, a newly created link still works and its invitation shows as failed in the published copy; sending again succeeds once mail is back, without a restart.
- **DP-43 — Live edits between people** An edit accepted from one person appears in every other open copy, in both text and diagram, within the published live delay, without a reload and without moving anyone's caret.
- **DP-44 — Presence** People who have the project open appear as presence chips with the published names, and a person who leaves disappears within the presence timeout.
- **DP-45 — Server order decides concurrent edits** The server applies edits in arrival order and merges an edit with an older base when the entity blocks it changed have not changed since; otherwise it refuses the edit with the published 409, so every client converges on the server text.
- **DP-46 — Conflict notice** A person whose edit was refused sees the published conflict alert naming the other person and the entity, and their editor shows the server text.
- **DP-47 — Published breakpoints** The phone, tablet and desktop workspace layouts appear exactly at the published viewport ranges, and no published viewport overflows sideways.
- **DP-48 — Touch pan, pinch and tap** On touch screens one finger pans the diagram, two fingers pinch-zoom within the published limits shown in the zoom status, and tapping an entity opens its detail sheet.
- **DP-49 — Reduced motion** With reduced motion requested, every entrance, glide, typed write-back, connector draw and flash shows its end state at once and works the same way, and no animation loops anywhere.
- **DP-50 — Sign-in with an emailed code** A person signs up or signs in with a six-digit code emailed through the mail provider; the code works once and expires after the published lifetime.
- **DP-51 — Dashboard** A signed-in person creates, opens and renames projects from the dashboard, which shows the published empty state when they have no projects and keeps projects across reloads.
- **DP-52 — Not found means not found** Any project, share, version, export or import the caller cannot open answers with the same not-found response and page as a missing one.
- **DP-53 — Run manifest and health** The app installs, builds and serves from the run manifest on the published port, and the health route answers as published.
- **DP-54 — Grading setup route** A setup route guarded by the grading key creates users with sessions, and projects with text, layout, versions, members and shares, and returns their ids.
- **DP-55 — One error order and shape** Every API error uses the published JSON shape, and errors are checked in the published order.
- **DP-56 — Dialog and menu keyboard rules** Every dialog and menu keeps Tab and Shift+Tab inside itself, closes on Escape and returns focus to its opener, and published shortcuts work whichever control in their region has focus.
- **DP-57 — Published copy verbatim** Every string this brief prints in backticks is rendered and announced character for character.
- **DP-58 — Landing page** The landing page carries the pinned status strip, the dark nav with menus, the centred hero stack with its tally bubble and charcoal button, the working sample editor, the dialects strip, the alternating feature rows, the card grid and the import banner, all as described.
- **DP-59 — Visual language** Every screen uses the published palette roles, type, shapes and dark app-window islands on a white page, with AA contrast and comfortable tap targets.
- **DP-60 — Real services wiring** Credentials and URLs come only from the environment, provider-derived states come from real provider calls, and nothing fakes them in the browser or with a stub.

## Frontend

### Screens and layout (DP-06, DP-07, DP-47, DP-51, DP-52, DP-58)

Every screen keeps the **live studio status strip** pinned at the very top, with the **studio nav with menus** pinned directly below it. Both stay in place at every scroll position. Content sits in a centred container about 1000 pixels wide. The editor screen is the exception and runs full-bleed.

The published viewport ranges, which are the only layout switches for the workspace and the landing page:

- **Phone, narrower than 768 pixels (375x812 is checked):** a single column with comfortable side margins. The status strip wraps to two lines. The nav shows the wordmark and a menu button.
- **Tablet, 768 to 1023 pixels (768x1024 is checked):** the full nav. Workspaces show the text pane above the diagram.
- **Desktop, 1024 pixels and wider (1280x800 is checked):** the full nav. Workspaces show the text pane on the left (about two fifths of the width) and the diagram on the right.

At none of the three checked sizes is the page wider than the viewport. Strips that hold more items than fit, such as the dialects strip and the editor toolbar on a phone, scroll sideways inside themselves.

**Landing page (`/`).** From top to bottom:

1. The **landing hero stack**, centred: a small muted credit line, the bold headline, the two-line muted subtitle, the **live project tally bubble** (a rounded card with a small downward pointer aimed at the button below it), and one **primary studio button**.
2. The **editor and diagram workspace** in its sample form, which is the real working editor. It is about 1000 pixels wide on desktop and runs past the bottom of the first screen. It has the **editor toolbar** across its top, the dark text pane on the left and the dark diagram on the right. On a phone, the text pane sits above the diagram inside the window, with no tabs.
3. The **supported dialects strip**: a muted heading over one row of text wordmarks that runs past both edges and scrolls sideways.
4. Four **alternating feature rows**. Each row pairs a text column with a dark illustration window, and the window switches sides from row to row. Below 1024 pixels the text comes first and the window sits under it.
5. The **feature card grid**: six outlined white cards, three per row on desktop, two on tablet and one on phone.
6. The **import DDL banner**: a pale-blue tinted panel with an eyebrow, a heading, a paragraph and a primary studio button. It stacks on a phone, where the button goes full width.
7. The keyboard guide and a footer.

The feature row windows are illustrations. They are hidden from assistive technology and carry none of the diagram data attributes. Only the sample editor in the hero is live.

**Sign-in (`/signin`).** A centred white card with the email field, the display name field and a send button. After the code is sent, it shows the code field and the sign-in button.

**Dashboard (`/projects`).** Two sections: your projects, then projects shared with you. Each project is a white outlined card with its name, the role badge (`Owner`, `Editor` or `Viewer`), the entity count and the time of last change. Cards sit in one column on a phone and two on tablet and desktop. When you have no projects of your own, an empty state replaces the first list. A `New project` button sits at the top right of the first section. The time shown is the project's last change in the business time zone, formatted as `YYYY-MM-DD HH:MM <zone>`, and it updates when the dashboard loads.

**Editor (`/projects/<project id>`).** This is the full-bleed **editor and diagram workspace**. Under the nav it has:

- The **editor toolbar**: a dark strip with button chips on the left; presence chips and the save state on the right; the blue Templates pill at the far right.
- The project name as the page heading.
- The workspace panes. On desktop the text pane is on the left, with the error area along its bottom, and the diagram is on the right, with the zoom controls floating in a white pill at the bottom centre of the diagram.
- The export panel, which docks over the right third of the diagram on desktop and fills the workspace on tablet and phone.
- The **starter templates panel**, which docks as a narrow dark column on the far left of the workspace on desktop and opens above the text pane on tablet and phone.

On a phone, the workspace becomes two tabs, Text and Diagram, with exactly one pane visible at a time. Owners and editors start on Text, and link viewers start on Diagram.

**Shared page (`/s/<token>`).**

- A view link shows the same editor screen without the editing toolbar chips, with a `View only` badge and a read-only text pane.
- An edit link opened by a signed-out person shows a sign-in card headed `Sign in to edit <project name>`. A signed-in person joins the project and is taken to the editor.

**Not-found page.** Every unknown or unavailable project or link URL renders the not-found page with HTTP status 404. The page has a centred badge, a heading, a single hint line and a link back to the dashboard. It never names a project.

### Public screens and controls (DP-02, DP-15, DP-39, DP-44, DP-56, DP-57)

Only the roles, names and attributes listed here are public. Everything else is free. Names are given as ARIA role plus accessible name. Placeholders in angle brackets are defined in Feedback states. Emoji shown after headings are decorative, sit in their own element hidden from assistive technology, and are not part of any published name or copy.

**Every page**

| Control or region | Visible copy and notes |
|---|---|
| `status "Studio status"` | The pinned strip: a white pill reading `Live`, then the strip message from Feedback states |
| `link "Skip to content"` | First Tab stop on every page |
| `navigation "Main"` | The dark nav |
| `link "Joinery home"` | Logo tile and wordmark `Joinery` |
| `button "Product"` → `menu "Product"` | Menu items (links): `Text language`, `Drawing links`, `Import DDL`, `Sharing and versions`; each has a one-line muted description |
| `button "Learn"` → `menu "Learn"` | Menu items (links): `Keyboard guide`, `Sample editor` |
| `link "Your projects"` / `link "Sign in"` | The white nav end button: the first when signed in, the second when signed out |
| `button "Sign out"` | Shown when signed in |
| `button "Menu"` → `dialog "Menu"` | Below 768 pixels only; a full-height sheet holding the same nav items |

**Landing page**

| Control or region | Visible copy |
|---|---|
| credit line | `A studio by Pinewick Labs` |
| `heading` level 1 | `Write the tables, join them, and watch the diagram keep up`, followed by the 🪚 emoji |
| subtitle, line one | `Joinery reads a small schema language as you type and draws the diagram beside it.` |
| subtitle, line two | `Draw a link on the diagram and the line appears in your text, ready for PostgreSQL or MySQL.` |
| `region "Project tally"` | `<projects> schemas drafted and <exports> DDL files exported in this studio`, plus a pill link `link "See the sample"` (followed by 👇) that scrolls to the sample editor |
| `link "Open the studio"` | The primary studio button; goes to the dashboard, or to sign-in when signed out |
| `region "Sample editor"` (anchor `#sample`) | Holds `textbox "Sample schema text"`, `region "Sample diagram"` (same DOM contract as the editor diagram) and `button "Reset sample"` |
| `region "Supported dialects"` | Heading `Ships to the dialects you deploy`; `list "Supported dialects and formats"` with items `PostgreSQL`, `MySQL`, `Mortise text`, `Plain-text diffs`, `Byte-exact exports`, `Original DDL kept`, `Numbered versions`, `Revocable links` |
| feature row 1 (anchor `#editor`) | `heading "Text first, diagram in step"` (🔁), `link "Try text-first editing"` |
| feature row 2 (anchor `#links`) | `heading "Draw a link, get a line of text"` (✏️), `link "Try drawing a link"` |
| feature row 3 (anchor `#import`) | `heading "Bring the DDL you already have"` (📥), `link "Try importing DDL"` |
| feature row 4 (anchor `#sharing`) | `heading "Share a link, take it back"` (🔗), `link "Try sharing a link"` |
| `region "Mortise at a glance"` (anchor `#language`) | Heading `Mortise at a glance` (🧩); six card headings: `Entities and columns`, `Choices for fixed values`, `Four kinds of link`, `Groups and colours`, `Exports you can diff`, `Versions you can restore` |
| `region "Import DDL banner"` | Eyebrow `Import · PostgreSQL or MySQL`, `heading "Already have CREATE TABLE statements? Bring them in."`, `link "Import DDL"` (primary studio button, to the dashboard) |
| `region "Keyboard guide"` (anchor `#keyboard`) | A table of the shortcuts in Interactions |
| footer | `Joinery is made by Pinewick Labs. Every name in the samples is invented.` |

All four feature row links go to the dashboard, or to sign-in when signed out.

**Sign-in page**

| Control | Copy |
|---|---|
| `textbox "Email"` | |
| `textbox "Display name"` | Needed only for a new email address |
| `button "Send code"` | |
| `textbox "Sign-in code"` | Appears after the code is sent |
| `button "Sign in"` | |
| `status "Sign-in status"` | |

**Dashboard**

| Control | Copy |
|---|---|
| `heading "Your projects"` | |
| `list "Projects"` | Each item is one card; `link "<project name>"` opens the project |
| `button "Rename <project name>"` → `dialog "Rename project"` | Holds `textbox "Project name"` and `button "Save name"` |
| `button "New project"` → `dialog "New project"` | Holds `textbox "Project name"`, `combobox "Start from"` (options `Empty`, `Library loans`, `Greenhouse beds`, `Recipe box`) and `button "Create project"` |
| empty state | Heading `No projects yet`; lines `Start a schema from scratch or from a starter template.` and `Projects people share with you show up here too.`; `button "Create your first project"` (opens the New project dialog) |
| `heading "Shared with you"`, `list "Shared projects"` | When empty, the line `Nothing shared with you yet.` |

**Editor screen** (the shared page uses the subset marked "view too")

| Control or region | Copy and notes |
|---|---|
| `heading` level 1 | The project name (view too) |
| `toolbar "Editor tools"` | Chips in this order: `button "Share"` (owner only), `button "Versions"` (view too), `button "Save version"`, `button "Import"`, `button "Export"` (has an expanded state), `button "Arrange"`, `button "Group selected"`, `button "Ungroup"`, `button "Colour"`, `button "Keyboard help"` (view too), `button "Templates"` (the blue pill, has a pressed state) |
| `list "People here"` | Presence chips (view too) |
| `status "Save state"` | Autosave state |
| `View only` badge | Shown instead of the edit chips for viewers |
| `tablist "Workspace"` | Below 768 pixels only: `tab "Text"`, `tab "Diagram"` (view too) |
| `textbox "Schema text"` | The text pane; carries `aria-readonly="true"` whenever the person cannot edit (view too) |
| `region "Errors"` | The red error bar showing the first error, and `list "Errors"`; each item is a button whose name is the error line |
| `status "Editor status"` | Parse announcements (view too) |
| `status "Diagram out of date"` | Banner over the diagram while the text has errors (view too) |
| `region "Diagram"` | Focusable canvas (view too) |
| `status "Zoom"`, `button "Zoom out"`, `button "Zoom in"` | Inside `region "Diagram"` (view too) |
| `status "Diagram announcements"` | Moves, selection, links, groups, colours, renames (view too) |
| `status "Studio announcements"` | Saves, exports, imports, shares, versions (view too) |
| `alert` | Conflict, outage and access notices (view too) |
| `list "Diagram outline"` | Visually hidden; in the accessibility tree (view too) |
| canvas empty state | Badge, heading `No entities yet`, lines `Type an entity in the text, or pick a starter template.` and `Everything a template adds stays editable.`, and the small blue `button "Add an entity"` |
| `region "Starter templates"` | `searchbox "Find a template"`, one entry per template with a bold title, a one-line description and `button "Use <template name>"` |
| `menu "Entity colour"` | Opened by Colour; holds `menuitemradio` items `Slate`, `Blue`, `Violet`, `Green`, `Amber`, `Red` |
| `region "Export DDL"` | `radiogroup "Dialect"` (`radio "PostgreSQL"`, `radio "MySQL"`), `region "DDL preview"`, `button "Save export"`, `link "Download <file name>"` (only once stored) |

**Dialogs**

| Dialog | Contents |
|---|---|
| `dialog "Save version"` | `textbox "Version name"`, `button "Save"` |
| `dialog "Versions"` | `list "Version history"` (items read `Version <n>: <version name>`, then `<time>` and `by <display name>`), `button "Restore version <n>"` per item (only for people who can edit), `combobox "From version"`, `combobox "To version"` (options `Version <n>`), `button "Compare versions"`, `region "Comparison"` |
| `alertdialog "Restore version <n>?"` | `button "Restore"`, `button "Cancel"` |
| `dialog "Share project"` | `radiogroup "Access"` (`radio "Can view"`, `radio "Can edit"`), `textbox "Invite by email (optional)"`, `button "Create link"`, `list "Links"` (described below), `list "People with access"` (described below), `button "Close"` |
| `dialog "Import DDL"` | `radiogroup "DDL dialect"` (`radio "PostgreSQL"`, `radio "MySQL"`), `radiogroup "Import mode"` (`radio "Merge by table name"`, `radio "Replace all text"`), `textbox "DDL to import"`, a file input labelled `SQL file`, `button "Import"`, `list "Import errors"`, `region "Import report"` holding `list "Import results"`, `list "Import notes"` and `link "Download original DDL"` |
| `dialog "Group entities"` | `textbox "Group name"`, `radiogroup "Group colour"` (radios `Slate`, `Blue`, `Violet`, `Green`, `Amber`, `Red`), `button "Create group"` |
| `dialog "Rename entity"` | `textbox "New name"`, `button "Rename"` |
| `dialog "Entity <entity>"` | The detail sheet: `list "Columns of <entity>"`, `list "Links of <entity>"`, `button "Rename entity"` (editors only), `button "Close"` |
| `dialog "Keyboard shortcuts"` | The shortcut table, `button "Close"` |
| `alertdialog "Replace the text?"` | `button "Replace text"`, `button "Cancel"` |

In `list "Links"`, each item shows `View link` or `Edit link`, the invitee email when there is one, the invitation state, and buttons `button "Copy <access> link"`, `button "Rotate <access> link"`, `button "Turn off <access> link"` and, after a failure, `button "Send again"`. When the list is empty it reads `No links yet.`

In `list "People with access"`, each item is named `<display name>, <role word>`. It holds `combobox "Access for <display name>"` (options `Can edit`, `Can view`) and `button "Remove <display name>"`.

**Not-found page:** heading `Nothing here`, the line `This link or project isn't available. It may have been turned off, or the address may be wrong.`, and `link "Go to your projects"`.

**Diagram DOM contract.** Both the editor diagram and the sample diagram follow this contract.

- **Entity:** an SVG group with these attributes:
  - `data-entity="<entity>"` (the name without quotes)
  - `data-x` and `data-y` (integers in grid units)
  - `data-group` (the group name, or empty)
  - `data-color` (one of the six colour names in lower case)
  - `data-selected` (`true` or `false`)
  - `data-motion` (`enter` while its entrance plays, `move` while it glides, and absent otherwise)
  - role `group`, focusable, named `Entity <entity>, <n> columns, <m> links`

  In the name, the words become `1 column` and `1 link` when the count is one. `<m>` counts links that touch the entity on either side, and a link from the entity to itself counts once.
- **Column list:** the columns sit inside `list "Columns of <entity>"`.
- **Column:** an element with these attributes:
  - `data-column="<entity>.<column>"`
  - `data-type` (the canonical type, or the choice name)
  - `data-key` (any of `primary`, `unique`, `foreign`, in that order and separated by spaces, or empty)
  - `data-flash="true"` while its endpoint flash plays

  Its role is `listitem`, named `<column> <type>` followed by `, primary key`, `, unique` and `, foreign key` for each marker that applies (in that order), then `, required` when the column is required and is not a key. Example: `author_id int, foreign key, required`.
  - `primary` marks a key column.
  - `unique` marks a column with the `unique` setting or a column that belongs to a unique index.
  - `foreign` marks the column on the foreign-key side of a link: the left column of `>-` and `--`, and the right column of `-<`. Many-to-many links mark neither side.
- **Column handle:** each column row carries a drag handle with `data-handle="<entity>.<column>"`.
- **Link:** an element with `data-link="<from entity>.<from column>-><to entity>.<to column>"`, written in the direction of the text, and `data-cardinality` set to one of `many-to-one`, `one-to-many`, `one-to-one` or `many-to-many`. While its line draws in, it carries `data-motion="draw"`. During a pointer drag, a preview line carries `data-preview="true"`.
- **Diagram outline:** `list "Diagram outline"` has one item per statement, in text order. An inline link is listed right after its entity.
  - Choices: `Choice <choice>: <value>, <value>`
  - Entities: the entity's accessible name
  - Links: `Link <from entity>.<from column> to <to entity>.<to column>, <cardinality words>`, where the words are `many to one`, `one to many`, `one to one` or `many to many`
  - Groups: `Group <group>: <entity>, <entity>`
- **Zoom:** `status "Zoom"` reads `Zoom <percent>%`.

**Presence chips.** `list "People here"` has one item per signed-in person, in the order they joined. Each item is named `<display name>`, except the viewer's own chip, which reads `<display name> (you)`. When any link viewers are present, a last item reads `<n> link viewers`, or `1 link viewer`.

### Interactions (DP-03, DP-04, DP-18, DP-19, DP-21, DP-22, DP-23, DP-24, DP-25, DP-48, DP-56)

**Editor typing.** The text pane is a code editor with a line-number gutter. While you type, Joinery parses the text after the parse delay of quiet typing (`JOINERY_PARSE_DELAY_MS`). Each parse then:

- updates the error list,
- updates the editor status and the out-of-date banner,
- updates the diagram and the outline from the last valid parse,
- updates the DDL preview when the export panel is open.

None of this reloads the page or moves the caret or selection. Edits are sent to the server after the same quiet delay, with at most one edit in flight at a time. After the server replies, the editor shows the server text, keeping the caret at the same line and column (clamped to the text).

**Editor keys.**

- Tab inserts two spaces at the caret.
- Shift+Tab removes up to two leading spaces from each selected line.
- Escape releases the editor, so that the next Tab moves focus to `region "Diagram"` and Shift+Tab moves it to the last toolbar chip.
- Ctrl+S (Cmd+S on macOS) opens `dialog "Save version"` from anywhere on the editor screen, whichever control has focus, and prevents the browser's own save. For people who cannot edit, it does nothing.

**Tab order on the editor screen:** skip link, nav, toolbar chips in order, `textbox "Schema text"`, `region "Diagram"`, entities in text order, `button "Zoom out"`, `button "Zoom in"`, the error buttons, then the export panel controls when the panel is open.

**Clicking an error.** Activating an error button in `list "Errors"` puts the caret at that error's line and column and focuses the editor.

**Diagram keys.** These work while focus is anywhere inside `region "Diagram"`:

| Key | Effect |
|---|---|
| Tab / Shift+Tab | Next or previous entity in text order; past the last entity, focus moves on to the zoom buttons |
| Arrow keys (entity focused) | Move the entity one grid step; Shift+arrow moves five steps |
| Arrow keys (Diagram region focused) | Pan by two grid steps |
| Space | Toggle the focused entity's selection |
| Enter (entity focused) | Enter the entity's column list and focus its first column |
| Up / Down (in a column list) | Previous or next column |
| Escape | Leave the column list (focus returns to the entity); a second Escape clears the selection |
| L (column focused) | Start a link from that column |
| I (entity focused) | Open `dialog "Entity <entity>"` |
| R (entity focused) | Open `dialog "Rename entity"` |
| G | Open `dialog "Group entities"` for the current selection |
| + / − / 0 | Zoom in, zoom out, reset to 100 percent |

The `+`, `−`, `0` and `G` keys work wherever focus is inside the Diagram region, including on an entity, a column or a zoom button. One grid step is 20 CSS pixels at 100 percent zoom, and positions stay between 0 and 500 grid units inclusive. A move that would go past a bound stops at it and is still announced.

**Moving with the pointer.** Pressing on an entity's header and dragging moves the entity. On release it snaps to the nearest grid step and the new layout is saved. Pressing on empty canvas and dragging pans the diagram. A click selects one entity alone, and Shift+click toggles an entity in the selection. Neither moving nor colouring ever changes the text.

**Drawing a link with the pointer.** Press on a column handle and drag. A preview line follows the pointer. Releasing over another column row asks the server to write the link line. Releasing anywhere else writes nothing and is announced as cancelled. Dropping on the starting column writes nothing and is announced in the same-column copy.

**Drawing a link with the keyboard.** Focus a column and press L. The start is announced.

- Up and Down move through the columns of the current entity.
- Tab and Shift+Tab jump to the first column of the next or previous entity in text order, wrapping at the ends.
- Each column that receives focus is announced as the target.
- Enter completes the link.
- Escape cancels, writes nothing, and is announced.

Drawing links, grouping and renaming through the diagram are refused while the text has errors. Each refusal is announced with the API's message.

**Grouping.**

1. Select one or more entities that are not yet grouped.
2. Activate `Group selected`, or press G. The button is disabled unless at least one entity is selected and none of the selected entities is grouped.
3. Enter a name, pick a colour, and confirm with `Create group`.

The group block is written to the text, and the group shows as a translucent region in its colour, with a solid header strip carrying its name. `Ungroup`, with a grouped entity focused or selected, removes that entity's whole group.

**Colour.** `Colour` opens `menu "Entity colour"`. Choosing an item recolours every selected entity, or the focused entity when nothing is selected.

**Rename through the diagram.** Rename opens `dialog "Rename entity"`. Confirming rewrites the name and its references and keeps the entity in place.

**Arrange.** `Arrange` sends every entity to its published grid cell.

**Zoom.**

- `Zoom in` and `Zoom out` step to the next multiple of 25 percent, between 25 and 200 percent. Each button is disabled at its limit.
- Ctrl+wheel and pinch zoom continuously, rounded to whole percents and clamped to the same limits.
- Zoom and pan are per screen and are never saved.

**Touch.**

- One finger dragging anywhere pans the diagram, except when it starts on a column handle, which draws a link.
- Two fingers pinch-zoom around their midpoint.
- A tap on an entity opens its detail sheet. On a phone, the sheet rises from the bottom and covers about the lower two thirds of the screen.
- Panning and zooming follow the fingers directly, with no glide after release.
- Link viewers can pan, pinch and tap. The detail sheet hides Rename for them.

**Templates.** The `Templates` pill toggles the starter templates panel. Typing in `Find a template` filters the entries immediately, with no submit. A template matches when the trimmed query, ignoring letter case, is part of its name or one of its keywords; an empty query shows all three. Enter in the search box applies the first match. `Use <template name>` replaces the text with the template text. When the text is not empty, Joinery first asks with `alertdialog "Replace the text?"`. `Add an entity` inserts the published starter entity.

**Phone tabs.** Arrow keys move between the Text and Diagram tabs, and selecting a tab shows its pane.

**Dialogs, sheets and menus.**

- Opening one moves focus to its first field, or to its first control when it has no field.
- Tab from the last control wraps to the first, and Shift+Tab from the first wraps to the last. Focus never leaves an open dialog, sheet or menu.
- Escape closes it, and focus returns to the control that opened it.
- Menus move between items with Up and Down, and Enter or Space chooses.
- The nav menus open on click, on Enter or on Space, and close on Escape or on a click outside.

**Hero sample editor.** The sample editor accepts typing and pointer and keyboard moves like the real editor, but it never saves. `Reset sample` puts the published sample text back. Clicking or typing in it while the demo plays ends the demo at once, showing the final text, and then the keystroke applies.

### Visual design (DP-58, DP-59)

The design direction is `seed`: a bright white page with a pinned blue strip, friendly rounded shapes, and dark editor windows framed like desktop apps as the only dark surfaces.

**Type.** Noto Sans is used for all interface text, headings included. JetBrains Mono is used for the text pane, the DDL preview, error lines and column types on the diagram. Both are self-hosted. Headings are bold and in sentence case, and some end in a single decorative emoji. Each step up the heading scale is about an eighth larger than the step below, so the hero headline is about twice the body size and card titles are about a quarter larger than body text. Body text is roomy, with generous line spacing. Muted text is used for subtitles and card bodies. Eyebrows are small, semibold, in sentence case and in the bright accent blue, never spaced-out capitals.

**Colour roles.**

- **Ground:** plain white behind every page.
- **Ink:** soft charcoal for headings and body text.
- **Muted ink:** cool mid-grey for subtitles, card bodies and hints.
- **Chrome:** near-black for the nav bar.
- **Button fill:** charcoal grey for primary studio buttons, with white text.
- **Deep accent:** deep cobalt for the full-width status strip, with white text.
- **Accent:** bright blue for text links (which end in a small chevron), eyebrows, focus rings, the Templates pill, small `+` buttons, the zoom slider, link-drawing previews and endpoint flashes.
- **Editor pane:** almost-black behind the text pane.
- **Dark canvas:** dark slate behind the diagram.
- **Toolbar:** dark graphite for the editor toolbar strip, whose chips lighten on hover.
- **Tinted panel:** very pale blue with a light blue edge, used for the import DDL banner and the outage banners.
- **Card border:** light grey thin outlines on white cards.
- **Error:** bright red for the error bar along the bottom of the text pane and for gutter markers.

Entity header strips and group regions use the six layout colours: slate, blue, violet, green, amber and red. Groups are drawn as translucent fills with a solid header strip in the same hue.

**Shapes and density.** Comfortable density. Cards are white with a thin outline and softly rounded corners. Buttons have small, crisp corner rounding. Editor and diagram windows have softly rounded corners and a soft drop shadow. The tally bubble is a rounded card with a small pointer. The zoom controls sit in a fully rounded white pill.

**Composition.** The landing composition is a pinned blue strip over the dark nav, the centred hero stack, the 1000-pixel live window running past the fold, then alternating text-and-window feature rows and a three-by-two outlined card grid. The working screens use the same language:

- The dashboard is a list of white outlined cards.
- The share dialog, version list, import report and export panel are white cards and dialogs with charcoal primary buttons and blue chevron links.
- Empty states reuse the centred badge, heading, two hint lines and small blue `+` button.
- Errors use the red bar along the bottom of the text pane, showing line and column.
- Outage banners use the tinted panel.

**Accessibility.** All text meets WCAG 2.2 AA contrast against its background. That includes white on the cobalt strip and white on the red error bar, where the error text is bold. Focus is always visible as a blue ring offset from the control. At 375 and 768 pixels, every control has a touch area at least 44 by 44 pixels. At 1280 pixels, every control is at least 24 by 24 pixels.

### Motion and effects (DP-05, DP-06, DP-20, DP-25, DP-49)

Motion only explains change. It starts quickly and settles softly. Every motion listed here runs as a browser animation or transition, so the browser's list of running animations shows it while it plays.

**Hover and press feedback.**

- Links, nav items, pills and toolbar chips change colour in about a seventh of a second. A link's chevron slides slightly right, and an underline appears.
- Primary studio buttons darken and gain a soft shadow in about a third of a second, and sink slightly while pressed.
- Feature cards lift with a soft shadow in about a third of a second. On phones the shadow shows by default.
- Nav menus and toolbar menus fade in while rising slightly, in about a seventh of a second, and the menu caret flips.
- The dialect wordmarks go from grey to full ink in about a third of a second.

**Entity entrance.**

1. When a parse adds an entity, its node fades in from transparent while growing from 96 percent of its size to full size. This lasts 250 to 350 milliseconds, with `data-motion="enter"` set until it ends.
2. Its column rows appear one after another, 40 milliseconds apart.

Entities added by other people's edits enter the same way.

**Connector draw.** When a link line becomes valid, its connector draws itself from the starting column to the target column. Connectors are orthogonal lines with small end markers. The draw takes 350 to 450 milliseconds, with `data-motion="draw"` on the link. Both endpoint rows then flash a light tint of the accent blue for 550 to 650 milliseconds, with `data-flash="true"`.

**Write-back typing.** When a drawn link is accepted:

1. The link line is typed into the editor at the insertion point at 35 milliseconds per character. The editor is read-only while it types.
2. When the last character lands, the caret settles at the end of the line, the connector draws, and the endpoint rows flash.

The write-back is complete only when the whole line is present.

**Arrange glide.** Entities glide from their old cells to their new cells in 300 to 400 milliseconds, with `data-motion="move"`. Connectors follow during the glide.

**Hero demo (the type-to-table cascade).** When at least a quarter of the sample editor is in view:

1. The caret blinks three times and then stays solid.
2. The editor starts with the published sample's text up to and including its first link line. The diagram shows the two entities and their connector.
3. The editor types the rest of the sample at 35 milliseconds per character, pausing 300 milliseconds at the end of each line.
4. When the closing brace of the third entity is typed, that entity enters.
5. When the final link line completes, its connector draws and its endpoints flash.

The demo ends 5 to 7 seconds after it starts, with three entities and two connectors, and the sample editor is then live. It plays once per page load. It never replays or reverses when you scroll away and back.

**Dialogs and sheets.** These fade in within a fifth of a second. Phone sheets rise from the bottom in about a quarter of a second.

**No loops.** Nothing loops. Carets do not blink, apart from the three hero blinks. Pending states use text, never spinners. The dialect strip does not drift. Nothing moves without a cause.

**Reduced motion.** When the person's system asks for reduced motion:

- The hero shows the final sample text and diagram immediately.
- Entities appear in place, with no `data-motion` and no row stagger.
- Written-back link lines appear in one step, and their endpoint rows show a static highlight for 600 milliseconds.
- Connectors appear fully drawn.
- Arrange jumps.
- Dialogs, sheets and menus appear without fading or rising.
- Hover colour changes still take up to about a seventh of a second.

Every function behaves exactly the same as it does with motion.

### Feedback states (DP-09, DP-10, DP-11, DP-29, DP-30, DP-38, DP-40, DP-41, DP-42, DP-46, DP-57)

Copy rules for every backticked string in this brief:

- It renders and is announced character for character.
- Apostrophes are straight (').
- Hyphens are plain ASCII hyphens.
- Pending copy ends with three full stops, not an ellipsis character.

**Placeholders.**

| Placeholder | Meaning |
|---|---|
| `<entity>`, `<column>`, `<choice>`, `<group>` | Names as the diagram shows them, without quotes |
| `<display name>` | A person's display name |
| `<email>` | The address as entered |
| `<n>`, `<m>`, `<line>`, `<column number>`, `<x>`, `<y>`, `<projects>`, `<exports>`, `<added>`, `<merged>`, `<skipped>`, `<ambiguous>` | Base-10 integers without separators |
| `<dialect name>` | `PostgreSQL` or `MySQL` |
| `<access>` | `view` or `edit` |
| `<Access>` | `View` or `Edit` |
| `<role word>` | `owner`, `editor` or `viewer` |
| `<colour>` | One of the six colour names in lower case |
| `<file name>` | The export file name from Business rules |
| `<template name>` | A template name from Seed data |
| `<time>` | Business time as `YYYY-MM-DD HH:MM <zone>` |
| `<query>` | The trimmed search text |
| `<unit>` | A merge unit name from Business rules |

**Pending behaviour.** While a request is pending, the button that started it shows the pending copy as its label and is disabled. The same pending copy goes to `status "Studio announcements"`, or to `status "Sign-in status"` on the sign-in page.

**Form errors.** Field errors from a 422 reply show under their field, linked to it as its description. Above the form, an `alert` headed `Check these fields:` lists each message as a link that moves focus to its field.

**Studio status strip** (`status "Studio status"`). It is filled on page load and refreshed every 15 seconds.

| Storage | Mail | Copy |
|---|---|---|
| up | up | `All studio services are running.` |
| down | up | `Storage is down: exports and imports are paused. Editing still saves.` |
| up | down | `Mail is down: sign-in codes and invitations are paused. Links still work.` |
| down | down | `Storage and mail are down: exports, imports, codes and invitations are paused. Editing still saves.` |

**Editing and parsing.**

| Action | Region | Copy |
|---|---|---|
| Parse finished, no errors | `status "Editor status"` | `No errors.` |
| Parse finished, one error | `status "Editor status"` | `1 error. First error at line <line>, column <column number>.` |
| Parse finished, several errors | `status "Editor status"` | `<n> errors. First error at line <line>, column <column number>.` |
| Text has errors | `status "Diagram out of date"` | `Showing the last diagram without errors. Fix the text to update it.` |
| More than 20 errors | last item of `list "Errors"` | `<n> more errors`, or `1 more error` |
| Gutter marker | `img` named | `Error on line <line>: <message>`, using that line's first error |
| Edit in flight | `status "Save state"` | `Saving...` |
| Edit accepted | `status "Save state"` | `All changes saved` |
| Edit failed in transport or with a 5xx (retried every 3 seconds) | `status "Save state"` | `Changes not saved yet. Retrying...` |
| Edit refused by a conflict | `alert` | `<display name> changed <unit> first. Your edit was not saved and the text now shows the latest version.` |
| Template applied | `status "Studio announcements"` | `Started from <template name>.` |
| No template matches | inside `region "Starter templates"` | `No template matches "<query>".` |

The editor status copy updates after each parse whenever it differs from what is already there.

**Diagram actions** (`status "Diagram announcements"`).

| Action | Copy |
|---|---|
| Move | `Moved <entity> to <x>, <y>.` |
| Select or deselect | `Selected <entity>. <n> selected.` / `Deselected <entity>. <n> selected.` |
| Selection cleared | `Selection cleared.` |
| Link started | `Linking from <entity>.<column>. Choose a target column.` |
| Target focused | `Target <entity>.<column>.` |
| Link written | `Linked <from entity>.<from column> to <to entity>.<to column>, many to one.` |
| Link cancelled | `Link cancelled.` |
| Target is the start column | `Choose a different column.` |
| Link refused by the server | The `message` (409) or field message (422) of the API reply |
| Group created | `Grouped <entity>, <entity> as "<group>".` (entities in text order, joined by a comma and a space) |
| Group removed | `Removed group "<group>".` |
| Colour set | `<entity> is now <colour>.` |
| Renamed | `Renamed <old entity> to <new entity>.` |
| Arranged | `Arranged <n> entities.` |

**Versions, exports and imports.**

| Action | Pending | Success (`status "Studio announcements"`) | Failure (`alert`) |
|---|---|---|---|
| Save version | `Saving...` | `Version <n> saved.` | Field errors |
| Restore version | `Restoring version <n>...` | `Restored version <n> as version <m>.` | — |
| Compare versions | — | The comparison copy below | — |
| Save export | `Saving export...` | `<dialect name> export saved. Download is ready.` | The API's 409 or 429 `message`; storage outage: `Export storage is unavailable. Your diagram is safe and still saving; try the export again shortly.` |
| Download after expiry | — | — | `This download has expired. Save the export again.` (the Download link is removed) |
| Import | `Importing...` | `Imported <added> new and <merged> merged entities. <skipped> statements skipped, <ambiguous> ambiguous.`; nothing changed: `Nothing changed: the text already matches this DDL.` | Rejected: `The import was not applied. Fix the lines below and try again.`, with `list "Import errors"` holding the error lines; storage outage: `Import storage is unavailable, so nothing was imported. Your diagram is safe; try again shortly.` |

**Comparison copy** (inside `region "Comparison"`):

- First line: `Version <a> to version <b>: <added> added, <removed> removed, <changed> changed`.
- Then one line per entity: `Added entity <entity>`, `Removed entity <entity>` or `Changed entity <entity>`.
- When nothing differs, the only line is `No entity changes between version <a> and version <b>.`

**Import results** (items of `list "Import results"`):

- Tables, types, indexes and foreign keys: `Line <line>: <kind> <name> <status>`, where `<kind>` is `table`, `type`, `index` or `foreign key`, `<name>` is the item's name as Business rules (Import, Report) define it, and `<status>` is `added` or `merged`.
- Skipped statements: `Line <line>: <WORDS> skipped`, where `<WORDS>` is defined under Statement words in Business rules (Import).
- Ambiguous tables: `Line <line>: table <name> ambiguous, it matches <existing name> only by letter case, not imported`.

`list "Import notes"` shows the API's notes verbatim. When the version list is empty it reads `No versions yet. Save one to keep this moment.`

**Sharing and access.**

| Action | Pending | Success (`status "Studio announcements"`) | Failure (`alert`) |
|---|---|---|---|
| Create link | `Creating link...` | `<Access> link created.` | Field errors |
| Invitation | `Sending invitation...` | `Invitation sent to <email>.` | `The invitation to <email> could not be sent because mail is down. The link works; send it again later.` |
| Send again | `Sending invitation...` | `Invitation sent to <email>.` | The same mail-down copy |
| Rotate | — | `Link rotated. The old address no longer works.` | — |
| Turn off | — | `Link turned off.` | — |
| Role change | — | `<display name> can now only view.` / `<display name> can now edit.` | — |
| Remove member | — | `<display name> no longer has access.` | — |

The invitation state line in each link item reads `Invitation queued`, `Invitation sent` or `Invitation failed`. It updates when the dialog opens and after each create or send.

**Notices to the affected person** (`alert`, pushed live):

| Event | Copy |
|---|---|
| Downgraded to viewer | `Your access changed to view only.` |
| Upgraded to editor | `You can edit this project again.` |
| Removed | `You no longer have access to this project.` |
| Link turned off | `The owner turned off this link.` |
| Link rotated | `The owner replaced this link with a new one.` |
| Link expired | `This link has expired.` |

After any of these notices except the upgrade, the editor turns read-only (`aria-readonly="true"`), and the edit chips disappear at once. The diagram stays visible until the page is reloaded. On reload, people whose access is gone get the not-found page.

**Projects and sign-in.**

| Action | Region | Copy |
|---|---|---|
| Project created | `status "Studio announcements"` | `Project <project name> created.` |
| Project renamed | `status "Studio announcements"` | `Project renamed to <project name>.` |
| Code requested | `status "Sign-in status"` | Pending `Sending code...`, then `We sent a code to <email>.` |
| Code request while mail is down | `alert` | `We couldn't send a code because mail is down. Try again in a minute.` |

## Backend

### API (DP-07, DP-08, DP-29, DP-33, DP-35, DP-38, DP-50, DP-52, DP-53, DP-54, DP-55)

**Format.**

- Every route lives under the app's own origin.
- Request and response bodies are `application/json; charset=utf-8`, except where a route says otherwise.
- Times are ISO 8601 UTC with milliseconds, for example `2026-11-05T09:30:00.000Z`.
- Project, user, share, export and import ids are UUID version 4 strings.
- Signed-in calls carry the HttpOnly, SameSite=Lax cookie `joinery_session`, which lasts 30 days.

**Error shape.** Every error body is a JSON object with a string `error` and a string `message`, plus the extra fields its row names.

**Error check order.** The order is the same for every route:

1. 401: unauthenticated where a session is needed.
2. 404: unknown, malformed, or not visible to the caller.
3. 403: the caller can open the resource but may not perform this write.
4. 409: revision or state conflict.
5. 422: validation.
6. 413: text over the size limit.
7. 429: rate limit.
8. 503: a dependency fails after every check has passed.

**Common bodies.**

| Status | Body |
|---|---|
| 401 | `{"error":"signed_out","message":"Sign in to continue."}` |
| 404 | `{"error":"not_found","message":"Nothing is here."}` (identical for missing and for not visible) |
| 403 view-only write | `{"error":"read_only","message":"You can view this project but not change it."}` |
| 403 owner-only action by an editor | `{"error":"owner_only","message":"Only the owner can do this."}` |
| 409 stale base | `{"error":"stale_revision","message":"The text changed. Try again on the latest version.","revision":<n>,"text":"<server text>"}` |
| 409 text has errors | `{"error":"schema_has_errors","message":"Fix the errors in the text first."}` |
| 422 | `{"error":"invalid","message":"Some fields need attention.","fields":{"<field>":"<message>"}}` |
| 413 | `{"error":"too_large","message":"Text is larger than <limit> bytes."}`, where `<limit>` is `JOINERY_TEXT_LIMIT_BYTES` |
| 503 storage | `{"error":"storage_unavailable","message":"Storage is unavailable. Your diagram is safe; try again shortly."}` |
| 503 mail | `{"error":"mail_unavailable","message":"Mail is unavailable. Try again shortly."}` |

**Common field messages.**

| Field | Message |
|---|---|
| `email` | `Enter a valid email address.` |
| `displayName` | `Enter a display name of 1 to 40 characters.` |
| `name` (project) | `Enter a project name of 1 to 80 characters.` |
| `name` (version) | `Enter a version name of 1 to 80 characters.` |
| `baseRevision` | `Send the revision your text is based on.` |
| `text` | `Send the text as a string.` |
| `dialect` | `Pick postgresql or mysql.` |

**Service routes**

- `GET /api/health` → 200 `{"status":"ok"}` when PostgreSQL, object storage and mail are all reachable. When storage or mail is unreachable, it answers 200 `{"status":"unavailable"}`. When PostgreSQL is unreachable, it answers 503 `{"status":"unavailable"}`. Each probe has a 2-second timeout, and results are cached for at most 5 seconds.
- `GET /api/status` → 200 `{"storage":"up"|"down","mail":"up"|"down","checkedAt":"<time>"}`, from the same cached probes.
- `GET /api/stats` → 200 `{"projects":<n>,"exports":<n>}`: the count of projects and the count of exports in state `stored` or `expired`.
- `POST /api/check` `{"text":"<text>"}`, no session needed → 200 `{"valid":<bool>,"errorCount":<n>,"errors":["Line 2, column 9: Unknown type strng"]}`. It returns every error in the published order, with no cap. Text over the limit → 413.

**Sign-in**

- `POST /api/auth/code` `{"email":"<email>","displayName":"<name>"}` → 202 `{"status":"sent"}` once the mail provider has accepted the code email.
  - `displayName` is required only when the email is new. For a known email it is ignored.
  - 422 on `email` or `displayName`.
  - 503 mail.
- `POST /api/auth/session` `{"email","code"}` → 200 `{"user":{"id","email","displayName"}}`, and sets the cookie.
  - 422 `{"fields":{"code":"That code is wrong or has expired."}}` for a wrong, used or expired code.
- `DELETE /api/auth/session` → 204, and clears the cookie.
- `GET /api/me` → 200 `{"user":{...}}`, or 401.

**Projects**

- **Project JSON:** `{"id","name","role":"owner"|"editor"|"viewer","revision":<n>,"text":"<text>","layout":<layout>,"errorCount":<n>,"owner":{"id","displayName"},"updatedAt":"<time>"}`.
- **Summary JSON:** `{"id","name","role","revision","entityCount":<n>,"updatedAt"}`.
- `GET /api/projects` → 200 `{"owned":[<summary>],"shared":[<summary>]}`, each list sorted newest `updatedAt` first.
- `POST /api/projects` `{"name","templateId"?}` → 201 project JSON.
  - `templateId` is one of `library-loans`, `greenhouse-beds` or `recipe-box`. Without it the text is empty.
  - 422 on `name`, or on `templateId` with `Pick a listed template.`
- `GET /api/projects/<id>` → 200 project JSON.
- `PATCH /api/projects/<id>` `{"name"}` → 200 project JSON. Viewers get 403.
- `POST /api/projects/<id>/edits` `{"baseRevision":<n>,"text":"<full text>"}` → 200 `{"revision":<n>,"text":"<server text>","merged":<bool>}`.
  - 409 `{"error":"edit_conflict","message":"<display name> changed <unit> first.","revision":<n>,"text":"<server text>","conflicts":[{"unit":"<unit>","by":"<display name>"}]}`.
  - 422 on `baseRevision` when it is missing or above the current revision.
  - 413 for text over the limit.
- `PATCH /api/projects/<id>/layout` `{"entities":{"<entity>":{"x"?,"y"?,"color"?}},"groups":{"<group>":{"color"}}}` → 200 `{"layout":<layout>}`. 422 field messages:
  - `entities.<entity>`: `No entity <entity>.`
  - `x` and `y`: `Use a whole number from 0 to 500.`
  - `color`: `Pick one of slate, blue, violet, green, amber or red.`
  - `groups.<group>`: `No group <group>.`
- `POST /api/projects/<id>/layout/arrange` → 200 `{"layout":<layout>}`.
- `POST /api/projects/<id>/links` `{"baseRevision","from":"<entity>.<column>","to":"<entity>.<column>"}` → 200 `{"revision","text","line":"<written line>","lineNumber":<n>}`.
  - 409 `stale_revision` or `schema_has_errors`.
  - 409 `{"error":"link_exists","message":"That link already exists."}`.
  - 422 field messages on `from` or `to`: `No column <entity>.<column>.`, `Choose a different column.`, or the language message for a type mismatch.
- `POST /api/projects/<id>/groups` `{"baseRevision","name","entities":["<entity>"],"color"}` → 200 `{"revision","text","layout"}`.
  - 409 `stale_revision` or `schema_has_errors`.
  - 409 `{"error":"already_grouped","message":"<entity> is already in group \"<group>\"."}`.
  - 422 field messages: `name` gets `Enter a group name of 1 to 40 characters without double quotes.` or `A group with this name already exists.`; `entities` gets `Pick at least one entity.` or `No entity <entity>.`; `color` gets the colour message.
- `DELETE /api/projects/<id>/groups/<url-encoded group name>?baseRevision=<n>` → 200 `{"revision","text","layout"}`.
  - 404 for an unknown group.
  - 409 `stale_revision` or `schema_has_errors`.
- `POST /api/projects/<id>/entities/rename` `{"baseRevision","from","to"}` → 200 `{"revision","text","layout"}`.
  - 409 `stale_revision` or `schema_has_errors`.
  - 422 field messages: `from` gets `No entity <entity>.`; `to` gets `Use 1 to 64 characters without double quotes, dots, backticks or backslashes.` or `That name is already used.`
- `GET /api/projects/<id>/ddl?dialect=postgresql|mysql` → 200 `text/plain; charset=utf-8`, exactly the bytes an export would store.
  - 409 `schema_has_errors`.
  - 422 on `dialect`.

**Layout JSON:** `{"entities":{"<entity>":{"x":<int>,"y":<int>,"color":"<colour>"}},"groups":{"<group>":{"color":"<colour>"}}}`.

**Versions**

- **Version JSON:** `{"number":<n>,"name":"<name>","revision":<n>,"createdAt":"<time>","createdBy":{"id","displayName"},"restoredFrom":<n>|null}`.
- `POST /api/projects/<id>/versions` `{"name"}` → 201 version JSON. Viewers get 403. 422 on `name`.
- `GET /api/projects/<id>/versions` → 200 `{"versions":[<version>]}`, highest number first.
- `GET /api/projects/<id>/versions/<n>` → 200 version JSON plus `"text"` and `"layout"`.
- `POST /api/projects/<id>/versions/<n>/restore` → 201 `{"version":<new version>,"project":<project JSON>}`. Viewers get 403.
- `GET /api/projects/<id>/versions/compare?from=<a>&to=<b>` → 200 `{"from":<a>,"to":<b>,"added":["<entity>"],"removed":[...],"changed":[...]}`, each list in name order.
  - 404 for an unknown version.
  - 409 `{"error":"version_has_errors","message":"One of these versions has errors in its text."}`.

**Shares and members** (owner only; an editor gets 403 `owner_only`)

- **Share JSON:** `{"id","access":"view"|"edit","status":"active"|"rotated"|"revoked"|"expired","url":"/s/<token>","token":"<token>","email":"<email>"|null,"invitation":null|{"status":"queued"|"sent"|"failed","sentAt":"<time>"|null},"expiresAt":"<time>","createdAt":"<time>","replacedBy":"<share id>"|null}`.
- `POST /api/projects/<id>/shares` `{"access","email"?,"expiresInSeconds"?}` → 201 share JSON. When an email is given, the response comes after the mail attempt, with the invitation `sent` or `failed`. 422 field messages:
  - `access`: `Pick view or edit.`
  - `email`: the email message.
  - `expiresInSeconds`: `Use a whole number of seconds from 1 to 31536000.`
- `GET /api/projects/<id>/shares` → 200 `{"shares":[<share>]}`, newest first, with status computed from the server clock.
- `POST /api/projects/<id>/shares/<share id>/rotate` → 201 the new share JSON.
- `POST /api/projects/<id>/shares/<share id>/revoke` → 200 share JSON.
- Rotate and revoke both answer 409 `{"error":"share_not_active","message":"This link is no longer active."}` when the share is not active.
- `POST /api/projects/<id>/shares/<share id>/invitation` → 200 share JSON with the invitation `sent`.
  - 409 `share_not_active`.
  - 409 `{"error":"no_invitation","message":"This link has no invitation email."}`.
  - 503 mail, which leaves the invitation `failed`.
- `GET /api/projects/<id>/members` → 200 `{"members":[{"userId","displayName","email","role":"editor"|"viewer","joinedVia":"<share id>"|null}]}`.
- `PATCH /api/projects/<id>/members/<user id>` `{"role":"editor"|"viewer"}` → 200 member JSON.
  - 409 `{"error":"owner_role_fixed","message":"The owner's access cannot change."}` when the user id is the owner's.
  - 422 on `role`: `Pick editor or viewer.`
- `DELETE /api/projects/<id>/members/<user id>` → 204. 409 `owner_role_fixed` when the user id is the owner's.

**Link routes** (by token; a token that is unknown, rotated, revoked or expired → 404)

- `GET /api/shared/<token>` → 200 project JSON with `"role":"viewer"` and `"via":"link"` for view tokens. For edit tokens it answers `{"access":"edit","projectName":"<name>"}`.
- `POST /api/shared/<token>/join`, session needed → 200 `{"projectId","role":"editor"}`.
  - The caller becomes an editor, or stays as they are if they are already a member or the owner.
  - A view token → 403 `read_only`.
  - A person previously removed from the project can rejoin only through a link created after their removal; an older link → 404.
- `POST /api/shared/<token>/edits` → 403 `read_only` for view tokens. For edit tokens → 403 `{"error":"join_first","message":"Join the project before editing."}`.
- `GET /api/shared/<token>/versions`, `GET /api/shared/<token>/versions/<n>` and `GET /api/shared/<token>/versions/compare?from=<a>&to=<b>` answer, for view tokens, exactly like the matching project version routes. For edit tokens they answer 403 `join_first`.

**Live channel**

- WebSocket at `/api/projects/<id>/live` (session) and at `/api/shared/<token>/live` (view token).
- An upgrade that would answer 401 or 404 is refused with that HTTP status.
- Messages from the server:
  - `{"type":"hello","revision","text","layout","access":"owner"|"editor"|"viewer","presenceTimeoutSeconds":<n>}`
  - `{"type":"revision","revision","text","by":{"userId","displayName"}}`
  - `{"type":"layout","layout","by":{...}}`
  - `{"type":"presence","people":[{"userId","displayName"}],"linkViewers":<n>}`
  - `{"type":"access","access":"editor"|"viewer"|"none","reason":"role_changed"|"removed"|"revoked"|"rotated"|"expired"}`
- An `access` message with `none` is followed by a close with code 4404.
- The client sends `{"type":"ping"}` at least every third of `presenceTimeoutSeconds`.

**Exports**

- **Export JSON:** `{"id","dialect":"postgresql"|"mysql","status":"requested"|"stored"|"failed"|"expired","key":"<object key>","bytes":<n>,"sha256":"<hex>","fileName":"<file name>","revision":<n>,"downloadUrl":"/api/projects/<id>/exports/<export id>/download","downloadExpiresAt":"<time>","createdAt":"<time>"}`.
- `POST /api/projects/<id>/exports` `{"dialect"}` → 201 export JSON with status `stored`. Viewers get 403. The request then runs through the check order:
  1. 409 `schema_has_errors`.
  2. 422 on `dialect`.
  3. 429 `{"error":"rate_limited","message":"Too many exports. Try again in a minute."}`, with a `Retry-After` header in whole seconds.
  4. 503 storage.
- `GET /api/projects/<id>/exports` → 200 `{"exports":[<export>]}`, newest first.
- `GET /api/projects/<id>/exports/<export id>/download` → 200 with the stored bytes, `Content-Type: application/sql; charset=utf-8` and `Content-Disposition: attachment; filename="<file name>"`.
  - 409 `{"error":"export_expired","message":"This download has expired. Save the export again."}`.
  - 503 storage.

**Imports**

- `POST /api/projects/<id>/imports?dialect=postgresql|mysql&mode=merge|replace&baseRevision=<n>`. The body is the raw DDL bytes, with `Content-Type: application/sql` or `text/plain`. On success → 201:

  ```json
  {"id":"<import id>","dialect":"postgresql","mode":"merge","revision":<n>,"changed":<bool>,
   "originalKey":"<object key>","bytes":<n>,"sha256":"<hex>",
   "report":[{"line":<n>,"kind":"table"|"type"|"index"|"foreign key"|"statement","name":"<name>","status":"added"|"merged"|"skipped"|"ambiguous"}],
   "notes":["<note>"],
   "counts":{"added":<n>,"merged":<n>,"skipped":<n>,"ambiguous":<n>}}
  ```

  Viewers get 403. The request then runs through the check order:
  1. 409 `stale_revision`.
  2. 409 `schema_has_errors` (merge mode only).
  3. 422 on `dialect`, or on `mode` with `Pick merge or replace.`
  4. 422 `{"error":"import_failed","message":"The import was not applied.","lines":["Line <line>, column <column number>: <message>"]}`.
  5. 413 `{"error":"too_large","message":"The DDL is larger than <limit> bytes."}`.
  6. 503 storage.
- `GET /api/projects/<id>/imports` → 200 `{"imports":[{"id","dialect","mode","bytes","sha256","createdAt"}]}`.
- `GET /api/projects/<id>/imports/<import id>/original` → 200 with the exact stored bytes and `Content-Type: application/sql`. 503 storage.

**Grading setup**

`POST /api/grading/setup` with the header `X-Grading-Key: <JOINERY_GRADING_KEY>`. A missing or wrong key, or an empty `JOINERY_GRADING_KEY`, gets the 404 body. Request body:

```json
{"users":[{"ref":"owner","email":"ada@example.test","displayName":"Ada Okafor"}],
 "projects":[{"ref":"p1","owner":"owner","name":"Library","text":"<text>","layout":<layout>,
   "versions":[{"name":"First cut","text":"<text>","layout":<layout>}],
   "members":[{"user":"<user ref>","role":"editor"|"viewer"}],
   "shares":[{"ref":"s1","access":"view"|"edit","expiresInSeconds":<n>}]}]}
```

- Versions are created in order, numbered from 1. A version without `text` or `layout` takes the project's value.
- The project's current state is its `text` and `layout`, at revision 1.
- Missing layout entries get default cells.
- An existing email reuses that user and issues a new session.
- Nothing is emailed.

Response → 201:

```json
{"users":{"<ref>":{"id","session":"<joinery_session cookie value>"}},
 "projects":{"<ref>":{"id","revision":1,"versions":[1]}},
 "shares":{"<ref>":{"id","token","url"}}}
```

Validation failures answer 422 with field paths such as `projects.0.name`.

### Business rules (DP-01, DP-08, DP-12, DP-13, DP-14, DP-16, DP-17, DP-18, DP-21, DP-22, DP-23, DP-24, DP-26, DP-27, DP-28, DP-31, DP-32, DP-34, DP-35, DP-36, DP-37, DP-40, DP-41, DP-43, DP-45)

#### The Mortise language

Mortise text is UTF-8. Lines end in LF or CRLF. Spaces and tabs separate tokens. `#` starts a comment that runs to the end of the line, anywhere outside a quoted name or string. Statements start at the beginning of a line. Every keyword is lower case.

Grammar:

```
text          = { blank-line | comment-line | statement } ;
statement     = entity | choice | link | group ;
entity        = "entity" name "{" line-end { member } "}" ;
member        = ( column | index ) line-end | comment-line | blank-line ;
column        = name type [ "[" column-setting { "," column-setting } "]" ] ;
column-setting= "key" | "auto" | "required" | "unique"
              | "default" ":" literal
              | "link" ":" token ref ;
index         = "index" "(" name { "," name } ")"
                [ "[" index-setting { "," index-setting } "]" ] ;
index-setting = "unique" | "name" ":" dq-string ;
choice        = "choice" name "{" name { "," name } "}" ;     (may span lines)
link          = "link" ref token ref [ "[" "delete" ":" action "]" ] ;
action        = "cascade" | "restrict" | "set null" | "no action" ;
group         = "group" dq-string "{" name { "," name } "}" ;  (may span lines)
ref           = name "." name ;
token         = ">-" | "-<" | "--" | ">-<" ;
type          = type-name [ "(" integer [ "," integer ] ")" ] | choice-name ;
literal       = integer | decimal | sq-string | "true" | "false" | "null" | "now" ;
name          = bare-name | dq-name ;
bare-name     = ( letter | "_" ) { letter | digit | "_" } ;
dq-name       = '"' 1 to 64 printable ASCII characters other than " \ . ` '"' ;
dq-string     = '"' 1 to 40 characters other than " and line breaks '"' ;   (group and index names)
sq-string     = "'" { any character but a line break; '' stands for ' } "'" ;
```

- Names are case-sensitive and at most 64 characters long.
- A member line that starts with `index` followed by `(` is an index. Any other member line is a column.
- The `{` of an entity ends its line, apart from an optional comment. The `}` sits on its own line.
- Entities take no settings. A `[` after an entity name is an unexpected token.

**Column settings.**

| Setting | Meaning |
|---|---|
| `key` | Part of the primary key. Several key columns form one composite key in column order. A key column is always NOT NULL. |
| `auto` | Auto-increment. Allowed only on `int`, `smallint` and `bigint`. |
| `required` | NOT NULL |
| `unique` | Single-column unique constraint |
| `default: <literal>` | Default value. `now` means the current timestamp. A choice column's default must be one of its values. |
| `link: <token> <entity>.<column>` | An inline link from this column, the same as a link line written right after the entity |

**Column types** (the closed list; names are lower case):

| Type | Parameters | PostgreSQL | MySQL |
|---|---|---|---|
| `int` | none | `INTEGER` | `INT` |
| `smallint` | none | `SMALLINT` | `SMALLINT` |
| `bigint` | none | `BIGINT` | `BIGINT` |
| `decimal(p,s)` | p from 1 to 65; s from 0 to 30, not above p | `NUMERIC(p,s)` | `DECIMAL(p,s)` |
| `float` | none | `REAL` | `FLOAT` |
| `double` | none | `DOUBLE PRECISION` | `DOUBLE` |
| `bool` | none | `BOOLEAN` | `BOOLEAN` |
| `text` | none | `TEXT` | `TEXT` |
| `varchar(n)` | n from 1 to 16383 | `VARCHAR(n)` | `VARCHAR(n)` |
| `char(n)` | n from 1 to 255 | `CHAR(n)` | `CHAR(n)` |
| `date` | none | `DATE` | `DATE` |
| `time` | none | `TIME` | `TIME` |
| `timestamp` | none | `TIMESTAMP` | `DATETIME` |
| `timestamptz` | none | `TIMESTAMPTZ` | `TIMESTAMP` (reported) |
| `uuid` | none | `UUID` | `CHAR(36)` (reported) |
| `json` | none | `JSONB` | `JSON` |
| `bytes` | none | `BYTEA` | `LONGBLOB` |
| `<choice name>` | none | the enum type | inline `ENUM(...)` (reported) |

**Links.** A link joins two columns. Which side holds the foreign key depends on the cardinality:

| Token | Meaning | `data-cardinality` | Foreign key |
|---|---|---|---|
| `>-` | many-to-one | `many-to-one` | On the left column, referencing the right |
| `-<` | one-to-many | `one-to-many` | On the right column, referencing the left |
| `--` | one-to-one | `one-to-one` | On the left column, which must be `unique`, the sole key, or the sole column of a unique index |
| `>-<` | many-to-many | `many-to-many` | None; the export reports it |

- Linked columns must have the same base type (the type name without parameters), or both must be integer types.
- `delete: set null` is not allowed on a required or key column.
- Two links joining the same two columns, in either direction, are a duplicate.

**Groups.** A group names one or more entities. An entity belongs to at most one group.

**Messages.** This is the closed list. Every error renders as `Line <line>, column <column number>: <message>`. Lines and columns count from 1, and columns count characters. `<type>` is the canonical type, and `<n>` is the line of the first definition.

| Message | Points at |
|---|---|
| `Unexpected token <token>` | The token |
| `Unexpected end of text` | Just past the last character |
| `Unexpected end of line` | Just past the last character of the line before any comment |
| `Missing closing brace for entity <entity>` (also `choice <choice>`, `group "<group>"`) | The opening brace. A statement keyword at the start of a line inside an open block also ends the block with this error. |
| `Unknown type <type>` | The type |
| `Type <type> takes no parameters` | The opening parenthesis |
| `Type varchar needs a length from 1 to 16383` | The type |
| `Type char needs a length from 1 to 255` | The type |
| `Type decimal needs a precision from 1 to 65 and a scale from 0 to 30 that is not above the precision` | The type |
| `Unknown setting <setting>` | The setting |
| `Setting auto needs an integer column` | The setting |
| `Key column <entity>.<column> cannot default to null` | The default |
| `Value <value> is not in choice <choice>` | The default literal |
| `Entity <entity> is already defined on line <n>` | The second name |
| `Choice <choice> is already defined on line <n>` | The second name |
| `Group "<group>" is already defined on line <n>` | The second name |
| `Column <column> is already defined in entity <entity>` | The second column name |
| `Entity <entity> has no columns` | The entity name |
| `Choice <choice> lists <value> twice` | The second value |
| `Index names missing column <entity>.<column>` | The name inside the index |
| `Link points to missing entity <entity>` | The reference |
| `Link points to missing column <entity>.<column>` | The reference |
| `Link joins <type> to <type>` | The second reference |
| `One-to-one link needs <entity>.<column> to be unique` | The first reference |
| `Link sets null on required column <entity>.<column>` | The action |
| `Link <entity>.<column> to <entity>.<column> is already defined on line <n>` | The second link |
| `Group "<group>" names missing entity <entity>` | The name |
| `Entity <entity> is already in group "<group>"` | The name |
| `Name <name> is longer than 64 characters` | The name |
| `Text is larger than <limit> bytes` | Line 1, column 1; the only error reported |
| `Schema has more than <limit> entities` | The first entity past the limit |
| `Schema has more than <limit> statements` | The first statement past the limit |

- **Syntax errors** are exactly `Unexpected token <token>` (the token as written), `Unexpected end of line`, `Unexpected end of text` and the `Missing closing brace ...` messages. Every other message is a check on a statement that parsed.
- **After a syntax error**, the rest of that line is skipped and nothing after the error on that line is checked. Parsing resumes on the next line in this state:
  - **Entity header line.** When the line starts with `entity` followed by a valid name, and its last token before any comment is `{`, the block opens and the entity is defined with that name, even if an error came between the name and the `{`. Otherwise no block opens, and the lines after it, up to and including the next line holding only `}`, are skipped without further errors.
  - **Member line** inside an open entity. The column or index on that line is not defined, and the block stays open.
  - **Choice or group.** Parsing skips forward to the next `}`, on the same line or a later one, which closes the block. Values listed before the error are kept.
  - **Link line.** The link is not defined.
  - **Any other top-level line** that does not start with a statement keyword reports `Unexpected token <first token>` at its first token and is skipped.
- `Unexpected end of line` is reported when a line, the last line included, ends where a token is still needed. An entity still open at the end of the text reports `Missing closing brace for entity <entity>`. A choice or group list spread over lines that is still open at the end of the text reports `Unexpected end of text` instead of its missing brace message.
- Every check error is reported in full and skips nothing: the rest of the line is still checked, and the statement still counts for later checks. A column with an unknown type still exists; only the link type check skips it.
- **Worked multi-error example.** This text:

  ```
  entity books [key] {
    id int [key]
    title strng
  }

  entity loans
    id int [key]
    book_id int
  }
  link loans.book_id >- books.id
  link books.id >- shelves.id
  ```

  gives exactly these five errors, in this order:

  ```
  Line 1, column 14: Unexpected token [
  Line 3, column 9: Unknown type strng
  Line 6, column 13: Unexpected end of line
  Line 10, column 6: Link points to missing entity loans
  Line 11, column 18: Link points to missing entity shelves
  ```

  `books` opens despite the error on line 1. `loans` never opens, so lines 7 to 9 are skipped and `loans` is not defined. The editor status reads `5 errors. First error at line 1, column 14.`
- Errors are sorted by line, then by column, then by message text.

**Limits.** These are exact, and the limit value itself is allowed.

- Text up to `JOINERY_TEXT_LIMIT_BYTES` bytes.
- At most `JOINERY_ENTITY_LIMIT` entities.
- At most `JOINERY_STATEMENT_LIMIT` top-level statements. A statement is an entity, choice, link line or group.
- Any check, parse, export or import within these limits answers within 2 seconds.

**Worked examples.** Entities without stored positions start in the next free cells by the rule below, the first two being (0, 0) and (14, 0).

1. Two entities:

   ```
   entity authors {
     id int [key, auto]
     name varchar(80) [required]
   }

   entity books {
     id int [key, auto]
     title text [required]
     author_id int [required]
   }
   link books.author_id >- authors.id
   ```

   - `data-entity="authors"` is at `data-x="0" data-y="0"` and is named `Entity authors, 2 columns, 1 link`.
   - `data-entity="books"` is at `data-x="14" data-y="0"` and is named `Entity books, 3 columns, 1 link`.
   - `authors.id` has `data-key="primary"` and `data-type="int"` and is named `id int, primary key`.
   - `books.author_id` has `data-key="foreign"` and is named `author_id int, foreign key, required`.
   - The link has `data-link="books.author_id->authors.id"` and `data-cardinality="many-to-one"`.

2. A choice:

   ```
   choice shelf_kind { fiction, reference, "large print" }

   entity shelves {
     id int [key]
     kind shelf_kind [required, default: 'fiction']
   }
   ```

   - `shelves.kind` has `data-type="shelf_kind"` and `data-key=""` and is named `kind shelf_kind, required`.
   - The outline's first item is `Choice shelf_kind: fiction, reference, large print`.

3. A composite key with a composite unique index:

   ```
   entity loans {
     book_id int [key]
     member_id int [key]
     copy_no smallint [required]
     started_on date [required]
     index (member_id, started_on) [unique, name: "loans_one_per_day"]
   }
   ```

   - `data-key` values: `book_id` `primary`, `member_id` `primary unique`, `copy_no` empty, `started_on` `unique`.
   - `member_id` is named `member_id int, primary key, unique`.

4. A group:

   ```
   entity beds {
     id int [key]
   }

   entity trays {
     id int [key]
     bed_id int
   }
   link trays.bed_id >- beds.id

   group "Potting shed" { beds, trays }
   ```

   - Both entities have `data-group="Potting shed"`.
   - The layout's group colour is `blue`.
   - The last outline item is `Group Potting shed: beds, trays`.

#### Canonical text

Every text Joinery writes follows these rules. That covers drawn links, groups, renames through the diagram, imports and the starter entity.

- **Names:** a name is written bare when it matches `[A-Za-z_][A-Za-z0-9_]*` and is not one of `entity`, `choice`, `link`, `group`, `index`, `key`, `auto`, `required`, `unique`, `default`, `true`, `false`, `null`, `now`. Otherwise it is written in double quotes. Group names are always quoted.
- **Entity block:**
  - `entity <name> {`, then one line per column: two spaces, `<name> <type>`, then ` [<settings>]` when the column has any settings.
  - Settings are joined by `, ` in this order: `key`, `auto`, `required`, `unique`, `default: <literal>`, `link: <token> <entity>.<column>`. `required` is left out on key columns.
  - Index lines follow the columns: two spaces, `index (<a>, <b>)`, then ` [unique, name: "<name>"]` with only the parts that apply.
  - Then `}`.
- **Types:** lower case, with parameters and no spaces, for example `decimal(6,2)`.
- **Literals:** numbers as written, strings in single quotes with `'` doubled, and `true`, `false`, `null` and `now` in lower case.
- **Link line:** `link <entity>.<column> <token> <entity>.<column>`, then ` [delete: <action>]` when there is a delete action.
- **Choice:** `choice <name> { <value>, <value> }` on one line.
- **Group:** `group "<name>" { <entity>, <entity> }` on one line, with entities in the order their blocks appear in the text.
- **Whole text** (replace imports, the starter entity and starter-template creation): choices first, then entities, each immediately followed by the link lines it owns, then groups. Exactly one blank line separates blocks. Lines end in LF, and the text ends with one LF. A link is owned by its left-hand entity.
- **Inserted lines** use the line ending of the line they follow.
- **The starter entity** is `entity new_entity {` / `  id int [key, auto]` / `}`. It is appended like a group block, and when that name is taken it becomes `new_entity_2`, then `new_entity_3`, counting up by one.

#### Text and diagram stay in step

- **Layout.** The layout stores one position and one colour per entity of the last valid parse, and one colour per group. Positions are in grid units from 0 to 500 inclusive. The default entity colour is `slate`, and the default group colour is `blue`. The colour list is closed: `slate`, `blue`, `violet`, `green`, `amber`, `red`. Moving, colouring and arranging change only the layout, never the text. The layout is saved in PostgreSQL and survives reload.
- **Next free cell.** Cells are numbered in reading order, eight per row. Cell `k` sits at x = 14 × (k mod 8) and y = 12 × floor(k / 8). With at most 200 entities no placement needs a cell past cell 199, which sits at x = 98, y = 288, so every placed cell is inside the 0 to 500 bounds. If `JOINERY_ENTITY_LIMIT` is raised so that a cell's y would pass 500, that cell's y is clamped to 500. A cell is occupied when some entity's position equals it exactly. Whenever an accepted edit's valid parse holds entities without a position, the server places them, in text order, each in the first unoccupied cell.
- **Forgotten positions.** When an accepted edit's valid parse no longer contains an entity, its layout entry is dropped. Renaming an entity in the text therefore gives the new name the next free cell.
- **Last valid parse.** While the text has errors, the layout and the diagram keep the last valid parse.
- **Drawn link write-back.** The server writes exactly one line, `link <from entity>.<from column> >- <to entity>.<to column>` (default cardinality many-to-one). The line goes on a new line directly after the line holding the closing brace of the entity that owns the starting column, and after any link lines that immediately follow that brace line. Every other byte stays identical, comments and blank lines included. When the line it follows is the last line and has no line ending, the inserted text is a line ending followed by the link line. The start and target must be different columns, the link must not already exist, and the types must match.
- **Group write-back.** The group block is appended at the end of the text, preceded by exactly one blank line. When the text already ends with a line ending, that means one extra line ending. Otherwise it means two line endings. The block ends with a line ending, and an empty text gets no leading blank line. Ungrouping removes the block's lines and exactly one blank line before it, when there is one. The group's colour lives in the layout.
- **Rename through the diagram.** The server rewrites the entity's header name, every reference to it in link lines and inline link settings, and every group list that names it, each in canonical name form. No other byte changes. The layout entry moves to the new name, keeping its position and colour.
- **Arrange.** Every entity in text order moves to cell 0, 1, 2, counting up by one in text order.
- **Writes that need a valid text.** Links, groups, renames and merge imports need valid text and a base revision equal to the current revision.

#### Live editing between people

- Every edit carries the base revision it was made on. The server applies edits in arrival order. Each accepted edit increases the revision by 1 and is written to the edit log in PostgreSQL with its author. An edit whose text equals the current text is accepted with no new revision.
- **Units.** For merging, the text is split by line.
  - A unit starts at every line that begins, in its first column, with `entity `, `choice ` or `group `. It runs to the line before the next unit start. So comments, blank lines and top-level link lines below an entity block belong to that entity's unit.
  - The lines before the first unit form the unit `the start of the text`.
  - Units are named `entity <name>`, `choice <name>` or `group "<name>"`. A repeated name gets ` (2)` for its second occurrence and ` (3)` for its third, counting up by one.
- **Merge.**
  - An edit whose base equals the current revision is applied as sent.
  - For an older base, the server finds the units the sender changed between the base text and the sent text (added, removed, or with any byte different), and the units changed between the base text and the current text.
  - If the two sets share no unit, the sender's changes are applied to the current text. Changed units are replaced in place, and removed units are deleted. Each added unit goes directly after the unit that precedes it in the sent text. When nothing precedes it, it goes at the start; when that preceding unit no longer exists, it goes at the end.
  - If the sets share a unit, the whole edit is refused with the 409 `edit_conflict` and nothing changes. The conflict names the first shared unit in current-text order and the display name of the author of the latest accepted edit that changed it.
- **Convergence.** After every reply, clients show the server text, so no client stays on a diverged copy.
- **Fan-out.** Every accepted edit, layout change and restore reaches every other open live channel for the project within `JOINERY_LIVE_MAX_DELAY_MS` of being accepted. A typed change therefore shows for other people within the parse delay plus the live delay.
- **Presence.** Presence lives in the app server process. An entry is removed when its channel closes, or when no message has arrived for `JOINERY_PRESENCE_TIMEOUT_SECONDS`. Every change goes out as a presence message.

#### Versions

- Version numbers per project start at 1 and are gapless and increasing. Two saves arriving together get consecutive numbers.
- A version stores the project's text, layout (positions, entity colours and group colours) and revision. Its name is 1 to 80 characters after trimming.
- Restoring version N:
  1. Sets the project text and layout to exactly N's text and layout, as a new revision.
  2. Creates version latest+1 named `Restored from version <N>`, with `restoredFrom` N.
  3. Pushes the new revision and layout to every live channel.

  Restore never deletes or renumbers history.
- **Comparison.** An entity is added or removed when its name appears in only one of the two versions. It is changed when its canonical entity block, together with the canonical link lines it owns, differs between them.
- Owners and editors save and restore. Viewers can list, read and compare.

#### Shares and members

- **Share states.** A share is `active` until one of these happens:
  - Rotate makes it `rotated` and creates a new active share with the same access and a new default expiry.
  - Revoke makes it `revoked`.
  - The server's UTC clock reaches `expiresAt`, which makes it `expired`.

  `rotated`, `revoked` and `expired` are final. Rotating or revoking a share that is not active answers 409 `share_not_active`.
- **Expiry.** `expiresAt` is the creation time plus `expiresInSeconds` when that is given, otherwise plus `JOINERY_SHARE_TTL_SECONDS`.
- **Tokens.** A token is 32 URL-safe random characters. A token that is not active resolves to the 404 at once, giving no hint that the project exists.
- **Effect on open sessions.**
  - When a share is rotated or revoked, every live channel opened through it gets the `access` message with `none` and the matching reason at once.
  - When a share expires, those channels get it within 5 seconds of `expiresAt`.
  - Revoking an edit share also removes every member who joined through it.
  - Rotating keeps members.
  - Expiry stops new joins but keeps members.
- **Invitations.** Invitation states are `queued` (when the share is created with an email), then `sent` once the mail provider accepts the message, or `failed` when it does not. Send again moves `failed` to `sent`, or keeps it `failed`.
- **Member roles.** Roles move from `editor` to `viewer`, from `viewer` to `editor`, and from either to removed. Removed is final. The owner's role never changes.
- **Role changes apply immediately.** A role change or removal takes effect on the member's next request: a write by a downgraded member answers 403, and every request by a removed member answers 404. Their live channels get the `access` message within the live delay.
- **Access matrix.**

| Caller | Read project, versions, compare | Edit text, layout, links, groups, renames, versions, restore, import, export | Shares and members |
|---|---|---|---|
| Owner | yes | yes | yes |
| Editor | yes | yes | 403 `owner_only` |
| Viewer member or view link | yes | 403 `read_only` | 403 `read_only` |
| Anyone else | 404 | 404 | 404 |

#### Export format

- **The file.** The file starts with the line `-- Joinery export: <dialect name>`. Then come any notes, one per line, each as `-- note: <text>` and sorted by code point. Then one blank line. Then the statements, each followed by `;`, separated by exactly one blank line. The file ends with a single LF. Nothing in it depends on time, project name or revision, so identical text gives byte-identical files.
- **Statement order.**
  1. PostgreSQL only: `CREATE TYPE` for each choice, in name order.
  2. `CREATE TABLE` in dependency order. Repeat until every table is created: among the tables not yet created, take those whose foreign keys point only at tables already created, or at themselves, and create the one whose name sorts first by code point. When none qualifies, create the remaining table whose name sorts first.
  3. `ALTER TABLE ... ADD CONSTRAINT` for every foreign key whose referenced table was created after its own table, in table creation order, then by constraint name.
  4. `CREATE INDEX` and `CREATE UNIQUE INDEX`, in table creation order, then in index text order.
- **Inside CREATE TABLE.** The body has one item per line, indented two spaces, separated by commas, then `)`. Items in order:
  1. Columns, in text order.
  2. The primary key.
  3. Unique constraints, in column order.
  4. Foreign keys that can be inline, in link text order.

  A column line is the quoted name, the type, ` NOT NULL` when required or key, then ` GENERATED BY DEFAULT AS IDENTITY` (PostgreSQL) or ` AUTO_INCREMENT` (MySQL) for `auto`, then ` DEFAULT <value>`. Default values are written as `'text'` with `'` doubled, numbers as written, `TRUE`, `FALSE`, `NULL`, and `CURRENT_TIMESTAMP` for `now`.
- **Quoting.** PostgreSQL wraps every identifier in double quotes. MySQL wraps every identifier in backticks.
- **Constraint and index names.**

| Construct | PostgreSQL | MySQL |
|---|---|---|
| Primary key | `CONSTRAINT "<t>_pkey" PRIMARY KEY ("a", "b")` | `PRIMARY KEY (`a`, `b`)` |
| Unique column | `CONSTRAINT "<t>_<c>_key" UNIQUE ("<c>")` | `UNIQUE KEY `<t>_<c>_key` (`<c>`)` |
| Foreign key | `CONSTRAINT "<t>_<c>_fkey" FOREIGN KEY ("<c>") REFERENCES "<rt>" ("<rc>")`, then ` ON DELETE CASCADE`, ` ON DELETE RESTRICT`, ` ON DELETE SET NULL` or ` ON DELETE NO ACTION` when set | The same shape with backticks |
| Index | `CREATE [UNIQUE] INDEX "<name>" ON "<t>" ("a", "b")` | `CREATE [UNIQUE] INDEX `<name>` ON `<t>` (`a`, `b`)` |

  An index without a `name:` is named `<t>_<col1>_<col2>_idx`, using every column.
- **Deferred foreign keys.** A foreign key that the statement order moves out of `CREATE TABLE` is written as one statement on a single line. It is `ALTER TABLE`, the quoted table name, ` ADD `, then the foreign-key cell above exactly as written (constraint name, columns, referenced table and column), then the ` ON DELETE ...` suffix when set, then `;`. For example, this text forms a cycle:

  ```
  entity books {
    id int [key]
    shelf_id int
  }
  link books.shelf_id >- shelves.id [delete: set null]

  entity shelves {
    id int [key]
    first_book_id int
  }
  link shelves.first_book_id >- books.id
  ```

  Its PostgreSQL export is:

  ```
  -- Joinery export: PostgreSQL

  CREATE TABLE "books" (
    "id" INTEGER NOT NULL,
    "shelf_id" INTEGER,
    CONSTRAINT "books_pkey" PRIMARY KEY ("id")
  );

  CREATE TABLE "shelves" (
    "id" INTEGER NOT NULL,
    "first_book_id" INTEGER,
    CONSTRAINT "shelves_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shelves_first_book_id_fkey" FOREIGN KEY ("first_book_id") REFERENCES "books" ("id")
  );

  ALTER TABLE "books" ADD CONSTRAINT "books_shelf_id_fkey" FOREIGN KEY ("shelf_id") REFERENCES "shelves" ("id") ON DELETE SET NULL;
  ```

  Its MySQL export is:

  ```
  -- Joinery export: MySQL

  CREATE TABLE `books` (
    `id` INT NOT NULL,
    `shelf_id` INT,
    PRIMARY KEY (`id`)
  );

  CREATE TABLE `shelves` (
    `id` INT NOT NULL,
    `first_book_id` INT,
    PRIMARY KEY (`id`),
    CONSTRAINT `shelves_first_book_id_fkey` FOREIGN KEY (`first_book_id`) REFERENCES `books` (`id`)
  );

  ALTER TABLE `books` ADD CONSTRAINT `books_shelf_id_fkey` FOREIGN KEY (`shelf_id`) REFERENCES `shelves` (`id`) ON DELETE SET NULL;
  ```
- **Choices.** PostgreSQL writes `CREATE TYPE "<choice>" AS ENUM ('<value>', '<value>')`, and a choice column's type is the quoted choice name. MySQL writes the column's type inline as `ENUM('<value>', '<value>')`.
- **Identifier length.** The limit is 63 characters for PostgreSQL and 64 characters for MySQL. A longer identifier, whether written by the author or generated as a constraint or index name, is shortened to its first (limit − 9) characters, then `_`, then the first 8 lowercase hex digits of the SHA-256 of the full identifier.
- **Notes.** These are the only lossy lowerings, and each one gets a note:
  - `many-to-many link <e>.<c> >-< <e>.<c> has no foreign key`
  - `identifier <full> shortened to <short>`
  - `choice <choice> inlined as ENUM on <entity>.<column>` (MySQL)
  - `uuid column <entity>.<column> stored as CHAR(36)` (MySQL)
  - `timestamptz column <entity>.<column> stored as TIMESTAMP` (MySQL)
- **Example.** With worked example 1, the PostgreSQL export is:

  ```
  -- Joinery export: PostgreSQL

  CREATE TABLE "authors" (
    "id" INTEGER NOT NULL GENERATED BY DEFAULT AS IDENTITY,
    "name" VARCHAR(80) NOT NULL,
    CONSTRAINT "authors_pkey" PRIMARY KEY ("id")
  );

  CREATE TABLE "books" (
    "id" INTEGER NOT NULL GENERATED BY DEFAULT AS IDENTITY,
    "title" TEXT NOT NULL,
    "author_id" INTEGER NOT NULL,
    CONSTRAINT "books_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "books_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "authors" ("id")
  );
  ```

- **Export state.** An export record is created as `requested`. The server writes the object, then reads its metadata back from storage and compares the size and SHA-256. Only when they match does the record become `stored`. Any storage failure makes it `failed` and answers the 503.
- **Download lifetime.** A stored export is downloadable until `downloadExpiresAt`, which is the storage time plus `JOINERY_EXPORT_LINK_TTL_SECONDS`. After that it reads as `expired`, judged by the server clock.
- **Rate limit.** Each user may make at most `JOINERY_EXPORT_RATE_LIMIT` export requests in any rolling 60 seconds. Only requests that pass validation count.
- **File name.** The file is named `<slug>-<dialect>.sql`, where `<dialect>` is `postgresql` or `mysql`. The slug is the project name in lower case, with every run of characters other than `a` to `z` and `0` to `9` turned into `-`, trimmed of `-` and cut to 60 characters. An empty slug becomes `schema`.

#### Import

- **Format.** The DDL must be valid UTF-8, or the import fails with `Import is not valid UTF-8 text` at the first bad byte. Comments (`--` to the end of the line, `/* */`, and MySQL `/*! */`) are ignored. Unquoted PostgreSQL names are folded to lower case. Quoted names, and MySQL names, keep their case.
- **Supported statements.** Every statement ends in `;`.
  - `CREATE TYPE <name> AS ENUM ('a', ...)` (PostgreSQL)
  - `CREATE TABLE [IF NOT EXISTS] <name> (...)` with:
    - column constraints `NOT NULL`, `NULL`, `PRIMARY KEY`, `UNIQUE`, `DEFAULT <literal | CURRENT_TIMESTAMP | now()>`, `REFERENCES <t> (<c>) [ON DELETE <action>]`, `GENERATED BY DEFAULT AS IDENTITY`, `GENERATED ALWAYS AS IDENTITY` and `AUTO_INCREMENT`;
    - table constraints `[CONSTRAINT <n>] PRIMARY KEY (...)`, `UNIQUE [KEY <n>] (...)` and single-column `FOREIGN KEY (<c>) REFERENCES <t> (<c>) [ON DELETE <action>]`;
    - MySQL inline `INDEX <n> (...)` and `KEY <n> (...)`;
    - MySQL table options `ENGINE`, `DEFAULT CHARSET`, `CHARSET`, `COLLATE` and `AUTO_INCREMENT=<n>`.
  - `ALTER TABLE <t> ADD [CONSTRAINT <n>] FOREIGN KEY (<c>) REFERENCES <t> (<c>) [ON DELETE <action>]`
  - `CREATE [UNIQUE] INDEX [IF NOT EXISTS] <n> ON <t> [USING BTREE] (<cols>)`
- **Skipped statements.** These are reported as skipped and change nothing: `SET`, `BEGIN`, `COMMIT`, `START TRANSACTION`, `DROP TABLE`, `CREATE EXTENSION`, `CREATE SCHEMA`, `USE`, `LOCK TABLES` and `UNLOCK TABLES`. A statement is skipped when its leading tokens match one of these entries, ignoring letter case.
- **Statement words.** `<WORDS>`, in a skipped report item and in `Unsupported statement: <WORDS>`, is the statement's first two tokens, upper-cased and joined by one space, whether or not they are keywords. A statement with one token uses that token alone. A token is a run of characters other than whitespace, `;`, `(`, `)`, `,` and `=`, with any quotes kept. Examples:
  - `COMMIT;` → `COMMIT`
  - `SET search_path = x;` → `SET SEARCH_PATH`
  - `SET NAMES utf8mb4;` → `SET NAMES`
  - `USE shop;` → `USE SHOP`
  - `DROP TABLE IF EXISTS loans;` → `DROP TABLE`
  - `CREATE VIEW v AS SELECT 1;` → `CREATE VIEW` (unsupported, so the import fails)
- **Type mapping on import.** Matching ignores letter case.

| Imported type | Becomes |
|---|---|
| `integer`, `int`, `int4` | `int` |
| `serial` | `int` with `auto` |
| `smallint`, `int2` | `smallint` |
| `smallserial` | `smallint` with `auto` |
| `bigint`, `int8` | `bigint` |
| `bigserial` | `bigint` with `auto` |
| `numeric(p,s)`, `decimal(p,s)` | `decimal(p,s)` |
| `real`, `float4`, MySQL `FLOAT` | `float` |
| `double precision`, `float8`, MySQL `DOUBLE` | `double` |
| `boolean`, `bool`, `TINYINT(1)` | `bool` |
| `text` | `text` |
| `varchar(n)`, `character varying(n)` | `varchar(n)` |
| `char(n)`, `character(n)` | `char(n)` |
| `date` | `date` |
| `time` | `time` |
| PostgreSQL `timestamp`, MySQL `DATETIME` | `timestamp` |
| PostgreSQL `timestamptz` or `timestamp with time zone`, MySQL `TIMESTAMP` | `timestamptz` |
| `uuid` | `uuid` |
| `json`, `jsonb` | `json` |
| `bytea`, `BLOB`, `LONGBLOB` | `bytes` |
| A PostgreSQL enum type | That choice |
| MySQL `ENUM(...)` | A choice named `<table>_<column>` |

  MySQL integer display widths such as `INT(11)` are accepted.
- **How constraints become Mortise.** A single-column unique constraint becomes the `unique` setting. A multi-column one becomes `index (...) [unique]`. An index whose name equals the default name is written without `name:`. A foreign key becomes a link line owned by the foreign-key table. It is `--` when, in the whole imported model, the foreign-key column has the `unique` setting, is the sole key, or is the sole column of a unique index. Otherwise it is `>-`.
- **Notes.** Each of these goes into `notes`:
  - `Line <line>: constraint name <name> not kept`
  - `Line <line>: table option <OPTION> ignored`
  - `Line <line>: display width on <column> ignored`
  - `Line <line>: GENERATED ALWAYS imported as auto`
- **Import messages.** This is the closed list, in the shared line-and-column format:
  - `Unsupported statement: <WORDS>`
  - `Unsupported clause: <CLAUSE>` (for example `CHECK`, `ON UPDATE`, `ADD COLUMN`, `composite FOREIGN KEY`, `DEFAULT nextval`)
  - `Unsupported type: <TYPE>`
  - `Unknown table in foreign key: <name>`
  - `Unknown table in index: <name>`
  - `Unknown column <table>.<column>`
  - `Duplicate table in import: <name>`
  - `Foreign key points to ambiguous table <name>`
  - `Missing semicolon at end of statement`
  - `Unexpected token <token>`
  - `Unexpected end of text`
  - `Import has more than <limit> statements` (`JOINERY_STATEMENT_LIMIT`)
  - `Nesting is deeper than <limit> levels` (`JOINERY_NESTING_LIMIT`, counting nested parentheses)
  - `Import is not valid UTF-8 text`
  - `Name <name> is longer than 64 characters`

  When the imported model breaks a Mortise rule, the Mortise message is reported at the DDL statement's position. On any error, nothing is stored and nothing changes.
- **Replace mode.** The text becomes the canonical whole text of the imported model. Entities whose names already existed keep their positions. New entities get the next free cells. Report statuses in replace mode are given under Report.
- **Merge mode.** Matching is by exact table name.
  - A matched entity has its block, and the link lines directly after it, replaced in place by the imported canonical block and links. The report marks it `merged`.
  - A matched choice is replaced in place.
  - New choices and entities are appended at the end of the text in statement order, each preceded by one blank line. The report marks them `added`.
  - A table whose name equals an existing entity only when letter case is ignored is `ambiguous` and is not imported. A separate `CREATE INDEX` on an ambiguous table fails the import with `Unknown table in index: <name>`. A foreign key from or to an ambiguous table fails it with `Foreign key points to ambiguous table <name>`.
  - Every other unit stays byte-identical.
  - When the result equals the current text, `changed` is false and no revision is made, so a repeated import creates nothing.
- **Report.** `report` holds one item per statement, in statement order, and nothing else:
  - `CREATE TABLE` has kind `table`, and its name is the table name.
  - `CREATE TYPE` has kind `type`, and its name is the type name.
  - A separate `CREATE INDEX` has kind `index`, and its name is the index name as written.
  - `ALTER TABLE ... ADD ... FOREIGN KEY` has kind `foreign key`, and its name is `<table>.<column>` of the foreign-key column.
  - A skipped statement has kind `statement`, its name is its `<WORDS>`, and its status is `skipped`.

  Keys, indexes and foreign keys written inside a `CREATE TABLE`, and choices made from a MySQL `ENUM(...)`, get no item of their own.
  - **Merge mode statuses.** A table or type is `merged` when an entity or choice with exactly that name existed before the import, and `added` otherwise. An index or foreign key item takes the status of its own table (the index's table, or the table that holds the foreign key). A table that matches only by letter case is `ambiguous`.
  - **Replace mode statuses.** Every table, type, index and foreign key item is `added`, skipped statements stay `skipped`, and nothing is `ambiguous`.
  - **Counts.** `counts.added` and `counts.merged` count only `table` items with that status, so they are entity counts. `counts.skipped` counts `statement` items. `counts.ambiguous` counts `ambiguous` table items.
- **Original bytes.** Every successful import stores the request body, unchanged, in object storage before the text changes. When storage fails, the import answers the 503 and nothing changes.
- **Round trip.** Two schemas have the same model when they define the same entities, columns (type, key, auto, required, unique and default), indexes (columns, unique and name), choices (name and values) and links. For this comparison, `a.x -< b.y` counts as `b.y >- a.x`, and a `>-` link whose left column has the `unique` setting, is the sole key, or is the sole column of a unique index counts as `--`. Importing a PostgreSQL export gives back the same model, apart from many-to-many links. Importing a MySQL export gives back the same model, apart from the constructs its notes list.

#### Sign-in codes

- A code is 6 random digits. It is valid for `JOINERY_CODE_TTL_SECONDS` and works only once.
- A new request for the same email replaces the previous code.
- After 5 wrong attempts the code stops working.
- A new email address creates the user, with the given display name, the first time its code is used.

### Services (DP-29, DP-30, DP-33, DP-38, DP-42, DP-50, DP-60)

- **PostgreSQL** (`DATABASE_URL`) holds users, sessions, sign-in codes, projects, the edit log, layouts, versions, shares, memberships, export records and import records. The app applies its schema idempotently every time it starts serving. When PostgreSQL is unreachable at boot, the app keeps serving and retries every 2 seconds.
- **MinIO** (the `S3_*` variables, path-style when `S3_FORCE_PATH_STYLE` is `true`) holds two kinds of object, both with content type `application/sql`:
  - exports at `exports/<project id>/<export id>-<dialect>.sql`, whose bytes are exactly the export text;
  - import originals at `imports/<project id>/<import id>.sql`, whose bytes are exactly the request body.

  The bucket is `S3_BUCKET`, which the app creates if it is missing. Each operation opens a fresh request, so storage that comes back works again with no restart.
- **Storage outage.**
  - Exports and imports answer the 503 storage body, and export records become `failed`.
  - Downloads answer 503.
  - Editing, layout, versions and shares keep working.
  - Health answers `unavailable`, and the strip shows the storage copy.
- **Mailpit** (`SMTP_HOST`, `SMTP_PORT`, plain SMTP without TLS or authentication) receives every email from `MAIL_FROM`.
  - **Sign-in email:** sent to the person, with subject `Your Joinery sign-in code`. The body has the line `Your Joinery sign-in code is <code>.` and the line `It stops working at <time>.`
  - **Invitation email:** sent to the invitee, with subject `<owner display name> shared "<project name>" on Joinery`. The body has the line `Open it here: <APP_PUBLIC_URL>/s/<token>`, then `This link can view the diagram.` or `This link can edit the diagram.`, then `It stops working at <time>.`

  When `APP_PUBLIC_URL` is not set, links use `http://localhost:<port>`. An email counts as sent only after the SMTP server accepts it.
- **Mail outage.** Code requests answer the 503 mail body. Shares are still created, with their invitation `failed`. Send again works once mail returns, with no restart. Health answers `unavailable`, and the strip shows the mail copy.

### Seed data (DP-06, DP-51)

At start there are no users, projects, shares or exports. Every name in the samples and templates is invented. The following text is built in, byte for byte, with LF line endings and a final LF.

**Hero sample.** The demo starts with every line up to and including `link books.shelf_id >- shelves.id` already shown, and types the rest.

```
# Library loans and shelves
entity shelves {
  id int [key]
  label varchar(40)
}

entity books {
  id int [key]
  title text
  shelf_id int
}
link books.shelf_id >- shelves.id

entity loans {
  id int [key]
  book_id int
  due date
}
link loans.book_id >- books.id
```

**Template `Library loans`** (id `library-loans`; keywords library, books, loans, shelves; description `Shelves, books, members and loans with a loan status choice.`):

```
# Library loans and shelves
choice loan_status { open, returned, overdue }

entity shelves {
  id int [key, auto]
  label varchar(40) [required, unique]
  floor smallint [required, default: 1]
}

entity books {
  id int [key, auto]
  title varchar(200) [required]
  isbn char(13) [unique]
  shelf_id int
}
link books.shelf_id >- shelves.id

entity members {
  id int [key, auto]
  full_name varchar(120) [required]
  joined_on date [required]
}

entity loans {
  id bigint [key, auto]
  book_id int [required]
  member_id int [required]
  status loan_status [required, default: 'open']
  due_on date [required]
  index (book_id, status)
}
link loans.book_id >- books.id
link loans.member_id >- members.id
```

**Template `Greenhouse beds`** (id `greenhouse-beds`; keywords garden, greenhouse, beds, plants; description `Beds and sowings grouped together, with a light level choice.`):

```
# Greenhouse beds
choice light_level { shade, partial, full }

entity beds {
  id int [key, auto]
  code varchar(8) [required, unique]
  light light_level [required, default: 'full']
}

entity sowings {
  id int [key, auto]
  bed_id int [required]
  crop varchar(60) [required]
  sown_on date [required]
}
link sowings.bed_id >- beds.id

group "Growing" { beds, sowings }
```

**Template `Recipe box`** (id `recipe-box`; keywords recipes, cooking, ingredients, food; description `Recipes and ingredients joined through a composite key.`):

```
# Recipe box
entity recipes {
  id int [key, auto]
  title varchar(120) [required]
  serves smallint [default: 2]
}

entity ingredients {
  id int [key, auto]
  name varchar(80) [required, unique]
}

entity recipe_ingredients {
  recipe_id int [key]
  ingredient_id int [key]
  amount decimal(6,2) [required]
  unit varchar(12)
}
link recipe_ingredients.recipe_id >- recipes.id [delete: cascade]
link recipe_ingredients.ingredient_id >- ingredients.id
```

## Technical requirements

### Deployment (DP-53)

Backend: TypeScript on Node 22 with npm. Frontend: TypeScript built with Node 22.

- `/app/run.json` holds the string fields `install`, `build` and `serve`, and `"_schema":"run-manifest-v1"`. For example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```

- The server binds `0.0.0.0` on `APP_PUBLIC_PORT` when it is set, and on 4173 otherwise.
- `GET /api/health` behaves as published in API.
- A single server process serves the built frontend, the API and the live channel. An open-source editor component may power the text pane.

### Configuration and secrets (DP-54, DP-60)

The server reads all of these at start. Credentials are never hard-coded and never sent to the browser.

- **Services:** `DATABASE_URL`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`, `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`.
- **Grading:** `JOINERY_GRADING_KEY` (default empty, which disables the setup route).
- **Timers and limits:**

| Variable | Default |
|---|---|
| `JOINERY_PARSE_DELAY_MS` | 150 |
| `JOINERY_LIVE_MAX_DELAY_MS` | 1000 |
| `JOINERY_PRESENCE_TIMEOUT_SECONDS` | 30 |
| `JOINERY_CODE_TTL_SECONDS` | 600 |
| `JOINERY_SHARE_TTL_SECONDS` | 604800 |
| `JOINERY_EXPORT_LINK_TTL_SECONDS` | 300 |
| `JOINERY_EXPORT_RATE_LIMIT` | 10 |
| `JOINERY_TEXT_LIMIT_BYTES` | 200000 |
| `JOINERY_ENTITY_LIMIT` | 200 |
| `JOINERY_STATEMENT_LIMIT` | 1000 |
| `JOINERY_NESTING_LIMIT` | 32 |
| `JOINERY_TIME_ZONE` | `UTC` (an IANA name, used for displayed times) |

The browser receives only the parse delay it needs, through the page.

### Server boundary (DP-30, DP-42, DP-52, DP-55)

- **Same origin only.** There are no CORS headers. The live channel refuses an upgrade whose Origin does not match the host.
- **Body size.** Any request body over 5,000,000 bytes is refused with 413 and the `too_large` shape before any other check. Text limits follow the published error order.
- **Never served:** source files, source maps, environment files, the run manifest, lockfiles and credentials.
- **Not-found responses.** Unknown routes under `/api` answer the 404 body. Unknown page routes render the not-found page with status 404.
- **Dependencies down at boot.** A dependency that is down at boot never stops the server. It starts, serves pages and health, and uses each dependency when it is next needed.

### Browser support and performance (DP-12, DP-47)

- Supported browsers are the current Chromium, Firefox and WebKit, at 375x812, 768x1024 and 1280x800.
- The landing page and its sample editor accept typing within three seconds of load.
- A project with 200 entities opens within three seconds, and each keystroke shows within a tenth of a second.

## Working rules

- IF-01: `/app/run.json` is a JSON object holding exactly the string fields `install`, `build`, `serve` and `_schema` set to `run-manifest-v1`.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package with its version and licence, plus the self-hosted fonts. Shipped packages means the production dependency tree, as `npm ls --omit=dev --all --json` reports it.
- IF-03: Every shipped package and font uses MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or BlueOak-1.0.0, or OFL-1.1 for fonts.
- IF-04: The app uses no datastore beyond PostgreSQL, MinIO and Mailpit: no SQLite, no Redis or Valkey, and no files used as a database.
- IF-05: The committed `package-lock.json` drives `install` through `npm ci`.
- IF-06: The browser loads nothing from another origin. Fonts, scripts, styles and images are all served by the app.
- IF-07: The provided service configuration and its seeded development credentials stay unchanged.

## Engineering standards

- The TypeScript compiles in strict mode, and domain values carry precise types rather than `any`.
- Names in the code match this brief's terms: entity, column, choice, link, group, layout, revision, unit, version, share, member, export, import.
- Each domain rule is decided in exactly one place in the source, and the server and browser share that one place. This covers parsing and messages, canonical printing, next-free-cell placement, unit merging, export lowering, share and member transitions, access checks and the error order.
- No abstraction has only one implementation.
- There is no dead, commented-out or unreachable code.
- Input is validated at the request boundary, with no defensive checks for states that cannot happen.
- Every API error is built in one place, using the one published shape.
- There are no features beyond this brief.
