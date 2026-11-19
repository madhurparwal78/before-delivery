# TRUTH.md: Wayline Data Pipeline Console

Ground truth for the build. Every value is marked `brief: <section>` (stated in instruction.md) or `decided: <why>`.
Decided design values come from the seed capture's computed styles and keyframes (the PRD capture notes), turned
into an original Wayline identity. No `solution/app` was present when this file was written, so nothing here is read
from an existing build.

## Journeys: the ideal flow

### J1. Visitor (DP-53 to DP-61)
1. `/` loads with the floating white header card, the "14.8K STARS" badge and the h1 "Keep every system in step with your AI." with "with your AI." in the violet-to-pink gradient. The page renders its headline with scripts off. `brief: Screens and layout; Browser support and performance`
2. The dot-grid canvas behind the hero shimmers (aria-hidden). The consent card "Cookie consent" sits bottom-left; nothing analytics-like is stored. `brief: Screens and layout; Server boundary`
3. Scrolling: the logo marquee drifts, the architecture diagram's tiles send pulses into the hub that fans out to "AI agents" and "Warehouses", the four metrics count up 0 to "300+", "9,000+", "4B", "15%" as they enter view, and each section fades up while sliding a touch. `brief: Screens and layout; Motion and effects`
4. "Hear your data move": the film autoplays muted and loops; "Unmute film" (aria-pressed) toggles sound; the "Chapters" list seeks to 0, 12 and 24 seconds; "Show transcript" reveals the four cues. `brief: Screens and layout; Interactions`
5. `/connectors`: "Showing 17" in a polite live region; search "sample" gives "Showing 1"; "Destinations" gives "Showing 5"; "Clear all" restores 17. Three card columns from 992 px. `brief: Screens and layout; Seed data`
6. `/pricing`: four plan cards (Starter, Team, Scale, Private Cloud), Team emphasised; "Credit package" "80 credits · $340/mo" changes the Team figure from "$140" to "$340". `brief: Screens and layout`
7. "Try it free" opens `/login`. An unknown path answers 404 with a link home. `brief: Interactions; Screens and layout`

### J2. Editor sets up a connection (DP-18 to DP-26)
1. Sign in at `/login` (editor@example.com / deku-demo-pw-2026); `/app` shows h1 "Connections", the three health cards under "All syncs healthy", and the connection list. `brief: Seed data; Screens and layout`
2. `/app/sources`: the New source form; API key "short" shows its error beneath the field (polite); a valid key creates the source. `brief: Feedback states`
3. "New connection" opens `/app/connections/new`. The step list marks the current step with `aria-current="step"` and a violet highlight. Source, Destination, Streams ("Sync <stream>" checkbox + "Sync mode for <stream>" select), Schedule (Manual / Every N minutes / Cron with conditional fields, name, prefix, policy). "Back" keeps every value. `brief: Screens and layout; Interactions`
4. "Create connection" opens `/app/connections/<id>` with the flow diagram image "Data flow from <source> to Lumen Warehouse", the streams table and an empty job history. Name taken: 409 `name_taken` (decided before `table_conflict` when both apply); interval below 15 minutes on team: 422 `frequency_exceeds_plan`, shown as field errors. `brief: API; Business rules`

### J3. Editor runs a sync (DP-27 to DP-42)
1. "Sync now": `POST /api/connections/<id>/sync` answers 201; the row reads Running within 2 s; beams travel along the diagram and the hub breathes; the live log (JetBrains Mono) streams `Sync started`, then one `stream <name>: <n> records read` line per stream over the event stream; the `stream <name>: <n> records committed` lines and `Sync succeeded` are appended only in the single commit that writes the rows (brief: API, Jobs logs: exactly that order). `brief: API; Business rules; Motion and effects`
2. About 21 s later (decided: 20 s running after a 1 s start, inside the brief's 8 to 30 s) the job commits rows, cursors and status in one transaction; the row reads Succeeded with the records committed; the status region announces "Sync succeeded"; with sounds on a rising two-note chime plays (one `AudioContext`, two `OscillatorNode` starts, brief: Feedback states; decided: 660 Hz then 880 Hz, about 0.12 s each, gentle gain). `brief: Feedback states; decided: a short, quiet chime that reads as success`
3. The warehouse table page shows 50 rows per page with "Next page" / "Previous page". `brief: Screens and layout`
4. A second "Sync now" while running: 409 `sync_already_running`. "Cancel": Cancelled, nothing written, "Sync cancelled" announced. "Reset": confirmation dialog; Escape closes it and returns focus to "Reset"; confirming empties the tables and clears cursors. `brief: Interactions; Business rules`
5. Incremental append: a second sync commits only appended rows; incremental dedup keeps one newest row per id. `brief: Business rules`

### J4. Editor builds a connector (DP-43 to DP-47)
1. `/app/builder` opens the starting manifest (`/mock-api/v1`, `X-Api-Key`, stream `invoices`, path `/invoices`, key `id`, selector `data`, page size 3). "UI" and "YAML" tabs mirror each other. `brief: Screens and layout`
2. API key `sandbox-key-2026`, "Test": three pages, "7 records", INV-1042 to INV-1048, detected fields `id: string`, `customer: string`, `total_cents: integer`, `status: string`. `brief: API`
3. "Publish": custom runnable source definition version 1 (republish keeps the id, version 2); a source from it syncs the seven invoices. `brief: API`

### J5. Admin manages the workspace (DP-12 to DP-15, DP-48 to DP-52)
1. `/app/members`: "Invite member" (Email, Name, Role) shows the `/accept-invite?token=<token>` link once; `/accept-invite` with a 12+ character password signs the invitee in. `brief: Screens and layout; API`
2. `/app/audit` lists the hash chain oldest first from the 64-zero genesis hash. `/app/settings` shows the "Plan" select to admins only. `brief: Business rules; Screens and layout`
3. Top bar: "Sync sounds" and "Dark theme" switches persist per user; Control+K opens "Command palette"; "Account menu" > "Sign out" returns to `/`. `brief: Interactions`

## Palette

| Role | Value | Source |
|---|---|---|
| Page and surfaces | `#ffffff` | decided: captured surface, matches brief "on white" |
| Body text | `#5c5c5c` | decided: the captured `#666666` one step darker so body copy also clears AA on the `#f5f5f5` panel (6.1:1); brief "mid neutral grey" |
| Headings | `#0a0a0a` | decided: near-black neutral, brief "near-black neutral" |
| Muted secondary text | `#707070` | decided: the captured `#858585` darkened to hold 4.5:1 on white and on `#f8f8fa`; brief "lighter grey" |
| Hairlines, card rings | `#e6e6e6` (ring `0 0 0 1px #d0d0d0`) | decided: captured hairline and card ring |
| Default border | `#d0d0d0` | decided: captured `--border` |
| Subtle panel surface | `#f5f5f5` | decided: captured |
| Console page | `#f8f8fa` | decided: captured off-white page |
| Action violet (primary fill) | `#6e4bea` | decided: the captured `#695edf` (hue 245) shifted to hue 253 so it reads violet, white text 5.4:1 |
| Violet ink (links, ticks, active nav text) | `#5e3fd6` | decided: darker partner of the action violet, 6.7:1 on white |
| Primary hover (deep navy) | `#2c2f74` | decided: brief "darkening to deep navy on hover" |
| Lavender (mock borders) | `#a299ff` | decided: captured light accent |
| Active row tint | `#ecebfd` | decided: pale cool violet tint |
| Gradient | `#6e4bea` to `#d4489f` | decided: brief "violet into warm pink" (pink hue 323) |
| Glow | `#8f7bff` | decided: brief "light, vivid indigo" |
| Hub tile | `#b3abff` to `#4536c4` top to bottom | decided: brief "light, soft indigo down to a deep indigo" |
| Sign-in chooser page / cards / outline | `#050505` / `#111111` / `#2e2e2e` | decided: near-black page and cards with a visibly lighter deep-grey outline |
| Dark theme panel / page / raised | `#141c45` / `#0b1030` / `#1c2558` | decided: deep cool night blue (hue ~230) on a darker page of the same hue; the document body takes the page colour too |
| Status: Succeeded / Running / Failed / Cancelled, Pending | `#1f9d3a` / `#d18b00` / `#e0413a` / `#8a8a8a` | decided: green, amber, red and grey (brief); terminal-window dots keep `#27c93f` `#ffbd2e` `#ff5f56` |

Contrast: body `#5c5c5c` on white is 6.7:1, muted `#707070` is 4.9:1 and white on `#6e4bea` is 5.4:1; dark theme text is `#e8eaf6` on `#141c45` (14.6:1), muted `#a9b0d6` (7.9:1), links `#b9b0ff`. Cross glyphs `#7a7a7a` (4.3:1), tick glyphs `#5e3fd6`. Every pairing is checked against WCAG 2.2 AA with axe in both themes. `brief: Accessibility; decided: values`

## Type

| Use | Face | Size / line | Source |
|---|---|---|---|
| Body | Inter, fallback system-ui, -apple-system, "Segoe UI", sans-serif | 16 / 24 px | brief: Visual design |
| Small UI | Inter | 13 and 14 px | brief: Visual design |
| Hero h1 | Inter 600, tracking -0.035em | clamp(40 px, 6 vw, 68 px), two lines at desktop | decided: display size "several times the body" |
| Section h2 | Inter 600 | 40 px desktop, 28 px phone | decided: steps down from the hero |
| Labels, nav, tags, eyebrows, buttons | Fragment Mono, uppercase, 13 px, tracking 0.04em | | brief: Visual design |
| Code, logs, YAML | JetBrains Mono 13 px | | brief: Visual design |
| Console figures | Inter, `font-variant-numeric: tabular-nums` | 32 px health figures | brief: tabular numerals; decided: size |

Fonts are self-hosted subsets (Inter 400/500/600, Fragment Mono 400, JetBrains Mono 400), open-licence files shipped in the app and served from its own origin, never a font CDN, with `font-display: swap`. `brief: Visual design; Deployment; Browser support and performance`

## Console layout details

- Connection page: the flow diagram takes its own full-width row; below it Summary and Streams sit side by side at their content height; from 1280 the job history and live log split 5:4. Below 600 px the diagram stacks source, hub and warehouse vertically so tile names stay legible; names wrap onto extra lines inside the tile, never an ellipsis, and each tile carries its full name as its SVG title. `decided: the diagram names what it shows at every width`
- Sources list: names and connectors wrap so every row keeps its right-aligned "Check" button in view; Created shows date plus `HH:mm`. The Start date placeholder is an example date (`2026-01-01`), with the `YYYY-MM-DD` pattern as the hint. `brief: Sources page; decided: no repeated text`
- "Settings status" sits in the top bar beside the workspace name, so the page does not shift when it speaks. `decided`
- An empty cell in the Streams table ("—") is set in the interface face; only real cursor values use JetBrains Mono. `decided`

## Shape

Controls and tabs 8 px radius; search fields and large cards 20 px; panels 12 px; chips fully round. Card ring one pixel pale grey; raised mocks add a soft violet-tinted shadow; consent card soft shadow; mobile overlay frosted with a 16 px backdrop blur. `brief: Visual design; decided: radii and blur captured`

## Layout per viewport

| Viewport | Layout | Source |
|---|---|---|
| 320 px | single column, no horizontal scroll on `/` | brief: Screens and layout |
| 375x812 (below 480) | everything stacks; hero buttons full width; header links behind "Menu" (frosted full-height overlay); comparison matrix one plan at a time with a plan switch; console rail is a drawer opened by a labelled button; row controls 44 px | brief: Screens and layout |
| 390 px | every button, form control and chrome link at least 44x44 px | brief: Accessibility |
| 768x1024 (768 to 991) | header links folded behind "Menu"; console rail a drawer; catalog two columns; comparison shows all four plan columns side by side with no "Plan" tab set (from 768 up; below 768 one plan at a time behind the "Plan" tab set) | brief: Screens and layout |
| 992 px and up | header links inline; catalog three columns; console rail fixed at left | brief: Screens and layout |
| 1280x800 and up | content column widens toward its cap (decided: 1200 px) and centres; console rows compact | brief: Screens and layout; decided: cap |

## Breakpoints

Below 480 (stack, full-width hero buttons); below 768 (comparison "Plan" tab set, one catalog column); from 768 (all plan columns, two catalog columns); below 992 (header "Menu", console rail drawer); from 992 (three catalog columns, fixed rail); from 1280 (content column widens toward its cap). `brief: Screens and layout`

## Motion

Easing: the house curve `cubic-bezier(.22,1,.36,1)` for entrances, opacity reveals and colour shifts; blurred fades `cubic-bezier(.45,0,.15,1)`. `decided: captured curves; brief: "leaving quickly and arriving slowly"`

| Motion | Timing | Reduced motion | Source |
|---|---|---|---|
| Flow beam (stroke-dashoffset across the path, fades in at 8 %, out after 80 %) | 3000 ms, infinite while a job runs | removed, diagram static | brief: "each crossing a line in about three seconds" |
| Dash march between stages | 1100 ms linear, infinite | removed | decided: captured |
| Hub breathe (opacity .8 to 1, scale .95 to 1) | 1000 ms alternate (a 2 s cycle) | removed | brief: "about every two seconds" |
| Idle diagram | no animation at all | — | brief: "When no job is running, the diagram is still" |
| Finished-run ring | one 1000 ms ring from the end node (scale 1 to 1.9, fading) | not drawn | brief: "over about one second" |
| Section fade-up (opacity 0 to 1, translateY 18 px to 0) | 420 ms ease-out, rAF-driven, the first time a section enters view; at rest until then | content shown in place at once | brief: "in under half a second" |
| Metric count-up | 1500 ms from 0 the first time the metrics enter view (rAF) | final values at once | brief: "about one and a half seconds" |
| Hero dot grid shimmer (canvas, DPR capped at 2) | continuous rAF, 6 s shimmer cycle | one static frame | brief: "shimmers slowly" |
| Wordmark ticker | 60 s linear, masked edges | still row | brief: drifts sideways, fades at both edges |
| Typing dots (MCP), orbit rings, YAML caret, AI ASSISTANT sweep | 1100 ms staggered, 24 s and 36 s, 1100 ms blink, 1400 ms while thinking | still | brief: Other marketing loops |
| Button and link colour shifts (primary violet to navy) | 160 ms ease-out | instant | brief: "about a sixth of a second" |
| Console drawer slide (translateX -32 px to 0, opacity in) over a dimmed page | 250 ms ease-out | appears at once | brief: "slides in from the left in about a quarter of a second" |
| Film | autoplay muted, loop | never autoplays | brief |

## States

| Surface | Pending | Success | Error | Source |
|---|---|---|---|---|
| Sign in | button reads "Signing in…" and is disabled while posting | opens exactly the `redirect_to` the server returns (the `next` address when it resolves inside `/app`, otherwise `/app`) | "Email or password is incorrect." in a polite region | brief: Feedback states |
| New source / Invite member / wizard | button disabled while posting | list updates / invite link shown once / connection page opens | field errors beneath fields, polite | brief: Feedback states |
| Job row | Pending, then Running (amber dot), live log streaming | Succeeded (green), "Sync succeeded" in the status region, chime if on | Failed (red), "Sync failed"; Cancelled (grey), "Sync cancelled"; with sounds on a falling two-note chime (decided: 520 Hz then 392 Hz) | brief: Feedback states |
| Catalog | | "Showing N" updates, polite | | brief: Feedback states |
| Dashboard monitor | | "All syncs healthy" when no connection's latest job failed | "<n> connections need attention", `<n>` the connections whose latest job failed (a connection with no jobs counts as healthy) | brief: Screens and layout |
| Unknown path | | | 404 page with "Back to home" link | brief; decided: link copy |
| Connection page result | | the sync outcome in `Sync status` carries its status dot; the "Connection status" line clears when the next sync, cancel or reset starts | | decided: the outcome reads at a glance and no stale line outlives its action |
| Sync now sequence | "Starting sync…" from the press, "Sync running" once the job reads running (first log line, the job read or the history) | final copy in the job-end render, with the job row and the Streams table's Rows and Cursor | refusal copy; 503 database copy / outage copy in `alert` | brief: Feedback states |
| Wizard after a 401 | draft saved to this tab's session storage for the signed-in user | after the same user signs in: Schedule step restored, "Signed in again. Your connection draft is restored." | another user, sign-out, success or any other entry: discarded, blank Source step | brief: Interactions |
| Builder YAML | | readable again: copy gone, tabs and buttons work | "This YAML can't be read. Fix it before switching tabs." as the field's description; YAML tab held; Test and Publish disabled | brief: Feedback states |
| Console page the role may not open | | | replaced by `/app` (history entry replaced) with "You don't have permission to do that." in `alert` | brief: Interactions |

## Server ground truth

- One transaction per successful sync: warehouse rows (each tagged `_wayline_job_id`, `_wayline_extracted_at`), cursor values and the job status commit together; cancel and failure roll back. `brief: Business rules`
- Postgres constraints: unique `(workspace_id, name)` on connections; partial unique index on jobs `(connection_id) WHERE status IN ('pending','running')`; unique `(workspace_id, key)` on idempotency keys; unique `(workspace_id, seq)` on audit events, appended under a workspace row lock. `brief: Services; decided: mechanism`
- Collections live in `public`; each destination's warehouse tables live in the schema `warehouse_<destination id>` (lowercased, non `[a-z0-9_]` characters as `_`), so `table_conflict` is per destination and two destinations may both hold `shop_orders`. `brief: Services`
- Connection creation answers the first broken rule in the order `validation`, `name_taken`, `table_conflict`, `frequency_exceeds_plan`. `brief: API`
- Paging cursors are opaque and signed (HMAC), and each is valid only on the listing that issued it: job cursors carry the position `(created_at, id)` bound to the workspace and the `connection_id` filter or none; records cursors carry the position bound to the workspace, destination, table and its current generation. An edited, truncated, undecodable, foreign or earlier-generation cursor answers 400 `invalid_cursor`, never a 5xx. `brief: Business rules, Paging; decided: HMAC signature and keyset position`
- Lockout: five failed sign-ins for one email within one lockout period, with no success between, lock it for one lockout period from the fifth failure (429 `too_many_attempts` with `Retry-After`); the period is `WAYLINE_LOCKOUT_SECONDS`, read at start, default 900. Lock state lives in the database. `brief: Business rules`
- Builder reads only `base_url` beginning `/mock-api/`, resolved in-process, never over the network to another host. `brief: Server boundary`
- Seeds on start, idempotent; seeded logins written to `USER_README.md`; schema created on start because grading resets the database. `brief: Seed data; Deployment`

## Judged criteria mapping

| Criterion | What the build shows | Requirement |
|---|---|---|
| B1 | `/signin` near-black `#050505` page, two `#111111` cards outlined `#2e2e2e`, each with a violet button | DP-57 |
| B2 | floating white header card, 12 px inset, outlined "Talk to sales" and violet "Try it free" | DP-58 |
| B3 | Team card raised on a violet-tinted shadow under a violet-to-pink top band with the "Best value past 25 GB" chip; its ring stays the same 1 px pale grey as every card | DP-59 |
| B4 | "Build with Wayline" band with its own background above the link columns | DP-58 |
| B5 | 01 Copy / 02 Query / 03 Act each swap the diagram and caption | DP-53 |
| B6 | three health cards with 32 px tabular figures under the monitor line | DP-26 |
| B7 | live log lines appended one by one in JetBrains Mono, an `HH:MM:SS` column beside a wrapping message column | DP-38 |
| B8 | detected fields listed as `name: type` | DP-47 |
| B9 | current step filled violet with `aria-current="step"` | DP-25 |
| B10 | palette option highlight follows the arrow keys (aria-activedescendant) | DP-49 |
| B11 | label above field, error text directly below it | DP-20 |
| B12 | white surfaces, `#5c5c5c` body, near-black headings, single violet `#6e4bea` | DP-62 |
| B13 | Fragment Mono uppercase labels | DP-58 |
| B14 | gradient text on the hero second line and metric figures | DP-62 |
| B15 | 1 px `#d0d0d0` ring cards with 20 px radius | DP-62 |
| B16 | faint dot grid behind the hero, static under reduced motion | DP-62 |
| B17 | 36 px job rows with tabular numerals | DP-38 |
| B18 | tiles, curved beams, hub, "AI agents" and "Warehouses" cards; the console flow diagram's source tile carries a braces glyph and its warehouse tile the disc stack, joined to the hub by curved links | DP-53, DP-39 |
| B19 | monogram tile, name, category, availability chips on each card | DP-17 |
| B20 | dot plus word per status | DP-38 |
| B21 | below 992 px no rail: "Open navigation" opens the "Navigation" drawer dialog ("Close navigation" first); from 992 the "Console" rail | DP-51, DP-90 |
| B22 | one plan column with a plan switch at 375 px | DP-59 |
| S1 | sync commit in one transaction | DP-27, DP-36 |
| S2 | database constraints listed above | DP-22, DP-33, DP-34, DP-35 |
| S3 | `/mock-api/` prefix check before any fetch | DP-45 |
| Q1 | `StatusChip`, `CatalogCard`, `JobTable` shared components | DP-63 |
| Q2 | one error helper emitting `{error, request_id}` | DP-11 |

## Media and licences

| Asset | Licence | Source |
|---|---|---|
| `assets/data-sonification-…webm` (served at `/media/data-in-sound.webm`) | public domain (NASA) | brief: Deployment; Wikimedia Commons file page |
| `/media/data-in-sound.en.vtt`, `/media/data-in-sound.chapters.vtt` | original | brief: Media (cue text verbatim) |
| Inter 400/500/600, Fragment Mono 400, JetBrains Mono 400 latin woff2 | OFL-1.1 | brief: Visual design; Fontsource packages |
| Wayline ribbon mark, icons, diagrams, monograms | original | brief: Iconography, Assets |
