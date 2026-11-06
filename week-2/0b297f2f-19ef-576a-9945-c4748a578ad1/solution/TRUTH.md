# TRUTH — Northlight Works Hangline (golden)

The brief made concrete. `brief: <section>` = copied verbatim; `decided: <why>` = the brief is silent.

## Journeys (ideal end-to-end flow)

1. **Curator places by keyboard** (brief: Journeys 1). Start: seed, Ines Calloway. Tab past `Skip to main content` into the rail → `Tide Chart Quilt` card → `Place` → `dialog "Place work"` (focus on Wall) → South wall → `Save placement` → `422 placement_rejected too_bright`; the error summary (`Fix these to continue:`) takes focus, reason under Wall and announced → summary link focuses Wall → North wall → save → `201`, dialog closes, focus on the new handle, `Tide Chart Quilt placed on North wall.`; work drops 10 cm onto 145 cm over 250 ms. Provider: `placements` row (proposed, v1, lux 50, lux-hours 34,300) + `events` `placement.placed`. Other sessions: Team updates `Ines Calloway placed Tide Chart Quilt on North wall.` within 5 s (the page asks for events again at once while events keep arriving, otherwise after a 1.5 s wall-clock pause; brief: Live data "at least every 2 seconds").
2. **Nudge, remove, undo** (brief: Journeys 2). Shift+Left = −10 cm, saved once 500 ms after the last key (`PATCH` with version); Enter → `Placement details`; Save → focus back on the handle. `Remove from wall` → `DELETE` → toast `<title> removed.` + `<s> s left` from `remainingMs`, focus on `Undo`; Ctrl/Cmd+Z → `POST /api/undo/{id}` → `Undone: <title> is back where it was.`, focus on the handle. After 10 s: `410 undo_expired`.
3. **Claim race** (brief: Journeys 3). One `POST .../claim` per press (pending set). Winner: `You claimed <title>.`, focus `Mark hung`. Loser: `409 already_claimed` → card `Claimed by <winner>`, `<winner> claimed <title> first.`, focus on card h3.
4. **Sign-off** (brief: Journeys 4). No photo → `409 condition_not_recorded` → `Add a condition photo before signing off <title>.`; photo upload shows `Uploading condition photo...` until `201` (row written only after MinIO confirms); then `Sign off` → `Signed off`. MinIO down → `503 image_store_unavailable`, banner, nothing stored.
5. **Register in inches** (brief: Journeys 5). Half-filled → `422` per-field messages, summary focused. 30 × 24 in → 762 × 610 mm → `76.2 cm × 61.0 cm` / `30.0 in × 24.0 in`. Lands on `/records/<id>` with focus on h1, `<title> saved.` Register URL holds `q`, `lender`, `sort`, `dir`.
6. **Light budget** (brief: Journeys 6). Lowering a budget re-flags the placement `over` (server recompute); Light view marker `data-overlay="red-hatch"`, ledger `Over budget`, count `1 over budget`. Repeated wall lux saves are sent in order; only the last result is shown/announced.
7. **Eye line** (brief: Journeys 7). `2`: grain dissolve + camera 1800→145 cm facing the wall (760 ms), then hang line fades in (200 ms). `3`: lux cross-fade 500 ms. URL `?view=light-eye&work=<id>` restores as a cut. Reduced motion: cuts.
8. **Lender preview** (brief: Journeys 8). Schedule `YYYY-MM-DD` → 09:00 Europe/London (or now + `PREVIEW_PUBLISH_DELAY_SECONDS`); countdown from `remainingMs`. Server publishes within 1 s of `publishAt`: per lender with placed works a snapshot JSON + PNG in MinIO, a 256-bit token, one email (sent at once, retried every 3 s). Withdraw → links `410`, notices to lenders already sent, queued emails cancelled.

## Palette (decided within brief: Visual design)

| Role | Hex |
|---|---|
| ground (plaster) | `#F3F0E8` |
| field | `#FBFAF6` |
| ink | `#1C1B18` |
| muted | `#59544B` |
| walls (stone) | `#B8B0A2` |
| floor | `#D8D1C3` |
| accent (hang line, focus, pressed marker, busy) | `#B5501C` |
| over budget (brick; reserved for over-budget works, so errors, banners and a zero count are drawn in ink) | `#8C2A1C` |
| lux ramp | `#EDE9DF` → `#E38F45` |

## Type, space, layout

- Instrument Serif 400 only for exhibition title, gallery name and `Loan register` h1 (brief: Visual design). Hanken Grotesk 400/500/600 elsewhere, tabular figures. Steps 16 / 20 / 25 / 31.25 px (×1.25, brief).
- Lengths `145.0 cm`, whole lux `50 lux`, lux-hours `34,300` (brief: Visual design).
- Desk ≥1024: rail 280 | scene column | inspector 320, 1px ink rules. Tablet 600–1023: scene | inspector 320, rail drawer from header `Objects`. Phone <600: View group, scene, count, ledger (Work, Offset, Lux status, Status), inspector; bottom bar `Objects` / `Lender preview` sheets (brief: Screens and layout).
- Phone header: line 1 `Hangline` + Sections, line 2 Working as + Units (brief: Screens and layout, two lines). Tablet ledger keeps all eight columns and scrolls inside itself beside a pinned, ink-ruled Work column (decided: eight columns don't fit a ~400 px pane; the page itself never scrolls sideways).
- Spacing 4px base; tap targets ≥44px; focus ring 3px accent, 2px offset, shown on keyboard focus and on a focused error summary; a heading focused after a pointer action shows none (decided: brief: Visual design keeps the accent to the hang line, focus rings, pressed marker and busy mark).
- Phone scene runs edge to edge past the page padding (brief: Screens and layout, "scene at full width").
- Tablet ledger: headings may wrap, a thin ink scrollbar and a muted line under the table say it scrolls sideways (decided: eight columns don't fit the ~400 px pane and the overflow must read as intended).
- Register cards (tablet, phone) lead with the linked title, then the other eight values in column order; at phone each value is a label-left, value-right row (decided: brief: Screens and layout fixes the nine labelled values, not their order).

## Motion (element, trigger, duration, easing, reduced-motion substitute)

| Element | Trigger | Duration | Easing | Reduced |
|---|---|---|---|---|
| selection outline | select | 200 ms | linear opacity | instant |
| new work settle (`data-settling`) | new placement | 250 ms | expo-out | instant, never `true` |
| eye-line drop + grain dissolve | Plan→Wall | 760 ms | expo-out | cut |
| hang line | after drop / before rise | 200 ms | linear | cut |
| lux cross-fade | to/from Light | 500 ms | ease-in-out | cut |
| drawer / sheet / legend | open | 240 ms | cubic-bezier(.16,1,.3,1) | ≤1 ms |
| toast | appear | 200 ms | same | ≤1 ms |

## States per async action

Pending: button shows an accent ring mark, ignores presses (except `Save lux`, whose saves queue, brief: Wall lux). Success: sentence in `status "Announcements"`. Field error: under the field + error summary. Outage: banner `alert` (database banner holds focus on `Try again`, rest inert).

## Media

Fonts from Fontsource (OFL-1.1, bundled). `public/favicon.svg` original. Scene, hatch and snapshot PNG drawn by code.

## Decided where the brief is silent

- Rail order = register default (object number ascending).
- Desk rail and inspector are sticky, as tall as the window, and each scrolls inside itself; the scene column carries both 1px ink rules, so the scene stays in view while staff work down the rail (decided: brief: Visual design, panels separated only by thin rules; Density, generous space around the canvas).
- Desk Scene ledger at 15px: Wall, lengths, lux, lux-hours and lux status never break, a two-word heading may take two lines, a long title or holder's name wraps inside its cell, and each work handle is underlined like a link with a tinted row on hover (decided: eight columns must fit the desk scene column without a sideways scroll).
- The inspector shows the selected work's `Within limit` or `Over budget` (brick, hatch swatch) as the ledger does (decided: brief: Visual design, over budget always with the hatch and the words).
- Selected ledger row: 11% ink tint and a 2px ink rule on its left edge; a hovered row takes the 6% tint (decided: selection and hover must not look alike). Tablet scene box 40vh, 300–420 px (decided: the plan's long room fills a squarer box). Draft preview status: a dashed ring (decided: draft is not yet scheduled).
- Card status glyphs: Not placed dashed ring, Proposed hollow ring, Claimed ringed dot, Hung filled, Signed off filled with a tick (decided: the mark alone tells the states apart; the words stay verbatim).
- Plan view names each wall beside it, and the eye-line view shows `Facing <wall name>` beside the published readout (decided: brief: Problem and users, sightlines are checked by people new to the model; the readout copy itself is unchanged).
- Light view draws an over-budget work with a 3 cm brick band and brick hatching on the field colour (decided: brief: Visual design, deep brick red with a diagonal hatch, distinct from the accent).
- First seeded staff preselected when none was chosen on the device.
- Eye-line camera stands back in front of the selected work at a 55° vertical field of view, far enough to see the floor, the wall's top and a strip of ceiling; it may run up to 0.9 m past a wall's end so a corner shows; a 6 m wall shows both corners (decided: a visitor's view of a room; a whole 12 m wall at tablet width made works unreadably small).
- Walls shade softly from the hang line (full light) to 84% at floor and ceiling; the selection outline is a 2px-equivalent ink band about 4px outside the frame (decided: brief: Motion and effects, lit walls; DP-89 gallery scene craft).
- The events route answers at once. Each page asks again at once while events keep arriving, otherwise after a 1.5 s pause timed by the wall clock (an abort-signal timeout), so updates keep arriving while the page's own timers are held (decided: brief: Live data asks for new events at least every 2 seconds and shows each change within 5 s).
- Team updates keeps the last three refreshes' sentences, one element each, so a change arriving just after another doesn't wipe it (decided: brief: Live data asks every change to show in every session; the brief fixes only how one refresh's sentences are joined).
- The timed preview refresh (every 4 s, and on tab return) re-syncs the countdown and recipients of the preview already shown; a change of preview status or id is applied when its event arrives, so `Live` and `Preview published. Lenders notified: <n>.` appear together (decided: brief: Feedback states announces the publish sentence as the status goes Live in place).
- Withdrawal notices and preview emails are attempted immediately after the change commits, then retried every 3 s.
- Every state-changing request the staff pages send carries a fresh Idempotency-Key, and every state-changing route honours it by the brief's replay rule; a request delivered twice changes things once, and both deliveries get the first answer with its `seq` (decided: brief: API, Idempotency defines keys scoped to staff and route; brief: Live data never announces a tab's own change, which needs the tab to learn its `seq` even when the network resends its request).
