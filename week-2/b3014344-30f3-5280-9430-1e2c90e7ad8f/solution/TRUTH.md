# TRUTH — Pampero Ledger golden

The brief made concrete. Every value says `brief: <section>` (verbatim) or `decided: <why>`.
Design tokens in full: `DESIGN.md`.

## Journeys (ideal end-to-end flow)

1. **Peso prospect buys a site build** (brief: Journeys 1). Start: signed out on `/`. Scroll past the hero
   (monolith turning, 36 s per turn — decided within 30–45 s); Tab through `list "Case studies"`; Enter on a
   card lifts it to fill the stage in 667 ms then shows `/work/<slug>`; Escape / Back to work / browser
   back returns to `/` with focus on that card. In `region "Pricing"` pick ARS (or press C); Studio Site is
   chosen; the sheet folds flat (`Quoting…`), the crease slides to 40.0, panels tilt to 18°, numerals count
   to `ARS 235.061,72` / `ARS 352.592,60`; `Quote status` reads `Due now ARS 235.061,72, due at
   launch ARS 352.592,60, total ARS 587.654,32.` Start checkout → `POST /api/orders` → `/checkout/<id>`.
   Fill Business name, Your name, Email, Password, tick `I accept the scope and price in this quote`,
   Accept quote → `Quote accepted. Price locked at ARS 587.654,32.`, focus on Card number. Card
   `4242 4242 4242 4242`, `12/39`, `123`, `Pay ARS 235.061,72` → `Processing payment…` → `/orders/<id>/receipt`
   (`Payment received`, Deposit, amount, capture time BA, `We'll email your receipt to <email>.`).
   Provider end state: Kill Bill account `pampero-<account id>` (ARS, BA tz, AUTO_PAY_OFF, external plugin);
   deposit invoice `PB-#### deposit` with balance 0.00; exactly one authorized and captured Kill Bill payment `<order id>-deposit`
   showing AUTHORIZE then CAPTURE, both successful, for the amount paid, plus one external invoice payment of
   the same amount that settles the deposit invoice (brief: Services, Build payments); MinIO `portal/<order id>/.portal`; Mailpit `Receipt PB-####:
   ARS 235.061,72`; portal shows a new project; order `deposit_paid`.
2. **Build to close** (brief: Journeys 2). Studio: Start build (`in_build`); Peso prices form raises
   Studio Site (row effective now); Invoice launch balance → Kill Bill invoice `PB-#### launch balance` at the
   locked balance, `Invoice <n> from Pampero Build Co.: <amount>` email, PDF under `portal/<order>/invoices/`.
   Client follows `/portal/invoices` → `Pay launch balance` → checkout Payment form for the open balance →
   receipt. Studio: Close project → `closed`; the contractor gets 403 `access_ended` (page: access-ended page)
   on the project, its files and earlier links.
3. **Portal sharing** (brief: Journeys 3). Owner: Invite teammate dialog → `Invite sent to <email>.`, email
   `Join <business> on Pampero Ledger` with `<APP_PUBLIC_URL>/invite/<token>`. Teammate sets name and
   password → `/portal/projects/<id>`; uploads logo with `Uploading <name>: 0/25/50/75/100%` then
   `Uploaded <name>.`. Contractor downloads it and uploads a deliverable; owner downloads it and the
   deposit invoice PDF.
4. **Care change** (brief: Journeys 4). `/portal/plan` Switch to Care Lite → dialog + `POST /api/plan/previews`
   at once; sheet shows Credit / New plan charge from Kill Bill's dry run; Confirm change → `Your plan is now
   Care Lite.`, focus returns to `Switch to Care Plus`. Kill Bill change invoice holds REPAIR_ADJ = credit and
   RECURRING = charge. Pause → `Your plan pauses on <charged-through>.`; Resume → `Your plan is active
   again.`; Cancel at period end → `Your plan ends on <charged-through>.`
5. **Renewal fails** (brief: Journeys 5). Seeded PB-0004/PB-0005: renewal invoice open at seeding, attempt 1
   declined (card 0002) within 60 s: invoice notice + `Care plan payment failed (attempt 1 of 3)`; plan
   `past_due`, banner `Your last care-plan payment failed. Update your card to keep your plan.`. Attempts 2
   and 3 at +3 and +7 dunning days; attempt 3 cancels the subscription at once. Card update with 4242 pays
   the renewal (`<invoice id>-renewal`), one receipt, status active, no dunning notice.
6. **Refund and credit** (brief: Journeys 6). Studio Refund dialog → `Refunded <amount>. <left> left on this
   payment.`, Refunded so far / Left on this payment update; one refund email; REFUND transaction on the
   captured payment. Add credit (decided: per-order dialog, journey 6 needs a UI) → Kill Bill CBA, applied by
   Kill Bill to the next invoice; one credit email.
7. **Billing down at checkout** (brief: Journeys 7). Pay → `alert` with exactly the billing-outage copy,
   nothing in Kill Bill, card fields keep their values; Pay again when billing returns succeeds.

## Rules carried exactly (brief: Business rules)

Deposit = floor(40% of total) to the cent, balance = remainder (`shared/money.ts`); share half-up to one
decimal; money as BigInt minor units; display `USD 1,999.99`, `ARS 2.350.617,28`, `-USD 120.50`; price in
effect = latest row with effective ≤ now; order moves only quoted → accepted → deposit_paid → in_build →
balance_invoiced → paid_in_full → closed (care stops at paid_in_full); error precedence 413/415/403 cross
origin → 401 → studio 403 → 404 → 403 → idempotent replay → 409 → 422 → 402/503; idempotency keys scoped to
caller + method + path, only 2xx stored; uploads ≤ 10,000,000 bytes, type by magic bytes, SVG without
script/handlers/javascript:/foreignObject; links valid `DOWNLOAD_LINK_SECONDS`, re-checked per use.

## Palette (hex the build uses)

ground `#F3EDE1`, paper `#FAF6EE`, ink `#1A1D26`, cobalt `#1E44C2` (deep `#16338F`), seam `#E0522B`,
seam tint `#F8DDD2`, stone `#8C7F6E`, stone-deep `#5B5044`, hairline `#D8CEBD`, success ink `#245C3A`
(brief: Visual design roles; hex decided — DESIGN.md Palette with AA ratios).

## Type, space, layout

Bricolage Grotesque 500/700 headings, IBM Plex Sans 400/500/600 body 17px/1.6, IBM Plex Mono tabular for
amounts, dates and the clock (brief: Type). Scale ×1.333 per level; hero clamp(56px, 10.5vw, 119px) ≈ 7×
body at 1280 (brief). 12 columns, 24px gutter, margin clamp(20px, 5vw, 72px), measure 72ch; each home
section ≥ 100vh (brief: Density). Per viewport (brief: Screens and layout): 375 — Menu drawer, deck 1
column, plans 1 column, sheet stacked due-now above, checkout one column, portal nav wrapping row; 768 —
Menu drawer, deck 2, plans 2 with Care second row left, sheet side by side, checkout summary left; 1280 —
inline nav, deck 3, plans 3. Breakpoints only at 600 and 1024.

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| hover lift / press | pointer | 200 ms | cubic-bezier(0.34,1.56,0.64,1) | colour only |
| quote fold flat | pick sent | 200 ms | settle (cubic out) | table swaps in place |
| crease slide + tilt 0→18° | answer | 333 ms | settle | `data-crease` jumps, tilt 0 |
| numeral count | after crease | 667 ms | settle | none |
| case-study lift | card activated / back | 667 ms | settle | at once |
| camera catch-up | scroll | 320 ms | settle | one fixed station per section |
| monolith turn | hero pinned | 36 s/turn | linear | none (`data-scene-turn` constant) |
| dialogs, drawer | open/close | 200 ms | cubic-bezier(0.16,1,0.3,1) | at once |

All graded motion is requestAnimationFrame-driven (decided: runs identically under a stepped page clock).

## States per async action

Exactly the brief's Feedback states table (copy in `src/shared/copy.ts`). Decided where silent: invoices
page outage `Billing is unreachable, so we can't show your invoices right now.`; invite used/expired page
shows the API message; studio actions report in `Studio status`.

## Media and licences

All pictures drawn in code for this app (`original`); Lucide icons (ISC); three fonts OFL-1.1, latin WOFF2 files from
Fontsource 5.3.0 vendored in `app/src/client/fonts/` and self-hosted; listed in `app/assets.json` and `app/THIRD_PARTY_NOTICES.md`.
