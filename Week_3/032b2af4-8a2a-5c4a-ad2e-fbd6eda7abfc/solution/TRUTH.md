# TRUTH.md — Pacely Athlete Training Network

Ground truth for the golden build. Every value is marked `brief: <section>` when instruction.md states it, or
`decided: <why>` when the brief leaves it open and the golden picks it. No golden app shipped with the legacy
bundle (its `solve.sh` was a stub), so the decided values below are the golden builder's targets, not a
description of existing code.

## 1. Ideal flow of every journey

### 1.1 Sign up and session (workflow `athlete-signup-and-session`, DP-01..DP-05)
1. Visitor opens `/`, presses "Sign Up With Email" and reaches `/signup` (brief: Journeys).
2. Name, Email and Password are submitted; an invalid field gets `aria-invalid="true"` and an inline message, and the page stays on `/signup` (brief: Public screens and controls / Signup).
3. `POST /api/auth/signup` answers `201 {token, athlete}`. The client stores the token (decided: `sessionStorage`, or `localStorage` when Remember me is ticked; the only persisted values besides the consent flag, so no analytics identifier is persisted, per brief: Working rules) and goes to `/dashboard`.
4. `/login` with a wrong password shows "The username or password did not match. Please try again." (brief: Feedback states).
5. Log Out in the avatar menu calls `POST /api/auth/logout` (`204`, the token row is deleted) and returns to `/` (brief: API / Sessions).
6. `PATCH /api/me {time_zone}` validates with Python `zoneinfo.available_timezones()` (decided: the standard IANA list, no extra dependency).
7. `DELETE /api/me {password}` runs one transaction that deletes the athlete and cascades every row they own or wrote, then re-ranks touched leaderboards (brief: Business rules / Account deletion).

### 1.2 Upload and parse (workflow `athlete-uploads-gpx-run`, DP-06..DP-08)
1. `/upload`: choose a file in the "GPX file" input; the client parses the GPX with the same haversine rules and shows "Distance" with km to two decimals (brief: Screens and layout / Upload).
2. Name, Sport and Visibility are set; "Save activity" posts `{name, sport_type, visibility, gpx}` (brief: API / Uploading).
3. The server parses with `xml.etree.ElementTree` (decided: stdlib, namespace-agnostic `trkpt` lookup), computes the figures (brief: Business rules / Parsing rules) and inserts the activity, its points, its efforts and its edit-free history in one transaction.
4. The response is `201` with the activity; the client navigates to `/activities/<id>` (brief: Interactions / Upload).

### 1.3 Splits, best efforts and the activity page (workflow `run-splits-and-best-efforts`, DP-09..DP-13)
1. Splits use interpolated crossing times; the final remainder split appears when at least one metre remains (brief: Business rules / Splits and best efforts).
2. Best efforts use a two-pointer sweep over running distance (decided: O(n) and exact to the rule).
3. The activity page shows the stats header, the route map (an SVG drawn from `/streams`), the elevation profile slider, the splits table with "Fastest", the segment efforts with medals and crown, the kudos button and the comment thread (brief: Screens and layout / Activity page).
4. "Play audio splits" queues one `SpeechSynthesisUtterance` per split, each "Kilometer <n>, <m> minutes <s> seconds", speaking the next on `onend`; with no `speechSynthesis` the button is `disabled` (brief: Interactions / Audio splits).

### 1.4 Refused, duplicate and replayed uploads (workflow `invalid-or-duplicate-upload-refused`, DP-14..DP-18)
1. Malformed XML, or fewer than two timed points, answers `400 {error:"validation", fields:{gpx}}` (brief: API / Uploading).
2. A unique index on `activities(athlete_id, start_time)` turns a duplicate into `409 {error:"duplicate_activity", activity_id}`; the insert catches the unique violation, so three simultaneous identical uploads give one `201` and two `409` (brief: API / Duplicates and replays; Business rules / Uniqueness).
3. `Idempotency-Key`: a table `idempotency_keys(athlete_id, key, body_sha256, activity_id, status, response)` with a unique `(athlete_id, key)`, written in the same transaction as the activity (decided: keeps the stored answer with the activity it created). Same key and body → the stored answer; same key, new body → `422 idempotency_key_reused`.
4. Bodies over 5000000 bytes → `413 {error:"payload_too_large"}` checked from `Content-Length` and the read length; non-JSON → `400 {error:"validation"}` (brief: API / Errors and limits).

### 1.5 Segments and leaderboards (workflows `segment-efforts-rank-on-leaderboard`, `leaderboard-limit-for-free-athletes`, DP-19..DP-29)
1. `POST /api/segments` takes two point indexes of the caller's own activity; distance and elevation difference are rounded (brief: Business rules / Segment geometry and matching).
2. Matching: the first point within 25 m of the start, then the first later point within 25 m of the end; at most one effort per activity (unique `segment_efforts(activity_id, segment_id)`).
3. On creation, existing activities are matched in `start_time` order; `pr_rank` and `is_crown` are computed once, at insert, from the efforts already stored, and never recomputed on read (brief: Business rules / Leaderboard rules).
4. The leaderboard keeps each athlete's fastest non-`only_me` effort, sorted by time then effort start time; non-subscribers get ten rows plus `viewer_entry`; `filter=following` keeps the viewer and accepted followees and ranks again.
5. `/segments/<id>` shows Overall and Following tabs; the Following tab writes `?filter=following` with `history.pushState`, and `popstate` restores the board (brief: Interactions / Segment tabs).
6. Plans: `POST /api/subscription` writes a `trialing` subscription ending today plus 30 days (UTC) and sets `athletes.plan` and the subscriber flag; `DELETE` removes it (brief: API / Plans).

### 1.6 Follows and the feed (workflows `followers-feed-pages-newest-first`, `private-follower-denied-until-approved`, DP-30..DP-37)
1. Follow: public → `accepted` at once; private → `pending` and a follow request (brief: API / Follows).
2. The feed query selects the caller's own activities plus accepted followees' activities visible to the caller, ordered by `(start_time DESC, id DESC)`; the cursor is the base64 JSON of the last `(start_time, id)` (decided: keyset paging, so inserts never repeat or skip a walked row).
3. The dashboard renders 20 cards, then an IntersectionObserver on a sentinel fetches the next page (brief: Interactions / Dashboard paging).
4. `/athletes/<id>`: the Follow button reads Follow, Requested or Following from `follow_status` (brief: Interactions / Follow button).

### 1.7 Visibility and privacy zones (workflow `hidden-activity-and-zone-points-forbidden`, DP-38..DP-42)
1. One function `can_view(viewer_id, activity_row, owner_row)` decides visibility (brief: Business rules / Visibility; brief: Engineering standards / One home per rule); every activity route calls it and answers `404` when false, and every listing filters with the same rule in SQL generated by that module.
2. Patch, delete, export and history check ownership after visibility: visible but not owned → `403`.
3. Streams for anyone but the owner drop every point within `radius_m` of the zone centre from all four arrays (brief: Business rules / Privacy zones).
4. Non-integer, negative, fractional or overlong ids are parsed with a strict regex and answer `404` before any query (brief: API / Errors and limits).
5. `/settings/privacy` saves through `PUT /api/me/privacy` and shows "Privacy settings saved" in a `status` region.

### 1.8 Kudos and comments (workflows `duplicate-kudos-counted-once`, `comment-delete-forbidden-to-strangers`, DP-43..DP-51)
1. Kudos: `INSERT ... ON CONFLICT (athlete_id, activity_id) DO NOTHING RETURNING` decides `201` or `200`; counts are `COUNT(*)` reads, never counters (decided: derived counts stay correct under deletion cascades).
2. The kudos toggle updates optimistically, plays the pop, and on a refused POST restores the previous pressed state and count and shows the "Kudos could not be saved" alert (brief: Feedback states).
3. Comments trim text, accept 1..500 characters, list oldest first; delete is allowed to the author or the activity owner, else `403`.
4. A refused comment is never inserted into the thread; the field keeps the text and the "Comment could not be posted" alert shows (brief: Feedback states).

### 1.9 Challenges (workflow `challenge-progress-and-completion`, DP-52..DP-55)
1. The window is the current month in the caller's zone, converted to UTC instants (brief: Business rules / Challenge rules).
2. Progress sums or maxes qualifying own activities; completion walks activities in `start_time` order until the goal is reached and reports that activity's `start_time`; all computed on read (decided: deletion recomputes for free).
3. `/challenges` chips write `?filter=<slug>` with `pushState`; the ring is `role="progressbar"` named after the challenge with `aria-valuenow = min(100, floor(progress * 100 / goal))` (brief: Interactions / Challenge rings).

### 1.10 Stats and recap (workflow `weekly-stats-and-year-recap`, DP-56..DP-58)
1. Weeks start Monday 00:00 in the athlete's zone; `week_start` is that local date; empty weeks carry zeros (brief: Business rules / Stats rules).
2. The recap aggregates the year in the athlete's time zone, UTC by default (brief: Business rules / Recap rules, Time zones); `/recap` shows five cards, one at a time, with five segments and a `status` reading "Slide <n> of 5".
3. "Play recap" plays the `<audio>` track and advances every 5000 ms with `setTimeout` (decided: driven by the page clock so pausing clears the timer); Mute toggles `audio.muted`; under reduced motion nothing advances on its own.

### 1.11 Owner tools (workflow `owner-edits-exports-and-deletes-activity`, DP-59..DP-63)
1. `PATCH` writes one `activity_edits` row per field whose value changed, in a fixed field order (name, then visibility) with a per-row sequence (decided: keeps same-instant edits in order).
2. `export.gpx` writes every stored point with `lat`, `lon`, `ele` and `time` to seven decimals, one decimal and whole seconds (decided: re-parsing the export reproduces the figures).
3. The "Route position" slider is a custom `role="slider"` with `aria-valuenow` = point index and `aria-valuetext` = "<km to 2 dp> km, <ele rounded> m"; arrows step one point, Home/End jump.
4. "Play flyover" animates the marker with `requestAnimationFrame` over 8000 ms at 1x (brief: Interactions / Flyover), updates the `status` "Flyover at <km> km", and the button becomes "Pause flyover" with `aria-pressed="true"`; 2x and 4x shorten the run.

### 1.12 Visitor pages (workflows `visitor-home-media-and-motion`, `visitor-pages-accessible-and-deployed`, DP-64..DP-85)
1. Home: three panels, hero `<video muted loop playsinline>` with the captions `<track>`; under reduced motion the video has no `autoplay`, stays at frame 0 and a "Play video" button starts it (brief: Public screens and controls / Hero clip).
2. `/media/hero.vtt` is a static WebVTT file with one cue `00:00:00.000 --> 00:00:06.000` (decided: covers the opening of the clip) served as `text/vtt`.
3. `/assets/<file>` streams the four supplied files unchanged with `image/jpeg`, `video/webm` and `audio/ogg`.
4. Consent bar: Accept All, Customize and Reject Non-Essential all set `localStorage["pacely-consent-dismissed"]="1"` (decided: an essential preference, not an analytics identifier).
5. Unknown page addresses answer `404` with the not-found page and a "Back to home" link to `/`.
6. `GET /api/health` answers `200 {"status":"ok"}` once migrations and the seed have run.

## 2. Palette

| Role | Value | Basis |
|---|---|---|
| Page | `#FAFAF8` | brief: Visual design / Surfaces (near-white warm neutral); decided: hex |
| Card | `#FFFFFF` | brief: Visual design / Surfaces |
| Tinted band, table stripe | `#F3F2EF` | brief: pale warm grey; decided: hex |
| Hairline border | `#E5E3DE` | brief: light warm grey; decided: hex |
| Ink (headings) | `#1E1B18` | brief: near-black warm ink; decided: hex |
| Body text | `#4A4540` | brief: deep warm grey; decided: hex, 9.2:1 on white |
| Muted text | `#6E6862` | brief: mid warm grey; decided: hex, 5.4:1 on white |
| Subdued text | `#8F8881` | brief: light warm grey; decided: decorative or large text only |
| Primary orange | `#D93D00` | brief: vivid orange; decided: `#E34402` measures 4.12:1 against white, `#D93D00` reaches 4.55:1 at button size |
| Primary hover | `#B83300` | brief: darker burnt orange; orange text on white or page uses `#C23A00` (5.4:1) |
| Link | `#0A58CA` | brief: deep vivid blue |
| Error | `#C81E1E` | brief: vivid red |
| Success | `#4A6B00` | brief: deep olive green |
| Warning | `#B86E00` | brief: warm amber |
| Gold / silver / bronze | `#D4A017` / `#A7AEB5` / `#B0703A` | brief: medal tones, medals only |
| Hero gradient | black `#000000` at the edges, through deep maroon `#4A0E14`, to the ember red-orange glow `#FF4F1F` in the middle of the gradient (top to bottom: black → maroon → ember → maroon → black, the ember glow centred across the width below the type) | brief: "from black through a deep maroon to a vivid ember red-orange glow, the ember sitting in the middle of the gradient"; decided: hex, and the glow sits below the headline so white text never stands on ember |
| Chart accents | maroon `#6B1A22`, lemon amber `#F5C400`, navy `#14244B`, teal `#00A3A3`, sand `#E8DCC2` | brief: expanded palette; decided: hex |

## 3. Type

| Use | Value | Basis |
|---|---|---|
| Family | Inter, self-hosted WOFF2 under `/fonts/`, OFL-1.1 | brief: one open-licence grotesque sans served from the app's own origin; decided: Inter |
| Fallback | system-ui, -apple-system, "Segoe UI", Roboto, sans-serif | brief: Visual design / Type |
| Body | 15px / 24px, weight 400 | brief |
| Small | 14px | brief |
| Lede | 17px to 18px | brief |
| Caps label | 12px bold, uppercase, letter-spacing 0.08em | brief: size and weight; decided: tracking |
| Card title | 22px to 24px, weight 700 | brief: size; decided: weight |
| Hero headline | clamp(40px, 6vw, 72px), line-height 1.02, weight 900, two lines | brief: very large and tight on two lines; decided: values |
| Figures in tables | `font-variant-numeric: tabular-nums` | brief: Screens and layout / Responsive layout |

## 4. Shape and elevation

| Token | Value | Basis |
|---|---|---|
| Radius small (inputs, chips) | 4px | brief: small radius; decided: px |
| Radius medium (controls) | 8px | brief; decided: px |
| Radius large (cards) | 12px | brief; decided: px |
| Radius extra large (plan cards, primary buttons) | 20px | brief; decided: px |
| Pill | 999px | brief: calls to action are pills |
| Card shadow | 0 1px 3px of ink at 8% | brief: faint short shadow |
| Plan card shadow | 0 16px 40px of ink at 10% | brief: wide soft shadow |
| Sticky nav shadow | 0 2px 8px of ink at 8% | brief: soft drop shadow |
| Comparison table backdrop | 12px blur | brief: frosted blur |

## 5. Layout per viewport and breakpoints

| Breakpoint | Width | Layout | Basis |
|---|---|---|---|
| Phone | < 640px | one column; signup card before the photographs; nav becomes the left drawer; wide tables scroll in a frame; challenge cards one across | brief: Responsive layout |
| Tablet | 640px to 1023px | feature grids two across; challenge cards two across | brief |
| Laptop | 1024px to 1439px | dashboard gains its left athlete column; home three panels | brief |
| Wide desktop | ≥ 1024px | challenge cards four across | brief: "four across at desktop" and "on a wide desktop"; decided: four across from 1024px |
| Reflow floor | 320px | no sideways scroll | brief |
| Touch targets | 44 × 44 CSS px at 390px wide | | brief: Visual design / Touch targets |

## 6. Motion

| Moment | Duration | Easing | Reduced motion | Basis |
|---|---|---|---|---|
| Hero route line draw | 1600 ms once on load (stroke-dashoffset) | ease-out | drawn at once | brief: Named moments; decided: timing |
| Reveal on scroll (product images) | 500 ms, rise 16px and fade | overshoot curve, settles past and back | shown at once | brief: Scroll; decided: values |
| Feed card entrance | 320 ms, rise 8px and fade | ease-out | none | brief: Named moments |
| Kudos pop | 300 ms, scale 1 → 1.18 → 1, lift 2px | overshoot | none | brief: Named moments |
| Pulse ring behind featured plan | 3000 ms, infinite | ease-out | stopped | brief: three-second loop |
| Hero chevron drift | 1800 ms, infinite | ease-in-out | stopped | brief |
| Loading shimmer | 1200 ms, infinite | linear | stopped | brief |
| Map blinking point | 1000 ms, infinite | steps | stopped | brief |
| Drawer slide | 240 ms | symmetric ease-in-out | instant | brief |
| Link colour | 80 ms | linear | — | brief: as fast as a flicker |
| Button background | 150 ms | ease | — | brief: a touch slower |
| Opacity fades | 150 ms | ease | — | brief: brief |
| Card transform | 200 ms | ease-out | — | brief |
| Header hide/reveal | 200 ms translateY | ease-out | jumps | brief: Scroll |
| Flyover marker | 8000 ms at 1x via requestAnimationFrame | linear along distance | does not start on its own | brief: Interactions / Flyover |
| Recap advance | every 5000 ms | — | never advances on its own | brief: Interactions / Recap player |

Under `prefers-reduced-motion: reduce` every CSS animation and transition is removed (not shortened), so
`document.getAnimations()` holds nothing running (decided: the tests treat any running animation as motion).

## 7. States

| State | Behaviour | Basis |
|---|---|---|
| Upload refused | `role="alert"` with the server's reason, stays on `/upload` | brief: Feedback states |
| Kudos refused | toggle and count revert, `role="alert"` "Kudos could not be saved" | brief |
| Comment refused | not in the thread, text kept, `role="alert"` "Comment could not be posted" | brief |
| Login mismatch | inline message under the form | brief |
| Signup errors | `aria-invalid="true"` plus message per field | brief |
| Privacy saved | `role="status"` "Privacy settings saved" | brief |
| Empty trophy case / feed / recap year | section shown with zeros or "Nothing here yet" | brief: Empty states; decided: copy |
| Loading | shimmer placeholders sized to the cards | brief: Named moments |
| Not found | 404 page with "Back to home" | brief: Server boundary |

## 8. Seed

Seeded on first start in one transaction guarded by `INSERT ... ON CONFLICT DO NOTHING` (brief: Seed data,
idempotent). Harbor Climb runs (brief: Seed data / Seeded activities): three `run` activities visible to
everyone: Leo's "Harbor Climb Morning Run" at 2026-01-10T07:00:00Z (238 s), Ava's "Harbor Climb Tempo" at
2026-01-11T07:00:00Z (251 s) and Sam's "Harbor Climb Easy Run" at 2026-01-12T07:00:00Z (302 s). Each is eleven
points evenly spaced due north from the segment start to its end, elevation 10 to 50 m, times evenly spaced so the
effort time matches exactly. The start times lie in the past and outside the current month, so the runs count toward
no challenge and every new upload tops the feed. `pr_rank` 1 for each; `is_crown` true for Leo's only (recorded in
start-time order Leo, Ava, Sam).

## 9. Judged-criteria mapping

| Criterion | Requirement | What the golden shows | Basis |
|---|---|---|---|
| B1 | DP-64 | home three panels, white card, stacked buttons, orange route line over the clip | brief: Screens and layout / Home |
| B2 | DP-74 | sticky TRAIN/EXPLORE/COMPETE tabs with orange underline above the comparison table | brief: Features |
| B3 | DP-55 | promoted white card with Join Challenge beside an orange cover, chip row, two galleries | brief: Challenges |
| B4 | DP-29 | white timeline card under the hero, then four plan cards | brief: Subscribe |
| B5 | DP-83 | family and student plan cards, yes/no table, FAQ accordion | brief: Family, student |
| B6 | DP-83 | eight captains as initials, What's New cards with orange kickers | brief: About and What's New |
| B7 | DP-69 | white header layout and black consent bar on / and /challenges | brief: Global chrome |
| B8 | DP-76 | full-screen light SVG map, orange Harbor Climb line, filter, toggle, Create Route | brief: Maps |
| B9 | DP-33 | dashboard left column and feed cards with route drawings and figures | brief: Dashboard |
| B10 | DP-13 | large figures above the orange route with green start and chequered finish | brief: Activity page |
| B11 | DP-58 | full-screen recap card with five segments | brief: Recap |
| B12, B21, B22, B23 | DP-36 | Leo's profile: counts by the name; twelve-week chart; trophy case; activities list | brief: Athlete profile |
| B13, B14 | DP-81 | one orange; dark ember heroes | brief: Visual design |
| B15, B16, B17 | DP-82 | radii and shadows; two-peak logo and sport glyphs; Inter everywhere | brief: Visual design |
| B18 | DP-22 | gold medal and separate crown on Leo's Harbor Climb effort | brief: Visual design |
| B19, B20 | DP-84 | tablet two across, wide four across; phone signup first and table in its frame | brief: Responsive layout |
| S1 | DP-85 | upload handler stores only parser output | brief: Engineering standards / Server-side figures |
| Q1 | DP-85 | one `haversine()` in `geo.py` used by parsing, matching and zones | brief: One home per rule |
| Q2 | DP-85 | one `visibility.py` used by every route and listing | brief: One home per rule |
| Q3 | DP-85 | four unique constraints in the migration | brief: Database guarantees |

Motion, hover, focus, tab order and reduced motion are graded by pytest (DP-29, DP-33, DP-45, DP-58, DP-63, DP-67,
DP-68, DP-70, DP-73), never by the judge.

## 10. Media and licences

| File | Served at | Licence | Source |
|---|---|---|---|
| `assets/gravel-road.jpg` | `/assets/gravel-road.jpg` (`image/jpeg`) | public domain | Wikimedia Commons, US National Park Service photograph (decided: free, no credit, matches "riders on a gravel road") |
| `assets/marathon-runners.jpg` | `/assets/marathon-runners.jpg` | public domain | Wikimedia Commons, US Marine Corps photograph |
| `assets/cyclists.webm` | `/assets/cyclists.webm` (`video/webm`) | public domain | Wikimedia Commons, US Bureau of Land Management clip, first 10 s, audio stripped |
| `assets/music.ogg` | `/assets/music.ogg` (`audio/ogg`) | original | synthesised for the app (126 bpm, A minor) |
| `static/fonts/inter-latin-wght-normal.woff2` | `/static/fonts/...` | OFL-1.1 | Fontsource `@fontsource-variable/inter` 5.3.0 |

`/media/hero.vtt` is generated by the app: one cue `00:00:00.000 --> 00:00:06.000` (decided: opening of the clip), `text/vtt`.
