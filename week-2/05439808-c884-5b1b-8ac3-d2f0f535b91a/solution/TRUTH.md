# TRUTH — Saltreach (Low Tide Works)

The brief made concrete. Every value says where it came from: `brief: <section>` (verbatim) or
`decided: <why>`.

## Journeys (ideal end-to-end flows)

1. **Arrive and confirm** (brief: Journeys 1; DP-01, DP-02, DP-09).
   Start: no account, `/signup`. Fill Email, Password, Display name; Time zone is preselected to the
   browser zone (brief). "Create island" → Tide notices "Creating your island…" then "Check your inbox
   at <email>. Your confirmation link may take a few minutes to arrive." Provider: one Mailpit message,
   subject `Confirm your Saltreach email`, From `MAIL_FROM`, body link `<APP_PUBLIC_URL>/verify?token=…`.
   Opening it: heading "Confirming your email", "Confirming…" then "Email confirmed. Your island is
   ready." "Go to sign in" → sign in → Village. Top rule: Brine 1,500 / 2,000, Peat 1,500 / 2,000,
   Copper 100 / 200, Builders 2/2, Saltmark 5, Army 10/20, Trophies 0, League Mudflat (brief: Seed
   data). Sign out → `/signin` with "You signed out."; browser Back → `/signin` again with the same
   notice, never the island (brief: Interactions, Session end).
2. **Build and upgrade** (brief: Journeys 2; DP-11, DP-12, DP-16, DP-74). "Build" opens dialog "Build"
   (focus on the first "Place …"); "Place Peat Rick" closes it and shows a ghost at the cell cursor,
   rotation 0, tinted teal when valid and brick red when invalid. Move with drag, touch or arrows,
   "Rotate"/R, "Confirm placement"/Enter → "Placing Peat Rick…" → "Peat Rick placed. Done at HH:MM."
   The Rick rises out of the salt (560 ms), the Builder queue shows "Peat Rick → level 1 · m:ss",
   Builders 1/2. On completion every open tab announces "Peat Rick reached level 1.", Peat cap
   becomes 7,000, Builders 2/2, Saltmark 6. Provider: `build_spend` ledger pair at the job start.
3. **Run the economy** (brief: Journeys 3; DP-17 – DP-23). Collect in Building details → "Collecting…"
   → "Collected <amounts>." (or the storage-full / nothing variants); the other tab's top rule counts up
   within 2 s via `/api/events`. Train 3 Saltjack → "Training 3 Saltjack. Ready at HH:MM.", Army 13/20.
   Cancel the middle batch from the Army queue → later batches start earlier by its duration; refund
   copy "Training of <count> <unit> cancelled. Refunded <amounts>."
4. **Scout and raid** (brief: Journeys 4; DP-24 – DP-31). "Raid" → `/scout` → "Searching the tide for
   an island…" → Scout report (heading display name, Trophies, League, Lootable list = floor(balance ×
   20 / 100)). "Start raid" (Idempotency-Key) → "Locking the island…" → "Island locked. Deploy before the
   finalize countdown runs out." → `/raids/<id>`: Raid clock m:ss (180 simulated seconds), "Finalize by
   m:ss", Units radiogroup "Saltjack (<n> left)". Keys 1/2 pick, arrows walk the tidal ring, Space or
   Enter deploys at the current tick; batches are retried with the same key after a network failure
   ("Deploys didn't reach the tide. Retrying…"). "End raid" flushes deploys, then finalizes →
   "Resolving the raid on the server…" → "Raid resolved: <stars> stars, <destruction>% destroyed." and
   the Raid result panel (stars, % destroyed, Loot <transferred>, Trophies ±n, "Open replay").
5. **Be raided** (brief: Journeys 5; DP-37). Defender's open village: "Your island is under attack."
   within 2 s of the lock; on resolution the readouts drop to the post-raid values, "Shielded until
   HH:MM" appears when 2+ stars were conceded, "Your island was raided: …" is announced and the Raid
   log's Defences tab gains the row with "Replay raid by <attacker>".
6. **Replay a defence** (brief: Journeys 6; DP-40 – DP-45). `/raids/<id>/replay[?tick=n]`, "Loading
   replay…" → "Replay ready: <final> ticks." The browser re-runs `shared/battle.ts` on the published seed,
   layout, deploys and `result.lootable`; every settle writes `data-tick`, `data-destruction`,
   `data-stars`, `data-loot-*`, `data-state-hash`, `data-settled`, `data-drawn-tick`, equal to the
   server snapshot.
7. **Collect the rewards** (brief: Journeys 7; DP-46 – DP-50). Rewards panel: "Open daily chest" →
   "Daily chest opened (day 1 of 7): 300 brine, 300 peat."; "Claim league bonus" → "Mudflat league bonus
   claimed: 1,000 brine, 1,000 peat."; then "Next chest <Ddd D Mmm, HH:MM>" and "Next league bonus …" in
   the saved zone; a Profile zone change re-renders them in the new zone within 2 s.
8. **Run a clan** (brief: Journeys 8; DP-51 – DP-60). Found clan → "<clan> founded. You lead it." Invite
   by email → "Invitation recorded for <email>. The mail may take a few minutes." (Mailpit subject
   `<inviter> invited you to <clan> on Saltreach`). Invitee accepts from the Clan panel → roster updates
   live; Promote/Demote → "<name> is now Mate/Deckhand."; Delete message → "Message removed by a warden"
   on every open chat. Skipper leaves → earliest `mateSince` mate leads.
9. **Share an army** (brief: Journeys 9; DP-61 – DP-66). Request units (1–6) → "Request posted for 2
   Saltjack."; a clanmate's "Donate to <name>" opens dialog "Donate" (focus on Count) → "You donated 1
   Saltjack to <name>."; the requester's "My request" shows "<given> of <count> Saltjack" live; armies
   and the roster's donated/received counters change.
10. **Settle a dispute, ride out an outage** (brief: Journeys 10; DP-67 – DP-73). Operator → Operations:
   "Database: up", "Mail: delivering", "Queued mail: <n>"; Raid ID + "Re-run raid" → "Seed <seed> re-run
   matches every tick (0–<final>)."; "Check ledger" → "Ledger balanced: <pairs> pairs." With Mailpit
   down the status reads "Mail: queued, Mailpit unreachable" and queued mail is delivered exactly once
   after it returns. With PostgreSQL down every API route but health/status answers 503
   `database_unavailable`, the client shows the outage copy in Tide alerts and a brick banner.

## Palette (decided values for brief: Visual design colour roles)

| Role | Hex | Source |
|---|---|---|
| ground, dusk indigo | `#1A1838` | brief: deep dusk indigo ground; decided: hue 245°, L 16% |
| panel | `#211F45` | decided: one flat step above ground, no shadow |
| ink, salt off-white | `#F3EFE4` | brief: crisp salt off-white ink |
| ink-muted | `#BDB8CF` | decided: secondary text, 8.1:1 on panel |
| kiln orange accent | `#F2933F` | brief: one warm kiln orange for actionable and live values |
| tide teal | `#5FBFB3` | brief: water, valid placement, shield |
| brick red | `#E06A58` | brief: danger, invalid ghost, destruction, outage |
| brick fill | `#9E3A2E` | decided: alert and banner fill carrying ink text at 5.9:1 |

## Type

Fraunces 600 for product name, screen headings (31.25 px) and panel titles (25 px); Atkinson
Hyperlegible 400/700 at 16 px for body and controls; JetBrains Mono 500 tabular for every number
(brief: Visual design, Type; heading steps ×1.25). Fonts self-hosted woff2 (latin).

## Space and layout per viewport (brief: Screens and layout)

| Viewport | Top rule | Queues rail | Context panels | Wake dial |
|---|---|---|---|---|
| 1280×800 | a single slim row in every state (brief: 1280×800, Density): raid clock and finalize countdown first on the raid screen, then readouts with each name beside its value, navigation (icon plus label) at the right end | open, 20vw (min 232 px) | right, 33.3vw | 25vh ring, bottom centre |
| 768×1024 | a single row with smaller gaps (brief: 768×1024): each readout's name sits above its value in a narrow cell, navigation (icon plus label) at the right end | collapsed to its toggle | right, 33.3vw (keeps the centre box clear) | 20vh |
| 375×812 | two rows (brief: 375×812): first the resources, second the other readouts and the icon-only navigation, which holds the row's right end; on the raid screen the raid clock and finalize countdown are the first of the other readouts on the second row (brief L144) | sheet from the left | bottom sheet, max 60vh | 60vw |

A row never wraps further: when its readouts are wider than the row (larger balances, a shield, the raid
clock), they scroll sideways inside that row, which then takes keyboard focus; a solid ink-muted chevron marker
(no gradient, brief: Visual design) shows each edge with more beyond it and scrolls that way when pressed, and the
wheel scrolls the row (decided: the brief fixes
the row count per viewport and forbids horizontal page overflow and targets under 44 px, so the extra
width scrolls within the row; the page itself never scrolls sideways).

Rail, context panels, outage banner and toasts start at `--top-h`, the band's measured height
(decided: the band's height differs per viewport, one row or two, so it is measured rather than assumed). Toasts sit
in the strip between the Queues rail (or its toggle) and an open panel, and below the queues toggle on
phones (decided: a notice never covers a control or a panel heading).

Centre box = viewport/4 × viewport/4 centred (brief: Composition); no interface except Build/Donate
dialogs and the ghost bar overlaps it at 768 and 1280. Targets ≥ 44×44 px (brief: Accessibility).

## Motion (brief: Motion and effects)

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| button press/hover | pointer | 100 ms | cubic-bezier(.2,.7,.2,1) | none |
| context panel | open / close | 250 ms, 24 px travel + fade | cubic-bezier(.2,.8,.2,1) | instant |
| readout count-up + orange | value change (incl. live) | 250 ms count, 700 ms tint | ease-out cubic | instant, no tint |
| camera recentre | panel opens, ghost starts | 250 ms | ease-out cubic | instant |
| building rise / collapse | placed / destroyed | 560 ms | ease-out cubic | instant |
| level badge pulse | upgrade finished | 250 ms, one orange pulse | sine | none |
| tide ripple | loop | 8 s per cycle | sine | holds still |
| scaffold ring | running job | 5 s per turn | linear | holds still |
| Wake dial coast | fling release | v × 0.92 per 16.7 ms frame until < 0.5 tick/frame | exponential | stepped slider, no coast |
| Wake dial spring | coast end / slow release | < 450 ms, k 900, c 60 (critically damped) | spring | none |
| dial numerals | settle | 250 ms count | ease-out cubic | instant |

`data-animating` is `true` only during rise, collapse, pulse, panel slide or camera recentre.

## States per async action

Pending copy → Tide notices with a busy button (aria-busy, presses ignored); success → Tide
notices; errors → Tide alerts; 422 → "Check the highlighted fields." plus each API message under its
control (aria-invalid + aria-describedby). Exact copy per action: brief: Feedback states (verbatim in
`client/*.tsx` and `client/copy.ts`).

## Breakpoints

≤ 700 px phone, 701–1179 px tablet, ≥ 1180 px laptop (decided: between the three named viewports).

## Media and licences

No image, audio, video or model files. Fonts (OFL-1.1) listed in `app/assets.json`; icons Lucide
(ISC) inlined as SVG; island, textures, mark and empty-state drawing are original code.
