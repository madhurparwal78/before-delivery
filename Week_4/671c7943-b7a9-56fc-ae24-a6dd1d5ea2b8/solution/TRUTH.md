# TRUTH — Sollis Studio Folio

The golden's ground truth. Every value says where it came from: `brief: <section>` (copied verbatim from `instruction.md`) or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

Start state of every journey: edition 1, the starting content of Seed data, no enquiries, next reference `SOL-0001` (brief: Business rules / Starting state). The grading route restores it with `DELETE /api/grading/content` (brief: API).

## Journeys

### 1 Home tour (DP-01..04)
1. Open `/`: title `Sollis Studio | Independent designer` (brief: Screens and layout). Sections in order `intro`, `about`, `services`, `work`, `philosophy`, `contact`, then the footer, each a `region` named by its heading with `id="<section id>"` (brief: Screens and layout).
2. Intro lines rise from one line height below, in their own clipping boxes (brief: Motion 1).
3. Click header link `Services`: the page scrolls on the page clock for 220 ms (decided: inside the brief's one second); the first time the `Services` heading's top edge passes 85% of the viewport it rises from 32 px below and fades in over 600 ms, as every section heading does (brief: Motion 2); when the scroll ends, focus lands on the `Services` heading, whose top sits 96 px from the viewport top (decided: header 64 px plus 32 px; the brief asks for at least 16 px clear). Reduced motion and page loads jump at once (brief: Section jumps).
4. `Start a project` in the intro jumps to `contact`, `See selected work` to `work` (brief: Interactions / Section jumps).
5. The link of the section holding the point 40% down the viewport carries `aria-current="true"` in the header and the menu, none while the point is in `intro`, updating in both scroll directions (brief: Current section).

### 2 Reading the statistics (DP-06..09)
Four tabs named `<value> <label>`, the first selected; values count 0 to value over 1,200 ms by `round(value x (1 - (1 - t/1200)^3))` the first time the tab list's top edge is above 85% of the viewport (brief: Motion 3). ArrowRight, ArrowLeft, Home and End select at once and wrap; one Tab stop; the panel is not a stop (brief: Statistics tabs). The panel shows the note, one `data-part` segment per part sized by value share (flex-grow = value, 2 px gaps), and `<part label>: <part value>` texts with thousands commas (brief: Statistics panel).

### 3 Scoping a service (DP-10..16)
Services collapsed at load; Enter or Space or click toggles; one open at a time; `service=<id>` replaces the address without a history entry; an address with `service=<id>` opens it and focuses its button, 96 px below the top; ArrowDown/Up/Home/End move focus only. `Start a <service> project` checks the type, sets `type=<id>`, jumps to `contact`, focuses `Name`, and leaves the service open (brief: Interactions / Services).

### 4 Weighing the evidence (DP-17, DP-18, DP-21..28, DP-30..34)
`See <service> work` checks the category, sets `category`, jumps to `Selected work` and announces `Showing 3 projects in <service>.`. A work item link fetches the case study, pushes one history entry, sets the title, focuses the level-1 heading and moves `[data-hero]` from the cover's box to its own over 480 ms (strong ease-out), then the eyebrow, heading and standfirst rise 24 px over 180 ms, 60 ms apart (brief: Motion 9). Next and Previous slide the old hero 40 px out and the new one 40 px in over 360 ms (brief: Motion 10). Back, once per case study shown, returns to the tile of the project first opened, filter kept, cover carried back, link focused (brief: Cover Carry).

### 5 Keeping the work current (DP-19, DP-20, DP-31)
`PUT /api/grading/content` replaces projects and statistics and adds one to the edition; the next full page load shows counts, gallery, sequences and titles from the stored projects (brief: Business rules / Derived counts).

### 6 Sending a commission brief (DP-40, DP-49..53)
Checks run on trimmed values when the form is sent; failures show the error box (focused) with one link per failed field, `aria-invalid="true"` and the message in the field's description (brief: Feedback states). A valid send: `Send enquiry` gets `aria-disabled="true"`, status `Sending your enquiry.`, one POST with the form's submission id; the thank-you panel replaces the form, heading `Thank you, <first name>.` focused, status `Enquiry <reference> sent.`. Mailpit holds the studio copy then the acknowledgement; Postgres holds the enquiry with `mail` `sent`; `Download your brief (PDF)` serves a one-page A4 PDF from Gotenberg (brief: Services).

### 7 Mail or PDF down (DP-53, DP-56)
Mail unreachable: 201 with `mail` `not_sent`, the enquiry kept, the panel shows the delay alert, status `Enquiry <reference> saved.`. PDF renderer unreachable: the brief address answers 503 with the unavailable page; enquiries still send. `/api/health` is always 200 with `ok` or `unavailable` (brief: API, Feedback states).

### 8 On a phone (DP-44..47)
At 375 px: `Menu` opens a modal dialog sliding down in 280 ms (decided: inside 200 to 350), focus on `About`, Tab wrapped, Escape, `Close menu` or a tap outside closes it with focus back on `Menu`; services and filter open by tap; a showcase swipe of 60 px or more moves one screen, a shorter one stays (brief: Showcase); the touch handler is on the whole region. Reduced motion: every motion appears at once in its end state (brief: Motion / Reduced motion).

## Palette roles (DESIGN.md)

| Role | Hex | Source |
|---|---|---|
| ground | #F6F2EA | brief: Colour (warm off-white); decided: hex |
| ground-2 | #EFE9DD | decided: second paper tone, no shadows |
| ink | #1E1A15 | brief: Colour (warm near-black) |
| muted | #625A4F | brief: Colour (muted warm grey); 6.08:1 on ground |
| accent | #0D5755 | brief: Colour (deep green-teal); 7.49:1 on ground |
| accent-deep | #0A4644 | decided: hover step |
| rule | #CFC6B4 | brief: Colour (hairline, 1 px) |
| rule-strong | #8F8573 | decided: control borders at 3:1 or more |
| danger | #9A2B1E | decided: validation red, 6.87:1 on ground |

## Type, space and layout

| Item | Value | Source |
|---|---|---|
| Headline family | Instrument Serif 400 | brief: Type |
| Body family | Instrument Sans 400, 500, 600 | brief: Type |
| Heading ratio | 1.333 between levels: h4 clamp(24px, 1.15rem + 1.5vw, 32px), h3 x1.333, h2 x1.333, h1 x1.333 | brief: Type; decided: base clamp |
| Figures | Instrument Sans `tabular-nums`; Instrument Serif digits in fixed 0.52 em spans | brief: Type; decided: Instrument Serif has no `tnum` |
| Header | fixed, 64 px at every width | brief: Screens and layout |
| Gallery columns | 3 from 1024 px, 2 from 600 px, 1 below | brief: Work |
| Service lists | side by side from 768 px | brief: Service panel |
| Statistics tabs | one row from 1024 px, two rows of two below | brief: Layouts by viewport |
| Case study contents | fixed left column from 1024 px, a row above the sections below | brief: Case study |
| Margins and gutters | 64 / 32 px at 1024+, 48 / 24 px at 600+, 20 / 24 px below | decided |
| Hang | 24 px from 768 px, 32 px from 1024 px | brief: Density |

## Motion table

| Element | Trigger | Duration, easing | Reduced-motion substitute | Source |
|---|---|---|---|---|
| Intro lines | page open | 700 ms each, 120 ms apart, cubic-bezier(.2,.7,.2,1) | in place | brief: Motion 1 |
| Section headings | top edge above 85% of the viewport, once | 600 ms, 32 px rise and fade | visible | brief: Motion 2 |
| Statistics count | tab list top edge above 85%, once | 1,200 ms, ease-out cubic on the page clock | final values | brief: Motion 3 |
| Intro plate | scroll | translateY round(0.25 x min(s, 800)) px | stays at 0 | brief: Motion 4 |
| Service panel and chevron | toggle | 320 ms, `grid-template-rows`, chevron 180 deg | at once | brief: Motion 5 |
| Work item cover and caption | hover or focus | cover 1.04 over 350 ms, caption 8 px and fade over 250 ms | at once | brief: Motion 6 |
| Cover reveal | top edge above 90%, once | 700 ms from the bottom edge up | visible | brief: Motion 7 |
| Filter fade | filter change | 250 ms | none | brief: Motion 8 |
| Cover Carry | open a work item | 480 ms, cubic-bezier(.16,1,.3,1); title lines 180 ms, 60 ms apart | end state | brief: Motion 9 |
| Neighbour slide | Previous or Next | 360 ms, 40 px | end state | brief: Motion 10 |
| Process panel | tab choice | 280 ms, 16 px | none | brief: Motion 11 |
| Showcase | button or swipe | 360 ms transform of the screen track, cubic-bezier(.2,.7,.2,1) | instant | brief: Motion 12 (arrives within 600 ms) |
| Menu sheet | open and close | 280 ms | at once | brief: Motion 13 |
| Colour changes | hover, focus | 120 ms linear | none | brief: Motion 15 |

## States per async action

| Action | Pending | Success | Failure |
|---|---|---|---|
| Send enquiry | `aria-disabled="true"`, status `Sending your enquiry.` | thank-you panel; `Enquiry <ref> sent.` or, with mail down, the delay alert and `Enquiry <ref> saved.` | 422 shows the error box; network error, 503 or any other error: alert `We could not send your enquiry. Please try again, or email <studio email>.`, values kept, status emptied, the same submission id reused |
| Case study fetch | none visible (local, fast) | Cover Carry or slide | the browser loads the address as a full page |
| Brief PDF | browser download | 200 `application/pdf` with `attachment; filename="<ref>-brief.pdf"` | 503 unavailable page; unknown token 404 |

## Breakpoints

375 phone, 600 two-column gallery, 768 tablet (service lists side by side, hang), 1024 desktop (header links, three columns, four statistic tabs, fixed contents column), 1280 reference (brief: Layouts by viewport; decided: 600 and 768 steps).

## Media and licences

Every picture is an SVG built by the app from project data (`src/server/plates.ts`): covers, heroes, showcase screens, intro plate, portrait; swatches are CSS blocks. Licence `original`. The only binary files served are the four Instrument font files, copied at build from the OFL-1.1 Fontsource packages listed in `THIRD_PARTY_NOTICES.md`. No raster image, audio, video or model.
