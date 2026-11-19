# Tidemark Daybook

Tidemark Daybook is a subscription daily-planning workspace for knowledge workers who book their own calendars, such as independent consultants, staff engineers and freelance designers, and for the small studios that pay for their seats. Each morning a member pulls tasks into five ruled day columns and estimates them. They then check each day against a personal workload threshold, using a gauge called the Waterline, and timebox the tasks onto a calendar strip. In the evening they shut the day down and receive a digest email. Build it as one web app backed by PostgreSQL (the system of record), Kill Bill (each workspace's trial, monthly per-seat subscription and seat count) and an SMTP mail service that the grader observes through Mailpit (invites, shutdown digests and trial notices). Calendars connect in two ways only: by importing an iCalendar (.ics) file, and through a private outbound feed URL for each member. Task tools connect by CSV import. The app makes no other network calls. Out of scope: payment-card entry, live two-way sync with any third-party calendar or tracker, single sign-on, mobile apps, file attachments, comments, and any datastore other than the provided PostgreSQL.

## Problem and users

People who manage their own calendars keep their tasks in issue trackers, inbox flags and spreadsheets. Every morning they rebuild the day by hand. They often plan nine hours of work into a day that already holds three hours of meetings. Many pay for a planner plus a separate calendar-sync add-on, and they still lose time to the same sync faults: deleted time blocks come back after a refresh, re-importing a task list creates duplicates, a block moved on one device silently overwrites the same block moved on another, and "today" changes at UTC midnight instead of local midnight. The result is overcommitted days, missed deadlines, and a planning ritual that takes longer than the time it saves.

- **Member** (daily): runs the morning ritual. They pull tasks into day columns, estimate them, check each day against their workload threshold, and timebox the tasks onto the calendar. In the evening they shut the day down.
- **Workspace owner** (weekly): pays for seats, invites and removes studio members, and reviews the workspace's weekly planned-versus-done totals. The owner is also a member and plans their own days.
- **Founder operator** (occasionally): keeps billing state, queued mail and imports healthy for every workspace without seeing anyone's task content.

## Journeys

1. **Start a trial.** Start state: a signed-out visitor on the sign-in screen. They follow "Start a free trial", enter a workspace name, their name, email, password and time zone, and submit. End state: their empty Daybook, with five day columns starting at today in their time zone, a subscription banner showing the trial days left, and, in Kill Bill, an account for the workspace with one active seat.
2. **Morning ritual.** Start state: seeded member Tama Rewiti (Auckland) signs in. They open step 1 Pull, import their tracker's CSV export, and quick-add one task. In step 2 Estimate they set estimates. In step 3 Check they read each day's Waterline. In step 4 Timebox they drag a card over tomorrow's column, see the ghost cross the tidemark and the over label appear, drop it on a day with room, then drag it onto a calendar slot. End state: the task appears as a timed block on the calendar strip and in Tama's feed. Each column's total matches the server.
3. **Re-import the next morning.** Start state: a member with cards from yesterday's CSV import. They import the same export again with one edited title and one new row. End state: the summary reports one updated and one created card and the rest unchanged. No duplicate cards exist.
4. **Two devices.** Start state: the same member is signed in on a laptop and a phone, both showing a session at 10:00. The laptop moves it to 11:00. The phone, not yet refreshed, moves it to 14:00. End state: the session is at 11:00 on both devices. The phone's block snaps back to 11:00 and the reason is announced.
5. **Evening shutdown.** Start state: a member with done and unfinished cards today. They open step 5 Shut down, review the preview and send it. End state: unfinished cards sit at the top of tomorrow's column. One digest email reaches their inbox. A second shutdown the same local day sends no second email.
6. **Run the studio.** Start state: owner Wren Castell on the Workspace page. They invite a new address, remove a member and step back one week in the review. End state: Kill Bill's active seat count equals the members table's seat count, the invitee has one invite email, and the review shows per-member planned and done minutes for that week.
7. **Subscribe from another calendar.** Start state: a member in Settings. They copy the feed URL into another calendar app, later rotate it and confirm. End state: the old URL answers not found and the new one serves the same events.
8. **Operator check.** Start state: the operator signs in. They open Operations after billing callbacks have arrived and after a period when mail was unreachable. End state: each workspace shows its current subscription state, active and billed seats, queued work and import activity. No task, meeting or routine names appear anywhere.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Workspace sign-up** Creating a workspace starts it in the trialing state with its owner signed in, and registers a Kill Bill account plus one seat for the owner, or queues that registration when Kill Bill is unreachable, as qualified in Services.
- **DP-02 — Trial start journey** A visitor who fills in the trial form lands on an empty Daybook for their new workspace with the subscription banner showing the trial days left.
- **DP-03 — Trial clock and notice** The trial ends a configured length after workspace creation, checked on the server, and the owner receives exactly one trial-ending email at the configured lead time before it ends, as set out in Business rules and Services.
- **DP-04 — Read-only workspace** In the read-only and cancelled states every planning write is refused with the read-only error, while reads, sign-in, settings, member removal and the calendar feed keep working.
- **DP-05 — Task import matching** Importing a CSV task export matches rows on source and external id, so a repeat import updates existing cards and creates none, and the response reports created, updated, unchanged, merged, rejected and orphaned rows.
- **DP-06 — Import journey** A member opens the task import dialog, uploads a CSV export, hears the import summary announced, and finds the new cards in the Backlog.
- **DP-07 — Quick add and suggestions** Typing in the add-a-task box suggests at most eight of the member's own open tasks and never a task from another member or workspace, and Enter adds a new Backlog card.
- **DP-08 — Calendar file import** Importing an .ics file creates or updates meetings matched on event UID, skips all-day and repeating events, and adds each meeting's minutes to the local days it overlaps.
- **DP-09 — Meetings on the calendar** After a calendar import the member sees each meeting as a ruled block on the calendar strip at its local time, and the affected day totals grow by its minutes.
- **DP-10 — Derived day load** Every day's task, meeting, routine and planned minutes are computed from server-side records only, and any total a client sends is ignored.
- **DP-11 — Local today** Today, the five day columns and the past-day rejection follow the member's profile time zone rather than the server's or the browser's, and the board rolls over within a minute of local midnight without a reload.
- **DP-12 — Estimating cards** In the Estimate step a member picks an estimate on a card, and the card, the day total and the Waterline update to the server-confirmed value.
- **DP-13 — Waterline gauge** Each day column shows a fill whose height against the tidemark equals planned minutes over the threshold, capped at 1.2, with a tidemark rule at the threshold and the over label whenever the day is over.
- **DP-14 — Drag preview** While a card is held over a day column by pointer, touch or keyboard, a ghost segment of its estimate stacks on that column's fill, and the part above the tidemark is hatched with the over label beside it.
- **DP-15 — Task versions** Every task change carries the version it was based on, and a change based on an older version is refused with the conflict error and the current task, leaving the task unchanged.
- **DP-16 — Honest card moves** A card dragged to another column moves at once, and if the server refuses the move the card returns to its previous column, the fill drains back and the reason is announced.
- **DP-17 — Keyboard moves** A card can be picked up with Space, carried between the Backlog, day columns and calendar slots with arrow keys, dropped with Enter and put back with Escape, with focus staying on the card.
- **DP-18 — Timebox once** Creating a timed session requires an idempotency key, a replay returns the original response, and a task never has more than one session, even under parallel requests.
- **DP-19 — Session version winner** When two saves move the same session from the same version, exactly one succeeds and the other gets the conflict error with the winning session, whose start and end both come from the winner.
- **DP-20 — Timebox journey** Dropping a card on a calendar slot turns it into a block whose height matches its estimate, and the column's fill stays put when the task was already planned on that day.
- **DP-21 — Removed sessions stay removed** Deleting a session removes it from the calendar, the board and the feed for good, and it does not reappear after a reload or a re-import.
- **DP-22 — DST-safe routines** Routines keep their local start time on every applicable day, including across daylight-saving changes, with exactly one occurrence per qualifying local date under the gap and overlap rule in Business rules.
- **DP-23 — Routine journey** A member adds a routine in Settings and sees it on the calendar strip at the same local time on each board day it applies to.
- **DP-24 — Private calendar feed** Each member has a secret feed URL that serves their timed sessions and routine occurrences as an iCalendar file, with exactly one event per session or occurrence.
- **DP-25 — Feed rotation** Rotating the feed URL makes the old URL answer not found at once, the new URL serves the same events, and no feed URL accepts anything but reading.
- **DP-26 — Feed settings journey** A member copies the feed URL, confirms a rotation in Settings, and sees the new URL and the rotation announcement.
- **DP-27 — Evening shutdown** Shutting down the day moves today's open tasks to tomorrow, clears their sessions, and reports done, carried-over and tomorrow's first item for the member's local day.
- **DP-28 — Shutdown digest** Each member gets at most one shutdown digest email per local day, queued and sent once later when mail is unreachable, as qualified in Services.
- **DP-29 — Shutdown journey** A member opens the Shut down step, reviews the preview, sends the shutdown, and sees today's open cards move to tomorrow with the outcome announced.
- **DP-30 — Invites hold seats** An owner's invite adds one Kill Bill seat and sends one invite email, and when billing is unreachable the invite waits without a seat or email until billing accepts the seat, as qualified in Services.
- **DP-31 — Removing members** Removing a member cancels their seat in Kill Bill and ends their access and feed, or changes nothing when billing is unreachable, and the owner cannot be removed.
- **DP-32 — Join journey** An invited person opens the emailed link, sets their name, password and time zone, and lands on their own empty Daybook in the inviting workspace.
- **DP-33 — Weekly review totals** The owner's weekly review sums planned and done estimate minutes per seat-holding member for an ISO week by each member's local dates, counting only the owner's workspace.
- **DP-34 — Review screen** An owner sees the Workspace page with the seat count, the members table and the weekly review table, and can step between weeks.
- **DP-35 — Verified billing callbacks** Billing callbacks are accepted only with a valid signature and a fresh timestamp, and a repeated event id changes nothing.
- **DP-36 — Subscription states** The workspace subscription follows the state machine in Business rules, derived from every verified event in occurredAt order so that the final state never depends on the order events arrive in.
- **DP-37 — Queued work recovers** Work queued while Kill Bill or mail is unreachable completes exactly once within the recovery window in Business rules after any running instance can reach the service again, without a restart.
- **DP-38 — Operator overview** The operator sees every workspace's subscription state, seats, queued work and import activity with no task, meeting or routine content, and no other role can see this overview.
- **DP-39 — Run manifest and health** The app installs, builds and serves from the run manifest on the configured port and answers the health check, even when Kill Bill or mail is unreachable at boot.
- **DP-40 — Server boundary** The server accepts only same-origin writes within the stated size and content-type limits, and never serves source, configuration or credentials.
- **DP-41 — Credentials from environment** Every service URL and credential is read from the environment at start and is never hard-coded or sent to the browser.
- **DP-42 — Responsive notebook** Every screen fits the three viewports in Screens and layout without horizontal page scrolling, using the arrangement described for each width.
- **DP-43 — Notebook look** The Daybook reads as a paper notebook spread, with a warm paper ground, ink text, serif day headings over ruled columns, mono numerals, flat ruled slips and one green accent per screen.
- **DP-44 — Motion and reduced motion** Fills, ghosts, counters and rollbacks animate within the stated durations, nothing loops for decoration, and with reduced motion every change is instant while labels and announcements still appear.
- **DP-45 — Accessible controls** Every public control has its stated role and name, tab order follows the page, dialogs keep and return focus, and tap targets and contrast meet the Visual design limits.

## Frontend

### Screens and layout (DP-02, DP-09, DP-34, DP-38, DP-42)

The screens are Sign in, Start a trial, Join (from an invite link), Daybook (the main planner), Settings, Workspace (owner only) and Operations (operator only). Every screen has the `status` live region "Planner updates" (see Feedback states) and a header with the workspace name and the navigation links its role may use. Members and owners see Daybook and Settings, owners also see Workspace, and the operator sees only Operations. All screens fit 375x812, 768x1024 and 1280x800 with no horizontal page scrolling.

**Daybook.** The Daybook is laid out as a notebook spread:
- **1280x800:** a narrow left gutter holds the ritual steps as a numbered margin rail (1 Pull, 2 Estimate, 3 Check, 4 Timebox, 5 Shut down) and, below it, the Backlog of task slips with the add-a-task box on top. The centre holds five ruled day columns side by side, starting at today in the member's profile time zone. Each column has a serif date heading, a mono minutes total, its Waterline gauge and its cards. The right side holds the calendar strip for one selected day (today at first), drawn as half-hour hairlines from 07:00 to 20:00 local time, with Previous day and Next day buttons limited to the five board days.
- **768x1024:** the ritual rail becomes a single row of numbered steps under the header. The Backlog sits full width above the five columns, which share the width as narrow columns. The calendar strip sits full width below them.
- **375x812:** the ritual row stays, scrolling within itself if needed. The Backlog is a collapsible section. The five day columns become five slim gauges in one row, each with a short heading such as "Thu 29", its total and its Waterline. Tapping a gauge's "Show" button lists that day's cards below the row. The calendar strip follows below.

A subscription banner sits under the header on every Daybook, Settings and Workspace screen whenever the workspace is trialing, past due, read-only or cancelled.

**Settings.** A single column at all widths with three sections: Day settings (time zone and workload threshold), Calendar feed (the feed URL with Copy and Rotate) and Routines (the list plus Add routine).

**Workspace.** The Seats section shows the active seat count and the invite form. Below it are the Members table and the Weekly review table, with week navigation. At 375 wide each table row becomes a stacked card with the same cells in order.

**Operations.** The Workspaces table, one row per workspace, with the columns listed in the controls table. At 375 wide rows become stacked cards.

**Sign in, Start a trial, Join.** One centred form on the paper ground, with the product name set in the display serif above it.

### Public screens and controls (DP-06, DP-07, DP-12, DP-13, DP-14, DP-17, DP-26, DP-29, DP-32, DP-34, DP-38, DP-45)

Only these roles, names, labels and hooks are public; everything else is free. `<title>` is the task title, `<Day label>` is a date written as weekday, day number and month name in English (for example "Thursday 29 October"), `<Short day>` is the three-letter weekday and day number (for example "Thu 29"), and times are 24-hour `HH:MM` in the member's profile time zone.

| Role and accessible name | Where | Visible copy |
|---|---|---|
| `form "Sign in"` with fields labelled "Email" and "Password", `button "Sign in"`, `link "Start a free trial"` | Sign in | same |
| `form "Start your trial"` with fields labelled "Workspace name", "Your name", "Email", "Password", `combobox "Time zone"` (prefilled with the browser's zone), `button "Start free trial"` | Start a trial | same |
| `form "Join <workspace name>"` with fields labelled "Your name", "Password", `combobox "Time zone"`, `button "Join workspace"` | Join | same |
| `navigation "Main"` with `link "Daybook"`, `link "Settings"`, `link "Workspace"` (owner), `link "Operations"` (operator), `button "Sign out"` | header | same |
| `region "Subscription"` | banner | copy from Feedback states |
| `navigation "Morning ritual"` with `button "Pull"`, `button "Estimate"`, `button "Check"`, `button "Timebox"`, `button "Shut down"`; the active step carries the current-step state | ritual rail | numerals 1 to 5 beside each word |
| `region "Backlog"` containing `combobox "Add a task"` with `listbox "Suggestions"` of `option` items named by task title, `button "Import tasks"`, `button "Import calendar"`, and a `list` of cards | Backlog | Backlog cards whose day has passed show "From <Day label>" |
| `region "<Day label>"` for each of the five days, containing a level-2 `heading "<Day label>"` (visible text `<Short day>` at 375 wide), the mono total "<planned>m", a `meter "Load for <Day label>"` (minimum 0, maximum 1.2 times the threshold, value the planned minutes capped at that maximum, and value text "<planned> of <threshold> minutes" with the uncapped planned minutes; checks read the value text), and a `list` of cards | day columns | same |
| `button "Show <Day label>"` | each gauge, at 375 wide only | "Show" |
| Waterline hooks inside each day column: element with `data-part="waterline-fill"`, element with `data-part="tidemark"`, element with `data-part="waterline-ghost"` (present only while a card is held over that column), and element with `data-part="over-label"` (present only while over) | day columns | over label copy from Feedback states |
| Card: `listitem` containing `button "Move <title>"` (the whole slip is also draggable by pointer or touch), `checkbox "Done: <title>"`, the estimate in mono ("<n>m" or "No estimate") | Backlog, day columns | title, estimate |
| `radiogroup "Estimate for <title>"` with `radio` items "15 minutes", "30 minutes", "45 minutes", "60 minutes", "90 minutes", "120 minutes" | each card, while the Estimate step is active | "15m", "30m", "45m", "60m", "90m", "2h" |
| `region "Calendar"` with level-2 `heading "<Day label>"`, `button "Previous day"`, `button "Next day"`, half-hour slots from 07:00 to 20:00 each carrying `data-slot="HH:MM"` | calendar strip | hour labels in mono |
| Session block: `button "<title>, <start> to <end>"` with `button "Remove <title> from calendar"` inside its card area; routine blocks named "<routine name>, <start> to <end>" and meeting blocks named "Meeting: <summary>, <start> to <end>" are not interactive | calendar strip | title and times |
| `dialog "Import tasks"` with a file field labelled "CSV export", `button "Import"`, `button "Close"` | Backlog | same |
| `dialog "Import calendar"` with a file field labelled "Calendar file (.ics)", `button "Import"`, `button "Close"` | Backlog | same |
| `dialog "Shut down"` showing the preview lists under the headings "Done", "Carry over to <Day label>" and "Tomorrow starts with", plus `button "Send shutdown"` and `button "Not yet"` | step 5 | same |
| `form "Day settings"` with `combobox "Time zone"`, `spinbutton "Workload threshold (minutes)"`, `button "Save settings"` | Settings | same |
| `region "Calendar feed"` with a read-only `textbox "Feed URL"`, `button "Copy feed URL"`, `button "Rotate feed URL"` | Settings | same |
| `alertdialog "Rotate feed URL?"` with `button "Rotate"` and `button "Keep current URL"` | Settings | "Calendar apps using the old URL will stop updating." |
| `region "Routines"` with a `list` of routines, `button "Add routine"`, `button "Delete routine <name>"` | Settings | "<name> · <start> · <n>m · Every day" or "… · Weekdays" |
| `dialog "Add routine"` with fields labelled "Name", "Start time", `spinbutton "Minutes"`, `radiogroup "Repeats"` (radios "Every day", "Weekdays"), `button "Save routine"`, `button "Cancel"` | Settings | same |
| `region "Seats"` showing "Active seats: <n>", `form "Invite a member"` with a field labelled "Email" and `button "Send invite"` | Workspace | same |
| `table "Members"` with columns Name, Email, Role, Status (cells "Owner"/"Member", "Active"/"Invited"/"Waiting for billing") and a `button "Remove <name or email>"` in each non-owner row | Workspace | same |
| `table "Weekly review"` with columns Member, Planned, Done and a final "Total" row (minutes in mono as "<n>m"), level-2 `heading "Week of <Day label of Monday>"`, `button "Previous week"`, `button "Next week"` | Workspace | same |
| `table "Workspaces"` with columns Workspace, State, Trial ends, Seats (written "<active> / <billed>", with "—" for billed until a seats callback arrives), Queued, Last import | Operations | same |

### Interactions (DP-07, DP-12, DP-14, DP-16, DP-17, DP-20, DP-23, DP-26, DP-29)

- **Ritual rail.** Activating a step marks it current. Pull moves focus to "Add a task". Estimate reveals the estimate radiogroups on every open card. Check announces how many board days are over the threshold, using the Check copy. Timebox shows a hint above the calendar strip. Shut down opens `dialog "Shut down"` with the preview fetched from the server. The rail has no locked steps: any step can be opened at any time.
- **Add a task.** Typing one or more characters shows up to eight suggestions after a quarter-second pause. Arrow keys move through the options and Escape closes the list. Choosing a suggestion moves focus to that existing card instead of creating a copy. Pressing Enter on the typed text, with no option highlighted, creates a new Backlog card with that title.
- **Estimating.** Choosing a radio sends the estimate. The card's mono estimate, the column total and the fill update as the confirmed task comes back.
- **Done.** Ticking "Done: <title>" marks the task done. The card stays in its column with a strike-through title. Unticking reopens it.
- **Pointer drag.** Pressing on a slip and moving more than a few pixels lifts it, and it follows the pointer. On touch, a press held for about a third of a second lifts it. While the slip is over a day column other than its own, that column shows the ghost and, if needed, the hatched overflow and the over label (DP-14). Releasing over a column moves the card there at once: the ghost becomes solid fill, the total counts to the new value, and the server's confirmed total then replaces it. Releasing over a calendar slot timeboxes the task at that slot's start time on the strip's day. Releasing anywhere else returns the slip to where it was. The Backlog is a valid drop target and clears the card's day.
- **Keyboard drag.** With focus on "Move <title>", Space picks the card up. Left and Right step through Backlog, the five day columns and the Calendar, in that order. In the Calendar, Up and Down step between half-hour slots, starting at 09:00 or the card's current session time. Enter drops at the current target. Escape cancels and leaves the card where it was. A held card shows the same ghost, hatching and over label as a pointer drag. Focus stays on the card's Move button throughout and after the drop. Each step is announced with the keyboard copy in Feedback states.
- **Session blocks.** A session block can be dragged, or picked up with Space and moved with Up and Down, to another slot on the same strip day. Previous day and Next day change the strip's day while a block is held, so a block can also move to another board day. Each change is sent with the session's version. "Remove <title> from calendar" deletes the session after a single press. The card stays in its day column.
- **Rollback.** When the server refuses any move (a card between columns, a card onto the calendar, or a session to a new time), the item returns to its previous place, the fill drains back to its previous height, and the refusal reason is announced. After a version conflict the card or block shows the server's current state.
- **Dialogs.** Opening a dialog moves focus to its first field. Tab cycles inside the dialog. Escape or its cancel button closes it and returns focus to the control that opened it. The import dialogs stay open after an import and show the summary inside the dialog as well as announcing it.
- **Feed.** Copy writes the URL to the clipboard. Rotate opens the confirmation. "Rotate" replaces the URL in the textbox. "Keep current URL" closes the confirmation with nothing changed.
- **Refresh.** The board and calendar strip re-read from the server whenever the window regains focus, and at least every 60 seconds. The first board column is today in the profile time zone, worked out from the device clock converted to that zone, never from the browser's own zone. It rolls over within 60 seconds after local midnight without a reload. The subscription banner refreshes on page load and every 60 seconds.
- **Workspace page.** "Send invite" submits the email. Each Remove button removes that row after a single press. "Previous week" and "Next week" change the review week.
- **Tab order** follows reading order: header navigation, subscription banner links, ritual rail, Backlog (add-a-task box, import buttons, cards), the day columns left to right with their cards top to bottom, then the calendar strip.

### Visual design (DP-43, DP-45)

- **Colour roles.** A warm off-white paper is the ground everywhere. Text, headings and numbers are a near-black ink with a green undertone. Column rules, card borders and calendar hairlines are a pale sand line. One deep pine-green accent marks the single primary action on each screen, the current ritual step, session blocks and the Waterline fill. A brick red is reserved for overload: the hatched part of a fill above the tidemark, and the over label. Meetings are drawn as sand-ruled blocks with ink text and no fill, so they read as already-taken time.
- **Type.** Day headings, page titles and the product name use the soft-cornered display serif Fraunces. Body text, labels and buttons use IBM Plex Sans. Every number (totals, estimates, times, seat counts) is set in IBM Plex Mono with fixed-width digits, so columns of numbers line up. Each heading level is one quarter larger than the level below it, and day headings are about one and a half times body size.
- **Density.** The layout is comfortable: spacing follows an 8-and-16 rhythm, cards have generous inner padding, and only one line of secondary text appears per card.
- **Composition.** The page is a notebook spread: the numbered margin rail on the left, ruled day columns in the centre, each with its serif heading and mono total above a horizontal rule, and the calendar strip on the right with hairlines every half hour and slightly stronger lines on the hour. Cards are flat paper slips with a thin sand border. Nothing uses shadows, gradients or rounded pill shapes. The only fills on the page are the Waterline and the session blocks.
- **Tap targets and contrast.** Every interactive control is at least 44 by 44 px, including card handles, checkboxes, estimate radios and calendar slots. All text and meaningful graphics meet WCAG 2.2 AA contrast against the paper ground, including the accent and the overload colour. Focus is shown as a clear two-tone ring that stays visible on paper and on the accent.
- **Icons** come from the Lucide set.

### Motion and effects (DP-13, DP-14, DP-16, DP-20, DP-44)

Motion explains changes in load and never decorates. Every motion starts fast and eases gently into place, with no bounce or overshoot. No element loops, pulses or animates while the page is idle.

- **Press and hover feedback:** buttons and slips change their border or background tone within about a sixth of a second (0.1 to 0.2 seconds).
- **Fill change:** when a day's planned minutes change, its Waterline fill rises or falls to the new height in about a quarter to a third of a second (0.2 to 0.35 seconds).
- **Ghost:** the ghost segment grows from the top of the fill to its full height in the same 0.2 to 0.35 seconds after the slip enters a column, and shrinks away just as fast when it leaves.
- **Counter:** after a drop, the column's mono total counts digit by digit through intermediate values from the old number to the new one, finishing in a little under half a second (0.35 to 0.5 seconds). The server-confirmed total then replaces it with no further animation, or with another count if the server's value differs.
- **Rollback:** a refused move drains the fill back to its previous height and slides the slip back to its previous place, finishing within half a second.
- **Dialogs:** they fade and rise slightly into place within a quarter second and leave faster than they arrived.

**Waterline, step by step.**
1. Each column's fill rises from the base of its gauge. The fill's height, divided by the tidemark's height above the base, equals planned minutes divided by the threshold, capped at 1.2 (within 2 percent). The dashed tidemark rule therefore sits at five-sixths of the gauge height, and the top sixth is headroom above it.
2. When a slip enters another column during a drag, a ghost segment stacks on top of the fill. The ghost's height, relative to the tidemark's height, equals the card's estimate divided by the threshold, and it is clipped at the top of the gauge.
3. If fill plus ghost passes the tidemark, the part above the rule becomes diagonal hatching in the overload colour, and the over label appears beside the rule, so the warning never relies on colour alone. A column that is already over the threshold, with no drag, shows its hatched part and the over label too.
4. On drop, the ghost turns solid, the total counts to the new value, and the confirmed total replaces the optimistic one.
5. If the server refuses, the fill drains back to its earlier height, the hatching and label match the restored total, and the refusal is announced.
6. When a card already planned on a day is dropped onto the calendar strip for that same day, it becomes a block whose height is its estimate in minutes times the height of a half-hour slot divided by 30 (within 2 px). That column's fill does not change, because the work is already counted.
7. Dragging back out of a column reverses the ghost step by step, in the reverse order: the hatching clears, the label goes, and the ghost shrinks.

**Reduced motion.** When the system asks for reduced motion, every fill height, ghost, hatching change, rollback and dialog appears or disappears instantly, and totals jump straight to their new value. The over label, the hatching and every live-region announcement still appear. Keyboard moves show the same ghost and label without motion.

### Feedback states (DP-02, DP-06, DP-12, DP-16, DP-17, DP-20, DP-26, DP-28, DP-29, DP-30, DP-31)

Every async action announces its outcome through the single polite `status` live region "Planner updates". Field errors also appear under the field they belong to, linked to it as its description. While a request is pending, the button that started it shows the pending copy and is marked busy. Card and session moves have no pending copy, because they show their result at once (optimistically). Placeholders: `<n>`, `<planned>`, `<threshold>` and `<projected>` are whole minutes. `<email>` is the address involved. `<name>` is a person's or routine's name. `<column>` is "Backlog" or a `<Day label>`. `<time zone>` is the IANA zone name. `<trial end>` is the trial end date written as a `<Day label>` in the owner's time zone.

| Action | Pending | Success | Error | Outage |
|---|---|---|---|---|
| Sign in | "Signing in…" | (navigates to Daybook) | "That email and password don't match." | — |
| Start trial | "Creating workspace…" | "Workspace created. Your trial ends on <trial end>." | field errors; email taken: "That email already has a Daybook." | Kill Bill unreachable: "Workspace created. Billing is unreachable, so your seat will be registered when it's back." |
| Join | "Joining…" | (navigates to Daybook) | used link: "This invite has already been used." | — |
| Add task | — | "Added <title> to the Backlog." | field error under the box | — |
| Import tasks | "Importing…" | "Imported: <created> new, <updated> updated, <unchanged> unchanged." followed, when non-zero, by " <merged> merged." " <rejected> rows skipped." " <orphaned> not in this file." | too large: "That file is larger than 1,000,000 bytes."; wrong format: "That file isn't a task export with external_id and title columns."; too many rows: "That file has more than 2,000 rows." | — |
| Import calendar | "Importing…" | "Calendar imported: <created> new, <updated> updated, <unchanged> unchanged, <skipped> skipped." | too large: same as tasks; wrong format: "That file isn't an iCalendar file." | — |
| Estimate | — | "<title>: <n> minutes." | the move rollback copy with its reason | — |
| Done | — | "Marked <title> done." / "Reopened <title>." | rollback copy | — |
| Move card | — | "Moved <title> to <column>. <Day label> is at <planned>m of <threshold>m." (second sentence omitted for Backlog) | "Couldn't move <title>: <reason>. It's back in <column>." | — |
| Timebox | — | "Timeboxed <title> at <start>." | "Couldn't timebox <title>: <reason>." | — |
| Move session | — | "Moved <title> to <start>." | "Couldn't move <title>: <reason>. Showing the latest time." | — |
| Remove session | — | "Removed <title> from the calendar." | "Couldn't remove <title>: <reason>." | — |
| Check step | — | "<n> of 5 days are over your threshold." | — | — |
| Save settings | "Saving…" | "Settings saved. Today is <Day label> in <time zone>." | field errors | — |
| Copy feed | — | "Feed URL copied." | "Couldn't copy. Select the URL and copy it yourself." | — |
| Rotate feed | "Rotating…" | "Feed URL rotated. The old URL has stopped working." | — | — |
| Save routine | "Saving…" | "Added routine <name> at <start>." | field errors | — |
| Delete routine | — | "Deleted routine <name>." | — | — |
| Shut down | "Shutting down…" | sent: "Day shut down. Digest sent to <email>."; repeat: "Day shut down. Today's digest was already sent." | rollback reason for read-only | mail unreachable: "Day shut down. Mail is unreachable, so your digest is queued and will send when it's back." |
| Send invite | "Sending…" | "Invite sent to <email>." | already in workspace: "<email> is already in this workspace."; other workspace: "<email> already has a Daybook." | mail unreachable: "Invite saved. Mail is unreachable, so the email to <email> is queued."; Kill Bill unreachable: "Invite saved. Billing is unreachable, so the seat and email will go through when it's back." |
| Remove member | "Removing…" | "Removed <name or email>. Active seats: <n>." | owner: "The owner can't be removed." | Kill Bill unreachable: "Billing is unreachable, so <name or email> is still a member. Try again shortly." |
| Any request, server error or no response | — | — | "Something went wrong on our side. Nothing was changed." | — |

**Rejection reasons** (`<reason>`), chosen by the error code from the API: `version_conflict` → "it was changed on another device"; `workspace_read_only` → "this workspace is read-only"; `day_in_past` → "that day has already passed"; `already_scheduled` → "it's already on the calendar"; `estimate_required` → "add an estimate first"; `crosses_midnight` → "it would run past midnight"; anything else or no response → "the server didn't respond".

**Keyboard drag copy:**
- Pick up: "Picked up <title>. Use arrow keys to choose a place, Enter to drop, Escape to cancel."
- Over a day column: "Over <Day label>: <projected>m of <threshold>m." When the projected total is over the threshold, the over label's sentence form " Over by <n>m." is appended.
- Over the Backlog: "Over Backlog."
- Over a calendar slot: "Calendar slot <start>."
- Cancel: "Cancelled. <title> stays in <column>."

**Waterline over label:** "Over by <n>m", where `<n>` is the projected or actual planned minutes minus the threshold.

**Subscription banner** (`region "Subscription"`):
- Trialing: "Trial: <d> days left" (or "Trial: 1 day left"), where `<d>` is the remaining trial time in days, rounded up.
- Past due: "Payment failed. Planning stays open while billing retries."
- Read-only: "This workspace is read-only. Planning resumes when the subscription is active."
- Cancelled: "This subscription is cancelled. Your plans stay readable."
- Active: no banner.

## Backend

### API (DP-01, DP-04, DP-05, DP-07, DP-08, DP-10, DP-15, DP-18, DP-19, DP-21, DP-24, DP-25, DP-27, DP-30, DP-31, DP-33, DP-35, DP-38, DP-39, DP-40)

All endpoints are under the app's own origin. JSON bodies use `application/json; charset=utf-8`. The task import takes `text/csv` and the calendar import takes `text/calendar`; any other content type on a write that carries a body is refused with `415`. A write with no body (no `Content-Length`, or a length of 0) needs no content type and is never refused with `415`. Size limits: JSON bodies up to and including 65,536 bytes, CSV and iCalendar bodies up to and including 1,000,000 bytes; larger bodies get `413`. Authentication is an HttpOnly, SameSite=Lax session cookie named `tidemark_session`, set by sign-up, sign-in and invite acceptance. Unknown JSON fields are ignored. Dates are `YYYY-MM-DD`, local times are `HH:MM` (24-hour), and instants are ISO 8601 UTC with a `Z` suffix.

**Error shape.** Every error body is `{"error":"<code>","message":"<sentence>"}`. Validation errors add `"fields":{"<field>":"<message>"}`. Version conflicts add `"current":<the current task or session object>`.

**Error precedence** (one rule for the whole API):
1. `405 method_not_allowed` for a method the path does not accept (for example, any method but GET or HEAD on a `/feed/` URL, whatever its token), then `413`, then `415`, then `403 cross_origin`.
2. `401 unauthenticated`, or the endpoint's own credential check.
3. An idempotent replay, which returns its stored response.
4. `404 not_found` for an unknown resource or one in another workspace or owned by another member (never `403`).
5. `403 forbidden` for the wrong role.
6. `402 workspace_read_only`.
7. `409` state conflicts.
8. `422` validation, including `day_in_past`, `estimate_required` and `crosses_midnight`.

The rows below list only each endpoint's extra errors.

**Objects.**
- Member: `{"id","name","email","role":"owner"|"member"|"operator","timeZone","thresholdMinutes"}`
- Workspace: `{"id","name","state":"trialing"|"active"|"past_due"|"read_only"|"cancelled","trialEndsAt","writable":bool}`. `writable` is true in trialing, active and past_due.
- Task: `{"id","title","estimateMinutes":int|null,"dayDate":date|null,"position":int,"status":"open"|"done","source":str|null,"externalId":str|null,"dueDate":date|null,"version":int,"session":Session|null}`
- Session: `{"id","taskId","title","date","startTime","endTime","start","end","version"}`
- Day: `{"date","label":"<Day label>","taskMinutes","meetingMinutes","routineMinutes","plannedMinutes","overByMinutes","tasks":[Task]}`. `overByMinutes` is 0 when not over.
- Routine: `{"id","name","startTime","durationMinutes","repeats":"daily"|"weekdays"}`

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| `GET /api/health` | — | `200 {"status":"ok"}` | — |
| `POST /api/workspaces` | `{"workspaceName","ownerName","email","password","timeZone"}` | `201 {"workspace","member","billing":"registered"\|"queued"}`, sets cookie | `409 email_taken`; `422` (names 1 to 80 characters, valid email, password at least 10 characters, a known IANA zone) |
| `POST /api/auth/sign-in` | `{"email","password"}` | `200 {"member","workspace"}`, sets cookie | `401 invalid_credentials` (also for removed members) |
| `POST /api/auth/sign-out` | — | `204` | — |
| `GET /api/me` | — | `200 {"member","workspace","today":date}` | — |
| `PATCH /api/me` | `{"timeZone"?,"thresholdMinutes"?}` | `200 {"member","today"}` | `422` |
| `GET /api/board?start=<date>` | `start` optional, default today | `200 {"today","timeZone","thresholdMinutes","days":[5 Day],"backlog":[Task]}` | `422` bad date |
| `POST /api/tasks` | `{"title","estimateMinutes"?,"dayDate"?}` | `201 {"task","days":[affected Day]}` | `422` |
| `PATCH /api/tasks/{id}` | `{"version", "title"?,"estimateMinutes"?,"dayDate"?,"position"?,"status"?}` | `200 {"task","days":[affected Day]}` | `409 version_conflict`; `422 day_in_past` |
| `GET /api/tasks/suggest?q=<text>` | `q` 1 to 100 characters | `200 {"suggestions":[{"id","title","estimateMinutes"}]}` | `422` |
| `POST /api/imports/tasks` | CSV body | `200 {"batchId","created","updated","unchanged","merged","rejected":[{"line","reason"}],"orphaned":[{"externalId","title"}]}` | `422 not_a_task_export`; `422 too_many_rows` |
| `POST /api/imports/calendar` | iCalendar body | `200 {"batchId","created","updated","unchanged","skipped"}` | `422 not_a_calendar` |
| `GET /api/calendar?from=<date>&to=<date>` | inclusive range of at most 31 days | `200 {"timeZone","items":[{"kind":"session"\|"routine"\|"meeting","id","title","date","startTime","endTime","start","end","version"?}]}` | `422` |
| `POST /api/sessions` | header `Idempotency-Key` (1 to 200 characters); `{"taskId","date","startTime"}` | `201 {"session","task","days"}` | `400 idempotency_key_required`; `409 already_scheduled`; `422 estimate_required`, `crosses_midnight`, `day_in_past`, `idempotency_key_mismatch`, and a start not on `:00` or `:30` |
| `PATCH /api/sessions/{id}` | `{"version","date","startTime"}` | `200 {"session","task","days"}` | `409 version_conflict`; `422` as above |
| `DELETE /api/sessions/{id}?version=<n>` | — | `204` | `409 version_conflict` |
| `GET /api/routines` / `POST /api/routines` | `{"name","startTime","durationMinutes","repeats"}` | `200 {"routines"}` / `201 {"routine"}` | `422` (name 1 to 80 characters, duration 5 to 240 in steps of 5, both limits allowed) |
| `DELETE /api/routines/{id}` | — | `204` | — |
| `GET /api/feed` / `POST /api/feed/rotate` | — | `200 {"url":"<origin>/feed/<token>.ics"}` | — |
| `GET /feed/{token}.ics` | no cookie needed | `200` `text/calendar; charset=utf-8`, `Cache-Control: no-store` | `404` plain text for unknown or rotated tokens; `405 method_not_allowed` for any method but GET and HEAD |
| `GET /api/shutdown/preview` | — | `200 {"date","done":[{"id","title"}],"carriedOver":[{"id","title"}],"tomorrowFirst":{"title","startTime"}\|null}` | — |
| `POST /api/shutdown` | `{}` | `200` the preview shape plus `"digest":"sent"\|"queued"\|"already_sent"` | — |
| `GET /api/workspace/members` | owner | `200 {"members":[{"id","name","email","role","status":"active"\|"invited"\|"pending_billing"}],"seats":{"active","billed":int\|null}}` | — |
| `POST /api/workspace/invitations` | owner; `{"email"}` | `201 {"member","email":"sent"\|"queued"}` or `202 {"member","billing":"queued"}` | `409 already_member`; `409 email_taken`; `422` |
| `DELETE /api/workspace/members/{id}` | owner | `200 {"seats"}` | `409 cannot_remove_owner`; `503 billing_unavailable` |
| `GET /api/invitations/{token}` | no cookie needed | `200 {"workspaceName","email"}` | `404`; `410 invitation_used` |
| `POST /api/invitations/{token}/accept` | `{"name","password","timeZone"}` | `201 {"member","workspace"}`, sets cookie | `404`; `410 invitation_used`; `422` |
| `GET /api/workspace/review?week=<YYYY-Www>` | owner; `week` optional, default the current ISO week in the owner's zone | `200 {"week","members":[{"memberId","name","plannedMinutes","doneMinutes"}],"totals":{"plannedMinutes","doneMinutes"}}` | `422` |
| `POST /api/billing/callbacks` | headers `X-Tidemark-Timestamp`, `X-Tidemark-Signature`; `{"eventId","type","workspaceId","occurredAt","seats"?}` | `200 {"received":true,"applied":bool}` or `200 {"received":true,"duplicate":true}` | `401 invalid_signature`; `401 stale_timestamp`; `404 unknown_workspace`; `422` |
| `GET /api/ops/workspaces` | operator | `200 {"workspaces":[{"id","name","state","trialEndsAt","activeSeats","billedSeats","lastBillingEventAt","outbox":{"pending","sent"},"imports":{"batches","lastAt"}}]}` | — |

The operator role gets `403 forbidden` on every planner and owner endpoint. Members and owners get `403 forbidden` on `/api/ops/*`, and members get it on owner endpoints. Planner endpoints are scoped to the caller: a task, session or routine of another member, even in the same workspace, is `404`.

### Business rules (DP-03, DP-04, DP-05, DP-07, DP-08, DP-10, DP-11, DP-15, DP-18, DP-19, DP-21, DP-22, DP-24, DP-25, DP-27, DP-28, DP-30, DP-31, DP-33, DP-35, DP-36, DP-37)

**Validation values.**
- Task titles: 1 to 200 characters after trimming.
- `estimateMinutes`: 5 to 600 in steps of 5, both limits allowed, or null.
- `thresholdMinutes`: 60 to 960 in steps of 15, both limits allowed. The default is 360.
- `timeZone` must be a known IANA zone name.
- Emails are compared case-insensitively. One email belongs to at most one account in the whole app.

**Time zone and today.**
- A member's "today" is the current date in their profile time zone, from the server clock, never the server's own zone or the browser's.
- Each board day runs from local 00:00 to the next local 00:00.
- Setting a task's `dayDate`, or a session's `date`, to before today gives `day_in_past`. Today itself is allowed.
- Open tasks whose `dayDate` is before today appear in the board's `backlog` with their old `dayDate`, and they count toward no shown day.
- Changing the profile zone moves today and all day boundaries at once. Sessions keep their instant, and their local date and times are recomputed. When a session's recomputed local date differs from its task's `dayDate`, the task's `dayDate` moves to that date in the same change, and the task's and the session's versions each add 1. A session that now runs past local midnight keeps its instant and stays valid: its `date` is its local start date, and its task's whole estimate counts on that date only. `crosses_midnight` applies only to creating and moving a session. Routines keep their wall-clock time in the new zone.

**Derived load (DP-10).** For each local day:
- `taskMinutes` is the sum of the estimates of the member's tasks with that `dayDate` (open or done, with null counting 0).
- `meetingMinutes` is the sum of each imported meeting's minutes that overlap that local day.
- `routineMinutes` is the sum of that day's routine occurrence durations.
- `plannedMinutes` is the sum of those three, and `overByMinutes` is `max(0, plannedMinutes − thresholdMinutes)`.
- These values are computed only from stored records. They are never accepted from a request.
- A timed session adds nothing on its own: its task's estimate is already counted on the session's day.

**Task versions (DP-15).**
- Tasks start at version 1, and each successful change adds 1.
- A `PATCH` whose `version` is not the current one is refused with `409 version_conflict`, including `current`, and changes nothing.
- Moving a task with a session to a different `dayDate` (or to the Backlog) deletes the session in the same change.
- Marking a task done keeps its session.
- `position` is the 0-based index within the target column. The server renumbers the others.

**Sessions (DP-18, DP-19, DP-21).**
- A session's length equals its task's estimate. A task without an estimate gets `estimate_required`.
- A session must start on `:00` or `:30` and end by local midnight, otherwise `crosses_midnight`.
- Creating a session sets the task's `dayDate` to the session date, which adds 1 to the task version.
- Each task has at most one session. A create for a task that already has one gets `409 already_scheduled`. Under any number of parallel creates for the same task with different keys, exactly one gets `201` and the rest get `409 already_scheduled`.
- **Idempotency keys** are scoped to the member and kept for `IDEMPOTENCY_TTL_SECONDS` (default 86,400 seconds). The same key with the same body returns the stored status and body with header `Idempotent-Replayed: true`, even after a later conflict would apply. The same key with a different body gets `422 idempotency_key_mismatch`. Concurrent requests with one key and one body produce one session, and all of them receive the same `201` body.
- **Session versions** start at 1. A move or delete must name the current version. When several moves arrive based on the same version, exactly one succeeds. Every other one gets `409 version_conflict` with `current` set to the winning session. The stored session never mixes fields from two writes: its date, start and end always come from a single successful write.
- Moving a session to another date also moves its task's `dayDate`.
- A deleted session is gone for good. No read, refresh, feed or import brings it back. Re-importing the task's CSV row never creates a session.

**Routines and DST (DP-22).**
- A routine stores a local wall-clock start and a duration. It occurs once on every local date (daily) or every local Monday to Friday (weekdays), always at that wall-clock time.
- If the start time falls in a daylight-saving gap on a date, that occurrence starts the length of the gap later (for example 02:30 becomes 03:30), with the same duration.
- If the start time occurs twice on a date, the occurrence uses the first (earlier) instant.
- Each qualifying local date has exactly one occurrence. None is ever doubled or dropped.
- An occurrence's id is `<routineId>:<date>`.
- Deleting a routine removes all its occurrences.

**Calendar import (DP-08).**
- Only `VEVENT`s with a `UID`, a `DTSTART` and either a `DTEND` or a `DURATION`, whose times are UTC (`Z`) or carry an IANA `TZID`, and that have no `RRULE` and are not all-day (date-only), are imported.
- Every `VEVENT` that is not imported counts once in `skipped`: one missing a `UID`, a `DTSTART` or an end, an all-day event, one with a floating time, and one with an `RRULE`.
- Meetings match on `UID` for the importing member. A new `UID` creates a meeting. A known `UID` with a changed summary or time counts as `updated`. A known `UID` with nothing changed counts as `unchanged`.

**Task import (DP-05).**
- The CSV is UTF-8 with quoted fields allowed. The header row is required and must contain `external_id` and `title`, otherwise `not_a_task_export`. Optional columns are `estimate_minutes`, `due_date` and `source` (default `csv`). Other columns are ignored.
- The file may have at most 2,000 data rows (2,000 allowed), otherwise `too_many_rows`.
- Rows are matched for the importing member on the pair (source, external id). Matching never crosses members or workspaces.
- A row with a missing `external_id` or `title`, or an invalid estimate or due date, is listed in `rejected` with its line number (the header is line 1) and a reason. The other rows still import.
- When several rows in one file share a (source, external id), the last row wins, and each earlier one counts in `merged` on every import of that file, including a repeat import. `created`, `updated` and `unchanged` count only the winning row of each key.
- A matched card gets the row's title and due date. The row's estimate is applied only when the card has no estimate. Its day, status and session are never changed.
- `orphaned` lists the member's open tasks from an earlier import, with a source that appears in this file, whose external id is absent from this file. Orphans are reported, never deleted.
- Importing the same file twice creates nothing the second time: it reports the winning row of each key as `unchanged` and the earlier duplicates as `merged` again.

**Suggestions (DP-07).** Suggestions are the caller's own open tasks whose title contains `q`, ignoring case. They are ordered by most recently changed and capped at eight. No other member's or workspace's task ever appears.

**Feed (DP-24, DP-25).**
- Each member has one feed token: at least 32 random URL-safe characters, created with the member.
- The feed lists the member's sessions, each as one `VEVENT` with `UID` `session-<id>@tidemark`. It also lists routine occurrences from 7 days before to 28 days after today, each with `UID` `routine-<routineId>-<YYYYMMDD>@tidemark`.
- Each event's `SUMMARY` is the title, and `DTSTART` and `DTEND` are UTC. Meetings are not included.
- Rotating replaces the token at once. The old URL answers `404` from the next request onward.
- A removed member's feed answers `404`.
- Feeds stay live in every subscription state.

**Shutdown (DP-27, DP-28).**
- Shutdown works on the member's today. Done tasks dated today are listed as `done`.
- Open tasks dated today move to tomorrow, top of the column in their current order, and their sessions are deleted. They are listed as `carriedOver`.
- `tomorrowFirst` is the earliest session or routine occurrence on tomorrow's date, or null.
- The digest goes out at most once per member per local date. A later shutdown on the same local date still carries over any newly open tasks but reports `already_sent` and sends nothing.

**Seats (DP-30, DP-31).**
- Seat-holding members are the owner plus members whose status is `active` or `invited`. After every invite or removal, the number of active seat subscriptions in Kill Bill equals the number of seat-holding members, or neither change is applied.
- If Kill Bill refuses or does not answer an invite, the member is stored as `pending_billing` with no seat and no email, and the seat is queued.
- Once Kill Bill accepts the queued seat, the status becomes `invited` and the invite email is sent.
- A removal that Kill Bill does not confirm gets `503 billing_unavailable` and leaves the member unchanged.
- Removing a `pending_billing` invite needs no Kill Bill call.
- A removed member's sign-in, open sessions and feed stop working immediately.
- Accepting an invite moves the member from `invited` to `active`. The link then gives `410 invitation_used`.

**Weekly review (DP-33).**
- The review covers seat-holding members of the owner's workspace only.
- A task counts in ISO week `YYYY-Www` when its `dayDate` falls on that week's Monday to Sunday. `dayDate` is already the member's local date.
- `plannedMinutes` sums the estimates of those tasks. `doneMinutes` sums the estimates of those with status done.

**Subscription state machine (DP-04, DP-36).** The legal transitions are:

| From | Event or trigger | To |
|---|---|---|
| trialing | `subscription.trial_converted` | active |
| trialing | trial end reached without conversion | read_only |
| active | `payment.failed` | past_due |
| past_due | `payment.succeeded` | active |
| past_due | `payment.failed` | read_only |
| read_only | `payment.succeeded` or `subscription.trial_converted` | active |
| trialing, active, past_due, read_only | `subscription.cancelled` | cancelled |

`cancelled` is final. Any event-and-state pair not in the table leaves the state unchanged.

**Order of events.** A workspace's state is always the result of replaying, from `trialing`, every stored state event (every type except `seats.changed`) in `occurredAt` order, with ties broken by `eventId` in ascending text order, plus the trial-end trigger placed at `trialEndsAt` once that instant has passed. Stored events include those the seed writes (see Seed data) as well as verified callbacks; a workspace with no stored state events is therefore `trialing` until its trial-end trigger fires. Each step applies the table above, and a step not in the table is skipped. The server replays whenever a new event is stored and when the trial-end trigger fires, so the final state depends only on which events have arrived, never on their arrival order. For example, from trialing, `subscription.trial_converted` at a time t1 and `payment.failed` at a later t2 end in past_due in either arrival order. Because the trial-end trigger is a step in the same replay, a conversion whose `occurredAt` is before `trialEndsAt` turns the trigger into a skipped step whenever the conversion arrives. A state event answers `applied:true` when its own step is a legal transition in the replay that includes it, and `applied:false` otherwise.

**Seat events.** `seats.changed` never changes state and takes no part in the replay. It answers `applied:true` and sets the billed seat count to its `seats` only when it is the newest stored `seats.changed` for the workspace by `occurredAt` (ties broken by `eventId` as above). An older one is stored, answered `applied:false`, and leaves the billed seat count at the newest event's value.

In `read_only` and `cancelled`, every task, session, routine, import, shutdown and invite write gets `402 workspace_read_only`. Reads, the feed, sign-in and sign-out, `PATCH /api/me`, feed rotation and member removal still work.

**Trial clock (DP-03).**
- `trialEndsAt` is workspace creation plus `TRIAL_LENGTH_SECONDS` (default 1,209,600 seconds, which is 14 days).
- The server checks it on every request and in a background sweep that runs at least every 10 seconds. A trialing workspace moves to `read_only` within 10 seconds of `trialEndsAt`.
- When the time left falls to `TRIAL_NOTICE_LEAD_SECONDS` (default 259,200 seconds, which is 3 days) and the workspace is still trialing, one trial notice is queued for the owner within 10 seconds. It is never sent twice.

**Billing callbacks (DP-35).**
- `X-Tidemark-Signature` must equal `v1=` followed by the lowercase hex SHA-256 HMAC of `<X-Tidemark-Timestamp>.<raw body>`, keyed with `KILLBILL_API_SECRET`. Otherwise the callback gets `invalid_signature`.
- `X-Tidemark-Timestamp` is Unix seconds. It must be within `BILLING_CALLBACK_TOLERANCE_SECONDS` (default 300) of server time in either direction, with the limit itself allowed. Otherwise the callback gets `stale_timestamp`.
- The `type` values are the five events named in the state machine table.
- An `eventId` seen before returns `duplicate:true` and changes nothing, whatever its body.

**Queued work and recovery (DP-37).**
- Every effect on Kill Bill or mail is written to a queue in PostgreSQL in the same transaction as the change that causes it. The response reports `sent` or `registered` only when the effect completed before the response.
- Every running app instance that shares the database drains the queue. It retries failed items at least every 10 seconds and claims each item so that only one instance performs it.
- A queued item completes within 30 seconds after any instance can reach the service again, with no restart. Each queued item is performed exactly once.
- Each Kill Bill or SMTP call times out after 5 seconds and then counts as unreachable.

**Sessions and cookies.** A signed-in session lasts `SESSION_TTL_SECONDS` (default 2,592,000 seconds) and ends at sign-out.

### Services (DP-01, DP-03, DP-28, DP-30, DP-31, DP-37)

**Kill Bill.**
- The tenant catalog contains product `Daybook` with plan `daybook-seat-monthly` in the default price list, priced in USD: a 14-day trial phase, then a monthly evergreen phase at 12.00 USD per seat. The app makes sure the catalog contains this plan before its first billing call. It never replaces a catalog that already has it.
- Each workspace has one Kill Bill account with external key equal to the workspace id, name equal to the workspace name, email equal to the owner's email, and currency USD.
- Each seat-holding member has one subscription on `daybook-seat-monthly` in its own bundle, with bundle external key `<workspaceId>:<memberId>`. Removal cancels that subscription immediately.
- When Kill Bill is unreachable: sign-up still returns `201` with `"billing":"queued"`, and the account and owner seat are created by the queue. Invites return the `202` shape. Removals return `503 billing_unavailable`. The UI shows the matching outage copy from Feedback states.

**Mail (SMTP, observed in Mailpit).**
- Every message is sent from the address in `MAIL_FROM`, whose value is `Tidemark Daybook <daybook@tidemark.test>`, and carries the header `Message-ID: <outbox-<queue item id>@tidemark.test>`.
- **Invite**, to the invited email:
  - Subject: "<owner name> invited you to <workspace name> on Tidemark Daybook"
  - The body contains the join link `<origin of the owner's request>/join/<token>`.
- **Shutdown digest**, to the member:
  - Subject: "Shutdown for <Day label>"
  - The body has the lines "Done: <n>" followed by the titles, "Carried over to <Day label of tomorrow>: <n>" followed by the titles, and either "Tomorrow starts with: <title> at <start>" or "Tomorrow starts with: nothing scheduled".
- **Trial notice**, to the owner:
  - Subject: "Your Tidemark Daybook trial ends soon"
  - The body contains "Your trial for <workspace name> ends on <trial end> at <HH:MM> (<time zone>)." in the owner's zone.
- When mail is unreachable, the change is still saved and the message is queued. Invites return `"email":"queued"` and shutdowns `"digest":"queued"`, with the outage copy from Feedback states. Exactly one message per queue item arrives once mail returns.

**PostgreSQL.**
- PostgreSQL holds all app state, including the queue, idempotency records, import batches with their external-id matches, and billing events.
- The schema and the seed are applied idempotently every time the app serves. The grader may hand the app an empty database at any time.

### Seed data (DP-02, DP-07, DP-13, DP-33, DP-36, DP-38)

Every seeded person and business is invented. All seeded accounts use the password `daybook-demo-2026`. The seed is created only when the seeded workspace is missing. Dates that say "today" or "tomorrow" are relative to each member's local date when the seed runs. Each seeded member has the daily routine "Inbox zero" at 08:30 for 30 minutes and their own feed token.

**Harbour Lane Studio** (created at seed time, so its `trialEndsAt` is seed time plus `TRIAL_LENGTH_SECONDS`; no stored billing events, so it replays to `trialing`)
- Wren Castell, `wren@harbourlane.test`, owner, `Europe/London`, threshold 360.
  - Backlog: "Draft Q4 proposal" (45, source `tracker`, external id `TRK-101`), "Review pull request queue" (30, `tracker`, `TRK-102`), "Invoice October" (15), "Sketch onboarding flow" (no estimate).
  - Today: "Client call prep" (60), plus meetings "Studio stand-up" 09:30–10:00 and "Client review" 14:00–15:30.
  - Tomorrow: "Write case study" (300).
- Tama Rewiti, `tama@harbourlane.test`, member, `Pacific/Auckland`, threshold 300. Backlog: "Prepare workshop slides" (90).
- Leilani Kahale, `leilani@harbourlane.test`, member, `Pacific/Honolulu`, threshold 420. Backlog: "Audit design tokens" (60).

**Saltmarsh Consulting** (replays to `active`)
- Its creation time is seed time minus 2,592,000 seconds (30 days), and its `trialEndsAt` is that creation time plus `TRIAL_LENGTH_SECONDS`.
- The seed stores one billing event for it: `eventId` `seed-saltmarsh-trial-converted`, type `subscription.trial_converted`, `occurredAt` equal to its creation time plus 1 second. Because this conversion precedes `trialEndsAt`, the replay goes from trialing to active and skips the trial-end trigger, and no trial notice is ever queued for Saltmarsh. This event is its `lastBillingEventAt` until a callback arrives. A callback reusing this `eventId` is a duplicate.
- Ossian Pell, `ossian@saltmarsh.test`, owner, `America/New_York`, threshold 360. Backlog: "Saltmarsh retainer report" (120) and "Estuary survey notes" (30).

**Operator**
- Juno Ferreira, `operator@tidemark.test`, role `operator`, `UTC`, in no workspace.

For example, with the seed data at start:
- Wren's today shows 210m of 360m (60 task, 120 meeting and 30 routine minutes).
- Tomorrow shows 330m. Dragging "Draft Q4 proposal" over tomorrow shows the over label for 15 minutes.
- Wren's suggestions for "retainer" are empty.
- A verified `payment.failed` for Saltmarsh with an `occurredAt` after its seeded conversion moves it to `past_due` and answers `applied:true`.
- Kill Bill holds one account for each of the two workspaces, with 3 and 1 active seats, once billing is reachable.

## Technical requirements

### Deployment (DP-39)

- Node.js 22 LTS with npm is available. Write the app in TypeScript.
- `/app/run.json` holds string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`, for example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}
  ```

- `serve` binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set.
- `GET /api/health` answers HTTP 200 `{"status":"ok"}` once the database schema is applied. It does not depend on Kill Bill or mail.
- The grader may start extra copies of the app at once. Some point one service at an unreachable address while sharing the database. One uses short trial settings and its own empty database. Each copy must boot and serve normally.

### Configuration and secrets (DP-41)

Read at start, from the environment only:
- Database: `DATABASE_URL`.
- Kill Bill: `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`.
- Mail: `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` (the From line given in Services).
- Server: `APP_PUBLIC_PORT`.
- Timing, each with the default given in Business rules: `TRIAL_LENGTH_SECONDS`, `TRIAL_NOTICE_LEAD_SECONDS`, `BILLING_CALLBACK_TOLERANCE_SECONDS`, `IDEMPOTENCY_TTL_SECONDS`, `SESSION_TTL_SECONDS`.

No credential or service URL is hard-coded, written to logs, or included in any response or browser bundle.

### Server boundary (DP-40)

- A write request (any method other than GET or HEAD) whose `Origin` header is present and differs from the app's own origin gets `403 cross_origin`. Billing callbacks carry no `Origin` and are checked by signature instead.
- The method check and the API's size and content-type limits apply before any other processing, in the order set by the API's error precedence.
- The server serves only the built browser assets and the endpoints listed in the API. It never serves source files, source maps, `run.json`, package manifests, environment files, dependency folders or credentials. Any such path answers `404`.
- Responses set `X-Content-Type-Options: nosniff`.
- When Kill Bill or mail is unreachable at boot, the app still starts, answers health, and serves every screen, and the outage behaviour in Services applies. When the service returns, queued work completes without a restart.

### Browser support and performance (DP-42, DP-44)

- The app supports current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800.
- The Daybook with the seed data is usable (columns, totals and cards shown and draggable) within three seconds of navigation on a local connection.
- A move's server-confirmed total replaces the optimistic one within one second.
- Fonts are served from the app's own origin.

## Working rules

- IF-01: `/app/run.json` exists with exactly the string keys `_schema` (value `run-manifest-v1`), `install`, `build` and `serve`.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and every bundled font, with name, version and licence.
- IF-03: Every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) uses one of MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, CC0-1.0 or Unlicense, and bundled fonts use OFL-1.1.
- IF-04: The only datastore is the provided PostgreSQL: no SQLite, Redis, embedded database or application data written to local files.
- IF-05: The provided service definitions and environment files for PostgreSQL, Kill Bill and Mailpit are left unmodified.
- IF-06: Fonts and icons ship inside the app and load from its own origin, with no CDN or third-party request at runtime.
- IF-07: Server and browser code is TypeScript compiled with strict mode enabled, and `npx tsc --noEmit` passes.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript, with no `any` used to escape the type checker.
- Names in the code match the domain terms in this brief: workspace, member, task, estimate, day, session, routine, meeting, threshold, tidemark, shutdown, seat and feed token.
- Each domain rule is decided in exactly one place in the source: the subscription state transitions, a day's planned minutes, the today and day-boundary calculation, routine expansion across daylight-saving changes, and import matching.
- Every error response is built through one consistent error shape, the one defined in the API.
- No abstraction has only a single implementation, and there are no defensive checks for states the types or the database constraints already rule out.
- The code has no dead, commented-out or unreachable code and no features beyond this brief.
- Concurrency and idempotency rules are enforced by database constraints or transactions, not by in-memory locks.
