# Plumb & Pencil Snaglight

Snaglight is a punch-list and job-notes workspace for small residential remodeling firms: two-to-twelve-person kitchen, bath and whole-home renovation companies. Each house gets one job. The firm shares that job's checklist, notes, floor plan, site-visit schedule and punch-list costs with its trade subcontractors and, where it is safe, with the homeowners.

Every punch item is pinned to a room on the floor plan. The plan can be revised without losing pins. Several people can edit the same note at once without overwriting each other. The list keeps working when the phone has no signal, every open device stays in step through a live event stream, and the house access codes are the most tightly guarded data in the workspace.

Build it as one TypeScript web app with its own server. It uses three services:
- Postgres keeps every record.
- An S3-compatible object store (MinIO) holds every floor-plan revision and every photo.
- An SMTP server (Mailpit) carries email.

The following are out of scope:
- self sign-up and firm creation (the firm and its owner are seeded)
- billing and invoicing
- push or text-message notifications
- native apps
- lockbox or smart-lock hardware
- drawing tools beyond rectilinear room outlines entered as corner lists
- file import or export
- any datastore other than those three services

## Problem and users

A small remodeler closes every job with a punch list: dozens of small fixes spread across rooms, each owned by a different trade, and the homeowner adds more with every walkthrough. Most firms run this in a group text, a shared notes app or a spreadsheet. The same notes also hold the lockbox code, the alarm code, the garage keypad code and where the dog is kept. As a result, every electrician, tiler and painter who was ever on the thread keeps a family's codes long after their work is done. Lockbox practice says a code should go only to an authorized person for an authorized visit, but the notes apps contractors use cannot limit a field to one trade or one visit.

Other problems pile up on top of that:
- Basements and gutted houses often have no signal, so lead carpenters lose edits or create duplicates when they reconnect.
- When two people type into the same note, one overwrites the other.
- When the plan is revised mid-job, every pin ends up in the wrong place.
- Weekly trade days are retyped week by week and drift an hour at the clock change.
- Costs and change orders live in yet another spreadsheet.

The remodeler pays for all of this in three ways:
- callbacks when an item is lost
- a held-back final payment when the homeowner cannot see progress
- liability when a code leaks

The users:
- **Remodeler owner** (daily): sets up a job from a floor-plan image with its real room shapes and revises the plan without losing pins. Adds the lead carpenter, trades and homeowner. Schedules one-off and recurring trade site visits within working hours. Keeps the access card, punch-list costs and change orders. Removes duplicate items, and closes the punch list so the final payment is released.
- **Lead carpenter** (daily): walks each room with a phone, often with no signal. Adds items and pins them to the plan, attaches defect photos and edits shared notes. Links items that wait on each other, assigns trades, checks off whole rooms at once, and verifies or sends back finished work.
- **Trade subcontractor** (weekly): sees only the items assigned to their trade. Sees the house access codes only around their scheduled site visits, and marks items done with a completion photo.
- **Homeowner** (weekly): adds items they notice and follows progress room by room as it happens. Reads a daily walkthrough summary by email that lists tomorrow's site visits. Never sees crew-only notes, costs or the access codes.

## Journeys

1. **Set up a job.**
   - The owner signs in and sees exactly the seeded jobs.
   - They create a job with its name, address and time zone. It opens with no rooms, no plan and `0% verified`.
   - They upload a floor-plan image, add an L-shaped kitchen and a rectangular bath by typing their corners, and add a lead carpenter, two trades and a homeowner.
   - A third room that would overlap the kitchen is refused with the overlap message.
   - The homeowner signs in with the initial password the owner gave them and sees only that job. Opening another family's job shows the not-found page.
2. **Walk a room by keyboard.**
   - The lead carpenter opens a job with rooms and works without a mouse.
   - They quick-add an item to a room and press P. A crosshair appears at the room's anchor point. They move it with the arrow keys and press Enter.
   - They choose a trade in the item details and check off a crew item.
   - They move a verified item's pin into the next room. The row moves to that room's group under the same number, and both rooms' counts change in the headings and on the plan labels. The owner, watching the same job on a laptop, sees each change appear within two seconds.
3. **Walk a basement offline.**
   - The lead carpenter's phone loses signal and the offline banner appears.
   - They add two items, edit a title, move a pin, check off a crew item, and check off a trade item that is still waiting on its completion photo. Each row shows the pending-sync mark.
   - Meanwhile the owner changes the same title and pin online, and deletes another item the lead had edited.
   - When the phone reconnects, the Activity region announces the sync counts and the removed row.
   - The crew item stays verified. The trade item reverts with its reason. The deleted item's row disappears.
   - The edited title appears under the conflict heading with both titles. The phone's pin is kept, with the owner's pin offered as the alternative.
   - Syncing again creates no duplicates.
4. **A trade's visit day.**
   - The owner schedules the electrician for a visit that starts in 20 minutes and ends within working hours. A second visit that overlaps it is refused, and so is an evening slot past 19:00.
   - The owner gives the electrician an item, and the electrician's inbox gets exactly one code-free assignment notice.
   - The electrician signs in and sees only electrical items. Under House access they reveal the lockbox, alarm and garage codes, along with the time the codes stay visible until.
   - They upload a completion photo, which shows `Photo uploading` until it is stored, and mark the item done.
   - The lead carpenter verifies it. The owner's reveal log lists the electrician's reveal.
5. **The homeowner follows along.**
   - The homeowner opens their job on a phone and adds an item they noticed in the hall.
   - They see each room's verified count and the empty-room copy for the laundry room. They select a row to see its pin; while the plan sheet is closed, no pin can be reached.
   - They see notes meant for everyone, but no crew notes and no costs.
   - After the daily summary time they receive a code-free summary. It lists each changed item once with its current status, lists the deleted item as removed, lists tomorrow's site visits, and its counts match the screen.
6. **Offboard a trade after a lost phone.**
   - The owner ends the tiler's role while the tiler has the job open in a tab. The tiler's tab clears the codes and shows the role-ended message, and every request the tiler makes to the job is refused.
   - The owner's phone, with the job open, is lost, so the owner changes their password on the laptop. The lost phone's session is signed out and its live stream closes, while the laptop stays signed in.
7. **Close out.**
   - The owner deletes a duplicate item that has a defect photo. Its photo is gone from the object store, its old photo link answers not found, and the next new item gets a new number.
   - The owner starts the walkthrough, the remaining items are verified, and the owner closes out the job.
   - The job shows as closed out and read-only. Every plan revision and every photo is deleted from the object store, and the job refuses further changes.
8. **Document a defect.**
   - The lead carpenter selects an item and attaches a defect photo taken on a phone, with location data. The row shows `Photo uploading`, then the photo appears under the item.
   - The stored copy carries no location data, and the homeowner sees the same photo on that item.
   - When the object store is unreachable, the upload fails with the storage outage copy and leaves no photo behind.
9. **Edit a note together.**
   - The lead carpenter, offline in the basement, adds to the crew note on an item. At the same time the owner edits that note online.
   - When the phone reconnects, both screens show the same merged note, built by the published character rule.
   - The lead carpenter's Undo removes only their own words and leaves the owner's in place. The owner's Undo then removes only the owner's.
   - The note's history lists every revision.
10. **Book a recurring visit.**
    - The owner books the electrician every weekday morning for two weeks, across a clock change. The schedule lists every occurrence at the same local time.
    - The electrician opens House access during today's occurrence. The phone's own clock is hours off, yet the codes and their visible-until time follow the server.
    - The owner cancels tomorrow's occurrence. The electrician's next visit skips it, and the homeowner's summary does not list it.
11. **Revise the plan.**
    - The kitchen wall moves, and the owner uploads plan revision 2 with three reference point pairs and the rooms' new corners.
    - Pins follow the new drawing. One pin that now falls in the kitchen notch is flagged `Pin needs review`.
    - The lead carpenter's phone had a pin move queued from revision 1. When it syncs, the move is mapped onto the new drawing and applies with no conflict.
    - Counts, plan labels and the cost by room follow the re-filed items.
12. **Review costs.**
    - The owner enters quantities and unit costs on several items. Line totals round to the cent by the published rule.
    - The lead carpenter's offline change to the same unit cost waits under the conflict heading.
    - The owner approves a change order and raises the contingency. The Costs tab, open on another screen, updates in place.
    - Asking for the totals as of an earlier moment reproduces the earlier total.
13. **Bulk-check a room.**
    - The lead carpenter filters the list to the kitchen's open items and assigns all shown items to Tile in one action. The tiler gets exactly one notice per item.
    - A bulk check-off that includes an item still waiting on another shows the nothing-changed alert, and no item changes.
    - The owner reopens a verified blocker. Its dependents return to open everywhere.
14. **Two devices stay in step.**
    - The owner and the homeowner both have the job open. The owner moves a pin into another room, and within two seconds the homeowner's row moves group and both count texts change.
    - The homeowner's phone loses its connection while the owner deletes an item and edits a note. When it reconnects, its list equals a fresh load.
    - Meanwhile the lead carpenter's half-typed note survives every incoming update.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Sign in** Members sign in with email and password, receive a session cookie and see their name from the account endpoint, and a wrong pair is refused with the published message.
- **DP-02 — Jobs** The remodeler owner creates a job with a name, address and time zone that starts with no rooms, no plan and 0% verified, and each member lists and opens only the jobs where they hold an active role.
- **DP-03 — Floor plan and rooms** The owner uploads a floor-plan image that is stored in the object store as plan revision 1 and served same-origin, and adds named rectilinear room outlines of 4 to 12 corners that never overlap, each with a server-computed bounding box and anchor, as qualified in Business rules.
- **DP-04 — People on a job** The owner adds a lead carpenter, trade subcontractors with their trade, and homeowners to a job, creating an account with an initial password when the email is new.
- **DP-05 — Job and record scoping** A job, item, photo, room, member, visit, note, change order or plan revision id the caller cannot see answers the same 404 as a missing one, whether it is in the URL or inside a request body, as qualified in API.
- **DP-06 — Owner sets up a job** The owner starts from exactly the seeded firm, creates an empty job, uploads a plan, adds an L-shaped and a rectangular room and people, and the new homeowner signs in to see that job and none of another family's.
- **DP-07 — Punch items and quick add** The owner, lead carpenter and homeowner add items to a room with a consecutive job-wide number that is never reused, and the owner and lead carpenter edit title, room, trade, cost note, quantity and unit cost, with the validation in API.
- **DP-08 — Plan-relative pins** Each item's pin is stored as x and y between 0 and 1 of the plan image and decides the item's room by the published inside and shared-edge rules, a pin moved across a boundary re-files the item with its number kept, a pin outside every room is refused with the published message, and a pin shows at the same plan-relative spot after a reload, on another device and at every published viewport.
- **DP-09 — Keyboard pin placement** Pressing P on a focused row or on any control inside it starts placement at the room's anchor, the arrow keys move the crosshair in the published steps, Enter drops the pin and Escape cancels with focus back on the row.
- **DP-10 — Touch pin placement on a phone** On a phone-width screen the lead carpenter opens the plan sheet from an item, taps the plan to move the crosshair and drops the pin with a button, with the same stored result as by keyboard.
- **DP-11 — Lead pins and checks off by keyboard** Using only the keyboard, the lead carpenter quick-adds an item, pins it in its room, assigns a trade, checks off a crew item and moves a pin into another room, and each step is visible in the list and on the plan.
- **DP-12 — Room tether on selection** Selecting a row by click, tap or Enter highlights it, frames the pin's room in the plan pane, draws a blueprint-blue line from the row to its pin and pulses the pin once, in the order and timing given in Motion and effects.
- **DP-13 — Reduced-motion tether** With reduced motion on, selecting a row draws no line and runs no pan or pulse; the plan jumps straight to the room, the pin gets a static orange ring and the row shows the published pinned-in text.
- **DP-14 — Pins and rows find each other** A trade or homeowner selects a row to see its pin and room or activates a pin to select and scroll to its row, and verified items show as check-mark pins in the done green.
- **DP-15 — Offline banner and queue** When the device loses connection the published offline banner shows. Items, edits, actions and notes made offline appear at once with the pending mark and survive a reload until they sync.
- **DP-16 — Sync operation log** Queued offline operations sync through one endpoint that runs them in ascending client sequence whatever their array order, maps pins stamped with an older plan revision through every later revision, rejects operations that depend on a rejected creation or target a deleted item as not found, reports each outcome, and treats replays as specified in API.
- **DP-17 — Field-by-field merge** On sync each changed field merges on its own by the published policy, where title, cost note, quantity, unit cost, trade and room keep the server value and record a conflict, a phone pin wins and re-files the item while the replaced pin is recorded as a conflict, and an online edit or a resolution clears that field's conflict.
- **DP-18 — Sync announcement** When queued edits finish syncing, the Activity live region announces the published sync sentence with the counts the server reported.
- **DP-19 — Lead resolves a sync conflict** The lead carpenter edits an item's title and pin offline while the owner changes the same fields online, and on reconnect both fields are listed under the published conflict heading with both values, with the phone's pin in place, and choosing a value clears that conflict for everyone.
- **DP-20 — Item lifecycle and deletion** Items move from open to in progress to ready for check to verified, with send-back and an owner-only reopen, the owner or the creating lead carpenter deletes items as permitted in Business rules, and each illegal step, including a trade change on finished work, is refused with the code given there.
- **DP-21 — Honest offline check-off** An item checked off offline shows as done with the pending mark, and if the server rejects the action the row returns to the server's status with the published not-saved text, or disappears with the published removal text when the item was deleted meanwhile.
- **DP-22 — Lead walks a room offline** The lead carpenter goes offline, adds and checks off items and reconnects. Accepted changes settle, rejected ones revert, and a second sync creates no duplicate items.
- **DP-23 — Photo upload rules** Plan images and defect and completion photos are accepted only as JPEG, PNG or WebP, judged by their content, and only up to the published byte limit, and the stored copy carries no embedded metadata and so no location.
- **DP-24 — Storage-confirmed photos** A photo appears on an item only after the object store confirms it, the row shows the uploading text until then, a storage outage leaves no photo behind, and removing a photo or deleting its item deletes the stored object first and leaves everything in place when that fails.
- **DP-25 — Lead documents a defect** The lead carpenter selects an item, attaches a defect photo, sees it under the item after the upload, and the homeowner sees the same photo on that item.
- **DP-26 — Role-scoped responses** Job, item, note, member and event responses return only the fields published for the caller's role, so trades and homeowners never receive cost notes, quantities, unit costs, line totals, notes outside their audience or other trades' contact details.
- **DP-27 — Notes threads** Members post notes with an audience on items they can see and reply one level deep, homeowners see only notes for everyone, and each note carries a revision number that every applied edit, undo and redo raises by one.
- **DP-28 — Sub finishes, lead verifies or sends back** The trade marks an assigned item done with a completion photo, the lead carpenter sends it back with a reason or verifies it, and both sides see the new status.
- **DP-29 — Access card and reveal log** The owner keeps the lockbox, alarm and garage codes and a house note on one access card. The owner and lead carpenter can always read it, the homeowner never can, and every read is recorded in a log that only the owner sees.
- **DP-30 — Site visits and the code window** Every site visit occurrence falls between 07:00 and 19:00 on one job-local date, the first ends in the future, none overlaps another occurrence of the same person, each converts to UTC with its own date's offset, and a trade reads the access card only during the code window around one of their occurrences, as qualified in Business rules.
- **DP-31 — Sub opens house access on visit day** The owner schedules a trade's visit starting soon within working hours, and the trade opens the job, shows the codes with the time they stay visible until, and sees them disappear once the visit ends.
- **DP-32 — Ending a role** When the owner ends a member's role on a job, that member's next request to the job is refused with the role-ended response, their open event streams end with the role-ended event, and their open tab clears the codes and shows the role-ended message within the delay in Interactions.
- **DP-33 — Password change ends other sessions** Changing a password ends every other session of that account and its open event streams at once, while the session that made the change stays signed in.
- **DP-34 — Owner offboards a sub after a lost phone** The owner ends a trade's role and changes their own password, after which the sub's open tab and the owner's other session both lose access.
- **DP-35 — Assignment notice** Each applied change that gives an item a different non-null trade, each item of a successful bulk assignment included, queues exactly one code-free email to each active member of that trade, carrying the item, its room and a sign-in link, while replays, conflicts, rejections, failed bulk actions and same-trade edits queue none, as qualified in Business rules.
- **DP-36 — Mail outbox** Every email goes through an outbox the owner can read, which shows the not-sent label while mail is unreachable and sends each message exactly once when mail returns, even with several server processes.
- **DP-37 — Owner assigns trades and watches the outbox** The owner assigns and reassigns items to trades while the lead carpenter's offline batch replays, and sees exactly one notice per applied change in the outbox and in the trades' inboxes.
- **DP-38 — Daily walkthrough summary** Each homeowner receives at most one code-free, amount-free summary per job-local day at or after the daily summary time, listing each item changed since the previous cut-off once with its state at the cut-off or as removed, and tomorrow's expanded site visits, as qualified in Business rules.
- **DP-39 — One set of counts** Room counts and job progress come from one calculation and agree in the list headings, the plan room labels, the API, the event stream and the summary email after every transition, cascade, re-filing, plan revision, deletion, bulk action and sync.
- **DP-40 — Homeowner follows progress** The homeowner adds an item they noticed, sees room-by-room progress that follows re-filed and deleted items, sees the published empty-room copy, and never sees crew notes or costs.
- **DP-41 — Job stages and close-out** A job moves from active to walkthrough to closed out, close-out requires every item to be verified and deletes every plan revision and photo object before their records, and a closed job refuses changes.
- **DP-42 — Owner closes out a job** The owner deletes a duplicate item, starts the walkthrough, verifies the remaining items and closes out the job, then sees it read-only with every plan revision and photo gone.
- **DP-43 — Run manifest and health** The app installs, builds and serves from the run manifest on the published port and answers the health check.
- **DP-44 — Server boundary** The server accepts only same-origin requests within the published size limits, serves only built assets, and starts even when storage or mail is unreachable.
- **DP-45 — Published copy** Every string the brief prints in backticks renders, and is announced, character for character.
- **DP-46 — Breakpoint layouts** The job view switches between list beside plan, list with a collapsible plan rail, and list with a plan bottom sheet exactly at the breakpoints in Screens and layout, with no horizontal scrolling, and a collapsed rail or closed sheet exposes no plan control.
- **DP-47 — Dialogs and keyboard** Every action works by keyboard, focus stays inside an open dialog or sheet, Escape closes it and focus returns to the control that opened it.
- **DP-48 — Motion and loops** Every motion in the product is one named in Motion and effects and runs at its stated timing, nothing loops, and reduced motion shows each end state at once.
- **DP-49 — Drafting-table look** The job view reads as a drafting table, with a warm paper ground, graphite text, hairline rules, thin blueprint room outlines on a faint grid, condensed capital room headings and tabular numerals, and no gradients or shadows.
- **DP-50 — Real services and configuration** Every record, object and email goes through the real Postgres, object store and mail server, using credentials read from the environment, with no stand-in state.
- **DP-51 — Note edits converge** Note edits name code-point positions in the text of a base revision and merge by the published character model, so simultaneous edits from any device converge to the body that model gives.
- **DP-52 — Personal undo and redo** Undo and redo change only the caller's own note edits, hiding or restoring their characters in place around other people's later text, and the note's history lists every revision with its body.
- **DP-53 — Lead and owner edit a note together** The lead carpenter edits a crew note offline while the owner edits it online, and after the sync both see the published merged body, each person's undo removes only their own text, and a replay changes nothing.
- **DP-54 — Recurring visit series** The owner or lead carpenter schedules a daily, weekly or every-N-days visit series of at most 60 occurrences within 180 days, refused before any occurrence is expanded or stored when larger, whose occurrences keep their wall-clock times with each date's own UTC offset.
- **DP-55 — Occurrence exceptions and overlap** Single occurrences are moved or cancelled, overlap is judged across every non-cancelled occurrence of the person with the earliest clashing date reported, and the code window, next visit and summary use the expanded occurrences.
- **DP-56 — Owner books a recurring visit** The owner books a daily series for the electrician, who reveals the codes during today's occurrence with the server's visible-until time even when the phone's clock is wrong, and a cancelled occurrence drops out of the next visit.
- **DP-57 — Plan revisions** The owner uploads a plan revision with three reference point pairs and every room's new outline, earlier revisions stay listed and readable, and a storage outage changes nothing.
- **DP-58 — Pin transform and review flags** Every pin is mapped through the published affine transform with rounding and re-filed by the new outlines or flagged as needing review, and queued phone pins from an older revision are mapped through every later transform before they merge.
- **DP-59 — Owner revises the plan** The owner uploads a revision while the lead carpenter has a pin move queued offline, and after the sync the mapped pin applies without a conflict, a pin mapped outside every room is refused with the published text, and the room counts, plan labels and cost by room follow.
- **DP-60 — Item costs** The owner and lead carpenter record each item's quantity and unit cost as exact decimal strings, and its line total is quantity times unit cost rounded half to even to cents.
- **DP-61 — Cost rollups and change orders** The costs endpoint totals items by room and by trade and adds the change orders approved by the requested moment and one contingency on the job total at the percent in effect then.
- **DP-62 — Owner reviews costs** The owner sets item costs, approves a change order and raises the contingency while the Costs tab updates in place, a lead carpenter's conflicting offline cost edit waits under the conflict heading, and an earlier moment reproduces the earlier total.
- **DP-63 — Blocked-by links** Items wait on up to 10 other items without ever forming a cycle, an item cannot be marked done or verified while a blocker is unverified, and reopening an item reopens every transitive dependent that was ready for check or verified.
- **DP-64 — All-or-nothing bulk actions** Bulk start, mark done, verify and trade assignment evaluate the selected items in ascending number, commit all or nothing, report every failure, and queue no email and emit no event when they fail.
- **DP-65 — Lead bulk-checks a room** The lead carpenter filters the list and assigns or checks off the shown items in one action, a selection with a blocked item shows the nothing-changed alert with nothing changed, and a reopened blocker returns its dependents to open everywhere.
- **DP-66 — Job event stream** Each job serves a live event stream whose events carry per-job sequence numbers in commit order and are projected for each caller's role and scope, with nothing emitted for replays, rejections or failed bulk actions.
- **DP-67 — Resume and every-process delivery** A client that reconnects with its last sequence number receives exactly the missed in-scope events in order or the published reset, and events reach open streams on every server process sharing the database within 2 seconds.
- **DP-68 — Two devices stay in step** The owner's changes appear in place on the homeowner's open job within 2 seconds, a device that reconnects catches up to what a fresh load shows, and an open note editor keeps its draft through incoming events.

## Frontend

### Screens and layout (DP-02, DP-03, DP-04, DP-29, DP-36, DP-46, DP-57, DP-61, DP-63)

All screens share a top bar. It holds the product name on the left, a `link "Your jobs"`, a `link "Account"` and a `button "Sign out"`. While offline, the offline banner sits directly below the top bar on every screen. No screen scrolls horizontally at 375x812, 768x1024 or 1280x800.

- **Sign in** (`/signin`). A single centred column with the heading `Sign in`, the email and password fields and the sign-in button. After a session ends, this screen also shows the signed-out copy from Feedback states.
- **Your jobs** (`/jobs`). The heading `Your jobs` and one row per job, showing:
  - the job name as a link
  - the stage label (`Active`, `Walkthrough` or `Closed out`)
  - the job progress text

  The owner also sees `button "New job"`. With no jobs, the row area shows the empty-jobs copy.
- **Job view** (`/jobs/<job id>`, and `/jobs/<job id>/items/<item id>`, which opens with that item selected). The header holds:
  - the job name as the level-1 heading
  - the stage label and the job progress text
  - for the owner and lead carpenter, the review count text when any pin needs review
  - for the owner, the stage buttons
  - a tab list

  The tabs are:
  - **Punch list**: everyone.
  - **Setup**: owner. It holds the plan upload, `button "Upload revision"`, a table of plan revisions and the room list with `button "Add room"`.
  - **People & visits**: owner and lead carpenter. It holds a table of people and a table of site visits with one row per occurrence. The owner sees every control. The lead carpenter sees the visit controls (schedule, move, cancel, delete), matching the visits API, but not Add person or End role.
  - **Costs**: owner and lead carpenter. It holds the cost by room and cost by trade tables, the totals lines, the change orders table and the change order form. The owner also sees the contingency field and the Approve buttons. At 1280x800 the two cost tables sit side by side above the totals. At 768x1024 and 375x812 everything stacks in one column.
  - **Access**: owner and lead carpenter. The owner edits the access card here and reads the code-reveal log. The lead carpenter sees the card read-only.
  - **Outbox**: owner. A table of every queued and sent email for the job.

  A newly created job shows no room groups, the plan pane's empty sheet with no image, and `0% verified`.
- **Punch list layout.**
  - **1024 px wide and up** (checked at 1280x800). The list fills the left pane, about two fifths of the width. The plan pane fills the right three fifths. Both are visible at once, side by side, and the list's right edge does not pass the plan's left edge.
  - **768 to 1023 px** (checked at 768x1024). The list fills the width except for a narrow plan rail along the right edge. The rail starts collapsed, showing only `button "Show plan"` (expanded state false). Expanding it slides the plan pane in over the right half of the list. While the rail is collapsed, the plan region and everything inside it (the image, every pin and "Fit plan") is hidden: none of it can be seen, focused, clicked or found by assistive technology. Moving the pane off-screen does not count as hidden.
  - **Below 768 px** (checked at 375x812). The list fills the width and no plan is visible. `button "Show plan"` stays in view at the bottom of the screen. Opening it raises the plan bottom sheet, which covers at least three fifths of the screen height. While the sheet is closed, nothing inside it is visible, focusable or exposed to assistive technology. This also holds after the sheet has been opened and closed again.
- **The list.** Above the groups sit, in order:
  - for trades, the House access region
  - the quick-add field and its room picker (not shown to trades)
  - the three filter pickers
  - for the owner and lead carpenter, the bulk controls

  A conflict group, headed by the conflict heading, sits above all rooms whenever any item the viewer can see has a conflict. Only the owner and lead carpenter see conflicts.

  Rooms appear in the order they were created. Each room group has:
  - a room heading in condensed capitals
  - the room count text
  - the item rows that pass the filters, ordered by number
  - the empty-room copy, when the room has no items in the viewer's scope

  Filters hide rows only. Headings, count texts and the empty-room copy ignore them.

  When an item is re-filed into another room, its row moves into that room's group at its place in number order, and both groups' count texts change at the same time.
- **A row** shows:
  - the item number in mono numerals
  - the title
  - the trade label, or `Crew` when there is no trade
  - the status label
  - a small pin glyph when pinned, or the review text when its pin needs review
  - the waiting-on text when it waits on other items
  - the row's action buttons
  - any transient row text from Feedback states

  A row added offline, or an optimistic quick-add row whose save has not returned yet, has no server number. It shows a placeholder of your choice where `<n>` goes: in the number column, in its accessible name (Item, a space, the placeholder, a colon, a space, then the title) and in its button names. It switches to its real number once the server assigns one, on save or on sync.

  The selected row expands in place into its details region, which holds:
  - the editable fields (owner and lead carpenter), or read-only values for others
  - the line total for the owner and lead carpenter
  - photos as thumbnails
  - the notes thread, with each note's edit, undo and redo controls
  - the photo, pin, waits-on, send-back, reopen and delete controls the viewer is allowed to use
- **The plan pane** shows:
  - the current plan revision's image on a paper sheet with a faint grid behind it
  - each room outline drawn as a thin blueprint polygon through its corners, with a label at the room's anchor showing the room name and its `<verified>/<total>` count
  - a numbered pin button for each pinned item
  - `button "Fit plan"` in a corner

  Each pin button sits so that its stored point falls inside the button's box, give or take 2 px. The stored point is `x` times the rendered plan image's width and `y` times its height, measured from the image's top-left corner. This is how "the same plan-relative spot" is judged after a reload, on another device and at every published viewport. The same measure places each room corner and each room label.

  If the plan cannot be loaded, the pane shows the plan-unavailable copy.
- **Account** (`/account`). The heading `Account` and the change-password form.
- **Not found.** Any job or item route the viewer cannot see renders the same screen, whether the record is missing, deleted or out of scope: the heading `We can't find that page.` and `link "Back to your jobs"`.
- **Role ended.** When the viewer's role on the open job has ended, the job view is replaced by the role-ended message from the API catalogue and `link "Back to your jobs"`.

### Public screens and controls (DP-01, DP-04, DP-09, DP-10, DP-12, DP-14, DP-15, DP-19, DP-20, DP-29, DP-31, DP-36, DP-45, DP-47, DP-51, DP-52, DP-54, DP-55, DP-57, DP-60, DP-61, DP-63, DP-64)

Only the controls below are public. Everything else is up to you.

Text fields are identified by their visible label. Placeholders:
- `<n>` and `<m>` are item numbers.
- `<title>` is an item title.
- `<room>` is a room name.
- `<name>` is a person's name.
- `<starts>` is an occurrence's job-local start as `YYYY-MM-DD HH:MM`.
- `<description>` is a change order's description.
- `<k>` is a count, defined where it is used.

| Role and accessible name | Where | Visible copy and notes |
|---|---|---|
| field "Email", field "Password", `button "Sign in"` | Sign in | Labels as named |
| `link "Your jobs"`, `link "Account"`, `button "Sign out"` | Top bar | As named |
| `status "Connection"` | Below top bar | Holds the offline banner while offline. Empty otherwise |
| `status "Activity"` | Every screen (visually a slim strip at the bottom of the list) | Every async result from Feedback states |
| `alert "There is a problem"` | Top of any form with field errors | Heading `There is a problem`, then one link per field error that moves focus to the field |
| `alert "Nothing changed"` | Top of the list after a failed bulk action | Heading `Nothing changed`, then one line per failure |
| `button "New job"`, `dialog "New job"` with fields "Job name", "Address", "Time zone" and `button "Create job"` | Your jobs (owner) | Time zone is a searchable list of time zone names |
| `link "<job name>"` | Your jobs | One per job |
| `tab "Punch list"`, `tab "Setup"`, `tab "People & visits"`, `tab "Costs"`, `tab "Access"`, `tab "Outbox"` | Job view | Shown per role as in Screens and layout |
| `button "Start walkthrough"`, `button "Close out job"`, `dialog "Close out job"` with `button "Close out"` | Job header (owner) | Shown only when the step is legal from the current stage |
| Job progress text | Job header and Your jobs | `<percent>% verified` |
| Review count text | Job header (owner, lead carpenter) | `<k> pins need review`, where `<k>` is the number of items whose pin status is needs review. Hidden when `<k>` is 0 |
| `region "Punch list"` | Job view | Holds the list |
| field "Quick add item", `combobox "Quick add room"` | Top of list (owner, lead carpenter, homeowner) | Enter in the field saves |
| `combobox "Show room"`, `combobox "Show status"`, `combobox "Show trade"` | Top of list (everyone) | Room options `All rooms`, then each room name. Status options `All`, `Open`, `In progress`, `Ready for check`, `Verified`. Trade options `All trades`, `Crew`, then each trade label |
| `button "Check off <k> shown"`, `combobox "Assign shown to"`, `button "Assign <k> shown"` | Top of list (owner, lead carpenter) | `<k>` is the number of rows the filters currently show. Disabled when `<k>` is 0 or while offline. Assign options are the trade options of the Trade picker |
| `heading` level 2 "<room>" | List | Room name, shown in capitals |
| Room count text | Beside each room heading | `<verified> of <total> verified` |
| `list "<room> items"` containing `listitem "Item <n>: <title>"` | List | Each row is focusable. The selected row has its current-item state set to true |
| Waiting-on text | Row | `Waiting on <numbers>`, where `<numbers>` are the item's `blocked_by` numbers joined by a comma and a space. Hidden when the item waits on nothing |
| Review text | Row | `Pin needs review`, shown when the item's pin status is needs review |
| `button "Check off item <n>"` | Row (owner, lead carpenter) | Verifies the item |
| `button "Start item <n>"`, `button "Mark item <n> done"` | Row (assigned trade, owner, lead carpenter) | Shown when legal |
| `region "Item <n> details"` | Under the selected row | Inline details |
| field "Title", `combobox "Room"`, `combobox "Trade"`, field "Cost note", field "Quantity", field "Unit cost" | Details (owner, lead carpenter) | Trade options `No trade`, `Electrical`, `Plumbing`, `Tile`, `Paint`, `Carpentry`, `HVAC`, `Flooring` |
| Line total text | Details (owner, lead carpenter) | `Line total <money>` |
| `button "Place pin"` | Details (owner, lead carpenter, and a homeowner on items they created) | Starts placement |
| `button "Waits on"`, `dialog "Waits on item <n>"` with one `checkbox "Item <m>: <title>"` per other item and `button "Save"` | Details (owner, lead carpenter) | Disabled while offline |
| file input "Add defect photo", file input "Add completion photo" | Details | Defect: owner and lead carpenter. Completion: owner, lead carpenter and assigned trade |
| `list "Photos"`, `button "Remove photo <k>"` | Details | `<k>` is the photo's 1-based position. Remove is shown to the owner, the lead carpenter and the uploader |
| field "Add a note", `combobox "Who can see this"`, `button "Post note"`, `button "Reply"`, field "Reply" | Details | Audience options `Crew only` and `Everyone`. Homeowners see no audience picker |
| `button "Edit note"`, field "Edit note", `button "Save note"`, `button "Undo my edit"`, `button "Redo my edit"` | Each note the viewer may edit | Undo and Redo are disabled while offline |
| `button "Send back"`, `dialog "Send back item <n>"` with field "Reason" and `button "Send back item"` | Details (owner, lead carpenter) | Shown when the item is ready for check |
| `button "Reopen item <n>"` | Details (owner) | Shown when the item is verified |
| `button "Delete item <n>"`, `dialog "Delete item <n>"` with `button "Delete item"` | Details | Shown to the owner on items that are not verified, and to the lead carpenter on open items they created. Disabled while offline |
| `region "Needs a decision"` with heading level 2 `Needs a decision` | Top of list (owner, lead carpenter) | One group per conflicting field, labelled `Item <n>: <field label>`, where `<field label>` is `Title`, `Room`, `Trade`, `Cost note`, `Quantity`, `Unit cost` or `Pin` |
| `button "Keep <value text>"` | Each conflict group | One per recorded value |
| `region "House access"`, `button "Show access codes"`, `button "Hide access codes"` | Top of list (trade). The owner and lead carpenter see the same region on the Access tab | When shown, lists `Lockbox`, `Alarm`, `Garage` and `House note` with their values |
| `region "Plan"` | Plan pane, expanded tablet rail or open phone sheet | Holds the plan. Not exposed while the rail is collapsed or the sheet is closed |
| `img "Floor plan of <job name>"` | Plan | The current plan image |
| `button "Pin <n>: <title>"` | Plan | One per pinned item, showing `<n>`, or a check mark when verified |
| `button "Fit plan"` | Plan | Shows the whole plan |
| `button "Show plan"` | Tablet rail and phone bottom bar | On the tablet it carries an expanded state |
| `dialog "Plan"`, `button "Close plan"` | Phone | The bottom sheet |
| `status "Pin placement"`, `button "Drop pin"`, `button "Cancel placement"` | Plan, during placement | Placement readout from Feedback states |
| Tether line | Plan and list overlay | Hidden from assistive technology. Carries the attribute `data-tether="<n>"`. Present only while drawn |
| Crosshair | Plan, during placement | Hidden from assistive technology. Carries the attribute `data-crosshair` |
| `button "Upload plan"` (opens a file input labelled "Upload plan"), `button "Add room"`, `dialog "Add room"` with fields "Room name", "Corners" and `button "Save room"` | Setup tab | Corners format in Interactions. A server error on `outline` shows under "Corners" |
| `button "Upload revision"`, `dialog "Upload plan revision"` with file input "Revision image", field "Reference points", one field "<room> corners" per room and `button "Upload revision"` | Setup tab (owner) | Formats in Interactions. Server errors on `reference_points` and `rooms` show under their fields |
| `table "Plan revisions"` | Setup tab | Columns Revision, Uploaded by, Uploaded at (job-local `YYYY-MM-DD HH:MM`), Pins moved, Need review |
| `table "People"`, `button "Add person"`, `dialog "Add person"` with fields "Name", "Email", "Phone", "Role", "Trade", "Initial password" and `button "Add"` | People & visits | Role options `Lead carpenter`, `Trade`, `Homeowner` |
| `button "End role for <name>"`, `dialog "End role"` with `button "End role"` | People & visits (owner) | One per non-owner person |
| `table "Site visits"` | People & visits | One row per occurrence in start order. Columns Person, Starts, Ends, Status. Status reads `Scheduled`, `Moved` or `Cancelled` |
| `button "Schedule visit"`, `dialog "Schedule visit"` with `combobox "Person"`, fields "Starts", "Ends", `combobox "Repeats"`, checkboxes `Mon` `Tue` `Wed` `Thu` `Fri` `Sat` `Sun`, field "Every how many days", `combobox "Ends"`, fields "End date", "Occurrences" and `button "Save visit"` | People & visits | Times are job-local. Repeats options `Does not repeat`, `Daily`, `Weekly`, `Every N days`. Ends options `On date`, `After count` |
| `button "Move visit on <starts>"`, `dialog "Move visit"` with fields "Starts", "Ends" and `button "Move visit"`, `button "Cancel visit on <starts>"` | Each non-cancelled occurrence row | |
| `button "Delete visit on <starts>"` | The row of each series' first occurrence | Deletes the whole series |
| fields "Lockbox code", "Alarm code", "Garage code", "House note", `button "Save access card"` | Access tab (owner) | |
| `table "Code reveals"` | Access tab (owner) | Columns Person, Role, Revealed at (job-local `YYYY-MM-DD HH:MM`) |
| `table "Cost by room"`, `table "Cost by trade"` | Costs tab | Columns Room or Trade, then Subtotal. Every room, and every trade plus `Crew`, appear even at zero |
| Totals lines | Costs tab | `Subtotal <money>`, `Change orders <money>`, `Contingency <percent>% <money>`, `Total <money>` |
| field "Contingency percent", `button "Save contingency"` | Costs tab (owner) | |
| `table "Change orders"`, fields "Change order description", "Change order amount", `button "Add change order"`, `button "Approve <description>"` | Costs tab | Columns Description, Amount, Status (`Pending` or `Approved`), Approved at. Approve is for the owner, on pending rows |
| `table "Outbox"` | Outbox tab | Columns Sent to, Subject, Status, Queued at. Status reads `Not sent yet` or `Sent` |
| fields "Current password", "New password", `button "Change password"` | Account | |
| heading `We can't find that page.`, `link "Back to your jobs"` | Not found | |

Money placeholders:
- `<money>` is an amount in dollars with a thousands comma and two decimals, for example `$1,234.50`. A negative amount puts the minus before the dollar sign, for example `-$12.00`.
- `<percent>` in the contingency line is the percent with two decimals, for example `5.00`.

### Interactions (DP-09, DP-10, DP-11, DP-12, DP-14, DP-15, DP-19, DP-20, DP-21, DP-31, DP-32, DP-46, DP-47, DP-51, DP-52, DP-56, DP-57, DP-64, DP-68)

- **Tab order on the Punch list.**
  1. top bar
  2. tabs
  3. House access region, when shown
  4. quick add field, then its room picker
  5. filters, then bulk controls
  6. conflict groups
  7. rows in list order; inside a selected row, its buttons and then its details controls
  8. plan controls: pins in number order, then "Fit plan" (at 1024 px and up, or with the tablet rail expanded)

  With the tablet rail collapsed, Tab from the last row's controls goes to "Show plan" and never reaches a plan control. On a phone, "Show plan" in the bottom bar comes after the rows. Every control shows a visible focus ring in the safety orange.
- **Selecting a row.** Click or tap the row, or press Enter or Space while it has focus. The row becomes the selected row, its details open below it, and the plan responds as in Motion and effects. Selecting another row moves the selection. Escape on a selected row clears the selection and closes its details.
- **Selecting a pin.** Click, tap or Enter on a pin selects its row and scrolls the list so the row is in view.
- **Quick add.** Type a title in "Quick add item", pick a room in "Quick add room", and press Enter. The room picker starts on the first room, or on the selected row's room. The new row appears in its room at once. Focus stays in the quick add field so the next item can be typed, and the field clears on save.
- **Keyboard pin placement.** Press P while focus is on a row or on any control inside that row or its details. In text fields, P types a letter instead.
  1. A crosshair appears at the anchor of the item's room (defined in Business rules), even when the item already has a pin. On a tablet with the rail collapsed, the rail expands first. On a phone, the plan sheet opens first.
  2. The arrow keys move the crosshair by one hundredth of the plan's width or height. Shift with an arrow moves it by five hundredths. The crosshair stops at the plan's edges, and the Pin placement readout updates on each move.
  3. Enter drops the pin. The server decides the room. If the server refuses, the crosshair stays and the refusal is shown. If the pin lands in another room, the row moves to that room's group as described in Screens and layout.
  4. Escape cancels, puts any previous pin back and returns focus to the row.

  `button "Place pin"` starts the same mode.
- **Pointer and touch placement.** During placement, a click or tap anywhere on the plan moves the crosshair to that point. `button "Drop pin"` and `button "Cancel placement"` do the same as Enter and Escape. On pointer devices, dragging a row and releasing it over the plan drops that item's pin at the release point in one step. On a 375 px phone, the lead carpenter opens the item's details, taps Place pin, taps the spot on the plan and taps Drop pin.
- **Plan rail and sheet.** On a tablet, "Show plan" toggles the rail and its expanded state. On a phone, "Show plan" opens `dialog "Plan"`. "Close plan", Escape or a downward swipe on the sheet's handle closes it, and focus returns to the opener. On a phone, selecting a row opens the sheet with that row's room framed and no tether.
- **Dialogs and the sheet.** Every dialog and the plan sheet keep Tab and Shift+Tab cycling inside them: Tab from the last control goes to the first, and Shift+Tab from the first goes to the last. Escape closes the dialog or sheet, and focus returns to the control that opened it.
- **Adding a room.** In `dialog "Add room"`, "Corners" takes the room's corners in order as percent pairs `x,y` separated by `;`. Each number is 0 to 100 with up to two decimals, and spaces are allowed. For example, `4,5; 52,5; 52,30; 40,30; 40,47; 4,47` is the seeded Kitchen. The page divides each number by 100 and sends the corners as the outline.
- **Uploading a revision.**
  - In `dialog "Upload plan revision"`, each "<room> corners" field starts filled with that room's current corners in the Corners format. The owner edits the ones that changed.
  - "Reference points" takes three pairs separated by `;`. Each pair is written `old x,old y > new x,new y`, in percent with the same number rules. For example, `10,10 > 12,10; 90,10 > 92,10; 10,90 > 12,90` describes a drawing shifted two hundredths to the right.
  - The page sends the image, the points and every room's outline in one request.
  - On success the plan pane shows the new image, and pins and rows update as the response says.
- **Inline editing.** In the details, a text field saves when focus leaves it or on Enter. A picker saves as soon as it changes. Quantity and unit cost are typed as plain decimals and sent as strings.
- **Editing a note.**
  1. "Edit note" opens the note's text in field "Edit note". The page remembers the note's revision at that moment.
  2. "Save note" works out one edit. It finds the longest common start of the original and edited text, then the longest common end of what remains, counting Unicode code points. It sends the middle as one edit, with the remembered revision as its base.
  3. The note then shows the server's merged body.
  4. "Undo my edit" and "Redo my edit" call undo and redo for the viewer and show the returned body.
- **Waits on.** "Waits on" opens its dialog with the item's current blockers checked. "Save" sends the checked items.
- **Filters and bulk actions.**
  - The filters combine: a row shows when it matches all three.
  - "Check off <k> shown" bulk-verifies the shown rows.
  - "Assign <k> shown" bulk-assigns them to the trade chosen in "Assign shown to".
  - On success, each row takes its new values. On failure, every row stays as it was and the nothing-changed alert lists each failure as `Item <n>: <message>` in number order, where `<message>` is the failure's message.
- **Scheduling a visit.**
  - "Repeats" controls which further fields show: the weekday checkboxes for Weekly, "Every how many days" for Every N days. "Ends", "End date" and "Occurrences" show for any repeating choice.
  - "Move visit on <starts>" opens `dialog "Move visit"` with that occurrence's times filled in.
  - "Cancel visit on <starts>" cancels that occurrence at once.
  - "Delete visit on <starts>" deletes the series.
- **Deleting an item.** "Delete item <n>" opens its confirmation dialog. "Delete item" deletes it, the row leaves the list, and focus moves to the next row, or to the quick add field when there is none.
- **Conflict resolution.** Activating a "Keep <value text>" button saves that value, and the group disappears for everyone.
- **Live updates.**
  - While online, the job view keeps the job's event stream open and applies each event in place: rows, groups, count texts, plan labels, pins, conflicts, notes, the visits table and the Costs tab. A change someone else makes appears within 2 seconds.
  - On reconnect, the page resumes the stream from the last sequence number it applied. After resuming, what it shows equals a fresh load. On a reset event it reloads the job's data.
  - As a fallback, the view re-reads the data its open tab shows every 15 seconds and whenever the tab regains focus. That is the refresh delay.
  - Incoming events and refreshes never close the selected row's details, an open dialog or a note editor, and never discard text the viewer has typed and not yet saved.
  - When the stream delivers the role-ended event, or a refresh is refused because the viewer's role has ended, the view clears any shown codes and switches to the role-ended screen. This happens at the latest within the refresh delay.
  - When an update shows that the viewer may no longer see codes, any shown codes are removed.
  - When a refresh gets an unauthenticated response, the browser goes to the sign-in screen with the signed-out copy.
- **House access.** Shown codes stay until the viewer hides them or an update removes them. For a trade, they are also removed when the server's visible-until time passes. The page judges that moment from the time and status the server returned, never from the device's own clock alone. The device clock may be wrong by hours.
- **Offline.**
  - A job the user opened while online opens again after a reload with no connection, with its list, its plan and any queued changes.
  - While offline, adding items, editing fields (quantity and unit cost included), item actions, pin placement, posting notes and editing notes apply on screen at once. They are queued on the device with a client sequence number in the order they were made, and the row shows the pending mark.
  - Each queued operation that carries a pin is stamped with the plan revision the device had cached.
  - Photo inputs are disabled and show the photos-offline copy.
  - These are disabled while offline: owner-only setup controls, the delete control, Waits on, bulk controls, note Undo and Redo, and every Costs tab control except item fields.
  - When the connection returns, or when a page loads online with a non-empty queue, the queue syncs within 5 seconds.

### Visual design (DP-49)

- **Composition.** The product looks like a drafting table.
  - On wide screens, an indented task-and-notes list grouped by room sits on the left. On the right, the floor plan lies on a paper sheet with a faint grid of small squares behind it, each about the size of the gap between two lines of body text.
  - Room outlines are thin blueprint polygons that follow every corner, so an L-shaped kitchen reads as an L.
  - The Costs tab reads like a ledger page: ruled rows with figures aligned on the right.
- **Rules and surfaces.** Single hairline rules divide sections and rows. Surfaces are flat paper with no gradients and no drop shadows. Dialogs and the bottom sheet are bordered with a hairline rule instead of floating on a shadow.
- **Colour roles.**
  - **Ground**: warm off-white paper.
  - **Text and icons**: near-black graphite ink.
  - **Blueprint**: a muted blueprint blue for room outlines, the tether line, the selected-row bar and links.
  - **Safety orange**: pins, the placement crosshair, the reduced-motion ring and every focus ring. It is never used for body text.
  - **Done**: a deep green for verified status and check-mark pins.
  - **Errors**: graphite text with a blueprint-blue left rule and a written message, so no meaning depends on colour alone.
- **Type.**
  - Room headings and screen titles use a condensed grotesque display face (Archivo), set in capitals with slightly open letter spacing.
  - Body text uses a plain humanist sans (IBM Plex Sans).
  - Every number uses a fixed-width mono numeral style so columns of figures line up: item numbers, counts, percentages, times, pin readouts, codes and money.
  - Each heading level is one fifth larger than the level below it, so a room heading is about one and a half times the body size and the screen title about twice.
- **Density.** Comfortable. Rows have generous vertical padding so a thumb can hit them. Every button, row, pin and field is at least 44 px tall and wide where it can be tapped.
- **Contrast.** Text and controls meet WCAG 2.2 AA contrast against the paper ground, including pin numbers on orange and check marks on green.
- **Selected row.** A pale blueprint wash fills the row, and a solid blueprint bar runs along its leading edge.
- **Fonts.** The app serves every font file itself.

### Motion and effects (DP-12, DP-13, DP-48)

Every motion here eases in quickly and settles gently. Each stated duration may vary by up to 0.06 seconds either way. No other motion exists in the product: no spinners, no looping shimmer, no idle animation and no decorative effect. Pending states are shown with text only. Live updates, rows moving between groups and Costs figures changing happen without animation.

- **Row highlight** (state change). The selected-row wash and bar fade in over about 0.18 seconds. Hovering a row on a pointer device shows a faint wash at once, with no animation.
- **Room tether** (the signature; it connects a punch item to its spot in the house). When a row with a pin is selected while the plan is visible:
  1. The plan pans and zooms over about 0.42 seconds until the bounding box of the pin's room fits inside the plan pane and fills at least three fifths of the pane's width or height.
  2. When the pan ends, a thin blueprint-blue line draws itself over about 0.32 seconds, like a pen drawn across the sheet. It starts at the row's trailing edge, at the vertical centre of the row's summary line, and ends at the centre of the pin. When finished, its ends sit within 4 px of those points. The selected list item may hold its details region inside it, so the start counts as correct anywhere on the list item's trailing edge between its top and bottom.
  3. When the line arrives, the pin pulses once over about 0.32 seconds, growing by a quarter and returning to its size.

  A verified item's pin is collapsed to a check mark in the done green.

  The line stays while the row is selected and both the row and the pin are visible. It disappears without animation when the selection changes or clears, or when the row or pin scrolls out of view, and it redraws without animation when they return. If the row has no pin, only the pan happens, framing the row's room. Below 768 px, or on a tablet with the rail collapsed, no line is drawn.
- **Rail and sheet** (enter and exit). The tablet rail slides in from the right and the phone sheet rises from the bottom, each over about 0.32 seconds. Each leaves the same way it came. Once it has left, its contents are hidden as described in Screens and layout.
- **Dialogs** (enter). Dialogs fade in over about 0.18 seconds and close at once.
- **Reduced motion.** When the device asks for reduced motion:
  - there is no tether line, pan animation or pulse
  - the plan jumps straight to the framed room
  - the selected pin gets a static thin ring in the safety orange
  - the selected row shows the reduced-motion pinned text from Feedback states
  - the row highlight, rail, sheet and dialogs appear in their end state at once

  Placement by keyboard, pointer and touch works the same.

### Feedback states (DP-15, DP-18, DP-21, DP-24, DP-36, DP-45, DP-52, DP-57, DP-64)

Every async action has four states: pending, success, field error and outage.
- While an action is pending, its button is disabled and marked busy.
- Results are announced in `status "Activity"`, each replacing the previous message.
- A form that fails validation also shows the error summary alert and puts each field's message under its field.
- Error messages come from the API error catalogue, shown character for character, unless the API publishes a field message for that field.

Placeholders:
- `<n>` is the item number and `<room>` the room name.
- `<status label>` is `Open`, `In progress`, `Ready for check` or `Verified`.
- `<synced>` and `<conflicts>` are the counts from the sync response.
- `<message>` is the server's message. When the rejection carries a published field message, `<message>` is that field message. For example, a pin placed offline outside every room shows `Not saved: Drop the pin inside a room on the plan.` In every other case it is the catalogue message for the error code.
- `<x>` and `<y>` are whole percentages, rounded half up.
- `<HH:MM>` is a job-local 24-hour time.
- In the upload-revision copy, `<n>` is the new revision number, `<moved>` and `<review>` are the response's `moved` and `needs_review` counts.
- In the bulk copy, `<k>` is the number of items in the request and `<trade label>` is the chosen trade's label, or `No trade`.

The published-copy rule (DP-45) covers text the UI shows or announces. That means the copy in Screens and layout, Public screens and controls and this section, plus API catalogue and field messages when they appear on screen. These are printed in backticks for precision only and are not UI copy: API error codes, environment variable names, JSON keys and bodies, event names, commands, storage keys and seed passwords. Email subjects and bodies must match exactly in the messages sent, and the Outbox table's Subject column shows each subject exactly as sent.

| Action | Pending | Success (Activity unless noted) | Error or outage |
|---|---|---|---|
| Sign in | `Saving` | goes to Your jobs | catalogue message under the form |
| Change password | `Saving` | `Password changed. Every other session is signed out.` | field messages |
| Create job | `Saving` | `Job created.` | field messages |
| Upload plan | `Saving` | `Plan uploaded.` | catalogue message (type, size or storage) |
| Upload revision | `Saving` | `Plan revision <n> uploaded: <moved> pins moved, <review> need review.` | field messages, or the catalogue message |
| Add room | `Saving` | `Room saved.` | field messages (the `outline` message under "Corners") |
| Add person | `Saving` | `Person added.` | catalogue or field message |
| End role | `Saving` | `Role ended for <name>.` | catalogue message |
| Schedule visit | `Saving` | `Visit scheduled.` | field messages, or the `visit_overlap` catalogue message |
| Move visit | `Saving` | `Visit moved.` | field messages or catalogue message |
| Cancel visit occurrence | `Saving` | `Visit cancelled.` | catalogue message |
| Save access card | `Saving` | `Access card saved.` | field messages |
| Show access codes | `Saving` | codes appear. For a trade the region adds `Codes visible until <HH:MM>` | catalogue message in the region. A trade with an upcoming visit also sees `Next visit: <YYYY-MM-DD HH:MM>` |
| Quick add or edit an item (Waits on included) | `Saving` | `Item <n> saved.` | `Not saved: <message>` |
| Drop a pin | `Saving` | `Pin dropped for item <n> in <room>.` (`<room>` is the room the server filed the item in) | the published pin field message; the crosshair stays |
| Item action | `Saving` | `Item <n>: <status label>.` | `Not saved: <message>` |
| Bulk check-off | `Saving` | `<k> items checked off.` | the nothing-changed alert and `Not saved: <message>` |
| Bulk assign | `Saving` | `<k> items assigned to <trade label>.` | the nothing-changed alert and `Not saved: <message>` |
| Delete item | `Saving` | `Item <n> deleted.` | `Not saved: <message>`; the row stays |
| Post a note | `Saving` | `Note posted.` | `Not saved: <message>` |
| Save note edit | `Saving` | `Note updated.` | `Not saved: <message>`; the editor keeps the draft |
| Undo my edit | `Saving` | `Edit undone.` | `Not saved: <message>` |
| Redo my edit | `Saving` | `Edit redone.` | `Not saved: <message>` |
| Photo upload | row text `Photo uploading` | `Photo saved.`; the thumbnail appears only now | catalogue message; no thumbnail |
| Remove photo | `Saving` | `Photo removed.` | catalogue message; the photo stays |
| Resolve conflict | `Saving` | `Conflict resolved.` | catalogue message |
| Save contingency | `Saving` | `Contingency saved.` | field messages |
| Add change order | `Saving` | `Change order added.` | field messages |
| Approve change order | `Saving` | `Change order approved.` | catalogue message |
| Start walkthrough | `Saving` | `Walkthrough started.` | catalogue message |
| Close out | `Saving` | `Job closed out.` | catalogue message |
| Offline sync | row text `Waiting to sync` on each queued row | `Sync complete: <synced> synced, <conflicts> to review.` | see the sync rejection rule below |

**Sync rejections.** When a sync result is `rejected`:
- If its item still exists, the row reverts to the values and status the server holds, and any note editor reverts to the server's body. The row shows `Not saved: <message>` until the next change to that row.
- If its item was never created (a rejected creation, and every operation that depended on it) or no longer exists, the row is removed together with any queued notes on it. After the sync sentence, Activity adds one sentence per removed row, separated by a single space: `Item <n> removed. Not saved: <message>`.

For example, a check-off queued on item 7 after the owner deleted it announces `Sync complete: 0 synced, 0 to review. Item 7 removed. Not saved: Not found.` No ghost row is ever left behind.

**Other published copy**
- Offline banner (in `status "Connection"`): `You're offline. Changes are saved on this phone and will sync when you reconnect.`
- Photo inputs while offline: `Photos need a connection.`
- Empty room: `No items in this room yet.`
- Conflict heading: `Needs a decision`. Each value line reads `<name> set <value text>`. `<value text>` is one of:
  - the text itself, for a title or cost note
  - the string value, for a quantity or unit cost, or `No value` when it is null
  - the room name
  - the trade label, or `No trade`
  - a pin as `<x>%, <y>%`, or `No pin`
- Placement readout (in `status "Pin placement"`): `Placing pin for item <n>: <x>% across, <y>% down.`
- Reduced-motion selected row: `Pinned in <room>`
- Plan unavailable: `Plan unavailable right now.`
- No jobs: `No jobs yet.`
- After a session ends: `You've been signed out.`
- Outbox status labels: `Not sent yet` for a queued entry, `Sent` for a sent one.
- Visit status labels: as listed in Public screens and controls.

## Backend

### API (DP-01, DP-02, DP-03, DP-04, DP-05, DP-07, DP-16, DP-20, DP-23, DP-26, DP-27, DP-29, DP-30, DP-36, DP-51, DP-52, DP-54, DP-55, DP-57, DP-60, DP-61, DP-63, DP-64, DP-66, DP-67)

#### General rules

- Every endpoint sits under `/api`.
- Endpoints speak JSON (`application/json; charset=utf-8`) except where multipart, image bytes or an event stream are stated.
- Every endpoint needs the session cookie except session creation and health.
- Ids are opaque UUID strings.
- Times are UTC ISO 8601 with `Z`, except fields marked job-local.
- Unknown request keys are ignored.

**Error shape.** Every error body is `{"error":"<code>","message":"<text>"}`. A 422 adds `"fields":{"<field>":"<text>"}`. Codes listed below with extra keys add them to this shape.

**Error precedence.** One rule covers the whole API:
1. too-large body (413)
2. cross-origin (403)
3. unauthenticated (401)
4. unknown or not-visible resource (404)
5. forbidden or role ended (403)
6. state conflicts (409)
7. validation (422, 413 `photo_too_large`, 415)
8. a provider outage (503)

Within the 409s:
- `job_closed` comes first.
- For item actions the order is then `invalid_transition`, `blocked`, `awaiting_trade`, `completion_photo_required`.
- For visits and occurrences the order is then `invalid_transition`, `visit_overlap`.
- `bulk_failed` is judged only after a bulk request has passed validation, because it comes from evaluating the items.

What "not visible" means:
- A resource is not visible when it is missing, deleted, belongs to another job or firm, or lies outside the caller's scope. Out of scope means another trade's item (with its photos and notes), a crew note for a homeowner, or a job where the caller never held a role.
- All of these answer the same 404, whether the id is in the path or in the body. Body ids include `room_id`, `member_id`, `parent_id`, `note_id`, `item_ids`, rooms in a revision and item ids in sync operations.
- Role alone never hides a record that exists on a job the caller belongs to. An endpoint the caller's role may not use answers 403 `forbidden` for every existing id. For example, a trade or homeowner asking for the plan revisions list, an existing plan revision image, the change orders or the costs gets 403 `forbidden`. An id that does not exist on the job, such as an unknown revision number, answers 404 for every role.
- A caller whose role on the job has ended gets `role_ended` for every route under that job, whatever ids follow.
- Inside a sync, an operation whose `op_id` is already in the operation log answers as a replay, as set out under Sync, before any other check.

#### Error catalogue

| code | status | message |
|---|---|---|
| `too_large` | 413 | `That request is too large.` |
| `cross_origin` | 403 | `Requests must come from Snaglight itself.` |
| `unauthenticated` | 401 | `Sign in to continue.` |
| `invalid_credentials` | 401 | `That email and password don't match.` |
| `not_found` | 404 | `Not found.` |
| `forbidden` | 403 | `You can't do that on this job.` |
| `role_ended` | 403 | `Your access to this job has ended.` |
| `outside_site_visit` | 403 | `Access codes show from 30 minutes before your next site visit.` |
| `invalid_transition` | 409 | `That step isn't allowed from here.` |
| `blocked` | 409 | `Finish the items this one is waiting on first.` (body adds `"waiting_on":[<numbers ascending>]`, the numbers of the item's blockers that are not verified) |
| `awaiting_trade` | 409 | `Waiting on the trade's completion photo.` |
| `completion_photo_required` | 409 | `Add a completion photo before marking this done.` |
| `bulk_failed` | 409 | `None of the items changed.` (body adds `"failures":[{"number","error","message"}]` in number order) |
| `items_not_verified` | 409 | `Every item must be verified before close-out.` (body adds `"unverified":<count>`) |
| `job_closed` | 409 | `This job is closed out.` |
| `already_member` | 409 | `That person already has a role on this job.` |
| `no_conflict` | 409 | `That field has no conflict to resolve.` |
| `visit_overlap` | 409 | `That person already has a visit then.` (body adds `"occurrence_date":"YYYY-MM-DD"`) |
| `nothing_to_undo` | 409 | `You have no edit to undo on this note.` |
| `nothing_to_redo` | 409 | `You have no undone edit to redo on this note.` |
| `validation` | 422 | `Check the highlighted fields.` |
| `photo_too_large` | 413 | `Images must be 10,000,000 bytes or smaller.` |
| `unsupported_image` | 415 | `Use a JPEG, PNG or WebP image.` |
| `storage_unavailable` | 503 | `Storage is unreachable; nothing was saved. Try again shortly.` |

#### Published field messages

- `pin`: `Drop the pin inside a room on the plan.`
- `new_password`: `New password must be at least 10 characters.`
- `outline` and `rooms`, when an outline overlaps another room: `Rooms can't overlap.`
- `item_ids`, when the change would make a cycle: `Items can't wait on each other in a circle.`
- `reference_points`, when the old points are collinear: `Pick three reference points that are not in a line.`

Every other field message is free text.

#### Resource shapes

Each role gets exactly these keys. Absent means the key is not in the JSON.

- **Job** (all roles):
  - `id`, `name`, `address`, `time_zone`
  - `status`: `active`, `walkthrough` or `closed_out`
  - `progress`: `{"verified","total","percent"}`
  - `my_role`: `owner`, `lead`, `trade` or `homeowner`
  - `my_trade`: a trade key or null
  - `plan_url`: `/api/jobs/<id>/plan`, or null
  - `plan_revision`: the current revision number, or null with no plan
  - `access_codes_available`: boolean
  - `next_visit`: `{"starts_at","ends_at"}`, job-local, for the caller's current or next non-cancelled occurrence. Null for anyone who is not a trade or who has none.
- **Room**:
  - `id`, `name`
  - `outline`: the corners as `[{"x","y"}, ...]` in the order sent
  - `bounds`: `{"x","y","w","h"}`, the bounding box of the outline
  - `anchor`: `{"x","y"}`, the anchor point from Business rules, not rounded
  - `counts`: `{"verified","total"}`
- **Item**:
  - Owner and lead carpenter: `id`, `number`, `title`, `room_id`, `trade`, `status`, `pin`, `pin_status`, `blocked_by`, `cost_note`, `quantity`, `unit_cost`, `line_total`, `sent_back_reason`, `conflicts`, `created_by`, `photos`, `notes`, `updated_at`.
  - Trade: the same without `cost_note`, `quantity`, `unit_cost`, `line_total` and `conflicts`.
  - Homeowner: the same as a trade, also without `sent_back_reason`.
  - Field values:
    - `trade`: one of `electrical`, `plumbing`, `tile`, `paint`, `carpentry`, `hvac`, `flooring`, or null.
    - `status`: one of `open`, `in_progress`, `ready_for_check`, `verified`.
    - `pin`: `{"x","y"}` or null.
    - `pin_status`: `placed`, `unpinned` or `needs_review`.
    - `blocked_by`: the blockers' item numbers, ascending.
    - `quantity`: a string with exactly three decimals, or null.
    - `unit_cost`: a string with exactly two decimals, or null.
    - `line_total`: a string with two decimals.
    - `created_by`: `{"name","role"}`.
    - `conflicts`: a list of `{"field","server_value","server_by","phone_value","phone_by"}`, at most one per field. Each `*_by` is a person's name.
- **Note**:
  - `id`, `body`, `audience` (`crew` or `everyone`), `author` (`{"name","role"}`), `rev`, `created_at`.
  - Top-level notes also carry `replies`: a list of notes without `replies`.
  - Homeowners receive only `everyone` notes and replies.
- **Photo**: `id`, `kind` (`defect` or `completion`), `content_type`, `bytes`, `url` (`/api/jobs/<job id>/photos/<photo id>`), `uploaded_by` (`{"name","role"}`), `created_at`.
- **Member**: the owner and lead carpenter receive `id`, `name`, `role`, `trade`, `email`, `phone` for everyone. A trade or homeowner receives those six keys for owner and lead rows and for their own row, and only `id`, `name`, `role`, `trade` for every other row.
- **Visit**:
  - `id`, `member_id`, `member_name`
  - `starts_at`, `ends_at`: job-local `YYYY-MM-DDTHH:MM:SS`, the first occurrence's original times
  - `starts_at_utc`, `ends_at_utc`
  - `recurrence`: null or the rule as stored, with weekdays in Monday-to-Sunday order
  - `occurrences`: `[{"date","starts_at","ends_at","starts_at_utc","ends_at_utc","status","active"}]`, ordered by original date. `date` is the original generated job-local date. The times are current (moved times for a moved occurrence). `status` is `scheduled`, `moved` or `cancelled`. `active` is true while that occurrence's code window is open.
  - `active`: true while any occurrence's code window is open
- **AccessCard**: `lockbox_code`, `alarm_code`, `garage_code`, `house_note`, `visible_until`. `visible_until` is a UTC time for a trade and null for the owner and lead carpenter.
- **Reveal**: `name`, `role`, `revealed_at`.
- **OutboxEntry**: `id`, `kind` (`assignment` or `summary`), `to`, `subject`, `status` (`queued` or `sent`), `created_at`, `sent_at` (null until sent).
- **ChangeOrder**: `id`, `description`, `amount` (a string with two decimals), `status` (`pending` or `approved`), `created_at`, `approved_at` (null until approved).
- **Costs**:
  - `as_of`
  - `by_room`: `[{"room_id","name","subtotal"}]`
  - `by_trade`: `[{"trade","subtotal"}]`
  - `items_subtotal`, `change_orders_total`, `contingency_percent`, `contingency`, `total`

  Every amount is a string with two decimals, and the percent too.

#### Session and account

- `POST /api/session`: takes `{"email","password"}` and answers 200 `{"user":{"name","email","is_owner"}}`. It sets an HttpOnly, SameSite=Lax cookie `snaglight_session` with path `/`. Errors: 401 `invalid_credentials`, 422.
- `DELETE /api/session`: answers 204 and ends the current session.
- `GET /api/me`: answers 200 `{"user":{"name","email","is_owner"}}`.
- `POST /api/me/password`: takes `{"current_password","new_password"}` and answers 200 `{"ok":true}`. Errors: 422 on `current_password` when it is wrong, or on `new_password` when it is shorter than 10 or longer than 200 characters.

#### Jobs, plan and rooms

- `GET /api/jobs`: answers 200 `{"jobs":[Job]}`, listing the jobs where the caller holds an active role, newest first.
- `POST /api/jobs`: owner only. Takes `{"name","address","time_zone"}` and answers 201 Job. The name is 1 to 120 characters, the address 1 to 200 characters, and the time zone an IANA name such as `America/Chicago`. A new job has no rooms and no items, `plan_url` and `plan_revision` null, and `progress` `{"verified":0,"total":0,"percent":0}`.
- `GET /api/jobs/{jobId}`: answers 200 Job.
- `POST /api/jobs/{jobId}/actions`: owner only. Takes `{"action":"start_walkthrough"|"close_out"}` and answers 200 Job.
- `PUT /api/jobs/{jobId}/plan`: owner only. Takes multipart with a `file` part and answers 200 Job. On a job without a plan it creates revision 1. On a job with a plan it creates the next revision with the identity transform and unchanged outlines.
- `GET /api/jobs/{jobId}/plan`: answers 200 with the current revision's image bytes and stored content type, or 404 when the job has no plan.
- `POST /api/jobs/{jobId}/plan/revisions`: owner only. Takes multipart with three parts:
  - `file`: the image
  - `reference_points`: JSON, exactly three `{"old":{"x","y"},"new":{"x","y"}}`, each coordinate 0 to 1 with at most four decimals
  - `rooms`: JSON, one `{"room_id","outline"}` for every existing room exactly once

  It answers 201 `{"revision","job":Job,"moved","needs_review"}`. Errors:
  - 409 `invalid_transition` when the job has no plan
  - 422 on `reference_points`, on `rooms` (a missing or repeated room, or a failing outline) or on `file`
  - the image errors
  - 503 `storage_unavailable`
- `GET /api/jobs/{jobId}/plan/revisions`: owner and lead carpenter. Answers 200 `{"revisions":[{"revision","created_at","uploaded_by":{"name","role"},"moved","needs_review"}]}`, oldest first. Trades and homeowners get 403 `forbidden`.
- `GET /api/jobs/{jobId}/plan/revisions/{n}`: owner and lead carpenter. Answers 200 with that revision's image bytes. Trades and homeowners get 403 `forbidden` for every revision number that exists. A revision number that does not exist answers 404 for every role.
- `GET /api/jobs/{jobId}/rooms`: answers 200 `{"rooms":[Room]}` in creation order.
- `POST /api/jobs/{jobId}/rooms`: owner only. Takes `{"name","outline":[{"x","y"},...]}` and answers 201 Room. The name is 1 to 60 characters and unique in the job. A failing outline answers 422 on `outline`.

#### Members, visits and access

- `GET /api/jobs/{jobId}/members`: answers 200 `{"members":[Member]}`, listing active roles only.
- `POST /api/jobs/{jobId}/members`: owner only. Takes `{"name","email","phone","role":"lead"|"trade"|"homeowner","trade","initial_password"}` and answers 201 Member.
  - `trade` is required for the role `trade` and must be null otherwise.
  - `phone` is optional.
  - `initial_password` (10 to 200 characters) is required only when no account has that email.
  - Error: 409 `already_member`.
- `DELETE /api/jobs/{jobId}/members/{memberId}`: owner only. Answers 204. Ending the owner's own role answers 409 `invalid_transition`.
- `GET /api/jobs/{jobId}/visits`: answers 200 `{"visits":[Visit]}`. The owner and lead carpenter get every visit. A trade gets their own. Homeowners get 403.
- `POST /api/jobs/{jobId}/visits`: owner or lead carpenter. Takes `{"member_id","starts_at","ends_at","recurrence"}` and answers 201 Visit.
  - The times are job-local `YYYY-MM-DDTHH:MM`, with optional `:SS`.
  - `recurrence` is optional: null, or `{"freq":"daily"|"weekly"|"every_n_days","weekdays":[...],"interval":<int>,"until":"YYYY-MM-DD"|null,"count":<int>|null}`. Weekdays use `MO`, `TU`, `WE`, `TH`, `FR`, `SA`, `SU`.
  - A member who is not a trade gets 422 on `member_id`.
  - The scheduling and recurrence rules and their errors are in Business rules.
- `PUT /api/jobs/{jobId}/visits/{visitId}/occurrences/{date}`: owner or lead carpenter. Moves one occurrence. Takes `{"starts_at","ends_at"}` (job-local) and answers 200 Visit.
- `DELETE /api/jobs/{jobId}/visits/{visitId}/occurrences/{date}`: owner or lead carpenter. Cancels one occurrence and answers 200 Visit.
- `DELETE /api/jobs/{jobId}/visits/{visitId}`: owner or lead carpenter. Deletes the whole series and answers 204.
- `GET /api/jobs/{jobId}/access`: answers 200 AccessCard and records one reveal. Errors: 403 `outside_site_visit` for a trade outside the window, 403 `forbidden` for a homeowner.
- `PUT /api/jobs/{jobId}/access`: owner only. Takes `{"lockbox_code","alarm_code","garage_code","house_note"}` and answers 200 AccessCard. Codes are 0 to 40 characters and the note 0 to 500 characters. It records no reveal.
- `GET /api/jobs/{jobId}/access/reveals`: owner only. Answers 200 `{"reveals":[Reveal]}`, newest first.

#### Items, links and bulk actions

- `GET /api/jobs/{jobId}/items`: answers 200 `{"items":[Item]}` in room creation order, then by number, limited to the caller's scope.
- `POST /api/jobs/{jobId}/items`: takes `{"title","room_id","trade","cost_note","quantity","unit_cost","pin"}` and answers 201 Item.
  - Only `title` and `room_id` are required. The title is 1 to 200 characters and the cost note at most 1,000 characters.
  - A homeowner who sends `trade`, `cost_note`, `quantity` or `unit_cost` gets 403. A key that is left out, null or an empty string does not count as sent.
  - Trades get 403.
  - When `pin` is sent, it decides the room by the pin rules, and `room_id` serves as the shared-edge tie-break.
- `GET /api/jobs/{jobId}/items/{itemId}`: answers 200 Item.
- `PATCH /api/jobs/{jobId}/items/{itemId}`: takes any non-empty subset of `{"title","room_id","trade","cost_note","quantity","unit_cost","pin"}` and answers 200 Item.
  - Allowed for the owner and lead carpenter, and for a homeowner setting `pin` on an item they created.
  - Each field sent replaces its value and clears that field's conflict, if any.
  - `quantity` and `unit_cost` must be JSON strings or null. A JSON number answers 422 on that field.
- `DELETE /api/jobs/{jobId}/items/{itemId}`: answers 204. Errors: 403 `forbidden`, 409 `invalid_transition`, 409 `job_closed`, 503 `storage_unavailable`.
- `POST /api/jobs/{jobId}/items/{itemId}/actions`: takes `{"action":"start"|"mark_done"|"verify"|"send_back"|"reopen","reason"}` and answers 200 Item.
  - `reason` is required for `send_back`, 1 to 500 characters.
  - A `reopen` response also carries `"reopened_dependents":[<numbers ascending>]`.
- `PUT /api/jobs/{jobId}/items/{itemId}/blocked-by`: owner and lead carpenter. Takes `{"item_ids":[...]}` with 0 to 10 ids, which replace the item's blockers, and answers 200 Item. More than 10 answers 422 on `item_ids`. Duplicate ids collapse into one.
- `POST /api/jobs/{jobId}/items/bulk`: takes `{"action":"start"|"mark_done"|"verify"|"set_trade","trade","item_ids":[...]}` with 1 to 100 ids and answers 200 `{"items":[Item]}` in number order.
  - `trade` (a trade key or null) is required for `set_trade`.
  - Duplicate ids, or an id count outside 1 to 100, answer 422 on `item_ids`.
  - Errors: 404, 403 and 409 `bulk_failed`, as set out in Business rules.

#### Notes and photos

- `POST /api/jobs/{jobId}/items/{itemId}/notes`: takes `{"body","audience","parent_id"}` and answers 201 Note with `rev` 0. The body is 1 to 2,000 code points. `parent_id` is optional.
- `POST /api/jobs/{jobId}/items/{itemId}/notes/{noteId}/edits`: takes `{"base_rev","pos","delete","insert"}` and answers 200 Note. Each of the following failures answers 422 on that field:
  - `base_rev` outside 0 to the current `rev`
  - a negative `pos`
  - `pos` plus `delete` larger than the length of the text at `base_rev`
  - neither a positive `delete` nor a non-empty `insert`
  - a resulting body outside 1 to 2,000 code points
- `POST …/notes/{noteId}/undo` and `POST …/notes/{noteId}/redo`: take no body and answer 200 Note. Errors: 409 `nothing_to_undo`, 409 `nothing_to_redo`.
- `GET …/notes/{noteId}/history`: answers 200 `{"revisions":[{"rev","kind":"create"|"edit"|"undo"|"redo","author":{"name","role"},"body","created_at"}]}`, oldest first, to anyone who can see the note.
- `POST /api/jobs/{jobId}/items/{itemId}/photos`: takes multipart with a `file` part and a `kind` part (`defect` or `completion`) and answers 201 Photo.
- `GET /api/jobs/{jobId}/photos/{photoId}`: answers 200 with the image bytes. A photo whose record is gone answers 404 `not_found`, whether or not storage is reachable.
- `DELETE /api/jobs/{jobId}/photos/{photoId}`: answers 204.
- `POST /api/jobs/{jobId}/items/{itemId}/resolve`: owner and lead carpenter. Takes `{"field","value"}` and answers 200 Item.
  - `value` must equal one of the two recorded values, otherwise 422 on `value`.
  - A field without a conflict answers 409 `no_conflict`.
  - Resolving a pin re-files the item. A chosen pin that now lies outside every room answers 422 with the published `pin` message.

#### Costs

- `GET /api/jobs/{jobId}/costs?as_of=<UTC ISO time>`: owner and lead carpenter. Answers 200 Costs. `as_of` defaults to now. A value that cannot be read answers 422 on `as_of`. Others get 403.
- `PUT /api/jobs/{jobId}/contingency`: owner only. Takes `{"percent"}`, a string from `0.00` to `25.00` with up to two decimals, and answers 200 `{"percent","effective_at"}`.
- `GET /api/jobs/{jobId}/change-orders`: owner and lead carpenter. Answers 200 `{"change_orders":[ChangeOrder]}`, oldest first.
- `POST /api/jobs/{jobId}/change-orders`: owner or lead carpenter. Takes `{"description","amount"}` and answers 201 ChangeOrder with `status` `pending`. The description is 1 to 200 characters. The amount is a non-zero string from `-99999.99` to `99999.99` with up to two decimals.
- `POST /api/jobs/{jobId}/change-orders/{id}/approve`: owner only. Answers 200 ChangeOrder. A second approval answers 409 `invalid_transition`.

#### Sync

`POST /api/jobs/{jobId}/sync` takes `{"ops":[Op]}` with 1 to 200 operations and answers 200 `{"results":[Result],"synced":<int>,"conflicts":<int>}`.

These request-wide checks answer 422 on `ops` for the whole request, with no per-operation results:
- more than 200 operations, or none
- an operation without a `seq`, or with a `seq` that is not an integer from 1 to 2147483647
- two operations with the same `seq`

Each Op has `op_id` (a UUID made on the device), `seq` (the device's client sequence number) and `type`:
- `{"op_id","seq","type":"create_item","client_item_id","plan_revision","fields":{"title","room_id","trade","cost_note","quantity","unit_cost","pin"}}`
- `{"op_id","seq","type":"update_item","item_id","plan_revision","changes":{"<field>":{"from":<value>,"to":<value>}}}`
- `{"op_id","seq","type":"item_action","item_id","action","reason"}`
- `{"op_id","seq","type":"add_note","item_id","client_note_id","body","audience","parent_id"}`
- `{"op_id","seq","type":"edit_note","item_id","note_id","base_rev","pos","delete","insert"}`

There is no other operation type. Any other `type` is rejected with a 422-shaped error on `type`.

References and plan revisions:
- `plan_revision` and `client_note_id` are optional.
- `item_id` may be a server id or a `client_item_id` created by an operation with a lower `seq` in this request or in an earlier sync.
- `note_id` may be a server id or a `client_note_id` made the same way.
- A `plan_revision` higher than the job's current revision answers 422 on `plan_revision`. Left out, it means the current revision.

Each Result is `{"op_id","seq","outcome":"applied"|"duplicate"|"conflict"|"rejected","item":Item|null,"error":{...}|null}`.

- **Order.** Operations run in ascending `seq`, whatever their order in the array, and `results` come back in ascending `seq`.
- **Checks.** Each operation is checked with the same rules and permissions as its online counterpart. A failing operation is `rejected` with the error body it would have received, and later operations still run.
- **Atomic operations.** If any field fails validation, the whole operation is `rejected` and none of its fields apply. For example, a pin outside every room rejects the whole operation.
- **Dependent operations.** When a `create_item` or `add_note` is rejected, every later operation in the request that refers to its client id is rejected with the `not_found` body. A reference that names no item or note also answers `not_found`. That includes a client id never mapped to one.
- **Deleted items.** Every `update_item`, `item_action`, `add_note` and `edit_note` whose item has been deleted is rejected with the `not_found` body.
- **Reused client ids.** A `create_item` or `add_note` with a new `op_id`, whose client id is already mapped by this request or an earlier one, is rejected with a 422-shaped error on `client_item_id` or `client_note_id`.
- **Operation log.** The log keeps every operation whose outcome was `applied` or `conflict`, with its content. A `rejected` operation is not kept. "Content" means every key of the operation except `op_id` and `seq`.
- **Replays.**
  - Replaying an `op_id` whose original outcome was `applied` or `conflict` answers `duplicate`, with `item` set to the item as it is now and `error` null. It changes nothing, records no conflict, queues no email and emits no event.
  - Replaying a `create_item` whose item has since been deleted answers `duplicate` with `item` null.
  - Replaying an `op_id` whose original outcome was `rejected` evaluates it again as a new operation.
  - An `op_id` already in the log sent with different content is `rejected` with a 422-shaped error on `op_id`, and the log keeps the original.
  - The same content with a different `seq` is a plain replay.
- **Error bodies.** A rejected Result's `error` is the full error body the online request would get, so a 422 carries `fields`. For example: `{"error":"validation","message":"Check the highlighted fields.","fields":{"op_id":"<text>"}}`.
- **Counts.**
  - `duplicate` results count towards neither total.
  - `synced` counts distinct items with at least one operation `applied` in this request. An applied `edit_note` counts its item.
  - `conflicts` counts distinct items that gained a conflict in this request.

#### Event stream

`GET /api/jobs/{jobId}/events` answers 200 with `text/event-stream`. It applies the usual 401, 404 and `role_ended` checks before streaming. The resume point comes from the `Last-Event-ID` header or the `after` query parameter. The header wins when both are sent. With neither, the stream carries only events committed after it opens.

Each event is one frame: a line `id: <seq>`, a line `event: <type>`, a line `data: <JSON>`, then a blank line. A comment line `: keep-alive` is sent every 15 seconds.

The event types are:

| type | data | Who receives it |
|---|---|---|
| `item` | `{"item":Item}`: the item as committed, projected for the receiver's role | everyone whose scope includes the item |
| `item_deleted` | `{"id","number"}` | everyone whose scope included the item. A trade also receives it when an item leaves their scope through a trade change |
| `room` | `{"room":Room}` | everyone |
| `counts` | `{"progress","rooms":[{"id","counts"}]}`: for the receiver's scope at delivery | everyone |
| `note` | `{"item_id","note"}` | everyone who can see that note |
| `plan` | `{"revision","plan_url"}` | everyone |
| `visit` | `{"visit":Visit}` | owner, lead carpenter and that trade |
| `visit_deleted` | `{"id"}` | owner, lead carpenter and that trade |
| `costs` | the Costs object for now | owner and lead carpenter |
| `job` | `{"job":Job}`, projected for the receiver | everyone |
| `role_ended` | `{}` | the member whose role ended. Their stream then closes |
| `reset` | `{}` | a resuming client, as set out in Business rules |

#### Other endpoints

- `GET /api/jobs/{jobId}/outbox`: owner only. Answers 200 `{"entries":[OutboxEntry]}`, newest first.
- `GET /api/health`: answers 200 `{"status":"ok"}` without a session.

**Size limits.** A JSON body may be up to 1,000,000 bytes. A multipart body may be up to 10,500,000 bytes. Each limit itself is allowed. Larger bodies answer `too_large`.

### Business rules (DP-03, DP-04, DP-05, DP-07, DP-08, DP-17, DP-20, DP-21, DP-23, DP-24, DP-29, DP-30, DP-32, DP-33, DP-35, DP-38, DP-39, DP-41, DP-51, DP-52, DP-54, DP-55, DP-58, DP-60, DP-61, DP-63, DP-64, DP-66, DP-67)

#### Roles

- The firm owner holds the `owner` role on every job of the firm. Every other person holds one role per job: `lead`, `trade` (with one trade) or `homeowner`.
- A trade's scope is the items whose `trade` equals their trade. A homeowner's scope is every item on the job.
- Any action a role does not have answers 403 `forbidden`.
- Ending a role takes effect on the member's next request, even mid-session. Every route under that job answers `role_ended`, and the job leaves their job list. Every visit series of theirs is deleted, their open event streams receive `role_ended` and close, and they get no further email for that job.
- Adding the same email again restores a role.

#### Item lifecycle

| Action | From | To | Who | Extra rule |
|---|---|---|---|---|
| `start` | `open` | `in_progress` | assigned trade, lead carpenter, owner | |
| `mark_done` | `in_progress` | `ready_for_check` | assigned trade, lead carpenter, owner | every blocker verified, else `blocked`. An item with a trade needs at least one stored completion photo, else `completion_photo_required`. Clears `sent_back_reason` |
| `verify` | `ready_for_check` | `verified` | lead carpenter, owner | every blocker verified, else `blocked` |
| `verify` | `open` or `in_progress`, item without a trade | `verified` | lead carpenter, owner | every blocker verified, else `blocked`. An item with a trade in these states answers `awaiting_trade` |
| `send_back` | `ready_for_check` | `in_progress` | lead carpenter, owner | stores the reason as `sent_back_reason` |
| `reopen` | `verified` | `open` | owner only | the lead carpenter gets `forbidden`. The reopen cascades as set out under Blocked-by links |

- Every other action and state combination answers `invalid_transition`. Homeowners have no item actions.
- **Trade changes on finished work.** An item's trade can change only while it is `open` or `in_progress`. A change to a different trade on an item in `ready_for_check` or `verified` answers `invalid_transition`. That covers PATCH, resolve, bulk `set_trade`, and a sync change whose `to` differs from the server value.

#### Deleting an item

- **Who may delete.** The owner may delete any item that is not `verified`; a `verified` item answers `invalid_transition`. The lead carpenter may delete an `open` item they created; for the lead carpenter, any other item answers `forbidden`. Trades and homeowners get `forbidden`.
- **Order of work.** The server first deletes the item's photo objects from the object store. Then, in one transaction, it deletes the photo records, notes, conflicts and the item, and removes the item from every other item's `blocked_by`. An item with no photos needs no storage call.
- **Storage down.** If storage is unreachable, the request answers `storage_unavailable` and nothing changes.
- **Afterwards.** The item and its photos answer 404 `not_found` for every role, and counts, cost rollups and job progress drop at once. An outbox entry already queued for the item still sends.
- **Online only.** There is no offline delete.

#### Item numbers

Numbers are assigned consecutively per job from 1, with none skipped at assignment, even when items are created at the same moment. A deleted item's number is never reused: after item 7 of 7 is deleted, the next item is 8. A rejected creation takes no number.

#### Concurrency

- Actions, edits, deletions, link changes, note edits and syncs on one item or note are applied one at a time.
- Of several simultaneous identical actions, exactly one succeeds and the rest answer `invalid_transition`.
- Two syncs that touch the same item at the same moment are applied one after the other. Each field ends with exactly one value and at most one conflict, and the result equals one of the two orders.
- Of simultaneous approvals of one change order, exactly one answers 200.

#### Job stages

- `start_walkthrough` moves `active` to `walkthrough`.
- `close_out` moves `walkthrough` to `closed_out`, and answers `items_not_verified` while any item is not verified.
- Every other stage move answers `invalid_transition`.
- **Close-out cleanup.** Close-out first deletes every stored object of the job (every plan revision and every photo) from the object store, then their records. Afterwards `plan_url` and `plan_revision` are null and `photos` is empty. The plan URL, every revision URL and every old photo URL answer 404 `not_found`.
- **Close-out with storage down.** If storage is unreachable, close-out answers `storage_unavailable` and the job stays in `walkthrough` with its records. A later close-out removes whatever remains.
- **Closed jobs.** Every write under a closed-out job answers `job_closed`. A sync request to a closed-out job answers 409 with the `job_closed` body for the whole request, with no per-operation results, whatever operations it carries, already-logged `op_id`s included.
- Items can be added, acted on and deleted in both `active` and `walkthrough`.

#### Room outlines

- **Corners.** An outline is a list of 4 to 12 corners. Each coordinate is between 0 and 1 (both ends allowed) with at most four decimal places.
- **Shape.** Consecutive edges alternate between horizontal and vertical, including the closing edge from the last corner back to the first. No edge has zero length. The outline is simple: edges that are not next to each other share no point. Either winding direction is accepted.
- **Overlap.** Two rooms overlap when their interiors share any area. Touching along an edge or at a corner is allowed. Identical outlines overlap, and so do outlines that cross like a plus sign even though neither has a corner inside the other. An overlapping outline answers 422 with the published overlap message.
- **Other failures.** Every other failing outline answers 422 on its field with free text.
- **Simultaneous creation.** Of two simultaneous room creations whose outlines overlap each other, exactly one answers 201.
- **Existing items.** Adding a room never changes an existing item's room.
- **Bounds.** A room's `bounds` is the smallest axis-aligned box around its corners.
- **Anchor.** The anchor is found in four steps:
  1. Take the horizontal line through the vertical centre of `bounds`.
  2. Intersect that line with the closed polygon, which gives one or more closed segments.
  3. Choose the widest segment. On a tie, choose the leftmost.
  4. The anchor is that segment's midpoint.

  For example, a U-shaped room with corners (0.10,0.10) (0.20,0.10) (0.20,0.40) (0.40,0.40) (0.40,0.10) (0.50,0.10) (0.50,0.50) (0.10,0.50) has its anchor at (0.15, 0.30). Keyboard and touch placement start at the anchor, and the plan's room label sits there.
- **Framing.** Selecting a row frames that room's `bounds`.

#### Pins and rooms

- **Rounding.** A pin is `x` and `y` between 0 and 1 (both ends allowed), measured from the plan image's top-left corner. The server rounds each coordinate to the nearest 0.0001, with halves rounding up, before storing it and deciding its room. Sync compares `from` and `to` as rounded values.
- **Inside.** A point is inside a room when it lies in the closed polygon, boundary included. A point in the notch of an L-shaped room is outside that room. A pin inside no room answers 422 with the published `pin` message.
- **Pin decides the room.** Setting a pin files the item in the room containing it. That applies on creation, PATCH, sync, resolve and plan revisions.
- **Shared edges.** When the pin lies on an edge or corner shared by two or more rooms, the room is chosen in this order:
  1. the `room_id` given in the same request or operation, if that room contains the pin
  2. otherwise, the item's current room, if it contains the pin
  3. otherwise, the earliest-created room that contains the pin
- **Re-filing.** A re-filed item keeps its number, status, photos, notes and links. A verified item that moves across a boundary stays verified, and one verified count moves from the old room to the new one. Job progress does not change.
- **Room changes.** Changing `room_id` alone clears a pin that is not inside the new room.
- **Pin status.** Any pin set makes `pin_status` `placed`. Clearing a pin through a room change makes it `unpinned`. A plan revision sets `needs_review` as set out below.

#### Plan revisions

- **Revision 1.** The first plan upload is revision 1. Each later upload takes the next number. Earlier revisions stay stored and listed, and the job always shows its latest revision.
- **Collinear points.** A revision's three old reference points must not lie in a line. When twice the area of their triangle is below 0.000001 in absolute value, the request answers 422 with the published `reference_points` message.
- **Room outlines.** The `rooms` outlines replace every room's outline. They follow every outline rule, overlap included, which answers 422 with the published overlap message on `rooms`.
- **The transform.** The server solves the affine transform exactly from the three pairs: T(p) = A·p + t, the one that maps each old point to its new point. Then it takes every pinned item in number order:
  1. It computes p′ = T(p) and rounds each coordinate to 0.0001, halves up.
  2. If p′ lies within 0 to 1 on both axes and inside a room by the new outlines, the item takes pin p′ and is re-filed by the pin rules, with its current room as the shared-edge tie-break.
  3. Otherwise its `pin` becomes null, its `pin_status` becomes `needs_review` and its room stays.
- **Response counts.** `moved` counts items whose pin value changed. `needs_review` counts the flagged ones.
- **Recompute.** Bounds, anchors, counts and cost rollups are recomputed in the same transaction.
- **Order of work.** The image object is stored and confirmed first, and only then do the database rows commit. A storage outage answers `storage_unavailable` and changes nothing: no revision and no pin moves.
- **Identity revisions.** A revision made by `PUT /plan` on a job that already has a plan uses the identity transform and keeps every outline.
- **Queued pins from older revisions.** When a sync operation's pin values are stamped with a `plan_revision` lower than the current one, the server maps them first. That covers `create_item.fields.pin` and both `from` and `to` of a `pin` change. It maps them through each later revision's transform in turn, rounding after each step, and only then validates and merges. A mapped `to` that falls outside 0 to 1 or inside no room is `rejected` with the published `pin` message.

#### Images

- Plan images and photos are accepted only when their content is JPEG, PNG or WebP, whatever the file name or declared type. Anything else, SVG included, answers `unsupported_image`.
- A file larger than 10,000,000 bytes answers `photo_too_large`. Exactly 10,000,000 bytes is allowed.
- Before storing, the server removes every embedded metadata block (EXIF, XMP and PNG text chunks).

#### Photos

- **Who.** The owner or lead carpenter uploads defect photos. The owner, the lead carpenter or the item's assigned trade uploads completion photos. Homeowners cannot upload. The owner, the lead carpenter or the uploader deletes a photo.
- **Confirmed only.** An upload answers 201, and the photo appears in any response, only after the object store has confirmed the object exists. An unconfirmed photo does not count towards the completion-photo rule.
- **Storage down.** If the store fails, the request answers `storage_unavailable` and nothing is recorded.
- **Deleting.** Deleting a photo removes the stored object first, then the record. If the object cannot be removed, the request answers `storage_unavailable` and the photo stays.

#### Notes

- **Audience.** A note's audience is `crew` (the owner, the lead carpenter and the item's trade) or `everyone` (homeowners too).
- **Homeowners.** Homeowners post only `everyone` notes; a `crew` note from a homeowner answers 403. A homeowner's reply to a crew note answers 404.
- **Replies.** A reply's parent must be a top-level note on the same item; a reply to a reply answers 422. A reply to a `crew` note must itself be `crew`, otherwise 422.
- **Who may edit.** A note's author may edit it, undo and redo on it. So may the owner and the lead carpenter, on any note they can see. Anyone else who can see the note gets `forbidden`.
- **Revision numbers.** A note's `rev` starts at 0 when it is created. Each applied edit, undo or redo adds 1, including an undo or redo that changes no visible character.
- **Positions.** Positions and lengths count Unicode code points, not UTF-16 units.
- **Character model** (the published merge rule):
  - A note is a sequence of characters. Each character remembers the revision that inserted it and the set of revisions that deleted it. No character ever leaves the sequence.
  - The creating revision inserts the original body.
  - A revision is active unless it has been undone and not redone. A character is visible when its inserting revision is active and no active revision deletes it. The body is the visible characters in sequence order.
  - The text at revision r is the body just after revision r, as listed in the history.
- **Applying an edit.** An edit with base `b`, position `p`, delete count `d` and insert text `s` applies in three steps:
  1. Let c₀ … c₍L−1₎ be the characters visible at revision `b`, in sequence order.
  2. **Delete.** The edit becomes a deleter of c_p … c_(p+d−1), whether or not they are still visible. Overlapping deletes by different people therefore all stick.
  3. **Insert.** The left boundary is c_(p−1), or the start of the note when `p` is 0. The right boundary is c_(p+d), or the end of the note when p+d equals L. Among the characters between the boundaries, consider only those inserted by revisions later than `b`. The new text goes immediately before the first of them whose author's job member `id` (from the members list, compared as lowercase strings) sorts after the editor's member id. When there is none, it goes immediately before the right boundary, or at the end of the note. A person's own characters never sort after them.
- **Worked example.** Take a note reading `Fix tile` at rev 3, where the owner's member id sorts before the lead carpenter's.
  - The owner inserts ` today` at position 8 on base 3, giving `Fix tile today`. The lead carpenter's phone then syncs an insert of ` grout` at position 8 on base 3. The result is `Fix tile today grout`. If the ids sort the other way, the result is `Fix tile grout today`, whichever edit arrives first.
  - If instead the owner deletes `tile` (position 4, delete 4, base 3) and the lead carpenter inserts ` grout` at position 8 on base 3, the result is `Fix  grout`, with two spaces.
- **Undo.** Undo makes the caller's most recent active edit revision on that note inactive. "Most recent" is by original rev. Other people's edits are skipped, and edits the caller made through sync count as their own. Undoing a delete brings its characters back in their exact place among anything others have typed around them, unless another active revision also deletes them. Undoing an insert hides that text even when others have edited next to it.
- **Redo.** Redo makes active again the edit revision the caller most recently undid, provided it is still inactive and the caller has applied no new edit to that note since that undo. Otherwise redo answers `nothing_to_redo`. With nothing to undo, undo answers `nothing_to_undo`. The creating revision cannot be undone.
- **Edits in sync.** `edit_note` never conflicts. It is `applied` or `rejected`. Undo and redo are online only.

#### Site visits

- **Ownership.** A visit belongs to one trade member of the job and has one or more occurrences.
- **Time conversion.** Times arrive job-local. Each occurrence converts to UTC with the job time zone's rules on that occurrence's own date, not today's offset. For example, on the seeded Hale job (`America/Chicago`), a 07:00 start on 2030-03-10 is `2030-03-10T12:00:00Z`, and on 2030-03-09 it is `2030-03-09T13:00:00Z`.
- **Odd local times.** A local time that does not exist on a date answers 422 on its field. A local time that occurs twice uses its first occurrence.
- **Recurrence rule.**
  - `freq` `daily` repeats every date from the start date.
  - `weekly` repeats on the listed `weekdays` every week. They must be non-empty with no repeats, and the start date must fall on a listed weekday.
  - `every_n_days` repeats every `interval` days, 2 to 30.
  - `weekdays` is allowed only for weekly, and `interval` only for every_n_days.
  - Exactly one of `until` or `count` is given. `until` is a job-local date, inclusive, on or after the start date. `count` is 1 to 60.
  - Dates are calendar dates in the job's time zone, and every occurrence keeps the series' wall-clock start and end times.
  - Every failure answers 422 on `recurrence`.
- **Size limits.** A rule that gives more than 60 occurrences, or whose last occurrence falls more than 180 days after the first, answers 422 on `recurrence`. Exactly 60 occurrences, and exactly 180 days, are allowed. For example, every 4 days for 46 occurrences spans exactly 180 days and is accepted, and 47 is refused. The server judges a rule's validity, size limits included, by date arithmetic alone, before it expands or stores any occurrence.
- **Overlap.**
  - An occurrence overlaps another occurrence of the same member on the job when their intervals overlap. Each interval includes its start and excludes its end, so one may begin when another ends.
  - Only non-cancelled occurrences count, and moved ones count at their new times.
  - An overlap answers 409 `visit_overlap` with `occurrence_date`, the earliest job-local date among the new visit's occurrences that overlaps.
  - The check uses the times as sent. When the recurrence fails validation, or the times cannot be read, or the end is not after the start, only the first occurrence is checked, and an unreadable one overlaps nothing.
  - Under the API-wide precedence, an overlapping request answers 409 even when it would also fail a 422 check.
  - Of simultaneous requests whose occurrences overlap for the same member, exactly one answers 201.
- **Validation.** Every failing field is reported. Per occurrence, the first failing check in this order decides the message:
  1. Either time cannot be read, or the end is not after the start: 422 on that field.
  2. `ends_at` falls on a later job-local date than `starts_at`: 422 on `ends_at`.
  3. `starts_at` is before 07:00 job-local (422 on `starts_at`), or `ends_at` is after 19:00 job-local (422 on `ends_at`). Exactly 07:00 and exactly 19:00 are allowed.
  4. The first occurrence's end is at or before the server's current time: 422 on `ends_at`.
- **Moving an occurrence.** A move re-runs the per-occurrence checks, including the current-time check on the moved occurrence, and the overlap check against everything except itself. The occurrence keeps its original `date` and becomes `moved`, and may move to another date.
- **Cancelling an occurrence.** A cancel makes it `cancelled`. A cancelled occurrence still uses up one of `count`.
- **Exception errors.** A date the rule never generated, or an occurrence that is already cancelled, answers 404. Moving or cancelling an occurrence whose end has passed answers `invalid_transition`.

#### Access codes

- The owner and lead carpenter may read the access card at any time. A homeowner never may.
- A trade may read it only while one of their non-cancelled occurrences on that job has an open code window. The window opens 30 minutes before the occurrence's UTC start (that moment included) and closes at its UTC end (that moment excluded), judged by the server's clock.
- For a trade, `visible_until` is the latest UTC end among their open windows.
- `access_codes_available` and `next_visit` in Job follow the same occurrences at the moment of the request.
- Every successful read of the access card records one reveal with who and when.

#### Offline merge

Each field in an `update_item` merges on its own:

| Field | Server value equals `from` | Server value already equals `to` | Otherwise |
|---|---|---|---|
| `title`, `cost_note`, `quantity`, `unit_cost`, `trade` | apply `to` | nothing changes; counts as applied | keep the server value and record a conflict |
| `pin` | apply `to` and re-file the room | nothing changes; counts as applied | the phone wins: apply `to`, re-file the room, and record a conflict whose `server_value` is the replaced value |
| `room_id` sent without `pin` | apply `to`, clearing a pin not inside the new room | nothing changes; counts as applied | keep the server value and record a conflict |
| `room_id` sent with `pin` in the same operation | not merged; used only as the shared-edge tie-break for the pin | | |

- **Conflict contents.** A conflict holds two pairs: the value kept or replaced on the server with whoever set it (`server_value`, `server_by`), and the phone's `to` with the syncing person's name (`phone_value`, `phone_by`). A null pin reads `No pin`, and a null quantity or unit cost reads `No value`.
- **Pin example.** Suppose the owner changed an item's room, which cleared its pin, and the phone then moves that pin from its old spot. The phone's pin is applied, the item is re-filed into the room that contains it, and the conflict records `No pin` as the server value.
- **Outcome.** The operation's outcome is `conflict` if any field recorded one. Its other fields still merge on their own.
- **Nothing is dropped.** Neither value is ever lost. A later conflict on the same field replaces the recorded phone value.
- **Clearing.** Resolving a conflict, or an online PATCH on that field, sets the value and removes that field's conflict.
- **Other operation types.** `create_item`, `item_action`, `add_note` and `edit_note` never conflict.

#### Money

- **Quantity.** `quantity` is a decimal string from `0.001` to `9999.999` with up to three decimals, or null.
- **Unit cost.** `unit_cost` is a decimal string from `0.00` to `99999.99` with up to two decimals, or null.
- **Format.** Neither value takes a sign, an exponent or a JSON number. A violation answers 422 on the field.
- **Line total.** `line_total` is quantity times unit cost, computed exactly, then rounded half to even to cents. It is `0.00` when either value is null.
- **Rollup.** Costs `as_of` a moment are computed from:
  - `items_subtotal`: the sum of the current line totals of all items, with no further rounding. Items are not effective-dated.
  - `by_room`: every room in creation order, `0.00` rooms included.
  - `by_trade`: always these eight rows in this order: electrical, plumbing, tile, paint, carpentry, hvac, flooring, then null for crew items. Room and trade subtotals cover items only.
  - `change_orders_total`: the sum of `amount` over change orders whose `approved_at` is at or before `as_of`.
  - `contingency_percent`: the latest setting whose `effective_at` is at or before `as_of`, or `0.00` when there is none. A setting takes effect at the moment of its request.
  - `contingency`: (items_subtotal + change_orders_total) × percent ÷ 100, rounded half to even to cents. It is computed once on the job total and never per room. It is `0.00` when that base is below zero.
  - `total`: items_subtotal + change_orders_total + contingency.
- **Published examples.**
  - 2.5 × 0.05 gives `0.12`, and 1.5 × 0.05 gives `0.08`.
  - A contingency of 0.50% on 1.00 is `0.00`, and on 3.00 it is `0.02`.
- **Sync labels.** Quantity and unit cost merge in sync as in the table above, with the conflict labels from Public screens and controls.

#### Blocked-by links

- **Links.** An item waits on 0 to 10 other items of the same job, and its `blocked_by` lists them.
- **Cycles.** An item may not wait on itself, directly or through a chain. Such a change answers 422 with the published `item_ids` message. Of two simultaneous changes that together would close a cycle, exactly one answers 200 and the other answers that 422.
- **Finished items.** Adding a blocker that is not verified to an item in `ready_for_check` or `verified` answers `blocked`.
- **Reopen cascade.** When the owner reopens item X, the server takes every item that depends on X, directly or through any chain of items whatever their status. Each of those in `ready_for_check` or `verified` becomes `open` with `sent_back_reason` cleared, in the same transaction. Each cascaded item counts as a change for the daily summary.

#### Bulk actions

- **Order of checks.** Any id that is not visible answers 404 for the whole request. Then role is checked: a trade's `verify` or `set_trade`, or any homeowner request, answers 403 for the whole request before any item is evaluated.
- **Evaluation.** Items are evaluated in ascending item number. Each is judged against the state left by the earlier items in the same request, using the single-action rules. A `set_trade` item follows the trade-change rule. So if item 3 blocks item 5, verifying both together succeeds, and if item 5 blocks item 2, item 2 fails.
- **Success.** When every item succeeds, everything commits in one transaction.
- **Failure.** When any item fails, the request answers `bulk_failed` listing every failing item. The remaining items are evaluated as if the successful ones had applied. Nothing commits, no email is queued and no event is emitted.
- **Notices.** A successful `set_trade` queues its assignment notices in the same transaction.

#### Event stream

- **Sequence numbers.** Each job has one event log. Every event a committed write produces takes the next per-job sequence number in commit order, starting at 1, with no gaps.
- **Which writes produce events.** Writes to items (their notes, photos, conflicts and links included), rooms, the plan, visits, change orders, contingency and the job stage produce events, and so does a role ending. A commit that changes counts also produces one `counts` event, and a commit that changes any figure of the Costs object for now also produces one `costs` event. Adding members, the access card, reveals and the outbox produce none. Seeded records produce none, so a seeded job's log starts empty.
- **What emits nothing.** Duplicate replays, rejected operations, failed bulk requests and refused requests emit nothing. A sync emits the events of its applied and conflict operations in `seq` order.
- **Delivery.** Each caller receives only the events in their scope, projected for their role. Scope and projection are judged at delivery time. A caller's ids therefore strictly increase and may skip numbers. A client never receives an event before an earlier-numbered event it is entitled to.
- **Every process.** Events reach open streams on every server process that shares the database within 2 seconds of commit.
- **Retention.** The log keeps the last `EVENT_RETENTION_COUNT` events per job.
- **Resuming.** A resume point is served when every event after it is still kept. The stream then sends exactly the missed in-scope events in order, then live events, with no duplicates. A resume point that is older than the kept events, or higher than the latest number, first gets a `reset` event whose id is the latest number, then live events.
- **Closing.** A stream closes after `role_ended`. Sign-out or a password change closes that session's streams within 2 seconds.

#### Derived counts

- **Room counts.** A room's `counts.verified` and `counts.total` cover the items in that room within the caller's scope.
- **Job progress.** `progress` covers every item within the caller's scope. `percent` is the verified share rounded down to a whole number, or 0 with no items. Deleted items count nowhere.
- **One calculation.** These values come from one calculation shared by the item list, the plan's room labels, the job header, the event stream and the summary email. They are correct in the response to every transition, cascade, re-filing, plan revision, deletion, bulk action and sync.

#### Assignment notices

- **When a notice is queued.** An applied change that gives an item a non-null trade different from its previous trade queues one notice for each active member with that trade on the job. Such changes are:
  - creation with a trade
  - a trade change by PATCH, sync or bulk `set_trade`
  - resolving a trade conflict to a different trade
- **No notice** is queued for:
  - a change that keeps the same trade
  - a sync field whose value already equalled `to`
  - a `duplicate` replay
  - a `rejected` operation
  - a trade field that ended in a conflict
  - a failed bulk request
  - a member added after the assignment
- **Repeated changes.** Each applied change counts. Electrical to plumbing and back to electrical queues three rounds. A sync that creates an item with one trade and later changes it to another queues one round for each.

#### Daily walkthrough summary

- **Due time.** A job's summary for job-local date D is due at the daily summary time on D. That time is set by `SUMMARY_LOCAL_TIME`, a job-local 24-hour `HH:MM`, and is 18:00 when unset. The server checks at least every 30 seconds.
- **When it is queued.** On each check, for every active or walkthrough job with at least one homeowner, the server queues one summary per homeowner when all of these hold:
  - the job-local time is at or after the daily summary time
  - no summary has been queued for D
  - the window holds changes
  - the latest change in the window is at least `SUMMARY_QUIET_SECONDS` seconds old. This is a whole number from 0 to 60, both ends allowed, and 60 when unset.
- **Window.** A summary's cut-off is the moment it is queued. Its window runs from the previous cut-off, or the job's creation, excluded, to this cut-off, included. For a seeded job the first window starts at the seed.
- **What counts as a change.** Item creations, item actions (cascaded reopens included), re-filings to another room by any cause, and item deletions. Seeded records are not changes.
- **Items listed.** Each affected item is listed once, in number order, with its title and status at the cut-off. An item deleted in the window that existed at the previous cut-off is listed as removed, with its title at deletion. An item both created and deleted inside the window is not listed.
- **Counts and visits.** The room and percent lines come from the derived-count calculation at the cut-off, in a homeowner's scope. The visit lines list every non-cancelled occurrence, of any member, whose job-local start date is D+1, expanded at the cut-off. They run in start order, then in trade order as listed under Money.
- **Later changes.** Changes made after D's summary was queued wait for the next day's summary.
- **Example.** A deployment runs with `SUMMARY_LOCAL_TIME` `00:00` and `SUMMARY_QUIET_SECONDS` `15`. On the seeded Hale job, someone creates an item, acts twice on item 1, moves item 6's pin into Laundry and deletes item 4, each change less than 15 seconds after the last. Within 45 seconds of the last change:
  - that deployment's outbox for the job holds exactly one summary entry to Priya Hale for that date
  - that deployment's messages, identified as set out in Services, hold exactly one summary to her
  - the summary lists items 1, 4, 6 and the new item once each, in number order, with item 4 reading `Removed`

  A further change that day queues no second summary.

#### Sessions

- A session ends on sign-out, on password change, or after `SESSION_IDLE_MINUTES` minutes without a request (default 720).
- Changing a password ends every other session of that account at once. Their next request answers 401 and their streams close. The session that made the change stays signed in.

### Services (DP-03, DP-24, DP-35, DP-36, DP-38, DP-41, DP-50, DP-57)

**Postgres** (`DATABASE_URL`) is the system of record. It holds:
- firms, people and password hashes
- jobs, rooms with their corner lists, plan revisions with their reference points
- job roles and sessions
- punch items with pins, pin status, costs and blocked-by links
- notes with their character sequences and revision history
- photo records and the per-job item number counter
- visit series with their rules and occurrence exceptions
- the access card and the code-reveal log
- change orders and contingency settings
- the offline operation log, with client id mappings, and conflicts
- the per-job event log
- the mail outbox

Apply the schema idempotently every time a server process starts, and insert the seed data when it is missing. Several processes may start at the same moment; none of them ever duplicates seed data.

**Object store** (MinIO through the S3 variables). Objects go in `S3_BUCKET` under these keys:
- `jobs/<job id>/plan/<object id>.<ext>`, one object per plan revision
- `jobs/<job id>/items/<item id>/photos/<photo id>.<ext>`

`<ext>` is `jpg`, `png` or `webp` from the detected type, and each object is stored with that content type. The browser receives images only through the app's own endpoints. After an item is deleted, nothing remains under its photos prefix. After close-out, nothing remains under `jobs/<job id>/`.

When storage is unreachable:
- These answer `storage_unavailable` and change nothing: plan upload, revision upload, photo upload, photo delete, deleting an item with photos, and close-out.
- The plan, revision and photo image endpoints answer 503 with the same body for records that still exist.
- The plan pane shows the plan-unavailable copy.
- Everything else keeps working.

**Mail** (SMTP at `SMTP_HOST`:`SMTP_PORT`, no authentication or TLS).
- Every message's From line is `Snaglight <notices@snaglight.example>`. The environment provides it as `MAIL_FROM`; read the sender from there, and use the same value when it is unset.
- Each message has a plain-text body.

**Assignment notice**
- **To**: the trade member's email.
- **Subject**: `Snaglight: new item on <job name>`.
- **Body**: these lines, using the title and room as they were when the notice was queued:
  - `Item <n>: <title>`
  - `Room: <room>`
  - `Sign in to see the details: <APP_PUBLIC_URL>/signin`

**Daily walkthrough summary**
- **To**: each homeowner's email.
- **Subject**: `Snaglight: walkthrough summary for <job name>, <YYYY-MM-DD>`, with the job-local date.
- **Body**, in this order:
  1. `<percent>% verified (<verified> of <total> items)`
  2. one line per room: `<room>: <verified> of <total> verified`
  3. one line per tomorrow occurrence: `Visit <YYYY-MM-DD> <HH:MM> to <HH:MM>: <trade label>`, or the single line `No site visits tomorrow` when there are none
  4. one line per listed item: `Item <n>: <title> — <status label>`, or `Item <n>: <title> — Removed`
  5. `Sign in to see the details: <APP_PUBLIC_URL>/signin`

Each body is exactly its listed lines in order, joined by single line breaks, with no blank lines and no other text. A CRLF on the wire counts as one line break, and one trailing line break is allowed.

**Deployments and links.**
- Server processes that share one database form one deployment. Several deployments may share one mail server, and their messages may share recipients and subjects.
- Every server process is started with its own `APP_PUBLIC_URL`, and no two processes share one, even within a deployment.
- An entry's sign-in link is fixed when the entry is queued, built from the `APP_PUBLIC_URL` of the process that queued it, and stored with the entry. Whichever process later sends the entry sends that stored link unchanged.
- A message therefore belongs to the deployment that includes the process whose `APP_PUBLIC_URL` starts its sign-in link.
- Every per-recipient count in this brief is judged among one deployment's messages, alongside its outbox: one notice per applied change, and at most one summary per job-local day.

**What email never contains.** No email ever contains:
- an access code or the house note
- the address
- a cost note, quantity, unit cost or any other amount
- any note text
- a send-back reason
- a phone number
- a member's name in a visit line
- any link other than the sign-in link

**Outbox.**
- Every email is written to the outbox in the same transaction as the change that caused it, so the change succeeds whether or not mail is reachable.
- A sender tries each queued entry at once, then at least every 30 seconds until the SMTP server accepts it, and then marks it `sent`.
- An entry is claimed before it is sent. Each entry produces exactly one delivered message, even when several server processes share the database and all run senders.
- While mail is unreachable, entries stay `queued` and the Outbox tab shows `Not sent yet`. Mail may stay unreachable for a server's whole life. Its entries then stay queued, and nothing is lost.

### Seed data (DP-01, DP-02, DP-03, DP-29, DP-39, DP-40)

Every person, firm, address and code below is invented. The app starts with exactly these records and nothing else. Restarting the server adds no duplicate person, job, room, revision, item, note, visit, change order or photo. Every seeded account has the password `paper-plan-2026`. The firm is **Larchmere Renovation Co.**

| Person | Email | Phone | Role |
|---|---|---|---|
| Dana Whitcombe | dana@larchmere.example | 555-0101 | firm owner |
| Ravi Okafor | ravi@larchmere.example | 555-0102 | lead carpenter on both jobs |
| Marco Ruiz | marco@brightwire.example | 555-0141 | trade, Electrical, Hale job |
| Tess Lindqvist | tess@lindqvisttile.example | 555-0142 | trade, Tile, Hale job |
| Paul Ferrante | paul@ferrantepaint.example | 555-0143 | trade, Paint, both jobs |
| Priya Hale | priya.hale@example.com | 555-0177 | homeowner, Hale job |
| Sam Oduya | sam.oduya@example.net | 555-0188 | homeowner, Oduya job |

**Job "Hale kitchen and bath"**
- Address 14 Orchard Lane, Maple Falls. Time zone `America/Chicago`. Stage active.
- Access card:
  - lockbox `4826`
  - alarm `7319`
  - garage `5550`
  - house note `Biscuit the dog stays in the laundry room; keep that door shut.`

Rooms, in creation order, with corners in the order returned:

| Room | Corners (x, y) | Bounds x, y, w, h | Anchor |
|---|---|---|---|
| Kitchen (L shape) | (0.04,0.05) (0.52,0.05) (0.52,0.30) (0.40,0.30) (0.40,0.47) (0.04,0.47) | 0.04, 0.05, 0.48, 0.42 | (0.28, 0.26) |
| Primary bath | (0.58,0.05) (0.96,0.05) (0.96,0.45) (0.58,0.45) | 0.58, 0.05, 0.38, 0.40 | (0.77, 0.25) |
| Hall (L shape) | (0.04,0.53) (0.44,0.53) (0.44,0.75) (0.50,0.75) (0.50,0.95) (0.04,0.95) | 0.04, 0.53, 0.46, 0.42 | (0.24, 0.74) |
| Laundry | (0.50,0.53) (0.96,0.53) (0.96,0.95) (0.50,0.95) | 0.50, 0.53, 0.46, 0.42 | (0.73, 0.74) |

Reference points on this plan:
- (0.55, 0.50) lies outside every room.
- (0.46, 0.40) lies in the Kitchen's notch, so it is outside every room.
- (0.50, 0.85) lies on the edge Hall and Laundry share.
- (0.70, 0.80) lies inside Laundry.

| # | Room | Title | Trade | Status | Pin | Cost note | Created by |
|---|---|---|---|---|---|---|---|
| 1 | Kitchen | Touch-up paint by the window | paint | open | 0.30, 0.12 | Leftover wall paint in garage; no charge | Ravi Okafor |
| 2 | Kitchen | Pendant over island flickers | electrical | in_progress | 0.24, 0.30 | Fixture under supplier warranty | Ravi Okafor |
| 3 | Primary bath | Regrout shower corner | tile | in_progress | 0.86, 0.16 | none | Ravi Okafor |
| 4 | Primary bath | Caulk gap behind vanity | none | open | 0.70, 0.32 | none | Ravi Okafor |
| 5 | Hall | Outlet cover missing by closet | electrical | open | none | none | Dana Whitcombe |
| 6 | Hall | Door sticks at the head | none | verified | 0.20, 0.72 | none | Ravi Okafor |

- Pinned items have `pin_status` `placed`, and item 5 has `unpinned`.
- No item has a quantity, unit cost or blocker.
- Notes, all at `rev` 0:
  - Item 2 has a `crew` note by Ravi Okafor: `Marco thinks it's the dimmer; bring a spare.`
  - Item 1 has an `everyone` note by Priya Hale: `There's also a scuff on the base cabinet.`, with an `everyone` reply by Ravi Okafor: `We'll cover it with the window touch-up.`
- Marco Ruiz has one visit with no recurrence: 2030-03-04, 08:00 to 12:00 job-local.
- Laundry has no items. No item has a photo.
- The job has no change orders and no contingency setting, so its percent reads `0.00`.
- The outbox is empty, and the event log is empty.

For example, with the seed data at start:
- the job reads `16% verified`
- Hall reads `1 of 2 verified`
- pressing P on item 2 reads `Placing pin for item 2: 28% across, 26% down.`
- the costs total is `0.00`

**Job "Oduya basement"**
- Address 9 Quarry Road, Ridgeview. Time zone `America/Denver`. Stage active.
- Access card:
  - lockbox `1193`
  - alarm `6604`
  - garage `2871`
  - house note `Side door sticks; lift the handle.`
- Rooms:
  - Rec room: (0.05,0.05) (0.65,0.05) (0.65,0.65) (0.05,0.65)
  - Utility: (0.70,0.05) (0.95,0.05) (0.95,0.45) (0.70,0.45)
- Items, both created by Ravi Okafor:
  1. Rec room, `Baseboard gap at stair`, paint, open, pin 0.30, 0.30
  2. Utility, `Label the panel circuits`, electrical, open, no pin
- No visits, change orders or contingency.

Each seeded job has plan revision 1, uploaded by Dana Whitcombe, with 0 pins moved and 0 needing review. Its image ships with the app: an invented PNG line drawing in a 3:2 landscape shape showing the rooms above. The image is uploaded to the object store on the first start where storage is reachable. If storage is unreachable at start, the database seed still completes, and the plan endpoint answers as set out in Services until a later start uploads the image.

## Technical requirements

### Deployment (DP-43)

The container provides Node.js 22 LTS with npm. Write the app in TypeScript. At `/app/run.json`, provide string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

The `serve` command starts one process that serves the API, the event stream and the built front end on `0.0.0.0`. It listens on the port in `APP_PUBLIC_PORT` when set, and on 4173 otherwise. It answers `GET /api/health` with HTTP 200 and `{"status":"ok"}` once it accepts requests. Each process applies the schema and seed on start. Several server processes may run against the same database, bucket and mail server at once, and every rule in this brief holds across them.

### Configuration and secrets (DP-50)

The server reads these at start:
- `DATABASE_URL`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `SMTP_HOST`, `SMTP_PORT`
- `MAIL_FROM`: the From line in Services
- `APP_PUBLIC_URL`: this process's own public base URL, used for links in email as set out in Services. When unset, use `http://localhost:<port>`
- `APP_PUBLIC_PORT`
- `SESSION_IDLE_MINUTES`
- `SUMMARY_LOCAL_TIME` and `SUMMARY_QUIET_SECONDS`, as set out in Business rules
- `EVENT_RETENTION_COUNT`: a whole number from 10 to 100,000, both allowed, default 1000

Every server process receives its own `APP_PUBLIC_PORT` and `APP_PUBLIC_URL` from the environment; use them exactly as given. No credential or service URL is hard-coded in source or sent to the browser. Passwords are stored only as salted slow hashes.

### Server boundary (DP-05, DP-44)

- **Same origin.** The app sends no cross-origin sharing headers. A state-changing request whose `Origin` header names another origin answers `cross_origin`.
- **Size limits.** Body size limits are those in API.
- **What it serves.** The server serves only the built front-end assets, the bundled fonts, the API and the event stream. It never serves source files, `run.json`, environment files, lockfiles or anything outside the build output. An unknown path outside `/api` answers the app shell, so client routes work.
- **Checks.** Every API route checks the session and the caller's role on the job and on every nested or body id, as set out in API.
- **Long-lived streams.** An event stream stays open for as long as the client keeps it, until one of the closing rules in Business rules ends it.
- **Postgres at boot.** If Postgres is unreachable at start, the server retries for up to 60 seconds, then exits with an error.
- **Storage and mail.** If the object store or mail server is unreachable, at start or later, the server still starts, answers health, and behaves as set out in Services.

### Browser support and performance (DP-15, DP-46, DP-68)

- **Browsers.** Current Chromium, Firefox and WebKit.
- **Viewports.** 375x812 with touch, 768x1024 and 1280x800.
- **Load time.** With seed data, the job view is usable within three seconds of navigation on the local server.
- **Optimistic display.** A quick-added row, an edited field or an action shows on screen before the server answers.
- **Live changes.** Other people's changes appear within 2 seconds while online, as set out in Interactions.
- **Offline.** The app works offline after one online visit.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, and no other way of starting the app is required.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package with its version and licence. Shipped packages are the production dependency tree that `npm ls --omit=dev --all --json` reports, plus every bundled font.
- IF-03: Every shipped package and bundled font is licensed under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or SIL OFL 1.1.
- IF-04: The server uses no datastore other than the provided Postgres, object store and mail server: no SQLite, no Redis, no embedded database, and no files written as a database on the server. This rule covers the server only; the browser may keep the cached job and the offline queue in IndexedDB or localStorage.
- IF-05: The provided service configuration and environment variable names are used as given and are not modified.
- IF-06: All application source is TypeScript. JavaScript files appear only as tool configuration or build output.
- IF-07: The running app makes no request to any third-party origin. The app serves fonts, icons and the seed plan images itself.

## Engineering standards

- The TypeScript is idiomatic and strictly typed, with no `any` in domain code. Names match this brief's domain terms: job, room, outline, anchor, plan revision, punch item, pin, trade, blocker, site visit, occurrence, access card, reveal, change order, contingency, outbox entry, conflict, operation log, event.
- Each domain rule is decided in exactly one place in the source, and every caller uses it. That covers:
  - the item lifecycle table and item deletion permissions
  - the room outline checks, the inside and shared-edge rules, and the anchor
  - the plan transform and pin mapping, and the per-field merge policy
  - the note character model with undo and redo
  - recurrence expansion, the site-visit checks and time conversion, and the code window
  - role scoping and field projection
  - money rounding and cost rollups
  - dependency checks and the reopen cascade, and bulk evaluation
  - the assignment-notice rule, the derived counts, and event sequencing
- There are no abstractions with only one implementation and no layers that only forward calls.
- There is no dead, commented-out or unreachable code, and no defensive checks for states the types and schema already rule out.
- Money and code-point positions are never handled as binary floating-point values or UTF-16 offsets.
- Every error leaves the server in the single error shape and catalogue from API.
- Database changes that belong together commit in one transaction. For example: an item change with its outbox entries and events; an operation with its log record; a bulk action as a whole; a deletion's rows once its objects are gone.
- The source contains no feature, endpoint, screen or setting beyond this brief.
