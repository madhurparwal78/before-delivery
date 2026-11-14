# TRUTH — Vellum Orbit Studio, Eight Worlds

The golden's ground truth. Every value says where it came from: `brief: <section>` (copied) or `decided: <why>`.

## Ideal end-to-end flows

### 1. Walk the worlds (brief: Journeys 1; Interactions)
1. Start: `GET /` answers 200; title `Vellum Orbit Studio | Eight brand worlds`; stage `data-mode` `loading` then `3d`; `data-active-world` `ledgerwick`; yaw and target yaw `0.0`; camera `ring`; announcer empty (brief: Stage state attributes, World announcer).
2. `Enter the worlds` (click, tap, Enter, Space), all in one task: page jumps to the top of section `worlds`; `data-camera` `descending`; focus on rail button `Ledgerwick Advisory`; announcer reads `World 1 of 8: Ledgerwick Advisory, Finance and professional services`; after 900 ms the camera is `ring`. With reduced motion it is `ring` at once (brief: Opening scene).
3. Scroll (one viewport height per world), drag (80 px selects the next or previous world; the drawn yaw follows the pointer at 0.1875 degrees per pixel, within 45 degrees of the press), swipe (60 px, larger than vertical), rail click, arrow keys, Home, End, `Previous world`, `Next world` all select one world: overlay numeral, heading, industry, rail, announcer, `data-active-world`, `data-target-yaw` and the scroll position agree in that task; the ring turns from the drawn yaw to the target in 450 ms, straight, in one direction (brief: Interactions).
4. `Enter <world>`: address `/worlds/<slug>` (new history entry), title, content, focus on the h1 and `data-camera` `entering` in one task; after 700 ms `inside` with yaw equal to target yaw (brief: Entering a world).
5. `Back to all worlds`, Escape (no text field focused, no dialog open) or browser Back: address `/`, `data-camera` `leaving`, same world active, page at that world's scroll position, focus on `Enter <world>`; after 700 ms `ring`. Forward enters again (brief: Leaving a world).
6. `Previous world: <name>` and `Next world: <name>` follow ring order without wrapping; the camera moves island to island (`entering`, then `inside`) (brief: World to world).

### 2. Read a case study (brief: Journeys 2; Interactions / Case studies)
`/work/<slug>` shows h1 in the project's display face on its ground, then the nine h2 sections in order. A thumbnail opens modal dialog `Image viewer` (focus on `Close viewer`); buttons, ArrowLeft/ArrowRight and a horizontal touch swipe of 60 px or more change the image with wrap; Tab wraps; Escape or `Close viewer` returns focus to the opening thumbnail.

### 3. Filter the work (brief: Journeys 3; Work filters; Gallery address)
Service toggles and the `Industry` select filter together; counts follow Business rules; the address is `/work?service=<ids>&industry=<id>&pages=<n>` and every change replaces it; `Show more work` appends the next page and focuses its first tile; opening a tile and coming back (Back or `All work`) restores the same address and focuses that tile.

### 4. Compare services and prices (brief: Journeys 4)
Six tabs (automatic activation, wrap, Home, End) keep the address `/services/<id>`; four collapsible process steps; examples, work, prices and enquiry links. The price list filters by category and price type with the published counts; details expand independently; `Enquire about <item>` goes to `/contact?service=<category>&item=<id>`.

### 5. Send an enquiry (brief: Journeys 5; Business rules)
Four steps with validation on Next, focus on each step heading, answers kept on Back/Edit and in this tab's session storage. An address that pre-fills a service (`/contact?service=<id>`, optionally `&item=<id>`) applies it once per address and opens on step 2, where the service is chosen (brief: DP-41, Interactions); a reload, a removed item or a newly chosen service never re-applies it. Send posts once with the review's submission id. The server stores the enquiry (`pending`), makes one intake request, and answers 201 (state `sent`, intake reference stored) or 502 (`failed`). The page shows `Enquiry received` only on 201, with both references.

### 6. Recover (brief: Journeys 6; Feedback states)
Intake failure: review stays with every answer, alert text as published, `Try again` focused; retry reuses the submission id; the server hands the stored enquiry over again and never creates a second one. Missing WebGL or any failing model: still gallery of eight cards with the published notice and, after a model failure, `Try 3D again`.

### 7. Browse on a phone (brief: Journeys 7)
At 375 px the menu is a modal dialog, the rail is a sideways strip inside itself, every control is at least 44 by 44 px and nothing scrolls sideways, also with reduced motion.

## Palette roles (brief: Visual design / Colour; decided where silent, see DESIGN.md)
ground #0a0f1a, surface #101725, ink #f3ecdd, muted #b8ae9c, gold #d0a23c (primary action, current rail item, active step), gold bright #e2b855, focus #e8c16a, line #262e3d, danger #f4907f. World and project pages use their own ground, ink and accent from Seed data (brief: Seed data); the accent is never used for text on world pages.

## Type (brief: Visual design / Type)
Headlines Bodoni Moda, body Figtree, the eight world faces for world h1; all served as woff2 from `/fonts/`; figures tabular (`font-variant-numeric: tabular-nums`). Measure 46ch, which gives 66 to 68 characters on a full middle line in Figtree at 18 px (decided: inside the brief's 60 to 75).

## Space and layout per viewport (brief: Screens and layout)
- 1280 x 800: Main navigation; intro h1 spans columns 2 to 9; tiles, prices 3 columns; thumbs 4; footer 4; principles 2 by 2; rail one row of eight.
- 768 x 1024: Menu button; tiles, prices, thumbs, footer 2 columns; rail one row.
- 375 x 812: one column everywhere; rail is a strip; tabs are a strip; targets at least 44 x 44.
- Header 64 px fixed at every width; clear zone starts 72 px from the top of the viewport (brief: Interactions).
- Worlds section is 8 viewport heights tall in 3D and loading modes, as tall as its content in still mode; the stage is pinned (sticky) in view. A world page's stage band is 60% of the viewport height.

## Motion table (brief: Motion and effects)
| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| camera descent | `Enter the worlds` | 900 ms | in-out cubic (decided) | at once |
| ring yaw | active world changes | 450 ms | in-out cubic, symmetric | at once |
| camera flight | enter, leave, world to world | 700 ms | in-out cubic | at once |
| emblem | scene live | 15 deg/s | linear | none, angle stays 0.0 |
| menu panel | open, close | 200 ms, sliding down 24 px from above its place (decided distance: its controls stay reachable at every frame) | ease-out / ease-in (decided) | at once |
| viewer image | change | 240 ms | ease-out (decided) | at once |
All are driven by `requestAnimationFrame` times (canvas) or WAAPI; no timers the visitor waits for.

## States per async action
- Scene loading: `loading` (text `Loading the worlds…`), `3d`, `still` (neither WebGL 2 nor WebGL, or any model error status or failure). `Try 3D again` refetches all eight; success gives `3d` with world 1 active and focus on its rail button; failure keeps the still layout and notice. The announcer is never set by it (brief: Scene loading, Still layout).
- Gallery and price filters: results status empty at load, changes once per filter change.
- Enquiry send: pending (`Sending…`, status `Sending your enquiry…`); success (201); intake failure (502, other 5xx, network); too many (429, alert with limit, window minutes and wait minutes, focus on the alert); field errors (422, back to the earliest step).
- Files: `/scenes/...` and `/media/...` stream from MinIO; unknown files 404 `{"error":"not_found"}`; 503 `{"error":"file_unavailable"}` while MinIO is unreachable; failed images show the project's plate with the caption and `Image unavailable`.
- Health: 200 `{"status":"ok"}` whenever Postgres answers, else 503 `{"status":"unavailable"}`.

## Server rules (brief: Backend)
- Error order: unknown path 404, unpublished method 405 with `Allow`, content type 415, size 413 (16,384 bytes allowed), invalid JSON 400, field errors 422, replay, limit 429.
- References `VO-` plus six digits from 1; intake request body exactly as published, `source` `vellum-orbit-site`; timeout `INTAKE_TIMEOUT_MS`.
- Intake state changes allowed: `pending → sent`, `pending → failed`, `failed → pending` (replay). A `sent` enquiry never changes.
- Limit: `ENQUIRY_LIMIT` new enquiries per email (case-insensitive) in `ENQUIRY_WINDOW_SECONDS`; refused posts store nothing.
- Content and files are generated and stored at start (schema applied each start, starting content stored once under an advisory lock, missing MinIO files stored when the file store answers, checked every 5 s until done).

## Decisions where the brief is silent
- The gallery page size is inferred in the browser from the first page the server embeds, so only the enquiry limit and window are sent as settings (decided: brief: Configuration and secrets).
- Studio page content lives in a Postgres table (decided: the server keeps all content in Postgres).
- The stage uses 3D mode when the browser offers WebGL 2 or WebGL; the still layout applies only when it offers neither (brief: Interactions / Still layout). Three.js is pinned to 0.162.0, whose renderer asks for WebGL 2 and falls back to WebGL (decided: later releases drop WebGL, which the brief still counts).
- The footer social links open `https://*.example` in a new tab with `rel="noopener noreferrer"` (brief: Footer).

## Media and licences
- Eight island models and 48 gallery SVGs: generated by the application, original, stored in MinIO.
- Fonts: eleven woff2 files, SIL OFL 1.1 (Fontsource), listed in `app/assets.json` and `app/THIRD_PARTY_NOTICES.md`.
- No photographs, icons or video.
