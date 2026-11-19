# TRUTH — Quarkyard golden

Ground truth of the golden app. Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>`.
Exact palette, type, space and motion tables live in `DESIGN.md`; this file is the behaviour and the values the build uses.

## Journeys (start state, actions, visible end state, provider-recorded end state)

1. **Setting up a term** (brief: Journeys 1). Start: Dana (verified Educator) on `/dashboard`. Focus `Create classroom`, Enter: dialog `Create classroom`
   opens with focus on `Classroom name`; the three time fields are empty with placeholders `Now`, `14 days after Join opens`, `70 days after Join opens`.
   Type `Space Camp`, Enter: `POST /api/classrooms` (time zone preselected `America/Chicago`, or the zone of the most recent classroom). End: page `/classrooms/<id>`
   with focus on the h1 `Space Camp`, state `Open for joining`, empty roster with doodle + `Show join code`, Status `Created Space Camp`. Postgres: one classroom row, a 6-character code from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, join closes = opens + 14 days, hand-in = opens + 70 days at the same local wall time.
2. **Joining on a tablet** (brief: Journeys 2). `/join`: type code (any case, spaces and hyphens ignored), Tab, nickname, Enter. `POST /api/join/code` (pending session) then `POST /api/join/nickname` (new cookie value, Student session). End: `/class`, Status `Joined <classroom> as <nickname>`, `Hand-in in <d>d <h>h <m>m`. The instructor roster gains the tile and Status `<nickname> joined` within 2 s without reload. Same nickname in another case: `That nickname is taken in this classroom.` under `Nickname`.
3. **Building and handing in a 3D part**. `B`, `C`, size (`Width (mm)` 10), `H`, Ctrl+A, Ctrl+G: worker union minus hole, one `group` object of volume 6429 (brief: Business rules), Status `Grouped 2 shapes`; arrows nudge, `R` rotates 15 degrees, `L` aligns, `W` sets the workplane; Ctrl+S: Status `Saved revision 1`, snapshot at `projects/<id>/rev-1.json`. Roster tile `Rev 1` live. When server time passes the hand-in time the next save answers `classroom_handed_in` and the tile reads `Handed in`.
4. **Wiring a night light**. Parts `Battery`, `LED`; wire by terminal buttons (Enter on `BAT-1 + terminal`, Status `Wiring from BAT-1 +`, Enter on `LED-1 + terminal`, Status `Wired BAT-1 + to LED-1 +`); `Start Simulation`: LED straight on 9 V burns out (280.0 mA), Status `LED-1 burnt out at 280.0 mA`; `Reset LED`; a 330 Ω resistor in series gives 19.7 mA, brightness 0.99, `LED-1 lit at 19.7 mA`; typing a new resistance updates the readout within one tick. Saved with Ctrl+S.
5. **Coding a tower**. Palette `Repeat`, ArrowRight on the block, `Add Sphere`, `Move Z by`; `Play`: first step after `QY_BLOCKS_STEP_MS`, 6 steps, 3 spheres at z 0, 10, 20, Status `Program finished: 3 objects`; saved snapshot holds program and objects; the instructor's Glancet shows 3 meshes.
6. **Watching one child**. `Watch Tiny Turtle live` (Enter): dialog `Glancet: Tiny Turtle` docked 24 px from the bottom and right edges (360 x 203), focus inside, fades over `QY_GLANCET_FADE_MS`, turntable turns once per 12 s; `Expand viewer` 80% width 16:9 at top 109 px (modal), shrink back; a Student save raises `Rev` by one live; Escape closes, focus returns to the Watch button, scroll unchanged.
7. **Ending someone's access**. Blue Fox opens a classmate's project: h1 `Project not found` (API 404). Founder `Remove Blue Fox` (alertdialog `Remove Blue Fox?`, `Remove from classroom`): Status `Removed Blue Fox`, tile gone, focus on the next tile's Watch button; Blue Fox's page shows Notice `You were removed from <classroom>.`, next request `401 removed`; stream closed; projects, snapshots, exports deleted. Removing the Assistant closes their Glancet with Status `<nickname>... You were removed from <classroom>.`.
8. **A Personal maker at home**. `/signup` choose `Personal maker`: Notice `Check your inbox at <email> to verify your account.` with `Resend verification email`; first save refused `Verify your email to save projects.`; the Mailpit message (Subject `Verify your Quarkyard email`, From `MAIL_FROM`, link line `<APP_PUBLIC_URL>/verify?token=<token>`, `This link expires at <instant>.`) opens `/verify`: h1 `Email verified. You can save projects now.`; save succeeds; `Export` STL + `Inches`: size line in inches, file stored at `exports/<owner>/<export>/<file>`, Status `Exported <file> (inches)` then `Saved to your library`, listed under `My exports`.

## Values the build uses

- Palette: ground #FFFFFF, surface #F6F8FA, ink #282727, muted #646E80, muted-deep #414651, cobalt #0175DA, royal #0A47D2, navy #0D4FB0, azure #0870D0 (decided: AA on surface), violet #7400CC, edge #DADDE3, notice #EEF4FB (decided), toy #35B558 #7A3FD1 #F58220 #1E90FF (brief: Renders).
- Type: Fira Sans 400/600/700 served by the app; body 16/1.5, hero 48 (36 phones), section 32, figures bold tabular (brief: Typefaces).
- Space: 8px unit, column 1050 + 24px margins, header 81 (60 narrow), radii pill 999 and card 8, tap target 44 (brief: Mood and shape).
- Breakpoints: narrow < 600 (checked 375x812), medium 600-1023 (768x1024), wide >= 1024 (1280x800) (brief: Screens and layout).
- Config: `QY_AUTOSAVE_MS` 1500, `QY_BLOCKS_STEP_MS` 400, `QY_SIM_TICK_MS` 100, `QY_TOAST_MS` 4000, `QY_GLANCET_FADE_MS` 150, `QY_JOIN_RATE_LIMIT` 5, `QY_VERIFY_TTL_SECONDS` 86400 (brief: Configuration).
- Decided: footer links `Privacy`, `Terms`, `Student data` open three short policy pages in the same SPA (the brief lists the links, not their targets); starter cards link to `/editor/new?kind=3d&starter=<id>` (the brief says the card opens the starter's shapes as an unsaved design); a roster tile with no saved project reads `No saved project yet`; Status lines `Handed in <classroom>` and `Archived <classroom>` on hand-in-all and archive (the brief gives no copy for them).

## Motion table

| Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| Pills, links, cards, icons | hover | 250 ms | ease | none (colour only) |
| Modal dialogs, Menu, Shapes sheet | open/close | ~166 ms | linear | appear/disappear at once |
| Glancet | open/close | `QY_GLANCET_FADE_MS` 150 ms | linear (rAF on the page clock) | no fade |
| Glancet turntable | playing | 12 s per turn | linear | starts paused, three-quarter view, `Pause turntable` pressed |
| Glancet revision swap | project-saved | 250 ms crossfade | linear | in place |
| Poster card loop | playing | 6-10 s | eased | finished frame, paused |
| Feature-row loops | playing | decided 8 s | ease-in-out | finished frame, paused |
| Starter previews | first draw, then turn | 250 ms fade, 20-30 s per turn | linear | finished, paused |
| Status lines | message | removed after `QY_TOAST_MS` | none | same |
| Block steps | Play | `QY_BLOCKS_STEP_MS` per step | none | whole program at once |
| Simulation | running | every `QY_SIM_TICK_MS` | none | same |

## States per async action

- Join: `Join class` disabled while in flight; errors under the field and in Status.
- Save: `Saving…` -> `Saved · revision <n>` or `Unsaved changes` (also after failure); 503 -> Status + Notice `Save failed: storage is unavailable. Your design is safe; try again.`, edits stay in memory and `localStorage`.
- Export: Status `Preparing <file>…`, `#qy-export` working, then done or failed.
- Grouping: Status `Grouping…`, `Group` disabled until the worker answers.
- Stale save: Notice with `Reload`, Status copy, edits kept.
- Outage: health `{"status":"unavailable"}`; sign-in, join, rosters and stream keep working.

## Media and licences

All renders, doodles, previews and the logo mark are generated by the app (SVG, canvas, WebGL), licence `original`. Icons: Lucide via `lucide-react` (ISC). Font: Fira Sans via `@fontsource/fira-sans` (OFL-1.1). Geometry kernel: Manifold 3.5.4 WebAssembly vendored in `app/third_party/manifold` (Apache-2.0). No stock imagery and no external origins.
