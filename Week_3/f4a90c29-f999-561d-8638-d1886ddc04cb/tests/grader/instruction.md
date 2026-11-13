# Sundial & Wren Wren Calendar

Wren Calendar is one shared team calendar for a 14-person strategy consultancy with offices in New York, London and Auckland. Times stay exact across every clock change, every open screen agrees within a second, and every notice appears inside the product. It uses Postgres for all records and the replayable change log, Gotenberg to render the printable week to PDF, and MinIO to store PDFs and iCalendar files. Out of scope: email of any kind, self-registration or account creation (everyone signs in as a seeded person), external calendar sync, video-call links, room booking, native apps and any extra datastore.

## Problem and users

The firm runs on a general-purpose calendar. Weekly meetings drift by an hour for some viewers when the three zones change clocks on different weeks. "This and following" edits split series and strand exceptions. Guest permissions are easy to get wrong and leak the guest list. Out-of-office and focus time never decline anything reliably. Every notice is an email that arrives hours late in a different inbox. The office manager keeps a spreadsheet of zone changes and hand-edits series after each one, and the partners keep another spreadsheet of who is awake when.

- **Consultant** (daily): creates, drags, resizes and repeats events across zones, answers invitations, and sets focus time and out of office.
- **Organiser** (daily): runs a series with guests, handles proposed times, and splits or edits a series without losing exceptions. The organiser of an event is the owner of the calendar it lives on.
- **Office manager** (weekly): records zone rule changes, manages calendar sharing levels and guest defaults, and prints the week.
- **Guest** (daily): sees only what the guest switches allow, answers for one occurrence or the series, and proposes a new time. Anyone invited to an event is its guest, whether a colleague or one of the two seeded outside guests.

## Journeys

1. **A weekly meeting across the change.** Ines Okafor, signed in with the seed data, opens the week of 15 March 2027. Partners' weekly is an hour earlier for them than the week before, because New York has changed clocks and London has not. Dara Kessler, signed in on New York time, still sees it at 09:00. Two weeks later both see their usual times again.
2. **Dragging without waking anyone.** A consultant presses on an event in the week grid and drags it. Three clocks opens beside the block and its numerals roll at every 15-minute step, with each bar showing whether that city is inside working hours. On release the event is saved, the quick dialog opens with the same three times in its title row, and every other open screen shows the new time within a second.
3. **Editing part of a series.** An organiser moves one occurrence, deletes another, then changes this and following from a later date. The series becomes two, and each exception stays on its date with its own values and answers.
4. **Two people, one event.** Two people edit the same event at once. The first save wins. The second person sees a dialog with the winner's values and chooses whether to reapply their own changes.
5. **An invitation meets out of office.** An organiser invites Tane Whitcombe to a meeting during their out-of-office week. Without any reload, the answer turns to No on both people's open screens, the counts change, and the published decline message is announced once on each screen.
6. **A guest proposes a time.** A guest answers Maybe for one occurrence and proposes a new time. The proposal appears on the organiser's open event page within a second. The organiser accepts it, that occurrence moves, and the decision is announced once on each open screen.
7. **The office manager's week.** Marit Holloway records a zone rule change, and only events saved after its date show the warning and Move. Marit lowers a colleague's share level and the colleague's open grid changes at once. Marit prints the week while the document service is down. The print stays pending with Retry and completes once the service is back, with no restart and no second file.
8. **Restoring what was deleted.** An organiser sends a series with guests, answers and exceptions to the trash and restores it exactly, then deletes and restores one occurrence on its own. An untouched trashed item is purged when its retention ends and disappears from search and exports.
9. **Setting up my own view.** A consultant opens Custom days, sets a four-day count, a Sunday week start, hidden weekends and a second zone in Settings, and a second open tab follows at once. Every view has a key, the list of keys is one key away, and Escape on an event page lands on the same event in the grid.
10. **Sketching a meeting.** A consultant drags across empty slots, types half a title and reloads. The half-written event is back, from the server, with focus in its title, and it is also there in another browser signed in as the same person.
11. **A crowded day.** Three overlapping meetings share a column by the published rule, a night call shows on both of its days, and a month cell full of events shows the exact `+N more`, which changes as the window gets shorter.
12. **Setting up a repeat.** An organiser creates a repeat on the second Tuesday, one on the last Friday, one on the 31st and one on February 29, each ending on a date or after a count, and checks them on the grid.
13. **Finding a time.** A consultant chooses two colleagues in other zones, reads their busy blocks in the viewer's own zone, and books the earliest slot inside everyone's working hours.
14. **Sharing a calendar.** A calendar's owner gives a colleague Manage sharing, and that colleague lowers someone else's level while that person's grid is open.
15. **Being reminded.** A reminder fires on the server clock while the page is open, is snoozed by ten minutes and fires again once. Moving the meeting moves the next reminder, and deleting it cancels the reminder.
16. **Focus time.** A consultant blocks focus time that declines new and existing meetings. Each decline reaches the organiser's open screen at once.
17. **Out of office with conflicts.** A consultant sets out of office with their own message. New invitations are declined with that message, and the meetings already in that period are listed for them to answer.
18. **Finding and copying.** A consultant searches for a guest's name, opens the result on its date with the event focused, duplicates it, moves the copy to another calendar and switches on the holidays.
19. **A guest and the zone rule.** A guest sees a zone rule warning on an event that says its 09:00 now shows as 10:00, with no Move, on the weeks the rule shifts and not on the weeks it does not. On the organiser's screen Move returns only those weeks to 09:00, and the guest's grid follows.
20. **Switches on a live event.** An organiser turns See guest list off on an event with a shared link. The link stops working and the event's guests lose the guest list. The organiser then turns Modify event on, and every guest of that event sees the guest list again on their open screen, while a colleague with See all details on that calendar who is not a guest still sees neither.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Clock time kept.** An event keeps its clock time in its own zone across every daylight change, and viewers in other zones see the instant shift only for the weeks the changes differ.
- **DP-02 — Gaps and repeated hours.** A local time that does not exist on a change day moves forward for that occurrence only, and a local time that happens twice uses the first, as qualified in Business rules.
- **DP-03 — Calendar-date repeats.** A monthly repeat on a day some months lack skips those months, and a yearly repeat on February 29 shows only in leap years.
- **DP-04 — Repeat rule limits.** The server accepts the published repeat rule forms, including the nth and last weekday of a month, and rejects every other form with a field error.
- **DP-05 — Server clock and now line.** The now line, today and every default date come from the server clock, so a wrong device clock never moves them.
- **DP-06 — Scope choice on repeats.** Every edit, move, resize or delete of a repeating occurrence asks for This event, This and following events or All events, and Cancel changes nothing.
- **DP-07 — This and following split.** Changing or deleting this and following splits the series at that occurrence, and each exception and answer stays on its date in whichever series now holds that date.
- **DP-08 — All events keeps exceptions.** Changing all events applies the change to everything else and leaves each exception's overridden values in place, unless that overridden field is the one being edited.
- **DP-09 — First save wins.** Of any number of simultaneous saves against one event version exactly one succeeds, and every other receives the conflict response with the winner's values.
- **DP-10 — Conflict choice.** The losing editor sees a dialog with the winner's values and can reapply their own changes or keep the winner's.
- **DP-11 — Create events.** A consultant creates events, repeats, focus time and out of office from the New event dialog, and they appear on every open screen that can read them.
- **DP-12 — Drag and resize.** Dragging an event block moves it and dragging its edges resizes it, in 15-minute steps, with the result saved on release in the event's own zone.
- **DP-13 — Three clocks ribbon.** While dragging or resizing on the week or day grid, a ribbon beside the block shows the moving edge's time in New York, London and Auckland, with rolling numerals and a working-hours bar for each city.
- **DP-14 — Three clocks settle.** On release the ribbon settles into the quick dialog's title row, and its final values equal the saved event.
- **DP-15 — Alt-arrow moves.** A focused event moves by Alt with arrow keys and resizes by Alt+Shift with arrow keys, keeps focus, and announces each result.
- **DP-16 — Single-key shortcuts.** The published shortcut list works whichever control in the calendar has focus, including number keys for the views, and switches off in text fields and while a dialog is open.
- **DP-17 — Dialog focus.** Tab and Shift+Tab wrap inside every open dialog, Escape closes it, and focus returns to the same control or event that opened it.
- **DP-18 — Undo.** A move, resize or trash can be undone by button or shortcut for 10 seconds, which puts back exactly what it altered and is announced, as qualified in Interactions.
- **DP-19 — Address holds the view.** View, date, chosen calendars and open event live in the address and survive reload, Back and Forward and a second tab.
- **DP-20 — Published layouts.** The grid, mini month and calendar list take their published arrangement at 375x812, 768x1024 and 1280x800 with no horizontal overflow.
- **DP-21 — More count follows height.** Each month cell shows as many events as fit plus a +N more control, and both change with window height without a reload.
- **DP-22 — Search as you type.** Search results and their announced count update in place as the person types, match title, location, notes and readable guest names, and never include anything they cannot read in full.
- **DP-23 — Find a time.** Find a time lists the earliest common slots inside everyone's working hours for chosen colleagues, each with its three city times, and opens a chosen slot as a new event.
- **DP-24 — Invitations and answers.** A guest answers Yes, No or Maybe for one occurrence or the series, and each answer follows the reply rules in Business rules.
- **DP-25 — RSVP live.** Answer counts, declines and proposed times update in place within a second on every open screen allowed to see them.
- **DP-26 — One live connection.** Each page opens one WebSocket, sends nothing before it opens, and receives every missed change by sequence number after a drop.
- **DP-27 — Out of office and focus declines.** A new invitation or moved occurrence overlapping an out-of-office or focus window answers No with the window's message or the published copy, as qualified in Business rules.
- **DP-28 — Decisions announced once.** Every accepted or declined proposal and every automatic decline is announced exactly once on each open screen allowed to see it, including after a reconnect.
- **DP-29 — Propose a new time.** A guest proposes a new time for one occurrence or a single event, and the proposal follows its state rules.
- **DP-30 — Decide a proposal.** The organiser or anyone with edit access accepts or declines a proposal, exactly one decision wins, and acceptance moves that occurrence only.
- **DP-31 — Moved times reopen replies.** Any change to an occurrence's time returns its guests to waiting, except the accepted proposer, and rechecks out of office and focus time.
- **DP-32 — Modify event switch.** A guest without Modify event sees no edit controls and the server refuses the edit anyway.
- **DP-33 — Hidden guest lists.** With See guest list off, no page, API response, live message, notice, search result, file or link carries other guests or answer counts to anyone below edit access, except guests of an event with Modify event on, as qualified in Business rules.
- **DP-34 — Published field lists.** Each event and occurrence response carries exactly the published fields for the caller's access level and no email address.
- **DP-35 — Private reads as Busy.** A private event reads as Busy on every surface for anyone below edit access who is not its guest, and free/busy access shows every event that way.
- **DP-36 — Shared link.** An event's shared link is a read-only page that can be regenerated, turned off and expires, and a dead link answers the same as an unknown one.
- **DP-37 — Link dies with the guest list.** Turning See guest list off kills the event's shared link for good, and turning it on again does not revive it.
- **DP-38 — Share levels.** Only the office manager, a calendar's owner and people with Manage sharing on it set or remove its share levels, and the server refuses everyone else.
- **DP-39 — Access changes at once.** A lowered or removed share level applies on the colleague's next request and changes or removes the events on their open screen within a second, with an announcement.
- **DP-40 — Guest defaults and office hours.** The office manager sets guest switch defaults for new events and each office's working hours, and existing events keep the switches they already have.
- **DP-41 — Recording zone rules.** Only the office manager records an effective-dated zone rule change with its new offset, and a recorded rule appears on every open screen allowed to see it.
- **DP-42 — Zone warning.** Only occurrences from the effective date of timed events in the rule's zone saved after that date, and whose own shift is not zero, show the warning naming both clock times and the shifted time on the grid at the same instant, while earlier saves, zero-shift occurrences and ordinary daylight changes bring no warning.
- **DP-43 — Move action.** Move, at full access only, applies as This and following and returns only the warned occurrences to their saved clock time, changing their instants, leaves zero-shift and earlier occurrences as they were, and clears those warnings.
- **DP-44 — Restore a series.** Restoring a trashed event or series brings back its guests, answers, switches, proposals, exceptions and shared link exactly.
- **DP-45 — Restore one occurrence.** A deleted occurrence is its own trash item, and restoring it brings back that occurrence only with its own values and answers.
- **DP-46 — Trash retention and purge.** A trashed item lasts for the published retention on the server clock, then is purged from every surface, and can also be deleted for good by hand.
- **DP-47 — Printed week document.** The office manager prints a Monday-to-Sunday week to a PDF showing the published content, with no guest names and with access rules applied.
- **DP-48 — Stored means confirmed.** A print reads as stored and can be downloaded only after MinIO confirms the object exists.
- **DP-49 — Retry reuses the key.** Retry and replays of a print request never create a second object, as a print's single storage key is fixed when it is created.
- **DP-50 — Print through outages.** While the document service or file storage is down the print stays pending with Retry and the published copy, and it completes once the service is back, without a restart.
- **DP-51 — iCalendar round trip.** A repeating event with modified and deleted occurrences survives export and import with identical occurrences, including zone, clock time and rule.
- **DP-52 — iCalendar files and outage.** Every exported or imported iCalendar file is stored in MinIO before the action succeeds, and while storage is down the action changes nothing and shows the published copy.
- **DP-53 — All-day reminders.** An all-day reminder fires once at 17:00 the day before in each person's own zone on the server clock and appears as an in-app notice announced once.
- **DP-54 — Sign-in and seeded people.** People sign in with a seeded email and passcode, and the seed data in Seed data is present at first start and never duplicated.
- **DP-55 — Platform and boundary.** The app starts from the run manifest, answers the health check, applies its schema on serve, and keeps to the published server boundary.
- **DP-56 — Status region.** A polite status region named Wren status is on every page from first paint, and every async result is announced there with its exact published copy.
- **DP-57 — Phone schedule and reduced motion.** At phone width the schedule view has no overflow and targets of at least 44 pixels, and reduced motion swaps every animation for its published end state with the same function.
- **DP-58 — Landing look.** The landing page is the published single off-centre column on the plum-black ground, with a Three clocks example panel peeking in at the bottom edge.
- **DP-59 — Workspace look.** The calendar and every working screen hang on the same left edge and carry the published type, surfaces, event colour and restrained accent use.
- **DP-60 — Configuration from the environment.** Every service address and credential is read from the environment at start and is never in source or sent to the browser.
- **DP-61 — Custom days and personal view.** Custom days, week start, hidden weekends and a second zone come from the person's server settings, follow them to any browser and reach their other open tabs within a second.
- **DP-62 — Event page keys.** Ctrl+S saves the event page, and Escape returns to the grid with focus on the same event, fully in view, through the address.
- **DP-63 — Slot keyboard model.** Arrow keys, Home, End, Ctrl+Home and Ctrl+End move among the grid's 15-minute slots and bring the focused slot fully into view, clear of the sticky headings.
- **DP-64 — Complete first draw.** On first load the grid shows every event of the period at its final position, scrolled to working hours, with or without the WebSocket.
- **DP-65 — Server-kept draft.** An unsaved new event is kept on the server per person, and comes back with focus in its title after a reload, in another browser and in an open second tab, and is removed on Save, Cancel or Escape.
- **DP-66 — Drag to create.** Dragging across empty slots snaps both ends to 15 minutes and opens the New event quick dialog with those times and focus in its title, creating nothing until Save.
- **DP-67 — Overlap layout.** Overlapping events share a day column by the published lane rule, measured on screen, and take their new lanes when a change arrives live.
- **DP-68 — Midnight and the top band.** All-day and 24-hour events sit in the top band, and a shorter event crossing midnight in the viewer's zone shows a block on each of its two days.
- **DP-69 — Nth and last weekday repeats.** A monthly repeat on the nth or last weekday shows on the right dates on the grid, in the viewer's zone, ending on a date or after a count.
- **DP-70 — Repeat controls.** The repeat choices are radiogroups driven by the keyboard, read their options from the start date, and save the published rule.
- **DP-71 — This event exception.** Changing This event moves only that occurrence on the grid, focus stays on it, and all other occurrences stay where they were.
- **DP-72 — Split on the grid.** After This and following, the grid shows both series on their right dates, with each exception and answer on its date, and no Undo is offered.
- **DP-73 — Delete choices.** Deleting a repeating occurrence offers the same three choices, each removes the right occurrences from the grid and creates the right trash item, and focus goes to the published place when the opener is gone.
- **DP-74 — In-app invitations.** An invitation reaches the invited person only in the app: a notice, announced once, with the event on their grid without a reload.
- **DP-75 — Focus across a redraw.** A live change that redraws the grid leaves focus on the same event at its new position, in view, or on its old slot if the event is gone.
- **DP-76 — Focus time modes.** Focus time declines only new invitations or new and existing meetings, the second by default, can repeat, and each decline reaches the organiser's open screen live.
- **DP-77 — Conflicts to answer.** Setting out of office lists the person's existing overlapping meetings to answer, without changing them, and each answer shows in place and reaches the organiser.
- **DP-78 — Busy blocks.** Find a time draws each chosen person's merged busy blocks in the viewer's zone, cut at each local midnight into one block per date, without titles, on screen.
- **DP-79 — Manage sharing level.** The manage level gives edit access plus changing that calendar's shares and default reminders, from an open screen, and its removal applies at once.
- **DP-80 — Timed reminders and defaults.** A calendar's default reminders are copied by each new timed event, and each fires once on the server clock at its minutes before each occurrence, on an open page without a reload.
- **DP-81 — Snooze.** Snooze moves a fired reminder by the chosen minutes on the server clock, and it fires and is announced once more.
- **DP-82 — Moved and deleted reminders.** Moving an occurrence moves its pending reminders, trashing cancels them, and restoring brings back those still in the future.
- **DP-83 — Search result opens the date.** Choosing a search result opens its date with that event's block focused and fully in view.
- **DP-84 — Duplicate and move.** An event can be duplicated, or moved to another calendar the person may edit, by the published rules, and open screens follow within a second.
- **DP-85 — Public holidays.** A read-only holidays calendar can be switched on from the rail, and every change to it is refused on screen and by the server.
- **DP-86 — Guest sees the warning only.** A guest sees the same zone rule warning and shown times on the grid, quick dialog and event page with no Move control, the server refuses Move anyway, and the guest's open grid follows when the organiser moves.
- **DP-87 — Modify shows the guest list.** Turning Modify event on shows every guest of that event the guest list and counts on their open screen, even with See guest list off, while viewers at details or busy access who are not its guests still see neither.
- **DP-88 — Phone schedule keeps the day.** At phone width the focused day of the schedule moves by keys, is fully in view under the toolbar, and stays in place when a live change adds rows above it.

## Frontend

### Screens and layout (DP-19, DP-20, DP-21, DP-57, DP-58, DP-59)

Published widths: phone is under 600 pixels wide, tablet is 600 to 1023, desktop is 1024 and above. No other width changes which layout 375x812, 768x1024 or 1280x800 receives. No screen scrolls sideways at any of the three.

| Screen and address | What it shows |
|---|---|
| Landing `/` | Public. Headline, one sentence, a sign-in button, a text link, and the Three clocks example panel. |
| Sign in `/signin` | One narrow column with email and passcode. |
| Calendar `/calendar` | Toolbar, grid and rail: the workspace. |
| Event `/events/<event id>` with optional `?occurrence=<occurrence id>` | Everything the viewer may see about one event or occurrence, with answers, proposals, switches and the shared link. |
| Find a time `/find` | People, duration and date range, then a list of slots. |
| Search `/search?q=<text>` | Search field and live results. |
| Trash `/trash` | Trashed items you can edit, with days left. |
| Sharing `/sharing` | Staff: the people and levels of each calendar they may manage, as set out in Sharing. |
| Zone rules `/zone-rules` | Office manager records rules; all staff read them. |
| Prints `/prints` | Office manager only: request form and printed weeks. |
| Editing on the event page | At edit access the event page holds the same fields as `dialog "Edit event"` directly on the page, with `button "Save"`. |
| Settings `/settings` | Own time zone, week start, hidden weekends, custom-days count and second zone for everyone. Default reminders for each calendar the person owns or manages. Guest defaults and office hours for the office manager. |
| Shared event `/share/<token>` | Public, read only: one event and its guest list. |

**Calendar at 1280x800:** a quiet rail fills the left of the screen, holding the mini month above the calendar list, and ends at a shared edge about 22% of the way in. The toolbar and grid start on that same edge and the grid takes the rest of the width. Default view: Week.

**Calendar at 768x1024:** the toolbar is on top, then one row with the mini month on the left and the calendar list on the right, then the grid at full width below them. Default view: Week.

**Calendar at 375x812:** in order, a compact toolbar, the date heading, then the schedule list at full width. The mini month and calendar list sit in a sheet opened by the Calendars button. Default view: Schedule, and only Schedule and Day are offered. An address asking for `view=week`, `view=month` or `view=custom` shows Schedule and leaves the address unchanged, so the same address opens that view on a wider screen.

**Single-column screens (landing, sign in, settings and the other forms):** at 1280x800 one column about 500 pixels wide starts on the 22% edge. At 768x1024 it starts about 10% in. At 375x812 it fills the width inside even side margins.

**Month view:** each day cell shows as many event chips as fit its height, then a `+<n> more` button. Shown chips plus `<n>` always equals that day's events. Both recalculate as the window height changes, with no reload.

### Public screens and controls (DP-06, DP-10, DP-11, DP-13, DP-19, DP-22, DP-23, DP-24, DP-29, DP-30, DP-32, DP-36, DP-38, DP-40, DP-41, DP-42, DP-44, DP-47, DP-54, DP-56, DP-58, DP-61, DP-62, DP-63, DP-66, DP-68, DP-70, DP-76, DP-77, DP-78, DP-79, DP-81, DP-83, DP-84, DP-85, DP-86, DP-88)

Only these are public. `<date>` is written like `Mon 8 Mar 2027`. `<time>` is 24-hour `HH:MM`. `<city>` is `New York`, `London` or `Auckland`.

Text fields take these exact formats, with 24-hour times:

- `textbox "Starts"` and `textbox "Ends"` take `YYYY-MM-DD HH:MM`, or `YYYY-MM-DD` when `checkbox "All day"` is on, read in the zone chosen in `combobox "Zone"`. In `dialog "Propose a new time"` they are read in the event's zone, and take `YYYY-MM-DD` for an all-day event.
- `textbox "From"`, `textbox "To"`, `textbox "Effective date"`, `textbox "Week starting"`, `textbox "End date"` and `textbox "Date"` take `YYYY-MM-DD`.
- `textbox "New offset"` takes `+HH:MM` or `-HH:MM`.
- `textbox "Reminder minutes"` takes whole minutes separated by commas, like `10,60`, or stays empty.
- `textbox "<city> opens"` and `textbox "<city> closes"` take `HH:MM`.

Options of `combobox "Zone"` and `combobox "My time zone"` read `New York`, `London` and `Auckland`. Options of `combobox "People"`, `combobox "Invite person"` and `combobox "Person"` are people's full names. Options of `combobox "Calendar"` are calendar names.

| Where | Role and accessible name | Visible copy or note |
|---|---|---|
| Every page | `status "Wren status"` | Polite live region present from first paint. |
| Signed-in pages | `navigation "Main"` | Links `Calendar`, `Find a time`, `Search`, `Trash`, `Zone rules`, `Sharing`, `Settings`, and for the office manager `Prints`; button `Sign out`. Outside guests get only `Calendar` and `Settings`. |
| Calendar | `link "Skip to calendar"` | First Tab stop. |
| Landing | `heading` level 1 | `Every clock in the firm,` then `agreeing to the second.` on two lines. |
| Landing | sentence | `One shared calendar for New York, London and Auckland, where a weekly meeting never drifts and nothing goes through email.` |
| Landing | `link "Sign in"`, `link "See the three clocks"` | The first looks like a small accent button and goes to `/signin`. The second is a text link that scrolls to the panel. |
| Landing | `region "Three clocks example"` | Row 1: `Partners' weekly`, `Tue 6 Oct 2026`, `09:00 New York`, `14:00 London`, `02:00 Auckland`. Row 2: `Client readout`, `Tue 6 Oct 2026`, `11:30 New York`, `16:30 London`, `04:30 Auckland`. A drawn pointer rests on row 1. |
| Sign in | `textbox "Email"`, `textbox "Passcode"`, `button "Sign in"` | Password-masked passcode. |
| Calendar toolbar | `button "Today"`, `button "Previous"`, `button "Next"`, `button "New event"`, `button "Notices"`, `heading` level 1 | Heading is the visible period. |
| Calendar toolbar | `radiogroup "View"` | Radios `Day`, `Week`, `Month`, `Custom days`, `Schedule`. |
| Calendar rail | `region "Mini month"` with `button "<date>"` per day | Chooses the date. |
| Calendar rail | `group "Calendars"` with `checkbox "<calendar name>"` | Shows or hides a calendar. |
| Phone | `button "Calendars"`, `dialog "Calendars"` | Sheet holding the mini month and list. |
| Grid | `region "Week grid"`, `region "Day grid"`, `region "Custom days grid"`, `region "Month grid"`, `list "Schedule"` | One per view. |
| Time grid | `gridcell "<date> <time>"` | One per 15-minute slot of each shown day, in the viewer's zone; the keyboard model is in Interactions. |
| Time grid | `group "All-day events"` | The top band above the day columns. |
| Time grid | `group "Second zone <city>"` | Hour labels for the second zone beside the grid's own, when one is set. |
| Schedule | `button "<date>"` | The heading of each day that has events. |
| Grid | `button "<title>, <time> to <time>"` | Event block, times in the viewer's zone. All-day: `button "<title>, all day"`. Unreadable events show title `Busy`. |
| Grid | `img "Now <time>"` | The now line, on the current day in Week and Day. |
| Grid | `img "Zone rule warning"` | Small marker inside a warned occurrence's block or chip in every view, at `full` or `guest` access. The block keeps its published accessible name. |
| Month | `button "+<n> more"`, `dialog "Events on <date>"` | Full day list. |
| Drag and quick dialog | `group "Three clocks"` holding three `group`s named `<city> <time>, inside working hours` or `<city> <time>, outside working hours` | In New York, London, Auckland order. |
| Quick dialog | `dialog "<title>"` | Title row with Three clocks; `button "Open event"`, `button "Edit"`, `button "Duplicate"`, `button "Delete"`. Edit and Delete show only when allowed; Duplicate shows at any access except `busy`. A warned occurrence at `full` or `guest` access also holds `region "Zone rule warning"` here; its `button "Move"` stays on the event page. |
| Create and edit | `dialog "New event"`, `dialog "Edit event"` | `textbox "Title"`, `combobox "Calendar"`, `combobox "Kind"` (`Event`, `Focus time`, `Out of office`), `combobox "Colour"` (`Calendar colour`, `Rose`, `Amber`, `Teal`, `Indigo`), `checkbox "All day"`, `textbox "Starts"`, `textbox "Ends"`, `combobox "Zone"`, `textbox "Location"`, `textbox "Notes"`, `checkbox "Private"`, `textbox "Reminder minutes"`, `button "Save"`, `button "Cancel"`. |
| Create and edit, repeat | `radiogroup "Repeat"`; `group "Repeat on"`; `radiogroup "Monthly by"`; `radiogroup "Ends"` | `Repeat` radios: `Does not repeat`, `Daily`, `Weekly`, `Monthly`, `Yearly`. `Repeat on`, for Weekly: `checkbox "Mon"` through `checkbox "Sun"`. `Monthly by`, for Monthly: `radio "On day <n>"`, `radio "On the <first, second, third or fourth> <weekday>"` and `radio "On the last <weekday>"`, read from the start date, with `<weekday>` written in full; the second is left out when the date is the fifth such weekday and the third shows only when the date is that month's last such weekday. `Ends` radios: `Never`, `On date` with `textbox "End date"`, `After a number` with `spinbutton "Occurrences"`. |
| Create and edit, focus time | `radiogroup "Decline"` | Radios `Only new invitations` and `New and existing meetings`, the second chosen by default. |
| Create and edit, out of office | `textbox "Decline message"` | Optional. |
| Scope choice | `dialog "Edit repeating event"`, `dialog "Delete repeating event"` | `radiogroup "Apply to"` with `radio "This event"`, `radio "This and following events"`, `radio "All events"`; Arrow keys move and select among them; `button "OK"` or `button "Delete"`, `button "Cancel"`. |
| Conflict | `dialog "This event changed"` | Text from Feedback states, `list "Winning values"`, `button "Reapply my changes"`, `button "Keep theirs"`. |
| Undo | `button "Undo"` | Beside the status region after a move, resize or trash. |
| Event page | `group "Three clocks"`, `region "Answers"`, `list "Guests"` | `Answers` holds the counts sentence and each `Guests` row holds the guest row text, both from Feedback states. Both are left out of the page when the viewer's access carries no `rsvp` or `guests`. |
| Event page | `radiogroup "Your answer"`, `radiogroup "Answer for"` | Radios `Yes`, `No`, `Maybe`; and `This event`, `All events`. Guests only. |
| Event page | `button "Propose a new time"`, `dialog "Propose a new time"` | `textbox "Starts"`, `textbox "Ends"`, `textbox "Note"`, `button "Send proposal"`. |
| Event page | `list "Proposed times"` with `button "Accept"`, `button "Decline"` | Buttons for edit access only. |
| Event page | `group "Guest switches"` with `checkbox "Modify event"`, `checkbox "Invite others"`, `checkbox "See guest list"` | Edit access only. One set per event, applying to every guest of that event. |
| Event page | `button "Invite"`, `combobox "Invite person"`, `button "Remove <name>"` | Invite follows the Invite others switch. Remove is edit access only. |
| Event page | `button "Copy shared link"`, `button "New shared link"`, `button "Turn off shared link"` | Edit access only. |
| Event page | `region "Zone rule warning"`, `button "Move"` | The region at `full` or `guest` access, for the warned occurrence in the address, or without one for the event's first warned occurrence. `Move` at `full` only. |
| Event page | `button "Duplicate"`, `combobox "Move to calendar"`, `button "Move to calendar"` | Duplicate at any access except `busy`. Moving at `full` only, listing the calendars the person may edit. |
| Event page, out of office | `list "Conflicts"` with `radiogroup "<title> on <date>"` per row | Radios `Yes`, `No`, `Maybe`. Own out-of-office events only. |
| Shared event page | `heading` level 1, `list "Guests"` | Event title, and guests with the guest row text from Feedback states, without messages. |
| Find a time | `combobox "People"`, `spinbutton "Minutes"`, `textbox "From"`, `textbox "To"`, `list "Slots"`, `button "Book <date> <time>"` | Results update on change. Times on buttons are in the viewer's zone. |
| Find a time | `region "Busy blocks"` with `group "<name>"` per checked person, holding `img "Busy <date> <time> to <time>"` | Each person's busy blocks in the viewer's zone, drawn in a per-person column by date and time. No titles. A block is cut at each midnight in the viewer's zone into one `img` per date, in date order. A segment starting at midnight is named `00:00` and a segment ending at midnight is named `24:00`. For example, with the seed data at start, an Auckland viewer checking Tane Whitcombe over 15 to 19 March 2027 sees five images, from `Busy Mon 15 Mar 2027 00:00 to 24:00` to `Busy Fri 19 Mar 2027 00:00 to 24:00`. |
| Search | `searchbox "Search events"`, `list "Results"` with `link "<title>, <date>"` | Results update on input. |
| Trash | `list "Trash"`, `button "Restore <title>"`, `button "Delete <title> for good"` | Each row shows `<n> days left`. |
| Sharing | `combobox "Calendar"`, `combobox "Level for <name>"`, `button "Remove <name>"`, `combobox "Person"`, `combobox "Level"`, `button "Add"` | Levels `See only free/busy`, `See all details`, `Make changes`, `Manage sharing`. |
| Zone rules | `combobox "Zone"`, `textbox "Effective date"`, `textbox "New offset"`, `textbox "Note"`, `button "Record rule"`, `list "Zone rules"` | Form is office manager only. |
| Prints | `textbox "Week starting"`, `button "Print the week"`, `list "Printed weeks"`, `button "Retry"`, `link "Download PDF"` | Download shows only when stored. |
| Settings | `combobox "My time zone"`, `combobox "Week starts on"` (`Monday`, `Sunday`, `Saturday`), `checkbox "Hide weekends"`, `spinbutton "Custom days"`, `combobox "Second zone"` (`None`, `New York`, `London`, `Auckland`), `textbox "Default reminders for <calendar name>"`, `checkbox "Modify event by default"`, `checkbox "Invite others by default"`, `checkbox "See guest list by default"`, `textbox "<city> opens"`, `textbox "<city> closes"`, `button "Save settings"` | Defaults and hours are office manager only. |
| Notices | `dialog "Notices"`, `list "Notices"` | Newest first. |
| Reminder | `region "Reminder: <title>"` with `combobox "Snooze for"`, `button "Snooze"`, `button "Dismiss"` | Appears on every open page of that person when a reminder fires, and holds the reminder copy from Feedback states. `Snooze for` options read `5 minutes`, `10 minutes` and `30 minutes`. |
| Go to a date | `dialog "Go to date"`, `textbox "Date"`, `button "Go"` | Opened by `G`. |
| Keyboard list | `dialog "Keyboard shortcuts"`, `list "Shortcuts"` | Opened by `?`. One row per shortcut in Interactions. |
| Unknown address | `heading` level 1 | Copy from Feedback states, with `link "Back to the calendar"`. |

### Interactions (DP-05, DP-06, DP-11, DP-12, DP-13, DP-14, DP-15, DP-16, DP-17, DP-18, DP-19, DP-21, DP-22, DP-23, DP-25, DP-39, DP-61, DP-62, DP-63, DP-64, DP-65, DP-66, DP-67, DP-68, DP-75, DP-83, DP-88)

**Address.** `/calendar` carries `view` (`day`, `week`, `month`, `custom`, `schedule`), `date` (`YYYY-MM-DD`), `calendars` (comma-separated calendar ids), `event` (occurrence id, or event id for a single event; its quick dialog is open) and `focus` (an occurrence or event id whose block holds focus, brought fully into view, with no dialog open). For example, `/calendar?view=week&date=2027-03-08&calendars=cal-dara,cal-firm&event=evt-partners-weekly@20270309T0900`. Changing any of them adds a history entry. Back and Forward restore them, including closing or reopening the quick dialog. Reload or the same address in a second tab shows the same view, date, calendars and open dialog. A missing or invalid `view` or `date` takes its default: the published view for the layout, and today in the viewer's zone. Missing `calendars` means every calendar the person can read except `Public holidays`. Unreadable ids in `calendars` are ignored.

**Grid.** Week shows the seven days of the week holding `date`, from the person's week start, in the viewer's zone. With Hide weekends on, Week and Custom days leave out Saturdays and Sundays. Custom days shows the person's custom-days count of days, from 2 to 7 inclusive, starting on `date`. `Previous` and `Next` move by the shown period: one day, one week, one month, the custom-days count, or for Schedule 14 days; Schedule lists the 14 days starting on `date`. Personal settings live on the server, follow the person to any browser, and reach their other open tabs within a second. A second zone shows its hour labels beside the grid's own, each aligned with the same instant. The now line takes its time from the server clock. The page re-reads that clock on load, on each WebSocket open, whenever the tab returns to view and at least every 30 seconds, and moves the line within a minute of real time passing. The device clock never decides the line, today or the default date.

**Pointer move and resize.** On pointer down on a block in Week or Day, Three clocks opens beside it. Moving snaps every 15 minutes; horizontal movement in Week changes the day. Dragging the top or bottom edge resizes. The clocks show the moving edge: the start for a move or top-edge resize, the end for a bottom-edge resize. Events are at least 15 minutes long, so dragging stops there. Escape during a drag cancels it and the block returns. Release saves in the event's own zone, then the quick dialog opens with focus inside it. Release on a repeating occurrence first opens the scope dialog; Cancel returns the block. In Month, dragging a chip changes the date only and shows no ribbon. Dragging on an empty part of Week, Day or Custom days snaps both ends to 15-minute slots in the viewer's zone and, on release, opens `dialog "New event"` as a quick dialog with those times, the viewer's zone and focus in `textbox "Title"`. Nothing is created until Save. On touch at tablet and desktop width, a press of about half a second starts the same drag. At phone width events are moved with the edit dialog.

**Working-hours bars.** A start is inside when it is at or after the office's opening time and before closing on a working day. An end is inside when it is after opening and at or before closing on a working day. Everyone works their office's hours.

**Keyboard.** Enter on a focused event opens the quick dialog. Alt+Up and Alt+Down move it 15 minutes. Alt+Left and Alt+Right move it one day. Alt+Shift+Up and Alt+Shift+Down change its end by 15 minutes, never below 15 minutes long. Each press saves, keeps focus on the same event, and shows Three clocks beside it. On a repeating occurrence the first press opens the scope dialog, and later presses reuse that choice until focus leaves the event.

**Single-key shortcuts** (case-insensitive, no modifier): `1` or `D` Day, `2` or `W` Week, `3` or `M` Month, `4` or `X` Custom days, `5` or `A` Schedule, `T` today, `J` next period, `K` previous period, `G` go to a date, `C` new event, `E` opens the focused event's page, `Z` undo, `Delete` deletes the focused event through the same scope and trash rules as its button, `/` open `/search` with focus in `searchbox "Search events"`, `S` open `/settings`, `?` the list of shortcuts. They work with focus anywhere on the calendar screen, including a button, slot or event block. They do nothing in a text field, combobox or searchbox, or while any dialog is open.

**Slots.** The time grid takes one Tab stop for its slots, on one `gridcell` at a time, and each event block is its own Tab stop after it. Up and Down move one slot, Left and Right one shown day. `Home` goes to the same time on the first shown day and `End` to the same time on the last shown day. `Ctrl+Home` goes to the first slot of the first shown day and `Ctrl+End` to the last slot of the last shown day. The newly focused slot is always brought fully into view, with no part under the sticky day headings or hour labels. Enter on a slot opens `dialog "New event"` for its 15 minutes.

**Event page keys.** `Ctrl+S` saves the event page's fields at edit access and never opens the browser's own save prompt. `Escape` drops any unsaved changes and goes to `/calendar` for the date of that event with its block focused, and fully in view, through the `focus` address value.

**First draw.** On first load the grid shows every event of the period at its final position and size the first time it is visible, with the 09:00 row at the top of the scrolling area in the viewer's zone, within one row. This needs neither a live message nor a second request after that drawing, and it is the same with the WebSocket refused.

**Overlaps.** In a day column, events linked by overlapping instants form one group; shared endpoints do not overlap. Sort a group by longest duration first, then earliest start, then event id. Place each event in the leftmost lane where it overlaps nothing already placed. Every event in the group is one lane wide, a lane being the column's width divided by the group's lane count, and sits at its lane's left edge, within 2 pixels. A block's top and height follow its minutes on one even scale.

**Top band and midnight.** All-day events and timed events of 24 hours or more sit in `group "All-day events"`, across each of their shown days in Week, Day and Custom days. A timed event under 24 hours that crosses midnight in the viewer's zone shows one block on each of its two days, each cut at midnight, with the same accessible name and the event's full times. In Schedule and Month it is listed on both days.

**Focus across a redraw.** A live change that redraws the grid leaves focus on the same event block, at its new position, and keeps it in view. If that event is gone from the view, focus moves to the slot at its old start. A live change never moves focus while a dialog is open.

**Schedule keys at phone width.** Up and Down on a day's `button "<date>"` go to the next or previous listed day, and Home and End to the first and last. The focused day is fully in view under the sticky toolbar, and stays so, at the same position within 4 pixels, when a live change adds or removes rows above it.

**Dialogs.** Every dialog and sheet wraps Tab and Shift+Tab among its own controls, closes on Escape, and returns focus to its opener. For a quick dialog, the opener is that same event block, even after a save re-renders the grid. When the dialog's action removed its opener, as a delete does, focus goes to the slot at that event's old start, or in Schedule and Month to the next event of that day or else that day's heading or cell. The first field or first control receives focus on opening, and for a dialog opened from a slot Save returns focus to the new event's block.

**Undo.** After a move, resize or trash, `button "Undo"` stays for 10 seconds and `Z` does the same. It puts back exactly what the change altered: the times, the exception it created, and every answer the change returned to waiting. It is not offered after a This and following change or after a Move for a zone rule. Undo goes through the same version check as any save.

**Drafts.** Every change in `dialog "New event"` saves that person's one server draft within half a second of the last change. While a draft exists, every `/calendar` page of that person shows that dialog with the draft's values, focus in `textbox "Title"` on load, including after a reload, in another browser, and within a second in an already open second tab. Save and Cancel delete the draft, as does Escape, which closes the dialog. No browser storage holds it.

**Answers and proposals.** Choosing a radio in `Your answer` saves at once for the chosen `Answer for` scope. No screen needs a reload to show another person's change: blocks, counts, guest rows, proposals, warnings, prints and access changes update in place within a second of the server's commit.

**Search and find a time.** Results update while typing, without a submit, within half a second of the last keystroke, and `q` stays in the address. Choosing a result opens `/calendar` at that date with the result's block focused and fully in view, through the `focus` address value. Below the API's minimum length the page sends no search, empties `list "Results"` and shows the too-short copy from Feedback states. Find a time updates on any field change. `Book <date> <time>` opens `dialog "New event"` with the times and the chosen people as guests.

### Visual design (DP-58, DP-59)

Direction: quiet instrument. The mood is hushed, exact and nocturnal: one narrow column on a mostly empty first screen, everything aligned to one left edge, on a plum-black ground.

- **Type:** Sora for both headings and body. Titles are Sora light, content is Sora regular, never smaller than 16 pixels. Each heading step is a quarter larger than the one below it.
- **Colour roles:** plum-black ground; a slightly lifted dark plum for surfaces; white ink; a soft greyed mauve for muted text; hot pink as the single accent, carrying dark plum-black text when it is a fill. Pink marks only the primary button and the Three clocks bars.
- **Density:** comfortable. Every control and tap target is at least 44 pixels in each direction. Everything meets WCAG 2.2 AA contrast.
- **Composition:** everything hangs on one left edge about 22% in. Landing and settings are a single column of about 440 to 560 pixels. The calendar keeps the grid as its one wide element, with the mini month and calendar list tucked into a quiet rail that shares the edge.
- **Hero:** on the dark ground, a light two-line headline, one sentence, one small pink button and a text link on that edge. At the bottom edge a surface panel about 370 pixels wide peeks in with the two published event rows and the drawn pointer.
- **Working screens:** grid, event page, find a time, sharing, settings, trash and search use the same light titles and regular content. Every surface uses one small corner rounding. Event blocks are fills in their calendar's colour with white text that passes contrast, and the small colour chips in the list and month view carry the calendar's identity.
- **Hour grid:** drawn by spacing and alternating tint steps, with no lines between hours or days. The dense grid stays fully readable within the calm: hour labels and block text are never dimmed below contrast.
- **Empty, loading and outage states:** one plain sentence in the column with a text link, never a spinner alone.
- Add no paper or cream ground, hairline rules, monospace labels, index numbering or glass.

### Motion and effects (DP-13, DP-14, DP-57)

**Three clocks, the signature.**
1. On pointer down, a slim ribbon slides out from beside the block in about a third of a second and settles softly. It holds three stacks of evenly spaced numerals, for New York, London and Auckland.
2. At each 15-minute snap, each changed digit rolls to its new value in about a fifth of a second, starting quickly and settling softly. The accessible names update at the same moment.
3. A bar under each stack is pink while that time is inside working hours and muted while outside. It changes at the same snap.
4. Moving back reverses the numerals step by step, with the same values at the same positions.
5. On release, the ribbon travels into the quick dialog's title row in about a third of a second and stays there. Its final values equal the saved event.

**Other motion.** Dialogs fade and rise in under a quarter of a second to show they have opened, and fade out faster than they arrive. Blocks changed by another person take their new position in under a third of a second. Press feedback is a slight tint change, immediate. No decorative looping animation exists anywhere, and no 3D scene.

**Reduced motion.** Numerals swap with no roll, the ribbon appears and settles without sliding, dialogs appear at once, and blocks jump. The same three times and flags are shown. On each snap the status region announces the three-clock line from Feedback states. All functions stay available.

### Feedback states (DP-10, DP-14, DP-15, DP-18, DP-25, DP-27, DP-28, DP-30, DP-33, DP-37, DP-39, DP-42, DP-43, DP-44, DP-45, DP-46, DP-50, DP-52, DP-53, DP-54, DP-56, DP-74, DP-80, DP-81, DP-84, DP-86)

Every string here renders character for character, with straight apostrophes, in `status "Wren status"` unless a different place is named. `<title>` is the title the viewer may read. `<name>` is a person's full name. Failed saves not listed below show their API `message` in the status region. Field errors appear beside the field and are linked from a summary at the top of the form. A text field holding another format than its published one shows `Use YYYY-MM-DD HH:MM.`, `Use YYYY-MM-DD.` or `Use HH:MM.`, matching that format.

| Action | Pending | Success | Failure |
|---|---|---|---|
| Sign in | `Signing in...` | goes to the calendar | beside the form: `That email and passcode do not match.` |
| Save an event | `Saving <title>...` | `Saved <title>.` | fields: `Enter a title.`, `End must be after start.`, `Use a daily, weekly, monthly or yearly repeat with INTERVAL, BYDAY, COUNT or UNTIL.` |
| Move or resize | `Saving <title>...` | `Moved <title> to <time> <city>.` with the viewer's city; resize: `Resized <title> to end at <time> <city>.` | at the limit: `Events are at least 15 minutes long.` |
| Undo | `Saving <title>...` | `Undid the last change to <title>.` | conflict dialog |
| Answer | `Saving your answer...` | `Your answer is saved: <Yes, No or Maybe>.` | API message |
| Propose | `Sending your proposal...` | `Your proposal for <title> is sent.` | `You already have an open proposal for this time.` |
| Trash | `Moving <title> to trash...` | `Moved <title> to trash.` | API message |
| Restore | `Restoring <title>...` | `Restored <title>.` | `Restore the series first, then this occurrence.` |
| Delete for good | `Deleting <title>...` | `Deleted <title> for good.` | API message |
| Share level | `Saving access...` | `Access saved.` | API message |
| Record zone rule | `Recording rule...` | `Rule recorded for <city>.` | API message or field error |
| Zone Move | `Moving <title>...` | `Moved <title> back to <saved time> <city>.` | API message |
| Settings | `Saving settings...` | `Settings saved.` | field errors |
| Duplicate | `Duplicating <title>...` | `Duplicated <title>.` | API message |
| Move to calendar | `Moving <title>...` | `Moved <title> to <calendar name>.` | API message |
| Snooze | `Snoozing <title>...` | `Snoozed <title> for <n> minutes.` | API message |

**Conflict dialog text:** `<name> saved this first. Their values are shown here.` Reapplying sends the loser's changed fields on top of the winner's version and shows `Saved <title>.`. `Keep theirs` closes with `Kept the saved values for <title>.`.

**Decisions**, also written as notices:
- `<name> is out of office until <date>, so <title> was declined automatically.` `<date>` is the last out-of-office day in that person's zone. For a timed out of office, it is the date it ends.
- `<name> is in focus time until <time>, so <title> was declined automatically.` `<time>` is when that focus block ends, in that person's zone.
- `Proposal accepted: <title> moves to <time> <city>.` in the event's zone and city.
- `Proposal declined for <title>.`
- A new proposal, to edit access and not a decision: `<name> proposed <time> <city> for <title>.` `<time>` is the proposed start in the event's zone and `<city>` is that zone's city, as with an accepted proposal.

**Three-clock line**, under reduced motion and for keyboard moves under reduced motion: `New York <time> <flag>, London <time> <flag>, Auckland <time> <flag>.` with `<flag>` being `inside working hours` or `outside working hours`.

**Occurrences moved by a gap** show on the event page and quick dialog: `This occurrence starts at <time> because <requested time> does not exist on <date>.`

**Answers and guests.** `region "Answers"` reads `<yes> yes, <no> no, <maybe> maybe, <invited> waiting`, where the four numbers are the `rsvp` counts, zeros included. Each row of `list "Guests"` reads `<name>: <answer>`, where `<answer>` is `Yes`, `No`, `Maybe` or `Waiting`, for the page's occurrence, or the series default when the page has none. Rows are in alphabetical order of name. A reply that carries a `message` shows it on a second line in the same row. For example, with the seed data at start, Partners' weekly on Tue 9 Mar 2027 reads `1 yes, 0 no, 1 maybe, 1 waiting`, with the row `Ines Okafor: Yes`.

**Guest list and link:** turning See guest list off when a link existed: `Guest list hidden. The shared link no longer works.` Dead or unknown shared link page heading: `This link no longer works.` Unknown address heading: `Nothing is scheduled at this address.`

**Access changes** to the colleague: `Your access to <calendar name> changed to <level label>.` or `You no longer have access to <calendar name>.` Asking for an unreadable event in the address: `That event is not available.`

**Zone warning** in `region "Zone rule warning"`: `A zone rule for <city> took effect on <date>: <note> <saved time> now shows as <shown time>.`

**Invitations**, written as a notice and announced once on each open screen of the invited person: `<name> invited you to <title>.`

**Reminders**, written as a notice and announced once when one fires, including after a snooze: all day `Reminder: <title> is tomorrow.`, timed `Reminder: <title> starts at <time> <city>.` in that person's zone. Notices with nothing in them: `No notices yet.`

**Empty states:** trash `Trash is empty. Deleted events stay here for 30 days.`; search with no match `Nothing matches <q>.`, and result count announcements `<n> results for <q>.` or `1 result for <q>.`; a search field holding too few characters `Type at least 2 characters to search.`, shown in the column and not announced; find a time `No free time fits these people. Try a longer range.`; prints `No printed weeks yet.`; schedule `Nothing scheduled in this period.`

**Prints**, on the row in `list "Printed weeks"`, and announced on each change:

| State | Copy |
|---|---|
| `pending`, working | `Preparing the printed week.` |
| `pending`, document service down | `The document service is not answering. This print stays pending; choose Retry.` |
| `rendered`, working | `Storing the printed week.` |
| `rendered`, file storage down | `File storage is not answering. This print stays pending; choose Retry.` |
| `failed` | `This print failed. Choose Retry.` |
| `stored` | `The printed week is ready.` |

**iCalendar actions:** `Exported <calendar name>.` with a download link; `Imported <created> new and <updated> updated into <calendar name>.`; while storage is down the 503 message from API.

**WebSocket lost:** beside the toolbar `Reconnecting. Changes will catch up.` until reopened, then nothing further.

## Backend

### API (DP-01 to DP-05, DP-07 to DP-09, DP-22 to DP-55, DP-61, DP-65, DP-73, DP-76 to DP-82, DP-84 to DP-87)

JSON is UTF-8 with `Content-Type: application/json`; any other type on a JSON endpoint answers `415`. JSON bodies may be up to and including 1,000,000 bytes, and iCalendar uploads up to and including 5,000,000 bytes; larger answers `413`.

**Error shape, everywhere:** `{"error":"<code>","message":"<sentence>"}`, with `"fields":{"<field>":"<sentence>"}` added on `422`. Field sentences are the Feedback states copy where given.

**Order of checks for the whole API:** `413` and `415`; a state-changing request with a foreign `Origin` answers `403 cross_origin`; an idempotent replay returns its stored response; `401 unauthenticated`; `404 not_found` for an unknown resource or one the caller cannot read at all; `403 forbidden`; `428 version_required` and `412 version_conflict`; state conflicts `409`; validation `422`.

**Formats:** `start_local` and `end_local` are `YYYY-MM-DDTHH:MM` in the event's `zone`; for all-day events they are `YYYY-MM-DD` with the end date inclusive, and `start_utc` and `end_utc` are `null`. `zone` is `America/New_York`, `Europe/London` or `Pacific/Auckland`. An occurrence id is `<event id>@<YYYYMMDDTHHMM>` using the occurrence's original rule-generated local start. Single events use their event id as `occurrence_id`. A `clocks` array has three entries in New York, London, Auckland order: `{"city","time","date","inside_hours"}`; it is empty for all-day events. An event's version travels in the `ETag` response header as `"<version>"` and in the `version` field.

**Access levels** are returned as `access`, the first that applies: `full` (calendar owner, or `edit` or `manage` share), `guest` (invited), `details` (`details` share on a non-private event, and every event of `Public holidays`), `busy` (everything else readable).

**Published fields.** Event responses carry exactly these and nothing else; other than `full`, nothing else may appear in any body.

| Access | Event fields |
|---|---|
| `full` | `id, calendar_id, series_id, split_from, organiser, title, location, notes, kind, colour, reminders, all_day, start_local, end_local, zone, visibility, rrule, decline_mode, decline_message, switches, guests, rsvp, proposals, exceptions, zone_warnings, share_link, version, saved_at, access, adjusted, clocks, start_utc, end_utc` |
| `guest`, See guest list on or Modify event on | `id, calendar_id, series_id, organiser, title, location, notes, kind, colour, reminders, all_day, start_local, end_local, zone, rrule, switches, guests, rsvp, my_reply, my_proposals, zone_warnings, version, access, adjusted, clocks, start_utc, end_utc` |
| `guest`, See guest list off and Modify event off | same as above without `guests` and `rsvp` |
| `details` | `id, calendar_id, series_id, organiser, title, location, notes, kind, colour, all_day, start_local, end_local, zone, rrule, access, adjusted, clocks, start_utc, end_utc` plus `guests` and `rsvp` only when See guest list is on |
| `busy` | `id, calendar_id, title` (always `Busy`)`, all_day, start_local, end_local, zone, access, clocks, start_utc, end_utc` |

Occurrence responses use the same fields for their access, with `occurrence_id` and `event_id` in place of `id`, plus `is_exception`. At `busy`, an occurrence carries exactly `occurrence_id, event_id, calendar_id, title, all_day, start_local, end_local, zone, access, clocks, start_utc, end_utc`. Its block and its address still open it, as `dialog "Busy"` holding only Three clocks and `button "Open event"`, and its event page shows only those values. A busy all-day occurrence has empty `clocks`, so its dialog holds only `button "Open event"`. Sub-objects: `organiser {id,name}`; `guests [{person_id,name,answer,message}]`; `my_reply {answer,message}`; `rsvp {yes,no,maybe,invited}`; `switches {modify_event,invite_others,see_guest_list}`; `proposals` and `my_proposals` items `{id,occurrence_id,proposer {id,name},start_local,end_local,note,status}`; `exceptions [{occurrence_id,deleted,start_local,end_local,title,location,notes}]`; `zone_warnings [{rule_id,city,effective_date,new_offset,shift_minutes,saved_time,shown_time,note}]`; `share_link {token,url,expires_at}` or `null`. Email addresses appear only in the caller's own `GET /api/me`.

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| `GET /api/health` | | `200 {"status":"ok"}` | `503 {"status":"starting"}` until Postgres answers |
| `GET /api/time` | | `200 {"now_utc":"<RFC 3339>","zone":"<caller zone or UTC>"}` | public |
| `POST /api/session` | `{"email","passcode"}` | `200 {"person":{...}}`, sets `HttpOnly`, `SameSite=Lax` cookie | `401 bad_credentials` |
| `DELETE /api/session` | | `204` | |
| `GET /api/me` | | `200 {"id","name","email","zone","city","role","week_start","hide_weekends","custom_days","second_zone"}`; `role` is `office_manager`, `member` or `guest`; `week_start` is `monday`, `sunday` or `saturday`; `custom_days` a whole number from 2 to 7 inclusive; `second_zone` a published zone or `null`. New people start `monday`, `false`, `4`, `null`. | |
| `PATCH /api/me` | any of `zone, week_start, hide_weekends, custom_days, second_zone` | `200` same | `422` |
| `GET /api/draft` | | `200 {"draft":{...}}`, `{"draft":null}` when none | |
| `PUT /api/draft` | Any of the fields of `POST /api/events`, unvalidated beyond type, at most one per person | `200 {"draft":{...}}` | `422` |
| `DELETE /api/draft` | | `204` | |
| `GET /api/people` | | `200 {"people":[{"id","name","zone","city"}]}` | `403` for role `guest` |
| `GET /api/calendars` | | `200 {"calendars":[{"id","name","owner_id","colour","level","default_reminders"}]}`; `level` is `owner`, `manage`, `edit`, `details`, `free_busy` or `read_only` | |
| `PATCH /api/calendars/:id` | `{"default_reminders":[<minutes>]}` | `200` calendar | `403` below `manage`; `422` |
| `GET /api/occurrences?from=YYYY-MM-DD&to=YYYY-MM-DD&calendars=a,b` | `to` is exclusive; at most 366 days | `200 {"occurrences":[...]}` ordered by start; includes events where the caller is a guest | `422` |
| `POST /api/events` | `calendar_id, title, kind, all_day, start_local, end_local, zone, location?, notes?, colour?, visibility?, rrule?, reminders?, decline_mode?, decline_message?, switches?, guest_ids?` | `201` event | `403` below edit on that calendar; `422` |
| `GET /api/events/:id?occurrence_id=` | | `200` event, with answers for that occurrence if given | |
| `PATCH /api/events/:id` | `If-Match: "<version>"`; changed fields, plus `scope` (`this`, `following`, `all`) and `occurrence_id` for a series | `200 {"event":{...},"split":null}`, or with a split `"split":{"earlier_id","later_id"}` | `412`, `428`, `403`, `404 not_found` for a deleted occurrence, `422` |
| `DELETE /api/events/:id?scope=&occurrence_id=` | `If-Match` | `200 {"trash_id"}` | same |
| `POST /api/events/:id/duplicate` | | `201` event | `403` at `busy` |
| `POST /api/events/:id/move` | `If-Match`; `{"calendar_id"}` | `200` event | `403` below edit on either calendar, and for `Public holidays`; `412`, `428` |
| `GET /api/events/:id/conflicts` | | `200 {"conflicts":[{"event_id","occurrence_id","title","start_local","zone","answer"}]}` | `403` unless it is the caller's own out-of-office event |
| `POST /api/events/:id/guests` | `{"person_ids":[...]}` | `200` event for the caller's access | `403` without edit access or Invite others |
| `DELETE /api/events/:id/guests/:person_id` | | `200` event | `403` below `full` |
| `PUT /api/events/:id/replies/me` | `{"scope":"occurrence"|"series","occurrence_id"?,"answer":"yes"|"no"|"maybe"}` | `200 {"my_reply":{...}}` | `403 not_a_guest`; `422` |
| `POST /api/events/:id/proposals` | `{"occurrence_id"?,"start_local","end_local","note"?}` | `201` proposal | `403 not_a_guest`; `409 proposal_open`; `422` |
| `POST /api/proposals/:id/accept`, `/decline` | | `200 {"proposal":{...},"event":{...}}` | `403`; `409 proposal_decided` |
| `POST /api/events/:id/share-link` | creates or regenerates | `201 {"token","url","expires_at"}` | `403`; `409 guest_list_hidden`; `409 private_event` |
| `DELETE /api/events/:id/share-link` | | `204` | `403` |
| `GET /api/share/:token` | public | `200 {"title","location","organiser_name","all_day","start_local","end_local","zone","clocks","guests":[{"name","answer"}]}` | `404 not_found` with message `This link no longer works.`; any other method answers `405 read_only` |
| `GET /api/shares?calendar_id=` | | `200 {"shares":[{"person_id","name","level"}]}` | `403` as set out in Sharing |
| `PUT /api/calendars/:id/shares/:person_id` | `{"level":"free_busy"|"details"|"edit"|"manage"}` | `200` share | `403`; `422` |
| `DELETE /api/calendars/:id/shares/:person_id` | | `204` | `403` |
| `GET /api/settings` | | `200 {"guest_defaults":{"modify_event","invite_others","see_guest_list"},"office_hours":{"<zone>":{"open":"HH:MM","close":"HH:MM","days":[1,2,3,4,5]}}}`; days use 1 for Monday | `403` for role `guest` |
| `PATCH /api/settings` | any of those | `200` same | `403`; `422` |
| `GET /api/zone-rules` | | `200 {"rules":[{"id","zone","city","effective_date","new_offset","note","recorded_by"}]}` | `403` for role `guest` |
| `POST /api/zone-rules` | `{"zone","effective_date","new_offset","note"}` | `201` rule | `403`; `409 rule_exists` for that zone and date; `422` |
| `POST /api/events/:id/zone-moves` | `If-Match`; `{"rule_id"}` | `200 {"event":{...},"split":null or {...}}` | `403` below `full`; `409 not_warned`; `412`, `428` |
| `GET /api/trash` | | `200 {"items":[{"id","kind":"event"|"series"|"occurrence","title","event_id","occurrence_id","trashed_at","purge_at","days_left"}]}` | items at edit access only |
| `POST /api/trash/:id/restore` | | `200 {"event":{...}}` | `403`; `409 not_trashed`; `409 parent_trashed` |
| `DELETE /api/trash/:id` | | `204` | `403` |
| `GET /api/search?q=` | `q` at least 2 characters | `200 {"results":[{"event_id","occurrence_id","title","start_local","zone","calendar_id"}]}`, at most 50 | `422` |
| `GET /api/find-a-time?people=a,b&minutes=30&from=YYYY-MM-DD&to=YYYY-MM-DD` | `to` inclusive; at most 31 days; minutes a multiple of 15 from 15 to 480 inclusive | `200 {"slots":[{"start_utc","end_utc","clocks"}],"busy":[{"person_id","name","blocks":[{"start_utc","end_utc"}]}]}`, at most 20 slots | `403` for role `guest`; `422` |
| `GET /api/notices` | | `200 {"notices":[{"id","kind","text","created_at"}]}` newest first | |
| `GET /api/reminders?from=&to=` | event dates; `to` exclusive; at most 366 days | `200 {"reminders":[{"id","occurrence_id","title","minutes","due_utc","status":"scheduled"|"fired"|"snoozed"|"cancelled","fired_at"}]}`, caller's own | `422` |
| `POST /api/reminders/:id/snooze` | `{"minutes":5|10|30}` | `200` reminder | `404`; `409 not_fired`; `422` |
| `POST /api/prints` | header `Idempotency-Key` required; `{"week_start":"YYYY-MM-DD","calendars"?:[...]}` | `202` print | `403`; `409 idempotency_conflict`; `422`, including a `week_start` that is not a Monday |
| `GET /api/prints`, `GET /api/prints/:id` | | `200 {"prints":[...]}`, `200` print | `403` |
| `POST /api/prints/:id/retry` | | `202` print; `200` unchanged when already `stored` | `403` |
| `GET /api/prints/:id/pdf` | | `200 application/pdf`, attachment `wren-week-<week_start>.pdf` | `403`; `409 print_not_stored` |
| `POST /api/calendars/:id/exports` | | `201 {"id","object_key","size_bytes","url"}` | `403` at `free_busy`; `503 file_storage_unavailable` |
| `GET /api/exports/:id/file` | | `200 text/calendar` | `503 file_storage_unavailable` |
| `POST /api/calendars/:id/imports` | `Content-Type: text/calendar` | `201 {"id","object_key","created","updated","skipped":[{"uid","reason"}]}` | `403` below edit; `422 invalid_icalendar`; `503 file_storage_unavailable` |
| `GET /api/live?after=<seq>` | WebSocket; cookie | see Business rules | `401` before upgrade |

**Print object:** `{"id","week_start","calendars","status","waiting_on","object_key","size_bytes","created_at","stored_at"}`. `status` is `pending`, `rendered`, `stored` or `failed`. `waiting_on` is `null`, `document_service` or `file_storage`.

**File storage 503 message:** `File storage is not answering. Nothing was changed. Try again shortly.`

Other messages named in Feedback states are the `message` value for `bad_credentials`, `proposal_open` and `parent_trashed`.

### Business rules (DP-01 to DP-10, DP-22, DP-24 to DP-53, DP-69, DP-71 to DP-74, DP-76 to DP-82, DP-84 to DP-87)

**Time.**
- An event is stored as local clock times plus its own zone. Instants are computed for each occurrence from that zone's rules for that date. A recorded zone rule works differently, as set out in Zone rules.
- A local start that does not exist on a change day moves forward to the first valid minute of that day for that occurrence only, keeping its duration, with `adjusted: true`. Later occurrences return to the requested time.
- A local start that happens twice uses the first of the two instants.
- With seed data: Sunday markets check is 02:30 to 03:00 on Sun 7 Mar 2027, 03:00 to 03:30 on Sun 14 Mar 2027 and 02:30 to 03:00 on Sun 21 Mar 2027.
- All-day events are the same calendar dates for every viewer.

**Repeat rules.** `rrule` absent or `null` means no repeat. Otherwise it is uppercase `NAME=value` parts joined by `;`, in any order, each part at most once, and is returned as sent.
- `FREQ` is required: `DAILY`, `WEEKLY`, `MONTHLY` or `YEARLY`.
- `INTERVAL` is optional: a whole number from 1 to 99 inclusive, with no leading zero. It counts periods from the start date's period, and weeks begin on Monday. It may combine with any other part.
- `COUNT` is optional: a whole number from 1 to 999 inclusive, with no leading zero.
- `UNTIL` is optional, written `YYYYMMDD`: an inclusive local date, not before the start date. `COUNT` and `UNTIL` never appear together.
- `BYDAY` with `WEEKLY`: a comma-separated list of `MO`, `TU`, `WE`, `TH`, `FR`, `SA`, `SU`, in any order, with no repeats and no number prefix.
- `BYDAY` with `MONTHLY`: exactly one weekday with a prefix, `1` to `4` for the nth or `-1` for the last, such as `2TU` or `-1FR`. It never goes with `DAILY` or `YEARLY`.
- Monthly without `BYDAY`, and yearly, take their day from the start date. A monthly repeat on the 29th, 30th or 31st skips months without that day; February 29 yearly occurs only in leap years.
- The start date must itself match the rule, so a weekly `BYDAY` list must include the start date's weekday, and a monthly `2TU` must start on a second Tuesday.
- Any other form answers `422` on `rrule`. Skipped dates do not count toward `COUNT`; deleted occurrences do.

| Accepted | Rejected |
|---|---|
| `FREQ=DAILY` | `freq=daily` |
| `FREQ=WEEKLY;BYDAY=TU,MO` | `FREQ=WEEKLY;BYDAY=mo`, `FREQ=WEEKLY;BYDAY=MO,MO`, `FREQ=WEEKLY;BYDAY=1MO` |
| `COUNT=4;FREQ=WEEKLY;INTERVAL=2` | `FREQ=WEEKLY;INTERVAL=0`, `FREQ=WEEKLY;INTERVAL=100`, `FREQ=WEEKLY;COUNT=0`, `FREQ=WEEKLY;COUNT=1000` |
| `FREQ=MONTHLY;UNTIL=20271231`, `FREQ=MONTHLY;BYDAY=2TU`, `FREQ=MONTHLY;BYDAY=-1FR` | `FREQ=MONTHLY;BYDAY=MO`, `FREQ=MONTHLY;BYDAY=5TU`, `FREQ=MONTHLY;BYDAY=2TU,3TU`, `FREQ=MONTHLY;BYMONTHDAY=1`, `FREQ=MONTHLY;UNTIL=20271231T000000Z` |
| `FREQ=YEARLY;INTERVAL=2` | `FREQ=YEARLY;COUNT=2;UNTIL=20301231`, `INTERVAL=2`, `FREQ=HOURLY` |

**Editing a series.** `this` writes an exception keyed to that occurrence's original date. `all` applies changed fields to the series. A field an exception overrode keeps the exception's value, unless that same field is the one being edited, and then the exception takes the new value. Fields it did not override follow the series. Each exception stays attached to its date, so an exception moved to another date that takes a new clock time keeps its moved date. If `all` changes the rule, modified exceptions whose date no longer fits stay as standalone occurrences with their values, and deleted exceptions whose date no longer fits are dropped.

**This and following.** `following` ends the original series on the day before that occurrence and starts a new series there with the changes, with `split_from` naming the earlier one. Every exception, per-occurrence answer and open proposal dated on or after the split moves to the new series on the same date; series-wide answers and guest switches are copied. A `COUNT` divides: the earlier series keeps the count generated before the split and the later takes the remainder. `following` on the first occurrence behaves as `all`.

**Deleting.** `this` makes a deleted occurrence and an `occurrence` trash item, keeping its overridden values and answers. `following` splits the same way and trashes the later series as a `series` item. `all`, or deleting a single event, trashes it as a `series` or `event` item.

**First save wins.** `PATCH`, `DELETE` and zone moves require `If-Match`; missing answers `428`. An exception or split changes the series' one version. Of concurrent requests against the same version exactly one succeeds. Each other answers `412 {"error":"version_conflict","message":"<name> saved this first.","current":{...}}`, with `current` being the event at the caller's access and `<name>` the winner's name. Reapplying is a new `PATCH` with the new version.

**Replies.** A guest starts `invited`. Answers move among `yes`, `no`, `maybe` freely; a return to `invited` by the guest answers `422`. A series answer sets the series default and leaves per-occurrence answers in place. Only guests reply: `403 not_a_guest`. The organiser is not a guest row and is not counted. `rsvp` counts guests for the requested occurrence, or series defaults if none is given.

**Moved times.** Any change to an occurrence's time returns its guests to `invited` for the changed occurrences, except an accepted proposer who becomes `yes`, then rechecks automatic declines.

**Automatic declines.** A person's out-of-office and focus events are decline windows, over each of their occurrences; a focus event can repeat. A focus event's `decline_mode` is `new_only` or `new_and_existing`, and is `new_and_existing` when left out. An out-of-office event's optional `decline_message` is 1 to 200 characters. Neither field applies to any other kind. Windows and meetings overlap when their instants intersect, with shared endpoints not overlapping; all-day windows cover that date from local midnight to local midnight in the window's zone.
- When a person is invited, or an occurrence's time changes, each occurrence overlapping one of that person's windows answers `no`, with `message` being the window's `decline_message` when it has one and otherwise the published copy for that window. Other occurrences of the series are not touched.
- When a focus event with `new_and_existing` is created or moved, every overlapping occurrence where that person is a guest becomes `no` the same way, whatever its answer. With `new_only` nothing existing changes.
- When an out-of-office event is created or moved, existing occurrences keep their answers and are listed as its conflicts: every occurrence overlapping it where that person is a guest, ordered by start. The person answers each from `list "Conflicts"`, with the usual reply rules for that occurrence, and the row shows the new answer in place.
- Removing a window restores nothing.
- A guest may change an automatic `no` afterward. Events on a person's own calendar are never declined.

**Decisions.** An accepted proposal, a declined proposal and an automatic decline each commit one `decision` change-log entry with one `decision_id`, delivered once to each open screen of the organiser, the affected guest and those at `full` access. Other guests get one only for an accepted proposal, without another guest's name, and only when they can read the event. Screens announce a `decision_id` once, even when a reconnect replays it. Each decision also writes one notice per person.

**Proposals.** State: `proposed` then `accepted` or `declined`, with no other edge. Only a guest proposes, at most one open per guest per occurrence, else `409 proposal_open`. A proposal on a series needs `occurrence_id`, else `422`. Only `full` access decides. Deciding an already decided proposal, including the loser of a simultaneous decision, answers `409 proposal_decided`. Accepting moves that occurrence only, as an exception, or the single event.

**Invitations.** Inviting a person writes one notice and sends it live to their open screens, announced once. Their answer starts at `invited` for every occurrence, and they find the event on their grid at once.

**Guest switches.** Each switch is set once per event and applies to every guest of that event; there is no per-guest switch. New events take `guest_defaults` unless `switches` is given. Changing defaults never alters existing events. `Modify event` lets a guest change title, location, notes, start, end and repeat by the same rules as a save; it never lets them change switches, guests, visibility, calendar or the shared link. Without it, the server answers `403`. `Modify event` on also shows every guest of that event the guest list and counts, whatever See guest list says, on their open screens within a second. `Invite others` lets a guest add people. With See guest list off, anyone below `full` who is not a guest of an event with Modify event on (`details` and `busy` viewers always, and the event's guests while Modify event is off) receives neither other guests nor counts in any body, page, live message, notice, search result, iCalendar file or shared link. For example, with the seed data at start, turning Modify event on for Northgate board review shows the guest list and counts to Sam Aldous, Bea Marchetti and Hana Rewiti, while Marit Holloway, at `details` on `cal-ines`, still sees neither.

**Private events.** `visibility` is `default` or `private`. Below `full`, and not a guest, the event is `busy` access. At `free_busy`, every event is `busy` access. Busy events are never matched by search and are written as `SUMMARY:Busy` with no other text in exports.

**Shared links.** Each event has at most one live link, with an unguessable token. A link dies when regenerated, turned off, when See guest list is turned off, or at `expires_at`, which is `SHARE_LINK_TTL_SECONDS` after creation. Turning See guest list on again never revives a dead link. Dead and unknown tokens answer identically. A trashed event's link answers as dead, and it works again on restore unless it has expired. A link cannot be created when See guest list is off, or on a private event.

**Sharing.** Levels are `free_busy`, `details`, `edit`, `manage`. `manage` is `edit` plus changing that calendar's shares and default reminders. Only the office manager, the calendar's owner and people with `manage` on it read or change its shares; everyone else answers `403`. `Public holidays` has no shares and nobody can change it. A change applies to the very next request of that person, even in an existing session, and sends a `share.changed` message at once. Replayed messages use the person's access at send time, so a removed share delivers no later change about that calendar.

**Zone rules.** A rule is a `zone`, `effective_date`, `new_offset` (`+HH:MM` or `-HH:MM`) and `note` (1 to 200 characters); rules are never edited or removed. `new_offset` is a whole multiple of 15 minutes from `-12:00` to `+14:00` inclusive, else `422` on `new_offset`. An occurrence carries a warning for a rule when its event's zone matches, the event's last save's date on the server clock, in that zone, is strictly after the effective date, the occurrence is dated on or after that date, its own `shift_minutes` is not 0, and the event has not been moved for that rule. A warned event is one with a warned occurrence. Events last saved on or before the date stay unwarned and unchanged on every surface unless saved again. The warning shows as the grid marker, as the warning region in the quick dialog and on the event page and in `zone_warnings`, at `full` and `guest` access, and as a printed line at `full` access. Only `full` access has Move: a guest gets no such control and the server answers `403`, whatever the guest's switches. All-day events have no clock times, so they never carry a warning, and Move treats them as unwarned.

**What a warned occurrence shows.** A recorded rule is not a daylight change. Ordinary daylight changes are already in the zone's rules, so a 09:00 stays 09:00 through them with no warning. A recorded rule sets the zone's offset to `new_offset` from its effective date, whatever the season. Each occurrence dated on or after that date has its own `shift_minutes`: `new_offset` minus the offset the zone's rules give at that occurrence's saved start, under the latest rule for that zone on or before its date. An occurrence whose `shift_minutes` is 0 has no warning and Move does not touch it. Until someone acts, a warned occurrence keeps its saved instant, and in the rule's zone it shows at its saved clock time plus its own `shift_minutes`. That shown time is what `start_local`, `end_local`, the rule city's entry in `clocks` and the grid give everyone; `start_utc` and `end_utc` stay as saved, so viewers in other zones see no change. Occurrences dated before the effective date never change. An occurrence's `zone_warnings` holds its own warning, or nothing. An event's lists each rule warning any of its occurrences, with `shift_minutes`, `saved_time` and `shown_time` (`HH:MM`) from the first occurrence so warned. Times typed or dragged on a warned occurrence are read as shown clock times. A guest sees the same warnings and the same times, with no action.

**Move.** Move, at `full` access only, applies as This and following from the event's first warned occurrence for that rule: a series with earlier occurrences is split there by the This and following rule. It returns each warned occurrence from there on, modified exceptions on those dates included, to its saved clock time, and takes its own `shift_minutes` off its instant. Occurrences with `shift_minutes` 0 keep their clock time and instant. From then on those occurrences show their saved clock time in the rule's zone, and viewers in other zones see the warned ones moved. The rule is recorded as moved for that event so its warnings clear, and other rules' warnings remain. Move on an event with no warned occurrence for that rule answers `409 not_warned`.

For example, with the seed data, take a rule for Auckland effective 2026-06-01 with new offset `+13:00`. Wellington workshop, saved at 10:00 to 12:00 on Tue 20 Apr 2027, when Auckland's rules give `+12:00`, has `shift_minutes` 60:

| | Auckland viewer | London viewer | `start_utc` | Warning |
|---|---|---|---|---|
| Before Move | 11:00 to 13:00 on Tue 20 Apr 2027 | 23:00 on Mon 19 Apr 2027 | `2027-04-19T22:00:00Z` | `10:00 now shows as 11:00.` |
| After Move | 10:00 to 12:00 on Tue 20 Apr 2027 | 22:00 on Mon 19 Apr 2027 | `2027-04-19T21:00:00Z` | none |

The same rule on a weekly crossing the seasons: Hana's Focus time, saved at 09:00 on Mondays, warns only the weeks whose `shift_minutes` is not 0, from Mon 5 Apr to Mon 20 Sep 2027. Move splits the series at Mon 5 Apr 2027.

| Occurrence | Zone's rules give | `shift_minutes` | Auckland before Move | Warning | `start_utc` before Move | Auckland after Move | `start_utc` after Move |
|---|---|---|---|---|---|---|---|
| Mon 29 Mar 2027 | `+13:00` | 0 | 09:00 | none | `2027-03-28T20:00:00Z` | 09:00 | `2027-03-28T20:00:00Z` |
| Mon 19 Apr 2027 | `+12:00` | 60 | 10:00 | `09:00 now shows as 10:00.` | `2027-04-18T21:00:00Z` | 09:00 | `2027-04-18T20:00:00Z` |
| Mon 6 Dec 2027 | `+13:00` | 0 | 09:00 | none | `2027-12-05T20:00:00Z` | 09:00 | `2027-12-05T20:00:00Z` |

**Trash.** States: `live`, `trashed`, then `restored` or `purged`. An item is purged `TRASH_RETENTION_SECONDS` after being trashed, on the server clock, within 5 seconds of that moment; `days_left` rounds up to whole days. Trashed events leave grid, search, exports, reminders, find a time and prints. Restoring returns the same ids with guests, answers, switches, proposals, exceptions and link, and raises the version. Restoring a restored item answers `409 not_trashed`; restoring or deleting a purged item answers `404`. An occurrence item whose series is still trashed answers `409 parent_trashed`. A restored occurrence returns to whichever series now holds its date. Purging removes the event's data from search, notices, reminders and change-log payloads.

**Reminders.** A calendar's `default_reminders` are whole minutes from 0 to 10080 inclusive, at most 5. A new timed event with no `reminders` given copies its calendar's list then; later changes to the list leave existing events alone. Each entry of a timed event's `reminders` gives each occurrence one reminder per person among the calendar's owner and guests not answering `no`, due that many minutes before that occurrence's start. Each all-day occurrence has one reminder per such person, due at 17:00 the day before in that person's current zone, and its `reminders` is always `[]`. For example, with the seed data, London offsite is due `2027-03-11T17:00:00Z` for Marit Holloway, `2027-03-11T22:00:00Z` for Dara Kessler and `2027-03-11T04:00:00Z` for Tane Whitcombe. A reminder fires once, within one real second of due on the server clock: it writes a notice and sends a live message to that person's screens, also when no page is open, and an open page shows it without a reload. One already past due when created, with the occurrence not yet started (for all-day, its day not over in that person's zone), fires at once. Otherwise past reminders do not fire or list. The device clock plays no part.
- **Snooze.** Only a fired reminder can be snoozed, else `409 not_fired`. Snooze sets it to `snoozed`, due the chosen minutes after the server clock's now, and it fires once more then.
- **Moved.** When an occurrence's time changes by any route, each of its reminders not yet fired, or snoozed, becomes `scheduled` and due by the same rule from the new start. Reminders already fired stay as they are.
- **Deleted.** Trashing cancels its not-yet-fired and snoozed reminders, and they no longer fire. Restoring brings back those still in the future as `scheduled`. A person who answers `no`, or who is removed, loses theirs the same way.

**Find a time.** `people` holds person ids. The people checked are those named plus the caller. Booking a slot never adds the caller as a guest.
- **What blocks a person:** every occurrence of any kind on a calendar they own, and every occurrence where they are a guest answering `yes` or `maybe`. `invited` and `no` answers, trashed events and deleted occurrences block nothing. An all-day occurrence blocks each of its dates from local midnight to local midnight in its zone. A slot and an occurrence clash when their instants intersect, and shared endpoints do not clash.
- **Range:** `from` and `to` are dates in the caller's zone. Slots start every 15 real minutes from midnight at the start of `from`, so skipped local times do not appear and repeated ones appear twice. A slot must end no later than midnight at the end of `to`, and ending exactly then is allowed. The server clock plays no part, so past slots are listed like any other.
- **Which slots appear:** those where no checked person is blocked and, for every checked person, the slot's start and end are both inside their office's hours by the working-hours rules in Interactions and fall on one date in their zone. `clocks` show the slot's start.
- **Order:** earliest start first, keeping the first 20. No titles appear in the response.
- **Busy:** `busy` has one entry per checked person in `people` order, then the caller. Its `blocks` are that person's blocking occurrences' instants, clipped to the range, merged where they touch or overlap, and ordered by start. The response keeps a merged block whole; only the page cuts it at midnight, as the `Busy blocks` row in Public screens and controls sets out.

**Search.** Case-insensitive contains-match on title, location, notes and guest names across events the caller reads at `full`, `guest` or `details`, including the values of modified exceptions. Guest names match only where that caller may read that event's guest list. `q` is measured after trimming outer spaces. Each event gives one result, however many occurrences it has. A single event names itself and its start. A series whose own values match names its next undeleted occurrence at or after the server clock's now, or its last undeleted occurrence when none remain. A series that matches only through modified exceptions names the earliest such exception. Results are ordered by the named occurrence's instant, earliest first, then by event id, keeping the first 50. An all-day occurrence's instant is local midnight in its zone.

**Prints.** State: `pending`, `rendered`, then `stored` or `failed`. Creation fixes the job's one object key.
- An attempt starts on creation and on Retry, running in the background. It calls the document service and, on a PDF, moves to `rendered`, then writes to storage and confirms by reading the object's size back. Only then is it `stored`.
- An unreachable document service leaves `pending` with `waiting_on: document_service`. Unreachable storage leaves `rendered` with `waiting_on: file_storage`. A reply from either service with an error status moves to `failed`.
- The server makes one attempt each time and never gives up the job. Retry is legal from `pending`, `rendered` and `failed`, and concurrent Retries share one attempt and answer `202` with the current state. Retry on `stored` writes nothing.
- `Idempotency-Key` replays per person: same key and same body returns the original job; same key and a different body answers `409 idempotency_conflict`.
- `calendars` defaults to every calendar the office manager can read.
- A print uses the zone and access of the office manager who requested it, as they stand when each attempt renders. The week runs from Monday midnight to the next Monday midnight in that zone. A timed occurrence prints once, under the date its start falls on in that zone, if that date is in the week. An all-day occurrence prints under each of its own dates that falls in the week. For example, with the seed data at start, Wellington workshop prints under `Mon 19 Apr 2027` for Marit Holloway.

**Duplicate and move.** Duplicate creates a new event on the same calendar, or on the caller's own when they cannot edit it, with the same values and rule, the title `<title> copy`, the current guest defaults, and no guests, answers, exceptions, proposals or shared link. Moving to another calendar keeps the same event id, guests, answers, exceptions and shared link, needs edit access to both calendars, and raises the version. Every open screen updates by access: the event leaves or appears within a second.

**Public holidays.** `cal-holidays`, named `Public holidays`, is readable by every person with level `read_only`, starts off on every screen and is switched on by its checkbox, which goes in `calendars` in the address. Every change to it answers `403`, its events show no edit, delete, duplicate or drag, and it is left out of busy blocks, reminders and find a time.

**iCalendar.** An export has one `VEVENT` per event with `UID` the event id, `DTSTART;TZID` and `DTEND;TZID` (or `VALUE=DATE` with an exclusive end for all-day), `SUMMARY`, `LOCATION`, `DESCRIPTION`, `RRULE`, `CLASS:PRIVATE` for private events, one `EXDATE;TZID` for each deleted occurrence and one further `VEVENT` with `RECURRENCE-ID;TZID` for each modified occurrence. Kind travels as `X-WREN-KIND`. It never has an `ATTENDEE` or anything about guests. Trashed events are left out. Importing the file into an empty calendar gives occurrences equal to the original in title, location, notes, zone, local start and end, UTC instants and exception status. Importing into a calendar that already holds that `UID` from an earlier import or export replaces that event, so nothing doubles. Imported events have no guests. Unsupported rules are listed in `skipped`.

**Live changes.** Every committed change appends one row to a change log with an increasing `seq`. `/api/live?after=<seq>` first sends each later row the person may see, in order, then live rows. A message is `{"seq":<n>,"type":"<type>","data":{...}}`, with `data` projected for that person at send time by the same field rules. Types: `event.changed`, `event.deleted`, `reply.changed`, `proposal.changed`, `decision`, `share.changed`, `zone_rule.recorded`, `reminder.fired`, `print.changed`. A page opens exactly one connection, sends nothing before it opens, reconnects within five seconds of a drop with its last `seq`, and reaches the current state with no reload. Open screens show the change within a second of the commit.

### Services (DP-47 to DP-52)

**Postgres** holds people, sessions, events, series, exceptions, trash, guests and replies, proposals, settings, zone rules, reminders, notices, print jobs and the change log. All state lives there so a restart loses nothing. The schema and seed apply idempotently on every serve.

**Gotenberg** renders the printed week. The server posts an HTML page to `$GOTENBERG_URL/forms/chromium/convert/html`. The PDF's text contains `Sundial & Wren`, `Week of <date>` for the Monday, each day of the week as `<date>`, and for each readable occurrence its title and its time as `<time> New York`, `<time> London`, `<time> Auckland`, or `All day`. A warned event adds a line with `Zone rule warning`. Private events below `full` print `Busy`. It carries no guest names. When Gotenberg is unreachable, the print stays `pending` as in Business rules and the API still answers `202`.

**MinIO** holds, in `$S3_BUCKET`:
- `prints/<print id>.pdf` with type `application/pdf`
- `exports/<export id>.ics` and `imports/<import id>.ics` with type `text/calendar`

The browser never talks to MinIO; downloads go through the app. While MinIO is unreachable, an export or import answers the `503` from API and changes nothing, and a print stays `rendered` as in Business rules. An import creates events only after the file is stored and confirmed.

No email is sent by anything.

### Seed data (DP-54)

Every seeded person, firm and client is invented. The seed loads once into an empty database. Every person's passcode is `wren-seed-2027`. Email is `<first name in lowercase>@sundialwren.example`. Person id is `p-<first name in lowercase>`, and each has a calendar `cal-<first name in lowercase>` named after them, except the outside guests, who have none.

| Person | Office | Role |
|---|---|---|
| Marit Holloway | London | `office_manager` |
| Ines Okafor, Edith Sarr, Rafe Moncrieff, Yuki Tamblyn | London | `member` |
| Dara Kessler, Joss Abernathy, Priya Venn, Callum Reyes, Noor Lindqvist | New York | `member` |
| Tane Whitcombe, Hana Rewiti, Oren Castell, Lia Fenwick | Auckland | `member` |
| Sam Aldous | New York | `guest` |
| Bea Marchetti | London | `guest` |

Also `cal-firm`, named `Firm calendar`, owned by Marit Holloway, and the read-only `cal-holidays`, named `Public holidays`, owned by nobody. Every calendar's `default_reminders` starts empty.

**Office hours:** every office 09:00 to 17:30, Monday to Friday. **Guest defaults:** Modify event off, Invite others off, See guest list off.

**Shares:** `cal-firm`: all 13 other staff `details`. `cal-dara`: Marit `details`, Ines `edit`, Joss `free_busy`, Priya `manage`. `cal-ines`: Marit `details`, Dara `edit`. `cal-tane`: Hana `details`, Ines `free_busy`. `cal-oren` and `cal-lia`: Marit `edit`.

**Events** (ids as given). `Modify`, `Invite` and `List` are the guest switches, with off when not named:

| Id | Title | Calendar | When and zone | Saved | Guests and notes |
|---|---|---|---|---|---|
| `evt-partners-weekly` | Partners' weekly | `cal-dara` | Tuesdays 09:00 to 10:00 New York, `FREQ=WEEKLY;BYDAY=TU` from 2026-09-01, no end | 2026-08-20 | List on. Ines series `yes`, Tane series `maybe`, Marit `invited`. Exceptions: 23 Mar 2027 at 10:00 to 11:00; 13 Apr 2027 deleted. Tane `no` for 16 Mar 2027 with the out-of-office message. |
| `evt-client-readout` | Client readout | `cal-dara` | Tue 6 Oct 2026 11:30 to 12:30 New York | 2026-08-20 | None. |
| `evt-board-review` | Northgate board review | `cal-ines` | Wed 10 Mar 2027 15:00 to 16:00 London | 2026-08-20 | All switches off. Guests Sam, Bea, Hana. Location `Northgate House`. |
| `evt-harbour-kickoff` | Harbour kickoff | `cal-tane` | Thu 11 Mar 2027 10:00 to 11:00 Auckland | 2026-08-20 | Modify and List on. Guests Sam, Oren. Shared link token `seed-harbour-link`. |
| `evt-pay-talk` | Partner pay talk | `cal-dara` | Thu 11 Mar 2027 14:00 to 14:30 New York | 2026-08-20 | Private. Notes `Confidential`. |
| `evt-sunday-check` | Sunday markets check | `cal-joss` | Sundays 02:30 to 03:00 New York, `FREQ=WEEKLY;COUNT=4` from 2027-03-07 | 2026-08-20 | None. |
| `evt-month-end` | Month-end close | `cal-marit` | 16:00 to 17:00 London, `FREQ=MONTHLY` from 2027-01-31 | 2026-08-20 | None. |
| `evt-founders-day` | Founders' day | `cal-firm` | All day, `FREQ=YEARLY` from 2028-02-29, London | 2026-08-20 | None. |
| `evt-london-offsite` | London offsite | `cal-firm` | All day Fri 12 Mar 2027, London | 2026-08-20 | Guests Dara, Tane, Ines. |
| `evt-tane-away` | Out of office | `cal-tane` | All day Mon 15 Mar to Fri 19 Mar 2027, Auckland, kind out of office | 2026-08-20 | None. |
| `evt-hana-focus` | Focus time | `cal-hana` | Mondays 09:00 to 12:00 Auckland, `FREQ=WEEKLY` from 2027-03-01, kind focus, `decline_mode` `new_and_existing` | 2026-08-20 | None. |
| `evt-wellington-workshop` | Wellington workshop | `cal-oren` | Tue 20 Apr 2027 10:00 to 12:00 Auckland | 2026-08-01 | None. |
| `evt-queen-street` | Queen Street review | `cal-lia` | Wed 21 Apr 2027 10:00 to 11:00 Auckland | 2026-03-01 | None. |
| `hol-christmas` | Christmas Day | `cal-holidays` | All day Fri 25 Dec 2026, London | 2026-08-20 | None. |
| `hol-new-year` | New Year's Day | `cal-holidays` | All day Fri 1 Jan 2027, London | 2026-08-20 | None. |
| `hol-good-friday` | Good Friday | `cal-holidays` | All day Fri 26 Mar 2027, London | 2026-08-20 | None. |

For example, with the seed data at start, Partners' weekly reads:

| Occurrence | New York | London | Auckland |
|---|---|---|---|
| Tue 6 Oct 2026 | 09:00 | 14:00 | 02:00 next day |
| Tue 9 Mar 2027 | 09:00 | 14:00 | 03:00 next day |
| Tue 16 Mar 2027 | 09:00 | 13:00 | 02:00 next day |
| Tue 30 Mar 2027 | 09:00 | 14:00 | 02:00 next day |
| Tue 6 Apr 2027 | 09:00 | 14:00 | 01:00 next day |

Also with the seed data, a zone rule for Auckland effective 2026-06-01 warns Wellington workshop and Hana's Focus time from Mon 5 Apr 2027, and not Harbour kickoff, whose `shift_minutes` is 0, Queen Street review, which was last saved before that date, or the all-day Out of office event. Trash, notices, prints and zone rules start empty.

## Technical requirements

### Deployment (DP-55)

Backend: Go 1.27. Frontend: TypeScript built with Node 22 in the same `build` step and served by the Go server.

`go.sum` and the npm lockfile are committed. No system library beyond build-essential is installed, so talk plain HTTP to the services. No browser-side WASM.

`/app/run.json` holds string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"go mod download && npm ci","build":"npm run build && go build -o bin/server .","serve":"./bin/server"}
```

Bind `0.0.0.0` on port 4173, honouring `APP_PUBLIC_PORT` when set. `GET /api/health` follows the API table.

### Configuration and secrets (DP-05, DP-36, DP-46, DP-53, DP-60)

Read at start; never hard-code them or send them to the browser: `DATABASE_URL`; `GOTENBERG_URL`; `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. The bucket already exists.

Rehearsal and retention settings, each optional:
- `TRASH_RETENTION_SECONDS`: trash retention, default 2592000, which is 30 days.
- `SHARE_LINK_TTL_SECONDS`: shared link lifetime, default 2592000.
- `CLOCK_START`: an RFC 3339 instant. When set, the server clock starts there at boot and runs forward.
- `CLOCK_RATE`: server seconds per real second, default 1; 3600 means one server hour per real second.

Every server time rule, `/api/time`, the now line and every default date read this one server clock.

### Server boundary (DP-05, DP-33, DP-50, DP-55)

- Same origin only: no cross-origin access headers, no third-party scripts or fonts. Sora is bundled and served by the app.
- The browser only talks to the app; never to Postgres, Gotenberg or MinIO.
- The server never serves source files, the run manifest, environment values or credentials. Request size limits are in API.
- A service down at boot does not stop the app. It starts with Gotenberg or MinIO unreachable, tries each again per attempt with no cached failure, and recovers when the service returns, without a restart. If Postgres is unreachable at boot, it keeps serving the `503` health answer, retries every second, and applies schema and seed once connected.
- Sessions end only on sign-out and hold no copy of access: role and share levels are read on every request.

### Browser support and performance (DP-20, DP-25)

Current Chromium, Firefox and WebKit, at 375x812, 768x1024 and 1280x800, with touch at the first two. The calendar is usable within three seconds of navigation with the seed data. Remote changes appear within one second.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package and bundled font with its licence. Shipped packages means the production dependency tree: for Go, the modules the program imports; for npm, `npm ls --omit=dev --all --json`.
- IF-03: Shipped packages use only MIT, BSD, Apache-2.0, ISC or MPL-2.0 licences, and the bundled Sora font uses the SIL Open Font License.
- IF-04: The only datastores are Postgres and MinIO; no embedded database, local file store or extra cache holds product state.
- IF-05: `go.sum` and the npm lockfile are committed.
- IF-06: No service credential or address appears in committed source; each is read from its named environment variable.
- IF-07: No shipped page loads any script, style or font from another origin.

## Engineering standards

- The Go and TypeScript are idiomatic for each language, formatted by `gofmt` and with TypeScript strict mode on.
- Names match this brief's domain terms: occurrence, exception, series, guest, reply, proposal, share level, zone rule, trash item, print.
- Each domain rule, including occurrence generation, gap handling, access level, field projection, reply transitions, proposal transitions, trash transitions and print transitions, is decided in exactly one place in the source.
- No abstraction has a single implementation unless a test double requires it.
- No dead, commented-out or unreachable code, and no defensive checks for impossible states.
- Every API error uses the one published error shape.
- No feature exists beyond this brief.
