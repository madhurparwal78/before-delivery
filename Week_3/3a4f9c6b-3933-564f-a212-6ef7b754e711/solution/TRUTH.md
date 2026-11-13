# TRUTH — Tideline Works Keelson (golden)

Every value says where it comes from: `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys: the ideal end-to-end flow

1. **Ship a bundle to staging** (brief: Journeys 1, DP-18..DP-29)
   - Start: seed. dev and staging show 1.5.0 Healthy `in sync 5/5`.
   - The pipeline sends `POST /api/projects/payments-core/bundles`. The object `bundles/payments-core/<hex>.json` is stored in MinIO before the 201 reply, and the reply carries `sha256:<hex>`.
   - Tomás selects dev, presses Promote, picks `<version> · <short digest>` and presses Request promotion.
   - A double press sends one request key. Activity reads `Requesting promotion…`, then `Promotion of <v> to dev started.`
   - Postgres records one promotion. History is null→requested, requested→queued, queued→applying. Five OutOfSync/Progressing health rows exist, and evidence snapshot 001 is queued and then stored.
   - The rail: a capsule `Bundle <short>` leaves Bundles. Agent reports move `data-phase`/`data-progress` through applying (0.2+0.4·n/N) and health_wait (0.6+0.35·n/N). The counter counts up, and on Healthy the dev border flashes once and shows `current <short>`. The same flow repeats from dev to staging.
2. **Race for prod-eu** (brief: Journeys 2, DP-30, DP-31). Simultaneous requests lock the stage row (`SELECT … FOR UPDATE`), and a partial unique index backs that up. One wins (`awaiting_approval`). Each loser gets 409 `stage_busy` with the holder. The loser's dialog stays open with `prod-eu is held by <v> (<short>). Try again when it finishes.` The node shows `Out-of-sync` with the winner's capsule.
3. **Approve with evidence** (brief: Journeys 3, DP-32..DP-35). Each release manager gets one mail `Approval requested: <v> to prod-eu (Payments Core)`. It carries the redacted diff, the request expiry in cluster time and `<APP_PUBLIC_URL>/approvals/<token>` (192-bit token, stored hashed). The link page shows the redacted diff and an Open in Keelson link. After sign-in, the column shows `Live revision <short>` rows and `Not checked yet. The window is checked when the promotion starts.` Approve uploads the decision snapshot first, then records the approval and queues the requester's notice. Activity reads `Approved until <expiry cluster time>. The requester will be notified.`
4. **A stale tab** (brief: Journeys 4, DP-36..DP-38). A Start at or after `expires_at` answers 409 `approval_expired`, or `invalid_transition` with state `expired` if the sweep got there first. The promotion becomes `expired`, one `Approval expired: …` mail goes out, and Problem reads `This approval expired at <expiry>. Request a new promotion.`
5. **Windows and a Black-Friday freeze** (brief: Journeys 5, DP-39..DP-45). Add window shows the next five openings in cluster time format. Check an instant converts the typed local time with the clock-change rule and writes `Open: <label>` or `Closed: …` into the Window decision status. A new freeze version names `based_on_version`; a stale base answers 412 `Someone scheduled version <n> first. Reload to see it, then try again.` Each promotion pins the version in force at its `requested_at`.
6. **Break a freeze from a phone** (brief: Journeys 6, DP-46, DP-47). The graph stacks vertically below 768px. Tapping prod-apac opens a full-screen sheet with Close at the top. Break freeze needs a 10–500 character reason. The flow is window_blocked→queued→applying, by the SRE. Every release manager gets one `Freeze broken: prod-apac by Kofi Brandt` mail carrying the reason.
7. **Roll prod-us back at night** (brief: Journeys 7, DP-48, DP-49). The target is the most recent `healthy` promotion of the stage other than the current revision. Its bundle object is read back from MinIO and its SHA-256 checked (503 if unreachable, and nothing changes). The current revision becomes `rolled_back`. A `rollback` promotion copies the target's stored overrides byte for byte, with `restores` set to the target, and passes through the window check.
8. **Audit and recovery** (brief: Journeys 8, DP-50..DP-56). Snapshots and messages wait in Postgres. Every instance checks reachability every 2s and drains every 1s (claimed with `FOR UPDATE SKIP LOCKED`, in order per promotion). The ledger shows `Evidence uploads queued: <n>`, `Notices queued: <n>` and the reachability notices. The download returns the latest stored snapshot's exact bytes as `keelson-evidence-<id>-<n>.json`.

## Decided where the brief is silent

- The seeded prod-apac 1.4.0 rollout records a freeze break by Kofi Brandt. decided: 08:30Z is 16:30 in Singapore, outside APAC business hours, and the approval lapsed before the next opening, so a freeze break is the only legal path to `applying`.
- Seeded promotions reach Healthy 10 minutes after entering applying. decided: plausible history; the brief only fixes the request and approval instants.
- Graph nodes add two read-only fields: `defaults` (for the Promote summary) and `last_healthy_at` (for the ledger's last-Healthy column). decided: the screens need them.
- `window-decision?at=` with a bad value answers 422 `fields.at` "Use an ISO 8601 instant with an offset.", and `promotions?limit` answers 422 `fields.limit` "Use a whole number from 1 to 100.". decided: they reuse the brief's message style.
- Errors with no listed code (unexpected failures, the database still starting) answer 503 `storage_unavailable`. decided: the code list is closed, and the dependency step is the last one in the precedence order.
- `GET /` answers 404. brief: Server boundary (only the four client routes are served).
- The Promote button shows only while the stage has no active promotion. The Roll back button shows only when a rollback target exists. brief: "only in states where it applies".
- The approval link API returns the project slug as `project`. decided: the Open in Keelson link needs the slug.
- The rollback reason is stored in `promotions.rollback_reason`. decided: the brief asks for the reason to be recorded but gives it no field in the promotion object.

## Palette (hex used by the build)

ground `#111316`, surface `#1a1d22`, raised `#22262c`, hairline `#2d3239`, control border `#69717d`, ink `#e7eaef`, muted `#a7afba`, faint `#8d95a1`, amber `#f2b13d` (on-amber ink `#1a1406`), coral `#ff7461`, mint `#72d6a3`, steel `#a3bbd8`, grey `#9097a1`. Source: brief: Visual design (roles); decided: hex values (AA ratios in DESIGN.md).

## Type, space, layout

- Fonts: Space Grotesk 500/600 for headings and stage names, IBM Plex Sans 400/500/600 for body and controls, and IBM Plex Mono 400/500 with tabular figures for every number. All are self-hosted woff2. Source: brief: Type.
- Sizes: 14/20 body, then 17, 20, 24 and 28px headings (each step ×1.2, title ≈2× body), on a 4px rhythm. Source: brief: Type, Density.
- 1280px and wider: a 192px rail, then the graph with the ledger directly beneath it, then the evidence column at 30% width, flush right. Stage nodes are 128–136px squares laid out in px, so the graph with three fan-out rows and the whole ledger fit above the 800px fold; the Bundles intake node shares their height and solid hairline border. Every edge leaves its source from one port at the node's vertical centre. Fan-out edges split at a single vertical trunk 24px out, so the junction reads as one clean branch, and each capsule rides its own edge's path. Ledger rows show the in-sync count as bare `<n>/<N>` under the IN SYNC header; nodes and narrow ledger cards keep `in sync <n>/<N>`. In the evidence column every fact row puts its label above a full-width value, so cluster-time values never wrap; diff rows put the change label above the resource ref, and each `before`/`after` label sits on its own line above a full-width value that wraps anywhere, so long image refs wrap from the left edge. The main header always holds a 28px feedback strip under the title (surface, hairline border) carrying Activity and Problem, with a faint `No recent activity.` outside both live regions while they are empty, so the first message never moves the graph. The ledger pins IN SYNC to the right edge. The selected stage's rail link carries `aria-current` with the amber left rule, and the Bundles node captions its newest bundle `latest`. Nodes are 136px with the column closed and 128px with it open (the 656px plate cannot hold four 136px columns plus capsule-length edges). decided: the composition keeps the ledger readable together with the graph.
- 768–1279px: the rail sits behind Menu, the graph is horizontal at full width, and the evidence column overlays the right side (min(440px, 62vw)).
- Under 768px: the graph is a vertical stack; the first fan-out stage sits directly below its upstream and the others branch from one shared trunk lane on the left, the ledger becomes one card per stage, the evidence column is a full-screen sheet with Close at the top, and dialogs take the full width. Source: brief: Viewports.
- Every button, link, checkbox and textbox is at least 44×44. Source: brief: Touch targets.

## Motion table

| Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| Drawn edge stroke (stroke-dashoffset, WAAPI) | server progress rises | 440ms | cubic-bezier(0.16,1,0.3,1) | five labelled segments fill at once (`data-reached="true"`) |
| Capsule (offset-distance on the edge's offset-path, WAAPI) | server progress rises, or a new promotion | 440ms | same | static at the tip |
| Counter (`@property --in-sync` transition; the real text node holds the server value) | in-sync count rises | 440ms | same | swaps at once |
| Target border flash (box-shadow) + current-tag highlight | phase becomes healthy | 440ms | same | steady amber border for 2000ms (WAAPI with identical keyframes) |
| Coral run-back (stroke-dasharray/offset) | phase becomes degraded | 900ms | same | reached segments filled coral at once |
| Evidence column / sheet slide (`@starting-style` translate) | user opens a stage | 440ms | same | none |
| Dialog fade + 8px rise | user opens a dialog | 160ms | same | none |
| Press/hover colour | user acts | 160ms | same | colour only |

Nothing loops, and nothing moves while idle. Source: brief: Motion and effects.

## States per async action

The copy table in brief: Feedback states, verbatim. Pending and success go to `status "Activity"`, errors to `alert "Problem"`, and field errors sit under their field. Success copy is announced only after the screen has re-read the server and shows the new state (the evidence column's actions included). The confirm button stays disabled until then. decided: the announcement never describes a state that the page does not show yet. Rail phases are announced in `status "Promotion progress"` and reachability in `status "Delivery queue"`.

## Media and licences

The only media are fonts and the icon set. Fonts are Fontsource 5.1.1 woff2 under SIL OFL 1.1 (brief: IF-03; SPDX id `ofl-1.1` in `app/assets.json`), listed there with sha256. Icons are Lucide (lucide-react 0.468.0, ISC). The graph plate's dot grid is drawn inline as SVG.
