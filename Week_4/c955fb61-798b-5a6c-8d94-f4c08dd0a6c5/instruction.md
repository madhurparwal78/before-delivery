# Slackwater Instruments Slackwater Plan

Slackwater Plan is a Gantt-chart planner for small teams that run real projects without a project office, such as a product launch, an office move, a festival or a research study. A project holds tasks, milestones and one level of groups on a working-day calendar that skips weekends and the project's own holidays. Tasks are joined by four kinds of dependency link, each with a lag. The server works out every date, the critical path, the float, the group progress, the variance against a saved baseline and each person's workload, then pushes the result to everyone who has the project open. The editing person and everyone watching see the knock-on of each move at the same moment. Build it in TypeScript on Node. It uses exactly three backing services: Postgres stores every record, MinIO stores the CSV and PDF exports, and Mailpit receives the assignment notices. Out of scope: AI features, time tracking, third-party integrations, outside sign-in, paid plans, email invitations, share links, any other datastore, queue or cache, and any external PDF service. The app renders its PDFs itself.

## Problem and users

Small teams need what professional schedulers have. They need dependencies that push later work along, a calendar that skips weekends and public holidays, a critical path, and a baseline that shows how far the work has slipped. Today they choose between two bad options. One is a spreadsheet, where changing one date breaks every formula after it. The other is a large Gantt suite sized for a programme office, with dependencies and baselines locked behind premium tiers. When a date moves in a spreadsheet, nobody can say which tasks are now critical, how far the finish has drifted from the promised date, or who is now booked for twelve hours on one day. The team pays for this in evenings spent re-typing dates after a supplier slips by three days, and in people who hear about a new assignment too late.

- **Project owner** (daily): builds and re-plans a project with tasks, milestones, groups, dependencies, holidays, a baseline and exports.
- **Editor** (weekly): edits the shared project live, moves and resizes tasks, updates percent complete, comments, and hears about new assignments by email.
- **Viewer** (occasional): reads the chart, the critical path, the baseline comparison and the workload on a phone or laptop, and exports, without changing anything.

In this brief "owner", "editor" and "viewer" are a person's role in a workspace. A workspace holds projects and members.

## Journeys

1. **Build a plan from the list.** Start: the owner is signed in on an empty project. The owner opens the List view. Using only the keyboard, they type task names one after another on the `Add task` row, set durations, write predecessors such as `1FS+1`, make a group, move rows up and into the group, and correct a bad predecessor entry. End: the chart shows every bar on its computed dates, an editor watching the same project saw each row arrive, and a reload shows the same plan.
2. **Re-plan by pointer around a holiday.** Start: the owner has the example project "Spring launch" open on a laptop. They drag Review brief onto a Saturday and watch it snap to the Monday. They stretch it across the Founders Day holiday, cancel one drag with Escape, and add a new holiday from the Holidays dialog. End: the dependents have moved by the right number of working days, each result was announced, and every date survives a reload.
3. **Re-plan by keyboard and link without a mouse.** Start: the owner has a project open. They Tab into the chart, nudge a bar with the Arrow keys, resize it with Shift and the Arrow keys, press L to link two tasks, and hear every result. A viewer in another browser who tries the same keys hears that they cannot change the plan. End: focus is still on the bar the owner moved, and the viewer's plan is unchanged.
4. **A supplier slips.** Start: the owner and an editor both have "Spring launch" open, and a baseline is saved. The owner moves Draft brief three working days later. End: both screens show the pushed dates, the new critical path, the new finish and the variance against the baseline. Moving it back lets every dependent return to its own chosen start and no earlier.
5. **Update progress on a phone.** Start: an editor opens the project on a phone. They read the timeline cards, tap Update progress on a task, drag the slider with a thumb, and save. End: the card and its group show the new percent, and the owner's laptop shows the change without a reload.
6. **Balance the work and tell people.** Start: the owner has the Workload view open. An editor assigns Asha Rao to an overlapping task. End: the owner sees two over-allocated days appear in place. After the configured delay the assignee receives one email that links straight to the task, and the comments posted on the task appear live for everyone who has it open.
7. **Two editors, one task.** Start: two editors have the same project open and can see each other in `People here`. One is typing in the Task details dialog when the other moves the same task. End: the typing editor keeps their unsaved text and focus. When they save, they are told who changed the task first and are shown the current values, and their second save succeeds.
8. **Export, even on a bad day.** Start: the owner and a viewer have the project open. Each of them exports CSV and PDF from the Export menu. End: each download link appears only once the file is stored, and the exports are still listed after a reload. While file storage is down, the same export shows the outage alert and no link.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health** `/app/run.json` installs, builds and serves the app on port 4173, and `GET /api/health` answers 200 with `{"status": "ok"}` in every grading instance, as qualified in Deployment.
- **DP-02 — Grading setup route** `POST /api/grading/setup` with the grading key builds the people, workspace, projects, items, links, assignments and baseline it is given and returns their ids, as specified in API.
- **DP-03 — Sign-in and sign-up** People create an account at `/signup`, sign in at `/signin` or through `POST /api/session`, and every page and API call other than the public ones requires a session.
- **DP-04 — Server-owned today and late flag** Today comes from the server's configuration, served by `GET /api/config`, and the today line and every late flag follow it whatever the browser's clock says.
- **DP-05 — Request limits and error order** Every API error follows the one published precedence and body shape, with the body-size and content-type limits from Server boundary.
- **DP-06 — Working-day calendar** Starts, ends and durations count only the project's working days, a start on a non-working day moves to the next working day, and every screen date uses the published format.
- **DP-07 — Project read model** `GET /api/projects/<id>` returns the server's one computed schedule with exactly the published keys, and every view and export shows those same values.
- **DP-08 — Empty project** A project with no items shows the published empty sentence, the `No finish date yet` finish text and an `Open the list` button instead of the chart.
- **DP-09 — Task list grid** The `Task list` grid has the published columns, one active cell moved by Arrow, Home and End keys, and opens, saves, cancels and adds rows by keyboard as described in Interactions.
- **DP-10 — Predecessors cell** The Predecessors cell accepts the published entry syntax, shows links in canonical text, replaces the item's incoming links on save, and refuses bad entries with the first published message.
- **DP-11 — Keyboard reorder and grouping** Alt with the Arrow keys moves a task or milestone up or down a row and into or out of a group, persisted on the server and announced with the published sentences.
- **DP-12 — Build a plan from the list** The owner builds a linked, grouped plan in an empty project by keyboard alone, and an editor's open chart shows the rows as they are added.
- **DP-13 — Pointer drag, snap and resize** Dragging a bar's middle moves it and dragging its end handles resizes it, snapping to whole days and then to working days by the published rules, with the drag tip and Escape cancel.
- **DP-14 — Holidays** Adding or removing a holiday in the Holidays dialog recalculates every item's dates on the server, marks the day in the chart header and announces how many tasks moved.
- **DP-15 — Re-plan by pointer** The owner drags and resizes bars across a weekend and a holiday and adds a holiday by keyboard, and every resulting date survives a reload.
- **DP-16 — Bar keyboard** A focused bar moves one working day with ArrowLeft and ArrowRight, changes duration with Shift and the Arrow keys, opens Task details with Enter and the link dialog with L, and keeps focus after every redraw.
- **DP-17 — Chosen start and link bounds** Each item keeps its chosen start, its shown start is the latest of that and every link bound, and a move earlier than the bound saves the chosen start and announces the published constraint sentence.
- **DP-18 — Bar descriptions** Every bar's accessible name is the item name and its description is the published sentence of dates, duration, progress, critical, late, variance and links.
- **DP-19 — Schedule updates announcements** The `Schedule updates` live region announces the published sentence for each of the person's own accepted edits only after the server has answered.
- **DP-20 — Viewers cannot edit** A viewer can read and export every view but the server refuses every change from them with 403, and the screen tells them so without changing anything.
- **DP-21 — Re-plan by keyboard** The owner nudges and resizes bars by keyboard and hears each result, while a viewer in another browser cannot change the plan.
- **DP-22 — Four link types with lag** Finish-to-start, start-to-start, finish-to-finish and start-to-finish links with a lag from -30 to 30 working days give the published dates.
- **DP-23 — Link dialog** The `Add link` dialog, opened with L on a focused bar, creates a link by keyboard and returns focus to the bar.
- **DP-24 — Link errors and loops** Duplicate, self, group, bad-lag and looping links are refused with the published status, body and message, the loop message names the loop path, and nothing is saved.
- **DP-25 — Link a plan by keyboard** The owner links every item of the Link examples project through the link dialog by keyboard and sees each successor land on its published dates.
- **DP-26 — Task details dialog** The `Task details` dialog edits an item's name, chosen start, duration and percent, manages assignees and comments, keeps Tab inside itself and returns focus to its opener.
- **DP-27 — Live updates in place** Every accepted change appears in every other open view of the project without a reload, keeping each viewer's focus and scroll, and is announced in `Project updates`.
- **DP-28 — Push later, come back earlier** Moving a predecessor later pushes its dependents in the owner's and an editor's open chart, and moving it back lets them return no earlier than their chosen starts.
- **DP-29 — Critical path and float** The server computes total float and the critical path per accepted edit, marks critical bars, links and the critical count, and the highlight toggle dims every non-critical bar.
- **DP-30 — Watch the critical path change** The owner moves tasks and sees exactly which items join the critical path in the chart, the list and the API, while an editor's chart shows the same.
- **DP-31 — Baseline save and replace** Saving a baseline stores every item's shown dates and the finish under a name, and saving again asks for confirmation with the published sentence before replacing it.
- **DP-32 — Variance and baseline ghosts** Each item and the finish show the signed working-day variance from the baseline in the chart, grid, description and header, and Show baseline draws ghost bars at the baseline dates.
- **DP-33 — Compare against the baseline** The owner saves a baseline by keyboard, moves a task, and reads every variance, the finish variance and the ghost bars, which survive a reload.
- **DP-34 — Percent complete and group rollup** Percent complete is a whole number, milestones are 0 or 100, and each group shows the duration-weighted mean of its tasks rounded half up, or 0 when it has no tasks, everywhere it appears.
- **DP-35 — Phone timeline** Below 768 pixels wide the Gantt view is the `Timeline` card list with short dates, progress, Critical and Late words and an Update progress button per task.
- **DP-36 — Progress sheet** The `Update progress` sheet sets percent complete with a slider that works by touch, pointer and keyboard in steps of 5 without scrolling the page.
- **DP-37 — Published breakpoints** The project page shows the published phone, tablet and desktop layout at 375x812, 768x1024 and 1280x800 and never scrolls sideways.
- **DP-38 — Update progress on a phone** An editor on a phone updates a task's progress by touch, sees the card and its group rollup change, and a desktop browser sees the new percent live.
- **DP-39 — Workload hours** Each person's hours per weekday sum their assignments across every project in the workspace on that project's working days, and a day above capacity is over-allocated.
- **DP-40 — Workload grid** The `Workload` grid shows two weeks of weekday cells per owner and editor with the published labels and attributes, moves by keyboard and opens each day's breakdown.
- **DP-41 — Assignments** Owners and editors assign owners and editors to tasks at a number of hours a day and remove them, with the published limits.
- **DP-42 — Rebalance a person's load** An editor assigns a person to an overlapping task and the owner's open workload grid shows the over-allocated days without a reload.
- **DP-43 — Version conflicts** An edit based on an older item version is refused with 409 naming who changed it, the sender's screen returns to the server's state with the published notice, and of two simultaneous edits exactly one wins.
- **DP-44 — Presence and selection** `People here` lists everyone with the project open, and the bar another person has focused carries their name.
- **DP-45 — Open dialog keeps its edits** An open Task details dialog keeps its unsaved values, focus and version while pushed changes redraw the chart behind it, and takes the current values after a refused save.
- **DP-46 — Two editors on one task** Two editors edit the same task at once, one change wins, the other sees the conflict notice and saves again successfully.
- **DP-47 — Comments** Owners and editors post comments on an item, shown oldest first and pushed live to every open Task details dialog for that item, with the 1000-character limit.
- **DP-48 — Assignment notice** Assigning someone other than yourself sends them one email after the server's configured delay, with the published subject, body and link, and an assignment removed within the delay sends nothing.
- **DP-49 — Assign and discuss** The owner comments and assigns an editor by keyboard, the editor sees the comment live, receives the notice by email and opens the task from its link.
- **DP-50 — Export menu and stored files** The Export menu renders a CSV or PDF on the server, stores it in MinIO, and shows its download link only after the stored object is confirmed, listed again after a reload.
- **DP-51 — CSV content** The CSV export has the published header, one row per item with the server's values and neutralises cells starting with =, +, - or @.
- **DP-52 — PDF content** The PDF export is A4 landscape with the project name as its title, 20 rows a page, page numbers and each row's published line of text.
- **DP-53 — Storage outage** While file storage is unreachable an export answers 503, shows the published alert and no link, and health still answers 200.
- **DP-54 — Export a plan** The owner and a viewer export a plan to CSV and PDF by keyboard and download the stored files.
- **DP-55 — Knock-on motion** After an accepted edit's result arrives, moved bars slide one dependency depth at a time and the finish marker follows, with the published timings and attributes.
- **DP-56 — Reduced motion** With reduced motion every bar and the finish marker take their final place in one frame with no motion attributes, and every announcement and shifted mark is unchanged.
- **DP-57 — Focus and accessibility** Focus is always visible, every dialog and sheet keeps Tab inside itself and closes with Escape, and the Gantt, List and Workload views have no automated accessibility violations at the three published sizes.
- **DP-58 — Visual language** Every screen uses STIX Two Text, the two inks on off-white, fill, outline and hatch instead of status colours, and yellow on exactly one element, as described in Visual design.
- **DP-59 — Landing page** The signed-out home page shows the published column-on-one-line hero with its headline, links and true-size demo plan.
- **DP-60 — Secrets and served assets** Every service credential and URL is read from the environment, none reaches the browser, and the font, icons and code are served by the app itself.

## Frontend

All visible copy in this brief uses the straight apostrophe and straight quotation marks, and the plain ASCII hyphen-minus for every dash, minus sign and range (`Mon 1 Mar - Wed 3 Mar`). Render each backticked string character for character. The arrow in `See a plan move →` is the one exception, and it is written exactly as shown. Angle-bracket placeholders such as `<item>` are filled as defined where they first appear. `<item>`, `<A>`, `<B>`, `<predecessor>` and `<group>` are item names. `<name>` is a person's name. `<date>` is a date in the long screen format from Business rules.

### Screens and layout (DP-08, DP-35, DP-37, DP-59)

**Pages.**

- `/` for a signed-out visitor is the landing page described in Visual design.
- `/` for a signed-in person has the heading `Projects`, a `list "Projects"` of links (each link's name is a project name, sorted by name, covering every workspace the person belongs to) and `button "New project"`.
- `/signin` and `/signup` are single-column forms on the same left edge as everything else.
- `/projects/<id>` is the project page. If the project does not exist or belongs to a workspace the person is not a member of, the page shows only the heading `No such project.`
- Visiting any page except `/`, `/signin` and `/signup` without a session redirects to `/signin?next=<path and query>`. After sign-in the person returns to that path and query.

**Project page, top to bottom.**

1. The project name as the page's only level-one heading.
2. `id="project-finish"` with the text `Finishes <date>`, or `No finish date yet` when the project has no items. In that case `id="finish-variance"` is absent too.
3. With a baseline, `id="finish-variance"` with the variance text.
4. `id="critical-count"` with `<n> critical tasks`, `1 critical task` or `No critical tasks`, counting critical tasks and milestones.
5. `list "People here"`.
6. `tablist "View"`.
7. The toolbar.
8. The two status regions and the page `alert`.
9. The chosen view.
10. `region "Exports"`.

A project with no items shows `No tasks yet. Add the first task in the list.` and `button "Open the list"` in place of the Gantt view, sitting on the column edge. The button selects the List tab.

**Views.**

- **Gantt view.**
  - From 768 pixels wide it shows a name column (one row per item in row order, items in a group indented under their group's row) beside `region "Chart"`. The border between the two sits at 27% of the page width. Every row is 44 pixels tall. The chart scrolls sideways inside its region and the name column stays put.
  - Below 768 pixels wide it becomes `list "Timeline"`, one card per row in row order. Each card shows:
    - the item name;
    - the short dates: `Mon 1 Mar - Wed 3 Mar` for a task or group, `Tue 16 Mar` for a milestone, and none for an empty group;
    - `<p>% complete`;
    - the words `Critical` and `Late` when they apply;
    - for each task, `button "Update progress for <item>"`.
- **List view.** `grid "Task list"` inside a region that scrolls sideways on its own.
  - Below 768 pixels the Row and Name columns stay fixed while the others scroll.
  - From 768 to 1279 pixels the grid scrolls sideways inside its region when its columns do not fit.
  - From 1280 pixels all nine columns fit without scrolling.
- **Workload view.** `grid "Workload"` with the Person column fixed and the day columns scrolling inside the grid's region below 1280 pixels. From 1280 pixels all twelve columns fit.

**Layouts by width.** The breakpoints are exactly these: phone below 768 pixels, tablet from 768 to 1279 pixels, desktop from 1280 pixels. 375x812 is phone, 768x1024 is tablet and 1280x800 is desktop.

- **Phone.** One column. The header stacks heading, finish, variance, critical count and `People here`. The tabs sit in one row, the toolbar buttons wrap onto as many rows as they need, and Exports comes last.
- **Tablet.** Heading, finish, variance and count stack on the left edge. `People here` sits under them and the toolbar wraps onto at most two rows.
- **Desktop.** `People here` sits at the right end of the header row and the toolbar fits on one row.
- At every width the page itself never scrolls sideways; only the chart and grid regions do. Below 768 pixels every control a person taps is at least 44 by 44 pixels.

**Exports shelf.** `region "Exports"` lists the project's stored exports newest first as `link "Download <filename>"`, each followed by its format and the time it was made. The newest one carries the word `Ready`.

### Public screens and controls (DP-08, DP-09, DP-13, DP-14, DP-16, DP-23, DP-26, DP-31, DP-32, DP-35, DP-36, DP-40, DP-41, DP-44, DP-47, DP-50, DP-59)

These roles and names are public, and tests and judges use them. Everything else is up to you. Copy for announcements and errors is listed in Feedback states.

| Role and name | Where | Notes |
|---|---|---|
| `link "Start a plan"`, `link "See a plan move →"`, `link "Sign in"`, `region "Demo plan"` | landing | Start a plan goes to `/signup`. See a plan move scrolls to the demo. |
| `textbox "Email"`, `textbox "Password"`, `button "Sign in"` | `/signin` | |
| `textbox "Name"`, `textbox "Email"`, `textbox "Password"`, `button "Create account"` | `/signup` | |
| `list "Projects"`, `button "New project"` | `/` signed in | |
| `dialog "New project"` with `textbox "Project name"`, `combobox "Workspace"`, `button "Create project"` | `/` | The Workspace combobox lists workspaces where the person is owner or editor. The default is the one they joined most recently. |
| `tablist "View"` with `tab "Gantt"`, `tab "List"`, `tab "Workload"` | project page | |
| `list "People here"` | project page | Items read `<name> (you)` first, then the others' names sorted. |
| `checkbox "Show baseline"`, `checkbox "Highlight critical path"`, `button "Save baseline"`, `button "Holidays"`, `button "Export"` | toolbar | |
| `menu "Export"` with `menuitem "Export CSV"`, `menuitem "Export PDF"` | opened by Export | |
| `region "Exports"` with `link "Download <filename>"` | project page | |
| `status "Schedule updates"`, `status "Project updates"`, `status "Export status"` | project page | All polite. |
| `alert` (page) | project page | Grid and chart errors. Each dialog also has its own `alert`. |
| `region "Chart"` | Gantt, tablet and desktop | See the chart contract below. |
| `button "Open the list"` | empty project | |
| `list "Timeline"`, `button "Update progress for <item>"` | Gantt, phone | |
| `dialog "Update progress"` with the item name as heading, `slider "Percent complete"`, `button "Save progress"`, `button "Cancel"` | phone sheet | The slider shows `<p>%`. |
| `grid "Task list"` | List | Column headers `Row`, `Name`, `Start`, `End`, `Duration`, `Predecessors`, `Assignees`, `% complete`, `Variance`. The last row is `Add task`. The cell editor is a `textbox` named after its column header. |
| `grid "Workload"`, `button "Previous two weeks"`, `button "Next two weeks"` | Workload | Column headers `Person`, ten short dates, `Over-allocated days`. |
| `dialog "<name>, <date>"` with `list "Assignments"` | Workload | Items read `<project>: <item>, <hours> hours`. |
| `dialog "Task details"` | project page | `textbox "Name"`, `textbox "Start"`, `spinbutton "Duration"`, `spinbutton "Percent complete"`, `button "Save task"`, `button "Delete task"`, `region "Assignees"`, `region "Comments"`. |
| In `region "Assignees"` | Task details, tasks only | `list "Assignees"` with items `<name>, <hours> hours a day` and `button "Remove <name>"`; `combobox "Add person"`; `spinbutton "Hours a day"`; `button "Assign"`. |
| In `region "Comments"` | Task details | `list "Comments"` with items `<name>: <text>`; `textbox "New comment"`; `button "Post comment"`. |
| `dialog "Add link"` | Gantt | Heading `Link from <item>`; `combobox "Successor"` with options `<row> <name>`; `radiogroup "Link type"` with radios `Finish to start`, `Start to start`, `Finish to finish`, `Start to finish`; `spinbutton "Lag in working days"`; `button "Add link"`. |
| `dialog "Holidays"` | toolbar | `list "Holidays"` with items `<date> <name>` and `button "Remove <name>"`; `textbox "Date"`; `textbox "Holiday name"`; `button "Add holiday"`. |
| `dialog "Save baseline"` | toolbar | `textbox "Baseline name"`, `button "Save baseline"`. After saving it shows the heading `Baseline set` and `button "Back to plan"`. |

**Chart contract.** Tests read these attributes and text, never pixels. Dates in attributes are `YYYY-MM-DD`.

- **Day columns.** One header cell `[data-day="YYYY-MM-DD"]` per calendar day, each 32 pixels wide, with `data-working="true|false"` and, for a holiday, `data-holiday="<holiday name>"`. The chart runs from the Monday one week before the week of the earliest item start to the Sunday two weeks after the week of the project finish. A bar's left edge is its start day's column and it spans every calendar day up to and including its end.
- **Today line and finish.** `id="today-line"` with `data-date` (today) is present when today is one of the chart's days. `id="finish-marker"` has `data-date` set to the project finish.
- **Bars.** Every task, milestone and non-empty group has exactly one bar element `[data-item-id="<id>"]` with these attributes:
  - `data-kind` (`task|milestone|group`);
  - `data-start` and `data-end` (a milestone has its date in both);
  - `data-duration` (working days);
  - `data-percent`;
  - `data-critical` (`true|false`);
  - `data-late` (`true|false`);
  - on task and milestone bars that have a baseline, `data-variance` (a signed integer such as `3`, `-2` or `0`), `data-baseline-start` and `data-baseline-end`. Group bars never carry these three attributes, and neither do bars of items added after the baseline;
  - `data-shifted="true"` on every bar the last accepted edit moved, until the next accepted edit;
  - `data-dimmed="true"` while Highlight critical path is on and the bar is not critical;
  - `data-selected-by="<names>"` while other people have that bar focused (several names sorted and joined by `, `).
- **Handles.** A task bar holds two 8-pixel handles, `[data-handle="start"]` and `[data-handle="end"]`, inside its ends.
- **Links.** Every link is an element `[data-link-id="<id>"]` with `data-from`, `data-to` (item ids), `data-type` (`FS|SS|FF|SF`), `data-lag` and `data-critical`.
- **Baseline ghosts.** While Show baseline is on, every item with a baseline has a `[data-baseline-bar]` element with `data-item-id`, `data-start` and `data-end`.
- **Drag tip.** While dragging, `id="drag-tip"` shows `<start> - <end>` of the snapped result in the long date format.

### Interactions (DP-09, DP-10, DP-11, DP-13, DP-16, DP-23, DP-26, DP-36, DP-40, DP-44, DP-47, DP-57)

**Tab order on the project page** follows reading order: the view tabs, the toolbar controls, the view's single tab stop (the chart's bars, the grid's active cell, the workload's active cell, or the timeline's buttons), then the Exports links.

**View tabs.** ArrowLeft and ArrowRight move focus across the tabs and select the tab they land on. The chosen view is kept in the URL as `?view=gantt|list|workload` (default `gantt`) and survives a reload. The other URL parameters are:

- `baseline=on` (Show baseline);
- `critical=on` (Highlight critical path);
- `from=YYYY-MM-DD` (the Workload Monday);
- `task=<id>`, which opens that item's Task details on load.

**Chart by keyboard.**

- The bars of tasks and milestones share one tab stop, which starts on the first such bar in row order. ArrowDown and ArrowUp move focus to the next and previous of these bars. Group bars are not focusable. Inside `region "Chart"` the bars are the only focusable controls, so every key below works on whichever bar has focus.
- ArrowRight sets the item's chosen start to the working day after its shown start. ArrowLeft sets it to the working day before. Each press is one edit.
- Shift+ArrowRight adds one working day of duration and Shift+ArrowLeft removes one. A milestone ignores Shift with the Arrow keys. At 1 working day, Shift+ArrowLeft announces the one-day message and saves nothing.
- Enter opens Task details. L opens the Add link dialog from this bar.
- While a key edit is in flight the bar shows its requested place and carries `aria-busy="true"`. When the result arrives it takes the server's place.
- Focus stays on the same bar after every redraw, including the knock-on and pushed changes from other people. Clicking a bar focuses it.
- When a person focuses a bar, every other person's chart marks that bar with their name in `data-selected-by` within one second. The mark is removed within one second after they move focus away or leave.

**Pointer drag.**

- Bars respond to pointer events of every pointer type: mouse, pen and touch. Dragging the middle of a task or milestone bar moves it. Dragging `[data-handle="start"]` or `[data-handle="end"]` resizes it. Group bars cannot be dragged.
- A drag starts once the pointer has moved 4 pixels. Escape during a drag cancels it, puts the bar back and saves nothing.
- Snapping: the offset is `round(dx / 32)` calendar days, where `dx` is the horizontal pointer movement in pixels.
  - **Move:** the new chosen start is start plus offset. On a non-working day it becomes the next working day. The duration in working days is kept.
  - **End handle:** the new end is end plus offset. On a non-working day it becomes the previous working day. It is never before the start, and the start is kept.
  - **Start handle:** the new start is start plus offset. On a non-working day it becomes the next working day. It is never after the end, and the end is kept.
- While dragging, the bar follows the pointer in whole-day steps and the drag tip shows the snapped result. On drop, the bar sits at the snapped place while the request is in flight and nothing else moves.
- For example, with the seed data at start: dropping Review brief (Thu 4 - Fri 5 Mar 2027) 64 pixels to the right lands on Sat 6 Mar, which snaps to Mon 8 Mar, so Review brief becomes Mon 8 - Tue 9 Mar 2027 and no dependent moves. Dragging its end handle 64 pixels right (Tue 9 to Thu 11 Mar) then makes it 3 working days (Mon 8, Tue 9 and Thu 11 Mar, skipping Founders Day), and Design pages and Sign-off move.

**Add link dialog.**

- The Successor options are every task and milestone in the project except the bar's own item, in row order. Items already linked from this bar are included, and choosing one shows the duplicate alert. Groups and the bar's own item are never listed, so the self and group messages come only from the Predecessors cell and the API.
- The Successor combobox filters its options by row number or name as you type, ignoring case. ArrowDown and ArrowUp move through the options and Enter picks one.
- Finish to start is selected by default, and the Arrow keys move between the link type radios.
- The lag starts at 0 and ArrowUp and ArrowDown change it by 1.
- Add link saves. On success the dialog closes and focus returns to the bar. Errors show in the dialog's alert and keep it open. Escape closes the dialog and returns focus to the bar.

**Task details.**

- It opens with Enter on a bar, with Enter on a grid row's Assignees cell, or from `?task=<id>`.
- Start shows and edits the item's chosen start as `YYYY-MM-DD`. This is the start its people last set, not the shown start, so for an item pushed by a link it can be earlier than its bar.
- Save task sends every field. On success it closes and returns focus to its opener (the bar, or the grid cell; with `?task=` it returns to the first bar). Field errors show in the dialog's alert, mark the field `aria-invalid="true"` and keep the dialog open.
- Delete task deletes the item at once, closes the dialog and moves focus to the next bar in row order, or the previous one when it was last.
- For a group, only Name is editable and the Assignees region is absent. For a milestone the Assignees region is absent.
- Pushed changes redraw the chart behind the dialog but never change its fields, its focus or the version it edits. The Comments list is the one exception: new comments appear in it live.
- The dialog's own Assign and Remove calls return the item, and the dialog adopts that item's `version` while keeping its other fields as typed. A later Save task is therefore not refused because of the person's own assignment change. Posting a comment does not change the version.
- Assignees: Add person lists the workspace's owners and editors not yet assigned. Typing filters by name, ignoring case. ArrowDown and ArrowUp move through the names and Enter picks one. Hours a day starts at 8. Assign saves, and Remove `<name>` removes that person.
- Comments: Post comment is disabled while the textbox is empty. Ctrl+Enter in the textbox posts.

**Task list grid.**

- **Active cell.** One cell is active and has the only tab stop. It starts on row 1's Name cell, or on the `Add task` row's Name cell in an empty project. The Arrow keys move it, and Home and End go to the first and last cells of its row.
- **Editing.** Enter, F2 or typing a printable character on a Name, Start, Duration, Predecessors or % complete cell opens that column's textbox. A typed character replaces the value; Enter and F2 keep it. The Start textbox opens holding the item's chosen start as `YYYY-MM-DD`, while the cell itself shows the shown start. % complete is edited as a number without `%`. Inside the textbox:
  - Enter saves and moves the active cell down one row;
  - Tab saves and moves it one cell right (it stays put on the last cell);
  - Escape cancels and keeps the old value.

  On a refused value the textbox stays open with `aria-invalid="true"`, the page alert shows the message, and nothing is saved.
- **Rows.** Each item row (role `row`) carries `data-item-id="<id>"`, `data-critical="true|false"` and `data-late="true|false"` with the server's values. The `Add task` row carries none of them.
- **Read-only cells.** End, Row and Variance never open. On a group row only Name opens.
- **Assignees cell.** Enter opens Task details.
- **Cell text.** Start and End show long dates, Duration shows working days (`0` for a milestone), % complete shows `<p>%`, and Assignees shows `<name> (<hours>)` sorted by name and joined by `; `. Variance shows `+3`, `-2` or `0` with a baseline and is empty without one, and always empty for groups.
- **Add task row.** Typing a name and pressing Enter creates a task as the last row (start is the first working day on or after today, 1 day, 0%). Shift+Enter creates a group instead. The active cell stays on the new `Add task` row's Name cell with its textbox closed, so the next name can be typed at once. Enter with an empty name closes the textbox.
- **Duration and milestones.** A Duration of 0 turns a task into a milestone, and more than 0 turns a milestone into a task.
- **Reordering.** Alt+ArrowUp and Alt+ArrowDown on any cell of a task or milestone row move it one place, as defined in Business rules. Alt+ArrowRight puts it in the nearest group above it, and Alt+ArrowLeft takes it out of its group. Where the rule allows no change, the key does nothing and nothing is announced. The active cell follows the moved item. Row numbers and every canonical predecessors text update to the new order.

**Workload grid.**

- The active cell starts on the first person's first day, and the Arrow keys move it.
- Enter on a day cell opens that day's breakdown dialog. Escape closes it and returns focus to the cell.
- Previous two weeks and Next two weeks move the shown Monday by 14 days and update `from` in the URL.

**Export menu.** Enter, Space or ArrowDown on Export opens the menu with focus on its first item. ArrowDown and ArrowUp move between the items. Enter chooses an item, which closes the menu, returns focus to Export and starts the export. Escape closes the menu and returns focus to Export.

**Progress sheet.**

- The slider runs from 0 to 100 in steps of 5 and starts at the task's percent.
- Dragging the thumb with any pointer, including touch, sets the value. Touch-dragging the slider never scrolls the page.
- ArrowRight and ArrowUp add 5, ArrowLeft and ArrowDown subtract 5, Home sets 0 and End sets 100.
- Save progress saves and closes the sheet. Cancel and Escape close it without saving. Either way focus returns to the card's button.

**Dialogs, sheets and menus in general.** Tab and Shift+Tab wrap inside every open dialog and sheet. This includes Tab from the last control, which a native dialog alone does not keep in the page. Escape closes them, and focus returns to the control that opened them.

**Viewers.**

- Bars carry `aria-disabled="true"`. Bar edit keys and pointer drags change nothing and announce the read-only message.
- Grid cells do not open for editing.
- Task details shows read-only fields with no Save task, Delete task, Assign or Post comment.
- Save baseline and Holidays carry `aria-disabled="true"`. Activating them shows the read-only message in the page alert.
- Export works for viewers.

### Visual design (DP-58, DP-59)

The direction is a quiet instrument. The page is exact, because every bar edge lands on a day boundary to the pixel. It is unhurried, because the knock-on is the only motion. It is confident, because the hero headline sits on a page that is mostly empty.

- **Type.** STIX Two Text is the only typeface, for display and body alike, served by the app. Headings use its medium weight. Each heading level is a quarter larger than the level below it. Body text is set at a comfortable reading size. Tables, the list grid, the workload grid and the export shelf use its tabular figures, so digits line up in columns.
- **Colour, by role.**
  - The ground is a very light off-white grey.
  - The surface is a slightly darker light grey, used for panels, weekend columns and banners.
  - The ink is a deep bottle-green that reads almost black, used for text, critical bars and buttons.
  - The muted ink is a soft grey-green, used for secondary text, float tails and baseline ghosts.
  - The accent is a bright lemon yellow, and anything on it is set in the bottle-green ink.

  There is no cream or paper tone, no status colour and no gradient.
- **Density.** Comfortable. Rows in the list grid, workload grid, name column and export shelf are 44 pixels tall.
- **Composition.** Everything hangs on one left edge at 27% of the page width. The marketing column is 380 to 520 pixels wide. In the app, that same edge becomes the border between the name column and the timeline, so the line the eye follows is the scheduling seam itself.
- **Hero (DP-59).**
  - The Slackwater mark (a short horizontal ink bar with a trailing muted float tail) sits on the left edge near the top.
  - Well below it is a two-line headline: `Move one task.` in ink and `The rest of the plan follows.` in the muted ink. It grows with the window from a little under twice body size to nearly three times.
  - Then comes one sentence: `Slackwater Plan counts working days, skips weekends and your holidays, and shows the critical path the moment a date moves.`
  - Then the near-black `Start a plan` link styled as a button, and the plain text link `See a plan move →`.
  - `Sign in` sits alone at the top right.
  - At the bottom edge a 368-pixel-tall surface panel, `region "Demo plan"`, peeks 90 pixels above the fold. It holds two real Gantt rows at true size, `Order tiles` and `Lay floor`, joined by a finish-to-start connector, with a drawn pointer resting on the first bar.
- **Working screens.**
  - The same face, the two inks and one small, barely rounded corner on bars, buttons and inputs. No shadows, no ruled grid lines and no icon cards.
  - Week boundaries on the timeline are alternating bands of ground and surface, not lines. Weekend and holiday columns are surface-toned, with the holiday name set vertically in small muted italic.
  - Critical tasks are solid ink bars. Non-critical bars are ground-filled with a thin ink outline, followed by a muted tail as long as their total float. Milestones are ink diamonds. Groups are thin ink brackets spanning their items. Baseline ghosts are a thin muted bar under each row. Late bars are followed by the muted italic word `Late`. Dimmed bars under Highlight critical path fade to the muted ink.
  - Over-allocated workload cells show the hours in ink on a diagonally hatched surface, never through colour alone.
- **Yellow.** Yellow appears on exactly one element per view: the finish marker in the Gantt view; the newest export's `Ready` tag in the List and Workload views and the phone timeline; and the primary button in each form dialog. The one full-yellow field is the `Baseline set` confirmation inside the Save baseline dialog.
- **Empty, error and outage states.** An empty state is a single sentence and one small button on the column edge. Error and outage banners are muted-ink sentences across the column width on the surface tone.
- **Size and contrast.** Every control is at least 44 pixels tall. All text and focus indicators meet WCAG 2.2 AA contrast against their background, and yellow is only ever a background behind ink.
- **Focus.** A two-pixel ink ring with a small gap, visible on every bar, grid cell, button, field and menu item.

### Motion and effects (DP-55, DP-56)

The Knock-on is the product's only motion. Dialogs, sheets and menus appear and disappear at once, and nothing loops or moves for decoration. The verifier pauses the browser clock and advances it step by step, and it blocks service workers, so do not depend on a service worker. Drive every motion from `requestAnimationFrame` and `performance.now()`.

**The Knock-on.**

1. **When it plays.** It plays when an accepted edit's result arrives in a browser, whether the result is the person's own or one pushed from someone else.
2. **What updates at once.** The moment the result arrives, every bar's data attributes, the descriptions, `id="project-finish"`, the critical count and the announcement take their new values. The edited bar and group bars jump to their new places at once. The motion below is visual only.
3. **Which bars slide.** Every other bar whose shown start changed slides horizontally from its old place to its new place. A bar's depth is the fewest links from the edited item to it, capped at 12. For a link change the edited item is the link's predecessor. For a holiday change every moved bar has depth 0.
4. **Timing.** Let `e` be the milliseconds since the result arrived. A bar of depth `k` stays at its old place while `e` is under `KNOCK_ON_STAGGER_MS × k`. It then moves with progress `min(1, (e - KNOCK_ON_STAGGER_MS × k) / KNOCK_ON_MS)`, eased by a curve that starts quickly and settles softly: the cubic Bezier ease with control points (0.2, 0) and (0, 1).
5. **How the slide is drawn.** The bar is laid out at its new place and carries the inline transform `translateX(<px>px)`, where `<px>` is (old start column minus new start column) × 32 × (1 − eased progress). It is therefore 0 at the end.
6. **The motion attribute.** From the result's arrival until its progress reaches 1, the bar carries `data-motion="knock-on"`. Then the attribute is removed.
7. **Connectors, tails and fill.** Connectors redraw as their successor settles and float tails grow or shrink to their new length. A bar joining or leaving the critical path swaps between outline and solid fill when it settles.
8. **The finish marker.** When the last sliding bar stops (at arrival, if no bar slides), `id="finish-marker"` slides from the old finish column to the new one over `FINISH_MOTION_MS`, with the same easing and the same inline transform, carrying `data-motion="finish"` while it moves. If the finish did not change it does not move.
9. **A new result mid-motion.** If another result arrives while motion is playing, everything jumps to its final place first and the new motion starts from there.
10. **A refused edit.** The edited bar returns to the server's place and nothing downstream moves.

With the defaults from Configuration, the whole cascade takes about a quarter of a second for one depth and under one second for a deep plan, and the finish marker takes about a third of a second.

**Reduced motion.** When the person's system asks for reduced motion, no bar and no marker ever gets `data-motion` or a non-zero transform, and everything is in its final place on the first frame. Shifted bars keep a thin ink underline until the next accepted edit, so the knock-on stays readable. `data-shifted`, every attribute and every announcement are the same as with motion.

**Landing demo.** When `region "Demo plan"` first scrolls into view, the demo plays the Knock-on once: Order tiles moves one working day later and Lay floor slides after it with one depth of stagger. It plays once per page load and does not reverse when the visitor scrolls back. Under reduced motion it shows the end state at once.

### Feedback states (DP-08, DP-14, DP-19, DP-20, DP-24, DP-27, DP-31, DP-43, DP-47, DP-50, DP-53)

**Pending.** While a request is in flight, its button is disabled with its label unchanged, and an edited bar or grid row carries `aria-busy="true"`. Nothing is announced until the server answers. If there is no answer, or a 5xx answer other than the storage outage, the page alert or dialog alert shows `Your change could not be saved. Try again.` and the screen returns to the server's last state.

**`status "Schedule updates"`** announces the result of the person's own accepted edit after the server answers, never before:

- **Move:** `<item> now starts <date> and ends <date>.`, or for a milestone `<item> is now on <date>.`
- **Resize:** `<item> now lasts <n> working days and ends <date>.`, using `1 working day` for one day.
- **Link:** `Linked <A> to <B>, <type words>, lag <n>.`, where the type words are `finish to start`, `start to start`, `finish to finish` or `start to finish`, and `<n>` is signed only when negative (`lag -1`).
- **Predecessors:** `Predecessors of <item> set to <canonical text>.`, or `Predecessors of <item> cleared.` when emptied.
- **Delete:** `<item> deleted.`
- Each of these five sentences is followed by a space and the moved count, then ` Project finishes <date>.` There is one exception. A Delete that leaves the project with no items announces `<item> deleted. The project has no tasks left.` instead. The moved count is `No dependent tasks moved.`, `1 dependent task moved.` or `<n> dependent tasks moved.`, counted as defined in Business rules. For example, with the seed data at start, three ArrowRight presses on Draft brief end with `Draft brief now starts Thu 4 Mar 2027 and ends Mon 8 Mar 2027. 4 dependent tasks moved. Project finishes Wed 17 Mar 2027.`
- **Percent:** `<item> is <p>% complete.` (no count).
- **Constraint**, announced instead of the move sentence when the saved chosen start is earlier than the resulting shown start: `<item> can start no earlier than <date> because of <predecessor>.` For example, with the seed data at start, dragging Review brief to Mon 1 Mar 2027 announces `Review brief can start no earlier than Thu 4 Mar 2027 because of Draft brief.`
- **Name only:** `<item> saved.`
- **New row from the grid:** `<item> added as row <n>.`
- **Reorder:** `<item> moved to row <n>.`, `<item> is now in <group>.`, `<item> is no longer in a group.`
- **Holiday:** `Holiday <name> added. <tasks moved> Project finishes <date>.` and `Holiday <name> removed. <tasks moved> Project finishes <date>.`, where `<tasks moved>` is `No tasks moved.`, `1 task moved.` or `<n> tasks moved.` On a project with no items, the sentence ends after `No tasks moved.`
- **Baseline:** `Baseline <name> saved.`
- **Assignment:** `<name> assigned to <item>, <hours> hours a day.` and `<name> removed from <item>.`
- **Comment:** `Comment posted.`
- **Minimum duration:** `<item> is already 1 working day long.`
- **Viewer bar key or drag:** `You can view this project but not change it.`

**`status "Project updates"`** announces each accepted change made by someone else, once, when it arrives:

- `<name> changed <item>.` for an edit, assignment, reorder or link change, where the item is the edited item;
- `<name> added <item>.`
- `<name> deleted <item>.`
- `<name> commented on <item>.`
- `<name> changed the holidays.`
- `<name> saved the baseline.`

**`status "Export status"`:**

- **Pending:** `Preparing the CSV export.` or `Preparing the PDF export.`
- **Success:** `<filename> is ready to download.`, shown only after the 201.

**Alerts** (the page `alert`, or the open dialog's own `alert`):

- **Sign-in:** `Email or password is incorrect.`
- **Sign-up:** `Enter your name.`, `Enter a valid email address.`, `Password must be at least 10 characters.`, `That email already has an account.`
- **New project:** `Project name must be 1 to 80 characters.`
- **Grid and Task details fields:**
  - Name: `Name must be 1 to 120 characters.`
  - Start: `Enter a date as YYYY-MM-DD.`
  - Duration: `Duration must be a whole number from 0 to 999.`
  - Percent: `Percent complete must be a whole number from 0 to 100.`
  - A milestone's percent other than 0 or 100: `A milestone is either 0% or 100% complete.`
  - Duration 0 on a task with assignees: `Remove the assignees before making this a milestone.`
- **Predecessors cell**, the first failure only:
  - `Write predecessors like 2FS+1, 3SS-2.`
  - `There is no row <n>.`
  - `A task cannot wait for itself.`
  - `Groups cannot be linked.`
  - `Lag must be between -30 and 30 working days.`
  - `Row <n> is listed twice.`
  - the loop message.
- **Links:**
  - Duplicate: `Those tasks are already linked.`
  - Self: `A task cannot wait for itself.`
  - Group: `Groups cannot be linked.`
  - Lag: `Lag must be between -30 and 30 working days.`
  - Loop: `That link would make the project wait on itself: <path>.`, with `<path>` as defined in Business rules.
- **Read only:** `You can view this project but not change it.`
- **Conflict:** `<name> changed <item> first. Your change was not saved.`
- **Holidays:** `Enter a date as YYYY-MM-DD.`, `Holiday name must be 1 to 60 characters.`, `That date is a weekend.`, `That date is already a holiday.`
- **Baseline:** `Baseline name must be 1 to 60 characters.` When a baseline already exists, the Save baseline dialog shows `This replaces the baseline <name>.` above its button before saving.
- **Assignments:** `Hours a day must be from 0.5 to 24 in steps of 0.5.`, `<name> is already assigned to this task.`
- **Comments:** `Comments can be at most 1000 characters.`
- **Storage outage:** `File storage is unavailable. Your export was not saved. Try again later.`

After a refused edit, the alert stays visible until the person's next action. A later redraw or pushed change never clears or overwrites it.

## Backend

### API (DP-01, DP-02, DP-03, DP-05, DP-07, DP-20, DP-24, DP-43, DP-50)

Requests and responses are `application/json` unless noted. Every id is a string. Dates are `YYYY-MM-DD`. Every error body is `{"error": "<code>"}` plus the extra keys named for that code.

**Error precedence, for the whole API.** Each request is checked in this order, and the first failure answers:

1. body too large, 413 `{"error": "too_large"}`;
2. a body that is not JSON, 415 `{"error": "unsupported_media_type"}`;
3. a cross-origin request, 403 `{"error": "bad_origin"}`;
4. no session, 401 `{"error": "unauthenticated"}`;
5. an unknown resource, or one in a workspace the person is not a member of, 404 `{"error": "not_found"}`;
6. a change by a viewer, 403 `{"error": "read_only"}`;
7. the endpoint's own errors, in the order its row lists them.

Unknown API paths answer 404 `{"error": "not_found"}`. Unexpected failures answer 500 `{"error": "server_error"}`.

| Method and path | Request | Success | Endpoint's own errors, in order |
|---|---|---|---|
| `GET /api/health` (public) | | 200 `{"status": "ok"}` | none |
| `GET /api/config` (public) | | 200 `{"today", "timeZone", "assignNoticeDelaySeconds", "presenceTimeoutSeconds", "knockOnMs", "knockOnStaggerMs", "finishMotionMs"}` | none |
| `POST /api/grading/setup` (public, keyed) | see below | 201 see below | missing or wrong `X-Grading-Key`, or `GRADING_KEY` unset: 404 `not_found` (checked before everything except 413 and 415); malformed body: 422 `{"error": "invalid_field", "field": "<json path>"}` |
| `POST /api/signup` (public) | `{"name", "email", "password"}` | 201 `{"user": {"id", "name", "email"}}` and the session cookie | 422 `{"error": "invalid_field", "field": "name\|email\|password"}` (first bad in that order: name 1 to 80 characters, a valid email, password at least 10 characters); 409 `{"error": "email_taken"}` |
| `POST /api/session` (public) | `{"email", "password"}` | 200 `{"user": {"id", "name", "email"}}` and the session cookie | 401 `{"error": "invalid_credentials"}` |
| `DELETE /api/session` | | 204 | none |
| `GET /api/me` | | 200 `{"user": {"id", "name", "email"}, "workspaces": [{"id", "name", "role"}]}` | none |
| `GET /api/projects` | | 200 `{"projects": [{"id", "name", "workspace", "finish"}]}` sorted by name | none |
| `POST /api/projects` | `{"name", "workspace": <workspace id>}` | 201 `{"project": <project>}` | 422 `{"error": "invalid_field", "field": "name"}` (1 to 80 characters) |
| `GET /api/projects/<id>` | | 200 `<project>` | none |
| `POST /api/projects/<id>/items` | `{"name", "kind": "task\|milestone\|group", "start"?, "duration"?, "group"?: <group id> \| null}` | 201 `{"item", "moved", "finish"}` | 422 `invalid_field` with field in the order name, kind, start, duration, group |
| `PATCH /api/items/<id>` | `{"baseVersion": <int>, "name"?, "start"?, "duration"?, "percent"?, "group"?: <group id> \| null}` | 200 `{"item": <item>, "moved": [{"id", "start", "end"}], "finish"}` | 422 `{"error": "invalid_field", "field": "baseVersion"}` (missing or not an integer); 409 `{"error": "version_conflict", "item": <current item>, "by": "<name>"}`; 422 `{"error": "invalid_field", "field": "<first bad field in the order name, start, duration, percent, group>"}`; 422 `{"error": "has_assignees"}` |
| `DELETE /api/items/<id>` | | 200 `{"moved", "finish"}` | none |
| `POST /api/items/<id>/reorder` | `{"direction": "up\|down"}` | 200 `{"changed": true\|false, "rows": [{"id", "row", "group"}]}` | 422 `{"error": "invalid_field", "field": "direction"}`; 422 `{"error": "not_reorderable"}` (a group) |
| `PUT /api/items/<id>/predecessors` | `{"baseVersion", "text": "<cell text>"}` | 200 `{"item", "moved", "finish"}` | 422 `invalid_field` baseVersion; 409 `version_conflict`; 422 `{"error": "invalid_predecessors", "message": "<the Predecessors cell message>"}` |
| `POST /api/projects/<id>/links` | `{"from": <item id>, "to": <item id>, "type": "FS\|SS\|FF\|SF", "lag": <int>}` | 201 `{"link": {"id", "from", "to", "type", "lag"}, "moved", "finish"}` | 422 `{"error": "invalid_link", "field": "<first bad in the order type, lag, from, to>"}`; 422 `{"error": "self_link"}`; 422 `{"error": "group_link"}`; 409 `{"error": "duplicate_link"}`; 422 `{"error": "loop", "path": [<item ids>], "message": "<the loop message>"}` |
| `DELETE /api/links/<id>` | | 200 `{"moved", "finish"}` | none |
| `POST /api/projects/<id>/holidays` | `{"date", "name"}` | 201 `{"holiday": {"date", "name"}, "moved", "finish"}` | 422 `invalid_field` date (not `YYYY-MM-DD`), then name (1 to 60 characters); 422 `{"error": "weekend"}`; 409 `{"error": "duplicate_holiday"}` |
| `DELETE /api/projects/<id>/holidays/<date>` | | 200 `{"moved", "finish"}` | none (an unknown date is 404) |
| `POST /api/projects/<id>/baseline` | `{"name", "replace"?: true}` | 201 `{"baseline": {"name", "finish", "finishVariance"}}` | 422 `invalid_field` name (1 to 60 characters); 409 `{"error": "baseline_exists", "name": "<current baseline name>"}` when one exists and `replace` is not `true` |
| `POST /api/items/<id>/assignees` | `{"userId", "hours"}` | 201 `{"item"}` | 422 `{"error": "not_a_task"}`; 422 `invalid_field` userId (not an owner or editor of the workspace), then hours; 409 `{"error": "already_assigned"}` |
| `DELETE /api/items/<id>/assignees/<userId>` | | 200 `{"item"}` | none (not assigned is 404) |
| `GET /api/items/<id>/comments` | | 200 `{"comments": [{"id", "author", "text", "createdAt"}]}` oldest first | none |
| `POST /api/items/<id>/comments` | `{"text"}` | 201 `{"comment": {"id", "author", "text", "createdAt"}}` | 422 `invalid_field` text (1 to 1000 characters after trimming) |
| `GET /api/workspaces/<id>/workload?from=<Monday>` | | 200 `{"from", "days": [<10 dates>], "people": [{"userId", "name", "capacity", "overDays", "days": [{"date", "hours", "over", "assignments": [{"project", "item", "hours"}]}]}]}` | 422 `invalid_field` from (missing, not a date, or not a Monday) |
| `GET /api/projects/<id>/presence` | | 200 `{"people": [{"userId", "name", "selected": <item id> \| null}]}` | none |
| `POST /api/projects/<id>/exports` | `{"format": "csv\|pdf"}` | 201 `{"id", "format", "filename", "downloadUrl"}` | 422 `invalid_field` format; 503 `{"error": "storage_unavailable"}` |
| `GET /api/projects/<id>/exports` | | 200 `{"exports": [{"id", "format", "filename", "downloadUrl", "createdAt"}]}` newest first, stored exports only | none |
| `GET /api/exports/<id>/download` | | 200 with the file body, `Content-Type` `text/csv; charset=utf-8` or `application/pdf`, and `Content-Disposition: attachment; filename="<filename>"` | 503 `storage_unavailable` |

**Other notes on the endpoints.**

- Viewers may call every `GET` and the export endpoints. Every other write by a viewer answers 403 `read_only`.
- Value types:
  - In `GET /api/projects`, `workspace` is `{"id", "name"}`, for example `{"id": "w1", "name": "Harbour Street Studio"}`.
  - A comment's `author` is `{"userId", "name"}`, for example `{"userId": "u1", "name": "Asha Rao"}`. Its `createdAt`, like an export's, is an ISO 8601 UTC timestamp.
  - In the workload's `assignments`, `project` and `item` are names, for example `{"project": "Spring launch", "item": "Draft brief", "hours": 4}`. They are sorted by project name, then row.
  - The reorder answer's `rows` lists every item of the project in the new row order. Each entry's `group` is a group id or `null`.
- `downloadUrl` is `/api/exports/<id>/download`.
- `moved` lists the items counted in the moved count, in row order. For a link create or delete, it also includes the successor.
- `finish` is the project finish, or `null` when the project has no items.
- `by` is the name of the person whose accepted edit made the current version. For version 1 it is the person who created the item; for an item created by the setup route, it is the first owner in the setup's member list.
- The live channel (Server-Sent Events or a WebSocket, your choice) is served on the same origin for signed-in members. It carries accepted changes, presence, focus selection and comments.

**`<project>`** is exactly:

`{"id", "name", "finish", "holidays": [{"date", "name"}], "items": [<item>], "links": [{"id", "from", "to", "type", "lag", "critical"}], "baseline": {"name", "finish", "finishVariance"} | null}`

Holidays are sorted by date and items are in row order.

**`<item>`** is exactly:

`{"id", "row", "name", "kind", "group", "chosenStart", "start", "end", "duration", "percent", "critical", "float", "late", "version", "assignees": [{"userId", "name", "hours"}], "baseline": {"start", "end", "variance"} | null}`

- `group` is a group id or `null`.
- `chosenStart` is `null` for groups.
- `float` is an integer number of working days, and `null` for groups.
- An empty group has `start` and `end` `null` and `duration` 0.
- Groups always have `baseline` `null`.

**Setup route.** `POST /api/grading/setup` takes the header `X-Grading-Key: <GRADING_KEY>` and this body:

```json
{"users": [{"email", "name", "password", "capacity": 8}],
 "workspace": {"name", "members": [{"email", "role": "owner|editor|viewer"}]},
 "projects": [{"name", "holidays": [{"date", "name"}],
   "items": [{"key", "name", "kind": "task|milestone|group", "group": "<group key>" | null,
              "start", "duration", "percent", "assignees": [{"email", "hours"}]}],
   "links": [{"from": "<key>", "to": "<key>", "type", "lag"}],
   "baseline": {"name"} | null}]}
```

It answers `201 {"workspace": {"id"}, "users": [{"email", "id"}], "projects": [{"name", "id", "items": {"<key>": "<id>"}}]}`.

- Each call creates a new workspace.
- An email that already exists updates that person's name, password and capacity and adds them to the new workspace.
- Items keep the given order as rows. A group's `start` and `duration` are ignored, and a milestone's `start` is its date.
- The baseline, when given, is saved after scheduling.
- The route sends no notices and never returns tokens or session cookies.

### Business rules (DP-04, DP-06, DP-10, DP-11, DP-17, DP-22, DP-24, DP-29, DP-31, DP-32, DP-34, DP-39, DP-41, DP-43, DP-48, DP-50, DP-51)

**Today.** Today is `PLAN_TODAY` when it is set. Otherwise it is the current date in `PLAN_TIME_ZONE`. A person's device clock may be wrong. The browser never uses its own clock for any date. It reads `today` from `GET /api/config`, and the late flags and the today line come from the server.

**Calendar.**

- A working day is a Monday to Friday that is not one of the project's holidays.
- Dates are date-only and identical for every viewer.
- Screen dates use one long format, `Mon 1 Mar 2027` (weekday, day without a leading zero, month, year). The short form used in workload headers and phone cards drops the year: `Mon 1 Mar`.
- A start that falls on a non-working day, from any input (grid, dialog, API, setup route), moves to the next working day before it is stored.

**Items.**

- A task has a start (a working day) and a duration of 1 to 999 whole working days. Its end is the duration-th working day, counting the start as the first.
- A milestone has duration 0 and one date (a working day), which is both its start and its end.
- A group spans its items: its start is the earliest item start, its end is the latest item end, and its duration is the number of working days from start to end inclusive. Groups are one level deep and hold tasks and milestones only.
- Names are 1 to 120 characters.
- Creating an item (`POST /api/projects/<id>/items`):
  - `start` defaults to the first working day on or after today.
  - `duration` defaults to 1 for a task and 0 for a milestone.
  - Percent starts at 0.
  - A group's `start` and `duration` are ignored.
  - A task's duration must be 1 to 999 and a milestone's must be 0. Any other value answers 422 `invalid_field` with field `duration`.
  - `group` must be the id of a group in the same project, and a group cannot itself have a `group`. Otherwise the answer is 422 `invalid_field` with field `group`.
  - The new item becomes the project's last row. With `group`, it becomes that group's last item instead.
- Editing an item (`PATCH /api/items/<id>`):
  - `duration` may be 0 to 999. 0 turns a task into a milestone, and more than 0 turns a milestone into a task.
  - On a group, any of `start`, `duration`, `percent` or `group` answers 422 `invalid_field` with that field.
  - A task with assignees cannot become a milestone: 422 `has_assignees`.

**Chosen start and shown start.**

- Every task and milestone stores its chosen start, the start its people last set. The server computes a shown start, which is the later of the chosen start and every incoming link's bound.
- The `start` field of an item create or edit writes the chosen start, as do the grid's Start cell and the Task details Start field. The shown start is never written back as a chosen start.
- Moving a predecessor later pushes its dependents. Moving it earlier lets them come back, but never earlier than their own chosen start.
- When the chosen start just saved is earlier than the resulting shown start, the constraint sentence names the predecessor whose link gives the greatest bound. If several bounds are equal, it names the predecessor with the lower row number.

**Working-day numbers.**

- Number the working days in order, and let `W(x)` be the number of working day `x`.
- For a task, `S = W(start)` and `F = W(end) + 1`, so `F - S` is the duration.
- For a milestone, `S = F = W(date) + 1`, because a milestone happens at the end of its day.

**Link bounds.** A link from predecessor A to successor B has a type and a lag `L`, an integer number of working days from -30 to 30 (negative is a lead):

- finish to start (`FS`): `S_B >= F_A + L`
- start to start (`SS`): `S_B >= S_A + L`
- finish to finish (`FF`): `F_B >= F_A + L`
- start to finish (`SF`): `F_B >= S_A + L`

An `FF` or `SF` bound on `F_B` becomes the start bound `F_B - duration_B`. B's shown `S` is the greatest of its chosen `S` and its start bounds, and `F = S + duration`. Converting back to dates: a task's start is working day `S` and its end is working day `F - 1`; a milestone's date is working day `S - 1`.

**Which links are allowed.** Groups cannot be linked. Only one link may run from a given predecessor to a given successor, whatever its type. The project finish is the latest end of any item, so `PF` is the greatest `F`.

**Worked example 1, "Spring launch"** (seed data at start):

- Draft brief Mon 1 Mar - Wed 3 Mar 2027.
- Review brief Thu 4 Mar - Fri 5 Mar.
- Write copy Tue 2 Mar - Wed 3 Mar.
- Design pages Thu 11 Mar - Tue 16 Mar (4 working days across Founders Day).
- Sign-off Tue 16 Mar 2027 (its link holds it after its chosen Mon 15 Mar).
- The project finishes Tue 16 Mar 2027.
- Content spans Mon 1 Mar - Fri 5 Mar 2027, 5 working days.

**Worked example 2, moving later and earlier.** Draft brief's chosen start moves to Thu 4 Mar 2027:

- Draft brief Thu 4 Mar - Mon 8 Mar.
- Review brief Tue 9 Mar - Thu 11 Mar (skipping the holiday).
- Write copy Fri 5 Mar - Mon 8 Mar.
- Design pages Fri 12 Mar - Wed 17 Mar.
- Sign-off Wed 17 Mar.
- The project finishes Wed 17 Mar 2027, and 4 dependent items moved.

Moving Draft brief back to Mon 1 Mar 2027 restores every date of example 1. Review brief returns to Thu 4 Mar, its chosen start, and not earlier. Design pages returns to Thu 11 Mar.

**Worked example 3, every link type, on "Link examples"** (seed data at start, with these links added in order):

- A -> B `FS` lag 2
- B -> C `SS` lag -1
- C -> D `FF` lag 1
- D -> E `FS` lag 0
- E -> F `SF` lag 0

The shown dates become:

- A Plan route Mon 1 Mar - Wed 3 Mar
- B Book venue Mon 8 Mar - Tue 9 Mar
- C Print maps Fri 5 Mar - Thu 11 Mar
- D Pack kits Tue 9 Mar - Fri 12 Mar
- E Kick-off Fri 12 Mar
- F Send reminders Thu 11 Mar - Fri 12 Mar 2027

**Worked example 4, a new holiday.** After Review brief is dropped on Mon 8 Mar and stretched to 3 days, as in the drag example in Interactions, adding the holiday Mon 15 Mar 2027 `Quiet day` moves Design pages to Fri 12 Mar - Thu 18 Mar and Sign-off to Thu 18 Mar. That is 2 tasks moved, and the project finishes Thu 18 Mar 2027.

**Edits and the moved count.**

- A move sets the chosen start and keeps the duration in working days. A resize changes the duration and keeps the start (or, with the start handle, keeps the end).
- Every accepted move, resize, field change, link change, predecessors save, holiday change, assignment, reorder or delete is one edit. After each edit the server recomputes the whole project once (both passes, float, critical path, rollups and late flags) and pushes the result. The chart, list grid, phone list, workload, CSV and PDF all read that one result.
- The moved count is the number of items other than the edited one whose shown start or end changed, not counting groups. For a link create or delete, the edited item is the predecessor. For a holiday change, every changed item counts.

**Critical path.**

- The backward pass gives each item a late finish `LF`. It is the least of `PF` and, for each outgoing link to B with lag `L`:
  - FS: `LS_B - L`
  - SS: `LS_B - L + duration_A`
  - FF: `LF_B - L`
  - SF: `LF_B - L + duration_A`

  where `LS = LF - duration`.
- Total float is `LF - F` working days, and an item is critical when its total float is 0. Groups are never critical. A link is critical when both its ends are critical.
- In example 1 only Design pages and Sign-off are critical. Draft brief and Review brief have 2 days of float and Write copy has 8.
- After example 2's move, Draft brief, Review brief, Design pages and Sign-off are critical.
- When, starting from example 1, Review brief is dropped on Mon 8 Mar 2027, Review brief becomes critical. It ends Tue 9 Mar, and because Wed 10 Mar is a holiday, Design pages' chosen Thu 11 Mar is the very next working day.

**Percent complete.**

- Percent complete is a whole number from 0 to 100. A milestone is `0` or `100` (done).
- A group's percent is the duration-weighted mean of its tasks, excluding milestones, rounded half up to a whole number. For example, after Draft brief is set to 40%, Content's tasks of 3, 2 and 2 days at 40%, 75% and 10% give (120 + 150 + 20) / 7 = 41.43, shown as `41%`. At start it is `33%`.
- A group with no tasks, either empty or holding only milestones, is `0%` everywhere it appears.
- The task progress states are not started (0%), in progress (1% to 99%) and done (100%).

**Late.** An item is late when its end is before today and its percent is below 100. With today Thu 4 Mar 2027 and the seed data at start, Draft brief and Write copy (both ending Wed 3 Mar, under 100%) are late and Review brief (ending Fri 5 Mar) is not. Late flags are recomputed on every edit and on every project read, so they change on the first read after the date changes.

**Baseline and variance.**

- Saving a baseline stores every task's and milestone's shown start and end and the project finish, under a name of 1 to 60 characters. A project has one baseline, and saving again replaces it only with `replace: true`.
- Variance is the signed number of working days, on the current calendar, from the baseline end to the current end:
  - positive when later, counting the working days after the baseline end up to and including the current end;
  - negative when earlier, counted the same way in the other direction;
  - 0 when equal.
- The finish variance is computed the same way over the finishes. Items added after the baseline have no variance.
- Example: with a baseline saved on example 1 and then Draft brief moved to Thu 4 Mar 2027, the variances are Draft brief +3, Review brief +3, Write copy +3, Design pages +1, Sign-off +1, and the finish +1. If instead Design pages shrinks from 4 to 2 days (ending Fri 12 Mar 2027), Design pages is -2.
- The variance text is `<n> working days later than baseline`, `1 working day later than baseline`, `<n> working days earlier than baseline`, `1 working day earlier than baseline` or `On baseline`.

**Bar description.** Each bar's description, linked through `aria-describedby`, is made of these parts joined by `. ` and ended with `.`:

1. Task `Starts <date>, ends <date>`; milestone `Milestone on <date>`; group `Group from <date> to <date>`.
2. Task `<n> working days, <p>% complete` (with `1 working day`); milestone `Done` or `Not done`; group `<p>% complete`.
3. `Critical`, if critical.
4. `Late`, if late.
5. For a task or milestone with a baseline, the variance text. Group bars and items added after the baseline omit this part.
6. For each incoming link, in predecessor row order: `Waits for <predecessor>, <type words>, lag <n>`.

Example 1's Design pages reads `Starts Thu 11 Mar 2027, ends Tue 16 Mar 2027. 4 working days, 0% complete. Critical. Waits for Review brief, finish to start, lag 0.`

**Loops.** A link or predecessors entry that would make an item depend on itself is refused and nothing is saved. The loop path starts at the new link's predecessor, goes to its successor, and then follows existing links back to the predecessor. If several paths exist, it uses the one with the fewest links; if those tie, the one whose row numbers, read in order, are lowest. The names are joined by ` -> `. In example 1, linking Design pages to Draft brief gives `That link would make the project wait on itself: Design pages -> Draft brief -> Review brief -> Design pages.` A `5` in Draft brief's Predecessors cell gives the same message.

**Predecessors cell.**

- The cell holds comma-separated entries of the form `<row>[FS|SS|FF|SF][+n|-n]`. Spaces are ignored, the type is case-insensitive, the type defaults to FS and the lag defaults to 0.
- The canonical text is entries in predecessor row order, joined by `, `, with the type always written and a lag of 0 written as nothing: `2FS+1, 3SS-2, 4FF`.
- Saving replaces all of that item's incoming links.
- Entries are checked left to right. Each entry is checked for syntax, unknown row, self, group, lag range and repeated row, in that order. Then the whole cell is checked for a loop. The first failure is reported.

**Rows and groups.**

- At the top level, the units are ungrouped items and whole groups (a group together with its items). Inside a group, the units are its items.
- Moving a task or milestone up or down swaps it with the neighbouring unit at its own level. At the first or last place of its level, nothing changes and the answer is `changed: false`. Groups are not reordered.
- Setting `group` to a group id makes the item that group's last item. Alt+ArrowRight uses the nearest group whose block lies above the item, and does nothing when the item is already in a group or no group lies above it.
- Setting `group` to `null` places the item just after the group's last row. It does nothing when the item is not in a group.
- Reorders are applied in the order the server receives them. Each one is relative to the order at that moment, so two people's reorders both take effect, one after the other.
- Deleting an item removes its links and assignments and cancels its queued notices. Deleting a group leaves its items ungrouped at its place.

**Versions and concurrency.**

- An item's `version` starts at 1 and goes up by 1 for each accepted edit of that item: name, chosen start, duration, percent, group, assignees or its incoming links. Being pushed by a link, a holiday or a reorder does not change it.
- Edits to one project are applied one at a time, in the order the server receives them. An edit whose `baseVersion` is not the item's current version answers 409 `version_conflict`.
- Of two or more simultaneous edits with the same `baseVersion`, exactly one answers 200. The others answer 409, and only the winner is stored.
- The browser that is refused shows the conflict alert and puts the server's state on screen: a dragged or nudged bar returns to the server's place, and an open Task details dialog takes the current values and the current version, so saving again works.

**Presence.** Everyone with the project page open appears in `People here` within one second of opening it. A person who leaves is removed within `PRESENCE_TIMEOUT_SECONDS`.

**Workload.**

- An assignment gives a person a number of hours a day, from 0.5 to 24 in steps of 0.5, on a task (never a milestone or a group). Only owners and editors can be assigned, and a person can be assigned to a task once.
- A person's load on a weekday is the sum of their assignment hours over every task, in every project of the workspace, whose start-to-end range includes that day and for which that day is a working day of the task's project.
- Capacity is in hours a day, and the default is 8. A day is over-allocated when the load is greater than the capacity; equal is not over.
- Hours show as a whole number or with one decimal (`10`, `6.5`).
- Example, with the seed data at start: Asha Rao has Draft brief at 4 hours a day. Assigning her Write copy at 6 hours a day makes Tue 2 Mar and Wed 3 Mar 2027 10 hours each, both over-allocated, while Mon 1 Mar stays at 4. Her Office move task Pack desks counts 3 hours on Wed 10 Mar 2027, even though that day is a Spring launch holiday. Ben Ode at exactly 8 of 8 hours on Thu 11 and Fri 12 Mar is not over-allocated.

**Workload grid.**

- The grid shows the ten weekdays of two weeks from a Monday, which defaults to the Monday of today's week.
- It has one row per owner and editor of the workspace, sorted by name, with the person's name as the row header.
- Each day cell has `data-date`, `data-hours` (`0` when there is no load) and `data-over` (`true|false`), and shows the hours (empty when 0).
- Each day cell's `aria-label` is `<name>, <date>: <hours> of <capacity> hours`, followed by `, over-allocated` when over. For example: `Asha Rao, Tue 2 Mar 2027: 10 of 8 hours, over-allocated`.
- `Over-allocated days` is the count of over-allocated days among the ten shown.
- The breakdown dialog lists the day's assignments in the order of the API's `assignments`.
- The grid updates in place within one second of any accepted edit in any project of the workspace.

**Assignment notice.** The notice states are queued, then sent or cancelled.

- When an owner or editor assigns someone other than themselves, the server queues one notice.
- It is sent no earlier than `ASSIGN_NOTICE_DELAY_SECONDS` after the assignment and no later than 5 seconds after that.
- If the assignment is removed, or its task deleted, within the delay, the notice is cancelled and nothing is sent. Assigning the same person again later queues a new notice.
- Self-assignment and the setup route send nothing.
- The queue lives in Postgres, so a restart neither loses nor repeats notices.

**Exports.** An export moves through the states requested, rendering, then stored (the link is shown) or failed (the outage alert is shown and the person can try again).

- The server answers 201 only after it has confirmed that the stored object exists in MinIO.
- Only stored exports are listed. They stay downloadable after a reload.
- The filename is `<project slug>-<today>.csv` or `<project slug>-<today>.pdf`. The project slug is the name in lower case, with each run of characters other than a-z and 0-9 turned into `-`, then trimmed of `-` at both ends. Example: `spring-launch-2027-03-04.csv`.

**CSV format.**

- UTF-8 with no byte-order mark, comma-separated, quoted by RFC 4180 rules, and each line ending with a carriage return and line feed.
- The header is exactly `Row,Name,Type,Group,Start,End,Duration,Percent complete,Critical,Assignees,Predecessors,Baseline start,Baseline end,Variance`, followed by one line per row in row order.
- Columns:
  - Type is `task`, `milestone` or `group`.
  - Group is the group's name, or empty.
  - Dates are `YYYY-MM-DD`, and empty for an empty group.
  - Duration is in working days (0 for a milestone).
  - Critical is `yes` or `no`.
  - Assignees are `<name> (<hours>)`, sorted by name and joined by `; `.
  - Predecessors use the canonical text.
  - Variance is a signed integer with no plus sign (`3`, `-2`, `0`).
  - The baseline columns and Variance are empty without a baseline, for groups, and for items added after the baseline.
- A Name, Group or Assignees value that begins with `=`, `+`, `-` or `@` is written with a leading `'`. For example, a task named `=Total` is written as `'=Total`.
- For example, with the seed data at start, the first lines after the header are:

```
1,Content,group,,2027-03-01,2027-03-05,5,33,no,,,,,
2,Draft brief,task,Content,2027-03-01,2027-03-03,3,20,no,Asha Rao (4),,,,
3,Review brief,task,Content,2027-03-04,2027-03-05,2,75,no,,2FS,,,
```

**PDF format.**

- A4 landscape, with the project name as the document Title metadata.
- 20 rows a page, so there are ceil(rows / 20) pages and at least 1.
- Every page shows the project name at the top and `Page <n> of <N>` at the bottom.
- Each row is printed as one line of real, selectable text: the row number, name, start, end (`YYYY-MM-DD`), duration and percent with `%`, in that order, separated by spaces.

### Services (DP-48, DP-50, DP-53)

- **Postgres** holds workspaces, members and roles, people, sessions, projects, items with their chosen starts and versions, links, holidays, assignments, comments, baselines, the notice queue and export records. Every date calculation reads from it. Apply the schema idempotently every time the server starts.
- **MinIO** stores each export in the bucket `S3_BUCKET` under the key `exports/<project id>/<export id>/<filename>`, with content type `text/csv; charset=utf-8` or `application/pdf`. Downloads stream from MinIO through the app; the browser never talks to MinIO. While MinIO is unreachable:
  - creating an export answers 503 `{"error": "storage_unavailable"}`, records nothing as stored and shows the storage outage alert with no link;
  - downloading answers the same 503;
  - listing still works.
- **Mailpit** receives each assignment notice over SMTP at `SMTP_HOST` and `SMTP_PORT`:
  - From: `MAIL_FROM`.
  - To: `<name> <email>`.
  - Subject: `New assignment: <item> in <project>`.
  - Plain-text body lines, each on its own line: `<assigner> assigned you to <item> in <project>.`, `Starts: <date>`, `Ends: <date>`, `Hours a day: <hours>`, `Open: <APP_PUBLIC_URL>/projects/<project id>?task=<item id>`.
  - The dates are the long format, as scheduled when the mail is sent.
  - Opening the link after sign-in opens the project with that item's Task details open.
  - While SMTP is unreachable, notices stay queued and are retried every 10 seconds. Each is sent once when SMTP returns. The assignment's success copy never claims that a mail was sent.

### Seed data (DP-02)

The app starts with an empty database: no people and no workspaces. The records below are the published example data, which the verifier builds through the setup route. Every person, workspace and project here is invented.

**People** (all with capacity 8):

| Name | Email | Password | Role in "Harbour Street Studio" |
|---|---|---|---|
| Asha Rao | `asha@slackwater.test` | `asha-plans-2027` | owner |
| Ben Ode | `ben@slackwater.test` | `ben-plans-2027` | editor |
| Cara Lund | `cara@slackwater.test` | `cara-plans-2027` | editor |
| Devi Shah | `devi@slackwater.test` | `devi-plans-2027` | viewer |

**Project "Spring launch".** Holiday `2027-03-10` `Founders Day`. Rows in order:

| Row | Key | Name | Kind | Group | Start | Duration | Percent | Assignees |
|---|---|---|---|---|---|---|---|---|
| 1 | `content` | Content | group | | | | | |
| 2 | `draft` | Draft brief | task | content | 2027-03-01 | 3 | 20 | Asha Rao 4 |
| 3 | `review` | Review brief | task | content | 2027-03-04 | 2 | 75 | |
| 4 | `write` | Write copy | task | content | 2027-03-02 | 2 | 10 | |
| 5 | `design` | Design pages | task | | 2027-03-11 | 4 | 0 | Ben Ode 8 |
| 6 | `signoff` | Sign-off | milestone | | 2027-03-15 | 0 | 0 | |

Links: draft -> review FS 0; draft -> write SS 1; review -> design FS 0; design -> signoff FS 0. No baseline.

**Project "Office move".** No holidays. One row: `pack`, Pack desks, task, start 2027-03-08, 3 days, 0%, Asha Rao 3 hours a day. No links.

**Project "Link examples".** Holiday `2027-03-10` `Founders Day`. Every start is 2027-03-01 and every percent is 0:

- `a` Plan route, task, 3 days
- `b` Book venue, task, 2 days
- `c` Print maps, task, 4 days
- `d` Pack kits, task, 3 days
- `e` Kick-off, milestone
- `f` Send reminders, task, 2 days

It has no links at start; worked example 3 lists the links that are added.

**Landing demo.** The landing demo's `Order tiles` and `Lay floor` rows are fixed page content, not records.

## Technical requirements

### Deployment (DP-01)

- Node.js 22 with npm is available. Write the server and client in TypeScript.
- `/app/run.json` is a JSON object with the string fields `install`, `build` and `serve`, plus `"_schema": "run-manifest-v1"`. For example:

```json
{"_schema": "run-manifest-v1", "install": "npm ci", "build": "npm run build", "serve": "npm start"}
```

- The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set.
- `GET /api/health` answers HTTP 200 with JSON `{"status": "ok"}` in every grading instance, including the storage-outage instance. It never answers 503.
- The grader also runs a second instance with file storage broken, as listed in Configuration.

### Configuration and secrets (DP-04, DP-60)

Read every variable at start. Never hard-code any of them, and never send any credential to the browser.

- Postgres: `DATABASE_URL`.
- MinIO: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. The bucket already exists.
- Mail: `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` (default `Slackwater Plan <plans@slackwater.test>`).
- `GRADING_KEY`: the setup route is disabled when it is unset.
- `PLAN_TODAY` (`YYYY-MM-DD`) and `PLAN_TIME_ZONE` (IANA name, default `UTC`).
- `ASSIGN_NOTICE_DELAY_SECONDS` (default 60) and `PRESENCE_TIMEOUT_SECONDS` (default 15).
- `KNOCK_ON_MS` (default 220), `KNOCK_ON_STAGGER_MS` (default 45) and `FINISH_MOTION_MS` (default 320), all in milliseconds.
- `APP_PUBLIC_PORT` and `APP_PUBLIC_URL`, used in mail links. The default for `APP_PUBLIC_URL` is `http://localhost:<port>`.

The grader's main instance sets `PLAN_TODAY=2027-03-04`, `PLAN_TIME_ZONE=Europe/London`, `ASSIGN_NOTICE_DELAY_SECONDS=6`, `PRESENCE_TIMEOUT_SECONDS=5`, `MAIL_FROM=Slackwater Plan <plans@slackwater.test>` and a secret `GRADING_KEY`. The storage-outage instance is the same except that `S3_ENDPOINT=http://127.0.0.1:9`.

### Server boundary (DP-05, DP-20, DP-60)

- Pages, assets, the API and the live channel are all served from one origin. A state-changing request whose `Origin` header names another origin answers 403 `bad_origin`. Requests without an `Origin` header are allowed.
- JSON request bodies may be at most 100,000 bytes. Exactly 100,000 bytes is allowed; more answers 413 `too_large`. A POST, PATCH or PUT body that is not `application/json` answers 415 `unsupported_media_type`.
- The server serves only the built client assets and the routes in this brief. It never serves source files, `run.json`, environment files, credentials or stack traces.
- The browser makes no external requests. The STIX Two Text font files, icons and all code come from the app, from open-licensed packages.
- Every edit is decided by the server, whatever the page shows. A viewer's write answers 403 `read_only`.
- At boot, if MinIO or SMTP is unreachable, the server still starts and serves, and those features degrade as described in Services. If Postgres is unreachable at boot, the server retries every 2 seconds and opens its port once the schema is applied.

### Browser support and performance (DP-37, DP-57)

- Current Chromium, Firefox and WebKit are supported, at 375x812, 768x1024 and 1280x800, with mouse, keyboard and touch.
- A project of 200 items is usable within three seconds of opening.
- An edit on a 200-item project is answered within half a second.
- A pushed change is applied in every other open view as soon as it arrives, with no timer or debounce, and within one second of the server accepting it.
- The Gantt, List and Workload views have no automated accessibility (axe) violations at the three sizes.

## Working rules

- IF-01: `/app/run.json` exists with the string fields `install`, `build` and `serve` and `"_schema": "run-manifest-v1"`, and nothing else is needed to run the app.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) with its name, version and licence, plus the STIX Two Text font and its licence.
- IF-03: Every shipped package and bundled font uses one of these licences: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, CC0-1.0 or OFL-1.1.
- IF-04: The app uses only Postgres, MinIO and Mailpit as backing services. The shipped packages include no other database, cache, queue or embedded datastore, and no realtime or PDF web service.
- IF-05: The provided service configuration (the compose files and the dev environment values) is left unchanged.
- IF-06: All application source, server and client, is TypeScript, compiled by the `build` command, and `package-lock.json` is committed.

## Engineering standards

- The code is idempotent TypeScript, with strict type checking on and no `any` used where the domain type is known.
- Names in the code use the domain terms from this brief: chosen start, shown start, working day, link bound, lag, total float, critical, baseline, variance, workload, capacity, knock-on.
- Each domain rule is decided in exactly one place in the source, and every view and export reads that result. The rules are: the working-day calendar, the forward and backward passes, the group rollup, the late flag, variance, workload hours, the loop check, the version check and the export state.
- No abstraction has only a single implementation, and there are no defensive checks for states the rules make impossible.
- There is no dead, commented-out or unreachable code, and no feature beyond this brief.
- Every API error is produced through the one published error shape and precedence.
- Browser state for a project comes only from server results and pushed changes. The browser never recomputes dates, critical flags, late flags or rollups. The one exception is the snapped start and end it previews in the drag tip and the in-flight bar while a drag or key edit waits for the server.
