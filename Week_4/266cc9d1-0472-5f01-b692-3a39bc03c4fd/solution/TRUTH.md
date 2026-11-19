# TRUTH — Larchline Geospatial Spanwise (golden)

The brief made concrete. Every value says where it came from: `brief: <section>` (verbatim) or
`decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Journeys (ideal end-to-end flows)

### 1. Upload a corridor (brief: Journeys 1; DP-10, DP-11, DP-13)
- Start: survey processor (`kestrel-processor-4417`) signed in, Ash Creek (or Cutbank) workspace open.
- Assets tab → `Upload assets` → `dialog "Upload survey assets"`; choose `radio "Tileset"`, pick files with the
  `Files` chooser (or drop a folder: paths stay relative to it — brief: Interactions/Upload).
- `Upload`: the page hashes every file (SHA-256, in the browser), `POST /api/corridors/{id}/assets` declares the
  manifest; on 201 the dialog closes and the new row reads `Tileset · 3 files · Pending` (brief: Public screens).
- Each file `PUT /api/assets/{id}/files/{path}`; `status "Upload status"` reads `Uploading <k> of <m> files for Tileset`,
  then `Verifying <m> files with storage`, then `Tileset stored: 3 files verified.` (brief: Feedback states).
- Server, per file: size check; write with the declared SHA-256 as the S3 checksum (storage refuses other bytes);
  HEAD with checksum mode; stored only when size and SHA-256 match; asset row locked so the last file stores the
  asset exactly once with one `stored_at` (brief: Business rules/Storage confirmation).
- End: row `Tileset · 3 files · Stored`; `Files` expands one `link "Download <path>"` per file; objects under
  `tenants/kestrel/corridors/<id>/assets/<asset id>/` (brief: Services).
- Mismatch: `Tileset rejected: <path> did not match its checksum.`, row `Rejected`, every object under the prefix deleted.

### 2. Scrub a corridor and check coverage (brief: Journeys 2; DP-05–DP-09, DP-49)
- Start: analyst opens Ash Creek from the list (row shows `Overdue`, `Draft`).
- Each scrub input (pointer move, key, Previous/Next span) at once updates `Chainage 1,240.0 m`, `Span 4–5`, the slider
  value text `Chainage 1,240 metres, span 4 to 5, no findings nearby`, rings and rail outlines (25 m reach, inclusive).
- The drone line reads `Drone locating...` (no Flight time line, marker hidden) until the answer to the latest input
  arrives; earlier answers are discarded (decided: one sequence number in `client/src/view.ts`).
- Answer applied: `Drone 44.500000° N, 93.192028° W, 320.0 m`, `Flight time 2026-06-14 14:04:00 UTC`; camera eases
  340 ms to 150 m behind / 80 m above the marker, looking at it (pitch −28.1°).
- 1268–1904 m is hatched and labelled `No flight coverage`; there the drone line reads `Drone No flight coverage` and
  the camera sits 150 m behind / 60 m above the centreline ground at the playhead.
- End: on release `?ch=…&t=…&cam=…` replaces the history entry; `t` is added when its answer arrives.

### 3. Triage and submit by keyboard (brief: Journeys 3; DP-14–DP-22)
- J/K select (rail order: chainage, then label); selection pushes a history entry and announces
  `Selected F-1, Span 2–3, chainage 470.0 m.` in `status "View status"`.
- E opens `dialog "Edit finding F-1"`; Save → `Saving F-1...` → `Saved F-1. Clearance 1.51 m, Violation.`
- N opens `dialog "New finding"` at the playhead with offset 0, radius 3.00, ground from the finest loaded terrain
  tile and its level (else empty, `hand-entered`).
- Terrain tiles finer than a finding's level that contain it are sampled and sent once per level
  (`POST /api/findings/{id}/terrain`); `status "Terrain updates"` announces
  `Ground height for F-2 re-resolved to 250.48 m at terrain level 15. Clearance now 15.00 m, Clear.`
- Submit for review → `dialog "Submit findings set"` (`4 findings, 2 violations will be frozen and sent to
  dana.okafor@northmere.example.`); Confirm submit twice → one request key per dialog opening, one submit, one email,
  `Submitted revision 1. Review link emailed to dana.okafor@northmere.example.`
- Provider end state: set `submitted`, frozen counts, `evidence.json` under
  `tenants/kestrel/corridors/nm-ash-creek/findings-sets/<set id>/`, one Mailpit message
  `Spanwise review: Ash Creek 345 kV revision 1` to the forester with the link alone on a line.

### 4. Review on a phone (brief: Journeys 4; DP-25–DP-28, DP-48, DP-51)
- `/review/<token>` at 375x812: header `Ash Creek 345 kV, revision 1`, contractor, utility, `Link expires … (America/Chicago)`.
- The rail is a collapsed bottom sheet: summary line + `Show findings`; everything else hidden and inert.
- `Accept F-1` → PUT decision → pressed only after 200, `F-1 marked accepted.`; `Dispute F-3` shows and focuses the note
  box; leaving it with text sends the dispute (`F-3 marked disputed.`); a failed save keeps the stored state and says
  `Could not save the decision for F-3. Try again.`
- `Accept F-2`, `Accept F-4` the same way: every one of the 4 findings is decided before sending (brief: Business
  rules/Decisions "Complete requires a decision for every finding"; Journeys 4 "accepts most findings and disputes one").
- `Send decisions` → `Decisions sent: 3 accepted, 1 disputed.`; the rail shows `Decisions for this revision are final.`;
  the analyst receives `Spanwise decision: <corridor> revision 1 disputed` with one line per finding.

### 5. Revise after a dispute and prove the evidence (brief: Journeys 5; DP-31–DP-34)
- Disputed set → `Start revision` → old set `closed`, new draft revision 2 (`previous_set_id`), findings copied with
  their labels; `Revision 2 started as a draft.`
- Processor: Assets tab → `Files` → `Download ash-creek-2026-06-14.czml` / `Download tileset.json`: bytes identical,
  `ETag` = stored SHA-256, never compressed.

### 6. Find the span at the roadside (brief: Journeys 6; DP-38–DP-40)
- Tablet review link after acceptance: decisions-final rail, each item `Accepted` and its span line; for F-1
  `Span 2–3 · nearest tower T2 · chainage 470.0 m` (brief: seed F-1 at 470.0 m; T2 at 312 m is 158 m away, T3 at
  640 m is 170 m away, so T2 is nearest; an exact tie would go to the lower tower — brief: Interactions/Nearest tower),
  `Fly to F-1` (1100 ms ease-out).
- Touch: one-finger pan, pinch zoom, two-finger twist (heading), two-finger vertical drag (pitch); readout follows.
- Reduced motion: every camera pose lands in the next frame; the playhead jumps; the sheet appears at once.

### 7. Keep working through outages (brief: Journeys 7; DP-35–DP-37, DP-52, DP-53)
- Storage unreachable (even at boot): `alert` `Tile storage is unreachable. Findings stay editable, and tiles will reload
  when storage is back.` inserted once; `No tiles can be shown right now. Use the span ribbon and the findings rail to
  keep working.` in place of the canvas; flight answers and coverage still work (PostgreSQL); editing continues.
- Status checks (load + every 10 s) never close dialogs, clear fields, move focus, collapse the sheet, switch tabs or
  collapse `Files` rows; on recovery assets are re-read in place and the globe returns.
- Mail down at submit: `email: "queued"`, `Submitted revision 1. The email to … is queued and will send when mail is
  back.`; the link line ends ` · Email queued` and flips to ` · Email sent` in place once any process delivers it.

## Palette (decided values; DESIGN.md)

| Role | Hex | Source |
|---|---|---|
| paper | `#F3EEE2` | brief: Visual design (warm off-white paper); decided: hue 42°, L 0.92 |
| paper-raised | `#FAF7F0` | decided: rail as a lighter sheet |
| paper-sunk | `#E9E2D0` | decided: tracks, banner, selected row |
| ink | `#17212F` | brief: Visual design (dark blue-black ink) |
| muted | `#55606E` | brief: Visual design (muted blue-grey secondary text) |
| rule | `#9AA5B1` | brief: Visual design (hairline rules, tower ticks) |
| control edge | `#6E7A88` | decided: WCAG 1.4.11 3:1 control boundaries |
| forest | `#2E5B3E` | brief: Visual design (Clear findings, stored states) |
| violation | `#9E4815` | brief: Visual design (the one burnt-orange accent, violations only) |

## Type, space and layout

- Fraunces 500/600 headings (h1 29.3 px, h2 23.4, h3 18.75 — each level ×1.25), IBM Plex Sans 15 px body, IBM Plex
  Mono tabular figures (brief: Visual design; decided: 15 px compact body).
- Breakpoints: phone < 768, tablet 768–1023, desktop ≥ 1024 (brief: Screens and layout).
- Desktop: rail 360 px right (brief 320–400), readout over the globe's top-left; tablet: rail 300 px (brief 280–340),
  readout atop the rail above the tabs; phone: header, full-width globe, collapsed sheet row (56 px), ribbon; the
  expanded sheet overlays the globe up to 60 % of the viewport height.
- Ribbon: full width, 100 px (phone 108 px; brief 72–120); strip inset 18 px each side, linear chainage mapping.
- Touch layouts: every control ≥ 44 × 44 px (brief: Visual design).

## Motion

| Element | Trigger | Duration | Easing | Reduced-motion substitute | Source |
|---|---|---|---|---|---|
| playhead | track press, key/button step, selection | 200 ms | cubic-bezier(0.22,0.61,0.36,1) | jumps | brief: Motion (0.15–0.25 s) |
| playhead | drag | none (follows pointer) | — | same | brief: Motion |
| camera chase | each applied flight answer | 340 ms | ease-out cubic, restarts from current pose | next frame | brief: Motion (0.28–0.4 s) |
| camera fly | Fly to; selection > 600 m away | 1100 ms | ease-out quartic; height rises on an arc (40 m + a quarter of the distance, at most 400 m) and settles back on the target | next frame | brief: Motion (0.8–1.5 s); decided: 600 m "far", and an arc so a flight between two places reads as a flight |
| dialogs | open / close | 200 ms | fade + 6 px rise / fall | instant | brief: Motion (0.15–0.25 s) |
| phone sheet | expand / collapse | 200 ms | slides from behind the ribbon | instant | brief: Motion |
| rings | enter / leave 25 m reach | 160 ms | linear alpha | instant | brief: Motion (< 0.2 s, never pulse) |
| gesture inertia | release | ≤ 0.5 s (Cesium decay 0.6) | decay | none | brief: Motion |
| scene | — | renders on demand only (`requestRenderMode`) | — | — | brief: Motion (no unnamed loops) |

## States per async action (brief: Feedback states)

Sign-in (`Sign-in status`), finding save/delete (`Save status`), terrain refinement (`Terrain updates`), submit and set
actions (`Submit status`), link actions (`Link status`), upload (`Upload status`), review (`Review status`), selection
and copy link (`View status`) — each a named polite region with the brief's exact copy, visible in the notice stack at
the globe's bottom-left. Pending buttons carry `aria-disabled="true"` and the brief's pending copy.
Decided: `Start findings set` announces `Revision 1 started as a draft.` (the brief's revision copy); a submit whose
request never reaches the server keeps the dialog open with `The request did not reach Spanwise. Press Confirm submit to
try again.` and retries with the same Idempotency-Key.

## Decisions where the brief is silent (backend)

- Invalid `Idempotency-Key` header → `422 validation_failed` (field `Idempotency-Key`), checked at validation time.
- Malformed JSON body → `422 validation_failed` (field `body`, `Send a JSON object.`) at validation time, so the
  precedence order still holds.
- `POST /api/session`: 413/415 → 403 cross_origin → 422 → 401 invalid_access_code.
- Projected flight-sample chainages are stored to the millimetre (coverage ends match tower chainages).
- Probes every 5 s (brief: at least every 10 s); outbox worker every 5 s (brief: at least every 30 s); email lease 30 s.
- A finding's ECEF position is the tree base (ground height).
- The flown track on the globe is drawn along the covered centreline ranges at the drone's answered height.

## Media and licences

- Fonts: Fraunces, IBM Plex Sans, IBM Plex Mono — Fontsource woff2, SIL OFL 1.1, vendored (`app/assets.json`).
- Icons: Lucide via `lucide-react` (ISC).
- Drawings (empty states, corridor plan, glyphs on the globe): original, drawn in code.
- Terrain pyramids, canopy tileset (Draco glb + KTX2 texture) and the Ash Creek CZML: generated by
  `app/server/fixtures/*` (IF-06), stored in the bucket at seed time.
