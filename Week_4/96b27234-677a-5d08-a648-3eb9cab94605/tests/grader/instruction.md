# Tabletop Lantern Co. Hearthtile

Hearthtile is a small browser gathering place for volunteers who run hobby communities and for the hobby 3D creators who build their rooms and avatars. People walk tile by tile through paper-cut 3D rooms, talk only to those nearby, keep each other safe with one set of tools, and meet at scheduled gatherings. It uses four backend services: Postgres for lasting records, MinIO for uploaded model files, Mailpit for mail, and Valkey for live presence and tile claims across app instances. Out of scope: voice and video, headset and native apps, in-world scripting, a marketplace, currency and paid plans, age verification, AI features, outside sign-in, scores, matches, block placing, crafting, channel-based chat, and any other datastore or broker.

## Problem and users

Volunteers host live gatherings in heavyweight 3D social apps that need a headset or a large client. They cannot tell in advance how heavy a room or avatar will be on a modest laptop or phone. A new version of a room can change a session while people are standing in it. Mute, block, hide-by-rank, removal votes and reports are scattered, and they take effect at different times. Reminders sent through chat servers are wrong across time zones. Hobby creators have nowhere light to publish a checked model with an honest performance rank. Hosts and creators pay in unpaid hours, and the one-person operator pays in moderation load.

- **Host** (weekly): opens a live session of a published room with a visibility level and capacity, schedules gatherings for a community, and keeps the session safe.
- **Creator** (weekly): uploads a room or avatar as a GLB file, reads the server's check and published rank, and publishes new versions without disturbing people already inside.
- **Member** (daily): joins from an invite or a friend's presence, walks tile by tile by keyboard or touch, talks only to people nearby, and controls who and what appears.
- **Moderator** (daily): triages reports and applies decisions that take effect immediately across live sessions.

## Journeys

1. **Walking a room by keyboard.** A Member starts on an open session page. They turn and step with the arrow keys, hear walls and seats refuse them, sit and stand, ask who is nearby, and open the actions for the nearest person. The end state is a mirror showing their new tile and focus back on the control they started from.
2. **Meeting across instances.** Two Members start on different app instances in one session. Each sees the other arrive and move with no reload. They step for the same tile, and one wins while the other reads the notice. The end state is both mirrors agreeing on the winner's tile, then an announced departure.
3. **Walking on a phone.** A Member starts at phone size and steps with the on-screen direction buttons, holding one down to keep walking. They open and close the people and chat sheet and reopen it while it is still closing. The end state is an open sheet that stays open, and a canvas above it showing their tile.
4. **Talking nearby.** Three Members start in one room at different distances. One speaks. The end state is the speaker reading how many heard, the Earshot Ripple reaching 6 tiles, the nearby Member reading the message, and the distant Member having received nothing at all.
5. **Opening and filling a session.** A Host starts on the sessions page and opens a room at a chosen visibility and capacity. Friends find it, others never do, and two people race for the last place. The end state is exactly one new person inside and the host role handed on when the Host leaves.
6. **Publishing a checked model.** A Creator starts in the studio and uploads by keyboard, reads a refusal for a renamed file, then uploads a real GLB. The end state is a rank and worst measure on screen, a table of measures, and a published version whose file reads back byte for byte.
7. **Changing a room while people stand in it.** A Creator publishes a new room version while a Member is inside. The Member keeps the old walls until rejoining. The Creator restores an old version and removes another. The end state is a Member on the new version and a removed file that answers not found.
8. **Staying safe and being heard.** Members start in a live room and block, mute and hide by rank, start a removal vote and file a report. A Moderator reviews and suspends. A community owner demotes a steward mid-session. A gathering reminder arrives at the right time in each Member's own zone. The end state is every change in force at once, with the exact notices on screen.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health.** Ship the run manifest and bind as Deployment states, and answer the health route as API states, including its 200 unavailable body when Valkey or MinIO is out of reach.
- **DP-02 — Grading setup and worlds.** `POST /api/grading/setup` creates a complete world from one JSON body and answers every created id by its key, and lists, counts, presence and search only ever include the caller's world.
- **DP-03 — Grading clock and outage.** `POST /api/grading/clock` holds a world's clock and runs everything that has become due before it answers, and `POST /api/grading/outage` makes only the receiving instance treat a service as unreachable until set false.
- **DP-04 — Instances and timers.** Every timer and limit reads its published environment variable at start, and each published extra instance behaves as Deployment states.
- **DP-05 — Error order.** Every route follows the one error order and body shapes stated at the top of API, so anything the caller cannot open answers 404 and never 403.
- **DP-06 — Server boundary.** Enforce the same-origin rule, the request size limits and the list of things never served, and keep starting and serving when a dependency is unreachable at boot, as Server boundary states.
- **DP-07 — Sign-up and sign-in.** Sign-up and sign-in never reveal whether an email is known, sign-up mails a confirmation link to a new email only, and only a confirmed account signs in.
- **DP-08 — Seed data.** Apply the invented records in Seed data exactly once at first start, with original procedural model files stored as real versions.
- **DP-09 — Room mirror.** A room page carries the published mirror lists and attributes, updated when the server's message arrives and never on an animation frame, so it stays correct with the page clock paused.
- **DP-10 — Turn then step.** A direction press turns a standing person who is not facing that way and moves a standing person who is, on the published tile grid decided by the server, and a seated person's press is refused as Business rules states.
- **DP-11 — Refused steps and pacing.** A refused step changes nothing and answers its exact text, and a step inside the minimum interval answers 429, as Business rules states.
- **DP-12 — Sit and stand.** A person sits on the seat straight ahead and stands back to the published tile, with an exact refusal for each case in Business rules.
- **DP-13 — Room shortcuts.** A Member walks, sits, opens chat, lists nearby people and opens the nearest person's actions using only the keyboard, with Tab wrapping inside every open dialog and focus returning to the opener.
- **DP-14 — Room announcements.** The Room announcements region holds each arrival, departure, nearby person and refusal with its exact text, spaced by the page clock rule in Feedback states.
- **DP-15 — Live mirror across instances.** Two people on different app instances see each other's arrival and every move in the mirror in place with no reload, through the published Valkey keys and channel.
- **DP-16 — One tile one winner.** Of any people stepping onto one tile on any instances, exactly one moves by server order and each other person reads the published refusal and stays.
- **DP-17 — Exits and departures.** Stepping onto an exit or leaving ends a person's presence in the session, and a person who has lost all sockets leaves only after the grace period, with a reload inside it keeping their tile.
- **DP-18 — Direction buttons.** On a phone a Member steps with on-screen direction buttons of at least 44 px, where a press steps once at once and a hold repeats on the page clock until release.
- **DP-19 — People and chat sheet.** At phone size a closed sheet is hidden and inert, Tab wraps inside the open sheet, arrow keys in its chat field move only the caret, and reopening it during its exit keeps it open with no stale timer re-hiding it.
- **DP-20 — Published layouts.** Each of 375x812, 768x1024 and 1280x800 shows its published arrangement and order of canvas, people list and chat with no horizontal overflow.
- **DP-21 — Chat distance.** The server decides recipients at send time by the published distance, and `heardBy` matches every case in the worked distance table in Business rules.
- **DP-22 — Chat recipients and length.** A message reaches only its recipients in the log, the API and the socket, walking into range later never reveals it, and its length is counted in user-perceived characters as Business rules states.
- **DP-23 — Earshot Ripple.** On send the speaker reads the server's recipient count and sees Earshot Ripple grow from their tile out to the chat distance, observable through the published attributes on the page clock.
- **DP-24 — Session lifecycle.** A Host opens a session of a published room with a level and capacity, the longest-present person becomes host when the host leaves, and the session ends when its last person leaves.
- **DP-25 — Visibility levels.** Who may see and join a session matches every row of the visibility table in Business rules, a block with the host included.
- **DP-26 — Barred sessions stay hidden.** A session someone may not join answers 404 and is absent from every list, search, total, count, capacity figure and friend presence entry that person can read.
- **DP-27 — Last capacity place.** Exactly one of any number of concurrent joiners takes the last place across instances, the others read the published refusal, and a person with two tabs counts once.
- **DP-28 — Friend presence.** Friends with no block between them read each other's published presence state, and a join control appears only when the viewer may join that session.
- **DP-29 — Upload journey.** A Creator uploads, reads the rank, the worst measure and the measures table, and publishes the version using only the keyboard, as the upload rows in Public screens and controls state.
- **DP-30 — Refused uploads.** Type is judged from the file's content in the published check order, never its name or declared type, and each refused file answers and shows its exact text.
- **DP-31 — Rank measures.** Triangles, materials, texture size and file size are measured as Business rules states, and the rank is computed once at upload and stored with the version.
- **DP-32 — Rank limits.** The rank for each kind matches every inclusive limit in the rank table, the worst measure sets the rank, and a tie names the earlier measure.
- **DP-33 — Stored as submitted.** Every version's file is stored byte for byte at the published MinIO key and reads back as the same bytes, and a version exists only after its object is stored.
- **DP-34 — Publishing versions.** Publishing makes a checked version current for later joins only, and everyone already inside keeps the version they joined with until they rejoin.
- **DP-35 — Walking your own version.** Each person walks on the layout of their own room version while other people still block them, as the worked example in Business rules states.
- **DP-36 — Restore and removal.** Restore publishes a new version with the old bytes, and removal deletes the object and takes the version out of every list and route unless it is in use by an open session, as Business rules states.
- **DP-37 — Block both ways.** A block has every published effect in both directions at once in live sessions, persists, and is fully undone on unblock.
- **DP-38 — Mute one way.** A mute stops only the muted person's chat reaching the muter, leaves the muted person's view unchanged, applies at once and persists.
- **DP-39 — Hide above rank.** A viewer's rank setting hides heavier avatars for that viewer only, at once, with the published precedence between avatar states.
- **DP-40 — Starting and casting a vote.** Anyone in a session starts a removal vote by keyboard from the person's actions, the starter's yes counts, eligibility is fixed at the start, and each illegal attempt answers its exact refusal.
- **DP-41 — Vote thresholds.** The yes votes a removal needs match every row of the threshold table in Business rules.
- **DP-42 — Vote window and outcome.** The server's world clock alone opens and closes a vote even when the device clock is wrong, and passing removes the person at once with the published notices and a barred rejoin.
- **DP-43 — Anonymous reports.** Anyone in a session files a report by keyboard, a block does not prevent it, and no response, page or mail ever reveals who filed it.
- **DP-44 — Report moves.** A Moderator moves a report through the legal states, every illegal move is refused with the exact text, and non-moderators answer 404.
- **DP-45 — Warn and suspend.** Suspending ends the person's live sessions at once with the published notice and refuses their next request and later sign-ins, while warning shows its notice and ends nothing.
- **DP-46 — Live role changes.** A role change or removal applies on the person's next request, mid-session, and a removed control leaves the page on the pushed event with focus kept safe.
- **DP-47 — Member fields by role.** `GET /api/communities/<id>/members` returns exactly the keys in the role table in Business rules, and nothing more.
- **DP-48 — Community boundary.** Another community's member, gathering or session id answers 404 on every route, nested path and request body ids included.
- **DP-49 — Gathering times by zone.** A gathering is stored in its community's zone and each Member reads it in their own zone in the exact published format and abbreviation.
- **DP-50 — Daylight-saving rules.** Weekly gatherings keep the community's wall clock across daylight-saving dates, and missing and repeated local times follow the published rules and are shown as notes to each Member.
- **DP-51 — Gathering status and limit.** The server's world clock decides upcoming, open and ended even when the device clock is wrong, and attending stops at the limit with the published refusal.
- **DP-52 — Exactly-once reminders.** Each attending Member gets one reminder per occurrence across all instances at the published lead time, in that Member's zone, and nothing one second earlier.
- **DP-53 — Friend invites.** Friend invites answer identically for known and unknown emails, work once by keyboard, die at exactly their lifetime, can be revoked, and show one identical refusal when dead.
- **DP-54 — Reduced motion.** Under reduced motion the camera cuts, avatars jump, no animation runs, Earshot Ripple is a static outline and the sheet has no exit animation, with the same function and text.
- **DP-55 — File storage outage.** With MinIO unreachable an upload saves nothing and shows the exact text, which no later repaint overwrites.
- **DP-56 — Live room outage.** With Valkey unreachable opening or joining saves nothing and shows the exact text, other pages keep working, and an open room page recovers with no reload or restart.
- **DP-57 — Paper-cut look.** Every screen wears the warm cut-paper look in Visual design, on a cream ground with one lantern-yellow accent and hard offset shadows.
- **DP-58 — Room scene.** A seeded room shows a visible paper-cut tile floor, avatars standing on their tiles and, after a message, Earshot Ripple, on a software WebGL renderer.
- **DP-59 — 3D view fallback.** Without WebGL the canvas is replaced by the published text, and the mirror and every control still work.
- **DP-60 — Source integrity.** The source shows a real WebGL scene, real provider calls and credentials read only from the environment, with no state faked for the mirror or stored outside the four services.

## Frontend

### Screens and layout (DP-09, DP-19, DP-20, DP-24, DP-29, DP-44, DP-46, DP-49, DP-53)

Every path below works by direct URL. A signed-out visitor to a signed-in page goes to `/signin`, and returns to the page after signing in.

- `/`: a front door naming the product, with links to sign in and sign up. A signed-in visitor goes to `/sessions`.
- `/signin`, `/signup`: the forms, with the confirmation message after sign-up.
- `/confirm/<token>`: confirms the account and offers a link to sign in.
- `/sessions`: search, the sessions the person may see, their friends' sessions, the avatar they wear, and the open-a-session dialog.
- `/sessions/<id>`: the room if the person is inside; otherwise a short summary and the join button if they may join; otherwise the unavailable heading.
- `/friends`: friends with presence, the invite form and sent invites.
- `/invites/<token>`: accepting an invite, or the dead-link heading.
- `/studio`: upload form, result, measures, the Creator's assets and versions.
- `/communities`, `/communities/<id>`: the person's communities; a community's members and gatherings.
- `/gatherings/<id>`: a gathering's occurrences, status and attendance.
- `/moderation`: the report queue, for Moderators only.

Any other path shows the not-found heading in Feedback states. Each signed-in page carries the main navigation at the top, wrapping onto a second row on a phone. No screen overflows sideways at any of the three published viewports.

The room page's arrangement at each viewport, with no other width changing which arrangement these three get:

| Viewport | Arrangement |
|---|---|
| 1280x800 | Three columns: people list left, canvas centre, chat right. The direction buttons sit below the canvas. `list "Room features"` sits below the people list. |
| 768x1024 | Canvas on top, direction buttons under it, then people list on the left and chat on the right, side by side below. |
| 375x812 | Canvas on top, direction buttons below the canvas, `button "People and chat"` below them. The people list, room features and chat sit in the sheet `dialog "People and chat"`. |

`status "Room announcements"` lies outside the sheet at every viewport. A closed sheet is hidden and inert: nothing in it is visible, focusable or in the accessibility tree. Its mirror entries still exist in the page's structure with current data attributes, so they can be read by attribute. `button "People and chat"` is shown only at the phone arrangement.

### Public screens and controls (DP-09, DP-13, DP-18, DP-19, DP-22, DP-24, DP-28, DP-29, DP-36, DP-37, DP-38, DP-39, DP-40, DP-43, DP-44, DP-46, DP-49, DP-51, DP-53)

Only these are public. Everything else is free. A name in angle brackets is filled from the record.

**Mirror attributes.** The canvas and lists below live in `region "Room"`, which carries `data-room-version` (the version this person is on), `data-motion` (`animated` or `reduced`), `data-ripple` (`none`, `growing` or `outline`) and `data-ripple-radius` (0 to 6). The visible text `Room version <n>` is in the region.

Each `listitem` of `list "People here"`, one per person in the session, carries:
- `data-person-id`
- `data-display-name`
- `data-tile-x`, `data-tile-y`
- `data-facing` (`north`, `east`, `south` or `west`)
- `data-seated` (`true` or `false`)
- `data-avatar` (`shown`, `hidden` or `fallback`)
- `data-host` (`true` or `false`)

Each `listitem` of `list "Room features"`, one per exit and seat, carries `data-feature-id`, `data-kind` (`exit` or `seat`), `data-tile-x`, `data-tile-y` and `data-occupied-by` (a person id, or empty).

| Where | Role and accessible name | Notes |
|---|---|---|
| All signed-in pages | `navigation "Main"` | Links `Sessions`, `Friends`, `Studio`, `Communities`, and `Moderation` for Moderators only |
| All signed-in pages | `button "Sign out"` | |
| Sign in and sign up | `textbox "Email"`, field labelled `Password`, `button "Sign in"` | |
| Sign up | `textbox "Display name"`, `combobox "Time zone"`, `button "Create account"` | Options in the combobox table below |
| Sign in and sign up | `status "Account result"` | |
| Sessions | `searchbox "Search sessions"`, `status "Session count"` | |
| Sessions | `list "Sessions"`, each item with `data-session-id` and `button "Join <room name>"` | |
| Sessions | `list "Friends' sessions"`, each item with `data-session-id` and `button "Join <host name>"` | Holds `friends` sessions the viewer may join |
| Sessions | `combobox "Wear avatar"`, `button "Open a session"` | |
| Open-a-session dialog | `dialog "Open a session"`, `combobox "Room"`, `combobox "Visibility"`, `spinbutton "Capacity"`, `combobox "Community"`, `button "Open session"`, `button "Cancel"` | Community is shown for the `community` level |
| Session page | `button "Join session"`, `status "Session result"`, `alert` | |
| Room | `region "Room"` | Contains everything in the room rows |
| Room | `img "Room view"` | The canvas with `role="img"` |
| Room | `list "People here"`, `list "Room features"` | Each person's item has `button "Actions for <name>"` |
| Room | `button "Step north"`, `button "Step east"`, `button "Step south"`, `button "Step west"`, `button "Sit or stand"` | At least 44 px each at 375x812 |
| Room | `button "Leave session"` | |
| Room | `combobox "Hide avatars above"` | Options in the combobox table below |
| Room, host only | `combobox "Invite a friend"`, `button "Invite"` | |
| Room, owners and stewards in a community session | `button "Schedule gathering"` | Same control as on the community page |
| Room, phone | `button "People and chat"`, `dialog "People and chat"`, `button "Close"` | The close button is inside the sheet |
| Room | `status "Room announcements"` | Polite live region, one paragraph per announcement |
| Room | `log "Nearby chat"`, `textbox "Say something nearby"`, `button "Send"`, `status "Chat result"` | Each log child reads `<display name>: <text>` |
| Room | `status "Safety result"` | |
| Person actions | `dialog "Person actions"`, `button "Block"` or `button "Unblock"`, `button "Mute"` or `button "Unmute"`, `button "Start removal vote"`, `button "Report"`, `button "Close"` | |
| Report | `dialog "Report someone"`, `combobox "Category"`, `textbox "Details"`, `button "Send report"`, `button "Cancel"`, `status "Report result"` | |
| Vote | `region "Removal vote"` with `data-vote-status` (`open`, `passed` or `failed`), `button "Vote yes"`, `button "Vote no"`, `status "Vote result"` | Shows the visible text `Vote on removing <name>.` |
| Friends | `list "Friends"`, each item with `data-person-id`, `data-presence`, and `button "Join <name>"` when allowed; `button "Remove friend <name>"` | |
| Friends | `textbox "Friend's email"`, `button "Send invite"`, `status "Invite result"` | |
| Friends | `list "Sent invites"`, each with `button "Revoke invite to <email>"` | |
| Invite page | `button "Accept invite"` | |
| Studio | `combobox "Kind"`, `textbox "Model name"`, file field labelled `Model file`, `textbox "Room layout"`, `button "Upload model"` | Room layout is shown for rooms |
| Studio | `status "Upload result"`, `alert`, `table "Measures"` | Columns `Measure`, `Value`, `Rank`, with four rows in this order: `triangles`, `materials`, `texture size`, `file size`. `Measure` holds that label exactly. `Value` holds the API's whole number for that measure with no separators or unit, for example `5001`. `Rank` holds only that measure's own rank name, for example `Linen` |
| Studio | `list "Versions"`, each item with `data-version`, `data-version-status`, `button "Publish version"`, `button "Restore version <n>"`, `button "Remove version <n>"`; `status "Version result"` | |
| Communities | `table "Members"`, `combobox "Role for <name>"`, `button "Remove <name>"`, `status "Community result"` | Shown by role |
| Communities | `list "Gatherings"`, each item with `data-gathering-id`, `data-status` | |
| Schedule | `button "Schedule gathering"`, `dialog "Schedule gathering"`, `textbox "Title"`, `textbox "Starts"`, `spinbutton "Duration in minutes"`, `combobox "Repeats"`, `spinbutton "Limit"`, `button "Save gathering"`, `button "Cancel"` | |
| Gathering | `list "Occurrences"`, each item with `data-status`, showing the display time, the status word and any note | |
| Gathering | `button "Attend"`, `button "Stop attending"`, `status "Gathering result"` | |
| Moderation | `table "Reports"`, each row with `data-report-id`, `data-report-state`, and only its legal `button "Start review"`, `button "Warn"`, `button "Suspend"`, `button "Dismiss"`; `status "Moderation result"` | |
| Any | `alert` | Removal, suspension, warning and outage notices |

Each combobox is a native single-choice select with exactly these options, in this order:

| Combobox | Option labels | Value of each option |
|---|---|---|
| `Time zone` | The allowed zones in Business rules, in table order, each by its IANA name, for example `Europe/London` | Same as its label |
| `Visibility` | `public`, `friends`, `community`, `invite` | Same as its label |
| `Kind` | `room`, `avatar` | Same as its label |
| `Category` | `harassment`, `hateful-content`, `impersonation`, `other` | Same as its label |
| `Repeats` | `none`, `weekly` | Same as its label |
| `Role for <name>` | `owner`, `steward`, `member` | Same as its label |
| `Hide avatars above` | `Show all`, `Feather`, `Linen`, `Cedar`, `Granite` | Same as its label, except that `Show all` has an empty value and sends JSON `null` |
| `Room` | The name of each room in the world with a current published version | The room's id |
| `Community` | The name of each community where the person is an owner or steward | The community's id |
| `Wear avatar` | The name of each avatar in the world with a current published version | The avatar's id |
| `Invite a friend` | The display name of each of the host's friends | The person's id |

`Hide avatars above` and `Role for <name>` open on the current setting.

### Interactions (DP-13, DP-18, DP-19, DP-29, DP-40, DP-43, DP-53)

**Page clock.** Pages under test run with a paused browser clock that the test advances, and with service workers blocked. App behaviour needing a browser timer (hold repeat, announcement spacing, reconnect, sheet exit, ripple) completes when that clock advances. No page load, mirror update or control waits on a timer or an animation frame.

**Room keys.** These work whichever control has focus inside `region "Room"`, and also when focus is on the page itself:

| Key | Effect |
|---|---|
| Arrow keys | Press the matching direction, turning or stepping |
| `S` | Sits, or stands if seated |
| `T` | Opens the sheet if needed, then focuses the chat field |
| `N` | Announces nearby people, those within chat distance |
| `M` | Opens `dialog "Person actions"` for the nearest other person in the session, at any distance: least Chebyshev distance, ties by display name as the viewer sees it, then id |

If there is nobody to name, `N` and `M` announce the empty text from Feedback states. Keys are sent one at a time in the order pressed, and none is dropped.

Arrow keys and shortcuts never act while focus is in a text field or select, and they do not act while `dialog "Person actions"`, `dialog "Report someone"` or `dialog "Schedule gathering"` is open. In the chat field, arrow keys move the caret and not the avatar.

**Escape and focus.** Escape closes the open dialog or sheet and returns focus to its opener. In the chat field outside a sheet, Escape leaves the field and returns focus to the control that had focus before, or to the region if none did. Tab and Shift+Tab wrap inside every open dialog and the open sheet, and focus never leaves it. If `M` opened the dialog, focus returns to the control that had focus when `M` was pressed.

Every action works by keyboard, including choosing a file, uploading, publishing, voting, reporting and accepting an invite. Enter sends chat from the chat field. Enter or Space activates any focused button.

**Touch.** A press on a direction button steps once at once. Holding repeats one press every 250 ms of page clock until release, including release outside the button. No gesture depends on a canvas pixel, and dragging on the canvas does nothing.

**Sheet.** `button "People and chat"` opens the sheet with focus on its first control. `button "Close"` or Escape closes it, and the opener becomes available as soon as closing starts. Pressing it during the exit leaves the sheet open, and no later timer hides it.

**Searching sessions.** Each change in `searchbox "Search sessions"` updates `list "Sessions"` and `status "Session count"` in place on the server's reply, with no submit button, no reload and no waiting on a browser timer.

**Removed controls.** If a control with focus disappears because of a pushed event, focus moves to the page's main heading and never falls to nothing.

### Visual design (DP-57, DP-58)

The look is warm, tactile and welcoming, like a craft table:

- **Colour.** The ground is cream paper. Text and outlines are a dark slate ink. A single lantern yellow marks primary actions and your own avatar's base. A brick red is reserved for safety actions and refusals. A muted teal marks calm confirmations and the Earshot Ripple. All text and controls meet WCAG 2.2 AA contrast, and focus is a thick ink outline visible on every control.
- **Type.** Headings use the platform's built-in serif and body text uses the platform's built-in sans-serif, with no downloaded fonts. Each heading level is about one-fifth larger than the level below it.
- **Surfaces.** Panels and buttons look like cut paper with softly rounded corners and a hard offset shadow with no blur.
- **Density.** Spacing is comfortable, with room between rows, and every control is at least 44 px to tap.
- **Composition.** The 3D paper-cut room sits beside a plain readable list of the same people and features, so nothing depends on seeing the canvas.

**3D scene.** The canvas shows a WebGL view through an open-source library with an allowed licence, such as three.js. It shows the room from a fixed three-quarter angle above: a floor of cream paper tiles in two close shades, walls as raised cut-paper blocks, seats as low folded stools, exits as lantern-yellow tiles, and each person's avatar on a paper base on their tile. Rubric checks open a seeded room on a software WebGL renderer and look for a visible tile floor, avatars and Earshot Ripple, never frame rate.

### Motion and effects (DP-23, DP-54, DP-59)

Motion always means a change of state:

- **Sheet and dialogs.** The sheet enters in under a third of a second and exits in about a quarter of a second, settling softly.
- **Press feedback.** A pressed button drops onto its shadow in about a tenth of a second.
- **Avatars.** An avatar glides to its new tile in about a fifth of a second.
- **Camera.** The camera follows your avatar and settles in under half a second. Dragging does not orbit it, with or without reduced motion.
- **Idle.** The scene holds still when nothing changes. Unnamed decorative loops are banned everywhere.

**Earshot Ripple.** This is the product's signature:

1. The speaker presses Send and the server replies with its recipient count.
2. `status "Chat result"` reads the Heard-by text from Feedback states.
3. In the speaker's 3D view, a ring of tinted tiles starts at the speaker's tile, with `data-ripple="growing"` and `data-ripple-radius="0"`.
4. The radius grows by one tile every 60 milliseconds of page clock, reaching 6 at 360 milliseconds, starting fast and settling softly. The ring is a square of tiles because distance is counted the Chebyshev way, it passes over walls, and the room's edge clips it.
5. The ring holds at 6 for half a second of page clock, then `data-ripple` returns to `none` and the radius to 0.

Only the speaker sees it. The attributes run on page timers and never need a rendered frame. A new send restarts it from 0. A refused send shows no ripple.

**Reduced motion.** When the person's system asks for reduced motion, including a change made while the page is open, `data-motion="reduced"`; otherwise `data-motion="animated"`. Under reduced motion:

- The camera cuts rather than glides and avatars jump to their tile.
- `document.getAnimations()` shows no running animation.
- The sheet opens and closes at once with no exit animation.
- Earshot Ripple is replaced at once by a static outline of the in-range tiles, with `data-ripple="outline"` and `data-ripple-radius="6"`, held for 2 seconds of page clock, then `none` and 0.

Function, text and recipients are the same.

**Without WebGL.** The canvas is replaced by the `status` text `3D view unavailable. Everything else still works.`, and the mirror, ripple attributes and every control still work.

### Feedback states (DP-14, DP-23, DP-24, DP-42, DP-43, DP-45, DP-53, DP-55, DP-56)

Every string in backticks in this brief renders character for character, with straight apostrophes and three plain full stops in pending text. Announcements carry the same characters. A later repaint or list refresh never overwrites a refusal, outage or result message the action just showed; the message stays until the person's next action.

| Action | Live region | Pending | Success |
|---|---|---|---|
| Sign up | `status "Account result"` | `Sending...` | `Check your email to confirm your account.` |
| Sign in | `status "Account result"` | `Signing in...` | Goes to the intended page |
| Open or join a session | `status "Session result"` | `Opening...` | Goes to the room |
| Chat | `status "Chat result"` | `Sending...` | `Heard by N.`, where N is the server's `heardBy` |
| Upload | `status "Upload result"` | `Checking your file...` | `Rank: <rank>. Worst measure: <measure>.` |
| Publish | `status "Version result"` | `Saving...` | `Version <n> published.` |
| Restore | `status "Version result"` | `Saving...` | `Version <n> restored as version <m>.` |
| Remove | `status "Version result"` | `Saving...` | `Version <n> removed.` |
| Block, unblock | `status "Safety result"` | `Saving...` | `Blocked.`, `Unblocked.` |
| Mute, unmute | `status "Safety result"` | `Saving...` | `Muted.`, `Unmuted.` |
| Hide by rank | `status "Safety result"` | `Saving...` | `Avatars above <rank> are hidden.`, `All avatars are shown.` |
| Cast a vote | `status "Vote result"` | `Saving...` | `Vote counted.` |
| Report | `status "Report result"` | `Sending...` | `Report sent.` |
| Move a report | `status "Moderation result"` | `Saving...` | `Report moved to <state>.` |
| Change a role, remove a member | `status "Community result"` | `Saving...` | `Role changed.`, `Member removed.` |
| Schedule | `status "Gathering result"` | `Saving...` | `Gathering scheduled.` |
| Attend, stop attending | `status "Gathering result"` | `Saving...` | `You're attending.`, `You're no longer attending.` |
| Send an invite | `status "Invite result"` | `Sending invite...` | `Invite on its way.` |

In the upload text, `<rank>` equals the API's `rank` and `<measure>` equals the API's `worstMeasure` string, character for character, for example `Rank: Linen. Worst measure: texture size.`

A refusal shows its exact server text in the same region, except where this section or Services names `alert`.

**Room announcements.** `status "Room announcements"` holds one paragraph per announcement, newest last, keeping the latest 20. Exact texts:
- `<name> arrived.`
- `<name> left.`
- `<name> is nearby.`, when a person comes within chat distance of you after being out of it. It is never announced for people already within distance when you open the page. A person arriving within distance gives their arrival, then this.
- every refused step or sit text
- `Nearby: <names by distance, then name, comma separated>.` for `N`
- `Nobody is nearby.` for `N` or `M` with nobody to name
- `<name> is now the host.`
- `<name> was removed by a vote.`
- `The vote did not pass.`
- `Live room restored.`

Identical consecutive text within 2 seconds of page clock is not repeated. For example, the wall refusal twice at once gives one paragraph, and after 2 seconds of page clock it gives another. Wherever a blocked person would be named in this region, `<name>` is `Someone`.

**Notices in `alert`:**
- `The room voted to remove you.`
- `A moderator has removed you from this session.`
- `A moderator has warned you.`
- `You are no longer in this community.`

A warning reaches an open page at once. Otherwise it shows once on the person's next page.

**Headings:**
- Unavailable session: `This session isn't available.`
- Dead invite link: `This invite isn't available.`
- Dead confirmation link: `This link isn't available.`
- Any unknown path: `Page not found.`

A person on `/moderation` who is not a Moderator sees `Page not found.`, as they do for any page barred to their role.

## Backend

### API (DP-01, DP-02, DP-03, DP-05, DP-07, DP-09, DP-10, DP-12, DP-21, DP-24, DP-28, DP-29, DP-30, DP-33, DP-36, DP-37, DP-38, DP-39, DP-40, DP-43, DP-44, DP-46, DP-47, DP-48, DP-49, DP-51, DP-53)

**Conventions.** JSON in and out, as UTF-8. Sign-in sets an HttpOnly session cookie valid on every instance. Commands are REST, so server order is plain. Ids are opaque strings.

**Error order, for the whole API:**
1. 401 not signed in: `{"error":"Sign in first."}`.
2. 404 for anything the caller cannot open: unknown, another community's, barred to the caller's role, or a session they may not join. This is never 403. Body everywhere: `{"error":"Not found."}`.
3. 409 state conflicts.
4. 422 validation.
5. 429 rate limit.

Other refusals are `{"error":"<exact text>"}`, with texts in Business rules unless named otherwise. A 503 from Services answers when the request needs an unreachable service; checks that do not need that service run first. Endpoint rows below name only their success response, and their refusals live in Business rules.

**Health.** `GET /api/health` needs no session and answers within one second. `200 {"status":"ok"}`; an instance that cannot reach Valkey or MinIO, or is told so by the outage route, answers `200 {"status":"unavailable"}`, never 503.

**Accounts**
- `POST /api/signup` `{email,password,displayName,timeZone}`: always `202 {"status":"check-your-email"}`, known email or not, once the fields are valid.
- `POST /api/confirm/<token>`: `200 {"status":"confirmed"}`. The `/confirm/<token>` page calls it.
- `POST /api/signin` `{email,password}`: `200 {"personId","displayName","siteRole","timeZone"}`.
- `POST /api/signout`: `200 {"status":"signed-out"}`.
- `GET /api/me`: `200 {"personId","displayName","email","siteRole","timeZone","avatarId","hideAbove","worldId"}`.
- `PUT /api/me/avatar` `{avatarId}`: `200 {"avatarId"}`. The avatar must be published.
- `PUT /api/me/hide-above` `{"rank":"Feather"}`, with `Linen`, `Cedar`, `Granite` or JSON `null` also allowed: `200 {"hideAbove"}`.

**Friends and safety**
- `GET /api/friends`: `200 {"friends":[{"personId","displayName","presence","session"}]}`, with `presence` `online`, `in-session` or `offline`, and `session` `{"id","roomName"}` or null.
- `DELETE /api/friends/<personId>`: `200 {"status":"removed"}`.
- `POST /api/friends/invites` `{email}`: `202 {"status":"sent"}`, identical for known and unknown emails.
- `GET /api/friends/invites`: `200 {"invites":[{"id","email","state","expiresAt"}]}`, with `state` `pending`, `used`, `revoked` or `expired`.
- `DELETE /api/friends/invites/<id>`: `200 {"status":"revoked"}`.
- `GET /api/invites/<token>`: needs no session, `200 {"from":"<displayName>"}`.
- `POST /api/invites/<token>/accept`: `200 {"status":"friends"}`.
- `POST /api/blocks/<personId>`, `DELETE /api/blocks/<personId>`: `200 {"blocked":true}` or `{"blocked":false}`. Replays answer the same.
- `POST /api/mutes/<personId>`, `DELETE /api/mutes/<personId>`: `200 {"muted":true}` or `{"muted":false}`. Replays answer the same.

**Sessions**
- `GET /api/sessions?q=<text>`: `200 {"sessions":[summary],"total":n}`. `q` matches room name and host display name. A summary has exactly `id, roomName, hostName, visibility, capacity, count, status`.
- `POST /api/sessions` `{roomId,visibility,capacity,communityId}`: `201` with the detail below. `communityId` is needed only for `community`, otherwise null.
- `GET /api/sessions/<id>`: `200 {id,roomId,roomName,roomVersion,hostId,hostName,visibility,capacity,count,status,communityId}`. For someone inside, it also has `layout`, `features` (`[{"id","kind","x","y","occupiedBy"}]`) and `people`. Each person has exactly `personId, displayName, x, y, facing, seated, avatar, host`, projected for the viewer. `roomVersion` is the caller's own version if inside, otherwise the current one.
- `POST /api/sessions/<id>/join`: `200` with the detail. Joining while inside is a replay that changes nothing.
- `POST /api/sessions/<id>/leave`: `200 {"status":"left"}`.
- `POST /api/sessions/<id>/invitees` `{personId}`: `201 {"personId"}`, host only.
- `POST /api/sessions/<id>/step` `{"direction":"north"}`, or `east`, `south`, `west`: `200 {"result":"turned","x":n,"y":n,"facing":"east"}`, with `result` `turned`, `moved` or `left`.
- `POST /api/sessions/<id>/sit`: `200 {"result":"seated","x","y","facing"}`.
- `POST /api/sessions/<id>/stand`: `200 {"result":"stood","x","y","facing"}`.
- `POST /api/sessions/<id>/chat` `{"text":...}`: `201 {"id":...,"heardBy":N}`.
- `GET /api/sessions/<id>/chat`: `200 {"messages":[{"id","fromId","fromName","text","sentAt"}]}`, only messages you sent or received, with `fromName` projected for the viewer.
- `POST /api/sessions/<id>/votes` `{"personId"}`: `201` with the vote below.
- `GET /api/sessions/<id>/votes`: `200 {"votes":[{"id","targetId","status","eligible","needed","yes","no","closesAt"}]}`, with `status` `open`, `passed` or `failed`.
- `POST /api/sessions/<id>/votes/<voteId>/ballots` `{"choice":"yes"}`, or `no`: `201` with the vote.

**WebSockets.** Both push only; commands never travel over them. `/ws/sessions/<sessionId>` pushes events to signed-in people in that session. `/ws/me` pushes a signed-in person's own events (friend presence, role changes, warnings, suspension) and keeps them online. Frames are JSON objects with a `type`. Each frame is projected per viewer, so chat text reaches only recipients and a blocked person's real name never appears. A refused upgrade carries no data.

**Assets**
- `POST /api/assets` multipart `kind` (`room` or `avatar`), `name`, `file`, and for rooms `layout`: `201 {"assetId","version","rank","worstMeasure","measures":{"triangles":n,"materials":n,"textureSize":n,"fileSize":n}}`. `worstMeasure` is `triangles`, `materials`, `texture size` or `file size`.
- `POST /api/assets/<id>/versions` multipart `file`, and for rooms `layout`: `201`, same body.
- `GET /api/assets?kind=room&mine=true`: `200 {"assets":[{"id","kind","name","ownerName","currentVersion","rank"}],"total":n}`. Both query parameters are optional. Without `mine`, only assets with a current published version appear.
- `GET /api/assets/<id>`: `200` with those fields plus `versions`, `[{"version","status","rank","worstMeasure","measures","layout","createdAt"}]`, where `layout` is present for rooms. Non-owners see only published versions.
- `GET /api/assets/<id>/versions/<n>/file`: `200` with the stored bytes as `model/gltf-binary`. Published versions are readable by anyone signed in within the world; checked versions by the owner only.
- `POST /api/assets/<id>/versions/<n>/publish`: `200 {"assetId","version","status":"published"}`.
- `POST /api/assets/<id>/versions/<n>/restore`: `201`, same body as upload.
- `DELETE /api/assets/<id>/versions/<n>`, `DELETE /api/assets/<id>`: `200 {"status":"removed"}`.

Changes to a version are for the asset's owner only; anyone else gets 404.

**Reports**
- `POST /api/reports` `{personId,sessionId,category,details}`: `201 {"id","state":"open"}`.
- `GET /api/moderation/reports`: `200 {"reports":[{"id","personId","personName","sessionId","roomName","category","details","state","action","createdAt"}]}`, exactly these keys. There is no filer field.
- `POST /api/moderation/reports/<id>/move` `{"state":"reviewing"}`, also `{"state":"dismissed"}`, or `{"state":"upheld","action":"warn"}` with `warn` or `suspend`: `200` with the report.

**Communities and gatherings**
- `GET /api/communities`: `200 {"communities":[{"id","name","timeZone","role"}]}`.
- `POST /api/communities` `{name,timeZone}`: `201 {"id","name","timeZone","role":"owner"}`.
- `GET /api/communities/<id>/members`: `200 {"members":[...],"total":n}`, with keys from the role table.
- `POST /api/communities/<id>/members` `{personId}`: `201 {"personId","role":"member"}`, for owners and stewards.
- `PUT /api/communities/<id>/members/<personId>` `{"role":"steward"}`: `200 {"personId","role"}`, for owners.
- `DELETE /api/communities/<id>/members/<personId>`: `200 {"status":"removed"}`. Owners remove anyone but themselves. Stewards remove only people whose role is `member`.
- `GET /api/communities/<id>/gatherings`: `200 {"gatherings":[gathering],"total":n}`.
- `POST /api/communities/<id>/gatherings` `{title,startsLocal,durationMinutes,recurrence,limit}`: `201` with the gathering. `recurrence` is `none` or `weekly`.
- `GET /api/gatherings/<id>`: `200` with the gathering, for members of its community. A gathering has `id, communityId, title, durationMinutes, recurrence, limit, attendingCount, attending, status, display, occurrences`.
- `POST /api/communities/<id>/gatherings/<gatheringId>/attend`: `200 {"attending":true,"count":n}`. A replay answers the same.
- `DELETE /api/communities/<id>/gatherings/<gatheringId>/attend`: `200 {"attending":false,"count":n}`.

Each item of `occurrences` is `{"startsAt","startsLocal","display","status","note"}`. `startsAt` is UTC, `startsLocal` is in the community's zone, `display` is in the caller's zone, and `note` is text or null. `occurrences` lists up to 8, from the earliest not ended; a `none` gathering always lists its one. The gathering's own `status` and `display` are those of its first listed occurrence.

**Grading routes.** All three need the header `X-Grading-Key` equal to env `GRADING_KEY` and no session. A wrong or missing key, or an unset `GRADING_KEY`, answers `404 {"error":"Not found."}`.

`POST /api/grading/setup` creates one world and answers 201. Literal example:

```json
{
  "people": [
    {"key":"ann","email":"ann@world.example","password":"lantern-pass-1","displayName":"Ann Ember","timeZone":"America/New_York","siteRole":"member","avatar":"fox"},
    {"key":"ben","email":"ben@world.example","password":"lantern-pass-2","displayName":"Ben Reed","timeZone":"Europe/London","siteRole":"member","avatar":"fox"},
    {"key":"mod","email":"mod@world.example","password":"lantern-pass-3","displayName":"Mo Dale","timeZone":"Asia/Tokyo","siteRole":"moderator"}
  ],
  "friendships": [["ann","ben"]],
  "blocks": [{"from":"mod","to":"ben"}],
  "mutes": [{"from":"ben","to":"mod"}],
  "communities": [
    {"key":"stitch","name":"Stitch Night","timeZone":"America/New_York",
     "members":[{"person":"ann","role":"owner"},{"person":"ben","role":"member"}]}
  ],
  "avatars": [{"key":"fox","name":"Copper Fox","owner":"ann","rank":"Feather"}],
  "rooms": [
    {"key":"loft","name":"Test Loft","owner":"ann","rank":"Feather",
     "layout":{"width":12,"height":12,"spawn":[{"x":1,"y":1}],"walls":[{"x":3,"y":3}],"seats":[{"id":"seat-1","x":5,"y":2}],"exits":[{"id":"exit-1","x":0,"y":6}]}},
    {"key":"den","name":"Test Den","owner":"ann",
     "versions":[
       {"rank":"Feather","layout":{"width":8,"height":8,"spawn":[{"x":1,"y":1}],"walls":[],"seats":[],"exits":[]},"published":true},
       {"rank":"Linen","layout":{"width":8,"height":8,"spawn":[{"x":1,"y":1}],"walls":[{"x":3,"y":3}],"seats":[],"exits":[]},"published":false}
     ]}
  ],
  "sessions": [
    {"key":"s1","room":"loft","host":"ann","visibility":"public","capacity":10,"community":null,"invitees":[],
     "placements":[{"person":"ann","x":2,"y":2,"facing":"north"},{"person":"ben","x":5,"y":5,"facing":"south"}]}
  ],
  "reports": [{"key":"r1","filer":"ann","person":"ben","session":"s1","category":"other","details":"Invented report.","state":"open"}],
  "gatherings": [
    {"key":"g1","community":"stitch","title":"Spring Stitch","startsLocal":"2027-03-07T19:00","durationMinutes":90,"recurrence":"weekly","limit":20,"attending":["ann","ben"]}
  ]
}
```

Response:

```json
{"worldId":"<id>","people":{"ann":"<id>","ben":"<id>","mod":"<id>"},"communities":{"stitch":"<id>"},"avatars":{"fox":"<id>"},"rooms":{"loft":"<id>","den":"<id>"},"sessions":{"s1":"<id>"},"reports":{"r1":"<id>"},"gatherings":{"g1":"<id>"}}
```

Setup rules:
- Every list may be left out or empty.
- Each person is already confirmed and signs in with `POST /api/signin`.
- Emails must be unique across all worlds.
- Avatars and rooms take `rank` (and `layout` for rooms) for a single published version 1, or `versions` for several. The current version is the last one with `published` true, which is the default.
- For each version the server generates a valid small GLB file whose measures give that rank, for example by its materials count, and stores it in MinIO at the published key.
- A session's room must have a published version. A session with no `placements` places the host on the first spawn tile. `placements` give each person's joining order.
- People placed this way have no socket and stay until they leave or are removed.
- A bad reference or value answers `422 {"error":"<reason>"}`, with free reason text.
- The body limit for this route is 1,000,000 bytes.

**Worlds.** Everyone and everything a setup call creates belongs to its world. Lists, counts, presence and search only ever include the caller's world, and another world's ids answer 404. People made through normal sign-up belong to the world with id `default`.

`POST /api/grading/clock` `{"worldId":"...","now":"2027-03-14T18:59:59-04:00"}` sets that world's clock to that instant and holds it, not ticking, until set again. `"now":null` returns it to real time. Each world's clock is independent. Every server time rule reads the world's clock. Before answering, the route runs every reminder, closes every vote and completes every dropped-socket departure that has become due in that world, so results are readable when it answers. It answers `200 {"worldId","now":"<UTC instant>"}`, `404` for an unknown world, and `422 {"error":"Give a valid time."}`.

`POST /api/grading/outage` `{"service":"valkey","down":true}`, with `valkey` or `minio`, and `true` or `false`, makes only the instance receiving it treat that service as unreachable through the same code path as a real failure, until set false. It answers `200 {"service","down"}` or `422 {"error":"Choose valkey or minio."}`. It exists so recovery without a restart can be observed.

### Business rules (DP-07, DP-10, DP-11, DP-12, DP-16, DP-17, DP-21, DP-22, DP-24, DP-25, DP-26, DP-27, DP-28, DP-30, DP-31, DP-32, DP-34, DP-35, DP-36, DP-37, DP-38, DP-39, DP-40, DP-41, DP-42, DP-43, DP-44, DP-45, DP-46, DP-47, DP-48, DP-49, DP-50, DP-51, DP-52, DP-53)

**Time.** The device clock may be wrong. Server decisions never read the browser clock. Where something is upcoming, open, ended or closed, the browser renders the server's status and never recomputes it. Pushed changes reach the page when they happen; a due item in a world on real time is processed within 2 seconds. The vote and gathering statuses returned by the API are always correct for the world's clock at the moment of the read.

**Accounts**
- A new email gets the confirmation mail. A known email gets no account change and no mail.
- Sign-up validation, 422: `Enter a valid email address.`, `Passwords need at least 10 characters.`, `Give a display name of 1 to 40 characters.`, `Choose a time zone from the list.`
- Wrong password, unknown email, unconfirmed account and suspended account all answer the identical `401 {"error":"Email or password is wrong."}`.
- A used or unknown confirmation token answers 404.

**Friend invites**
- The link lives `INVITE_TTL_SECONDS` from sending by the world's clock: alive at the lifetime minus 1 second, dead at exactly the lifetime. For example, at the default, sent 2027-03-01T12:00:00Z is alive at 2027-03-08T11:59:59Z and dead at 2027-03-08T12:00:00Z.
- It is single use. Accepting makes the pair friends and a second use is dead.
- A dead, used, revoked or unknown link answers 404 on the API, and all look identical on the page.
- Accepting your own invite, accepting from another world, or accepting with a block between the pair also answers 404.
- Friend-invite validation, 422: `Enter a valid email address.`

**The tile grid**
- A room is a grid of 1-metre tiles from (0,0) at the north-west corner; x grows east and y grows south.
- A layout is JSON shaped as in the setup example. Width and height are each 4 to 40.
- Every spawn, wall, seat and exit lies inside the grid, no two share a tile, spawn holds at least one tile, and seat and exit ids are unique.
- A joiner lands on the first free spawn tile in list order, or if none is free on the first free tile scanning from the north row, west to east, facing south.

**Stepping**
- A standing person not facing the pressed direction only turns, with `result` `turned`.
- A standing person already facing it steps, with `result` `moved`. For example, at (2,2) facing north, east turns; east again moves to (3,2).
- Stepping onto an exit tile leaves the session, with `result` `left`, and the page lands on `/sessions`. An exit tile never holds anyone.
- A seated person can neither turn nor step: every direction press, facing that way or not, gets the seated refusal below and leaves their facing as it was.
- A refused step changes nothing and answers 409, checked in this order: while seated `Stand up to move.`; edge or wall `A wall blocks that way.`; seat `A seat blocks that way.`; person `Someone is standing there.`
- A bad direction answers `422 {"error":"Choose north, east, south or west."}`.
- Two people stepping onto one tile resolve by server order through Valkey: exactly one moves, and the other gets the person refusal and stays, on any instance. Every step off a tile frees it.
- A step or turn less than `STEP_MIN_INTERVAL_MS` after your last accepted step or turn, by the world's clock, answers `429 {"error":"Slow down a little."}`. The pacing check applies only to a press that would turn or move: every 409 above comes first under the error order, so a seated press never answers 429, and refused presses do not restart the interval.

**Sitting**
- Sit is allowed on the seat straight ahead of your facing, one tile away. You then occupy the seat's tile, seated, and the tile you left is free.
- Sit refusals, 409: `No seat in front of you.`, `That seat is taken.`, `You are already seated.`
- Stand puts you on the tile you sat from, or if that is occupied, the first free neighbour of the seat in north, east, south, west order.
- Stand refusals, 409: `No space to stand.`, `You are not seated.`

**Proximity chat**
- Distance is Chebyshev, the larger of the x gap and the y gap, and reach is 6 tiles inclusive. Walls do not stop sound.
- Recipients are decided by the server at send time, per recipient: within reach, no block between the pair, no mute of the speaker by the recipient. Having an open socket does not matter.
- `heardBy` excludes the speaker. Worked distances, speaker at (5,5):

| Other person | Distance | Hears |
|---|---|---|
| (11,5) | 6 | yes |
| (12,5) | 7 | no |
| (11,11) | 6 | yes |
| (12,11) | 7 | no |
| (5,0) | 5 | yes |

- A message reaches nobody else, in the API or in any socket frame. Walking into range later never reveals earlier messages.
- Length is 1 to `CHAT_MAX_CHARS` user-perceived characters, and an emoji, including a joined family emoji, counts as 1. At the limit is allowed.
- Over the limit answers `422 {"error":"Messages can be at most <CHAT_MAX_CHARS> characters."}`, for example `Messages can be at most 300 characters.` at the default.
- Empty or whitespace-only answers `422 {"error":"Write something to send."}`.

**Sessions.** A session is `open` until it ends, and an ended session answers 404 on every route. Visibility, where "may" means both see and join:

| Viewer | `public` | `friends` | `community` | `invite` |
|---|---|---|---|---|
| Any person in the world | may | no | no | no |
| The host's friend | may | may | no | no |
| Member of the session's community | may | no | may | no |
| Person the host invited | may | no | no | may |
| Person with a block with the host, either direction, whatever else they are | may | no | no | no |
| Person removed from this session by a vote | no | no | no | no |
| Person in another world | no | no | no | no |

"The host" means the current host. Someone already inside when a block is made stays inside.

- A session someone may not join answers 404 and never appears in `GET /api/sessions`, its `total`, search, `list "Friends' sessions"`, friend presence or any count or capacity figure they can read.
- Capacity is 1 to `SESSION_CAPACITY_MAX`, both allowed, and counts distinct people including the host. A person with two tabs counts once.
- At capacity, a person who may see the session gets `409 {"error":"This session is full."}`. Exactly one of any number of concurrent joiners takes the last place, across instances.
- Opening validation, 422: `Capacity must be between 1 and <SESSION_CAPACITY_MAX>.`, `Choose public, friends, community or invite.`, `Choose a community for this session.`
- A room with no published version, or a community where the caller is not an owner or steward, answers 404.
- When the host leaves, the person in the session longest becomes host, ties by id. A session ends when its last person leaves.
- An outage never removes anyone. A person with all sockets lost leaves the session `DROP_GRACE_SECONDS` later, and a reload inside the grace keeps their tile. Two tabs count once and closing one changes nothing. If a person's instance cannot reach Valkey, the grace starts again when it can.

**Presence**
- States are `online` (at least one open socket), `in-session` (inside a session) and `offline`, seen only by friends with no block between them.
- A person placed by setup reads `in-session` with no socket.
- A person whose sockets are all gone reads `offline` after `DROP_GRACE_SECONDS`.
- `in-session` shows the session and `button "Join <name>"` only if the viewer may join it. Otherwise that friend reads `online` and `session` is null.

**Uploads.** Form fields are checked first, 422: `Choose room or avatar.`, `Give the model a name of 1 to 80 characters.`, `Choose a file to upload.`, `This room layout is not valid.` Then the file is judged by its content, never by its name or declared type, in this order:

1. Bytes not starting with the `glTF` magic: `This file is not a GLB model.` (422)
2. Version not 2, stated length not the real length, a broken or missing JSON chunk, or an embedded image that is not a readable PNG or JPEG: `This GLB file is damaged.` (422)
3. Any `uri` in `buffers` or `images`: `This GLB refers to files outside itself.` (422)
4. Above the top rank for its kind: `This model is over the Granite limit for <measure>.`, first failing in the order triangles, materials, texture size, file size (422, or 413 for file size).

**Measures**
- Triangles: over all mesh primitives per referencing node, so a mesh used by two nodes counts twice and an unreferenced mesh counts 0. Use the index count, or the position count if there is no index, divided by 3 for triangle lists, or minus 2 for strips and fans; points and lines count 0.
- Materials: entries in `materials`.
- Texture size: the largest width or height of any embedded image, read from its PNG or JPEG header, or 0 with none.
- File size: bytes of the file.

**Ranks.** Each limit is inclusive. The rank is computed once at upload and stored with the version, and is never recalculated.

| Rank | Avatar triangles | Avatar materials | Avatar texture px | Avatar bytes | Room triangles | Room materials | Room texture px | Room bytes |
|---|---|---|---|---|---|---|---|---|
| Feather | 5,000 | 2 | 512 | 1,000,000 | 20,000 | 8 | 1024 | 4,000,000 |
| Linen | 15,000 | 4 | 1024 | 4,000,000 | 60,000 | 16 | 2048 | 12,000,000 |
| Cedar | 40,000 | 8 | 2048 | 10,000,000 | 150,000 | 32 | 4096 | 30,000,000 |
| Granite | 100,000 | 16 | 4096 | 20,000,000 | 400,000 | 64 | 8192 | 50,000,000 |

Each measure gets its own rank. The worst measure sets the file's rank, and a tie for worst names the earlier in the order triangles, materials, texture size, file size. So an all-Feather file reads worst `triangles`. Worked avatars: 5,000 triangles, 2 materials, 512 px, 900,000 bytes is Feather; 5,001 triangles and otherwise Feather is Linen with worst `triangles`; 100 triangles and 5 materials is Cedar with worst `materials`.

**Versions.** Legal moves are `checked` to `published`, and `checked` or `published` to `removed`. Numbers grow from 1 and are never reused.
- An upload is `checked`. Publishing makes it the asset's current published version. Publishing a version already published answers `409 {"error":"This version is already published."}`.
- People already inside a session keep their room version until they rejoin; new joiners get the current one. A reload is not a rejoin.
- Each person walks on the layout of their own version; other people still block. Worked example: (3,3) is a wall in v2 but not v1. Someone on v1 steps onto it; someone on v2 is refused with the wall text; someone standing there blocks both.
- Restore publishes a new version with the old bytes, stored rank and layout, so restoring v1 when v2 is current gives v3.
- Removal removes the object from MinIO. File and record answer 404 everywhere and the version leaves every list and history.
- Removing a version anyone in an open session is on answers `409 {"error":"This version is in use by an open session."}`.
- Removing the current version makes the highest remaining published version current. Removing the only published version is the same as removing the asset: every version and object goes, and the asset answers 404.
- Someone wearing a removed avatar has `data-avatar="fallback"` until they choose another.

**Safety effects.** All apply at once in live sessions with no reload, and persist. Blocking or muting yourself answers `422 {"error":"You cannot do that to yourself."}`.

| Effect | Who is affected | What changes |
|---|---|---|
| Block, made by either side, both directions alike | Both people | Each one's mirror entry for the other stays because the tile stays occupied, with `data-avatar="fallback"` and `data-display-name="Someone"`. No chat either way and not counted in `heardBy`. Absent from each other's friend list and presence, restored on unblock. Named as `Someone` in announcements. A blocked person may still report. |
| Mute | Only the muter | The muter receives none of the muted person's chat and they are not counted in `heardBy`. The muted person's mirror and chat view are unchanged and they may still hear the muter. Presence is unchanged. |
| Hide above rank | Only the viewer | Other people's avatars ranked heavier than the setting, in the order Feather, Linen, Cedar, Granite, show `data-avatar="hidden"`. Name, tile and chat are unchanged. Your own avatar is never hidden. |

Avatar state precedence: `fallback`, then `hidden`, then `shown`. Someone with no avatar shows `fallback`.

**Removal votes.** Legal moves are `open` to `passed` or `failed`.
- Anyone in the session may start one against someone else in it. A target not in the session answers 404. A vote against yourself answers `422 {"error":"You cannot start a vote about yourself."}`.
- The starter's yes counts. Eligible voters are the people in the session at the start, less the target. Joiners afterwards cannot vote, and neither can the target: `409 {"error":"You cannot vote on this."}`.
- It needs at least 2 eligible, else `409 {"error":"Too few people to vote."}`.
- One open vote per target, else `409 {"error":"A vote on this person is already open."}`.
- Threshold is 60% of eligible, rounded up:

| Eligible | 2 | 3 | 4 | 5 | 6 | 7 | 10 |
|---|---|---|---|---|---|---|---|
| Yes votes needed | 2 | 2 | 3 | 3 | 4 | 5 | 6 |

- The window is `VOTE_WINDOW_SECONDS` from the start by the world's clock. Votes at the window minus 1 second count. At exactly the window it is closed: `409 {"error":"This vote has closed."}`.
- One vote per person: `409 {"error":"You have already voted."}`. A bad choice answers `422 {"error":"Choose yes or no."}`.
- A vote passes the moment it reaches the threshold, and fails only when the window closes short of it. It stays open if the target leaves.
- Passing removes the person at once and they cannot rejoin that session. It leaves their lists and answers 404. Notices are in Feedback states.

**Reports**
- Category is `harassment`, `hateful-content`, `impersonation` or `other`; details are 1 to 1000 characters.
- Validation, 422: `Choose a category.`, `Write 1 to 1000 characters.`, `You cannot report yourself.`
- The reported person must be someone in the world and the reporter must be in, or have been in, that session; otherwise 404.
- A report never reveals who filed it, to anyone, Moderators included: no filer field in any response, page or mail.
- Only `siteRole` `moderator` reads and moves reports; anyone else gets 404.
- Legal moves are `open` to `reviewing`, and `reviewing` to `upheld` or `dismissed`. Any other move answers `409 {"error":"This report cannot move that way."}`.
- `upheld` without a valid `action` answers `422 {"error":"Choose warn or suspend."}`. An unknown state answers `422 {"error":"Choose a valid state."}`.
- `suspend` takes effect at once: the person leaves every live session, others read their departure, on their next server message they read the removal notice, their next API request answers 401, and sign-in then answers the wrong-password text.
- `warn` shows its notice and nothing ends.

**Communities**
- Roles are `owner`, `steward` and `member`. Owners change roles and remove members. Stewards schedule gatherings, open community sessions and remove members. Members attend.
- Actions barred to a role answer 404.
- A change that would leave no owner answers `409 {"error":"A community needs an owner."}`. A bad role answers `422 {"error":"Choose owner, steward or member."}`.
- A demotion applies on the next request, mid-session. `button "Schedule gathering"` disappears on the pushed event, and the API then answers 404 for that action.
- A person removed from a community leaves its community sessions at once and reads the notice in Feedback states.
- Another community's ids, including ids in a body or nested path, answer 404.
- Community validation, 422: `Give the community a name of 1 to 80 characters.`, `Choose a time zone from the list.`

`GET /api/communities/<id>/members` returns exactly these keys by the caller's role:

| Caller's role | Keys of each member |
|---|---|
| `member` | `personId`, `displayName`, `role` |
| `steward` | `personId`, `displayName`, `role`, `joinedAt` |
| `owner` | `personId`, `displayName`, `role`, `joinedAt`, `email` |

**Gathering times.** `startsLocal` looks like `2027-03-07T19:00` and is stored in the community's IANA zone. Allowed zones and abbreviations, which the app prints itself rather than taking them from platform output:

| Zone | Abbreviations |
|---|---|
| `America/New_York` | EST, EDT |
| `America/Los_Angeles` | PST, PDT |
| `Europe/London` | GMT, BST |
| `Europe/Berlin` | CET, CEST |
| `Asia/Kolkata` | IST |
| `Asia/Tokyo` | JST |
| `Australia/Sydney` | AEST, AEDT |

Display, in each member's own zone and with plain spaces: `Sun 7 Mar 2027, 7:00 PM EST`.

- A local time that does not exist moves forward by the gap: 02:30 on 2027-03-14 in New York is 03:30 EDT. That occurrence's `note` is `This time doesn't exist that day, so it moves forward.`
- A repeated one means the first occurrence: 01:30 on 2027-11-07 in New York is 01:30 EDT. That occurrence's `note` is `This time happens twice that day. This is the first.`
- Weekly keeps the community's wall clock, applying these rules per occurrence.

Worked example, weekly Sunday 19:00 New York:

| Occurrence | Seen from London | Seen from New York |
|---|---|---|
| 2027-03-07 | `Mon 8 Mar 2027, 12:00 AM GMT` | `Sun 7 Mar 2027, 7:00 PM EST` |
| 2027-03-14 | `Sun 14 Mar 2027, 11:00 PM GMT` | `Sun 14 Mar 2027, 7:00 PM EDT` |
| 2027-03-28 | `Mon 29 Mar 2027, 12:00 AM BST` | `Sun 28 Mar 2027, 7:00 PM EDT` |

Gathering validation, 422: `Give the gathering a title of 1 to 120 characters.`, `Enter the start as a local date and time.`, `Duration must be 15 to 480 minutes.`, `Choose none or weekly.`, `Limit must be 1 to 500.`

**Gathering status**, from the world's clock: `upcoming` until 15 minutes before the start; `open` from exactly 15 minutes before the start until the end; `ended` from exactly the end, which is the start plus `durationMinutes` in elapsed time. A weekly gathering never ends as a whole. Attending covers every occurrence and counts against `limit`:
- At the limit, `409 {"error":"This gathering is full."}`, and exactly one of concurrent attendees takes the last place.
- Once a `none` gathering has ended, `409 {"error":"This gathering has ended."}`.

**Reminders.** Each person attending when an occurrence falls due gets one reminder for it, exactly once across all instances, at `REMINDER_LEAD_MINUTES` before the occurrence, inclusive. Nothing goes one second earlier. An occurrence that has already started when first seen as due sends nothing. Mail contents are in Services.

### Services (DP-07, DP-15, DP-16, DP-27, DP-28, DP-33, DP-36, DP-52, DP-53, DP-55, DP-56)

**Postgres.** Accounts, friendships, blocks, mutes, communities and roles, gatherings, rooms, avatars, versions with their published ranks, session records and membership, votes, reports, moderator decisions, world clocks and the mail outbox. All of it survives reload. The schema is applied idempotently on serve, safely from several instances starting together.

**MinIO.** Files are stored byte for byte at `assets/<assetId>/v<version>.glb`, and nothing is added, normalised or stripped. A version row exists only after its object is stored.

When MinIO is unreachable:
- An upload or restore that passed its checks answers `503 {"error":"File storage is unavailable. Nothing was saved."}`, with the same text in `alert`, and leaves no version row and no object.
- Removal answers the same 503 and changes nothing.
- A file read answers `503 {"error":"File storage is unavailable."}`.
- A room view that cannot load its GLB still shows its tile floor from the layout and plain paper avatars.

**Mailpit.** From is env `MAIL_FROM`. Mail goes through `SMTP_HOST` and `SMTP_PORT` from an outbox, retried until the server accepts it, so a slow mail server never fails a request. Links are absolute, built from `APP_PUBLIC_URL` when set, and otherwise from the request origin; the paths below are exact.

| Mail | To | Subject | Content |
|---|---|---|---|
| Confirmation | The new email | `Confirm your Hearthtile account` | Link `/confirm/<token>` |
| Friend invite | The invited email | `<displayName> invited you to Hearthtile` | Link `/invites/<token>` |
| Reminder | Each attending person | `Starting soon: <title>` | Body line `<title> starts <display in that member's zone>.` and link `/gatherings/<id>` |

**Valkey.** Live presence, positions, session events and tile and place claims, shared between instances. Published keys:

| Key | Type | Content |
|---|---|---|
| `presence:<personId>` | Key | Exists while the person is online or in a session |
| `session:<sessionId>:positions` | Hash | One field per person id, holding their tile and facing |
| `session:<sessionId>:events` | Channel | Session events crossing instances |

Tile claims and last-place claims are decided atomically in Valkey. A person on any instance sees everyone in the session.

When Valkey is unreachable on an instance:
- Opening or joining a session, and every live command (step, sit, stand, chat, vote), answers `503 {"error":"Live rooms are unavailable right now."}`, with that text in `alert` on the page and nothing half-saved.
- Sign-in, community pages, session lists and studio pages keep working. Friends read `offline` there.
- A page in a session keeps its last mirror, shows the text in `alert`, and retries the socket every 2 seconds of page clock.
- When Valkey returns, the page restores the mirror from the server without reload, clears the alert and announces the restored text from Feedback states. Recovery needs no restart.

### Seed data (DP-08)

Every seeded person and place is invented. Seed is applied once at first start, only when all services are reachable, and never partly. It lives in the `default` world and its GLB models are original and generated by the app.

**People**

| Display name | Email | Password | Zone | Site role | Avatar |
|---|---|---|---|---|---|
| Wren Okafor | `wren@hearthtile.example` | `lantern-wren-01` | `America/New_York` | `member` | Paper Fox |
| Tomas Vale | `tomas@hearthtile.example` | `lantern-tomas-02` | `Europe/London` | `member` | Tin Heron |
| Imke Dorn | `imke@hearthtile.example` | `lantern-imke-03` | `Europe/Berlin` | `member` | Moss Walker |
| Priya Nand | `priya@hearthtile.example` | `lantern-priya-04` | `Asia/Kolkata` | `moderator` | None |

Wren Okafor and Tomas Vale are friends.

**Assets**, all owned by Wren Okafor, each with one published version: rooms `Quilt Loft` (Feather) and `Reading Porch` (Feather); avatars `Paper Fox` (Feather), `Tin Heron` (Linen) and `Moss Walker` (Cedar).

Quilt Loft layout: `{"width":12,"height":12,"spawn":[{"x":1,"y":1},{"x":2,"y":1},{"x":3,"y":1}],"walls":[{"x":3,"y":3},{"x":8,"y":8}],"seats":[{"id":"seat-1","x":5,"y":2}],"exits":[{"id":"exit-1","x":0,"y":6}]}`.

Reading Porch layout: `{"width":8,"height":8,"spawn":[{"x":1,"y":1}],"walls":[{"x":4,"y":4}],"seats":[{"id":"seat-1","x":6,"y":2}],"exits":[{"id":"exit-1","x":7,"y":6}]}`.

**Community** `Thursday Stitchers`, zone `America/New_York`: Wren Okafor is `owner`, Tomas Vale is `steward`, Imke Dorn is `member`.

**Gathering** `Thursday Stitch-In`: weekly from `2027-03-04T19:00`, 90 minutes, limit 30, with Wren Okafor and Imke Dorn attending.

**Session**: one open `public` session of Quilt Loft hosted by Wren Okafor, capacity 12, with Wren Okafor at (2,2) facing south, Tomas Vale at (4,3) facing west and Imke Dorn at (6,5) facing north. They are placed with no socket.

## Technical requirements

### Deployment (DP-01, DP-04)

The app is TypeScript on a current long-term-support Node.js with npm. `/app/run.json` holds string `install`, `build` and `serve`, and `"_schema":"run-manifest-v1"`. For example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
```

Serve binds `0.0.0.0` on port 4173, honouring `APP_PUBLIC_PORT` when set. Two or more instances share the same services, and two people may be connected to different instances. Grading runs the primary with `STEP_MIN_INTERVAL_MS` 0, so tests are not limited by their own speed. It also runs these extra instances:

| Instance | Environment | URL env var | Purpose |
|---|---|---|---|
| `second-instance` | `INSTANCE_NAME=b` | `APP_SECOND_URL` | Healthy, same services, for two-instance checks |
| `short-timers` | `STEP_MIN_INTERVAL_MS=2000`, `DROP_GRACE_SECONDS=2` | `APP_TIMERS_URL` | Healthy, same services, for pacing and grace checks |
| `minio-down` | `S3_ENDPOINT=http://127.0.0.1:9` | `APP_MINIO_DOWN_URL` | MinIO unreachable |
| `valkey-down` | `VALKEY_URL=redis://127.0.0.1:9` | `APP_VALKEY_DOWN_URL` | Valkey unreachable |

### Configuration and secrets (DP-04, DP-60)

All of these are read at start from the environment. None is hard-coded or sent to the browser.

**Service settings:**
- `DATABASE_URL`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `SMTP_HOST`, `SMTP_PORT`, `MAILPIT_URL`, `MAIL_FROM`
- `VALKEY_URL`
- `GRADING_KEY`
- `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`
- `INSTANCE_NAME`, default `a`, which only labels the instance in logs

`MAIL_FROM` at grading is `Hearthtile <hello@hearthtile.example>`.

**Timers and limits:**

| Variable | Default | Unit |
|---|---|---|
| `STEP_MIN_INTERVAL_MS` | 200 | milliseconds |
| `DROP_GRACE_SECONDS` | 30 | seconds |
| `VOTE_WINDOW_SECONDS` | 60 | seconds |
| `INVITE_TTL_SECONDS` | 604800 | seconds |
| `REMINDER_LEAD_MINUTES` | 60 | minutes |
| `CHAT_MAX_CHARS` | 300 | user-perceived characters |
| `SESSION_CAPACITY_MAX` | 50 | people |

### Server boundary (DP-06, DP-33)

- **Same origin.** The app calls only its own origin from the browser and loads no outside scripts, fonts or models. A state-changing request or WebSocket upgrade whose `Origin` header names another host answers `403 {"error":"Cross-origin requests are refused."}`, checked before everything else. A request with no `Origin` header is allowed.
- **Size limits.** A JSON body may be up to 64,000 bytes inclusive, except the setup route's limit in API; larger answers `413 {"error":"That request is too large."}`. A multipart upload request may be up to 51,000,000 bytes inclusive; larger answers 413 with the file-size text from Business rules.
- **Bad bodies.** A body that is not JSON where JSON is required answers `422 {"error":"Send a JSON body."}`.
- **Never served.** Source files, `run.json`, package manifests, dependency folders, dotfiles, credentials and any path escaping the public assets answer the 404 for that path. Model files are reachable only through the file route, and the uploaded file name never becomes part of a storage key.
- **Unreachable at boot.** The server starts and serves even if MinIO or Valkey is unreachable, answers health as API states, and reconnects by itself with no restart. It keeps retrying Postgres at boot until it is reachable.

### Browser support and performance (DP-09, DP-15, DP-58)

The app covers current Chromium, Firefox and WebKit, at 375x812, 768x1024 and 1280x800. A room page is usable, with its mirror and controls working, within three seconds of opening, including on a software WebGL renderer. A move appears in another person's mirror within one second across instances.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` names every shipped package with its licence, where shipped packages means the production dependency tree (`npm ls --omit=dev --all --json`, or the lockfile's non-dev group).
- IF-03: Every shipped package, meaning the production dependency tree as in IF-02, has a licence among MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC or 0BSD.
- IF-04: The app uses only Postgres, MinIO, Mailpit and Valkey for storage and messaging, with no other datastore, broker or lasting local file state.
- IF-05: The application source is TypeScript.
- IF-06: Models, fonts and other assets the app ships are original or generated by the app, and nothing is fetched from outside at run time.
- IF-07: The development service definitions you are given stay untouched.

## Engineering standards

- The code is idiomatic TypeScript with strict type checking on, and its names match the domain terms in this brief: tile, facing, session, version, rank, measure, earshot, gathering, occurrence.
- Each domain rule, such as a rank computation, a chat recipient decision, a state transition, a vote threshold or a gathering status, is decided in exactly one place in the source.
- There is no abstraction with a single implementation unless a test seam in this brief requires it.
- There is no dead, commented-out or unreachable code.
- There are no defensive checks for impossible states.
- Every refusal goes through one consistent error shape.
- There are no features beyond this brief.
- Browser code renders the server's published status and never recomputes a server decision.
