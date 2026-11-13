# TRUTH — Quillmoor Reserve (golden)

The brief made concrete. Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>`.
Visual tokens are in `DESIGN.md`; this file restates the ones the build uses.

## Journeys (ideal end-to-end flows)

1. **Fund and reconcile** (brief: Journeys 1). Ines (`stw-ines`) on `/steward` adds a borrower (Member name, Member email,
   Member role `Borrower`, Add member → `Member added: <name>.`). The borrower's `/borrow` Wallet reads `0,00000000` for
   MBTC. Ines picks that member in `Member`, `Transfer asset` MBTC, types `1 234,5` (U+202F grouping) in `Transfer amount`,
   Record transfer → `Transfer recorded: 1 234,50000000 MBTC to <name>.`; the borrower's open Wallet shows it within the
   5 s refresh. On `/ledger` Ines chooses `Ledger asset` MBTC, `Postings shown` 20 and types `2026-11-01 01:30` in
   `Posted from` + Enter → URL `/ledger?asset=MBTC&limit=20&from=2026-11-01T04:00:00Z`; Back and Forward restore controls
   and table without a page load. The postings table lists `custody` and `wallet:<id>` legs and every row of `Ledger
   totals` nets to `0,…`. Provider: Postgres posting `transfer_in` (custody −x, wallet +x).
2. **Supply, fee and withdraw** (brief: Journeys 2). Rosa (`lp-rosa`) on `/supply` picks Pool QUSD, types an amount,
   Supply → `Supplying` then `Supplied <amount> QUSD for <shares> shares.` Petra (`tr-petra`) on `/trade` types an
   amount, the preview follows the latest keystroke, Get firm quote, Swap now. Rosa's QUSD `Share price` rises in place
   at the next 5 s refresh while her half-typed Withdraw amount and its field error survive. Withdraw → `Withdrew
   <amount> QUSD.` + `View receipt`; pressing Withdraw again with the same input resends the same Idempotency-Key and
   shows the original receipt (`Idempotency-Replayed: true`). Receipt: `Settled` (statement JSON and PDF both in MinIO).
3. **Borrow, retry, repay all** (brief: Journeys 3). Keyboard only on `/borrow`: collateral, Enter opens the position; the
   new `Position <id>` link is the next Tab stop. On the position page Draw with a lost reply shows
   `Couldn’t reach Quillmoor. Press the same button again to retry safely.` and `Retry` directly after Draw; Retry resends
   body and key → original receipt, one `draw` posting. `Repay all` → `Repaid <amount> <ASSET>. No debt remains.` and
   `Healthy`.
4. **Margin, grace and a race** (brief: Journeys 4). A steward price post below health factor 1,1000 queues one margin
   email (`Margin notice: <pid> at health factor 1,0xxx`) and the page moves to `Margin warning`; below 1 it reads
   `Liquidatable in grace` with `Grace ends HH:MM:SS NDT`, then `Liquidatable now` at the server's grace end with no
   request. Two liquidators confirm at once: one `201` Settled receipt, the other `409 already_liquidated` live in
   Problems, one liquidation notice, one fill event in Svix.
5. **Oracle, stale feed and recovery** (brief: Journeys 5). A new WireMock round moves the price live in every rail
   (`Oracle round <n>`); unreachable / malformed / older-round each show their own line while the last good price holds;
   after `STALENESS_SECONDS` the `Price feed` alert appears everywhere and a draw is refused `423` with the banner copy;
   a fresh round clears the banner at the next refresh, the draw succeeds, positions below 1 read `Liquidatable in grace`
   first (recovery grace).
6. **Stress test and post** (brief: Journeys 6). Steward `Asset` MBTC, slider Shift+Left ×3 → `−15,0% · $54 400,00000000`,
   `Positions at risk 2`, `Collateral exposed 2,00000000 MBTC`; 400 ms later `Shock reading` says `2 positions at risk at
   −15,0% shock.`. `Post this price` fills New price with `54 400,00000000` and focuses Post price; the post announces
   `Price posted. <n> positions now below health factor 1.` and both rulers recentre at `0,0%`; the crossed positions
   appear in the liquidator's queue.
7. **Liquidate and settle** (brief: Journeys 7). Kestrel moves through the queue grid with arrow keys, Enter on `Liquidate
   <pid>` opens the dialog (focus in Repay amount, prefilled with max repay), Repay options → `Use half of max repay`,
   Confirm liquidation → receipt `Pending statement` then `Settled` without reload; `Webhook delivered.`; the PDF
   downloads with `Desk time … NST` and `UTC …`; the borrower page shows `Partially liquidated` and `Liquidation notice
   sent.`.
8. **Outages** (brief: Journeys 8). Gotenberg down: a draw commits, says the funds moved, reads `Pending statement` until
   another process renders the PDF once. Mail down: liquidation settles, notice reads `Liquidation notice queued, not yet
   sent.`. Storage down: liquidation refused 503 `The statement store is unreachable. Nothing was changed. Try again
   shortly.`, nothing posts, no notice, no event, position stays liquidatable.

## Server decisions where the brief is silent

| Value | Source |
|---|---|
| Every API request runs in one Postgres transaction holding a transaction-scoped advisory lock (the "ledger lock"); it first brings interest forward and re-evaluates every open position | decided: the brief requires every rule (contests, one winner, key replays) to hold across processes sharing one database |
| Account balances are kept in `account_balances`, updated in the same statement batch as the legs | decided: a balance is the sum of its legs; pool figures are still computed from balances at every read, never stored |
| Position debt = `ceil(principal × index ÷ reference index)`; `principal` and `reference_index` reset only at a draw, repayment or fill; each accrual posts the difference to the posted debt | brief: Interest (Position debt) |
| Accrual and swap fees split with one function (`reserveShare`, largest remainder, tie to supply) | brief: Fee and interest split |
| Seed price posts have `evidence_key: null` and write no object; the seed emits no events and queues no notices | brief: Services (Seed evidence), Seed data |
| Unauthenticated, forbidden and every other error use one problem-details builder; non-object JSON bodies answer 400 `invalid_json` | brief: Server boundary, Error body; decided for non-objects (earliest rung that fits) |
| Unknown non-API paths without a file extension serve the app shell; a last path segment containing `.` that is not in the build answers the 404 problem body | brief: Server boundary (What is never served) |
| Keyed endpoints store the first response below 500 (refusals included); 5xx are never stored | brief: Retries with an Idempotency-Key |
| `ETag` of a risk read is `"<ASSET>-<risk_version>"` (strong), bumped on every save; `If-Match` accepts a list or `*`, weak tags never match | brief: Manual price posts and risk parameters (RFC 9110) |
| The outbox is drained by one process at a time (transaction-scoped advisory lock), oldest first, one transaction per event | decided: delivery order per position without per-position coordination |
| Statement PDF is rendered from the stored text statement lines; bundled Space Grotesk and IBM Plex Mono are embedded in the HTML | brief: Settlement statements ("set in the ledger-sheet type") |
| Background jobs run every 2 s per process (evaluation, notices, webhooks, PDF renders) and every `ORACLE_POLL_SECONDS` (oracle) | brief: Background jobs (attempted within 10 s) |
| `GET /api/ledger/postings` limit outside 1..200 is clamped | decided: the brief publishes no field message for limit |
| Amount and price strings longer than 40 characters are refused with the published field message | decided: bounds bigint work |
| Install is `npm ci --include=dev` | decided: the build needs TypeScript and Vite whatever `NODE_ENV` says |

## Browser decisions

| Value | Source |
|---|---|
| Live data: pools, wallet and rail every 5 s and after every action; position page, queue, ledger, Borrow list and pending receipts every 5 s; ruler positions on load, asset change, after a post, every 5 s while not dragging | brief: Live data refresh |
| Busy buttons use `aria-disabled` so focus stays on the pressed control | brief: Interactions (focus stays on the button) |
| Draw takes a new key on every press; Swap now, Withdraw and Confirm liquidation resend the same key while their inputs are unchanged | brief: Interactions (Draw and Retry) |
| Browser-side field errors show on every input; a refused submission focuses the first field in error | brief: Interactions (Amount fields) |
| Shock handle tween: 120 ms ease-out cubic on animation frames; reduced motion jumps | brief: Motion (0.1–0.15 s); decided: frame-driven so it follows the page clock |
| Tick fills: 200 ms ink ↔ brick red; reduced motion instant plus a diagonal hatch on crossed ticks | brief: Motion |
| Settled shock announcement 400 ms after the last movement, not on first load | brief: Feedback states |
| Every ruler recentres at 0% when the posted price or its round changes | brief: Post this price |
| Liquidation conflict (status < 500) closes the dialog at once, Problems shows the copy, focus returns to the row's button; 503 and network failures keep it open so Confirm again retries with the same key | brief: Interactions |
| The queue grid navigates data cells only; the Action cell's focus target is the row's Liquidate button | brief: Liquidation queue grid |
| Shock ruler asset (Liquidations and Steward) defaults to the first listed asset with open positions | decided: the brief says "the chosen asset" without a default |
| Wide tables stack into label-value records by worksheet width (container queries): queue below 980 px, ledger and legs below 640 px | brief: Screens (375 stacking, no sideways scroll) |
| Mixed-asset columns pad the fraction to the widest decimals present so commas align | brief: Figures |
| Wall times come from the API instant formatted in `desk_time_zone` with `Intl` (`en-CA` for `NST`/`NDT`) | brief: Desk formats (Wall times) |

## Palette (hex as built)

paper `#F4EEDC`, sheet `#FAF6EA`, ink `#1A2130`, ink-muted `#4B5262`, rule `#C9BD98`, rule-strong `#9C8F68`,
signal (brick red) `#A3301C`, accrual (bottle green) `#1E5638`, caution `#6F520C`. Source: brief Visual design
(roles); decided hexes (DESIGN.md, contrast computed: ink 13.9:1, signal 6.0:1, accrual 7.4:1 on paper).

## Type, space, layout

Space Grotesk 500/600 headings (h1 27.34, h2 21.88, h3 17.5 px), IBM Plex Sans 400/500/600 body 14 px, IBM Plex
Mono 400/500 tabular figures (12.5 px in wide tables). 4 px unit, 32 px ruled rows, 44 px controls (brief: Touch).
1280: pools 20% | worksheet | rail 20%. 768: rail band on top, pools 33% | worksheet. 375: rail, worksheet, pools.

## Motion table

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| link/button underline | hover | 100 ms | cubic-bezier(0.2,0,0,1) | instant |
| button | press | 100 ms translateY(1px) | same | instant |
| Liquidate position dialog | open/close | 180 ms opacity + 8 px rise | same | appears without moving |
| Repay options menu | open | none | — | none |
| shock handle | each step | 120 ms | ease-out cubic | no transition |
| ruler ticks | crossed / uncrossed | 200 ms ink ↔ red | ease-out cubic | instant + hatch |

## States per async action

Pending and success copy exactly as brief Feedback states; conflicts/outages/network in Problems verbatim (the API's
`detail`); 422 under each field (aria-describedby) plus `Check the highlighted fields.` with links that focus the field.
Receipts: `Settled` / `Pending statement` + the explanation line; `Webhook delivered.` / `Webhook queued, not yet
delivered.`; notices `… sent.` / `… queued, not yet sent.`.

## Media and licences

No images. Fonts: Space Grotesk, IBM Plex Sans, IBM Plex Mono (Fontsource 5.3.0 woff2, OFL-1.1), listed in
`app/assets.json` and `app/THIRD_PARTY_NOTICES.md` with the full OFL text.

## Disputes (bundle test defects)

`test_oracle_faults_and_recovery[wrong_feed]` and `[old_round]` timed out at "baseline oracle reading" in the verifier's
full run (92/94). The test's `oracle_now` already waits for the server clock to pass the last applied round, so the round
collision recorded in earlier iterations is not the cause. Locally all eight cases pass alone, in four repeated runs of
the oracle tests (also under CPU load) and in a full 100-test run, and the app log of the failing run holds no oracle
error. One real race was removed (an applied reading now reads the clock under the ledger lock), but the verifier's
failure was not reproduced, so its cause is unproven. DP-32.

Otherwise none. The tests locate controls with exact accessible names, so the brief's substring pairs do not collide.
Only the tests that need the verifier image's `/app`, `/srv/app` and `/opt/axe` paths cannot run on this machine; they
were checked by hand (`selftest/outage_db.py`, notices and licence comparison, cold start in the Node 22.14 image).
