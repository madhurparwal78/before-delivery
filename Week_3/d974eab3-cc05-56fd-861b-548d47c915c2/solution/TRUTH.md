# TRUTH — Vireo Pace golden

Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>`.

## Flows

1. **Reading the story** (brief: Journeys 1). Start: `/` with starting content, edition 1. Action: scroll Opening, About,
   Oxygen & Energy, Science & Technology, Product, Interviews, Lifestyle, then back. End: the rail link and the address
   hash `#<chapter id>` follow the chapter whose box contains the point 40% down the viewport; hash replaced, no history
   entry. A rail press jumps to the chapter, its heading focused and at least 16 px below the 64 px header. The copied
   address opens in a fresh browser on the same chapter, heading focused. (brief: Business rules)
2. **Breath to energy** (brief: Journeys 2). At 768 px and wider without reduced motion About is 3 viewports tall and
   Oxygen & Energy 5, each held by a sticky stage; p = (scroll - chapter top) / (chapter height - viewport height), clamped.
   About: `data-panel` 1 below p 0.25, 2 below 0.75, else 3, on the exact p; `data-progress` p with two decimals rounded
   half up; the track moves left by p * 2 panel widths. Oxygen: `data-stage` = min(5, floor(p*5)+1); the dot sits p of the
   way along the path. Tabs jump (no scroll motion) to p = (k - 0.5) / 5 and announce `Stage <k> of 5: <title>.`; panel
   buttons jump to p = (k - 1) / 2 and announce `Panel <k> of 3: <title>.`. Below 768 px, or with reduced motion, nothing
   is held: About is a snapping row (buttons scroll within 600 ms, instantly with reduced motion; swipes announce once);
   Oxygen has normal height and the dot rests at (k - 0.5) / 5.
3. **What is in the stick** (brief: Journeys 3). Disclosures (`aria-expanded`, panel `hidden` while collapsed), the
   `Nitrate pathway` slider (native range 1 to 3, `aria-valuetext` Nitrate, Nitrite, Nitric oxide, diagram `data-step`
   and step text equal to the value), the link `See the amounts per stick` jumps to Product, the not-a-medicine notice
   `<name> is a food. It is not a medicine and is not intended to diagnose, treat, cure or prevent any disease.` shows in
   Science, in the Ingredients tab and on the sheet. The pack turns front, side, back.
4. **The sheet** (brief: Journeys 4, Services). `PUT /api/grading/content` replaces the record and adds one to the edition.
   `Download product sheet (PDF)`: button `aria-disabled="true"` and `Preparing the product sheet.`, then the file
   `vireo-pace-product-sheet.pdf` downloads, `Product sheet ready.`, focus never leaves the button. Gotenberg unreachable,
   erroring or slower than 20 s: the API answers 503 `sheet_unavailable`, the button shows an `alert` with exactly the
   message, health says `{"status":"unavailable"}`, everything else works, and the next request after recovery succeeds
   (every request opens a new connection).
5. **Interviews** (brief: Journeys 5). `Show interviews` radios filter in published order and announce `Showing <n>
   interviews.` (`Showing 1 interview.`). A card opens `/interviews/<slug>` (history entry added, h1 focused, title
   `<name> | Vireo Pace interviews`); ArrowLeft and ArrowRight open the neighbours (one history entry per move);
   an unknown slug answers 404 with the published page.
6. **ON and OFF** (brief: Journeys 6, Business rules). The chosen scenario shows in the radios and the address at once;
   the panel, `data-mode`, `data-scenario`, picture, copy and announcement `<ON or OFF>: <name>. <title>.` change when
   the answer for the latest choice arrives; earlier answers are ignored; the panel is `aria-busy` while loading and
   keeps the previous scenario; a failure shows `This moment cannot be shown right now. Please choose it again.` and
   returns the radios and address to the scenario still shown. A mode shows the scenario last chosen in it, or its first.
7. **Phone, keyboard, reduced motion** (brief: Journeys 7). Tab order and menu as in Interactions; swipes of 50 px or more
   across the scenario picture choose a neighbour; reduced motion changes every motion to an instant change.

## Palette (hex used by the build)

ground `#0b1511`, raised `#13211a`, paper `#f6f2e8`, paper deep `#eee8d9`, ink `#10201a`, mist `#e8efe9`, muted night
`#aebdb3`, muted paper `#4b5a51`, hairlines `#c8c0aa` and `#2b3f34`, leaf `#4fc972` (deep `#16703a` for text and rings on
paper), oxygen `#a6e8e3`, beet `#7b1530`. Roles: brief: Visual design; hex values: decided in DESIGN.md.

## Type, space and layout

Shippori Mincho 500 for display and headings, Zen Kaku Gothic New 400/500/700 for body (brief: Type); steps of 1.3333 from
a fluid body size (20 px at 1280, 16 px at 375) (brief: one third larger; decided: sizes). Header 64 px fixed, rail 72 px
from 1024 px, content margin `clamp(24px, 6vw, 96px)`, measure 62ch (decided: airy, at most about 70). Layouts at
1280x800, 768x1024, 375x812 as the brief's table. Breakpoints: 768 (held stages, two-column interviews, stops in one
row), 1024 (rail, Site links, product side by side, three interview columns) (brief: layouts).

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| hero words | page open | 520 ms each, 85 ms apart | `cubic-bezier(.22,.8,.24,1)` | none |
| chapter headings | first entry to the viewport | 550 ms | same | none |
| pack turn | pack view radio | 500 ms | same | instant |
| marker | scenario choice | 350 ms | same | instant |
| picture crossfade, copy slide (20 px) | visitor's scenario choice | 350 ms | same | instant |
| stage colour | mode change | 550 ms | same | instant |
| menu | open, close | 280 ms, 260 ms | same | instant |
| jump by link | link | 260 to 620 ms, rAF | ease-out | instant |
| hover, focus colour | pointer, focus | 120 ms | same | instant |

All durations sit inside the brief's ranges (brief: Motion and effects). Track and dot follow scroll only.

## States

Sheet: idle, pending (`aria-disabled`), ready (announced), outage (alert). Scenario: idle, busy, success, failure
(alert). Content read failure: `The story cannot be loaded right now. Please reload the page.` Unknown page:
`This page does not exist.` with `Back to the story`; unknown interview: the API message with `All interviews`.

## Media and licences

All pictures are drawn in code (licence: original): carton pack, six hue portraits, eight scenes, oxygen path, nitrate
diagram, beet root, arcs, icons, favicon. Fonts: Fontsource files of the two SIL OFL 1.1 families, copied unmodified.
Code: `pg` and its tree (MIT, ISC); build tools: TypeScript (Apache-2.0).
