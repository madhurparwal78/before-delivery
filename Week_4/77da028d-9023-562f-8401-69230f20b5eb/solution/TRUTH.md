# TRUTH — Umbral Works Darkframe

The golden's ground truth. Every value says where it came from: `brief: <section>` (copied verbatim from `instruction.md`) or
`decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Journeys (ideal end-to-end flows)

### 1. Set up the site (DP-01, DP-03, DP-04, DP-05) — brief: Journeys 1
- Start: no workspace. Action: `POST /api/workspaces {name, site}` -> 201 `{imager_id, name, key}` with `key = dfk_` + 32 lowercase hex (brief: API). Provider-recorded: row in `gateway.workspaces`, row in `sky_engine.sites` with a 72-bin all-zero horizon.
- `/unlock`: type the key in `textbox "Workspace key"`, `button "Unlock"`; success -> `/plan`; a wrong key shows `Error summary` `That workspace key is not recognised.` (brief: Feedback states).
- `/site`: edit label, latitude, longitude, elevation, time zone, push topic; `Save site` -> `Saving site...` then `Site saved.`; an invalid value (latitude 95) shows `Error summary` `Check the highlighted fields.` with a link that focuses the field, nothing saved (brief: Feedback states).
- Horizon painter: drag, or arrow keys; the whole mask is saved at the end of a drag and 500 ms after the last key; `Horizon saved.`; the verdict card repaints from `GET /api/tonight`. After reload the painter shows the same mask.
- End: `GET /api/site/horizon` returns the painted 72 values; the card shows the verdict word.

### 2. Plan tonight (DP-07..DP-11, DP-20) — brief: Journeys 2
- Start: unlocked, active projects, no plan. `/plan?date=D` shows `Night of <long date>`, the no-conditions banner and verdict `Unknown`.
- `Add target` -> `dialog "Add target to plan"` -> choose `<target> (<project>)` -> `Add to plan` -> `<target> added. At <HH:MM>: Unknown, 0 usable minutes left.`
- `Enter sky conditions` -> three numbers per hour -> `Save conditions` -> `Saving conditions...` then `Conditions saved for <n> hours.`; `PUT /api/plans/<D>/conditions` stores rows with `entered_at` = server now.
- End: the card shows Go or No-go, `Best: <target> in <filter>`, the clear window and countdown exactly as `GET /api/plans/<D>?minute=<m>` reports.

### 3. Scrub the night (DP-12..DP-19) — brief: Journeys 3
- Focus `slider "Night time"`; keys move 5/30 minutes, Home/End jump; drag picks the minute and snaps to a multiple of 5 on release. Each move requests `GET /api/plans/<D>?minute=<m>` (newest reply wins) and ends with one `At <HH:MM>: <Verdict>, <n> usable minutes left.` in `Plan updates`.
- Order of repaint (brief: Motion): position (0 ms), mask clip (+100 ms), verdict ticks (+200 ms), hours owed ticks (+300 ms); under reduced motion everything lands in one frame.
- The chart lens (160 px) reveals the unmasked sky and reads out `<target>: altitude <a> degrees, Moon <s> degrees away[, behind the treeline]`.

### 4. At the telescope on a phone (DP-18, DP-51, DP-52) — brief: Journeys 4
- 375x812 portrait: tab bar above a fixed time bar at the bottom; `Earlier 30 minutes` / `Later 30 minutes` >= 44 px; touch drag on the bar scrubs, on the dome orbits.
- ntfy down: the push row is `unsent` (`attempts` grows every `PUSH_RETRY_SECONDS`) and the card and push log show `Push not sent yet. Darkframe will retry.`; when ntfy answers the dispatcher publishes once and marks it `sent` with `sent_at`.

### 5. Log a session (DP-24..DP-31) — brief: Journeys 5
- `New session` (active project, observing date) -> `Session created for <date>.`; editor: `Started at` `YYYY-MM-DD HH:MM` site time -> `Start imaging` -> `Imaging started. Night of <date>.` (observing date by the noon rule); `Log batch` (a repeated submit with the same `Idempotency-Key` creates nothing) -> `<n> subs of <s> s in <filter> added.`; `Upload frames` -> `Uploading <name>: 0%` ... `100%` -> `<name> stored. <n> frames in this session.`; `Calibrate <filter> batch <n>` -> `Use <set>`; `Finish and log` -> `Session logged: <duration> integrated.`
- Provider: object `frames/<imager>/<session>/<batch>/<frame>/<name>` in MinIO equals the upload; two ledger entries per batch summing to zero; hours owed dropped by exactly sub count x exposure.

### 6. Amend, trash, restore (DP-32..DP-36) — brief: Journeys 6
- Editor lock taken on open (`POST /api/sessions/<id>/lock`), expires after `DRAFT_LOCK_SECONDS`; the notes box keeps its text and shows `Your edit lock expired. Your notes are kept; save to take the lock again.`; Save takes a new lock and repeats once -> `Notes saved.`; held elsewhere -> `This session is open for editing on another device.`
- `Amend` changes a batch -> reversal of its latest log movement plus a new log movement; `Trash session` reverses every unreversed log movement; `Restore session` brings back the previous state and re-posts the integration.

### 7. Keep the library (DP-37..DP-42) — brief: Journeys 7
- Empty: `Your calibration library is empty. Add a dark, flat or bias set to start matching frames.` `New calibration set` -> `<name> added to the library.` -> `Upload master <name>` -> `Master stored for <name>.` -> `Mark ready <name>` -> `<name> is ready.` -> `Edit <name>` (new version) -> `History <name>` -> `Restore version <n>` -> `<name> restored to version <n>.`
- Stale: ready and `age_days` > 180/30/365 shows state `Stale` with the stale warning as description.

### 8. Share and be reminded (DP-48..DP-50, DP-53) — brief: Journeys 8
- `Share` -> `Create link` -> `Share link ready.`; `/s/<token>` shows the integration summary and `Imaged from near <lat>, <lon>` on the 0.5-degree grid; `Regenerate link` -> `New share link ready. The old link no longer works.`; `Revoke link` -> `Share link revoked.`; the friend then sees `This shared project link is no longer available.`
- Reminder: `New-moon weekend reminder` + `Reminder time` -> `Reminder saved.`; `Upcoming reminders` items read `<remind local date> <HH:MM> before the new moon of <new moon local date>`; the wall time is kept across clock changes (spring gap moves forward by the gap, autumn repeat uses the earlier instant).

## Palette (hex the build uses) — decided from brief: Visual design - Colour
| Role | Hex | Source |
|---|---|---|
| ground | `#050A14` | brief: near-black navy |
| surface | `#0D1626` | brief: deep blue-slate card |
| raised (inputs, time bar) | `#14213A` | decided: fields read as raised on a card |
| sheet | `#1A2A45` | brief: lighter sheet for dense tables (14 lightness points above ground) |
| ink | `#E6EEFA` | brief: pale blue-white |
| muted | `#93A7C4` | brief: grey-blue |
| accent cyan | `#22D3EE` | brief: single bright cyan (hue 188) |
| text on cyan | `#031018` | brief: almost-black navy |
| edge | white 9% / active 24% | brief: thin faint white edge, brighter on active |

## Type — brief: Visual design - Type
Sora variable, self-hosted (`/assets/fonts/sora-latin-wght-normal.woff2`). Headings weight 300, each level x1.333 (h3 21px, h2 28px, h1 37px); the Plan h1 is `clamp(1.75rem, 6.25vw, 6rem)` = 80px at 1280. Labels weight 600 in sentence case. `font-variant-numeric: tabular-nums` on `body`.

## Space, layout per viewport — brief: Screens and layout
- Space unit 8px; card radius 20px, input radius 10px, controls >= 44px (brief: Cards and controls).
- 375 (<768): one column; Plan order h1, verdict card, dome, chart, target list, `Enter sky conditions`, `Add target`; time bar fixed at the bottom, tab bar above it.
- 768-1199: top navigation; h1 and verdict card span the width; left ~3/5 holds dome, chart, time bar; right holds the target list and both buttons; Projects 2 columns.
- >= 1200: left rail; dome 46% of the window centred; `Add target` pill under the dome; chart and time bar below; verdict card, target list, conditions button in the right column; Projects 3 columns.

## Motion table — brief: Motion and effects
| Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| hover/press/focus/toggle | pointer, key | 160 ms | `cubic-bezier(0.16,1,0.3,1)` | none (instant) |
| dialog | open / close | 420 ms / 280 ms (under 500) | same | no transition |
| sheet (Sessions, Library, Ledger) | route / open | 420 ms slide up | same | no transition |
| night handle on key | key | 160 ms | same | jumps |
| night handle on release | pointer up | 380 ms spring, overshoot a few minutes | `cubic-bezier(0.34,1.35,0.64,1)` | jumps |
| chart dots / dome stars and dots | plan reply | 160 ms | ease-out | one frame |
| mask clip dim | +100 ms | 160 ms | ease-out | one frame |
| verdict numerals | +200 ms | 180 ms ticks | ease-out | final value at once |
| hours owed numerals | +300 ms | 180 ms ticks | ease-out | final value at once |
| dome orbit/zoom | input | 160 ms | ease-out | jumps |
| idle | none | none | none | none |

## States per async action — brief: Feedback states
Every action shows pending, success, error and outage next to the action and in the named live region with the brief's exact copy (see the Feedback states tables). A 503 shows the API `message` and keeps typed values. Success copy states only what the server confirmed; delivery shows only in the push state and push log.

## Breakpoints — brief: Screens and layout
768 and 1200 pixels exactly; no sideways scroll at 375, 768, 1280.

## Decided values (the brief is silent)
- `started_at` of a session is site-local ISO 8601 with offset; `logged_at` and other record timestamps are UTC `Z` (decided: matches the brief's time-field convention and its seed example).
- `session_count` counts sessions that are not trashed (decided: the Sessions list shows them by default).
- Calibration candidates list every set with `matches` and `reasons`; the dialog offers ready and stale ones (decided: building and retired sets can never calibrate).
- Uploads in the editor go to the batch chosen in a `Frame batch` select shown only when a session has more than one batch (decided: the brief names one `Upload frames` button).
- Stars are 1200 deterministic pseudo-random points fixed to local sidereal time, not a catalogue (decided: no catalogue licence needed; brief only asks for a sidereal star field).
- The chart's minute line is a cyan arc around the rim whose sweep is the handle's share of the night (decided: the brief asks for a cyan minute line without a geometry).
- Moon positions between five-minute samples are interpolated; the plan's displayed Moon figures are exact for the handle minute (decided: speed under one second for eight targets).

## Media and licences
No image, audio, video or model file ships. Drawn in code (`original`): sky disc, dome, chart, stars, Moon, icons (`web/js/core/icons.js`). Font: Sora variable woff2 (OFL-1.1, Fontsource 5.3.0). Library: three.js 0.187.0 (MIT) vendored in `web/vendor/three/`. Python: aiohttp, asyncpg and their dependencies (Apache-2.0, MIT, BSD-3-Clause, PSF-2.0), tzdata (Apache-2.0).
