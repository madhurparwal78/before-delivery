# TRUTH — Niner Hall Runup Bay (golden)

Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>` (the brief is silent).

## Journeys, end to end

1. **Opening a class** (brief: Journeys 1). Start: a verified instructor with a school and an empty class. Actions: `Student emails` takes addresses
   separated by commas or new lines, `Send invitations` shows `Sending...` then `Invitations sent: <n>`; each address counts as sent only after
   Mailpit accepts its mail (subject `Join <class name> on Runup Bay`, one link `/invite/<token>`). The student opens the link, gives `Name` and
   `Password`, `Join class` shows `Joining...` and lands on `/classes/<id>` (a reload stays there). The instructor imports a layout at `/aerodromes`
   (`Checking layout...`), faulty lines appear in `list "Import errors"` (`Line 42: segment P1T ends at unknown node Q7.`), a valid file lands on
   `/aerodromes/<id>` with the map and `Download original` returning the exact stored bytes. A scenario is saved (`Scenario saved.`), assigned from the
   class page (`Assignment saved.`). End state: the class page lists the student and the assignment row with `Start exercise`.
2. **Working Ground** (Journeys 2). A Ground student opens a session: strips in Pending. Tab lands on the first strip, `Ctrl+Right` pre-fills
   `<CS> PUSH APPROVED` and focuses the line (nothing changes until accepted), Enter sends: the strip moves to Pushback and takes focus,
   `status "Readback"` shows `Push approved, <CS>.`. After `PUSH_SECONDS` the aircraft is `ready`; the next pre-fills are `TAXI HP <hp> VIA <taxiway>`
   and `CONTACT TOWER`. End state: a strip in Hand-off (`data-state="offered"`) with an open offer, a copy in the Tower board's Incoming bay.
3. **Seeing the taxi** (Journeys 3, Motion: Centreline Run). Each change of the command text posts the text to `/preview` at once; only the latest reply is
   shown; the route segments get `data-lit="preview"` one per 90 ms, the stop bar 200 ms after the last, R4 segments hatch with `data-conflict="R4"`;
   an accepted `TAXI` turns the segments `data-lit="accepted"` for that seat and each goes dark as the aircraft leaves it.
4. **Working Tower** (Journeys 4). The Incoming copy pulses (3 cycles, 1.2 s); `Accept <CS>` / `Ctrl+Right` / a drag to Holding moves it. `LINEUP` and
   `CLEARED TAKEOFF` are accepted even when early; R8 alone is raised if the runway is closed, otherwise R1, then R2, then R3, each penalised; the alert row appears on all three screens.
5. **Running events** (Journeys 5). The console (tabs on phone) pauses, resumes, sets speed, injects closure, reopen, go-around, emergency, wind; every
   client changes at once from the server push; half-typed lines and half-filled event forms are untouched by pushes.
6. **Wrong readback** (Journeys 6). Seeded errors follow `(seed + SIM_SEED_OFFSET + n) % every == 0`; `NEGATIVE HP <p>` / `NEGATIVE RUNWAY <r>` inside
   `READBACK_CORRECT_SECONDS` closes it, otherwise R7 is raised on that tick.
7. **Debrief** (Journeys 7). `End exercise` writes `Exercise ended.`; every client shows `link "Open debrief"` to `/sessions/<id>/debrief`: score, result,
   breakdown, timeline and the replay slider (Arrow keys 1 s, PageUp/PageDown 60 s, Home/End) that snaps with no animation.
8. **Record** (Journeys 8). `/records/<student id>` lists attempts, best on-time score and status per assignment; `Export CSV` / `Export PDF` store the
   file in MinIO first, then send one notice per session and kind, then answer with `X-Report-Notice: sent|not-sent|repeat`
   (`Report saved. Notice sent.`, `Report saved. Notice not sent.`, `Report saved.` for a repeat).

## Backend facts (all from the brief)

- Rule engine in `src/server/domain/`: one grammar (`grammar.ts`), one planner for preview and execution (`planCommand`), one rule table (`rules.ts`),
  one score (`scoring.ts`). Sim clock, strips, aircraft and the log are persisted in Postgres on every operation; replay frames per sim second.
- Tick order, movement metres per tick, handoff, wake minimums, penalties and score as in brief: Business rules.
- Outages: MinIO down gives `503 storage_unavailable` with the three published messages and nothing kept; Postgres down gives
  `503 database_unavailable` on API routes other than health (`/api/config` included); Mailpit refusing gives `503 mail_unavailable`.

## Palette roles (hex the build uses)

| Role | Hex | Source |
|---|---|---|
| ground | `#2a0a18` | brief: Colour "very deep burgundy" |
| surface | `#46132d` | brief: Colour "one step lighter burgundy" |
| surface-high | `#5c1d3f` | decided: hover and pavement need a third step, still one hue |
| ink, accent | `#ff92cc` | brief: Colour "bubblegum pink" |
| muted | `#d097b6` | brief: Colour "dusty rose" |
| rule | `#98587b` | decided: dashed guides at 3:1 on ground |
| text-on-accent | `#2a0a18` | brief: Colour |

No red, amber, green or white (brief: Colour).

## Type

Stack Sans Headline 300 for display, Stack Sans Text 400/600 for body, Spline Sans Mono 400 only in the clearance line, grammar help and literal clearances
in logs (brief: Type). Body 15px, heading steps ×1.25 (15, 18.75, 23.4, 29.3, 36.6). Landing headline `calc(100vw / 14)` capped at 91px
(brief: Landing page 1). Tabular figures for timers and scores.

## Space, layout per viewport

| Viewport | Layout | Source |
|---|---|---|
| 1280x800 | container 1280px with dashed guides; position page board / map / alerts side by side; console both boards side by side, map and controls below | brief: Screens and layout |
| 768x1024 | `data-layout="tablet"`; tabs Board and Map with alerts under; console tabs Clock, Events, Alerts, Boards; 44px controls | brief: Screens and layout |
| 375x812 | `data-layout="phone"`; tabs Board, Map, Alerts; bays stack as full-width rows (decided: six columns do not fit 375px); debrief tables reflow to labelled lines with table roles kept | brief: Phone rules; decided |

Landing hero: four columns by two rows of dashed guides, headline over columns 1 to 3 of row 1, the clearance in column 4, the Wrenfield schematic over
columns 1 to 3 of row 2, the solid pink `Open your school` cell in column 4 of row 2; on a phone the pink cell follows the headline (brief: Landing page).

## Motion table

| Element | Trigger | Duration | Easing | Reduced-motion substitute | Source |
|---|---|---|---|---|---|
| strip | changes bay | 250 ms, `data-motion="move"` | cubic-bezier(.2,.8,.2,1) | drawn at once, no marker | brief: Motion list |
| new strip | appears | 250 ms fade up | same | none | brief: Motion list |
| aircraft symbol | sim position changes | 1000 / speed ms, `data-glide-ms` | linear | `data-glide-ms="0"`, one frame | brief: Motion list |
| Incoming strip | offer opens | 1200 ms, `data-motion="pulse"` | ease-in-out | `data-outline="static"` 2000 ms | brief: Motion list |
| alert row | new alert | 250 ms, `data-motion="alert"` | cubic-bezier(.2,.8,.2,1) | no slide | brief: Motion list |
| board region | R5 raised | 600 ms, `data-motion="flash"` | two flashes | `data-outline="static"` 2000 ms | brief: Motion list |
| route segment | typed taxi | 90 ms per segment, stop bar +200 ms, retract 250 ms | none | end state in one frame | brief: Centreline Run |
| score numeral | debrief loads | 400 ms CSS counter | ease-out | final value | brief: Motion list |
| loading guides | page fetch | 400 ms once | ease-out | static | brief: Motion list |

Markers are set and cleared by browser timers; pushes render with no timer (Preact renders in a microtask and the app uses layout effects).

## States per async action

As in brief: Feedback states (`Saving...`, `Signing in...`, `Sending...`, `Joining...`, `Checking layout...`, `Injecting...`, `Pinning...`,
`Preparing report...`; successes and failure alerts verbatim). Connection loss shows the hatched `Connection lost. Reconnecting...` cell.

## Breakpoints

600 and 1024 px (brief: Screens and layout).

## Media

None. The map, the landing schematic, hatch and the dither field are drawn in code. Only fonts are binary assets, all OFL-1.1 (`app/assets.json`).
