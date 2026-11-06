# TRUTH — Pellicle & Pane Edgeprint (golden)

Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys (ideal end-to-end flows)

1. **Log a roll while shooting** (brief: Journeys 1). Signed out on `/` → Open archive → `/signin` → sign in lands `/archive`. Log → New roll → `/rolls/new` → Create roll lands `/rolls/<id>` announcing `Roll saved.` → Log defaults to the newest roll, counter 1. Each Log exposure: pending `Logging…`, success `Note <counter> logged.`; counter becomes highest + 1 (empty after 99), settings kept, note cleared, Misfire unticked, focus on Shutter. A 401 keeps a draft (account-bound, sessionStorage), announces `Your session ended. Sign in to keep this exposure.`, goes to `/signin?next=%2Flog`; the same account gets every field back with `Your unsent exposure is back. Press Log exposure to send it.` and focus on Log exposure; another account starts clean. Edit roll raises EI; the roll's shooting log re-derives stops; archive shows `Logging` and `Unmatched notes <n>`. Provider-recorded: rows in PostgreSQL `rolls`, `entries`.
2. **Upload a developed strip** (Journeys 2). Choose file, DPI, first edge, Upload strip: the browser hashes the file (SHA-256), sends bytes with `X-Scan-Size`/`X-Scan-SHA256`; progressbar shows bytes sent (0–100, never decreasing); Activity: `Uploading <filename>…` then one outcome. 201 → `Stored <filename>: size and checksum confirmed.`, focus `Strip <position>`. Provider-recorded: MinIO `originals/<account>/<scan>` byte-identical and `previews/<account>/<scan>/<n>.png`; row in `scans` only after read-back confirms size and SHA-256.
3. **Refused files** (Journeys 3). palette PNG, multi-page TIFF, tiled TIFF refused within seconds with the published field copy under Strip scan, focus on the field, nothing stored.
4. **Align** (Journeys 4). Calibrate (clear light or step wedge) → Find frames → nudge edges by keyboard (Enter saves, refusal springs back) → Propose alignment → Override alignment dialog → Save alignment; stale tab answered with the stale copy; counters on roll page and archive equal the contact sheet.
5. **Pin readings** (Journeys 5). Loupe by pointer, keyboard (arrows 1 cell, Shift 8) or touch (tap opens, tap another moves, same cell pins); Enter/click pins; the server stores gross/net rounded to two decimals with the calibration id; a gold marker is drawn and the reading is listed under its frame.
6. **Curves** (Journeys 6). Curves page and workspace derive curve, contrast index, frames used, span and meter bias on every read.
7. **Saved frame link** (Journeys 7). Signed-out `/rolls/<r>/scans/<s>?frame=3` redirects (302) to `/signin?next=<percent-encoded>`, back after sign-in with `Frame 3` scrolled into view; title saved with `Title saved.`
8. **Storage outage** (Journeys 8). `GET /api/storage` unavailable → banner (`alert` + `Check again`); reads and note logging work; uploads, calibration, detection, readings, pins, originals, previews and edge nudges answer 503 `storage_unavailable` and leave nothing.

## Palette (brief: Visual design › Palette; hex decided where the brief gives words)

ground `#133621` (brief: Negative tint G = 19, 54, 33); surface `#1C4630` (decided: slightly lighter bottle green); ink/accent/focus `#F4D96C` (brief: I = 244, 217, 108); muted `#B8AE72` (decided: olive gold, lightness below ink); hover swap to muted at once (brief: Motion).

## Type, space, layout

Host Grotesk variable 300–800, latin subset, served from `/static/fonts` (brief: Type). Body 16px/1.5, small 14px, headings ×1.333 per level: 21.3 / 28.4 / 37.9px (brief: Type; decided: exact steps). Landing headline weight 400, `clamp(28px, 2.5vw, 40px)` (brief: Hero). Tabular figures on body (brief: Type). Margins 6vw, 12 columns, gutter 16px (phone, tablet) / 24px (desktop) (decided). Radius 0 (brief). Controls ≥ 44px including handle hit areas (brief). Breakpoints 600 and 1100 (brief: Screens and layout). Landing: large print columns 6–9 at 14vh, wedge columns 2–3 at 52vh, sentence columns 10–12; phone stacks large print, wedge at 60% right, headline, sentence (brief: Hero). Archive prints cycle `(start, span, drop)` = (1,4,0) (6,5,120) (3,3,200) (8,4,0) (2,5,120) (7,3,0) (4,4,200) (9,4,120) so neighbours always differ (brief: Composition; cycle decided); phone cycle 100% / 72% left / 60% right (brief). Workspace: desktop Strip across 12 columns, Curve 1–7 and Notes 8–12 with equal tops; tablet and phone stacked; phone Loupe reading panel between Strip region and Curve (brief).

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| Loupe canvas clip-path (WAAPI) | opens | 180 ms (brief 0.15–0.2 s) | cubic-bezier(0.2, 0.9, 0.25, 1) | no animation, instant |
| Loupe canvas clip-path (WAAPI) | closes | 100 ms (brief ≤ 0.15 s) | same | instant removal |
| Curve dot transform (WAAPI) | reading changes | 250 ms (brief 0.2–0.3 s) | same | jumps |
| Loupe position | pointer move | 0 (brief: no lag) | none | same |

Nothing else moves; no transitions, no loops.

## States per async action (brief: Feedback states, copy verbatim in `static/js`, `edgeprint/validation.py`)

Sign in / Create account `Signing in…` / `Creating account…`; Create or save roll `Saving roll…` → `Roll saved.`; Log exposure `Logging…`; edit/delete `Saving note…`; Upload `Uploading <filename>…`; Calibrate `Calibrating…`; Find frames `Finding frames…`; nudge/accept `Saving frame <n>…`; propose `Comparing notes with frames…`; save alignment `Saving alignment…`; pin `Pinning…`; title `Saving title…`. Field errors under fields with `aria-invalid`, first invalid field focused; error copy from the one table in `validation.py` shared with the browser through the generated `/static/js/domain.js`.

## Decisions where the brief is silent

- Data: frame densities and the scan's base plus fog are stored at detect/nudge/calibrate (recomputed together under the scan row lock); counters, matching, states, curves, bias, zones, log H are derived on read. Scan `base_fog` is returned unrounded (the verifier compares readings against it).
- Decoded scans are cached in memory only (LRU, 400 MB), and every read first confirms the original in storage.
- Own PNG/TIFF decoders on numpy (anti-diagonal Paeth/Average unfiltering, bounded inflate, LZW) so every refusal is an explicit rule check.
- `Log` shows its form even with no rolls (Log exposure disabled) so the page keeps its Note field.
- A note-save 401 also keeps the Log form's values so the page comes back as it was.
- The strip canvas is never shorter than 44px (brief: controls ≥ 44px); a very wide strip is stretched vertically to that height and pointer, loupe and overlays map x and y separately. Strip and handles use `touch-action: pan-y` so a vertical swipe from the strip scrolls the page (brief: Loupe by touch). Where a browser does not pan natively and keeps delivering the touch pointer's moves, the strip scrolls the page by the vertical swipe itself, so the swipe scrolls on every supported browser (decided: brief requires the scroll on current Chromium with touch).
- Accept buttons read `Accept` with the accessible name `Accept frame <n> width`.

## Media and licences

No media files: every picture is drawn on canvas or is the user's scan. Font: Host Grotesk (OFL-1.1) from Fontsource 5.3.0, listed in `app/assets.json` and `app/THIRD_PARTY_NOTICES.md`. Python packages: anyio, asyncpg, click, h11, idna, numpy 2.2.6, starlette, typing_extensions, uvicorn (MIT, Apache-2.0, BSD-3-Clause, PSF-2.0).
