# Pinbyte Switchyard

Pinbyte Switchyard is a visual automation builder for multi-member workspaces. An operations, finance or support team drafts an automation on a step canvas, test-runs it on sample data, publishes it as a numbered version, and then watches every run live, cancels runs that are asleep, and replays failed runs from a chosen step. It serves Automation builders, Run operators, Workspace owners and Viewers. The backend is one TypeScript server on Node 22 that also runs the automation engine, with a TypeScript frontend built with Node 22. It uses three services only: Postgres (all state), MinIO (JSON exports and imported files) and Mailpit (sign-up confirmations, member invites and every send-email step, as real SMTP). Out of scope: outside connectors or credentials, a marketplace, code steps, outside sign-in, paid plans, any AI feature, any other datastore, and any external asset or font (fonts are bundled files).

## Problem and users

Operations, finance and support teams wire form intakes, schedules, incoming webhooks, table rows and email by hand, and the tools they use fail in the same places. Saving is not publishing, so edits go live by accident or never go live. A failed run can be replayed from a step only in some tools, and a replay can send a second email. Nobody can tell which logic a run asleep in a wait step will follow once the automation is edited and published again. Retry timing and schedules drift around daylight-saving changes because they follow the browser's clock instead of the server's. Two members editing one draft overwrite each other silently. The cost is duplicated customer emails, lost form submissions and hours spent reading run logs, paid by the operations lead whose team owns the automations.

- **Automation builder** (daily): assembles one trigger and ordered steps by drag or keyboard, fills step inputs from earlier outputs with the template syntax, test-runs on sample data and publishes a numbered version.
- **Run operator** (daily): watches runs arrive live, reads each step's status, input, output, log and timing, cancels a waiting run, and replays a failed run from a chosen step.
- **Workspace owner** (weekly): invites members by email with a role, and exports or imports automations as JSON.
- **Viewer** (occasional): reads automations and run history and sees which version each run used, without being able to change anything.

## Journeys

1. **Build by keyboard and publish.** A builder starts on an empty workspace page, creates a form automation, adds a set-values step and a send-email step at the grid cursor, wires them with the edge keys, fills templated fields in the step panel, and publishes. A visitor in another browser submits the public form. The run detail shows every step succeeded with its output, and the email is in Mailpit.
2. **Wait, cancel and resume.** A run operator opens the run list while a run sits in a wait step. A second run is cancelled by keyboard. The workspace clock is advanced past the first run's due time and the first run finishes, while the cancelled run never resumes. A collaborator's list shows each change without a reload.
3. **Retry and error path.** A call-webhook step fails. The operator watches it show retrying as the workspace clock moves, then the run follows the step's error edge to an email, or fails with the run message.
4. **Replay a failed run.** The operator opens a failed run, chooses a step at or before the failed one, and replays. The page lands on the new run, earlier steps are marked reused, and no second email is sent.
5. **Publish while runs are asleep.** A builder publishes version 2 while a version 1 run waits. The version numeral steps down to the new version, the drain counter shows the one run left on the old version, and when the clock advances that run finishes on version 1 and the counter reaches zero.
6. **Two editors, one draft.** Two editors open the same draft and see each other's presence. One saves a step and the other's save to that step is refused live, naming the first. After the hold lapses on the workspace clock the second save succeeds and the first editor sees it in place.
7. **Webhook intake and schedules.** With the run list open, an outside system posts a delivery twice with one key and one run appears. Scheduled automations fire as the clock advances across daylight-saving changes, and times read in the workspace zone.
8. **Owner tasks and viewer limits.** An owner exports an automation, imports the file, and invites a viewer. The viewer follows the Mailpit link, lands on the workspace, sees controls disabled with a reason, and meets not found for another workspace's address. On a phone, an operator reads a run's step list and opens a step log by touch.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Keyboard-built automation** An Automation builder takes a new form automation from an empty canvas to a published version using only the keyboard, and a visitor's submission then runs it to success with the email visible in Mailpit.
- **DP-02 — Grid cursor and focus landing** Arrow keys move the grid cursor, the published letter keys add each step kind at the cursor, and focus lands on the published element after every canvas action in the keyboard table.
- **DP-03 — Step settings dialog focus** Enter on a step opens its settings dialog with focus inside it, Tab and Shift+Tab wrap within the dialog, and Escape or the close button returns focus to the step.
- **DP-04 — Publish creates a numbered version** Publish copies the draft into the next immutable numbered version, makes it live, refuses when nothing changed, and announces the new version in the Run updates region.
- **DP-05 — Send-email confirmed by the mail server** A send-email step becomes succeeded only after Mailpit has accepted the message, and the accepted message carries the published From, run-id header, templated subject and templated body.
- **DP-06 — Public form intake** A public form validates its published fields, starts exactly one run of the live version with the submitted values as trigger output, and answers not found when the automation has no live version.
- **DP-07 — Pointer-built automation** An Automation builder drags steps onto the grid, wires them by dragging between ports, and meets the cycle and disconnected-step refusals in one pointer session.
- **DP-08 — Pointer placement and wiring** A dropped or moved step snaps to the nearest grid cell and cannot share a cell, and only a drag from an output port to another step's input port draws an edge.
- **DP-09 — Edge drawing motion** A newly drawn edge reports data-anim running while it draws in and none afterwards, and reports none throughout when the user prefers reduced motion.
- **DP-10 — Save refusals for edges** Saving an edge that would close a cycle, give a step a second incoming edge, or end at the trigger is refused with the published message and draws nothing.
- **DP-11 — Publish refusals move focus** Publish refuses each published invalid draft condition with its exact message and step id, and focus moves to that step on the canvas or in the step list.
- **DP-12 — Opposite ports on two manual runs** A builder runs a published branch twice from the Run now control with different inputs, and the run details show opposite ports taken with the untaken part skipped.
- **DP-13 — Condition comparison rules** Filter and branch conditions compare as numbers when both sides parse as numbers and as case-sensitive strings otherwise, with the published operators and worked examples.
- **DP-14 — Template typing** A template field that is one whole expression keeps the value's type, any other field becomes a string, and an unknown path resolves to empty text with the published log line.
- **DP-15 — Run result announcements** The Run updates region announces each run's start, wait, success, failure and cancellation in the published sentences, once per transition.
- **DP-16 — Step list keyboard navigation** The step list on a run detail is navigable by keyboard in execution order, and Enter on an item opens that step's log with focus returning on close.
- **DP-17 — Loop over table rows** A loop over all rows of a seeded table adds one row per item to a second table, and the new rows are visible on the table screen and through the tables API.
- **DP-18 — Loop variables** Inside a loop body the loop index counts from 1 and the loop item gives the current item, and a body step's log holds one attempt line per iteration.
- **DP-19 — Step limit failure** A run that would exceed the step limit fails with the published message, skips the step that would exceed it and every later step that has not run, and is announced as failed.
- **DP-20 — Loop source rules** A loop whose list does not resolve to a list fails that step with the published message, and a loop over all rows of a table sees each row as an object with its row id.
- **DP-21 — Depth-first execution order** Steps run one at a time in the published depth-first order, with several edges on one port running in data-order and each downstream part finishing before the next.
- **DP-22 — Wait holds a run until the server clock** A run held by a wait step stays waiting until the workspace clock reaches its due time, then resumes and finishes, whatever the open tab's clock says.
- **DP-23 — Waiting run appears live** A collaborator's open run list shows a run as waiting, and later as succeeded, without a reload.
- **DP-24 — Cancelling a waiting run** Cancelling a waiting run by keyboard marks the waiting step cancelled and every unrun step skipped, and later clock advances never resume it.
- **DP-25 — Finished runs refuse cancel** Cancelling a run that has already finished is refused with the published status and body.
- **DP-26 — Browser clock never decides** With the browser's clock set hours away, run and step statuses, due times and times of day on screen show what the server pushes.
- **DP-27 — Retrying step journey** A failing call-webhook step shows retrying between attempts while the workspace clock is advanced, then follows its error edge to a send-email step or fails the run, with a collaborator watching live.
- **DP-28 — Attempt log lines** Every attempt of a step writes the published log line, and the attempt count and delay come from the published retry settings.
- **DP-29 — Error edge keeps the step failed** A step that fails after its last attempt follows its error edge, stays failed, and the run ends succeeded when nothing else fails.
- **DP-30 — Run failure without an error edge** A step that fails after its last attempt with no error edge fails the run with the published run message and skips every step not yet run.
- **DP-31 — Mail outage on send-email** With the mail service down, a send-email step retries on the workspace clock and then takes its error path or fails the run, and is never reported succeeded.
- **DP-32 — Export and import journey** A Workspace owner exports an automation by keyboard, imports the downloaded file, and lands on the new automation's editor with the same steps.
- **DP-33 — Export bytes match storage** An export is marked saved only after storage confirms it, and the object under the published key holds exactly the bytes the download gave.
- **DP-34 — Export format and import validation** The exported file has the published keys, and an import that names an unknown node kind or is not a Switchyard automation is refused with the published 422 message and stores nothing.
- **DP-35 — Import stored as uploaded** A valid import is stored under its published key byte for byte as uploaded and creates a new draft that lands the owner on its editor route.
- **DP-36 — Storage outage on export and import** With storage down, export and import answer the published 503 and show the published outage notice, nothing is marked saved, and health reports unavailable.
- **DP-37 — Webhook intake journey** With the run list open, a webhook delivery starts one run that appears live, a repeated delivery with the same key and body adds no row, and arrivals are announced.
- **DP-38 — Webhook refusal order** Webhook deliveries are refused in the published order of unknown path, wrong method, oversized body, wrong content type and malformed JSON, each with its published status and body.
- **DP-39 — Webhook body limit boundary** A body exactly at the webhook body limit starts a run, and a body one byte over is refused as too large and starts none.
- **DP-40 — Idempotent webhook replay and conflict** The same Idempotency-Key with the same body returns the original run without starting another, and the same key with a different body is refused.
- **DP-41 — Idempotency window on the workspace clock** A key is remembered for the published window measured on the workspace clock, after which the same key starts a new run.
- **DP-42 — Schedule journey** A Run operator watches scheduled runs appear in the run list in the workspace time zone as the workspace clock advances across a spring-forward day, a fall-back day and an interval schedule, and reads them on a phone.
- **DP-43 — Spring-forward daily schedule** A daily schedule at a wall-clock time that does not exist on the spring-forward day fires once at the next existing minute.
- **DP-44 — Fall-back daily schedule** A daily schedule at a repeated wall-clock time fires once on the fall-back day, at its first occurrence.
- **DP-45 — Interval schedule** An every-N-minutes schedule fires once per interval as the clock advances, each firing is its own run, and only the live version's schedule fires.
- **DP-46 — Workspace time zone display** Run start times, schedule times and due times show in the workspace time zone in the published format, whatever zone the browser is in.
- **DP-47 — Version pinning journey** A version 1 run asleep in a wait step finishes on version 1 after version 2 is published, while a new run uses version 2.
- **DP-48 — Versions are immutable and drain** Published versions never change, and each superseded version is draining while it has unfinished runs and retired when it has none.
- **DP-49 — Version numeral and drain counter** The canvas header shows the live version numeral and the drain counter, both taken from server records, and the counter changing is announced.
- **DP-50 — Run tokens and ghost edges** Each in-progress run is a token on the step it is at, runs on older versions keep a ghost of that version's edges and show their version, and the ghost edges disappear when the counter reaches zero.
- **DP-51 — Version drain motion** On publish the numeral steps from the old to the new version in the published animation, and reduced motion shows the final state at once while the counter still updates and is announced.
- **DP-52 — Co-editing journey** Two editors in separate browsers see each other's presence, one save wins and the other is refused live, the hold lapses on the workspace clock, and all of it works by keyboard.
- **DP-53 — Presence notice** Members on the same draft see the published presence notice, pushed when another member opens or leaves it.
- **DP-54 — Held step refuses another member** A save to a step held by another member is refused with the published conflict notice naming the holder, and the field shows the holder's value.
- **DP-55 — Hold lapses on the workspace clock** After the edit hold has lapsed on the workspace clock any member's save wins, and the previous holder sees it in place.
- **DP-56 — Simultaneous first saves** When two members save a fresh step at the same moment, exactly one save wins, the one the server received first.
- **DP-57 — Live run list by status** A run list filtered to failed receives a failing run live and ignores a succeeding one, with no reload.
- **DP-58 — Test runs hidden by default** A test run on sample data shows Draft, the Test chip and the test marker, and appears in the run list only while Show test runs is on.
- **DP-59 — Streams stay in the workspace** The live stream and every list, count and run detail carry only the member's workspace, and another workspace's runs never appear.
- **DP-60 — Filters by keyboard and announced** The run list filters work by keyboard and announce the shown count in the Run list results region.
- **DP-61 — Replay journey** A Run operator replays a seeded failed run from its failed step and lands on the new run, whose earlier steps are reused and which sends no second email.
- **DP-62 — Replay reuses recorded outputs** A replay creates a new run on the original's version, links to the original, and shows every earlier step reused with its recorded output.
- **DP-63 — Replay refusals** Replay is refused for a run that is not failed, for a start step after the failed step, and for a start step inside a loop.
- **DP-64 — Replay landing and announcement** After Replay the page lands on the new run's route and the new run is announced as started.
- **DP-65 — Replay by keyboard and live to others** The replay control is reachable and operable by keyboard, and a viewer in another browser sees the replay arrive in the run list live.
- **DP-66 — Phone step list** Below the canvas breakpoint the canvas is replaced by an ordered step list with the same step ids, kinds and statuses, and resizing above it brings the canvas back.
- **DP-67 — Step log by touch** Tapping a step opens its log with status, input, output, attempts and timing, and a tap on the close button closes it.
- **DP-68 — Breakpoint exactness** The canvas shows at the breakpoint width and above and the step list shows one pixel below it.
- **DP-69 — Touch targets and no sideways scroll** On a phone every control is large enough to tap as published, the page does not scroll sideways, and reduced motion shows version numerals and edges without animation.
- **DP-70 — Invite journey** A Workspace owner invites a viewer by email, the viewer opens the Mailpit link in another browser and lands on the workspace route, and sees the automations and runs read-only.
- **DP-71 — Viewer refusals** A viewer's edit, publish, run, import, export and invite are refused by the server with the published 403 body, and the controls are present but disabled with the published reason.
- **DP-72 — Other workspaces answer not found** A workspace, automation, run or table outside the member's workspaces answers 404 in the API and shows the not-found page by address.
- **DP-73 — Not-found page** The not-found page shows the published copy and its action for any unknown address.
- **DP-74 — Invite and sign-up email** Sign-up confirmation and member invites go out through Mailpit with the published subject and link, and answer the published 503 when the mail service is down.
- **DP-75 — Landing hero and example tabs** The signed-out landing page shows the release notice bar, the pill nav, a headline that builds letter by letter, and a preview frame whose three tabs swap three example automations, with no animation under reduced motion.
- **DP-76 — Working screens carry the visual language** Run lists, forms, tables, empty states and error states use the same dotted ground, pill nav, pink pill actions, dark rounded panels and typefaces as the landing page.
- **DP-77 — Canvas and step nodes** The editor canvas is a dark dotted panel of square step nodes on a snapping grid joined by dashed curved edges between ports, with status chips on run views.
- **DP-78 — Layouts at the three viewports** Each screen shows its published layout and element order at 375x812, 768x1024 and 1280x800 with no horizontal overflow.
- **DP-79 — Deployment manifest and health** The run manifest installs, builds and serves the app on the published port, and the health route answers as published for the primary and for each outage instance.
- **DP-80 — Grading routes** The grading setup and clock routes require the grading key, answer 404 without it, create what the request names, and move one workspace's clock, answering only after every due timer owned by the instance called has fired.
- **DP-81 — Run state survives restart** Drafts, versions, runs, step records, timers, idempotency keys and clock offsets survive a server restart, and waiting runs still resume at their due times.
- **DP-82 — Credentials from environment** Every service credential and URL is read from the published environment variables and is never hard-coded or sent to the browser.
- **DP-83 — Engine rules decided once** The run engine's status transitions, retry rule, step limit and version binding are each decided in one place in the source.

## Frontend

### Screens and layout (DP-01, DP-06, DP-07, DP-16, DP-23, DP-49, DP-57, DP-66, DP-68, DP-69, DP-70, DP-75, DP-76, DP-77, DP-78)

Every screen has no horizontal page overflow at 375x812, 768x1024 and 1280x800. Two width thresholds exist: the canvas breakpoint `CANVAS_BREAKPOINT_PX` (a viewport narrower than it is "narrow"; exactly that width and wider is "wide"), and a split-layout threshold at 1024 pixels. So 375 is narrow and single-column, 768 is wide and single-column, and 1280 is wide and split.

- **Signed-out landing `/`**: the release notice bar, then the floating pill nav, then a centred stack of two-line headline, two lines of subcopy and two pill actions. Under it sits the preview frame with a tab row along its base, then the four step-kind cards, the three automation story cards and the footer. The cards form one row at 1280 and 768, and at 375 the row scrolls sideways inside its own box while the page does not. At 375 the release bar wraps to two lines and the nav shows the logo and the menu button.
- **Auth pages** (`/sign-up`, `/sign-in`, `/confirm/<token>`, `/invite/<token>`): one centred dark panel with a light form card, same at all sizes, filling the width minus the page gutter at 375.
- **Workspace home `/w/<workspace id>`**: heading, then the actions row (New automation, Import automation), then the automations list as rows on a light surface (one per row, single column at every size). Each row shows the name, trigger kind, a live-version chip (`Live v<n>` or `Draft only`), and for a live schedule the next-run time.
- **Editor `/w/<workspace id>/automations/<automation id>`**: header row (name, version drain group, actions), step-kind toolbar, then the canvas panel when wide. Narrow, the canvas panel and toolbar are replaced by the ordered `list "Steps"`; tapping an item opens its settings dialog, and adding, moving or wiring steps needs the canvas. At 1280 the step-kind toolbar is a column at the canvas's left edge, and at 768 it is a row above the canvas.
- **Runs `/w/<workspace id>/runs`**: heading, filter row (Status, Automation, Show test runs), the shown-count line, then run rows. Filters sit in one row at 1280 and 768 and stack at 375.
- **Run detail `/w/<workspace id>/runs/<run id>`**: at 1280 the run summary is a left column (about a third) and the canvas a right column (about three fifths); at 768 the summary is above a full-width canvas; at 375 the summary is above the step list. The canvas panel and the step list show the same step ids, kinds and statuses.
- **Tables `/w/<workspace id>/tables`** and **`/w/<workspace id>/tables/<table id>`**: a list of tables, and a table detail with the row grid and the add-row form beneath it.
- **Members `/w/<workspace id>/members`**: members table, pending invites list and the invite form (side by side at 1280, stacked at 768 and 375).
- **Public form `/forms/<workspace slug>/<path>`**: one dark panel with the form fields stacked and one Submit pill.
- **Not found**: a dark panel with the not-found heading and its pink underlined action, at every size.

The footer is a dark panel inset from the viewport edges with rounded bottom corners: three columns of links, a dot lattice with one white square in the middle, and a bottom row. Signed in, it also shows the time-zone line from the controls table.

### Public screens and controls (DP-01 to DP-83)

Only the names below are public; everything else is free. Accessible names use straight apostrophes and the exact case shown. `<n>` and `<name>` are filled from the record.

**Shell and landing**

| Role "name" | Where | Visible copy and behaviour |
|---|---|---|
| `navigation "Main"` | every page | Floating pill nav. |
| `link "Pinbyte Switchyard"` | nav, left | Logo link to `/`. |
| `link "Sign in"`, `link "Create a workspace"` | nav and hero, signed out | To `/sign-in` and `/sign-up`; the second is the pink pill. |
| `link "Automations"`, `link "Runs"`, `link "Tables"`, `link "Members"` | nav, signed in | To `/w/<workspace id>` and its `/runs`, `/tables`, `/members`. |
| `combobox "Workspace"` | nav, signed in | Options are the member's workspace names; choosing one navigates to `/w/<workspace id>`. |
| `button "Sign out"` | nav, signed in | Ends the session and lands on `/`. |
| `button "Menu"` | nav, narrow viewport only | Toggles the nav links (`aria-expanded`); Escape closes it and returns focus to the button. |
| `status "Run updates"` | every signed-in page | Holds the published sentences as a log, one line per sentence, newest last (see Feedback states). It lives in the page shell and survives in-app navigation. |
| `status "Draft notices"` | editor | Presence, conflict, refusals and draft-saved copy. |
| `status "Run list results"` | runs page | Shows the shown-count sentence. |
| `status "Notices"` | every signed-in page and the public form | All other success and refusal copy. |
| `alert` | error and outage panels | A dark panel with the message and a pink underlined `button "Dismiss"`. |
| `contentinfo` | every page | Footer. Signed in it contains `Times are shown in <time zone>` where `<time zone>` is the value of `WORKSPACE_TIME_ZONE`. |
| `region "Release notice"` | landing, top | `Runs stay on the version they started on.` and `link "Learn more"` (jumps to the preview frame). |
| `heading` level 1 | landing | `Draft in peace.` on line one and `Publish with eyes open.` on line two. Its accessible name is the full text even while letters are still building in. |
| text | landing, under the headline | `Wire forms, schedules, webhooks and tables into automations. Test them, publish numbered versions, and replay any failed run.` |
| `tablist "Example automations"` | landing preview frame | Three tabs: `tab "Form to table row"`, `tab "Schedule to email"`, `tab "Webhook to loop"`; the active tab is filled; Left and Right arrow keys move between them. Each has a `tabpanel` with an original SVG graph of that example. |
| `region "Step kinds"` | landing | Four dark cards with `heading` level 3: `Triggers`, `Logic and waiting`, `Tables`, `Mail and webhooks`. |
| `region "Automation stories"` | landing | Three dark `article` cards (company, headline, quote, name and role). Copy is free; every person and business is invented. |

**Authentication and workspace pages**

| Role "name" | Where | Visible copy and behaviour |
|---|---|---|
| `heading` level 1 `Create a workspace` | `/sign-up` | With `textbox "Name"`, `textbox "Email"`, `textbox "Password"`, `button "Create account"`. |
| `heading` level 1 `Sign in` | `/sign-in` | With `textbox "Email"`, `textbox "Password"`, `button "Sign in"`. |
| `heading` level 1 `Confirming your email` | `/confirm/<token>` | Confirms, signs in, lands on `/w/<workspace id>`. |
| `heading` level 1 `Join <workspace name>` | `/invite/<token>` | With `textbox "Name"`, `textbox "Password"`, `button "Join workspace"`; accepting lands on `/w/<workspace id>`. |
| `alert` named `Problem` | any form with a field error | Contains one `link` whose text is the server's `error` message; activating it focuses the field named by the response's `field`. |
| `heading` level 1 `Automations` | `/w/<workspace id>` | With `button "New automation"`, `button "Import automation"` and `list "Automations"` (each `listitem` holds a link named by the automation name). |
| `dialog "New automation"` | opened by New automation | `textbox "Automation name"`, `combobox "Trigger"` (options `Form`, `Schedule`, `Webhook`, `Row added`, `Manual`), `button "Create automation"`, `button "Close"`; creating lands on the editor route. |
| file input `Automation file` | opened by Import automation | Chooses the JSON file; choosing it uploads at once. |
| `heading` level 1 `Members` | members page | `table "Members"` (name, email, role), `list "Pending invites"`, `textbox "Invitee email"`, `combobox "Role"` (options `editor`, `viewer`), `button "Send invite"`. |
| `heading` level 1 `Tables` | tables page | `list "Tables"` (each item a link to the table), `button "New table"`. |
| `dialog "New table"` | opened by New table | `textbox "Table name"`, per column `textbox "Column name <n>"` and `combobox "Column type <n>"` (options `text`, `number`), `button "Add column"`, `button "Create table"`, `button "Close"`. |
| `table "<table name>"` | table detail | A `columnheader` for `Row id` and each column; each row is a `row` with `data-row-id`; below it `textbox "New row: <column>"` per column and `button "Add row"`. |
| `heading` level 1 `<automation name>` | public form | Fields: `textbox "<label>"` for text fields and `spinbutton "<label>"` for number fields, then `button "Submit"`. |
| `heading` level 1 `We couldn't find that page` | not-found page | With the not-found body line and `link "Back to start"` (see Feedback states). |

**Editor**

| Role "name" | Visible copy and behaviour |
|---|---|
| `heading` level 1 `<automation name>` | Editor title. |
| `group "Version drain"` | Holds the numeral `v<n>` (or `No version` before the first publish) and the counter text `Runs left on older versions: <k>`; carries `data-live-version` and `data-drain-count`. |
| `toolbar "Step kinds"` | Nine buttons named `Add step: Set values`, `Add step: Filter`, `Add step: Branch`, `Add step: Loop`, `Add step: Wait`, `Add step: Send email`, `Add step: Add row`, `Add step: Update row`, `Add step: Call webhook`. Click adds at the grid cursor; dragging one onto the canvas drops at the nearest cell. |
| `region "Automation canvas"` | The SVG canvas with its DOM mirror (wide viewports only). |
| `group "Grid cursor"` | The focusable cursor; carries `data-col` and `data-row`. |
| `button "<step name>"` | Each step on the canvas. |
| `button "Output port <port> of <step name>"`, `button "Input port of <step name>"` | The ports. |
| `button "Edge from <from step name> to <to step name>"` | Each edge; focusable but not in the Tab order. |
| `button "Test run"` | Runs the draft on the trigger's sample data. |
| `button "Run now"`, `textbox "Run input (JSON)"` | Manual trigger only; Run now starts a run of the live version with the input. |
| `button "Publish"` | Publishes the draft. |
| `button "Export live version"` | Exports the live version; disabled with a reason before the first publish. |
| `link "View runs"`, `link "View run #<n>"` | The first goes to the runs page filtered to this automation; the second appears after Test run or Run now. |
| `list "Steps"` | Narrow viewports only; one `listitem` per step with a `button "<step name>"`, the kind label and a status chip. |
| `dialog "Step settings: <step name>"` | Step panel: `textbox "Step name"`, then three expanders whose headings are `button "Settings"` (open at first), `button "Connections"` (lists outgoing edges with port and order, read-only) and `button "Template help"` (the template syntax and the paths available to this step); then `button "Close"`. Opening one expander body fades in; thin dividers separate the expanders. |

Step settings controls by kind (inside the Settings expander):

| Kind | Controls |
|---|---|
| form trigger | `textbox "Form path"`; for each field `n`: `textbox "Field name <n>"`, `textbox "Field label <n>"`, `combobox "Field type <n>"` (options `text`, `number`); `button "Add form field"`; `textbox "Sample data (JSON)"` |
| schedule trigger | `textbox "Schedule"`, `textbox "Sample data (JSON)"` |
| webhook trigger | `textbox "Hook path"`, `textbox "Sample data (JSON)"` |
| row_added trigger | `combobox "Table"`, `textbox "Sample data (JSON)"` |
| manual trigger | `textbox "Sample data (JSON)"` |
| set | a group `Values` holding `textbox "Value name <n>"` and `textbox "Value <n>"`; `button "Add value"` |
| filter, branch | `textbox "Left"`, `combobox "Operator"` (options `equals`, `not equals`, `contains`, `greater than`, `less than`, `is empty`, `is not empty`), `textbox "Right"` |
| loop | `combobox "Loop over"` (options `A list`, `All rows of a table`), `textbox "List"`, `combobox "Table"` |
| wait | `spinbutton "Seconds"` |
| send_email | `textbox "To"`, `textbox "Subject"`, `textbox "Body"` |
| add_row | `combobox "Table"`, then `textbox "Column <column>"` for each column of the chosen table |
| update_row | `combobox "Table"`, `textbox "Row id"`, then `textbox "Column <column>"` for each column |
| call_webhook | `textbox "URL"`, `textbox "Body name <n>"`, `textbox "Body value <n>"`, `button "Add body value"` |

**Runs**

| Role "name" | Where | Visible copy and behaviour |
|---|---|---|
| `combobox "Status"` | runs page | Options `All`, `queued`, `running`, `waiting`, `succeeded`, `failed`, `cancelled`. |
| `combobox "Automation"` | runs page | Option `All automations` then each automation's name. |
| `checkbox "Show test runs"` | runs page | Off at first. |
| `list "Runs"` | runs page | Each `listitem` carries the run data attributes below and holds `link "Run #<n> of <automation name>"`, a status chip with the status word, `Started <time>`, `Version <n>` or `Draft`, and a `Test` chip for test runs. |
| `region "Run summary"` | run detail | `heading` level 1 `Run #<n> of <automation name>`, the status chip, `Version <n>` or `Draft`, a `Test` chip for test runs, `Started <time>`, `Finished <time>` once finished, the run message when there is one, and a link to the original run when this is a replay. |
| `button "Cancel run"` | run detail | Enabled only while the run is queued, running or waiting. |
| `combobox "Replay from"`, `button "Replay"` | run detail, failed runs only | The combobox lists the steps at or before the failed step, outside any loop body, by step name. |
| `dialog "Step log: <step name>"` | run detail | Opened by activating a step. Contains `group "Status"`, `group "Input"` and `group "Output"` (each holds the JSON text indented by two spaces), `list "Log"` (one item per line), `group "Attempts"` (`Attempts: <n>`), `group "Timing"` (lines `Started: <time>`, `Finished: <time>`, and `Due: <time>` or `Retry at: <time>` when applicable), and `button "Close"`. |

**Document contract** (data attributes; tests read these, never pixels):

| Element | Attributes |
|---|---|
| each step on the canvas and each step-list item (editor and run views) | `data-step-id`, `data-kind` (`form`, `schedule`, `webhook`, `row_added`, `manual`, `set`, `filter`, `branch`, `loop`, `wait`, `send_email`, `add_row`, `update_row`, `call_webhook`), `data-col`, `data-row`; on run views also `data-status`, `data-reused` (`true` for reused steps, `false` otherwise) and `data-anim` |
| each edge | `data-edge-id`, `data-from`, `data-port`, `data-to`, `data-order`, `data-anim`; ghost edges also `data-ghost="true"` and `data-version` |
| each run list item and the run summary | `data-run-id`, `data-status`, `data-test` (`true` or `false`), `data-version` (number, or empty for a test run), and `data-replay-of="<original run id>"` on replays only |
| each run token | `data-run-token="<run id>"`, `data-version`, `data-at-step="<step id>"` |

`data-anim` is `running` while the thing moves (a running step's pulse, an edge drawing in) and `none` otherwise, and always `none` under reduced motion. On run views, step-list items follow the run step order in Business rules, Execution order. In the editor they follow the canvas Tab order.

### Interactions (DP-01 to DP-03, DP-07 to DP-09, DP-16, DP-24, DP-52, DP-60, DP-65, DP-67)

**Canvas keyboard table.** The canvas has one Tab stop for the grid cursor; Tab and Shift+Tab then move between steps in execution order (trigger first, then each port's edges in data-order depth first with the loop's each part before done and a branch's true part before false, then unconnected steps by id). Tab past the last step leaves the canvas. The grid has 24 columns and 12 rows; the cursor stops at the edge. The new-automation trigger sits at column 1, row 2, and the cursor starts at column 2, row 2. A step takes focus when it is added, so the cursor cell becomes that step's cell. Letter keys and shortcuts work whichever canvas control has focus. Letter keys match either case. Shift does not count as a modifier, so Shift+Tab works as published and Shift+S adds a set values step like `S`. A letter key pressed with Alt, Ctrl or Meta (Cmd) does nothing, except Ctrl+Z and Ctrl+Y (Cmd+Z and Cmd+Y on macOS).

| Key | Focus is on | Result | Focus lands on |
|---|---|---|---|
| Arrow keys | grid cursor | Cursor moves one cell | the cursor |
| Arrow keys | a step | The step moves one cell; refused if the cell is taken (the step stays) | the step |
| `S` `F` `B` `L` `W` `E` `A` `U` `H` | cursor or step | Adds set values, filter, branch, loop, wait, send email, add row, update row, call webhook at the cursor cell; refused if the cell is taken | the new step, or unchanged when refused |
| Enter | a step | Opens the step settings dialog | `textbox "Step name"` in the dialog |
| Escape | a step (no edge in progress) | Moves focus to the cursor at the step's cell | the cursor |
| Escape | dialog open | Closes the dialog | the step it was opened from |
| `C` | a step | Starts an edge from the step's first output port; pressing `C` again cycles that step's ports | the same step |
| Arrow keys or Tab | edge in progress | Choose the target: Tab goes to the next step in execution order, an arrow goes to the nearest step in that direction | the candidate target step |
| Enter | edge in progress | Saves the edge from the source port to the target step | the target step; after a refusal, the source step |
| Escape | edge in progress | Cancels the edge | the source step |
| `.` (period) | a step | Moves to its first outgoing edge; repeating cycles that step's outgoing edges | the edge |
| Delete | a step | Removes the step and its edges | the cursor at that cell |
| Delete | an edge | Removes the edge | the edge's source step |
| Ctrl+Z, Ctrl+Y (Cmd on macOS) | any canvas control | Undo or redo the member's last add, move, delete, edge draw or edge delete; a restored step keeps its id | the restored step, or the cursor when the undo removed a step |

**Step settings dialog.** It opens from the step with Enter, a click or a tap. While it is open Tab and Shift+Tab wrap between its first and last controls and never reach the page behind. Escape or `button "Close"` closes it and focus returns to the step. A field saves when it changes (it loses focus, a choice is made, or Enter is pressed in a single-line field); nothing waits on a timer.

**Pointer.** Dragging a step by its body moves it and it snaps to the nearest cell on release; dropping on an occupied cell puts it back and shows the refusal. Dragging from an output port to another step's input port saves an edge; dropping anywhere else, or starting the drag at an input port, draws nothing. Dragging a toolbar button onto the canvas adds that kind at the nearest cell to the drop. Clicking a step (pressing and releasing on it without moving it) focuses that step and opens its step settings dialog. A press that moves the step is a drag and opens nothing.

**Run views.** On run detail the canvas or step list is read-only. Enter, click or tap on a step opens `dialog "Step log: <step name>"` with the same focus rules as the settings dialog. On the step list, Tab and Arrow Down or Up move between items in order. `button "Cancel run"` cancels. Choosing a step in `combobox "Replay from"` and activating `button "Replay"` replays.

**Runs page.** Changing a filter applies at once with no submit button, by keyboard or pointer, and the shown-count sentence updates. New and changed runs arrive in place as the server pushes them.

**Other.** Landing tabs use Left and Right arrows and Enter. The menu button, nav combobox, expanders and tabs are all operable by keyboard; focus shows as a two-step-thick ink outline offset from the control. Buttons grow slightly under the pointer and press down slightly when pressed.

**Touch.** On narrow viewports tapping a list item opens its dialog (settings in the editor, log on a run), and tapping Close closes it. Every control is at least 44 pixels tall and wide.

### Visual design (DP-75, DP-76, DP-77, DP-78)

- **Type.** Display headings use Bricolage Grotesque, tightly tracked and in sentence case. Body text uses Schibsted Grotesk. Counts and version numbers use Schibsted's tabular figures. JetBrains Mono appears only on uppercase pill labels, the nav and literal template code. Headings step up by about a quarter from one level to the next, and the landing headline is about four times the body size. All three font families are bundled files.
- **Colour roles.** The ground is a near-white page carrying a faint static dot grid. Light surfaces (nav pill, run rows, form cards) are a slightly darker grey. Dark surfaces (the release bar, canvas panels, cards, footer, error panels) are near-black. Ink is near-black on light and near-white on dark. The accent is a soft pink used for primary pill buttons and for links and underlined actions on dark panels, and never as text on the light ground. Secondary pills are a mid-light neutral grey. Status chips are pills that always carry the status word, so colour is never the only signal. All text meets WCAG 2.2 AA contrast.
- **Density and composition.** Comfortable spacing on a four-step scale, a generous gutter at 1280, and a tighter one at 375. A floating pill nav sits over the dotted page. Large near-black panels with strongly rounded corners carry the automation graphs, in a split of roughly a third for copy and three fifths for the panel on wide feature sections.
- **Hero.** The landing page is the seed hero: the release bar, the pill nav, a two-line headline that builds letter by letter, then a rounded light preview frame with three pill tabs that swap three example automations (a form to a table row, a schedule to an email, a webhook to a loop), drawn as original SVG nodes: rounded squares, small circles, dashed curved connectors and small plus buttons, with invented icons such as a mail glyph, a gear and a bolt.
- **Working screens.** Run lists are rows on a light surface with pill status chips. Forms are light cards on the dotted ground with pink pill submit buttons. Tables sit on light surfaces with the same type. Empty states are a dot lattice with a single white rounded square and one line of copy. Error and outage panels are dark with a pink underlined action. The editor canvas and run canvas are dark dotted panels with square step nodes (each about two thirds of a grid cell, 96 pixels square), small port dots, dashed curved edges between ports, and a short two-line caption under each node (step name in light ink, kind in grey). Run views show a status chip on each node. The step-kind cards have a dot lattice with a pixel icon made of white rounded squares above a title and grey body text. Pixel-icon shapes and the story-card brand marks are original and abstract.
- **Controls.** Pill buttons are fully rounded, at least 44 pixels tall, with uppercase mono labels; primary is pink with dark ink, secondary is grey with dark ink.
- **Named components.** These product components carry the seed's interface conventions, and each is checkable as described.
  - The **workspace pill nav** is the `navigation "Main"` landmark: a light grey, fully rounded bar floating near the top of every page with a small gap above it and the page gutter on each side, about as tall as a large button. The logo link sits at its left, uppercase mono links in the centre, and the sign-in link and the pink primary pill at the right (the workspace selector and Sign out when signed in). It stays at the top while the page scrolls. Hover shifts colour in about a seventh of a second. Below the canvas breakpoint it collapses to the logo and `button "Menu"`.
  - The **canvas dot grid** is the faint static dot pattern on the page ground and inside every dark panel, regularly spaced and low in contrast (lighter dots on dark, darker dots on light). It never moves and never changes under reduced motion.
  - The **example automation preview tabs** are the `tablist "Example automations"` along the base of the rounded light preview frame on the landing page: three pill tabs, each at least 44 pixels tall, the active one filled. Before the headline has finished building the frame shows a grey skeleton and the tabs are not selectable. Choosing a tab crossfades the diagram in about a third of a second, and instantly under reduced motion.
  - The **step panel expanders** are the three expanders inside `dialog "Step settings: <step name>"`: a vertical stack with a thin divider between items, each showing only its heading (`Settings`, `Connections`, `Template help`) when closed. Activating a heading by click, tap, Enter or Space opens its body with a fade of about a third of a second (instant under reduced motion) and sets `aria-expanded`.
  - The **step kind cards** are the four dark rounded cards in `region "Step kinds"`: a dot lattice with a pixel icon of white rounded squares in the upper half, and a title and grey body text below. They sit in one row at 768 and 1280 and scroll sideways inside their own box at 375. On hover the icon squares shift in four steps over about a third of a second, and under reduced motion they stay still.
  - The **workspace status footer** is the `contentinfo` panel: dark, inset from the viewport edges, with rounded bottom corners, three columns of uppercase mono links, a dot lattice with one white rounded square in the middle, and a bottom row of legal links, social marks and the copyright line. Signed in it also shows the time-zone line from the controls table. Link hover shifts the colour to pink in about a seventh of a second. The columns stack into one column at 375.

### Motion and effects (DP-09, DP-49, DP-50, DP-51, DP-69, DP-75)

Everything that moves snaps in four visible steps instead of gliding, so an automation reads as a machine ticking. Opacity fades are the only soft motion. Motion is driven by the stylesheet and animation-end events, not by page timers, so it completes with a paused page clock. No decorative loop exists; the only repeating motion is the running-step pulse below.

- **Landing headline.** On load each letter rises a few pixels into place in four snapped steps over about a third of a second, letters starting about 30 milliseconds apart. When the last letter lands, the preview frame swaps its grey skeleton for the live diagram with a fade of about a third of a second (about six tenths of a second after the headline finishes). Only then do the tabs become selectable, and choosing one crossfades the diagram in about a third of a second. Panels reveal once as they enter the viewport with a short fade and a small rise.
- **Hover and press.** Link and button colour changes take about a seventh of a second; pill buttons grow by a few percent under the pointer and shrink slightly when pressed. Link underlines thicken. Step-kind card icon squares shift in four steps over about a third of a second on hover.
- **Running step.** A step whose status is `running` pulses in four snapped steps about once a second until its status changes.
- **Edge draw-in.** A newly added edge (drawn by this member or pushed from another) draws in over about six tenths of a second (between half a second and three quarters), with `data-anim` `running` meanwhile and `none` afterwards. Edges already on the page at load are `none`.
- **Version drain (signature).** On publish, the version numeral in the editor header changes from `v<old>` to `v<new>` as split digits that each step down in four snapped steps over between a quarter and two fifths of a second, each digit starting between 20 and 40 milliseconds after the previous. The new graph's edges draw in as above. Every in-progress non-test run is a small square token sitting on the step it is at, moving between steps in four snapped steps. Tokens of runs on an older version keep a ghost of that version's edges under the live ones (fading with opacity) and carry the label `v<old>`. A drain counter next to the numeral counts down as each older-version run finishes or is cancelled, and the ghost edges are gone when it reaches zero. Token positions, version labels and counts come only from the server's run records and pushes.
- **Reduced motion** (`prefers-reduced-motion`): letters, the preview frame, tab swaps, panel reveals, the pulse, edge draw-ins, tokens, the numeral and hover scaling all show their final state at once, with no translate and no stagger, and `data-anim` stays `none`. The drain counter still updates and is still announced.

### Feedback states (DP-04, DP-15, DP-33, DP-36, DP-49, DP-60, DP-70, DP-73, DP-74)

**Generic rules.** While a request is in flight the button that started it is disabled, carries `aria-busy="true"` and reads `Working...`. A refusal answered by the server is shown verbatim from its `error` field in the owning region (below) and never rephrased. Form field errors also show the `Problem` alert summary linked to the field. If the live connection drops, `status "Notices"` shows `Live updates paused. Reconnecting...`, the page reconnects, and on reconnect it refetches what it shows.

**Run updates sentences.** `status "Run updates"` announces exactly these sentences, once per transition, for every run in the workspace (test runs included):

- `Run #<n> started`
- `Run #<n> is waiting at <step name>`
- `Run #<n> succeeded`
- `Run #<n> failed at <step name>`
- `Run #<n> was cancelled`
- `Version <n> published`
- `Runs left on older versions: <k>` (whenever the drain count changes)

`<n>` counts per automation from 1, test runs included. `<step name>` is the step the run waits at, or the step whose failure (or step-limit stop) ended the run. A run that fails, or is replayed, announces its own started and failed sentences. Retrying steps produce no announcement.

Each sentence is added as its own new line at the end of the region, and earlier lines stay. The region keeps the latest 20 lines, and older lines drop off the top. Only additions are announced. The region starts empty on each full page load. On a publish, `Version <n> published` is added first. `Runs left on older versions: <k>` follows only when the drain count changed, so a first publish, or a publish with no unfinished runs on older versions, adds the version sentence alone.

**Other regions.**

- `status "Run list results"`: `Runs shown: <k>`, updated on every filter change and push.
- `status "Draft notices"`: `Draft saved. Not live until you publish.` after every accepted draft change; `Drawing an edge from <step name> (<port>). Choose a target and press Enter.` while an edge is in progress (the port part updates on each `C`); `<name> is also editing this draft` and the conflict notice (both owned by Business rules, Collaboration); `Import saved. This is a draft.` on the editor an import landed on; and every draft refusal verbatim from the server.
- `status "Notices"`: `Check your email to confirm your account` after sign-up; `Invite sent to <email>` after an invite; `Table created`; `Row added`; `Saving export...` while an export is pending and `Export saved` only after storage has confirmed it; `Saving import...` while an import is pending; every other refusal verbatim.
- Public form: `Thanks, your response was received.` in a `status` after a successful submit.

**Outages and not found.**

- Storage down (export or import answered 503): an `alert` reading `Storage is unavailable. Nothing was saved.`; no download starts and no saved sentence appears.
- Mail down on sign-up: an `alert` reading `Email is unavailable. Your account was not created.`
- Mail down on invite: an `alert` reading `Email is unavailable. The invite was not sent.`
- Not-found page (any unknown address, another workspace's address, an unusable invite or confirm link): `heading` level 1 `We couldn't find that page`, a line `It may have moved, or you may not have access to it.`, and the pink underlined `link "Back to start"` to `/`.

**Disabled controls for roles.** For a viewer, Test run, Run now, Publish, Export live version, New automation, Import automation, New table, Add row, Cancel run, Replay, Send invite and the nine `Add step: ...` buttons of `toolbar "Step kinds"` are present but disabled, and each has the accessible description `Viewers cannot change this workspace`. For an editor, Send invite is disabled with the description `Only owners can do this`. The editor's step settings fields are disabled for a viewer, with the same description.

## Backend

### API

All paths are under one origin. Requests with a body use `application/json`; responses are `application/json; charset=utf-8` unless a row says otherwise. Ids are opaque strings of lowercase letters, digits and hyphens: workspaces `ws-<8 hex>`, automations `au-<8 hex>`, runs `run-<8 hex>`, tables `tb-<8 hex>`, imports `im-<8 hex>`; step ids are `trigger`, `s1`, `s2`, ... ; edge ids `e1`, `e2`, ...; row ids `r1`, `r2`, ... per table. Timestamps are ISO 8601 UTC strings with milliseconds. `<ws>` is a workspace id and `<aid>` an automation id in the paths below.

**Error shape and order (stated once for every route except the webhook route).** Every error is `{"error":"<message>"}`, with these extra keys only where a row names them: `step_id`, `step`, `field`. The order of checks is: the cross-origin 403, then 401 unauthenticated, then 404 unknown or not a member of that workspace (the body is the same either way), then 403 role, then 413 or 415 on the body, then 409 state conflict, then 422 validation.

| Status | Body | When |
|---|---|---|
| 401 | `{"error":"Sign in required"}` | No valid session on a signed-in route |
| 404 | `{"error":"Not found"}` | Unknown or other-workspace resource; also unknown `/api/` paths |
| 403 | `{"error":"Viewers cannot change this workspace"}` | A viewer calls anything that changes, runs, imports or exports; also create or invite calls below |
| 403 | `{"error":"Only owners can do this"}` | An editor calls an owner-only route. A viewer gets the viewer body above on every route that changes anything, invites included |
| 403 | `{"error":"Cross-origin request refused"}` | A mutating request (any method other than GET and HEAD) carries an `Origin` header that differs from the origin it was served on, meaning the scheme, host and port of that request. A request with no `Origin` header is accepted. The public form and webhook routes accept any origin |
| 413 | `{"error":"Body is larger than 65536 bytes"}` | JSON body over 65,536 bytes (the limit itself is allowed) |
| 415 | `{"error":"Content type must be application/json"}` | Wrong content type on a route with a body |
| 422 | `{"error":"Body is not valid JSON"}` | JSON that does not parse; a parsed non-object body answers `{"error":"Body must be a JSON object"}` |
| 422 | `{"error":"JSON is nested more than 20 levels deep"}` | Any JSON body deeper than 20 levels |
| 422 | `{"error":"Name must be 60 characters or fewer"}` | Any automation, step or table name over 60 characters; length counts characters as a person sees them, so an emoji counts as 1 |

**Authentication and invites** (public unless noted; the session cookie is set by the sign-in routes):

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/auth/sign-up` | `{"name","email","password"}` | `201 {"message":"Check your email to confirm your account"}`; creates an unconfirmed user and a workspace named `<name>'s workspace`, and sends the confirmation mail | 409 `{"error":"That email already has an account"}`; 422 with `field` set: `Enter your name`, `Enter a valid email address`, `Password must be at least 8 characters`; 503 `{"error":"Email is unavailable"}` (nothing is created) |
| `POST /api/auth/confirm` | `{"token"}` | `200 {"workspace_id"}`, confirms, signs in | 404 for an unknown or used token |
| `POST /api/auth/sign-in` | `{"email","password"}` | `200 {"workspace_id","name"}` (first workspace by join time) | 401 `{"error":"Email or password is wrong"}`; 403 `{"error":"Confirm your email first"}` |
| `POST /api/auth/sign-out` | none | 204 | none |
| `GET /api/me` | none | `200 {"id","name","email","workspaces":[{"id","name","slug","role"}]}` | 401 |
| `GET /api/invites/<token>` | none | `200 {"workspace_name","email","role","has_account"}` | 404 unknown or used token |
| `POST /api/invites/<token>/accept` | `{"name","password"}` | `200 {"workspace_id"}`; creates and confirms the account when the email has none (an existing account must supply its password, and `name` is ignored), joins with the invited role, signs in; the token is then used up | 404; 401 `Email or password is wrong` for an existing account with a wrong password; 422 as sign-up |

**Workspace, members and tables** (all need membership):

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/workspaces/<ws>` | none | `200 {"id","name","slug","role","time_zone","now"}` (`now` is the workspace clock) | none |
| `GET /api/workspaces/<ws>/members` | none | `200 {"members":[{"user_id","name","email","role"}],"invites":[{"id","email","role"}]}` | none |
| `POST /api/workspaces/<ws>/invites` (owner) | `{"email","role"}` | `201 {"invite_id","email","role"}`; sends the invite mail first; a second invite to the same email replaces the first | 409 `{"error":"That person is already a member"}`; 422 `Enter a valid email address` or `Role must be editor or viewer`; 503 `{"error":"Email is unavailable"}` |
| `GET /api/workspaces/<ws>/tables` | none | `200 {"tables":[{"id","name","columns":[{"name","type"}],"row_count"}]}` | none |
| `POST /api/workspaces/<ws>/tables` | `{"name","columns":[{"name","type"}]}` | `201` the table | 422 `Table name is required`, `Add at least one column`, `Column names must be unique`, `Column type must be text or number` |
| `GET /api/workspaces/<ws>/tables/<tid>` | none | `200 {"id","name","columns","rows":[{"_row_id", <column>: <value>}]}` in creation order | none |
| `POST /api/workspaces/<ws>/tables/<tid>/rows` | `{"values":{"<column>":<value>}}` | `201` the row object; fires matching `row_added` triggers | 422 the number-column message from Business rules |

**Automations, draft and versions:**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/workspaces/<ws>/automations` | none | `200 {"automations":[{"id","name","trigger_kind","live_version","next_run_at","drain_count"}]}` | none |
| `POST /api/workspaces/<ws>/automations` | `{"name","trigger_kind"}` | `201` the draft shape below | 422 `Name is required` or `Unknown node kind: <kind>` (a trigger kind is one of `form`, `schedule`, `webhook`, `row_added`, `manual`) |
| `GET /api/workspaces/<ws>/automations/<aid>` | none | `200 {"id","name","trigger_kind","revision","live_version","drain_count","next_run_at","trigger":{"id":"trigger","kind","name","col","row","fields","sample"},"steps":[{"id","kind","name","col","row","fields"}],"edges":[{"id","from","port","to","order"}]}` | none |
| `POST .../automations/<aid>/draft/steps` | `{"kind","col","row"}` (an optional `id` restores a step deleted from this draft, for undo) | `201` the step with a default name | 409 `{"error":"That cell is already taken"}`; 422 `Unknown node kind: <kind>` (including trigger kinds) or `That cell is outside the grid` |
| `PUT .../draft/steps/<sid>` | any of `{"name","fields","sample","col","row"}`; `fields` keys given replace those keys; `sample` is trigger-only | `200 {"step","revision"}` | 409 the cell message above, or the conflict body in Business rules (Collaboration); 404 unknown step; 422 `Sample data must be a JSON object` |
| `DELETE .../draft/steps/<sid>` | none | 204; its edges go too | 422 `The trigger cannot be deleted` |
| `POST .../draft/edges` | `{"from","port","to"}` | `201` the edge; its `order` is one more than the highest `order` on that source port | 422 as listed under Edge refusals |
| `DELETE .../draft/edges/<eid>` | none | 204; remaining edges on that port renumber from 1 | none |
| `POST .../publish` | none | `201 {"version","published_at"}` | 409 `{"error":"The draft has no changes since version <n>"}` (`<n>` is the live version); 422 publish refusals below |
| `GET .../versions` | none | `200 {"versions":[{"version","status","published_at","runs_left"}]}` where `status` is `live`, `draining` or `retired` | none |
| `GET .../versions/<n>` | none | `200` the draft shape for that version, plus `"version"` | 404 unknown version |
| `POST .../versions/<n>/export` | none | `200`, content type `application/json`, header `Content-Disposition: attachment`, body: the export file bytes, sent only after storage confirmed the object | 503 `{"error":"Storage is unavailable"}`; 404 unknown version |
| `POST /api/workspaces/<ws>/imports` | raw bytes of the file, content type `application/json`, at most 262,144 bytes | `201 {"automation_id","import_id","key"}` | 413 `{"error":"Body is larger than 262144 bytes"}`; 503 `{"error":"Storage is unavailable"}`; 422 `Import is not valid JSON`, `Import is not a Switchyard automation`, `Unknown node kind: <kind>`, or any edge message below |

**Edge refusals** (422, checked in this order): `Unknown step: <id>`; `The trigger cannot have an incoming edge`; `Step <from> has no port <port>`; `That edge would close a cycle at step <id>` (`<id>` is the edge's target step); `Step <to> already has an incoming edge`.

**Publish refusals** (422 `{"error":"<message>","step_id":"<id>"}`). Checks run over `trigger` first, then `s1`, `s2`, ... in numeric order, and each step is checked in this order; the first failure answers:

1. `Step <id> is not connected to the trigger` (no chain of edges reaches the step from the trigger)
2. `Step <id> needs a value for <label>` (a required field below is empty; `<label>` is the control's name from the settings table)
3. For the trigger only: `Step trigger has a schedule that is not every N minutes or daily at HH:MM`; `Step trigger needs a path no other live automation uses` (form and hook paths are unique within a workspace among live versions of automations other than this one, separately for forms and hooks; a path is lowercase letters, digits and hyphens)
4. `Step <id> must wait between 1 and <max> seconds` (`<max>` is `WAIT_MAX_SECONDS`)
5. `Step <id> can only call this app's own address`
6. `Step <id> is a loop inside another loop`

Required fields by kind: form needs `Form path` and `Form fields` (at least one); schedule needs `Schedule`; webhook needs `Hook path`; row_added needs `Table`; set needs `Values` (at least one entry with a non-empty name); filter and branch need `Left` and, unless the operator is `is empty` or `is not empty`, `Right`; loop needs `List` or `Table` depending on its source; wait needs `Seconds`; send_email needs `To`, `Subject` and `Body`; add_row needs `Table`; update_row needs `Table` and `Row id`; call_webhook needs `URL`.

**Runs:**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `POST /api/workspaces/<ws>/automations/<aid>/runs` | `{"test":bool,"input":object}` both optional | `201 {"run_id","number"}`. A test run (`"test":true`) runs the draft, with `input` defaulting to the trigger's sample data. Without `test`, only a manual automation with a live version runs, and `input` defaults to `{}` | 409 `{"error":"Publish a version before running"}`; 409 `{"error":"Only manual automations can be run by hand"}`; 422 `{"error":"Run input must be a JSON object"}` |
| `GET /api/workspaces/<ws>/runs?status=&automation=&test=true` | query filters; `test=true` includes test runs, otherwise they are left out | `200 {"runs":[...]}` newest first (by start time, then number), at most 100, each `{"id","number","automation_id","automation_name","status","test","version","replay_of","started_at","finished_at","message"}` (`version` is null for a test run) | 404 for an `automation` outside the workspace; 422 `Unknown status: <value>` |
| `GET /api/workspaces/<ws>/runs/<rid>` | none | `200` the list item plus `"trigger"` (trigger output), `"steps"`: executed steps in execution order, then unrun steps by id, each `{"id","kind","name","col","row","status","reused","input","output","log":[string],"attempts","started_at","finished_at","due_at","retry_at"}`, and `"edges"` | none |
| `POST .../runs/<rid>/cancel` | none | `200` the run | 409 `{"error":"Run #<n> has already finished"}` |
| `POST .../runs/<rid>/replay` | `{"from_step":"<step id>"}` | `201 {"run_id","number"}` | 409 `{"error":"Only a failed run can be replayed"}`; 422 `{"error":"Replay must start at or before the failed step"}`; 422 `{"error":"Replay cannot start inside a loop"}` |

**Public routes** (no session):

- `GET /forms/<workspace slug>/<path>`: the public form page (not found when no live version).
- `POST /api/forms/<workspace slug>/<path>`: body is a JSON object of field values; `202 {"run_id"}`; 404 unknown path or no live version; 422 `{"error":"<label> is required","field":"<name>"}` or `{"error":"<label> must be a number","field":"<name>"}` (a number field takes a JSON number or a numeric string); body limit as for the JSON API.
- `POST /hooks/<workspace slug>/<path>`: see Business rules, Webhook trigger.
- `GET /api/health`: `200 {"status":"ok"}`; see Services for the unavailable answer.

**Live stream.** `GET /api/workspaces/<ws>/events` is a server-sent event stream (`text/event-stream`; add `?draft=<aid>` to register presence on that draft). It answers 401 and 404 like any workspace route. Each `data:` line is a JSON object with `type` and `workspace_id`; the stream only ever carries that workspace's events:

- `run`: `{"type":"run","workspace_id","run":<run list item>,"steps":[{"id","status"}]}` on every run or step change.
- `version`: `{"type":"version","workspace_id","automation_id","version"}` on publish.
- `drain`: `{"type":"drain","workspace_id","automation_id","count"}` whenever the drain count changes.
- `draft`: `{"type":"draft","workspace_id","automation_id","revision","step_id"}` on every accepted draft change.
- `presence`: `{"type":"presence","workspace_id","automation_id","members":[{"id","name"}]}` to connections registered on that draft.
- `table`: `{"type":"table","workspace_id","table_id"}` on every row change.

The browser never polls on a timer for any of this; it refetches only after a push or a reconnect. The server sends a comment line every 15 seconds so the connection stays open.

**Grading routes** (all need header `X-Grading-Key: <GRADING_KEY>`; a missing or wrong key answers `404 {"error":"Not found"}`):

- `POST /api/grading/setup` creates everything in one call and answers `200` with every id. Request:

```json
{"users":[{"key":"owner","email":"o@x.example","name":"Olu","password":"pw-123456"}],
 "workspaces":[{"key":"w1","id":"ws-alpha","name":"Alpha","slug":"alpha",
   "clock":{"set":"2027-03-13T12:00:00Z"},
   "members":[{"user":"owner","role":"owner"}],
   "tables":[{"key":"orders","id":"tb-orders","name":"Orders",
              "columns":[{"name":"customer","type":"text"}],"rows":[{"customer":"A"}]}],
   "automations":[{"key":"a1","id":"au-a1","name":"Intake",
     "versions":[{"trigger":{"kind":"form","col":1,"row":2,
                   "fields":{"path":"intake","form_fields":[{"name":"customer","label":"Customer","type":"text"}]},
                   "sample":{"customer":"A"}},
                  "steps":[{"id":"s1","kind":"send_email","name":"Send email 1","col":2,"row":2,
                            "fields":{"to":"o@x.example","subject":"New {{trigger.customer}}","body":"Hi"}},
                           {"id":"s2","kind":"call_webhook","name":"Call webhook 1","col":3,"row":2,
                            "fields":{"url":"/hooks/alpha/missing","body":{}}}],
                  "edges":[{"from":"trigger","port":"out","to":"s1","order":1},
                           {"from":"s1","port":"out","to":"s2","order":1}]}],
     "runs":[{"key":"r1","version":1,"input":{}},
             {"key":"r2","version":1,"input":{},"recorded":{"status":"failed","failed_step":"s2",
               "steps":{"s1":{"status":"succeeded","output":{}},"s2":{"status":"failed","message":"Webhook answered 404"}}}}]}]}]}
```

  Rules: users are created confirmed. Optional `id` fields (workspace, table, automation) are used as given, otherwise generated, so step fields can name table ids. A workspace `clock` is applied first. Each `versions` entry, and the optional `draft`, is complete content in one shape: `trigger` (`kind`, `col`, `row`, `fields`, `sample`, optional `name`), `steps` (each `id`, `kind`, `name`, `col`, `row`, `fields`) and `edges` (each `from`, `port`, `to`, optional `order`). No entry inherits anything from the draft, from another version or from any other entry. `versions` are published in order through the normal publish checks, and a failure answers 422 with the publish refusal body. `draft` defaults to the last version's content, and at least one of the two is required. Step ids, cells and field values are used as given; edge `order` defaults to creation order. A run entry without `recorded` is started through the real engine with `input` as its trigger output (default `{}`), and the call answers after it has gone as far as it can without waiting. A run entry with `recorded` is never executed, even when it also has `input`. It is inserted as a finished record (`failed` or `succeeded`), and its `input` (default `{}`) is used only as the recorded trigger output. Its unlisted steps are `skipped` and its run message is built as for a real failure. It sends no email and starts no timer. Response: `{"users":{"<key>":{"id","cookie"}},"workspaces":{"<key>":{"id","slug","tables":{"<key>":{"id"}},"automations":{"<key>":{"id","versions":[n],"runs":{"<key>":"<run id>"}}}}}}`, where `cookie` is a session cookie value usable under the cookie name in Server boundary. An email that already exists answers `409 {"error":"Email already exists"}`.
- `POST /api/grading/workspaces/<id>/clock` with `{"advance_seconds":N}` (a non-negative integer) or `{"set":"<ISO instant>"}`: answers `200 {"now","offset_seconds"}` only after every timer owned by the instance that received the call (see Business rules, Several server instances) and due at or before the new time has fired in time order and every resumed run has gone as far as it can without waiting again. Setting the clock earlier fires nothing and nothing fires twice. Both keys, neither, or an unparseable value answer `422 {"error":"Send advance_seconds or set"}`. An unknown workspace answers 404.

### Business rules

**Words and ids.** An automation has one trigger and steps; lines between them are edges; connection points are ports. One execution is a run. Step ids are `s1`, `s2`, ... in creation order within the automation, and a deleted id is never reused. The trigger's id is `trigger`. A new step's default name is `<kind label> <k>` where `<kind label>` is `Set values`, `Filter`, `Branch`, `Loop`, `Wait`, `Send email`, `Add row`, `Update row` or `Call webhook` and `<k>` counts steps of that kind ever created in the automation from 1; a trigger's default name is `Form trigger`, `Schedule trigger`, `Webhook trigger`, `Row added trigger` or `Manual trigger`. Names need not be unique.

**Roles.** Owner: everything. Editor: everything except invite. Viewer: read-only (read automations, drafts, versions, runs, tables, members and the live stream); a viewer's create, edit, publish, run, cancel, replay, import, export, table create, row add and invite are refused with the role bodies in the API error table. Export and import need owner or editor. A person is never told whether a resource they cannot see exists: the 404 body is the same for unknown and other-workspace resources.

**Server clock.** Every time rule below (waits, retry delays, schedules, idempotency windows, edit holds, run timestamps) follows the workspace's server clock: real time plus an offset stored per workspace, moved only by the grading clock route. The server checks for due timers every `SCHEDULE_TICK_SECONDS` of real time. The browser never decides time-dependent state; it shows what the server pushes. Times on screen are formatted `<YYYY-MM-DD> <HH:mm:ss> <zone abbreviation>` in the zone named by `WORKSPACE_TIME_ZONE` (for example `2027-03-14 03:00:00 EDT`).

**Several server instances.** The grader may start extra instances that share the database, each with one dependency broken. An instance's identity is the port it is bound to: the value of `APP_PUBLIC_PORT`, or 4173 when that is unset. `APP_PUBLIC_URL` never decides identity, because several instances may be given the same one. Each instance is bound to its own port, so no two running instances share an identity. The port stays the same across restarts, so a restarted instance resumes the runs and schedules it owns.

- **Runs.** A run is owned by the instance that created it, including runs created by a grading setup call to that instance. Only the owner executes the run's steps and fires its wait and retry timers, on its own tick or on a clock call made to it.
- **Schedules.** An automation's schedule is owned by the instance that published its live version. Only that instance fires its schedule, and each scheduled instant creates at most one run.
- **Instant checks.** Edit holds and idempotency windows are checked against the workspace clock when a request arrives, on whichever instance receives it.

**Node kinds** (nothing else exists). Triggers (exactly one per automation, id `trigger`, port `out`):

| `data-kind` | Fields (JSON keys in `fields`) | Trigger output |
|---|---|---|
| `form` | `path`, `form_fields` (list of `{"name","label","type"}` with type `text` or `number`) | the submitted values; text as strings, number fields as numbers |
| `schedule` | `schedule` | `{"fired_at":"<scheduled instant, ISO UTC>"}` |
| `webhook` | `path` | the parsed request body object |
| `row_added` | `table` (table id) | the new row: its columns plus `_row_id`. Only a person adding a row (table screen or rows API) fires it; rows added by a run never do |
| `manual` | none | the run's `input` object |

A trigger also has `sample` (a JSON object) used by test runs.

Steps:

| `data-kind` | Fields | Output | Ports | Failure messages |
|---|---|---|---|---|
| `set` | `values` (object of name to template) | the object of resolved values | `out`, `error` | none |
| `filter` | `left`, `operator`, `right` | `{"passed":true}` or `{"passed":false}` | `out` | none |
| `branch` | `left`, `operator`, `right` | `{"result":true}` or `{"result":false}` | `true`, `false` | none |
| `loop` | `source` (`list` or `table`), `list`, `table` | `{"count":<items>}` | `each`, `done` | `Loop source is not a list`; `Table not found: <value>` |
| `wait` | `seconds` | `{"waited_seconds":<n>}` | `out` | none |
| `send_email` | `to`, `subject`, `body` | `{"to","subject"}` | `out`, `error` | `Recipient is not a workspace member: <address>`; `Mail server did not accept the message` |
| `add_row` | `table`, `values` (column to template) | the new row object with `_row_id` | `out`, `error` | `Column <column> must be a number`; `Table not found: <value>` |
| `update_row` | `table`, `row_id`, `values` | the updated row object | `out`, `error` | `Row <row id> not found`; `Column <column> must be a number`; `Table not found: <value>` |
| `call_webhook` | `url`, `body` (object of name to template) | `{"status":<n>,"body":<parsed JSON or text>}` | `out`, `error` | `Webhook answered <status>`; `Webhook could not be reached` |

Step rules: each step has exactly one incoming edge. A `filter` whose condition is false stops the run (it is `succeeded` with `{"passed":false}`, every step that has not run becomes `skipped`, and the run ends `succeeded`), even inside a loop body. A `loop` iterates either a template that must resolve to a list (`source` `list`) or all rows of a table (`source` `table`, each row an object of its columns plus `_row_id`); `{{loop.item.<path>}}` is the current item and `{{loop.index}}` counts from 1; a loop inside another loop's `each` part is refused at publish. A `wait` holds for `seconds` (1 to `WAIT_MAX_SECONDS`) of workspace time and shows `waiting` with a due time. `send_email`: `to` must resolve (trimmed, compared without regard to case) to a workspace member's email, otherwise the step fails; the message is sent from `MAIL_FROM`; the step succeeds only after Mailpit has accepted the message. `add_row` and `update_row`: built-in tables have text and number columns only; a value for a number column must be a number or text that parses as a finite decimal after trimming, and is stored as a number, otherwise the step fails; a listed column that does not exist is ignored; unlisted columns stay empty (add) or unchanged (update). `call_webhook` posts the `body` object as JSON to `url`, which must be a path beginning `/hooks/` or an absolute http address whose host and port are those of `APP_PUBLIC_URL` (or `127.0.0.1` or `localhost` on the app's own port); any other host is refused at publish; redirects are not followed; a non-2xx answer fails the step.

**Execution order.** Steps run one at a time, following edges from the trigger. When one port has several edges they run in `data-order` order (1, 2, ...), and each target's whole downstream part finishes before the next starts (depth first). A loop runs its whole `each` part for item 1, then item 2, through the last item; then its `done` part. A `branch` runs only the matching port's part, and every step on the other port's part becomes `skipped`. A failing step with an `error` edge runs that edge's part and its `out` part is skipped. Worked example: trigger `out` to `s1` (set); `s1` `out` has two edges, order 1 to `s2` (a loop) and order 2 to `s5` (send email); `s2` `each` has order 1 to `s3` (add row) and order 2 to `s4` (set); `s2` `done` goes to `s6` (send email). With two loop items the executed order is trigger, `s1`, `s2`, `s3`, `s4`, `s3`, `s4`, `s6`, `s5`.

**Run step order.** The run step order is the same in a run's step records: the run detail's `steps` array, the run step list and the step-list Tab order.

1. **The trigger comes first.** Its entry has id `trigger`, its kind and status `succeeded`, with input `{}` and the trigger output as its output. It has 1 attempt, an empty log (in a replay, only the reuse line from Replay) and the run's start time as both its start and finish.
2. **Each executed step appears once**, at the position of its first execution, so the worked example lists trigger, `s1`, `s2`, `s3`, `s4`, `s6`, `s5`. A loop body step shows the status, input and output of its latest execution, and `attempts` counts the attempts of that latest execution. Its log holds the lines of every execution, in order.
3. **Steps that never ran come last**, by id number.

**Template syntax.** `{{trigger.<path>}}`, `{{steps.<id>.<path>}}` (the latest output of that step), `{{loop.item.<path>}}`, `{{loop.index}}`, `{{run.id}}`. Paths are dot-separated with numeric list indexes (`items.0.name`); spaces just inside the braces are ignored. A field whose text is exactly one expression (nothing before or after it) keeps the value's type. Any other field becomes a string: numbers as written in JSON, `true` or `false`, objects and lists as compact JSON, null and missing as empty text. An unknown path (including a loop path outside a loop, or a step that has not run) resolves to empty text and adds the step-log line `Unknown template path: <path>` to the step that used it. Text with `{{` and no closing `}}` stays as written. Worked examples with trigger `{"name":"Ada","qty":3,"flag":true,"items":[{"name":"Pen"},{"name":"Ink"}]}`:

1. `{{trigger.qty}}` gives the number 3 (type kept); `Qty: {{trigger.qty}}` gives the string `Qty: 3`.
2. `{{trigger.flag}}` gives the boolean true; `Flag: {{trigger.flag}}` gives `Flag: true`.
3. `{{trigger.items}}` gives the list; `Items: {{trigger.items}}` gives `Items: [{"name":"Pen"},{"name":"Ink"}]`.
4. `{{trigger.items.1.name}}` gives `Ink`.
5. `Hi {{trigger.nope}}!` gives `Hi !` and the log line `Unknown template path: trigger.nope`; a whole-expression `{{trigger.nope}}` gives an empty string and the same line.
6. In loop iteration 2 over the items, `Row {{loop.index}}: {{loop.item.name}}` gives `Row 2: Ink` and `{{loop.index}}` alone gives the number 2.
7. `{{run.id}}` gives the run's id as a string.

**Conditions** (filter and branch). Operators: `equals`, `not equals`, `contains`, `greater than`, `less than`, `is empty`, `is not empty`. Both sides are resolved to text, and compared as numbers when both parse as finite decimal numbers after trimming (an optional sign, digits and an optional fraction; no exponent, hex, `Infinity` or `NaN`), otherwise as case-sensitive strings by code unit. `contains` tests whether the left text includes the right text. `is empty` is true when the left text is empty after trimming. Examples: `"10"` greater than `"9"` is true (numbers); `"abc"` less than `"abd"` is true (strings); `"Apple"` equals `"apple"` is false; `"10"` greater than `"9a"` is false (strings, since `"1"` sorts before `"9"`); `"1.0"` equals `"1"` is true (numbers).

**Run and step state machines.** Run: `queued`, `running`, `waiting`, `succeeded`, `failed`, `cancelled`. Allowed transitions: queued to running; running to waiting; waiting to running; running to succeeded; running to failed; queued, running or waiting to cancelled. A run is created queued and the engine takes it to running at once. A finished run (succeeded, failed, cancelled) never changes again; cancelling it is refused with the API's cancel conflict body, and replaying a run that is not failed is refused with the replay conflict body. A run is `waiting` while a wait step holds it; a step in `retrying` leaves the run `running`.

Step: `pending`, `running`, `waiting`, `retrying`, `succeeded`, `failed`, `skipped`, `cancelled`. Allowed transitions: pending to running; running to succeeded; running to failed; running to retrying; retrying to running; running to waiting; waiting to succeeded; waiting to cancelled; retrying to cancelled; pending to skipped. Inside a loop body a step that finished may start again (succeeded or failed to running) for the next iteration, and its status always shows its latest execution. At run start every step of the bound version is `pending`; when the run ends every step still `pending` becomes `skipped`. A step that failed and followed its `error` edge stays `failed`, and the run ends `succeeded` if nothing else fails: for example, if `s2` fails after its last attempt and has an `error` edge to `s3` (send email), `s3` runs and succeeds, `s2` stays `failed`, `s2`'s `out` part is `skipped`, and the run is `succeeded`.

**Cancel.** Cancelling a waiting run marks the waiting step `cancelled`, every step not yet run `skipped`, and the run `cancelled`; it never resumes, however far the clock advances. Cancelling a retrying run marks the retrying step `cancelled` the same way. A step already executing finishes and keeps its status.

**Retries.** A failing step is retried `RETRY_COUNT` times, `RETRY_DELAY_SECONDS` apart on the workspace clock, showing `retrying` (with `retry_at`) between attempts. The total number of attempts is `RETRY_COUNT + 1`. Every attempt writes a step-log line: `Attempt <n> of <total> failed: <message>` or `Attempt <n> of <total> succeeded` (a wait step writes its line when the wait ends). After the last failed attempt the step follows its `error` edge when it has one; otherwise the run fails with the run message `Step <id> failed after <total> attempts: <message>` and every step not yet run is `skipped`. For example, with the defaults, a step that first fails at time T retries at T plus 30 seconds and again at T plus 60 seconds, so its log holds three failed-attempt lines for a persistent failure.

**Step limit.** A step execution is one step starting (retries do not add; reused steps do not count; the trigger does not count). When a run would make its `STEP_LIMIT + 1`th execution it fails with the run message `Step limit of <limit> reached`; the step that would have run is `skipped` if it has never run (a step that ran in an earlier iteration keeps its status), every step that has not run is `skipped`, a loop the limit interrupted is `failed`, and the announcement names the step that would have run. For example, with the defaults, a loop with two body steps over 25 items executes 1 plus 19 times 2 plus 1, which is 40 executions, so the second body step of iteration 20 would be execution 41 and the run fails there.

**Drafts, versions and test runs.** An automation is edited as a draft; the draft's `revision` rises by one on every accepted change. Publish creates the next version (1, 2, ...) with the draft's content, validated as under Publish refusals; versions are immutable; the newest is live. A draft whose `revision` equals the live version's revision cannot be published. Only the live version answers forms, hooks, schedules and the Run now control. A version's status is `live` while newest, `draining` once superseded while any non-test run bound to it is queued, running or waiting, and `retired` when superseded with no such run. The automation's **drain count** is the number of non-test runs bound to any version older than the live one that are queued, running or waiting; it is pushed whenever it changes and is announced as published in Feedback states. A run binds to the version live when it started and finishes on it even if a newer version is published meanwhile (including a run asleep in a wait step); the run detail shows `Version <n>`. A test run is marked (`data-test="true"`, a `Test` chip), binds to a snapshot of the draft taken at its start, shows `Draft` instead of a version, is left out of the drain count, performs its steps for real (rows are added, emails are sent), and appears in the run list and its counts only when the test filter is on.

**Replay.** A failed run can be replayed from any step at or before its failed step in the order the steps first executed, except a step inside a loop's `each` part (the loop step itself may be chosen). The trigger may be chosen too: then only the trigger output is reused and every other step executes again. In every replay the trigger entry is reused. A replay creates a new run on the original's version (a replay of a test run is a test run on the same snapshot), with the original's trigger output, linked by `data-replay-of="<original run id>"`. Every step executed before the chosen one is reused: it shows its recorded status and output, `data-reused="true"`, the log line `Reused output from run #<n>`, and is not executed again, so a send-email step sends nothing; a branch before the chosen step takes the port its recorded output names. Steps from the chosen step onward execute normally and count toward the step limit. Replay creates a new run number and the page lands on the new run's route.

**Schedules.** Formats: `every N minutes` (N from 1 to 1440) and `daily at HH:MM` in `WORKSPACE_TIME_ZONE`. Each firing is its own run, bound to the live version, with the scheduled instant as `fired_at`. Publishing anchors a schedule: the first `every N minutes` firing is N minutes after the publish moment and each later one N minutes after the previous scheduled instant; a daily schedule fires at the next occurrence of its wall-clock time after the publish moment. When the clock jumps forward, every firing due at or before the new time fires in order, one run each. A newer version replaces the older version's schedule. Daily rules: a time that does not exist on the spring-forward day fires at the next existing minute (the first minute after the skipped hour); on the fall-back day a repeated time fires once, at its first occurrence. For example, with the default zone, `daily at 02:30` fires on 2027-03-13 at 02:30 EST (07:30 UTC), on 2027-03-14 at 03:00 EDT (07:00 UTC, since 02:30 does not exist), and `daily at 01:30` fires on 2027-11-07 once, at 01:30 EDT (05:30 UTC) and not again at 01:30 EST (06:30 UTC).

**Webhook trigger.** The address is `/hooks/<workspace slug>/<path>`; POST only; content types `application/json` and `application/x-www-form-urlencoded`; body limit `WEBHOOK_BODY_LIMIT_BYTES` (a body of exactly that many bytes is accepted, one byte more is refused). Error order, stated once for this route: 404, then 405, then 413, then 415, then 422, then the key rules. Bodies:

| Status | Body | When |
|---|---|---|
| 404 | `{"error":"Not found"}` | unknown workspace or path, or the automation has no live version |
| 405 | `{"error":"Method not allowed"}` with header `Allow: POST` | any method other than POST |
| 413 | `{"error":"Body is larger than <limit> bytes"}` | body over the limit (`<limit>` is `WEBHOOK_BODY_LIMIT_BYTES`) |
| 415 | `{"error":"Content type must be application/json or application/x-www-form-urlencoded"}` | other content type |
| 422 | `{"error":"Body is not valid JSON"}` or `{"error":"Body must be a JSON object"}` | JSON that does not parse or is not an object |
| 202 | `{"run_id":"<id>","replayed":false}` | first delivery; starts one run |
| 200 | `{"run_id":"<same id>","replayed":true}` | the same `Idempotency-Key` with the same body (compared by bytes) inside `IDEMPOTENCY_WINDOW_SECONDS`; starts no run |
| 409 | `{"error":"Idempotency-Key was already used with a different body"}` | the same key with a different body inside the window |

The window is measured on the workspace clock from the first delivery that used the key; after it, the same key is new again and starts a run. Refused deliveries (404, 405, 413, 415, 422) never record a key, and a 409 does not extend the window. Form-encoded bodies become an object of strings (the last value wins for a repeated name). A delivery with no key is never treated as a replay. Replay is checked per workspace, hook path and key.

**Collaboration.** Two or more members on the same draft see the presence notice `<name> is also editing this draft` in `status "Draft notices"`, pushed live when another member opens or leaves the draft (a member's own other tabs do not count). Saves are applied in the order the server receives them. A member's accepted save of a step's name, fields or sample holds that step for `EDIT_HOLD_SECONDS` of workspace time after their latest save to it. Another member's save to a held step answers `409` with `{"error":"<holder name> is editing <step name>. Your change was not saved.","step":<the step as saved>}`; the refused member sees that error text as the live notice in `status "Draft notices"` and the field shows the holder's value from `step`. Once the hold has lapsed anyone may save. A member never conflicts with their own hold. Moving a step does not need or take a hold. When two members make a first save of a fresh step at the same moment, exactly one wins: the one the server receives first. An accepted save is pushed to everyone on the draft and the field updates in place with no reload.

**Tables.** Table names and column names are free text within the 60-character rule; column types are `text` or `number`. A number-column value that is not a number or numeric text answers (and a step fails with) `Column <column> must be a number`. Row changes push a `table` event, and the table screen updates in place.

**Export and import.** Export of version `<n>` writes the file to MinIO under `exports/<workspace id>/<automation id>/v<n>.json` and the UI shows `Export saved` only after storage confirms; the response body is the same bytes. The file is UTF-8 JSON containing no timestamps, so exporting a version twice gives identical bytes. Top-level keys: `format` (`"switchyard-automation"`), `format_version` (`1`), `name`, `trigger` (`kind`, `col`, `row`, `fields`, `sample`), `steps` (each `id`, `kind`, `name`, `col`, `row`, `fields`) and `edges` (each `from`, `port`, `to`, `order`). Import (owner or editor) checks, in order: parses as JSON; `format` and `format_version` match; every step's `kind` is one of the nine step kinds and the trigger's kind is one of the five trigger kinds (otherwise `Unknown node kind: <kind>`); edges follow the edge refusals. Only a file that passes all of these is stored, under `imports/<workspace id>/<import id>.json`, byte for byte as uploaded, and a new draft is created from it (same step ids, cells, fields and edges; table ids are kept as written and a table that does not exist here makes that step fail at run time with `Table not found: <value>`). The new draft is not published.

**Limits.** JSON bodies and names follow the API error table. Import files are limited as in the imports row. Every API route answers within two seconds for any body inside these limits, including deeply nested or very long text.

### Services

- **Postgres** holds users (password stored only as a salted hash), workspaces, members and roles, invites, drafts, numbered immutable versions, built-in tables and rows, runs and per-step records (status, attempts, input, output, log, timing), timers, idempotency keys, schedule claims, edit holds and each workspace's clock offset. The schema is created idempotently when the server starts. Run state survives restart: waiting runs and retrying steps resume at their recorded due times, steps recorded `succeeded` are never executed again, and a step that was mid-attempt starts its next attempt.
- **MinIO** holds every export under `exports/<workspace id>/<automation id>/v<n>.json` and every accepted import under `imports/<workspace id>/<import id>.json`, content type `application/json`, in the bucket named by `S3_BUCKET`. When storage is unreachable, export and import answer 503 with the storage body from the API and the UI shows the storage outage alert from Feedback states; nothing is marked saved and no download starts.
- **Mailpit** receives real SMTP from the app, with the From from `MAIL_FROM`: sign-up confirmation (To the new user; Subject `Confirm your Pinbyte Switchyard account`; the body holds the link `<APP_PUBLIC_URL>/confirm/<token>`), member invite (To the invitee; Subject `<inviter name> invited you to <workspace name> on Pinbyte Switchyard`; the body holds `<APP_PUBLIC_URL>/invite/<token>`) and every send-email step (To the resolved member email, the templated Subject and Body as plain text, and the header `X-Switchyard-Run: <run id>`). A step is succeeded only after the mail server accepts the message; sign-up and invite answer success only after acceptance. When the mail server is unreachable, sign-up and invite answer 503 with the API body and the UI shows the matching mail outage alert; a send-email step fails with `Mail server did not accept the message`, retries on the workspace clock and then takes its `error` edge or fails the run.
- **Health.** `GET /api/health` always answers HTTP 200. It answers `{"status":"ok"}` when Postgres, MinIO and the mail server are all reachable, and `{"status":"unavailable"}` when MinIO or the mail server is not (the outage instances).

### Seed data

Every seeded person and business is invented. The server creates these when absent at start (idempotently):

| Item | Values |
|---|---|
| Users (all confirmed, password `switchyard-demo-1`) | `Imara Teague` `imara@fulfilment.example` (owner); `Dov Marchetti` `dov@fulfilment.example` (editor); `Wren Adeyemi` `wren@fulfilment.example` (viewer); `Soren Hale` `soren@harbor.example` (owner of the second workspace) |
| Workspace 1 | id `ws-fulfilment`, name `Fulfilment Ops`, slug `fulfilment-ops`; members Imara (owner), Dov (editor), Wren (viewer) |
| Workspace 2 | id `ws-harbor`, name `Harbor Desk`, slug `harbor-desk`; member Soren (owner) |
| Table `Orders` (`tb-orders`) | columns `customer` text, `item` text, `quantity` number; rows `r1` Cobalt Studio, Ribbon, 12; `r2` Harbor Bakery, Tape, 40; `r3` Lumen Print, Labels, 7 |
| Table `Followups` (`tb-followups`) | columns `customer` text, `position` number; no rows |
| Automation `Order intake` (`au-order-intake`, workspace 1, version 1 live) | trigger form, path `order-intake`, fields `customer` (label `Customer`, text), `item` (label `Item`, text), `quantity` (label `Quantity`, number), sample `{"customer":"Cobalt Studio","item":"Ribbon","quantity":12}`; `s1` add row to `Orders` with values `{{trigger.customer}}`, `{{trigger.item}}`, `{{trigger.quantity}}`; `s2` send email to `imara@fulfilment.example`, Subject `New order from {{trigger.customer}}`, Body `{{trigger.quantity}} x {{trigger.item}}`; edges trigger `out` to `s1` (order 1) and `s1` `out` to `s2` (order 1) |
| Automation `Harbor digest` (`au-harbor-digest`, workspace 2) | manual trigger, draft only, no steps, no versions |

All workspace clocks start with offset zero. No runs exist at start.

## Technical requirements

### Deployment (DP-79, DP-81)

Backend: TypeScript on Node 22, compiled during the build. Frontend: TypeScript built with Node 22.

The app root holds `/app/run.json`: one JSON object with the string fields `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, for example `{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm start"}`. The server binds `0.0.0.0` on port 4173 and honours `APP_PUBLIC_PORT` when it is set. `GET /api/health` answers HTTP 200 with JSON `{"status":"ok"}` as described under Services. The grader starts two extra instances on the next ports with one dependency broken and reads their addresses from `APP_MINIO_DOWN_URL` (S3 endpoint set to `http://127.0.0.1:9`) and `APP_MAILPIT_DOWN_URL` (SMTP host `127.0.0.1`, SMTP port `9`, and `MAILPIT_URL` set to `http://127.0.0.1:9`). Outage instances share the primary's database and bucket.

### Configuration and secrets (DP-80, DP-82)

Service credentials and service URLs are read from the environment at start. They are never hard-coded and never sent to the browser. Service variables: `DATABASE_URL`; `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`; `SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL`; `MAIL_FROM`; `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`. The server reads the following knobs, which the grader sets per instance, and uses the default shown when one is unset. Each limit is inclusive: the value itself is allowed. The server embeds `CANVAS_BREAKPOINT_PX` and `WORKSPACE_TIME_ZONE` in the app shell page it serves, so the browser takes the breakpoint and the zone from the instance that served the page. No other knob reaches the browser.

| Env var | Default | Unit and meaning |
|---|---|---|
| `GRADING_KEY` | `gk-switchyard-4c9e27b1` | secret guarding the grading routes |
| `WORKSPACE_TIME_ZONE` | `America/New_York` | IANA zone of every workspace: schedules and displayed times |
| `RETRY_COUNT` | `2` | retries after a step's first failed attempt (so 3 attempts in all) |
| `RETRY_DELAY_SECONDS` | `30` | workspace-clock seconds between attempts |
| `STEP_LIMIT` | `40` | step executions one run may make (loop iterations count each body step) |
| `WAIT_MAX_SECONDS` | `86400` | longest wait a wait step may hold, in seconds |
| `WEBHOOK_BODY_LIMIT_BYTES` | `4096` | largest webhook body accepted, in bytes (4,096 accepted, 4,097 refused with the defaults) |
| `IDEMPOTENCY_WINDOW_SECONDS` | `600` | how long a webhook idempotency key is remembered, in workspace seconds |
| `EDIT_HOLD_SECONDS` | `20` | how long a member's save holds a step against other members, in workspace seconds |
| `SCHEDULE_TICK_SECONDS` | `1` | real seconds between the server's checks for due timers |
| `CANVAS_BREAKPOINT_PX` | `720` | viewport width in CSS pixels below which the canvas is replaced by the step list |
| `MAIL_FROM` | `Pinbyte Switchyard <runs@switchyard.example>` | the From of every email |

### Server boundary (DP-72, DP-80)

Same origin only: no cross-origin resource sharing headers are sent, and mutating requests with a foreign `Origin` are refused as the API error table says (except the public form and webhook routes). The session cookie is named `switchyard_session`, is HttpOnly, SameSite Lax, path `/`, and holds an opaque random value. Request size limits are in the API (JSON bodies, imports) and Business rules (webhooks). The server serves only built static assets and the app shell; it never serves source files, environment values, lockfiles or credentials, and unknown `/api/` paths answer the JSON 404. Unknown non-API addresses serve the app shell, which shows the not-found page. If Postgres is unreachable at boot the server retries for up to 30 seconds and then exits with a non-zero status; if MinIO or the mail server is unreachable at boot the server still starts and serves, and the matching actions answer as the Services section says.

### Browser support and performance (DP-26, DP-69, DP-78)

Current Chromium, Firefox and Safari, at 375x812, 768x1024 and 1280x800. The device clock may be wrong and may be paused: every screen shows what the server pushed and never decides due, waiting, expired or held from its own clock. The landing page is usable within three seconds on a local network; a pushed run change appears on screen within one second of the server recording it; API routes answer within two seconds as stated in Business rules.

## Working rules

- IF-01: `/app/run.json` is a JSON object with string `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`.
- IF-02: `THIRD_PARTY_NOTICES.md` at the app root lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) with name, version and licence, and every bundled font file with its licence.
- IF-03: Shipped packages and bundled fonts carry only MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC or SIL OFL 1.1 licences.
- IF-04: No datastore, cache, queue or database file exists beyond Postgres and MinIO, and the automation engine runs inside the app server.
- IF-05: Neither the server nor the browser makes any network request at runtime except to the app itself, Postgres, MinIO and the mail server; fonts and images are bundled.
- IF-06: The service definitions and dev credentials supplied with the task are left untouched, and the app reads every credential from the environment.
- IF-07: A lockfile is committed and `install` uses it, with no step that downloads anything outside the package registry.
- IF-08: User-visible copy, routes and role names never call an automation or a run a "workflow", "flow" or "zap", and the product contains no AI feature.

## Engineering standards

- The code is idiomatic strict TypeScript with explicit types at module boundaries, and it builds without type errors or lint warnings.
- Names match this brief's domain terms: automation, trigger, step, edge, port, run, version, draft, drain, replay, workspace clock.
- Each domain rule is decided in exactly one place: run and step status transitions, the retry rule, the step limit, version binding, schedule time resolution, the edit hold, the idempotency window, and role checks.
- No abstraction exists with a single implementation, and no module exists only to wrap another call.
- There is no dead, commented-out or unreachable code and no defensive check for a state the rules make impossible.
- Every error answered by the API goes through one error shape and one place that builds it, and every refusal message is defined once.
- Time is read from the workspace clock in one place, so no rule reads the machine clock directly.
- The product contains nothing beyond this brief: no extra routes, node kinds, settings or roles.
