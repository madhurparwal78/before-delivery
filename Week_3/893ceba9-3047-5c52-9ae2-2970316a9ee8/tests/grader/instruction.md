# Marlow & Quill Language Works Interline Desk

Interline Desk is a translation management desk for one independent localization engineer who looks after the strings of three to six client apps. It holds each client project's keys, a branch-aware working copy per feature branch, one translation memory per project, AI drafts routed per target language, MQM quality scores, review by invited client reviewers, and publishing of approved locale files to the client's Git repository. It persists everything in Postgres. It keeps uploaded originals, import snapshots and published bundles in MinIO (S3 API). It sends signed webhooks to the client's CI through Svix. It calls a Git host and an AI engine over HTTP; in this build WireMock stands in for both, and every response they give is invented. There are three kinds of access: the seeded owner account, reviewers invited by the owner, and project API tokens for CI. There is no self-registration, no billing, no machine translation of your own, no in-app chat, and no datastore beyond Postgres and MinIO.

## Problem and users

A freelance localization engineer looks after the strings of several client apps. Each client brings a spreadsheet or a TMX file full of old translations, a Git repo whose feature branches rewrite the same locale files, and an AI engine whose drafts vary in quality. Today the engineer migrates old spreadsheets by hand, and exact matches get lost to stray whitespace, casing and placeholder differences. Merges silently overwrite or delete translations when two branches touch one key. A bad import or merge cannot be rolled back to the exact earlier state. Once a tool has normalised the submitted source files, the originals are gone. The big platforms assume a team, a procurement cycle and per-seat pricing. The freelancer pays for the damage in unbilled rework and in client trust.

- **Localization engineer (owner).** The single account that runs every client project, daily. Goal: import a client's legacy TM, branch, draft with routed AI plus human review, merge and publish without losing a string.
- **Client reviewer.** An invited linguist or product owner, weekly. They can see only the projects they were invited to, and they act only on segments assigned to them. Goal: review low-MQM segments and approve or correct them, often from a phone.
- **CI service account.** Holds a project API token, daily. Goal: pull approved locale files and receive signed webhook events when a publish is confirmed and when a review completes.

## Journeys

1. **First run.** Start: a fresh install. The owner opens the landing page, chooses `Open the demo desk`, and signs in with the seeded credentials. End: the dashboard lists the demo project `Larkspur Rider`, the analytics band reads 0 exact matches reused, 1 conflict open, 4 segments below the MQM threshold and 0 publishes confirmed, and the project's branch rail shows `main` and `feature/checkout-redesign`.
2. **Migrate a legacy TM.** Start: the demo project with its six seeded TM entries. The owner imports a client CSV in which casing, spacing and placeholder styles differ from the keys. End: an import report with counts and every row that needs attention listed by line, untranslated main segments filled from exact matches, and the original file downloadable byte for byte. Importing the same file again adds nothing.
3. **Branch, edit and merge.** Start: main plus the seeded branch. The owner creates a branch, renames a key and edits a source string; meanwhile main changes the same source. End: the branch rail shows the conflict, the owner holds and resolves it in the merge screen, requests review, and merges. Main now carries the key's full history across the rename.
4. **Undo.** Start: a just-finished import or merge turned out to be wrong. The owner restores it from the operations list. End: main and the TM read back exactly as before, including values, statuses, scores, issues and comments.
5. **Draft and review.** Start: Japanese segments are untranslated. The owner drafts Japanese with AI; exact TM matches are reused first, and low-scoring drafts go to `Needs review`. The owner invites a client reviewer and assigns them the segments. The reviewer works the queue on a phone using only the keyboard, approving and correcting. End: the assignment completes and the CI endpoint receives a signed `review.completed` event.
6. **Publish.** Start: approved translations on main and a registered CI webhook endpoint. The owner publishes main. End: the publish moves from `Queued` to `Awaiting host confirmation` to `Published as pull request #42.` only after the repository host confirms the pull request. The CI endpoint then receives one signed `locale.published` event, and CI pulls `de.json` with its token.
7. **Erase a client.** Start: a client project the engineer no longer serves. The owner types the slug to confirm and erases it. End: the project is gone from every screen, API, export, bucket and the webhook service, and its URL shows the not-found screen.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Demo workspace at first boot** On first boot against an empty database the app holds exactly the published seed (one owner, one project with three target languages, 40 main keys, one TM with six entries, one open branch and one audit entry) and nothing else, however many instances boot at once.
- **DP-02 — Sign-in and roles** The owner and invited reviewers sign in with email and password into an HttpOnly session, and every endpoint enforces the owner, reviewer and CI token scopes with the published error precedence.
- **DP-03 — Workspace dashboard** The signed-in owner lands on a dashboard whose workspace analytics band, client project wordmark strip and project cards show the server's current figures on every load.
- **DP-04 — Published empty and not-found copy** Empty queues, empty translation memories, unknown or out-of-scope projects and unknown pages show the exact published headings and text, with straight apostrophes.
- **DP-05 — Translation memory imports** The owner imports a TMX or CSV file up to 5,000,000 bytes into a project's TM, and exact matches fill untranslated main segments, as qualified in Business rules.
- **DP-06 — One exact-match rule** Every exact 100% match (import, branch key creation, AI routing and the editor lookup) uses the one published normalisation of case, whitespace and placeholders, and maps placeholders back by position.
- **DP-07 — Duplicates, re-imports and the row report** Duplicate rows merge into one TM entry, re-importing the same file adds nothing, and every row needing attention is reported with its line number and one reason.
- **DP-08 — Imports kept as submitted** Every imported TM file is stored in MinIO byte for byte as submitted and downloads identically.
- **DP-09 — Source locale uploads** The owner uploads a JSON source locale file to an open branch, and the parsed, normalised keys add or update the branch's working copy.
- **DP-10 — Source files downloaded as submitted** An uploaded source locale file is stored in MinIO and downloads byte for byte as submitted, with its original name and content type, whatever normalisation the working copy received.
- **DP-11 — Source edits carry their history** A source edit or rename keeps the key's history across branches and merges, sends translated segments of that key to `Needs review`, and a removed key leaves a placeholder in review queues.
- **DP-12 — Branch lifecycle and limits** Branches move only along the published open, in review, merged and abandoned edges, with at most five open or in-review feature branches per project and exact rejections for every illegal edge.
- **DP-13 — Key edits on a branch** On an open branch the owner creates, renames, edits and deletes keys and edits translations, while closed and in-review branches reject those edits.
- **DP-14 — Branch rail** The project page shows the branch rail as a tablist of main and every open or in-review branch whose panels show the server's merge-preview counts, with `?branch=` in the URL and arrow-key navigation.
- **DP-15 — Branch rail motion** Choosing a branch slides and resizes the underline indicator and crossfades the panels at the published timings, and reduced motion swaps them instantly with the same state.
- **DP-16 — Merge preview figures** The merge preview classifies every key against the branch's base and current main into new, edited, deleted and field-level conflicts, and counts below-threshold segments.
- **DP-17 — Conflict holds and resolution** Resolving a conflict needs a hold by the caller's session that expires on the server clock, and exactly one of several simultaneous hold requests wins.
- **DP-18 — Merge into main** A merge from in review applies every change and resolution to main and never drops or overwrites a translation silently, and unresolved conflicts block it.
- **DP-19 — Merge journey** The owner takes a branch from conflict to merged entirely in the browser, through the branch rail, the merge screen and the resolve dialog.
- **DP-20 — Exact restore** Restoring an import or a merge returns main and the TM to exactly the earlier keys, values, statuses, scores, issues and comments.
- **DP-21 — Restore refused after later changes** A restore is refused once any later change has touched main or the TM, and a second restore of one operation is refused.
- **DP-22 — Project erasure** Erasing a project removes its rows, its MinIO objects, its Svix application, its tokens, its reviewer scopes and its audit entries, leaving one anonymous erasure entry.
- **DP-23 — Audit log retention and export** Every state change writes one audit entry, entries older than the retention period by the server clock are never shown, and the CSV export neutralises formula cells.
- **DP-24 — AI draft routing** Drafting a language on a branch fills each untranslated segment from an exact TM match first and otherwise from the AI engine routed for that language, scoring AI drafts on arrival.
- **DP-25 — MQM scoring and segment states** Segments follow the published untranslated, drafted, scored, needs-review and approved states, with MQM scores computed once by the published formula and threshold.
- **DP-26 — AI engine outage** When the AI engine fails, drafting stops with the published 503 and banner while TM matches already applied stay.
- **DP-27 — Reviewer invitations and scope** The owner invites reviewers per project with a one-time access key, and reviewers see only their projects and act only on segments assigned to them.
- **DP-28 — Review assignments expire** Assignments hold needs-review segments for one reviewer until they expire on the server clock, complete when every live segment is approved, and send `review.completed` on completion.
- **DP-29 — Keyboard-complete review and dialogs** The review queue and every dialog work by keyboard alone: the published shortcuts work from any control in the queue, Tab wraps inside dialogs, Escape closes them, and focus returns to the opener.
- **DP-30 — Segment editor breakpoints** The segment editor shows one column below 768 px, two columns from 768 px up to 1023 px, and three columns from 1024 px up, in the published order, without horizontal overflow.
- **DP-31 — Review journey** A reviewer signs in, works an assignment on a phone-sized screen, approves one segment and corrects another, and the owner sees both approved.
- **DP-32 — Publish confirmed by the repository host** A publish stores its bundles and opens a pull request, and it reads `published` only after the repository host confirms the pull request, as qualified in Business rules.
- **DP-33 — Publish idempotency and one at a time** Publishing needs an Idempotency-Key whose replay returns the stored response, and a project runs at most one publish at a time.
- **DP-34 — Repository host outage** When the repository host is unreachable, every signed-in screen shows the published outage banner and publishes end `failed` with the published reason.
- **DP-35 — Publish journey** The owner publishes main from the project page and watches its status go from queued to published in the browser.
- **DP-36 — CI tokens and locale pull** Project API tokens let CI download each target language's approved strings in the published bundle format, and nothing else.
- **DP-37 — Signed webhook events** Confirmed publishes and completed reviews become one Svix message each, with a stable event id that Svix signs and retries until the CI endpoint acknowledges it.
- **DP-38 — Webhook outage** When Svix is unreachable, events wait in the app with the same event id and are retried on the published interval, endpoint saves return the published 503, and the webhook banner shows.
- **DP-39 — Run manifest and health** The app installs, builds and serves from `/app/run.json` on port 4173 (or `APP_PUBLIC_PORT`) and answers `GET /api/health` with `{"status":"ok"}`.
- **DP-40 — Credentials from the environment** Every service URL and credential is read from the published environment variables at start, never hard-coded and never sent to the browser.
- **DP-41 — Server boundary** The server is same-origin only, enforces the published body limits and content types, serves no source or credential files, and starts even when the Git host, AI engine, Svix or MinIO is unreachable.
- **DP-42 — Landing page** The public landing page shows the hero split with app-collage illustration and floating stat chips, the persona cards with integration-hub diagrams, the security and hosting posture grid and the cookie and data notice, in the published visual language.
- **DP-43 — Working-screen visual language** Dashboards, tables, forms, empty states, banners and loading states use the same white, monochrome, hairline-card language, with colour only in illustration panels and status always spelled out in words.
- **DP-44 — Header, menus and responsive shell** The sticky header with mega-dropdowns, the mobile hamburger menu and the workflow trigger cards carousel follow the published roles, keyboard behaviour and breakpoints at 375x812, 768x1024 and 1280x800.
- **DP-45 — Motion and reduced motion** Hover, press, dropdown, carousel and marquee motion follow the published timings, there are no other loops, and reduced motion makes every transition instant.

## Frontend

### Screens and layout (DP-03, DP-04, DP-14, DP-30, DP-42, DP-44)

Every screen sits in a centred content column about 1290 px wide on desktop, with 24 px side margins on phones. No viewport (375x812, 768x1024, 1280x800) ever scrolls horizontally, except the branch rail strip and the wordmark strip, which scroll inside themselves. Sections alternate white and very light grey bands.

- **Landing (`/`, public).** At the top is a simplified sticky header with the logo, a `Sign in` link and an `Open the demo desk` primary link. Below it:
  - The **Hero split with app-collage illustration and floating stat chips** recast as the landing hero with locale-file cards. On the left, about half the width, is a three-line sentence-case heading, a bold one-line lead and one primary button. On the right is an illustration panel about 600 by 500 px with rounded corners. It holds three overlapping locale-file cards drawn in SVG (a key line, a source line, grey skeleton bars for the target, and a language-code badge) on a faint square grid, plus three floating white stat chips that are real HTML text. On phones the panel moves below the copy and scales to the column width.
  - The **Persona card with integration-hub diagram** recast as the repo-TM-AI hub card. It is a two-card grid in `region "Who works here"` (stacked on phones). Each card opens with an illustration panel holding a horizontal diagram: an app tile, a thin connector, a tray of nine small white tiles (language codes, a TM tile and an AI-route tile), another connector, and an illustrated square avatar (no photographs). Below the panel come the card title, a bold audience line, a body paragraph, a four-item "what matters" list, and an outline link with a trailing arrow.
  - The **Compliance icon grid** recast as the security and hosting posture grid, in `region "Security and hosting"`. It has a centred two-line heading, then twelve borderless items in three columns (two at 768, one on phones). Each item has an icon tile with a thin grey border and a grey line glyph, a title and a one-sentence body. A centred primary `Open the demo desk` button closes the grid.
  - The **Consent dialog** recast as the cookie and data notice: a white panel pinned to the bottom-left on desktop and a full-width bottom sheet on phones, with no scrim.
- **Sign in (`/sign-in`).** One white card, centred, with email, password and a primary button.
- **Dashboard (`/desk`, owner).** At the top is the **Sticky header with mega-dropdowns**, recast as project and workspace navigation. Below it, in order:
  - The heading `Your desk`.
  - The **Trust line + logo marquee** recast as the client project wordmark strip, in `region "Client apps"`. It has one line of text, then a row of client names set as muted text wordmarks.
  - The **Stats band over illustration** recast as the workspace analytics band, in `region "Workspace analytics"`. A full-width band of flat SVG colour blocks sits behind a white card. The card holds four stat columns, each a large tabular numeral over a caption, and a centred outline link `Open audit log` with a trailing arrow. On phones the stats sit two per row.
  - The project cards, one per project, in a two-column grid that becomes one column on phones.
- **Project page (`/projects/<slug>`, owner).** The project name heading comes first. Then:
  - The **Underline tab bar with feature panel** recast as the branch rail, centred under the heading. Its feature panel has two columns: on the left the counts, the list of conflicting keys and the links; on the right an illustration panel with the mini hub diagram of the repository, the TM and the AI route. On phones the panel stacks, the counts come first, and the tab strip scrolls sideways with about two tabs visible.
  - The **Problem/diagnosis card pair** recast as migration health cards. `region "Import health"` and `region "Merge health"` sit side by side (stacked on phones). Each card has a row of three icon tiles, a title, a sentence, a bold `Living with` sub-label, a four-item list of server figures, and a full-width outline link with a trailing arrow.
  - The **Gradient-stroke icon feature grid → mobile carousel** recast as workflow trigger cards, in `region "Workflows"`. Six cards sit in a 3 by 2 grid on the light grey band (2 by 3 at 768). Each card has a gradient-stroke icon tile, a title, a sentence and one button. Below 768 px the grid becomes a one-card carousel with previous and next arrows and six dots.
- **Segment editor (`/projects/<slug>/editor?branch=<branch>&lang=<lang>&segment=<segment id>`).** It has three regions: `region "Segments"` (the key list with status words), `region "Segment editor"` (key name, source, target text box, actions) and `region "Quality and history"` (the MQM score, issues, TM match, comments and status history). The layout:
  - Below 768 px: one column in the order Segment editor, Quality and history, Segments.
  - From 768 px through 1023 px: two columns. Segments sits on the left at about two fifths of the width. On the right, Segment editor is stacked above Quality and history.
  - From 1024 px up: three columns, left to right: Segments, Segment editor, Quality and history.

  At 375x812 the target text box and the action buttons fit the viewport width.
- **Review queue (`/review`, owner and reviewer).** The heading `Review queue` comes first, then a one-line list of keyboard shortcuts, then `region "Review queue"` holding one card per segment. Each card shows the key, the source, the translation, the MQM score, the issue list, the status word, the assignment expiry time and two buttons. Cards are one column at every size.
- **Translation memory (`/projects/<slug>/tm`).** The heading `Translation memory`, the import form, `region "Import report"` (the counts sentence and a borderless table with `Line` and `Reason` columns), the imports list, a search box, and a borderless table of entries.
- **Merge screen (`/projects/<slug>/merge?branch=<branch>`).** The heading `Merge <branch> into main`, the four counts, a borderless conflicts table (key, field, base, main, branch, resolution), the branch action buttons, and the operations list with restore buttons.
- **Project settings (`/projects/<slug>/settings`).** Four cards: reviewers, CI tokens, webhook endpoint and source files. A separate card at the end holds the erase action.
- **Audit log (`/audit`).** A borderless table of entries (time, actor, action, project, detail), newest first, with a `Download CSV` link.
- **Not found.** An unknown or out-of-scope project URL, and any unknown path, render a white card with a heading, one sentence and one link, served with HTTP status 404.

On every signed-in screen, `region "Service status"` sits directly under the header and holds any outage banners. It is empty when all services are up.

### Public screens and controls (DP-02, DP-03, DP-04, DP-14, DP-29, DP-42, DP-44)

Only the controls and regions in this table are public; tests and judges touch nothing else.

| Where | Role and accessible name | Visible copy or content |
|---|---|---|
| Landing | `heading` level 1 | three lines: `Keep every string.` / `Branch without losing one.` / `Publish what you approved.` |
| Landing | lead paragraph | `Translation memory, branches, AI drafts and MQM review for the engineer who runs several client apps alone.` |
| Landing | `link "Open the demo desk"` (hero, header and posture grid) | `Open the demo desk` |
| Landing header | `link "Sign in"` | `Sign in` |
| Landing hero | `img "Three locale files with MQM, match and conflict figures"` | stat chips `MQM 96`, `312 exact matches reused`, `2 branch conflicts open` (example figures, labelled `Example` in small text) |
| Landing | `region "Who works here"` | card titles `The engineer's desk` and `The client reviewer's queue` |
| Landing | `region "Security and hosting"` | heading `How your clients' strings are kept`; item titles `One session cookie`, `Files kept as submitted`, `Exact restore`, `Erasure on request`, `Signed webhooks`, `Scoped reviewer access`, `Per-project CI tokens`, `Six-month audit log`, `Formula-safe exports`, `Same-origin only`, `Your own storage`, `No trackers` |
| Every page, first visit | `region "Cookie and data notice"` | `Interline Desk sets one session cookie to keep you signed in. No tracking or advertising cookies.`; `button "Details"` (outline, reveals one more sentence: `Your choice to hide this notice is remembered in this browser only.`); `button "Got it"` (primary, hides the notice for good in this browser) |
| Sign in | `textbox "Email"`, `textbox "Password"`, `button "Sign in"` | |
| Signed-in header (desktop) | `button "Projects"`, `button "Branches"`, `button "Review"`, `button "Workspace"` (each with `aria-expanded`, opening a dropdown `navigation` of the same name); `link "Audit log"` (owner only); `button "Sign out"`; `button "New project"` (primary, owner only); `link "Import"` (outline, owner only, goes to the TM screen of the current project or the first project); `button "Target language"` (icon, globe glyph, opens `menu "Target language"` of `menuitemradio` items, one per target language of the current project, disabled outside project, editor and review screens) | Reviewers see only `Review`, `Target language` and `Sign out` |
| Dropdowns | `Projects`: one link per project grouped under its client name, plus `New project`. `Branches`: per project, one link per open or in-review branch. `Review`: `Review queue`. `Workspace`: per project, `Translation memory` and `Settings` | |
| Signed-in header (below 768 px) | `button "Open menu"` opens `dialog "Menu"` (full height); inside, the four groups are accordion buttons with the same names, plus `button "Close menu"`, with `New project` and `Sign out` pinned at the bottom | |
| Every signed-in page | `region "Service status"`; `status "Desk updates"` (polite); `alert "Desk problems"` | copy from Feedback states |
| Dashboard | `heading "Your desk"`; `region "Client apps"` | line `Client apps on this desk: <projects>`, one wordmark per distinct client name |
| Dashboard | `region "Workspace analytics"` | captions `Exact matches reused`, `Conflicts open`, `Below MQM threshold`, `Publishes confirmed`; `link "Open audit log"` |
| Dashboard | `link "Open <project name>"` per project card; `dialog "New project"` with `textbox "Slug"`, `textbox "Project name"`, `textbox "Client"`, `textbox "Source language"`, `textbox "Target languages"` (comma-separated codes), `textbox "Repository"`, `spinbutton "MQM threshold"`, `button "Create project"`, `button "Cancel"` | |
| Project page | `tablist "Branches"`; one `tab` per branch named by the branch name, main first, the rest in creation order; `tabpanel` labelled by its tab | main panel captions `Keys`, `Needs review`, `Below MQM threshold`, `Last publish` (value `Never` or `Pull request #<number>`); branch panel captions `New keys`, `Edited keys`, `Conflicts`, `Below MQM threshold`, list heading `Conflicting keys`, empty line `No conflicts with main.` |
| Project page panel | `img "How <branch> connects to the repository, translation memory and AI route"`; `link "Open editor"`; `link "Open merge preview"` (feature branches only) | the diagram's tiles carry the text `<repository>`, `TM <entry count>` and one `<lang> → <engine>` line per target language |
| Project page | `button "New branch"` opens `dialog "New branch"` with `textbox "Branch name"`, `button "Create branch"`, `button "Cancel"` | |
| Project page | `region "Import health"`, `region "Merge health"` | Import health items `Entries added`, `Duplicates merged`, `Exact matches reused`, `Rows needing attention` (from the latest import; with no import, all zero plus the line `No imports yet.`), link `Open import report`. Merge health items `Conflicts open`, `Branches in review`, `Last merge`, `Restorable operations`, link `Open merge preview` |
| Project page | `region "Workflows"` with buttons `Import translation memory`, `Upload source file`, `Draft with AI`, `Assign review`, `Merge a branch`, `Publish`; below 768 px also `button "Previous workflow"`, `button "Next workflow"` and six `button "Show workflow <n>"` dots, the active one with `aria-current="true"` | |
| Project page | `dialog "Upload source file"` (`select "Branch"`, file input `Source file`, `button "Upload"`); `dialog "Draft with AI"` (`select "Branch"`, `select "Language"`, `button "Draft"`); `dialog "Assign review"` (`select "Reviewer"`, `select "Branch"`, `select "Language"`, `button "Assign"`); `dialog "Publish"` (`select "Branch"`, `button "Publish to repository"`); `region "Publish status"` | `Merge a branch` opens the merge screen of the selected tab's branch; `Import translation memory` opens the TM screen |
| Editor | `region "Segments"` with one `button` per key named by the key name, the current one `aria-current="true"`; `region "Segment editor"` with `textbox "Translation (<lang>)"`, `button "Save translation"`, `button "Record MQM issue"`, `button "Score"`, `button "Approve"`; `region "Quality and history"` | score line `MQM <score>` or `Not scored`; TM box heading `Exact match from translation memory` or line `No exact match.` |
| Editor | `dialog "Record MQM issue"` with `combobox "Category"`, `combobox "Severity"`, `textbox "Note"`, `button "Add issue"`, `button "Cancel"` | |
| Review queue | `heading "Review queue"`; shortcut line `Shortcuts: J next, K previous, A approve, C correct.`; `region "Review queue"`; one `article` per segment named by `<key> (<lang>)`; in each, `button "Approve"` and `button "Correct"`; `button "Refresh queue"` | |
| Review queue | `dialog "Correct segment"` with `textbox "Corrected translation"`, `textbox "Comment"`, `button "Save correction"`, `button "Cancel"` | |
| TM screen | `form "Import translation memory"` with file input `Import file`, `combobox "Format"` (`TMX`, `CSV`), `button "Import"`; `region "Import report"`; per import `link "Download original"` and `button "Restore"`; `searchbox "Search translation memory"` | |
| Merge screen | `heading` `Merge <branch> into main`; per conflict `button "Resolve <key> <field>"`; `button "Request review"`; `button "Reopen branch"`; `button "Merge into main"`; `button "Abandon branch"`; per operation `button "Restore"` | |
| Merge screen | `dialog "Resolve conflict"` with `radio "Keep main"`, `radio "Keep branch"`, `radio "Write a new value"`, `textbox "New value"`, `button "Save resolution"`, `button "Cancel"`; `dialog "Restore"` with `button "Restore now"`, `button "Cancel"`; `dialog "Abandon branch"` with `button "Abandon"`, `button "Cancel"` | |
| Settings | `textbox "Reviewer name"`, `textbox "Reviewer email"`, `button "Invite reviewer"`, `region "New access key"`; `textbox "Token label"`, `button "Create token"`, `region "New token"`; `textbox "Endpoint URL"`, `button "Save endpoint"`, text `Signing secret`; per source file `link "Download original"`; `button "Erase project"` opens `dialog "Erase project"` with `textbox "Type the project slug to confirm"`, `button "Erase everything"`, `button "Cancel"` | |
| Audit log | `table "Audit log"`, `link "Download CSV"` | |
| Not found | `heading` and `link` | copy from Feedback states |

### Interactions (DP-14, DP-17, DP-19, DP-29, DP-31, DP-35, DP-44)

- **Signing in.** Enter submits. The owner lands on `/desk` and a reviewer on `/review`. Visiting any signed-in page without a session goes to `/sign-in`, and after sign-in returns to the page first asked for.
- **Branch rail.**
  1. Clicking a tab, or pressing Left or Right while a tab has focus, selects the previous or next tab, wrapping at the ends. Home and End select the first and last tab. Selection follows focus.
  2. The selected tab has `aria-selected="true"` and is the only tab in the Tab order; the others are skipped by Tab. Focus stays on the tab.
  3. The URL query `?branch=<branch name>` updates without a page reload.
  4. While the counts load, the panel shows grey skeleton bars shaped like the counts. The panel then shows the counts from the merge preview, fetched afresh each time a tab is selected.
  5. Opening `/projects/<slug>?branch=<name>` selects that tab. An unknown or closed branch selects `main` and rewrites the URL to `?branch=main`.
  6. On phones the strip scrolls the selected tab into view.
- **Header dropdowns.** Enter, Space or a click toggles a dropdown. Escape closes it and returns focus to its button, and so does a click outside. Only one is open at a time. Down Arrow from an open button moves into the panel's first link.
- **Mobile menu.** `Open menu` opens the sheet with focus on `Close menu`. The groups open and close like accordions.
- **Dialogs (every dialog in the table, the mobile menu included).** Opening a dialog puts focus on its first field or, when it has no field, its first button. Tab from the last control goes to the first, and Shift+Tab from the first goes to the last. Escape or `Cancel` closes the dialog without saving. Every way of closing returns focus to the control that opened it. A successful save closes the dialog and returns focus to the opener. A rejected save keeps the dialog open and moves focus to the first field with an error.
- **Review queue keyboard.** One card is the current segment: it is outlined and carries `aria-current="true"`, and it is the first card when the queue loads. The shortcuts work whenever focus is anywhere inside `region "Review queue"`, a button included, but not while a text box has focus. They are single letters, either case, with no modifier.
  - J makes the next card current and moves focus to its `Approve` button. K does the same for the previous card.
  - A approves the current card.
  - C opens `Correct segment` for the current card. When that dialog closes, focus returns to the current card's `Correct` button.

  Approved cards stay in the list showing `Approved` until the queue refreshes. The queue refreshes on `Refresh queue`, on page load and every 15 seconds; a refresh drops approved and expired cards and keeps the current card if it is still listed.
- **Editor.** Choosing a key in Segments loads it and updates `?segment=`. Ctrl+Enter (Cmd+Enter on macOS) inside the translation box saves. Approve is enabled only when the segment's status allows it for the signed-in role.
- **Merge screen.** Each `Resolve <key> <field>` button first asks the server for a hold and then opens `Resolve conflict`. If the hold is refused, the dialog does not open and the refusal shows. `Write a new value` enables the `New value` box.
- **Workflow trigger cards carousel (below 768 px).** The arrow buttons and dots move one card at a time. Swiping left or right moves one card. The dot for the visible card is filled.
- **Wordmark strip.** It scrolls only when the wordmarks are wider than the strip. Hover or focus inside the strip pauses it.
- **Publish status.** After `Publish to repository`, `region "Publish status"` checks the publish every 2 seconds until it is published or failed.
- **Touch.** Every button, link, tab and dot is at least 44 by 44 px to touch.

### Visual design (DP-42, DP-43)

The design direction is `seed`: airy like a white studio wall, exact like a ruled ledger, calm like a quiet review desk.

- **Typefaces.** Figtree sets display and body text. Inter sets small UI labels: tabs, the notice, chip text and table headers. Both fonts are self-hosted. Counts and MQM scores use tabular figures, so the digits line up in columns.
- **Colour roles.**
  - The page ground is pure white.
  - Alternating section bands and card fills on those bands are a very light cool grey.
  - Text is a deep blue-black ink.
  - Primary buttons are a near-black fill with white labels.
  - Card borders and table dividers are a light grey hairline.
  - Outline buttons and the tab rail line use a mid grey.
  - Colour appears only in illustration panels and icon-tile strokes. The panels carry a soft gradient from pale peach through pale pink to pale lilac with a faint white square grid over it. Icon tiles carry a thin stroke graded from soft coral to soft violet.
- **Scale.** Each heading step is about one fifth larger than the step below it. The hero heading is about two and a half times the body size on desktop and smaller on phones.
- **Density.** Comfortable: generous section padding on desktop, tighter on phones, and spacing in steps of four pixels.
- **Composition.** The content column is centred. The hero is split half and half. The header is sticky: tall on desktop and short on phones, plain white, and it gains a hairline bottom border once the page scrolls. Sections alternate white and light grey bands.
- **Working screens.** These use the same language: hairline-bordered cards with generously rounded corners on white and light grey bands, buttons and inputs with softly rounded corners, and near-black primary buttons. Tables are borderless rows separated by hairlines.
- **Status.** Segment, branch and publish status is always a word (`Untranslated`, `Drafted`, `Scored`, `Needs review`, `Approved`; `Open`, `In review`, `Merged`, `Abandoned`; `Queued`, `Awaiting host confirmation`, `Published`, `Failed`), sometimes with a shape (an outlined or filled small square). Status never relies on colour alone.
- **Empty states.** A small gridded illustration panel with an SVG locale card, a heading, one sentence and one button.
- **Errors and outage banners.** White cards with a heavy ink-coloured left edge and a bold text label before the sentence.
- **Loading.** Static grey skeleton bars shaped like the collage's bars.
- **Focus.** Visible as a dark outline set slightly off the control.
- **Contrast.** All text meets WCAG 2.2 AA contrast against its background.

### Motion and effects (DP-15, DP-45)

- **Branch rail (signature).** When a new tab is chosen:
  1. The short black underline under the selected label slides from the old label to the new one and changes to the new label's width in about a fifth of a second (200 milliseconds), starting fast and settling softly.
  2. At the same moment the old panel fades out over about 150 milliseconds.
  3. After a 50 millisecond pause the new panel fades in over about 200 milliseconds.
  4. On phones the strip scrolls the chosen tab into view over about 300 milliseconds.

  Choosing the previous tab plays the same steps in the other direction. The counts, URL and ARIA state change at the moment of choosing, not after the motion.
- **Buttons.** On hover a primary button darkens slightly and an outline button fills with a faint grey, in about 200 milliseconds. A trailing arrow nudges a few pixels right in the same time and returns when the pointer leaves. Disabled controls are faded to about 40% and do not react.
- **Dropdowns and accordions.** The chevron turns half a revolution in about 200 milliseconds as the panel opens, and turns back as it closes. The hamburger's three bars fold into a cross in about 200 milliseconds.
- **Header.** The hairline border appears as soon as the page has scrolled a little (about 10 px) and disappears when the page returns to the top.
- **Carousel.** Cards slide sideways in about 300 milliseconds.
- **Wordmark strip.** When it scrolls, one pass takes about 20 seconds at a constant speed. It pauses on hover and while focus is inside it, and it stops for good after two passes.
- **No other loops.** The wordmark strip is the only repeating motion. Skeleton bars do not shimmer. There are no decorative loops, parallax effects or WebGL.
- **Reduced motion.** When the system asks for reduced motion:
  - The branch rail indicator jumps to the new tab at once.
  - The panels swap with no fade.
  - The phone strip jumps to the tab instead of scrolling.
  - Chevrons, the hamburger and carousel cards change state at once.
  - Hover feedback changes colour at once with no arrow nudge.
  - The wordmark strip never moves.

  Counts, URL, ARIA state and focus behave exactly as with motion.

### Feedback states (DP-04, DP-26, DP-34, DP-38)

Every async action shows its pending copy in `status "Desk updates"` and disables its button while it waits. Success copy also goes to `status "Desk updates"`. Failure copy goes to `alert "Desk problems"` and also appears next to the field or control involved. Field errors show the server's `fields` message under each field. Placeholders: `<project name>`, `<branch>`, `<filename>`, `<key>`, `<reviewer name>` and `<language>` come from the record, where `<language>` is the language code. `<n>` and the other count placeholders are the integers the API returns. `<time>` is the server time shown in the browser's local 24-hour `HH:MM`. All apostrophes are straight.

| Action | Pending | Success | Failures |
|---|---|---|---|
| Sign in | `Signing you in.` | (navigates) | 401: `That email and password don't match.` |
| Create project | `Creating project.` | `Created <project name>.` | `slug_taken` on Slug: `That slug is already used by another project.` |
| Create branch | `Creating branch.` | `Created branch <branch>.` | `branch_exists` on Branch name: `A branch with that name already exists.`; `branch_limit`: `This project already has five open branches. Merge or abandon one first.`; bad name: `Use lowercase letters, digits, slashes, hyphens or underscores.` |
| TM import | `Importing translation memory.` | `Imported <added> new entries, merged <duplicates> duplicates and reused <applied> exact matches.`, followed when rows exist by `<n> rows need attention.` | 413: `That file is larger than 5,000,000 bytes.`; bad CSV header: `The spreadsheet needs source, target and target_language columns.`; unreadable TMX: `That TMX file can't be read.` |
| Source file upload | `Uploading source file.` | `Stored <filename> as submitted: <added> keys added, <changed> changed, <unchanged> unchanged.` | 413 as above; bad JSON: `The file must be a JSON object whose values are all strings.` |
| Save key or translation | `Saving.` | `Saved <key>.` | `key_exists`: `Another key on this branch already has that name.`; `branch_not_open`: `This branch is in review, so keys and translations are locked.`; `branch_closed`: `This branch is merged or abandoned, so it can't change.` |
| Draft with AI | `Drafting <language> segments.` | `Drafted <ai_drafted> segments with AI and reused <tm_reused> exact matches.` | 503: the AI engine banner sentence |
| Score or record issue | `Recording MQM issues.` | `Scored MQM <score>.`, or when below threshold `Scored MQM <score>. Sent to review.` | |
| Approve | `Approving.` | `Approved.` | `illegal_transition`: `That change isn't allowed from <status word>.`; `assignment_expired`: `This assignment expired. Ask the engineer to assign it again.`; `key_removed`: `This key was removed on <branch>.` |
| Correct | `Saving correction.` | `Correction saved and approved.` | same as Approve |
| Assign review | `Assigning segments.` | `Assigned <n> segments to <reviewer name> until <time>.` | `no_segments_to_review`: `There are no unassigned segments that need review in <language> on <branch>.` |
| Hold conflict | `Holding conflict.` | `Holding this conflict for you until <time>.` | `conflict_held`: `This conflict is being resolved in another session until <time>.` |
| Save resolution | `Saving resolution.` | `Resolution saved.` | `hold_required`: `Your hold on this conflict ran out. Hold it again to resolve it.` |
| Request review / reopen / abandon | `Updating branch.` | `Branch <branch> is <state word>.` | `illegal_transition`: `That change isn't allowed from <state word>.` |
| Merge | `Merging <branch> into main.` | `Merged <branch> into main.` | `conflicts_unresolved`: `Resolve every conflict before merging. <n> left.` |
| Restore | `Restoring.` | `Restored the state before this <import or merge>.` | `restore_superseded`: `Later changes were made after this, so it can't be restored exactly.`; `already_restored`: `This was already restored.` |
| Publish | `Publish queued.`, then `Waiting for the repository host to confirm the pull request.` | `Published as pull request #<number>.` | `git_host_unavailable`: `Publish failed: the repository host isn't answering.`; `pull_request_rejected`: `Publish failed: the repository host rejected the pull request.`; `not_confirmed`: `Publish failed: the repository host didn't confirm the pull request.`; `publish_in_progress`: `Another publish is still running for this project.` |
| Save webhook endpoint | `Saving endpoint.` | `Webhook endpoint saved.` | 503: `The webhook service isn't answering. The endpoint wasn't saved; try again in a few minutes.` |
| Create token | `Creating token.` | `Token created. Copy it now; it won't be shown again.` | |
| Invite reviewer | `Inviting reviewer.` | new reviewer: `Invited <reviewer name>. Copy the access key now; it won't be shown again.`; existing reviewer: `Added <reviewer name> to this project.` | `reviewer_exists`: `That reviewer already has access to this project.` |
| Erase project | `Erasing project.` | `Erased <project name> and every stored file.` | wrong slug: `Type the project slug exactly to confirm.` |
| Any upload while MinIO is down | | | 503: `File storage isn't answering. Nothing was saved; try again in a few minutes.` |
| Any request that cannot reach the server | | | `The desk couldn't reach the server. Check your connection and try again.` |

**Outage banners.** These appear in `region "Service status"` on every signed-in screen, for owner and reviewer alike, while the probe in Services reports the service down. Each banner's text is announced once in `alert "Desk problems"` when it appears.

- Label `Repository host outage`, text `The repository host isn't answering. Publishing will fail until it's back; your strings are safe here.`
- Label `AI engine outage`, text `The AI engine isn't answering. Exact matches from translation memory still apply; other segments stay untranslated.`
- Label `Webhook outage`, text `Webhook delivery is paused. Events are kept and sent once the service is back.`

**Empty and not-found states.**

- Review queue, reviewer: heading `Nothing to review right now`, text `When the engineer assigns segments to you, they'll show up here.`, button `Refresh queue`.
- Review queue, owner: the same heading, text `Segments that score below a project's MQM threshold land here.`, button `Refresh queue`.
- Translation memory: heading `No translation memory yet`, text `Import a TMX file or a spreadsheet to start reusing exact matches.`, button `Import translation memory`.
- Audit log: heading `Nothing in the audit log yet`.
- Unknown or out-of-scope project: heading `We couldn't find that project`, text `It may have been erased, or the link is wrong.`, link `Back to your desk` for the owner and `Back to your review queue` for a reviewer.
- Any other unknown page: heading `We couldn't find that page`, with the same link.
- A queue card whose key was removed shows `This key was removed on <branch>.` in place of the source, and its buttons are disabled.

## Backend

### API (DP-02, DP-05, DP-07, DP-09, DP-10, DP-12, DP-13, DP-16, DP-17, DP-18, DP-20, DP-21, DP-22, DP-23, DP-24, DP-25, DP-27, DP-28, DP-32, DP-33, DP-36, DP-38, DP-39)

**General rules**

- All JSON is UTF-8 with `Content-Type: application/json`. Times are UTC in the form `2026-11-04T09:30:00Z`. Ids are lowercase UUIDs.
- `{slug}` is the project slug. `{branch}` is the branch name, percent-encoded in paths (a slash becomes `%2F`); the server decodes it. `main` is always present.
- Sessions use the HttpOnly, SameSite=Lax cookie `desk_session`, valid for 12 hours.
- CI endpoints accept only `Authorization: Bearer <token>`, and no other endpoint accepts a token.

**Error shape.** Every error uses one shape: `{"error":{"code":"<code>","message":"<sentence>","details":{...}}}`, where `details` is optional. Validation errors use `422 {"error":{"code":"validation_failed","message":"...","fields":{"<field>":"<message>"}}}`.

**Error precedence.** This one order covers the whole API:

1. 413 `payload_too_large`
2. 401 `unauthenticated`
3. 404 `not_found` (unknown resource, or a project or segment outside the caller's scope)
4. 403 `forbidden` (a reviewer calling an owner-only endpoint inside their scope)
5. 415 `unsupported_media_type`
6. an idempotent replay returns its stored response
7. 409 state conflicts
8. 422 validation
9. 503 dependency failures

**Error catalogue.** Every code and its status, stated once here:

| Status | Codes |
|---|---|
| 401 | `unauthenticated`, `invalid_credentials` (sign-in only) |
| 403 | `forbidden` |
| 404 | `not_found` |
| 409 | `slug_taken`, `branch_exists`, `branch_limit`, `branch_not_open`, `branch_closed`, `illegal_transition` (details `{"from","to"}`), `key_exists`, `conflict_held` (details `{"held_until"}`), `hold_required`, `conflicts_unresolved` (details `{"conflicts":[ids]}`), `restore_superseded`, `already_restored`, `assignment_expired`, `key_removed`, `no_segments_to_review`, `publish_in_progress`, `idempotency_key_reused`, `reviewer_exists` |
| 413 | `payload_too_large` |
| 415 | `unsupported_media_type` |
| 422 | `validation_failed` |
| 503 | `ai_engine_unavailable` (details `{"tm_reused","ai_drafted"}`), `webhooks_unavailable`, `storage_unavailable` |

**Record shapes**

- **Project:** `{"id","slug","name","client","source_language","target_languages":[...],"repository","mqm_threshold","ai_routes":{"<lang>":"<engine>"},"created_at"}`.
- **Branch:** `{"name","state":"open"|"in_review"|"merged"|"abandoned","is_main","created_at"}`. Main always reports `open`.
- **Segment summary:** `{"segment_id","value":string|null,"status","score":int|null}`. Status is one of `untranslated`, `drafted`, `scored`, `needs_review`, `approved`.
- **Segment:** `{"id","project","branch","key_id","key","source","language","value","status","score","origin":"seed"|"tm"|"ai:<engine>"|"manual"|"review"|null,"issues":[{"category","severity","note"}],"comments":[{"id","author","body","at"}],"history":[{"at","actor","from","to","value"}],"removed"}`.
- **Conflict:** `{"id":"<key_id>:<field>","key_id","key","field":"name"|"source"|"presence"|"translation:<lang>","base","main","branch","resolution":null|{"choice","value","by","at"},"held_until":null|time}`.
- **Publish:** `{"id","branch","state":"queued"|"awaiting_host_confirmation"|"published"|"failed","failure_reason":null|"git_host_unavailable"|"pull_request_rejected"|"not_confirmed","languages","pull_request":null|{"number","url"},"bundles":{"<lang>":{"object_key","sha256"}},"created_at","confirmed_at"}`.
- **Operation:** `{"id","kind":"import"|"merge","label","at","restored_at","restorable"}`.
- **Assignment:** `{"id","reviewer_id","branch","language","segment_ids","state":"active"|"completed"|"expired"|"cancelled","expires_at"}`.
- **Event:** `{"event_id","type","state":"pending"|"sent","attempts","created_at","sent_at"}`.
- **Audit entry:** `{"id","at","actor","action","project","detail"}`.

**Platform and session**

| Method and path | Who | Request | Success |
|---|---|---|---|
| GET `/api/health` | anyone | | 200 `{"status":"ok"}` once the schema is applied and the seed exists; before that 503 `{"status":"starting"}` |
| POST `/api/session` | anyone | `{"email","password"}` | 200 `{"user":{"id","name","email","role":"owner"|"reviewer"}}` and sets the cookie; wrong pair 401 `invalid_credentials` |
| DELETE `/api/session` | session | | 204, clears the cookie |
| GET `/api/me` | session | | 200 the user |
| GET `/api/integrations` | session | | 200 `{"git_host":"up"|"down","ai_engine":"up"|"down","webhooks":"up"|"down"}` |
| GET `/api/workspace/stats` | owner | | 200 `{"projects","exact_matches_reused","conflicts_open","below_threshold","publishes_confirmed"}` |
| GET `/api/audit` | owner | | 200 `{"entries":[audit entry]}`, newest first |
| GET `/api/audit.csv` | owner | | 200 `text/csv; charset=utf-8`, header row `at,actor,action,project,detail` |

**Projects**

| Method and path | Who | Request | Success |
|---|---|---|---|
| GET `/api/projects` | session | | 200 `{"projects":[project]}`; reviewers get only their projects |
| POST `/api/projects` | owner | `{"slug","name","client","source_language","target_languages","repository","mqm_threshold"?,"ai_routes"?}` | 201 project, with an empty main branch and an empty TM; `slug_taken` |
| GET `/api/projects/{slug}` | session in scope | | 200 project plus `"branches":[branch],"tm_entries":<n>,"last_publish":publish|null` |
| PATCH `/api/projects/{slug}` | owner | any of `{"name","client","ai_routes"}` | 200 project |
| DELETE `/api/projects/{slug}` | owner | `{"confirm":"<slug>"}` | 204; a mismatch is 422 on `confirm` |

Validation for projects:

- `slug` matches `^[a-z0-9][a-z0-9-]{1,39}$`.
- `name` and `client` are 1 to 80 characters.
- Language codes match `^[a-z]{2,3}(-[A-Z]{2})?$`.
- `target_languages` has 1 to 10 distinct codes, none equal to the source.
- `repository` matches `^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`.
- `mqm_threshold` is an integer from 0 to 100 inclusive; the default is 90, and it is fixed after creation.
- `ai_routes` maps target codes to engine names matching `^[a-z0-9-]{1,40}$`; the default is `lexa-general` for every target.

**Branches, keys and segments**

| Method and path | Who | Request | Success |
|---|---|---|---|
| GET `/api/projects/{slug}/branches` | owner | | 200 `{"branches":[branch]}`, including closed ones |
| POST `/api/projects/{slug}/branches` | owner | `{"name"}` | 201 branch, a copy of current main; `branch_exists`, `branch_limit` |
| POST `/api/projects/{slug}/branches/{branch}/transitions` | owner | `{"to":"in_review"|"open"|"abandoned"}` | 200 branch; `illegal_transition` |
| GET `/api/projects/{slug}/branches/{branch}/keys?lang=<lang>` | owner | | 200 `{"keys":[{"id","name","source","translations":{"<lang>":segment summary}}]}`, live keys in name order; without `lang`, every target language |
| POST `/api/projects/{slug}/branches/{branch}/keys` | owner | `{"name","source"}` | 201 key; `key_exists`, `branch_not_open`, `branch_closed` |
| PATCH `/api/projects/{slug}/branches/{branch}/keys/{key_id}` | owner | any of `{"name","source"}` | 200 key; the same errors |
| DELETE `/api/projects/{slug}/branches/{branch}/keys/{key_id}` | owner | | 204; the same errors |
| GET `/api/projects/{slug}/keys/{key_id}/history` | owner | | 200 `{"key_id","revisions":[{"at","branch","field":"created"|"name"|"source"|"deleted"|"merged"|"restored","from","to","actor"}]}` in time order |
| GET `/api/segments/{id}` | owner, or a reviewer the segment was ever assigned to | | 200 segment |
| PUT `/api/segments/{id}/value` | owner | `{"value"}` | 200 segment; `branch_not_open`, `branch_closed` |
| POST `/api/segments/{id}/score` | owner | `{"issues":[{"category","severity","note"?}]}` (an empty list is allowed) | 200 segment; `illegal_transition` |
| POST `/api/segments/{id}/issues` | owner | `{"category","severity","note"?}` | 201 segment (adds one issue and rescores); `illegal_transition` |
| POST `/api/segments/{id}/approve` | owner or assigned reviewer | `{}` | 200 segment; `illegal_transition`, `assignment_expired`, `key_removed` |
| POST `/api/segments/{id}/correct` | owner or assigned reviewer | `{"value","comment"?}` | 200 segment; the same errors |
| POST `/api/segments/{id}/comments` | owner or assigned reviewer | `{"body"}` | 201 `{"id","author","body","at"}` |
| POST `/api/projects/{slug}/branches/{branch}/drafts` | owner | `{"language"}` | 200 `{"tm_reused","ai_drafted"}`; `branch_not_open`, `branch_closed`, `ai_engine_unavailable` |
| POST `/api/projects/{slug}/tm/match` | owner | `{"source","language"}` | 200 `{"match":null|{"entry_id","source","target","reused_value"}}` |

Validation for keys, segments and comments:

- Key `name` matches `^[A-Za-z0-9_.-]{1,120}$`.
- `source` is 1 to 2,000 characters and not only whitespace.
- A translation `value` is 1 to 4,000 characters.
- A comment `body` is 1 to 2,000 characters.
- An issue `note` is up to 500 characters.
- `category` is one of `accuracy`, `fluency`, `terminology`, `style`, `locale-convention`.
- `severity` is one of `minor`, `major`, `critical`.
- Branch names match `^[a-z0-9][a-z0-9/_-]{0,62}$` and are never `main`.

**Merge, holds and restore**

| Method and path | Who | Request | Success |
|---|---|---|---|
| GET `/api/projects/{slug}/branches/{branch}/merge-preview` | owner | | 200 `{"branch","state","keys","needs_review","new_keys","edited_keys","deleted_keys","conflicts":[conflict],"below_threshold"}`; `keys` is the branch's live key count and `needs_review` its live segments in `needs_review`, both real for every branch including main; for main, `new_keys`, `edited_keys` and `deleted_keys` are 0 and `conflicts` is empty, while `keys`, `needs_review` and `below_threshold` are real counts (with the seed data at start, 40, 2 and 2). The project page's main panel reads `Keys`, `Needs review` and `Below MQM threshold` from this response |
| POST `/api/projects/{slug}/branches/{branch}/conflicts/{conflict_id}/hold` | owner | `{}` | 200 `{"conflict_id","held_until"}`; `conflict_held`, `branch_closed` |
| PUT `/api/projects/{slug}/branches/{branch}/conflicts/{conflict_id}` | owner | `{"choice":"main"|"branch"|"custom","value"?}` (`value` is required for `custom`) | 200 conflict; `hold_required`, `conflict_held`, `branch_closed` |
| POST `/api/projects/{slug}/branches/{branch}/merge` | owner | `{}` | 200 `{"merge_id","new_keys","edited_keys","deleted_keys","conflicts_resolved"}`; `illegal_transition`, `conflicts_unresolved` |
| GET `/api/projects/{slug}/operations` | owner | | 200 `{"operations":[operation]}`, newest first |
| POST `/api/projects/{slug}/operations/{op_id}/restore` | owner | `{}` | 200 operation; `restore_superseded`, `already_restored` |

**Translation memory and source files.** Uploads are `multipart/form-data` with a file part `file`. A TM import also takes a text part `format` with `tmx` or `csv`.

| Method and path | Who | Success |
|---|---|---|
| GET `/api/projects/{slug}/tm?lang=<lang>&q=<text>` | owner | 200 `{"entries":[{"id","source","target","target_language","import_id"}],"total"}`; `q` matches normalised source text |
| POST `/api/projects/{slug}/tm/imports` | owner | 201 `{"import_id","filename","format","size","sha256","object_key","added","duplicates","applied","rows":[{"line","reason"}]}`, with rows sorted by line |
| GET `/api/projects/{slug}/tm/imports` | owner | 200 `{"imports":[{"import_id","filename","format","size","sha256","at","restored_at"}]}` |
| GET `/api/projects/{slug}/tm/imports/{import_id}/original` | owner | 200, the bytes as submitted |
| POST `/api/projects/{slug}/branches/{branch}/source-files` | owner | 201 `{"file_id","filename","content_type","size","sha256","object_key","keys_added","keys_changed","keys_unchanged"}`; `branch_not_open`, `branch_closed` |
| GET `/api/projects/{slug}/source-files` | owner | 200 `{"files":[{"file_id","branch","filename","content_type","size","sha256","at"}]}` |
| GET `/api/projects/{slug}/source-files/{file_id}/original` | owner | 200, the bytes as submitted, with `Content-Type` the content type of the uploaded part (or `application/octet-stream` when it had none) and `Content-Disposition: attachment; filename="<filename>"` |

**Review**

| Method and path | Who | Request | Success |
|---|---|---|---|
| GET `/api/projects/{slug}/reviewers` | owner | | 200 `{"reviewers":[{"id","name","email"}]}` |
| POST `/api/projects/{slug}/reviewers` | owner | `{"name","email"}` | a new email gives 201 `{"id","name","email","access_key"}`; an email that is already a reviewer elsewhere gives 200 with `"access_key":null`; `reviewer_exists` |
| DELETE `/api/projects/{slug}/reviewers/{id}` | owner | | 204; cancels the reviewer's active assignments in this project |
| POST `/api/projects/{slug}/assignments` | owner | `{"reviewer_id","branch","language"}` | 201 assignment; `no_segments_to_review`, `branch_closed` |
| GET `/api/projects/{slug}/assignments` | owner | | 200 `{"assignments":[assignment]}` |
| GET `/api/review-queue?lang=<lang>` | session | | 200 `{"segments":[{"segment_id","project","branch","language","key","source","value","status","score","issues","assignment_id","expires_at","removed"}]}`; a reviewer gets their active assignments; the owner gets every needs-review segment plus segments in active assignments |

**Publish, CI and webhooks**

| Method and path | Who | Request | Success |
|---|---|---|---|
| POST `/api/projects/{slug}/publishes` | owner | header `Idempotency-Key` (1 to 64 visible ASCII characters), body `{"branch"}` | 202 publish in state `queued`; `publish_in_progress`, `branch_closed`, `idempotency_key_reused`; a missing or bad key is 422 on `Idempotency-Key` |
| GET `/api/projects/{slug}/publishes` | owner | | 200 `{"publishes":[publish]}`, newest first |
| GET `/api/projects/{slug}/publishes/{id}` | owner | | 200 publish |
| GET `/api/projects/{slug}/tokens` | owner | | 200 `{"tokens":[{"id","label","created_at"}]}` |
| POST `/api/projects/{slug}/tokens` | owner | `{"label"}` (1 to 80 characters) | 201 `{"id","label","token"}`; the token starts with `idk_` and is shown only once |
| DELETE `/api/projects/{slug}/tokens/{id}` | owner | | 204 |
| GET `/api/ci/projects/{slug}/locales/{lang}.json` | token of that project | | 200 `application/json; charset=utf-8`, main's approved strings in the bundle format; a token of another project is 404 |
| PUT `/api/projects/{slug}/webhook` | owner | `{"url"}` (an absolute `http` or `https` URL) | 200 `{"url","event_types":["locale.published","review.completed"],"signing_secret"}`; `webhooks_unavailable` |
| GET `/api/projects/{slug}/webhook` | owner | | 200 the same shape, or `not_found` when none is set |
| GET `/api/projects/{slug}/events` | owner | | 200 `{"events":[event]}` |

### Business rules (DP-01, DP-05, DP-06, DP-07, DP-09, DP-11, DP-12, DP-13, DP-16, DP-17, DP-18, DP-20, DP-21, DP-22, DP-23, DP-24, DP-25, DP-27, DP-28, DP-32, DP-33, DP-36, DP-37, DP-38)

**Exact-match normalisation.** This is the one rule for every exact 100% match. Two strings match when their normalised forms are equal byte for byte. To normalise:

1. Apply Unicode NFC.
2. Replace every placeholder with `{}`. Placeholders are `{name}`, `{{name}}`, `%s`, `%d`, `%@`, `%<n>$s` and `%<n>$d`, where `name` is letters, digits and underscores and `<n>` is digits.
3. Lowercase with full Unicode lowercasing.
4. Turn every run of whitespace (space, tab, line breaks, no-break space) into one space, and trim both ends.

For example, `Total:   {amount}`, `total: %s` and ` TOTAL: {{sum}} ` all match.

**Placeholder mapping.** When a TM entry fills a segment, the reused value is the TM target with every occurrence of the TM source's i-th placeholder token replaced by the key source's i-th placeholder token. Tokens in the target that the TM source does not have stay as they are. For example, TM source `Hi %1$s, you have %2$d items` with target `%2$d Artikel für %1$s`, reused for the key source `Hi {name}, you have {count} items`, gives `{count} Artikel für {name}`.

**Where exact matches are reused.** The same match fills segments in three places:

- A TM import fills untranslated main segments.
- Creating a key, or changing its source on any branch by edit or upload, fills that key's untranslated segments.
- AI drafting tries TM first.

A filled segment becomes `drafted`, with origin `tm`, no score, and no AI call. When several TM entries match, the oldest entry wins.

**TM imports.**

- The TM holds one entry per (target language, normalised source, normalised target).
- **CSV:** UTF-8 with an optional BOM, comma-separated, double-quote quoting. The header row must hold the columns `source`, `target` and `target_language` in any order, and may also hold `note`. Line numbers count from 1 at the header, so the first data row is line 2. A quoted field with line breaks takes the line number where its record starts.
- **TMX:** each `<tu>` holds one `<tuv>` per language, with its language in `xml:lang` (or `lang`) and the text in `<seg>`. Inline elements inside `<seg>` contribute their text. The source `tuv` is the one whose primary language subtag equals the project's source language. Every other `tuv` is one row whose line is the line of its `<tu>` opening tag. A target code matches a project target exactly first, then by primary subtag (`de-DE` imports as `de`).
- **Row outcomes.** Each row gets exactly one outcome, checked in this order:
  1. `missing_source`: the source is empty.
  2. `missing_target`: the target is empty.
  3. `unknown_language`: the target language is not a project target.
  4. Duplicate: the same normalised source, language and normalised target already exist in the TM or earlier in the file. The row is counted in `duplicates` and adds nothing.
  5. `conflicting_target`: the same normalised source and language exist with a different normalised target. The existing entry is kept and the row is not added.
  6. Otherwise the row is added. If no live main key's source matches it, it is also reported as `no_matching_key`.

  `rows` lists every row reported with a reason. `added` counts new entries.
- **Applying matches.** After adding entries, the import runs the apply step over every entry in the project's TM, including entries from earlier imports and the seeded entries, not only the entries this import added. It fills untranslated main segments from exact matches as described above. `applied` counts the segments filled. For example, with the seed data at start, a first import that adds nothing relevant still gives `applied` 6: `Remove` (de and fr), `Checkout` (de), `Total: {amount}` (de) and `Sign out` (de and fr).
- **Re-imports.** Importing the same file a second time reports `added` 0 and `applied` 0, with every earlier added row now counted in `duplicates`.
- **Snapshots.** Each import is an operation. Before it changes anything, the import snapshots the TM and the main branch.

**Source locale files.**

- The file must be a JSON object, with an optional UTF-8 BOM.
- Nested objects flatten to dotted key names, and every leaf must be a string. Arrays, numbers, booleans, nulls, duplicate member names and flattened names that fail the key-name pattern are rejected with 422 on `file`.
- In the working copy only, each value is trimmed of whitespace at both ends.
- A key absent from the branch is created (`keys_added`). A key whose trimmed value differs from the branch's source has its source changed (`keys_changed`). Equal values count as `keys_unchanged`. Keys on the branch that the file lacks are untouched.
- The stored original is never altered.

**Source edits and history.**

- Every key has a stable id shared across branches.
- Creating, renaming, editing the source of and deleting a key each add a revision to the key's history. A merge adds a `merged` revision and brings the branch's revisions into main's history. A restore adds a `restored` revision.
- History follows the key id, so it survives renames.
- When a key's source changes, every segment of that key on that branch that has a value moves to `needs_review`, keeping its value, score and issues, and its history records `source changed`.
- Deleting a key removes it from key lists and drafts. A segment of a deleted key that is in an active assignment stays in that queue with `removed: true` and `source: null`, and approving or correcting it is rejected with `key_removed`.

**Branch states.**

- A feature branch starts `open`.
- Legal moves: open to in_review, in_review to open, open to abandoned, in_review to abandoned (all through transitions), and in_review to merged (only through merge). Every other move, including any move of `main`, is rejected with `illegal_transition`.
- Merged and abandoned are final. Any change on a final branch is rejected with `branch_closed`.
- Key edits, translation values, drafts and source uploads need `open`; on `in_review` they are rejected with `branch_not_open`.
- Scoring, approving, correcting, comments, holds and resolutions are allowed in `open` and `in_review`.
- A project has at most five feature branches in `open` or `in_review`; creating a sixth is rejected with `branch_limit`.
- Names are unique across all branches of a project, closed ones included.
- A new branch's base is a copy of main at creation, keeping key ids. Its segments are copies with new segment ids.

**Merge preview.** The preview compares each key across the branch's base, the branch and current main, field by field. The fields are `name`, `source`, `presence` and each `translation:<lang>` (the segment's value; its status, score, issues and comments travel with the value).

- **Conflict:** a field changed on both sides to different values. Also a conflict: a key deleted on one side and changed on the other (`presence`), and a merge that would leave two live keys with the same name (`name` on the branch's key).
- **New key:** created on the branch.
- **Edited key:** a base key changed on the branch with no conflicting field.
- **Deleted key:** a base key deleted on the branch without conflict.
- **below_threshold:** the number of the branch's live segments whose score is below the project threshold.
- Workspace `conflicts_open` is the number of unresolved conflicts over every open or in-review branch.
- Workspace `below_threshold` sums below-threshold segments over main and every open or in-review branch.
- Workspace `exact_matches_reused` counts live segments whose current value has origin `tm`.
- Workspace `publishes_confirmed` counts publishes in state `published`.

**Holds and resolutions.**

- A hold belongs to the session that took it and lasts `CONFLICT_HOLD_SECONDS` by the server clock (default 300 seconds).
- Holding again from the same session renews the hold. A hold request while another session's hold is active is rejected with `conflict_held`. Of several simultaneous hold requests, exactly one wins.
- Saving a resolution needs an active hold by the caller (otherwise `hold_required`) and releases the hold.
- `main` keeps main's value, `branch` keeps the branch's value, and `custom` writes `value`.
- A resolution records the main value it saw. If main changes that field afterwards, the resolution is void and the conflict is unresolved again.

**Merge.**

- A merge needs `in_review`. From `open` it is rejected with `illegal_transition`.
- The merge recomputes the preview. Any unresolved conflict rejects it with `conflicts_unresolved`.
- Otherwise, in one transaction, the merge:
  - snapshots main as an operation;
  - adds new keys with their segments;
  - applies edits and deletions;
  - applies resolutions;
  - marks the branch `merged`.
- Where both sides hold the same value, main's segment is kept. No main value changes except through a branch edit that main did not touch, or through a resolution.
- Of two simultaneous merges of one branch, one succeeds and the other is rejected with `illegal_transition`.

**Restore.**

- Restoring an operation brings main and the TM back to the operation's snapshot exactly. That covers key ids and names, sources, segment ids, values, statuses, scores, origins, issues and comments, compared byte for byte. The only additions are the `restored` history revisions.
- Restoring a merge also returns its branch to `in_review` with its resolutions.
- Restoring an import removes the entries it added. Its stored original stays.
- A restore is refused with `restore_superseded` if any later change has touched main or the TM: a key or segment change, a comment, an import, a merge or another restore.
- A second restore of the same operation is rejected with `already_restored`.

**Segment states and MQM.**

- Legal moves:
  - untranslated to drafted: a TM fill or a manual value.
  - untranslated to scored or needs_review: an AI draft, which records drafted and then the score in history.
  - drafted to scored or needs_review: scoring.
  - scored to needs_review: a rescore or added issue below threshold, or a source change.
  - scored or needs_review to approved: approve. needs_review to approved: correct (a `scored` segment can be approved but not corrected).
  - any status with a value to drafted: a new manual value, which clears issues and score.
  - approved to needs_review: a source change.
- Every other move (approving `untranslated` or `drafted`, scoring `untranslated` or `approved`, correcting anything but `needs_review`) is rejected with `illegal_transition`.
- A reviewer may approve or correct only `needs_review` segments in their own active assignment. When the assignment has expired, those actions are rejected with `assignment_expired`.
- **Scoring:**
  - Penalty points are 1 for minor, 5 for major and 25 for critical.
  - Word count is the number of whitespace-separated tokens in the key source, placeholders included.
  - The score is 100 minus 100 times the penalty total divided by the larger of the word count and 10. It is rounded half up to an integer, with a floor of 0.
  - A score at or above the threshold gives `scored`; below it gives `needs_review`.

  For example, with the seed data at start, one major issue on `Welcome back, {name}.` scores 50.
- Approving keeps the score. Correcting replaces the value, sets origin `review`, appends the optional comment and keeps the issues for the record.

**AI drafting.**

- Drafting walks the branch's live, untranslated segments in one language, in key-name order.
- Each segment is filled from an exact TM match when there is one. Otherwise the app calls the engine routed for that language with the key source.
- The returned draft becomes the value, with origin `ai:<engine>`. Returned issues with a known category and severity are recorded, and the segment is scored at once.
- The first engine failure stops the run with `ai_engine_unavailable`. Its `details` carry the counts so far, and every segment already filled stays filled.

**Reviewers and assignments.**

- A reviewer is one account per email across the workspace, with a scope of projects. The first invitation creates the account and an access key (`rvk_` followed by 24 random letters and digits), which is the reviewer's password. Later invitations from other projects only add scope. Inviting an email already in this project's scope is rejected with `reviewer_exists`.
- An assignment takes every `needs_review` segment of one branch and language that is not in another active assignment, and lasts `ASSIGNMENT_TTL_SECONDS` by the server clock (default 172800 seconds). With none to take, it is rejected with `no_segments_to_review`. Of simultaneous assignment requests for one branch and language, exactly one gets the segments.
- When every live segment in an assignment is approved, the assignment becomes `completed` and one `review.completed` event is queued.
- After `expires_at` the assignment reads `expired`, and its segments return to the unassigned queue still `needs_review`.

**Publish.**

- A publish takes `main` or an open or in-review branch.
- It writes one bundle per project target language, holding the branch's approved strings:
  - a JSON object of flat dotted key names to values, keys sorted by Unicode code point;
  - two-space indentation, `": "` between key and value, non-ASCII characters written as themselves, a trailing newline;
  - `{}` plus a newline when empty.
- It stores the bundles, then asks the Git host to open a pull request (state `queued`).
  - A 201 with an integer `number` moves it to `awaiting_host_confirmation`.
  - A 4xx ends it `failed` with `pull_request_rejected`.
  - A connection error, timeout or 5xx is retried up to three attempts, 2 seconds apart, then ends `failed` with `git_host_unavailable`.
- In `awaiting_host_confirmation` the app reads the pull request every 2 seconds.
  - A 200 with the same `number` and state `open` or `merged` makes it `published`, sets `confirmed_at`, and queues one `locale.published` event.
  - No such answer within 30 seconds of entering this state ends it `failed` with `not_confirmed`.
- A publish is carried out by the server instance that accepted it.
- **Idempotency.** The key and the request body are stored with the first response. The same key with the same body returns that stored status and body. The same key with a different body is rejected with `idempotency_key_reused`. Keys are scoped per project.
- **One at a time.** A project has at most one publish in `queued` or `awaiting_host_confirmation`. Of simultaneous publish requests with different keys, exactly one gets 202 and the rest get `publish_in_progress`.

**CI pull.** The CI endpoint returns the bundle bytes built from main's current approved strings, exactly as a publish would write them. Revoked tokens get 401.

**Events.**

- An event is queued only when the project has a webhook endpoint.
- Its `event_id` is `evt_pub_<publish id>` or `evt_rev_<assignment id>`. That id is the Svix message id and the idempotency key, so retries never create a second message.
- The app sends pending events at once, then retries every `WEBHOOK_RETRY_SECONDS` (default 10 seconds) until Svix accepts. Each attempt counts in `attempts`. Events are sent by the server instance that queued them.

**Erasure.**

- Deleting a project removes every row that holds the project's id or slug: keys, segments, history, TM, imports, source file records, branches, merges, operations, holds, assignments, tokens, idempotency records, events and audit entries.
- It removes every MinIO object under the project's prefix and deletes its Svix application. If Svix is unreachable, the app retries that deletion every `WEBHOOK_RETRY_SECONDS` until it succeeds.
- Reviewers lose the project from their scope. A reviewer left with no project can no longer sign in.
- One audit entry with action `project.erased` and empty project and detail fields is written.
- Afterwards every API path under the slug returns `not_found`, and the slug can be reused.

**Audit log.**

- Every state change writes exactly one entry, with an action named `<area>.<verb>` (for example `branch.merged`).
- The actor is the user's email, `system` or `ci:<token label>`.
- Entries older than `AUDIT_RETENTION_SECONDS` by the server clock (default 15,811,200 seconds, which is 183 days, the six-month retention) are never returned by either audit endpoint, and are deleted within 60 seconds.
- In the CSV, any cell that begins with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading `'`. Cells are quoted where needed, and rows end with CRLF.

**First boot.**

- On serve, the app applies its schema idempotently.
- Against a database with no workspace, it writes the Seed data exactly once, even when several instances boot at once against the same database.
- Nothing else is ever pre-loaded: no test records, sample reviewers or extra projects.

### Services (DP-08, DP-10, DP-22, DP-24, DP-26, DP-32, DP-34, DP-37, DP-38)

- **Postgres** (`DATABASE_URL`) holds every record above. The app connects as a non-superuser owner of its database.
- **MinIO** (`S3_*`) uses the bucket `S3_BUCKET` with path-style addressing. Object keys:
  - TM originals: `projects/<project id>/imports/<import id>`
  - source originals: `projects/<project id>/source-files/<file id>`
  - snapshots: `projects/<project id>/snapshots/<operation id>.json`
  - bundles: `projects/<project id>/publishes/<publish id>/<lang>.json`

  Originals and bundles are stored byte for byte, with the submitted content type. When MinIO is unreachable, uploads, imports, merges, restores and publishes are rejected with `storage_unavailable` and change nothing.
- **Svix** (`SVIX_URL`, `SVIX_API_KEY`):
  - Saving a project's endpoint creates or reuses the application with uid `idk-<project id>` (named after the project) and one endpoint for the URL, subscribed to `locale.published` and `review.completed`.
  - `signing_secret` is that endpoint's Svix secret.
  - Messages carry `eventType` and `eventId` equal to `event_id`, and the payload. Svix signs each delivery and retries failed deliveries on its own schedule.
  - `locale.published` payload: `{"event_id","type":"locale.published","project":"<slug>","branch","publish_id","pull_request":{"number","url"},"languages":[...],"bundles":{"<lang>":"<sha256 hex>"},"published_at"}`.
  - `review.completed` payload: `{"event_id","type":"review.completed","project","branch","language","assignment_id","reviewer_id","segments_approved","completed_at"}`.
- **Git host.** The base URL is `GIT_HOST_URL`, falling back to `WIREMOCK_URL` when unset. Every call times out after 5 seconds. The data is invented; the stand-in answers every repository.
  - `GET /git/v1/health` returns 200 `{"status":"ok"}`.
  - `POST /git/v1/repos/<owner>/<repo>/pulls` takes `{"title":"Interline Desk publish <publish id>","head":"interline/<publish id>","base":"main","files":[{"path":"locales/<lang>.json","content":"<base64 bundle>"}]}` and returns 201 `{"number":42,"html_url":"https://git.example.test/larkspur-cycles/rider-app/pull/42","state":"open"}`.
  - `GET /git/v1/repos/<owner>/<repo>/pulls/<number>` returns 200 `{"number":42,"state":"open","merged":false}`.
  - `<owner>/<repo>` is the project's `repository`. `pull_request.url` is the returned `html_url`.
- **AI engine.** The base URL is `AI_ENGINE_URL`, falling back to `WIREMOCK_URL` when unset. Every call times out after 5 seconds. The data is invented; the stand-in returns the same draft for every segment of a language.
  - `GET /ai/v1/health` returns 200 `{"status":"ok"}`.
  - `POST /ai/v1/draft?engine=<engine>&source=<source lang>&target=<target lang>` takes the body `{"key":"<key name>","text":"<source>"}` and returns 200 `{"draft":"<text>","issues":[{"category","severity","note"}]}`.
  - Baseline answers:
    - `target=de`: draft `Entwurf der Lexa-Testmaschine` with one issue `fluency`, `minor`, note `Word order reads stiffly.`
    - `target=fr`: draft `Ébauche de la machine d'essai Lexa` with no issues.
    - `target=ja`: draft `レクサ試験エンジンの下書き` with one issue `accuracy`, `major`, note `Meaning drifts from the source.`
  - Any connection error, timeout, non-200 status or body without a string `draft` counts as a failure.
- **Health probes.** `/api/integrations` reports `git_host` from the Git health call, `ai_engine` from the AI health call, and `webhooks` from `GET <SVIX_URL>/api/v1/health/`. Each is `up` only on a 200 within 5 seconds. Results are cached for at most 15 seconds. Every signed-in page reads them on load and every 15 seconds, and shows or hides the banners from Feedback states.

### Seed data (DP-01)

Every person, business, app and repository below is invented.

- **Owner:** name `Robin Achterberg`, email `robin@marlowquill.example`, password `interline-demo-2026`.
- **Project:** slug `larkspur-rider`, name `Larkspur Rider`, client `Larkspur Cycles`, source `en`, targets `de`, `fr`, `ja`, repository `larkspur-cycles/rider-app`, MQM threshold 90, AI routes `de` → `lexa-general`, `fr` → `lexa-general`, `ja` → `lexa-formal`.
- **Main keys** (40, each with one `created` revision; key 32 also has a `source` revision from `Order summary` to `Basket summary`):

| # | Key | Source |
|---|---|---|
| 1 | `app.title` | `Larkspur Rider` |
| 2 | `nav.home` | `Home` |
| 3 | `nav.rides` | `Rides` |
| 4 | `nav.garage` | `Garage` |
| 5 | `nav.profile` | `Profile` |
| 6 | `home.greeting` | `Welcome back, {name}.` |
| 7 | `home.weekly_distance` | `You rode {distance} km this week.` |
| 8 | `home.start_ride` | `Start a ride` |
| 9 | `rides.empty` | `No rides yet.` |
| 10 | `rides.filter.all` | `All rides` |
| 11 | `rides.filter.month` | `This month` |
| 12 | `rides.detail.duration` | `Duration` |
| 13 | `rides.detail.elevation` | `Elevation gain` |
| 14 | `rides.detail.share` | `Share ride` |
| 15 | `garage.add_bike` | `Add a bike` |
| 16 | `garage.service_due` | `Service due in {days} days` |
| 17 | `garage.tyre_pressure` | `Tyre pressure` |
| 18 | `garage.chain_wear` | `Chain wear` |
| 19 | `profile.edit` | `Edit profile` |
| 20 | `profile.units` | `Units` |
| 21 | `profile.units.metric` | `Metric` |
| 22 | `profile.units.imperial` | `Imperial` |
| 23 | `profile.sign_out` | `Sign out` |
| 24 | `settings.notifications` | `Notifications` |
| 25 | `settings.privacy` | `Privacy` |
| 26 | `settings.language` | `Language` |
| 27 | `cart.title` | `Your basket` |
| 28 | `cart.empty` | `Your basket is empty.` |
| 29 | `cart.item_count` | `{count} items` |
| 30 | `cart.remove` | `Remove` |
| 31 | `checkout.title` | `Checkout` |
| 32 | `checkout.summary.title` | `Basket summary` |
| 33 | `checkout.shipping` | `Shipping` |
| 34 | `checkout.total` | `Total: {amount}` |
| 35 | `checkout.cta.pay` | `Pay now` |
| 36 | `checkout.success` | `Thanks, {name}. Your order is on its way.` |
| 37 | `errors.network` | `Check your connection and try again.` |
| 38 | `errors.payment_declined` | `Your payment was declined.` |
| 39 | `errors.generic` | `Something went wrong.` |
| 40 | `legal.terms` | `Terms of service` |

- **Main translations.** All carry origin `seed`. Every other main segment is `untranslated`, with a null value and score.
  - `de`, keys 1 to 12, `approved`, score 100, no issues: `Larkspur Rider`, `Start`, `Fahrten`, `Garage`, `Profil`, `Willkommen zurück, {name}.`, `Du bist diese Woche {distance} km gefahren.`, `Fahrt starten`, `Noch keine Fahrten.`, `Alle Fahrten`, `Diesen Monat`, `Dauer`.
  - `fr`, keys 1 to 8, `approved`, score 100: `Larkspur Rider`, `Accueil`, `Sorties`, `Garage`, `Profil`, `Bon retour, {name}.`, `Vous avez roulé {distance} km cette semaine.`, `Démarrer une sortie`.
  - `ja`, keys 1 to 5, `approved`, score 100: `Larkspur Rider`, `ホーム`, `ライド`, `ガレージ`, `プロフィール`.
  - `ja`, key 6: `ようこそ、{name}。`, `needs_review`, score 50, one issue `accuracy`/`major`, note `Drops "back" from the greeting.`
  - `ja`, key 7: `今週は{distance}km走りました。`, `needs_review`, score 80, issues `fluency`/`minor` note `Unit reads awkwardly.` and `style`/`minor` note `Casual register on a formal route.`
  - So main has de 12 approved and 28 untranslated, fr 8 approved and 32 untranslated, ja 5 approved, 2 needs review and 33 untranslated.
- **Translation memory** (six entries, no import): `Remove` → de `Entfernen`; `Remove` → fr `Retirer`; `Checkout` → de `Kasse`; `Total: {amount}` → de `Summe: {amount}`; `Sign out` → de `Abmelden`; `Sign out` → fr `Se déconnecter`. None has been applied at start; the first import's apply step uses them (see Business rules).
- **Branch `feature/checkout-redesign`, state `open`:**
  - Its base is main with key 32's source `Order summary`. It copies every main segment as above.
  - It edits key 35's source to `Pay and finish`.
  - It edits key 32's source to `Your order`.
  - It adds `checkout.saved_card` (`Pay with a saved card`) and `checkout.promo.label` (`Promo code`), each with three untranslated segments.
  - It has 42 live keys.
  - Its merge preview at start: `new_keys` 2, `edited_keys` 1, `deleted_keys` 0, one unresolved conflict `<key 32 id>:source` (base `Order summary`, main `Basket summary`, branch `Your order`), and `below_threshold` 2.
- **Everything else:** no reviewers, assignments, tokens, webhook endpoint, imports, source files, operations, publishes or events. One audit entry with action `workspace.seeded` and actor `system`. Nothing in MinIO or Svix.
- **Figures at start.** The workspace stats read projects 1, exact matches reused 0, conflicts open 1, below threshold 4, publishes confirmed 0. Main's panel reads keys 40, needs review 2, below threshold 2, last publish `Never`.

## Technical requirements

### Deployment (DP-39)

Backend: Go 1.27 with Go modules. Frontend: TypeScript built with Node 22 in the same `build` step and served by the Go server as static assets.

- The images ship Go 1.27, Node 22 and build-essential, and nothing more. Install no system library; talk plain HTTP to every service. Browser-side WASM is not allowed.
- Commit `go.sum` and the npm lockfile.
- `/app/run.json` holds the string fields `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example: `{"_schema":"run-manifest-v1","install":"go mod download && npm ci","build":"npm run build && go build -o bin/interline-desk .","serve":"./bin/interline-desk"}`.
- `serve` binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set.
- `GET /api/health` answers as in API, and returns 200 `{"status":"ok"}` within 60 seconds of serve on a healthy stack.
- Further copies of the app may run at once against the same database with different environment values.

### Configuration and secrets (DP-40)

The app reads all of these at start:

- Postgres: `DATABASE_URL`.
- MinIO: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
- Svix: `SVIX_URL`, `SVIX_API_KEY`.
- WireMock and the stand-ins: `WIREMOCK_URL`, plus the optional `GIT_HOST_URL` and `AI_ENGINE_URL`.
- Time rules, each a whole number of seconds: `ASSIGNMENT_TTL_SECONDS` (default 172800), `CONFLICT_HOLD_SECONDS` (default 300), `AUDIT_RETENTION_SECONDS` (default 15811200), `WEBHOOK_RETRY_SECONDS` (default 10).

No credential or service URL is hard-coded, logged, written to an API response other than the endpoint `signing_secret`, or sent to the browser. Owner and reviewer passwords are stored only as slow salted hashes, and tokens only as hashes.

### Server boundary (DP-41)

- The browser talks only to the app's own origin. The app sets no CORS headers that allow other origins, and loads no fonts, scripts or images from elsewhere.
- **Body limits:**
  - JSON bodies may be up to 1,000,000 bytes (exactly 1,000,000 is allowed).
  - An uploaded file may be up to 5,000,000 bytes (exactly 5,000,000 is allowed), and a whole multipart request up to 5,100,000 bytes.
  - Anything larger gets `payload_too_large`.
- **Content types:** JSON endpoints require `application/json` and upload endpoints require `multipart/form-data`. Anything else gets `unsupported_media_type`.
- **Never served:** Go or TypeScript sources, source maps, `run.json`, environment files, lockfiles or anything under a dot-directory. These return the not-found page with 404.
- **Boot:** the server starts and serves pages even when the Git host, the AI engine, Svix or MinIO is unreachable; each failure shows only in its own actions and banners. While Postgres is unreachable at boot, the server retries every 2 seconds and health reports `starting`.
- Unknown API paths return `not_found` in the error shape.

### Browser support and performance (DP-30, DP-44)

- The current Chromium, Firefox and WebKit at the viewports 375x812, 768x1024 and 1280x800.
- Every signed-in screen is usable within three seconds on a local stack with the seed data.
- The branch rail panel shows its counts within one second of choosing a tab.
- No interaction leaves the page unresponsive for more than half a second.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` fields and `"_schema":"run-manifest-v1"`, and the app runs only through it.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package and every bundled font with its licence. Shipped packages are the Go modules the program imports plus the npm production dependency tree (`npm ls --omit=dev --all --json`).
- IF-03: Every shipped package and bundled font is under MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC, 0BSD, MPL-2.0, Unicode-3.0 or OFL-1.1.
- IF-04: Postgres and MinIO are the only datastores. No SQLite, embedded key-value store, Redis or local files hold application state.
- IF-05: The provided service configuration and its credentials are left exactly as given.
- IF-06: `go.sum` and the npm lockfile are committed, and the build installs only from them.

## Engineering standards

- The Go code is idiomatic: errors are wrapped with context and returned rather than panicking, contexts carry request deadlines to Postgres, MinIO and HTTP calls, and code is formatted with `gofmt`.
- Names in code match the domain terms of this brief: segment, key, branch, base, conflict, hold, assignment, TM entry, exact match, MQM score, publish, operation, restore.
- Each domain rule is decided in exactly one place: the exact-match normalisation, the MQM score, each state machine's legal moves, the merge classification, the bundle format and the error precedence. Every caller uses that single decision.
- No interface or abstraction has only one implementation, unless it exists to replace an external service.
- There is no dead, commented-out or unreachable code, and no defensive checks for states the rules make impossible.
- Every API error is produced through the one error shape in API.
- There are no features, endpoints, screens or settings beyond this brief.
