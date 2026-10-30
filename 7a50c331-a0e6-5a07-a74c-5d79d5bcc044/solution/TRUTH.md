# TRUTH.md — Tessel

Ground truth for the golden build in `app/` (Starlette + uvicorn + Jinja2 + pg8000, package `tessel`, served by
`.venv/bin/python -m tessel` from `run.json`). Every value is marked `brief: <section>` when the
brief pins it, or `decided: <why>` when the golden chose it inside the brief's latitude.

## Ideal flow of every journey

1. **Owner provisions a database** (brief: Journeys). Sign in at `/login` as `northwind.owner@example.com`
   / `deku-demo-pw-2026` → land on `/console` → type `atlas_memory` in the inline create row → press
   `Create` (button reads `Creating...`, panel `aria-busy="true"`) → toast `Database created`, live
   region `Database created` → the new row reads `provisioning` (yellow, shimmering) → the page polls
   `GET /api/v2/databases/status` and the row turns `ready` after 2 s of server time without a reload.
2. **Editor ingests two facts** (brief: Journeys). Sources tab of `atlas_memory` → `Ingest source` opens
   the inline row at the top of the table → id `ui-owners`, title, text, two fact rows (`Atlas Launch`
   `OWNED_BY` `Priya Raman` from `2026-01-05T09:00:00Z`, `Ravi Menon` from `2026-05-01T00:00:00Z`) →
   `Ingest` → toast `Source ingested` → row tagged `In write log` (yellow) → Graph query tab: the owner
   statement answers `Ravi Menon` (As of empty) and `Priya Raman` as of `2026-03-11T00:00:00Z`, with
   `Served from index generation 0 at LSN 0 plus 1 pending write log entries` → Stats `Compact` →
   `Folded 1 entries into generation 1` → row reads `Indexed`, answers unchanged.
3. **Viewer searches** (brief: Journeys). Search tab of `launch_brain` → `billing migration` →
   results ranked by the BM25 rule with 4-decimal scores → `Not useful` → `Rating`, `Comment`,
   `Send feedback` → toast `Feedback sent`.
4. **Visitor prices** (brief: Journeys, Pricing and calculator). `3.2` GB, `2.4` M tokens → Ship
   `$25.00` `minimum applies`, Scale `$300.00` `minimum applies`, Open Source `$0.00`, Enterprise `Custom`.
5. **Stale edit** (brief: More journeys). `Edit` on a row sends `if_version`; another writer lands
   first → `Source conf-1 is at version 2` beside `Title`, typed text kept; reload → edit from v2 →
   `Source ingested`, version 3.
6. **Delete and undo** (brief: More journeys). `Delete` → toast `Source deleted` with `Undo` →
   `POST /api/v2/context/restore` → toast `Source restored`.
7. **Export and import** (brief: More journeys). Stats `Export` → `Export queued` → `Export running`
   → `Export ready` + `Download` link (server time 0–1 s, 1–2 s, ≥2 s) → requester emailed
   `Export ready: <database>` → console `Import database` → `Export document`, `New name`, `Import`
   → new row `provisioning` → `ready`; the import answers the same graph rows and search results (its own lsns and `served_from` differ).
8. **Explore the past** (brief: More journeys). Explore tab → slider `As of moment` starts on `now`;
   Home → `2026-01-05T09:00:00Z` (`4 entities, 2 relations`), steps through the seed moments; select
   `Atlas Launch` → region `Inspect Atlas Launch` with `Outgoing` / `Incoming` lines.
9. **Forgot password** (brief: More journeys). `/login` → `Forgot password?` → `/forgot` → `Send
   reset link` → `If that email belongs to a member, a reset link is on its way.` → mail `Reset your
   Tessel password`, first line `<APP_PUBLIC_URL>/reset?token=<64 hex>` → `/reset?token=` → `Set
   password` → `/login` reading `Your password was reset. Sign in with the new one.`
10. **Session ended elsewhere** (brief: More journeys). Another client calls `logout-all` → the next
    console action lands on `/login?next=<that page>` reading `Your session has ended. Sign in again.`
    → sign in returns to that page.

## Palette (brief: Visual design, Palette roles; tones decided)

| Role | Value | Basis |
|---|---|---|
| void | `#0a0a0a` — near-black neutral, the darkest (about 4% lightness) | brief: Palette roles; decided: matches the captured page |
| panel | `#111111` — one step lighter near-black | brief: Palette roles |
| raised | `#1a1a1a` — two steps lighter near-black | brief: Palette roles |
| hairline | `#1c1c1c`, grid every 80 px — very dark neutral grey, used for the repeating vertical grid on the page background | brief: Shape, glass and type scale |
| line strong | `#2e2e2e` — dark neutral grey for card borders and row separators | brief: Palette roles |
| ink | `#ffffff` — white | brief: Palette roles |
| ink 60 | `rgba(255,255,255,.6)` — white at 60 % | brief: Palette roles |
| muted / faint | `#8f8f8f` / `#5c5c5c` — mid grey / dark mid grey | brief: Palette roles |
| signal orange | `#ff571a` — light vivid orange, the captured site's primary (red 255, green 87, blue 26) | brief: Palette roles; decided: sampled from the captured site probe |
| signal hover | `#ff7a45` — a lighter vivid orange for primary hover | brief: Palette roles |
| amber | `#ffcf3f` — light vivid yellow for `provisioning` and `In write log` | brief: Palette roles |

Status always reads in words; `ready` and success toasts stay plain white (brief: Visual design).

## Type (brief: Type, Shape, glass and type scale)

- Family `"Geist Mono", ui-monospace, "SFMono-Regular", Menlo, monospace` everywhere; weight 400,
  500 for buttons and table headers, 700 for numeric emphasis (brief: Type).
- Closed size set 12, 13, 14, 15, 15.5, 16, 17, 18, 20, 23, 24, 25 px; only the hero heading and
  landing section headings are larger (brief: Shape, glass and type scale). Target for the site
  stylesheet: body 14 px, console tables 13 px, captions 12 px, buttons 14 px (decided: compact
  console density inside the closed set).
- Hero heading holds on at most two lines at 1920 px (brief: Type).

## Shape and surfaces (brief: Shape, glass and type scale; Surfaces)

- Capsule buttons (radius ≥ half the height); inputs and menus barely rounded (4 px), cards more
  (8 px), table wrappers more again (12 px) (decided: smallest steps that read as distinct while
  keeping the brief's order).
- Header glass: strong blur with a saturation lift; menus a lighter blur with a faint inner hairline
  ring and a soft drop shadow (brief).
- Focus ring: thin solid signal orange outline offset from the control, keyboard focus only (brief:
  Shape, glass and type scale; Interactions).

## Layout per viewport (brief: Screens and layout, Three layouts with names)

| Layout | Width | Landing | Console |
|---|---|---|---|
| phone | up to 767 px (decided: below tablet width) | one column; header = wordmark, compact star `13.1k`, menu button opening a full-width sheet; Graph view a vertical chain of 21 nodes; benchmark cells two per row; plans one column | tabs scroll sideways; table rows become stacked cards with the name above the status |
| tablet | 768–1279 px (decided: tablet up to a small laptop) | feature and plan grids two columns; architecture panels stacked | rail plus table |
| desktop | 1280 px and up (decided: wide desktop) | four plans in one row; architecture panels side by side | rail plus table |

No layout scrolls sideways at 320, 390, 768 or 1440 px (brief: Interactions).

## Motion (brief: Motion and effects)

| Moment | Trigger | Golden behaviour | Basis |
|---|---|---|---|
| word rise | page load | hero words rise from below their line one after another, fade trailing the rise | brief |
| link colour | hover | inline link warms to orange with a dotted underline over a short beat | brief |
| view swap / edge draw | hero Text ↔ Graph | brief fade; the 20 edges draw in the pinned edge order from `Tessel` | brief |
| menu drop / chevron turn | Resources opens | menu fades and settles from just above; chevron turns half a circle | brief |
| menu wipe | phone menu button | sheet wipes down from the top | brief |
| logo scroll | always | endless CSS loop moving the track by half its width, paused under pointer or focus | brief |
| flow dash | always | connector dashes crawl in a steady CSS loop | brief |
| latency lanes | card in view | seven bars, white and amber alternating, endless loops, hidden from assistive technology | brief |
| cell glow | hover or focus on a benchmark cell | orange wall from the bottom, bright top edge, blurred cone, round bloom | brief |
| section reveal | first time a fifth of a section is visible | slides up a little and fades in, once | brief |
| view slide | View this page as | indicator glides with a long soft settle | brief |
| toast rise / row remove | toast enters / closes | rises with opacity; fades and lifts away | brief |
| panel swap / tab slide | workspace tab | panel fades in with a lift; marker slides | brief |
| dialog open | delete dialog, phone menu | grows from just under full size | brief |
| row flash | row created, restored or changed | row lights briefly | brief |
| node select / inspector slide | Explore node | fill warms to orange; Inspector slides in from the right | brief |
| provision shimmer | `provisioning` badge | translucent white band sweeps forever until `ready` | brief |
| counter pulse | Stats counter changed | card lifts to the raised colour once | brief |
| press scale | pointer down or Space | control shrinks a little and springs back | brief |
| header rule | scrolled past the hero | orange hairline fades in along the header bottom; gone at the top | brief |
| faq open | FAQ question | answer fades and slides in; plus turns into a cross | brief |
| calculator tick | estimate changes | changed figure flashes orange | brief |
| results stagger | Run, Search, Look up, Load more, timeline step | rows arrive one after another, the rest at once past the twentieth | brief |
| sign-in shake | refused sign in | form shakes twice and settles | brief |

All are CSS or Web Animations the browser reports; decorative loops animate position only. Under
reduced motion every loop stops and every transition happens in the same frame (brief: Motion and
effects). Durations: short beats 120–200 ms, settles 300–450 ms (decided: "short and
mechanical").

## States (brief: Feedback states)

- Empty: `No databases yet`, `No sources in this collection`, `No sources match these words`, `No facts
  mention this entity`, `No audit events match these filters`, `No facts at this moment`.
- Waiting labels: `Running...`, `Searching...`, `Looking up...`, `Ingesting...`, `Compacting...`,
  `Creating...`; panel `aria-busy="true"` meanwhile.
- Bare failure: `Something went wrong. Try again.` beside the control in signal orange; typed text and
  last results kept.
- Toasts: `role="status"`, newest on top, at most three, `Close` on each, auto-leave after 6 s.
- Live region lines: `Query answered: N rows`, `Search found N sources`, `Source ingested`, `Folded N
  entries into generation G` / `Nothing to fold`, `Export ready`, `Database created`.
- Access: `You do not have access to this page`; foreign or missing database `Database not found`.
- Money `$1,234.50`; counts of 1000 or more with thousands commas.

## Server truth (brief: Business rules, API, Data model)

- Envelope `{success, data, error{code,message,field}, meta{request_id,latency_ms}}`; version header
  checked before credentials; refusal catalogue messages verbatim.
- Write log: gapless lsns per database under concurrency (decided: allocate inside one transaction
  that locks the database row; the golden serializes its other races with `FOR UPDATE` and advisory
  locks), compaction folds every pending entry and raises the generation by one.
- Supersession: greatest `valid_from` not after `as_of`, then greater lsn, then later fact position.
- Keyword score exactly the brief's formula (`2.2 / (f + 1.2 * (0.25 + 0.75 * |D| / avgdl))`); scores
  rounded half up to 4 decimals; ties by id, then collection.
- Bill in integer cents with ceiling division; Ship minimum 2500, Scale 30000; rates 50 and 25.
- Seeds: `launch_brain` in both organizations exactly as the Seed data tables (brief: Seed data).

## Decisions inside the brief's latitude

- Console scripts call `/api` with the member's own session token, embedded in the console page
  (`<meta name="tessel-session">`); the cookie `tessel_session` stays HttpOnly (decided: the API reads
  only `Authorization`).
- Sign out is a plain form posting `intent=signout` to `/login` (decided: no route beyond the route map).
- Toasts stack bottom-right, newest on top; only their buttons take the pointer (decided: never cover a
  control near the top of a table).
- Section reveals run only after a person scrolls (wheel, touch, key, pointer); a scripted scroll shows
  sections as they are (decided: a sweep by an audit tool never meets half-faded text).
- With nothing focused, Tab lands on the skip link wherever the page was scrolled (`static/skip.js`).
- Latency lanes loop at 1180-1460 ms per crossing; logo track 40 s; flow dash 1.4 s; shimmer 1.5 s.
- At desktop width the hero Text view shows a quiet, static, `aria-hidden` preview of the Graph view
  (orange `Tessel` and its first three edges) in a right column (decided: the first screen is not
  half empty; no new motion, skipped by the markdown twin).
- The fixed `View this page as` switch has a solid panel fill, and public `<main>` keeps 88 px of bottom
  padding so the last content scrolls clear of it (decided: the switch never hides content at rest).
- Explore timeline moments come from the server-rendered workspace page, extended by later answers.
- Unexpected failures answer `503` `UNAVAILABLE` in the envelope (API) or an error page, never 500.

## Disputes with the reference tests

None open. The three earlier disputes (sign-out name match, CSV `Accept` header, feedback window
between tests) were fixed in the refreshed tests; the unchanged app passes all 105 cases.

## Judged-criteria mapping

| Criterion | Requirement | What the golden must show | Basis |
|---|---|---|---|
| B1 | DP-56 | cards, panels, inputs a step lighter than the void page on `/` and `/console` | brief: Visual design |
| B2 | DP-56 | white headings, translucent white body | brief: Visual design |
| B3 | DP-56 | Sign up, Run, active tab marker and sign-in error text in one signal orange | brief: Visual design |
| B4 | DP-14 | `Statement` editor, `As of`, `Run` and three example statement buttons on the Graph query tab | brief: Console |
| B5 | DP-46 | nine Stats counters as a label-with-figure grid | brief: Console |
| B6 | DP-46 | seven labelled bill lines | brief: Console |
| B7 | DP-27 | inline create row as the table's first row with `Name`, `Create`, helper | brief: Surfaces |
| B8 | DP-50 | console rows tighter than landing sections | brief: Layout |
| B9 | DP-53 | benchmark figure larger than its name | brief: Landing page |
| B10 | DP-53 | architecture boxes joined by dotted connectors | brief: Landing page |
| B11 | DP-53 | logo strip one row, soft ends | brief: Surfaces |
| B12 | DP-53 | three bordered storage bars drawn in markup | brief: Zero-asset substitution |
| B13 | DP-53 | chart lines Tessel, VectorDB, Full context with text tick labels | brief: Landing page |
| B14 | DP-53 | English copy everywhere | brief: Working rules |
| B15 | DP-28 | plan buttons with no checkout fields | brief: Working rules |
| B16 | DP-56 | input < card < table wrapper radii | brief: Shape, glass and type scale |
| B17 | DP-55 | frosted Resources menu with inner ring and shadow | brief: Surfaces |
| B18 | DP-55 | orange header rule only past the hero | brief: Global chrome |
| B19 | DP-54 | 21 nodes connected to the orange `Tessel` node | brief: Hero |
| B20 | DP-53 | customer names as grey text | brief: Zero-asset substitution |
| B21 | DP-53 | eight testimonials with initials circles | brief: Landing page |
| B22 | DP-53 | `SOC 2`, `GDPR`, `HIPAA` capsules in the footer | brief: Zero-asset substitution |
| B23 | DP-32 | disabled `Delete database` looks dimmer until the name is typed | decided: disabled control at 40 % opacity |
| B24 | DP-50 | visible labels on every tab, field and text button | brief: Interactions |
| B25 | DP-57 | phone tabs in one sideways-scrolling row | brief: Three layouts with names |
| B26 | DP-62 | orange plus before each Enterprise line | brief: Contact |
| B27 | DP-62 | Send message grey text on raised dark fill at rest | brief: Contact |
| B28 | DP-53 | orange right arrows in the four comparison pairs | brief: Landing page |
| B29 | DP-58 | line numbers and orange heading marks in the reader | brief: Global chrome |
| B30 | DP-49 | email and password only on `/login` | brief: Integrations |
| B31 | DP-46 | daily bars to today, today marked, tallest at full height | brief: Console |
| B32 | DP-10 | Explore edges as thin labelled lines between chips | brief: Console |
| S1 | DP-66 | every record in PostgreSQL via `DATABASE_URL` (`tessel/db.py`) | brief: Server boundary |
| S2 | DP-70 | notices sent over SMTP to `SMTP_HOST`/`SMTP_PORT` (`tessel/mail.py`) | brief: Services |
| S3 | DP-17 | deterministic scoring, supersession, ordering and bill (`search.py`, `graph.py`, `core.py`) | brief: Engineering standards |
| S4 | DP-30 | role and organization checks server-side before writes (`security.py`, route modules) | brief: Server boundary |
