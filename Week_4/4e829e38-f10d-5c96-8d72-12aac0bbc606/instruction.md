# Corran & Bly Everyweek

Everyweek is a rule-driven work hub for small crews that run the same routines week after week: a community kitchen's orders, a makerspace's machine upkeep, a small office's month-end close. An operations coordinator builds projects with sections, custom and formula fields and automation rules. Team members work through tasks in list, board and timeline views with a live inbox. Goals roll up from the work underneath, workload is checked against each person's daily capacity, a public intake form turns requests into tasks, and approvers decide from their inbox. One TypeScript app serves the pages, the API and an in-process live channel. It stores everything in postgres, keeps attachments and project downloads in minio (an S3-compatible object store), and sends mail through mailpit. There are no other datastores, no payments, no third-party sign-in and no outbound calls to outside HTTP services. Every person, team and business in this brief is invented.

## Problem and users

Small teams that run recurring operations keep the same work going in a shared spreadsheet, a chat thread and somebody's memory. Repeating jobs are copied by hand and forgotten when that person is away. A request arrives by message and never becomes a tracked job. Sign-offs happen in side chats and nobody can say later who agreed. Spreadsheet formulas break silently when a column moves. Home-made automations fire twice or never, and nobody can see what ran. Goal progress is a number someone types in. One person ends up with four jobs on the same Tuesday while a teammate has none. When two people change the same job at once, one change quietly overwrites the other. The cost falls on the coordinator, who rebuilds the week by hand every Monday.

- **Operations coordinator** (daily): builds projects with sections, custom and formula fields, writes automation rules from triggers, conditions and actions, sets weighted goals, and balances each member's daily workload against capacity.
- **Team member** (daily): works through tasks in the list, board and timeline by keyboard or on a phone, clears a live inbox, attaches files and sees teammates' edits appear in place without a reload.
- **Approver** (weekly): decides approval requests (approve, request changes or reject) from their inbox in a second window and sees the requester's task change at once.
- **Requester** (monthly): submits a request through a public intake form while signed out, and the request becomes a task by the form's published mapping.

## Journeys

1. **Build the week.** The coordinator signs in and opens a project that has sections and a list view. In the `Add task` row of a section they type three task names, pressing Enter after each. Focus stays in the row and the tasks appear in order. They select the three rows with Shift+ArrowDown, set the Tags field on all three at once, and indent one row under the row above. A teammate's open list shows the new tasks, the nesting and the tags without reload.
2. **Watch a rule fire.** A project has four rules that chain. The coordinator sets a task's Stage field to Ready. The task's Rule runs panel fills with entries in firing order, each indented one level deeper than the rule that set it off. The chain stops at the depth limit with the stop message, and the formula column on the task updates at the same moment. A teammate's open panel receives the same entries live.
3. **Request to decision.** A signed-out requester opens the public form, submits it with a mistake, fixes it, and sees a reference. The coordinator's open list shows the new task in place. The coordinator asks an approver to approve it. In a second window the approver opens their inbox, presses Decide, picks Approve and saves. The requester's task chip changes to Approved in place, and the requester's inbox gets the decision item.
4. **Move work by keyboard and touch.** On the board a team member picks up a card with Space, moves it with arrows, drops it, and hears each step announced. On the timeline they shift a bar by one day and link a blocker to a waiting task. On a 375 by 812 phone they switch views with tabs, tap a task to open it as a bottom sheet and drag a card to another column by touch.
5. **Recurring work and the digest.** The grader moves the server clock past a recurring task's due date. Exactly one next task appears in teammates' lists with the announcement. A member with unread inbox items gets exactly one digest mail for the window.
6. **Two people, one task.** Two members open the same task. One focuses the Name field, and the other sees the field read-only with the lock text. The first saves, and the second's open detail shows the new name. The second then saves the Description from an old version and meets the stale-save dialog.
7. **Goals and workload.** The coordinator opens the goal tree, changes a sub-goal's manual value, and the parent goals and their progress bars move in place in another window. On the workload grid they find a person over capacity on Friday, open the cell, and reassign a task to a teammate. The cells update in both windows.
8. **Monthly report.** A member attaches a receipt to a task, then prepares a CSV download of the project. The download shows Ready only after the object store confirms the file. With the object store unreachable it fails with the published message and offers nothing.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health** The app installs, builds and serves from the run manifest on the published port, and its health answers as qualified in Deployment, including on the instance whose object store is unreachable.
- **DP-02 — Grading seed and clock hook** When the grading variable is set, the grading routes create the published records with chosen timestamps, return every id, fix the server clock and run work that has become due once.
- **DP-03 — Error order and shapes** Every endpoint answers failures in the one published order with the published body shapes.
- **DP-04 — Published environment limits** Each published environment variable sets its limit and has the published default when unset.
- **DP-05 — Live updates across instances** Every change appears in place on every open page of the team, including pages served by another app instance, without a reload and without moving that page's focus.
- **DP-06 — Page clock contract** Every card and bar move, progress bar and run entry runs on the page clock, with state written before the motion starts and reduced motion showing the end state at once.
- **DP-07 — Server boundary** The server stays same-origin, bounds request bodies, never serves source or secrets and starts when a dependency is unreachable.
- **DP-08 — Self-contained assets** The app ships its one open-licensed font and its icons and loads nothing from outside its own origin.
- **DP-09 — Welcome page** A signed-out visitor sees the welcome page whose header menus, team-kind chips, sign-up block, showcase and footer behave as published.
- **DP-10 — Visual language** Every screen, including empty, loading, error and outage states, carries the published palette, type, shapes and density at all three viewports.
- **DP-11 — Provider wiring** Files are stored in and read from the object store, mail leaves through the mail service, and every credential is read from the environment.
- **DP-12 — Sign-up and verification** A new account receives a six-digit code by mail, must verify it before it can join a team, and then joins with the team code.
- **DP-13 — List keyboard entry and selection** A team member adds tasks in order from the Add task row, moves between cells and extends a row selection by keyboard with focus staying put.
- **DP-14 — Subtasks and multi-select tags** Indenting, outdenting and setting a multi-select field on a selection change the saved tasks by the published rules and appear in a teammate's open list in place.
- **DP-15 — List announcements** The List status region announces selection, nesting and tag changes with the published text.
- **DP-16 — Board keyboard moves** A team member picks up, moves, drops or cancels a card by keyboard with each step announced in Board status.
- **DP-17 — Board drag and persisted order** A pointer drag moves a card between columns, the order survives a reload, and a teammate's open board shows the change in place.
- **DP-18 — Move motion** A moved card exposes its progress on the page clock at the published sample times and settles at once under reduced motion.
- **DP-19 — Timeline keyboard moves** A coordinator shifts a bar or its due date by one day by keyboard with each change announced in Timeline status.
- **DP-20 — Dependencies** A coordinator links a blocker to a waiting task by keyboard, the line appears for teammates in place, and a waiting bar warns when it starts before its blocker is due.
- **DP-21 — Timeline bars** Every bar names its task and dates exactly, and its date attributes match the saved dates after each move.
- **DP-22 — Formula editor by keyboard** A coordinator opens the formula editor from its column header, inserts a field reference from the suggestions, keeps focus inside, and returns to the header button on close.
- **DP-23 — Formula values** Formula fields compute on the server by the published language and its rules for blanks, dates and rounding, and update in place for every open list.
- **DP-24 — Formula errors and bounds** An invalid or oversized formula is refused with the exact message and character position, and runaway evaluation stops within the published budget.
- **DP-25 — Rule builder by keyboard** A coordinator builds and saves a rule using only the keyboard and hears the published confirmation.
- **DP-26 — Rule runs once per trigger** A rule runs once per trigger event even when two app instances receive the trigger at once, and rules on the same trigger run in position order.
- **DP-27 — Chain depth and run limit** A rule set off by another rule counts one level deeper, a chain stops at the published depth with the exact message, and runs over the limit are skipped with the exact message.
- **DP-28 — Rule runs panel** The task's Rule runs panel lists entries in the published order and indented by depth, and a teammate's open panel receives each entry in place.
- **DP-29 — Rule trace line** The working screens draw a pink-to-coral line through the tasks the last rule run changed.
- **DP-30 — Repeat rules** Next due dates follow the published repeat rules, as qualified in Business rules.
- **DP-31 — Successor created once** A recurring task creates exactly one successor per period across both instances, whether it is completed or the server clock passes its due date, as qualified in Business rules.
- **DP-32 — Complete by keyboard** Completing a row by keyboard keeps focus on that row, and a teammate's list shows the successor in place with its announcement.
- **DP-33 — Goal rollup** Goal progress is the published weighted average of sub-goals, linked projects and manual value, rounded only for display, and every parent changes when a child changes.
- **DP-34 — Goal tree by keyboard** A team member walks the goal tree by keyboard and opens a goal, and a manual change to a sub-goal moves every parent in a second window.
- **DP-35 — Progress bar motion** A progress bar's drawn width eases from the old to the new value on the page clock at the published samples and jumps under reduced motion.
- **DP-36 — Workload cells** A task's effort is spread over its working days, and each person's cell shows total, capacity and the over-capacity label by the published text.
- **DP-37 — Workload grid by keyboard** A coordinator moves between cells by keyboard, opens a cell's task list and reassigns a task through the Reassign task dialog.
- **DP-38 — Reassign by drag** A pointer drag of a task chip onto another person's row reassigns it, and the cells update in a teammate's grid in place.
- **DP-39 — Intake errors** A signed-out requester who submits an incomplete form sees the error summary, focus moves to it, and each link moves focus to its field.
- **DP-40 — Intake mapping and reference** A valid submission becomes a task by the published mapping with the next reference and appears in the coordinator's open list in place.
- **DP-41 — Intake on a phone** The intake form is one column on a phone, and no focusable control lies under the top bar after scrolling.
- **DP-42 — Deciding an approval** An approver decides from a second window through the Decide dialog with focus kept inside and returned.
- **DP-43 — Approval states and order** A decision follows the approval state machine and the published error order.
- **DP-44 — Decision results** A saved decision is announced, the requester's task chip changes in place, and the requester's inbox gains the published item.
- **DP-45 — Inbox by keyboard** A team member moves between inbox items, marks them read and archives them by keyboard, with focus never falling to the page body.
- **DP-46 — Live inbox and badge** New inbox items arrive at the top in place with an announcement, and the top bar link shows the unread count.
- **DP-47 — Digest mail** Each member gets one digest mail per window that has something waiting, driven by the server clock and sent once across instances.
- **DP-48 — Edit hold** A field being edited is held for its editor and shows the published lock text and read-only state to everyone else.
- **DP-49 — Stale save dialog** A save from an old version is refused, and the page shows the published dialog with focus kept inside and returned.
- **DP-50 — Hold lapse** A hold and a lost viewer's presence lapse after the published timeout on the server clock, and the field becomes editable in place.
- **DP-51 — Phone views and sheet** At 375 by 812 the views are tabs switched by arrow keys, and a tapped task opens as a bottom sheet that returns focus on close.
- **DP-52 — Touch drag** A touch drag moves a card to another column on a phone.
- **DP-53 — Breakpoints and collapsed panel** At each published viewport the layout is the published one, a collapsed panel is unavailable, and no focusable control lies under the top bar.
- **DP-54 — Other team's project** A project outside the caller's teams answers as not found in the API and on the page.
- **DP-55 — Deletions keep focus** Deleting a task, a section or a field announces it, updates teammates in place and puts focus on the published next control.
- **DP-56 — Delete confirmations** Each delete confirmation keeps Tab inside and returns focus to the opener on Cancel or Escape.
- **DP-57 — Attachment cap** An attachment over the size cap is refused before any field is checked, with the published page copy.
- **DP-58 — Project files** A project download in CSV or JSON is Ready only after the object store confirms the file, and its values match the published columns.
- **DP-59 — Download outage** While the object store is unreachable the download fails with the published message, nothing is offered and focus stays in the dialog.

## Frontend

### Screens and layout (DP-09, DP-10, DP-13, DP-16, DP-19, DP-36, DP-41, DP-51, DP-53, DP-54)

The pages are `/` (welcome page when signed out, My work when signed in), `/account`, `/projects/:id` (list, board and timeline, chosen by the address query `view=list`, `view=board` or `view=timeline`, list by default), `/projects/:id/rules`, `/goals`, `/workload/:teamId` (optional query `from`), `/inbox`, and the public `/f/:slug`. Pages other than `/`, `/account` and `/f/:slug` send a signed-out visitor to `/account`. A project of another team, or an unknown id, shows the heading `Project not found` with a pill action back to My work.

**Published viewports.** 375x812, 768x1024 and 1280x800 each show exactly the layout below, with no horizontal overflow of the page. No breakpoint between them changes which layout a published viewport gets.

**Top bar.** On every page, a 56 px bar is the only sticky element. Scrolling gives it a hairline shadow. After scrolling, no focusable control lies under it, and focused controls scroll into view at least 72 px below the page top. Signed in, it holds the logo mark and wordmark, the links My work, Goals and the inbox link, and an account menu. At 375 the links fold into a `Menu` disclosure whose collapsed content is hidden and unavailable. Signed out, it is the workspace header with mega menus (see Visual design).

**Welcome page.** Top to bottom: the header, a centred hero (headline, subline, the team-kind chips), a two-column area, the dark view showcase band, the team lead story, the start your workspace band and the dark site footer. At 1280 the two-column area puts the heading, copy and sign-up block on the left and the collage on the right. At 768 and 375 it is one column with the collage first and the chips scrolling sideways inside their own row.

**Account.** One centred column at every size, with sign-up, verification, sign-in and join-a-team in that order.

**My work.** Heading, the list of the signed-in person's open tasks grouped by due status (each with its server-given status chip), the list `Projects` of the team's projects, and a `New project` button. At 1280 the two lists sit side by side, otherwise stacked.

**Project page.** A left project rail (the `Project panel`), a pill chip row above the view, and the view itself.
- At 1280 the panel is open on the left and the views are the chip row. The task detail docks as a side panel on the right.
- At 768 the panel is collapsed by default. The views are the tab list `Project views`, and the task detail opens as a sheet from the right edge covering about two thirds of the width.
- At 375 the panel is collapsed by default and opens in flow above the view. The views are the same tab list. Tasks open as a bottom sheet covering the full width and most of the height. The page title and chip row never push the view below the first screen.
- The chip row always shows the three view tabs, then the links `Workload` and `Rules`, and a `Download project` button.
- List: a grid with sections as groups. At 375 each row wraps, with Name on its own line and the other cells below, and the grid's roles and cell names stay the same.
- Board: columns are the sections, and cards are top-level tasks only. A card's `data-position` and its `position <i> of <n>` count the top-level tasks of that section, the same as the API `position`. At 1280 they sit side by side, at 768 two per row, and at 375 stacked one under another so a touch drag can cross columns without sideways scrolling.
- Timeline: one bar per scheduled top-level task on a grid of days that is 32 px a day at 1280 wide and scrolls sideways inside its own region at the smaller sizes. A task with a due date but no start draws a one-day bar on its due date, whose name and date attributes use the due date as both start and due. Moving that bar saves both dates. A task with a start but no due date, or with no dates, is listed under the grid as `Unscheduled`.

**Task detail.** At 1280 a docked region, at 768 and 375 a dialog sheet, both named `Task: <task name>`. It shows Name and Description with their save buttons, Assignee, Start, Due, Effort, custom and formula values, the approval chip and buttons, `Viewing now`, `Rule runs`, `History`, `Attachments` with `Attach file`, and `Delete task`.

**Rules page.** A list of the project's rules in position order, the `New rule` button, and the rule recipe carousel above the list.

**Goals.** A stack of link cards for top-level goals, then the goal tree. **Workload.** A header with the team name and the grid below it, ten working-day columns wide, with the grid scrolling sideways inside its own region at 375 and 768. **Inbox.** One column list. **Public form.** One column at every size.

### Public screens and controls (DP-01 to DP-59)

Only these controls and regions are public. Everything else is free.

| Role and accessible name | Visible copy and notes |
|---|---|
| link `My work`, link `Goals`, link `Inbox, <n> unread` | top bar; `<n>` is the unread count, `0` when none |
| button `Menu` | 375 only; collapses to unavailable when closed |
| button `Project panel` | project pages; `aria-expanded` |
| status `Notifications` | toasts, bottom centre |
| status `Inbox status` | present on every signed-in page |
| button `Work`, `Teams`, `Learn` | welcome header mega menus |
| link `Log in`, link `Try the sample form`, link `Get started` | welcome header |
| heading level 1 | `Recurring work that runs itself` |
| tablist `Team kinds` with tabs `Office ops`, `Content`, `Client work`, `Facilities`, `Finance close`, `Studio` | the selected tab has `aria-selected="true"`; its panel's heading is level 2 |
| textbox `Work email`, button `Sign up` | welcome sign-up block |
| tablist `Showcase views` with tabs `List`, `Board`, `Timeline`, `Workload`, `Rules` | dark band |
| textbox `Name`, `Email`, `Password`; button `Create account` | `/account` sign-up |
| textbox `Verification code`, button `Verify` | `/account` |
| textbox `Sign-in email`, `Sign-in password`; button `Sign in` | `/account` |
| textbox `Team code`, button `Join team` | `/account` |
| status `Account status` | `/account` messages |
| heading `My work`, list `Projects`, button `New project` | dialog `New project` has textbox `Project name`, textbox `Sections` (comma separated), buttons `Create project` and `Cancel` |
| tablist `Project views` with tabs `List`, `Board`, `Timeline` | at 1280 these are the chip row, with the same roles |
| link `Workload`, link `Rules`, button `Download project` | chip row |
| grid `Tasks` | columns Name, Assignee, Due, Effort, then one per custom or formula field; rows `role="row"` with `data-task`, `aria-level` (1 task, 2 subtask), `aria-selected` |
| button `Open <task name>` | inside each row's Name cell |
| textbox `Add task` | the row at the end of each section |
| button `<section name>` | section heading button; button `Delete section` and button `Add section` |
| button `Set Tags for selection` | named `Set <field name> for selection` for each multi-select field; opens dialog `Set Tags` with one checkbox per option and buttons `Apply tags` and `Cancel` |
| button `Edit formula for <field>` | header of a formula column; other custom columns have button `Edit field <field>`, and each has button `Delete field`; button `Add field` |
| dialog `Edit formula: <field>` | textbox `Formula`, listbox `Field suggestions`, alert region for errors, buttons `Save formula` and `Cancel` |
| dialog `Add field` | textbox `Field name`, combobox `Field type`, textbox `Options`, buttons `Add field` and `Cancel` |
| dialog `Edit field: <field>` | textbox `Field name`, buttons `Save field` and `Cancel` |
| status `List status` (polite) | list announcements |
| group `<section name>` with `role="button"` cards named `<task name>, <section>, position <i> of <n>` | board; cards carry `data-task`, `data-section`, `data-position`, `data-move-progress`, `data-motion` |
| status `Board status` (assertive) | board announcements |
| buttons named `<task name>, <start> to <due>` | timeline bars with `data-task`, `data-start`, `data-due`, `data-move-progress`, `data-motion`; dependency lines have `data-from`, `data-to` |
| status `Timeline status` (polite) | timeline announcements |
| complementary or dialog `Task: <task name>` | detail; button `Close task` |
| textbox `Name`, `Description`; buttons `Save name`, `Save description` | detail |
| combobox `Assignee`; textbox `Start`, `Due`, `Effort` | detail, save on change |
| list `Viewing now`, list `Rule runs`, list `History`, list `Attachments` | detail |
| button `Attach file`, button `Delete task` | detail |
| button `Request approval`, combobox `Approver`, button `Decide` | detail and inbox |
| dialog `Decide on <task name>` | radios `Approve`, `Request changes`, `Reject`; textbox `Comment`; buttons `Submit decision` and `Cancel` |
| status `Approval status` | polite |
| dialog `This task changed` | buttons `Load latest` and `Keep my edit` |
| button `New rule` | rules page |
| dialog `New rule` | textbox `Rule name`; step buttons `Step 1: When`, `Step 2: Condition`, `Step 3: Then`; comboboxes `When`, `Field`, `Value`, `Condition`, `Condition field`, `Then`, `Target`; textboxes `Condition value`, `Action value`; buttons `Save rule` and `Cancel` |
| status `Rules status` | polite |
| region `Rule recipes` with buttons `Previous recipes`, `Next recipes`, and `Use recipe: <name>` | recipe carousel |
| img `Rule trace` | the pink-to-coral line |
| tree `Goals` with `treeitem` named `<goal name>, <n>% complete` | goals |
| progressbar named `<goal name> progress` | `aria-valuenow`, `aria-valuetext`, `data-shown-percent` |
| links `Open <goal name>` | goal link cards |
| dialog `Goal: <goal name>` | spinbuttons `Weight`, `Manual value`; buttons `Save goal` and `Close goal`; button `New goal` opens dialog `New goal` (textbox `Goal name`, combobox `Parent goal`, spinbutton `Weight`, buttons `Create goal` and `Cancel`) |
| grid `Workload` | each cell has `data-person`, `data-date`, `data-total`, `data-over` |
| dialog `Tasks for <person> on <date>` | chips are buttons named by task name |
| dialog `Reassign task` | combobox `Assignee`, button `Reassign` |
| status `Workload status` | polite |
| list `Inbox`, heading `Inbox is empty` | items have `data-item`, `data-read` |
| form page heading, textboxes `Request title`, `Details`, `Needed by`, `Your email`, combobox `Category`, button `Submit request` | `/f/:slug` |
| alert with heading `There is a problem` | error summary with one link per error |
| dialog `Delete <name>?` | buttons `Delete` and `Cancel` |
| dialog `Download project` | radios `CSV`, `JSON`; button `Prepare file`; status `Download status`; link `Download CSV` or `Download JSON` |
| button `Attach file`, status for attachments | see Feedback states |
| heading `Project not found` | page for another team's project |

### Interactions (DP-13 to DP-59)

**Opening a task.** Activating `Open <task name>` in a row, clicking or tapping a board card, or pressing Enter on a card or bar opens the task detail and moves focus into it. `Close task` or Escape (below 1280) closes it and returns focus to the opener.

**List.** Arrow keys move between cells. Enter on a cell edits it: Enter saves and Escape cancels and restores the old value. Typing a name in `Add task` and pressing Enter creates the task at the end of that section and keeps focus in the entry, ready for the next name. Shift+ArrowDown and Shift+ArrowUp extend the row selection from the focused row, and a plain arrow clears it. Ctrl+] indents the focused row under the row above it, and Ctrl+[ outdents it. Ctrl+Enter toggles completed on the focused row and keeps focus on that row. Each shortcut works whichever control inside the row has focus. `Set Tags for selection` opens its popover, and `Apply tags` sets the chosen options on every selected row and returns focus to the button.

**Board.** Space on a focused card picks it up. ArrowRight and ArrowLeft move it to the neighbouring column, keeping its position number when that fits and otherwise the last place. ArrowUp and ArrowDown change its position in the column. Space drops it and saves. Escape cancels and puts it back. A pointer drag of 8 px or more starts a move, and dropping on a column or between cards saves it. A touch drag starts after 8 px too, and the card does not scroll the page while dragged.

**Timeline.** On a focused bar, ArrowRight and ArrowLeft move start and due together by one day. Shift+ArrowRight and Shift+ArrowLeft move only the due date and never before the start. D starts a dependency, arrows move between the other bars, Enter sets it and Escape cancels. Each press saves at once. Enter on a bar opens its task when no dependency is being chosen.

**Formula editor.** Enter or Space on `Edit formula for <field>` opens the popover with focus in `Formula`. Typing `{` opens `Field suggestions`, ArrowDown moves through it and Enter inserts the reference such as `{Effort}`. Tab and Shift+Tab wrap inside the popover. Escape closes it and returns focus to the header button. `Save formula` saves and closes, and an error leaves it open with the alert showing.

**Rule builder.** `New rule` opens the dark panel with step cards. One step is open at a time. Enter or Space on a step button opens it, closes the other, and rotates its chevron. Comboboxes open with ArrowDown, move with arrows and choose with Enter. Tab order is Rule name, then each step button followed by that step's controls when open, then `Save rule` and `Cancel`. Collapsed step content cannot be reached by Tab. `Field` shows only for the trigger `Field changed`. `Value` lists the field's options (or `Any value`) for `Field changed`, and the sections for `Moved to section`. `Condition field` and `Condition value` show when `Condition` is not `Always`. `Target` lists sections, people or fields for the matching action, and `Action value` shows for `Set field`, `Add subtask` and `Send to inbox`. `Use recipe: <name>` opens the dialog with those answers filled in.

**Goals.** The tree opens with every node expanded. Its nodes are goals only (linked projects are not nodes), with top-level goals and children each in name order. Only one node is in the Tab order at a time: Tab into the tree focuses the first top-level goal, and afterwards the last focused node. In the tree, ArrowRight expands a collapsed node and otherwise moves to its first child, ArrowLeft collapses an open node and otherwise moves to its parent, ArrowDown and ArrowUp move between visible nodes, and Enter opens the goal dialog.

**Workload grid.** Arrow keys move between cells, and Enter on a cell opens the popover with focus on its first chip. R on a focused chip opens `Reassign task`. A pointer drag of a chip onto another person's row reassigns it. Both popovers keep Tab inside and return focus to what opened them on Escape. The cell popover stays open beside the grid so rows remain visible for the drag.

**Inbox.** ArrowDown and ArrowUp move between items, Enter opens the task, M toggles read, E archives, and each works whichever control inside the item has focus. `Decide` on an approval item opens the Decide dialog.

**Task detail fields.** Focusing `Name` or `Description` takes the edit hold. `Save name` and `Save description` save and release it. Assignee, Start, Due and Effort save when changed. The stale dialog's `Keep my edit` saves the same text again on the newest version, and `Load latest` replaces the field with the saved value. Both close it.

**Deleting.** `Delete task`, `Delete section` and `Delete field` open the confirmation. `Delete` deletes. `Cancel` or Escape returns focus to the opener.

**Intake form.** `Submit request` with errors moves focus to the summary. Each summary link moves focus to its field.

**Welcome page.** Header menu buttons open their panels on click, and Escape closes them and returns focus to the button. Clicking a team-kind chip swaps the heading, the copy and the collage. Clicking a showcase tab centres that card, and the arrow buttons step the carousels by one card. Hover darkens fills over a fraction of a second.

**Download.** `Download project` opens the dialog. `Prepare file` starts the job, and focus stays on the button.

### Visual design (DP-09, DP-10, DP-29)

**Type.** The whole product is set in Instrument Sans, shipped with the app: medium weight for display text with tight tracking, regular weight for body. Body text is 16 to 20 px with a comfortable line height, and every count, effort and percentage uses tabular figures. Headings step up by about one fifth per level. The hero headline is about four times the body size, section headings about three times, and working-screen headings about one and a half to two times. Headings are in sentence case.

**Palette, by role.** White ground. Near-black ink for text, filled pill buttons, dark bands and the footer. A light grey for board columns and a lighter grey for empty-state panels. A dark grey for step cards on the near-black rule builder and showcase band. A muted grey ink for secondary text. A soft pink marks the current choice (the active chip, tab and view), with dark text on it. A coral red appears only as small marks and as the far end of the trail line. All text meets WCAG 2.2 AA contrast.

**Shapes and density.** Only three radii exist: large panels, 12 px cards and full pills. Density is comfortable, with rows 16 px type tall enough to tap, and every control, including the small round chevrons whose visible circle is smaller, has a tap area of at least 44 px. Dark panels are inset from the edge with the large radius.

**Working screens.** They keep the sticky bar, the project rail and a pill chip row above every view, with the active chip pink. Lists and tables are white with 16 px rows and tabular figures. Board columns are light-grey panels holding white 12 px cards. The rule builder is a near-black panel with dark-grey step cards. A plain-sentence preview of the rule sits beside the open step. Empty, loading and error states are a large sentence with a pill action on the lighter grey. Outages are a full-width dark band with white text.

**Rule trace line.** After a rule run, a thin pink-to-coral line with black end dots is drawn live through the tasks that run changed, in the order they changed (row gutter in the list, overlay on the board, between bars on the timeline). It is exposed as `img` `Rule trace` and replaces the previous trace on the next run.

**Welcome page and seed components.** The page uses the following components, all recast with original copy and invented data:
- **Workspace header with mega menus:** the 56 px sticky bar with a three-dot-free original logo mark (a coral and black pair of linked circles) and the wordmark `Everyweek`. Buttons `Work`, `Teams` and `Learn` open grouped link columns in a white panel under the bar, with chevrons that rotate. On the right sit `Log in`, an outlined `Try the sample form` pill and a filled `Get started` pill.
- **View and team-kind chips:** pills 44 px tall with a 14 px label. The active one is pink and the rest grey or outlined. The pink moves to a new chip in about a fifth of a second. Over the dark band the chips are larger and dark grey.
- **Workspace sign-up block:** two outlined pills `Join with a team code` and `Open a sample request form`, an `or` divider, the `Work email` field and a black `Sign up` pill. A focused field shows a visible dark ring. `Sign up` goes to `/account` with the email filled in.
- **Recurring work collage:** layered white cards (a task row, an intake card, an approval chip, initials avatars) joined by a thin line with black node dots and a pink-to-coral trail. On a chip change the cards cross-fade and shift by about a dozen pixels in about a third of a second and the trail redraws. Reduced motion swaps them at once.
- **Dark view showcase carousel:** a near-black band with large pill tabs, then a centre-snapped row of dark-grey cards with a 64 px icon tile, title, description and a framed mockup that fades to pink at its bottom edge. Neighbouring cards are dimmed. Tab and card move together in about a third of a second. On a phone there are pagination dots. Reduced motion jumps.
- **Rule step accordion:** the rule builder described above, with the chevron turning half a circle in about a third of a second, and the open step's height easing. Reduced motion shows the end state.
- **Rule recipe carousel:** white 304 px cards with an original glossy blob glyph, title, one-line value and example, with two 44 px round arrows. The active arrow is solid black and the disabled one pale. Cards step one at a time in about a third of a second.
- **Goal link card stack:** on `/goals`, a light-grey panel holding stacked white link cards with a 30px-class title, grey subtitle and a black round arrow button. Hover nudges the arrow right a few pixels.
- **Team lead story:** a rounded gradient block in place of a photo, an invented quote and the invented person's name and title. Side by side on desktop, single column on a phone.
- **Start your workspace band:** a full-width near-black band with a large white headline `Start your workspace`, a white pill `Get started` and a small footnote under a divider.
- **Round step and arrow buttons:** the chevrons and arrows above darken on hover and lose opacity when disabled.
- **Dark site footer:** near-black with five link columns and a bottom row with the copyright and a round `Back to top` button. On a phone it stacks to one centred column.

**Hero copy.** The headline reads `Recurring work that runs itself`. Each chip's panel heading and copy line is:
- Office ops: `Month-end close that starts itself` / Checklists repeat on the right day and every sign-off is recorded.
- Content: `Every issue moves on its own schedule` / Briefs, drafts and reviews repeat each cycle and rules hand them on.
- Client work: `Requests become tracked jobs` / A public form turns each request into a task with a named approver.
- Facilities: `Upkeep that never lapses` / Machine and building checks come back every week or month.
- Finance close: `Approvals with a clear paper trail` / Each decision is saved with who agreed and when.
- Studio: `A balanced week for every person` / Daily workload shows who is over capacity before a deadline slips.

### Motion and effects (DP-06, DP-16, DP-18, DP-28, DP-35)

**Test harness.** The grader opens each page with the page clock paused and service workers blocked. Tests advance the page clock with the clock's run-for step so animation-frame callbacks fire. Every card and bar move, progress bar and run-entry slide reads that clock. No hook in the app may wait on an animation frame or a timer: state is written synchronously first, and motion only reads it.

**Move (card or bar).** A moved element animates from its old place over `EVERYWEEK_MOVE_MS` with an easing that starts fast and settles softly (its control points are 0.2 and 0 for the first and 0 and 1 for the second). It exposes `data-move-progress` as the eased fraction with four decimals and `data-motion="moving"`. At the default duration, at 80, 160 and 240 ms after the drop it reads `0.6072`, `0.8778` and `0.9755`. At the full duration it reads `1.0000` and `data-motion="settled"`. At rest it reads `1.0000` and settled. Remote moves from a teammate animate the same way.

**Progress bar.** The drawn width, exposed as `data-shown-percent` with two decimals, eases from the old to the new value over `EVERYWEEK_PROGRESS_MS` with the same curve. At the default duration and from 66.25 to 76.25 it reads `72.32`, `75.03` and `76.00` at 100, 200 and 300 ms, then `76.25`.

**Rule run entry.** Each new entry in `Rule runs` slides in from 8 px offset over 160 ms with the same curve. It exposes `data-motion` (`entering`, then `settled`) and `data-slide-offset` in pixels with two decimals: `3.14`, `0.98` and `0.20` at 40, 80 and 120 ms, then `0.00`.

**Formula cells.** A dependent formula value cross-fades over 240 ms (`data-motion="fading"` then `settled`). The accessible value changes at once.

**Others.** Chip fill, hover and focus changes take about a fifth of a second, carousel and accordion moves about a third of a second, and sections fade up by about a dozen pixels once as they scroll into view. The trace line draws in about a quarter of a second. Toasts fade in and out in under half a second. Nothing loops or moves without a cause. The only repeating effect is none.

**Reduced motion.** Under `prefers-reduced-motion` every element above shows its end state at once with no slide, fade, draw or shift: `data-move-progress` is `1.0000` and settled, `data-shown-percent` is the new value, `data-slide-offset` is `0.00`, and the announced text is the same.

### Feedback states (DP-13 to DP-59)

**Rules that hold on every screen.**
- Every action works from the keyboard. Tab and Shift+Tab wrap inside every open dialog, sheet and popover, Escape closes it, and focus returns to the control that opened it. After a save, move, delete or close, focus never falls to the page body.
- Every string given in backticks renders character for character, with straight apostrophes and plain hyphens, and announcements built from it carry the same characters.
- Announcements go to the named live regions below. An error summary links to its fields.
- A closed or collapsed drawer, sheet, menu, accordion step or panel is hidden, cannot take focus and is absent from the accessibility tree at every viewport.
- While a formula editor or rule builder is open, live updates to the board, list or inbox never take its focus or change its text. A dialog reopened during its close motion stays open. A status or error message an action just showed is never overwritten by the repaint that follows.
- While a request is in flight its control is marked busy and a second activation is ignored, so one action makes one record.
- Touch and reduced-motion variants have the same function as pointer and full motion.
- A teammate's change (a card move, a rule's field change, a goal's progress, a new task, a deletion, a decision) shows in every open page in place, within 2 seconds, and is announced in the region of that screen.

**Live regions and exact copy.**

| Region | Text | When |
|---|---|---|
| `List status` | `3 tasks selected` (`<n> tasks selected`, `1 task selected` for one) | after Shift+Arrow |
| `List status` | `Pack orders is now a subtask of Order dry goods` | after indent |
| `List status` | `Pack orders is no longer a subtask` | after outdent |
| `List status` | `Can't indent Pack orders` / `Can't outdent Pack orders` | when refused |
| `List status` | `Tags set on 3 tasks` (`<Field> set on <n> tasks`, `1 task` for one) | after `Apply tags` |
| `List status` | `Weigh stock repeats on 2026-03-09` (`<task name> repeats on <date>`) | when a successor appears, on every open list of the project |
| `List status` | `<task name> marked complete` / `<task name> marked not complete` | after Ctrl+Enter |
| `List status` | `Task deleted`, `Section deleted`, `Field deleted` | after each deletion |
| `Board status` | `Picked up Order dry goods. To do, position 1 of 3.` | Space |
| `Board status` | `Order dry goods, Doing, position 1 of 2.` | each arrow |
| `Board status` | `Dropped Order dry goods in Doing, position 2 of 2.` | Space again |
| `Board status` | `Move cancelled. Order dry goods is back in To do, position 1 of 3.` | Escape |
| `Timeline status` | `Order dry goods moved to 2026-03-03 to 2026-03-05` | arrow |
| `Timeline status` | `Order dry goods now due 2026-03-06` | Shift+arrow |
| `Timeline status` | `Due date can't be before the start date` | Shift+ArrowLeft at the start |
| `Timeline status` | `Choose the task that waits for Order dry goods` | D |
| `Timeline status` | `Order dry goods now blocks Pack orders` | Enter |
| `Timeline status` | `Dependency cancelled` | Escape |
| `Rules status` | `Rule saved: Ready to review` (`Rule saved: <rule name>`) | after `Save rule` |
| `Workload status` | `Pack orders reassigned to Ilse Marchetti` | after reassign by dialog or drag |
| `Approval status` | `Decision saved: Approved` (`Approved`, `Changes requested`, `Rejected`) | after `Submit decision` |
| `Inbox status` | `New in inbox: <item text>` | when an item arrives |
| `Inbox status` | `Marked as read`, `Marked as unread`, `Archived` | after M or E |
| `Account status` | `We sent a 6-digit code to <email>`, `Email verified`, `You joined <team name>`, `Verify your email before joining a team` | sign-up steps |
| `Download status` | `Preparing`, `Ready` | download job |
| `Download status` | `Download failed: file storage is unavailable. Nothing was saved.` | object store unreachable |
| `Notifications` | `Saved` after an inline cell save; `Couldn't save. Nothing changed.` after a failed save; `This task changed. Try again.` after a stale move in list, board or timeline | toasts, leave after `EVERYWEEK_TOAST_MS` on the page clock |

**Field errors.** Inline forms show the error text under the field, linked with `aria-describedby`, with `aria-invalid="true"`.
- Rule dialog: `Enter a rule name`, `Choose when the rule runs`, `Choose what happens`.
- Formula editor alert: the formula error message exactly as the API returns it.
- Intake summary: `Enter a request title`, `Enter a date today or later`, `Enter an email address like name@example.com`.
- Intake title over its length: `Request title must be 120 characters or fewer`.
- Intake category outside the list: `Choose a category from the list`.
- Sign-up: `Enter your name`, `Enter an email address like name@example.com`, `Use at least 8 characters`, `That email already has an account`.
- Verify: `That code is not right`.
- Decision without a comment: `Add a comment for this decision`.
- Task name: `Enter a task name`.

**Outage.**
- Attachment: `File is larger than 1 MB` (over the cap) and `Attachment failed: file storage is unavailable. Nothing was saved.` (store down). They appear in an alert inside the detail's Attachments area.
- When a file action fails because storage is unreachable, a full-width dark band reads `File storage is unavailable. Everything else keeps working.` under the top bar. It leaves when a later file action succeeds.
- The stale dialog `This task changed` is the only stale-save surface for the detail. The dialog text reads `Someone saved this task after you opened it.`
- Loading shows the sentence `Loading` with a pill action `Reload` after 5 seconds. Empty states: My work `Nothing is assigned to you yet.` with pill `See projects`, inbox heading `Inbox is empty`.

## Backend

### API (DP-02, DP-03, DP-05, and every endpoint below)

All requests and responses are JSON (`application/json`) except attachments (multipart form data) and downloads (the file). JSON request bodies are limited to 262,144 bytes; a body of exactly 262,144 bytes is accepted. Ids are strings, dates are ISO `YYYY-MM-DD`, timestamps are ISO UTC. The workspace time zone is UTC. A session cookie from sign-in authenticates requests.

**Error order, for every endpoint.** 401 (signed out) comes before 404 (anything outside the caller's teams, or unknown, answers `404 {"error":"not_found"}`, never 403, never 500), before 413 (body or file over its cap, before any field is read), before 403 (visible but not allowed), before 409 (stale version, held field, already decided), before 503 (`{"error":"storage_unavailable"}` when the object store is unreachable), before 422 (field errors).
- 401 is `{"error":"unauthenticated"}`.
- 403 is `{"error":"forbidden"}` unless a row names another code.
- 413 is `{"error":"body_too_large"}` unless a row names another code.
- 422 is `{"errors":{"<field>":"<message>"}}`. `<field>` is the request body key that failed (for intake: `title`, `neededBy`, `email`, `category`). `<message>` comes from Feedback states, the endpoint row, or the list below. When one key fails several checks, the first check in this brief's order is reported.
- A body that is not valid JSON answers 422 `{"errors":{"body":"Send a JSON body"}}`.
- Endpoint rows below name only their own extra errors.

**Other 422 messages, by body key.**
- Project: `name` `Enter a project name`; `sections` `Add at least one section`.
- Task: `name` uses the task-name message from Feedback states. `section` `Choose a section of this project`. `effort` `Effort must be 0 or more hours`. `due` uses the due-before-start text from Timeline status. `parentId` follows List nesting.
- Section: `name` `Enter a section name` or `A section with that name already exists`.
- Field: `name` `Enter a field name` or `A field with that name already exists`; `type` `Choose a field type`.
- Goal: `name` `Enter a goal name`; `weight` `Weight must be a whole number from 1 to 10`; `manualValue` `Manual value must be from 0 to 100`.
- Capacity: `weekday` `Choose a weekday from mon to fri`; `hours` `Hours must be from 0 to 24`.
- Form: `slug` `Use lowercase letters, digits and hyphens` or `That form address is taken`; `section` `Choose a section of this project`; `title` `Enter a form title`.
- Approval: `approverId` `Choose a member of this team`.
- Decision: `decision` `Choose a decision`. `comment` uses the missing-comment message from Feedback states, or `Comment must be 500 characters or fewer`.
- Rule: `name`, `trigger` and `action` use the rule dialog messages from Feedback states.
- Hold: `field` `Choose name or description`.
- File: `format` `Choose csv or json`.
- Sign-up, verify and intake: `name`, `email`, `password`, `code`, `title`, `neededBy` and `category` use the messages from Feedback states.

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/health` | none | 200 `{"status":"ok"}` | see Deployment |
| `GET /api/config` | none | 200 `{"moveMs":320,"progressMs":400,"toastMs":4000,"holdTimeoutMs":30000}` (the effective values) | none |
| `POST /api/signup` | `{"name","email","password"}` | 201 `{"id","email","verified":false}`, and a mail with the code | 422 |
| `POST /api/verify` | `{"email","code"}` | 200 `{"verified":true}` | 404 unknown email, 422 wrong code |
| `POST /api/signin` | `{"email","password"}` | 200 `{"id","name","email"}` and the cookie | 401 `{"error":"invalid_credentials"}` |
| `POST /api/signout` | none | 204 | none |
| `GET /api/me` | none | 200 `{"id","name","email","verified","teams":[{"id","name","role"}]}` (`role` is `coordinator` or `member`) | none |
| `POST /api/teams/join` | `{"code"}` | 200 `{"teamId","name"}` | 404 unknown code, 403 `{"error":"not_verified"}` |
| `GET /api/teams/:teamId/projects` | none | 200 `{"projects":[{"id","name","progress"}]}` | none |
| `POST /api/teams/:teamId/projects` | `{"name","sections":["..."]}` | 201 project | 403 not a coordinator, 422 |
| `GET /api/projects/:id` | none | 200 `{"id","name","teamId","progress","members":[{"id","name","email"}],"sections":[{"id","name","position"}],"fields":[{"id","name","type","options","formula"}]}` | none |
| `GET /api/projects/:id/tasks?page=<n>` | none | 200 `{"tasks":[task],"page","pageSize","total"}`, in section order, then position, subtasks directly after their parent, `pageSize` = `EVERYWEEK_PAGE_SIZE` | none |
| `POST /api/projects/:id/tasks` | `{"name","section"?,"parentId"?,"position"?,"assigneeId"?,"start"?,"due"?,"effort"?,"recurrence"?,"values"?}` | 201 task (section defaults to the first, position to last) | 422 |
| `GET /api/tasks/:id` | none | 200 task plus `"attachments":[{"id","name","size"}]`, `"approval":{"status","approverId"}`, `"blocks":[ids]`, `"blockedBy":[ids]`, `"history":[{"text","createdAt"}]`, `"viewing":[{"id","name"}]` | none |
| `PATCH /api/tasks/:id` | `{"version", ...any of name, description, section, position, parentId, assigneeId, start, due, effort, completed, recurrence, values}` | 200 task after every rule it set off has run | 409 `{"error":"stale_task","latest":<n>}`, 409 `{"error":"held_by_other","holder":"<name>"}` (checked first), 422 |
| `DELETE /api/tasks/:id` | none | 204; its subtasks go too | none |
| `POST /api/projects/:id/sections` | `{"name"}` | 201 `{"id","name","position"}` | 422 (name needed or taken) |
| `DELETE /api/sections/:id` | none | 204; its tasks go too | 422 `{"errors":{"section":"A project needs at least one section"}}` |
| `POST /api/projects/:id/fields` | `{"name","type","options"?,"formula"?}` (`type` is `text`, `number`, `date`, `single_select`, `multi_select`, `formula`) | 201 field | 422 |
| `PATCH /api/fields/:id` | `{"name"?,"formula"?}` | 200 field | 422 `{"errors":{"formula":"<formula error message>"}}`; the old formula stays |
| `DELETE /api/fields/:id` | none | 204; stored values go | none |
| `POST /api/tasks/:id/dependencies` | `{"blocks":"<task id>"}` | 201 `{"from","to"}` | 422 `{"errors":{"blocks":"A task can't block itself or create a loop"}}` |
| `POST /api/tasks/:id/hold` | `{"field":"name"\|"description"}` | 200 `{"field","holder":{"id","name"},"expiresAt"}` | 409 `held_by_other`, 422 |
| `DELETE /api/tasks/:id/hold` | `{"field"}` | 204 | none |
| `POST /api/tasks/:id/approval` | `{"approverId"}` | 201 `{"status":"requested","approverId"}` | 409 `{"error":"already_requested"}` while the latest request is undecided, 422 approver not a team member |
| `POST /api/tasks/:id/decision` | `{"decision":"approve"\|"request_changes"\|"reject","comment"?}` | 200 `{"status":"approved"\|"changes_requested"\|"rejected"}` | 403 not the approver, 409 `{"error":"already_decided"}`, 422 |
| `GET /api/projects/:id/rules` | none | 200 `{"rules":[rule]}` in firing order | none |
| `POST /api/projects/:id/rules` | `{"name","trigger","condition"?,"action"}` | 201 rule with `"position"` (last) | 403 not a coordinator, 422 |
| `GET /api/tasks/:id/rule-runs` | none | 200 `{"runs":[{"id","depth","summary","detail","createdAt"}]}` in published order | none |
| `GET /api/teams/:teamId/goals` | none | 200 `{"goals":[{"id","name","parentId","weight","manualValue","ownerId","progress","percent","projects":[{"projectId","name","weight","progress"}]}]}` | none |
| `POST /api/teams/:teamId/goals` | `{"name","parentId"?,"weight"?,"manualValue"?}` | 201 goal | 422 |
| `PATCH /api/goals/:id` | `{"name"?,"weight"?,"manualValue"?}` | 200 goal | 403 not the owner or a coordinator, 422 |
| `POST /api/goals/:id/projects` | `{"projectId","weight"?}` | 201 link | 403, 422 |
| `GET /api/teams/:teamId/workload?from=<date>` | none | 200 `{"from","days":[10 dates],"people":[{"id","name","cells":[{"date","total","capacity","over","text","tasks":[{"id","name"}]}]}]}` | none |
| `PUT /api/teams/:teamId/capacities` | `{"personId","weekday":"mon".."fri","hours"}` | 200 | 403 not a coordinator, 422 |
| `POST /api/projects/:id/forms` | `{"slug","section","title"}` | 201 form | 403, 422 |
| `GET /api/forms/:slug` | none (public) | 200 `{"title","categories":[...]}` | 404 |
| `POST /api/forms/:slug/submissions` | `{"title","details"?,"neededBy","email","category"?}` (public) | 201 `{"reference":"REQ-0001","taskId"}` | 404, 422 |
| `GET /api/inbox` | none | 200 `{"unread":<n>,"items":[{"id","text","taskId","kind","read","createdAt"}]}` newest first, archived ones left out | none |
| `PATCH /api/inbox/:id` | `{"read":true\|false}` or `{"archived":true}` | 200 item | none |
| `POST /api/tasks/:id/attachments` | multipart field `file` | 201 `{"id","name","size","contentType"}` | 413 `{"error":"file_too_large"}`, 503 `{"error":"storage_unavailable"}`, 422 `{"errors":{"file":"Choose a file to attach"}}` |
| `GET /api/attachments/:id` | none | 200 the bytes with the stored content type | 503 |
| `POST /api/projects/:id/files` | `{"format":"csv"\|"json"}` | 202 `{"id","status":"preparing"}` | 422 |
| `GET /api/files/:id` | none | 200 `{"id","status":"preparing"\|"ready"\|"failed","format","url"?,"error"?}` | none |
| `GET /api/files/:id/download` | none | 200 the file | 404 until ready |
| `GET /api/events` | none | `text/event-stream` of live changes for the caller's teams | none |

**Task JSON.** `{"id","projectId","name","description","section","position","parentId","assigneeId","start","due","effort","completed","version","recurrence","dueStatus","values":{"<field name>":value}}`. `section` is the section id. `position` is 1-based among siblings. `effort` is hours or null. `values` holds custom and formula results keyed by field name, in these JSON types:
- numbers as JSON numbers;
- dates as `YYYY-MM-DD` strings;
- text and the chosen option as strings;
- multi-select as an array of option strings;
- true and false as JSON booleans;
- error results as the strings `#DIV/0`, `#VALUE`, `#REF` and `#BUDGET`;
- `null` for blank.

Create and PATCH take `section` as a section id and `values` keyed by field name, in the same types. `version` is an integer starting at 1 that rises with every saved change. `dueStatus` is `overdue`, `today`, `later` or `none`. A task whose `parentId` is set is a subtask, in its parent's section.

**Rule JSON.** `trigger` is `{"type":"task_added"}`, `{"type":"field_changed","field","value"?}`, `{"type":"moved_to_section","section"}`, `{"type":"due_date_arrives"}` or `{"type":"approval_decided"}`. `condition` is `{"field","op","value"?}` with `op` one of `is`, `is_not`, `is_blank`, `is_greater_than`. `action` is `{"type":"set_field","target":"<field>","value"}`, `{"type":"move_to_section","target":"<section>"}`, `{"type":"assign_to","target":"<person id>"}`, `{"type":"add_subtask","value":"<name>"}` or `{"type":"send_to_inbox","value"?}`. A trigger or condition `field` and the `set_field` target are a field id, or one of the built-in keys `assignee`, `start`, `due` and `effort`. A `value` for a select field is the option text, and for `assignee` it is a person id. A trigger `section` and the `move_to_section` target are section ids.

**Grading routes.** They exist only when `EVERYWEEK_GRADING=1`, and every call needs the header `X-Everyweek-Grading: 1`. They are present on every instance, including the outage instance. Without the variable they answer 404. The seed body may be up to 5,000,000 bytes.
- `POST /grading/seed` inserts records exactly as given: no rules run, no mail is sent, no inbox item is made. It returns 201 with an object keyed like the request (`people`, `teams`, `projects`, `sections`, `fields`, `tasks`, `rules`, `goals`, `forms`, `approvals`, `inbox`), each mapping the caller's `key` to the new id (`sections` maps project key to section name to id). Records may carry `createdAt`.
- Request top-level keys, processed in this order:
  - `people`: `{"key","name","email","password","verified"}`.
  - `teams`: `{"key","name","members":[person keys],"coordinators":[person keys],"joinCode"?}`.
  - `capacities`: `{"person","weekday","hours"}`.
  - `projects`: `{"key","team","name","sections":[names],"fields":[{"key","name","type","options"?,"formula"?}],"tasks":[{"key","name","section","parent"?,"position"?,"assignee"?,"start"?,"due"?,"effort"?,"completed"?,"values"?,"recurrence"?,"description"?}],"rules":[{"key","name","position"?,"trigger","condition"?,"action"}],"forms":[{"key","slug","section","title"}],"dependencies":[{"from","to"}]}`.
  - `goals`: `{"key","team","name","parent"?,"weight"?,"manual"?,"owner"?,"projects":[{"project","weight"}]}`.
  - `approvals`: `{"key","task","approver","requester","status":"requested"}`.
  - `inbox`: `{"key","person","text","task"?,"read"?,"createdAt"?}`.
  - `history`: `{"task","text","createdAt"}`.
- Inside a request, references use the caller's keys (including `assignee`, `approver`, `owner` and rule `assign_to` targets).
- A task's `section`, a form's `section`, and a rule's trigger section or `move_to_section` target use the section name within that project.
- A rule's field references use the field key or a built-in key.
- Task `values` are keyed by field name. Tasks of a project are created in array order, so positions follow it when omitted. Forms need no pre-existing field. `Requested by` is created when a form is added.
- `POST /grading/clock` with `{"now":"2026-03-02T09:00:00Z"}` fixes the server clock and answers 200 `{"now":"<the fixed time>"}`. Every due date, recurrence, rule schedule, edit hold, presence and digest reads it. The fixed time is stored in the database, so a call to any instance sets the clock for every instance on that database. Before the first call it is real time, and later calls may set it forward or back. Before answering, the hook runs the work that has become due exactly once across instances (recurring tasks, `Due date arrives` rules, digests, lapsed holds and presence) and pushes the changes to every open page. While `EVERYWEEK_GRADING=1`, due work runs only inside a clock call and never on a timer, so nothing seeded or started becomes due before the first call. Without the grading variable the clock is real time and the server checks for due work every 15 seconds.

### Business rules (DP-02, DP-04, DP-23 to DP-50, DP-54, DP-57, DP-58)

**Concurrency and duplicates.** A save carries the task's `version`. The server applies the first of two saves from the same version and answers 409 `stale_task` with `latest` to the second. A trigger claims its work in the database before running, so a rule runs once per trigger event, a recurring task is made once per period and a digest is sent once per member per window, whichever instance handles it. A double activation of one control makes one record (see Feedback states).

**Time.** The server's clock (the grading hook or real time) decides whether a task is overdue, due today or later, whether a form date is today or later, whether a hold or presence has lapsed, when a recurring task is due and which digest window it is. The browser shows the status the API gives and never compares dates with its own clock, which may be wrong. A task is `overdue` when it is open and its due date is before the server date, `today` when open and due on the server date, `later` when open and due after it, and `none` when completed or without a due date. The status chip and the My work group heading for each value read `Overdue`, `Due today`, `Later` and `No due date`. My work shows the groups in that order and leaves out empty ones.

**List nesting.** Tasks nest one level only.
- Indent: Ctrl+], or a PATCH that sets `parentId`, makes the focused top-level task the last subtask of the nearest top-level task above it in the same section. This holds whether the row directly above is that task or one of its subtasks.
- Indent is refused when the row is already a subtask, when it has subtasks of its own, or when no top-level task is above it in its section.
- Outdent: Ctrl+[, or `parentId` set to null, makes a subtask a top-level task placed directly after its former parent. The parent keeps its other subtasks.
- Outdent is refused on a top-level row.
- A refusal changes nothing and is announced with the refusal text from Feedback states. Through the API it answers 422 `{"errors":{"parentId":"Tasks nest one level only"}}`.
- Positions among the remaining siblings close up and stay 1-based.

**Formula language.** A formula field holds a formula of at most `EVERYWEEK_FORMULA_MAX_CHARS` characters.
- References are `{Field name}`, matching a field by exact name: built-in `Start`, `Due`, `Effort`, any custom field, or another formula field (circular references are refused).
- Values are numbers, strings in double quotes and dates. Operators are `+ - * /` with the usual precedence, parentheses, unary minus, and the comparisons `> < >= <= = !=`.
- Functions, upper case only: `ROUND(x, n)` (half away from zero), `IF(test, a, b)`, `ISBLANK(x)`, `DAYS(from, to)` (whole days, `to` minus `from`) and `CONCAT(a, ...)` (at least one argument).
- A date plus a number adds days, and a date minus a number subtracts days.
- Blanks: a blank in `+` or `-` counts as 0, a blank in `*` or `/` makes the result blank, a comparison with a blank is false, `DAYS` with a blank gives blank, `ISBLANK` is true for a blank or empty text, an `IF` test that is blank counts as false, and `CONCAT` treats a blank as empty text.
- Results show numbers with up to 10 decimal places and no trailing zeros, dates as `YYYY-MM-DD`, true and false as `true` and `false`, and blank as an empty cell whose accessible name is `<field name>, blank`. A formula cell's accessible name is `<field name>, <value>` in the same pattern.
- Errors as values: division by zero gives `#DIV/0`, a text where a number is needed gives `#VALUE`, a reference to a deleted field gives `#REF`, and an error in an operand is the result.
- Worked examples, with Effort 2.5 and Rate 40: `{Effort} * {Rate}` is `100`. With Effort blank it is blank. `ROUND({Effort} / 3, 2)` with Effort 2 is `0.67`. `ROUND(2.5, 0)` is `3` and `ROUND(-2.5, 0)` is `-3`. `DAYS({Start}, {Due})` with Start 2026-03-02 and Due 2026-03-09 is `7`. `{Due} + 3` is `2026-03-12`. `IF({Effort} > 4, "Large", "Small")` is `Large` with Effort 5 and `Small` with Effort blank. `{Effort} + {Extra}` with Extra blank is `2.5`. `{Rate} / 0` is `#DIV/0`.
- Errors, refused with 422 and the same message, the old formula staying. Character positions count from 1, and a formula that ends early points one past its last character:
  - `ROUND({Effort}, )` gives `Formula error at character 17: expected a value`.
  - `2 + * 3` gives `Formula error at character 5: expected a value`.
  - `ROUND({Effort}, 2` gives `Formula error at character 18: expected )`.
  - `{Effrot} + 1` gives `Formula error at character 1: unknown field Effrot`.
  - `IF({Effort} > 4, "Large")` gives `Formula error at character 1: IF needs 3 arguments` (the pattern is `<NAME> needs <n> arguments`, with `1 argument` for one and `CONCAT needs at least 1 argument`).
  - A formula over the cap gives `Formula error at character 201: formula is longer than 200 characters` (checked before any other error).
  - An empty formula gives `Formula error at character 1: expected a value`.
  - A reference that leads back to the field being saved, directly or through other formula fields, gives `Formula error at character <n>: circular reference to <field>`. Here `<n>` is the position of the `{` of the first such reference and `<field>` is the name inside it.
  - Other refusals follow the same pattern: `unknown function <name>`, `unexpected character <c>`, `expected }` and `expected end of formula`.
- Bounds: one task's evaluation of one formula is limited to `EVERYWEEK_FORMULA_MAX_STEPS` evaluation steps (each number, string, reference, unary minus, operator, comparison and function call is one step, counted through referenced formula fields too; `IF` evaluates its test and then only the chosen branch). Over the budget the value is `#BUDGET`. A save or evaluation of any allowed formula answers within 2 seconds.
- Formula values are computed on the server for every read and pushed to open lists when an input changes.

**Rule engine.**
- Triggers are `Task added`, `Field changed` (field and to-value), `Moved to section` (section), `Due date arrives` (when the server clock reaches 00:00 UTC of the task's due date) and `Approval decided`. A trigger event happens only when the value or section actually changes.
- Conditions, all of which must hold, are `is`, `is not`, `is blank` and `is greater than`.
- Actions are `Set field`, `Move to section`, `Assign to`, `Add subtask` (which fires `Task added` for the subtask) and `Send to inbox` (to the task's assignee, or the team's coordinators when none, with the action value as text or `<rule name>: <task name>` when blank).
- Rules on the same trigger run in position order in the project's Rules list (1 first), then by creation time.
- The user's own change is depth 0. A rule it sets off runs at depth 1, and a rule set off by a rule's action runs one deeper. A rule that would run deeper than `EVERYWEEK_RULE_MAX_DEPTH` does not run, and the chain ends with the entry `Stopped: chain depth limit 3 reached at <rule name>`, whose `data-depth` is the depth that rule would have had.
- Only entries whose summary reads `ran` count as runs. Entries for unmet conditions, stopped entries and skipped entries do not count. Once a project has `EVERYWEEK_RULE_RUNS_PER_MINUTE` counted runs in the current UTC minute of the server clock, the next rule that would run (the 61st at the default) writes `Skipped: rule run limit 60 per minute reached` instead, and the chain ends.
- A rule whose conditions fail writes `<rule name> skipped: conditions not met`.
- Each rule runs exactly once per trigger event, whichever instance handles it, using a claim row per rule and event.
- The `Rule runs` list is ordered as the chain ran: each entry is followed by the entries it set off. Each entry has `data-depth`, is indented 16 px per depth, and holds an element `data-part="summary"` with the exact text and an element `data-part="detail"`. The detail reads, by entry kind (each number is the effective value):
  - a run whose conditions held: `Trigger: <trigger text>. Conditions: met`;
  - a run without conditions: `Trigger: <trigger text>. Conditions: none`;
  - an entry skipped by its conditions: `Trigger: <trigger text>. Conditions: not met`;
  - a stopped entry: `Trigger: <trigger text>. Not run: depth <d> is deeper than <max depth>`;
  - an entry skipped by the run limit: `Trigger: <trigger text>. Not run: <limit> runs this minute`.
- Trigger text follows the rule's definition, not the event. It is one of: `Task added`; `Field changed <field name>`, with ` to <value>` added when the rule names a value (`Field changed Stage to Ready`, `Field changed Assignee`); `Moved to section <section name>`; `Due date arrives`; or `Approval decided`.
- Summaries are `<rule name> ran: moved to <section>`, `<rule name> ran: assigned to <person>`, `<rule name> ran: set <field> to <value>`, `<rule name> ran: added subtask <name>` and `<rule name> ran: sent to inbox`.
- Worked chain: R1 `Ready to review` (Field changed Stage to Ready: Move to section Review), R2 `Review sets owner` (Moved to section Review: Assign to Noor Halvorsen), R3 `Owner flags` (Field changed Assignee: Set field Priority to High) and R4 `High priority notice` (Field changed Priority to High: Set field Stage to Ready). Setting Stage to Ready gives, in order: `Ready to review ran: moved to Review` (depth 1), `Review sets owner ran: assigned to Noor Halvorsen` (depth 2), `Owner flags ran: set Priority to High` (depth 3), `Stopped: chain depth limit 3 reached at High priority notice` (depth 4).
- History gets one entry per change, `<person or rule name> changed <field label>`.

**Recurring tasks.** The repeat rules are written exactly as `Every week on <weekday>`, `Every month on day <n>` and `Every <n> days after completion`.
- Weekly: the next due is the next such weekday after the previous due date.
- Monthly: the next due is day `<n>` of the month after the previous due date's month, or that month's last day when it has no such day. Day 31 from 2026-01-31 gives 2026-02-28 then 2026-03-31.
- After completion: the completion date (the server date) plus `<n>` days. Completed on 2026-03-04 with 10 days gives 2026-03-14.
- The successor copies name, section, assignee, effort, custom values and recurrence, starts not completed, and shifts its start by the same number of days as its due.
- It is created when the current task is completed, or, for weekly and monthly rules, when the server clock passes the current due date (00:00 UTC the day after it) while the task is still open. A successor is created exactly once per task across instances. One clock call creates at most one successor for each task that was open before the call. A successor that is itself already past due therefore makes its own successor only when it is completed or at the next clock call. For example, if `Weigh stock` is due 2026-03-02 and left open, a clock call setting 2026-03-20 gives it exactly one successor, due 2026-03-09. A second call at the same time adds one more, due 2026-03-16.
- Worked: `Weigh stock` every week on Monday, due 2026-03-02, completed 2026-03-04, gives `Weigh stock` due 2026-03-09.

**Goals.**
- A goal with children (sub-goals or linked projects) has progress = sum(weight × child progress) / sum(weights), from the children's unrounded values. A goal with none uses its manual value (0 to 100, set by its owner or a coordinator).
- A project's progress is completed top-level tasks / top-level tasks × 100 (subtasks excluded, and an empty project is 0).
- Weights are whole numbers 1 to 10, default 1.
- Display rounds half up to a whole percent only at the end. `progress` in the API is the unrounded value and `percent` the displayed one.
- Worked example, built through the grading seed: `Run a steady year` has `Kitchen runs on time` (weight 2) and `Upkeep never lapses` (weight 1). `Kitchen runs on time` has project `Weekly orders` (weight 3, 6 of 8 top-level tasks done, so 75) and sub-goal `Suppliers confirmed` (weight 1, manual 40): (3 × 75 + 40) / 4 = 66.25, shown `66%`. `Upkeep never lapses` has project `Machine upkeep` (weight 1, 2 of 5 = 40) and sub-goal `Spare parts stocked` (weight 1, manual 90): 65%. `Run a steady year` = (2 × 66.25 + 65) / 3 = 65.833, shown `66%`.
- With the starter seed's open tasks instead, the three goals show `Kitchen runs on time` 10%, `Upkeep never lapses` 45% and `Run a steady year` 22%.
- Changing `Suppliers confirmed` to 80 gives 76.25 (`76%`) and (152.5 + 65) / 3 = 72.5 (`73%`; from rounded children it would wrongly be 72).
- The tree `Goals` has a `treeitem` per goal named `<name>, 66% complete`. Each goal's `progressbar` carries `aria-valuenow` (rounded), `aria-valuetext` `66% complete` and `data-shown-percent`.
- Every parent changes when a child, weight, link or linked project's task changes, and the change is pushed to open pages.

**Workload.**
- A task's effort (hours) is spread evenly over its working days from start to due inclusive (Monday to Friday only). Completed and unassigned tasks, and tasks without effort or without a working day, count nothing. A task with a due date but no start counts on its due date alone, and a task without a due date counts nothing. Subtasks count by their own effort.
- A person's cell for a day is the sum of their shares. Capacity is per person per weekday, default 8 hours.
- The cell text is `<total> of <capacity> h`, the total rounded half up to one decimal with no trailing `.0` (`4 of 8 h`). A cell whose unrounded total is above capacity adds `, over capacity`, has `data-over="true"` and a hatched fill, never colour alone. `data-total` is the unrounded total with two decimals.
- Worked example, week of 2026-03-02, Noor Halvorsen with capacity 8 h and Friday 4 h: `Order dry goods` 12 h from 2026-03-02 to 2026-03-04 (4 a day), `Pack orders` 10 h from 2026-03-04 to 2026-03-06 (3.333 a day) and `Count freezer` 5 h from 2026-03-06 to 2026-03-09 (two working days, 2.5 a day). Cells: Monday `4 of 8 h`, Tuesday `4 of 8 h`, Wednesday `7.3 of 8 h`, Thursday `3.3 of 8 h`, Friday `5.8 of 4 h, over capacity`, next Monday `2.5 of 8 h`.
- Reassigning `Pack orders` to Ilse Marchetti gives Noor Wednesday `4 of 8 h`, Thursday `0 of 8 h`, Friday `2.5 of 4 h`.
- The grid shows ten working days from the Monday of the week containing `from` (default: the server date).

**Timeline dependencies.** A dependency is a line from blocker to waiting task. When the blocker's due date is on or after the waiting task's start, the waiting bar shows `Starts before <blocker name> is due`. Nothing is rescheduled automatically.

**Edit hold and presence.** Focusing `Name` or `Description` takes a hold on that field. Every other open page shows `Being edited by <name>` next to it and the field is read-only (`aria-readonly="true"`) until the holder saves, closes the task, or `EVERYWEEK_HOLD_TIMEOUT_MS` passes on the server clock. Saved edits reach every open page in server order. `Viewing now` names everyone with the task open. A viewer whose live connection has dropped leaves it after the same timeout on the server clock.

**Approvals.** An approval request has one approver. State machine: `requested` goes to `approved`, `changes_requested` or `rejected`. A decided request accepts no second decision (409 `already_decided`). A comment is required for `request_changes` and `reject`, and optional (at most 500 characters) for `approve`. A new request can be made once the latest is decided. The task's status chip reads `Awaiting approval`, `Approved`, `Changes requested` or `Rejected`. The approver gets the inbox item `Approval requested: <task name>` (with `Decide`). The requester gets `<approver name> approved <task name>`, `<approver name> requested changes on <task name>` or `<approver name> rejected <task name>`. A decision fires the `Approval decided` trigger.

**Inbox and digest.** The unread count is the number of unread, unarchived items. The digest window is `EVERYWEEK_DIGEST_WINDOW_MIN` minutes aligned to UTC midnight (the UTC hour for 60). When the server clock reaches the end of a window, each member with unread, unarchived items created in that window gets exactly one mail, whichever instance handles it. Nothing is sent for an empty window. When the clock jumps over several windows, each window with waiting items sends one mail. A clock call handles the windows that end after the previous server time and at or before the new one. The first call handles none.

**Intake.** The form is open without sign-in. Request title is required and at most 120 characters. Needed by is required, an ISO date, today or later by the server clock. Your email is required and must look like an address. Category, if sent, must be an option of the project's `Category` field. A valid submission creates a task in the form's section by this mapping: Request title to name, Details to description, Needed by to due, Category to the `Category` field, Your email to the `Requested by` field. It answers the reference `REQ-` plus four digits, counted per team from 1 and never repeated, and the page then reads `Request received. Your reference is REQ-0001.`

**Files.** `POST /api/projects/:id/files` answers 202 with `preparing`, writes the file to the object store, asks the store to confirm it exists, and only then sets `ready` with its link. While the store is unreachable the job becomes `failed` with `error` `storage_unavailable`, no link is offered, and the page shows the outage copy from Feedback states. The CSV has the header `id,name,section,assignee_email,start,due,effort_hours,completed,parent_id` with one row per task (subtasks too), `completed` as `true` or `false`, and blanks empty. `section` is the section name in the CSV and the section id in the JSON. `parent_id` is the parent task's id, or blank (CSV) and `null` (JSON) for a top-level task. The JSON is `{"schema":"everyweek.project/1","project":{"id","name"},"sections":[{"id","name","position"}],"tasks":[{"id","name","section","assignee_email","start","due","effort_hours","completed","parent_id"}]}`. Tests read the values, not the bytes. An attachment larger than `EVERYWEEK_UPLOAD_MAX_BYTES` is refused, and a file of exactly that size is accepted.

**Deletion.** Deleting a task deletes its subtasks. Deleting a section deletes its tasks. A project always keeps one section, and `Delete section` is marked disabled on the last. After a task delete, focus goes to the next row's Name cell (the previous when it was last, the `Add task` row when none remain). After a section delete, to the next section's heading button (the previous when last). After a field delete, to the next column's header button (the previous when last, `Add field` when none remain).

**Persistence.** Projects, rules, goals, history and everything else stay after a reload.

### Services (DP-11, DP-12, DP-47, DP-57 to DP-59)

**postgres** holds teams (each team is a workspace), people and sessions, projects, sections, tasks and subtasks, custom and formula fields and values, dependencies, rules and their run history, claim rows, recurring definitions, goals, weights and links, capacities, intake forms and the per-team reference counter, approval requests and decisions, inbox items, task history, holds and presence, attachment and file records, and the digest claims. It is the only datastore and is shared by every app instance. The schema and the starter seed are applied on every start without resetting rows.

**minio** holds every attachment at `attachments/<task id>/<attachment id>/<file name>` and every project download at `exports/<project id>/<file id>.csv` or `.json`. A download is `ready` only after the store confirms the object. If the store cannot be reached, a download is `failed` and an attachment answers 503 `storage_unavailable` with the copy from Feedback states. Nothing is offered and nothing is recorded as stored. Everything else keeps working on that instance.

**mailpit** receives two kinds of mail, sent from `MAIL_FROM`, which the mail service's environment sets to `Everyweek <hello@everyweek.example>` (this is also the default when unset):
- Sign-up: to the new account's address, subject `Your Everyweek verification code`, body containing one 6-digit code.
- Digest: to the member's address, subject `Everyweek: <n> unread in your inbox`, one item text per line. `<n>` is the number of unread items created in the window.

### Seed data (DP-01)

Every person and business here is invented. At first start, and only if the database is empty, the app creates:
- Team `Larder Street Kitchen`, join code `LARDER-2026`. People (all verified, password `weekly-demo-1`): Noor Halvorsen `noor@everyweek.example` (coordinator), Ilse Marchetti `ilse@everyweek.example` (member), Tomas Okonkwo `tomas@everyweek.example` (member, approver). Noor's Friday capacity is 4 hours, and everyone else's is the default.
- Project `Weekly orders` with sections `To do`, `Doing`, `Review`, `Done`. Fields: `Stage` (single select: `Draft`, `Ready`, `Review`), `Priority` (single select: `Low`, `Medium`, `High`), `Tags` (multi-select: `Fresh`, `Dry`, `Frozen`), `Category` (single select: `Dry goods`, `Fresh`, `Equipment`), `Rate` (number), `Extra` (number) and `Cost` (formula `{Effort} * {Rate}`).
- Tasks of `Weekly orders`, all assigned to Noor except where noted: `Order dry goods` (To do, 2026-03-02 to 2026-03-04, 12 h), `Pack orders` (To do, 2026-03-04 to 2026-03-06, 10 h), `Count freezer` (Doing, 2026-03-06 to 2026-03-09, 5 h) and `Weigh stock` (To do, due 2026-03-02, 2.5 h, Rate 40, assigned to Ilse, repeat `Every week on Monday`).
- Project `Machine upkeep` with sections `To do` and `Done` and tasks `Oil the slicer`, `Replace saw blade`, `Clean the mixer`.
- Public intake form `supply-request` titled `Supply request` into `Weekly orders`, section `To do`.
- Goals `Run a steady year` with children `Kitchen runs on time` (weight 2) and `Upkeep never lapses` (weight 1); `Kitchen runs on time` links `Weekly orders` (weight 3) and has sub-goal `Suppliers confirmed` (weight 1, manual 40); `Upkeep never lapses` links `Machine upkeep` (weight 1) and has sub-goal `Spare parts stocked` (weight 1, manual 90). Noor owns them all.
- No rules. One unread inbox item for Noor: `Welcome to Everyweek`.

## Technical requirements

### Deployment (DP-01)

Backend: TypeScript on Node 22 with the toolchain the image ships (npm). Frontend: TypeScript built with Node 22 in the same build step.

`/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, for example `{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm start"}`. The app binds `0.0.0.0` on 4173, or the value of `APP_PUBLIC_PORT` when set. `GET /api/health` answers 200 `{"status":"ok"}` only after the schema and starter seed are ready and the object store is reachable. Before that it answers 503 `{"status":"starting"}`. An instance whose object store is unreachable (the outage instance) answers 200 `{"status":"unavailable"}`, never 503, and still serves everything except attachments and file downloads. Health checks the store on every call and answers within 3 seconds. Several copies of the app may run against one database. They start one at a time and share the database, and start never resets rows.

### Configuration and secrets (DP-04, DP-07, DP-11)

Read at start from the environment, never hard-coded and never sent to the browser:
- `DATABASE_URL`.
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
- `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`.
- `APP_PUBLIC_PORT`.
- `EVERYWEEK_GRADING`: `1` turns on the grading routes.

Limits, each with its default and meaning:

| Variable | Default | Meaning |
|---|---|---|
| `EVERYWEEK_RULE_MAX_DEPTH` | 3 | deepest level at which a rule may run |
| `EVERYWEEK_RULE_RUNS_PER_MINUTE` | 60 | rule runs per project per UTC minute |
| `EVERYWEEK_FORMULA_MAX_CHARS` | 200 | longest formula in characters |
| `EVERYWEEK_FORMULA_MAX_STEPS` | 500 | evaluation steps per task per formula |
| `EVERYWEEK_DIGEST_WINDOW_MIN` | 60 | digest window length in minutes |
| `EVERYWEEK_HOLD_TIMEOUT_MS` | 30000 | edit hold and presence lifetime in milliseconds |
| `EVERYWEEK_UPLOAD_MAX_BYTES` | 1048576 | largest attachment in bytes |
| `EVERYWEEK_PAGE_SIZE` | 50 | tasks per API page |
| `EVERYWEEK_MOVE_MS` | 320 | move animation length |
| `EVERYWEEK_PROGRESS_MS` | 400 | progress bar animation length |
| `EVERYWEEK_TOAST_MS` | 4000 | toast lifetime |

Every message that prints a limit prints the effective value of its variable:
- the depth in `Stopped: chain depth limit <n> reached at <rule name>`;
- the run count in `Skipped: rule run limit <n> per minute reached`;
- the characters in the over-length formula error (`character <cap + 1>` and `longer than <cap> characters`);
- the attachment cap in `File is larger than <size>`.

`<size>` is the cap in whole megabytes when it is a multiple of 1,048,576 bytes (`1 MB`, `2 MB`). Otherwise it is the plain byte count followed by `bytes` (`500000 bytes`). The texts elsewhere in this brief show the defaults.

### Server boundary (DP-03, DP-07, DP-08)

Everything is same-origin: the pages, the API and the live channel come from one origin, and the server sets no cross-origin allowance. Request body limits are in API. The server never serves source files, the lockfile, environment values or credentials, and the browser bundle holds none. The browser loads nothing from another origin: the font, icons and scripts all ship with the app. If postgres is unreachable at boot the app keeps retrying and health answers 503 `starting`. If the object store or mail service is unreachable at boot the app still starts. Unknown paths under `/api` answer 404 `{"error":"not_found"}`.

### Browser support and performance (DP-06, DP-10)

Current Chromium at 375x812, 768x1024 and 1280x800. A project of 100 tasks shows its list within 3 seconds of load and its board and timeline within 3 seconds of switching. A save answers within 1 second and a live change reaches another open page within 2 seconds.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`.
- IF-02: `THIRD_PARTY_NOTICES.md` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`), the font and the icons with their licences.
- IF-03: Shipped packages use only MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, CC0 or OFL-1.1 licences.
- IF-04: Only postgres, minio and mailpit are used. There is no other datastore, cache, queue, broker or real-time service.
- IF-05: The seeded service configuration the builder was given is left untouched.
- IF-06: No credential appears in source or in the browser bundle, and every service setting is read from the environment.
- IF-07: No real product or company name appears in user-visible copy (page text, accessible names, mail and file contents) other than `Corran & Bly` and `Everyweek`, and no text is copied from another product. Licence notices, dependency manifests, lockfiles and the names of shipped font and icon files are exempt.
- IF-08: The font is shipped inside the app and no browser request goes to another origin.

## Engineering standards

- The code is idiomatic TypeScript with strict typing, and names match the domain terms in this brief (task, section, rule run, hold, digest window, successor).
- Each domain rule is decided in exactly one place in the source: the formula language, the rule chain and its depth, the repeat rules, the goal rollup, the workload spread, the approval transitions and the error order.
- No abstraction has a single implementation, and no code is dead, commented out or unreachable.
- There are no defensive checks for states the design makes impossible.
- Errors share one shape: `{"error":"<code>"}` or `{"errors":{"<field>":"<message>"}}`.
- Time is read from one clock source that the grading hook can set, and no code reads the system time on its own.
- Live updates are published from the same place the change is saved, so a page cannot show a state the database lacks.
- Nothing is built beyond this brief.
