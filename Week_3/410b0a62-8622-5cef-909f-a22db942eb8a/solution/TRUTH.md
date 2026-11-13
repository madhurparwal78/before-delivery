# TRUTH — Ottermere Sport Tempoline (golden)

What the finished app does, concretely. Each value says where it came from: `brief: <section>` (verbatim) or
`decided: <why>` (the brief is silent; the reason ties it to the brief's intent). Design values live in `DESIGN.md`; this file
repeats the ones a verifier reads.

## Services and configuration

- PostgreSQL via `DATABASE_URL`, object storage via `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (brief: Configuration and secrets).
- `GRADING_KEY`, `APP_TODAY`, `APP_TZ` (default UTC), `LIVE_HEARTBEAT_MS` (15000), `ACTIVITY_MAX_BYTES` (1048576), `ACTIVITY_MAX_SAMPLES` (21600), `LINK_REQUEST_TTL_HOURS` (72), `UPLOAD_TIMEOUT_MS` (5000), `CHART_ANIMATION_MS` (450), `APP_PUBLIC_PORT` (4173): all read once in `src/server/config.ts` (brief: Configuration and secrets).
- Fixed limits the brief states: JSON body 1,000,000 bytes (grading seed 20,000,000), upload envelope `ACTIVITY_MAX_BYTES` + 65,536, database retry every second at boot (brief: API, Server boundary).
- No configuration variable, credential, URL, limit or timer is sent to the browser (brief: Configuration and secrets). The page shows exactly one configured number, and only because the brief names it as a public attribute: the Fitness chart group's `data-animation-ms`, which "shows the configured duration" while the lines morph (brief: Public screens, Fitness chart card; Motion and effects, Chart). The browser receives that rendered number, never the variable or any other setting; today comes from `/api/me` (brief: Today and time zones). The two brief statements are recorded as a dispute below.
- Object key `activities/<athlete id>/<workout id>.csv|.json`, content type `text/csv` or `application/json`, metadata `sha256` and `filename` (brief: Services).

## Journey flows (start state, actions, visible end state, provider-recorded end state)

1. **Build a session by keyboard.** Athlete opens `/athletes/<id>/builder?date=2026-11-06`. Focus the "Add warm-up", "Add interval" and "Add cool-down" pills and press Enter: each inserts after the selected step, selects its first part and returns focus to the Steps list; the interval defaults to repeat 4, work 0:03:00 at 105%, recovery 0:03:00 at 55%. In the Steps list: Right twice and Shift+Up five times and `+` set the interval to 5 × (0:04:00 at 110% / 0:03:00 at 55%); each key announces e.g. `Interval work 0:04:00 at 110%.` in Builder announcements. Totals read `Duration 0:55:00`, `Planned 58.1 TSS`, `IF 0.80`. "Save to calendar" announces `Saved <name> on Fri 6 Nov.`; the workout row (source `builder`, version 1) is in PostgreSQL and the day chip shows it after a reload with its planned stress. "Save to library" announces `Saved <name> to your library.`; the library panel lists `<name> · 0:55:00 · 58.1 TSS` and `Place <name>` places it by keyboard (Enter, arrows within the centred week, Enter: `Placed <name> on Sat 7 Nov.`) (brief: Journeys 1; Feedback states).
2. **Upload and read the numbers.** Athlete opens "Log session on <Day>", chooses a CSV or JSON file, "Upload session". Pending: pill reads `Uploading <file>…`. The server checks size, type, request fields, contents, rows, channels, sample count and threshold in that order; on success it stores the object, reads size and SHA-256 back, commits the workout and the series in one transaction and the dialog closes with `Saved <title>: <tss> TSS.` in Session status. The day chip shows its compliance label, the week tile, banner, chart and table all show the new values and still do after a reload (brief: Journeys 2; Business rules).
3. **Coach moves and plans live.** Coach and athlete have the athlete's calendar open. Coach drags one planned item onto another chip and moves another by keyboard (Enter picks up: `Picked up <title>. Use the arrow keys to choose a day, then press Enter to drop or Escape to cancel.`); the athlete's view updates within 3 seconds through `GET /api/live`. The coach opens Plans, "Apply <plan>", chooses "Count back from event", a date and an event name; the confirmation reads `Added <n> workouts to <athlete>'s calendar. Skipped <k> on days that have already passed.` (plus the kept sentence when above 0) (brief: Journeys 3).
4. **Upload seen by the coach, comment seen by the athlete.** While the coach's `/coach` dashboard is open, an athlete upload updates the athlete's row in place (planned, completed, latest session, compliance) and the coach's Notices read `<athlete> logged <title>: <tss> TSS.`. The coach comments on the workout; the athlete sees the comment and the notice `<coach> commented on <title>.` within 3 seconds (brief: Journeys 4).
5. **Threshold change.** Coach or athlete saves FTP with a past "Effective from": only completed bike workouts from that day up to the day before the next later FTP are re-scored; the status reads `FTP <n> W from <Long day>. Re-scored <k> workouts.`; the series is recomputed from that day in the same transaction (brief: Journeys 5; Thresholds).
6. **Linking and unlinking.** Athlete enters a coach code in the navy footer; the form is replaced by `Request sent to <coach>. They'll appear under Coaches once they accept.`; the coach's Inbox shows `<athlete> wants to join` within 3 seconds; Accept replaces the item with `<athlete> is linked.`; the coach's switcher lists the athlete. When the athlete removes the coach, the coach's open views switch to the Not found view within 3 seconds and every later request answers 404 (brief: Journeys 6).
7. **On a phone (375×812).** The rail's centred week is 85% of the width with slivers; a swipe over 40px (or the arrows, dots) advances one week, the address `?week=` changes without a history entry, Week announcements read `Week of <Monday>: planned <x>, completed <x>, form <tsb>`. "Log a session" has field errors under their fields, the first invalid field focused. With reduced motion the week swaps instantly and `data-moving` never becomes `true` (brief: Journeys 7; Motion).
8. **Storage outage.** With storage unreachable the upload is refused with `503 storage_unavailable` and the message `Activity storage is unavailable. Your file was not saved; try again in a few minutes.` shown in the dialog's alert panel (violet bar, focused); the chosen file stays selected; nothing else changes. A hand-entered session still saves. Health answers `200 {"status":"unavailable"}` (brief: Journeys 8; Services).

## Palette (hex the build uses)

ground #F8F9FB, surface #FFFFFF, ink #010F31, muted #56657C, muted-on-dark #97A6BA, accent (cobalt) #2A5FEA, accent-2 (violet) #6446C8, glow #F472B6, on-accent #FFFFFF, danger #B42318, border #E5E7EB, state strips on-target #0B7A4E / close #8A5A00 / off-target #B54708 / missed #B42318 / unplanned #6446C8 / planned #2A5FEA (brief: Visual design palette roles; decided: the seed's slate, cobalt and violet were each darkened one step to clear WCAG 2.2 AA; state colours are the brief's "thin coloured strip" with its text label).

## Type, space and layout per viewport

- Display Encode Sans Expanded ExtraBold (800); body Inter 400/500, tabular figures in tables; both self-hosted woff2 (brief: Typefaces). Scale ratio 4/3 from 16px: 16, 21.33, 28.44, 37.92, 50.56, 67.41, 89.88 (brief: Type scale).
- 1280: banner form line 89.88px, week-tile totals 50.56px, section headings, sport-tile numerals and countdown 37.92px; content column 1280px; rail tile 66.667% of the width, 32px gap; library panel beside the rail's controls; builder graph two-thirds, totals/add/save/Steps one third. 768: one step lower, tile 78%, builder stacks graph, totals, Steps. 375: two steps lower, tile 85% with 12px gap, five tiles as a two-column grid, ring rows stacked, dialogs fill the screen as sheets, navigation in the Menu drawer (brief: Screens and layout; decided: step ladder keeps form > week totals > headings).
- Header 80px (64px at 375), white, fixed; every control at least 44px on the 375 and 768 layouts (brief: Tap targets).

## Motion table

| Element | Trigger | Duration, easing | Reduced-motion substitute | Source |
|---|---|---|---|---|
| Pill hover and press | hover, press | 250ms shadow and background, 120ms dip of 1px | none | brief: Motion |
| Tile hover | hover | 250ms shadow | none | brief: Motion |
| Colour changes | hover, focus | 160ms | none | brief: Motion |
| Header chevron, dropdown | open | 200ms flip, 300ms fade | instant | brief: Motion |
| Section headings and ring rows | a fifth in view, once | 400ms fade up 16px | static | brief: Motion |
| Week track (`data-moving`) | rail advance | 440ms `cubic-bezier(0.2,0.7,0.2,1)` WAAPI; `data-moving` is true until the animation's `finished` promise settles | swaps instantly, flag never true | brief: Motion (little under half a second) |
| Chart band | rail advance | same 440ms, same frame | jumps | brief: Motion |
| Week totals line and pill | 160ms after the track starts | 330ms fade and rise 12px | none | brief: Motion |
| Active dot | rail advance | 160ms fill to navy | none | brief: Motion |
| Chart lines | series change | `CHART_ANIMATION_MS`; `data-animating` true until the last frame, `data-animation-ms` shows the value | applied at once, `data-animating` false, `data-animation-ms` 0 | brief: Motion |
| Drift wall | scroll | ±0.25 tile each row, opposite directions, scroll-linked | static | brief: Motion |

## States per async action

Pending text, success text and field-error placement are exactly those of the brief's Feedback states table (Sign in `Signing in…`, Upload `Uploading <file name>…`, Save session `Saving…`, builder saves `Saving…`, threshold `Saving…`, Apply plan `Applying…`, Copy workouts `Copying…`, Send request `Sending…`, Post comment `Posting…`, Delete `Deleting…`). Every pending pill is disabled and its status region announces it. Refusals that are not field errors (409, 503) show in a violet-barred panel with role alert in the place of the action (decided: the brief forbids toasts for outages and names no pattern for the others).

## Breakpoints

375 (phone: Menu drawer, sheets, two-column tiles, stacked rings, 85% tile), 768 (tablet: full nav, stacked builder, 78% tile), 1280 (desktop; 1100 and up switches the day chips to seven columns and the tile to two-thirds) (brief: Screens and layout; Browser support).

## Media and licences

No photographs, no third-party logos. All drawings (band shapes, chart, rings, builder graph, countdown road, empty-state marks, wordmark) are original inline SVG/CSS (licence: original). Icons are Lucide (ISC) inlined as SVG. Fonts: Encode Sans Expanded 800 and Inter 400/500, SIL OFL-1.1, listed in `app/assets.json` and `THIRD_PARTY_NOTICES.md`.

## Decisions where the brief is silent

- A hand-entered session exposes its average as `np_w` (bike) or `ns_mps` (run), because the brief says the average stands in for the normalised value; the workout page labels it "Average power" or "Average pace" for a hand entry and "Normalised power" or "Normalised pace" for a file (decided: one stored measure, no second column that could drift).
- The week rail region holds only the track; its controls, status regions and the library panel sit directly under it in the same block (decided: keeps the swipe target compact on a phone while the track stays full-bleed).
- The session cookie has no fixed lifetime and ends with sign-out (brief: users hold a session until they sign out; no timer without an environment variable).
- Every open view reloads its data each time the live stream opens (first connect and every reconnect), because a change committed between the view's first load and the stream's subscription would otherwise never reach it (decided: brief Live updates, "within 3 seconds of a committed change").
- Calendar items drag with a mouse anywhere on the item, and by touch from the item's grip button; the Move button is the keyboard path (brief: Interactions).

## Disputes noted for the bundle

- The brief lists `CHART_ANIMATION_MS` among values "never sent to the browser" (brief: Configuration and secrets) yet requires the chart group's `data-animation-ms` to show the configured duration (brief: Public screens; Motion and effects). Both cannot hold literally; the app keeps the variable server-side and shows only the number the public attribute requires.
- Seed and upload CSV files in the tests write power as `100.0` (a whole number with a zero fraction) although the brief says power is "an integer"; the app accepts a whole number with or without a zero fraction.
