# TRUTH — Tinework golden

Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>`.

## Ideal journeys

1. **Reconfigure by keyboard** (brief: Journeys 1). Start: `/parts/twin-hole-plate` signed out; the page loads r1, writes `?config=` and sends evaluation seq 1 at once; `Evaluation` announces `Updated: 18 885.84 mm³`; viewport `data-eval-state=settled`, `data-epoch=1`. Tab order: Like, Save revision, Download ZIP, Download TAR, the `View` toolbar (one stop), Findings listbox, Build tape, Dimensions group controls. ArrowUp on `Width` steps 0.1 (Shift 10 steps, Ctrl or Meta a tenth, Page 10 steps), each press commits; one evaluation per burst after 400 ms; the address is replaced with sorted non-default pairs; `was 60.0 mm`, amber frame and `1 modified` appear and clear on `Reset all` (one evaluation, `config=`). The camera never moves.
2. **Share and save** (brief: Journeys 2). A doctored address drops unknown or ungrammatical values, rewrites the address and lists `Dropped from the link: …` in Findings. Signed out, `Save revision` opens `Sign up to save`; the mail link returns to the same configuration with `Save revision` open, `save=1` removed. A signed-in non-owner's Save posts a copy and lands on `/parts/<slug>-<6 hex>?config=…` announcing `Saved r1.`.
3. **Check before spending stock** (brief: Journeys 3). Arrow keys pick `Three-axis mill`; `Run pre-flight` claims the allowance (signed out: `Run pre-flight (1 of 1 left this session)`); findings Blocking then Advisory; selecting one glides the camera (480 ms), greys uninvolved faces and draws a leader; a dimension change turns the report `stale` (muted text, hollow icons, banner) without re-running; returning the value makes it `complete`.
4. **Compare and restore** (brief: Journeys 4). The compare address carries base, head, view and hunk; menus push history, view and hunk replace; J/K walk hunks; only the newest pair is painted; a live revision adds an option to both menus and announces `New revision r4 by …`. Restore creates a new head and the Restore button leaves the document (focus to main).
5. **Two pages, one head** (brief: Journeys 5). The losing save shows the `alert` with `Changes in rN`, `Open rN`, `Keep my values on rN`; the draft lives under `tinework:draft:<slug>:<known head id>`.
6. **Review to approval** (brief: Journeys 6). Comments appear only after a 201 or their live event; a lost answer is retried with the same Idempotency-Key; approvals, resets, carried and matched lines arrive live.
7. **Replay and fork** (brief: Journeys 7). The tape slider moves by keys and captured drags; every snapshot is the stored solid; fork from operation k lands on `?revision=<new>&operation=k`.
8. **Gallery on a phone** (brief: Journeys 8). Below 1024 px the viewport is the full window width, one rail group open at a time, closed groups inert.

## Palette (decided: values from brief: Visual design colour roles)

ground #080c15, surface #111b2e, surface line #1c2a44, ink #dce8f7, muted #93a7c2, accent #22d3ee, on-accent #04262d, band ground #0a1431 (accent = ink on band routes), Blocking #ff7f5c, Advisory #f5b83d, Pass #6fd49a, ghost #6b7f9c.

## Type, space, layout

Stack Sans Headline 500 for headings, Stack Sans Text 400/500/600 for everything else, tabular figures (brief: Type). 8 px rhythm, 4 px radius, 44 px targets (brief: Density and shape). Breakpoints 640, 768, 1024 (brief: Screens and layout): gallery 1/2/3 columns, categories row below 768, part rail beside the viewport from 1024, viewport edge to edge below 1024, tape strip scrolls below 768 with 24 px ticks.

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| hover, press, selection | pointer, key | 150 ms (brief 120 to 180) | cubic-bezier(.2,.7,.2,1) | 0 |
| rail group, dialog | toggle, open | 200 ms (brief 160 to 240) | cubic-bezier(.2,.7,.2,1) | 0 |
| solid cross-fade | evaluation settles | 150 ms | linear | immediate |
| camera glide | finding, hunk, thread | 480 ms (brief 400 to 560) | ease-out cubic | one frame |
| playhead settle | pointer release | 240 ms (brief 200 to 280) | cubic-bezier(.2,.7,.2,1) | 0 |
| evaluating frame | evaluation in flight | 1.2 s dash loop, stops with the evaluation | linear | static frame |

## States per async action

Evaluation: dirty, evaluating, settling, settled, failed, stale (brief: Evaluation lifecycle). Save: `Saving...` disabled button with a thin cyan line; 412 conflict alert; 503 save outage alert inside the open dialog. Pre-flight: unrun, running, complete, unsupported, stale; 429 shows the sign-in line. Comment: pending (no option yet), 201 option, lost `Not sent yet. Try again.`, refused line under Comment. Storage outage: `Storage` status, `aria-disabled` controls, outage alerts and panel (brief: H4).

## Media and licences

No image, audio or video files. Stack Sans Text and Stack Sans Headline (SIL OFL 1.1) bundled as woff2; icons drawn inline (original). three, react, react-dom, pg, ioredis are MIT.
