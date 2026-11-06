# Fly Floor Co. Promptside

Promptside is a keyboard-driven work tracker for one producing theatre taking one show, *The Lantern Keepers* at the invented Kettleyard Playhouse, from first rehearsal to opening night. The stage manager, the production carpenter, the lighting, sound and costume leads, and the director all work in one shared list. It replaces the nightly cycle of a rehearsal report copied into department spreadsheets. Promptside uses three backend services. Postgres is the system of record for tasks, blocking links, rehearsal-week cycles, the activity feed and the undo journal. MinIO stores set sketches, lighting plots and costume renderings. PocketBase hosts the company request intake, where the director and cast file requests from the rehearsal room. There are no accounts and no sign-in: the person acting is picked from the crew list. Out of scope: email of any kind, calendars, contact sheets, script and blocking notation, budgets, any datastore beyond those three services, and more than one show or theatre.

## Problem and users

In a mid-size producing theatre, every note from rehearsal passes through the stage manager. When the director says "the upstage door sticks", or an actor says "my quick-change needs a zip, not hooks", the note goes into that night's rehearsal report. The report is emailed to every department by 11 pm. Each department lead then copies their lines into a separate tracker: lighting splits its notes into focus, programming and electrics, wardrobe keeps a fittings sheet, and carpentry keeps a whiteboard. Nothing records that the paint call can't start until a flat is rebuilt, or that a focus session waits on the paint. Notes get duplicated across reports, fixed twice or dropped. Focus and paint calls get booked before the work they depend on is finished, which costs overtime crew calls in tech week. The crew spends late nights reconciling lists. Promptside keeps every note as an owned task with its blockers, and every notice stays in the app.

| Role | Goal | How often |
|---|---|---|
| Stage manager | Turn each night's director and cast requests into owned, prioritised work, and see what still blocks opening | Daily |
| Production carpenter | Clear the set build and repair queue in dependency order, and attach revised set sketches | Daily |
| Lighting lead | Work through focus and programming notes for each rehearsal week, and keep the current lighting plot attached to its tasks | Daily |
| Sound lead | Track sound cue and system notes from a phone at the tech table | Daily |
| Costume lead | Track fittings, alterations and quick-change rigs as sub-tasks that roll up to each costume | Daily |
| Director | File requests from the rehearsal room, and see whether each was accepted, declined or merged | Weekly |

## Journeys

1. **Post-rehearsal triage.** Start state: the seeded database, with three pending requests already pulled into triage. The stage manager opens Triage, moves between rows with j and k, and accepts the thunder request into Sound with High priority for Kofi Mensah. They merge the door request into STG-1 and decline the rocking-chair request with a reason. Each decision lowers the triage count by 1 in the same update as its other count changes. The accept raises the Backlog count and the current cycle's total by 1. The decline raises the Cancelled count by 1. The merge changes no other count. End state: the `Triage is clear` empty state shows, and each request in the intake carries its outcome.
2. **Notes session by keyboard.** Start state: the All tasks list. Using only the keyboard, the stage manager moves with j and k, marks rows with x and Shift with the arrow keys until twenty rows are selected, then opens the command palette and runs "Assign to Oren Vale". End state: all twenty rows show Oren Vale, one notice confirms the change, and focus stays on the same row.
3. **Clearing the build queue.** Start state: All tasks, list view, working as Devi Rangan. The production carpenter opens STG-12 and sets it to Done. The status chip flips, STG-10 closes because its last sub-task is done, and a green cue-line runs down the margin to STG-13 and then to STG-14. Each of those rows changes from Blocked to Todo with a "Freed by" badge. End state: the blocked count is 2 lower and the Rehearsal 1 progress has moved.
4. **Focus notes and the revised plot.** Start state: the Lighting department list. The lighting lead selects the twelve focus notes STG-21 to STG-32 and presses 2. After the save there is exactly one announcement, `Priority set to High on 12 tasks.` They open STG-37 and attach a revised plot PDF. It shows as uploading, then appears in Attachments marked Current. End state: the plot is in object storage and listed on the task.
5. **Closing the last fitting.** Start state: two tabs on All tasks, one with the costume lead working as Ruth Alder and one with the stage manager working as Maya Okonjo. The costume lead marks STG-51 Done. End state: in both tabs and without a reload, STG-48 shows Done, STG-47 shows Freed by STG-48, and the column counts, the blocked count and the Rehearsal 1 progress all show the new values.
6. **Sound notes at the tech table.** Start state: a 375-pixel phone. The sound lead opens the Departments drawer, picks Sound, taps STG-38, sets its owner in the full-screen sheet and closes the sheet. At the same moment the stage manager sets a different owner on STG-38 from a laptop. End state: both screens show the owner that won, whichever edit committed first. The screen whose edit lost shows one notice that its change was replaced, and the phone's list is still scrolled to STG-38.
7. **Sharing a carpentry view.** Start state: the stage manager on the list. They choose Carpentry, tick Blocked only, group by Cycle and move to STG-41, then send the address to the production carpenter. End state: the carpenter's tab opens the same view with STG-41 highlighted. Back undoes one view change at a time, and a reload keeps the view.
8. **Undoing a mistaken bulk move.** Start state: All tasks list. The stage manager selects STG-1 to STG-9 and STG-15 to STG-20, fifteen notes in all, and moves them to Done by mistake. STG-26 and STG-46 are freed. They press Ctrl+Z (Cmd+Z on a Mac). End state: all fifteen notes have their exact earlier status, priority and owner, STG-26 and STG-46 are Blocked again with the cascade played in reverse, and each restored task's activity feed has an undo entry. The single notice reports 15 tasks restored and 2 tasks blocked again.

The director's own journey is filing a request from the Requests screen and then seeing its outcome there once the stage manager has decided it.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Request intake pull.** Every pending request in the company request intake appears in triage as exactly one Triage task within 5 seconds, as qualified in Services.
- **DP-02 — Decisions written back to the intake.** Accepting, declining or merging a triage task becomes final only after the intake records the outcome, and if the intake refuses or cannot be reached the task stays in triage unchanged, as qualified in Business rules.
- **DP-03 — One-snapshot counters.** Every change returns and broadcasts one snapshot in which the triage count, board column counts, blocked count and cycle totals come from the same committed state, and the screen applies them together.
- **DP-04 — Triage to a clear inbox.** The stage manager works the triage screen by keyboard, accepting, declining and merging each request until the clear-inbox empty state shows. Each decision dialog keeps Tab inside it while open, focus never lands on the page body, and after every decision exactly one triage row is current. Afterwards a carpentry task is set to block the accepted request from its details with Add blocked task. The stage manager first chooses who they are working as from the rail, and the cleared triage screen on a 375-pixel phone keeps the rail as an off-screen drawer with every tap target at least 44 pixels. Last, the stage manager adds three new sound notes with no owner, selects them with x and Shift, presses a and finishes the palette's Assign to command for Kofi Mensah, and Undo then gives all three their earlier owner back with the exact Undo notice.
- **DP-05 — Keyboard grid.** In the task grid, j, k and the arrow keys move one current row, x and Shift with an arrow key build a selection, and the number keys 0 to 4 set priority, whichever control in the grid has focus.
- **DP-06 — Command palette.** Ctrl+K or Cmd+K opens the command palette from anywhere, typing filters the commands, Enter runs the active one on the selection or the current row, and Escape closes it.
- **DP-07 — Focus is never lost.** Dialogs, the phone sheet and the palette keep Tab and Shift+Tab inside them and return focus to their opener, and focus never lands on the page body after any action.
- **DP-08 — All-or-nothing bulk changes.** A bulk change of status, priority or owner applies to every listed task in one transaction or to none of them.
- **DP-09 — Post-rehearsal notes session.** The stage manager selects twenty notes and reassigns them through the palette using only the keyboard, and every row then shows the new owner. None of the twenty notes is already Oren Vale's. Undo then gives every note its earlier owner back with one notice saying how many tasks it restored.
- **DP-10 — Derived blocked state.** A task is blocked exactly while at least one of its blockers is open, and a blocked task cannot be moved to Done.
- **DP-11 — Cascade order.** A change that closes blockers reports each task it freed once, with the depth, order and freeing task defined in Business rules.
- **DP-12 — Cue-line cascade.** When a change frees tasks, the screen plays the cue-line cascade described in Motion and effects and finishes within 600 milliseconds of the server's reply.
- **DP-13 — Cascade under reduced motion.** With reduced motion requested, freed rows swap to their new state in a single frame with the same badges and order markers and no line.
- **DP-14 — Clearing the build queue.** The production carpenter opens a blocker's details from its row, marks it Done and sees which paint tasks it freed and in what order, with the blocked count and cycle progress updated; Escape then closes the details and returns focus to that row. This works the same while request intake is down, with its banner showing, and on a 375-pixel phone, where the freed rows stay reachable with nothing scrolling sideways and every tap target on the screen and in the Departments drawer is at least 44 pixels. Undo then reopens the blocker and its parent and blocks the freed tasks again, with one notice giving both counts. Two carpentry blockers without sub-tasks, each blocking one paint task, closed together with s and the palette's Move to Done free both paint tasks, and Undo re-blocks both, listing them in the undone cascade's reverse order, with the exact Undo notice.
- **DP-15 — Exact undo.** Undo restores every task touched by the crew member's last undoable change to its exact earlier status, priority, owner, title, details, label and cycle, re-blocks what that change freed, and records an activity entry, as qualified in Business rules.
- **DP-16 — Reverse cascade on undo.** Undoing a change that freed tasks plays the cascade backwards on screen, removing badges and restoring Blocked chips in reverse order.
- **DP-17 — One confirmed announcement.** A single or bulk change produces exactly one polite announcement in the Notices region, made only after the server confirms it.
- **DP-18 — Recovering a mistaken bulk move.** The stage manager selects fifteen carpentry notes, which all show as selected with the last one reached as the one current row, and moves them to Done from the command palette, which keeps Tab inside it while open and returns focus to the control that opened it when it closes. Undo then puts every note and freed task back as it was. If a note changed after that move, undo is refused, every row on screen keeps its saved values, and exactly one notice gives the reason, on a 375-pixel phone as on a laptop, where every tap target on the screen and in the Departments drawer is at least 44 pixels.
- **DP-19 — Versioned edits.** Every task edit names the version it was based on, and of several simultaneous edits to one task exactly one succeeds.
- **DP-20 — Honest rollback.** When the server rejects an edit, the tab that made it puts the saved value back, shows it, and announces one notice.
- **DP-21 — Live updates in every open tab.** Each committed change reaches every open tab within 2 seconds and updates rows, chips and counts in place without a reload.
- **DP-22 — Two leads on one task.** When the sound lead and the stage manager change one task's owner at the same moment, both tabs end showing the winning value and the losing tab shows one notice. The laptop then makes the task block another sound task with Add blocked task, and the phone shows that task Blocked with no reload. The sound lead's phone keeps the rail as an off-screen drawer with nothing scrolling sideways, and the laptop first chooses who it is working as from the rail. A bulk assignment of three sound notes on the laptop, and its Undo, each reach the phone's open task sheet with no reload.
- **DP-23 — Sub-task roll-up.** A parent task closes in the same transaction as its last open sub-task, and reopening any sub-task reopens the parent, as qualified in Business rules.
- **DP-24 — Parent guards.** A parent with open sub-tasks cannot be marked Done by hand, and a parent cannot take blockers directly.
- **DP-25 — Closing the last fitting.** The costume lead opens the last open sub-task of a costume from its row, closes it, and both their tab and the stage manager's tab show the parent Done, the freed task and the new counts with no reload; Escape then closes the details and returns focus to that row. The view's department, grouping and highlighted row stay in the address, so a reload, or a second tab opened from it on a 375-pixel phone with every tap target on the screen and in the Departments drawer at least 44 pixels, shows the same view. If the server refuses a sub-task change because the task changed meanwhile, the costume lead's screen puts back the saved sub-task, parent, freed-task states and counts with one notice. The stage manager then makes the closed parent block a new sound task with Add blocked task, and that task does not show Blocked, because its only blocker is done. The costume's details, open in the stage manager's tab, change their roll-up line from 2 of 3 to 3 of 3 sub-tasks done with no reload. Closing a costume's last two open fittings together with s and the palette's Move to Done closes the costume, and Undo reopens all three with the exact Undo notice.
- **DP-26 — Confirmed attachments only.** An attachment exists in Promptside only after object storage has confirmed the stored file, and a failed or interrupted upload leaves no attachment.
- **DP-27 — Upload limits.** Uploads accept PDF, PNG and JPEG files of up to 10,000,000 bytes and refuse others with the statuses in Business rules.
- **DP-28 — Signed downloads.** Opening an attachment redirects to a signed storage link that expires 60 seconds after it is issued.
- **DP-29 — Upload feedback.** While a file uploads it shows as uploading and never as attached, and the result is announced with the exact copy from Feedback states.
- **DP-30 — Keeping the plot current.** The lighting lead attaches a revised lighting plot to a focus task and sees it marked as the current plot only after the upload is confirmed. This works the same on a 375-pixel phone in the task sheet, with nothing scrolling sideways and every tap target on the screen, in the Departments drawer and in the sheet at least 44 pixels, and while request intake is down. When plot storage is down the upload is refused, focus stays in the details, and Escape returns focus to the task's row. During the storage outage the lighting lead can still make the task block a programming note with Add blocked task. Two focus notes set to Urgent together with the 1 key cannot be undone after a teammate edits one of them: Undo is refused with its notice and nothing changes.
- **DP-31 — Views live in the address.** Department, blocked filter, grouping, view, cycle, highlighted row and open task all come from the address, survive Back, Forward and reload, and open the same in a second tab.
- **DP-32 — Sharing a carpentry view.** The stage manager shares the address of Carpentry, blocked only, grouped by cycle with STG-41 highlighted, and the carpenter's tab opens that exact view. In that view the carpenter opens the highlighted task's details and makes it block a paint task with Add blocked task. Back in Carpentry with every task shown, Group by Cycle chosen from the palette stays in the address across a reload, and a bulk assignment of two unblocked carpentry tasks made there is undone exactly with the exact Undo notice.
- **DP-33 — Filing a request.** Anyone in the rehearsal room can file a request, and it is shown as filed only after the intake has stored it.
- **DP-34 — Request outcomes.** The Requests screen lists each request with the outcome the intake holds, pending, accepted, declined or merged, and the task the intake records for it, as qualified in Business rules.
- **DP-35 — Director checks outcomes.** The director files a request and, after the stage manager decides it, sees its outcome and task on the Requests screen. This works by keyboard on a 375-pixel phone with nothing scrolling sideways and every tap target at least 44 pixels, and the File a request dialog keeps Tab inside it and returns focus to its button when it closes. On the phone the rail stays an off-screen drawer, and while request intake is down the director can still choose who they are working as from the rail.
- **DP-36 — Rehearsal-week cycles.** The server places tasks in rehearsal-week cycles that begin at midnight on Monday in the theatre's time zone, as qualified in Business rules.
- **DP-37 — Cycle rollover.** When a cycle ends, its open tasks move to the next cycle within 5 seconds, each with one activity entry.
- **DP-38 — Opening-night countdown.** The header counts the days to opening night from the server's date in the theatre's time zone.
- **DP-39 — Watching a cycle roll.** The stage manager watches the current cycle end and sees open tasks move to the next cycle and the cycle progress change in place, on a 375-pixel phone with nothing scrolling sideways, every tap target on the screen and in the Departments drawer at least 44 pixels, and request intake down. The cycle filter, grouping and highlighted row live in the address and survive Back, reload and a second tab, where opening a task's details from its row and closing them with Escape returns focus to the row and drops the task from the address. In the second tab the stage manager makes the highlighted task block another with Add blocked task. On the phone the rail stays an off-screen drawer while the cycle rolls, and before the address check the stage manager chooses who they are working as from the rail. Three of the cycle's tasks set to High together with the 2 key are put back by Undo with the exact Undo notice.
- **DP-40 — Phone layout.** At 375 pixels wide the rail becomes a drawer, task details open as a full-screen sheet, nothing scrolls sideways, and every tap target is at least 44 pixels tall and wide.
- **DP-41 — Published breakpoints.** Widths of 1200 pixels and above show board columns with a docked detail pane, widths from 768 to 1199 pixels show a grouped list with an overlay pane, and narrower widths use the phone layout.
- **DP-42 — Sound notes at the tech table.** The sound lead on a phone opens the Sound department, changes a cue note in the sheet and returns to the list without losing their place. Undo then restores the note with one notice. When the sound lead's newest note is followed by a teammate's edit to the same task, Undo on the phone is refused with its notice and the note stays as saved.
- **DP-43 — Blocking links.** Crew can record that one task blocks another, and a link that would form a loop is refused.
- **DP-44 — Task state machine.** Task status moves only along the legal edges in Business rules, and every illegal move is refused with its stated status.
- **DP-45 — Creating tasks.** A new task gets the next STG number, joins the current cycle unless a later one is chosen, and is validated with field errors.
- **DP-46 — Linking paint to carpentry.** The stage manager creates a paint task, links the carpentry task that must finish first, and sees the paint task show Blocked and the blocked count rise. The carpentry task and a second carpentry blocker closed together with s and the palette's Move to Done free both paint tasks, and Undo re-blocks both with the exact Undo notice.
- **DP-47 — Idempotent retries.** A retried task creation, bulk change, triage decision, undo or request filing with the same key returns the original result and changes nothing.
- **DP-48 — One error shape.** Every API error uses one JSON shape and follows the single precedence order in API.
- **DP-49 — Service outages.** If request intake or plot storage is down, at boot or later, the tracker keeps working, shows the matching banner, and recovers without a restart.
- **DP-50 — Published copy verbatim.** Every string this brief gives in backticks as visible or announced copy renders and is announced character for character.
- **DP-51 — Server boundary.** The server serves only its own origin and assets, enforces body limits, and never serves source or credentials.
- **DP-52 — Health and start-up.** The server starts from the run manifest on the published port and answers the health check.
- **DP-53 — Credentials from the environment.** Every service address and credential is read from the environment at start and never reaches the browser.
- **DP-54 — Prompt-book look.** The page reads as a prompt book: a warm off-white page, dark ink, a thin margin rule on every list, a serif display face for headings, and tabular mono numerals for every count and task id.
- **DP-55 — Spike-tape departments.** Each department label appears as a strip of that department's coloured spike tape with the department name written on it.
- **DP-56 — Motion vocabulary.** Panels, dialogs and state changes move with the short timings in Motion and effects, nothing loops for decoration, and reduced motion removes every movement.
- **DP-57 — Accessible names and contrast.** Every public control has the role and name given in the controls table, and text and controls meet WCAG 2.2 AA contrast.
- **DP-58 — Real system of record.** Tasks, links, cycles, activity and the undo journal live in Postgres, and no endpoint fakes provider state.

## Frontend

### Screens and layout (DP-31, DP-40, DP-41, DP-54)

Promptside has three screens at the paths `/tasks`, `/triage` and `/requests`, plus a not-found page. `/` redirects to `/tasks`.

- **Header.** Present on every screen. It shows the show title as the page's top-level heading, the theatre name, the opening-night countdown text (DP-38), and the blocked-count link.
- **Department rail.** Contains "All tasks", "Triage" with the number of triage tasks, "Requests", one entry for each department with its spike-tape strip and its open-task count, and the five cycles with a progress bar each. At the bottom is the "Working as" picker, which holds the crew member who is acting. The choice is remembered in this browser and sent with every write.
- **Tasks screen.** A toolbar sits above a task grid.
  - List view groups rows under sticky group headers. Each header shows the group name and the number of rows in that group under the current filters. Grouping is by status (the default), cycle, department or owner.
  - Board view shows four status columns: Backlog, Todo, In progress and Done. Cancelled tasks are not shown in board view.
  - Group order in list view:
    - By status: Backlog, Todo, In progress, Done, Cancelled.
    - By cycle: the five cycles in calendar order, then the group of tasks with no cycle.
    - By department: Carpentry, Paint, Lighting, Sound, Wardrobe, Props.
    - By owner: crew members in the order of the crew table in Seed data, then the group of tasks with no owner.
    - The names of the no-cycle and no-owner groups are in Feedback states.
    - A group with no rows under the current filters is left out of list view. Board view always shows its four columns.
  - Within a group or column, rows are ordered by priority (Urgent first, No priority last) and then by task number.
  - Each row shows the task id in mono, the department strip, the title, the status chip, a Blocked chip when blocked, the priority and the owner's name.
  - When the filters leave nothing, the grid shows a level-2 heading `No tasks match this view`.
- **Detail pane.** Shows the task id and title as a level-2 heading. Beside it is a properties column: Title, Details, Status, Priority, Owner, Label, Cycle, Department, Parent, Blocked by, Blocks, Sub-tasks with their roll-up line, and Attachments. Next to the properties is the activity feed, oldest entry first, with the actor and time on each entry. Entries made by the server itself (rollover, a parent closing automatically) show the actor "Promptside".
- **Triage screen.** A grid of triage tasks. Each row shows the id, the request title, the requester and the suggested department. When there are no triage tasks, the empty state from Feedback states shows instead.
- **Requests screen.** A "File a request" button and a table of requests, newest first, with columns for the request, requester, date filed, outcome and task.

Layout by width:

| Width | Rail | Tasks | Detail |
|---|---|---|---|
| 1200 pixels and wider (published check at 1280×800) | Fixed on the left, 240 pixels wide | Board view shows four columns side by side. List view shows the grid. If the columns need more room, the board scrolls sideways inside its own area. | Docked on the right, 420 pixels wide, beside the grid, with the properties and activity side by side |
| 768 to 1199 pixels (published check at 768×1024) | Fixed on the left, 240 pixels wide | Board view becomes one list grouped by status in column order; list view is unchanged | Overlays the right side of the grid, 420 pixels wide, with properties above activity |
| Below 768 pixels (published check at 375×812) | Hidden behind a "Departments" button that opens a drawer from the left | One list. Rows are at least 44 pixels tall and show the id, department strip, title on one line and status chip, with owner and priority hidden. | Full-screen sheet with properties above activity |

A width of exactly 768 gets the middle layout and a width of exactly 1200 gets the wide layout. No other breakpoint changes which layout these published sizes get. At every published size the page never scrolls sideways.

### Public screens and controls (DP-05, DP-06, DP-07, DP-17, DP-29, DP-31, DP-33, DP-34, DP-49, DP-57)

These roles and names are public. Everything else is free. `<n>` is a whole number written in digits.

| Where | Role and accessible name | Visible copy or notes |
|---|---|---|
| Header | `banner` containing `heading` level 1 "The Lantern Keepers" | Countdown text from Feedback states |
| Header | `link "<n> blocked"` | Goes to `/tasks?blocked=1`. The name always carries the final count, even while the digits are rolling. |
| Rail | `navigation "Departments"` | |
| Rail | `link "All tasks"`, `link "Triage <n>"`, `link "Requests"` | `<n>` is the triage count |
| Rail | `link "<department name> <n>"` for each department | `<n>` is that department's open-task count |
| Rail | `progressbar "<cycle name> progress"` for each cycle | Value is the cycle's done count and maximum is its total. Visible text: `<done> of <total> done` |
| Rail | `combobox "Working as"` | Lists every crew member by full name. The choice is remembered per browser, so a journey with two crew members uses two browsers. |
| Phone | `button "Departments"` opens `dialog "Departments"` | The drawer holds the rail |
| Tasks toolbar | `toolbar "Task tools"` | |
| Tasks toolbar | `button "List view"`, `button "Board view"` | The active one is pressed |
| Tasks toolbar | `combobox "Group by"` | Options Status, Cycle, Department, Owner. Hidden in board view. |
| Tasks toolbar | `checkbox "Blocked only"`, `combobox "Cycle"` | The cycle options are "All cycles" and the five cycle names |
| Tasks toolbar | `button "New task"`, `button "Undo"`, `button "Commands"` | Commands opens the palette |
| Tasks toolbar | Selection text | `<n> selected`, shown while at least one row is selected |
| Grid | `grid "Tasks"` | Each group (list view) or column (board view) is a `rowgroup` named after the group, and its header shows the group name and count |
| Grid | `row` for each task | The accessible name starts with the task id. Selected rows have `aria-selected="true"`. The current row has `aria-current="true"`. Freed rows carry `data-freed-order` and `data-freed-depth` (Motion and effects). |
| Detail | `complementary "Task details"` (768 pixels and wider) or `dialog "Task details"` (below 768) | `button "Close details"` |
| Detail | `textbox "Title"`, `textbox "Details"`, `combobox "Status"`, `combobox "Priority"`, `combobox "Owner"`, `combobox "Label"`, `combobox "Cycle"` | Text fields save when they lose focus or on Enter. Comboboxes save on choice. |
| Detail | `list "Blocked by"`, `list "Blocks"`, `button "Add blocked task"`, `button "Remove link to <id>"` | |
| Detail | `list "Sub-tasks"`, `button "Add sub-task"` | Roll-up line from Feedback states |
| Detail | `list "Attachments"`, file input "Attach file", `combobox "Attachment kind"` | Each item has `link "<file name>"`, its kind, and `Current` on the newest of its kind |
| Detail | `progressbar "Upload progress"` | Present only while an upload is in flight |
| Detail | `list "Activity"` | |
| Palette | `dialog "Command palette"` containing `combobox "Command"` and `listbox "Commands"` | Options listed under Interactions |
| New task | `dialog "New task"` with `textbox "Title"`, `combobox "Department"`, `combobox "Priority"`, `combobox "Owner"`, `button "Create task"`, `button "Cancel"` | The sub-task form is the same dialog with the parent already set |
| Link tasks | `dialog "Add blocked task"` with `combobox "Task"`, `button "Add link"` | |
| Triage | `grid "Triage"` | Same row rules as the task grid |
| Triage | `dialog "Accept request"` with `combobox "Department"`, `combobox "Priority"`, `combobox "Owner"`, `combobox "Label"`, `button "Accept"` | |
| Triage | `dialog "Decline request"` with `textbox "Reason"`, `button "Decline"` | |
| Triage | `dialog "Merge request"` with `combobox "Duplicate of"`, `button "Merge"` | |
| Requests | `button "File a request"`, `table "Requests"` | Outcome cells read Pending, Accepted, Declined or Merged |
| Requests | `dialog "File a request"` with `textbox "Request"`, `textbox "Details"`, `textbox "Your name"`, `combobox "Department"`, `button "File request"` | |
| Forms | Error summary `alert` | Heading and links from Feedback states |
| Everywhere | `status "Notices"` (polite) | The one region that announces results |
| Everywhere | `region "Service status"` containing one `alert` for each service that is down | Banner copy from Feedback states |
| Not found | `heading` level 1 and `link "Back to tasks"` | Copy from Feedback states |

### Interactions (DP-04, DP-05, DP-06, DP-07, DP-09, DP-20, DP-21, DP-31, DP-42)

**Task grid keys.** These keys work when focus is on a row, on any control inside the grid, or on any control in the "Task tools" toolbar. They do not work while typing in a text field.

| Key | Action |
|---|---|
| j or Down arrow | Make the next row current |
| k or Up arrow | Make the previous row current |
| Home, End | Make the first or last row current |
| Left arrow, Right arrow | In board view at 1200 pixels and wider, move to the row at the same position in the neighbouring column, or to that column's last row |
| x | Toggle selection of the current row |
| Shift+Down, Shift+Up | Move the current row and select every row from the current row at the first Shift+arrow press to the new current row, adding them to rows already marked with x |
| 0 to 4 | Set priority: 0 No priority, 1 Urgent, 2 High, 3 Medium, 4 Low. Applies to the selection, or to the current row if nothing is selected. |
| Enter | Open details for the current row |
| Escape | Close the open details. If none are open, clear the selection. |
| a | Open the palette with `Assign to ` already typed |
| s | Open the palette with `Move to ` already typed |
| p | Open the palette with `Set priority: ` already typed |
| c | Open "New task" |
| Ctrl+Z or Cmd+Z | Undo (also works from the "Undo" button) |

There is exactly one current row. It carries `aria-current="true"`, holds DOM focus while the grid is focused, and is the only row reachable with Tab. Clicking or tapping a row makes it current and opens its details. Ctrl+click or Cmd+click toggles its selection instead.

**Command palette.** Ctrl+K or Cmd+K opens it from anywhere, including from inside text fields. Typing filters the commands by case-insensitive text match. Up and Down move the active option, Enter runs it, and Escape closes the palette. The commands are:

- `Assign to <full name>` for each crew member, and `Unassign`
- `Set priority: No priority`, `Set priority: Urgent`, `Set priority: High`, `Set priority: Medium`, `Set priority: Low`
- `Move to Backlog`, `Move to Todo`, `Move to In progress`, `Move to Done`, `Move to Cancelled`
- `Undo last change`, `New task`, `File a request`
- `Go to All tasks`, `Go to Triage`, `Go to Requests`, and `Go to <department name>` for each department
- `Group by Status`, `Group by Cycle`, `Group by Department`, `Group by Owner`
- `Show blocked only`, `Show all`
- `List view`, `Board view`

Task commands apply to the selection, or to the current row if nothing is selected. With more than one target they are sent as one bulk change.

**Triage keys.** In the "Triage" grid, j, k, the arrow keys, Home and End move as they do in the task grid. a opens "Accept request", d opens "Decline request" and m opens "Merge request". Accept is prefilled with the request's suggested department, No priority and no owner. Enter in a dialog submits it.

**Focus rules.**

- Every dialog and the phone sheet keeps Tab and Shift+Tab inside it: Tab from the last control goes to the first, and Shift+Tab from the first goes to the last. Escape closes the dialog or sheet, and focus returns to the control or row that opened it.
- The docked or overlay detail pane is not modal. Opening it moves focus to its heading. Escape inside it closes it and returns focus to the row.
- After an action removes the current row from the view (a filter no longer matches, or a triage decision), the next row becomes current, or the previous row if there is no next. If no rows remain, focus moves to the empty-state heading.
- After a bulk change, the current row stays current if it is still in view.
- Focus never lands on the page body.

**Address state.** Path `/tasks` takes these query parameters:

| Parameter | Values |
|---|---|
| `view` | `list` (default) or `board` |
| `dept` | A department key |
| `blocked` | `1` |
| `group` | `status` (default), `cycle`, `department` or `owner`. Ignored in board view. |
| `cycle` | A cycle key |
| `row` | The highlighted, current row's task id |
| `task` | The task whose details are open |

Parameters at their default are left out. Each change to view, department, blocked filter, grouping, cycle or open details adds one history entry, so Back and Forward step through those changes. Moving the current row replaces `row` without adding history. On load, including a reload and a second tab, the screen rebuilds the view from the address, scrolls the `row` task into view and makes it current. An unknown value, or a `row` or `task` not in the view, falls back to the default, and the address is rewritten without adding history. Selection is never kept in the address. For example, `/tasks?dept=carpentry&blocked=1&group=cycle&row=STG-41` shows Carpentry, blocked only, grouped by cycle, with STG-41 highlighted.

**Optimistic edits.**

1. A field edit, bulk edit or keyboard priority change shows the new value at once.
2. The affected rows are marked busy until the server replies.
3. On success, the change result replaces local values.
4. On any rejection, every affected row and field returns to the server's saved value. On a version rejection that value is the `current` value from the error. The Notices region then gets one notice.
5. A rejected value is never left on screen.

**Live updates.** Each tab keeps the change stream from the API open and applies each change result to its rows, chips, counts and progress bars in place. A tab that made the change applies the reply and ignores the stream's copy of the same change. A snapshot with a lower sequence number than the last one applied is ignored, so counts never step backwards. Changes made in other tabs are not announced, except when they cause the rollback in step 4 above. If the stream drops, the tab reconnects and reloads the tasks and snapshot.

**Phone.** Tapping "Departments" opens the drawer, and choosing an entry closes it. Tapping a row opens the sheet. Closing the sheet returns focus and scroll position to that row.

### Visual design (DP-54, DP-55, DP-57)

- **Colour.**
  - Page: a warm off-white, like prompt-book paper.
  - Text: a warm near-black ink.
  - Lines: a soft warm grey for hairline rules.
  - Accent: a deep stage-green for primary buttons, focus rings, the current row's edge, progress bars and the cue-line.
  - Alert: a deep brick red, used only for Blocked chips, error text and outage banners.
- **Prompt-book margin.** Every list and grid has a single thin grey margin rule running down its left side, like the margin of a prompt book. The cue-line draws along this rule.
- **Department strips.** Each department label looks like a short strip of spike tape in its own colour, with the department name printed on it in ink. The name always appears, never colour alone.

  | Department | Tape colour |
  |---|---|
  | Carpentry | Yellow |
  | Paint | Blue |
  | Lighting | Orange |
  | Sound | Violet |
  | Wardrobe | Pink |
  | Props | Kraft brown |

- **Type.**
  - Headings use Fraunces, a soft high-contrast serif.
  - Body text uses IBM Plex Sans.
  - Every task id, count, date and numeral uses IBM Plex Mono with equal-width digits, so columns of numbers line up.
  - Each heading level is about one fifth larger than the level below it.
  - All fonts are served by the app itself.
- **Density.**
  - Compact. Rows are about 32 pixels tall at 768 pixels and wider with a mouse.
  - Spacing follows a 4 and 8 pixel rhythm.
  - Below 768 pixels, and on touch screens, every row, button and control is at least 44 pixels tall and wide.
- **Focus.** Every focusable element shows a clearly visible green focus ring that does not touch the element's edge.
- **Contrast.** All text and control boundaries meet WCAG 2.2 AA contrast against the page, including text on tape strips and on chips.

### Motion and effects (DP-12, DP-13, DP-16, DP-56)

- **Detail pane.** Slides in from the right in about a quarter of a second (240 milliseconds), starting quickly and settling softly. It leaves in about a sixth of a second (160 milliseconds).
- **Phone sheet and drawer.** The sheet rises from the bottom and the drawer comes in from the left, with the same timings as the pane.
- **Dialogs and the palette.** They fade in and rise a few pixels in about a sixth of a second.
- **Hover and press.** Background colour changes take between a tenth and a sixth of a second (100 to 160 milliseconds).
- **Status chip change.** The chip swaps in about a sixth of a second.
- **Cue-line cascade (signature).** Time is measured from the server's reply in the tab that made the change, or from receiving the change in another tab. Everything below finishes within 600 milliseconds of that point.
  1. The status chip of the task the user changed flips to its new status in about a sixth of a second. Any parent that closed automatically flips at the same moment.
  2. A thin green cue-line, about 2 pixels wide, draws along the grid's left margin rule from the changed row to each freed row, going up or down as needed. It crosses group headers and stays drawn when the freed row sits in another group. If the changed row isn't on screen, the line starts at the grid's top edge.
  3. Rows are reached in depth order, about 60 milliseconds per depth (depth 1 to 5). Rows of the same depth are reached together.
  4. When the line reaches a row, its Blocked chip crossfades into the row's own status chip in about a quarter of a second, and the badge `Freed by <id>` appears on the row.
  5. Each freed row gets `data-freed-order` equal to its `order` and `data-freed-depth` equal to its `depth` from the server's cascade.
  6. The blocked-count digits roll down one step for each freed task as it is reached.
  7. The affected cycle progress bars move once, at the end, in about a quarter of a second.
  8. The line then fades in about a sixth of a second.

  Badges and order markers stay until that row next changes or the page reloads. Freed rows that the current filters hide are skipped on screen but still count.
- **Reverse cascade on undo.** Undoing a change that freed tasks plays the cascade backwards within the same 600 milliseconds.
  1. The line draws from the farthest freed row back towards the restored row.
  2. Rows are reached in the order of the undo's `reblocked` list. Each row loses its badge and its order markers, and its chip crossfades back to Blocked.
  3. The blocked digits roll up one step for each row.
  4. The progress bars move once, at the end.
- **Reduced motion.** When the person has asked their system for reduced motion:
  - Nothing slides, fades, rolls or draws.
  - Panes, sheets, drawers and dialogs appear and disappear in one frame.
  - The cascade has no line and no stagger: every freed row's chip and badge change in a single frame, with the same `Freed by <id>` badges and the same `data-freed-order` and `data-freed-depth` values.
  - Numerals jump straight to their final value, and progress bars jump to their end.
  - The reverse cascade likewise happens in one frame.
- **No decorative loops.** Nothing moves on its own. There are no spinners, pulsing dots, shimmer placeholders or looping animations. Pending work shows as text plus the busy marking.

### Feedback states (DP-17, DP-20, DP-29, DP-33, DP-49, DP-50)

Placeholders:

| Placeholder | Meaning |
|---|---|
| `<id>` | A task id such as STG-12 |
| `<ids>` | Task ids joined with a comma and a space |
| `<n>`, `<k>` | Whole numbers in digits |
| `<status>` | A status display name: Triage, Backlog, Todo, In progress, Done, Cancelled, Duplicate |
| `<priority>` | A priority display name: No priority, Urgent, High, Medium, Low |
| `<name>` | A crew member's full name |
| `<cycle>` | A cycle name |
| `<file name>` | The uploaded file's original name |

Wherever copy says "<n> tasks" or "<k> tasks", it reads "1 task" when the number is 1. Every apostrophe is a straight apostrophe, and every string below is exact.

**Notices region.** The `status "Notices"` region gets exactly one message per user action, and only after the server has replied. Each message replaces the previous one.

Single-task edit messages:

- Status: `<id> moved to <status>.`
  - Add ` <parent id> closed.` for each parent that closed automatically.
  - Add ` <parent id> reopened.` for each parent that reopened.
  - Then add ` <k> tasks freed.` when the change freed tasks.
  - For example, with the seed data at start, marking STG-12 Done announces `STG-12 moved to Done. STG-10 closed. 2 tasks freed.`
- Priority: `<id> priority set to <priority>.`
- Owner: `<id> assigned to <name>.` or `<id> unassigned.`
- Title, details, label or cycle: `<id> updated.`

Bulk edit messages:

- Status: `<n> tasks moved to <status>.`, plus ` <k> tasks freed.` when tasks were freed.
- Priority: `Priority set to <priority> on <n> tasks.`
- Owner: `<n> tasks assigned to <name>.` or `<n> tasks unassigned.`

Other success messages:

| Action | Message |
|---|---|
| Undo | `Undo restored <n> tasks.`, plus ` <k> tasks blocked again.` when tasks were re-blocked |
| New task | `<id> created.` |
| Link added | `<id> now blocks <id>.` |
| Link removed | `<id> no longer blocks <id>.` |
| Accept | `<id> accepted into <cycle>.` |
| Decline | `<id> declined.` |
| Merge | `<id> merged into <id>.` |
| Last triage task decided | Any decision message, followed by ` Triage is clear.` |
| Upload | `<file name> attached to <id>.` |
| Request filed | `Request filed. It reaches triage within a few seconds.` |

Rejection messages, announced after the rollback:

| Rejection | Message |
|---|---|
| Version conflict, single task | `<id> was changed by someone else. Showing the saved version.` |
| Version conflict, bulk | `No tasks changed: some were edited by someone else. Showing the saved versions.` |
| Any other bulk refusal | `No tasks changed. <k> of the selected tasks can't take that change.` |
| Illegal move | `<id> can't move from <status> to <status>.` |
| Blocked task to Done | `<id> is still blocked by <ids>.` |
| Parent with open sub-tasks to Done | `<id> has open sub-tasks.` |
| Task not editable | `<id> can't be edited in <status>.` |
| Link would form a loop | `That link would make a loop, so it was not added.` |
| Any other link refusal | `That link can't be added.` |
| Nothing to undo | `Nothing to undo.` |
| Undo stale | `Undo stopped: a task changed after that edit.` |
| Intake unreachable | `Request intake is unreachable, so <id> stays in triage.` |
| Intake refused | `Request intake refused the decision, so <id> stays in triage.` |
| Already decided | `<id> was already decided.` |
| Storage unreachable on upload | `Plot storage is unreachable. <file name> was not attached.` |
| Upload interrupted | `<file name> was not attached.` |
| Network failure | `Couldn't reach Promptside. Nothing was saved.` |

**Pending.**

- While an edit, bulk edit or undo awaits the server, the affected rows have `aria-busy="true"` and the toolbar shows `Saving`.
- A triage dialog's submit button shows `Sending to intake` and is disabled.
- During an upload, the Attachments section shows `Uploading <file name>` with the "Upload progress" bar. The file is not in `list "Attachments"` until the server confirms it.
- The "File request" button shows `Filing` and is disabled.
- Nothing is announced while work is pending.

**Field errors.** On a validation error a form shows an error summary `alert`.

- It has the heading `There is a problem`, followed by one link for each field in error. Each link's text is that field's message, and activating it moves focus to the field.
- Focus moves to the summary.
- Each field also shows its own message beside it.

The API returns these same messages:

| Field | Message |
|---|---|
| title, empty | `Give the task a title.` |
| title, too long | `Keep it to 140 characters.` |
| details | `Keep details to 4,000 characters.` |
| department | `Choose a department.` |
| priority | `Choose a priority from 0 to 4.` |
| owner | `Choose someone on the crew list.` |
| X-Crew-Member | `Choose someone on the crew list.` |
| status | `Choose a status.` |
| label | `Choose a label this department uses.` |
| cycle | `Choose the current cycle or a later one.` |
| parent | `Choose an existing task that is not a sub-task.` |
| blocks, same task | `A task can't block itself.` |
| blocks, unknown task | `Choose an existing task.` |
| tasks | `Choose 1 to 100 tasks.` |
| set | `Choose a change to make.` |
| decision | `Choose accept, decline or merge.` |
| reason | `Say why it was declined.` |
| duplicate_of | `Choose an accepted task to merge into.` |
| request title, empty | `Say what you need.` |
| request title, too long | `Keep it to 140 characters.` |
| requester | `Add your name.` |
| file | `Attach a PDF, PNG or JPEG file.` |
| kind | `Choose sketch, plot or rendering.` |
| Idempotency-Key | `Use 1 to 100 visible characters.` |
| query filter | `That filter value isn't recognised.` |

**Empty states.**

| Where | Copy |
|---|---|
| Triage | Level-2 heading `Triage is clear` and the line `Every request from the rehearsal room has an answer.` |
| Tasks | Level-2 heading `No tasks match this view` |
| Requests | `No requests filed yet.` |
| Attachments | `No attachments yet.` |

**Outage banners.** Each banner is an `alert` inside "Service status". It appears within 10 seconds of the server noticing the outage, and goes away within 10 seconds of the service returning.

- Intake down: `Request intake is unreachable. New requests reach triage when it is back, and decisions are paused.`
- Storage down: `Plot storage is unreachable. Attachments can't be uploaded or opened right now; everything else still works.`

While the intake is down, the Requests table area shows `Request outcomes can't be shown until the intake is back.`

**Header, group, table and roll-up text.**

| Item | Copy |
|---|---|
| Countdown, 2 or more days | `<n> days to opening` |
| Countdown, 1 day | `1 day to opening` |
| Countdown, opening day | `Opening tonight` |
| Countdown, after opening | `Now running` |
| Sub-task roll-up | `<done> of <total> sub-tasks done` |
| Freed badge | `Freed by <id>` |
| Rows chip when blocked | `Blocked` |
| Group name, tasks with no owner | `No owner` |
| Group name, tasks with no cycle | `No cycle` |
| Requests Task cell, when `task` is null | `Awaiting triage` |

**Not found.** A level-1 heading `This page isn't in the prompt book` and `link "Back to tasks"`.

## Backend

### API (DP-01, DP-02, DP-03, DP-08, DP-19, DP-21, DP-26, DP-28, DP-33, DP-34, DP-45, DP-48)

**Conventions.**

- Every endpoint is under `/api`.
- JSON responses are `application/json; charset=utf-8`.
- Writes with a body send `Content-Type: application/json`, except uploads, which send `multipart/form-data`.
- A write may send `X-Crew-Member: <handle>` to name who acts. If it is absent, the actor is `maya`.
- Task ids are written `STG-<number>`.

**Task.**

```json
{"id":"STG-12","number":12,"title":"Rebuild the upstage door flat","details":"","department":"carpentry","label":null,"status":"in_progress","priority":1,"owner":"devi","cycle":"rehearsal-1","parent":"STG-10","subtasks":null,"blocked_by":[],"blocks":["STG-13"],"blocked":false,"duplicate_of":null,"request":null,"version":1,"updated_at":"2026-11-02T21:14:03Z"}
```

| Field | Meaning |
|---|---|
| `status` | One of `triage`, `backlog`, `todo`, `in_progress`, `done`, `cancelled`, `duplicate` |
| `priority` | 0 to 4 |
| `owner` | A crew handle or null |
| `label` | A label key or null |
| `cycle` | A cycle key, or null for triage, declined and duplicate tasks |
| `subtasks` | `{"done":<n>,"total":<n>}` for a parent, where total leaves out cancelled sub-tasks; null otherwise |
| `blocked_by` | Every blocker, open or closed |
| `blocked` | The derived overlay |
| `request` | The intake record id for tasks pulled from the intake |

**Snapshot.**

```json
{"seq":1,"triage":3,"columns":{"backlog":8,"todo":40,"in_progress":8,"done":3,"cancelled":1},"blocked":7,"cycles":[{"key":"rehearsal-1","name":"Rehearsal 1","starts_at":"2026-11-02T00:00:00Z","ends_at":"2026-11-09T00:00:00Z","current":true,"done":3,"total":51}]}
```

`cycles` lists all five cycles in order, and `ends_at` is null for Previews. `seq` is the id of the last committed change, 0 before the first change. The numbers above are the seed state at start, once the three seeded requests have been pulled; that start-up pull is one committed change, so `seq` is 1.

**Change result.** Every task-changing call returns this:

```json
{"change":42,"undoable":true,"tasks":[],"cascade":[{"id":"STG-13","depth":1,"order":1,"freed_by":"STG-12"}],"reblocked":[{"id":"STG-13","order":1}],"snapshot":{}}
```

`tasks` holds every task the change touched, after the change. Business rules (Cascade) states which tasks count as touched.

**Error.** Every error body is one top-level object `error` holding `code` and `message`. `message` is free English text; the screen shows the copy in Feedback states instead. Every extra member sits inside `error`, beside `code` and `message`, and never at the top level:

| Member | Present on |
|---|---|
| `fields`, an object of field key to message | Every 422 |
| `current` | Every 412. For a single edit, the saved Task. For a bulk edit, a list of the saved Tasks of every stale entry, in task-number order. |
| `blocked_by`, a list of ids in task-number order | Every `blocked_by_open`. For a single edit, the task's open blockers. For a bulk change, every open blocker of the refused tasks, each listed once. |
| `tasks`, a list of ids in task-number order | Every bulk refusal with 404 or 409: the refused ids |

A single `blocked_by_open` therefore carries `blocked_by` only. A bulk `blocked_by_open` carries both `tasks` and `blocked_by`. A bulk 412 carries `current` only.

`fields` keys are the request's body field names (for example `title`, `blocks`, `tasks`, `file`, `kind`). A header error uses the header name exactly as written here, `X-Crew-Member` or `Idempotency-Key`. A query error on `GET /api/tasks` uses the parameter name: `dept`, `status`, `blocked`, `cycle`, `owner` or `label`.

Examples. Task objects are shortened here to three members; real responses carry the full Task.

422:

```json
{"error":{"code":"validation_failed","message":"Check the highlighted fields.","fields":{"title":"Give the task a title.","X-Crew-Member":"Choose someone on the crew list."}}}
```

412, single edit:

```json
{"error":{"code":"version_conflict","message":"STG-38 was changed by someone else.","current":{"id":"STG-38","owner":"maya","version":2}}}
```

412, bulk edit:

```json
{"error":{"code":"version_conflict","message":"Some tasks were changed by someone else.","current":[{"id":"STG-21","priority":2,"version":2},{"id":"STG-22","priority":2,"version":2}]}}
```

Bulk `blocked_by_open`, for example with the seed data at start, when one bulk change moves STG-26 and STG-46 to Done:

```json
{"error":{"code":"blocked_by_open","message":"Some tasks are still blocked.","tasks":["STG-26","STG-46"],"blocked_by":["STG-3","STG-6"]}}
```

**Error precedence.** This applies to the whole API. The first failing check decides the response:

1. 403 `cross_origin` (Server boundary)
2. 413 `payload_too_large` (Server boundary)
3. 415 `unsupported_media_type`
4. 400 `malformed_json`
5. 404 `not_found` for an unknown path, task, link or attachment
6. 428 `precondition_required`
7. Idempotency: a replay returns its stored response, or a key reuse conflict is refused (Business rules)
8. 412 `version_conflict`
9. 409 state conflicts (Business rules)
10. 422 `validation_failed`
11. 502 or 503 provider errors (Services)

**Endpoints.**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| GET `/api/health` | None | 200 `{"status":"ok"}` | 503 `{"status":"starting"}` until the database schema is ready |
| GET `/api/status` | None | 200 `{"intake":"up","plot_storage":"up"}`. Each value is `up` or `down`. | None |
| GET `/api/production` | None | 200 `{"theatre","show","time_zone","today","opening_night","days_to_opening","current_cycle","departments":[{"key","name","labels":[{"key","name"}]}],"crew":[{"handle","name","role","department"}]}`. `today` and `opening_night` are `YYYY-MM-DD`. | None |
| GET `/api/snapshot` | None | 200 Snapshot | None |
| GET `/api/tasks` | Optional query: `dept`, `status` (one status key; without it, every status except `triage` and `duplicate`), `blocked=1`, `cycle`, `owner` (handle or `none`), `label` | 200 `{"tasks":[...],"snapshot":{...}}`, ordered by number | 422 for an unknown filter value |
| GET `/api/tasks/{id}` | None | 200 `{"task":{...}}` with header `ETag: "<version>"` | None |
| POST `/api/tasks` | `{"title","department","details"?,"label"?,"priority"?,"owner"?,"status"?,"cycle"?,"parent"?}`. `status` is `backlog` (default) or `todo`. Optional `Idempotency-Key` header. | 201 Change result with `undoable:false` | None |
| PATCH `/api/tasks/{id}` | Any of `title`, `details`, `status`, `priority`, `owner`, `label`, `cycle`. Header `If-Match: <version>`; the number may be in double quotes. | 200 Change result | None. A body that changes nothing returns 200 with no new change and the version unchanged. |
| POST `/api/tasks/bulk` | `{"tasks":[{"id","version"}],"set":{"status"?,"priority"?,"owner"?}}`, 1 to 100 tasks. Optional `Idempotency-Key`. | 200 Change result | 404 lists unknown ids in `tasks` |
| POST `/api/undo` | `{}`. Optional `Idempotency-Key`. | 200 Change result with `undoable:false` | None |
| POST `/api/tasks/{id}/relations` | `{"blocks":"<id>"}`, meaning `{id}` blocks the named task | 201 Change result with `undoable:false` | None |
| DELETE `/api/tasks/{id}/relations/{target}` | None | 200 Change result with `undoable:false` | 404 when there is no such link |
| GET `/api/tasks/{id}/activity` | None | 200 `{"activity":[{"id","task","at","actor":{"handle","name"}\|null,"kind","changes":{"<field>":{"from","to"}},"change"}]}`, oldest first | None |
| GET `/api/tasks/{id}/attachments` | None | 200 `{"attachments":[{"id","task","file_name","kind","size","content_type","created_at","current"}]}`, newest first. Works while storage is down. | None |
| POST `/api/tasks/{id}/attachments` | Multipart with fields `file` and `kind` (`sketch`, `plot` or `rendering`) | 201 `{"attachment":{...}}` | 503 `storage_unavailable` |
| GET `/api/attachments/{id}/download` | None | 302 with `Location` set to a signed storage link | 503 `storage_unavailable` |
| POST `/api/triage/{id}/decision` | `{"decision":"accept","department","priority"?,"owner"?,"label"?}`, `{"decision":"decline","reason"}` or `{"decision":"merge","duplicate_of":"<id>"}`. Optional `Idempotency-Key`. | 200 Change result with `undoable:false` and `"request":{"id","status","task"}` | 502 `intake_rejected`, 503 `intake_unavailable` |
| GET `/api/requests` | None | 200 `{"requests":[{"id","title","details","requester","department","status","task","created","decided_at"}]}`, newest first | 503 `intake_unavailable` |
| POST `/api/requests` | `{"title","requester","details"?,"department"?}`. Optional `Idempotency-Key`. | 201 `{"request":{...}}` with status `pending` | 502 `intake_rejected`, 503 `intake_unavailable` |
| GET `/api/events` | None | 200 `text/event-stream` | None |

**Event stream.**

- Event `change` carries a change result plus `"kind"`, which is one of `create`, `edit`, `bulk`, `undo`, `relation`, `decision`, `pull`, `rollover` or `attachment`. For `attachment`, the event carries `"attachment"` in place of `tasks`.
- The event id is the change's `seq`.
- Event `status` carries the `/api/status` body whenever it changes.
- A comment line is sent at least every 15 seconds.

### Business rules (DP-02, DP-08, DP-10, DP-11, DP-15, DP-19, DP-23, DP-24, DP-27, DP-36, DP-37, DP-38, DP-43, DP-44, DP-45, DP-47)

All 409 responses here use the error shape and the codes named below.

**Status edges.**

| From | Legal moves |
|---|---|
| Backlog, Todo, In progress (the open statuses) | Any other open status, Done, or Cancelled |
| Done | Todo or In progress |
| Cancelled | Backlog |
| Triage | Only through a triage decision: Backlog on accept, Cancelled on decline, Duplicate on merge |
| Duplicate | Nothing (terminal) |

- Any other status move is refused with 409 `illegal_transition`.
- Any edit to a task in Triage or Duplicate is refused with 409 `not_editable`.
- A task is closed when it is Done, Cancelled or Duplicate.

**Blocked.** A task is blocked exactly when it is in an open status and at least one of its blockers is open. This is never stored by hand.

- Moving a blocked task to Done is refused with 409 `blocked_by_open`, listing the open blockers.
- In a bulk change, blockedness is judged after every task in that change has been applied. Closing a blocker and its dependent together is therefore allowed.

**Links.** `A blocks B` makes A a blocker of B.

| Refusal | Response |
|---|---|
| A link from a task to itself | 422 |
| A link to an unknown target | 422 |
| A link involving a Triage or Duplicate task | 409 `illegal_relation` |
| A link that already exists | 409 `relation_exists` (of two simultaneous identical adds, exactly one succeeds) |
| A link whose blocked task has sub-tasks | 409 `blocks_parent` |
| A link that would form a loop through any chain of links | 409 `relation_cycle` |

Adding or removing a link adds 1 to the version of both tasks.

**Sub-tasks.** Sub-tasks go one level deep, and the parent is set only when the sub-task is created. A sub-task's parent must exist and must not itself be a sub-task, otherwise the request is refused with 422. A parent that has blockers cannot take sub-tasks: 409 `blocks_parent`.

The roll-up happens in the same transaction as the change that causes it:

- When a change moves a sub-task to Done or Cancelled, and afterwards its parent is in an open status, every non-cancelled sub-task is Done, and at least one sub-task is Done, the parent becomes Done.
- When a parent is Done and any of its sub-tasks becomes open (reopened, or newly created), the parent becomes In progress.

The roll-up fires only on changes to sub-tasks.
- A parent moved out of Done by hand (to Todo or In progress) is allowed and stays open, even when every sub-task is Done.
- Such a parent closes again only when it is moved to Done by hand, or when a later sub-task change triggers the close above.
- Undo restores parents directly, as stated under Undo, and does not trigger the roll-up.

Moving a parent with open sub-tasks to Done by hand is refused with 409 `open_subtasks`.

**Versions.**

- Every task starts at version 1. Each change that touches a task adds 1, including roll-up, rollover, undo and link changes.
- PATCH without `If-Match` is refused with 428 `precondition_required`.
- If `If-Match` or a bulk entry's `version` differs from the saved version, the request is refused with 412 `version_conflict`. The error carries `current` as described in API.
- Of any number of simultaneous edits based on the same version, exactly one succeeds and every other one gets 412.

**Bulk.** All or nothing. If any task is refused, nothing changes. The error carries the members described in API, under the first code that applies, checked in this order: `not_editable`, `illegal_transition`, `blocked_by_open`, `open_subtasks`.

**Cascade.** A change frees a task when the change takes that task from blocked to not blocked while it stays open. Each freed task appears in `cascade` exactly once.

Apart from the two tasks of a link being added or removed, which follow the link rule above, freed and re-blocked tasks are not touched by the change that frees or re-blocks them:
- Their stored fields and version stay the same.
- They get no activity entry.
- They are not listed in `tasks`.
- They do not count towards an undo's restored total.

They appear only in `cascade` or `reblocked`, and the snapshot's `blocked` count reflects them. Each tab updates their Blocked chips from those two lists.

For a change that closes tasks:

- **Level.** Tasks closed directly by the request have level 0. A parent closed by roll-up has a level one higher than the highest level among its sub-tasks closed in this change.
- **`freed_by`.** Among the freed task's blockers that closed in this change, the one with the highest level. Ties go to the higher task number.
- **`depth`.** One more than the level of `freed_by`.
- **`order`.** The 1-based position after sorting by depth, then by task number.

For example, with the seed data at start, moving STG-12 to Done closes STG-10. The response's cascade is STG-13 (depth 1, order 1, freed by STG-12) followed by STG-14 (depth 2, order 2, freed by STG-10).

For a link removal, which closes no task: removing a link can free only the task that link blocked. When it does, `cascade` holds exactly that one task, with `freed_by` set to the removed link's blocker (the `{id}` in the request path), `depth` 1 and `order` 1. Because it is one of the link's two tasks, that freed task is also listed in `tasks`. When the removal frees nothing, `cascade` is empty.

`reblocked` lists the tasks a change took from not blocked to blocked. For an undo, it is the undone change's cascade in reverse order, numbered from 1. For any other change, it is in task-number order. Only tasks that actually go from not blocked to blocked are listed, and the Undo notice's `<k>` counts exactly those.

**Undo.** `POST /api/undo` reverses the acting crew member's most recent undoable change that has not already been undone.

- **Undoable changes.** PATCH edits and bulk edits.
- **Not undoable.** Creation, links, triage decisions, rollover, attachments and undo itself. There is no redo.
- **What it restores.** Every task the change touched, including parents closed or reopened by roll-up, gets its exact earlier `status`, `priority`, `owner`, `title`, `details`, `label` and `cycle`, with its version increased by 1. Re-blocking follows from the restored statuses.
- **Activity.** Undo writes one `undo` activity entry for each restored task. History is never deleted.
- **Nothing to undo.** Refused with 409 `nothing_to_undo`.
- **Stale.** If any touched task's version is no longer the version that change left it at, nothing changes and the request is refused with 409 `undo_stale`.

**Activity.** Every change writes exactly one activity entry for each task it touches, listing each changed field with its `from` and `to` values. The kinds are `created`, `edited`, `auto_closed`, `auto_reopened`, `linked`, `unlinked`, `attached`, `decided`, `rolled` and `undo`.

**Snapshot.** Every change commits its task updates, activity, journal entry and next `seq` in one transaction. The snapshot it returns and broadcasts is read inside that transaction.

| Count | Definition |
|---|---|
| `triage` | Tasks in Triage |
| `columns` | Tasks per status, excluding Triage and Duplicate |
| `blocked` | Blocked tasks |
| A cycle's `total` | Its tasks that are not Cancelled |
| A cycle's `done` | Its Done tasks |

**Triage decisions.** The server locks the triage task, then:

1. If the task is not in Triage, refuses with 409 `already_decided`. Of two simultaneous decisions on one task, exactly one succeeds and the other gets this.
2. Validates the body.
3. Writes the outcome to the intake record.
4. Commits only after the intake confirms.

If the intake is unreachable, the request is refused with 503 `intake_unavailable`. If the intake answers with an error, or the record is no longer pending, it is refused with 502 `intake_rejected`. In both cases the task and counts stay exactly as they were.

| Decision | The task | The intake record |
|---|---|---|
| Accept | Moves to Backlog in the department given, joins the cycle the server holds as current, and takes the priority, owner and label given | `accepted`, with `task` set to this task |
| Decline | Moves to Cancelled with no cycle | `declined`, with `decision_note` set to the reason and `task` set to this task |
| Merge | Moves to Duplicate with `duplicate_of` set. The target must exist and be in Backlog, Todo, In progress or Done, otherwise 422. | `merged`, with `task` set to the target |

While a record is `pending`, its `task` field is empty. `GET /api/requests` reports an empty `task` as null. The Requests screen's Task cell shows the task id, or the pending copy from Feedback states when `task` is null.

For example, with the seed data at start, all in one snapshot each:
- Accepting STG-62 lowers `triage` by 1 and raises both `columns.backlog` and the current cycle's `total` by 1.
- Declining a triage task lowers `triage` by 1 and raises `columns.cancelled` by 1.
- Merging lowers `triage` by 1 and changes no other count.

**Creating tasks.**

- The number is one more than the highest number ever used.
- The cycle is the current cycle, unless a current or later `cycle` is given; an earlier cycle is refused with 422.
- `label` must belong to the department, otherwise 422.
- `title` must be 1 to 140 characters after trimming, and `details` at most 4,000 characters; outside those limits, 422.

**Idempotency.** `POST /api/tasks`, `/api/tasks/bulk`, `/api/undo`, `/api/triage/{id}/decision` and `/api/requests` accept an optional `Idempotency-Key` of 1 to 100 visible ASCII characters; anything else is refused with 422.

- The first response with a status below 500 is stored with the key, the method and path, and the parsed body.
- A repeat with the same key, path and body returns the stored status and body with the header `Idempotent-Replay: true`, and changes nothing.
- The same key with a different path or body is refused with 409 `idempotency_key_reused`.
- Responses of 500 and above are not stored, so a retry after an outage runs again.
- Keys are kept for the life of the database.

**Uploads.**

- The `file` part must be `application/pdf`, `image/png` or `image/jpeg`, checked against both the declared type and the file's opening bytes; otherwise 422.
- `kind` must be `sketch`, `plot` or `rendering`; otherwise 422.
- A file of exactly 10,000,000 bytes is allowed. Larger files are refused with 413 `payload_too_large`. A refused upload announces `<file name> was not attached.` and stores nothing.
- The newest attachment of each kind on a task has `current: true`, and older ones of that kind have `current: false`.
- An attachment row is written only after storage confirms the object (Services). An upload interrupted before the server has the whole file leaves neither a row nor a stored object.

**Downloads.** The signed link expires 60 seconds after it is issued.

**Cycles.** There are five cycles, in order:

| Key | Name |
|---|---|
| `rehearsal-1` | Rehearsal 1 |
| `rehearsal-2` | Rehearsal 2 |
| `rehearsal-3` | Rehearsal 3 |
| `tech` | Tech |
| `previews` | Previews |

- **Calendar mode (default).**
  - Rehearsal 1 starts at 00:00 on Monday in the theatre's time zone. That Monday is `PROMPTSIDE_FIRST_MONDAY` when set; otherwise it is the Monday of the week of the server's first start on an empty database, recorded then and never recalculated.
  - Each later cycle starts 7 days after the one before. Previews never ends.
- **Short mode.** When `PROMPTSIDE_CYCLE_SECONDS` is set to a whole number from 10 to 604,800 inclusive, Rehearsal 1 starts at the moment of the server's first start on an empty database, and each cycle lasts that many seconds. Previews still never ends. The runtime creates the empty database and bucket such a copy uses before the copy starts.
- **Current cycle.** The cycle whose span contains the server's present time. Before Rehearsal 1 starts, it is Rehearsal 1. Only the server decides which cycle is current.

**Rollover.** Within 5 seconds after a cycle ends, every task of that cycle in Backlog, Todo or In progress moves to the cycle that is now current.

- Each moved task gets one `rolled` activity entry with the actor null, and its version increases by 1.
- The whole rollover is one change of kind `rollover`, which is broadcast.
- If several boundaries passed while the server was stopped, each task moves straight to the current cycle with one entry, within 5 seconds of start.
- Several server processes may share one database. A rollover happens exactly once whichever process runs it, and so does an intake pull.

**Countdown.**

- `days_to_opening` is the number of calendar days from today's date in the theatre's time zone to opening night. It is negative after opening night.
- Opening night is `PROMPTSIDE_OPENING_NIGHT` when set; otherwise it is 38 days after Rehearsal 1's calendar Monday (the Thursday of the second Previews week).
- Short mode does not change opening night.
- The header refreshes the countdown on load and at least every 60 seconds.

### Services (DP-01, DP-02, DP-26, DP-28, DP-33, DP-34, DP-49, DP-58)

**Postgres** (`DATABASE_URL`) holds all Promptside state: tasks, links, cycles and their recorded start, activity, the undo journal, idempotency records, attachment rows and the change sequence.

- The server applies its schema idempotently every time it starts.
- It seeds the data below when the database has no tasks.
- Change events reach the tabs connected to every server process that shares the database.

**MinIO** (`S3_*`) stores attachment files in bucket `S3_BUCKET`.

- **Object key.** `tasks/<task id>/<attachment id>/<file name>`, where the attachment id is a UUID and every character of the file name other than letters, digits, `.`, `-` and `_` is replaced by `_`. The object keeps its content type.
- **Upload.** The server stores the whole object, then reads its metadata back to confirm that the size matches. Only then does it insert the attachment row. If the row cannot be written, the object is deleted.
- **Download.** The server first confirms that the object exists, then redirects to a signed GET link on `S3_ENDPOINT`.
- **When down.** Uploads and downloads answer 503 `storage_unavailable`, and the storage banner shows. Listing attachments and everything else still works.

**PocketBase** (`POCKETBASE_URL`, authenticating as the admin in `POCKETBASE_ADMIN_EMAIL` and `POCKETBASE_ADMIN_PASSWORD`) is the request intake.

- **Collection.** The server ensures a base collection `requests` exists every time it starts. Its fields:

  | Field | Type |
  |---|---|
  | `title` | Text, required |
  | `details` | Text |
  | `requester` | Text, required |
  | `department` | Text |
  | `status` | Select of `pending`, `accepted`, `declined`, `merged`; required |
  | `task` | Text |
  | `decision_note` | Text |
  | `decided_at` | Date |

  Its API rules are admin-only.
- **Seeding.** When the server creates the collection, it adds the three seeded requests.
- **Pull.** At least every 5 seconds, and at start when the intake is reachable, the server pulls every `pending` record that has no Promptside task yet. It creates one Triage task for each, in the records' creation order, with the title and details copied and `request` set to the record id. Each pull is broadcast as a `pull` change. The triage row shows the requester and suggested department from the request record, blank when the request names no department and blank while the intake cannot be read.
- **Filing.** `POST /api/requests` creates a `pending` record and returns only after PocketBase confirms it.
- **Decision write-back.** Sets `status`, `task`, `decision_note` and `decided_at` as stated in Business rules.
- **Requests screen.** `GET /api/requests` reads the records live from the intake.
- **When down.** Decisions, filing and the requests list answer 503 `intake_unavailable`, and the intake banner shows. Triage tasks already pulled stay visible.

**Outage detection and recovery.** The server checks MinIO and PocketBase at start and every 5 seconds afterwards. A failed call also marks that service down at once. `GET /api/status` and the `status` event report the result. The server starts and serves the tracker even when either service is down at boot. When a service comes back, pulls, uploads and decisions resume without a restart. The published outage checks run copies of the server whose service address points at a closed port from the start.

### Seed data (DP-01, DP-14, DP-18, DP-25, DP-32)

Every person, theatre, show and request here is invented. The theatre is `Kettleyard Playhouse`, the show is `The Lantern Keepers`, and the default time zone is `Europe/London`.

**Crew.**

| Handle | Name | Role | Department |
|---|---|---|---|
| maya | Maya Okonjo | Stage manager | None |
| devi | Devi Rangan | Production carpenter | carpentry |
| sasha | Sasha Bell | Scenic charge painter | paint |
| ines | Ines Hart | Lighting lead | lighting |
| kofi | Kofi Mensah | Sound lead | sound |
| ruth | Ruth Alder | Costume lead | wardrobe |
| oren | Oren Vale | Props lead | props |
| leon | Leon Park | Director | None |

**Departments and their labels** (key, then display name).

| Department | Labels |
|---|---|
| carpentry, Carpentry | None |
| paint, Paint | None |
| lighting, Lighting | focus Focus, programming Programming, electrics Electrics |
| sound, Sound | cues Cues, system System |
| wardrobe, Wardrobe | fitting Fitting, alteration Alteration, quick-change Quick-change |
| props, Props | None |

**Tasks.** Every task starts at version 1. Priorities are written as numbers. A dash means none. The cycles are R1 (Rehearsal 1) and R2 (Rehearsal 2).

| Id | Title | Dept | Label | Status | Pri | Owner | Cycle | Parent | Blocked by |
|---|---|---|---|---|---|---|---|---|---|
| STG-1 | Upstage door sticks on the swing | carpentry | – | todo | 2 | devi | R1 | – | – |
| STG-2 | Stair unit stage right creaks on the third tread | carpentry | – | todo | 3 | devi | R1 | – | – |
| STG-3 | Add a masking flat at the stage left sight line | carpentry | – | todo | 3 | devi | R1 | – | – |
| STG-4 | Trim the bottom rail of the stage right wing flat | carpentry | – | todo | 4 | devi | R1 | – | – |
| STG-5 | Rebuild the trap lid hinge | carpentry | – | in_progress | 2 | devi | R1 | – | – |
| STG-6 | Brace the balcony rail | carpentry | – | todo | 1 | devi | R1 | – | – |
| STG-7 | Add a kick plate to the porch door | carpentry | – | backlog | 4 | – | R1 | – | – |
| STG-8 | Fix the wobble in the kitchen table leg | carpentry | – | todo | 3 | devi | R1 | – | – |
| STG-9 | Shim the window unit level | carpentry | – | todo | 4 | devi | R1 | – | – |
| STG-10 | Upstage door unit | carpentry | – | in_progress | 2 | devi | R1 | – | – |
| STG-11 | Re-hang the upstage door on rising butts | carpentry | – | done | 2 | devi | R1 | STG-10 | – |
| STG-12 | Rebuild the upstage door flat | carpentry | – | in_progress | 1 | devi | R1 | STG-10 | – |
| STG-13 | Repaint the upstage door flat | paint | – | todo | 2 | sasha | R1 | – | STG-12 |
| STG-14 | Touch up the back wall scumble around the door unit | paint | – | todo | 3 | sasha | R1 | – | STG-10 |
| STG-15 | Glue down the lifting floor cloth seam | carpentry | – | todo | 3 | devi | R2 | – | – |
| STG-16 | Add a handrail to the offstage escape stair | carpentry | – | todo | 2 | devi | R2 | – | – |
| STG-17 | Replace the cracked bench seat | carpentry | – | backlog | 4 | – | R2 | – | – |
| STG-18 | Silence the casters on the bar wagon | carpentry | – | todo | 3 | devi | R2 | – | – |
| STG-19 | Re-cut the window shutter to clear the sill | carpentry | – | todo | 4 | devi | R2 | – | – |
| STG-20 | Fit a stop block to the revolve jack | carpentry | – | todo | 2 | devi | R2 | – | – |
| STG-21 | Focus: area 1 downstage left | lighting | focus | todo | 3 | ines | R1 | – | – |
| STG-22 | Focus: area 2 downstage centre | lighting | focus | todo | 3 | ines | R1 | – | – |
| STG-23 | Focus: area 3 downstage right | lighting | focus | todo | 3 | ines | R1 | – | – |
| STG-24 | Focus: area 4 upstage left | lighting | focus | todo | 3 | ines | R1 | – | – |
| STG-25 | Focus: area 5 upstage centre | lighting | focus | todo | 3 | ines | R1 | – | – |
| STG-26 | Focus: stage left boom after masking | lighting | focus | todo | 3 | ines | R1 | – | STG-3 |
| STG-27 | Focus: porch door special | lighting | focus | todo | 3 | ines | R1 | – | – |
| STG-28 | Focus: window gobo | lighting | focus | todo | 3 | ines | R1 | – | – |
| STG-29 | Focus: kitchen table pool | lighting | focus | todo | 3 | ines | R1 | – | – |
| STG-30 | Focus: stair special | lighting | focus | todo | 3 | ines | R1 | – | – |
| STG-31 | Focus: trap special | lighting | focus | todo | 3 | ines | R1 | – | – |
| STG-32 | Focus: curtain call wash | lighting | focus | todo | 3 | ines | R1 | – | – |
| STG-33 | Build the storm sequence cues 40 to 46 | lighting | programming | todo | 2 | ines | R1 | – | – |
| STG-34 | Slow the fade in cue 12 | lighting | programming | todo | 3 | ines | R1 | – | – |
| STG-35 | Add a preset for the preshow | lighting | programming | backlog | 4 | ines | R1 | – | – |
| STG-36 | Replace the flickering lamp on the second electric | lighting | electrics | in_progress | 2 | ines | R1 | – | – |
| STG-37 | Focus: upstage door special | lighting | focus | todo | 2 | ines | R1 | – | STG-13 |
| STG-38 | Doorbell cue fires late in scene 4 | sound | cues | todo | 2 | kofi | R1 | – | – |
| STG-39 | Thunder cue too loud in the stalls | sound | cues | todo | 3 | kofi | R1 | – | – |
| STG-40 | Hum on the stage left foldback speaker | sound | system | in_progress | 1 | kofi | R1 | – | – |
| STG-41 | Build a platform for the quick-change booth | carpentry | – | todo | 2 | devi | R2 | – | STG-53 |
| STG-42 | Source a period telephone | props | – | in_progress | 3 | oren | R1 | – | – |
| STG-43 | Breakaway plate for the dinner scene | props | – | todo | 2 | oren | R1 | – | – |
| STG-44 | Add felt pads to the teacups | props | – | todo | 4 | oren | R1 | – | – |
| STG-45 | Preset the lantern on the porch table | props | – | backlog | 4 | – | R1 | – | – |
| STG-46 | Focus: balcony specials | lighting | focus | todo | 3 | ines | R1 | – | STG-6 |
| STG-47 | Re-rig the mic pack in the Act 1 coat lining | sound | system | todo | 3 | kofi | R1 | – | STG-48 |
| STG-48 | Costume: Act 1 coat for Ada | wardrobe | – | in_progress | 2 | ruth | R1 | – | – |
| STG-49 | First fitting for the Act 1 coat | wardrobe | fitting | done | 3 | ruth | R1 | STG-48 | – |
| STG-50 | Take in the Act 1 coat at the side seams | wardrobe | alteration | done | 3 | ruth | R1 | STG-48 | – |
| STG-51 | Swap the coat hooks for a zip for the quick-change | wardrobe | quick-change | in_progress | 2 | ruth | R1 | STG-48 | – |
| STG-52 | Costume: Act 2 waistcoat for Jonah | wardrobe | – | todo | 3 | ruth | R1 | – | – |
| STG-53 | Confirm the quick-change booth size | wardrobe | quick-change | todo | 2 | ruth | R1 | – | – |
| STG-54 | First fitting for the Act 2 waistcoat | wardrobe | fitting | todo | 3 | ruth | R1 | STG-52 | – |
| STG-55 | Let out the Act 2 waistcoat at the back seam | wardrobe | alteration | todo | 4 | ruth | R1 | STG-52 | – |
| STG-56 | Refresh the faded spike marks at the kitchen table | props | – | backlog | 3 | – | R1 | – | – |
| STG-57 | Re-glue the loose banister cap | carpentry | – | backlog | 4 | – | R2 | – | – |
| STG-58 | Fog machine for the storm scene | lighting | – | cancelled | 0 | – | R1 | – | – |
| STG-59 | Replace the worn rug edge tape | props | – | backlog | 4 | – | R1 | – | – |
| STG-60 | Set a battery change schedule for the radio mics | sound | system | backlog | 4 | – | R1 | – | – |

**Requests.** The intake is seeded in this order, all `pending`:

| # | Title | Details | Requester | Department |
|---|---|---|---|---|
| 1 | `The upstage door still sticks when it swings shut` | `Caught it twice on the Act 1 entrance.` | Leon Park | carpentry |
| 2 | `Bring the thunder in after the line about barring the door` | `It currently lands before the line.` | Leon Park | sound |
| 3 | `Lose the rocking chair in Act 2, it slows the scene change` | Empty | Hana Ito | props |

On a freshly seeded database these three are pulled as STG-61, STG-62 and STG-63.

For example, with the seed data at start and after the pull:

| Count | Value |
|---|---|
| Triage | 3 |
| Backlog | 8 |
| Todo | 40 |
| In progress | 8 |
| Done | 3 |
| Cancelled | 1 |
| Blocked | 7 (STG-13, 14, 26, 37, 41, 46 and 47) |
| Rehearsal 1 | 3 done of 51 |
| Rehearsal 2 | 0 done of 8 |
| Open tasks per department | Carpentry 19, Paint 2, Lighting 18, Sound 5, Wardrobe 6, Props 6 |

## Technical requirements

### Deployment (DP-52)

The runtime is Node.js 22 LTS with npm, and the app is written in TypeScript. `/app/run.json` holds the string commands `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

`serve` starts one process that binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set. That process serves the built client and the API on that one port. `GET /api/health` answers as stated in API. The schema, the PocketBase collection and the seed are applied idempotently on every serve, not only at build.

### Configuration and secrets (DP-53)

The server reads the following at start:

| Purpose | Variables |
|---|---|
| Postgres | `DATABASE_URL` |
| MinIO | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| PocketBase | `POCKETBASE_URL`, `POCKETBASE_ADMIN_EMAIL`, `POCKETBASE_ADMIN_PASSWORD` |
| Port | `APP_PUBLIC_PORT` |
| Theatre time zone | `THEATRE_TZ`, an IANA zone name, default `Europe/London` |
| Rehearsal 1 Monday | `PROMPTSIDE_FIRST_MONDAY`, as `YYYY-MM-DD` |
| Opening night | `PROMPTSIDE_OPENING_NIGHT`, as `YYYY-MM-DD` |
| Short mode | `PROMPTSIDE_CYCLE_SECONDS` |

No credential or service address is hard-coded. None appears in any HTML, script, style, source map or API response sent to the browser, with one exception: the host of a signed download link.

### Server boundary (DP-49, DP-51)

- The app serves one origin. No response carries cross-origin permission headers.
- A write whose `Origin` header is present and differs from the app's own origin is refused with 403 `cross_origin`.
- A JSON body over 65,536 bytes is refused with 413 `payload_too_large`; exactly 65,536 bytes is allowed. A multipart request over 10,100,000 bytes, or a file part over the upload limit in Business rules, gets the same 413.
- A write without the required content type is refused with 415 `unsupported_media_type`, and invalid JSON with 400 `malformed_json`.
- The server serves only the built client assets, the three screen paths, and `/api`.
  - Requests for source files, source maps, `.env` files, `run.json`, package manifests or lockfiles get the 404 page.
  - Unknown `/api` paths get a 404 JSON error.
  - Other unknown paths get the not-found page with status 404.
- **At boot.** The server keeps retrying Postgres and answers health with 503 until its schema is ready. It starts normally with MinIO or PocketBase unreachable, and recovers from them as stated in Services.

### Browser support and performance (DP-21, DP-40, DP-41)

- **Browsers.** Current Chromium, Firefox and WebKit.
- **Viewports.** 375×812, 768×1024 and 1280×800, with mouse and touch.
- **Load time.** The tasks screen with the seed data is usable within three seconds of navigation.
- **Keyboard.** Moving the current row by key shows within a tenth of a second.
- **Live updates.** A committed change appears in other open tabs within 2 seconds.
- **Scale.** The list stays usable with 500 tasks.

## Working rules

- IF-01: `/app/run.json` exists with `"_schema":"run-manifest-v1"` and string `install`, `build` and `serve` commands, and the app is started only through it.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists the name, version and licence of every shipped package and every bundled font. "Shipped packages" means the production dependency tree from `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package and font is licensed under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or SIL OFL-1.1.
- IF-04: The only datastores are the provided Postgres, MinIO and PocketBase. There is no SQLite, Redis, file-based store or in-memory store of record.
- IF-05: The provided service configuration for Postgres, MinIO and PocketBase is left unchanged.
- IF-06: Application source, both server and browser, is written in TypeScript.
- IF-07: The running app makes no requests to third-party origins. Fonts, scripts and styles are served by the app itself.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript, with no `any` used to silence the type checker.
- Names follow this brief's domain terms: task, triage, blocker, cascade, freed, cycle, rollover, intake, attachment, plot, crew member, snapshot.
- Each domain rule is decided in exactly one place in the source: the status edges, the blocked overlay, the cascade order, the sub-task roll-up, the undo restore, the current cycle, and the snapshot counts.
- Every API error is built through one error shape, with the single precedence order applied consistently.
- No abstraction has only one implementation, and there are no wrappers that only forward calls.
- There is no dead, commented-out or unreachable code, and no defensive checks for states the rules make impossible.
- There are no features, endpoints, screens or settings beyond this brief.
