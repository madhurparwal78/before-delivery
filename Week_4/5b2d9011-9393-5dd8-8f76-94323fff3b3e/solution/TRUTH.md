# TRUTH — Holdfast Nights golden

Every value says where it came from: `brief: <section>` (copied from `instruction.md`) or `decided: <why>` (the brief is silent).

## Journeys (ideal end-to-end flows)

1. **Founder schedules the month** (brief: Journeys 1). Start: title screen, no session. Callsign → type a callsign and the studio key → `Save callsign`; notice `Studio key accepted — founder tools unlocked.` Nights → `New weekly night` → Title, Mode Siege, Weekday Friday, Start time `20:00`, First date `YYYY-MM-DD` (a Friday after today, studio time), Weeks 8, Capacity → `Schedule nights`; notice `Scheduled 8 nights of <title>.` The Nights list groups nights under studio-date headings and every Friday shows `20:00 CST|CDT studio`, including the weeks after the daylight-saving change (the series stores weekday and wall time; each night is expanded from the wall time in America/Chicago). In `Ammo station prices` → `Schedule price change` → Item, New price, Effective `YYYY-MM-DD 19:30` → `Save price change`; the schedule table shows the row `Pending` with a `timer "Price change <item>"` counting down to the effective instant, and a `Remove …` button. Provider-recorded: rows in Postgres `series`, `nights`, `price_changes`.
2. **Phone sign-up** (brief: Journeys 2). A phone viewer opens `/nights`, picks the night, `Sign up for <title> on <Ddd D Mon>`, enters Name, Email and zone, `Sign me up`; notice `You're signed up for <title> on <Ddd D Mon>. Confirmation email: sent.` Mailpit receives the confirmation (subject `Signed up: <title> · <Ddd D Mon YYYY>`, lines `Studio time:`, `Your time:`, `Sign-ups close:`); one hour before the start the reminder (`Starts in 1 hour: <title>`) arrives within 5 s of falling due; a second submit with the same email returns the stored sign-up (`You're already signed up for this night.`) and sends nothing; after the closing instant the button is disabled and the status reads `Sign-ups closed`.
3. **A siege night** (brief: Journeys 3). Callsign, `Start a room`, share the code, teammates `Join by code`, everyone `Ready`, the host `Start match`. The server counts down 5,000 ms, spawns wave 1; the HUD shows the server's ammo, health, credits, wave and timers; in the intermission the `Shop` button enables and the Ammo station drawer lists the current prices.
4. **Dropped connection** (brief: Journeys 4). The stream drops: notice `Connection lost — reconnecting. Your seat is held.`; the client buffers reports, retries every second, and on return sends them in one batch (`Reconnected — <n> buffered reports sent.`). Each report id applies once. When the host drops the lowest connected seat becomes host (`<callsign> is now host`).
5. **Down, revive, boss, debrief** (brief: Journeys 5). A downed teammate's `Revive window <callsign>` counts down; a player within 2 m presses Revive before it ends and the teammate is up with 50 health. Clearing the boss wave ends the match with `Victory`; the Debrief dialog shows the result and `Squad results`; History lists the match.
6. **Convoy laps** (brief: Journeys 6). The racer drives checkpoints C1→C4 then the line; the browser moves the car locally and sends poses every 100 ms; the server judges speed, wrecks (reset after 3,000 ms at the last checkpoint) and times each lap; the Lap board shows the best lap.
7. **Tuning controls** (brief: Journeys 7). Settings → Controls → `Remap Fire` → press a key; Comfort → `Reduce effects`; Audio sliders. Settings are stored in Postgres when signed in and in the browser always; they persist after a reload.

## Palette (decided: values measured from the seed capture; brief: Visual design names the roles)

ground #070d0d · surface rgba(8,18,18,0.5) · ink #e6efec · muted #6f9f90 · dim #6a8a80 (seed #44625a lightened for AA: brief: Visual design, Dim ink) · accent/mint #9fe6cf · hairline #2a6e5c · primary fill #123a30 (hover #17483b) · primary bar emerald #1f9a6f · ghost border #3a4644, ghost label #a9b6b3 · danger #ff9b94 (decided: errors) · warning #f0c87a (decided: service banner).

## Type, space, layout

- Pixelify Sans (display: wordmark text fallback, panel headings, Fuse Clock numerals) and Chakra Petch (body 14px, labels 12px uppercase tracked), vendored woff2, OFL-1.1 (brief: Visual design, Type). Scale ×1.15 per heading level: 12/14/16/18.5/21.3/24.5 (brief: Visual design). Tabular figures everywhere (brief).
- Spacing steps 4/6/10/14/18/24 px (brief: Screens and layout, one compact step scale; seed: Layout system). Every interactive control ≥ 44×44 px (brief: Density and size).
- Desktop 1280×800: panels 440 px, Nights and History 640 px, notice panel ⅓ width; wordmark 40vw in the upper third, start-a-room bar beneath, two link rows, build stamp bottom-right (brief: Screens and layout). Tablet 768×1024: panels 70% width, notice ⅔. Phone 375×812: panels full width minus margin, wordmark full width minus margins, HUD readouts in one top row, touch sticks in the bottom corners with the action buttons above the right stick, drawer as a bottom sheet of 70% height, Started and Room columns hidden. No document scroll at any size.
- Breakpoints: ≤600 phone, 601–1024 tablet, >1024 desktop (decided: matches the three published viewports).

## Motion (brief: Motion and effects)

| Element | Trigger | Duration, easing | Reduced-motion substitute |
|---|---|---|---|
| Panels, dialogs | open | 180 ms cubic-bezier(.16,1,.3,1), opacity 0→1 and scale .985→1; exit 100 ms fade | appear and disappear instantly |
| Blur scrim | dialog open/close | 200 ms ease | instant |
| Hover, press | pointer | 200 ms ease colours; press 100 ms sink | none |
| Fuse Clock | each server value | digit rolls up in 100 ms; re-flow 200 ms when the snapshot disagrees by > 150 ms; at zero splits over 330 ms then shows the outcome word for 1.5 s | text swaps instantly, outcome appears at once |
| Stage | title idle | camera orbit, one loop per 60 s; follows the player in a match; shake ≤ 300 ms within 5 m of an explosion; bob 2 steps/s | frozen; no shake, no bob; pointer still turns the player model |

No looping CSS animation exists. Reduced effects follow `prefers-reduced-motion` or the Reduce effects switch (brief).

## States per async action (brief: Feedback states, copy verbatim)

Callsign, room start, join, ready, start, purchase, price change, removal, series, sign-up, settings and remap each show pending copy in `status "Notices"` immediately, then success or the published error copy; field errors sit under their field and are linked by `aria-describedby`; any 5xx shows `Something went wrong on the server. Try again.` Service banner lines (Valkey, mail, Postgres, in that order) follow `/api/status`; the in-room pause banner follows the room's `degraded`.

## Server rules (brief: Business rules, Seed data)

20 Hz ticks (50 ms), countdown 5,000 ms, intermission 20,000 ms, reload 1,800 ms, fuse 3,000 ms, revive window 10,000 ms, lease 5 s, grace 30,000 ms, invite 15 min, fire interval 100 ms (exactly 100 ms accepted), speed 4.0 m/s, damage 20, grenade 100/5 m, barrel 80/4 m, enemies per Seed data, convoy top speed 30.0 m/s + 0.5 m slack, checkpoints within 6.0 m, reset 3,000 ms. Time zone rules: skipped hour moves forward by the gap (`shifted_forward`), repeated hour uses the first occurrence (`first_occurrence`). Sign-ups open 168 h before and close 2 h before the start; the night ends 3 h after it; reminders are due at start − 60 min. Room creation by a player already seated in a live room answers `409 already_in_room` with `"code"` in the error object (brief: API, Rooms), and the browser shows `You're already in room <code>.` (brief: Feedback states). Decided: where the brief does not say, the ledger entry ids and event extra fields (`remaining_ms`, `lap_ms`, `checkpoint`, `by`) are additions that carry the facts the browser needs.

## Media and licences

No image, audio, video or model files. The wordmark, scenes and glyphs are drawn in code (`original`). Fonts: Pixelify Sans and Chakra Petch, OFL-1.1, vendored from Fontsource 5.3.0. Packages: three (MIT), lib/pq (MIT); build tools esbuild (MIT), typescript (Apache-2.0).
