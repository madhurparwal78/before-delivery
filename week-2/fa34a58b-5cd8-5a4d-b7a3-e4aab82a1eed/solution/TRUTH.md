# TRUTH — Gablework Nightplan (golden)

Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys: ideal end-to-end flow

### 1. Read the evening plan (DP-10)
- Start: seed data, laptop 1280x800, `/plan` (brief: Journeys 1). The plan opens on the hub's today at the
  hub's current minute from `GET /api/status`; the address is rewritten to `/plan?day=YYYY-MM-DD&at=HH:MM±HH:MM`
  (brief: Interactions, Opening the plan).
- Arrow keys step 15 min, PageUp/PageDown 60 min, Home 00:00, End 24:00 (brief: Scrubber keys). Each step
  updates the slider value, the 'At this time' list and the "Plan time" status at once; rooms whose scene
  differs fill one by one in plan order (Hall, Kitchen, Living, Study, Main bedroom, Nursery, Spare room, Bath,
  Porch), first at once, then +40 ms each, 240 ms fills; each legend count steps by one when a fill lands
  (brief: Plan sweep).
- Drag back to 19:30: pointer press jumps, drag snaps to 5 min; on release the address is replaced
  (`history.replaceState`, no new entry) (brief: Address, Scrubber pointer).
- Copy the address to a new tab: same day, time, fills, legend, lists (brief: DP-03). Provider: nothing written.

### 2. Wall tablet, clock 47 min fast, another zone (DP-21)
- Hub time "Hub time HH:MM CST", now marker "Now HH:MM", slider opening value and every room's "Now: <Scene>"
  come only from status messages; the browser clock is never read for them (brief: Business rules, server decides time).
- Kitchen → inspector sheet (768x1024: right sheet 320 px). Details for Kitchen lights → device sheet; Power off
  → `PUT /api/devices/kitchen-lights/state {"on":false}`; Escape; inspector switch on while the sheet is still
  closing (closing sheets stop blocking at once) → `{"on":true}`. Server ends on, revision +2; "Device updates"
  reads "Kitchen lights: on at <brightness>%" (brief: Feedback states, Live regions).
- Simulated thermostat report → "Living thermostat: set to <sp>°F, reading <cur>°F".

### 3. Fall-back night, Sunday 1 November 2026 (DP-26)
- Plan spans 25 hours; aria-valuemax 1500; hour labels "01 CDT" then "01 CST"; day line
  "Sunday 1 November 2026 · 25 hours" (brief: Screens, Scrubber keys).
- 'Night low' (01:30) owns all rooms from 01:30 CDT through the second pass; at 01:30 CST the address reads
  `at=01:30-06:00`, the list reads "Hall · Night low · since 01:30 CDT", Plan time "At 01:30 CST, 9 rooms in Night low"
  (brief: Slot occurrence on change days, `<since>`).
- Runs: exactly one Weekend 01:30 run, `ran_at` at -05:00; Day log lists "01:30 Night low · 9 rooms · Weekend".

### 4. Move the weekday wake-up (DP-33)
- Phone, Schedules → Weekday → Edit Weekday schedule; editor loads the version in force today, From = hub today.
- Slot 06:40 → 06:10, From 2026-11-09, Save: "Saving schedule…" then
  "Saved. Weekday slots change from Monday 9 November 2026." (brief: Schedule editor).
- Provider: new `schedule_versions` row (weekday, 2026-11-09), revision +1. Friday 6 Nov still 06:40; Monday 9 Nov 06:10.
- At 05:00:00 on 9 Nov (or a clock move past it) one `schedule_change` notice: subject
  "Schedule change takes effect: Weekday", body "From Monday 9 November 2026, the Weekday schedule runs these slots:"
  + one line per slot "HH:MM Scene — rooms"; sent once to household@alder-lane.test (brief: Notices and "today").

### 5. Two adults edit the weekend at once (DP-34, DP-35)
- Both editors carry the revision read; the first save wins (one conditional `UPDATE … WHERE revision = $read`
  in a transaction), the other gets 409 `schedule_changed`: alert "Someone else changed this schedule. Reload it to
  see their change." + Reload schedule, which loads the winner's slots and removes the alert. Open plans refetch
  on the `schedule` socket message without moving the scrubber.

### 6. Visitor in the spare room (DP-42)
- Guests → New guest scene: Room Spare room, Scene Guest welcome, Starts empty (now), Ends next day 11:00 →
  "Guest scene set for Spare room until 11:00 on <long date>." Row "Spare room · Guest welcome · Active · until 11:00 <long date>".
- No browser needed: the engine (250 ms ticks) ends it at 11:00:00 (ended_at ≤ +1 s), status at 11:00:00 shows the
  scheduled scene, socket pushes `guest_scene` and `status`; notice "Guest scene ended: Spare room" /
  "The guest scene Guest welcome in Spare room ended at 11:00 on <long date>. Spare room is back on <scheduled scene>."

### 7. Porch clip (DP-47)
- Camera announces (state announced) → Day log row "Porch camera HH:MM:SS" with "Storing clip…", Play disabled.
- Bytes arrive → stored in MinIO at `clips/porch-camera/<day>/<id>.mp4` (video/mp4), HEAD size = declared →
  state stored; row and open sheet show "<size> bytes" and Play enables in place; one "Motion on Porch camera" mail.
- Size mismatch → object deleted, state size_mismatch, "Clip incomplete. Not saved.", 422 with stored vs declared.

### 8. Keyboard only (DP-38)
- New scene sheet: focus moves to its first control (Close); Tab/Shift+Tab wrap; Escape returns focus to
  "New scene". Schedule editor: Add slot, Time, Scene (select), room checkboxes, Save. Plan: Tab to "Time of day",
  keys. Day log: clip row button → clip sheet, trap, Escape back to the row.

## Palette (decided values that satisfy brief: Visual design)

| Role | Hex | Source |
|---|---|---|
| ground | #0A1222 | brief: near-black navy; decided hex |
| grid | #56CCF2 at 7.5 % (8 px) + 5 % (64 px) | brief: faint ~8 px grid, barely visible cyan |
| line (outlines, control edges, slider track) | #3FC1E0 (8.8:1) | brief: thin cyan lines, 3:1 boundaries |
| hairline (separators) | #2A6A80 (3.1:1) | decided: quieter structure lines |
| focus / selected | #9BEBFF | brief: brighter cyan, never warm |
| ink / ink-2 | #E4EEF9 (15.9:1) / #9DB1C9 (8.5:1) | brief: pale blue-white ink |
| coral (alerts only) | #FF7A6B | brief: Alert |
| Candle / Honey / Amber / Rose / Dusk / Ember | #F4E4B8 / #E9C46A / #FFB22E / #E69C86 / #A07C4C / #B9541F | brief: Lamp (pale → deep, Ember darker and browner than coral) |
| room fills | tint 40 % over ground (Candle 48 %) | decided: keeps room labels ≥ 4.5:1 |

## Type
Space Grotesk 600 headings/brand/room labels; IBM Plex Sans 400/500/600 body; JetBrains Mono 400/500 with
tabular-nums for every numeral (hub time, counts, times, bytes, temperatures, dates); scale 16 → 19.2 → 23 → 27.6
(brief: Type, "a fifth larger"). Fonts self-hosted woff2 (Fontsource 5.3.0, OFL-1.1).

## Space and layout per viewport (brief: Screens and layout)

| Viewport | Layout |
|---|---|
| 1280x800 | rail 240 px fixed column; main; inspector 320 px complementary column (Hall at first load); floor plan + scrubber inside 800 px; 'At this time' and Rooms side by side |
| 768x1024 | full-width main; rail drawer from the left (dialog "Menu"); inspector right sheet 320 px; lists side by side |
| 375x812 | one column: plan, scrubber, list, rooms; plan and slider inside 812 px; drawer from the left; every sheet rises from the bottom |

Breakpoints (decided): desktop ≥ 1024 px, tablet 600–1023 px, phone < 600 px; only these three layouts.

## Motion table

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| room fill | scrubber change, room changed | 240 ms, stagger 40 ms in plan order | cubic-bezier(0.16,1,0.3,1) | same frame, no stagger |
| room accessible name | fill start | instant | — | same frame |
| legend count | fill lands | one step per room | — | same frame |
| sheets / drawer | open, close | 320 ms: a 16 px slide from the sheet's edge (right; bottom at 375x812; left for the drawer) with a fade | cubic-bezier(0.16,1,0.3,1) | at once |
| backdrop | with sheet | 320 ms opacity | same | at once |
| hover/press outline | pointer | 90 ms | ease-out | none |
| row pulse | socket change | 300 ms outline | ease-out | dropped |
Nothing moves while idle (brief: Banned).

## States per async action (brief: Feedback states)

| Action | Pending | Success | Error |
|---|---|---|---|
| device switch | switch flips + "Sending…" | "Sending…" gone; socket announces | switch back to server state + inline alert "<Device> is offline. Nothing was changed." |
| schedule save | "Saving schedule…" | "Saved. <Schedule> slots change from <long date>." | "Check the highlighted fields." + field messages; conflict alert + Reload schedule |
| scene save | "Creating scene…" / "Saving scene…" | "Scene created. Add it to a schedule slot to give it rooms." / "Scene saved." | field messages beside fields |
| guest scene | "Starting guest scene…" | "Guest scene set for <Room> until <HH:MM> on <long date>." | overlap alert / field messages |
| guest cancel | "Cancelling…" | "Guest scene cancelled for <Room>." | alert "This guest scene has already ended." |
| clip | "Storing clip…" (Play disabled) | "<stored size> bytes" (Play enabled) | "Clip incomplete. Not saved."; media while storage down: "The clip can't be loaded while clip storage is unreachable." |
| no HTTP answer | — | — | alert "Nightplan can't reach the hub. Your last change was not saved." |
| storage down | every page alert "Clip storage is unreachable. New clips wait as 'Storing clip…' until it is back." | | |
| mail down | Notices "Mail" status "Mail is unreachable. Notices are queued and each will be sent once when it is back." | | |

## Decisions where the brief is silent
- Guest scenes count for owners only while `scheduled`/`active` with `starts_at <= t < ends_at` (decided: brief Room owner 1 + Guest scene end).
- `start_owners` are the owners just before midnight; changes at midnight appear in `changes` (decided: keeps owners_at consistent).
- A null `starts_at` starts at the current minute (decided: guest times are "to the minute").
- Idempotency keys expire 24 h after first use by the server's real clock (decided: the hub clock jumps; keys are transport).
- A run item always reads "<count> rooms", so a one-room run reads "1 rooms"; the "1 room" form is only for the Plan time copy (brief: Public screens and controls, Day log run item; Live regions, Plan time).
- The inspector's "Now: <Scene> since <since>" formats `<since>` relative to the plan day, like every `<since>`: "HH:MM" when the owning change falls on the plan day, otherwise "Ddd HH:MM", plus " <abbr>" inside a repeated hour (brief: Public screens and controls, `<since>`).
- Device revisions bump only when a scene actually changes a device's state (decided: "each changed device").
- Sheets slide 16 px rather than their full width (decided: a closed sheet's controls must be reachable from the first frame of its 320 ms opening; the slide still enters from the published edge).
- The server writes the plan's full address into the page it serves for `/plan` and the browser puts it in the address bar before the page finishes loading (decided: "In every case the address is then rewritten to the full form", with no extra history entry and `GET /plan` answering 200).
- Mail retries are paced per hub instance (every 5 s after a refusal) and each pass tries every queued notice once (decided: two instances on one outbox must not delay each other; claims stay FOR UPDATE SKIP LOCKED).
- `ran_at` for a run is the tick that passed the occurrence (≤ 250 ms after it); runs list under the household day of `ran_at` (brief: Runs).

## Media and licences
Fonts: Space Grotesk, IBM Plex Sans, JetBrains Mono (OFL-1.1, Fontsource 5.3.0). Icons: Lucide 1.66.0 path data
inlined (ISC). `public/icon.svg`: original. No photos, video or other media are bundled (brief: Icons; clips come
from the simulated camera).
