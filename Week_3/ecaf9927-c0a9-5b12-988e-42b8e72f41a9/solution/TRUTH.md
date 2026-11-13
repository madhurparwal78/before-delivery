# TRUTH — Kerfline Bench golden

Every value says where it came from: `brief: <section>` (copied from `instruction.md`) or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Seed (brief: Seed data)

- Workspace "Ostra Lighting", product assembly "Ostra Desk Lamp". Members Ines Varga (founder, ines@ostra-lighting.example, mm, 2 decimals) and Teo Lindqvist (engineer, teo@lindqvist-eng.example, in, 3 decimals). Passwords as in the brief; stored only as scrypt hashes.
- Materials 6061-T6 aluminium 2.70, Acetal (POM-C) 1.41, PETG 1.27 g/cm³. Purchased: "M4 × 12 socket head cap screw" 2.10 g, "M3 brass heat-set insert" 0.40 g.
- Parts Base Plate (rect 120 × 80 + hole sketch; Extrude 1 new 8 normal, Extrude 2 cut 20 symmetric), Arm Link (160 × 16, 6), Pivot Bracket (30 × 20, 12), Shade (two circles Ø60/Ø56, 40), Switch Cover (24 × 16 rectangle with constraints 1 to 9, Slack 2, no extrude).
- Assemblies Ostra Desk Lamp / Arm Assembly / Head Assembly with the instances in the brief. Lamp total 346.2857 g, 16 pieces, 6 lines (brief: ≈ 346.2869 g; the app's faceted bodies agree within 0.1 %).
- First boot against an empty database seeds exactly once (advisory lock), then writes build 1 of every seeded part with extrudes to `bodies/<part id>/build-1.json` before health answers 200; skipped while storage is unreachable.

## Ideal end-to-end flows

1. **First sign-in** (brief: Journeys 1). Start: fresh deploy. Ines signs in (`POST /api/session`, cookie `kerfline_session`). The lamp opens in the Model tab: Assembly view image, Assembly tree (Base Plate, Pivot Bracket, M4 screws ×2, collapsed Arm Assembly), totals from `GET /api/assemblies/:id/tree`. Feature tree lists 3 assemblies, 5 parts, 2 purchased parts.
2. **Hold and extrude the switch cover** (Journeys 2). Open Switch Cover → Sketch 1: Slack 2, blue rings on three corners. Line 1 + Dimension "24" → rings shrink (≈230 ms), readout counts to Slack 1 (≈333 ms). Line 2 + "0.63 in" → Fully held, strokes turn ink. Extrude: depth, Confirm → Save status Saving… → Stored; Measurements Confirmed; object written to MinIO at `bodies/<id>/build-N.json`.
3. **Refuse a conflicting constraint** (Journeys 3). With Distance 1 = 24, Line 1 + "30" is refused (409 `over_constrained`): sketch unchanged, ghost "Distance 2" and "Distance 1" glyphs flash brick red twice, Model message "Distance 2 would conflict with Distance 1. Nothing was changed.". Delete Distance 1 → Slack 2; "30" accepted → Slack 1.
4. **Cut a hole** (Journeys 4). New sketch (Top, 0) → circle → two positional distances + diameter → Fully held → Extrude Cut → material switch → Measurements show the reduced volume and new mass. An Intersect that leaves nothing answers "Intersect leaves no material. Nothing was changed.".
5. **Build a subassembly** (Journeys 5). New assembly, Add to assembly (Pivot Bracket ×1, M3 insert ×2), add it to the lamp; Add pressed twice sends one Idempotency-Key and creates one instance; adding the lamp to the hinge answers "<hinge> cannot contain itself.".
6. **Redesign and quote in inches** (Journeys 6). Depth then material on the Pivot Bracket: every assembly row (including collapsed Arm Assembly) shows the server's new figures. Units in / 3 decimals redisplay in place; stored millimetre values never change.
7. **Storage down** (Journeys 7). Edit saves answer `not_stored`; banner "Storage is unreachable. Changes are kept, but parts are marked Not stored until a save reaches storage."; confirmed figures and rollups unchanged; next save after recovery is Stored with no restart.
8. **Two people on one sketch** (Journeys 8). A stale change answers 412 naming the saver and revision; the Save conflict alert shows the message and Reload; Reload refetches and shows the other person's change.

## Palette (brief: Visual design / Colour roles; hexes decided to fit the words)

ground #F4EFE2, panel #FAF7EE, ink #1D2430, muted #5A5F69 (decided: AA on ground), cobalt #0047AB (slack only), brick #A93226 (conflicts only), rule #BEB6A6, rule-strong #A59C89, body greys #DCD5C6 / #B9B1A0. See DESIGN.md.

## Type (brief: Visual design / Type)

Space Grotesk 500/700 (wordmark, titles, "Fully held"), IBM Plex Sans 400/500/600 (body), IBM Plex Mono 400/500 with tabular figures (every number). Scale ×1.2: 13, 15.6, 18.72, 22.46, 26.95 px. Fonts self-hosted woff2, SIL OFL-1.1.

## Space and layout per viewport (brief: Screens and layout)

| Viewport | Feature tree | Properties | Command strip | BOM tab |
|---|---|---|---|---|
| 1280×800 | floating, 264 px, 16 px from the left edge | floating, 332 px, 16 px from the right edge | one row, centred between the panels | full-width six-column table; tree and Properties hidden |
| 768×1024 | floating, 220 px | floating, 298 px | one row spanning the bottom, below both panels | same table |
| 375×812 | bottom sheet from the Feature tree button | bottom sheet from the Properties button | spans the bottom, two rows | stacked rows, column name before each value |

Breakpoints: sheets below 768 (767 and under), stacked BOM below 600. Sheets are at most 70 % of the viewport height and sit on the bottom edge; one sheet at a time.

## Motion (brief: Motion and effects)

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| Slack ring | constraint accepted | 230 ms | cubic-bezier(.2,.9,.2,1) | jumps |
| Slack readout | after the rings | 333 ms, each whole number once, evenly spaced | steps | jumps with the rings |
| Sketch strokes | slack reaches 0 | 167 ms | ease-out | at once |
| Conflict flash | 409 over_constrained | 167 ms × 2 turns on ghost and named glyph | ease-in-out | steady brick outline until the next sketch action |
| Depth handle | release or key step | 380 ms, overshoot ≤ 5 px | cubic-bezier(.2,.9,.2,1) | stops at target |
| Sheet | open / close | 250 / 200 ms | cubic-bezier(.2,.9,.2,1) / ease-in | no slide |
| Dialog | open | 160 ms fade + scale from .97 | cubic-bezier(.2,.9,.2,1) | no scale |
| Button | hover / press | 90 ms | ease-out | none |

No looping or decorative animation. Part and Assembly views are still images redrawn only when a stored body changes.

## States per async action (brief: Feedback states)

Sign in: "Signing in…" disabled; server message in an alert inside the form; field errors under fields. Part change: Save status Saving… → Stored / Not stored, chip likewise, Measurements Confirmed; refusals in Model message. Constraint accepted: "<label> added. Slack <n>." / "<label> added. Fully held." / "<label> added and marked redundant."; refused: server message + flash. Extrude: "Extruding…" disabled, "<feature> added.". Add: "Adding…" disabled, "<name> ×<n> added to <assembly>.", errors under Component. Stale (412): alert "Save conflict" with Reload. No answer: "No answer from the server. Your change was not confirmed.". Outage: alert "Storage outage". No body: "No stored body yet". Body unreadable: "Body view unavailable while storage is unreachable.".

## Geometry and figures (brief: Business rules)

Lengths stored once in mm (double). 1 in = 25.4 mm. Planes: Top (u,v,offset) +Z, Front (u,offset,v) +Y, Right (offset,u,v) +X. Slack = entity freedom − numeric Jacobian rank at the solved geometry; point freedom = rank of the point's rows beyond the constraint row space. Bodies are built with the Manifold kernel from the sketch profile (circles faceted at 256 sides per turn), one connected closed manifold, vertices snapped to 1 nm; volume, area, centroid and mass come from the stored triangles.

## Media (brief: none asked)

No photographs, video or fetched images. Icons are drawn inline as SVG (original). Fonts only, listed in `app/assets.json`.
