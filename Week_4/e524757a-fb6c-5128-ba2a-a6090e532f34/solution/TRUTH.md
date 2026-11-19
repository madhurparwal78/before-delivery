# TRUTH — Marram & Wick Hushfoot (golden)

The brief made concrete. Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>`.
Design tokens: `DESIGN.md` and `app/client/styles/tokens.css`. Build plan: `PLAN.md`.

## Journeys (ideal end-to-end flow)

### 1. First steps (DP-01..DP-07)
- Start: signed in as `explorer` of a grading world at tick 6000, on `/` (brief: Journeys 1, Seed data).
- Tab order on `/`: `Hushfoot`, `Islands`, `Text world`, `Account`, `Start walking`, `Guide creature`, `Reset view`, `Sound`, `Demo zoom`, `Demo focus` (brief: Interactions, Title screen Tab order).
- On `Guide creature`: ArrowRight x2 gives `data-spin="30"` and `Guide status` `Wump faces 30 degrees.`; `+` gives `data-zoom="1.25"` and `Wump at 125 percent.`; Space gives `data-nudges="1"` and `Wump hops.` (brief: Keyboard table, Feedback states).
- Pointer drag: 15 degrees per 20 px, stretch = distance / 200 capped at 1, springs back to `0.00` within 600 ms of page time (brief: Guide creature by pointer). decided: spring is a 500 ms ease-out to stay inside 600 ms.
- `Start walking` goes to `/play`; World view on spot 1 (3,12 facing E) of Saltmarsh Harbour; `World status` `You are on Saltmarsh Harbour. 3 of 4 album pages filled.` (brief: Seed data, Feedback states).
- Hold D 400 ms: 3,12 -> 4,12 (step 1) -> 5,12 (step 3), `data-gait="walk"`. R then hold D 400 ms: 6,12 .. 9,12, `data-gait="run"` (brief: Movement, DP-05).
- From 7,5 hold S: rock 7,6 stops it, heading S. Space: lands on 7,7 on the 4th step, `data-gait="jump"` through it (brief: Movement).
- Q/E orbit -/+90, `+`/`-` zoom 1..4, Home = heading angle and zoom 2 (brief: Keyboard table).
- End: reload shows the same `data-tile`; `PUT /api/me/position` stored the last land tile (brief: Position).

### 2. Phone expedition (DP-08..DP-14)
- 375x812 touch: World view fills the screen, `group "Joystick"` bottom left, `Run` and `Jump` bottom right (brief: Play page by width).
- Joystick move >= 16 px north held 400 ms walks 2 tiles; Run pressed makes it 4; Jump runs the 4-step jump (brief: Touch and pointer).
- Map sheet (full-width bottom sheet, modal): tapping 12,10 from spot 1 walks 3,11, 3,10, 4,10 .. 12,10 (brief: Walking to a spot).
- Two-finger sideways: 1 degree per 2 px of midpoint, halves rounded up; pinch 40 px per zoom step (brief: Touch and pointer).
- `Close map`, `Close album`, `Close` hide the sheet (`hidden`, out of the a11y tree and Tab order) with focus on the opener (brief: DP-13).
- `Camera`, `Zoom in`, `Focus`, `Take photo` keep a photo; result bottom sheet shows rows Size, Centring, Facing, Sharpness and total.

### 3. Lens Up (DP-15..DP-28)
- `/play?island=1&spot=2`: 12,10 facing N, saved on load (brief: Links).
- C: `data-mode="photo"`, `data-yaw="0"`, `data-zoom="1"`, `data-focus="4"`, `data-in-view="mossback-newt"`, `Frame guide` `Mossback newt in frame` (brief: Lens Up, DP-16).
- `+` -> zoom 2; Enter: page renders one frame, captures <= 960 px JPEG, sends multipart `POST /api/photos` (`image`, `pose`) with a new `Shot-Key` (brief: Lens Up 2).
- `Photo status` `Scoring…` while pending; then `Mossback newt: 100 points. Size 30, centring 25, facing 25, sharpness 20.` then `Album page filled: Mossback newt.` (brief: Feedback states).
- `dialog "Photo result"` opens, focus on `Close`; `score-total` counts 0 -> `100 / 100` over 600 ms; `film` counts 30 -> 35 (spent 1, page returned 6) (brief: Figures, Film).
- Provider: one `photos` row (total 100), MinIO object `photos/<id>.jpg` byte-identical, `film_ledger` pairs `photo` -1 and `page` +6 (brief: Photo state machine, Film).
- Escape closes the result with focus on `World view`; J opens the album: Saltmarsh Harbour `4 of 4 pages`, image from `/api/photos/<id>/image`; the player's other tab shows it live over `/api/live`.
- Refusals stored nothing and keep film: order 413, 415, 409 `out_of_film`, 409 `shot_key_reused`, 422 `bad_pose`, `tick_passed`, `tick_ahead`, `cannot_stand`, `camera_too_far`, `nothing_in_frame`, 503 `storage_unavailable` (brief: POST /api/photos).

### 4. Dusk and rain (DP-29..DP-35)
- Two contexts in one grading world: same `data-tick`, `data-weather`, `data-creatures` (brief: DP-29).
- tick 6000: `10:00`, clear, `mossback-newt@12,6,S;reedpipe-heron@6,16,E` on island 1 (brief: DP-30).
- clock route 6030: `reedpipe-heron@9,16,E` within 2 s, pushed at once (brief: Grading routes).
- tick 11000: `18:20`, `Dusk falls on the islands.`, `gloamfin-moth` present and in frame from spot 4 (brief: World clock, worked example 5).
- tick 4000: `06:40`, `Rain begins on the islands.`, `data-weather="rain"`, `puddle-lark@4,4,S`; leaving rain hours announces `The rain stops.` (brief: Feedback states).
- The page never advances the tick and ignores the device clock (brief: World clock).

### 5. The last stamp (DP-36..DP-42)
- explorer at 2 stamps, 3 of 4 pages: worked example 1 fills the newt page, earns the Saltmarsh Harbour stamp, 3 stamps open the lighthouse (brief: Albums).
- `Photo status` `Album page filled: Mossback newt.`; `World status` `Stamp earned for Saltmarsh Harbour. You have 3 stamps.` and `The lighthouse at Lantern Point is open.`; `data-lighthouse="open"` in every tab.
- `Restart expedition` -> `alertdialog "Restart the expedition?"` `Start the whole expedition again?`; `Restart`: albums, stamps, lighthouse cleared, film 36 (`restart` pair), Saltmarsh Harbour spot 1, address `/play`, `Expedition restarted. You are on Saltmarsh Harbour.` in every tab within 2 s; photos and the hall stay (brief: Restart).
- `Refill film` sets 36 only on Saltmarsh Harbour (`refill` pair); elsewhere `not_at_harbour`, at 36 `film_full` (brief: Film).

### 6. Hall and safari (DP-43..DP-56)
- `/hall`: Alt+ArrowDown on heron moves it to frame 2, `Reedpipe heron photo moved to frame 2 of 3.`; `Save hall` keeps order (brief: Hall editor).
- `/hall/<handle>`: visitor on 2,13 facing N; W 400 ms -> 2,11; walls stop it (brief: Hall floor).
- `friend` likes: one `likes` row; owner page `likes` figure `1 like`, `Gallery status` `<visitor name> liked your Reedpipe heron photo.` once (brief: Hall likes).
- `switch "Public hall"` off: hall page `No gallery here`, API, like route and images shown only there answer 404 (brief: Hall).
- Safari: `friend` types the code (upper-cased), `You joined <host name>'s safari.`; host sees `<guest name> joined your safari.`; host moves arrive as `data-host-island`/`data-host-tile`; map S marks `Sighting at <x>, <y> by <host name>`; host photos appear in `log "Safari feed"` (brief: Shared safari).
- Second joiner gets 409 `safari_full`; a closed guest page frees the seat between `SAFARI_SEAT_RELEASE_SECONDS` and +3 s; no app session left active or idle in transaction (brief: Shared safari).

### 7. Board and notes (DP-57..DP-63, DP-71..DP-77)
- `/board`: `Pin note` posts `{text}` with one `Request-Key`; author sees the literal text with `Waiting for a ranger` (brief: Notes, Text is literal).
- `/ranger`: `Approve` -> every open board shows it within 2 s, `New note on the board.`; author hears `Your note is on the board.`. `Decline` dialog -> `Your note was declined: Shares personal details.` (brief: Feedback states).
- Second ranger: 409 `note_decided` `Already approved by <ranger name>.` (brief: Error catalogue).
- 141 characters: `note_too_long`; 140 accepted; `newcomer`: 403 `unconfirmed` (brief: Notes, Confirmation).
- `/boards/1`: `Enter a photo` dialog, radio `Reedpipe heron photo, 74`; ranking total desc, tick asc, entry first; `friend` 74 at 5100 above `explorer` 74 at 5200; `Board updated. <player name> is now number 1.` (brief: Challenge boards).
- Filter: one `GET /api/boards/1?player=<text>` 250 ms of page time after the last key; older answers ignored; failure `Couldn't load the board. Try again.` stays until a load succeeds (brief: Filter).

### 8. Postcard to a grandparent (DP-64..DP-70)
- `Send postcard` dialog: `Recipient email`, `Your line`, `Post` (one `Request-Key` per draft); `Posting…` then `Postcard posted.` only after Mailpit accepted (brief: Postcards).
- Mailpit: from `MAIL_FROM`, subject `A postcard from <sender name> on <Island name>`, text body with the line as typed, `<Creature name>, <total> points`, `<APP_PUBLIC_URL>/postcards/<id>`, no HTML part, no Reply-To, the stored image attached with its exact bytes, no sender address (brief: Mailpit).
- `/postcards/<id>` signed out: image from the app origin, creature, score, island, line, `Sent by <sender name>` (brief: Public screens).
- storage-down: 503 `Storage unreachable. Postcard not sent.`, no mail; short-limits: third postcard 429 `You can send 2 postcards an hour. Try again later.` with `Retry-After` (brief: Postcards).
- `newcomer`: `Send a new code` -> Mailpit `Your Hushfoot confirmation code`, `Your code is <code>.`; `/confirm` -> `Email confirmed.` (brief: Confirmation).

## Palette roles (hex used by the build)

| Role | Hex | Source |
|---|---|---|
| ground | #ffffff | brief: Visual design ("pure white ground") |
| surface | #f2f2f2 | brief: Visual design ("pale neutral grey surface"); decided: hex for AA with ink and muted |
| ink | #0b0b0c | brief: Visual design ("near-black ink") |
| muted | #55585f | brief: Visual design ("mid grey for muted text"); decided: 7.1:1 on white |
| accent | #d81e17, text #ffffff | brief: Visual design ("signal red accent, with white on it"); decided: 5.1:1 |
| error band | #0b0b0c with #ffffff | brief: Visual design ("Errors are a solid black band with white text") |
| focus ring | #0b0b0c, 3 px | decided: red is reserved for three roles |

## Type, space, layout

- Albert Sans (bundled woff2, OFL), body 16 px / 1.5; heading steps x1.25: 16, 20, 25, 31.25, 39.06, 48.83 px (brief: Visual design). Figures use fixed digit cells (equal-width digits).
- Spacing 4, 8, 16, 24, 40, 64 px; radius 4 px (round joystick excepted); 2 px ink borders; no shadows or glass (brief: Visual design; decided: values).
- Targets >= 44 px at 375x812 and 768x1024 (brief: Screens and layout).

| Viewport | Layout | Source |
|---|---|---|
| < 768 px (375x812) | title halves stacked around a 4:3 frame; World view full screen, joystick bottom left, Run/Jump bottom right; map, album, result as full-width bottom sheets, one at a time | brief: Screens and layout |
| 768-1199 px (768x1024) | split headline around a 35% wide 16:9 viewfinder; map or album as a 360 px right side sheet; touch controls only with a coarse pointer | brief: Screens and layout |
| >= 1200 px (1280x800) | map and album side by side in one non-modal right panel 40% wide, `separator` 30..70 start 50; result 360 px side sheet | brief: Screens and layout |

## Motion

| Element | Trigger | Duration | Easing | Reduced-motion substitute | Source |
|---|---|---|---|---|---|
| camera to eye (`data-camera`) | enter photo mode | 320 ms | ease-out cubic | final on next frame | brief: Motion; decided: easing |
| framing guide (`data-guide`) | photo mode | 180 ms `drawing` then `drawn` | ease-out | `drawn` at once | brief: Motion |
| shutter bars (`data-shutter`) | photo taken | 210 ms `moving` | ease-in-out | stays `idle`, no animation | brief: Motion |
| Scoring thumbnail | after shutter | until the answer | ease-out pin | appears without motion | brief: Motion |
| figures | value changed | 600 ms | ease-out cubic | final text at once | brief: Motion |
| sheets | open/close | 280 ms by script | ease-out cubic | cut | brief: Motion ("under a third of a second") |
| Wump hop / stretch / breath | Space / release / idle | hop 400 ms, spring 500 ms, breath every 3-5 s | ease-out | no hop, stretch 0.00 at once, no breath | brief: Motion |
| grass sway, fireflies, rain rings | world | 2-4 s cycle | sine | stopped | brief: World, Reduced motion |
| landing reel | scroll | step per statement | ease-out | static stack | brief: Landing reel |

All on page time (rAF, `performance.now`, timeouts); nothing waits for a CSS transition event (brief: Page time).

## States per async action

| Action | Pending | Success | Error / outage | Source |
|---|---|---|---|---|
| Take photo | `Scoring…`, further presses ignored | result dialog + success line | catalogue message in `Photo status`, no result; network `Couldn't reach the islands. Try again.` | brief: Lens Up, Feedback |
| Pin note | `Pinning…`, presses ignored | `Note pinned.`, box empties, focus kept | black band in `Notes status` | brief: Postcard and note |
| Post | `Posting…`, presses ignored | `Postcard posted.`, dialog closes, focus to opener | black band in `Postcard status` | brief: Postcard and note |
| Save hall | `Saving hall…` | `Hall saved.` | `Gallery status` | brief: Feedback |
| Save settings | busy button | `Settings saved.` | `Couldn't save settings. Try again.` | brief: Feedback |
| Join safari | busy `Join` | `You joined <host name>'s safari.` | `Safari status`, focus kept in field | brief: DP-51 |
| Board load | guide corners | `<n> entries` / filtered line | `Couldn't load the board. Try again.` kept until success | brief: Filter |
| Send a new code | busy | `New code sent.` after Mailpit | `Couldn't send the code. Press Send a new code to try again.` | brief: Feedback |
| Health | — | `{"status":"ok"}` | `{"status":"unavailable"}`, always 200 within 2 s | brief: Deployment |

Touch controls from 768 px: brief: Play page by width ("Joystick, `Run` and `Jump` show only when the primary pointer is coarse").
decided: shown when `(pointer: coarse)` matches and `navigator.maxTouchPoints >= 2`, because the touch scheme includes the
two-finger orbit and pinch, which a single-point touch surface cannot perform. Below 768 px they always show.

## Breakpoints

phone < 768 px; tablet 768-1199 px; desktop >= 1200 px (brief: Screens and layout).

## Media and licences

| Asset | Licence | Source |
|---|---|---|
| Albert Sans woff2 (latin, latin-ext) | OFL 1.1 | brief: Visual design; github.com/usted/Albert-Sans via Fontsource; listed in `app/assets.json` and `THIRD_PARTY_NOTICES.md` |
| islands, explorer, creatures, Wump, sky, water, grass, particles | original | generated by `app/client/engine/*` with three.js (brief: World) |
| ambience and effects sound | original | generated Web Audio buffers (brief: Sound graph) |
| still map without WebGL | original | SVG drawn from the tile data (decided: brief requires an image of the island) |
| landing coast pictures | original | decided: brief allows scenes rendered from the world when CC0 coast photographs are not obtained; none bundled |
