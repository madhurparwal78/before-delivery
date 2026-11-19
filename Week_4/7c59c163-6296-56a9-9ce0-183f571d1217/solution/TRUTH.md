# TRUTH — Plumtide Venue golden

The brief made concrete. `brief: <section>` values are copied verbatim; `decided: <why>` values fill
silence in the brief's intent and the candy-shift direction.

## Journeys (ideal end-to-end flow)

### 1. Fund and trade an event (Ana) — brief: Journeys 1, Business rules
- Start: `hl-ana` signed out; seed state Ana available 68,106¢, held 31,894¢; RAIN book bids 34 (150), 30 (80), asks 37 (200), 40 (100). brief: Seed data.
- Sign in from `Sign in` → Keycloak → back on `/` with the `navigation "Venue"`. brief: DP-01.
- Balance → `Deposit by card` → Amount `50.00`, card `4242 4242 4242 4242` → `Deposit status` shows `Waiting for card confirmation…` then `Deposit confirmed — $50.00 added to your balance.`; available +5,000¢. Kill Bill records PURCHASE `deposit-<id>` SUCCESS on account `harbor:<member id>`; journal entry `deposit` (card_clearing −5,000, member available +5,000); one email `Deposit received — $50.00`. brief: DP-08, DP-09, DP-12.
- RAIN → `Book levels` option `Ask 37¢, 200 resting` → ticket Yes / 37 / 200, focus on Quantity → Quantity 120 → summary `Cost $44.40 + fee $0.56 = $44.96` → Review order → Confirm order → `Order updates`: `Filled in full`, `Filled 120 at 37¢`. brief: Interactions, Feedback states.
- End: order `filled`; available −4,496¢; book ask 37 shows 80 and is still best ask; ring shrinks then settles; Last trade counts to `37¢`; RAIN open interest 120; harbor `volume_cents_today` 4,440, `fees_cents` 56. brief: Business rules example.

### 2. Trade the shared pair book (Bo) — brief: Journeys 2
- Margin buy rests at the same price level as spot orders (`spot_quantity` + `margin_quantity` per level). A spot sell fills it: balance, levels, rings, open interest update in place within 1 s; the ticket keeps typed values and focus. A later trade far below entry makes the maintenance check (≤ 2 s after the fill) liquidate the long at the mark; `Order updates` shows `Your LANT margin position was liquidated at $<mark>.`; resting margin orders end `liquidated`. brief: DP-22..DP-25, DP-35, DP-36.

### 3. Build a bot (Ines) — brief: Journeys 3
- Builder → Desk (upgrade immediate, Kill Bill prorated invoice) → `Create API key` → dialog shows `pv_<12 hex>_<40 hex>` and `This key is shown once.` → `Save endpoint` → Svix endpoint uid `member-<id>`, channel `member-<id>` in app `venue-harbor`. Two `POST /api/orders` with the same `Idempotency-Key` → one order (second carries `Idempotent-Replayed: true`). One signed `order.filled` per fill, `eventId` = `fill_<fill id>`; delivery attempts listed. brief: DP-37..DP-46.

### 4. A plan payment fails — brief: Journeys 4
- Kill Bill `WARNING` (1 unpaid invoice) → `Payment failed` badge + banner, email `Payment failed — your Builder plan`; `DOWNGRADED` (2 unpaid) → `Downgraded`, every key's `rate` set to 2 before the state is committed, email `Your plan is now Sandbox`; `Pay outstanding balance` → Kill Bill invoice payments → when Kill Bill clears the account: `Active`, keys back to 20, email `Your Builder plan is active again`. brief: DP-43, DP-44.

### 5. Run the venue's markets (Teo) — brief: Journeys 5
- `List market` (event, close a few minutes ahead) → `Open trading` → YES and NO meet on the one book → at `closes_at` the server closes it (reads report `closed`, resting orders cancelled ≤ 2 s, open screens show `Trading closed`) → `Resolve` → `Confirm resolution` (Yes) → within 5 s payouts of 100¢ per winning contract from escrow, status `settled`, screen `Settled YES`; refund part of a deposit → refund email. brief: DP-31..DP-34, DP-13.

### 6. Own the venue (Mara) — brief: Journeys 6
- Venue totals (Parkinsans numerals), `Find member` combobox, `Invite member` (Keycloak user with `UPDATE_PASSWORD`, invite email `You're invited to Harbor Lantern Club`), fees saved for later orders, `Export fills (CSV)` (`fills-harbor-YYYY-MM.csv`), `Generate statements` (`Statements are being generated for <Month YYYY>.`), each member gets `Your <Month YYYY> statement is ready`. brief: DP-51..DP-54, DP-48, DP-49.

### 7. Run the platform (Sol) — brief: Journeys 7
- Provider health (7 providers, `up`/`down`, 2 s checks), `Onboard venue` → venue listed, owner invite email; every venue route refuses the founder (403 / 404 for ids). brief: DP-07.

## Palette (hex used by the build)

| Role | Hex | Source |
|---|---|---|
| slate ground | #B4C1CF | brief: Colour roles (soft grey-blue slate); hex decided |
| surface (cards) | #E6ECF2 | brief: paler blue-grey surface; hex decided |
| ink text | #17191E | brief: near-black ink; hex decided |
| secondary text | #3A4452 | brief: dark slate; hex decided |
| sage | #B9C8B0 | brief: soft grey-green sage; hex decided |
| blush | #E4CBC1 | brief: dusty pink-beige blush; hex decided |
| olive accent (every pill) | #46521F | brief: deep olive green; hex decided |
| stone (text on olive) | #EEEADD | brief: pale stone text; hex decided |
| stone-soft (secondary on olive) | #C4C3B0 | decided: readable secondary text on olive (4.74:1) |
| bid rings | #5F7F54 | brief: bids in sage; deepened for 3.79:1 on surface (decided) |
| ask rings | #B0624F | brief: asks in blush; deepened for 3.75:1 on surface (decided) |
| spindle | #46521F | decided: the accent carries the axis |

Contrast: ink on slate 9.60, on sage 10.01, on blush 11.40, on surface 14.78; stone on olive 7.02. brief: Accessibility (AA).

## Type, space and layout

- Parkinsans 700: product name, headings, live totals (home volume, open interest, venue totals). Urbanist 400/600/700: body, labels, tables, forms; prices/sizes/balances `tabular-nums`. brief: Typefaces.
- Scale ratio 4/3: 17 / 22.67 / 30.22 / 40.3 / 53.7 px; hero name and home volume numeral 9.09vw (1/11 of the viewport width). brief: Scale; base size decided (comfortable density).
- Cards radius 28px, padding 24px (32px ≥ 768); controls ≥ 44×44px; focus ring 3px solid ink, offset 3px. brief: Working screens, Accessibility.
- Breakpoints: < 768 one column; 768–1279 two columns; ≥ 1280 desktop. brief: Screens and layout.
- Market detail: 375 header → orbit (full width, square) → Book levels → ticket → Your orders; 768 left column orbit + Book levels (sticky), right ticket + Your orders; 1280 three sticky panes Book levels | orbit | ticket over a tall first row, Your orders full width below; page ≥ 1200 px taller than the viewport at every size. brief: Market detail.
- Balance: Available, held and collateral cards on a two-column grid at 768 and 1280 (brief: Balance), Available spanning both columns (decided: three cards on two columns, the balance a member checks first leads); the Deposits and Positions tables run full width below (decided: five-column tables need the width).
- Fields: Home hero slate → sage → blush → olive close block; Markets and Market admin sage; market detail blush; Balance, Orders, Statements, Profile, Venue, Platform slate; Builder olive with pale text and surface cards. brief: Working screens.

## Motion

| Element | Trigger | Duration | Easing | Reduced-motion substitute | Source |
|---|---|---|---|---|---|
| Pill press | :active | 150 ms | cubic-bezier(0.2,0,0,1) | none | brief: three speeds |
| Dialogs, Menu sheet, banners | open / close | 320 ms (fade + 12 px) | same | appear/disappear at once | brief: three speeds |
| Sticker entrance | first home load | 600 ms rotate 0° → tilt | same | final tilt from the start | brief: Stickers |
| Ring shrink / re-sort | book update from stream | < 1 s, critically damped (ω 14 s⁻¹), `data-settled` false until every ring is within 0.5 px | — | Depth ladder, at once | brief: Fill |
| Last trade count-up | rings settled after a trade | 600 ms, ends on exact price | ease-out cubic | final value at once | brief: Fill |
| Scroll camera | page scroll 0→1200 px | linear: 90° → 35° at 600 px → 0° at 1200 px, 0° beyond; same both ways | linear | scrolling changes nothing | brief: Scroll camera |
| Home orbit | — | fixed 35° | — | Depth ladder | brief: Scroll camera |
| Drag yaw | horizontal drag | 1° per 6 px, ±20° cap; release springs to 0 < 1 s, no bounce (ω 12 s⁻¹) | — | — | brief: Drag |
| Skeleton | loading | one pass of a lighter band, then still | — | still | brief: Working screens |

No idle motion anywhere; the orbit's frame loop stops when everything is at rest. brief: Motion and effects.

## States per async action (live region → copy)

All copy verbatim from brief: Feedback states. Place order → `Order updates` log (pending `Sending order…`, summary then `Filled <q> at <price>` lines, newest 10 kept); Cancel → `Cancelling…` / `Order cancelled` / `This order has already ended.`; Deposit → `Deposit status`; outage banner `Card payments are paused — your balance is safe`; Refund → `Admin updates`; Change plan / Pay → `Billing status`, banners for payment failed / downgraded / billing unavailable; Save endpoint → `Webhook status`, delay banner; Create key → inside the dialog; Statement link → alert on Statements; Generate statements, Save fees, Send invite → `Venue updates`; Save profile, Upload → `Profile status`. Decided (brief silent): admin lifecycle results `<SYMBOL> is now <status>.`, run-liquidations result `<SYMBOL>: checked N positions, liquidated M.`, onboarding result on Platform.

## Server rules made concrete

- Fee per fill `floor((notional × bps + 5000) / 10000)`; holds and the hold kind (buy, spot sell, margin open, margin reduce) decided once in `src/shared/rules.ts` and reused by the ticket summary. brief: Fees, Holds.
- Matching: one `FOR NO KEY UPDATE` lock per market row; makers by best price then `seq`; own orders skipped; event NO buy at q is an ask at 100 − q; execution at the maker's price; netting closes min(YES, NO) pairs for 100¢ each. brief: Matching.
- Ledger accounts exactly as brief: Services; every balance change is one entry whose legs sum to 0 (rejected otherwise). Margin cash flows through `venue:margin_lending:<market>`; shortfalls hit `venue:insurance`. decided: a balanced home for borrowed notional.
- Error precedence 413/400 → 401 → 429 → idempotent replay → 404 → 403 → 409 → 422; provider failures map to the route's published 503 code in one table. brief: API.
- Idempotency keys per (member, endpoint), never expiring; the key row is inserted first so exactly one of simultaneous requests executes and the others return its replay. The same key with an identical body (compared as parsed JSON) returns the first response's status and body unchanged, whatever that status was (a `payments_unavailable` 503 included), with no second order, hold, fee, Kill Bill payment or email. brief: Idempotency. Only a crash that produced no published response frees the key. decided: nothing was answered, so there is no first response to replay.
- Seed applied in steps (venues → people → funding → orders) under an advisory lock; the listener opens after the first start-up attempt. decided: seeded people exist before `/api/health` answers.
- New venues: taker 100 bps, maker 0 bps. decided: the brief sets no default.
- Downgrade: Kill Bill `END_OF_TERM` billing policy; upgrade `IMMEDIATE`; the app waits for Kill Bill to issue and pay the prorated invoice before answering. decided: invoices read back must match Kill Bill.

## Breakpoints

375 / 768 / 1280 as above; nav folds into `Menu` (full-height sheet) below 768; the top bar wraps onto two rows at 768 when needed; no horizontal scrolling. brief: Screens and layout.

## Media and licences

| Asset | How made | Licence |
|---|---|---|
| Four stickers (coin, dial, cube, envelope) | procedural SVG in `src/web/components/Sticker.tsx` | original |
| Orderbook Orbit | three.js geometry from live book levels | original (three.js MIT) |
| Icons | Lucide path data inlined | ISC |
| Parkinsans 700, Urbanist 400/600/700 | Fontsource woff2, self-hosted | OFL-1.1 |

No raster images, video or models ship. brief: DP-60.
