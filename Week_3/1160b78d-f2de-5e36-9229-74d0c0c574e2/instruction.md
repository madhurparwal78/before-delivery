# Tarecross Software Switchlamp

Switchlamp is the on-call and incident desk of Tarecross Software, an invented 60-person firm whose transport management, carrier data exchange and shipment tracking systems keep other companies' trucks moving. Responders, leads and admins sign in to hold the pager, keep every hour covered and set up the firm's services, and stakeholders read a public status page. It uses Postgres as the system of record, RabbitMQ to carry monitoring events, Valkey for the shared rate counter and cached responses, Mailpit as the mail receiver, and WireMock as the outside webhook receiver. Out of scope: other tenants, self-registration, SMS or voice calls, phone apps, billing, importing from another tool, and any datastore beyond those named here.

## Problem and users

A fault at 04:00 at Tarecross becomes missed pickups and overtime on a customer's dock within the hour. The firm's rota lives in a hosted tool whose support ends on 5 April 2027, and the alternatives it has priced charge for every seat whether or not that person is ever paged. A move is risky because the real rules were never written down: who holds a shift after a clock change, why a rotation drifted by an hour, which alerts belong to one incident, and why a page went to someone who had already handed off. Engineers pay in broken nights and double pages, and customers pay in stale status notices. Switchlamp writes those rules down and enforces them.

- **Responder** (daily): holds the pager, acknowledges fast from a phone or the keyboard, then works the incident to resolved without a double page.
- **Lead** (daily): keeps schedules, overrides and escalation policies covering every hour, and merges or reassigns incidents during a bad night.
- **Admin** (weekly): sets up services, integrations, maintenance windows, webhooks, API keys and roles for the whole firm.
- **Stakeholder** (occasional): reads the status of services and published updates with no responder detail in view.

## Journeys

1. **Event intake and the log.** A monitor posts a critical event for a service with nothing open. It is accepted, one incident opens, repeats join its alert, and after a resolve the same key opens a new alert. End: a lead watching the integration page saw each event land, and every dropped one, in exact words.
2. **A noisy integration.** A lead keeps an integration page open as a monitor floods it. The counter climbs to the limit, the endpoint refuses further events, and the countdown runs to zero in place. Messages arrive twice and out of order, and a malformed one reaches the dead letters. End: the lead uses Replay and the event applied once.
3. **Grouping and urgency.** Alerts for one service land inside and after its grouping window. End: they joined or opened incidents by the published rule, and a joining critical alert raised a low-urgency incident and notified its holder.
4. **The escalation walk.** A high-urgency incident runs through its levels and repeats on the server clock, skipping a level with nobody on call. End: two tabs and a reload showed the same level, holder and countdown throughout.
5. **Editing a policy.** A lead reorders levels by dragging and another lead does the same by keyboard, with the same saved result. End: a running incident keeps the version it opened with while a later one takes the edit, and the page says so.
6. **Reading the final schedule.** A lead reads layers and the computed final row for a chosen range and zone from the address. End: the blocks measure to scale on screen, one person or a flagged gap at every moment, and a layer edit changed only the future.
7. **A clock-change week.** A lead opens a rotation across a daylight saving change, where the 23-hour or 25-hour day is drawn to scale. They use Handoff Cut by pointer and by keyboard to take an hour of a shift. End: the lead saw who loses which minutes before releasing, and every open screen shows the same blocks within a second.
8. **Who is on call.** A responder keeps the on-call screen open across a handoff, an edit and a cache outage. End: a fresh load and every open screen named the new person at the exact second, and the calendar feed follows until its token is revoked.
9. **Being paged.** A holder gets an in-app notice at once and mail at their chosen delays, with low urgency held through quiet hours, and acknowledges from the mail link. Mail goes dark and returns. End: each message arrived once and a second use of the link changed nothing.
10. **Triage from the keyboard.** A responder is on the incident list as several events land together, in a saved filter from the address. They move with J and K, select with X, acknowledge with A and resolve through the dialog from R. End: each event was announced once, in order, each row reported its own result, and focus sits on the exact row the rules name.
11. **Working an incident.** A responder keeps a note draft across a reload and a second tab, asks a colleague to join, and a lead posts a status update. End: the timeline reads in server order, the first of two decisions won, and the other person saw who made it.
12. **Timers and reassignment.** A lead sets an acknowledge timeout, snoozes, lets auto-resolve run and reassigns to another service. End: each timer fired at its exact second on the screen and the old service stays listed as impacted.
13. **Merge and split.** A lead merges related incidents into one open target, then splits an alert off again. End: later events on a moved key land where the alert lives and the combined timeline stays in time order.
14. **Maintenance.** An admin schedules a window. End: its banner appeared and cleared on the exact second on two screens, events in between were logged as suppressed, and open incidents stayed as they were.
15. **Telling customers.** A lead publishes a status update while a responder adds private notes, and a stakeholder reads the map and the public page. End: the public page's plate crossfades, each subscriber gets one mail, and no note, draft or responder name appears on the page, in its cached copy or in the mail.
16. **The phone journey.** A responder at 375 px works the list, acknowledges, snoozes, reassigns, writes a note and checks who is on call. End: nothing overflowed, and no field was hidden behind the fixed action bar.
17. **Analytics.** A lead runs a measures job and reloads while it runs. End: progress carried on, the figures match the published formula, and the download matches the screen.
18. **Firm housekeeping.** An admin subscribes an outside endpoint, rotates an API key and changes a responder's role. Webhook attempts appear with the receiver's own status and body, and Replay keeps the event id. End: the old key stops at the end of its grace, the responder's open screens switch at once, and the data survives a restart.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Accepted means confirmed.** Answer an intake event as accepted only after the broker has confirmed holding it, as qualified in Services.
- **DP-02 — Intake refusals.** Refuse an invalid intake request with the exact status and body in API, and publish nothing for it.
- **DP-03 — Rate limit in the shared cache.** Limit each routing key by the Business rules window, counted in Valkey.
- **DP-04 — One effect per event in acceptance order.** Apply events for one dedup key in acceptance order whatever order or number of copies arrives, so a repeated copy never makes a second alert or timeline entry.
- **DP-05 — New alert after a resolve.** After a resolve, open a new alert for the same dedup key and never reopen the old one.
- **DP-06 — Alert grouping modes.** Group a service's new alerts by its grouping mode of none, a time window or until resolved, as qualified in Business rules.
- **DP-07 — Live integration page.** Show the counter, the Retry-After countdown and the event log changing in place within a second with no reload.
- **DP-08 — Exact event log reasons.** Show every dropped or refused event in the integration log with its exact published reason.
- **DP-09 — Dead letters after retries.** Move a message that cannot be applied to the dead-letter queue after the published retries and list it with its exact reason.
- **DP-10 — Replay applies once.** Apply a dead letter exactly once through Replay, with or without a correction, and remove it from the dead-letter queue.
- **DP-11 — Stable incident paging.** Page the incident list so no row repeats or goes missing under live arrivals while the total stays exact.
- **DP-12 — Keyboard triage.** Triage the incident list with J, K, X, A and R alone, with the published focus after each action and focus returned to the opener of any closed dialog.
- **DP-13 — Announced once in order.** Announce each decided event once, in order, in the polite status region present from first paint.
- **DP-14 — Socket replay.** Replay what a page missed after a socket drop, with nothing applied or announced twice.
- **DP-15 — Incident state machine.** Allow only the published incident transitions and reject every other one with its exact response.
- **DP-16 — First decision wins.** Let exactly one of several simultaneous requests that exclude each other succeed on an incident, and tell the others who made the decision.
- **DP-17 — Snooze rules.** Snooze only an acknowledged incident, for a published preset or a custom time within the published limit, and end or cancel the snooze as Business rules state.
- **DP-18 — Acknowledge timeout and auto-resolve.** Run the acknowledge timeout and auto-resolve timers as qualified in Business rules, with auto-resolve applying only to incidents opened after it was set.
- **DP-19 — Exact timer edges.** Decide every action at a timer's edge by the server clock alone under the single published edge rule.
- **DP-20 — Notes and server-kept drafts.** Keep each person's unfinished note on the server, and create exactly one note and one timeline entry from a double submit.
- **DP-21 — Operator clock.** Provide the operator control that moves or holds the one server clock so every timer can be checked exactly.
- **DP-22 — Escalation policy limits.** Enforce the published timeout, target and repeat limits on escalation policies, and refuse a save over a newer version.
- **DP-23 — Escalation run.** Move an incident through its levels and repeats at each exact timeout, skipping a level that has nobody on call.
- **DP-24 — Opened-with policy.** Keep a running incident on the policy as it stood when opened while later incidents take an edit, as qualified in Business rules.
- **DP-25 — Server-owned countdown.** Show the server's countdown value in every tab and after a reload, whatever the device clock says.
- **DP-26 — Delayed notification steps.** Send each person's notification steps by mail at their exact delays, once each, while the incident still needs that person.
- **DP-27 — Handoff moves a page.** Move an unacknowledged incident to the new holder at the handoff second so no later step goes to someone who has handed off.
- **DP-28 — Quiet hours hold.** Hold a low-urgency notice through the holder's quiet hours and send it at their end in that person's own zone.
- **DP-29 — Sent only after mail accepts.** Mark a step as sent only after the mail server accepted it, show unsent steps as queued, and send each once after mail returns with no restart.
- **DP-30 — Signed acknowledge link.** Let the signed link in a mail acknowledge an incident once, and show the published page word for word when it is used, out of date or invalid.
- **DP-31 — Merge and split.** Merge incidents so alerts move with their keys and later events land on the target, and let a moved alert be split off again.
- **DP-32 — Reassign.** Reassign an incident to a person or a service with the published effects on its status, snooze, timers and policy.
- **DP-33 — Analytics and download.** Measure time to acknowledge and resolve per service and team inside published business hours, with a download that matches the screen to the published precision.
- **DP-34 — Handoff Cut by pointer.** Let a lead cut an override directly on the final schedule row with 15-minute snapping, a live split and a running result before release.
- **DP-35 — Handoff Cut by keyboard and form.** Provide the published keyboard path and override form with the same 15-minute step and the same result as the pointer.
- **DP-36 — Cut result and refusal.** Replace the preview with the server's result on every open screen within a second, or settle back and announce the reason when the overlap rule refuses the cut.
- **DP-37 — Final schedule.** Compute a final schedule that has exactly one person or a flagged gap at any moment, with the lowest layer first and overrides above all.
- **DP-38 — Daylight saving rotation.** Keep each handoff at its local time across a daylight saving change, follow the published rule for missing and repeated times, and draw 23-hour and 25-hour days to one scale.
- **DP-39 — Layer edits change only the future.** Apply a layer edit only from the moment it is saved, so past blocks and past assignments never move.
- **DP-40 — Who is on call.** Serve who-is-on-call with a cached copy and ETag, changing at the exact handoff second and cleared at once by any edit or override.
- **DP-41 — Personal calendar feed.** Give each person a shift feed by token that regenerating, revoking or expiry stops at once and that can never change anything.
- **DP-42 — Older schedule upgrade.** Upgrade older schedule records once on start without blocking reads.
- **DP-43 — Public status page.** Show the firm's services, status words, maintenance banners and published updates to anyone without signing in, updating in place as Frontend states.
- **DP-44 — No responder detail in copies.** Keep responder notes, unpublished drafts and every other responder detail out of the status page, its cached copies, subscriber mail and webhook bodies.
- **DP-45 — Publishing a status update.** Publish a draft once, clear the cached status at once, crossfade the plate and send each subscriber one templated mail.
- **DP-46 — Slower state without Valkey.** Compute who-is-on-call and the status page from Postgres when Valkey is unreachable, show the published notice, and resume caching without a restart.
- **DP-47 — Service map and rollup.** Refuse and name a dependency cycle, and roll status up by the published worst-of rule.
- **DP-48 — Maintenance windows.** Start and end maintenance windows and their banners at the exact server second, dropping trigger events inside them.
- **DP-49 — Signed webhook posts.** Post subscribed incident events to the outside receiver with the published signature, timestamp, attempt number and event id.
- **DP-50 — Backoff and attempt record.** Retry on the published backoff, stop on success, and show a delivery as delivered only on the receiver's own answer, with each attempt's status and body.
- **DP-51 — Webhook Replay.** Replay a finished delivery under the same event id, proved by the receiver's record.
- **DP-52 — Sign-in and role rights.** Sign people in with the seeded accounts and enforce the published role rights on every page and endpoint.
- **DP-53 — Immediate role change.** Apply a role change or forced sign-out at once, so every open screen switches, closes its socket and receives no later data.
- **DP-54 — API keys.** Create, rotate and revoke API keys so a rotated key ends at its grace time on the server clock and a revoked key fails at once.
- **DP-55 — Working from a phone.** Let a responder work the list and an incident at 375 px, covering acknowledge, resolve, snooze, reassign, a note and who is on call, with comfortable targets, no page overflow and a fixed action bar that never hides the focused field, with no overflow at the other published viewports.
- **DP-56 — Run manifest and server boundary.** Serve from the published manifest and health path, keep credentials and source off the wire, and enforce the published origin and size limits.
- **DP-57 — Durable record and outage boot.** Keep every record through a restart, and start and recover without a restart when Valkey, mail or the receiver is unreachable.
- **DP-58 — Yard entry screens.** Open sign-in and the status page on the wordless freight yard plate above the giant name, as Visual design describes.
- **DP-59 — Working screen language.** Carry the white working pages, the one enormous figure, the near-black incident field and the single tangerine tab through every signed-in screen, as Visual design describes.
- **DP-60 — Motion and reduced motion.** Limit motion to the published crossfade and Handoff Cut movements, and show each end state at once under reduced motion with the same function.
- **DP-61 — Urgency follows the worst alert.** Raise an incident's urgency when a more severe alert joins it and notify by the published rule.
- **DP-62 — Policy editor by drag and keyboard.** Reorder escalation levels by drag and by keyboard with the same saved record, with focus and announcements as published.
- **DP-63 — Viewed zone and range in the address.** Keep the schedule's range and viewed zone in the address, and redraw every block and day band when the zone changes.
- **DP-64 — Refused removal lists what breaks.** Refuse to remove a person still needed by a future shift or a policy level, listing everything that would break.
- **DP-65 — Notification rules per urgency.** Write an in-app notice at once and send mail at each person's own delays per urgency, with an acknowledge cancelling every pending step.
- **DP-66 — Saved filters in the address.** Keep incident filters in the address across reload and Back, and store each person's named filters on the server.
- **DP-67 — Each row's own bulk result.** Report each row's own result from a bulk action, naming who decided a row someone else just decided.
- **DP-68 — Home and End bring the row into view.** Move focus to the first and last row with Home and End, or the phone's published controls, with that row fully in view.
- **DP-69 — Extra responders.** Let a person ask a colleague to join an incident, who can accept or decline once, with each answer on the timeline.
- **DP-70 — Service map by keyboard.** Move through the service map with the published arrow keys, keeping focus through live status changes.
- **DP-71 — Analytics job with live progress.** Compute measures as a job with live progress that survives a reload and a second tab, cached until an incident in range changes.
- **DP-72 — One socket, open before sending.** Open exactly one socket per page and send nothing until it is open.
- **DP-73 — REST contract.** Answer record reads with ETags and 304, and lists with cursors, under the one published error order and per-route key scopes.
- **DP-74 — Nobody on the whole policy.** Open no incident when every level of the policy is empty, and log why in the integration's event log.
- **DP-75 — Drill incidents.** Let an admin open a real incident on a service directly through the published drill route.

## Frontend

### Screens and layout (DP-07, DP-11, DP-25, DP-33, DP-34, DP-43, DP-55, DP-58, DP-59, DP-62, DP-63, DP-68, DP-70, DP-71)

Every screen is reachable at the three viewports 375x812, 768x1024 and 1280x800 with no horizontal page overflow. Every signed-in screen has the main navigation at the top, the `Live updates` region and a closing footer field. "Local time" below means `YYYY-MM-DD HH:MM ZZZ`, where `ZZZ` is the zone's abbreviation at that instant as the IANA time zone database gives it, for example `CDT` for America/Chicago in summer. It is a display form only; typed values use the formats under Public screens and controls. On schedule screens the zone is the viewed zone from the address; everywhere else it is the viewer's profile zone, never the browser's. The device clock may be wrong, and no screen depends on it.

| Path | Who | What it shows and how it is arranged |
|---|---|---|
| `/sign-in` | public | The yard plate fills the top of the viewport above the giant name, then the form. A signed-in visitor goes to `/oncall`. |
| `/status` | public | The same frame with the firm's name and one headline, then services with status words, maintenance banners, updates newest first, and the subscribe form. |
| `/status/unsubscribe/<token>` | public | One sentence of result and a link back to `/status`. |
| `/ack/<token>` | public | One sentence or heading and at most one button, on a white page. |
| `/oncall` | not stakeholder | One enormous holder name for the chosen schedule, the handoff countdown below it, then a list of every schedule and its holder. |
| `/incidents` | not stakeholder | The exact total as the enormous figure, filters, then the incident table. Phone: rows become stacked lines in the same order. |
| `/incidents/<id>` | not stakeholder | Opens on a floor-to-ceiling near-black field with the holder's name and a very large countdown in white. On white below: actions, alerts, steps, opened-with policy, timeline, note field. |
| `/schedules`, `/schedules/<id>` | not stakeholder | The list of schedules. A schedule page has the on-call name as its figure, a grid of layer rows with the final row last, and range controls. `?from=YYYY-MM-DD&days=<1 to 35>&zone=<IANA zone>` picks the range and viewed zone, and the default is 7 days from the Monday of the current week in the schedule's own zone. Phone: a stacked list of final shifts. |
| `/policies`, `/policies/<id>` | not stakeholder | The list and the level editor, with fields read-only for a responder. |
| `/services`, `/services/<id>` | not stakeholder | The service map as a tree with rolled-up status words, then each service's settings. |
| `/integrations`, `/integrations/<id>` | not stakeholder | The list with firm-wide dead letters. An integration page has the live counter as its figure, the Retry-After countdown, the routing key, dead letters and the event log. |
| `/webhooks`, `/webhooks/<id>` | admin | Endpoints, then each delivery with its attempts. |
| `/status-desk` | lead, admin | Drafts and published updates, with the editor. |
| `/analytics` | not stakeholder | The overall time to acknowledge as the figure, a date range, the job's progress, the measures table and the download link. |
| `/maintenance` | admin | Windows with their state words, and the form. |
| `/admin` | admin | People, roles and removal, API keys, and the operator clock. |
| `/me` | any signed-in person | Zone, quiet hours, notification delays and the calendar feed. A stakeholder sees only sign-out here and is otherwise sent to `/status`. |

### Public screens and controls (DP-07, DP-11, DP-12, DP-13, DP-20, DP-25, DP-30, DP-34, DP-35, DP-40, DP-41, DP-43, DP-45, DP-50, DP-52, DP-53, DP-54, DP-55, DP-61, DP-62, DP-63, DP-64, DP-65, DP-66, DP-67, DP-68, DP-69, DP-70, DP-71)

Only these are public; everything else is free.

| Where | Role and accessible name | Notes |
|---|---|---|
| Sign-in | `heading "Switchlamp"`, `textbox "Email"`, `textbox "Password"`, `button "Sign in"`, `link "Status page"` | |
| Status | `heading "Tarecross Software"`, `status "Current status"`, `list "Services"`, `list "Status updates"`, `textbox "Email for updates"`, `button "Subscribe"` | Each service item holds its name and status word. |
| Status | `img "Freight yard at dusk"` or `img "Freight yard at night"` | The plate on view. The other view stays hidden from assistive tech. The frame carries `data-plate="dusk"` or `data-plate="night"`. |
| Signed-in pages | `navigation "Main"`, `button "Sign out"`, `status "Live updates"`, `status "Notices for you"` | The live region is polite, visually hidden and in the page from first paint. `Notices for you` reads `<count> incidents need you`, the triggered incidents the person holds. |
| Incident list | `table "Incidents"`, `combobox "Status filter"`, `combobox "Service filter"`, `status "Incident total"`, `button "Older incidents"`, `button "Newer incidents"`, `button "Show <count> new incidents"`, `textbox "Filter name"`, `button "Save filter"`, `list "Saved filters"`, `region "Bulk results"` | Default filter is `Open`. Each `row` has `data-incident="<number>"` and holds number, title, service, status word, holder, opened local time and `checkbox "Select incident <number>"`. A selected row has `aria-selected="true"`. |
| Incident list at 375 px | `toolbar "List actions"` with `button "Acknowledge selected"`, `button "Resolve selected"`, `button "First incident"`, `button "Last incident"` | Fixed to the bottom of the screen. |
| Resolve dialog | `dialog "Resolve incidents"`, `button "Resolve"`, `button "Cancel"` | |
| Incident page | `timer "Incident countdown"`, `region "Holder"`, `toolbar "Incident actions"`, `button "Acknowledge"`, `button "Snooze"`, `button "Resolve"`, `list "Alerts"`, `list "Notification steps"`, `region "Opened-with policy"`, `list "Timeline"`, `textbox "Note"`, `button "Add note"`, `list "Impacted services"`, `list "Responders"`, `button "Add responder"` | The countdown reads `MM:SS`, or `H:MM:SS` from one hour. `region "Holder"` carries `data-level`, `data-cycle`, `data-holder` and `data-remaining-seconds`, the same values on every open tab. Each step item holds the person, channel, due local time and status word. |
| Responder request | `dialog "Request responder"`, `combobox "Responder"`, `button "Send request"`, `button "Cancel"`; for the person asked, `region "Responder request"`, `button "Accept"`, `button "Decline"` | |
| Snooze dialog | `dialog "Snooze incident"`, `radio "1 hour"`, `radio "4 hours"`, `radio "8 hours"`, `radio "24 hours"`, `radio "Custom time"`, `textbox "Snooze until"`, `button "Snooze incident"`, `button "Cancel"` | |
| Reassign on an incident | `button "Reassign"` in the toolbar, `dialog "Reassign incident"`, `combobox "Person"`, `combobox "Service"`, `button "Reassign incident"`, `button "Cancel"` | |
| Lead actions on an incident | `button "Merge"`, `dialog "Merge incidents"`, `textbox "Incident numbers"`, `button "Merge incidents"`, `button "Cancel"`, `button "Split off"` | One `Split off` per alert. After a split the alert leaves `list "Alerts"`, and focus moves to the `Split off` of the alert that took its place, else of the new last alert. A merged source shows `link "Incident #<target number>"`. |
| Schedule | `region "On call now"`, `group "Final schedule"`, `group "Layer <name>"`, `combobox "Cut for"`, `region "Cut preview"`, `button "Schedule an override"`, `button "Previous week"`, `button "Next week"`, `textbox "Range start"`, `combobox "View zone"` | `Cut for` lists people and `Nobody`, defaulting to the signed-in person. |
| Schedule blocks | Elements with `data-start`, `data-end` (UTC instants), `data-person` (a name, or `Nobody`), `data-source` (`layer`, `override` or `gap`) and `data-minutes` | Live preview pieces also carry `data-preview="true"`. Each day band carries `data-date` and `data-minutes`. |
| Override form | `dialog "Schedule an override"`, `combobox "Person"`, `textbox "Starts"`, `textbox "Ends"`, `button "Save override"`, `button "Cancel"` | Time fields step by 15 minutes. |
| Integration | `status "Events this minute"`, `timer "Retry-After countdown"`, `table "Event log"`, `table "Dead letters"`, `button "Replay"`, `dialog "Replay dead letter"`, `textbox "Corrected message"`, `button "Replay message"`, `button "Cancel"` | The counter reads `<count> / 120`. The countdown reads `<seconds> s`, or `Accepting events` when `retry_after` is null under the Rate window rule. |
| On call | `region "On call now"`, `timer "Handoff countdown"`, `combobox "Schedule"` | |
| Webhooks | `table "Deliveries"`, `table "Attempts"`, `button "Replay delivery"`, `textbox "Endpoint name"`, `textbox "Receiver path"`, `group "Event types"`, `group "Scope"`, `button "Add endpoint"` | Delivery status always shows as a word. `Event types` has one checkbox per event type and `Scope` one checkbox per service; none ticked in `Scope` means all services. |
| Status desk | `textbox "Update title"`, `textbox "Update body"`, `combobox "Update state"`, `group "Affected services"`, `button "Save draft"`, `button "Publish update"` | |
| Analytics | `table "Response measures"`, `textbox "From"`, `textbox "To"`, `button "Run analytics"`, `progressbar "Analytics progress"`, `link "Download CSV"` | The bar's `aria-valuenow` is the job's `done` and `aria-valuemax` its `total`. |
| Policy editor | `list "Levels"`, `button "Move level <position>"`, `spinbutton "Timeout for level <position>"`, `spinbutton "Repeats"`, `button "Add level"`, `button "Save policy"`, `region "Policy notice"` | Each level is a `listitem` with `data-level="<position>"`. |
| Service map | `tree "Service map"` | Each `treeitem` has `data-service="<name>"` and `data-status="<shown status>"` and holds both as text. |
| Maintenance | `textbox "Starts"`, `textbox "Ends"`, `combobox "Service"`, `button "Add window"`, `status "Maintenance banner"` on `/services` and `/status` | |
| Admin | `table "People"`, `combobox "Role for <name>"`, `button "Sign <name> out"`, `button "Remove <name>"`, `list "What this removal breaks"`, `table "API keys"`, `textbox "Key name"`, `combobox "Key scope"`, `button "Create key"`, `button "Rotate <key name>"`, `button "Revoke <key name>"` | |
| Operator clock | `region "Operator clock"`, `spinbutton "Advance by seconds"`, `button "Advance clock"`, `checkbox "Hold clock"` | Shows the current server time in UTC. |
| Me | `combobox "Time zone"`, `textbox "Quiet hours start"`, `textbox "Quiet hours end"`, `textbox "Notification delays"`, `spinbutton "Low urgency delay"`, `button "Save settings"`, `button "Create calendar link"`, `button "Regenerate calendar link"`, `button "Revoke calendar link"` | |
| Any form | `alert "Problems to fix"` | Lists each field error as a link that moves focus to its field. |

**Typed formats.** All times are on the 24-hour clock. A typed local time that falls on a clock change follows the Daylight saving rule in Business rules.

| Textbox | Literal format | Read in | Error when the format is wrong |
|---|---|---|---|
| `Starts` and `Ends` in `dialog "Schedule an override"` | `YYYY-MM-DD HH:MM`, for example `2027-03-14 14:15` | The viewed zone | `Use the format YYYY-MM-DD HH:MM.` |
| `Starts` and `Ends` on the maintenance page | `YYYY-MM-DD HH:MM` | The viewer's profile zone | `Use the format YYYY-MM-DD HH:MM.` |
| `Snooze until` | `YYYY-MM-DD HH:MM` | The viewer's profile zone | `Use the format YYYY-MM-DD HH:MM.` |
| `Range start` | `YYYY-MM-DD` | The viewed zone | `Use the format YYYY-MM-DD.` |
| `From` and `To` | `YYYY-MM-DD` | The firm's zone | `Use the format YYYY-MM-DD.` |
| `Quiet hours start` and `Quiet hours end` | `HH:MM`, with both empty for no quiet hours | The person's profile zone | `Use the format HH:MM.` |
| `Notification delays` | Whole minutes separated by commas, with optional spaces, for example `0, 5` | Minutes from becoming a holder | `Use 1 to 5 whole minutes from 0 to 60, separated by commas.` |

In `PATCH /api/me`, `quiet_start` and `quiet_end` are both `HH:MM` or both null, `notification_delays` is a JSON array of whole minutes, and `low_urgency_delay` is whole minutes from 0 to 60. A wrong value answers 422 under its own field name with the same sentence as its textbox above. An out-of-range `low_urgency_delay` answers `Use a whole number of minutes from 0 to 60.`, an unknown `timezone` answers `Choose a listed time zone.`, and one quiet-hours value without the other answers `Set both quiet hours times or neither.` under `quiet_start`.

**Combobox options.** Each combobox is a native single-choice select, read and chosen by these exact labels.

| Combobox | Options, in this order |
|---|---|
| `Status filter` | `Open`, `Triggered`, `Acknowledged`, `Snoozed`, `Resolved`, `All` |
| `Service filter` | `All services`, then each service name alphabetically; the default is `All services` |
| `Update state` | `Investigating`, `Identified`, `Monitoring`, `Resolved` |
| `Role for <name>` | `Responder`, `Lead`, `Admin`, `Stakeholder` |
| `Key scope` | `Read`, `Write` |
| `Time zone` | IANA zone names exactly as written, for example `Asia/Kolkata`, alphabetically |
| `Cut for`, and `Person` in `dialog "Schedule an override"` | The name of every person who is not a stakeholder, alphabetically, then `Nobody`; both default to the signed-in person |
| `Person` in `dialog "Reassign incident"` | `Not chosen`, then the name of every person who is not a stakeholder, alphabetically |
| `Service` in `dialog "Reassign incident"` | `Not chosen`, then each service name alphabetically |
| `Service` on the maintenance page | Each service name alphabetically |
| `Schedule` | Each schedule name alphabetically |
| `View zone` | IANA zone names exactly as written, alphabetically; the default is the schedule's own zone |
| `Responder` | The name of every person who is not a stakeholder, alphabetically, without the incident's holders and responders |

Roles and update states show in these labels on every screen and in mail, while the API keeps its lowercase values. `<role>` in the role-change copy from Feedback states is one of these role labels.

### Interactions (DP-07, DP-12, DP-14, DP-16, DP-20, DP-25, DP-34, DP-35, DP-36, DP-55, DP-62, DP-63, DP-66, DP-67, DP-68, DP-70, DP-71, DP-72)

**Incident list keyboard.** The table has one roving tab stop, and the first row has document focus on arrival, so the first `J` moves to the second row. These shortcuts work whichever control inside the table has focus, including a button or link in a row, and are ignored while focus is in a text field.

- `J` moves focus to the next row and `K` to the previous row, stopping at the ends.
- `Home` moves focus to the first row of the page and `End` to the last. That row is then fully inside the viewport and clear of any fixed or sticky element.
- `X` toggles selection of the focused row, and focus stays on that row.
- `A` acknowledges the selected rows, or the focused row when none is selected. Focus stays on the same row, or moves as under `R` if the filter removes it.
- `R` opens `dialog "Resolve incidents"` for the selected rows, or the focused row when none is selected, with `button "Resolve"` focused. Confirming resolves them and closes the dialog, and focus returns to the row it came from, or moves as below if the filter removes it.
- `A` and the dialog's `Resolve` report each row's own result in `Bulk results`, one line per row in row order, and clear earlier lines: `#<number> acknowledged.`, `#<number> resolved.`, or, for a row someone else has just decided, `#<number>: Already <decision> by <name>.` Such a row is never skipped silently.
- When a row leaves the filter, focus moves to the row that took its place, else to the new last row, else to the empty sentence, which can take focus.
- A row arriving above never moves focus.

**Dialogs.** Tab and Shift+Tab wrap inside every open dialog. Escape closes it, and focus returns to the control that opened it. For a dialog opened by `R`, that is the row. Confirming `dialog "Merge incidents"` or `dialog "Reassign incident"` also closes it and returns focus to the button that opened it.

**Paging.** `Older incidents` and `Newer incidents` load a page in place. A new matching incident never shifts the rows on view: `Show <count> new incidents` appears, counting them, and its use moves to the first page with them on top. Focus stays on the same row if it is still on view, and otherwise moves to the first row. `Incident total` updates at every arrival or removal within a second.

**Filters in the address.** The filters write `?status=<value>&service=<id>` to the address as a new history entry, so reload, Back and a pasted link show the same filter. `Save filter` stores the current filters under `Filter name` for that person on the server. Each item in `Saved filters` is a link to that address with its own `button "Remove <name>"`.

**Live pages.** Incident, schedule, integration, services, on-call, analytics and admin pages update from the socket within a second with no reload. Every signed-in page opens exactly one WebSocket, except a stakeholder's `/me`, which opens none like the public pages. A page sends nothing on it until it is open. Its first frame is then `{"type":"hello"}`. On a socket drop the page reconnects by itself and catches up from the last message it saw, with nothing applied or announced twice. A countdown shows the value the server last sent, and the server sends it at least once a second. A focused row or block keeps focus when a live change redraws it.

**Service map.** The tree holds one roving tab stop. Each top item is a service nothing depends on, and each child is a service its parent depends on, so a service can appear under several parents. Down and Up move to the next and previous visible item, Right opens a closed item or moves to its first child, Left closes an open item or moves to its parent, and Home and End move to the first and last visible item. Every item starts open. A live status change keeps focus on the same item.

**Policy editor.** `Move level <position>` is both the drag handle and the keyboard handle. Dragging it and releasing over another level's row puts the level at that row's position, and the rows close up. With the handle focused, Space lifts the level, Up and Down move it one position, Space drops it and Escape restores the order at lift. Each move announces `Level moved to position <position>.` in `Live updates`, and focus stays on the moved level's handle under its new name. Nothing is stored until `Save policy`, and both ways save the same record.

**Status page.** Polls with its ETag every 5 seconds and updates services, headline, banners, updates and plate in place. It announces only through `status "Current status"`.

**Note field.** The unfinished note saves itself to the server about a second after typing stops, and on leaving the page. Reloading, or opening the incident in a second tab or on another device, brings it back. An open second tab whose field is not focused takes the saved text within a second. `Add note` clears the draft everywhere.

**Schedule view zone.** Choosing `View zone` writes `zone` to the address as a new history entry and redraws every block, day band, tab and local time in that zone at once. `data-start` and `data-end` stay the same instants, and focus stays on the combobox.

**Handoff Cut, pointer.** For example, pressing at 14:05 sets the anchor at 14:00, and 14:08 sets it at 14:15; a press exactly halfway takes the later step.

1. The final row shows a small tangerine `Cut here` tab under the pointer's last position.
2. Pressing on the row sets the anchor at the nearest 15-minute step and opens a navy block there.
3. Moving the pointer in either direction moves the block's free edge from step to step. The tab rides that edge reading `Ends <HH:MM>, <h> h <m> min`, or `Ends <HH:MM>, <m> min` under an hour, in the viewed zone. It always names the free edge's time and the cut's length, on either side of the anchor.
4. Each block under the cut splits live into pieces, each keeping its person's name, with `data-preview="true"` on them. Every piece's width stays proportional to its minutes, and one scale holds across the whole range.
5. `Cut preview` shows the running result in the words from Feedback states.
6. Releasing commits. Releasing on the anchor step, or pressing Escape while dragging, cancels and restores the prior blocks.

**Handoff Cut, keyboard.** Tab to `group "Final schedule"`. The cursor starts at the latest 15-minute step at or before the server clock's present when that lies inside the range, its end excluded, and otherwise at the range's start. Left and Right move the cursor by 15 minutes, Enter sets the anchor, Left and Right then move the free edge with the same tab and preview, Enter commits, and Escape cancels. Focus stays on the group throughout.

**Handoff Cut, phone.** The schedule is a stacked list of shifts. `Schedule an override` opens the form, which gives the same 15-minute step and result. The form exists at every viewport.

**Phone action bars.** At 375 px `toolbar "Incident actions"` and `toolbar "List actions"` are fixed to the bottom of the screen. A focused field is always scrolled fully above the bar. `First incident` and `Last incident` bring that row fully into view above the bar and give it focus. Every control at every viewport is at least 44 px in both directions.

### Visual design (DP-58, DP-59)

**Direction: the place carries it.** The mood is nocturnal, exact and unhurried. Sign-in and the status page open on one wordless freight yard at night. Every countdown and shift edge is a tabular figure correct to the second.

**Type.** Display type is Darker Grotesque and body type is Lexend, with Chivo Mono used only for literal keys, dedup keys and signatures. Each step up the type scale is one third larger than the one below it, and lists use tabular figures. Font files are obtained during `install` from their open-licence packages and bundled with the app, and nothing loads from the network at `build` or at runtime.

**Colour.**
- The ground is white and the surface is a very pale warm grey.
- Ink is deep navy, and on the tangerine accent text is also navy.
- A muted slate grey is used only on white, never on the surface, where text stays navy.
- The incident page's opening field is a near-black with white type.
- Every page closes on a warm stone-grey footer field, the same stone grey as shift blocks.
- All text meets WCAG 2.2 AA contrast.

**Entry screens.** A full-bleed plate fills the top 58% of the viewport, showing lamp masts, wagon rows and wet asphalt with its focal point in the upper two-thirds and no words. `Switchlamp` runs on one line in Darker Grotesque across the white band below, as wide as the band allows. On a phone it breaks into two lines, `Switch` and `lamp`, each about a fifth of the screen width tall. The status page uses the same frame with the firm's name and one line of current status. All plates, the dusk and night views included, come from one seeded procedural script run at build time, in the same light, and are bundled with the app.

**Working screens.** These are white pages at comfortable density, where one enormous figure such as the countdown, the on-call name or the live counter stands above a calm list or grid. Trading rows above the fold for an instant answer is deliberate, because at 04:00 a responder needs only who holds this and how long is left.
- Corners are square everywhere.
- Rows group by spacing and the surface colour, never by hairlines or shadowed cards.
- Status always carries a word as well as a tone.
- Empty states are one short sentence with wide margins.
- Error and slower-state notices are plain full-width bars of navy text on the surface colour.

**Schedule grid.** Days alternate white and surface, so a 25-hour day visibly reads wider with no ruled lines. Shifts are stone-grey blocks named in text, overrides are solid navy, and a gap is an empty block with the word `Nobody`.

**Tangerine.** It appears once per screen, as one small action tab with navy text. On the schedule grid it is the cut tab, and at phone width it is `Schedule an override`.

### Motion and effects (DP-34, DP-36, DP-45, DP-60)

The only ambient motion on any page is one crossfade of about nine tenths of a second, on the status plate when a published update changes the view. There are no decorative loops, parallax, spinners on idle screens or hover animations beyond an instant colour change.

**Handoff Cut.** The moving edge and live split reach each 15-minute step in about a tenth of a second, starting quickly and settling softly. On release, the server's result or a refused cut's return to the prior blocks settles in about a quarter of a second. Pointer movement across the final row within the viewed range drives it, one step per 15 minutes, and moving back reverses it step by step.

**Reduced motion.** The plate swaps at once, and blocks jump straight to each snapped position with no easing or settle. The tab, split pieces, attributes, preview text and announcements stay identical.

### Feedback states (DP-07, DP-08, DP-13, DP-16, DP-20, DP-29, DP-30, DP-36, DP-40, DP-41, DP-43, DP-45, DP-46, DP-47, DP-48, DP-50, DP-52, DP-53, DP-54, DP-61, DP-62, DP-64, DP-66, DP-67, DP-69, DP-74)

**Pending.** The control that started an async action is disabled with `aria-busy="true"` until the reply arrives, and a double click makes one request. `Live updates` reads `Working on it.` if the reply takes longer than a second.

**Field errors.** The text of each `errors` entry from the API appears under its field and in `alert "Problems to fix"`.

**Announcements.** Each decided event adds one new line at the end of `status "Live updates"`, in event order, with exactly the timeline text below. The region keeps its last 20 lines. Refusals and action results go to the same region.

| Timeline `kind` | Text, in `Live updates` and in the timeline |
|---|---|
| `triggered` | `Incident #<number> triggered: <title>` |
| `acknowledged` | `Incident #<number> acknowledged by <name>` |
| `snoozed` | `Incident #<number> snoozed by <name> until <local time>` |
| `snooze_ended` | `Incident #<number> back to triggered: snooze ended` |
| `ack_timed_out` | `Incident #<number> back to triggered: acknowledge timed out` |
| `escalated` | `Incident #<number> escalated to <holder names>` |
| `handed_off` | `Incident #<number> handed off from <old name> to <new name>` |
| `reassigned` | `Incident #<number> reassigned to <holder names> by <name>` |
| `merged` | `Incident #<number> merged into #<target number> by <name>` |
| `split` | `Alert <dedup key> split into incident #<new number> by <name>` |
| `urgency_raised` | `Incident #<number> raised to high urgency` |
| `responder_requested` | `<name> asked <person> to join incident #<number>` |
| `responder_accepted` | `<person> joined incident #<number>` |
| `responder_declined` | `<person> declined to join incident #<number>` |
| `resolved` | `Incident #<number> resolved by <name>` |
| `auto_resolved` | `Incident #<number> auto-resolved` |

These two kinds appear in the timeline only and are not announced:

| Timeline `kind` | Timeline text |
|---|---|
| `repeat_event` | `Repeat event on <dedup key>` |
| `note` | The note's text, shown with its author |

`<holder names>` joins names with `, `, or reads `Nobody`. `<name>` is a person, an API key's name, an integration's name, or `Switchlamp` for an entry made by a timer or a handoff with nobody acting. A timeline entry's `actor` is that same `<name>`.

Times in server-built text follow one rule. `<local time>` in timeline text and announcements is in the firm's zone. In `Override saved`, `Cut refused` and the override `message` it is in the schedule's own zone, whatever zone is viewed.

**Action results.**

| Moment | Copy in `Live updates` unless stated |
|---|---|
| Decision lost to another person | `Already <decision> by <name>.`, where `<decision>` is acknowledged, snoozed or resolved |
| Illegal snooze | `Only an acknowledged incident can be snoozed.` |
| Note added | `Note added.` |
| Save over a newer version | `Someone saved a newer version. Reload to see it.` |
| Generic save | `Saved.` |
| Status update published | `Published. Notices to <count> subscribers are on their way.` |
| Subscribed | `You are subscribed to status updates.` shown beside the form |
| Unsubscribed | `You will get no more status updates.` |
| Merge done | `Merged <count> incidents into #<number>.` |
| Policy saved, in `Policy notice` | `<count> running incidents keep version <old version>. Version <new version> applies to later incidents.` |
| Removal refused, in `Live updates` | `<name> cannot be removed yet.` |
| Filter saved | `Filter saved.` |
| Replay done | `Replayed. The event applied once.` |
| Webhook Replay started | `Replay queued under the same event id.` |
| Clock moved | `Clock moved to <UTC instant>.` |
| Cut saved | `Override saved: <person> from <local time> to <local time>.` |
| Cut refused | `Cut refused: <person> already has an override from <local time> to <local time>.` |
| Sign-in failure, in `alert "Problems to fix"` | `That email and password do not match.` |
| After a forced sign-out, on the sign-in screen | `You have been signed out.` |
| After a role change, on the next screen | `Your role changed to <role>.` |

**Cut preview text.** Three parts joined by `; `, ending in a full stop:
1. Who loses time, as `<person> loses <minutes> minutes`, with one such phrase per person joined by `, ` in the order of their first lost minute, or `Nobody loses time`.
2. `no gap`, or `gap of <minutes> minutes`, counting the minutes inside the cut's range that nobody would hold.
3. `no overlap`, or `overlaps <person>'s override`.

**Integration event log.** Refusals from a known routing key are logged with null `event_id` and `incident_number`, and a request naming no known routing key is not logged. Each row has outcome `Applied`, `Dropped`, `Suppressed`, `Refused`, `Dead-lettered` or `Replayed`. The exact reasons are:

| Moment | Reason |
|---|---|
| Acknowledge or resolve on a key with no alert | `No alert has this dedup key.` |
| Acknowledge or resolve on a key whose latest alert is resolved | `This alert is already resolved.` |
| Acknowledge on an alert already acknowledged | `This alert is already acknowledged.` |
| Acknowledge or resolve whose key is open only under another routing key | `This dedup key belongs to another integration.` |
| Trigger with nobody on call on the whole policy | `Nobody is on call on this policy, so no incident opened.` |
| Trigger during a maintenance window | `The service is in a maintenance window.` |
| 429 refusal | `Over the limit of 120 events a minute.` |
| 503 refusal | `The queue did not confirm this event.` |
| 400 refusal from a known routing key | `Invalid event: <bad fields>.`, joined by `, ` in the order of the intake sentence table, for example `Invalid event: payload.summary, payload.severity.` |

**Dead letter reasons.**

| Moment | Reason |
|---|---|
| Body is not JSON | `Body is not valid JSON.` |
| A required field is absent | `Missing field: <field>.` |
| Severity not published | `Unknown severity: <value>.` |
| Summary too long | `Summary is longer than 1024 characters.` |
| Routing key unknown | `Unknown routing key: <value>.` |
| Earlier event absent past the limit | `Earlier event never arrived: key_seq <number>.` |

In the last reason `<number>` is the first absent `key_seq` for that key, so a message with `key_seq` 3 waiting when 2 never arrived names 2.

**Acknowledge link pages.**

| State | Heading | Sentence |
|---|---|---|
| Valid | `Acknowledge incident #<number>` | `<title>`, with `button "Acknowledge incident #<number>"` |
| Done | `Acknowledged.` | `Incident #<number> is with you now.` |
| Used | `This link has already been used.` | `Incident #<number> was acknowledged by <name>.` |
| Out of date | `This link is out of date.` | `Incident #<number> has moved on. Sign in to see where it stands.` |
| Invalid | `This link is not valid.` | `Ask your lead for help if you expected it to work.` |

**Outage bars and fixed notices.**

| Moment | Where | Copy |
|---|---|---|
| Valkey unreachable | Status page and on-call screens, in `Current status` or `On call now` as a bar | `Figures are coming straight from the record, so this page may load more slowly.` |
| Valkey unreachable | Integration page, replacing the counter figure | `Counter unavailable: events are accepted uncounted until it returns.` |
| Mail unreachable | Incident page | `Mail is unreachable. <count> notification steps are queued and will go out when it returns.` |
| Mail unreachable | Status desk | `Mail is unreachable. <count> subscriber notices are queued and will go out when it returns.` |
| Receiver unreachable | Webhook page | `The receiver is unreachable. Attempts continue on the published schedule.` |
| Broker unreachable | Integration page | `The queue is unreachable. New events are being refused.` |
| Page not found | Any | `We could not find that page.` |

**Removal list.** Each item in `What this removal breaks` reads `<schedule>: <local time> to <local time>` or `<policy>: level <position>`.

**Status words on screen.**
- Incident: `Triggered`, `Acknowledged`, `Snoozed`, `Resolved`
- Step: `Scheduled`, `Held until <local time in the holder's zone>`, `Queued`, `Sent`, `Cancelled`
- Delivery: `Pending`, `Retrying`, `Delivered`, `Rejected`, `Failed`
- Attempt with no answer: `Receiver unreachable`
- Maintenance window: `Upcoming`, `Running`, `Ended`

**Countdown on the incident page.** The label above the timer and `countdown.kind` come from the first line that applies:
1. The incident is snoozed: `Snooze ends in`, kind `snooze`.
2. The incident is acknowledged with an acknowledge deadline running: `Back to triggered in`, kind `ack_timeout`.
3. The incident is triggered, high urgency, with escalation still to run: `Escalates in`, kind `escalation`.
4. The incident is open with `auto_resolve_at` set: `Auto-resolves in`, kind `auto_resolve`. This line also covers escalation that has finished while auto-resolve still runs.
5. The incident is triggered, high urgency, with escalation finished: `Escalation finished`, kind `none`.
6. Anything else, a resolved incident included: `No timer running`, kind `none`.

With kind `none`, `due_at` is null, `remaining_seconds` is 0 and the timer shows `--:--`.

**Empty sentences.**
- Incident list: `Nothing is open.`
- Dead letters: `No dead letters.`
- Deliveries: `Nothing has been sent yet.`
- Updates: `No updates published.`

**Status headlines.**
- `All services are running.`
- `Maintenance is under way.`
- `Some services are affected.`

**Maintenance banner.** `Maintenance on <service> until <local time>`. On the public page, local time uses the firm's zone from Business rules.

## Backend

### API (DP-01, DP-02, DP-03, DP-07, DP-09, DP-10, DP-11, DP-15, DP-16, DP-17, DP-20, DP-21, DP-22, DP-25, DP-30, DP-31, DP-32, DP-33, DP-35, DP-36, DP-37, DP-39, DP-40, DP-41, DP-42, DP-43, DP-45, DP-47, DP-48, DP-49, DP-50, DP-51, DP-52, DP-53, DP-54, DP-56, DP-61, DP-63, DP-64, DP-65, DP-66, DP-67, DP-69, DP-71, DP-73, DP-74, DP-75)

**Conventions.** All API bodies are JSON with `Content-Type: application/json`. Instants are UTC ISO 8601 to the second, for example `2027-03-14T14:00:00Z`.

A signed-in browser uses the HttpOnly session cookie `switchlamp_session`. An API key uses `Authorization: Bearer <key>`, where scope `read` allows GET requests a responder may make, and scope `write` also allows incident actions and notes.

**Error shapes.**
- General: `{"error":"<code>"}`, plus only the further fields a row prints. Every error body printed in this brief is complete and exact, with nothing added. Only `illegal_transition` and `override_overlap` carry a `message`, because their rows print one.
- Field errors, status 422 everywhere except event intake: `{"errors":{"<field>":"<sentence>"}}`

**Error precedence for the whole API.**
1. Body too large: 413 `{"error":"body_too_large"}`
2. Invalid JSON: 400 `{"error":"invalid_json"}`
3. Unauthenticated: 401 `{"error":"unauthenticated"}`, or a dead key: 401 `{"error":"invalid_api_key"}`
4. Unknown resource: 404 `{"error":"not_found"}`
5. Forbidden: 403 `{"error":"forbidden"}`
6. Missing or stale version: 428 `{"error":"version_required"}`, or 412 `{"error":"version_conflict","current":{<record>}}`
7. State conflict: 409
8. Validation: 422

A replayed `Idempotency-Key` returns its stored response before any state check. The rows below name only each endpoint's own extra errors.

**Record reads.** A GET of one incident, policy, service or schedule answers `ETag: "<version>"`, and an `If-None-Match` holding that value answers 304 with no body, after the authentication and permission steps above. Every list with `limit` and `after` is cursor-paged: `next_cursor` is null on the last page, and the default and maximum sizes are those under Paging.

**API key scopes.** A key outside its scope answers 403 `{"error":"forbidden"}` at step 5.

**Versioned saves.** PUT on a policy, service or layer needs `If-Match: "<version>"`, and each record's JSON carries an integer `version`.

**Idempotency keys.** `POST` on notes, overrides, merge and publish accepts an optional `Idempotency-Key` header. The same key with the same body returns the stored response. The same key with a different body answers 409 `{"error":"idempotency_conflict"}`.

**Sign-in and session.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| POST `/api/session` | `{"email","password"}` | 200 `{"user":{"id","name","email","role","timezone"}}` | 401 `{"error":"invalid_credentials"}` |
| DELETE `/api/session` | | 204 | |
| GET `/api/me` | | 200 user plus `quiet_start`, `quiet_end`, `notification_delays`, `low_urgency_delay` | |
| PATCH `/api/me` | any of `timezone`, `quiet_start`, `quiet_end`, `notification_delays`, `low_urgency_delay` | 200 as GET | 422 |
| GET, POST `/api/me/saved-filters` | POST `{"name","status","service_id"}` | 200 `{"items":[{"id","name","status","service_id"}]}`, 201 item, that person's only | 422 |
| DELETE `/api/me/saved-filters/<id>` | | 204 | |
| POST `/api/me/calendar-token` | | 201 `{"url":"/calendar/<token>.ics","expires_at"}`; replaces any earlier token | |
| DELETE `/api/me/calendar-token` | | 204 | |
| GET `/calendar/<token>.ics` | no session | 200 `text/calendar` | 404 `{"error":"not_found"}` for unknown or revoked; 410 `{"error":"expired"}`; other methods 405 |

**Platform and clock.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET `/api/health` | | 200 `{"status":"ok"}` | |
| GET `/api/system` | not stakeholder | 200 `{"queue":"ok\|down","cache":"ok\|down","mail":"ok\|down","schedule_upgrade":{"state":"running\|done","upgraded":<count>,"finished_at"}}` | |
| GET `/api/clock` | signed in | 200 `{"now","frozen","offset_seconds"}` | |
| POST `/api/operator/clock` | admin; `{"advance_seconds":<1 to 31536000>}` or `{"set_to":"<instant>"}`, and/or `{"frozen":true\|false}` | 200 as GET, after every due timer is applied | 422 `{"errors":{"set_to":"The clock only moves forward."}}` |
| POST `/api/operator/drill` | admin; `{"service_id","summary","severity","dedup_key"}`, with `dedup_key` optional | 201 incident | 409 `{"error":"nobody_on_call"}`; 422 |
| GET `/api/live` | WebSocket, `?after=<seq>` optional | Messages below | 401, 403 at upgrade |

**Socket messages.** Each message is JSON `{"seq":<integer>,"type":"<type>","at":"<instant>","data":{...}}`.
- `type` is `incident`, `schedule`, `integration`, `status`, `clock`, `countdown`, `analytics` or `access`.
- An `incident` message's `data` has `incident_id`, `announce` (the text from Feedback states) and the list item.
- `?after` sends everything after that `seq` first, in order.
- Close codes are `4401` for signed out and `4403` for role changed.

**Monitoring events.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| POST `/api/events` | no session; the routing key authorises; body up to and including 512,000 bytes | 202 `{"status":"accepted","event_id":"<uuid>","dedup_key":"<key>"}` | see below |

```json
{"routing_key":"rk_transport_0001","event_action":"trigger","dedup_key":"tms-db-cpu","payload":{"summary":"TMS database CPU above 95%","source":"tms-db-1","severity":"critical","timestamp":"2027-03-14T14:00:00Z","custom_details":{}}}
```

`event_action` is `trigger`, `acknowledge` or `resolve`. `dedup_key` is 1 to 255 characters, and on a trigger with none the server generates one. `severity` is `critical`, `error`, `warning` or `info`. `summary` is at most 1024 characters, the limit included.

Intake errors, in this order after the size and JSON checks:
- 400 `{"error":"invalid_event","errors":{"<field>":"<sentence>"}}`, listing every bad field at once from the sentences below
- 404 `{"error":"unknown_routing_key"}`
- 429 `{"error":"rate_limited","retry_after":<seconds>}` with header `Retry-After: <seconds>`
- 503 `{"error":"queue_unavailable"}`

| Field | Sentence |
|---|---|
| `routing_key` | `Routing key is required.` |
| `event_action` | `Action must be trigger, acknowledge or resolve.` |
| `dedup_key` | `Dedup key is required for this action.` or `Dedup key must be 1 to 255 characters.` |
| `payload.summary`, on a trigger | `Summary is required.` or `Summary is longer than 1024 characters.` |
| `payload.source`, on a trigger | `Source is required.` |
| `payload.severity`, on a trigger | `Severity must be critical, error, warning or info.` |

For example, a trigger with no summary and severity `high` answers 400 with both `payload.summary` and `payload.severity` listed. A valid trigger with no `dedup_key` gets a generated one and always opens a new alert. The worker checks a message again, because a message on the queue may come from any publisher, and those that fail become dead letters.

**Integrations and dead letters.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET `/api/integrations` | | 200 `{"items":[...]}` | |
| POST `/api/integrations` | admin; `{"service_id","name"}` | 201 `{"id","service_id","name","routing_key"}` | 422 |
| GET `/api/integrations/<id>` | | 200 record plus `"counter":{"count","limit":120,"retry_after":<seconds or null>,"available":true\|false}` | |
| GET `/api/integrations/<id>/events` | `?limit&after` | 200 `{"items":[{"event_id","at","action","dedup_key","outcome","reason","incident_number"}],"next_cursor"}` | |
| GET `/api/dead-letters` | `?integration_id` | 200 `{"items":[{"id","event_id","routing_key","reason","raw","attempts","dead_at"}]}` | |
| POST `/api/dead-letters/<id>/replay` | lead or admin; optional `{"message":{<full corrected message>}}` | 200 `{"status":"replayed","event_id"}` | 409 `{"error":"already_replayed"}`; 422 `{"errors":{"message":"<dead letter reason>"}}` when it still cannot apply, and it stays listed |

**Incidents.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET `/api/incidents` | `?status=open\|triggered\|acknowledged\|snoozed\|resolved\|all&service_id&limit&after&before` | 200 `{"items":[<list item>],"total":<count>,"next_cursor","prev_cursor"}`, in the Paging order from Business rules | 422 `{"errors":{"limit":"Limit must be between 1 and 100."}}` |
| GET `/api/incidents/<id>` | | 200 incident | |
| POST `/api/incidents/bulk` | `{"action":"acknowledge\|resolve","ids":[...]}`, at most 100 | 200 `{"results":[{"id","number","status":"ok\|conflict","decision","decided_by"}]}`, one per id, each row decided on its own | 422 `{"errors":{"ids":"Choose 1 to 100 incidents."}}` |
| POST `/api/incidents/<id>/acknowledge` | | 200 incident | 409 decision conflict |
| POST `/api/incidents/<id>/snooze` | `{"preset_hours":1\|4\|8\|24}` or `{"until":"<instant>"}` | 200 incident | 409 conflict; 422 `{"errors":{"until":"Snooze for at most 168 hours."}}`; 422 `{"errors":{"until":"Choose a time after now."}}` |
| POST `/api/incidents/<id>/resolve` | | 200 incident | 409 decision conflict |
| POST `/api/incidents/<id>/reassign` | `{"person_id"}` or `{"service_id"}` | 200 incident | 409 decision conflict on resolved; 422 `{"errors":{"person_id":"This person already holds the incident."}}`; 422 `{"errors":{"person_id":"Choose either a person or a service."}}` when the body has both or neither; 422 `{"errors":{"service_id":"The incident is already on this service."}}` |
| POST `/api/incidents/<id>/merge` | lead or admin; `{"source_ids":[...]}`, where `<id>` is the target | 200 target incident | 409 `{"error":"merge_target_resolved"}`; 409 `{"error":"merge_source_resolved","number":<number>}`; 422 `{"errors":{"source_ids":"An incident cannot merge into itself."}}`; 422 `{"errors":{"source_ids":"An incident can hold at most 1000 alerts."}}` |
| POST `/api/incidents/<id>/alerts/<alert_id>/split` | lead or admin | 201 new incident | 409 `{"error":"last_alert"}`; 409 decision conflict on resolved |
| POST `/api/incidents/<id>/notes` | `{"body":"<1 to 10000 characters>"}` | 201 timeline entry | 422 |
| GET, PUT `/api/incidents/<id>/note-draft` | PUT `{"body"}` | 200 `{"body","saved_at"}`, for the signed-in person only | |
| POST `/api/incidents/<id>/responder-requests` | `{"person_id"}` | 201 `{"id","person","state":"requested"}` | 409 `{"error":"already_responding"}`; 409 decision conflict on resolved |
| POST `/api/responder-requests/<id>/accept`, `/decline` | the person asked only; anyone else 403 | 200 `{"id","person","state":"accepted\|declined"}` | 409 `{"error":"already_answered"}` |

Decision conflict body: 409 `{"error":"already_decided","decision":"acknowledged|snoozed|resolved","decided_by":"<name>","decided_at":"<instant>"}`. Snoozing a triggered incident answers 409 `{"error":"illegal_transition","message":"Only an acknowledged incident can be snoozed."}`.

Incident JSON:

```json
{"id":"<uuid>","number":5,"title":"<first alert summary>","service":{"id":"<id>","name":"<name>"},"status":"triggered","urgency":"high","holders":[{"id":"<id>","name":"<name>"}],"level":1,"cycle":0,"policy_snapshot":{"name":"<name>","version":1,"repeats":0,"levels":[{"timeout_minutes":30,"targets":[{"type":"schedule","id":"<id>","name":"<name>"}]}]},"server_now":"<instant>","countdown":{"kind":"escalation|ack_timeout|snooze|auto_resolve|none","due_at":"<instant or null>","remaining_seconds":0},"auto_resolve_at":null,"snoozed_until":null,"resolve_reason":null,"merged_into":null,"impacted_services":[],"responders":[{"id":"<id>","name":"<name>"}],"responder_requests":[{"id":"<id>","person":"<name>","state":"requested"}],"alerts":[{"id":"<id>","routing_key":"<key>","dedup_key":"<key>","status":"triggered","summary":"<text>","source":"<text>","severity":"critical","event_count":1}],"timeline":[{"id":"<id>","at":"<instant>","kind":"triggered","actor":"<name>","text":"<text>"}],"steps":[{"id":"<id>","person":"<name>","kind":"step|low_urgency","channel":"in_app|email","due_at":"<instant>","status":"scheduled|held|queued|sent|cancelled","sent_at":null}],"version":1}
```

A list item carries `id`, `number`, `title`, `service`, `status`, `urgency`, `holders`, `opened_at`, `alert_count` and `countdown`. `resolve_reason` is `Resolved`, `Merged` or `Auto-resolved`.

**Policies, services and maintenance.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET `/api/policies`, GET `/api/policies/<id>` | | 200 | |
| POST `/api/policies`, PUT `/api/policies/<id>` | lead or admin; `{"name","repeats","levels":[{"timeout_minutes","targets":[{"type":"person"\|"schedule","id"}]}]}` | 201, 200 record with `version` | 422 below |
| GET `/api/services`, GET `/api/services/<id>` | | 200 with `own_status`, `status` | |
| POST `/api/services`, PUT `/api/services/<id>` | admin; `{"name","team","policy_id","depends_on":[...],"grouping_mode","grouping_minutes","ack_timeout_minutes","auto_resolve_minutes"}` | 201, 200 | 422 below |
| GET `/api/maintenance-windows` | | 200 `{"items":[{"id","service_id","starts_at","ends_at","state"}]}` | |
| POST `/api/maintenance-windows` | admin; `{"service_id","starts_at","ends_at"}` | 201 | 422 `{"errors":{"ends_at":"The window must end after it starts."}}`; 422 `{"errors":{"starts_at":"The window cannot start in the past."}}` |
| DELETE `/api/maintenance-windows/<id>` | admin | 204, ending it at once | |

Policy validation:
- `{"errors":{"timeout_minutes":"Use at least 1 minute with one target."}}`
- `{"errors":{"timeout_minutes":"Use at least 3 minutes with several targets."}}`
- `{"errors":{"repeats":"A policy repeats at most 9 times."}}`
- `{"errors":{"levels":"A policy has 1 to 20 levels."}}`
- `{"errors":{"targets":"A level has 1 to 10 targets."}}`

`timeout_minutes` defaults to 30 when absent, and `repeats` to 0.

Service validation:
- `{"errors":{"depends_on":"This would make a loop: <name> -> <name> -> <name>"}}`, naming the cycle from the edited service back to itself
- `grouping_mode` is `none`, `window` or `until_resolved`, and `grouping_minutes` is 1 to 1440 with `window` and null otherwise
- `ack_timeout_minutes` is null or 1 to 1440
- `auto_resolve_minutes` is null or 1 to 10080

Each out-of-range value answers 422 with `{"errors":{"<field>":"Out of range."}}`.

**Schedules.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET `/api/schedules`, GET `/api/schedules/<id>` | | 200 with `zone`, `record_format`, `upgraded_at`, `layers` | |
| POST `/api/schedules` | lead or admin; `{"name","zone"}` | 201 | 422 |
| POST `/api/schedules/<id>/layers`, PUT `/api/schedules/<id>/layers/<layer_id>` | lead or admin; `{"name","order","shift_days":<1 to 28>,"handoff_time":"HH:MM","start_date":"YYYY-MM-DD","people":[ids],"restrictions":[{"days":["mon"...],"start":"HH:MM","end":"HH:MM"}]}` | 201, 200 with `version` | 422 |
| GET `/api/schedules/<id>/final` | `?from=<instant>&to=<instant>&zone=<IANA zone>`, with `zone` defaulting to the schedule's; `days` follow that zone | 200 below | 422 `{"errors":{"to":"View at most 35 days."}}`; 35 days is allowed |
| POST `/api/schedules/<id>/overrides/preview` | same as below | 200 `{"losses":[{"person","minutes","from","to"}],"gap_minutes","overlap":null\|{...},"summary":"<Cut preview text>"}`; saves nothing | 422 |
| POST `/api/schedules/<id>/overrides` | lead or admin; `{"person_id":"<id or null>","start","end"}` | 201 `{"override":{"id","person","start","end"},"final":{<blocks around it>}}` | see below |
| DELETE `/api/schedules/<id>/overrides/<override_id>` | lead or admin | 204 | 409 `{"error":"override_started"}` |
| GET `/api/oncall` | `?schedule_id` | 200 `{"schedule":{"id","name"},"at","holder":{"id","name"}\|null,"gap":false,"until":"<instant or null>"}` with `ETag`, `X-Switchlamp-Cache: hit\|miss\|bypass`; 304 on a matching `If-None-Match` | |

Final response:

```json
{"zone":"America/Chicago","from":"<instant>","to":"<instant>","blocks":[{"start":"<instant>","end":"<instant>","minutes":1380,"person":{"id":"<id>","name":"<name>"},"gap":false,"source":"layer","layer_id":"<id>","override_id":null}],"days":[{"date":"2027-03-14","start":"<instant>","end":"<instant>","minutes":1380}],"layers":[{"id":"<id>","name":"<name>","order":1,"blocks":[]}]}
```

A gap block has `person` null, `gap` true and `source` `gap`.

Override errors:
- 409 `{"error":"override_overlap","message":"<Cut refused copy>","overlaps":{"person","start","end"}}`
- 422 `{"errors":{"start":"Overrides start and end on a 15-minute step."}}`
- 422 `{"errors":{"end":"An override must end after it starts."}}`
- 422 `{"errors":{"end":"An override lasts at most 14 days."}}` (14 days is allowed)
- 422 `{"errors":{"start":"Overrides cannot change the past."}}`

**Status.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET `/api/status`, GET `/status` | public | 200 with `ETag`, `X-Switchlamp-Cache`; 304 on a matching `If-None-Match` | |
| POST `/api/status/subscribers` | public; `{"email"}` | 201 `{"status":"subscribed"}`; repeating an address answers the same | 422 `{"errors":{"email":"Enter a valid email address."}}` |
| GET `/status/unsubscribe/<token>` | public | 200 page | 404 |
| GET `/api/status-updates` | lead or admin | 200 `{"items":[...]}` with drafts | |
| POST `/api/status-updates`, PUT `/api/status-updates/<id>` | lead or admin; `{"title","body","state":"investigating\|identified\|monitoring\|resolved","service_ids":[...]}` | 201, 200 record with `"published_at":null` | 409 `{"error":"already_published"}` on PUT; 422 |
| POST `/api/status-updates/<id>/publish` | lead or admin | 200 record with `published_at`, `"subscribers":<count>` | 409 `{"error":"already_published"}` |

`GET /api/status` body: `{"firm":"Tarecross Software","headline","plate":"dusk|night","slower":false,"services":[{"name","status"}],"maintenance":[{"service","ends_at"}],"updates":[{"title","state","body","services":["<name>"],"published_at"}]}`.

**Webhooks.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET `/api/webhooks` | admin | 200 `{"items":[...]}` without secrets | |
| POST `/api/webhooks` | admin; `{"name","path":"/<path under the receiver>","event_types":[...],"service_ids":[...]}`, with an empty `service_ids` meaning all services | 201 `{"id","name","path","event_types","service_ids","secret":"whsec_<hex>"}`; the secret is shown only here | 422 `{"errors":{"path":"The path must start with /."}}` |
| DELETE `/api/webhooks/<id>` | admin | 204 | |
| GET `/api/webhooks/<id>/deliveries` | admin; `?limit&after` | 200 `{"items":[{"id","event_id","type","status":"pending\|retrying\|delivered\|rejected\|failed","next_attempt_at","attempts":[{"attempt","at","status_code":<code or null>,"body":"<first 2000 characters of the answer>","outcome"}]}],"next_cursor"}` | |
| POST `/api/webhook-deliveries/<id>/replay` | admin | 202 delivery | 409 `{"error":"delivery_in_progress"}` |

**People, keys and analytics.**

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET `/api/users` | not stakeholder | 200 `{"items":[{"id","name","email","role","timezone"}]}` | |
| PATCH `/api/users/<id>` | admin; `{"role":"responder\|lead\|admin\|stakeholder"}` | 200 user | 409 `{"error":"last_admin"}` |
| POST `/api/users/<id>/sign-out` | admin | 204 | |
| DELETE `/api/users/<id>` | admin | 204; that person can no longer sign in or be chosen | 409 `{"error":"last_admin"}`; 409 `{"error":"still_needed","breaks":[{"schedule","start","end"}\|{"policy","level"}]}`, in schedule then start order, policies last |
| GET `/api/api-keys` | admin | 200 `{"items":[{"id","name","scope","prefix","grace_ends_at","revoked_at"}]}` | |
| POST `/api/api-keys` | admin; `{"name","scope":"read\|write"}` | 201 `{"id","name","scope","key":"slk_<hex>"}`; the key is shown only here | 422 |
| POST `/api/api-keys/<id>/rotate` | admin; `{"grace_minutes":<0 to 1440>}`, default 60 | 200 `{"key":"slk_<hex>","grace_ends_at"}` | 409 `{"error":"key_revoked"}`; 422 |
| DELETE `/api/api-keys/<id>` | admin | 204 | |
| POST `/api/analytics/jobs` | `{"from":"YYYY-MM-DD","to":"YYYY-MM-DD"}` | 202 job, or 200 finished job with `"cached":true` | 422 `{"errors":{"to":"The range must end on or after its start."}}` |
| GET `/api/analytics/jobs/<id>` | | 200 `{"id","from","to","state":"running\|done","done","total","cached","rows":[{"name","kind":"service\|team","incidents","mtta_minutes":"12.5","mttr_minutes":"50.0"}],"overall":{"incidents","mtta_minutes","mttr_minutes"}}`; `rows` and `overall` are null while running | |
| GET `/api/analytics/jobs/<id>/download` | | 200 `text/csv`, header `name,incidents,mtta_minutes,mttr_minutes`, one row per item of `rows` in order, then `All services` | 409 `{"error":"job_running"}` |
| GET, POST `/ack/<token>` | public; GET never changes anything | 200 valid or done page | 410 used or out-of-date page; 404 invalid page |

Cross-origin state changes and unmatched API paths are owned by Server boundary and the 404 shape above.

### Business rules (DP-03 to DP-06, DP-11, DP-15 to DP-33, DP-35 to DP-42, DP-44 to DP-54, DP-61, DP-64, DP-65, DP-69, DP-71, DP-74, DP-75)

**One clock.** Every product timer runs on one server clock, kept in Postgres: real time plus an offset. It moves only forward. When held (`frozen`), it stands still until released, then runs on from that value. A move applies every due timer in deadline order, each stamped with its own deadline, so a two-hour jump walks each escalation step in turn. Actions are stamped with the server clock in whole seconds.

**The edge rule.** Every timed period includes its start second and excludes its end second, so at second T the timer ending at T has already fired. An action stamped T sees the state after the timer. An action stamped T minus one second sees the state before it. This one rule covers:
- escalation
- acknowledge timeout
- snooze end
- auto-resolve
- grouping windows
- maintenance windows
- quiet hours
- the rate window
- key grace
- link and token expiry
- handoffs

Every read and action applies due timers first, so no answer is ever stale.

**Drills.** A drill opens a real alert and incident on a service directly, so a service can be checked without depending on its monitor. It passes through no routing key, queue or rate limit and writes no event log row, and its alert has `routing_key` null, so events never touch it. Its `triggered` entry has the admin's name as actor. In every other way it follows the same rules as a trigger, including grouping, policy and maintenance, where it answers 409 `{"error":"in_maintenance"}` inside a window. Bad fields answer 422 under `summary` and `severity` with the intake sentences, and under `service_id` with `Choose a service.`

**Urgency.** `critical` and `error` make high urgency, and `warning` and `info` make low urgency. An incident's urgency is that of the most severe alert it has held, so it can rise and never falls. When a joining or moved alert raises a triggered incident to high, one `urgency_raised` entry is written at that second, any pending low-urgency notice is cancelled, escalation starts at level 1, cycle 0, with its full timeout, and the holders' high-urgency steps start from delay zero. A raise on an acknowledged or snoozed incident writes the entry and notifies no one. Low-urgency incidents never escalate and have no escalation countdown.

**Firm zone and business hours.** The firm's zone is `America/Chicago`. Business hours are Monday to Friday, 08:00 to 18:00, in that zone, with no holidays.

**Rate window.**
- Each routing key allows 120 counted events in a window, and the 120th is allowed.
- A window opens at the first counted event and lasts 60 seconds on the server clock.
- Only events that pass intake validation count. An event answered 429 or 503 does not count and opens no window, so a broker outage uses no slot.
- `count` is the counted events of the running window, and 0 when no window is running.
- From the moment `count` reaches 120 until the window ends, whether or not a 429 has been answered yet, `available` is false and `retry_after` is the whole seconds to the window's end, at least 1. At all other times `available` is true and `retry_after` is null.
- The integration page's countdown follows `retry_after` and reaches zero at that exact second. At the window's end second `count` is 0 and the page reads `Accepting events`.
- For example, with a window opened at second T and the 120th event at T+10, `retry_after` reads 50 at T+10 and 1 at T+59, and at T+60 the next event counts as 1.
- The count and window are kept in Valkey, so a restart of the app carries on with them unchanged.
- With Valkey unreachable, intake accepts events uncounted, and the integration's `counter` has `count` null, `available` true and `retry_after` null.
- A copy with its own `SWITCHLAMP_INSTANCE` has its own counter.

**Event application.**
- Intake numbers each accepted event per routing key and dedup key with `key_seq`, starting at 1 with no gaps. A number that did not get a broker confirm is reused.
- The worker applies `key_seq` k only after k-1. A message that arrives early waits.
- If an earlier number has not arrived after 60 real seconds, the waiting message becomes a dead letter with the Feedback states reason, and it no longer blocks later numbers.
- A number that has become a dead letter also no longer blocks later numbers.
- A copy with an `event_id` already applied has no effect at all: no alert, count, timeline entry, log row or mail.

**Event effects.**
- **Trigger on a key with no open alert:** opens a new alert, joining a grouped incident or opening a new one. A resolved alert never reopens. An alert belongs to its routing key and dedup key together.
- **Nobody on call:** when a trigger would open an incident and every level of the service's policy is empty at that second, no alert or incident opens and the event is logged `Dropped` with its reason.
- **Trigger on an open alert:** adds one to `event_count`, adds one `repeat_event` entry, logs `Applied`, and sends nothing.
- **Acknowledge event:** moves the incident from triggered to acknowledged, with the integration's name as actor, and is otherwise dropped with its reason. On an acknowledged or snoozed incident with an open alert it drops as `This alert is already acknowledged.`
- **Resolve event:** resolves the alert, and the incident resolves when its last open alert does, with that name as actor.
- **Trigger during a maintenance window:** logged `Suppressed` with its reason, with no alert and no incident. Acknowledge and resolve events still apply, and open incidents stay exactly as they are.

**Retries and dead letters.**
- A message that cannot be applied is tried 3 times in all, with waits of 1 and 2 real seconds, then becomes a dead letter.
- The worker checks, on triggers, `payload`, `payload.summary`, `payload.source` and `payload.severity`. On every message it checks, in this order first, `event_id`, `routing_key`, `dedup_key`, `key_seq` and `event_action`. The first absent field names the reason.
- Replay applies the stored or corrected message as of now, once, and logs `Replayed`. A concurrent second Replay gets the 409.

**Grouping.** With `none`, every new alert opens its own incident. With `window`, the first alert opens an incident and starts its window at that second. A later alert on a new key for the same service joins the service's most recent incident while the incident is open and inside the window. A resolve ends the window early. An alert after the window opens a new incident with its own window, and the older incident stays open. With `until_resolved`, a new alert joins the service's most recent incident for as long as that incident is open. Apart from the Urgency rule, joining never changes status, holder or timers. For example, with a 5-minute window opened at T, an alert at T+4:59 joins and an alert at T+5:00 opens a new incident.

**Incident states.**

| From | Action | To | Rejection or note |
|---|---|---|---|
| triggered | acknowledge | acknowledged | |
| triggered | snooze | none | 409 `illegal_transition` |
| triggered, acknowledged, snoozed | resolve | resolved | |
| triggered, acknowledged, snoozed | reassign | triggered | Cancels any snooze; timers follow the Reassign rule |
| acknowledged | acknowledge | none | 409 `already_decided` |
| acknowledged | snooze | snoozed | |
| acknowledged | acknowledge timeout | triggered | |
| snoozed | snooze ends | triggered | |
| snoozed | acknowledge by someone other than the snoozer | acknowledged | Ends the snooze and writes `acknowledged` |
| snoozed | acknowledge by the snoozer | none | 409 `already_decided` |
| snoozed | snooze | none | 409 `already_decided` |
| resolved | any action | none | 409 `already_decided`, or `merge_target_resolved` and `merge_source_resolved` on merge |
| open source | merge | resolved | `resolve_reason` Merged, `merged_into` set |

A resolved incident never reopens. Every state change writes exactly one timeline entry.

**First decision wins.** When people act on one incident at once, the first to commit succeeds and every request it has made illegal receives the conflict body naming who decided. Requests that stay legal in sequence, such as an acknowledge and then a resolve, both succeed in commit order. Each successful decision makes one effect, one timeline entry and one webhook event. On a resolved incident, `decision` is `resolved`, `decided_at` is the second it resolved, and `decided_by` is the actor of the entry that resolved it. For a merged incident that actor is the person who merged it. For an auto-resolved incident it is `Switchlamp`, so the Feedback states copy reads `Already resolved by Switchlamp.`

**Snooze.** Presets are in API. A custom time may be up to and including 168 hours from now. A snooze replaces the acknowledge timeout and sets `auto_resolve_at`, when the incident has one, to the snooze's end plus the auto-resolve minutes. Returning to triggered restarts the current level's full timeout and notifies the holders again. For an incident with auto-resolve, `auto_resolve_at` after a snooze is as follows:
- When the snooze ends at its own time, it stays as the snooze set it.
- When another person's acknowledge ends the snooze early, it becomes that acknowledge's second plus the auto-resolve minutes, and the acknowledge timeout starts from that second.
- When a reassign cancels the snooze, it becomes the reassign's second plus the auto-resolve minutes.

`snoozed_until` becomes null in all three cases, and an incident without auto-resolve keeps `auto_resolve_at` null. For example, on a service with 240 minutes of auto-resolve, an incident opened at 12:00, acknowledged at 12:10 and snoozed there for 1 hour has `auto_resolve_at` 17:10. If another person acknowledges at 12:40 it becomes 16:40.

**Acknowledge timeout.** On acknowledge, `ack_timeout_minutes` of the incident's current service, as it stands at that second, sets the deadline, and at that deadline the incident returns to triggered. No value means no timeout.

**Auto-resolve.** An incident copies `auto_resolve_minutes` from its service when it opens, so a change applies only to incidents opened after it was set. `auto_resolve_at` is `opened_at` plus those minutes and moves only as the Snooze rule states. Reassigning to another service keeps the copied minutes. Auto-resolve fires from triggered or acknowledged, with `resolve_reason` Auto-resolved.

**Opened-with policy.** An incident copies its service's policy into `policy_snapshot` when it opens and uses only that copy for every later step, on every surface. An edit reaches later incidents only. The one exception is reassigning to another service, which takes that service's policy as it stands then.

**Escalation.**
- A high-urgency incident starts at level 1, cycle 0, and notifies every target's current holder.
- A schedule target resolves to whoever is on call at that second.
- At the level's timeout it moves to the next level.
- After the last level, it returns to level 1 and `cycle` rises by one, until `cycle` equals `repeats`.
- After that it stays with the last level's holders, and its countdown follows the order in Feedback states.
- A level with nobody on call is skipped in the same second.
- If every level has become empty for an incident already open, `holders` is empty, the figure reads `Nobody`, the incident stays triggered, and it tries again when level 1's timeout passes.
- A policy repeats at most 9 times. After the last pass the holders are not notified again, and no entry is written.
- For example, Tracking escalation (2 repeats, two levels of 30 minutes) opened at T is at level 1 cycle 0 from T, level 2 cycle 0 from T+30, level 1 cycle 1 from T+60, level 2 cycle 1 from T+90, level 1 cycle 2 from T+120 and level 2 cycle 2 from T+150, and from T+180 it reads `Escalation finished`. If Tracking Nights has nobody on call at T, level 2 starts in that same second and its 30 minutes run from T.
- Acknowledged and snoozed incidents do not escalate.

**Handoff of a page.** When a schedule target's holder changes, by rotation, override or edit, a triggered incident held through that target moves at that second to the new holder. The new holder's steps start from delay zero and the old holder's unsent steps become `cancelled`. The escalation deadline does not change, and one `handed_off` entry is written. An acknowledged or snoozed incident stays with its person.

**Notification steps.**
- `notification_delays` is 1 to 5 whole minutes, each 0 to 60.
- Becoming a holder of a high-urgency incident schedules one step per delay. Each is a mail at its due second carrying a fresh acknowledge link.
- Becoming a holder of any incident also writes one in-app step, `channel` `in_app`, `sent` at that second and counted by `Notices for you`.
- A step becomes `cancelled` when the incident leaves triggered or the person stops holding it, so an acknowledge cancels every pending step. For example, with delays `[5, 15]`, a holder from T gets the in-app step at T and mail at T+5, and an acknowledge at T+7 cancels the mail due at T+15.
- A step becomes `queued` when due and `sent` only once the mail server accepted it.

**Quiet hours.** A low-urgency incident gives its holder one mail notice after `low_urgency_delay` minutes, outside quiet hours. Inside the holder's `quiet_start` to `quiet_end`, read in their own profile zone and possibly crossing midnight, it is `held` and goes out at the end second in that zone, whatever the browser, UTC or firm zone says. For example, Priya Lindqvist's notice due at 2027-01-10T17:00:00Z (22:30 in Asia/Kolkata) goes out at 2027-01-11T01:30:00Z (07:00 there). Quiet hours never delay high urgency. Resolving or acknowledging first cancels the notice.

**Acknowledge links.**
- A link is signed for one person, one incident and one assignment, and expires 30 minutes after its mail's due second.
- A GET or POST shows the first page that applies, in this order:
  1. The token is tampered: the invalid page.
  2. The link has already acknowledged the incident: the used page, naming the link's person, whatever has happened since.
  3. The incident is resolved: the out-of-date page.
  4. The incident is acknowledged or snoozed: the used page, naming whoever made the acknowledge that stands, even if the link has also expired or its person no longer holds the incident.
  5. The incident is triggered, and the link has expired or its person no longer holds the incident: the out-of-date page.
  6. Otherwise a GET shows the valid page, and a POST acknowledges as that person and shows the done page.
- The done page answers only the one POST that acknowledged, so a repeated or simultaneous second POST gets the used page.

**Merge and split.** Sources must be open. A combined total over 1000 alerts blocks the merge. Alerts move with their keys unchanged, the target's holders, responders and timers stay, the target's timeline shows the sources' entries with its own in time order, each carrying `from_number`, source timers stop and unsent source steps are cancelled. An event on a moved key lands on the alert where it now lives. Splitting a target's alert opens a new incident with that alert, on that alert's service at its current policy, starting at level 1. The source's last alert cannot be split.

**Extra responders.** Anyone who may act on an incident can ask another person to join, which notifies that person through an in-app step. Accepting adds them to `responders` and `Responders`, and declining does not. Each answer writes its entry, and the first answer stands. Responders do not hold the incident and take no escalation steps.

**Reassign.**
- To a person: holders become that person, `level` and `cycle` stay, and the current level's full timeout restarts from that second. If escalation had already finished, it stays finished with that person.
- To a service: the incident's service changes, the old service joins `impacted_services` and stays listed there, the alerts keep their dedup keys, the policy is taken as above, `level` returns to 1 and `cycle` to 0, holders follow it, and the level's full timeout starts from that second.
- Either way the status becomes triggered, and any acknowledge deadline and snooze are cancelled. The next acknowledge sets the acknowledge timeout by the rule above.
- `auto_resolve_at` stays unchanged, unless a snooze was cancelled, when the Snooze rule sets it.
- `countdown` follows the order in Feedback states, so a low-urgency incident still has no escalation countdown.
- A reassign writes one `reassigned` timeline entry and sends one `incident.reassigned` webhook event, and never `incident.unacknowledged`.

**Schedules.**
- A schedule has a zone and layers. Higher `order` sits above lower.
- A layer's holder at any moment comes from counting local-date shifts of `shift_days` from `start_date` at `handoff_time`, through `people` in turn. Before `start_date` at `handoff_time` the layer has no holder and never extends backwards, so that time falls to lower layers or is a gap.
- `restrictions` limit a layer to those local windows, and `end` may be `24:00`. An `end` earlier than `start` crosses midnight, and `days` always names the local day a window starts on, so `{"days":["fri"],"start":"22:00","end":"06:00"}` runs from Friday 22:00 to Saturday 06:00.
- The final schedule starts from the lowest layer, each higher layer replaces it wherever that layer has a holder, and overrides replace everything.
- Any moment left without a person is a flagged gap.
- A block runs from one change of holder or source to the next.
- For example, Transport Primary's block from 2027-03-13T14:00:00Z to 2027-03-14T13:00:00Z is Ines Varga's and measures 1380 minutes, because the clock change falls inside it, and 2027-03-14T13:00:00Z is Tomasz Reyes's 08:00 handoff. In America/Chicago the day 2027-03-14 measures 1380 minutes and 2027-11-07 measures 1500.

**Daylight saving.** A handoff keeps its local time on every date. A local time that does not exist that day takes the first valid instant after the jump, so 02:30 becomes 03:00. A local time that happens twice takes its first occurrence. Local days therefore measure 1380, 1440 or 1500 minutes, and the grid uses one scale for all of them.

**Layer edits.** An edit takes effect from the second it is saved. Blocks before that second, and who held any past incident, never change. The layer's earlier form continues to compute the past, so a past range reads identically before and after the edit.

**Overrides.**
- `start` and `end` fall on a 15-minute step of the clock.
- A `start` in the past but inside the current 15-minute step is clipped to the present second. Anything earlier is refused.
- `person_id` null makes a deliberate gap, flagged like any other.
- The overlap rule: an override may not overlap another override on that schedule, and touching ends is allowed.
- `losses` lists each person whose final minutes the cut takes.
- A saved cut covering the present changes who is on call at once and triggers the handoff rule above.

**Who is on call.** The answer changes at the exact handoff second on a fresh load and on every open screen. No cached copy outlives its `until` second.

**Cache clearing.** Any schedule, layer, override or policy edit, any service or maintenance edit, any published update, any incident status change, and any clock move clears the matching cached copies before its response returns.

**Removing a person.** A person cannot be removed while they hold a final-schedule shift within the next 60 days or are named as a level's target. The refusal lists everything that would break, on screen and in the API, and changes nothing. Focus stays on `Remove <name>`.

**Calendar feed.** The feed holds one event per final-schedule shift of its owner from 14 days before now to 60 days after, in UTC, with summary `On call: <schedule name>`. A token expires 365 days after creation. Regenerating kills the old token at once, and revoking stops the feed at once. A feed holds no incident or note data.

**Older schedules.** Records with `record_format` 1 store their handoff as a UTC time. On start, a background upgrade once rewrites each to `record_format` 2 with its local `handoff_time`, sets `upgraded_at`, and leaves that value untouched on later starts. Reads during the upgrade answer the same blocks as after it, and never wait for it.

**Status rollup.**
- A service's own status is `Major outage` with an open critical alert, `Partial outage` with an open error alert, and `Degraded` with an open warning or info alert.
- Otherwise it is `Maintenance` inside a running window, and otherwise `Operational`.
- Its shown status is the worst of its own status and that of every service it depends on, directly or not, in the order `Major outage`, `Partial outage`, `Degraded`, `Maintenance`, `Operational`.
- For example, an open critical alert on Carrier Data Exchange shows `Major outage` on it and on every service that depends on it, directly or not, which in the seed data is all four.
- The headline is the running headline when all are `Operational`, the maintenance headline when the worst is `Maintenance`, and the affected headline otherwise.
- The plate is `night` when the latest published update's state is not `resolved`, and `dusk` otherwise, including with no updates.

**Private data.** Notes, drafts, people's names and addresses, holders, dedup keys, sources, custom details and incident numbers never reach the status page, `/api/status`, their cached copies or subscriber mail. Webhook bodies never carry notes, drafts or people's addresses.

**Publishing.** Publishing makes an update public at that second and immutable. It queues one mail per current subscriber and clears the status cache, whether or not mail is reachable.

**Webhook backoff.**
- Each subscribed event makes one delivery with one event id, and the first attempt goes at once.
- A 2xx answer means `delivered` and attempts stop.
- A 5xx, a 429, no answer, or no answer within 10 real seconds means `retrying`.
- Any other answer means `rejected` and attempts stop.
- Retries wait 10 seconds, 30 seconds, 2 minutes, 10 minutes and 1 hour on the server clock, for 6 attempts in all, so from T they go at T+10 s, T+40 s, T+160 s, T+760 s and T+4360 s. A sixth failure means `failed`.
- An endpoint gets only its `event_types` and, when `service_ids` is not empty, only those services' incidents.
- A Replay starts a fresh series on the same schedule under the same event id, with attempt numbers continuing from the last.
- Replay is refused while the delivery is pending or retrying.

**Webhook event types.** `incident.triggered`, `incident.acknowledged`, `incident.snoozed`, `incident.unacknowledged` (for a return to triggered when an acknowledge timeout or a snooze ends), `incident.escalated`, `incident.reassigned`, `incident.merged`, `incident.resolved`. A merged source sends `incident.merged` with `resolve_reason` `Merged` and `merged_into` set to the target's number.

**API keys.** Rotating issues a new key at once, and the old key works until `grace_ends_at`, so with 60 minutes of grace from T a request at T+59:59 succeeds and one at T+60:00 answers 401. Revoking kills every form of the key at once.

**Role rights.**

| Right | Responder | Lead | Admin | Stakeholder |
|---|---|---|---|---|
| Public status page | yes | yes | yes | yes |
| Read incidents, schedules, policies, services, integrations, analytics | yes | yes | yes | no |
| Acknowledge, snooze, resolve, notes, own settings, own feed | yes | yes | yes | no |
| Reassign | yes | yes | yes | no |
| Merge, split | no | yes | yes | no |
| Edit schedules, layers, overrides, policies; Replay dead letters; status desk | no | yes | yes | no |
| Services, integrations, maintenance, webhooks, keys, roles, sign-outs, operator clock | no | no | yes | no |

**Immediate access change.** A role change or forced sign-out applies to that person's very next request. Within a second every open screen closes its socket with the published code and switches. A person now without access to the page goes to `/status`, or to `/sign-in` when signed out. Nothing further reaches them on the closed socket. A stakeholder may not open the socket.

**Analytics.**
- A job measures one service at a time and takes at least one real second per service, sending `done` over the socket after each. The figures come from the job, and the page opens by starting one on the default range. `?from&to&job=<id>` holds it in the address, so a reload or second tab follows the same job. A job finishes even if every page is closed.
- A finished result is cached in Valkey until an incident opened in that range changes, and a job for that range then answers at once with `cached` true.
- `rows` holds the services, then each team as `kind` `team`.
- An incident counts in the range holding its `opened_at` date in the firm's zone, both ends included.
- Time to acknowledge runs from opening to the first acknowledge, whatever happens later.
- Time to resolve runs from opening to resolution, minus snoozed time.
- Only seconds inside business hours count.
- A later return to triggered does not restart either measure.
- A source closed by merge is left out completely, and the target keeps its own times.
- Incidents without the end point are left out of that measure but still counted in `incidents`.
- Means are taken over exact seconds, shown in minutes rounded half up to one decimal, with `n/a` when there is nothing to measure.
- With `to` absent it is today's date in the firm's zone on the server clock. With `from` absent it is 29 days before `to`, so the default range covers 30 days, both ends included. `/analytics` opens on this default range.
- Services and teams each run by name alphabetically. A service or team with no incidents in the range has `incidents` 0 and `n/a` for both measures.
- A team's row and `overall` and the `All services` row use the same rules across all their incidents in the range, never a mean of means.
- `table "Response measures"` shows the rows in the same order, then `All services`, and the download holds the same strings.
- After a reload, and in a second tab, `progressbar "Analytics progress"` shows the job's current `done` from its first paint and never goes back.

**Paging.** Default page size is 25, the maximum is 100, and 100 is allowed. Ordering is newest opening instant first, then higher incident number first. Cursors name a position, so arrivals and removals elsewhere never repeat or skip a row. `total` is exact at the moment of each response.

### Services (DP-01, DP-03, DP-04, DP-09, DP-10, DP-26, DP-29, DP-30, DP-40, DP-45, DP-46, DP-49, DP-50, DP-51, DP-57, DP-65, DP-71)

`<instance>` below is the value of `SWITCHLAMP_INSTANCE`, with default `main`.

**Postgres.** The system of record for services, policies and their opened-with copies, schedule layers, overrides, incidents, alerts, timelines, drafts, the clock offset and pending timers. Schema is applied idempotently on every serve. If the database is empty, seed data loads once.

**RabbitMQ.** A durable queue `switchlamp.<instance>.events` carries persistent JSON messages. The publisher confirm is what makes an event accepted. If the confirm does not arrive within 5 real seconds, intake answers the 503 from API and the event is not accepted. A message body:

```json
{"event_id":"<uuid>","routing_key":"rk_transport_0001","dedup_key":"tms-db-cpu","key_seq":1,"event_action":"trigger","payload":{"summary":"<text>","source":"<text>","severity":"critical"},"accepted_at":"<instant>"}
```

Workers consume any message in this shape from that queue, whoever published it. Dead letters sit in the durable queue `switchlamp.<instance>.events.dead` until a successful Replay removes them.

**Valkey.** All keys start `switchlamp:<instance>:`.
- `rate:<routing_key>` is a hash with `window_start` (epoch seconds of the server clock) and `count`, and it has a time to live of no less than a day.
- `cache:analytics:<from>:<to>` holds a finished result, with no fixed lifetime.
- `cache:oncall:<schedule_id>`, `cache:status:json` and `cache:status:html` are hashes with `etag` and `body`, each living at most 5 minutes.
- When Valkey is unreachable, on-call and status are computed from Postgres, answer `X-Switchlamp-Cache: bypass`, show the slower-state copy and keep correct values. `/api/status` sets `slower` true.
- Caching resumes within 5 seconds of Valkey's return with no restart.

**Mailpit.** The app sends SMTP to `SMTP_HOST`:`SMTP_PORT`, from `MAIL_FROM` when set and otherwise `Switchlamp <pager@tarecross.example>`.

| Mail | To | Subject | Body must hold |
|---|---|---|---|
| Notification step | Holder's email | `[Switchlamp] Incident #<number> needs you: <title>` | Line `Acknowledge: <APP_PUBLIC_URL>/ack/<token>` |
| Low-urgency notice | Holder's email | `[Switchlamp] Low urgency incident #<number>: <title>` | The same line |
| Status update | Subscriber's email | `[Tarecross status] <title>` | Line `State: <state label>`, using the `Update state` label from Public screens, update body, line `Unsubscribe: <APP_PUBLIC_URL>/status/unsubscribe/<token>` |

Mail that cannot go stays queued in Postgres and is retried every 5 real seconds, with the mail host and port read for each attempt. Each message arrives exactly once, in due order for one person.

**WireMock.** WireMock stands in for the outside receiver, and its data is invented. Every webhook is `POST <WIREMOCK_URL><path>` with `Content-Type: application/json`, and the published baseline answers any path under `/hooks/` with status 200 and body `{"received":true}`. Headers:
- `X-Switchlamp-Event-Id: <uuid>`
- `X-Switchlamp-Timestamp: <unix seconds on the server clock at this attempt>`
- `X-Switchlamp-Attempt: <1 upward>`
- `X-Switchlamp-Signature: v1=<lowercase hex HMAC-SHA256 of "<timestamp>.<raw body>" under the endpoint's secret>`, so timestamp `1773496800`, body `{"id":"e1"}` and secret `whsec_seed_carrier_desk_7f3a` sign as `v1=7f79dd4aebf42807543e48def13e54148f2dc64db31c602f5e0d2ba71136965b`

Body: `{"id":"<event uuid>","type":"incident.triggered","occurred_at":"<instant>","incident":{"id":"<uuid>","number":5,"title":"<text>","service":"<name>","status":"triggered","urgency":"high","resolve_reason":null,"merged_into":null}}`. When the receiver is unreachable, the attempt records `status_code` null and the backoff continues.

### Seed data (DP-33, DP-37, DP-44, DP-49, DP-52, DP-54, DP-61, DP-65, DP-71)

Every seeded person and business is invented. The password of every account is `yard-lamp-2026`.

| Name | Email | Role | Zone | Quiet hours |
|---|---|---|---|---|
| Rowan Achterberg | `rowan@tarecross.example` | admin | America/Chicago | none |
| Sunniva Okoye | `sunniva@tarecross.example` | lead | America/Chicago | none |
| Dario Mbeki | `dario@tarecross.example` | lead | Europe/Lisbon | none |
| Ines Varga | `ines@tarecross.example` | responder | America/Chicago | 22:00 to 07:00 |
| Tomasz Reyes | `tomasz@tarecross.example` | responder | America/Chicago | 22:00 to 07:00 |
| Priya Lindqvist | `priya@tarecross.example` | responder | Asia/Kolkata | 22:00 to 07:00 |
| Mateus Oyelaran | `mateus@tarecross.example` | responder | Europe/Berlin | 23:00 to 07:00 |
| Hana Castellanos | `hana@tarecross.example` | stakeholder | America/Chicago | none |

Everyone's `notification_delays` is `[5, 15]` and `low_urgency_delay` is 0.

**Schedules** (`record_format` 2 unless noted):

| Schedule | Zone | Layer (order) | `shift_days`, handoff, start | People in order | Restrictions |
|---|---|---|---|---|---|
| Transport Primary | America/Chicago | Primary days (1) | 1, 08:00, 2026-01-05 | Ines, Tomasz, Priya, Mateus | none |
| Carrier Data | America/Chicago | Base week (1) | 7, 09:00, 2026-01-05 | Tomasz, Ines | none |
| Carrier Data | America/Chicago | Weekend cover (2) | 7, 00:00, 2026-01-03 | Mateus, Priya | sat, sun 00:00 to 24:00 |
| Tracking Nights | Europe/Berlin | Nights (1) | 1, 20:00, 2026-01-05 | Mateus, Priya | every day 20:00 to 06:00 |
| Legacy Yard Rota | America/Chicago | Yard week (1) | 7, stored as UTC 14:00 (local 08:00 after upgrade), 2026-01-05 | Ines, Tomasz | none; `record_format` 1 at seed |

**Policies:**

| Policy | Repeats | Levels |
|---|---|---|
| Transport escalation | 0 | Schedule Transport Primary, 30 minutes; then Sunniva Okoye, 30 minutes |
| Carrier escalation | 0 | Schedule Carrier Data, 10 minutes; then Dario Mbeki and Sunniva Okoye, 5 minutes |
| Tracking escalation | 2 | Schedule Tracking Nights, 30 minutes; then schedule Transport Primary, 30 minutes |
| Portal escalation | 0 | Priya Lindqvist, 30 minutes |

**Services and integrations:**

| Service | Team | Policy | Depends on | Grouping | Ack timeout | Auto-resolve | Integration, routing key |
|---|---|---|---|---|---|---|---|
| Transport Management | Freight Core | Transport escalation | Carrier Data Exchange | none | 30 | none | Transport monitor, `rk_transport_0001` |
| Carrier Data Exchange | Freight Core | Carrier escalation | none | window, 5 minutes | none | 240 | Carrier monitor, `rk_carrier_0002` |
| Shipment Tracking | Customer Visibility | Tracking escalation | Carrier Data Exchange | none | none | none | Tracking monitor, `rk_tracking_0003` |
| Customer Portal | Customer Visibility | Portal escalation | Shipment Tracking, Transport Management | until resolved | none | none | Portal monitor, `rk_portal_0004` |

**Resolved incidents on Shipment Tracking.** New incidents number from 5. No incident is open at start. Every acknowledge, snooze and resolve in this table was made by Ines Varga, and the merge by Sunniva Okoye.

| Number | Key | Opened | Acknowledged | Snoozed | Resolved |
|---|---|---|---|---|---|
| 1 | `tracking-late-1` | 2026-10-06T14:00:00Z | 2026-10-06T14:12:30Z | | 2026-10-06T15:00:00Z |
| 2 | `tracking-late-2` | 2026-10-06T22:50:00Z | 2026-10-07T13:05:00Z | | 2026-10-07T13:20:00Z |
| 3 | `tracking-late-3` | 2026-10-08T14:00:00Z | 2026-10-08T14:10:00Z | 2026-10-08T14:10:00Z to 2026-10-08T15:10:00Z | 2026-10-08T16:00:00Z |
| 4 | `tracking-late-4` | 2026-10-08T14:05:00Z | | | 2026-10-08T14:06:00Z, Merged into 3 |

For example, with the seed data at start, the range `2026-10-01` to `2026-10-31` shows Shipment Tracking and the Customer Visibility team each with 3 incidents, `12.5` and `50.0`, and Freight Core with 0 incidents and `n/a`.

**Private markers.** Incident 1 holds the note `NOTE-ONLY: rollback key is in vault slot 7.`, written by Ines Varga. Unpublished draft: title `Carrier feed slowdown`, body `DRAFT-ONLY: carrier feed slowdown under review.`, state `investigating`.

**Published update.** Title `Tracking delays cleared`, body `Tracking updates are back on time.`, state `resolved`, service Shipment Tracking, published `2026-10-08T17:00:00Z`.

**Subscribers.** `dock-office@meridian-haulage.example`, `ops@larkfield-freight.example`.

**Webhook endpoint.** `Carrier desk receiver`, path `/hooks/carrier-desk`, secret `whsec_seed_carrier_desk_7f3a`, all event types.

**API key.** `Dock board reader`, scope `read`, key `slk_seed_read_4c1d`.

## Technical requirements

### Deployment (DP-56, DP-57)

Backend: Go 1.27 with the Go toolchain the images ship. Frontend: TypeScript/JavaScript built with Node 22 in the same `build`, or pages rendered by the backend in Go.

Commit `go.sum`. Browser-side WASM is not available. No system library beyond build-essential is installed, so talk plain protocols to the services and use no OpenSSL headers.

`/app/run.json` holds string `install`, `build` and `serve` plus `"_schema":"run-manifest-v1"`, for example:

```json
{"_schema":"run-manifest-v1","install":"go mod download","build":"go build -o bin/server .","serve":"./bin/server"}
```

Serve binds `0.0.0.0` on port 4173, honouring `APP_PUBLIC_PORT` when set, and `GET /api/health` answers as API states. Plates are generated during `build` from the seeded script with no network. One serve process runs against a database at a time and runs intake, workers and timers itself. Stopping it and running `serve` again with the same environment is a restart: every record is still there and nothing already sent goes out again.

### Configuration and secrets (DP-56, DP-57)

Read at start, never hard-coded and never sent to the browser:
- `DATABASE_URL`
- `AMQP_URL`
- `VALKEY_URL`
- `SMTP_HOST`, `SMTP_PORT`
- `MAILPIT_URL`
- `WIREMOCK_URL`
- `MAIL_FROM` (optional)
- `APP_PUBLIC_URL`, used to build links in mail, falling back to the request's origin form on the serving port

`SWITCHLAMP_INSTANCE` (default `main`) names this copy's queues and keys, so copies with separate databases never read each other's work.

The signing secret for acknowledge links and tokens is generated on first start and kept in Postgres. Webhook secrets and API keys are stored server-side, and API keys only as hashes, apart from the seeded value's matching hash.

### Server boundary (DP-44, DP-56, DP-57)

- The app is same-origin only and sends no permissive cross-origin headers.
- A state-changing cookie request or socket upgrade whose `Origin` differs from the app's answers 403 `{"error":"cross_origin"}`. `POST /api/events` and bearer-key requests carry no cookie and are exempt.
- Request bodies are limited to 1,000,000 bytes, the limit allowed, except the intake limit in API.
- The server never serves source files, the manifest, environment values, secrets or service URLs. Browsers talk only to the app. Only the receiver path appears on the webhook page.
- With Valkey, mail, the receiver or RabbitMQ unreachable at boot, the app starts, answers health and recovers when the dependency returns, with no restart.
- With Postgres unreachable at boot, it keeps retrying every 5 seconds and answers 503 `{"status":"starting"}` on health until connected.
- Pages are not cached by the browser when they hold signed-in data.

### Browser support and performance (DP-55)

The app supports current Chromium, Firefox and WebKit at the three published viewports. The incident list and incident page are usable within two seconds. Live changes reach open screens within one second. No asset loads from any other origin.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`.
- IF-02: `THIRD_PARTY_NOTICES.md` at the repository root names every shipped package and bundled font with its licence; shipped packages means the Go modules the program imports plus the production dependency tree (`npm ls --omit=dev --all --json`) of any frontend.
- IF-03: Every shipped package and font uses MIT, Apache-2.0, BSD, ISC, MPL-2.0 or OFL-1.1.
- IF-04: The only datastores and brokers are the Postgres, RabbitMQ and Valkey named in this brief; no file, in-process or other store holds product records.
- IF-05: `go.sum` is committed.
- IF-06: All plates come from one seeded procedural script run during `build`, and all fonts and images are bundled, with nothing fetched at runtime.
- IF-07: No other on-call product's name, branding, layout or artwork appears in the product.

## Engineering standards

- Go code is idiomatic: errors are returned and wrapped with context, and contexts reach every database, broker and network call.
- Names match the domain terms in this brief: incident, alert, dedup key, holder, level, layer, override, handoff, dead letter, delivery.
- Each domain rule, such as an incident transition, the edge rule, the final schedule computation or the status rollup, is decided in exactly one place in the source.
- No abstraction exists with a single implementation unless a test double for an outside service requires it.
- There is no dead, commented-out or unreachable code, and no defensive check for a state the code has already excluded.
- All API failures share the one published error shape, produced in one place.
- Time comes only from the server clock, with no direct read of system time in domain logic.
- No feature exists beyond this brief.
