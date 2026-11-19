# TRUTH: Highwater Unit Finder (golden)

The brief made concrete. Every value says where it comes from: `brief: <section>` (copied verbatim) or `decided: <why>` (the brief
is silent; the reason ties it to the brief's intent).

## Journeys

### 1. Find a home by its view (brief: Journeys 1, Frontend / Interactions)

1. Landing `/`: the hero (HIGHWATER, the headline line and `Find your floor` on the ultramarine field, the live tower beside it) is
   followed by five full-height band sections, floors 36-38, 30-35, 20-29, 10-19 and 3-9, with giant cropped numerals 38, 35, 29, 19
   and 9, then the `Available now` tally and a footer (brief: Screens and layout / Landing). The tower camera descends from the roof (floor 38 at scroll 0) to the podium (floor 3 at 4,800 px); the field behind
   the tower swaps at each 960 px boundary; `Floor <n>` readout and canvas name `Highwater tower at floor <n>` with
   `n = 38 - round(35 * p)`, `p = min(scrollY / 4800, 1)` (brief: Motion / Landing descent).
2. `Find your floor` (yellow, dark navy text) goes to `/finder` (brief: Screens and layout).
3. In the finder the buyer ticks `3 bedrooms`, then quickly `Floors 20-29`. Each chip settles at once and runs one search; the
   address becomes `/finder?bedrooms=3&band=20-29` (one history entry per settled change); a reply to an older input is thrown
   away. Chip counts, rows, `Result count` (`<n> homes match`) and the lit cells update in place; `aria-busy="true"` while a search
   is in flight (brief: Interactions / Filtering).
4. Back lands on `bedrooms=3` without the floor band; Forward brings it back (brief: Filters in the address).
5. Sweeping the pointer over a lit cell shows the lens (224 px, centred on the pointer, lag 125 ms) with the unit's full-colour view,
   a yellow north tick, the chip `<code> · <bearing>° <facing> · <status>` and the matching row scrolled into view and marked
   `aria-current`; a dimmed cell shows `Outside your filters` instead of a view (brief: Window Lens).
6. `Show more homes` appends the next page; Notices says `<k> more homes. <shown> of <total> shown.`; focus lands on the first new
   row; loaded rows stay put while the tower re-reads every 5 s (brief: Paging).
7. Clicking cell 27C or its row pins it: the lens grows (360 ms) into the view panel of `dialog "Home 27C"`; the address gains
   `unit=27C` by replacing the entry (brief: Pinning).

### 2. Hold it before anyone else (brief: Journeys 2, Interactions / Holding)

Signed out, `Hold this home` opens `dialog "Sign in to hold"`. Creating an account (202 message) returns to sign-in with the email
filled; signing in closes the dialog, announces `Signed in.` and opens `alertdialog "Confirm hold"` (`Hold 27C at $<price>?` and
`No payment is taken. You can release the hold at any time.`) for the same home on the same address. Confirm sends the unit code and
the price version shown with a fresh `Idempotency-Key`. Until the 201 nothing reads `Held by you` and `My hold` is absent. On 201 the
dialog becomes the yellow confirmation (`This home is held for you.`, `Held until <end time>.`, `Open your hold`) and the cell, chip
and row read `Held by you`. A 401 closes the confirm dialog and opens `Sign in to hold` with the email filled and focus on Password;
after sign-in the same confirm dialog returns with focus on `Confirm hold` and no hold exists yet. `Open your hold` goes to
`/holds/<id>` (quoted price, price version, `hh:mm:ss` countdown on the server's clock); `Sign out` there lands on `/finder`.

### 3. Keyboard only (brief: Journeys 3, Interactions / Keyboard)

Tab reaches the tower grid as one stop (roving focus). Up and Down move one floor (stop at 38 and 3); Left and Right move one stack
and wrap between H and A (in the turntable the plan runs clockwise from right to left, so Right is the previous letter: decided,
so the arrow follows the screen). A stack on a turned-away face turns the tower first. Enter pins, Tab reaches `Hold this home`,
Enter on `Confirm hold`, focus lands on the confirmation heading, Escape returns focus to the starting gridcell. Tab wraps in every
open dialog; everything behind is hidden from assistive technology, unfocusable and ignores the pointer.

### 4. Lose the last one, or lose the reply (brief: Journeys 4, Interactions / Holding)

One winner per home is decided by Postgres (row lock on the unit, partial unique index on active holds). The loser sees
`Someone else holds this home now.` in the confirm dialog, the cell, chip and row turn `Held` at once, `Hold this home` is disabled,
and no tower re-read flips it back while the other hold is active. With no reply at all the confirm dialog says `We couldn't reach
Highwater. Your hold was not placed yet. Try again.`, `Confirm hold` is enabled again, and the retry resends the same key and body:
the stored first response is replayed and uses one attempt. A re-hold inside the cooldown answers 409 `hold_cooldown` with the end
time in sales-office time.

### 5. Agree with a partner (brief: Journeys 5, Server boundary)

`Create share link` shows the full link in the read-only `Share link` box; `Make a new link` kills the old one; releasing,
lapse, conversion or withdrawal kills the live one. `/shared/<token>` is sent `Cache-Control: no-store`,
`Referrer-Policy: no-referrer`, `<meta name="robots" content="noindex">`, title `Home <code> · Highwater` (dead: `Shared link ·
Highwater`) and fetches only `GET /api/shared/{token}`, its view image and static files. No name, email, hold id, start time or
price appears in its HTML or responses.

### 6. A hold runs out (brief: Journeys 6, Hold page)

The countdown ticks once a second from `endsAt - (browser clock + offset)` (offset: latest response `Date` minus browser clock).
At zero it shows `Checking...` and asks the server every 2 s; only a `lapsed` read shows `Your hold has lapsed. This home is open
to every buyer again.`, closes any open dialog and moves focus to the level 1 heading. Every read and write applies the lapse check
in Postgres first, so a release at or after `endsAt` answers 409 `hold_ended` and records the lapse at `endsAt`.

### 7. Coordinator's week (brief: Journeys 7, Console)

Signing in as a coordinator lands on `/console`: `Release floors 36-38` makes the band available, searchable and pinnable; `Save
price` sends integer literals with the loaded version (412 on a stale version, one winner for simultaneous saves) and adds a price
version row; `Upload photo` stores bytes as sent under `views/units/<code>/<md5>.<png|jpg>` and marks the unit photographed only after
a HEAD confirms size and MD5; `Withdraw unit` (after `alertdialog "Withdraw <code>?"`) ends any hold with end reason `withdrawal`,
removes the unit from search, counts, the lens and media links, and deletes its search document; `Convert <code>` makes the unit
reserved. Buyers see price changes and withdrawals in place within one re-read.

### 8. Search is down (brief: Journeys 8, Interactions / Search outage)

The first 503 shows the black `alert` banner (Notices silent), filter controls carry `aria-disabled="true"` and keep their checked
state, the finder retries every 10 s, no cell is dimmed, and holds still succeed with `Syncing` on cells, chips, rows and the
detail. On recovery the banner is removed, controls return in their previous states, results update, Notices says `Search is
back. <n> homes match.` and focus does not move.

## Palette (brief: Visual design / Colours; hex decided where the brief names a hue)

| Role | Hex | Use | Source |
|---|---|---|---|
| ground | `#2A1FD0` | deep ultramarine field, chips off, input borders | decided: between royal blue and violet |
| surface | `#3B2DE6` | alternating result bands, landing stage in dark zones | decided: slightly brighter ultramarine |
| ink | `#FFFFFF` | all text on ground and surface, chips on, detail field | brief: Colours |
| muted | `#CFCAF7` | secondary text, dimmed and unreleased cells, hatch stripe | decided: pale lavender |
| accent | `#FFE600` | the one yellow action, hover frame, current-row mark, north tick, focus ring, hold confirmation and hold page | decided: flat lemon yellow |
| on-accent | `#0B0A3A` | text on yellow | decided: very dark navy |
| black | `#000000` | outage and error banners | brief: Colours |
| tally green | `#0B6B3A` | the landing `Available now` section only | decided: flat deep green |

## Type, space and shape

| Item | Value | Source |
|---|---|---|
| Headings, unit codes, numerals | Red Hat Display 900, uppercase | brief: Type |
| Body | Red Hat Text 400 and 700; tabular figures for prices, areas, bearings, times, countdown | brief: Type |
| Heading scale | h3 1.25rem, h2 1.875rem (x1.5), h1 2.8125rem (x1.5) | brief: Type (each level 1.5x) |
| Hero headline | 5.4vw (about 6% of the window width), line-height 0.92 | brief: Type |
| Outer margin | 16 px | brief: Composition |
| Corner radius | 0 everywhere; only the lens circle is round | brief: Shapes |
| Controls | at least 44 px in both directions (tower cells excepted) | brief: Composition |
| Focus ring | 3 px yellow, 3 px offset, navy underlay | brief: Focus |

## Layout per viewport (brief: Frontend / Screens and layout)

| Viewport | Finder |
|---|---|
| 1280x800 | Filters pane (about a fifth), fixed Tower stage, Results pane side by side with aligned tops; no Filters button |
| 768x1024 | Tower stage left, Results right; filters in a sheet from the header's Filters button; detail a dialog over Results |
| 375x812 | Tower stage full width at the top, in the first viewport; Results below; filters in the same sheet; the lens is a fixed inset in a reserved box at the stage's top right and the tower is drawn clear of it; detail is full-screen |

Breakpoints: phone below 768, tablet 768 to 1099, desktop from 1100 (decided: the three published viewports map to one class each).

## Motion (brief: Motion and effects)

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| Lens position | pointer or focus moves | 125 ms (band 100-150) | ease-out cubic | snaps |
| Lens view | unit under the lens changes | 220 ms (band 150-250), only the newest photograph fades in | ease-out quad | swaps |
| Lens grow | pin | 360 ms (band 300-400) | ease-out cubic | opens at once |
| Tower turn | Turn left/right, keyboard step, drag release | 350 ms (band 300-400) | ease-out cubic | snaps (drag stays direct) |
| Filters sheet | open or close | 250 ms (under 333) | ease-out cubic | snaps |
| Landing camera | scroll over the first 4,800 px | scroll-linked | linear | one still pose per band (floors 38, 35, 29, 19, 9) |
| Giant numeral or word | scroll, while its section enters the window | slides at most 8% of the window width, then stops | linear | none |

All graded motion is `requestAnimationFrame` tweening stepped by the page clock. No idle motion anywhere.

## States per async action (brief: Feedback states)

Search, paging, create account, sign in, sign out, hold, open-home re-read, release, share, view photograph, tower models and every
console action use exactly the published pending, success and error copy; every API error shows the response `message` character for
character (field errors beside the control with `aria-invalid` and `aria-describedby`).

## Media (brief: Backend / Services, Seed data)

All binaries are generated for this app by `tools/generate-seed-assets.ts` (licence `original`): the Draco-compressed tower shell
and five floor-plate models, the two-colour facade and duotone-ramp textures, and 31 full-colour 1536x512 view photographs. Fonts:
Red Hat Display and Red Hat Text (OFL-1.1, Fontsource). Icons: Lucide (ISC). The Draco decoder is the one shipped with three.js
(Apache-2.0). See `app/THIRD_PARTY_NOTICES.md` and `app/assets.json`.

## Decisions where the brief is silent

- Landing: the hero fills the first window and each of the five band sections after it is 960 px tall, so a band section starts to
  enter the window exactly at its 960 px scroll boundary, when the field behind the tower swaps (decided: the brief gives each band
  section 960 px of scroll and swaps the field at each boundary).
- Landing left-hand fields: hero ground, then surface, white, ground, white, ground for the five bands (decided: the brief asks that
  no two neighbouring sections share a field colour, and the hero and the first band are both ultramarine, so the first band takes
  the brighter surface).
- Landing with reduced motion or no WebGL: the hero shows the roof band's pose and floor 38 until a band section fills more of the
  window (decided: the hero is not a band, and the brief starts the camera at floor 38 at the top of the page).
- The Notices message clears after 12 s (decided: a stale message should not stay forever).
- Gridcells draw the window pane of the facade texture; the cell around it is the hit area (decided: shading of the 3D shell stays visible).
- Anything behind an open modal is hidden with `aria-hidden`, `tabindex=-1` and a capture-phase pointer guard rather than the `inert`
  attribute (decided: `inert` removes the page from hit-testing, so the page behind could not be shown to be unclickable).
- The session cookie is a session cookie (`HttpOnly; SameSite=Lax; Path=/`, no `Max-Age`): the server decides, on the app clock, when
  a session ends, so a client whose own clock or cookie jar disagrees can never keep a session alive or drop one early (decided:
  DP-18 puts the expiry on the app clock).
- The finder tower is drawn by a level perspective camera beside the tower at mid-height, wider than its true plan (horizontal stretch up to 2.6x, same maths in the scene and the
  cell grid) so a window cell is large enough to hover and read; each DOM cell is skewed onto its face's quad so floors converge away from eye level (decided: the brief says a
  live 3D model, not a picture laid over a spreadsheet). Held and reserved hatching is compensated for that skew so it stays 45 degrees and 6 px on screen (brief: Visual design / The tower).
- The tower is drawn only in the two field colours, ultramarine `#2A1FD0` and white `#FFFFFF`: the face turned to the light takes the light tone, every other face the shade tone with a hard edge between them;
  window panes and floor plates take the opposite tone to their wall, and a 2 px line in the colour opposite the field runs round the silhouette so shaded faces do not vanish into the field. The two swap on the
  white field (brief: Visual design / The tower for the colours; decided: opposite tones and the line keep the tower readable). Windows are drawn only on faces that also show gridcells.
- On the landing the numeral and the band copy stay pinned to the bottom of the window while their section passes (decided: a section is 960 px tall and would otherwise stand empty).
- The lens chip sits beside the lens when it fits in the tower stage, otherwise under or over it (decided: the brief says only "beside"; a clipped chip is unreadable).
- The hovered cell's 3 px yellow frame is drawn on the cell, under the lens. The brief centres a 224 px lens on the pointer and makes the north tick the only yellow inside the lens
  (brief: Interactions / Window Lens; Visual design / Colours). Hovering always draws the frame on the unit's cells (L318); because the lens is centred on the pointer (L319) it lies on top of the hovered cell, so the frame is seen round the lens edge and in full once the pointer moves off or the home is pinned.
- Every unit and hold state change is written in `server/transitions.ts` inside one Postgres transaction with the unit row locked,
  the lapse check applied first and the pending index update queued (decided: one place for each domain rule).
