# TRUTH: Vasant Talkies Drinks Interval

The brief (`instruction.md`) made concrete. Every value says where it came from: `brief: <section>` is copied verbatim, `decided: <why>` is where the brief is silent. Nothing here reinterprets the brief; if the two ever differ, the brief wins.

## Ideal flow of each journey

### 1. A buyer reads a pack on a phone (brief: Journeys 1; Interactions)
- Start: `/` at 375x812 on the seeded catalogue; stage shows the KP-200-CTN story batch `NSK-260915-07`.
- Actions: opens `Reels` mid-story; takes `The Pack`; types a carton code in `Batch code`; submits; swipes or moves `Turn the pack`.
- Visible end: address `/?batch=<code>`; `Batch <code> read.` in `Pack reader status`; at progress 0.75 up a seated sticker beside the printed MRP if the server says so; `Pack facts` states the same printed MRP, revised MRP, unit sale price, dates as the panel.
- Provider end: none written; Postgres read at request time.

### 2. A buyer with reduced motion shares a pack (brief: Journeys 2; Motion > Reduced motion)
- Start: `/?sku=<code>` under reduced motion; no pin; slider absent; `Front`, `Back`, `Sticker` buttons shown.
- Actions: picks each still; chooses another lineup pack; goes Back.
- End: the first pack returns, page does not move, mirror text unchanged by the still chosen.

### 3. A kirana owner settles a counter dispute (brief: Journeys 3)
- Start: The Pack with a wrong phone clock.
- Actions: types a misspelt name in `Find a pack`; arrow keys or tap to choose; opens the notice; downloads the PDF of the version in force.
- End: result prices read from Postgres; link is a 60-second signed MinIO link renewed at age 30 s on a monotonic timer. With printing or storage down the owned sentence replaces the link and the prices stay. Past Kolkata midnight `region "New day"` shows; `Read today's prices` re-reads in place.

### 4. The editor imports and publishes by keyboard (brief: Journeys 4)
- Start: `/editor` on the exact seed, `CALL SHEET EMPTY`.
- Actions: chooses a file; `Import sheet`; settles rows (focus moves to the next open row, then to `Draft notice from sheet <filename>`); downloads evidence; drafts; follows `Fix <sku code>` from a refused row; `Save draft`; `Publish <title>`; `Publish notice now`.
- Visible end: focus on `Correct notice <number>`; `Notice <number> version 1 published.`; `Print pending` then `Printable` announced once; public reload shows the new price everywhere.
- Provider end: outbox rows in the same transaction; relay publishes confirmed durable jobs to `interval.<copyId>.work`; PDF at `<copyId>/notices/<number>/v1.pdf`; Meilisearch document of each SKU updated; one Svix message per subscribed endpoint with event id `<number>-v1-<endpointId>`.

### 5. The editor allows old wrappers (brief: Journeys 5; Business rules > Old wrappers)
- Actions: sets `Old wrappers until` on a sticker notice; registers a batch packed after the effective date with `Old wrapper` checked.
- End: reader shows old print + sticker + `Old wrapper under <number> v<version>` + `Read notice <number>`; a plain batch of that day shows the new print and no sticker; a stranding correction answers 409 `run_out_batches_exist`.

### 6. A stockist wires up their price master (brief: Journeys 6)
- Actions: `Save endpoint`; copies the secret from `dialog "Signing secret"`; `Send test to <url>`; after a publish reads the log; `Redeliver <event id>` or `Recover failed for <url>`; `Rotate secret for <url>`; `Remove <url>`; `Download price sheet`.
- End: Delivered or Failed only from Svix attempts; removal cancels undelivered entries and deletes the endpoint at Svix.

### 7. The services go away, misbehave and come back (brief: Journeys 7; Services)
- Actions answer within 5 seconds and nothing hangs; `alert "Message status"` and `alert "Work status"` carry the owned sentences, also behind an open dialog; on return, with no restart, each piece of work completes once and the sentence clears. Printing failure stays `Print failed` until `Retry print`. Search reports `down`, exact codes still answer. Storage refuses with the owned sentence and the link returns by itself.

### 8. The editor corrects, renames and loses a session (brief: Journeys 8)
- Correction: version 1 stays downloadable, `Superseded by version 2`; `notice.corrected` under a new event id.
- Rename: `Drink`, `Pack`, `Batch pack`, `Settle row <n> to` labels, draft row names and `Pack history` update in place, focus stays on the control used; published notices keep their names.
- Ended session: 401 sends the tab to `/sign-in` with `Your session has ended. Sign in again.`; same account signing in restores typed values with `Your unsaved work was kept. Nothing has been sent.`; another account or `Sign out` discards them. Held values live in that tab's memory only (decided: the brief says "within that tab", and IF-04 forbids product data elsewhere).

## Palette (brief: Visual design > Colour)

| Role | Hex | Source |
|---|---|---|
| Ground, deep carmine | `#9C1220` | brief: Colour (156, 18, 32) |
| Surface, darker carmine | `#8A101C` | brief: Colour (138, 16, 28) |
| Ink, white | `#FFFFFF` | brief: Colour |
| Muted, pale pink | `#F0B9BD` | brief: Colour (240, 185, 189) |
| Accent, blush pink | `#FFD9DC` | brief: Colour (255, 217, 220) |
| Text on accent, carmine | `#9C1220` | brief: Colour |
| Charcoal | `#2A2A2A` | brief: Colour (42, 42, 42) |
| Lineup greys | 255, 230, 205, 185, 165, 150 per channel | brief: The Lineup |

## Type (brief: Visual design > Type)
- Bebas Neue for display; EB Garamond for everything else; no monospace; prices in old-style tabular figures.
- Heading steps one third larger each: 26.67, 35.56, 47.41, 63.21, 84.28 px (decided: a 20 px body times 4/3, the brief fixes the ratio and the 20 px labels).

## Space and layout per viewport (brief: Screens and layout)
| Width | Layout |
|---|---|
| Under 768 | Single column; Reels button with hidden links; stage above mirror in the pinned view; stacked records in lists |
| 768 to 1279 | Links always visible; stage 60% left, mirror 40% right; tables; `/stockist` and `/editor` single column; Desk bar while rows are open |
| 1280 and up | Stage centred within 5%, mirror a rail to its right; `/stockist` and `/editor` two columns; no Desk bar |

Hero: carmine top 82%, charcoal bottom 18% (brief). Shout flush left at 20 px (brief). Spacing scale 8, 16, 24, 40, 64, 96 px (decided: "airy" in Density). All corners square except the single arch (brief).

## Motion table
| Element | Trigger | Duration | Easing | Reduced-motion substitute | Source |
|---|---|---|---|---|---|
| Hero pack travel, arch opening | Scroll over the first screen | Scroll-linked | Linear in scroll | Arch stays open, reads 1, no travel | brief: Hero opening |
| Pack yaw | Progress 0 to 0.55 | Scroll-linked | Constant rate, 0 to 180 degrees | `Front`, `Back`, `Sticker` stills | brief: Sticker Turn |
| Sticker flight | Progress 0.55 to 0.75 | Scroll-linked | Straight line, linear in progress | Seated or absent in `Sticker` still | brief: Sticker Turn, Flight |
| Camera | Progress 0.75 to 1 | Scroll-linked | Constant, 6 to 3.2 | `Sticker` still at 3.2 | brief: Sticker Turn |
| Pack swap | Pack choice | 320 ms (band 280 to 360) | cubic-bezier(0.2, 0, 0, 1) | Stays at 1 | brief: Swaps; 320 decided as the band's centre |
| Mirror swap | Pack choice | 180 ms (band 150 to 210) | cubic-bezier(0.2, 0, 0, 1) | Stays at 1 | brief: Swaps; 180 decided as the band's centre |
| Marquee | Always, pausable | 48 px/s, about 27 s across 1280 px (band 20 to 40 s) | Linear | Static list | brief: Marquee; 48 decided inside the band |
| Button field and ink | Hover, focus, press | 120 ms (under 200) | ease-out | None | brief: Hover and press; 120 decided |
| Page ease | Wheel on pointer devices | About 70 ms time constant | Exponential | None | brief: "eases gently"; 70 decided |

## States per async action (brief: Feedback states > Async actions)
Every row of that table is built verbatim in its named live region: Read pack, Find a pack, Read today's prices, Sign in, Import sheet, Settle or ignore, Save draft, Draft from sheet, Publish or correct, Retry print, Save endpoint, Send test, Rotate, Remove, Redeliver, Recover, Rename, Register batch. Owned sentences live in one file, `app/src/shared/copy.ts`.

Decided where silent:
- A file-less `Import sheet` shows the server's `validation` message in `Import status` (decided: the table says failure shows the response's message).
- The correction dialog has a `Close` button beside Escape (decided: a phone has no Escape key, and DP-43 requires every control path to work by touch).
- `Settle row <n> to` opens on a row's first candidate, else the first SKU (decided: the brief says one option per SKU, so no empty option exists).
- Matched rows sit in a closed disclosure per sheet (decided: a 5,000-row sheet must not make the desk unusable, and open rows are what the editor acts on).

## Breakpoints (brief: Screens and layout)
768 and 1280, holding at 767, 768, 1279 and 1280. No horizontal page scroll at 375x812, 768x1024, 1280x800.

## Media and licences
| Item | Licence | Source |
|---|---|---|
| Packs (carton, PET, glass, can), grain | original, procedural at runtime | brief: Assets; IF-06 |
| Bebas Neue, EB Garamond woff2 | OFL-1.1 | brief: Type; `app/assets.json`, `app/THIRD_PARTY_NOTICES.md` |
| Phosphor icons, inlined paths | MIT | brief: Icons and figures |
| three.js, Preact, pg, amqplib | MIT | decided: `DESIGN.md` UI kit; `app/THIRD_PARTY_NOTICES.md` |
