# TRUTH — Swathdeck golden

The brief (`instruction.md`) made concrete. `brief: <section>` values are verbatim; `decided: <why>` fills a
silence in the brief's intent.

## Journeys (start state → actions → visible and recorded end state)

1. **Plan a survey** (brief: Journeys 1). Ira Penhallow signed out → `/sign-in` → lands `/fleet`. Opens
   `New mission` (`/missions/new`): types name, picks the client, survey date, vertices (one `easting, northing`
   per line, Enter for a new line), opens `Vertex format help` (non-modal, inside the viewport, Escape returns
   focus), sets depth, swath ratio, overlap, azimuth, speed, survey order. `Plan preview` shows
   `<n> lines · <k> cross · <minutes> min` for the current values only (sequence-keyed requests; earlier answers
   discarded). The six settings mirror into the address with `replaceState` on blur or 600 ms after the last key.
   Ctrl+Enter or `Create mission` → `POST /api/missions` with an `Idempotency-Key` → lands
   `/missions/<id>/plan` listing `L01…` then `X01…`. Recorded: the mission row, its lines (Pending) and a
   `created` history event.
2. **Ready the fleet** (brief: Journeys 2). Pickers on every row (ARIA combobox → listbox, flips upward on the
   last row) → `Save assignments` with Shearwater overdue → whole save refused, `Plan status` shows the overdue
   block message; nothing recorded. Tamsin logs a service for Shearwater from `Fleet service`; the dialog makes one
   key per opening, a lost response keeps the dialog open and the retry sends the same key → one service entry,
   hours since service 0. Save again → `Assignments saved`. Ira raises Gannet's interval; a stale version answers
   409 → typed value kept, `Current: <interval> h` beside it.
3. **Slipway launch** (brief: Journeys 3). Tamsin on `/launch` (phone) taps `Mark <vessel> afloat`; the row reads
   `Afloat` only after 200; refusals and dropped requests leave `Ashore` with the copy. Ira presses
   `Launch mission` → both screens read `Launched`.
4. **Supervise** (brief: Journeys 4). `/fleet/<vessel>` updates position, speed, battery, coverage and
   `Recent fixes` in place every 2 s (page-clock polling). Link-state changes, breach (one per excursion), return
   inside, link lost and service overdue are announced once each in `Fleet announcements`; alerts are emailed
   (outbox, one message per recipient) and escalate once at the delay. Acknowledged ≠ Rectified; history
   records exactly one acknowledgement under races.
5. **Close a holiday** (brief: Journeys 5). On the console the lens moves 10 m per arrow (50 m with Shift), Enter
   queues infill for the holiday under the lens centre (or the one with most cells in the lens); only after
   201/200 does the dashed `Infill I0n` draw and the counters change. Reorder with Alt+arrows. A Lost vessel's
   Assigned infill moves to the nearest eligible vessel. The infill pass closes the holiday (`<holiday> closed`).
6. **Upload line files** (brief: Journeys 6). `Upload line file` dialog (file + SHA-256) → `Uploading <n>%`
   (XHR progress, capped at 99) → `Stored` after 2xx. 401 → sign in inside the dialog, resend once. 503 →
   `Waiting for storage`, held; sends itself once when status reports storage up. Over 8,000,000 bytes →
   resumable 4,000,000-byte parts.
7. **Recover and complete** (brief: Journeys 7). `Mark mission complete` → `Complete` only after 200, focus to
   the next section heading; Complete + report Pending commit together; the report is written once in canonical
   bytes; each reviewer gets one report-ready email after Ready.
8. **Client review** (brief: Journeys 8). Odile follows the email link through sign-in to `/surveys/<id>`; reads
   the header groups, filters `Line files` by vessel (`?vessel=`), downloads a line file, the CSV and the report.
9. **Field operations** (brief: Journeys 9). Offline queue in local storage; bulk assign with 10 s undo; leave
   guard; geofence change re-evaluates breaches; weather hold; re-run; history; hand-over; client flags; the
   coverage grid.

## Palette (decided values in DESIGN.md; roles from brief: Visual design › Colour)

| Role | Hex | Source |
|---|---|---|
| paper ground | `#F5F1E6` | brief: warm paper white |
| ground ruling | `#E6DFCF` | brief: faintly ruled like a nautical chart |
| surface | `#FBF8F1` | decided: sheets and panes one step lighter |
| ink | `#1B1A17` | brief: near-black ink |
| ink muted | `#57534A` | decided: AA secondary text |
| rule (warm grey) | `#C9C0AE` | brief: hairline rules and chart grid |
| rule strong | `#8C8473` | decided: 3:1 control borders |
| sea | `#1E4D78` | brief: deep sea blue for depth tints, primary buttons, links |
| depth shallow → deep | `#C7DBEC` → `#3D6E9C` | brief: lighter where shallow, darker where deep |
| bands 1× / 2× / 3×+ | `#B4C6D6` / `#7E98B1` / `#4C6A88` | brief: increasingly dense grey-blue |
| signal orange | `#B83E0B` | brief: only alerts (left rule, icon) and holidays (outline, hatch) |

## Type

| Use | Face | Size | Source |
|---|---|---|---|
| headings, mission names | Newsreader 500/600 | h1 29.30 px, h2 23.44 px, h3 18.75 px | brief: each level a quarter larger, from body size |
| body, controls | IBM Plex Sans 400/500/600 | 15 px / 1.45 | brief: Type |
| numbers with units | IBM Plex Mono 400/500, tabular | 0.92 em | brief: every number in mono with its unit |

## Space and layout per viewport

| Viewport | Fleet board / console | Source |
|---|---|---|
| 1280×800 | three panes: rail 280 px, chart, detail 360 px | brief: Layouts |
| 768×1024 | rail + chart; detail as right sheet (`<vessel> detail`, `Mission detail`) | brief: Layouts |
| 375×812 | one column; chart 45 vh (≥ 300 px); console list: Holidays, Lines, infill queues, plan summary, Alerts, vessel cards | brief: Layouts |
| tiers | wide ≥ 1024 px, medium 600–1023 px, narrow < 600 px | decided: no published viewport sits near a boundary |

Spacing unit 4 px; every button, option and row ≥ 44 px (brief: Touch). Launch list single column, 42 rem max
(decided: comfortable reading width).

## Motion

| Element | Trigger | Duration | Easing | Reduced motion | Source |
|---|---|---|---|---|---|
| lens centre | pointer move / arrow | trails 125 ms, settled < 250 ms | ease-out cubic (rAF, page clock) | snaps | brief: Lens follow |
| lens open / close | focus, pointer over / leave | 180 ms, scale 0.6 → 1 | `cubic-bezier(.2,.8,.2,1)` (WAAPI) | appears / disappears | brief: Lens open and close |
| infill line draw | server confirms queue | 320 ms mask `stroke-dashoffset` | same | appears drawn | brief: Infill line |
| vessel marker | new fix | 320 ms glide | ease-out cubic | jumps | brief: Vessel markers |
| sheets | open / close | 180 ms translateX | same | appear in place | brief: Sheets |
| new alert card | first seen after load | 180 ms translateY + opacity | same | appears | brief: alert cards |
| counter | value changes | 180 ms background tint | ease-out | swaps | brief: Counters |

Nothing loops; pending states are words (`Marking…`, `Completing…`, `Queueing…`, `Updating plan`).

## States per async action (brief: Feedback states, copy verbatim)

Sign in (`Signing in` → home; `Email or password is incorrect.`; 429 message), plan preview, create mission, save
assignments, launch, abort, mark afloat / recovered, log service, save interval, upload, complete, acknowledge,
queue infill, reorder, hold, resume, geofence, hand-over, re-run, flag, reply — each writes its published copy
into its named region. Unpublished no-response copies follow the brief's pattern
`Could not reach Swathdeck — <what> is not <done> yet` (decided: consistent with the published ones).

## Decisions where the brief is silent

- `GET /api/missions` items also carry `owner_id` and `owner_name` (decided: the fleet board announces a
  hand-over within five seconds from its two-second mission poll).
- `GET /api/surveyors` lists principal surveyors for the hand-over dialog's `Surveyor` picker (decided: the
  brief requires the picker and publishes no user list).
- Flag records also carry `mission_id`, `mission_name`, `client_name` (decided: the flags list item reads
  `<client> · <mission> · <label> · <comment>`).
- The planner preview chart draws lines from the preview's swath width, spacing and counts (decided: the
  preview response carries no line geometry).
- `Save assignments` sits above the table beside `Assign selected`; `Launch mission` and `Open console` below
  (brief: Reassign many lines places `Assign selected` "beside Save assignments" above the table).
- An alert email is sent 1.5 s after it is queued, checked every 0.5 s (decided: within the 30 s rule, keeps
  the email state steady while staff react).
- Queued offline actions and the held upload are dropped on sign-out (brief: Sessions and shared devices).
- Swaths are painted at the 5 m resolution of the server's coverage grid: exactly the covered cells, each tinted
  by the depth of the fixes whose swath crossed it (decided: the chart shows what the server counts, and a
  per-cell image paints quickly even under software rendering).
- A storage 503 on an upload counts as the server reporting storage down, so the held upload resumes on the
  next status poll that reports `up` (brief: Upload held through a storage outage).
- Chart text (grid edge labels, vessel names, holiday areas, the band legend) is drawn after the line work on a
  paper plate; holiday area labels sit beside their cells, never over a hatched cell, and a vessel label flips to
  the left of its chevron at the plot's right edge (decided: brief: Visual design asks labels and hatch to read
  clearly at AA contrast).
- Captions, table headers and status words use small capitals (`font-variant-caps`), not uppercase text, so
  the words stay as written for assistive technology and copy.

## Media and licences

Fonts: Newsreader, IBM Plex Sans, IBM Plex Mono woff2 from Fontsource 5.1.1 (OFL-1.1). Icon: Lucide
`triangle-alert` path (ISC). Favicon and mark: original. The chart is drawn in code (no images). Listed in
`app/assets.json` and `app/THIRD_PARTY_NOTICES.md`.
