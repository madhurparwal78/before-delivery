# TRUTH — Tare & Tally Tally Split (golden)

Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys (ideal end-to-end flow)

1. **Open a cycle** (brief: Journeys 1; Screens and layout; Interactions / Drafting)
   - Start: coordinator signed in at `/coordinator`; members on `/` see `There's no open cycle right now. The next case list appears here when the coordinator opens it.` when nothing is open.
   - `New cycle` → `/coordinator/cycles/new`: `Cycle name`, `Cutoff (club time)`, `Pickup starts (club time)`, `Pickup ends (club time)` (`YYYY-MM-DD HH:MM[:SS]`), one checkbox per catalogue case, `Save draft`.
   - Save (button or Enter in any text field) → `POST /api/cycles` → address replaced by `/coordinator/cycles/<id>`, `Saved draft <name>.` in `Coordinator updates`, `Open cycle` appears.
   - `Open cycle` sends the form's fields with `{"to":"open"}` and `If-Match`. Refused → `list "Problems with this cycle"` above the form, links `<label>: <error>` in form order, focus on the first link, `<n> problems stop this cycle from opening.`; each link focuses its field (Cases → first checkbox).
   - End: `<name> is now open.`, the same address shows the coordinator cycle view with `CUTOFF <display>` and `PICKUP <display>`; members see the case blocks. Revision 1 → 2.
2. **Pledge while others pledge** (brief: Journeys 2)
   - Signed-out member opens `/cycles/<id>`, signs in on that page and stays there.
   - `Top up` → `dialog "Top up credit"`; typed dollars sent as typed with one idempotency key per attempt (reused until the text is edited). Kill Bill `PURCHASE` with payment and transaction external key `topup-<code>-<key>`; one `top_up` movement (household +, `clearing:killbill` −); `Top-up of $X confirmed. Spendable credit is now $Y.`
   - Step units (`−`/`+`, Arrow keys, Home/End), `Pledge` (or Enter) → `PUT .../pledge` with a fresh key; pending `Saving...`; on 200 the fill sequence runs, `Pledged <units> of <case>. <to go> to go.` (or `Case sealed.`), credit panel from the response.
   - Other households' changes arrive with the 10-second refresh, newer line versions only, no animation, no announcement, nothing the member is doing disturbed.
3. **Change your mind** (brief: Journeys 3): lower units → same `Pledged` copy; `Withdraw from <case>` → `dialog "Withdraw pledge"` (`Withdraw your <units> from <case>?`, focus on `Keep pledge`) → `DELETE .../pledge` → `Withdrew from <case>. <to go> to go.`; a sealed case unseals and moves back to the open blocks; hold released.
4. **Cutoff** (brief: Journeys 4): the server's clock decides (`open` with cutoff passed is `sealing` on every read and write). Member page shows `Cutoff has passed. Pledges for <name> are closed.` within one refresh and disables case controls; a fresh pledge answers 409 `cutoff_passed` and `Cutoff has passed. <case> was not changed.`; a replayed key returns its stored response. Coordinator page drops `Cutoff (club time)`, keeps typed pickup values and shows `region "At cutoff"` with `SEALED` / `<n> TO GO` / `DROPPED` / `TAKEN UP` and `Drop <case>` / `Take up <case>`; the first resolution wins, others get `line_already_resolved`. `Place order` enables once nothing is filling.
5. **Receive and record shorts** (brief: Journeys 5): uploads `PUT .../documents/invoice|packing-slip` checked by declared type and leading bytes, ≤ 10,000,000 bytes, stored at `cycles/<id>/invoice.pdf` / `packing-slip.jpg|png` in `S3_BUCKET`; 201 only after MinIO acknowledges. `Mark received`, then `Record short: <case>` → `dialog "Record short shipment"` → short units assigned to the highest-numbered units; one notice per affected household (`Short shipment: <case>`, Message-ID `<short-<id>-<code>@tare-and-tally.example>`); the member block shows `Short shipment: <n> of your <units> units didn't arrive. You won't be charged for them.` by refresh.
6. **Pack bags** (brief: Journeys 6): `/breakdown` lists cycles in breakdown and `list "Bags"`; `<household> bag` opens `region "<household> bag"` with 44 px+ rows `checkbox "<units> of <case>"` saving at once, `Flag short: <case>` → `dialog "Flag short"`; accepted only from 12 h before pickup start to pickup end.
7. **Close** (brief: Journeys 7): `Close cycle` (one key per activation) → `closing` → Kill Bill external charges per household per case with positive net, description `<name>: <case> [<id>]`, skipping items already posted, `charge_mismatch` on a different amount → one transaction writes `pledge_charge` / `short_credit` / `take_up_charge` movements (same `created_at`), queues pickup receipts (`Pickup receipt: <name>`), sets `closed`; `<name> is closed. <n> receipts are queued for sending.` Kill Bill down → 503, stays `closing`, nothing written.

## Palette (decided hexes for brief: Visual design / Colour roles)

| Role | Hex | Contrast |
|---|---|---|
| kraft ground | `#DCC7A1` | ink on kraft 10.49 |
| kraft-light (text in green, field fill) | `#F3E9D6` | on green 8.43, on orange 4.56 |
| ink | `#1E1A15` | — |
| brown-grey secondary (kraft only; dropped cells and numeral) | `#5E4E3B` | 4.84 on kraft |
| burnt orange signal (actions, focus on kraft, own cells, banner rule) | `#B4460E` | 3.33 on kraft (non-text) |
| forest green sealed | `#1D4A2C` | kraft on green 6.15 |

Sealed/taken-up blocks: green ground, kraft-light text, kraft filled cells, own cells carry a solid ink centre square, focus ring kraft, hover kraft fill with ink text (brief: Inside a sealed-green block).

## Type (brief: Type; sizes decided)

Archivo variable at `font-stretch: 125%` weight 800–900 for headings and numerals; IBM Plex Sans 400/600 for body. Scale ×1.333: body/h3 1rem, h2 1.333rem, h1 1.777rem. Labels 0.75rem caps, letter-spacing .08em. Numeral two digits `clamp(3rem, 54cqi, 12rem)`, one digit `clamp(3.5rem, 100cqi, 20rem)` (container query on the numeral, which spans the block's content width) (decided: one digit fills about 70–75% of its block at every width, as "spanning most of its block's width" asks). Side by side, every numeral box is one-digit tall and bottom-aligned, so a row's numerals share one baseline (decided: the manifest reads as one ruled sheet). Both served from `/fonts/`.

## Space and layout per viewport (brief: Screens and layout; values decided)

- 12-column grid, 12 px gutters, a 1 px ink rule (22% ink) on every column line of the screen, running to the bottom of the viewport; panels and case blocks 1 px solid ink border on all four sides (sealed adds a 3 px inset ink outline for the 4 px frame), no radius, no shadow.
- Open case blocks side by side share their rows (CSS subgrid), so names, numerals, grids and controls line up across a row (decided: the manifest grid reads as one ruled sheet). Case names balance their lines and reserve two; unit grids side by side are 13rem tall with square cells capped by the block width, so a 6-, 12- and 25-unit grid end on one line (decided: no empty band between a small grid and its controls).
- Dialog scrim: kraft at 72% over the page (brief: no drop shadow; DESIGN.md elevation).
- Member home: each open cycle lists its cases as small blocks with the units-to-go numeral and a mini unit grid (decided: the brief's member home lists open cycles; the strip shows what is filling without a new screen).
- ≥ 1280: member open blocks span 9 columns (3 per row), `complementary "Sealed cases"` spans 3. Coordinator lines 8 | documents and receipts 4, stacked in one right-hand column; below 1280 the sections keep the brief's order (decided: receipts follow documents directly).
- Member cycle at every width, top to bottom: the cycle header, the notices region, the credit panel, then the case area (brief: Screens and layout / Member cycle, "Below it are the notices region, the credit panel, then the case blocks"). The header, notices and credit panel span all 12 columns (decided: they head the whole manifest sheet); the case area splits into open blocks and the sealed rail or tab bar as the per-width lines here state.
- 768–1279 (incl. 812×375): open blocks 2 per row in 8 columns, rail 4 columns.
- ≤ 767: `tablist "Cases"` (Open, Sealed) above one column of blocks; the unselected panel `hidden`. The switch is decided by `matchMedia("(min-width: 768px)")`; blocks never move on resize, so focus stays.
- ≤ 600: tables with `stack` become ruled stacked rows (`data-label` captions).
- Tap targets ≥ 44 px; dialogs `width: min(30rem, 100vw − 24px)`, `max-height: 100dvh − 24px`, body scrolls, actions stay visible.

## Motion (brief: Motion and effects)

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| Button/link hover and press | pointer | 140 ms colour; 80 ms 1 px sink | `cubic-bezier(.55,0,.15,1)` | none |
| Dialog in / out | open / close | 320 ms / 180 ms opacity + 6 px rise (WAAPI) | same | instant |
| Bag region | open bag | 320 ms opacity + 8 px rise | same | instant |
| Cells | own confirmed pledge change | starts 30 ms apart (≤ 800 ms spread), each 160 ms scale pop; reverse order for reductions | same | final state at once |
| Numeral | after cells | 330 ms, one integer per step (timer-driven) | linear | final value at once |
| Seal / unseal | units to go reaches / leaves 0 | 260 ms frame 1→4 px + colour, then 300 ms FLIP glide into rail (below 768: slide out 48 px) | same | instant move |
| Refresh changes | 10 s poll | none — same frame, no stagger | — | — |

Sequence total ≤ 1.9 s after the response (brief: within 2 seconds).

## States per async action (brief: Feedback states)

Pending copy: sign in `Signing in...`; save/open `Saving...`; save times `Saving...`; pledge/withdraw `Saving...`; top-up `Confirming...`; show older `Loading...`; resolve/transition `Working...`; close `Closing...`; upload `Uploading...`; record short / flag `Saving...`. In-flight buttons use `aria-disabled` so focus stays on them. All success/error copy is the brief's table verbatim; banners: cutoff, payments paused (`GET /api/payments/status`, server check ≤ 2 s old), mail queued, volunteer `No cycle is in breakdown yet.`

## Decided where the brief is silent

- Member `Line` carries `my_short_units` (decided: the in-block short-shipment notice needs the household's short units, and the short-unit selection rule must stay in one server module).
- Coordinator volunteer-flag names come from the bags endpoint (decided: flags only exist from breakdown on, when bags are readable).
- The coordinator time fields show `YYYY-MM-DD HH:MM[:SS]` computed in the browser from the `_at` instants with `Intl` in the club's zone from `GET /api/club` (decided: the brief's Cycle shape carries no local field text; every display string is still built by the server, and the device zone is never used).
- Carried-forward movement memo `Carried forward` (decided: brief names memos only for cycle movements and top-ups).
- Unknown non-app paths return the app page with HTTP 404 and the client shows `Page not found` (decided: correct status for an unknown address).
- Close lock: a close holds the cycle against other keys; one left behind by a dead process stops counting after 60 s (`close_in_progress`) (decided: longest plausible Kill Bill round with 5 s timeouts).

## Media and licences

| Asset | Licence | Source |
|---|---|---|
| Archivo variable woff2 (Latin, wdth+wght) | OFL-1.1 | Fontsource 5.3.0 |
| IBM Plex Sans 400/600 woff2 (Latin) | OFL-1.1 | Fontsource 5.3.0 |
| Kraft fibre texture (inline SVG noise) | original | drawn for this app |
| Empty-case drawing (inline SVG) | original | drawn for this app |


## The crate (brief: Visual design / The crate; Motion and effects)

- Every member case block holds `canvas role=img` named `Crate of <case>: <filled> of <pack> units pledged, <filling|sealed|taken up|dropped>` and `slider "Turn crate of <case>"` (−75…75, 15° keys, Home/End, 0.5° per pixel of drag, the 44 px `TURN` strip maps its width) (brief: Public screens and controls; Interactions).
- One WebGL context per document, made when the first crate is made; each crate copies its picture to its own 2D canvas. Without WebGL or while the context is lost the same box is painted with canvas 2D and the slider is absent / `aria-disabled="true"` (brief: One context; Without WebGL; Lost context).
- Unit tops: `mine` `#B4460E`, `taken` `#1E1A15`, dropped `#5E4E3B` (the stylesheet's cell colours, within 24 levels) (brief: Unit tops). Inside `#EBDDBC`, slot marks `#D8C698` (decided: light even kraft tone, 3:1 against all three tops).
- Timeline (decided inside the brief's bands): unit drop 170 ms from its cell's start; lid 300 ms; stamp 180 ms after the lid lands; seal step 480 ms with the frame (260 ms) and glide (300 ms) alongside; an unseal runs the step first (stamp lifts, lid opens), then the cells from the last backwards, then the numeral (brief: Fill the case, reverse order).
- Reduced motion: one draw per change. A newer line cancels a running sequence; an own response snaps it first (brief: Interrupted sequences).
- Client rules from the new brief: cycle-level fields apply only from a request sent after the one behind the values shown, a `cutoff_passed` refusal outranks any refresh in flight (DP-82); answers sent before sign-out are never delivered (DP-83); a dialog opened during another's exit finishes it at once (DP-14).
- Server rules from the new brief: close checks the close lock, then confirms the invoice object in MinIO (HEAD) before touching state or Kill Bill; a running close stops counting after 60 s; one upload per kind per cycle at a time, a running one stops counting after 60 s (`upload_in_progress`) (DP-84, DP-85).

| Asset | Licence | Source |
|---|---|---|
| three 0.187.0 | MIT | npm, bundled and served from the app's own origin |
| crate textures (corrugated kraft, tape, stamps) | original | drawn on a canvas at run time |
