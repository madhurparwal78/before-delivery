# TRUTH — Haldvik Subsea Pensight (golden)

Every value says where it comes from: `brief: <section>` (copied) or `decided: <why>` (the brief is silent).

## 1. Journeys (ideal end-to-end flow)

1. **First open** (brief: Journeys 1). Fresh install, laptop. `/` shows the open-pen card (Skarvholmen 01, brief: Pens page) and four square cards, each with its grade line (`Grade D — Repair before stocking · 5 open defects`, `Grade B — Monitor · 1 open defect`, `Grade A — Sound · 0 open defects`; brief: First-open copy). Opening Skarvholmen 01 shows `/pens/skv-01?view=cylinder`, six Scene status lines then no `Loading pen`, rows D-0001…D-0006 (D-0006 `Repaired`). `U` unwraps in 1.4 s, address ends `?view=flat`, D-0001 reads `panel F3`. Selecting D-0003 adds `&defect=D-0003` (history never grows). Reload: flat chart at once, D-0003 selected, no run played, grade D (brief: Workspace address).
2. **Dive day** (brief: Journeys 2). Plan dive (default start = next whole hour on the server clock, 90 min) → Check forecast → `GO — every planned hour is within limits` (provider GET `/v1/marine` with the site position to four decimals, `hourly=ocean_current_velocity,wave_height`, `start_hour`, `end_hour`) → Start dive (fresh GO only; clock counts from server `elapsed_s`) → attach sonar (MinIO `farms/<farm>/sonar/<id>`) → Finish with track lines `t_s,bearing_deg,depth_m` → listed as recorded with its track and capture.
3. **Edit from the deck** (brief: Journeys 3). Opening the editor takes `pensight:lock:defect:<id>` (30 s, refreshed every 10 s); the other device shows `Being edited on Deck tablet`. Save updates pin and row in place everywhere; history names the device with `size.length_cm: 45 → 60`. Two simultaneous saves of one version: one 200, one 409 `version_conflict`; both devices end showing the winner. Closing releases the lock.
4. **Copilot** (brief: Journeys 4). The provider receives exactly two messages (system findings context with eight keys per non-removed defect, and the question byte for byte). Answer text, camera flies to the first focused defect, proposals listed; Apply records one copilot repair (grade D → C for the seed pen); applying again changes nothing.
5. **Legacy import** (brief: Journeys 5). Choose CSV, double-click Import while the tablet uploads the same bytes: one import record, one MinIO object, one replay with the same id. Summary tables Created/Merged/Already imported/Orphans/Invalid with row numbers. Re-import: `Already imported — nothing new created`. Original downloads byte for byte.
6. **Publish and share** (brief: Journeys 6). Publish revision 2, create a 7-day link, the phone page shows grade, defects and `Link expires <date> <time> UTC (in <h> h <m> min)` from the server's `expires_in_s`. A cross-site revoke is refused 403 and the link stays active. Two simultaneous Regenerate presses: one 200, the other 409 `link_state` (`Link changed on another device — the list has been refreshed`); the old URL answers 410. Revoke: the page reads `This report link is no longer active` within 20 s; the tablet shows `Revoked`.
7. **Restore** (brief: Journeys 7). Restore revision 1 returns exactly that revision's defect ids, sizes, notes, statuses, repairs and still links; later defects vanish (404); versions become max(current, snapshot) + 1 and a `restored` history entry is written.
8. **Client erasure** (brief: Journeys 8). CSV export neutralises `=`, `+`, `-`, `@`, tab and CR leading text cells with an apostrophe. Search `%%` finds nothing; `kal` finds the farm and the pen. Erase farm (Cancel focused; Escape closes only the top dialog) removes the farm, its pens, defects, history, dives, imports, revisions, links, locks and every MinIO object under `farms/kalamos/`; the open report page reads `This report link does not exist` at its next re-check.

## 2. Palette (brief: Visual design; seed-reference inventory)

| Role | Hex | Source |
|---|---|---|
| ground, bar, panels, footer, stage fog | `#010101` | brief: near-black; seed: ground |
| ink on dark | `#FFFFFF` | brief: pure white ink |
| ink on light fields | `#010101` | brief: near-black ink on light |
| muted label on dark | `#9A9A9A` | brief: mid grey; seed |
| stone (report bands, Open defects panel) | `#8E9291` | brief: cool stone grey; seed |
| paper (latest report row) | `#F0EFEA` | brief: warm paper off-white; seed |
| olive (Condition grade panel) | `#525544` | brief: dark olive; seed |
| rule on light | `rgba(1,1,1,.33)` | brief: about one third strength |
| rule on dark | `rgba(255,255,255,.2)` | seed: hairline on dark |
| water (3D scene and card stills only) | `#1b6f78` to `#04161a` | decided: the brief allows only cold blue-green water as hue |
| focus ring | 1.5px solid `#FFFFFF` (`#010101` on light), offset 3px | brief: thin white ring slightly outside |

No accent and no status colours (brief).

## 3. Type, space, layout

- Faces: Inter Tight (light 300 to medium 500) for display, Inter (400/500) for the rest, self-served woff2 (brief: Typefaces). Tabular figures on every number (brief: Clinical). Scale 13 / 16 / 20 / 24 / 32 / 40 / 64 / 88 px, each step about a quarter larger (brief). Labels sentence case, muted, never capitals (brief).
- Gutters 32 px (laptop, tablet) and 16 px (phone); 12-column grid, 18 px gap (brief; seed). Media frames radius 2 px, everything else square. Tap targets at least 44 px (brief).
- Breakpoints: phone below 600, tablet 600 to 1099, laptop from 1100 (brief: Layout widths).
- 1280x800 workspace: pen list 2, stage 5, Copilot 2, defects 3 columns filling the viewport under a 72 px bar (brief). 768x1024: pen strip, stage at 56 vh (brief: a little over half), defects 3/5 beside Copilot 2/5. 375x812: Pen picker, stage at 44 vh (brief: a little under half), tab list `Pen panels`. Pens page: three, two, one card per row after the full-width open-pen card (brief). Report link page: stage 8 of 12 columns with Condition above Defects; tablet stage full width with Condition and Defects side by side; phone tab list `Report panels` (brief).
- Reports: paper latest row, olive and stone counter panels side by side (stacked on phones) with the numeral overlapping the frame's lower edge, stone revision bands with a thin dark top rule, chart first on phones (brief).

## 4. Motion

| Element | Trigger | Duration, easing | Reduced-motion substitute | Source |
|---|---|---|---|---|
| Pen Unwrap / Wrap | button, `U`, `W` | 1400 ms nominal (1200 to 1800), fast start and long soft settle; progress follows elapsed time; a reversal replays the progress made at the pace it was made | single frame to the end state | brief: Pen Unwrap |
| Camera fly-to | `N`, `P`, row, Show, copilot | 900 ms, ease-out (700 to 1400) | jump | brief: Camera fly-to |
| Orbit, zoom steps | keys, drag, wheel, pinch | steps settle in about 250 ms; drag orbits at once, a release glides under 400 ms | keep working unchanged | brief: Input motion |
| Fish school | ambient | one lap per 36 to 54 s, at most 36 fish | stops | brief: idle motion (30 to 60 s, at most 60) |
| Particles | ambient | cross the stage height in 30 s | stop | brief (20 to 40 s) |
| Light shafts | ambient | sway once per 10 s | stop | brief (8 to 12 s) |
| Selected pin pulse | selection | 2 s | stops | brief (1.5 to 2.5 s) |
| Card reveal | hover, focus | still +3% over 1000 ms; scrim 333 ms; grade line 200 ms (50 ms delay), arrow 300 ms | grade and arrow always shown, no growth, scrim only | brief: card reveal |
| Revision bands, latest row | first scroll into view | rise 8 px and fade over 1000 ms, 80 ms stagger, once | in place | brief: Report revision bands |
| Editor | open, close | slide 250 ms (48 px and a fade) from the right | none | brief: Panels |
| Dialogs, toasts | open | 160 ms and 200 ms fade | none | brief: Panels |

## 5. States per async action (brief: Feedback states, copied verbatim)

Save defect `Saving…` / `Saved <id>` / field error / 409 `<id> changed on another device — reopen to see the latest` / `<id> was removed` / 423 `Being edited on <device>`. Delete `Removing…` / `Removed <id>`. Attach still `Uploading still…` / `Attached still <id>` / `Still is larger than 8,000,000 bytes` / `Stills must be JPEG or PNG`. Record repair `Recording repair…` / `Repair recorded for <id>` / `<id> is already repaired`. Lock lost `Your edit lock expired — reopen the editor to continue`. Check forecast `Checking forecast…` / GO, NO-GO, stale copies / `Forecast unavailable — try again shortly`. Start `Starting dive…` / `Dive started` / `Dive needs a fresh GO before it can start` / `Dive has already started` / `Dive is already recorded`. Finish `Finishing dive…` / `Dive recorded` / `Track row <i> is invalid: <reason>` / `Dive is not running`. Sonar `Uploading sonar capture…` / `Attached sonar capture <id>` / `Sonar capture is larger than 20,000,000 bytes`. Copilot `Asking copilot…` / `Copilot answered` (+ `Ignored unknown defects: <ids>`) / `Copilot unavailable`; apply `Applying repair…` / `Repair recorded for <id>`. Import `Importing…` / `Imported <file>: <c> created, <m> merged, <a> already imported, <o> orphans, <i> invalid` / `Already imported — nothing new created` / `Import file is larger than 2,000,000 bytes`. Publish `Publishing…` / `Published revision <n>`; restore `Restoring…` / `Restored revision <n>`. Links `Working…` / `Link created`, `Link regenerated — the old link no longer works`, `Link revoked`, `Link copied` / `This link is no longer active`, `Link changed on another device — the list has been refreshed`. Erase `Erasing…` / `Erased <farm>` / `Type the farm name exactly to confirm`. Search `<n> results`, `Type at least 2 characters`, `Search text is longer than 100 characters`. Unreachable `Pensight server unreachable — changes are not saved` (the typed input stays).

Decided copy where the brief is silent: the empty statements `No revision published yet`, `No report links yet`, `No imports yet` (decided: seeded pens have none; one large statement on black like the brief's empty state), `Choose a legacy CSV file first` (decided: Import pressed without a file).

## 6. Media and licences

No photographs, no icon set and no video. The twin, card stills, flat charts and every line icon (24 px grid, 1.5 px stroke, round caps) are drawn in code: licence `original`. Fonts: Inter and Inter Tight latin subsets from Fontsource 5.3.0, OFL-1.1, committed under `web/public/fonts` and listed in `assets.json`. three.js 0.187.0 (MIT) is bundled and served by the app.
