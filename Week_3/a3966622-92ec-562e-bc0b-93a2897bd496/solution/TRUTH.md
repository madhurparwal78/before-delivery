# TRUTH — Ebbstone Marine Slackwater (golden)

Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys, end to end

1. **Agent places an order** (brief: Journeys 1, DP-01, DP-03, DP-65). Start: `agent@corvane.example` on `/orders`, no vessel chosen, `Order clearances` reads `Choose a vessel to see clearances`. Choosing `Tern Arrow` prefills speed 10, block coefficient 0.80, length 229, GT 43,500 and draught 11.200 m (brief: Seed data). Each edit sends `POST /api/plan` after a 300 ms pause (decided: under the brief's half second); a reply paints only if its inputs (vessel, stored mm, speed, Cb, length, GT, date, time) are still the form's; after 500 ms at rest the region announces `Window open, pinch Inner Sill +0.05 m, estimate $2,912.50 CAD` (brief: Feedback states, worked example 06:50). Switching `Draught units` redraws 36 ft / 9 in from 11,200 mm and sends nothing. `Place order` (keyed) → `Order MV-1011 placed`; the move is `Ordered` in the agent list and in the dispatcher's `Order queue`. Store: move row, history `Ordered`.
2. **Dispatcher plans by keyboard** (Journeys 2, DP-08–DP-12). `/board` loads the first queued order (`MV-1001` at start) or `?move=`. `n` cycles queued orders, `k` focuses `slider "Boarding time"`; arrows/Page/Home/End move among existing steps; each step's plan is requested and paints only if it is still the handle's step. After 500 ms at rest, `Section announcements` reads the pinch/gate change. `Commit window` → `Window committed at 06:50 port time, pinch Inner Sill +0.05 m`; the hull travels 0→100 in 900 ms; the move row shows `06:50` and `+0.05 m`.
3. **Assign the rested pilot** (Journeys 3, DP-18–DP-22, DP-25, DP-66). `Assign pilot to <ref>` or `a` opens `dialog "Assign pilot"` with the server's turn list, next eligible preselected. Assign is keyed; a second press while waiting sends nothing. Success `Pilot <name> assigned to <ref>`; the move is `Pilot assigned`; two notices (`Order confirmation` to the agent, `Assignment notice` to the pilot) go out once via Mailpit and show `sent` on the move.
4. **Pilot on a phone** (Journeys 4, DP-33–DP-35). `/pilot` at 375 px: next job (earliest assignment in `Pilot assigned`/`Pilot away`/`On board`), its pinch, Keel Section with touch handle, `Waypoints` sheet, `Jobs` drawer. `Confirm pilot away` → `Status now Pilot away`, `Confirm boarding` → `Status now On board`, `Complete move` → `Move completed. Charges post when the billing provider confirms.`
5. **Ladder report** (Journeys 5, DP-36–DP-40). `File ladder report` → `dialog "Ladder report"`. A mislabelled file → `Photo is not a JPEG, PNG or WebP image.`, listed `Photo not stored` with `Retry photo upload`; a real PNG replaces it → `Photo stored. SHA-256 <hex>`. Non-compliant + defects + `Refuse boarding` → `Report LR-3001 filed`; move `Refused at ladder` (heading `Boarding refused at ladder`), Cancellation line $380.00, one `Ladder notice` mail to agent + `harbourmaster@port-ansell.example` with the photo attached byte for byte. Agent downloads `Download photo 1`; `Corrected re-order` returns the move to `Ordered` with no mail.
6. **Amend near boarding** (Journeys 6, DP-27–DP-31, DP-64). Move page shows `Notice cutoff` `YYYY-MM-DD HH:MM ADT|AST` and `Notice verdict` from the server only. Late cancellation → `Cancelled late - under 2 hours' notice. The cancellation charge applies.`, status `Cancelled late`, line Cancellation × (1 + late amendments).
7. **Tariff and invoice** (Journeys 7, DP-41–DP-48, DP-61). `/accounts` form prefilled from the latest-effective revision; `Revision <label> published, effective <date time> port time`. Moves are priced by the revision in force at their boarding instant. `Issue invoice <id>` → `Invoice <number> issued` once Kill Bill commits; otherwise `Invoice pending provider confirmation`; a `Completed` move becomes `Invoiced`.
8. **Outage and lost reply** (Journeys 8, DP-49–DP-52, DP-55, DP-62, DP-63). Service items `Billing down` etc. and outage lines in `Service announcements`; a lost reply → `No reply from the server. Showing the last confirmed state.` and the control stays; pressing again resends the same `Idempotency-Key` and paints the stored success. Board link `/board?move=<ref>&q=<text>` (replaceState).

## Server rules made concrete

| Rule | Value | Source |
|---|---|---|
| Arrival | boarding instant + exact Σ(leg nm ÷ leg kn) seconds, rounded half up once per waypoint (BigInt fractions) | brief: Leg speed and arrival |
| Squat | Cb × V² ÷ 100 m (÷ 50 confined) → mm, half up | brief: Clearance |
| Required | max(1,000, ⌊draught/10⌉) mm | brief: Clearance |
| Tide | cosine between events, instants by real time, ±2 neighbouring dates; offsets per waypoint | brief: Tide |
| Steps | 5-minute local steps that exist; fall-back repeated hour once; spring-forward hour absent | brief: Port time |
| Notice cutoff | boarding instant − 2 h, written in local time with its offset | brief: Notice cutoff |
| Rest | 10 h after a duty ≥ 7 h, else 6 h, both directions; night rest 12 h after a 3rd+ consecutive night; rota run ≤ 15 dates | brief: Pilot eligibility |
| Tariff lines | Draft foot, Tonnage band, Minimum charge, Night surcharge (qty 1, unit = amount), Detention, Cancellation; each line half up once | brief: Billing events; decided: night/minimum quantity 1 |
| Versions | only stored changes to the move row raise `version`; notice and charge states live in their own records | decided: a mail or posting must not stale a dispatcher's plan |
| Permitted actions | one table (`domain/moveRules.ts`) of statuses per action; `Move.actions` lists what this reader may do now, and screens render only those controls | brief: Move states; Public screens ("present only when the status permits") |
| Amendment changing vessel | the new vessel's dimensions apply; it must belong to the ordering agency | decided: billing stays on the agency that ordered |
| Duty at early completion | a duty cannot start after it ends: completion or refusal before the boarding instant makes it a zero-length duty at that time | decided: rest counts from when the pilot actually stopped |
| `committed.pinch_waypoint` | the waypoint name | decided: the export needs the name |
| Refusal outside `Pilot away` | 409 `illegal_transition` | decided: a state conflict |
| Revision before the first one | the first revision prices it | decided: past plans still show an estimate |
| Move refs / invoices / reports | `MV-1011…`, `INV-5001…`, `LR-3001…`; photo and card ids random hex | decided: instances share one bucket, so object keys must not collide |
| Sign-in field | spelled with an escape in source | decided: the deployed Kill Bill credential is the same word (IF-06) |

## Palette (decided within brief: Visual design)

| Role | Hex |
|---|---|
| ground | `#081A1D` |
| panel / raise | `#0C2226` / `#112C31` |
| rule (hairline) | `#21434A` |
| control edge | `#6A8994` |
| ink / muted | `#CBD8E0` / `#A8BEC8` |
| teal (bars) / water / water line | `#1A7F86` / `#0E4C55` / `#5FC4C9` |
| amber (actions, handle, Pinch) | `#F0A841` |
| coral (closed gate, negative margins, outages, always with words) | `#FF6B5C` |
| seabed / seabed stroke | `#1B2724` / `#7E968C` |

## Type, space, layout

- Headings (h1 to h3) Saira Condensed 600 uppercase, 0.04em tracking; body IBM Plex Sans 400/600 at 14 px; numerals IBM Plex Mono with the unit in the same span; sizes 12, 14, 17.5, 21.875, 27.34 px (brief: Type, 1.25 ratio).
- 4 px spacing unit; rows 32 px desktop, 44 px below 768; radius 0; no shadows or gradients; 1 px rules (brief: Density and shape).
- `/board` and `/pilot`: top strip, `Service announcements`, then `region "Keel Section"` (height `100dvh / 3`: bar, drawing, formula line, time handle, planning day + open windows + `Commit window`), then the toolbar (`Waypoint table` toggle or `Jobs`/`Waypoints`, `Section announcements`), waypoint strip and panes. Only the region is pinned (`position: sticky; top: 0`); the toggle and the strip scroll with the panes in the page's own scroll (brief: Planning layouts). The pane block is `100dvh - 32px` tall and each pane scrolls inside it (decided: the page travels more than 500 px under the pinned section at 1280x800, and the panes' top never passes the top of the window, so scrolling a pane control into view never lifts the pane out of reach). `Commit window` follows the handle in Tab order (decided: keyboard planning reaches it in a few presses). ≥ 1280: Order queue · Moves · Pilot turn list; 768–1279: queue over moves left, turn list right; < 768: Moves only, drawer and sheet (brief: Planning layouts).

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| water line | plan paints | 0 | — | same |
| bars (`y`, `height`) | plan paints | 120 ms | cubic-bezier(0.16,1,0.3,1) | snap |
| Pinch marker (`transform`) | plan paints | 170 ms after 150 ms | same | snap |
| gate ribbon leaf | gate state changes | 330 ms | same | no leaf, colour and words change at once |
| hull (`data-progress`) | commit accepted | 900 ms, rAF, ease-out cubic | — | straight to 100 |
| drawer / sheet / dialogs | open / close | 250 ms fade in place; exit slides away with pointer events off, on page timers; reopen keeps it open | same | no travel |
| press / hover | pointer | 100 ms amber hairline | same | instant |

## States per async action

Pending / success / failure copy exactly as brief: Feedback states, in the region the brief names. Failure and no-reply messages persist until the user acts again in that control or the reported fact changes. Board refresh text `Board refreshed HH:MM:SS port time` / `Board refresh failed - showing data from HH:MM:SS`, from the server clock (reply `Date` header + monotonic time).

## Breakpoints

375×812, 768×1024, 1280×800 with no horizontal scroll (brief: Screens and layout).

## Media and licences

| Asset | Licence |
|---|---|
| Saira Condensed 600, IBM Plex Sans 400/600, IBM Plex Mono 400/500 (woff2, latin), vendored from Fontsource 5.3.0 under `public/fonts` | OFL-1.1 |
| Product mark, long section drawing | original (inline SVG drawn in code) |
| Shipped packages: react, react-dom, scheduler | MIT |
