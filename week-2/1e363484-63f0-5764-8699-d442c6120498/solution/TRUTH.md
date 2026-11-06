# TRUTH — Sedgemoor Instrument Works Fluxseal (golden)

Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys (ideal flow)

1. **Explore, preview and share** (brief: Journeys 1, Interactions).
   - Start: Tomas signs in (`/signin`, `tomas@levelmoor.example` / seeded password) → `/projects` → Blackmere Moss.
     The address is replaced with the canonical form `/projects/blackmere-moss?from=…&to=…&start=…&end=…&sensors=BM-S1,…` (brief: Workspace URL); the brush spans the whole window; one bar per UTC day hangs below the zero rule.
   - Actions: From/To + Apply dates (pushes one history entry; brush resets to the window); untick a sensor (checkbox and footprint stay in step; the last selected sensor is disabled); drag/resize the brush (whole half-hours, clamped) and use the keys (←/↓ −30 min, →/↑ +30 min, PgDn/PgUp ∓1 day, Home/End window edges; Previous/Next shift by the span).
     Each change asks `POST /api/projects/<slug>/preview` at most every 250 ms (decided: "a few times per second") plus the trailing position; only the answer for the newest requested position is shown.
   - Visible end: the map's contributing footprints tint moss (others return to hatching), Coverage and Net count to the server values in 450 ms, the meter jumps to its value at once, Seal figure is armed (ochre) or disabled with its reason; 500 ms after the last change the address is replaced (no history entry) and `status "Workspace status"` says `Coverage <c>%, net <signed> tCO2e. Seal available.` (or the floor / unavailable variants) once.
   - Provider end: nothing stored (previews are never stored, brief: Figure states).
2. **Seal a figure** (brief: Journeys 2, Seal).
   - Seal figure → `dialog "Seal figure"` (interval, sensors, coverage, net, buffer, credited, 12 fingerprint characters; focus on Confirm seal; key `seal-<32 hex>` made at open).
   - Confirm → button `Sealing...` disabled, status `Sealing figure. Waiting for evidence storage to confirm.`; tables, ledger and balance unchanged; no refresh while pending.
   - 201 → dialog closes, status `Sealed <id>: <signed> tCO2e at <c>% coverage.` (+ ` Supersedes <old>.`), tables refetch, focus on the new figure's link.
   - Provider end: one `figures` row (`sealed`), `issuance` entry = net, `buffer` entry = buffer when net < 0; `figures/<id>/readings.csv` (text/csv, `x-amz-meta-sha256` = fingerprint) and `derivation.json` (= the 201 body); one Mailpit message to the lead with subject `Sealed <id>: <tonnes> tCO2e at <c>% coverage`; one `idempotency_records` row.
3. **Seal during an outage**: storage down → `503 storage_unavailable` (< 10 s; every S3 call times out at 2.5 s); mail down → objects written, confirmed, then deleted, `503 mail_unavailable`. Dialog alert + status show the outage copy once; Confirm seal stays enabled and focused; nothing stored anywhere (transaction rolled back).
4. **Re-ingest breaks a seal**: parallel batches serialise on the project advisory lock; the first that changes a reading in scope re-derives the fingerprint, marks the figure `broken`, writes one reversal per entry and queues one alert in the same commit; later batches add revisions only. Alert: To lead + sealer (deduplicated), subject `Seal broken on <id> (readings moved: <n>)`, sent right after commit and every 30 s, claimed `FOR UPDATE SKIP LOCKED`.
5. **Re-seal after a break**: Figure page → Open interval in workspace (exact window/brush/sensors) → seal → the broken figure becomes `superseded` (`superseded_by`), the new figure `supersedes` it; no ledger entry for the old figure; status names the superseded figure.
6. **Lead on a phone**: Projects as cards → workspace; the figure panel is a fixed bottom sheet (collapsed: coverage gauge, net, Seal figure, Figure details; ≤ ⅓ viewport); a refresh (15 s) turns the row Broken, drops balance/buffer, announces once, keeps brush, sheet and focus.
7. **Regulator**: `/r/<token>` (no account): `Status: Intact|Broken|Superseded by <id>`, `Checked at <server time>`, `Link expires <…>`; Re-derive (POST, server verdict), audit trail, Download readings file (stored bytes, `<id>-readings.csv`).
8. **Links end; access changes**: revoked/expired/unknown pages show only the published heading and line; revoke after expiry → `This link has already expired.`; grant removed → open workspace's next request 404 → `/projects` with `You no longer have access to this project.`; lowered to analyst → Confirm seal answers 403 → dialog shows the analyst role copy.

## Business values (brief: Business rules, verbatim)

- Unit chain: CO2 t = ΣFC × 1800 × 0.00004401 × A ÷ 1 000 000; CH4 t CO2e = ΣFCH4 × 1800 × 0.00000001604 × 27.0 × A ÷ 1 000 000. Exact rationals (BigInt), half-even at 0.001 on totals; contributions by largest remainder, ties by byte order.
- Contributing: qualifying (qc 0/1) half-hours ≥ 80 % of the interval's half-hours.
- Coverage: towers then cells, byte order, each its exact area inside the boundary minus area already allocated (exact slab geometry), rounded half-even to m²; coverage = Σareas × 100 ÷ boundary area, one decimal, compared rounded with the floor.
- Buffer = round_half_even(|N| × buffer_pct ÷ 100, 3) from the rounded net when N < 0, else 0.000; credited = N + buffer.
- Seal precondition order: readings_changed → below_coverage_floor → interval_overlaps_sealed → already_sealed; storage and mail only after all four.
- Figure ids `<code>-F<4 digits>` from a Postgres sequence per project (never reused; gaps allowed).
- Link: 43-character base64url token; `expires_at = issued_at + LINK_TTL_SECONDS`; status from one clock read per request, `Date` header from the same read.
- `<moved>` on the Figure page banner: decided — the figure body has no field for it, so the page counts the distinct readings of the first batch in the figure's audit trail (with per-project serialisation the first batch after sealing is the breaking batch); the alert uses the server's own count.

## Palette (decided within brief: Visual design)

| Role | Hex |
|---|---|
| paper ground | `#F4EFE3` |
| ink (text, rules, hatching) | `#15211B` |
| covered moss | `#7E9969` |
| ochre accent (armed Seal figure, Confirm seal) | `#C9973A` |
| focus ring (ochre, deeper for 4.4:1) | `#94650F` |
| oxblood (broken only) | `#7B2330` |

## Type, space, layout

- Instrument Serif headings (h1 31, h2 26, h3 21.6, h4 18 px — ×1.2 per level from 15 px body, brief: Type), Instrument Sans body 15 px, IBM Plex Mono for every number and fingerprint, tabular figures, weights 400/500; numeric and timestamp table cells are set in the mono face as a whole, and an interval is one mono string `<start> to <end>`.
- Buffer mark (brief: Colour): a bar 8 px tall beside Net, width = buffer ÷ |net| of a 96 px track (min 16 px), 1 px ink outline, sparse hatching, mono caption `buffer <tonnes>` (decided: legible as a bar, not a glyph).
- An empty Figures table holds one row `No figures sealed yet.` (decided: the brief is silent; an empty header-only table reads as scaffolding).
- Spacing unit 4 px; every control ≥ 44 × 44 px; hairline 1 px ink rules between panes; no shadows and no gradients anywhere (brief: Surfaces); survey hatching is drawn as SVG line work — an SVG pattern on the map, tiled SVG line images on the emission bars and the buffer bar (decided: hatching without any gradient).
- ≥ 1200 px: sticky two panes (timeline left; map, sensors, figure right) of height `100vh − 121px`, records (with an ink top rule) scroll over them; the map width is `(100vh − 620px) × aspect` (≤ 340 px) and the disabled reason spans the panel under the button row, so the whole figure panel and its reason fit at 1280×800 (decided: the reason must be readable without scrolling a pane); 700–1199 px: map, timeline, sensors, figure stacked; < 700 px: map, timeline, sensors stacked + bottom sheet, tables as label/value cards (explicit table roles keep semantics).
- DOM order (= Tab order) follows the brief per layout (timeline before map at ≥ 1200 px; map first below; Unit breakdown before Seal figure in panes, after it in the sheet).

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| Coverage / Net visible numerals (rAF) | newest preview arrives | 450 ms | ease-out cubic | final value at once |
| Covered tint `opacity` per footprint (rAF) | same | 450 ms | ease-out cubic | final at once |
| Gauge fill `transform: scaleX` (rAF) | same | 450 ms | ease-out cubic | final at once |
| Dialog `opacity`, `translate` | open / close | 240 ms in, 140 ms out | ease-out / ease-in | none |
| Sheet `transform` | Figure details expands | 250 ms | ease-out | none |
| Button `filter: brightness(.92)` | press | 80 ms | linear | none |
| Underline colour | hover | 120 ms | linear | none |

## States per async action

| Action | Pending | Success | Failure |
|---|---|---|---|
| preview | previous figure stays | figure + tide; settle announcement | alert `Could not load the figure…` |
| seal | `Sealing...`, status pending copy | dialog closes, status, focus link | dialog alert + status (409/503 copy), `No answer…` on network/15 s timeout |
| issue link | — | textbox + Copy link focused, `Regulator link issued. It expires …` | `Only an intact sealed figure can have a regulator link.` |
| revoke | — | `Link revoked.` | `This link has already expired.` |
| re-derive | `Re-deriving from the stored readings.` | `Re-derived at …: Intact.` | `Could not re-derive right now. Try again in a few minutes.` |
| download | — | browser saves `<id>-readings.csv` | storage/mismatch alert, ended page on 410 |
| grant change | — | `Saved access for <person> on <project>: <role>.` | alert `Access was not changed. Try again.` |

## Breakpoints

700 px and 1200 px (brief: Screens and layout).

## Media and licences

- Fonts: Instrument Serif 400, Instrument Sans 400/600, IBM Plex Mono 400/500 — Fontsource 5.3.0 Latin woff2, OFL-1.1 (`app/assets.json`).
- Icons: Lucide via `lucide-react` 1.67.0, ISC.
- Map, hatching, wordmark and empty-timeline drawing: drawn in SVG/CSS by the app (original).
