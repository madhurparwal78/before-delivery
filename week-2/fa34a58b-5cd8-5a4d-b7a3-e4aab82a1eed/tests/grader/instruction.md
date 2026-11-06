# Gablework Nightplan

Nightplan is a self-hosted home hub for one household. It runs on a small box in the home and works room by room. It runs lighting and climate scenes on a daily timetable and shows live state from simulated lights, plugs, thermostats and motion cameras. It keeps short camera motion clips in on-premises object storage and sends plain household notices by email. The room is the unit of view: one 24-hour scrubber under a floor plan shows which scene owns every room at any moment of a chosen day. Build it for the adults of one household. It uses three backend services: PostgreSQL for all records, MinIO object storage for clip bytes, and an SMTP mail sink (Mailpit) for household notices. Out of scope:
- accounts, sign-in or roles (anyone on the home network who can reach the hub can use it)
- more than one household
- real device protocols (devices and cameras are simulated through the simulation API)
- any datastore other than PostgreSQL and MinIO
- any link or remote access in emails

## Problem and users

A household with a home hub runs dozens of devices across about nine rooms. To see what the house will do at 06:40 or 22:15, the owner reads schedule lists one entity at a time. Today's scheduler views are organised by schedule, not by room. People build their own room-to-light-to-schedule views just to answer "which scene owns the nursery at bedtime?" Time handling breaks quietly:
- After a daylight-saving change, runs happen twice or at the wrong hour.
- A wall tablet whose clock has drifted shows the wrong scene as active.
- A guest's scene never ends.
- A camera clip shows as "saved" when the file never fully reached disk.

The household pays in evenings lost to debugging, children woken by lights at the wrong hour, and a missing clip on the night it mattered. In Nightplan the server alone decides what is active and when. The screen only shows what the server publishes.

Users:

- **Household owner** (daily): plans which scene owns each room through the day, checks live device state, gives a visitor a guest scene that ends on time, and reviews motion clips.
- **Second adult** (weekly): adjusts the weekday or weekend schedule from their own phone and checks before bedtime that the nursery and bedroom scenes are right.

## Journeys

1. **Read the evening plan.** Start: the household owner opens `/plan` on a laptop with the seed data. Actions: they scrub from morning to bedtime with the arrow keys, then drag the scrubber back to 19:30 and copy the address into a new tab. End: rooms fill one by one in plan order as each scheduled change is crossed, and the legend counts step as fills land. The new tab shows the same day, time, room fills and 'At this time' list.
2. **Check the house from the wall tablet.** Start: the household owner opens the plan on a tablet whose clock runs 47 minutes fast and is set to another zone. Actions: they open the Kitchen in the room inspector, turn Kitchen lights off, turn it on again while the device sheet is still closing, and watch a simulated thermostat report a new reading. End: the now marker, hub time and each room's live scene match the server. Kitchen lights ends on, on screen and on the server. Each device change lands in place and is announced.
3. **Walk through the fall-back night.** Start: the household owner opens the plan for Sunday 1 November 2026. Actions: they scrub through the night, passing 01:30 CDT and then 01:30 CST, and later open the Day log for that day. End: the day spans 25 hours with the 01:00 hour drawn twice. 'Night low' takes the house at the first 01:30 only, and the Day log lists one 'Night low' run.
4. **Move the weekday wake-up.** Start: the second adult opens Schedules on their phone. Actions: they edit the Weekday schedule, change the 'Wake' slot from 06:40 to 06:10, set From to Monday 9 November 2026, and save. End: the success copy confirms the date. Scrubbing Friday 6 November still shows Wake at 06:40, and scrubbing Monday 9 November shows it at 06:10. On that Monday morning the household receives the schedule-change notice.
5. **Two adults edit the weekend at once.** Start: the household owner and the second adult both open the Weekend schedule editor. Actions: both change a slot and press Save within a second of each other. End: one sees the success copy. The other sees the conflict copy with a Reload schedule button, which loads the winner's slots. Every open plan repaints to the winner's slots.
6. **Give a visitor the spare room.** Start: the household owner opens Guests. Actions: they give the Spare room the 'Guest welcome' scene, starting now and ending at 11:00 the next morning, then close every browser. End: at 11:00:00 hub time the server ends the guest scene. The Spare room returns to its scheduled scene, socket listeners receive the change, and the household receives the guest-ended notice.
7. **Review a porch clip.** Start: the simulated porch camera announces a clip and starts sending it. Actions: the household owner opens the Day log and opens the clip's sheet. End: the row reads the storing copy and Play stays disabled until storage confirms the declared size. Then Play enables in place, the clip plays, and the motion notice arrives once.
8. **Build a scene from the keyboard.** Start: the household owner, using only a keyboard, is on `/scenes`. Actions: they create a scene, add it to rooms in a Weekend slot through the schedule editor, scrub to that slot, and open a clip sheet from the Day log. End: every step works by keyboard. Focus stays inside each open sheet and returns to the control that opened it.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Room-first floor plan** The plan page draws the nine rooms in plan order as outlined shapes, each named for its room and the scene that owns it at the scrubbed time, with a scene legend beneath.
- **DP-02 — Time-of-day scrubber** A single time-of-day slider under the plan moves across the chosen household day with the published key steps, pointer and touch dragging, and day controls, as detailed in Interactions.
- **DP-03 — Shareable plan address** The address bar always carries the scrubbed day and time with its offset, and opening that address or reloading shows the same view.
- **DP-04 — Plan sweep** Crossing a scheduled change fills the affected rooms one by one in plan order with the published stagger and duration, and each legend count steps by one as each fill lands.
- **DP-05 — Reduced-motion plan** With reduced motion on, fills, room names and legend counts switch in one frame, and the 'At this time' list and the 'Plan time' announcement carry the same room-to-scene facts in both modes.
- **DP-06 — Newest scrub wins** A step taken while an earlier sweep is still running cancels its remaining fills, and the plan, legend and list all end on the newest time.
- **DP-07 — Published plan layouts** At 375x812, 768x1024 and 1280x800 the plan page shows its published order and columns with no horizontal overflow, and closed drawers and sheets are hidden and cannot take focus.
- **DP-08 — Day plan API** GET /api/plan returns the household day's length, start owners and every change with its local time and offset, using the schedule version in force that day and any guest scenes.
- **DP-09 — Plan sweep look** The floor plan reads as a lamplit blueprint: cyan hairline rooms with dimension ticks on near-black navy, warm fills only for scene-held rooms, and a scrubber with hour ticks and the now marker.
- **DP-10 — Plan sweep journey** The household owner opens the plan, scrubs from morning to bedtime, copies the address into a new tab and sees the same rooms and scenes.
- **DP-11 — Household status and socket** GET /api/status and the /api/socket stream publish the hub's time, each room's live scene and service health, pushed within one second of any change and at least every 15 seconds.
- **DP-12 — Server-placed now** The 'now' marker, hub time, the scrubber's opening position and every room's live scene come only from the server's status, whatever the device clock or zone says.
- **DP-13 — Simulation API** The simulation endpoints set the hub clock and let simulated devices report state and go offline, with every effect visible in the API and the socket.
- **DP-14 — Named live regions** Device and scene changes from the socket update the screen in place without a reload and are announced in the 'Device updates' and 'Scene changes' regions with the published copy.
- **DP-15 — Room inspector** Choosing a room shows its live scene, its devices with their state and the day's plan for that room, as a side column at 1280x800 and as a sheet at smaller sizes.
- **DP-16 — Device state API** PUT /api/devices/{id}/state changes a light, plug or thermostat with the published fields and limits, bumps its revision and broadcasts the new state.
- **DP-17 — Device sheet** Each device has a details sheet with the controls for its kind, reachable by keyboard, which shows the server's latest state.
- **DP-18 — Refused toggle rolls back** An optimistic switch change the server refuses returns to the server's state and shows the device-offline copy.
- **DP-19 — Newest device action wins** Toggling again while a request is pending or the device sheet is closing ends with both screen and server on the last choice.
- **DP-20 — Scenes drive devices** Whenever a room's live scene changes, the server sets that room's online lights and thermostats to the scene's settings and leaves plugs and cameras as they are.
- **DP-21 — Live house journey** The household owner opens the plan on a tablet whose clock runs 47 minutes fast, turns the kitchen lights off and on from the inspector and sees each change land in place.
- **DP-22 — Fall-back day timeline** On the household's fall-back day the plan and scrubber span 25 hours with the 01:00 hour drawn twice and labelled by its offset, and spring-forward days span 23 hours.
- **DP-23 — Repeated hour runs once** A slot inside the repeated hour runs once, at its first occurrence, and owns its rooms through the second pass of that hour.
- **DP-24 — Skipped hour runs at 03:00** On the spring-forward day a slot inside the skipped hour runs at 03:00 and the plan shows it there.
- **DP-25 — Run ledger** The server records each slot occurrence once when the running hub clock reaches it, never for occurrences skipped by a clock move, and lists them by household day in GET /api/runs.
- **DP-26 — Fall-back night journey** The household owner scrubs Sunday 1 November 2026 through both 01:30s and later reads that day's runs, showing 'Night low' ran once.
- **DP-27 — Household day boundaries** Runs, clips and notices group by the household's local day in America/Chicago, and 'today' is the hub's local day, whatever zone the browser uses.
- **DP-28 — Day log page** The Day log page lists a chosen household day's runs and clips, defaulting to the hub's today and updating clip rows in place.
- **DP-29 — Day log journey** The household owner, browsing from a laptop set to another zone late in the evening, opens the Day log and sees only the runs and clips that belong to the household's today.
- **DP-30 — Effective-dated schedule versions** Each schedule save carries a from date and creates or replaces the version for that date, and every day uses the latest version whose from date is on or before it.
- **DP-31 — From date rules** A from date must be the hub's today or later and at most 366 days after it, with the published field errors otherwise.
- **DP-32 — Schedule editor sheet** The schedule editor sheet edits slot times, scenes and rooms plus the from date, and saves with the published pending and success copy.
- **DP-33 — Effective edit journey** The second adult moves weekday 'Wake' from 06:40 to 06:10 from Monday 9 November 2026, and scrubbing Friday 6 November still shows 06:40 while that Monday shows 06:10.
- **DP-34 — One winning schedule save** Saves to one schedule carry the revision the editor read, and of any concurrent saves with the same revision exactly one succeeds and the rest get the 409 schedule_changed answer.
- **DP-35 — Losing editor sees the winner** The losing editor shows the conflict copy with a Reload schedule button that loads the winner's slots, and open plans repaint to the winner's slots.
- **DP-36 — Scene catalogue API** GET, POST and PUT on /api/scenes list, create and change scenes with a unique name, one of six tints, a brightness and an optional setpoint.
- **DP-37 — Scene sheet** The New scene and Edit scene sheets create and change scenes with field errors shown beside their fields and the published pending and success copy.
- **DP-38 — Keyboard scene journey** Using only the keyboard, the household owner creates a scene, adds it to rooms in a weekend slot, scrubs to that slot and opens a clip sheet, with focus trapped and returned at each sheet.
- **DP-39 — Guest scene states** Guest scenes move scheduled → active → ended or cancelled under the published transition rules, with 409 answers for overlaps and for cancelling a closed guest scene.
- **DP-40 — Guest scene ends on the server** The server ends a guest scene at its end instant, inclusive, with no browser open, returns the room to its scheduled scene and pushes the change on the socket.
- **DP-41 — Guest request replay** A guest scene request repeated with the same Idempotency-Key and body returns the first answer, and the same key with a different body gets 409 idempotency_conflict.
- **DP-42 — Guest scene journey** The household owner gives the spare room the 'Guest welcome' scene until 11:00 and watches it hand back to the schedule at 11:00:00 hub time.
- **DP-43 — Camera clip intake** A simulated camera announces a clip with its declared byte size and then submits the bytes, which the server stores byte for byte under the published object key.
- **DP-44 — Storage-confirmed clips** A clip becomes stored and playable only after object storage reports the object at the declared size, and a size mismatch is rejected for good.
- **DP-45 — Clip sheet and Play** Clip rows show the storing copy until the clip is stored, and the clip sheet's Play button is enabled only for stored clips, updating in place.
- **DP-46 — Clip storage outage** While object storage is unreachable, clip bytes get 503, clips stay storing, nothing is marked stored and every page shows the storage banner.
- **DP-47 — Clip review journey** The household owner sees a new porch camera clip appear as storing, waits for it to become playable and plays it from the clip sheet.
- **DP-48 — Notice outbox** Every household notice is written to the outbox first and sent by email exactly once, within ten seconds while mail is up, as qualified in Services.
- **DP-49 — Household notice messages** The server sends plain-text notices with no links when it ends a guest scene, when an effective-dated edit takes effect and when a clip is stored, with the published subjects and bodies.
- **DP-50 — Mail outage** While mail is unreachable, notices stay queued, nothing is sent, the Notices page shows the mail banner, and each queued notice is sent exactly once when mail is back.
- **DP-51 — Notices page** The Notices page lists every notice newest first with its subject, recipient and queued or sent state, updating in place.
- **DP-52 — Run manifest and health** /app/run.json installs, builds and serves the app on the published port, and the health path answers 200 with {"status":"ok"} once ready.
- **DP-53 — Configuration from environment** Every service address and credential is read from the published environment variables at start and never hard-coded or sent to the browser.
- **DP-54 — Same-origin server boundary** The server enforces the published body limits and content types, refuses cross-origin writes and socket connections, and never serves source, manifest or environment files.
- **DP-55 — One error shape** Every API error uses the one published JSON error shape and the single published precedence order.
- **DP-56 — Keyboard-complete sheets** Every sheet and drawer opens and works from the keyboard, keeps Tab and Shift+Tab inside while open, closes on Escape and returns focus to its opener.
- **DP-57 — Readable, tappable controls** Every control is at least 44 by 44 pixels and all text and control edges meet WCAG 2.2 AA contrast on the dark ground.
- **DP-58 — No decorative loops** Nothing on any page moves while the user is idle except changes the server pushes, and sheets open and close within the published time.
- **DP-59 — Nocturnal blueprint look** Every page sits on a near-black navy blueprint sheet with a faint grid, cyan hairlines, pale ink, warm lamp fills only for scenes and coral only for alerts, in the published typefaces with tabular mono numerals.
- **DP-60 — Honest service wiring** Clip state, notice state and schedule revisions come from real PostgreSQL, MinIO and SMTP calls, with no in-memory stand-ins or self-reported success.

## Frontend

### Screens and layout (DP-01, DP-07, DP-15, DP-22, DP-28, DP-51, DP-59)

The app has six pages, all reachable from the rail navigation: Plan (`/plan`), Schedules (`/schedules`), Scenes (`/scenes`), Guests (`/guests`), Day log (`/log`) and Notices (`/notices`). `GET /` redirects to `/plan`.

**Header (every page).** It shows the hub time as "Hub time `<HH:MM>` `<abbr>`". At 768x1024 and 375x812 it also has the Menu button that opens the rail drawer. Placeholder formats used across this brief:
- `<HH:MM>` is 24-hour household time.
- `<abbr>` is CDT when the household offset is minus five hours and CST when it is minus six.
- `<long date>` is "Weekday D Month YYYY", for example "Sunday 1 November 2026".

**Rail.** It holds the brand mark "Gablework Nightplan" and the navigation. At 1280x800 it is a fixed left column 240 pixels wide. At 768x1024 and 375x812 it is a drawer that slides in from the left, opened by the Menu button. While closed, the drawer is not displayed and nothing in it can take focus.

**Plan page.** It contains, in this document order:
1. **Floor plan.** A drawn plan of the nine rooms as outlined shapes in a fixed procedural layout. Each room shows its name and is filled with the tint of the scene that owns it at the scrubbed time. The scene legend sits directly under the drawing.
2. **Scrubber block.** The day line reads `<long date>`, followed by " · 25 hours" or " · 23 hours" on daylight-saving change days. Under it are the day controls, then the time-of-day slider with an hour tick and label for every hour of the day. On a fall-back day the repeated hour carries two labels, "01 CDT" then "01 CST". On a spring-forward day the label 02 is absent. The 'now' marker sits on the track, labelled "Now `<HH:MM>`", only when the plan day is the hub's today.
3. **'At this time' list.** One line per room in plan order, giving that room's scene at the scrubbed time.
4. **Room list.** One button per room in plan order. Each shows the room name and "Now: `<Scene>`", the room's live scene from the server. A room held by a guest scene adds "Guest until `<HH:MM>`".
5. **Room inspector.** It shows the selected room's name, "Now: `<Scene>` since `<since>`", its devices with live state, and "Plan for `<Room>`", which lists each change for that room on the plan day as "`<HH:MM>` `<Scene>`".

Plan page layout at each published viewport:

| Viewport | Layout |
|---|---|
| 1280x800 | Three columns: the rail (240 pixels) on the left, the main column in the middle, and the room inspector (320 pixels) always visible on the right. In the main column the floor plan sits at the top and the scrubber block directly beneath it. Both are fully inside the first 800 pixels. Below them, the 'At this time' list (left) and the room list (right) sit side by side, tops aligned. At first load the inspector shows Hall. |
| 768x1024 | One full-width main column: floor plan, scrubber block, then the 'At this time' list (left) and the room list (right) side by side. The rail is a drawer. The inspector is a sheet that slides in from the right edge, 320 pixels wide, when a room is chosen. |
| 375x812 | One column in this order: floor plan, scrubber block, 'At this time' list, room list. The floor plan and the slider are both inside the first 812 pixels. The rail is a drawer. The inspector is a bottom sheet. |

No published viewport scrolls horizontally on any page. Only these three layouts exist for these three sizes, and no other breakpoint changes which layout a published size gets.

**Other pages.**
- **Schedules:** a tab for each schedule (Weekday, Weekend). Each tab panel shows that schedule's versions, oldest first, each headed "From `<long date>`" and listing its slots as "`<HH:MM>` `<Scene>` — `<rooms>`".
- **Scenes:** the list of scenes in catalogue order, each with its tint swatch, name, brightness and setpoint.
- **Guests:** the list of guest scenes, newest first, each with room, scene, state label and end time.
- **Day log:** a day picker, the day heading ("Today" when the chosen day is the hub's today, otherwise `<long date>`), then the Runs list and the Clips list.
- **Notices:** the notices list, newest first.

On these pages the content is one column next to the rail at 1280x800, and full width below the header at the smaller sizes.

All sheets (the inspector at smaller sizes, the device sheet, schedule editor, scene sheets, guest sheet and clip sheet) slide in from the right at 1280x800 and 768x1024, and up from the bottom at 375x812. While a sheet is closed it is not displayed and nothing in it can take focus.

### Public screens and controls (DP-01, DP-02, DP-12, DP-14, DP-15, DP-17, DP-32, DP-37, DP-45, DP-51)

These roles and accessible names are public. Everything else is free. Placeholders: `<Room>`, `<Scene>`, `<Device name>`, `<Camera name>` and `<Schedule>` are record names from the API. `<n>` is the 1-based position of a slot in the editor.

| Where | Role and accessible name | Visible copy or content |
|---|---|---|
| Header | button "Menu" (768x1024 and 375x812 only) | "Menu" |
| Header | text | "Hub time `<HH:MM>` `<abbr>`" |
| Rail drawer | dialog "Menu" (768x1024 and 375x812 only) | contains the navigation |
| Rail | navigation "Nightplan" with links "Plan", "Schedules", "Scenes", "Guests", "Day log", "Notices" | same |
| Plan | region "Floor plan" | the drawing and the legend |
| Plan | img "`<Room>`: `<Scene>`" for each room; `<Scene>` is "Unplanned" when no scene owns the room | room name drawn inside the outline |
| Plan | list "Scene legend", one listitem per scene in catalogue order | "`<Scene>` `<count>`" |
| Plan | region "Day and time" | day line, day controls, slider, now marker |
| Plan | button "Previous day", textbox "Plan day" (a date field), button "Next day", button "Jump to now" | same |
| Plan | slider "Time of day" | hour labels on the track |
| Plan | now marker (text) | "Now `<HH:MM>`" |
| Plan | list "At this time" | each item "`<Room>` · `<Scene>` · since `<since>`", or "`<Room>` · `<Scene>` · guest until `<HH:MM>`", or "`<Room>` · Unplanned" |
| Plan | list "Rooms" with button "`<Room>`" per room | "`<Room>`", "Now: `<Scene>`", optional "Guest until `<HH:MM>`" |
| Plan | complementary "Room inspector" at 1280x800; dialog "Room inspector" at the smaller sizes | room heading, "Now: `<Scene>` since `<since>`" |
| Inspector | list "Devices"; switch "`<Device name>`" for each light and plug; button "Details for `<Device name>`" for every device | thermostats show "Set to `<setpoint>`°F, reading `<current>`°F"; cameras show "Camera" |
| Inspector | list "Plan for `<Room>`" | "`<HH:MM>` `<Scene>`" per change |
| Device sheet | dialog "`<Device name>`" with switch "Power" (lights, plugs), slider "Brightness" (lights, 1 to 100), spinbutton "Setpoint" (thermostats, 60 to 80), button "Close" | "Online" or "Offline", "Last report `<HH:MM:SS>`" |
| Every page | status "Device updates", status "Scene changes", status "Connection" (polite; may be visually hidden) | latest message |
| Plan | status "Plan time" (polite) | latest announcement |
| Every page | alert (storage banner, only while storage is down) | the storage banner copy |
| Schedules | tablist "Schedules" with tab "Weekday", tab "Weekend"; button "Edit `<Schedule>` schedule" in each panel | same |
| Schedule editor | dialog "Edit `<Schedule>` schedule"; textbox "From" (date field); group "Slot `<n>`" holding textbox "Time", combobox "Scene" and one checkbox per room named "`<Room>`"; button "Remove slot `<n>`"; button "Add slot"; button "Save schedule"; button "Reload schedule" (only after a conflict); button "Close"; status "Schedule save"; alert for the conflict | same |
| Scenes | list "Scenes"; button "New scene"; button "Edit `<Scene>`" | same |
| Scene sheet | dialog "New scene" or "Edit `<Scene>`"; textbox "Scene name"; radiogroup "Tint" with radios "Amber", "Honey", "Ember", "Rose", "Dusk", "Candle"; spinbutton "Brightness" (0 to 100); spinbutton "Setpoint" (60 to 80, may be empty); button "Create scene" or "Save scene"; button "Close"; status "Scene save" | same |
| Guests | list "Guest scenes"; button "New guest scene"; button "Cancel guest scene for `<Room>`" on scheduled and active rows | rows "`<Room>` · `<Scene>` · `<state label>` · until `<HH:MM>` `<long date>`"; state labels Scheduled, Active, Ended, Cancelled |
| Guest sheet | dialog "New guest scene"; combobox "Room"; combobox "Scene"; textbox "Starts" (date and time, empty means now); textbox "Ends" (date and time); button "Start guest scene"; button "Close"; status "Guest scene" | same |
| Day log | textbox "Log day" (date field), button "Previous day", button "Next day"; list "Runs"; list "Clips" with button "`<Camera name>` `<HH:MM:SS>`" per clip | run item "`<HH:MM>` `<Scene>` · `<count>` rooms · `<Schedule>`"; clip row state copy from Feedback states |
| Clip sheet | dialog "Clip from `<Camera name>` at `<HH:MM:SS>`"; a video with no autoplay; button "Play"; button "Close" | declared and stored sizes in bytes |
| Notices | list "Notices"; status "Mail" | rows "`<subject>` · to `<address>` · Queued" or "· Sent `<HH:MM>`" |

`<since>` is `<HH:MM>` when the owning change falls on the plan day, otherwise "`<Ddd>` `<HH:MM>`" with a three-letter weekday, for example "Sat 23:30". When the instant falls inside a repeated hour, " `<abbr>`" is added.

### Interactions (DP-02, DP-03, DP-06, DP-15, DP-17, DP-19, DP-35, DP-56)

**Opening the plan.** Without a query string, the plan opens on the hub's today at the hub's current minute, both taken from `GET /api/status`. With `?day=YYYY-MM-DD&at=HH:MM±HH:MM` it opens on that day and instant. If `at` has no offset, it means the first occurrence of that wall time. A nonexistent wall time means 03:00. An unparseable or out-of-range `day` or `at` falls back to the hub's now. In every case the address is then rewritten to the full form.

**Address.** After every scrubber step, drag release, day change or Jump to now, the address bar is replaced (no new history entry) with `/plan?day=<YYYY-MM-DD>&at=<HH:MM><offset>`. `<offset>` is the household offset at that instant, for example `-05:00`. The end of the day is written `24:00` with the offset of the following midnight. Reloading or opening a copied address shows the same day, time, fills, legend and lists.

**Scrubber keys.** The slider "Time of day" has these values:
- aria-valuemin is 0.
- aria-valuemax is the day's length in minutes: 1440, 1500 on the fall-back day, 1380 on the spring-forward day.
- aria-valuenow is the minutes elapsed since that day's midnight.
- aria-valuetext is "`<HH:MM>` `<abbr>`".

Its keys:
- Right and Up move forward 15 minutes. Left and Down move back 15 minutes.
- PageUp moves forward 60 minutes. PageDown moves back 60 minutes.
- Home goes to 00:00. End goes to the end of the day.
- Values clamp at both ends.

**Scrubber pointer and touch.** Pressing on the track jumps there. Dragging with mouse, pen or finger moves continuously and snaps to 5-minute values. Touch dragging works the same with reduced motion on.

**Day controls.** Previous day, Next day and a date typed into "Plan day" change the plan day and keep the wall time, using its first occurrence or 03:00 if it does not exist on the new day. Jump to now sets the hub's today and the hub's current minute from the latest status.

**Choosing a room.** Pressing a room button in "Rooms", or clicking or tapping a room shape in the floor plan, selects that room. At 1280x800 the inspector column switches to it and focus stays where it was. At the smaller sizes the inspector sheet opens, and on close focus returns to the room's button in "Rooms". The plan shapes are for pointer and touch only. The room list is the keyboard path.

**Devices.** A light or plug switch in the inspector, or the "Power" switch in the device sheet, flips at once and sends the change. Changing "Brightness" or "Setpoint" sends when the value settles (on key press, or on drag release). "Details for `<Device name>`" opens the device sheet. The sheet shows the latest device state from the socket while open.

**Sheets and drawers.**
- Open: Enter or Space on the opening control opens the sheet, and focus moves to the first control inside it.
- While open: Tab from the last control wraps to the first, and Shift+Tab from the first wraps to the last. Focus never reaches the page behind.
- Close: Escape, the Close button, or a click on the dimmed backdrop closes the top sheet only. Focus returns to the control that opened it, or to the room's button in "Rooms" when a plan shape opened it.
- Closing: once a sheet starts to close it stops blocking the page, so controls behind it work during its exit. Reopening a sheet while it is still closing leaves it open.

**Schedule editor.** The editor opens loaded with the version in force on the hub's today and From set to the hub's today. Add slot appends an empty slot. Remove slot `<n>` removes it. Save schedule sends the slots, From and the revision read when the editor opened (or last reloaded). After a conflict, Reload schedule loads the latest schedule into the editor, replacing the unsaved edits, and removes the conflict message.

**Scenes, guests and clips.** "New scene" and "Edit `<Scene>`" open the scene sheet. "New guest scene" opens the guest sheet. A clip row button opens its clip sheet, and Play there starts the video.

### Visual design (DP-09, DP-57, DP-59)

- **Mood.** Nocturnal, drafted, lamplit. Every page is a blueprint sheet: a near-black navy ground covered by a faint fine grid of squares about 8 pixels across, drawn in a barely visible cyan. No surface anywhere is white or light grey. Panels are the same navy, separated by single thin cyan lines.
- **Lines.** Rooms on the floor plan are drawn as one-pixel cyan outlines. Each wall carries small perpendicular dimension ticks at its ends and a short measured-length label in mono numerals, like an architect's drawing. Sheets, list rows and inputs use the same thin cyan edges.
- **Ink.** Text is a pale blue-white ink. Secondary text is the same ink at lower strength and still meets contrast.
- **Lamp.** Warmth is reserved for light. Only a room held by a scene is filled, with that scene's warm tint. The six tints run from pale to deep within one warm family:
  - Candle: a pale cream-gold.
  - Honey: a soft gold.
  - Amber: the lamp colour itself, a bright amber.
  - Rose: a warm rose-gold.
  - Dusk: a dim brown-gold.
  - Ember: a deep burnt orange, darker and browner than the alert colour.

  An unplanned room stays unfilled. Selected and focused elements get a brighter cyan outline, never a warm one.
- **Alert.** A coral red is used only for alerts, refusals, field errors and the storage and mail banners.
- **Type.** Headings, the brand and room labels on the plan use Space Grotesk, a geometric grotesque. Body text uses IBM Plex Sans. Every numeral (times, counts, bytes, temperatures, percentages) uses JetBrains Mono with tabular figures, so digits do not shift as they change. Each heading level is about a fifth larger than the level below, and body text is the base step.
- **Density.** Comfortable: generous row height, clear gaps between list rows, no crowded tables.
- **Controls.** Every control (buttons, switches, slider thumb, checkboxes, radios, list buttons) has a hit area at least 44 by 44 pixels. Text meets WCAG 2.2 AA contrast against the navy ground (4.5 to 1 for body text, 3 to 1 for large text). Control boundaries, focus outlines and the slider track meet 3 to 1.
- **Icons.** Lucide line icons at the same thin stroke as the plan lines.

### Motion and effects (DP-04, DP-05, DP-06, DP-58)

Motion has one meaning here: light changing hands. Every motion starts quickly and settles softly.

**Plan sweep (the signature).**
1. On each scrubber change (key step, drag movement, jump, Jump to now, day change), the plan compares each room's scene at the old time with its scene at the new time.
2. Rooms whose scene differs change in published plan order: Hall, Kitchen, Living, Study, Main bedroom, Nursery, Spare room, Bath, Porch. Only changed rooms take part.
3. The first changed room starts at once and each next changed room starts 40 milliseconds after the one before. Each room's fill moves from the old tint to the new tint over 240 milliseconds. A room becoming unplanned fades its fill out over the same time.
4. A room's accessible name ("`<Room>`: `<Scene>`") switches the moment its fill starts.
5. As each room's fill finishes, the legend count of the scene it left steps down by one and the count of the scene it joined steps up by one. Counts change one digit step per room, never jumping by more than one at a time, so the legend visibly counts up and down as the sweep travels through the house.
6. Scrubbing back reverses this step by step: the same rooms return to their earlier tints, again in plan order with the same timing.
7. The 'At this time' list and the "Plan time" announcement switch to the new time at once on each change. They do not wait for the sweep.

**Sheets and drawers.** They slide in and out over 320 milliseconds (about a third of a second), with the backdrop dimming over the same time.

**Feedback motion.** Hover and press feedback (an outline brightening) appears within a tenth of a second and does not move layout. A room list row whose live scene changes from the socket gets one brief cyan outline pulse lasting under half a second. A device row whose state changes gets the same.

**Banned.** No decorative or idle loops anywhere: no spinners, shimmer, breathing glows, marquee text or ambient animation. While the user is idle, the only things that change are values the server pushes (hub time, the now marker, live scenes, device states, clip and notice rows) and their single outline pulse. Pending states use text, never spinners.

**Reduced motion.** When the operating system's reduced-motion setting is on:
- Every room fill, room accessible name and legend count switches to its final value in the same frame as the scrubber change, with no stagger and no counting.
- Sheets and drawers appear and disappear at once.
- Outline pulses are dropped.

**In both modes.** The visible 'At this time' list updates on every step with the same room-to-scene facts. The "Plan time" region announces the published Plan time copy for the new time.

### Feedback states (DP-14, DP-18, DP-19, DP-32, DP-35, DP-37, DP-45, DP-46, DP-50, DP-55)

**Newest action wins.** On every screen, the newest user action decides the final state. A response, timer or animation from an earlier action never overwrites it:
- A later scrub cancels the earlier sweep's remaining fills and legend steps. The new sweep runs from what is currently shown to the newest time.
- A second device change sent while the first is pending is applied on the server after the first. The switch, the sheet and the server all end on the last choice.
- A sheet's close timer never hides a sheet that was reopened.
- A status message just written for the latest action is never replaced by a repaint from an older request.

**Live regions.** Each named region holds only its latest message.

| Region | When | Copy |
|---|---|---|
| status "Device updates" | a device change arrives on the socket | "`<Device name>`: `<summary>`". `<summary>` is "on at `<brightness>`%" or "off" for lights, "on" or "off" for plugs, "set to `<setpoint>`°F, reading `<current>`°F" for thermostats, "offline" when it goes offline, and "back online" when it returns |
| status "Scene changes" | a room's live scene changes | "`<Room>` is now in `<Scene>`" |
| status "Plan time" | each scrubber change | "At `<time>`, `<n>` rooms in `<Scene>`, `<n>` rooms in `<Scene>`". It lists every scene holding at least one room, in catalogue order. A count of one reads "1 room". Unplanned rooms are added as "`<n>` rooms unplanned". `<time>` is `<HH:MM>`, followed by " `<abbr>`" inside a repeated hour. For example, with the seed data at 06:10 on Monday 9 November 2026 after the Wake edit: "At 06:10, 5 rooms in Wake, 4 rooms in Night low" |
| status "Connection" | socket drops, then reconnects | "Live updates paused. Reconnecting…", then "Live updates resumed." |

**Devices.**
- Pending: the switch shows the new position at once, and "Sending…" appears beside it.
- Success: "Sending…" disappears. The announcement comes from the socket.
- Refusal: the switch returns to the server's state, and an inline alert in the inspector (and in the device sheet if open) shows the device-offline message from the error table below.

**Schedule editor.**
- Pending: "Saving schedule…" in "Schedule save".
- Success: "Saved. `<Schedule>` slots change from `<long date>`.", where the date is the From date. The editor stays open with the saved slots and the new revision.
- Field errors: each message sits under its field, and "Schedule save" reads the invalid copy from the error table.
- Conflict: an alert in the sheet reads "Someone else changed this schedule. Reload it to see their change." and the Reload schedule button appears.

**Scene sheet.**
- Pending: "Creating scene…" or "Saving scene…".
- Success: "Scene created. Add it to a schedule slot to give it rooms." or "Scene saved."
- Field errors: as for the schedule editor.

**Guest sheet and list.**
- Pending: "Starting guest scene…".
- Success: "Guest scene set for `<Room>` until `<HH:MM>` on `<long date>`." (the end).
- Overlap: an alert with the guest-overlap message.
- Cancelling: "Cancelling…", then "Guest scene cancelled for `<Room>`." Both are in "Guest scene".
- Already closed: an alert with the guest-closed message.

**Clips.**
- Row and sheet while the clip is announced or storing: "Storing clip…", with Play disabled.
- Stored: "`<stored size>` bytes", with Play enabled.
- Size mismatch: "Clip incomplete. Not saved.", with Play disabled for good.
- Media fetch failing while storage is down: "The clip can't be loaded while clip storage is unreachable." in the sheet.

Rows and the open sheet change state in place within two seconds of the server's change.

**Storage banner.** While status reports storage down, every page shows an alert: "Clip storage is unreachable. New clips wait as 'Storing clip…' until it is back."

**Mail banner.** While status reports mail down, the Notices page's "Mail" region shows: "Mail is unreachable. Notices are queued and each will be sent once when it is back."

**Unreachable hub.** When any request fails without an HTTP answer, an alert reads "Nightplan can't reach the hub. Your last change was not saved." and the control returns to the last server state.

**Error messages.** Every API error carries one of these codes and its message:

| Status | Code | Message |
|---|---|---|
| 400 | `bad_json` | "The request body is not valid JSON." |
| 403 | `forbidden_origin` | "Requests must come from this hub's own pages." |
| 404 | `not_found` | "Nothing here by that name." |
| 409 | `schedule_changed` | "Someone else changed this schedule. Reload it to see their change." |
| 409 | `device_offline` | "`<Device name>` is offline. Nothing was changed." |
| 409 | `guest_overlap` | "`<Room>` already has a guest scene at that time." |
| 409 | `guest_scene_closed` | "This guest scene has already ended." |
| 409 | `idempotency_conflict` | "This request key was already used for a different guest scene." |
| 409 | `clip_closed` | "This clip is already closed." |
| 409 | `clip_not_playable` | "This clip is not stored yet." |
| 413 | `too_large` | "The request body is too large." |
| 415 | `unsupported_media_type` | "This content type is not accepted here." |
| 422 | `invalid` | "Check the highlighted fields." |
| 422 | `size_mismatch` | "The stored clip is `<stored size>` bytes, not the `<declared size>` bytes the camera declared." |
| 503 | `storage_unavailable` | "Clip storage is unreachable. Try again shortly." |

**Field messages** (in `fields` of an `invalid` error, keyed by field path; slot fields use `slots.<index>.<field>` with a 0-based index):

| Field | Message |
|---|---|
| `name` (scene) | "Give the scene a name of 1 to 40 characters." or "Another scene already uses this name." |
| `tint` | "Choose one of the six tints." |
| `brightness` (scene) | "Brightness is a whole number from 0 to 100." |
| `brightness` (device) | "Brightness is a whole number from 1 to 100." |
| `setpoint_f` | "Setpoint is a whole number from 60 to 80." |
| `on` | "Use true or false." |
| any state key the device kind lacks, or `state` for cameras | "This device has no such setting." |
| `revision` | "Reload the schedule before saving." |
| `from` | "Use a date like 2026-11-09.", "Choose today or a later day." or "Choose a day within the next 366 days." |
| `slots` | "A schedule has 1 to 48 slots." |
| `slots.<i>.time` | "Use a 24-hour time like 06:10." or "Two slots at the same time cannot share a room." |
| `slots.<i>.scene_id` | "Choose a scene." |
| `slots.<i>.room_ids` | "Choose at least one room." |
| `room_id` | "Choose a room." |
| `scene_id` | "Choose a scene." |
| `starts_at` | "Use a date and time like 2026-11-07T11:00.", "Start now or later." or "That time is skipped when clocks spring forward. Choose another time." |
| `ends_at` | "Use a date and time like 2026-11-07T11:00.", "End after the start.", "A guest scene can last at most 14 days." or "That time is skipped when clocks spring forward. Choose another time." |
| `Idempotency-Key` | "Use 1 to 100 visible characters." |
| `day` | "Use a date like 2026-11-01." |
| `now` (clock), `recorded_at` | "Use a time like 2026-11-01T01:29:55-05:00." |
| `declared_size` | "Declared size is a whole number of bytes from 1 to 20,000,000." |
| `body` (device report) | "Send online or state." |

## Backend

### API (DP-08, DP-11, DP-13, DP-16, DP-25, DP-36, DP-39, DP-41, DP-43, DP-51, DP-55)

**Formats.**
- JSON bodies are UTF-8 with `Content-Type: application/json`.
- Every instant in a response is ISO-8601 with seconds and the household offset, for example `2026-11-01T01:30:00-05:00`.
- Dates are `YYYY-MM-DD` household days.

**Error shape.** Every error response is `{"error":{"code":"<code>","message":"<message>"}}`. Errors with code `invalid` add `"fields":{"<path>":"<message>"}`. Codes and messages are those in Feedback states.

**Error precedence**, for the whole API:
1. `403 forbidden_origin`
2. `413 too_large`
3. `415 unsupported_media_type`
4. `400 bad_json`
5. `404 not_found` (unknown path or record)
6. An idempotent replay returns its stored answer, or `409 idempotency_conflict`.
7. State conflicts (`409`)
8. Validation (`422`)
9. `503 storage_unavailable`

The one exception: `guest_overlap` is decided after validation, because it needs valid times. Endpoint rows below list only their own errors.

**Records.**
- Room: `{"id","name","order","device_ids":[...]}`.
- Scene: `{"id","name","tint","brightness","setpoint_f"}`. `setpoint_f` may be null.
- Device: `{"id","name","room_id","kind","online","state","revision","updated_at"}`. `kind` is `light`, `plug`, `thermostat` or `camera`. `state` depends on kind:
  - light: `{"on":bool,"brightness":1-100}`, where brightness is the level used when on
  - plug: `{"on":bool}`
  - thermostat: `{"setpoint_f":int,"current_f":int}`
  - camera: `{}`
- Schedule: `{"id","name","days","revision","versions":[{"from","slots":[{"id","time","scene_id","room_ids"}]}]}`. Versions are ordered by `from`. Slots are ordered by `time`.
- Guest scene: `{"id","room_id","scene_id","starts_at","ends_at","state","ended_at","cancelled_at"}`. `state` is `scheduled`, `active`, `ended` or `cancelled`.
- Run: `{"id","schedule_id","version_from","slot_id","slot_time","ran_at","scene_id","room_ids"}`.
- Clip: `{"id","camera_id","camera_name","recorded_at","day","declared_size","stored_size","state","playable","object_key"}`. `state` is `announced`, `storing`, `stored` or `size_mismatch`. `stored_size` is null until storage reports a size.
- Notice: `{"id","kind","subject","to","state","attempts","created_at","sent_at"}`. `kind` is `guest_scene_ended`, `schedule_change` or `motion`. `state` is `queued` or `sent`.

**Endpoints.**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| GET `/api/health` | none | as stated in Deployment | none |
| GET `/api/status` | none | 200 `{"now","day","zone":"America/Chicago","offset","rooms":[{"room_id","name","scene_id","scene_name","since","source","guest_scene_id"}],"services":{"storage":"up"\|"down","mail":"up"\|"down"}}`. Rooms are in plan order. `source` is `schedule`, `guest` or `none`. `scene_id`, `scene_name` and `since` are null when `none` | none |
| GET `/api/plan?day=YYYY-MM-DD` | `day` optional, default the hub's today | 200 `{"day","schedule_id","hours","start","end","hour_marks":[{"at","label","abbr"}],"rooms":[{"room_id","name","order"}],"start_owners":[{"room_id","scene_id","since","source","guest_scene_id"}],"changes":[{"at","local","offset","source","schedule_id","version_from","slot_id","slot_time","guest_scene_id","scene_id","room_ids"}]}`. `hours` is 23, 24 or 25. `start` and `end` are the day's midnights. `label` is the two-digit hour. `source` of a change is `schedule`, `guest` (start) or `guest_end`. `slot_time` is the slot's wall time, which differs from `local` only on a spring-forward day | 422 `day` |
| GET `/api/rooms` | none | 200 `{"rooms":[room]}` in plan order | none |
| GET `/api/scenes` | none | 200 `{"scenes":[scene]}` in catalogue order (seed order, then creation order) | none |
| POST `/api/scenes` | `{"name","tint","brightness","setpoint_f"}` | 201 `{"scene":scene}` | 422 |
| PUT `/api/scenes/{id}` | same as POST | 200 `{"scene":scene}` | 422 |
| GET `/api/schedules` | none | 200 `{"schedules":[schedule]}` | none |
| GET `/api/schedules/{id}` | none | 200 `{"schedule":schedule}` | none |
| PUT `/api/schedules/{id}` | `{"revision":int,"from":"YYYY-MM-DD","slots":[{"time":"HH:MM","scene_id","room_ids":[...]}]}` | 200 `{"schedule":schedule}` with the revision increased by one. The server assigns slot ids | 409 `schedule_changed`; 422 |
| GET `/api/devices?room_id=` | `room_id` optional | 200 `{"devices":[device]}` | none |
| PUT `/api/devices/{id}/state` | lights `{"on"?,"brightness"?}` (at least one; brightness without `on` also turns the light on); plugs `{"on"}`; thermostats `{"setpoint_f"}` | 200 `{"device":device}` with the revision increased by one | 409 `device_offline`; 422 |
| GET `/api/guest-scenes` | none | 200 `{"guest_scenes":[guest scene]}`, newest first | none |
| POST `/api/guest-scenes` | header `Idempotency-Key` optional; `{"room_id","scene_id","starts_at":"YYYY-MM-DDTHH:MM"\|null,"ends_at":"YYYY-MM-DDTHH:MM"}` in household wall time; null `starts_at` means now | 201 `{"guest_scene":guest scene}` | 409 `idempotency_conflict`; 422; then 409 `guest_overlap` |
| POST `/api/guest-scenes/{id}/cancel` | `{}` | 200 `{"guest_scene":guest scene}` | 409 `guest_scene_closed` |
| GET `/api/runs?day=` | `day` optional, default the hub's today | 200 `{"day","runs":[run]}` ordered by `ran_at` | 422 `day` |
| GET `/api/clips?day=` | `day` optional, default the hub's today | 200 `{"day","clips":[clip]}` ordered by `recorded_at` | 422 `day` |
| GET `/api/clips/{id}` | none | 200 `{"clip":clip}` | none |
| GET `/api/clips/{id}/media` | none | 200 `Content-Type: video/mp4`, `Content-Length` equal to the stored size, body equal to the stored bytes | 409 `clip_not_playable`; 503 |
| GET `/api/notices` | none | 200 `{"notices":[notice]}`, newest first | none |
| GET `/api/socket` | WebSocket upgrade | see below | 403 handshake refusal for a foreign Origin |

**Socket.** Messages are JSON objects with a `type`:
- `{"type":"status",...}`: the same fields as `GET /api/status`. Sent on connect, within one second of any room's live scene changing, of a clock move, or of a service status change, and otherwise at least every 15 seconds.
- `{"type":"device","device":device}`
- `{"type":"guest_scene","guest_scene":guest scene}`
- `{"type":"schedule","schedule_id","revision"}`
- `{"type":"scene","scene":scene}`
- `{"type":"clip","clip":clip}`
- `{"type":"notice","notice":notice}`

Each change message is sent within one second of the change, whether or not any browser is connected to see it.

**Simulation API.** This is the device side of the hub. Simulated devices, cameras and the hub clock use it. It follows the same formats, error shape and precedence.

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| GET `/api/sim/clock` | none | 200 `{"now"}` | none |
| PUT `/api/sim/clock` | `{"now":"<ISO-8601 with offset>"}` | 200 `{"now"}`. The hub clock jumps to that instant and keeps running in real time from there | 422 `now` |
| POST `/api/sim/devices/{id}/report` | `{"online"?:bool,"state"?:{...}}`, at least one key; `state` takes the same fields as the device's state, including `current_f` for thermostats | 200 `{"device":device}` with the revision increased by one | 422 |
| POST `/api/sim/cameras/{device_id}/clips` | `{"recorded_at":"<ISO-8601 with offset>","declared_size":int}` | 201 `{"clip":clip}` in state `announced` | 404 for unknown and non-camera devices; 422 |
| PUT `/api/sim/clips/{id}/bytes` | raw body, `Content-Type: application/octet-stream` | 200 `{"clip":clip}` in state `stored` | 409 `clip_closed` for stored or rejected clips; 422 `size_mismatch` (the clip is then in state `size_mismatch`); 503 `storage_unavailable` (the clip stays `storing`, and the camera may send the same bytes again) |

### Business rules (DP-12, DP-20, DP-22, DP-23, DP-24, DP-25, DP-27, DP-30, DP-31, DP-34, DP-39, DP-40, DP-44, DP-48)

**The server alone decides time.**
- The hub clock is the server's clock, moved only through the simulation API. Moves last until the server restarts, after which it is real time.
- Each room's live scene, the hub's today, the hub time and the now marker come only from the status endpoint and socket.
- The browser never computes them from its own clock or zone. A tablet whose clock is 47 minutes fast, or that sits in another zone, shows exactly what the server publishes. The browser moves the now marker and hub time only when a status message arrives.

**Household zone.** Every schedule, slot, guest scene time, day boundary and "today" uses America/Chicago, whatever zone the browser, device or server process runs in. A household day runs from one local midnight to the next. The hub's today is the household day containing the hub clock's now.

**Which schedule owns a day.**
- Weekday runs Monday to Friday. Weekend runs Saturday and Sunday.
- Each schedule has versions, and each version has a `from` date and a full list of slots.
- A day uses the version with the latest `from` on or before that day. Days before a version's `from` keep the slots in force then, on every surface: plan, inspector plan, runs and Schedules page.

**Saving a version.**
- A save creates a version for its `from` date, or replaces the version that already has that `from` date.
- `from` must be the hub's today or later, and at most 366 days after the hub's today. Both edges are allowed.
- Slots: 1 to 48. Times are `HH:MM` from 00:00 to 23:59. Each slot has an existing scene and at least one known room, with no repeats. Two slots at the same time may not share a room.

**Slot occurrence on change days.**
- Each slot occurs once per day it applies to, at its wall time on that day.
- On the fall-back day, a wall time inside the repeated hour (01:00 to 01:59) occurs only at its first pass, the CDT one. The second pass of that hour is not an occurrence.
- On the spring-forward day, a wall time inside the skipped hour (02:00 to 02:59) occurs at 03:00 CDT.
- Recurring slots always keep their wall-clock time across the change.

**Room owner.** A room's scene at instant t is decided in this order:
1. The guest scene active for that room at t, if any.
2. Otherwise, the scene of the latest slot occurrence at or before t that covers the room, looking back up to seven days.
3. Otherwise "Unplanned".

`since` is the instant of that occurrence, or the guest scene's start. Schedule changes for a room held by a guest scene leave it out of their `room_ids` in the plan.

**Runs.**
- The server checks the hub clock at least once per second.
- When the running clock passes a slot occurrence, the server records one run for it: one per schedule, version, slot and household day. The server never records a second run for the same occurrence, including when the clock is moved back over it.
- A clock move does not record runs for occurrences between the old and new time. After any move, rooms whose owner changed get their new scene applied and announced.
- Runs list under the household day of `ran_at`.

**Scenes drive devices.** Whenever a room's live owner changes (slot occurrence, guest start, end or cancel, clock move, or a schedule save that changes today's owner), the server applies the scene to that room's online devices:
- A brightness of 0 turns lights off and leaves their stored level.
- Any other brightness turns lights on at that level.
- A non-null setpoint sets thermostats.
- Plugs, cameras and offline devices are untouched.

Each changed device gets a revision bump and a socket message. A change to a scene's settings applies at the next owner change. It does not re-apply at once.

**Device changes.**
- A change to an offline device is refused with `409 device_offline` and changes nothing.
- Changes to one device apply in the order received. The response and socket message carry the resulting state.

**Concurrency winner.**
- Every schedule save carries the `revision` the editor read. The save succeeds only if that is still the schedule's current revision, and the check and the write happen as one step.
- Of any number of simultaneous saves carrying the same revision, exactly one succeeds. Every other gets `409 schedule_changed` and changes nothing.
- On success the server pushes a `schedule` socket message. Open plans and Schedules pages refetch and show the winner's slots within two seconds, without moving the scrubber.

**Guest scene states.**

| From | Event | To |
|---|---|---|
| (new) | created with start in the future | `scheduled` |
| (new) | created with no start, or a start in the current minute | `active` |
| `scheduled` | hub clock reaches `starts_at`, inclusive | `active` |
| `active` | hub clock reaches `ends_at`, inclusive | `ended` |
| `scheduled`, `active` | cancel | `cancelled` |
| `ended`, `cancelled` | cancel | refused with `409 guest_scene_closed` |

Validation and timing rules:
- `starts_at` and `ends_at` are household wall times to the minute, meaning second :00.
- A wall time inside the repeated hour resolves to its first occurrence. A wall time inside the skipped hour is a 422.
- A start in an earlier minute than the hub's now is a 422. The end must be after the start, and at most 14 days after it (exactly 14 days is allowed).
- A new guest scene may not overlap a scheduled or active guest scene in the same room. If it does, the answer is `409 guest_overlap`.

**Guest scene end.**
- The server ends a guest scene at its end instant whether or not any browser is open, no later than one second after it.
- Status and plan computed at any instant at or after `ends_at` never show the guest scene. At one second before, they still do. For example, a guest scene ending at 11:00 is active at 10:59:59 and the room is back on its scheduled scene at 11:00:00.
- `ended_at` records when the server ended it. If a clock move jumps past `ends_at`, the guest scene ends at the move.
- Ending queues the guest-ended notice. Cancelling queues no notice.

**Idempotent guest requests.** A POST to `/api/guest-scenes` may carry `Idempotency-Key` (1 to 100 visible ASCII characters). The server keeps each key for 24 hours.
- The same key with the same JSON body returns the first answer's status and body unchanged, without creating anything.
- The same key with a different body gets `409 idempotency_conflict`.

**Clip states.**
- A clip moves `announced` → `storing` (bytes received) → `stored`, or `storing` → `size_mismatch`.
- `stored` is reached only after object storage reports the object at exactly `declared_size` bytes. Only stored clips are playable.
- If the size storage reports differs from `declared_size`, the server deletes the object and the clip becomes `size_mismatch`, which is never playable and accepts no more bytes.
- `declared_size` is 1 to 20,000,000 bytes, both edges allowed. A clip's `day` is the household day of `recorded_at`.

**Notices and "today".**
- Notices list newest first.
- The effect instant of a saved version is 05:00:00 household time on its `from` date.
- Each schedule and `from` date gets exactly one schedule-change notice, queued at the first of these moments:
  - the running hub clock reaches the effect instant;
  - a save on the `from` date when the hub clock is already at or after the effect instant (queued at the save);
  - a clock move that lands at or after the effect instant, whether on the `from` date itself or on any later day, so jumping over it counts (queued at the move, one notice per schedule and `from` date whose effect instant was passed, in `from` order).
- A clock move that lands before the effect instant queues nothing; the notice then follows when the running clock reaches it.
- Moving the clock back over an effect instant whose notice is already queued never queues a second one.
- Each notice describes the slots of the version with that `from` date as they stand when it is queued.
- The seeded versions never queue a notice.

### Services (DP-43, DP-44, DP-46, DP-48, DP-49, DP-50, DP-60)

**PostgreSQL** (`DATABASE_URL`) holds:
- the household and its zone
- rooms in plan order
- devices and their last state and revision
- scenes
- schedules with revision and versions, and each version's slots
- guest scenes with their server-side end
- idempotency keys with stored answers
- runs
- clip records with declared size, stored size and state
- the notice outbox

The app applies its schema idempotently every time it serves. It inserts the seed data only when the household record is missing, and never overwrites existing records.

**MinIO** (`S3_*`):
- **Storing.** Each clip is stored at object key `clips/<camera_id>/<day>/<clip_id>.mp4` with content type `video/mp4`. The stored bytes equal the submitted bytes exactly.
- **Confirming.** After writing, the server asks storage for the object's size (a HEAD). It marks the clip stored only when that size equals `declared_size`.
- **Health.** The server checks storage at start and every 5 seconds and publishes the result as `services.storage`.
- **When storage is unreachable:**
  - clip bytes get `503 storage_unavailable`
  - the clip stays `storing` and nothing is marked stored
  - clip media gets 503
  - status reports storage `down`
  - every page shows the storage banner from Feedback states

**Mailpit** (`SMTP_HOST`, `SMTP_PORT`): every notice is first written to the outbox in PostgreSQL as `queued`.

Each message:
- **From and To.** From is `MAIL_FROM`. To is the household notice address from Seed data.
- **Format.** It is plain text, contains no links or URLs, and carries header `X-Nightplan-Notice: <notice id>`.
- **Delivery.** It is sent once, and the notice becomes `sent` with `sent_at` only after the SMTP server accepts it.
- **Retry.** A failed attempt increments `attempts` and leaves the notice queued.

Each notice is claimed by one sender at a time, so it never goes out twice.

| Kind | Trigger | Subject | Body |
|---|---|---|---|
| `guest_scene_ended` | the server ends a guest scene | "Guest scene ended: `<Room>`" | "The guest scene `<Scene>` in `<Room>` ended at `<HH:MM>` on `<long date>`. `<Room>` is back on `<scheduled scene>`." The time and date are the guest scene's end |
| `schedule_change` | per the Business rules timing | "Schedule change takes effect: `<Schedule>`" | "From `<long date>`, the `<Schedule>` schedule runs these slots:" followed by one line per slot, "`<HH:MM>` `<Scene>` — `<room names joined by commas>`". The date is the version's `from` date |
| `motion` | a clip becomes stored | "Motion on `<Camera name>`" | "`<Camera name>` recorded motion at `<HH:MM:SS>` on `<long date>`. The clip is stored on the hub (`<stored size>` bytes)." |

Delivery timing:
- While mail is up, each queued notice is sent within ten seconds of being queued.
- While mail is unreachable, notices stay queued, nothing is sent, and status reports mail `down`. The server retries every 5 seconds and checks mail at start and every 5 seconds.
- When mail is back, each queued notice arrives exactly once, within ten seconds.

### Seed data

Every seeded household, person and address is invented.

- **Household:** "Alder Lane house". Zone America/Chicago. Household notice address `household@alder-lane.test`.
- **Rooms**, in plan order (id, name):
  1. `hall` Hall
  2. `kitchen` Kitchen
  3. `living` Living
  4. `study` Study
  5. `main-bedroom` Main bedroom
  6. `nursery` Nursery
  7. `spare-room` Spare room
  8. `bath` Bath
  9. `porch` Porch
- **Scenes**, in catalogue order:

| id | name | tint | brightness | setpoint_f |
|---|---|---|---|---|
| `wake` | Wake | amber | 70 | 70 |
| `day` | Day | honey | 40 | 68 |
| `evening` | Evening | ember | 60 | 69 |
| `bedtime` | Bedtime | rose | 20 | 67 |
| `night-low` | Night low | dusk | 5 | 65 |
| `guest-welcome` | Guest welcome | candle | 50 | 71 |

- **Devices.** All online, revision 1, with the state shown:

| id | name | room | kind | state |
|---|---|---|---|---|
| `hall-light` | Hall light | hall | light | off, level 70 |
| `hall-camera` | Hall camera | hall | camera | |
| `kitchen-lights` | Kitchen lights | kitchen | light | off, level 70 |
| `kettle-plug` | Kettle plug | kitchen | plug | off |
| `living-lamp` | Living lamp | living | light | off, level 60 |
| `living-thermostat` | Living thermostat | living | thermostat | setpoint 68, reading 69 |
| `study-lamp` | Study lamp | study | light | off, level 40 |
| `desk-plug` | Desk plug | study | plug | on |
| `main-bedroom-light` | Main bedroom light | main-bedroom | light | off, level 20 |
| `main-bedroom-thermostat` | Main bedroom thermostat | main-bedroom | thermostat | setpoint 67, reading 68 |
| `nursery-light` | Nursery light | nursery | light | off, level 20 |
| `nursery-thermostat` | Nursery thermostat | nursery | thermostat | setpoint 68, reading 68 |
| `spare-room-light` | Spare room light | spare-room | light | off, level 50 |
| `bath-light` | Bath light | bath | light | off, level 70 |
| `porch-light` | Porch light | porch | light | off, level 60 |
| `porch-camera` | Porch camera | porch | camera | |

- **Schedules.** Both at revision 1, each with one version from 2026-01-01.

**Weekday** (`weekday`, Monday to Friday):

| time | scene | rooms |
|---|---|---|
| 01:30 | Night low | all nine rooms |
| 06:40 | Wake | Hall, Kitchen, Main bedroom, Nursery, Bath |
| 08:30 | Day | Kitchen, Living, Study |
| 17:30 | Evening | Hall, Kitchen, Living, Porch |
| 19:30 | Bedtime | Nursery |
| 21:30 | Bedtime | Main bedroom |
| 22:15 | Night low | Hall, Kitchen, Living, Study, Bath, Porch |

**Weekend** (`weekend`, Saturday and Sunday):

| time | scene | rooms |
|---|---|---|
| 01:30 | Night low | all nine rooms |
| 08:00 | Wake | Hall, Kitchen, Main bedroom, Nursery, Bath |
| 10:00 | Day | Kitchen, Living, Study |
| 18:00 | Evening | Hall, Kitchen, Living, Porch |
| 19:45 | Bedtime | Nursery |
| 22:30 | Bedtime | Main bedroom |
| 23:30 | Night low | Hall, Kitchen, Living, Study, Bath, Porch |

- **Empty at start:** no guest scenes, runs, clips, notices or idempotency keys.
- **Hub clock:** starts at real time. In 2026 the household's fall-back day is Sunday 1 November 2026. The next spring-forward day is Sunday 14 March 2027.

## Technical requirements

### Deployment (DP-52)

- **Runtime.** The app is TypeScript on Node.js 22 LTS with npm.
- **Run manifest.** `/app/run.json` holds string commands `install`, `build` and `serve` plus `"_schema":"run-manifest-v1"`, for example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}
  ```

- **Port.** `serve` binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set.
- **Health.** `GET /api/health` returns HTTP 200 with JSON `{"status":"ok"}` once the schema is applied and PostgreSQL answers. Until then it returns 503 `{"status":"starting"}`.
- **Startup.** Health and the pages work while MinIO or Mailpit is unreachable. The plan is usable within three seconds of `serve` reporting healthy.

### Configuration and secrets (DP-53)

Read at start from the environment:
- `DATABASE_URL`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `SMTP_HOST`, `SMTP_PORT`
- `MAIL_FROM`
- `APP_PUBLIC_PORT`

Never hard-code any of them, never write them to logs, and never send them to the browser or include them in built assets. `MAILPIT_URL` may be present and is not needed by the app.

### Server boundary (DP-54, DP-55)

- **Same origin.** The app is served from one origin, and its pages call only that origin. Responses carry no cross-origin allowance headers. A write request (POST, PUT) whose `Origin` header is present and differs from the request's own origin gets `403 forbidden_origin`. A socket upgrade with a foreign `Origin` is refused with 403.
- **Size limits.** JSON bodies may be at most 65,536 bytes (that size is allowed, one byte more gets `413 too_large`). Clip bytes may be at most 20,000,000 bytes (that size is allowed).
- **Content types.** JSON endpoints accept only `application/json`, and the clip bytes endpoint only `application/octet-stream`. Anything else gets `415 unsupported_media_type`.
- **Never served.** The server never serves source files, the run manifest, lockfiles, package manifests, environment files or dependency folders. For example, `GET /run.json`, `/package.json`, `/.env` and `/src/` return 404 with the error shape.
- **Paths.** Unknown `/api/` paths return `404 not_found`. Page routes are exactly those listed in Screens and layout, and any other path returns 404.
- **Boot without PostgreSQL.** If PostgreSQL is unreachable at boot, the server keeps retrying every 2 seconds and answers health with 503 until it connects.

### Browser support and performance

- **Browsers.** Current Chromium, Firefox and WebKit, on desktop and touch devices.
- **Viewports.** 375x812, 768x1024 and 1280x800, with no horizontal overflow.
- **Responsiveness.**
  - Each scrubber step updates the 'At this time' list and the slider value within a tenth of a second.
  - A full plan sweep across all nine rooms finishes within 600 milliseconds.
  - Socket changes appear on screen within two seconds of the server change.

## Working rules

- IF-01: `/app/run.json` exists with exactly the string keys `install`, `build`, `serve` and `"_schema":"run-manifest-v1"`.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` names every shipped package with its version and licence, plus every bundled font and icon set. Shipped packages means the production dependency tree as `npm ls --omit=dev --all --json` reports it.
- IF-03: Shipped packages and bundled assets use only these licences: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, CC0-1.0 or OFL-1.1.
- IF-04: PostgreSQL and MinIO are the only datastores. No SQLite, Redis, embedded database or files used as a database.
- IF-05: The provided development service configuration and its credentials stay unchanged.
- IF-06: `/app/package-lock.json` is committed and the `install` command uses `npm ci`.
- IF-07: Pages load no resources from other origins. Fonts and icons are served by the app itself.

## Engineering standards

- TypeScript in strict mode throughout, with no `any`, idiomatic for Node and the browser.
- Names in code match this brief's domain terms: room, scene, tint, slot, schedule, schedule version, from date, revision, guest scene, run, clip, notice, outbox, hub clock, household day.
- Each domain rule is decided in exactly one place in the source. The rules are room owner, slot occurrence across daylight-saving changes, household day, guest scene transitions, clip confirmation, the schedule revision check, schedule-change notice timing and notice delivery. Every other part of the code calls that one place.
- No abstraction with only one implementation, and no features, settings or endpoints beyond this brief.
- No dead, commented-out or unreachable code, and no defensive checks for states the rules make impossible.
- One error shape built in one way for every API error, with codes and messages exactly as published.
- Database writes that must agree (schedule revision with its version, a notice claim with its sent mark) happen in a single transaction.
