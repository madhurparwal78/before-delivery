# TRUTH — Opaline Bench Days golden

Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys (ideal end-to-end flow)

1. **Explore and reserve on a phone** (375x812). Start: no account, 24 open benches. The overture
   fills the screen; a full-width reserve bar (`<remaining> of 24 seats remaining`, `Reserve a bench`)
   is docked at the bottom (brief: Screens and layout). `Menu` opens `dialog "Chapters"`; `03 Two days`
   closes it, scrolls and focuses the chapter heading. The `Day 1`/`Day 2` segmented switch swaps the
   session list. `Details for <evening>` and an FAQ question expand in place. The lab scene is about
   half the viewport; a sideways drag orbits it. The visitor creates an account from the sign-in
   dialog, taps an open C/D bench: it lifts, the ring depletes, and the docked bar becomes
   `region "Your hold"` with the countdown, `Pay deposit`, `Pay in full`, `Release bench`. Paying
   shows `Bench <bench> is yours`. End: reservation `deposit_paid`; Kill Bill PURCHASE
   `ob-deposit-<id>` of 90000 cents; `receipts/<id>/deposit.pdf` in MinIO; Mailpit has
   `Deposit received: Bench <bench> is yours` (brief: Services).
2. **Keyboard-only reservation** (1280x800). Tab lands on the first `Open` bench; arrows move
   (row ends stop); Enter holds; `status "Bench updates"` reads `Bench <bench> is held for you.
   <remaining> of 24 seats remaining.`; Escape releases (`Bench <bench> released. …`); Enter holds
   another; `Pay deposit` opens Checkout with focus in `Name for the receipt`; `Pay deposit $900.00`
   reads `Processing payment` while in flight; `Done` returns focus to the hold-panel heading.
3. **Last Atelier place**. Nine Atelier seats are sold. Two holds race; both panels read only
   `Holding Bench <bench>` (no lift, `data-lift` `0.00`, `data-ring` `none`) while the requests run;
   one 201, the other `409 bench_taken` (same bench) or `atelier_sold_out` (different benches) with
   `waitlist.open: true`; the loser's bench never lifts and shows the refetched server state
   (brief: Interactions › Bench state text): `Held` when the winner took that same bench, `Sold out`
   when it is a different A/B bench the server still reports `open`; the
   heading `Atelier is sold out` and `Join the Atelier waitlist` appear, and they join as number 1. The winner's
   hold lapses (server sweep within 2 s); the bench is offered to the first waitlisted entry for
   `OFFER_SECONDS`, email `A bench is open for you: sign in to accept`; accepting on `/account`
   starts a fresh 480-second hold. Throughout, the live offer counts under `held` and as an active
   Atelier place, so `sold_out` stays true on the map, the reserve bar and `GET /api/desk/inventory`
   (brief: Business rules › The ledger count).
4. **Balance, upgrade, cancellation, refund**. Upgrade from `deposit_paid` on or before venue-local
   19 March 2027 charges 60000 (`ob-upgrade-<id>`, balance becomes 440000); from 20 March it charges
   245000 (`paid_cents` 335000, balance 255000); from `paid_in_full` 245000. Every calendar rule
   reads the America/Chicago date of `BENCH_DAYS_NOW` (or the real clock), so 05:30 UTC on 16
   January 2027 is still 15 January (refund `paid − 25000`) and 06:30 UTC is 16 January (50%). Balance payment
   (`ob-balance-<id>`) moves to `paid_in_full` with `Paid in full: Bench <bench>`. Cancel fixes
   `refund_due_cents` by the venue date; the registrar's `Issue refund $<amount>` posts REFUND
   transactions `ob-refund-<id>-<n>` newest payment first with item adjustments; the row turns
   `Refunded`; email `Refund confirmed: Bench <bench>`.
5. **Clinic group**. A clinic selects up to six benches, `Hold <n> benches`, `Pay group invoice
   $<total>` — one Kill Bill invoice with one EXTERNAL_CHARGE per seat (`Bench <bench> <Tier> full
   price`) and one PURCHASE `ob-group-<gid>`; heading `Group invoice confirmed: <n> seats on one
   invoice`; group receipt lists `Bench <bench>: <name or Unassigned>`; named colleagues get
   `<clinic name> assigned you Bench <bench> at Opaline Bench Days`. Cancelling one seat adjusts only
   its item; upgrading one seat makes a separate one-item invoice.
6. **Registrar paperwork**. `Open licence` opens a 60-second presigned MinIO link; `Mark licence
   matched` → `Licence matched for <name>.`; `Issue visa letter` writes `visa-letters/<id>.pdf` once
   and emails `Your visa-support letter for Opaline Bench Days`.
7. **Event days**. On 2027-04-16 (venue date) `/checkin` reads `Day 1 check-in`; `/` focuses the
   search; two characters list matches (`Found <n> for "<query>".`), and the list shows only an
   answer whose echoed `q` is the text in the box; Enter checks the single match in; on 2027-04-17
   (until 05:00 UTC on the 18th) day 2. A certificate attempt while MinIO is down answers 503 and
   uses no number, so numbers stay consecutive. The
   certificate (`OB-2027-0001`…) is generated once into `certificates/<id>.pdf`, re-served
   unchanged, emailed once.
8. **Content and outages**. On the Agenda tab, `status "Hands-on share"` reads
   `Hands-on 690 of 960 minutes (71.8%)` at seed and recomputes in the browser on every Minutes
   keystroke and Format change; below 30% the Minutes field is `aria-invalid` and described by
   `Hands-on time must stay at least 30% of the agenda.`. Session writes run one at a time under a
   Postgres advisory lock, so of two writes that together break the rule exactly one succeeds. A
   PATCH from the content desk lands in PocketBase and shows on the next load. With Kill Bill unreachable, payments answer 503 `billing_unavailable`, the `alert` banner and
   Bench updates read `Billing is offline right now. Your hold keeps running and no money has moved.`
   and the hold keeps counting; the same retry succeeds once Kill Bill answers.

## Palette (decided values inside the brief's roles; brief: Visual design › Colour)

| Role | Hex |
|---|---|
| ground (near-black warm umber) | `#14100d` |
| umber ink (raised panels, dialogs) | `#241c16` |
| umber rule | `#3d3128` |
| bone (text, fine rules) | `#ede4d3` |
| bone muted (secondary text) | `#bcae98` |
| curing-light blue (live/selected only) | `#62c9ff` |
| priority gold (Atelier marks only) | `#d6a64b` |

Form errors (field errors, error summary, the invalid Minutes field, the content-unavailable line)
are bone text with a curing-blue marker: a 3 px curing-blue left rule, and a curing-blue border on
the invalid input (brief: Visual design › Density and composition). No other error hue exists.

## Type, space and layout

- Bodoni Moda display (400, 400 italic, 500), Instrument Sans body (400/500/600), both self-hosted
  (brief: Type). Monospace for countdowns and chapter numbers: system `ui-monospace` stack (brief:
  Numerals; decided: no third bundled font, the brief names two).
- Scale ×4/3 from 16 px: 12 · 16 · 21.3 · 28.4 · 37.9 · 50.5 · 67.4 · 89.8; chapter headlines
  `clamp(50.5px, 7vw, 89.8px)` (5.6× body at 1280). `tabular-nums` on `:root`.
- Chapters `min-height: max(100vh, 800px)`; lab chapter 200vh, and the scene stays in view while
  the chapter scrolls at every viewport (brief: Screens and layout): at ≥768 the whole lab stage is
  sticky under the masthead; at 375 the half-viewport scene is sticky under the masthead while the
  stacked list of benches scrolls beneath it (decided: the list is taller than the viewport, so only the
  scene can stay pinned).
- 1280x800: headline ≤ 62% width; rail fixed 24 px from the right edge; reserve bar top-right;
  agenda two columns; lab 2fr scene | 1fr controls (tier, 4×6 map, hold panel); evenings 3 per line;
  venue address and hotels side by side.
- 768x1024: rail and top-right bar; headline full width; agenda one column; scene full width then
  tier, map 4×6, hold panel; evenings 2 per line; venue stacked.
- 375x812: `Menu` + chapter drawer; bottom-docked reserve bar holding `region "Your hold"` while a
  hold is live; segmented day switch; map as a list grouped under `Row A`–`Row D`; 1 card per line.

## Motion (brief: Motion and effects)

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| bench rim / buttons | hover, press | 200 ms | `cubic-bezier(.16,1,.3,1)` | none |
| bench state, tab indicator, panel | state change | 333 ms | same | instant |
| seats count | value change | 600 ms (rAF) | ease-out cubic | final value |
| bench lift | hold placed | 520 ms spring (ease-out-back) | — | no scene |
| orbit spring-back | drag release | 450 ms | ease-out cubic | no scene |
| ring → band | payment confirmed | 600 ms | ease-out cubic | `Yours` band tile |
| bench label letters | hold placed | 333 ms each, 60 ms stagger | same | plain text |
| headline wipe | page load | 900 ms | same | none |
| preloader | lab assets ready | 0→100 in 800 ms | linear | not shown |
| chapter jump (rail, drawer, Reserve a bench) | link press | instant | — | instant |

The header is opaque `ground` with an `umber rule` hairline (decided: headlines scrolling under a translucent header ghosted through it). At 768 and 1280 the bar shows the seats count and `Reserve a bench`, or, while a hold is live, only the hold countdown (brief: Screens and layout, "seats remaining and the reserve button, or your live hold countdown").

Chapter jumps do not animate the scroll (decided: brief › Motion and effects says nothing else on
the site moves beyond the preloader, ring and countdown; a smooth scroll that is still settling also
moves controls under the pointer).

Camera: elevation 62° → 20° over the lab chapter's scroll; drag azimuth ±35° and elevation 20–62°
with ≤ 8° resisted over-pull. No idle motion.

## States per async action

| Action | Pending | Success | Refusal / outage |
|---|---|---|---|
| hold | `Holding Bench <bench>` | lift + ring + held copy | taken / Atelier sold out copy |
| pay | `Processing payment` (disabled) | `Bench <bench> is yours` | 202 pending copy; 503 billing banner; deposits closed copy |
| account actions | button disabled | Account updates copy | storage / document offline copy, field errors |
| desk actions | — | Desk updates copy | refund blocked copy; `Certificate not ready: <missing>.` |
| check-in | — | `<name> checked in for day <day>.` | already / balance due / no day 1 / no attendee copy |

## Breakpoints

`< 768` narrow; `768–1199` tablet; `≥ 1200` desktop (decided: 1200 so 1280 gets the desktop arrangement
with room for the rail).

## Media and licences

No images or video. Fonts: Bodoni Moda and Instrument Sans woff2 from Fontsource 5.3.0, OFL-1.1
(`app/assets.json`). Icons and the empty-state drawing are inline SVG drawn for this app
(`original`). The lab is procedural three.js geometry (MIT): each typodont is an extruded horseshoe arch in bone on a dark umber base (decided: the bench lab's focal object reads as a dental arch, not a block).
