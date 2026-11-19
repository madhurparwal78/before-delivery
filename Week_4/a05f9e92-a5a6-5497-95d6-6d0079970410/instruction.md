# Ferrocline Works Switchyard

Switchyard is a service desk for a one-person IT provider who runs all of one organisation's internal IT. The provider uses it to run a request catalog, incidents and problems, response promises timed in the organisation's own business hours, a service map that shows who an outage takes down, change approval with board votes, on-call escalation and a visual workflow designer. It also promotes configuration from a test workspace to the live one. Requesters, a backup technician, department approvers and department managers use the same app in their own browsers. Records and configuration live in Postgres, and every file lives in MinIO. One server process serves the interface, the JSON API and one live channel. Accounts are local, with a username and password only.

The following are out of scope: AI features, virtual agents, predictive routing, network discovery, HR, customer service and security modules, inbound and outbound email, chat and phone integrations, separation between organisations, paid plans, sound, and external assets or fonts. Notifications use the in-app inbox only. There is no scripting anywhere: rules, policies and workflows use published forms plus one small published expression language. No user-written code is ever run. Switchyard reads and writes only its own published import and configuration set formats. You may add no datastore beyond Postgres and MinIO.

## Problem and users

Thousands of mid-size organisations hand their whole internal IT to one independent provider: a 120-person architecture practice, a regional clinic group, a nonprofit with four offices. That one person has to run a catalog, keep response promises measured in the organisation's business hours, know which staff an outage takes down, keep changes out of the payroll freeze, and make sure the backup contractor answers at 2am. Platforms that do this properly charge per agent, need a consultant to configure and hide their rules in admin screens. So the provider falls back on a shared inbox, a spreadsheet of promises and a phone alarm. Clocks that should pause while the desk waits on a requester keep running. Changes go in during a freeze. Pages go unanswered. The provider pays in lost contracts and service credits, and the staff pay in downtime nobody saw coming.

Users:

- **Operator** (role `operator`, daily). Runs the desk from one place. Builds the catalog. Publishes workflows, business rules, access rules, form policies and SLA schedules. Works tickets, declares major incidents and chairs change votes. Promotes configuration from the test workspace to the live one.
- **Requester** (role `requester`, weekly). Asks for something from the catalog or reports a fault. Looks for a knowledge answer first, and sees honestly when the request will be handled.
- **Backup technician** (role `technician`, weekly). Takes the on-call shifts the operator hands off and acknowledges pages from a phone. Works assigned incidents without seeing fields the access rules deny.
- **Department approver** (role `approver`, weekly). Votes on changes that touch their department from a phone before the vote closes. Approves catalog requests that need sign-off.
- **Department manager** (role `manager`, occasional). Sees their department's service map, open major incidents, SLA standing and dashboards, and nothing the access rules deny.

### Glossary

- **Incident**: a report that something is broken or degraded for someone.
- **Problem**: the underlying cause behind one or more incidents, investigated separately from fixing each incident.
- **Known error**: a problem whose cause or workaround is written down, though not yet fixed for good.
- **Workaround**: steps that get people working again before the real fix.
- **Change**: a planned modification to a configuration item, which needs assessment and approval before it is made.
- **Request**: one checkout from the catalog. It holds one or more request items.
- **Request item**: one ordered catalog item inside a request, fulfilled by its workflow.
- **Task**: a unit of work given to a person or group, for example "Prepare laptop".
- **SLA**: a response promise. It is a target duration, counted in business time on a schedule, that pauses in published states.
- **Business schedule**: weekly opening hours, holiday dates and an IANA time zone.
- **Configuration item (item)**: anything the desk looks after, such as a service, application, server, cluster, network device or storage.
- **Service map**: the items and the typed relationships between them.
- **Outage**: an item marked down or degraded.
- **Major incident**: one parent incident that coordinates every incident caused by the same outage.
- **Change board**: a named group of approvers who vote on changes.
- **Quorum**: the rule that decides when a vote passes or fails.
- **Delegate**: an approver allowed to vote on another member's behalf for a period.
- **Freeze window**: a period when changes on some or all items may not be scheduled.
- **Maintenance window**: a period when an item is expected to be offline, so its outage does not spread.
- **On-call rotation**: who answers pages in each weekly shift.
- **Escalation ladder**: the ordered levels a page climbs while nobody acknowledges it.
- **Workspace**: either `live` (the real desk) or `test` (configuration being prepared).
- **Configuration set**: a named, captured bundle of configuration changes that is promoted from test to live.

## Journeys

1. **Keyboard incident.** Start: the operator is on the "Open incidents" queue. Using only the keyboard, they open a new fault and fill in impact and urgency, and see the priority the matrix gives, bumped for a business-critical service. They try to resolve the incident without a resolution code and get the published error, then resolve it properly. The requester's portal page shows each state change and announces it without a reload. End: the incident shows Resolved on both screens.
2. **SLA through a week.** Start: a requester's incident is running its resolution SLA on office hours. The technician puts it on hold, then changes its priority, then resumes it. The server clock moves past 75 percent and the department manager gets an inbox item. The SLA breaches. The incident is resolved, then reopened across a holiday. End: the agent's and the requester's countdowns show the same remaining time, and both show the breach.
3. **Two people, one incident.** Start: the operator and the backup technician have the same incident open, and each sees the other as viewing. They save different fields, and both saves succeed. They then save the same field: the second save gets the conflict dialog showing both values, and it is settled by keyboard. Work notes from both appear live. End: the audit trail shows every before and after value.
4. **The 2am page.** Start: a priority 1 incident is created outside business hours. Assignment rules route it, skipping a member who is out of office. A page goes to the week's on-call technician. The server clock passes the acknowledge timer and the page climbs to the operator. The technician acknowledges late from a phone with a long press. End: the operator's desk shows the late-acknowledge line live, and inbox counts update.
5. **Outage to major incident.** Start: the operator marks the main storage array down on the service map. Impact spreads up to the services, stops at a degraded cluster and is held back by a maintenance window. A major incident is proposed and promoted. The operator and the department manager scroll the outage relay and watch the affected-people counter rise to the server's total. They resolve every child together, and one child is reopened alone. End: the child list shows each child's state.
6. **A change and its vote.** Start: the operator drafts a normal change. The risk score is computed and routes the change to department sign-off, then the board. A freeze window and an overlapping change on a dependent item are refused with their messages. Approvers vote from two devices, and one votes as a delegate. One approver swipes to approve on a phone, uses Undo, then swipes again. Editing a locked field resets the approval. End: the tally and the inbox show the result.
7. **New starter.** Start: a requester opens the "New starter" order guide and answers its question. Dependent choices and form policies shape each item. The requester checks out the cart, and the department approver signs off the studio laptop. The tasks are worked. End: the portal tracks each item to Delivered live.
8. **Configuration promotion.** Start: the operator works in the test workspace. They build a flow in the designer by keyboard, write a business rule and an access rule, and capture them all in a configuration set. They export the set to storage, preview it against live, choose per item where collisions occur, commit, and back out. End: live is exactly as it was before the commit.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health** /app/run.json declares install, build and serve; the server listens on port 4173 or APP_PUBLIC_PORT; and GET /api/health answers as published in Server boundary.
- **DP-02 — Local accounts and roles** People sign in with a seeded username and password, land on the home screen of their first role in the published precedence, and reach only the screens and actions that the published role-to-screen and baseline access tables grant any of their roles, with a forbidden screen showing the published outcome.
- **DP-03 — One error order and shape** Every API error uses the one published error body and the published check order, and idempotent replays are answered before any state check.
- **DP-04 — Grading route and server clock** The key-guarded grading route creates any published fixture, saves as any user with a chosen version, changes runtime limits, redirects storage, and sets or advances the server clock, running all due background work before it answers.
- **DP-05 — Expression language** Every condition in rules, policies, SLA definitions, assignment, workflows and filters is written in the published expression language, and a malformed expression is refused with the published column error.
- **DP-06 — Published breakpoints** The ticket workspace and the requester portal show three panes at 1280x800, two at 768x1024 and one at 375x812, switching exactly at 1024 and 768 pixels wide, with no horizontal page overflow.
- **DP-07 — Published empty and not-found states** Empty queues, empty filter results, knowledge searches with no results, an empty inbox, no waiting votes and unknown pages each show their published single line and one button, character for character.
- **DP-08 — Server boundary and limits** The server serves only its own origin, refuses oversize bodies and cross-origin writes with the published bodies, never serves source or credentials, and enforces the published rate limits.
- **DP-09 — Hero poster** The landing screen is the published pinned-title poster: the giant product name on the orange field over six procedural service portraits, with the wordmark, Menu, sentence and button in their corners.
- **DP-10 — Pinned subject screens** Every working screen pins its subject's name in the display face on the orange field above white working sections, with square corners, status shown as words plus solid ink blocks, tabular figures and comfortable tap targets.
- **DP-11 — Source integrity** Credentials and URLs are read from the environment, conditions are interpreted from the published language without evaluating code, and each derived value is computed once on the server.
- **DP-12 — Record lifecycles and numbering** Incidents, problems, changes, request items and tasks move only along their published transition tables, illegal moves answer 422 with the published message, and numbers use the published prefixes with no gaps from rejected saves.
- **DP-13 — Priority matrix and override** Priority follows the published impact and urgency table with the business-critical bump, and only the operator may override it with a reason, which shows the published badge and writes an audit entry.
- **DP-14 — Knowledge search and suggestions** Knowledge search, and the suggestions shown while someone types a short description, rank published, in-audience, unexpired articles by the published formula.
- **DP-15 — Keyboard incident journey** From the incident grid, the operator opens, edits and moves an incident through its states using only the keyboard, while the requester's portal page updates and announces each change without a reload.
- **DP-16 — Business time across daylight saving** Elapsed business time counts only the open hours of the schedule's local days, skips holidays, and stays exact across the 29 March 2026 and 25 October 2026 clock changes in Europe/Berlin.
- **DP-17 — SLA pause, priority swap and reopen** The pause state stops the clock, a priority change swaps the SLA and recalculates it from the original start, and a reopen resumes from the elapsed time at resolve, all by the published rules.
- **DP-18 — SLA thresholds on the server clock** Crossing 50, 75 and 100 percent of a target fires the published inbox actions and the breach flag once each, whether time passes in real time or because the server clock was advanced.
- **DP-19 — Countdown from server time** Every SLA countdown in the browser comes from the last server message plus the browser clock's elapsed delta, so a wrong device clock never changes what is shown, and only the server declares pause, resume or breach.
- **DP-20 — SLA journey** An agent and a requester watch one incident's SLA through hold, priority change, escalation, breach, resolve and reopen across a holiday, and both countdowns agree throughout.
- **DP-21 — Per-field versions and presence** Saves carry each field's last-seen version: saves to different fields merge, a stale save to a changed field answers 409 with both values, work notes always append, presence lists who is viewing, and every change is audited with before and after values.
- **DP-22 — Business rules** Business rules run in the published timing and order, detect field changes, abort saves with their own message without using up a number, and stop at the published nesting limit.
- **DP-23 — Shared incident journey** Two people on one incident see each other present, save different fields, settle a same-field conflict in the published dialog by keyboard, and watch notes and activity arrive live.
- **DP-24 — Assignment rules and round robin** A new record goes to the group of the first matching assignment rule and then, by round robin, to the next member who is under capacity and not out of office, or to Triage with the published activity line.
- **DP-25 — Rotations across daylight saving** Weekly rotations hand over at 09:00 in the schedule's zone across daylight saving changes, and one-off overrides take precedence by the published rule.
- **DP-26 — Escalation ladder and late acknowledge** An unacknowledged page climbs the ladder when the server clock passes each level's acknowledge timer, an acknowledge stops it, and a late acknowledge is recorded with the published text.
- **DP-27 — Closed drawers and sheets are inert** At 375x812 and 768x1024, a closed navigation drawer, filter sheet or action sheet is invisible, cannot take focus and is absent from the accessibility tree until it is opened again.
- **DP-28 — On-call journey** A record is assigned automatically, a page escalates on the server clock, the backup technician acknowledges from a phone by long press or swipe, and the operator's desk and inbox update live.
- **DP-29 — Classes and loop-free relationships** Configuration items inherit attributes by the published class tree, relationships use the closed type list, and a relationship that would form a dependency loop is refused with the published chain message.
- **DP-30 — Layered map and node keyboard** The service map places each item at its published layered coordinates and gives each node its published accessible name; arrow keys move focus between nodes by the published rule, and Enter expands a node with the published animation.
- **DP-31 — Impact spread** Marking an item down or degraded spreads along dependency relationships; a cluster stays degraded while its required healthy members remain, a maintenance window stops the spread, and each affected person counts once.
- **DP-32 — Service map journey** By keyboard, the operator adds items and relationships, meets the loop refusal, marks an outage, and watches it stop at a degraded cluster and behind a maintenance window, with node labels and animations as published.
- **DP-33 — Major incident proposal** An outage that reaches the published threshold proposes a major incident that only the operator can promote or reject, and promotion links the open incidents on affected items as children.
- **DP-34 — Resolve together** Resolving a major incident resolves every open child in one transaction with the parent's code and note, or changes none of them, and a child can be reopened alone.
- **DP-35 — Outage relay** The relay pins the failed item's name and scrolls one panel per affected item in the server's order, with a people counter that rises and falls with scroll; under reduced motion it becomes a static list with the total announced once.
- **DP-36 — Outage relay look** Relay panels are full-height poster panels, each with its item's procedural portrait, its relationship path and a flat ground in its tier colour, under the pinned failed-item name.
- **DP-37 — Problems and workarounds** Problems link incidents, a published workaround appears live on every linked open incident, and a problem resolves and closes by the published closure rule.
- **DP-38 — Major incident journey** An outage proposes a major incident that is promoted and gets its children; two people follow the shared timeline live, resolve together, reopen one child alone, and see a workaround arrive on the open children.
- **DP-39 — Change models and risk score** Normal, standard and emergency changes follow their own transition tables, and the risk score and band follow the published formula and route each change to its approval steps.
- **DP-40 — Freeze and overlap refusal** A change inside a freeze window, or overlapping another change on the same item or on an item linked to it by dependency, is refused with the published message.
- **DP-41 — Locked fields reset approval** Editing a locked field after approval has started returns the change to Assessed, voids every vote, writes the published activity line, and removes the vote from approvers' open screens live.
- **DP-42 — Change calendar keyboard** The change calendar moves by day with the arrow keys and by month with PageUp and PageDown, opens a day with Enter, and returns focus to that day on Escape.
- **DP-43 — Change journey** The operator drafts a normal change, sees its risk score, meets the freeze and dependency overlap refusals, gets it approved, resets approval by editing a locked field while the approver watches, and navigates the calendar by keyboard.
- **DP-44 — Quorum, delegates and late votes** Each approval step closes by its published quorum rule or its window, a delegate's vote counts once for the member, a rejection resets later steps, and a late or repeated vote is refused.
- **DP-45 — Operator-only actions** Publishing workflows, committing or backing out configuration sets, closing a vote early and every other operator-only endpoint refuse all other roles with the published 403 body.
- **DP-46 — Phone voting gestures** On a 375-pixel-wide phone, an approver approves by swiping right or rejects by swiping left past the published distance, with an Undo period, or opens the vote action sheet with a long press.
- **DP-47 — Inbox rules and digest** Inbox items follow the published event rules and each person's digest setting, and the unread count updates live.
- **DP-48 — Board journey** A live agenda, weighted and N of M votes from two people with a live tally, a delegate's vote, a rejection that resets later steps, a phone swipe with Undo, and the result delivered to the inbox.
- **DP-49 — Catalog variables and order guides** Catalog items offer typed variables with dependent choices, and order guides add the published items for the answers given.
- **DP-50 — Form policies on both sides** Form policies make fields mandatory, visible or read-only in the browser as values change, and the server enforces the same policies with the published field errors.
- **DP-51 — Cart checkout** Checking out the cart creates one request, one request item per line and the tasks from each item's workflow, and a replay with the same idempotency key returns the stored response.
- **DP-52 — Catalog journey** A requester orders through the order guide and the cart with dependent choices and policies, the approver signs off, and the portal tracks each item and task live to Delivered.
- **DP-53 — Designer by keyboard** The workflow designer adds, moves, reorders and deletes steps, branches and loops using only the keyboard, with the published focus rules and step-move animation.
- **DP-54 — Versions, runs and flow limits** Publishing creates a numbered version while runs stay on the version they started on; self-calling subflows and runaway loops stop with the published messages, and failed steps can be retried or handled.
- **DP-55 — Designer journey** The operator builds a flow by keyboard with a branch and a loop, meets the loop-limit and subflow-chain errors, publishes version 2 while a run stays on version 1, and retries a failed step while a second person watches the run live.
- **DP-56 — Access rule evaluation** Table, row and field rules apply in the published order: a hidden record answers 404, and a denied field write on a visible record answers 403.
- **DP-57 — Denied fields leave no trace** A denied field or row is absent from lists, forms, search, activity, reports, dashboards, exports and group counts, and filtering or grouping on a denied field is refused as an unknown field.
- **DP-58 — Impersonation and live role change** Operator impersonation shows the published banner and writes an audit entry, and a role or rule change reaches the affected person's open pages without a reload.
- **DP-59 — Access journey** A field rule and a row rule take effect for a department manager on every surface, impersonation shows what the manager sees, and a role change reaches the manager's open page live.
- **DP-60 — Condition builder and filter text** The condition builder edits grouped AND and OR conditions with reference paths by keyboard, and round-trips exactly with the published filter text.
- **DP-61 — Group counts, paging, notices and bulk update** Lists group with counts, page with the published tie-break, announce new matching records instead of inserting them, and report bulk updates row by row.
- **DP-62 — Dashboards** Dashboard widgets compute the published aggregates on the server in the viewer's time zone, update live, offer a data table alternative and drill down to the filtered list.
- **DP-63 — Lists journey** The operator builds a nested filter by keyboard, round-trips its text, groups, bulk-updates with a partial failure, sees the new-records notice when someone else creates a record, and drills down from a live widget in another time zone.
- **DP-64 — Import format and re-runs** Imports in the published format preview each row's action and errors with line numbers, update by match key instead of duplicating, and change nothing when run again.
- **DP-65 — Configuration sets** Test workspace changes are captured in a named set, exported to storage, previewed against live with collisions, committed with per-item choices and backed out exactly.
- **DP-66 — Storage-confirmed files and exports** Attachments, import files, export files and configuration set files count as stored only after storage accepts the object under its published key, and only then does an export show complete.
- **DP-67 — Storage outage and recovery** While storage is unreachable, record work continues, the published banners and 503 body appear and uploads queue; when storage returns, queued uploads finish, failed exports retry and the banner clears without a restart.
- **DP-68 — Import and promotion journey** The operator imports a file with line errors, re-runs it with no changes, promotes and backs out a configuration set, and runs an export through a storage outage while record work continues.

## Frontend

### Screens and layout (DP-06, DP-07, DP-09, DP-10, DP-27, DP-35)

Each screen below is described at the three published viewports: phone 375x812, tablet 768x1024 and desktop 1280x800. No viewport ever scrolls horizontally at page level. Wide content, such as the service map canvas or a long table, scrolls inside its own region. There are exactly two layout boundaries. Widths of 1024 pixels and above use the desktop layout. Widths from 768 to 1023 pixels use the tablet layout. Widths below 768 pixels use the phone layout. No other boundary changes which layout one of the published viewports gets.

Every working screen has a pinned subject: one name in the display face on the orange field at the top. Below it, at a hard horizontal edge, the white working sections begin. Subjects are listed per screen below.

- **Landing** (`/`). The hero poster from Visual design. Phone: the wordmark and Menu share the top row. The name spans the full width. The portraits sit in a two-column grid of three rows, then the sentence, then the button, all stacked. Tablet: the portraits sit in three columns of two rows. Desktop: the six portraits sit in one row under the name, with the sentence bottom-left and the button bottom-right.
- **Sign in** (`/login`). Subject `Sign in`. One white section, at most 64 characters wide, holding the username, the password and the Sign in button.
- **Ticket workspace** (`/desk`, `/desk/lists/<table>`, `/desk/records/<number>`, `/desk/records/new/<table>`). Subject: the current queue's name, or the record number when a record is open on a phone (`New <Type>` for a record not yet saved).
  - Desktop: three panes side by side. The queues navigation takes about a fifth of the width on the left. The list (grid) is in the middle. The open record form takes about two fifths on the right.
  - Tablet: two panes, the list and the record form. The queues navigation moves into the navigation drawer opened by Menu.
  - Phone: one pane. List rows become stacked cards. Opening a card shows the record full screen with a back button. The filter opens as a bottom sheet, and the navigation is in the drawer.
  - Order on the phone: subject, then the Filter button, then the cards.
- **Record form** (inside the workspace). Shows the record's number as a heading, then its fields, the SLA region, transition buttons, the "Also viewing" list, the activity stream with work notes and comments, attachments, and links (parent, children, problem, workaround).
- **Service map** (`/desk/map`). Subject `Service map`. One canvas region with nodes and connecting lines, plus a details panel for the expanded node. Desktop and tablet: the details panel sits to the right of the canvas. Phone: the canvas fills the width and scrolls inside itself, and the details panel opens below it.
- **Major incident and outage relay** (`/desk/major/<number>`). Subject: the failed item's name. The relay panels come first, then the hard edge, then a white section with the child incident list, the Resolve together button and the timeline. Desktop: the child list and the timeline sit side by side. Tablet and phone: they stack, child list first.
- **Change** (`/desk/records/<change number>`). Subject: the change title. White sections for the fields, Risk, Approvals with Tally, and activity.
- **Change calendar** (`/desk/changes/calendar`). Subject: the month name and year. A seven-column month grid on every viewport. On the phone, each cell shows only the date and the change count.
- **Board agenda** (`/desk/boards/<board id>`). Subject: the board name. An ordered list of the changes waiting for this board's vote, each with its live tally.
- **Approvals** (`/approve`). Subject `Your votes`. Pending vote cards, one per approval waiting on the signed-in approver. Phone: a single stack of cards with the top card in front. Tablet and desktop: cards in a column at most 64 characters wide, each with Approve and Reject buttons.
- **On-call** (`/desk/oncall`) and **Pages** (`/pages`). Subject `On call`. The current on-call person, the shifts for the next eight weeks, overrides, and open pages as cards. Phone: page cards stack.
- **Requester portal** (`/portal`). Subject `Ask the desk`. Three regions: Search knowledge, Catalog and My requests. Desktop: three columns side by side in that order. Tablet: Search knowledge spans the full width above two columns, Catalog on the left and My requests on the right. Phone: one column in the order Search knowledge, Catalog, My requests.
- **Catalog item** (`/portal/items/<item id>`), **Order guide** (`/portal/guides/<guide id>`), **Cart** (`/portal/cart`), **Request** (`/portal/requests/<request number>`), **Report a fault** (`/portal/fault`), **Article** (`/portal/knowledge/<article number>`), **Incident** (`/portal/incidents/<incident number>`). Subject: the item, guide, request number, article title or incident number. Forms and articles sit in one white column at most 64 characters wide on every viewport.
- **Workflow designer** (`/desk/workflows/<flow id>`). Subject: the flow name. A vertical step tree drawn with connecting lines. Branch lanes sit side by side on desktop and tablet and stack on the phone. Desktop: a step detail panel on the right.
- **Run view** (`/desk/runs/<run id>`). Subject: the flow name and version. The list of steps with their statuses.
- **Rules and settings** (`/desk/admin/<kind>`). Subject: the kind's plural name, for example `Business rules`. One list and one form per kind.
- **Dashboards** (`/desk/dashboards/<dashboard id>` for the operator, `/dashboards/<dashboard id>` for managers). Subject: the dashboard name. Widgets in a grid: three columns on desktop, two on tablet, one on the phone.
- **Configuration sets** (`/desk/config-sets`), **Imports** (`/desk/imports`), **Exports** (`/desk/exports`). Subject: the screen name. A table and an action column.
- **Inbox** (`/inbox`). Subject `Inbox`. The list of items, newest first.
- **Not found**: any unknown page. The published not-found state from Feedback states.

Empty, loading and error states each replace the white section with a single pinned line in the display face over the orange field, plus one solid button. Their copy is in Feedback states.

**Who may open which screen.** A person may open every screen that any one of their roles may open, so their allowed screens are the union of their roles' rows in the table below. A person's home screen is the home screen of their first role in this precedence: operator, technician, approver, manager, requester. Home screens are `/desk` for operator and technician, `/approve` for approver, and `/portal` for manager and requester. For example, with the seed data at start, `ana`, `dev` and `jonas` (approver and requester) go to `/approve`, and `mae` and `hugo` (manager and requester) go to `/portal`. Sign-in, `link "Open your desk"` and `button "Impersonate <display name>"` all go to this home screen.

| Screens | Roles that may open them |
|---|---|
| `/`, `/login`, not found (any unknown path) | anyone, signed in or not (a signed-in person opening `/login` goes to their home screen) |
| `/portal` and every page under it, `/inbox` | all five roles |
| `/desk`, `/desk/lists/<table>`, `/desk/records/<number>` | operator, technician, approver, manager (each sees only the records and fields their baseline grants; a record they may not see shows the not-found state) |
| `/desk/map`, `/desk/major/<number>` | operator, technician, manager |
| `/desk/changes/calendar`, `/desk/boards/<board id>` | operator, technician, approver |
| `/approve` | operator, approver |
| `/desk/oncall`, `/pages`, `/desk/runs/<run id>`, `/desk/dashboards/<dashboard id>` | operator, technician |
| `/desk/exports` | operator, technician, manager |
| `/dashboards/<dashboard id>` | operator, manager |
| `/desk/workflows/<flow id>`, `/desk/admin/<kind>`, `/desk/config-sets`, `/desk/imports` | operator |
| `/desk/records/new/incident`, `/desk/records/new/problem`, `/desk/records/new/task` | operator, technician |
| `/desk/records/new/change` | operator |

A signed-in person none of whose roles is listed for a screen gets the not-found state from Feedback states with HTTP 404 (the same answer as an unknown page). An unknown path answers the not-found state with HTTP 404 whether or not the visitor is signed in. The redirect applies only to the known screens in the table: a visitor who is not signed in and opens any known screen other than `/` and `/login` is redirected with HTTP 302 to `/login`. The navigation drawer links only to screens the signed-in person may open.

### Public screens and controls (DP-02, DP-07, DP-15, DP-27, DP-30, DP-42, DP-46, DP-53, DP-60)

Only these roles and accessible names are public. Placeholders in angle brackets are filled per record. `<display name>` is a user's display name from Seed data, or from the fixture that created the user.

| Where | Role and accessible name | Visible copy, contents |
|---|---|---|
| Every page | `status` named `Announcements` (polite) | The one live region. Its texts are in Feedback states. |
| Every page | `banner` containing `link "Ferrocline"` and `button "Menu"` | Wordmark top-left, Menu top-right |
| Every page (signed in) | `link "Inbox, <n> unread"` | `<n>` is the live unread count |
| Below 1024 px, and the hero | `dialog "Navigation"` | The drawer, opened by Menu, with links to every screen the signed-in person may open |
| Operator | `combobox "Workspace"` | Options `Live workspace`, `Test workspace` |
| Operator in test workspace | text block | `Test workspace` in a solid ink block under the banner |
| When storage is down | `region "Storage status"` | The storage banner from Feedback states |
| While impersonating | `region "Impersonation"` with `button "Stop impersonating"` | Impersonation banner from Feedback states |
| Landing | `heading "SWITCHYARD"` (level 1) | The wordmark poster |
| Landing | six `img`: `Mail portrait`, `Project files portrait`, `Payroll portrait`, `Remote access portrait`, `Printing portrait`, `Sign-in portrait` | Procedural portraits |
| Landing | text | `One person, one organisation, every promise kept on its own clock.` |
| Landing | `link "Open your desk"` | Solid blue-black block with orange text. Goes to the signed-in person's home screen (see Screens and layout), otherwise to `/login` |
| Sign in | `textbox "Username"`, password field labelled `Password`, `button "Sign in"` | |
| Workspace | `navigation "Queues"` with one `link` per saved queue, named with the queue name | |
| Workspace, 768 px and above | `grid` named with the queue name | Columns: Number, Short description, Priority, State, Assigned to, SLA |
| Workspace grid rows | `row` with accessible name `<Type> <number>, priority <n>, <state label>, assigned to <display name or nobody>, SLA <p> percent` | When the record has no running SLA, the label ends `, no SLA` instead. `<Type>` is one of `Incident`, `Problem`, `Change`, `Request item`, `Task`. `<p>` is the SLA percent from Business rules. |
| Workspace, phone | `list` named with the queue name, with one `listitem` per record whose name equals the row label above | Cards |
| Workspace | `button "New incident"`, `button "New problem"`, `button "New task"` (operator and technician), `button "New change"` (operator only) | In the list pane's header, before Filter, on every viewport. Each opens the new-record form for its table (see Interactions) |
| Workspace | `button "Filter"`, which opens `dialog "Filter"` (a bottom sheet on the phone) | Condition builder |
| Filter | `radiogroup "Groups match"` with radios `All groups`, `Any group` | |
| Filter | `group "Group <g>"`, containing `radiogroup "Group <g> match"` (radios `All conditions`, `Any condition`) and `button "Add condition to group <g>"` | `<g>` counts from 1 |
| Filter | `group "Condition <c> of group <g>"`, containing `combobox "Field"`, `combobox "Operator"`, `textbox "Value"`, `button "Move condition up"`, `button "Move condition down"`, `button "Remove condition"` | |
| Filter | `button "Add group"`, `textbox "Filter text"`, `button "Use filter text"`, `button "Apply filter"`, `button "Save filter"`, `button "Close"` | |
| Workspace | `combobox "Group by"`, `button "Choose columns"`, `button "Update selected"`, `button "Export"`, `button "Previous page"`, `button "Next page"` | Group headings read `<group label> (<count>)` |
| Workspace | `button "<n> new records"` (`1 new record` when n is 1) | The new-records notice |
| Bulk update | `dialog "Bulk update"` with `combobox "Field"`, `textbox "Value"`, `button "Update"`; afterwards `region "Bulk update report"` headed by `heading "Bulk update report"` | Report lines from Feedback states |
| Record form | `form` named with the record number, or `form "New <Type>"` before a new record's first save | Each field is labelled with its field label from Business rules |
| Record form | `combobox "Assigned to"`, `combobox "Caller"`, `combobox "Service or item"` | The ARIA combobox pattern |
| Record form | `button "Save"`, `button "Move to <to state label>"` for each transition the role may make, `button "Override priority"` | |
| Record form | text badge | `Priority overridden` |
| Record form | `list "Also viewing"` with `listitem "<display name> is viewing"` | |
| Record form | `region "SLA"` containing, per SLA in stage `in_progress`, `paused` or `completed`, `progressbar "<SLA name>"` and its countdown text. Cancelled SLAs never show in any SLA region | Countdown copy from Feedback states |
| Record form | `list "Suggested articles"` with one `link` per article title | Shown while the short description is typed |
| Record form | `region "Workaround from <problem number>"` | The workaround text |
| Record form | `region "Activity"`; `textbox "Work note"`, `button "Add work note"`; `textbox "Comment"`, `button "Add comment"` | |
| Record form | `region "Attachments"` with `button "Attach file"` and one `listitem` per file named `<file name>, <state>` | `<state>` is `stored` or `waiting for storage` |
| Record form, after a failed save | `group "Problems to fix"` with one `link` per field error, which moves focus to that field | |
| Conflict | `dialog "Field conflict"`; per field a `radiogroup "<field label>"` with radios `Keep mine`, `Use theirs`; `button "Apply choices"`, `button "Cancel"` | Each group shows `Yours: <my value>` and `Theirs: <their value>, saved by <display name>` |
| Override | `dialog "Override priority"` with `combobox "Priority"`, `textbox "Reason"`, `button "Override"` | |
| Service map | `group "Service map"` containing one `button` per node named `<item name>, <class label>, <status label>` | |
| Service map | `region "<item name> details"`; `button "Add item"` (opens `dialog "Add item"`), `button "Add relationship"` (opens `dialog "Add relationship"` with `combobox "From"`, `combobox "Type"`, `combobox "To"`, `button "Add"`), `button "Mark down"`, `button "Mark degraded"`, `button "Mark healthy"`, `button "Schedule maintenance"` | |
| Major incident | `heading` level 1 with the failed item name; one `article` per relay panel named with its item name, or `and <n> more` | Each panel holds `img "<item name> portrait"`, the path text, `Tier <t>` and `+<k> people` |
| Major incident | `group "Affected people"` | The counter digits, then the word `people` |
| Major incident | `list "Child incidents"`, `button "Resolve together"`, `feed "Timeline"`, `button "Promote to major incident"`, `button "Reject proposal"` | |
| Change | `region "Risk"` | `Risk <score>, <band>` |
| Change | `region "Approvals"` with one `group "<step name>"` per step, containing `region "Tally"`, `button "Approve"`, `button "Reject"`, `button "Close vote"` (operator) | Tally copy from Feedback states |
| Change calendar | `grid "Change calendar"` with `gridcell "<weekday>, <day> <month> <year>, <n> changes"`, for example `Monday, 9 November 2026, 2 changes`; `button "Previous month"`, `button "Next month"` | Freeze days also show the word `Freeze` |
| Calendar day | `dialog "Changes on <day> <month> <year>"` | Links to the changes |
| Approvals | `article "<change number>: <title>"` for change votes; `article "<request item number>: <item name>"` for catalog approvals | |
| Approvals | `button "Undo"`; `dialog "Vote actions"` with `button "Approve"`, `button "Reject"`, `button "Open record"`, `button "Cancel"` | |
| On-call | `region "On call now"`; `article "Page for <incident number>"`; `button "Acknowledge"`; `dialog "Page actions"` with `button "Acknowledge"`, `button "Open incident"`, `button "Cancel"` | |
| Portal | `region "Search knowledge"` with `searchbox "Search knowledge"` and `list "Knowledge results"`; `region "Catalog"` with one `link` per item name; `region "My requests"`; `link "Report a fault"`; `link "Cart, <n> items"` | |
| Catalog item | One control per variable, named with the variable's label: a select is a `combobox`, text, multiline and date are a `textbox` (dates typed `YYYY-MM-DD`), number is a `spinbutton`, checkbox is a `checkbox`, reference is a `combobox`; `spinbutton "Quantity"` (default 1); `button "Add to cart"` | |
| Order guide | One control per question, named with its label (same control types); then one `group "<item name>"` per item the guide resolves, in rule order, refreshed within half a second of an answer change, each holding that item's variable controls; `button "Add all to cart"` | The browser checks every group's variables first and sends nothing while any problem remains (shown in the Problems to fix group); then it adds one cart line per resolved item, quantity 1, in rule order, and goes to the Cart |
| Cart | `button "Submit request"`, `button "Remove <item name>"` | |
| Request page | `region "Request status"` with one `listitem` per item, `<item number> <item name>: <state label>`, and per task, `<task number>: <state label>` | |
| Report a fault | `form "Report a fault"` with `textbox "Short description"`, `textbox "Description"`, `combobox "Service or item"`, `list "Suggested articles"`, `button "Report fault"` | Submitting creates an incident with the signed-in person as caller and goes to its portal incident page |
| My requests | one `link` per incident where the person is caller, named `<number> <short description>: <state label>`, and one per request where they are requester or requested-for, named `<request number>: <state label>`, newest first | Incidents go to the portal incident page, requests to the Request page |
| Portal incident page | `heading` level 1 with the incident number; `region "Incident status"` showing `<number>: <state label>`; `region "SLA"` (the same contents and rules as on the record form); `list "Comments"` with one `listitem` per comment, `<display name>: <text>`, oldest first; `textbox "Comment"`, `button "Add comment"`; `button "Reopen"` | Reopen shows only while the incident is Resolved and the reopen deadline has not passed, and opens `dialog "Reopen"` with `textbox "Reopen reason"` and `button "Reopen incident"`. Work notes and denied fields never show here |
| Article | `button "Helpful"`, `button "Not helpful"` | |
| Designer | `tree "Flow steps"` with `treeitem "<step name>, <type label>"` and lane items `Yes`, `No`, `Loop body`, `On error` | |
| Designer | `dialog "Add step"` with `combobox "Step type"`, `textbox "Step name"`, `button "Add step"`; `dialog "Delete step"` with `button "Delete"`, `button "Keep"`; `dialog "Edit step <step name>"`; `button "Publish"`; `button "Test run"` | |
| Run view | `list "Run steps"` with `listitem "<step name>: <status label>"`; `button "Retry <step name>"` | |
| Dashboard | `region "<widget title>"` containing `img "<widget title> chart"`, `button "Show data table"`, `table "<widget title> data"`; one `link "<group label>: <count>"` per bar or bucket | |
| Exports | `progressbar "Export progress"`, `button "Retry export"`, `link "Download export"` | Progress text from Feedback states |
| Imports | `button "Upload import file"`, `table "Import preview"`, `button "Commit import"` | |
| Configuration sets | `button "New set"`, `button "Export set"`, `button "Preview against live"`, `table "Set preview"`, a `radiogroup "<item name>"` per collision with radios `Take set`, `Keep live`, `button "Commit set"`, `button "Back out set"` | The sets table has one `row` per set, containing its set number. `Export set`, `Preview against live`, `Commit set` and `Back out set` sit in each row's action cell and act on that row's set. |
| Inbox | `list "Inbox"`, `button "Mark all read"`, `radiogroup "Digest"` with radios `Immediately`, `Daily digest` | |

**Rules and settings screens.** Each kind below lives at `/desk/admin/<slug>`. Its subject is the plural name. The screen has `list "<Plural name>"` with one `link` per record named with the record's name, `button "New <singular name>"`, and `form "<singular name>"` with `button "Save <singular name>"`. Each form field is a labelled control named by the API member in sentence case (for example `Name`, `Table`, `When`, `Order`, `Operations`, `Active`, `Time zone`). A string or number member is a `textbox` holding its plain value. A `true` or `false` member is a `checkbox`. Every array or object member is a `textbox` holding its JSON value, exactly as Actions does: for example `Operations` holds `["insert","update"]`, and `Roles` (on access rules and inbox rules), `Targets`, `Hours`, `Holidays`, `Members`, `Levels`, `Scope`, `Variables`, `Inputs` and `Outputs` each hold the JSON of that API member. The expression member is `textbox "Condition"`, and the actions member is `textbox "Actions"` holding the JSON array of action objects. Times are typed as `YYYY-MM-DD HH:mm`, and the zone they are read in depends on the form:
- Freeze window form: `Start` and `End` are read in the zone typed in the same form's `Time zone` field.
- Business schedule form: it has no instants. `Hours` holds wall times and `Holidays` holds dates, both in the schedule's own `Time zone`.
- `dialog "Add override"`: `Start` and `End` are read in the chosen rotation's time zone.
- `dialog "Schedule maintenance"` and every other time field: read in the viewer's time zone.

| Slug | Plural name | Singular name |
|---|---|---|
| `business-rules` | Business rules | business rule |
| `access-rules` | Access rules | access rule |
| `assignment-rules` | Assignment rules | assignment rule |
| `form-policies` | Form policies | form policy |
| `sla-definitions` | SLA definitions | SLA definition |
| `schedules` | Business schedules | business schedule |
| `escalation-policies` | Escalation policies | escalation policy |
| `boards` | Change boards | change board |
| `freeze-windows` | Freeze windows | freeze window |
| `catalog-items` | Catalog items | catalog item |
| `inbox-rules` | Inbox rules | inbox rule |
| `users` | Users | user |
| `audit-log` | Audit log | (read-only list of impersonation entries) |

On the `users` form, roles are `group "Roles"` with one `checkbox` per role named by the role key (`operator`, `technician`, `requester`, `approver`, `manager`), and each user row has `button "Impersonate <display name>"`, which starts impersonation and goes to that person's home screen. On the On-call screen, `button "Add override"` opens `dialog "Add override"` with `combobox "Rotation"`, `combobox "Person"`, `textbox "Start"`, `textbox "End"` and `button "Save override"`. On the service map, `button "Schedule maintenance"` opens `dialog "Schedule maintenance"` with `textbox "Start"`, `textbox "End"` and `button "Schedule"`.

Pinned subject names and display headings keep their published letter case in the page text. Where they look uppercase, that comes from styling, and checks compare the text content.

### Interactions (DP-15, DP-23, DP-27, DP-30, DP-42, DP-46, DP-53, DP-60)

**General keyboard rules.** Every action works by keyboard. In any open dialog or sheet, Tab and Shift+Tab wrap from the last control to the first and back, so focus never leaves it. Escape closes the dialog or sheet, and focus returns to the control that opened it. F6 moves focus to the next region (navigation, list, form, activity, then back to navigation) and Shift+F6 moves backwards, so focus is never trapped on a page. A published shortcut works whichever control in its region has focus. The one exception is the slash key: it types normally while focus is in a text field.

**Grid (list).**
- Arrow keys move between cells.
- Enter opens the focused row's record in the form pane. On the phone it opens full screen, and focus moves to the record's heading.
- Space selects or deselects the focused row. Shift+Up and Shift+Down extend the selection.
- F2 edits the focused cell when its column is editable (Short description, Assigned to, Impact, Urgency). Enter saves that one field with its version, and focus returns to the cell. Escape cancels.
- `/` opens the Filter dialog with focus on the first Field combobox.
- On phone cards, a tap opens the record and Enter does the same.

**Form.**
- Ctrl+S saves (Cmd+S on macOS) wherever focus is in the form. After a save, focus stays on the control that had it.
- After a transition, focus moves to the record heading.
- Reference fields follow the ARIA combobox pattern: typing filters options, Down opens and moves through them, Enter picks one and Escape closes the list.
- When a save fails validation, focus moves to the "Problems to fix" group.
- After "Apply choices" in the conflict dialog, focus returns to the first field that was in conflict.

**Creating a record.** Activating `New incident`, `New problem`, `New task` or `New change` (Enter or Space) goes to `/desk/records/new/<table>` and shows `form "New <Type>"` (`Incident`, `Problem`, `Task`, `Change`) in the form pane, full screen on the phone. Fields start empty apart from published defaults, and focus moves to the first field: `Short description` for incidents, problems and tasks, `Title` for changes. Priority shows the matrix value as soon as impact and urgency are both set, recomputed by the server on save. Save or Ctrl+S creates the record through the create endpoint. On success the address becomes `/desk/records/<number>`, the form is named with the new number, focus moves to the record heading, and the save copy from Feedback states is announced. A refused save keeps the new form and its values, and uses no number.

**Portal incident page.** `/portal/incidents/<incident number>` opens for anyone who can see that incident under the baseline (for requesters, incidents where they are the caller). An incident the person cannot see shows the not-found state with HTTP 404. The page receives the record's state and SLA changes through the live channel within 2 seconds, and announces each state change with the requester copy from Feedback states. `Add comment` posts a comment, which may move an incident waiting on the requester back to In progress by the incident rules. `Reopen incident` makes the reopen transition with the typed reopen reason; afterwards focus moves to the page heading. After `Report fault`, focus moves to the new incident page's heading and the save copy is announced.

**Condition builder.**
- "Add condition to group `<g>`" appends a row, and focus moves to that row's Field combobox.
- "Add group" appends a group with one empty row, and focus moves to its Field combobox.
- Move up and Move down reorder a row within its group. Alt+Up and Alt+Down do the same with focus anywhere in the row, and focus stays on the moved row.
- "Remove condition" deletes the row. Focus moves to the previous row's Field combobox, or to the group's add button if no row is left.
- The Field combobox accepts reference paths: typing `caller.` lists the fields of the caller.
- The Filter text box rewrites itself in canonical form within half a second of each builder change.
- Typing filter text and pressing Enter, or activating "Use filter text", rebuilds the builder from that text.
- "Apply filter" closes the dialog, and focus moves to the grid's first row.

**Bulk update.** Select rows, then choose "Update selected", a field and a value, and Update. The dialog closes, the report appears, and focus moves to the report's heading.

**New-records notice.** While a list is open, records that someone else creates and that match its filter are not inserted. The notice button appears instead. Activating it reloads the list in place, and focus moves to the first row.

**Service map.**
- Tab reaches the map group, and focus lands on the first node in reading order (top row, leftmost).
- Left and Right move to the previous or next node in the same row. Nothing happens at the end of a row.
- Up and Down move to the row above or below, onto the node whose horizontal position is nearest. Ties go to the node further left.
- Home and End move to the first and last node in the row.
- Enter expands or collapses the node's details region.

**Designer.**
- Up and Down move between visible tree items in reading order.
- Right enters a branch or loop: the first press expands it, the next moves to its first lane. Left moves to the parent.
- Insert opens "Add step". The new step goes after the focused step in the same lane, or first in the lane when a lane item is focused, and focus moves to the new step.
- Alt+Up and Alt+Down move the focused step within its lane, and focus stays on it.
- Delete opens "Delete step". Confirming removes the step, and focus moves to the previous step, or the next one if it was first.
- Enter opens "Edit step `<step name>`".
- The trigger step cannot be moved or deleted. Trying it announces the trigger copy from Feedback states.

**Change calendar.**
- Left and Right move one day. Up and Down move one week.
- PageUp and PageDown move to the same day in the previous or next month, or to that month's last day when the day does not exist in it.
- Home and End move to the start (Monday) and end (Sunday) of the week.
- Enter opens the day dialog. Escape closes it, and focus returns to the day cell.

**Phone gestures (375x812).**
- **Swipe a vote card.** The card follows the finger sideways. Releasing more than 96 pixels to the right approves, and more than 96 pixels to the left rejects. A shorter swipe snaps the card back.
- **Undo period.** After a swipe past the distance, the card leaves, the Undo button shows for 5 seconds, and only then is the vote sent. Undo within those 5 seconds restores the card and sends nothing. The 5 seconds are measured by the browser clock, and the server still decides whether the vote is accepted.
- **Long press.** Holding a finger on a vote card for at least 600 milliseconds without moving it more than 10 pixels opens "Vote actions" as a bottom sheet.
- **Page cards.** They work the same way. Swiping right more than 96 pixels acknowledges, with the same 5-second Undo, and a long press opens "Page actions".
- Pressing a card's buttons does the same things without gestures.
- After a vote is sent, focus moves to the next card, or to the empty state's button.

**Drawers and sheets.** Menu opens the navigation drawer. The Filter button on the phone opens the filter bottom sheet. Closing either one by Escape, Close, a backdrop tap or a link removes it from view, from the Tab order and from the accessibility tree until it is opened again. Sliding it off-screen does not count as closing it.

**Outage relay.** Scrolling down moves the panels up under the pinned name, and scrolling up brings them back. When the last panel has passed, the pin releases into the white child section. Activating "Resolve together" opens `dialog "Resolve together"` with `combobox "Resolution code"`, `textbox "Resolution note"` and `button "Resolve"`.

### Visual design (DP-09, DP-10, DP-36)

The direction is a pinned poster.

**Colour and type.**
- One hot orange field fills every screen from floor to ceiling. Working surfaces sit on a slightly lighter orange.
- Text, rules and solid blocks are a deep blue-black ink. Secondary text on the orange is a dark burnt brown.
- The accent is the same blue-black. Text on an accent block is the hot orange.
- White rest sections hold forms, tables and articles.
- Display type is Unbounded, used for the pinned names, heavy and uppercase in appearance. Body type is Onest. Each heading step is one third larger than the step below it, starting from body text.
- Body text is about 16 pixels tall with tabular figures (every digit the same width) for clocks, counts and numbers.
- Density is comfortable.

**Composition.** One pinned uppercase name holds the top of the viewport: the department, the queue, the broken service, the ticket number or the change title. Full-height panels, or the rows of the things it governs, scroll beneath it. Then the pin releases at a hard horizontal edge into white working sections. Forms and articles keep a narrow measure of about 64 characters per line. On desktop and tablet, pinned working names are about one sixteenth of the screen width tall. On phones they are about one seventh.

**Hero.** SWITCHYARD runs in blue-black Unbounded at its heaviest weight across the orange field, between 90 and 160 pixels tall depending on the window width. Beneath it sit six procedural portraits of service types: mail, file share, payroll, remote access, printers and identity. Each is a 2:3 upright tile drawn as a mosaic of simple glyph shapes generated from its name, and each brings its own flat background made from its glyph colours. The wordmark Ferrocline sits top-left and Menu sits top-right. The sentence sits bottom-left, and the solid blue-black "Open your desk" block with orange text sits bottom-right.

**Working screens.**
- Rows, forms and tables are set in Onest in white sections below the edge.
- Every corner is square, and every block is a rectangle.
- Status always shows as a word plus a solid ink block, never as colour alone. For example, a black block reads `Breached` and an outlined block reads `Paused`.
- Empty, loading and error states are a single pinned line in the display face over the orange field, with one solid button.

**Outage relay tiers.**
- Tier 1 (business-critical items): a blue-black background with orange text.
- Tier 2 (criticality 3, not business-critical): a burnt brown background with white text.
- Tier 3 (everything else): the lighter orange surface with blue-black text.
- Each relay panel shows its item's procedural portrait at 2:3, generated the same way as the hero portraits.

**Accessibility.**
- Text and controls meet WCAG 2.2 AA contrast. Blue-black on orange, orange on blue-black, white on brown and blue-black on white all pass.
- Every control is at least 44 pixels tall and wide.
- A visible focus outline (a thick blue-black frame, orange on dark blocks) marks every focused control.
- There is no cream or paper background, no hairline decoration, no monospace labels, no index numbering and no glass effects.

Fonts ship with the app and load from its own origin.

### Motion and effects (DP-30, DP-35, DP-46, DP-53)

All motion uses two timings: 180 milliseconds and 420 milliseconds. Both use one curve that starts fast and settles softly. Each motion runs through the browser's Web Animations interface on the element named below, so its duration can be read from the element's running animations.

| Motion | Element | Duration | Meaning |
|---|---|---|---|
| SLA bar change | the SLA progressbar's fill | 420 ms | The fill grows from its old percent to its new one whenever the server sends a new SLA value |
| Map node expand | the node's details region | 420 ms | The region grows from the node's height to its full height. Collapsing reverses it. |
| Designer step move | the moved tree item | 180 ms | The step slides from its old position to its new one on Alt+arrow or a drop |
| Press feedback | buttons and cards | 180 ms | A brief inset on press |
| Swipe snap-back | a vote or page card | 180 ms | The card returns to centre after a short swipe |
| Relay counter | the Affected people group | 420 ms per panel change | The counter counts from the old total to the new one |

**Outage relay, step by step.**
- The scroll range of the relay section is one viewport height per panel.
- The failed item's name stays pinned at the top in Unbounded at about one tenth of the screen width.
- Panels scroll up beneath it in the server's order (Business rules, impact).
- A panel counts as passed when its top edge has crossed the middle of the viewport.
- The counter at the bottom-left shows the running affected-people total of the last passed panel, or the failed item's own people before the first panel. Each time that value changes, the counter counts to it over 420 milliseconds.
- Scrolling back up un-passes panels one at a time, and the counter counts back down step by step.
- On the last panel the counter equals the server's affected-people total.
- After the last panel, the pin releases and the white child section scrolls into view.

**Reduced motion.** When the person prefers reduced motion, Switchyard creates no animations at all, so every element's list of running animations is empty, and each motion shows its end state at once.
- The relay title becomes an ordinary static heading. The panels become an ordinary list of the same items in the same order, with paths and tiers. The final total shows at once, and the reduced-motion total copy from Feedback states is announced once. There is no counting and no pin.
- Swipes still work, but the card follows the finger without animated return.
- The map expands and the SLA bar changes without animation.

There are no decorative loops anywhere: nothing moves unless one of the events above happens.

### Feedback states (DP-07, DP-19, DP-44, DP-46, DP-67)

Every async result is announced as plain text in the `Announcements` status region, which replaces its previous text. Visible copy matches it character for character, with straight apostrophes and ASCII hyphens.

Placeholders used below:
- `<number>`: a record number.
- `<state label>`: a state label from Business rules.
- `<field label>`: a field label.
- `<SLA name>`: an SLA definition's name.
- `<n>`: a whole number with no separators.
- `<H>:<MM>:<SS>`: a duration of whole hours (no upper limit), minutes and seconds, each of the last two padded to two digits, for example `27:04:09`.

| Action | Pending | Success (shown and announced) | Field or rule error | Outage |
|---|---|---|---|---|
| Sign in | button text `Signing in...` | goes to the person's home screen (see Screens and layout) | `That username and password do not match.` shown under the form | |
| Save a record | button text `Saving...` | `Saved <number>.` | `<n> problems to fix before saving.`, with the Problems to fix group | |
| Field conflict | | | `Conflict on <field label>: <display name> saved a newer value.` | |
| Transition | button text `Moving...` | `<number> moved to <state label>.` | the API message from Business rules, shown under the buttons | |
| Work note or comment | | `Note added.` | | |
| SLA pause, seen live | | `SLA paused: on hold` | | |
| SLA resume, seen live | | `SLA resumed` | | |
| SLA threshold, seen live | | `SLA at <p> percent: <SLA name>` (p is 50 or 75) | | |
| SLA breach, seen live | | `SLA breached: <SLA name>` | | |
| Requester sees their record change | | `Your request <number> is now <state label>.` | | |
| Catalog checkout | button text `Submitting...` | `Request <request number> submitted with <n> items.` | `<n> problems to fix before saving.` | |
| Vote by button | | `Vote recorded: <approve or reject> on <change number>.` | the API message | |
| Vote by swipe | | `Approving <number>. Undo within 5 seconds.` or `Rejecting <number>. Undo within 5 seconds.`; then the vote-recorded copy | | |
| Undo | | `Vote undone.` | | |
| Approval reset, seen live by approvers | | `<change number> changed and needs a new vote.` | | |
| Acknowledge | | `Page acknowledged.` | the API message | |
| Bulk update | | `<ok> updated, <failed> not updated.`; report lines `<number> updated` or `<number> not updated: <reason>` | | |
| New records notice | | `<n> new records` (`1 new record`) | | |
| Attachment | the file line reads `uploading` | `<file name> attached.` | the API message | `<file name> is queued until file storage returns.` |
| Import check | `Checking import...` | `Import checked: <c> to create, <u> to update, <x> unchanged, <e> with errors.` | | storage banner |
| Import commit | `Importing...` | `Import finished: <c> created, <u> updated, <x> unchanged, <e> failed.` | | storage banner |
| Export | progress text `<done> of <total> rows` | `Export complete: <n> rows.` | | `Export failed: file storage is unreachable.` |
| Configuration set export | `Exporting...` | `Set <set number> exported.` | | storage banner |
| Configuration set commit | `Committing...` | `Set <set number> committed: <n> items applied.` | the API message | |
| Configuration set back-out | `Backing out...` | `Set <set number> backed out.` | the API message | |
| Workflow publish | `Publishing...` | `Version <n> published.` | the API message | |
| Designer trigger move | | `The trigger stays first.` | | |
| Relay under reduced motion | | `<n> people affected by <item name>.` (announced once) | | |
| Role change, seen live by that person | | `Your access changed.` | | |

**SLA countdown copy**, used on forms, queue rows and the portal:
- running: `<H>:<MM>:<SS> left`
- paused: `Paused at <H>:<MM>:<SS> left`
- breached and still running: `Breached by <H>:<MM>:<SS>`
- completed in time: `Met`
- completed late: `Missed`

Paused SLAs also show `Paused for <H>:<MM>:<SS>`. The percent shows as `<p> percent`.

**Tally copy.**
- Count rules: `Approve <a>, reject <r>, waiting <w>. Needs <n> of <m>.`
- Weighted rule: `Approve weight <A>, reject weight <R>, waiting weight <W>. Needs <N> of <T>.`
- Once a step closes, its tally adds `Closed: approved` or `Closed: rejected`.

**Banners.**
- Storage banner, for desk roles: `File storage is unreachable. Ticket work continues; uploads are queued and exports will retry when storage returns.`
- Storage banner, for requesters on the portal: `Attachments are paused while file storage is unreachable. Your request still goes through.`
- Impersonation banner: `Impersonating <display name> (<username>). Everything you do is recorded.`
- Major incident proposal banner, on the item and map: `Major incident proposed for <item name>.`

**Empty, loading and error states** (one pinned line plus one button):

| State | Line | Button |
|---|---|---|
| Queue with no records | `Nothing waiting in <queue name>.` | `Show all open incidents` |
| Filter with no matches | `No records match this filter.` | `Clear filter` |
| Knowledge search with no results | `No articles match "<query>".` | `Report a fault` |
| Inbox empty | `Your inbox is empty.` | `Back to your desk` |
| No votes waiting | `No votes waiting for you.` | `Open changes` |
| Loading | `Loading <subject>...` | `Cancel` |
| Load error | `Switchyard could not load this. Try again.` | `Try again` |
| Not found | `That page isn't on the switchyard.` | `Back to your desk` |

## Backend

### API (DP-02, DP-03, DP-04, DP-08, DP-12, DP-21, DP-44, DP-45, DP-51, DP-56)

**Request and response format.**
- Every endpoint is under `/api`.
- Bodies are `application/json; charset=utf-8`, except uploads, which are `multipart/form-data` with the file in the field `file`.
- Times in requests and responses are ISO 8601 instants with an offset.
- Durations are whole seconds.
- Sessions use an HttpOnly, SameSite=Lax cookie named `switchyard_session`.

**One error body.** Every error has this shape:

`{"error":{"code":"<code>","message":"<text>","fields":{"<field>":"<text>"}}}`

`fields` appears only on field-level errors. Endpoints add extra members inside `error` only where stated.

**Error check order** (the whole API). One rate check comes before step 1, per endpoint class. A sign-in attempt is counted and checked before its credentials are read, so an over-limit sign-in answers 429 even with the wrong password, and no sign-in over the limit succeeds even with the right one. Any other write is checked right after authentication, so an over-limit write answers 429 even when it is valid. Reads are not rate limited. With the rate check passed, the steps are:
1. 401 `unauthenticated` (`Sign in to continue.`)
2. 404 `not_found` (`No such record.`) for unknown resources or resources the caller may not see
3. 403 for a role, function or field denial
4. 409 for a stale version or a state conflict
5. 422 for validation, illegal transitions and rule refusals
6. 413 `too_large` for an attachment over the size limit
7. (429 `rate_limited` is never decided here: it is decided by the rate check above, before step 1.)

An idempotent replay returns its stored response right after authentication and the rate check, before any other check. Transport checks in Server boundary (cross-origin and whole-body size) come before this order. Each endpoint row below lists only the errors it adds.

**The operator-only refusal.** It is `403 {"error":{"code":"operator_only","message":"Only the operator can do this."}}`. Rows below marked **O** answer it to every other role.

**Desk roles** means operator and technician.

**Other role refusals.** A person holds a row's permission when any one of their roles is listed in its Who column. A signed-in person none of whose roles a row's Who column lists answers `403 {"error":{"code":"forbidden","message":"Your role cannot do this."}}`. The record endpoints have no Who column: the baseline and the access rules decide there (404 `not_found`, 403 `denied`, 403 `field_denied`), except that work notes are for desk roles only and answer `forbidden` to every other role.

**Session, users and roles**

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| POST `/api/session` | anyone | `{"username","password"}` | 200 `{"user":{"username","display_name","roles":[...],"department","time_zone"}}` and sets the cookie | 401 `bad_credentials`, with the sign-in error copy from Feedback states |
| GET `/api/session` | signed in | | 200 `{"user":{...},"workspace":"live"\|"test","impersonating":null\|{"username","display_name"}}` | |
| DELETE `/api/session` | signed in | | 204 | |
| PUT `/api/session/workspace` | **O** | `{"workspace":"live"\|"test"}` | 200 `{"workspace"}` | |
| POST `/api/impersonate` | **O** | `{"username"}` | 200 `{"impersonating":{"username","display_name"}}` | |
| DELETE `/api/impersonate` | operator while impersonating | | 204 | |
| GET `/api/audit-log` | **O** | query `kind` (optional) | 200 `{"entries":[{"at","kind":"impersonation_started"\|"impersonation_stopped","actor","target"}]}`, newest first | |
| GET `/api/users` | operator, technician | | 200 `{"users":[{"username","display_name","roles","department","time_zone","out_of_office","capacity","active","delegate"}]}` | |
| POST `/api/users`, PATCH `/api/users/<username>` | **O** | `{"username","password","display_name","roles":[...],"department","time_zone","out_of_office":false,"capacity":null,"active":true}`, with any subset for PATCH | 201 or 200 `{"user"}` | 422 `validation` |
| PUT `/api/users/<username>/delegate` | that approver, or **O** | `{"delegate":"<username>","from","to"}` or `{"delegate":null}` | 200 `{"user"}` | 422 `validation` |
| GET or POST `/api/groups`, PATCH `/api/groups/<name>` | read: operator and technician; write: **O** | `{"name","members":[usernames in order],"escalation_policy":null}` | 200 or 201 `{"group"}` | |
| GET `/api/departments` | signed in | | 200 `{"departments":[{"name","members":<n>}]}` | |

**Records** (tables `incident`, `problem`, `change`, `request_item`, `task`; requests are read through their items)

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET `/api/tables/<table>/records` | query `filter` (filter text), `q` (text search), `sort` (field), `dir` (`asc`\|`desc`), `page` (from 1), `group_by` (field path), `columns` (comma list) | 200 `{"records":[<record summary>],"total","page","page_size","groups":[{"value","label","count","filter"}]}` (`groups` only with `group_by`) | 422 `unknown_field`, `filter_too_complex`, `expression_error` |
| POST `/api/tables/<table>/records` | `{"fields":{"<field>":<value>}}` | 201 `{"record":<record>}` | 422 `validation`, `aborted`, `rule_depth` |
| GET `/api/records/<number>` | | 200 `{"record":<record>}` | |
| PATCH `/api/records/<number>` | `{"fields":{"<field>":{"value":<value>,"version":<n>}}}` | 200 `{"record"}` | 403 `field_denied`; 409 `field_conflict`; 422 `validation`, `aborted`, `rule_depth` |
| POST `/api/records/<number>/transition` | `{"to":"<state>","fields":{"<field>":{"value","version"}}}` | 200 `{"record"}` | 409 `field_conflict`; 422 `illegal_transition`, `role_not_allowed`, `field_required`, `reopen_window_passed`, `open_incidents`, `fix_not_done`, `freeze`, `overlap`, `aborted`, `child_failed` |
| POST `/api/records/<number>/work-notes`, `/comments` | `{"text"}` (1 to 10,000 characters) | 201 `{"entry"}` | 422 `validation` |
| GET `/api/records/<number>/activity` | | 200 `{"entries":[{"at","actor","acting_for","kind","text"}]}` | |
| GET `/api/records/<number>/audit` | operator, technician | 200 `{"entries":[{"at","actor","acting_for","field","before","after","reason"}]}`; `reason` is null except on a priority override entry | |
| POST `/api/records/bulk` | `{"numbers":[...],"fields":{"<field>":<value>}}` | 200 `{"results":[{"number","ok":true}\|{"number","ok":false,"message"}]}` | |
| POST `/api/records/<number>/priority-override` (**O**) | `{"priority":1-5,"reason"}` | 200 `{"record"}` | 422 `validation` |
| DELETE `/api/records/<number>/priority-override` (**O**) | | 200 `{"record"}` | |
| POST `/api/records/<number>/assign-by-rules` | | 200 `{"record"}` | |
| POST `/api/records/<number>/attachments` | multipart `file` | 201 `{"attachment":{"id","name","bytes","type","status":"stored"}}`, or 202 with `"status":"queued"` during a storage outage | 422 `bad_type`, `over_quota`; 413 `too_large` |
| GET `/api/attachments/<id>` | | 200, the file bytes with their type | 503 `storage_unavailable`; 409 `not_stored` while queued |
| GET `/api/search?q=` | | 200 `{"records":[<record summary>],"articles":[<article summary>]}` | |

`<record summary>` is `{"number","table","state","state_label","short_description","priority","assigned_to","sla":{"percent","remaining_seconds","ticking","next_change_at","server_time","stage","breached"}|null,"label"}`, where `label` is the grid row label.

`<record>` is:

`{"number","table","state","state_label","fields":{"<field>":{"value","display","version","label","mandatory","read_only","visible"}},"priority_overridden","slas":[<sla>],"links":{"parent","children":[...],"problem","incidents":[...],"fix_change"},"workaround":null|{"problem","text"},"transitions":[{"to","label"}]}`

Denied fields are absent from `fields`. `transitions` lists only the moves this caller may make from the current state.

The `field_conflict` body adds:

`"conflicts":[{"field","label","yours","theirs","theirs_by","version"}]`

`version` is the current version to resend with.

**SLA and schedules**

| Method and path | Who | Request | Success |
|---|---|---|---|
| GET `/api/records/<number>/sla` | anyone who can see the record | | 200 `{"slas":[<sla>]}` |
| GET or POST `/api/schedules`, PUT `/api/schedules/<name>` | read: all desk roles; write: **O** | `{"name","time_zone":"<IANA>","hours":{"mon":[["08:00","17:00"]],...,"sun":[]},"holidays":["YYYY-MM-DD"]}` | 200 or 201 `{"schedule"}` |
| GET or POST `/api/sla-definitions`, PUT `/api/sla-definitions/<name>` | read: all desk roles; write: **O** | `{"name","table","start":"<expr>","pause":"<expr>","stop":"<expr>","schedule":"<name>","targets":{"1":<seconds>,...,"5":<seconds>}}` | 200 or 201 `{"sla_definition"}` |

`<sla>` is:

`{"id","definition","priority","stage":"in_progress"|"paused"|"completed"|"cancelled","start_at","target_seconds","elapsed_seconds","remaining_seconds","paused_seconds","percent","breached","ticking","next_change_at","server_time"}`

**Service map**

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| GET `/api/cis`, GET `/api/cis/<name>` | desk roles and managers | | 200 `{"cis":[<ci>]}` / `{"ci":<ci>}` | |
| POST `/api/cis`, PATCH `/api/cis/<name>` | **O** | `{"name","class","criticality":1-3,"business_critical":false,"owner_department", ...class attributes}` | 201 or 200 `{"ci"}` | 422 `validation` |
| POST `/api/relationships` | **O** | `{"source":"<name>","type":"<type>","target":"<name>"}` | 201 `{"relationship"}` | 422 `cycle`, `validation` |
| DELETE `/api/relationships` | **O** | same body | 204 | |
| GET `/api/service-map` | desk roles and managers | | 200 `{"nodes":[{"name","class","status","layer","x","y"}],"edges":[{"source","type","target"}]}` | |
| POST `/api/cis/<name>/status` | operator, technician | `{"status":"down"\|"degraded"\|"healthy"}` | 200 `{"ci","impact":<impact>}` | |
| POST `/api/cis/<name>/maintenance` | **O** | `{"start","end"}` | 201 `{"window"}` | 422 `validation` |
| GET `/api/cis/<name>/impact` | desk roles and managers | | 200 `<impact>` | |

`<ci>` is `{"id","name","class","criticality","business_critical","owner_department","status","effective_status","attributes":{...},"used_by":{"departments":[...],"people":[...]}}`. `status` is the declared status (`healthy`, `degraded`, `down`), and `effective_status` is the computed one (`healthy`, `degraded`, `down`, `maintenance`) from Business rules. In `GET /api/service-map`, each node's `status` is its effective status.

`<impact>` is:

`{"ci","status","base_people","affected":[{"ci":{"name","class","criticality","business_critical"},"path":["depends on","runs on"],"tier":1|2|3,"people_added","running_people"}],"degraded":[{"ci","path"}],"people_total","business_critical_affected","proposal":null|<proposal>}`

**Major incidents and problems**

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| GET `/api/major-proposals` | desk roles and managers | | 200 `{"proposals":[{"id","ci","reason","business_critical_affected","linked_open_incidents","status":"open"\|"promoted"\|"rejected","incident"}]}` | |
| POST `/api/major-proposals/<id>/promote` | **O** | | 201 `{"record"}` (the new major incident) | 409 `proposal_closed` |
| POST `/api/major-proposals/<id>/reject` | **O** | `{"reason"}` | 200 `{"proposal"}` | 409 `proposal_closed` |
| POST `/api/records/<number>/children` | operator, technician | `{"numbers":[...]}` | 200 `{"record"}` | 422 `validation` |
| DELETE `/api/records/<number>/children/<child>` | operator, technician | | 200 | |
| GET `/api/records/<number>/timeline` | anyone who can see the record | | 200 `{"entries":[...]}` | |
| GET `/api/major/<number>` | desk roles and managers | | 200 `{"record","impact","children":[<record summary>],"timeline":[...]}` | |
| POST `/api/records/<problem>/incidents` | operator, technician | `{"numbers":[...]}` | 200 `{"record"}` | |
| POST `/api/records/<problem>/workaround` | operator, technician | `{"text"}` | 200 `{"record"}` | 422 `validation` |

**Changes, boards and votes**

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| GET `/api/records/<change>/risk` | desk roles and approvers | | 200 `{"score","band","inputs":{"criticality","people_total","people_band","backout_tested","in_business_hours","failed_changes_90d","duration_hours"}}` | |
| GET `/api/records/<change>/approvals` | desk roles and approvers | | 200 `{"steps":[<step>]}` | |
| POST `/api/records/<change>/steps/<step>/votes` | voters and their active delegates | `{"decision":"approve"\|"reject","comment":"","on_behalf_of":null}` | 201 `{"vote":{"voter","voted_by","decision","at"},"step":<step>}` | 403 `not_a_voter`; 409 `already_voted`, `vote_closed`, `step_not_open` |
| POST `/api/records/<change>/steps/<step>/close` | **O** | | 200 `{"step"}` | 409 `vote_closed` |
| GET `/api/changes/calendar?month=YYYY-MM` | desk roles and approvers | | 200 `{"days":[{"date","changes":[{"number","title","planned_start","planned_end"}],"freezes":[names]}]}` | |
| GET or POST `/api/boards`, PUT `/api/boards/<name>` | read: all; write: **O** | `{"name","rule":"all"\|"any"\|"n_of_m"\|"weighted","n":null,"threshold_percent":null,"window_hours":48,"members":[{"username","weight":1}]}` | 200 or 201 `{"board"}` | |
| GET `/api/boards/<name>/agenda` | desk roles and approvers | | 200 `{"items":[{"number","title","planned_start","step":<step>}]}` | |
| GET or POST `/api/freeze-windows` | read: all; write: **O** | `{"name","start","end","time_zone","scope":"all"\|{"items":[names]}}` | 200 or 201 | |
| GET `/api/approvals` | signed in | | 200 `{"approvals":[{"kind":"change_step"\|"request_item","id","record","title","closes_at","step"}]}` | |
| POST `/api/approvals/<id>/decision` | that approver | `{"decision":"approve"\|"reject","comment":""}` | 200 `{"approval"}` | 409 `already_decided` |

`<step>` is:

`{"step","name","rule","status":"not_started"|"open"|"approved"|"rejected","opens_at","closes_at","voters":[{"username","weight","decision","voted_by"}],"tally":{"approve","reject","waiting","needed","of","approve_weight","reject_weight","waiting_weight","total_weight"}}`

**On-call**

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| GET or POST `/api/rotations` | read: desk roles; write: **O** | `{"name","time_zone","handover_weekday":"monday","handover_time":"09:00","members":[usernames],"anchor_date":"YYYY-MM-DD"}` | 200 or 201 `{"rotation"}` | 422 `validation` |
| POST `/api/rotations/<name>/overrides` | **O** | `{"username","start","end"}` | 201 `{"override"}` | |
| GET `/api/rotations/<name>/oncall?at=<instant>` | desk roles | | 200 `{"username","shift_start","shift_end","override":false}` | |
| GET `/api/rotations/<name>/shifts?from=<instant>&to=<instant>` | desk roles | | 200 `{"shifts":[{"username","start","end","override"}]}` | |
| GET or POST `/api/escalation-policies` | read: desk roles; write: **O** | `{"name","levels":[{"target":{"rotation":"<name>"}\|{"user":"<username>"},"ack_minutes":null}]}` | 200 or 201 | |
| POST `/api/records/<number>/page` | operator, technician | `{"policy":"<name>"}` | 201 `{"page":<page>}` | 409 `already_paging` |
| GET `/api/pages` | desk roles | | 200 `{"pages":[<page>]}` | |
| POST `/api/pages/<id>/acknowledge` | paged people, operator | `{}` | 200 `{"page"}` | 403 `not_paged`; 409 `already_acknowledged` |

`<page>` is:

`{"id","record","policy","status":"paging"|"acknowledged"|"exhausted","level","levels":[{"level","username","notified_at","ack_due_at"}],"acknowledged_by","acknowledged_level","late"}`

**Catalog, cart and portal**

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| GET `/api/catalog/items`, GET `/api/catalog/items/<id>` | signed in | | 200 `{"items":[...]}` / `{"item":{"id","name","variables":[<variable>],"workflow"}}` | |
| POST `/api/catalog/items`, PUT `/api/catalog/items/<id>` | **O** | `{"id","name","variables":[<variable>],"workflow":"<flow name>"}` | 201 or 200 | 422 `validation` |
| GET `/api/catalog/guides/<id>` | signed in | | 200 `{"guide":{"id","name","questions":[<variable>],"rules":[{"item","condition"}]}}` | |
| POST `/api/catalog/guides/<id>/resolve` | signed in | `{"answers":{...}}` | 200 `{"items":[ids in rule order]}` | 422 `validation` |
| GET `/api/cart` | signed in | | 200 `{"lines":[{"id","item","quantity","variables"}]}` | |
| POST `/api/cart/lines` | signed in | `{"item","quantity":1-10,"variables":{...}}` | 201 `{"line"}` | 422 `validation` with per-variable fields |
| DELETE `/api/cart/lines/<id>` | signed in | | 204 | |
| POST `/api/cart/checkout` | signed in; optional header `Idempotency-Key` (1 to 64 characters) | `{"requested_for":null}` | 201 `{"request":{"number","items":[{"number","item","state"}]}}` | 409 `idempotency_conflict`; 422 `empty_cart`, `validation` |
| GET `/api/requests/<request number>` | requester, requested-for person, desk roles | | 200 `{"request":{"number","state","items":[{"number","item","state","state_label","tasks":[{"number","state","state_label"}],"slas":[<sla>]}]}}` | |
| GET or POST `/api/form-policies` | read: signed in; write: **O** | `{"name","table":null,"catalog_item":null,"order":100,"condition":"<expr>","actions":[{"field","mandatory":null,"visible":null,"read_only":null}]}` | 200 or 201 | |

`<variable>` is:

`{"name","label","type":"text"|"multiline"|"select"|"checkbox"|"date"|"number"|"reference","required":false,"default":null,"choices":[{"value","label","when":null|{"variable","equals"}}]}`

**Knowledge**

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| GET `/api/knowledge/articles?q=` | signed in | | 200 `{"articles":[{"number","title","score","valid_until"}]}`, ranked | |
| GET `/api/knowledge/suggest?text=` | signed in | | 200 `{"articles":[at most 3]}` | |
| GET `/api/knowledge/articles/<number>` | in audience | | 200 `{"article":{"number","version","title","body","keywords","state","valid_until","helpful_yes","helpful_no","audience"}}` | |
| POST `/api/knowledge/articles`, PUT `/api/knowledge/articles/<number>` | operator, technician | `{"title","body","keywords":[...],"valid_until":null,"audience":{"roles":[],"departments":[]}}` | 201 or 200 (editing a published article creates a new draft version) | |
| POST `/api/knowledge/articles/<number>/submit` | author | | 200 | 422 `illegal_transition` |
| POST `/api/knowledge/articles/<number>/approve`, `/retire` | **O** | | 200 | 422 `illegal_transition` |
| PUT `/api/knowledge/articles/<number>/vote` | signed in, in audience | `{"helpful":true\|false}` | 200 `{"helpful_yes","helpful_no"}` | |

**Rules, workflows and inbox**

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| GET or POST `/api/business-rules`, PUT `/api/business-rules/<name>` | **O** | `{"name","table","when":"before"\|"after"\|"background","order":100,"operations":["insert","update"],"condition":"<expr>","actions":[<action>],"active":true}` | 200 or 201 | 422 `expression_error`, `validation` |
| GET or POST `/api/access-rules`, PUT `/api/access-rules/<name>` | **O** | `{"name","type":"table"\|"row"\|"field","table","field":null,"operation":"read"\|"write","roles":[...],"condition":null,"active":true}` | 200 or 201 | 422 `expression_error`, `validation` |
| GET or POST `/api/assignment-rules` | **O** | `{"name","order":100,"table","condition":"<expr>","group","active":true}` | 200 or 201 | 422 `expression_error` |
| GET or POST `/api/workflows` | read: operator; write: **O** | `{"name","kind":"flow"\|"subflow","inputs":[{"name","type"}],"outputs":[{"name","expr"}]}` | 200 or 201 `{"workflow":{"id","name","kind","draft","versions":[n...]}}` | |
| PUT `/api/workflows/<id>/draft` | **O** | `{"steps":[<step json>]}` | 200 `{"workflow"}` | 422 `validation` |
| POST `/api/workflows/<id>/publish` | **O** | | 201 `{"version"}` | 422 `subflow_cycle`, `validation` |
| POST `/api/workflows/<id>/test-run` | **O** | `{"record":"<number>"}` | 201 `{"run"}` | |
| GET `/api/runs/<id>` | operator, technician | | 200 `{"run":{"id","workflow","version","record","status":"running"\|"waiting"\|"done"\|"failed","steps":[{"id","name","status","error"}]}}` | |
| POST `/api/runs/<id>/retry` | **O** | | 202 `{"run"}` | 409 `nothing_to_retry` |
| GET `/api/inbox` | signed in | | 200 `{"items":[{"id","event","text","record","at","read"}],"unread"}` | |
| POST `/api/inbox/<id>/read`, POST `/api/inbox/read-all` | signed in | | 200 `{"unread"}` | |
| PUT `/api/inbox/settings` | signed in | `{"digest":"immediate"\|"daily"}` | 200 | |
| GET or PUT `/api/inbox-rules` | **O** | `{"rules":[{"event","roles":[...],"enabled":true}]}` | 200 | |

`<step json>` is:

`{"id","type":"trigger"|"if"|"loop"|"approval"|"create_task"|"set_fields"|"wait"|"subflow"|"notify"|"end","name", ...type fields, "on_error":[<step json>]}`

The type fields are:
- trigger: `{"on":"record_created"|"record_updated"|"item_ordered","table","items":[catalog ids],"condition"}`
- if: `{"condition","then":[...],"else":[...]}`
- loop: `{"over":"<expr list>"|null,"until":"<expr>"|null,"body":[...]}`
- approval: `{"approvers":{"kind":"department_approvers"|"user","user":null},"rule":"any"|"all"}`. `department_approvers` means the active users with role approver in the department of the request item's requested-for person (the requester when `requested_for` is null), or, for a record that is not a request item, the department of its caller.
- create_task: `{"group","short_description","wait":true}`
- set_fields: `{"fields":{"<field>":"<expr>"}}`
- wait: `{"units":<n>}`
- subflow: `{"flow":"<name>","inputs":{"<name>":"<expr>"}}`
- notify: `{"to":{"users":[...],"roles":[...]},"text"}`

`<action>` is one of:
- `{"set":{"<field>":"<expr>"}}`
- `{"abort":"<message>"}`
- `{"work_note":"<text>"}`
- `{"inbox":{"to":{"users":[],"roles":[]},"text"}}`
- `{"update_record":{"path":"<reference path>","fields":{"<field>":"<expr>"}}}`

**Lists, reports, dashboards, files and configuration sets**

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| GET or POST `/api/filters` | signed in | `{"name","table","filter","shared":false}` | 200 or 201 | 422 `filter_too_complex` |
| POST `/api/filters/parse` | signed in | `{"table","filter"}` | 200 `{"builder":{"connector":"and"\|"or","groups":[{"connector","conditions":[{"path","op","value"}]}]},"filter":"<canonical text>"}` | 422 `filter_too_complex`, `unknown_field` |
| POST `/api/filters/compose` | signed in | `{"table","builder":{...}}` | 200 `{"filter":"<canonical text>"}` | 422 `unknown_field` |
| POST `/api/reports/aggregate` | desk roles and managers | `{"table","filter","group_by":null,"bucket":null\|"day"\|"week","date_field":null,"time_zone":null}` | 200 `{"groups":[{"key","label","count","filter"}],"total"}` | 422 `unknown_field` |
| GET `/api/dashboards/<id>` | desk roles and managers | | 200 `{"dashboard":{"id","name","time_zone","widgets":[{"id","title","kind":"count"\|"bar"\|"trend","table","filter","group_by","bucket","data":[{"key","label","count","filter"}],"total"}]}}` | |
| POST `/api/exports` | desk roles and managers | `{"table","filter","columns":[...]}` | 202 `{"export":{"id","status":"queued","rows_total","rows_done"}}` | 422 `unknown_field` |
| GET `/api/exports/<id>` | owner, operator | | 200 `{"export":{"id","status","rows_total","rows_done","error":null\|"storage_unavailable","key"}}` | |
| POST `/api/exports/<id>/retry` | owner, operator | | 202 `{"export"}` | 409 `not_failed`; 503 `storage_unavailable` |
| GET `/api/exports/<id>/file` | owner, operator | | 200 `text/csv` | 409 `not_complete`; 503 |
| POST `/api/imports` | **O** | multipart `file`, `table` (`people`\|`configuration_items`), optional `mapping` (JSON) | 201 `{"import":{"id","table","key","rows":[{"line","action":"create"\|"update"\|"unchanged"\|"error","key","errors":[...]}],"counts":{"create","update","unchanged","error"}}}` | 413 `too_large`; 422 `validation`; 503 |
| POST `/api/imports/<id>/commit` | **O** | | 200 `{"import":{...,"results":[{"line","outcome":"created"\|"updated"\|"unchanged"\|"failed","errors"}]}}` | 409 `already_committed` |
| GET or POST `/api/config-sets` | **O** | `{"name"}` | 201 `{"set":{"id","number","name","state":"open","items":[{"kind","name","deleted"}]}}` | 409 `set_already_open` |
| POST `/api/config-sets/<id>/export` | **O** | | 201 `{"set":{...,"state":"exported","key"}}` | 503 |
| POST `/api/config-sets/<id>/preview` | **O** | | 200 `{"items":[{"kind","name","action":"create"\|"update"\|"unchanged"\|"collision"\|"delete"}]}` | 409 `not_exported`; 503 |
| POST `/api/config-sets/upload` | **O** | multipart `file` | 201 `{"set"}`, an exported set read from the file | 422 `validation`; 503 |
| POST `/api/config-sets/<id>/commit` | **O** | `{"choices":{"<kind>:<name>":"take_set"\|"keep_live"}}` | 200 `{"set":{...,"state":"committed"},"applied":<n>}` | 409 `not_exported`; 422 `choice_required` |
| POST `/api/config-sets/<id>/backout` | **O** | | 200 `{"set":{...,"state":"backed_out"}}` | 409 `not_committed`, `later_set` |
| GET `/api/storage` | signed in | | 200 `{"storage":"available"\|"unavailable","queued_uploads"}` | |

**Live channel.** `GET /api/live` upgrades to a WebSocket on the same origin, authenticated by the session cookie.
- The client sends `{"subscribe":["<topic>",...]}` and `{"unsubscribe":[...]}`.
- The client sends `{"presence":"<number>"}` every 10 seconds while a form is open.
- The server sends `{"topic","event","data","server_time"}`.
- Topics: `record:<number>`, `presence:<number>`, `sla:<number>`, `list:<table>`, `major:<number>`, `votes:<change number>`, `approvals`, `run:<id>`, `dashboard:<id>`, `inbox`, `export:<id>`, `storage`, `session`.

Every committed change reaches each subscribed open page within 2 seconds. List change notices are batched for `LIVE_SETTLE_MS` before being sent.

**Grading route.** Every `/api/grading/*` request needs the header `X-Grading-Key` equal to the `GRADING_KEY` value. Without it, or with a wrong key, the answer is 404 `not_found`.

| Method and path | Request | Success |
|---|---|---|
| POST `/api/grading/reset` | | 200 `{"status":"reset"}`. Restores Seed data, deletes the app's objects in the bucket, restores settings to their environment values, removes any storage redirect, and returns the server clock to real time. |
| POST `/api/grading/clock` | `{"set":"<instant>"}` or `{"advance_seconds":<n>}` | 200 `{"server_time"}`. From the new instant the server clock runs forward in real time. Before answering, every background job due between the old and new instant has run in time order, so its inbox items, flags, escalations, closures, handovers and workflow waits are already visible. |
| POST `/api/grading/fixtures` | `{"departments":[],"people":[],"users":[],"groups":[],"schedules":[],"sla_definitions":[],"cis":[],"relationships":[],"maintenance":[],"rotations":[],"overrides":[],"escalation_policies":[],"assignment_rules":[],"business_rules":[],"access_rules":[],"form_policies":[],"catalog_items":[],"guides":[],"workflows":[],"boards":[],"freeze_windows":[],"delegations":[],"records":[],"votes":[],"knowledge_articles":[],"inbox_rules":[],"dashboards":[]}` (any subset) | 201 `{"created":{"<kind>":[{"id","name" or "number"}]}}` |
| POST `/api/grading/records/<number>/save` | `{"as":"<username>","fields":{"<field>":{"value","version"}}}` | The same answers as PATCH, as that user |
| POST `/api/grading/session` | `{"username"}` | 200, and sets the session cookie for that user |
| PUT `/api/grading/settings` | `{"<SETTING NAME>":<value>}` for any setting in Configuration and secrets except credentials | 200 `{"settings":{...}}`, effective at once |
| POST `/api/grading/storage` | `{"endpoint":"<url>"\|null}` | 200 `{"endpoint"}`. Points the storage client at another endpoint until it is set back to `null` (the configured `S3_ENDPOINT`). |

Fixture details. Every fixture object may add `"workspace":"test"` (the default is `live`). Members shown with a value are optional and default to that value. The members of each kind are:

| Kind | Members |
|---|---|
| `departments` | `{"name"}` |
| `people` | `{"username","display_name","department"}`, with no sign-in |
| `users` | `{"username","password","display_name","roles":[...],"department","time_zone","out_of_office":false,"capacity":null,"active":true}` |
| `groups` | `{"name","members":[usernames in order],"escalation_policy":null}` |
| `schedules` | `{"name","time_zone","hours":{"mon":[["08:00","17:00"]],...,"sun":[]},"holidays":["YYYY-MM-DD"]}` |
| `sla_definitions` | `{"name","table","start","pause","stop","schedule","targets":{"1":<seconds>,...,"5":<seconds>}}` |
| `cis` | `{"name","class","criticality","business_critical":false,"owner_department","status":"healthy","used_by":{"departments":[],"people":[]}, ...class attributes such as "required_healthy"}`; `used_by` applies to business services only |
| `relationships` | `{"source","type","target"}` |
| `maintenance` | `{"ci","start","end"}` |
| `rotations` | `{"name","time_zone","handover_weekday":"monday","handover_time":"09:00","members":[usernames],"anchor_date"}` |
| `overrides` | `{"rotation","username","start","end"}` |
| `escalation_policies` | `{"name","levels":[{"target":{"rotation":"<name>"}\|{"user":"<username>"},"ack_minutes":null}]}` |
| `assignment_rules` | `{"name","order":100,"table","condition","group","active":true}` |
| `business_rules` | `{"name","table","when","order":100,"operations":[...],"condition","actions":[<action>],"active":true}` |
| `access_rules` | `{"name","type","table","field":null,"operation","roles":[...],"condition":null,"active":true}` |
| `form_policies` | `{"name","table":null,"catalog_item":null,"order":100,"condition","actions":[{"field","mandatory":null,"visible":null,"read_only":null}]}` |
| `catalog_items` | `{"id","name","variables":[<variable>],"workflow"}` |
| `guides` | `{"id","name","questions":[<variable>],"rules":[{"item","condition"}]}` |
| `workflows` | `{"name","kind":"flow","inputs":[],"outputs":[],"draft":null,"published":[]}`; `published` is a list of step lists, `[[<step json>],...]`, which become versions 1, 2 and onward in list order; `draft` is a step list, and null means a copy of the last published steps (or empty when none) |
| `boards` | `{"name","rule","n":null,"threshold_percent":null,"window_hours":48,"members":[{"username","weight":1}]}` |
| `freeze_windows` | `{"name","start","end","time_zone","scope"}` |
| `delegations` | `{"member","delegate","from","to"}` |
| `records` | `{"table","fields":{...plain values},"state","created_at","state_history":[{"state","at"}],"parent":null,"problem":null,"created_by":null}`, numbered by the normal sequence; `created_by` null is recorded as `oona`. They skip transition checks and business rules, but SLAs attach and compute from the history, and a change in peer_review, board_vote or emergency board_vote has its open step opened at its last history time |
| `votes` | `{"change","step","username","decision","on_behalf_of":null,"at"}`; `step` is the step number from 1 |
| `knowledge_articles` | `{"title","body","keywords":[...],"valid_until":null,"audience":{"roles":[],"departments":[]},"state":"published","helpful_yes":0,"helpful_no":0,"author":null,"published_at":null}`, numbered by the `ART-` sequence; `state` is `draft`, `in_review`, `published` or `retired`; the helpful counts are stored totals with no per-person votes behind them; `author` null is recorded as `oona`; `published_at` null means the server time of the fixture when the state is published |
| `inbox_rules` | `{"event","roles":[...],"enabled"}`, each appended to the rule list exactly as one entry of `PUT /api/inbox-rules` |
| `dashboards` | `{"id","name","widgets":[{"id","title","kind":"count"\|"bar"\|"trend","table","filter","group_by":null,"bucket":null,"date_field":null}]}`; the `time_zone` that `GET /api/dashboards/<id>` returns is always the viewer's |

The whole fixture is one transaction: a validation error answers 422 with the normal body and creates nothing.

### Business rules (DP-05, DP-12 to DP-14, DP-16 to DP-19, DP-21, DP-22, DP-24 to DP-26, DP-29 to DP-31, DP-33 to DP-35, DP-37, DP-39 to DP-41, DP-44, DP-45, DP-47, DP-49 to DP-51, DP-53, DP-54, DP-56 to DP-58, DP-60 to DP-62, DP-64, DP-65)

**Time.** The server clock is the only clock that decides time-dependent state. It starts at real time and is moved only by the grading route. Every due-time, window, threshold, timer, handover and expiry is decided against it. The device clock may be wrong: the browser never decides from its own clock whether something is open, due, paused, breached, escalated, expired or closed. It shows the state the server last sent.

All displayed times use the format `YYYY-MM-DD HH:mm`:
- dashboards and forms: the viewer's time zone
- server messages: the zone named in the rule

**Local times and daylight saving.** A schedule or rotation time is a wall-clock time in its IANA zone. A wall time that does not exist (inside the spring gap) moves forward by the length of the gap; for example, 02:30 on 29 March 2026 in Europe/Berlin becomes 03:30. A wall time that occurs twice (in the autumn overlap) means its first occurrence.

**Expression language.** Every condition and every computed value in Switchyard is written in this language, and nothing else is evaluated.

- **Literals**: numbers (`3`, `2.5`); strings in double quotes, with `\"` and `\\` escapes; `true`; `false`; `null`; lists `[a, b]`.
- **Paths**: dot-separated field names, followed through reference fields, for example `caller.department.name`. Contexts also provide `variables.<name>` (catalog items), `answers.<name>` (order guides), `inputs.<name>` and `steps.<step id>.<output>` (workflows), and `previous.<field>` (business rules).
- **Operators**, from lowest to highest precedence:
  1. `or`
  2. `and`
  3. `not`
  4. comparisons `=`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `contains`, `startswith` (not chainable)
  5. `+`, `-`
  6. `*`, `/`
  7. unary `-`
  
  Parentheses group. Keywords are lowercase.
- **Functions**: `changes(path)`, `changes_to(path, value)`, `changes_from(path, value)`, `is_empty(x)`, `len(x)`, `lower(s)`, `upper(s)`, `now()`, `me()` (the signed-in username), `has_role(role)`, `business_days_since(path)`.
- **Types**: comparing values of different types is false, except that a string compared with a date or time field is read as an ISO instant. `null = null` is true. An unknown path, or a path to a field the evaluating person may not read, is an error at save time.
- **Errors**: a malformed expression is refused with 422 `expression_error`, message `Expression error at column <c>: <reason>.` `<c>` counts from 1. `<reason>` is one of `unexpected "<token>"`, `unknown field "<path>"`, `unknown function "<name>"`, `expected ")"`, `expected a value`. Only the leftmost error is reported, and syntax errors come before unknown fields and functions. `<c>` is the position of a character in the whole expression text, trailing spaces included:
  - `unexpected "<token>"` points at the first character of that token. It is used when a token cannot continue the expression, for example `priority = 1 2` gives column 14. An unterminated string gives `unexpected "\""` at its opening quote.
  - `unknown field "<path>"` points at the first character of the path, for example `nosuch = 1` gives column 1.
  - `unknown function "<name>"` points at the first character of the name, for example `frob(1)` gives column 1.
  - `expected a value` points at the first character of the token that cannot start a value, or one past the end of the text when the text ends, for example `priority = = 1` gives column 12.
  - `expected ")"` points at the first character of the token found instead of `)`, or one past the end of the text when the text ends, for example `(priority = 1` gives column 14.

**Filter text.** Lists, saved filters, drill-downs and exports use filter text, which is a subset of the expression language:

`filter = group { connector group }`, with one connector used throughout
`group = condition | "(" condition { connector condition } ")"`, with one connector inside each group
`condition = path op value | "is_empty(" path ")" | "not is_empty(" path ")"`
`op = "=" | "!=" | "<" | "<=" | ">" | ">=" | "contains" | "startswith" | "in"`
`connector = "and" | "or"`

Canonical form:
- One group is written without parentheses.
- A connector with nothing to join is normalised to `and`: a filter with one group has top-level connector `and`, and a group with one condition has connector `and`. Parsing text gives `and` in both places, composing ignores such a connector, and the builder sets the matching radio (`All groups` or `All conditions`) whenever the top level has one group or a group has one condition. So builder, text and rebuilt builder always agree.
- Two or more groups each sit in parentheses, even with one condition.
- Operators and connectors have exactly one space on each side.
- Strings are double-quoted, and lists are written `["a", "b"]`.
- `value` is a number, a string, `true`, `false`, `null`, a list of those, or `me()`. Numbers are written without a plus sign or leading zeros, with a decimal point only when fractional (`2.50` becomes `2.5`). `true`, `false` and `null` are lowercase. `me()` is written `me()`. Dates and times are strings and are kept as typed.
- The Filter text box always shows canonical text. Stored text (saved queues, drill-down links) is kept as stored and is rewritten canonically when shown. For example, the seeded `My work` queue shows `(assigned_to.username = me()) and (state in ["new", "assigned", "in_progress", "on_hold"])`, and a drill-down for the 4 November 2026 bucket in Europe/Berlin shows `(created_at >= "2026-11-04T00:00:00+01:00") and (created_at < "2026-11-05T00:00:00+01:00")`.

The builder and the text round-trip exactly: building, then reading the text, then rebuilding gives the same builder and the same canonical text. Text outside the subset is refused with 422 `filter_too_complex`, message `This filter cannot be shown in the builder.` An empty filter matches every record.

**Record numbers.** A record gets its number in the same transaction that first saves it. A rejected or aborted save uses no number, so sequences never have gaps. Each sequence is zero-padded to six digits.

| Type | Prefix | Example |
|---|---|---|
| Incident | `BRK-` | `BRK-000004` |
| Problem | `ROOT-` | `ROOT-000002` |
| Change | `ALT-` | `ALT-000002` |
| Request | `ASK-` | `ASK-000001` |
| Request item | `ITM-` | `ITM-000001` |
| Task | `JOB-` | `JOB-000001` |
| Knowledge article | `ART-` | `ART-000006` |
| Configuration set | `SET-` | `SET-000001` |

**Transition messages** (422, one shape for all five types):
- `illegal_transition`: `Cannot move <type> from <from label> to <to label>.` `<type>` is `incident`, `problem`, `change`, `request item` or `task`.
- `role_not_allowed`: `Your role cannot move this <type> to <to label>.`
- `field_required`: `<field label> is required to move to <to label>.`, with `fields` naming the field. Only the first missing field in table order is reported.

**Incident fields and labels.**

| Field | Label |
|---|---|
| `short_description` | Short description (required at creation, 1 to 160 characters) |
| `description` | Description |
| `caller` | Caller |
| `affected_person` | Affected person |
| `configuration_item` | Service or item |
| `impact` | Impact (1 High, 2 Medium, 3 Low) |
| `urgency` | Urgency (same scale) |
| `priority` | Priority |
| `assignment_group` | Assignment group |
| `assigned_to` | Assigned to |
| `hold_reason` | Hold reason (`awaiting_requester`, `awaiting_supplier`, `awaiting_change`) |
| `resolution_code` | Resolution code (`fixed`, `workaround_given`, `no_fault_found`, `duplicate`) |
| `resolution_note` | Resolution note |
| `reopen_reason` | Reopen reason |
| `cancel_reason` | Cancel reason |
| `confidential` | Confidential |
| `is_major` | Major incident |
| `parent` | Parent |
| `problem` | Problem |
| `sla_breached` | SLA breached (derived) |
| `created_at`, `resolved_at` | Created, Resolved |

**Field values.** Everywhere a field's `value` appears (requests, responses, fixtures, filters, expressions) it is plain:
- numbers for impact, urgency, priority and quantity;
- `true` or `false` for checkboxes;
- ISO instants with offset for times;
- for reference fields a string: `caller`, `affected_person`, `assigned_to` and `requested_for` take a username; `configuration_item` takes an item name; `assignment_group` takes a group name; `parent`, `problem`, `fix_change` and `request` take a record number.

An empty field is `null`. `display` is the readable text: a display name, item name, group name or record number.

**Problem fields.** `short_description` (Short description, 1 to 160 characters, required), `description`, `configuration_item` (Service or item), `impact` and `urgency` (default 2 and 2), `priority`, `assignment_group`, `assigned_to`, `workaround` (Workaround), `fix_change` (Fix change), `cancel_reason`, `created_at`, `resolved_at`. Priority follows the priority matrix below.

**Request item fields.** `request` (Request), `item` (Catalog item, a catalog item id), `quantity`, `variables` (Variables, an object keyed by variable name), `requested_for` (Requested for), `impact` and `urgency` (defaults in the priority rules), `priority`, `assignment_group`, `assigned_to`, `cancel_reason`. Its `short_description` is the catalog item's name and is read-only.

**Task fields.** `short_description` (Short description), `description`, `parent` (the request item or other record it belongs to), `assignment_group`, `assigned_to`, `close_note` (Close note), `cancel_reason`, and a read-only `priority` copied from its parent when it is created (4 when it has no parent).

**Change priority.** A change has a read-only `priority`: 5 before its first risk score, then 4 for Low, 3 for Moderate and 2 for High, and 1 for an emergency change. Labels of fields not named in a table are the field name in sentence case with spaces.

**Incident states** and their labels: `new` New, `assigned` Assigned, `in_progress` In progress, `on_hold` On hold, `resolved` Resolved, `closed` Closed, `cancelled` Cancelled.

| From | To | Roles | Required fields |
|---|---|---|---|
| new | assigned | operator, technician | assigned_to |
| new, assigned | in_progress | operator, technician | assigned_to |
| in_progress | on_hold | operator, technician | hold_reason |
| on_hold | in_progress | operator, technician | none |
| in_progress | resolved | operator, technician | resolution_code, resolution_note |
| resolved | in_progress | operator, technician, the caller | reopen_reason |
| resolved | closed | operator | none |
| new, assigned, in_progress, on_hold | cancelled | operator | cancel_reason |

Automatic moves and related rules:
- A comment from the caller on an incident that is on hold with hold reason `awaiting_requester` moves it to in_progress automatically.
- The **reopen deadline** of a resolved incident is the instant with the same local wall time as `resolved_at` (the daylight saving rule above applies) on the 5th open day after the local date of `resolved_at`, in the zone of the `Office hours` schedule. An open day is a local date that is not a holiday and has opening hours on that schedule. The date of `resolved_at` itself is never counted, and each of the 5 days counts whole, whatever the hour. A reopen is allowed at the deadline and before it. After it, the answer is 422 `reopen_window_passed`, message `This incident was resolved more than 5 business days ago and cannot be reopened.`
- A resolved incident closes automatically at the first server-clock instant after its reopen deadline, so at exactly the deadline it is still Resolved and can be reopened.
- Every other pair of states answers `illegal_transition`.

**Problem states**: `new` New, `assessing` Assessing, `known_error` Known error, `fix_in_progress` Fix in progress, `resolved` Resolved, `closed` Closed, `cancelled` Cancelled.

| From | To | Roles | Required |
|---|---|---|---|
| new | assessing | operator, technician | none |
| assessing | known_error | operator, technician | workaround |
| assessing, known_error | fix_in_progress | operator | fix_change |
| fix_in_progress | resolved | operator | the fix change is Done |
| resolved | closed | operator | no linked open incidents |
| new, assessing, known_error, fix_in_progress | cancelled | operator | cancel_reason |

Problem rules:
- When the linked fix change reaches Done with outcome `successful`, the problem moves to resolved automatically, with the activity line `Resolved by fix change <change number>.`
- Resolving by hand before the fix change is done answers 422 `fix_not_done`, message `The fix change <change number> is not done yet.`
- Closing while linked incidents are still open (not resolved, closed or cancelled) answers 422 `open_incidents`, message `Resolve or close the <n> linked open incidents before closing this problem.`
- Publishing a workaround stores it on the problem. Within 2 seconds it shows in the workaround region of every linked open incident, and each of their assignees gets an inbox item.

**Change states**: `draft` Draft, `assessed` Assessed, `peer_review` Peer review, `board_vote` Board vote, `approved` Approved, `rejected` Rejected, `implementing` Implementing, `done` Done, `cancelled` Cancelled.

Change fields: `title`, `model` (`normal`, `standard`, `emergency`), `configuration_item`, `planned_start`, `planned_end`, `implementation_plan`, `backout_plan`, `backout_tested`, `standard_template`, `freeze_override_reason`, `outcome` (`successful`, `failed`, `backed_out`), `close_note`, `cancel_reason`. Labels are the field name in sentence case with spaces, for example `Planned start`.

| Model | From | To | Roles | Required |
|---|---|---|---|---|
| normal | draft | assessed | operator | configuration_item, planned_start, planned_end, implementation_plan, backout_plan |
| normal | assessed | peer_review | operator | none (submit) |
| normal | peer_review | board_vote | system, when Department sign-off passes and the band is Moderate or High | |
| normal | peer_review | approved | system, when Department sign-off passes and the band is Low | |
| normal | board_vote | approved | system, when the board step passes | |
| normal | peer_review, board_vote | rejected | system, when the open step fails | |
| normal | rejected | assessed | operator | none (revise) |
| emergency | draft | board_vote | operator | the normal draft fields |
| emergency | board_vote | approved or rejected | system | |
| standard | draft | approved | operator | standard_template, configuration_item, planned_start, planned_end |
| all | approved | implementing | operator | none |
| all | implementing | done | operator | outcome, close_note |
| all | any state before implementing | cancelled | operator | cancel_reason |

Freeze and overlap checks run on draft to assessed, on draft to board_vote (emergency), on draft to approved (standard), and on every submit.

**Change risk score.** Computed on assessment and again whenever a risk input changes:

score = 3 × criticality + 2 × people band + (0 if backout tested, otherwise 4) + (2 if the planned window overlaps open hours of the office hours schedule, otherwise 0) + 3 × min(failed changes in 90 days, 2) + (2 if the duration is more than 4 hours, otherwise 0)

- criticality: the change item's criticality, 1 to 3.
- people band: computed from the item's impact as if it were down. 0 people gives band 0, 1 to 10 gives 1, 11 to 50 gives 2, and more than 50 gives 3.
- failed changes in 90 days: Done changes on the same item with outcome `failed` or `backed_out` whose planned end falls in the 90 days before this change's planned start.
- duration: planned end minus planned start. Exactly 4 hours scores 0.
- Bands: 0 to 9 is `Low`, 10 to 17 is `Moderate`, 18 or more is `High`.

**Approval steps.**
- Normal changes start with step 1, `Department sign-off`. Its voters are the approvers of every department that uses a business service in the item's impact (as if it were down), plus the approvers of the item's owner department. Its rule is any, and its window is 48 hours.
- Moderate and High changes add step 2, `Change board`, with the seeded Change board's members, rule and window.
- Emergency changes have one step, `Emergency board`, using the Emergency board.
- A step opens when the change enters its state, and it closes at `opens_at` plus the window.

**Freeze windows.** A freeze covers a change when its scope includes the change's item (scope `all`, or a listed item, or any item a listed item depends on, transitively). It applies when the windows overlap: change start before freeze end, and freeze start before change end. Ends are exclusive. The refusal is 422 `freeze`, message `This change falls inside the freeze "<freeze name>" (<start> to <end>).` The times are in the freeze's zone. Only emergency changes may pass a freeze, and then `freeze_override_reason` is required.

**Calendar days.** The change calendar cuts days in the business time zone. A change counts on a local day when its window from `planned_start` to `planned_end` overlaps that day (midnight to the next midnight) and its end is exclusive, so a change ending exactly at midnight does not count on the next day, and a multi-day change counts on every day it touches. Only changes in assessed, peer_review, board_vote, approved, implementing or done count; draft, rejected and cancelled changes never appear. A day lists a freeze, and shows the word `Freeze`, when that freeze window overlaps the day by the same exclusive-end rule; `freezes` is sorted by name. A day cell's name ends `<n> changes`, written `1 change` when n is 1.

**Overlaps.** Another change in assessed, peer_review, board_vote, approved or implementing overlaps when its window overlaps and one of these holds:
- It is on the same item. Message: `This change overlaps <number> on <item> (<start> to <end>).`
- It is on an item this change's item depends on (dependency relationships, transitively). Message: `This change overlaps <number> on <other item>, which <this item> depends on (<start> to <end>).`
- It is on an item that depends on this change's item. Message: `This change overlaps <number> on <other item>, which depends on <this item> (<start> to <end>).`

All three answer 422 `overlap`, in the business time zone.

**Locked fields.** The locked fields are configuration_item, planned_start, planned_end, implementation_plan and backout_plan. Changing one while the change is in peer_review, board_vote or approved does the following in the same transaction:
- returns it to assessed
- sets every step to `not_started` and voids its votes
- recomputes risk
- writes the activity line `Approval reset because <field label> changed.`
- sends the approval-reset inbox item to the voters

Within 2 seconds, open approval screens drop the vote card.

**Quorum rules.** Each step is decided as soon as its outcome is certain. Here `a` and `r` are approve and reject counts, `m` is the number of voters, `A` and `R` are approve and reject weights, `T` is the total weight, and `t` is `threshold_percent`.

| Rule | Approved when | Rejected when |
|---|---|---|
| all | every voter approved | the first rejection |
| any | the first approval | every voter rejected |
| n_of_m | a ≥ n | r > m − n |
| weighted | 100 × A ≥ t × T | 100 × (T − R) < t × T |

- For the weighted rule, `needed` in the tally is the smallest whole weight N with 100 × N ≥ t × T.
- When the window closes undecided, the step is rejected with the activity line `Vote closed without reaching quorum.`
- The operator may close a step early. It is then decided as at window close.
- When step k rejects, the change becomes rejected, and every later step returns to `not_started` with its votes voided. On resubmission, approval restarts at step k, and steps before k keep their approval unless a locked field changed.

**Votes.**
- Each voter votes once per step opening. A second vote by the same voter, or by their delegate on their behalf, answers 409 `already_voted`, message `<display name> has already voted on this step.`
- A vote after `closes_at` (server clock), or on a decided step, answers 409 `vote_closed`, message `This vote closed at <closes_at>.`, in the business time zone.
- A vote by someone who is neither a voter nor an active delegate answers 403 `not_a_voter`, message `You are not a voter on this step.`
- A delegate votes with `on_behalf_of` set to the member, while the delegation's from-to period contains the server time. The vote counts once, with the member's weight, recorded as voted by the delegate. A delegate who is also a voter votes separately for themself.

**Priority.** Impact and urgency give priority through this table:

| | Urgency 1 | Urgency 2 | Urgency 3 |
|---|---|---|---|
| Impact 1 | 1 | 2 | 3 |
| Impact 2 | 2 | 3 | 4 |
| Impact 3 | 3 | 4 | 5 |

Priority labels: 1 Critical, 2 High, 3 Moderate, 4 Low, 5 Planning.
- When the record's item is business-critical, priority goes up one level (1 stays 1).
- Request items use the same table and default to impact 3, urgency 2.
- Only the operator may override priority. An override needs a reason of 1 to 500 characters, shows the badge `Priority overridden`, writes an audit entry (field `priority`, with the reason in `reason`), and freezes priority until the override is removed.
- Priority is read-only once resolved.

**SLA engine.**
- An SLA definition attaches to a record the first time its start condition is true on a save, with `start_at` set to that save's server time. Its target is the one for the record's priority at that moment.
- **Running time** is the interval from `start_at` to now, minus every interval in which the pause condition was true and every interval in which the stop condition was true, all taken from the record's state history.
- **Elapsed business time**: the length of the running time that falls inside the schedule's open windows, in seconds. Open windows are found day by day in the schedule's zone: each local date that is not a holiday opens at its local opening wall time and closes at its local closing wall time, each converted to an instant for that date. So on 27 March 2026, 08:00 in Europe/Berlin is 07:00 UTC, and on 30 March 2026 it is 06:00 UTC. A 24-hour schedule counts real elapsed time: its 29 March 2026 has 23 hours, and its 25 October 2026 has 25.
- **paused_seconds**: the business time that fell inside pause intervals.
- **remaining_seconds** = target − elapsed (negative once breached).
- **percent** = floor(elapsed × 100 ÷ target).
- **Breach**: the first time elapsed reaches the target, `breached` becomes true and stays true, and the record's `sla_breached` becomes true.
- **Stop**: when the stop condition becomes true, the stage becomes `completed`.
- **Reopen**: when the record leaves the stop condition (a reopen), the same SLA resumes at the elapsed time it had when it stopped. The time spent stopped never counts, and the breach flag keeps its value.
- **Priority change**: the SLA for the old priority becomes `cancelled`. A cancelled SLA stays in the API's `slas` list but never shows in an SLA region, so a record has at most one non-cancelled SLA per definition and each SLA region shows at most one progressbar per definition name. A new SLA for the new priority attaches with the original `start_at`, so the pause and stop intervals already recorded still apply and its elapsed value equals the old one. Thresholds the new SLA has already passed when it attaches are marked reached, and only the highest of them sends its action. A breach that is already true sets the flag and sends the breach action.
- **ticking** is true when the SLA is in progress and the server time is inside an open window. **next_change_at** is the next instant at which ticking would change (the closing time, the next opening time) if nothing else happens. It is null when ticking can never change by itself: a stage other than `in_progress`, or a schedule that is open all day on every day with no holiday ahead.
- **Shown SLA.** A row label, a card name and the `sla` member of a record summary use one SLA of the record: among its SLAs in stage `in_progress` or `paused`, the one with the highest `percent`, ties going to the definition whose name comes first in code-point order. When the record has none, `sla` is null and the label ends `, no SLA`. The grid's SLA column shows the same SLA's countdown.
- **Threshold actions** fire once each, at the exact instant each threshold is reached, whether real time passes or the clock is advanced:
  - 50 percent sends an inbox item to the assignee.
  - 75 percent sends one to the assignee and to the managers of the caller's department.
  - 100 percent sets the breach flag and sends one to the assignee, those managers and the operator.
  
  The texts are under Inbox below.
- The server re-evaluates SLAs on every save, on every clock change and once per real second, and pushes a fresh `<sla>` to subscribed pages on every change of stage, ticking, threshold or breach.

**Browser countdown.** When a page receives an `<sla>`, it records the browser's monotonic time at receipt. It then shows, once per second:
- shown remaining = remaining_seconds − min(seconds since receipt, next_change_at − server_time) when `ticking` is true and `next_change_at` is set; when `next_change_at` is null the minimum is just the seconds since receipt
- shown remaining = remaining_seconds when `ticking` is false

When the shown value reaches zero, the page keeps showing `0:00:00 left` until the server sends the breach. Queue rows, the form and the portal all use this same formula on the same server values.

**Assignment.**
- Assignment rules run when a record is created with no group and no assignee, and when someone asks for assignment by rules.
- Active rules for the table are tried in ascending `order`, with ties broken by name in code-point order. The first rule whose condition is true sets `assignment_group`.
- Within the group, the round-robin pointer moves to the next member in member order after the one assigned last, wrapping round.
- A member is skipped when inactive, out of office, or already holding open records equal to their capacity (`capacity`, or `ASSIGNMENT_CAPACITY` when that is null). Open means not resolved, closed, cancelled or done.
- Success writes the activity line `Assigned to <display name> by rule "<rule name>".`
- When no member fits, the group becomes `Triage` with nobody assigned, and the activity line is `No one in <group> could take <number>; sent to Triage.`

**Rotations.**
- A rotation's shifts start at its handover weekday and handover time, local to its zone, every week from `anchor_date`. The first member takes the shift starting on the anchor date, and each later shift goes to the next member, wrapping round.
- Handover keeps the 09:00 wall time across daylight saving changes. In Europe/Berlin the shift from Monday 23 March 2026 09:00 lasts 167 hours, and the one from Monday 19 October 2026 09:00 lasts 169 hours.
- An override covering an instant takes precedence. Where overrides overlap, the most recently created one wins.

**Escalation ladder.**
- A page starts at level 1 at its creation time. Each level notifies its target: the rotation's on-call person at that instant, or the named user.
- If nobody acknowledges by `notified_at` plus that level's `ack_minutes` (or `ONCALL_ACK_MINUTES`), the next level is notified at exactly that instant.
- After the last level's timer, the page becomes `exhausted`, and the operator gets an inbox item.
- A page starts automatically when an incident reaches priority 1 and its assignment group has an escalation policy.
- Any person notified at any level so far, or the operator, may acknowledge, and that stops the ladder. An acknowledge from the current level's person writes `Acknowledged by <display name> at level <n>.`
- An acknowledge from an earlier level's person, or one arriving after exhaustion, is still recorded and stops the ladder. It sets `late` to true and writes `Late acknowledge from <display name> at level <k>; paging had reached level <current>.`
- Acknowledging an acknowledged page answers 409 `already_acknowledged`, message `Already acknowledged by <display name>.` Someone never paged gets 403 `not_paged`, message `You were not paged for this.`

**Configuration item classes.**

| Class | Parent | Own attributes |
|---|---|---|
| Configuration item | none | name, criticality (1 to 3), business_critical, owner_department, status |
| Business service | Configuration item | used_by (departments and people) |
| Application | Configuration item | version |
| Server | Configuration item | operating_system, location |
| Virtual server | Server | host_name |
| Cluster | Configuration item | required_healthy (N) |
| Network device | Configuration item | location |
| Storage | Configuration item | capacity_gb |

A class has every attribute of its ancestors plus its own, and a class may not redefine an inherited attribute. Item names are unique, compared case-insensitively.

**Relationships.** The type list is closed: `depends on`, `runs on`, `hosted by`, `member of`, `connects to`, `backs up`.
- "X depends on Y" means X needs Y.
- `depends on`, `runs on` and `hosted by` are the dependency relationships.
- `member of` links a member to a cluster.
- `connects to` and `backs up` never affect status.
- A new dependency relationship from X to Y that would close a loop through existing dependency relationships answers 422 `cycle`, message `This relationship would form a dependency loop: X -> Y -> ... -> X.` It names every item on the loop, starting and ending at X.

**Map layout.**
- Layout edges are the dependency relationships plus, for each `member of`, an edge from the cluster to the member.
- An item with no outgoing layout edge is in layer 0. Any other item's layer is 1 + the highest layer of its targets.
- Rows go from the highest layer at the top to layer 0 at the bottom.
- Within a row, nodes are ordered by criticality descending, then name in case-insensitive code-point order.
- Each node is 160 by 64 units. `x` = 40 + 200 × (position in row, from 0), and `y` = 40 + 120 × (highest layer − layer). Each node's element carries these as integer `data-x` and `data-y`.

**Effective status.**
- An item's effective status is the worst of its own declared status and the status it inherits. Worst-to-best order is down, degraded, healthy.
- An item inherits down if any dependency target is effectively down, and degraded if any is effectively degraded.
- A cluster also takes a status from its members. With H members effectively healthy out of M, it is healthy when H = M, degraded when N ≤ H < M, and down when H < N.
- An item inside an active maintenance window (server clock) shows `maintenance`, and dependents treat it as healthy, so nothing spreads past it.
- Status labels are Healthy, Degraded, Down and In maintenance.
- The map node's accessible name, its visible status word and the map `status` all use the effective status, so an item reached by an outage reads `Down` or `Degraded`, and an item in an active maintenance window reads `In maintenance`.

**Impact.**
- The affected set of an item marked down or degraded is every item whose effective status is down because of it, not counting the item itself. Items that are degraded because of it are listed separately and never add people.
- The people of a business service are the members of its `used_by` departments plus its `used_by` people. People affected is the set of distinct usernames across the failed item (when it is a business service; this is `base_people`) and every affected business service, so each person counts once.
- **Traversal order** is depth-first, preorder, from the failed item along dependents (items that depend on, run on, are hosted by, or have as a member the current item, where a cluster's members count as its dependency for this walk). Each item's dependents are visited by criticality descending, then name case-insensitively. Each item appears once, at the first path that reaches it.
- `path` lists the relationship types from the affected item down to the failed item. `running_people` is the distinct-people count over `base_people` and every panel up to and including this one, and `people_added` is the increase over the previous panel.
- Tier is 1 for business-critical items, 2 for criticality 3, and 3 otherwise.
- The relay shows at most 8 panels. With more than 8 affected items, it shows the first 7, then one panel `and <n> more` that lists the rest and carries the final total.

**Major incidents.**
- An outage proposes a major incident when its impact has at least `MAJOR_PROPOSAL_SERVICES` business-critical business services down, or at least `MAJOR_PROPOSAL_INCIDENTS` open incidents on affected items.
- The proposal's `reason` reads `<n> business-critical services affected` or `<n> open incidents on affected items`, using the first condition that holds in that order.
- Promotion creates an incident with `is_major` true, short description `Outage: <item name>`, the failed item, priority 1 and state new, and links every open incident on the failed or affected items as a child.
- **Resolve together**: moving a major incident to resolved also moves every child that is not resolved, closed or cancelled to resolved in the same transaction, from any open state. Each child gets the parent's resolution code and the resolution note `Resolved with major incident <parent number>: <parent note>`. Each child's business rules run. If any child fails, nothing changes, and the answer is 422 `child_failed`, message `Child <number> could not be resolved: <reason>.`
- A child may be reopened alone, and the parent is unchanged.
- The timeline lists the parent's work notes, state changes, linked children and resolutions, newest first. It reaches every open page within 2 seconds.

**Catalog.**
- A select's offered choices are those whose `when` is null or matches the current value of the named variable.
- A submitted value outside the offered choices answers 422 with field `<variable>`, message `<label> must be one of <labels joined by ", ">.`
- An order guide's items are those whose rule condition is true for the answers, in rule order.
- **Checkout** creates one request (state Open), one request item per cart line (carrying its quantity and variables) and a run of the item's workflow (its current published version). It then empties the cart.
- **Idempotency**: a checkout with an `Idempotency-Key` stores its response for 24 hours. The same key with the same body returns the stored response. The same key with a different body answers 409 `idempotency_conflict`, message `This key was already used for a different request.`
- An empty cart answers 422 `empty_cart`, message `Your cart is empty.`
- A request has two states, `open` (Open) and `closed` (Closed). It is `open` from checkout, and becomes `closed` at the moment every item is delivered, closed, rejected or cancelled.

**Request item states**: `submitted` Submitted, `awaiting_approval` Awaiting approval, `approved` Approved, `rejected` Rejected, `fulfilling` Fulfilling, `delivered` Delivered, `closed` Closed, `cancelled` Cancelled.
- System moves (done by the item's workflow): submitted to awaiting_approval (at an approval step) or to fulfilling; awaiting_approval to approved, then fulfilling, or to rejected; fulfilling to delivered.
- Manual moves: delivered to closed (operator); submitted or awaiting_approval to cancelled (operator, or the requester, with cancel_reason).

**Task states**: `open` Open, `in_progress` In progress, `done` Done, `cancelled` Cancelled.
- open to in_progress: operator or technician.
- in_progress to done: operator or technician, requiring close_note.
- open or in_progress to cancelled: operator, requiring cancel_reason.

**Form policies.**
- Policies for a table or catalog item apply in ascending `order`. A later policy's action on the same field and property wins.
- The browser re-applies them within half a second of any field change, using the same published policies.
- On every save the server applies them to the submitted values:
  - A mandatory field that is empty answers 422 with field message `<label> is required.`
  - A read-only field whose submitted value differs from the stored value (or from its default, on create) answers 422 `<label> is read-only.`
  - A hidden field's submitted value is discarded.

**Business rules.**
- Order of execution: before rules, then the save, then after rules in the same transaction, then background rules after commit. Within each timing, rules run by ascending order, then name in code-point order.
- Change detection compares the saved values with the values before this save. `changes(f)` is true when they differ (on insert, when the new value is not empty). `changes_to(f, v)` and `changes_from(f, v)` also require the new or old value to equal `v`.
- An `abort` action is allowed only in before rules (a rule save otherwise answers 422 `validation`, `Only before rules can abort.`). It rejects the save with 422 `aborted` and the rule's message, using no number.
- `update_record` actions start nested saves that run rules again. The original save is depth 1. A save that would exceed `BUSINESS_RULE_DEPTH_LIMIT` rolls everything back with 422 `rule_depth`, message `Business rules stopped after <limit> nested updates at rule "<name>".`
- A failing background rule writes the activity line `Background rule "<name>" failed: <message>.`

**Field versions.**
- Every field starts at version 1 and gains 1 on each change.
- A save names the version it last saw for each field it changes. When every named version is current, all fields apply.
- When any named field's version is older, nothing applies, and the answer is 409 `field_conflict` with every stale field.
- Two people saving different fields therefore both succeed.
- Work notes and comments never conflict and always append.
- Every applied field change writes an audit entry with before and after values, the actor, and the person impersonated if any.

**Presence.** An open form registers presence through the live channel every 10 seconds. A person drops from "Also viewing" `PRESENCE_TIMEOUT_SECONDS` after their last heartbeat, or at once when they close the form.

**Access.**
- The baseline grants come first:

| Role | Can see and do |
|---|---|
| operator | everything |
| technician | read and write incidents, problems, tasks, request items; read changes, items, knowledge; work their pages |
| requester | read their own incidents, requests and items (caller or requested-for), the requester fields (number, short description, description, state, priority, comments, SLA, attachments, caller), and knowledge in their audience; create incidents and requests; comment |
| approver | the requester grants, plus reading changes and voting |
| manager | the requester grants, plus reading records whose caller is in their department, items, the service map, major incidents and dashboards |

- Then access rules (all deny rules, active ones only) apply in this order: table rules, then row rules, then field rules. Any matching rule denies. Rules never apply to the operator.
- A record outside the baseline or denied by a row rule answers 404 `not_found` on every endpoint.
- Writing a field the baseline or a field rule denies, on a visible record, answers 403 `field_denied`, message `You cannot change <field label>.`
- A table write denial answers 403 `denied`, message `You cannot change <table label> records.`
- A denied field or row is left out of every derived surface: list rows and columns, forms, search matches (its text is not searched), activity and audit lines about that field, report aggregates, dashboard totals, exports and group counts.
- Filtering, sorting or grouping by a denied field answers 422 `unknown_field`, message `Unknown field "<path>".`, which is the same answer as for a field that does not exist.
- Role and rule changes take effect on the next request. Open pages of affected people receive the change within 2 seconds, and denied fields and records vanish without a reload.
- Impersonation makes the operator's session act as the chosen user. It writes audit-log entries `impersonation_started` and `impersonation_stopped` (read through `GET /api/audit-log`), and every action meanwhile records both people.

**Knowledge.**
- An article version moves draft, then in_review, then published, then retired. Approve publishes; retire retires.
- Search covers published versions whose audience includes the caller (empty audience means everyone) and whose `valid_until` is empty or not before today's date in the business time zone.
- Tokens are the lowercase runs of letters and digits, at least 3 characters long, excluding `the`, `and`, `for`, `with`, `not`, `from`, `this`, `that`, `are`, `was`, `has`, `have`, `you`, `your`, `can`, `cannot`.
- With T, K and B the numbers of distinct query tokens found among the title, keyword and body tokens (exact match), score = 5 × T + 2 × K + B + min(max(helpful yes − helpful no, 0), 5).
- Only articles with T + K + B ≥ 1 appear. They are ranked by score descending, then publish time descending, then number ascending.
- Suggestions apply the same formula to the short description and return the top 3, refreshed 300 milliseconds after typing stops.
- Each person has one helpful vote per article version, and may change it.

**Lists.**
- **Text search.** `q` on a list and `GET /api/search` match the trimmed query, case-insensitively, as a substring of the number, `short_description` or `description` of records the caller can see. A field the caller may not read is not searched. List results follow the list's sort. `/api/search` returns at most 20 records (by number in code-point order) and at most 10 articles (ranked as in Knowledge).
- **Default order.** With no `sort`, lists sort by `number` and `dir` is `asc`. Approval cards go by `closes_at` ascending (catalog approvals, which have none, last), then record number ascending. Board agenda items go by `planned_start` ascending, then change number. Activity entries, audit entries, the timeline, pages and inbox items go newest first, ties by later insertion first. The top card of the approvals stack is the first of its order, and the next card is the one after it.
- **Group values.** With `group_by`, `value` is the field's plain value, `label` is the text shown, and `filter` is the canonical filter text of just that group (not the list's own filter). Priority groups have a numeric value with label `<n> <priority label>`, for example value 1, label `1 Critical`, filter `priority = 1`. Impact and urgency groups have labels `1 High`, `2 Medium` and `3 Low`. State groups use the state label and a filter such as `state = "on_hold"`. Reference groups use the display text and a filter such as `assigned_to = "teodor"`. Checkbox groups are labelled `Yes` and `No`. Records with no value form one group with value null, label `(empty)` and filter `is_empty(<path>)`. Groups are ordered by value ascending (numbers numerically, text in code-point order), the empty group last.
- Page size is `LIST_PAGE_SIZE`.
- Sorting uses the chosen column, then number ascending as the tie-break, so the pages never repeat or skip a record.
- Group counts are computed by the server after access rules.
- A bulk update applies each record separately, with the same checks as PATCH (the current versions are used). Each failure reports the API message as `<reason>`.

**Dashboards.**
- Widgets compute on the server after access rules, as the viewer.
- `trend` widgets bucket by local day (or week starting Monday) in the viewer's time zone. Every trend widget has exactly 14 buckets, oldest first: the last bucket is the local day (or week) that contains the server clock's instant in that zone, and the first is 13 days (or weeks) earlier, so there is no partial extra bucket. Empty buckets are listed with count 0. A bucket's `key` and `label` are its first local date as `YYYY-MM-DD`. Each bucket's `filter` is the filter text for that bucket's start and end instants, written with offsets.
- Each bar or bucket links to `/desk/lists/<table>?filter=<url-encoded filter text>`, and that list shows the text in its Filter text box.
- Widgets refresh within 2 seconds of any committed change that alters their data.

**Workflows.**
- Drafts are edited freely. Publishing creates the next numbered version. A run uses the version current when it started, until it ends.
- Publishing refuses a subflow chain that reaches the flow itself (directly, or through the latest published versions of other subflows) with 422 `subflow_cycle`, message `This subflow calls itself: <A> -> <B> -> <A>.`
- A loop that would start iteration `WORKFLOW_LOOP_LIMIT` + 1 fails its step with the error `Loop "<step name>" stopped after <limit> iterations.`
- A wait lasts its units × `WAIT_STEP_UNIT_SECONDS` of server time.
- A step that fails and has `on_error` steps runs them, shows `Handled`, and the run continues. Without them, the step shows `Failed`, the run stops as `failed`, and the operator may retry it, which re-runs the failed step and continues on success.
- An approval step whose approver set has no active person fails with `No active approver for "<step name>".`
- A test run uses the draft against a chosen record. Steps that would change records are marked simulated and change nothing.
- Step status labels: Waiting, Running, Done, Skipped, Failed, Handled.
- Type labels: Trigger, If, Loop, Approval, Create task, Set fields, Wait, Subflow, Notify, End.

**Inbox.**

The first column is the event key, exactly as it appears in `event` on inbox items and in inbox rules.

| Event key | Recipients | Text |
|---|---|---|
| assigned | the assignee | `<number> was assigned to you.` |
| mentioned | the user named with `@username` in a note or comment | `<display name> mentioned you on <number>.` |
| sla_threshold_50 | per the SLA engine | `<number> has used 50 percent of <SLA name>.` |
| sla_threshold_75 | per the SLA engine | `<number> has used 75 percent of <SLA name>.` |
| sla_breach | per the SLA engine | `<number> breached <SLA name>.` |
| page | the level's target | `Page for <number>: please acknowledge.` |
| page_exhausted | the operator | `Page for <number> was not acknowledged at any level.` |
| vote_requested | the step's voters and their active delegates | `Your vote is needed on <change number>: <title>.` |
| vote_result | the change's creator and the operator | `<change number> was <approved or rejected> at <step name>.` |
| approval_reset | the step's voters | `Approval on <change number> was reset: <field label> changed.` |
| approval_requested | the catalog approvers | `Approve <item number>: <item name> for <display name>.` |
| workaround_published | the assignees of linked open incidents | `A workaround was published on <problem number> for <number>.` |
| major_incident_proposed | the operator | `Major incident proposed for <item name>: <reason>.` |
| export_finished | the export's owner | `Export <id> is ready.` |

- Inbox rules never add recipients; they only stop delivery. A recipient does not receive an event when a rule with `enabled` false for that event key lists any one of the recipient's roles, so a person holding two roles loses the event if either role is disabled. Rules with `enabled` true change nothing. `PUT /api/inbox-rules` replaces the whole list.
- The urgent event keys are `page`, `page_exhausted` and `sla_breach`; they are always delivered at once, whatever the digest setting. Every other event key is non-urgent.
- A person whose digest is `daily` receives their non-urgent items as one item with event key `digest` and text `Daily digest: <n> updates`, at 08:00 in their own time zone on the server clock.
- The unread count is the number of unread delivered items.
- New items reach open pages within 2 seconds.

**Imports.** The published import format:
- UTF-8 text with LF or CRLF line endings.
- Line 1 is exactly `#switchyard-import v1 people` or `#switchyard-import v1 configuration_items`.
- Line 2 is a comma-separated header.
- Each later line is one row, using comma separation, double-quote quoting and `""` for a quote. Blank lines are skipped but still counted.

`people` columns: `username` (match key, required), `display_name` (required), `department` (an existing department), `active` (`true` or `false`, default `true`).

`configuration_items` columns: `name` (match key, required), `class` (a class label, required), `criticality` (`1`, `2` or `3`), `business_critical` (`true` or `false`), `owner_department`.

The `mapping` renames file columns to these names before validation. Line numbers count line 1 as 1. Row errors:
- `Line 1: the first line must be "#switchyard-import v1 <table>".`
- `Line 2: unknown column "<name>".`
- `Line <n>: expected <k> values, found <m>.`
- `Line <n>: <column> is required.`
- `Line <n>: <column> "<value>" is not one of <allowed values joined by ", ">.`
- `Line <n>: department "<value>" does not exist.`
- `Line <n>: duplicate key "<key>" also on line <m>.`

A row whose key exists and whose values equal the stored ones is `unchanged`, an existing key with different values is `update`, and a new key is `create`. Commit skips error rows and applies the rest in one transaction. Committing the same import twice answers 409 `already_committed`. A new import of a file that was already applied shows every row `unchanged` and changes nothing.

**Configuration sets.**
- Captured kinds: catalog_item, workflow, business_rule, access_rule, form_policy, sla_definition, schedule, assignment_rule, inbox_rule.
- The operator may have one open set at a time; a second answers 409 `set_already_open`. While a set is open, every create, update or delete of a captured kind in the test workspace records that item's latest content in the set, keyed by kind and name. Deletions are recorded too.
- Export writes the set file and moves the set to exported.
- Preview reads the stored file and compares each item with live:
  - live missing: `create`
  - content equal: `unchanged`
  - live unchanged since the last promotion or seeding of that item: `update`
  - live changed since then: `collision`
  - a deletion of an existing live item: `delete`
- Commit needs a choice for every collision. A missing choice answers 422 `choice_required`, message `Choose Take set or Keep live for <name>.`
- Commit applies every item (keep_live items are skipped) in one transaction, after storing a snapshot of each touched live item. `applied`, and the `<n>` in `<n> items applied`, counts the items whose live content changed: create, update, delete and collisions chosen as take_set. It excludes unchanged items and keep_live items.
- Back-out restores those snapshots exactly, deleting items the commit created. If a later committed set touched one of the same items, back-out answers 409 `later_set`, message `A later set changed <name>; back that out first.`

For a workflow, the item `content` is the workflow's create body plus its steps: `{"name","kind","inputs","outputs","draft":[<step json>],"published":null|{"version":<n>,"steps":[<step json>]}}`, where `published` is the latest published version at capture. Commit applies workflows before catalog items. For each workflow it replaces the live draft with `draft`. When `published` is not null and its steps differ from the live latest version, it publishes them as the next live version number. Runs already started stay on their versions. Back-out restores the draft and withdraws the version the commit published: it is no longer current, runs already on it finish on it, and its number is never reused.

The configuration set file is JSON:

```
{"format":"switchyard-config-set","version":1,"number":"SET-000001","name":"<set name>","exported_at":"<instant>","items":[{"kind":"business_rule","name":"<name>","deleted":false,"content":{...the create body of that kind...}}]}
```

**Exports.**
- An export job runs in the background: queued, then running (rows counted in batches of `EXPORT_BATCH_ROWS`), then storing, then complete or failed.
- Rows are the list's rows for the filter, after access rules, sorted as the list is. Columns are the chosen columns minus denied fields, with a header line of field labels.
- The job becomes complete only after storage accepts the object.
- Progress reaches open pages within 2 seconds of each batch.

**Rate limits.** Writes are limited to `WRITE_RATE_LIMIT_PER_MINUTE` per user, and sign-in attempts to `LOGIN_RATE_LIMIT_PER_MINUTE` per username. Over the limit, the answer is 429 `rate_limited`, message `Too many requests. Try again in <s> seconds.`, with a `Retry-After` header. Counts cover the 60 seconds before now on real time (not the grading clock). Every sign-in attempt counts, right or wrong, and every state-changing request counts, accepted or refused. `<s>` is the whole number of seconds until the oldest counted request leaves the window, at least 1.

### Services (DP-11, DP-66, DP-67)

**Postgres** (`DATABASE_URL`) is the system of record for users, roles, groups, departments and people; every record type with its field versions, state history, activity, audit and attachment metadata; workflow drafts, published versions and runs; SLA definitions, schedules and SLA instances; the service map, maintenance windows and proposals; rotations, overrides, policies and pages; boards, steps, votes and delegations; business rules, access rules, form policies and assignment rules; knowledge articles, versions and votes; inbox items and rules; configuration sets and their snapshots; imports; export jobs; idempotency records; and the server clock offset. Apply the schema idempotently every time the server starts. Every derived value (SLA numbers, impact, risk, tallies, group counts, aggregates) is computed from it once, on the server. Bytes of queued uploads wait in Postgres only until storage accepts them.

**MinIO** (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`) holds every file. Object keys:
- attachments: `attachments/<record number>/<attachment id>/<file name>`
- import files: `imports/<import id>/<file name>`
- export files: `exports/<export id>.csv`
- configuration set files: `config-sets/<set number>.json`

A file counts as stored only once MinIO accepts the PUT. Before that, no response, screen or announcement calls it stored.

**Attachment rules.**
- Allowed files are `.png` (image/png), `.jpg` or `.jpeg` (image/jpeg), `.pdf` (application/pdf), `.txt` and `.log` (text/plain) and `.csv` (text/csv), checked by extension and declared type.
- Any other file answers 422 `bad_type`, message `Switchyard accepts PNG, JPEG, PDF, TXT, LOG and CSV files.`
- A file larger than `ATTACHMENT_MAX_BYTES` (a file of exactly that size is allowed) answers 413 `too_large`, message `Files can be at most <limit> bytes.`
- An upload that would take the uploader's stored and queued total above `ATTACHMENT_QUOTA_BYTES` (reaching it exactly is allowed) answers 422 `over_quota`, message `This upload would take you past your <limit>-byte attachment quota.`
- `<limit>` is written with comma thousands separators, for example `5,000,000`.

**When MinIO is unreachable.**
- Storage is unavailable once a probe (checking that the bucket exists) or any storage call fails. Probes run at start and every `STORAGE_RETRY_SECONDS`.
- Record work never waits on storage: creating, editing, transitioning, voting, paging and checkout all keep working.
- The storage banners from Feedback states appear within 2 seconds on every open desk page and portal page.
- Attachment uploads answer 202 with status `queued` and keep their bytes until storage returns.
- Import uploads, configuration set export, upload and preview, export retry and file downloads answer 503 `{"error":{"code":"storage_unavailable","message":"File storage is unreachable. Try again when it returns."}}`.
- Running export jobs that fail to store become `failed` with error `storage_unavailable`.
- Health reports per Server boundary.

**When MinIO returns**, detected by the next successful probe, without a restart:
- Queued uploads are written in upload order and their files become `stored`.
- Every export failed with `storage_unavailable` is retried from the start automatically.
- The banners clear within 2 seconds.

### Seed data (DP-02, DP-07, DP-14, DP-31, DP-49)

Every seeded organisation, person, service and article is invented. The organisation is Marlowe Quarry Architects, and the business time zone is Europe/Berlin.

**Users** (password is `<username>-yard-2026`, all in Europe/Berlin except `hugo`, who is in Europe/Lisbon):

| Username | Display name | Roles | Department |
|---|---|---|---|
| `oona` | Oona Petrakis | operator | IT provider |
| `teodor` | Teodor Lindqvist | technician | IT provider |
| `bastian` | Bastian Quell | technician | IT provider |
| `ruth` | Ruth Abernathy | requester | Design Studio |
| `kofi` | Kofi Marsh | requester | Finance |
| `ana` | Ana Feld | approver, requester | Finance |
| `dev` | Devika Raman | approver, requester | Design Studio |
| `jonas` | Jonas Brandt | approver, requester | Studio Operations |
| `mae` | Mae Castellan | manager, requester | Design Studio |
| `hugo` | Hugo Varga | manager, requester | Finance |

**Departments and people.** Directory people have no sign-in:
- Design Studio: 48 people (ruth, dev, mae, plus `design01` to `design45`, named `Design staff 01` to `Design staff 45`)
- Finance: 9 people (kofi, ana, hugo, plus `fin01` to `fin06`)
- Studio Operations: 14 people (jonas, plus `ops01` to `ops13`)
- Leadership: 6 people (`lead01` to `lead06`)
- IT provider: oona, teodor, bastian

**Groups**: `Desk` (members in order: oona, teodor, bastian; escalation policy Desk ladder), `Triage` (no members).

**Schedules**:
- `Office hours`: Europe/Berlin, Monday to Friday 08:00 to 17:00. Holidays: 2026-01-01, 2026-04-03, 2026-04-06, 2026-05-01, 2026-05-14, 2026-05-25, 2026-10-03, 2026-12-25, 2026-12-26.
- `Around the clock`: Europe/Berlin, every day 00:00 to 24:00, no holidays.

**SLA definitions** (targets in business time on Office hours):
- `Incident response`: start `true`, pause `state = "on_hold"`, stop `state != "new"`. Targets: priority 1 15 minutes, 2 30 minutes, 3 1 hour, 4 4 hours, 5 8 hours.
- `Incident resolution`: start `true`, pause `state = "on_hold"`, stop `state in ["resolved", "closed", "cancelled"]`. Targets: 1 4 hours, 2 9 hours, 3 18 hours, 4 36 hours, 5 72 hours.
- `Request fulfilment` (request items): start `true`, pause `state = "awaiting_approval"`, stop `state in ["delivered", "closed", "rejected", "cancelled"]`. Target 27 hours for every priority.

**Configuration items** (name, class, criticality, business-critical):
- Business services:

  | Name | Criticality | Business-critical | Used by |
  |---|---|---|---|
  | Payroll | 3 | yes | Finance, Leadership, and person `ops01` |
  | Project files | 3 | yes | Design Studio, Studio Operations |
  | Mail | 3 | yes | Design Studio, Finance, Studio Operations, Leadership |
  | Sign-in | 3 | yes | Design Studio, Finance, Studio Operations, Leadership |
  | Remote access | 2 | no | Design Studio, Leadership |
  | Printing | 1 | no | Design Studio, Studio Operations |

- Applications: Payroll app (3), Mail relay (3), Directory (3), File gateway (3), Print server (1).
- Virtual servers: payroll-vm (3), mail-vm (3), dir-vm (3), print-vm (1).
- Servers: host-a, host-b, host-c (2 each).
- Clusters: Host cluster (3, required healthy 2), File cluster (3, required healthy 2).
- File servers: fs-node-1, fs-node-2, fs-node-3 (class Server, 2 each).
- Network devices: Core switch (3), VPN gateway (2).
- Storage: Main storage array (3).
- The owner department of every item is IT provider.

**Relationships**:
- Payroll depends on Payroll app; Payroll depends on Sign-in.
- Project files depends on File gateway; Project files depends on Sign-in.
- Mail depends on Mail relay; Mail depends on Sign-in.
- Sign-in depends on Directory.
- Remote access depends on VPN gateway; Remote access depends on Sign-in.
- Printing depends on Print server.
- Payroll app runs on payroll-vm; Mail relay runs on mail-vm; Directory runs on dir-vm; Print server runs on print-vm; File gateway runs on File cluster.
- payroll-vm, mail-vm, dir-vm and print-vm are each hosted by Host cluster.
- host-a, host-b and host-c are each member of Host cluster.
- fs-node-1, fs-node-2 and fs-node-3 are each member of File cluster.
- Host cluster depends on Main storage array; Host cluster depends on Core switch.
- File cluster depends on Core switch.
- VPN gateway depends on Core switch.

For example, with the seed data at start, marking Main storage array down affects 15 items in this order: Host cluster, dir-vm, Directory, Sign-in, Mail, Payroll, Project files, Remote access, mail-vm, Mail relay, payroll-vm, Payroll app, print-vm, Print server, Printing. The relay shows the first 7 panels, then `and 8 more`. Affected people total 77. The failed item is not a business service, so the counter reads 0 before panel 4, first rises at Sign-in (0 before it, 77 from panel 4 on), and stays at 77 through the later panels. A major incident is proposed.

**Freeze windows**:
- `Payroll freeze`: 2026-11-25 00:00 to 2026-12-01 00:00 Europe/Berlin, scope Payroll.
- `Year-end freeze`: 2026-12-21 00:00 to 2027-01-04 00:00 Europe/Berlin, scope all.

**Boards**:
- `Change board`: weighted, threshold 60 percent, window 48 hours, members ana (weight 2), dev (1), jonas (1).
- `Emergency board`: any, window 1 hour, members ana, dev, jonas.

**On-call**: rotation `Weekly on-call` (Europe/Berlin, Monday 09:00, members teodor then bastian, anchor 2026-01-05). Escalation policy `Desk ladder`: level 1 is rotation Weekly on-call, level 2 is user oona.

**Assignment rules**: `Payroll to Desk` (order 100, `configuration_item.name = "Payroll"`, group Desk), `Everything to Desk` (order 200, `true`, group Desk).

**Business rule**: `Major incidents are resolved` (incident, before, order 100, insert and update, `is_major = true and changes_to(state, "cancelled")`, abort `Major incidents are resolved, not cancelled.`).

**Access rules**:
- `Affected person hidden from managers`: field, incident.affected_person, read, roles manager.
- `Confidential incidents`: row, incident, read, roles technician, manager, approver, condition `confidential = true`.

**Form policies**:
- `Studio laptops need a reason`: catalog item laptop, order 100, condition `variables.model = "studio16"`. Action: justification visible and mandatory.
- `Laptop reason hidden otherwise`: laptop, order 50, condition `true`. Action: justification hidden, not mandatory.
- `Cost centre is fixed`: software-licence, order 100, condition `true`. Action: cost_centre read-only.
- `Hold reason when on hold`: incident, order 100, condition `state = "on_hold"`. Action: hold_reason visible and mandatory.
- `Hold reason hidden otherwise`: incident, order 50, condition `true`. Action: hold_reason hidden.

**Catalog items** (id, name, variables; each variable is given as name, label, type):
- `laptop`, Laptop, workflow Laptop fulfilment:
  - model, labelled `Model`, select, required: `standard14` "Standard 14-inch", `studio16` "Studio 16-inch"
  - memory, labelled `Memory`, select, required: `16` "16 GB" when model is standard14; `32` "32 GB" and `64` "64 GB" when model is studio16
  - justification, labelled `Why you need it`, multiline
- `software-licence`, Software licence, workflow Standard fulfilment:
  - seat, labelled `Seat type`, select, required: `cad` "CAD seat", `render` "Rendering seat", `suite` "Design suite"
  - cost_centre, labelled `Cost centre`, text, defaulting to the requester's department name
- `building-pass`, Building pass, workflow Standard fulfilment:
  - office, labelled `Office`, select, required: `kanal` "Kanal office", `hafen` "Hafen office"
  - start_date, labelled `Start date`, date, required
- `shared-drive`, Shared drive access, workflow Drive access:
  - drive, labelled `Drive`, select, required: `projects` "Projects", `finance` "Finance", `archive` "Archive"
  - access, labelled `Access level`, select, required: `read` "Read" always; `write` "Write" only when drive is not archive. Express this as two choices, `write` with `when` drive equals `projects` and `write` with `when` drive equals `finance`.

For example, with the seed data at start, a studio laptop with no reason answers the field message `Why you need it is required.`, and a required office left empty answers `Office is required.`

**Order guide**: `new-starter`, New starter. Question: role, labelled `New starter's role`, select, required, `architect` "Architect", `finance` "Finance", `operations` "Operations". Rules in order: laptop (`true`), software-licence (`answers.role = "architect"`), shared-drive (`true`), building-pass (`true`).

**Workflows** (each published as version 1):
- `Laptop fulfilment`: trigger item_ordered laptop; if `variables.model = "studio16"` then an approval (department approvers, any); create task "Prepare laptop" for Desk, waiting; set state `delivered`.
- `Standard fulfilment`: trigger item_ordered software-licence and building-pass; create task "Fulfil request" for Desk, waiting; set state `delivered`.
- `Drive access`: trigger item_ordered shared-drive; if `variables.access = "write"` then an approval (department approvers, any); create task "Grant drive access" for Desk, waiting; set state `delivered`.

**Queues** (saved shared filters on incident):
- `Open incidents`: `state in ["new", "assigned", "in_progress", "on_hold"]`
- `My work`: `assigned_to.username = me() and state in ["new", "assigned", "in_progress", "on_hold"]`
- `Unassigned`: `is_empty(assigned_to) and state in ["new", "assigned"]`
- `Awaiting requester`: `state = "on_hold" and hold_reason = "awaiting_requester"`. This queue is empty at start.
- `Major incidents`: `is_major = true and state in ["new", "assigned", "in_progress", "on_hold"]`

**Records.** All are created at the moment the database is first seeded, on the server clock:
- `BRK-000001` "Plotter on level 2 jams on A1 sheets": caller ruth, Printing, impact 3, urgency 2 (priority 4), assigned, assigned to teodor, group Desk.
- `BRK-000002` "Payroll export missing two contractors": caller kofi, Payroll, impact 2, urgency 1 (priority 1 after the bump), in progress, assigned to oona.
- `BRK-000003` "Remote access drops every 20 minutes from home": caller dev, Remote access, impact 3, urgency 3 (priority 5), new, unassigned.
- `ROOT-000001` "Plotter jams on large sheets": assessing, linked to BRK-000001.
- `ALT-000001` "Patch print server": normal, draft, Print server, created by oona.

The next numbers are `BRK-000004`, `ROOT-000002`, `ALT-000002`, `ASK-000001`, `ITM-000001`, `JOB-000001`, `ART-000006` and `SET-000001`.

**Knowledge articles** (all published, audience everyone unless stated):

| Number | Title | Keywords | Body | Helpful yes / no | Notes |
|---|---|---|---|---|---|
| `ART-000001` | Clearing an A1 plotter jam | plotter, jam, paper | `Open the front cover, lift the green lever and pull the sheet towards you. Reload the roll before closing.` | 4 / 0 | |
| `ART-000002` | Connecting to Remote access from home | vpn, remote, home | `Start the Remote access client, choose Marlowe Office and sign in with your usual password. If it drops, restart your home router.` | 2 / 1 | |
| `ART-000003` | Resetting your sign-in password | password, reset, locked | `Use the Reset password link on the sign-in page. After five failed tries the account locks for fifteen minutes.` | 0 / 0 | |
| `ART-000004` | Payroll export checklist | payroll, export, contractors | `Check that every contractor has a cost centre before running the monthly export.` | 0 / 0 | audience: department Finance |
| `ART-000005` | Installing the old plotter driver | plotter, driver | `Download the driver from the print server share and run the installer.` | 0 / 0 | valid until 2026-06-30, so expired |

**Dashboards**:
- `desk-overview`, "Desk overview" (operator), and `department-standing`, "Department standing" (managers). Both have the same widgets on incidents:
  - `Open by priority`: bar, filter of the Open incidents queue, grouped by priority.
  - `Breached SLAs`: count, `sla_breached = true and state in ["new", "assigned", "in_progress", "on_hold"]`.
  - `Opened per day`: trend, created_at by day, with the 14 buckets defined in Dashboards under Business rules.
  - `Open major incidents`: count, the Major incidents queue filter.
- Managers see only what the baseline and access rules allow them.

**Inbox rules**: every event is enabled for its recipients, and every user's digest is `immediate`.

## Technical requirements

### Deployment (DP-01)

Backend: TypeScript on Node 22, using npm and a committed `package-lock.json`. Frontend: TypeScript built with Node 22 in the same `build` step, served by the same server process.

`/app/run.json` holds string `install`, `build` and `serve` commands plus `"_schema":"run-manifest-v1"`. For example:

```
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}
```

The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set. It serves the interface, the JSON API and the live channel from that one port. The health path is `/api/health`, with answers as stated in Server boundary. The schema is applied idempotently on every serve, and the seed is inserted only when the database is empty.

### Configuration and secrets (DP-04, DP-11)

Read these at start. Never hard-code their values and never send them to the browser.

Service connections:
- `DATABASE_URL`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `APP_PUBLIC_PORT`

Settings, with their defaults. The grading route may change any of them at runtime.

| Name | Default | Meaning |
|---|---|---|
| `GRADING_KEY` | `switchyard-grading-local` | value of the `X-Grading-Key` header |
| `BUSINESS_TIME_ZONE` | `Europe/Berlin` | zone for server messages and new schedules |
| `ONCALL_ACK_MINUTES` | 15 | default acknowledge timer per level, in minutes of server time |
| `WAIT_STEP_UNIT_SECONDS` | 60 | length of one wait unit |
| `PRESENCE_TIMEOUT_SECONDS` | 30 | presence expiry |
| `WORKFLOW_LOOP_LIMIT` | 100 | loop iterations allowed |
| `BUSINESS_RULE_DEPTH_LIMIT` | 5 | nested rule saves allowed |
| `ASSIGNMENT_CAPACITY` | 10 | default open records per person |
| `ATTACHMENT_MAX_BYTES` | 5000000 | largest attachment allowed, in bytes |
| `ATTACHMENT_QUOTA_BYTES` | 20000000 | per-uploader quota, in bytes |
| `WRITE_RATE_LIMIT_PER_MINUTE` | 600 | writes per user per minute |
| `LOGIN_RATE_LIMIT_PER_MINUTE` | 10 | sign-in attempts per username per minute |
| `LIST_PAGE_SIZE` | 20 | rows per list page |
| `LIVE_SETTLE_MS` | 200 | batching delay for list notices, in milliseconds |
| `STORAGE_RETRY_SECONDS` | 10 | storage probe interval |
| `EXPORT_BATCH_ROWS` | 50 | export progress batch |
| `MAJOR_PROPOSAL_SERVICES` | 2 | business-critical services needed for a proposal |
| `MAJOR_PROPOSAL_INCIDENTS` | 3 | open incidents needed for a proposal |

### Server boundary (DP-01, DP-08, DP-67)

- **Same origin only.** The page, the API and the live channel share one origin. A state-changing request whose `Origin` header names a different origin answers 403 `{"error":{"code":"cross_origin","message":"Requests must come from Switchyard itself."}}`. No cross-origin resource sharing headers are sent.
- **Body limits.** JSON bodies may be at most 1,000,000 bytes, and multipart bodies at most `ATTACHMENT_MAX_BYTES` + 65,536 bytes (a body of exactly the limit is allowed). A larger body answers 413 `{"error":{"code":"too_large","message":"Request bodies can be at most <limit> bytes."}}` before it is read. These two transport checks come before the API error order. `<limit>` is the byte limit written with comma thousands separators: `1,000,000` for JSON bodies, and for multipart bodies `ATTACHMENT_MAX_BYTES` plus 65,536 (with the defaults, `5,065,536`). A file over `ATTACHMENT_MAX_BYTES` that fits inside that multipart limit gets the attachment message in Services, whose `<limit>` is `ATTACHMENT_MAX_BYTES` itself.
- **Never served.** The server never serves source files, source maps of server code, `run.json`, lockfiles, environment files, dependency folders or credentials. Any such path answers 404.
- **Health.** `GET /api/health` always answers 200:
  - `{"status":"ok"}` when Postgres and storage are reachable
  - `{"status":"unavailable"}` when storage is unreachable but Postgres works (it is never 503 for a storage outage)
  
  While Postgres is unreachable at boot, the server keeps retrying every 2 seconds and answers 503 `{"status":"starting"}` until it connects.
- **Storage down at boot.** Booting with storage unreachable does not stop the server. It starts and serves record work, and it recovers by the storage rules in Services without a restart.
- **Unknown pages** render the not-found state with HTTP 404 for every visitor, signed in or not, as stated in Screens and layout. Unknown API paths answer 404 `not_found`.

### Browser support and performance (DP-06)

- Browsers: current Chromium, Firefox and WebKit, at 375x812 (touch), 768x1024 and 1280x800.
- Every screen is usable within three seconds of navigation with the seed data.
- A list page of 20 rows appears within one second of its response.
- Live updates show within 2 seconds of the commit that causes them.
- The relay keeps scrolling without visible stutter with 8 panels.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, and nothing else is needed to start the app.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package, meaning the production dependency tree (`npm ls --omit=dev --all --json`), with its licence, plus the Unbounded and Onest fonts.
- IF-03: Every shipped package and asset is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or, for fonts, OFL-1.1.
- IF-04: The only datastores are the provided Postgres and MinIO: no SQLite or other database files, no in-process persistent store, no cache or queue server.
- IF-05: Fonts, images and scripts are served from the app's own origin, and the browser makes no request to any other origin.
- IF-06: No user-supplied text is ever run as code. There is no `eval`, `new Function`, `vm` module or dynamic `import` of user data.
- IF-07: `package-lock.json` is committed, and `install` uses it.
- IF-08: The provided development service configuration (the compose files and their seeded credentials) is left unchanged.

## Engineering standards

- Code is idiomatic, strictly typed TypeScript with no `any` on domain data. Names match the domain terms in this brief: incident, change, SLA, business schedule, configuration item, quorum, freeze window, rotation, configuration set.
- Each domain rule is decided in exactly one place in the source: each transition table, the priority matrix, the SLA formulas, impact traversal, the risk score, each quorum rule, access evaluation and the expression grammar. Every surface calls that one decision.
- The expression language is parsed into a tree and interpreted, and it never becomes executable code.
- Every API error is built through one error shape. Status codes follow the published order, and no endpoint invents another body.
- No abstraction has only one implementation, and no interface or factory exists for a single concrete type.
- There is no dead, commented-out or unreachable code, and no defensive checks for states the transition tables make impossible.
- Time-dependent decisions read the one server clock, never the system time directly, so the grading clock governs them all.
- There are no features, screens or endpoints beyond this brief.
