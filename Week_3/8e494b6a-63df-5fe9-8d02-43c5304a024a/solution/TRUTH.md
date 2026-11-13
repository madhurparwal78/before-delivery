# TRUTH: Spoorline golden

What the golden app does, value by value. Every value says where it came from: `brief: <section>` (copied from
`instruction.md`) or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Journeys

1. **Triage in Explore** (brief: Journeys 1). Start: `tomas` signed in on `/explore` in `ops` with the seed data and the grading clock
   (2026-03-01T00:00:00Z). He chooses stream `web`, quick range `Last 15 minutes`: `8 events found` is announced in
   `status "Announcements"` and the grid has `aria-rowcount` 9. He types in `combobox "Query"`, Tab accepts a highlighted suggestion with
   nothing added, Enter runs the query as typed and announces its count. He opens `list "Fields"`, picks `host`, reads `In 8 of 8 events`,
   presses `Include host-7`: pill `Filter host: host-7, include, enabled` appears and `4 events found` is announced. F6 walks
   Query, Histogram, Fields, Grid (and Document when open). Enter on a grid row opens `region "Document"` (animation `panel-in`, 160 ms),
   focus on `button "Close document"`; `Surrounding events` lists 5 before and 5 after. Escape closes it and focus is back on the same row.
   End state: the address holds stream, range, query and filters; reload shows the same search. Provider-recorded: searches count against
   `SPOOR_SEARCH_RATE` for the session; nothing is written.
2. **Narrow with Bucket Brush** (brief: Journeys 2, Business rules G). Viewer zone `America/New_York`; absolute range `2026-03-08 00:00:00`
   to `2026-03-09 00:00:00` shows `Interval: 30m` and 46 bucket buttons (the 23-hour day). Dragging across three buckets (or Shift+arrows then
   Enter) sets the range to the outer edges, bars that changed run `bar-settle` (200 ms), `Time range set: <n> events found` is announced, the
   count, field statistics, pills and grid follow it; the query text stays empty. Reduced motion: same result, no animation object is created.
3. **An alert through its life** (brief: Journeys 3, Business rules K and L). Rule checks run only through `POST /api/grading/check` under
   grading. State moves by one table: inactive to pending to active (after `SPOOR_PENDING_CHECKS` breaches) to recovered to inactive;
   a failed check keeps state; flapping holds actions; snoozes and weekly maintenance windows hold actions; the first check after a window
   ends fires one `is still active after maintenance window` item. Both browsers show `Group <g>, <state>[, flapping][, snoozed][, in maintenance]`,
   `Last check at <time>: ok` or `Check failed at <time>: state kept.`, history rows, and announce `Group <g> is now <state>`.
4. **Triage on a phone** (brief: Journeys 4, Screens). At 360 px: alert cards (`article` per group), a left swipe over 80 px with under 40 px vertical
   travel acknowledges (`Acknowledged Group <g>`), a shorter swipe springs back in about 200 ms; `Time range` and `Filters` open as bottom sheets
   (`sheet-rise`, 240 ms); Add to case announces `Added to case <n>.`; the trace tree toggles on tap and keeps its critical path and self time text.
5. **Prove a pipeline, then upload** (brief: Journeys 5, Business rules B and C). Simulation stores nothing; a skipped step says
   `Skipped: condition false`, a drop `Dropped`, a failure its handler sentence; saving raises the version by one. A file upload is judged
   (name `.ndjson`, UTF-8, no NUL, first non-space `{`, size) before anything is stored, kept in MinIO at
   `uploads/<space>/<sha256>.ndjson` and confirmed, then parsed with `upload` messages every `SPOOR_UPLOAD_PROGRESS_LINES` lines; bad lines go to the failure store.
6. **Age a stream** (brief: Journeys 6, Business rules J). Lifecycle steps run through `POST /api/grading/lifecycle`; a generation rolls over once,
   then moves straight to the furthest phase its age allows; archiving writes `segments/<space>/<stream>/<n>.ndjson`, confirms the byte size, then drops
   the rows from Postgres; with storage down the search shows `status "Partial results"` and a failed archive shows `Archive failed. It will retry on the next step.`
7. **Page through a moving result set** (brief: Journeys 7, Business rules H). A search makes a snapshot (pages of `SPOOR_PAGE_SIZE`, frozen order),
   `Show new events` counts events stored since (insertion order, not clock), the tail pauses with a buffer of `SPOOR_TAIL_BUFFER` and shows
   `Live tail paused: <n> new events` and `Buffer full: oldest <n> events discarded.`
8. **Hand out a key and share a search** (brief: Journeys 8, Business rules N). A key (`spk_` + 32 hex) is shown once in `textbox "New key value"`
   and stored only as its SHA-256; refusals are 401 `key_invalid`/`key_expired`/`key_revoked`, 404 for another space or stream, 403 `key_scope`.
   Copying a saved search into a space without its stream marks it `Needs attention`, and opening it shows `alert "Saved search error"`.

## Palette (brief: Visual design; hex values decided to meet AA)

| Role | Hex | Source |
|---|---|---|
| ground (warm paper) | #F7F3EA | brief: Colour roles |
| wash | #EFE8D6 | brief: Colour roles (deeper wash) |
| surface (sand) | #E9E0CB | brief: Colour roles |
| border | #B7AB93 | brief: Colour roles (warm khaki grey) |
| control border | #7C705A | decided: 3:1 against the ground for non-text contrast |
| divider | #DDD4C0 | brief: Colour roles (fainter warm hairlines) |
| ink | #1B2A22 | brief: Colour roles (near-black, green cast) |
| muted | #55645A | brief: Colour roles (muted grey-green) |
| accent (forest green) | #1F5A3D, hover #16432D, on-accent #FFFFFF | brief: Colour roles |
| danger (brick red) | #A3301E | brief: Colour roles |
| warning (dark ochre) | #7A5200 | brief: Colour roles |
| healthy (forest green) | #2E6B3F | brief: Colour roles |
| info (slate blue) | #35597C | brief: Colour roles |
| footer | #13201A with text #E9E5D8 | brief: Colour roles |

## Type (brief: Visual design)

JetBrains Mono (400, 500) for field names, log text, numerals, time stamps, bucket labels and the accordion index; Inter (400, 500, 600)
for interface copy; both bundled as woff2 from `src/client/fonts`. Body 16/24 px; heading step 24 px (1.5 x); view title 38 px (about 2.4 x body)
(decided: reads as the brief's "roughly two and a half times"). Sentence case everywhere.

## Space and layout per viewport (brief: Screens and layout)

Bands by viewport width only: phone below 768, tablet 768 to 1099, desk 1100 and up. Chrome from the top: ingest status bar (28 px, fixed at 0),
header (52 px on every layout, a little under twice the bar (brief: Visual design, Density and composition); fixed under the bar;
on phone the server time sits between the product name and the buttons in 11 px mono and wraps inside the header (decided: keeps the brief's height ratio with 44 px buttons at 360 px)), workspace tabs (2 px accent underline,
scrolls inside its own box), announcement strip, `<main data-seq data-pending>`, footer band. Explore: desk has the field list as a column of about a fifth of the
width and the Document beside the grid (the grid narrows); tablet overlays the Document on the right half of the grid; phone is one column with
`list "Events"` of `article` cards and `dialog "Filters"` holding the field list, statistics and pills. Every control you can tap is at least 44 pixels
in both directions on every layout (brief: Visual design, Targets): histogram buckets are 44 px wide and the histogram well scrolls inside its own box
when they do not fit (brief: Screens and layout, wide content scrolls inside its own box); grid rows and header cells are 44 px high; each
`separator "Resize <column>"` is a 44 px wide hit zone at its column's right edge.

## Motion (brief: Motion and effects)

| id | element | trigger | duration | easing | reduced motion |
|---|---|---|---|---|---|
| bar-settle | histogram bar | height changes after a range change | 200 ms | cubic-bezier(0.16, 1, 0.3, 1) | none created |
| panel-in | `region "Document"` | opens | 160 ms, 16 px slide plus fade | cubic-bezier(0.16, 1, 0.3, 1) | none created |
| sheet-rise | phone `dialog "Time range"` and `dialog "Filters"` | opens | 240 ms | ease-in-out; starts 32 px below its rest (decided: its controls stay under the pointer target while it rises) | none created |
| tab-slide | tab underline | current tab changes | 240 ms | cubic-bezier(0.16, 1, 0.3, 1) | none created |
| swipe spring-back | group card | a swipe that does not qualify | 200 ms | cubic-bezier(0.16, 1, 0.3, 1) | none created |

Hover and press change colour in 150 ms (named properties only). Nothing loops.

## States per async action (brief: Feedback states)

Writes carry `aria-busy="true"` and ignore repeat presses; `<main data-pending>` counts writes in flight. Search: skeleton rows with `data-search-state="loading"`,
`done`, or `error` with `alert "Search failed"` and Retry; `alert "Query error"` with the caret moved before the reported position; `status "Partial results"`;
`alert "Snapshot expired"` with `Start a new search`. Load failures: `alert "Load failed"` with the published sentence and Retry. Empty views: one line and one action on a wash band.

## Breakpoints (brief: Screens and layout)

768 and 1100 px; no horizontal page scroll from 360 px up.

## Media and licences (brief: Technical requirements; decided: the brief names none)

The lifecycle drawing on the sign-in and sign-up pages (four ruled bands) and the few interface glyphs are drawn inline for this app (licence: original).
Fonts: Inter and JetBrains Mono, SIL Open Font License 1.1, listed in `THIRD_PARTY_NOTICES.md` and `assets.json`. Shipped packages: react, react-dom, scheduler,
pg and its dependencies (MIT or ISC).
