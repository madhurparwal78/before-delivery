# Quillmoor Reserve

Quillmoor Reserve is a permissioned money market run by a small protocol operations team. Each listed asset has one single-sided liquidity pool, and that pool funds three things: swaps priced from the posted price, variable-rate lending, and collateralised borrowing with liquidations. Every movement settles on one internal double-entry ledger. Prices come from an external price oracle that the server polls. A risk steward can override the oracle with a manual post and sets each asset's risk parameters. Liquidity providers, borrowers, traders and liquidators all work against the same books. The server alone decides interest, health factors, grace periods, staleness and quote expiry.

Build it as one web app backed by six services:

- **Postgres** is the system of record: the ledger, pools, positions, prices, sessions, retry keys, the notice queue, the event outbox and the PDF render queue. It also settles every contest for a position or a pool's last liquidity, across server processes.
- **MinIO** stores settlement statements, statement PDFs and price evidence.
- **Mailpit** receives margin and liquidation notices.
- **WireMock** serves the invented third-party price oracle published in this brief.
- **Svix** delivers integrator webhooks.
- **Gotenberg** renders statement PDFs.

Out of scope: passwords and sign-in (members are chosen by identity, as set out in Business rules), any datastore beyond Postgres and MinIO, real blockchains or wallets, moving funds off the market, registering webhook endpoints (integrators are registered in Svix by the operations team), and any asset beyond the three seeded ones.

## Problem and users

Small teams run lending desks and money markets: treasury desks at crypto-native firms, fintechs with an internal credit book, and protocol teams testing parameters before a mainnet launch. They keep their state in spreadsheets, in on-chain forks they can't reason about, or in exchange back offices. None of these keeps a closed double-entry ledger that ties every swap fee, interest accrual and liquidation bonus back to the balances of liquidity providers and borrowers.

Real incidents show what that costs. In March 2026 a misconfigured price-cap update at a major lender triggered about $26M of wrongful liquidations, and its operators had to reimburse users by hand. After a market pause, borrowers who could not repay in time were liquidated the moment the pause lifted, which is why lenders now grant a grace period when a market reopens. Operations staff also spend days on four recurring problems:

- reconciling rounding drift between pool totals and per-account balances
- settling disputes over which of two keepers won a liquidation sent at the same moment
- working out whether a retried borrow moved funds twice
- working out whether a notice or an integrator event went out twice

Quillmoor Reserve runs the whole market on one ledger. Every unit is an exact integer in the asset's own decimals. A settlement is shown as final only once its statement and its PDF are both confirmed in storage. Its notice is queued and its integrator event sits on the outbox in the same commit as the money.

Users:

- **Liquidity provider.** Supplies an asset to its single-sided pool and watches the share value grow from swap fees and borrow interest. Withdraws without taking the pool below the liquidity it holds. Weekly.
- **Borrower.** Posts collateral in one asset and borrows another against it. Keeps the health factor above 1, and repays before a margin notice turns into a liquidation. Daily.
- **Trader.** Swaps one asset for another at the posted price less the published pool fee, with a firm quote that expires on the server's clock. Daily.
- **Liquidator.** Finds positions the server has marked liquidatable and repays part of their debt, up to the close factor. Receives collateral plus the liquidation bonus exactly once, along with an integrator event to their own systems and a PDF statement for their books. Daily.
- **Risk steward.** Watches the oracle feed and overrides it with manual posts when needed. Sets loan-to-value, liquidation threshold, bonus and reserve factor per asset. Stress-tests positions with a price shock, onboards members, records inbound transfers, reconciles the ledger and handles markets whose feed goes stale. Daily.

## Journeys

1. **Fund and reconcile.** Start: Ines Varga (risk steward) is on the Steward view, and a newly onboarded borrower has their own browser open on the Borrow view. Ines records an inbound transfer typed in desk format. The borrower's wallet shows it without a reload. Ines opens the Ledger view, filters it to the asset, a posting count and a desk-time window, then moves back and forward through the filter history. End: the URL holds the filter, the transfer's two legs are listed, and every asset nets to zero.
2. **Supply, fee and withdraw.** Start: Rosa Aldana (liquidity provider) has the Supply view open, and Petra Novak (trader) has the Trade view open in another browser. Rosa supplies QUSD. Petra types an amount in desk format, watches the preview follow her latest keystroke, takes a firm quote and swaps QUSD for MBTC. On Rosa's screen the QUSD share price rises in place while her half-typed withdrawal and its field error survive the refresh. Rosa withdraws, and a retry with the same key returns the original receipt. End: Rosa's receipt reads Settled and Petra's receipt digits equal her quote.
3. **Borrow, retry, repay all.** Start: a borrower with MBTC in their wallet uses only the keyboard on the Borrow view, and the steward watches the Ledger view. The borrower opens a position and draws QUSD. The reply is lost, so they press Retry and get the original loan receipt. Later they press Repay all. End: one draw posting on the steward's ledger, no debt left on the position, and Healthy shown.
4. **Margin, grace and a race.** Start: a borrower's position page is open with the device clock set hours away, and two liquidators have the Liquidations view open in two browsers. A steward price post drops the position below the warning level, and the borrower's page moves to Margin warning live as the margin email arrives. A further post drops it below health factor 1, so the page reads Liquidatable in grace. When the grace ends on the server clock, the page reads Liquidatable now with no request from anyone. Both liquidators confirm at once. End: one Settled receipt, the already-liquidated copy live on the other screen, one liquidation notice, and one fill event in Svix.
5. **Oracle, stale feed and recovery.** Start: the oracle feeds MBTC, and the steward, a borrower and a trader each have a view open. A new round moves the price live in every price rail. The oracle then fails, sends a malformed body and sends an older round. Each failure shows its own copy while the last good price holds. The price ages past the staleness limit, the stale banner appears everywhere, and a draw is refused. The oracle returns with a fresh round. End: the banner clears within one refresh, the draw succeeds, and positions below health factor 1 read Liquidatable in grace before they become liquidatable again.
6. **Stress test and post.** Start: Ines has MBTC chosen on the Steward view, and a liquidator has the read-only shock ruler open. Ines drags the shock down, and ticks turn red as the handle crosses them. Both counters change at every step, and after a short pause the settled count is announced. She presses Post this price and posts the prefilled price. End: both rulers recentre, the post is announced with its count, and the crossed positions appear in the liquidator's queue.
7. **Liquidate and settle.** Start: Kestrel Keepers (liquidator) is on the Liquidations view, and the borrower's position page is open. Kestrel moves through the queue grid by keyboard, opens the Liquidate position dialog, picks a repay from the Repay options menu and confirms. End: the receipt moves from Pending statement to Settled without a reload, the PDF statement downloads with desk and UTC times, the borrower's page shows the fill, and the receipt reads Webhook delivered.
8. **Outages.** Start: the PDF renderer, mail and object storage are each down on their own instance. A draw while the PDF renderer is down commits, says the funds moved and reads Pending statement until another process renders the PDF once. A liquidation while mail is down settles, with its notice shown as queued, not yet sent. A liquidation while storage is down is refused with nothing moved. End: every receipt tells the truth about what moved.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Member sessions and roles** Choosing a member opens a bearer-token session for them, every request except the health check, the member list and session creation carries that token, and the server refuses missing or unknown tokens and actions outside the member's role as qualified in Business rules.
- **DP-02 — Onboarding and inbound transfers** The risk steward adds a member with a name, an email and one role, and records an inbound transfer typed in desk format that reaches the member's wallet as one balanced posting of the exact minor units.
- **DP-03 — Balanced journals** Every posting sums to zero per asset it touches, postings are never edited, and the trial balance on the Ledger view nets to zero in every asset after any sequence of actions.
- **DP-04 — Ledger view state in the URL** The Ledger view's asset, count and desk-time window filters live in the URL as set out in Interactions, so Back, Forward and reload restore them and an unknown value falls back to its default without adding a history entry.
- **DP-05 — Steward funding journey** The risk steward onboards a borrower, records a transfer typed in desk format while the borrower's open wallet shows it without a reload, filters the Ledger view to that asset and a desk-time window across the daylight-saving change, and sees the transfer's legs and a zero net, with a request that breaks two rungs of the error ladder answered at the higher rung.
- **DP-06 — Pool shares and withdrawals** A liquidity provider supplies an asset for shares and withdraws up to their share value and the pool's available liquidity, with mint and burn rounded in the pool's favour and each withdrawal settled with a statement.
- **DP-07 — Pool figures read from the ledger** Every pool's available liquidity, total borrowed, utilization and share price equal the values computed from ledger balances at the moment of reading, after every swap, supply, withdrawal, draw, repay, accrual and liquidation.
- **DP-08 — Last-liquidity contest** When concurrent withdrawals, draws or swaps together ask for more than a pool's available liquidity, even through different server processes, they are served one at a time and the one that no longer fits gets the insufficient-liquidity conflict with nothing moved.
- **DP-09 — Supply form survives refresh** On the Supply view, typed amounts, the chosen pool, browser-side field errors, focus and the last announcement survive every 5-second refresh while the pool cards update in place.
- **DP-10 — Liquidity provider journey** A liquidity provider supplies to a pool, watches the pool card's share price rise without a reload after a trader's swap in another browser that pays with that pool's asset, keeps a half-typed withdrawal through refreshes, withdraws, retries the withdrawal with the same key to get the original receipt, and opens a receipt that reads Settled.
- **DP-11 — Live swap preview** As a trader types an amount or changes either asset, the swap preview shows the server's fee and output for the latest input only, in place with no submit, even when an earlier reply arrives later or carries an error.
- **DP-12 — Firm quotes and fee split** A firm quote computes the pool fee and output in integer minor units at the posted prices, rounded in the pool's favour, splits the fee between liquidity providers and the reserve by largest remainder, and fixes its expiry on the server clock.
- **DP-13 — Swap execution, expiry and single use** Executing a live quote posts balanced legs whose digits equal the quote and the receipt, while a quote executed at or after its expiry, already used or touching a stale market is refused with its published copy.
- **DP-14 — Trader journey** A trader types an amount in desk format, watches the preview follow the latest keystroke, takes a firm quote, swaps, and sees a receipt and wallet whose digits match the quote while a liquidity provider's open Supply view shows the fee in the share price of the pool of the asset the trader pays with, and an expired quote is refused with the expiry copy.
- **DP-15 — Positions and draws within loan-to-value** A borrower opens a position by locking collateral against a different asset and draws within the loan-to-value limit and the pool's available liquidity, each draw settled with a statement.
- **DP-16 — Idempotent money movements** Withdrawals, swaps, draws and liquidations follow Idempotency-Key semantics, so a replay returns the stored response marked as a replay and moves nothing, and the same key with a different body is refused.
- **DP-17 — Per-second interest accrual** Debt grows per second of server time from a cumulative borrow index on the asset's kinked utilization curve, rounded toward the pool, and every accrual posts balanced legs split between liquidity providers and the reserve.
- **DP-18 — Repayment and collateral changes** A borrower repays an amount or the whole debt accrued to the second of the request, adds collateral at any time and withdraws it only within loan-to-value, and the reply carries the new debt, health factor and state.
- **DP-19 — Keyboard-complete borrowing** A borrower opens a position, draws, retries after a lost reply and repays with the keyboard alone, with Enter submitting each amount field's own action and Retry directly after Draw in the Tab order.
- **DP-20 — Borrower journey** A borrower opens a position and draws with amounts typed in desk format, loses the reply, presses Retry and sees one draw in the wallet and on the receipt, then presses Repay all and sees no debt remain while the steward's open Ledger view lists one draw posting and the accrual postings.
- **DP-21 — Position state machine** Each position moves between healthy, warned, liquidatable in grace, liquidatable, partially liquidated and closed only along the edges in Business rules, and the server alone decides each move.
- **DP-22 — Health factor and liquidation price** The server computes each position's health factor and liquidation price with the published formulas, precision and rounding.
- **DP-23 — Background evaluation and margin notices** The server evaluates every open position in the background with no request touching it, so grace expiry and price- or interest-driven drops change state on time, and each drop from healthy to below the warning level sends exactly one margin notice email.
- **DP-24 — Server-decided position status** The position page shows debt, health factor, state and grace end exactly as the server last returned them, refreshed on the published schedule, whatever the device clock says.
- **DP-25 — Borrower margin journey** A borrower's open position page moves to Margin warning without a reload after the steward's price post in another browser, the margin email arrives once, the page moves to Liquidatable in grace and then Liquidatable now on the server clock with the device clock set hours away, and a repay brings it back to Healthy.
- **DP-26 — Manual price posts** The risk steward posts a price typed in desk format, a move of more than 60% needs explicit confirmation, every post re-evaluates every open position, and the reply counts the positions below health factor 1.
- **DP-27 — Price evidence as submitted** Every price post stores an evidence object before it counts, holding a manual post's submitted fields exactly as sent or an oracle reading's raw response body byte for byte, and a post whose evidence cannot be stored records nothing.
- **DP-28 — Risk parameters under conditional requests** The risk steward sets loan-to-value, liquidation threshold, liquidation bonus and reserve factor per asset within the published bounds under RFC 9110 conditional requests, and every open position is re-evaluated at once.
- **DP-29 — Announced price and repay results** A price post announces its count of positions below health factor 1 and a repay announces the new health factor in the Announcements live region, without moving focus.
- **DP-30 — Steward price journey** The risk steward types a price in desk format, confirms a large move after the field error asks for it, hears the published count, sees those positions appear in a liquidator's open queue without a reload, and saves risk parameters that a second steward's stale save then cannot overwrite.
- **DP-31 — Oracle readings** The server polls the published oracle for every asset, converts each mantissa and exponent to price units with integer arithmetic, and applies a reading exactly once and only when it is strictly newer by round and by publication time than the current price, so a manual post holds until a later publication.
- **DP-32 — Oracle faults and recovery** An oracle that is unreachable, slow, malformed, behind on rounds or moving more than 60% never replaces the last good price, each case reports its own status and copy, and a fresh reading applies on the next poll without a restart, even when the oracle was down at boot.
- **DP-33 — Oracle feed journey** The risk steward and a borrower watch an oracle round move the price live in the price rail, see an outage, a malformed body and an older round each leave the last good price with their own copy, post a manual override that a late older publication cannot replace, and see the next later publication take over.
- **DP-34 — Stale feed pause and banner** When an asset's current price was published longer ago than the staleness limit, its market is stale, draws, collateral withdrawals, liquidations and swaps touching it are refused, and every view shows the stale-feed banner until a fresh post, as qualified in Business rules.
- **DP-35 — Recovery grace after a stale feed** A post that reopens a stale market puts every position on that asset still below health factor 1 back into a recovery grace, during which liquidation is refused, before it becomes liquidatable again.
- **DP-36 — Feed recovery journey** With the oracle failing, the price ages past the limit and the stale banner appears live for borrower, trader and liquidator, a draw is refused with the banner copy, the oracle returns with a fresh round, the banner clears within one refresh, and a position below health factor 1 reads Liquidatable in grace before it becomes liquidatable.
- **DP-37 — Liquidation fills and write-off** A liquidator repays up to the close factor of a liquidatable position's debt and receives collateral worth the repayment plus the bonus at posted prices, rounded in the pool's favour, and a fill limited by the remaining collateral seizes all of it, writes off the rest and closes the position.
- **DP-38 — Liquidation queue grid** The liquidation queue is a WAI-ARIA grid with a roving tab stop listing every position below health factor 1 with its state and maximum repay, its Liquidate position dialog holds a menu button whose menu Escape closes before the dialog, and it shows the published empty copy when there are none.
- **DP-39 — All-or-nothing liquidation settlement** A liquidation commits its ledger legs, statement objects, queued borrower notice and outbox event together or none of them, so a failed attempt leaves the position untouched, still liquidatable and with no event sent.
- **DP-40 — Settlement finality from storage** A settlement receipt reads Settled only when the server confirms at the time of asking that both its statement JSON and its PDF are in storage, and reads Pending statement otherwise.
- **DP-41 — Settlement statements in desk time** Each settlement's text statement and PDF carry the published lines in order, with amounts in desk format and the settlement instant both in the desk time zone with its abbreviation and in UTC.
- **DP-42 — Liquidator journey** A liquidator moves through the queue grid by keyboard, opens a position, picks a repay from the menu, confirms, and lands on a receipt that moves from Pending statement to Settled without a reload while the borrower's open position page shows the fill and the liquidation notice arrives once, and a liquidation tried while the statement store is down leaves the position liquidatable.
- **DP-43 — One winner per liquidation round** Of two or more liquidations submitted at once for the same round of a position, even through different server processes, exactly one fills and every other gets the already-liquidated conflict with no ledger movement, statement or event.
- **DP-44 — Losing liquidator feedback** A liquidator whose submission lost the round sees the already-liquidated copy in the Problems alert, focus returns to the row, and the queue row refreshes to the new round.
- **DP-45 — Liquidation race journey** Two liquidators in two browsers open the same liquidatable position and confirm at once, one lands on a Settled receipt and the other sees the conflict copy live, the winner's retry with the same key returns the original fill, and the borrower receives exactly one liquidation notice and one fill event.
- **DP-46 — Shock ruler ticks and counters** The shock ruler draws one tick per open position collateralised in the chosen asset at its server liquidation price, and its positions-at-risk and collateral-exposed counters update in place on every step.
- **DP-47 — Shock ruler keyboard control and reading** The shock ruler is a slider that moves in half-percent steps with the arrow keys, five-percent steps with Shift and to either end with Home and End while focus stays on it, and after the published pause the Shock reading live region announces the at-risk count.
- **DP-48 — Shock handle motion and reduced motion** The visible shock handle and the tick fills move with the short transitions in Motion and effects, and under reduced motion they change with no transition.
- **DP-49 — Shock ruler tick rendering** Ticks the shock crosses turn from ink to signal red, and under reduced motion each crossed tick also carries a hatch, so at-risk status never rests on colour alone.
- **DP-50 — Post this price journey** The risk steward drags the shock ruler to a level while a liquidator's read-only ruler shows the same ticks, presses Post this price, posts the prefilled price, and sees both rulers recentre and the crossed positions in the queue, with the whole run repeated by keyboard under reduced motion.
- **DP-51 — Integrator events from committed changes** Every settlement and every position state change, including the ones the clock causes, reaches Svix as one message after its transaction commits, with the message id equal to the ledger event id and nothing sent for a rolled-back change.
- **DP-52 — Integrator event format and order** Integrator events carry the published payload with minor-unit string amounts and UTC instants without fractional seconds, and reach Svix in sequence order per position.
- **DP-53 — Integrator webhook journey** A borrower's draw, a price drop, a grace expiry with no request touching the position, and a liquidator's fill each appear in Svix once and in order with the receipt reading Webhook delivered, while a fill refused during a storage outage adds no message.
- **DP-54 — Statement store outage** While object storage is unreachable, draws, liquidity withdrawals, liquidations and manual price posts are refused with the storage outage copy and nothing moves, while every other action keeps working.
- **DP-55 — Mail, PDF renderer, webhook and database outages** Each of mail, the PDF renderer, Svix and the database fails in its own published way that says whether money moved, queued effects are delivered once the service returns, and the server recovers from dropped database connections without a restart.
- **DP-56 — Background jobs exactly once** Notice delivery, PDF rendering, webhook delivery, oracle rounds and background evaluation each run exactly once per item across every server process sharing the database.
- **DP-57 — Outage recovery journey** A borrower draws while the PDF renderer is down and sees Pending statement with funds moved, another process renders the PDF once and the receipt turns Settled without a reload, and a liquidation during a mail outage shows its notice as queued, not yet sent, while the liquidator's receipt is unaffected.
- **DP-58 — Run manifest and health check** The app installs, builds and serves from `/app/run.json` on the published port and answers the health check as set out in Deployment.
- **DP-59 — Configuration and boot** Every service URL and credential is read from the environment at start with no literal fallback, never sent to the browser, and the server refuses to start when a required variable is missing.
- **DP-60 — API boundary and problem details** The API serves one origin, enforces body limits, strict JSON types and unknown-key rejection, and answers every error as RFC 9457 problem details under the published precedence.
- **DP-61 — Desk formats** The interface types and shows amounts, prices, percentages, health factors, durations and wall-clock times in the published desk formats while the API speaks only its own published formats.
- **DP-62 — Responsive ledger-sheet layout** The three-zone ledger-sheet layout rearranges for 375 by 812, 768 by 1024 and 1280 by 800 viewports, with nothing scrolling sideways.
- **DP-63 — Keyboard, focus and touch targets** Every control is reachable in the published Tab order with a visible focus mark that is never hidden, dialogs trap and return focus, a refused submission moves focus to the first field in error, and touch targets meet the size in Visual design.
- **DP-64 — Ledger-sheet visual design** Every screen reads as a ruled ledger sheet: figures in tabular monospace aligned on the decimal comma, hairline rules, and red reserved for liquidation states.
- **DP-65 — Single source for each domain rule** Each domain rule, conversion and error shape is decided in exactly one place in the server source, and the browser renders server values without recomputing them.

## Frontend

### Screens and layout (DP-04, DP-09, DP-24, DP-34, DP-38, DP-40, DP-46, DP-62)

The app is one page. Each view lives at its own path:

| Path | View | Who uses it |
|---|---|---|
| `/` | The acting member's role home: Steward, Supply, Trade, Borrow or Liquidations | everyone |
| `/trade` | Trade: swap preview, firm quote, swap receipt | trader |
| `/borrow` | Borrow: open a position, the member's positions | borrower |
| `/positions/<position_id>` | Position page: debt, collateral, health factor plumb line, state, notices, actions, read-only shock ruler | everyone (actions only for the owning borrower) |
| `/supply` | Supply: supply and withdraw per pool, the member's shares and their value | liquidity provider |
| `/liquidations` | Liquidations: the liquidation queue grid, the Liquidate position dialog, read-only shock ruler | liquidator, risk steward |
| `/steward` | Steward: price post form, risk parameter form, shock ruler with Post this price, member onboarding, inbound transfers | risk steward |
| `/ledger` | Ledger: trial balance per asset and the filtered postings | risk steward |
| `/settlements/<settlement_id>` | Settlement receipt: kind, amounts, legs, statement status, webhook status, PDF download | everyone |

An unknown path shows the heading `We couldn’t find that page.` with a link back to `/`. The query parameter `?actor=<actor_id>` on any path selects that member as the acting member, as set out in Interactions.

Every view is a ledger sheet with three zones:

- **Pool column.** One card per asset, on hairline rules. Each card shows the asset code and name, Available liquidity, Total borrowed, Utilization, Share price, Borrow rate and Supply rate.
- **Worksheet.** The ruled working area of the current view. The acting member's `Wallet` region sits at its top. Every amount sits in a right-aligned monospace column, aligned on the decimal comma.
- **Price rail.** For each asset: its posted price, its source, its age and the oracle status line. Below those sit the three published durations, and the stale-feed banner while any market is stale.

A top bar above the zones holds the brand name, the Acting as chooser and the section navigation. The navigation shows only the sections the acting member's role uses, from the table above.

Layout by viewport:

- **1280 by 800.** The three zones sit side by side. The pool column takes about a fifth of the width, the price rail about a fifth, and the worksheet the rest.
- **768 by 1024.** The price rail becomes a full-width band under the top bar. Below it the pool column and the worksheet sit side by side, with the pool column about a third of the width.
- **375 by 812.** One column: the top bar, the price rail band, the worksheet, then the stacked pool cards. The navigation wraps onto as many rows as it needs. Wide tables (queue, ledger, legs) become stacked label-value blocks, one record per block. The queue keeps its grid role and its keyboard model.

No viewport scrolls sideways. Long amounts, such as 18-decimal figures, shrink their type inside the stacked rows instead of overflowing. A number is never split across lines.

The position page shows a health factor plumb line: a horizontal line from health factor 0 to 2. The 1.00 mark is a heavy rule and the warning level is a thin rule. A marker sits at the position's health factor. It is pinned at the right end above 2 and absent when there is no debt. Below the line the page shows the debt and collateral, the state label, the grace end while in grace, the notice list and the owner's action forms.

The settlement receipt shows the kind, the amounts, a legs table (account, asset, amount), the statement key, the statement status, the webhook status and, once the statement is stored, the PDF download.

The shock ruler appears in three places, each for the chosen asset:

- **Steward view.** The handle drags and Post this price is shown.
- **Liquidations view and position page.** The ruler is read-only: the handle still drags so members can explore, but Post this price is absent.

### Public screens and controls (DP-01, DP-04, DP-09, DP-11, DP-19, DP-29, DP-38, DP-40, DP-44, DP-46, DP-47)

Only the controls and regions below are public. Everything else in the markup is free.

Every labelled value is a visible label and a separate value element. Accessible names carry the label alone. Counts, badges and values are never part of a control's or region's accessible name, unless a placeholder in the table puts them there. For example, the Liquidations link shows the queue size in a badge beside its text, and its accessible name stays `Liquidations`.

Copy for announcements, banners, empty states and errors is in Feedback states.

| Where | Role and accessible name | Visible copy or content |
|---|---|---|
| Top bar | `combobox "Acting as"` | each member as `<name> (<role label>)`; role labels `Risk steward`, `Liquidity provider`, `Borrower`, `Trader`, `Liquidator` |
| Top bar | `navigation "Sections"` with links `Steward`, `Ledger`, `Liquidations`, `Supply`, `Trade`, `Borrow` (role-filtered) | link text as named; Liquidations carries the queue-size badge |
| Every view | `status "Announcements"` (polite, always present) | success and pending copy |
| Every view | `alert "Problems"` (always present, empty when idle) | conflict, validation summary, outage copy |
| Worksheet | `region "Wallet"` | labelled values `QUSD`, `MBTC`, `METH` |
| Pool column | `article "<ASSET> pool"`, one per asset | labelled values `Available liquidity`, `Total borrowed`, `Utilization`, `Share price`, `Borrow rate`, `Supply rate` |
| Price rail | `complementary "Posted prices"` | holds the groups below and labelled values `Grace period`, `Quote lifetime`, `Staleness limit` |
| Price rail | `group "<ASSET> price"`, one per asset | `$<price>`; `Oracle round <n>` or `Manual post`; `Posted <n> seconds ago`; the oracle status line |
| Price rail | `alert "Price feed"` | the stale-feed banner, present only while any market is stale |
| Trade | `combobox "Pay with"`, `combobox "Receive"`, `textbox "Amount to pay"` | asset codes |
| Trade | `status "Swap preview"` | `Pool fee <fee> <FROM>` and `You receive <amount_out> <TO>` |
| Trade | `button "Get firm quote"`, `region "Firm quote"` | fee, output, both prices, `Firm until <wall time>` |
| Trade | `button "Swap now"`, `region "Swap receipt"` | amount in, fee, amount out, both prices, swap id |
| Borrow | `combobox "Collateral asset"`, `combobox "Borrow asset"`, `textbox "Collateral amount"`, `button "Open position"` | as named |
| Borrow | `list "My positions"` with links `Position <position_id>` | per position: state label and health factor, outside the link name |
| Position page | `heading "Position <position_id>"`, `status "Position state"` | the state label |
| Position page | `img "Health factor <hf>"` or `img "Health factor: no debt"` | the plumb line |
| Position page | labelled values `Debt`, `Collateral`, `Health factor`, `Liquidation price`, and `Grace ends` while in grace | `Grace ends` shows a wall time |
| Position page | `textbox "Draw amount"`, `button "Draw"`, `button "Retry"` (only after a lost reply) | as named |
| Position page | `textbox "Repay amount"`, `button "Repay"`, `button "Repay all"` | as named |
| Position page | `textbox "Collateral change"`, `button "Add collateral"`, `button "Withdraw collateral"` | as named |
| Position page | `list "Notices"` | one item per notice |
| Supply | `combobox "Pool"`, `textbox "Supply amount"`, `button "Supply"`, `textbox "Withdraw amount"`, `button "Withdraw"` | as named |
| Supply | labelled values `Your shares`, `Share value` | |
| Liquidations | `grid "Liquidation queue"` | columns Position, Borrower, Health factor, State, Debt, Collateral, Max repay, Round, Action; per row `button "Liquidate <position_id>"` in the Action cell |
| Liquidations | `dialog "Liquidate position"` (modal) | `textbox "Repay amount"` prefilled with the max repay, `button "Repay options"`, `button "Confirm liquidation"`, `button "Cancel"` |
| Liquidations | `menu "Repay options"` | `menuitem "Use max repay"`, `menuitem "Use half of max repay"` |
| Receipt | `heading "Settlement receipt"`, `table "Settlement legs"` | |
| Receipt | `status "Statement status"` | `Settled` or `Pending statement` with its line |
| Receipt | `status "Integrator webhook"` | the webhook copy |
| Receipt | `button "Download PDF statement"` | present only while the statement status is Settled |
| Steward | `combobox "Asset"` | chooses the asset for the price form, the risk form and the shock ruler |
| Steward | `textbox "New price"`, `checkbox "Confirm large move"`, `button "Post price"` | as named |
| Steward | `textbox "Loan-to-value (%)"`, `textbox "Liquidation threshold (%)"`, `textbox "Liquidation bonus (%)"`, `textbox "Reserve factor (%)"`, `button "Save risk parameters"` | percentages |
| Steward | `textbox "Member name"`, `textbox "Member email"`, `combobox "Member role"`, `button "Add member"` | as named |
| Steward | `combobox "Member"`, `combobox "Transfer asset"`, `textbox "Transfer amount"`, `button "Record transfer"` | as named |
| Shock ruler | `region "Shock ruler"` | labelled values `Positions at risk`, `Collateral exposed` (`<amount> <ASSET>`), `Shocked price` (`$<price>`) |
| Shock ruler | `slider "Price shock"` | -60 to 60 in steps of 0.5; value text `<shock>% · $<shocked price>` |
| Shock ruler | `img "Shock handle"` | the visible handle over the slider's current value |
| Shock ruler | `img "Liquidation prices of open positions"` | the tick canvas |
| Shock ruler | `list "Position ticks"` (visually hidden) | per drawn or counted position: `<position_id>: $<liquidation price>, at risk` or `<position_id>: $<liquidation price>, clear` |
| Shock ruler | `status "Shock reading"` (polite) | the settled shock announcement |
| Shock ruler, Steward only | `button "Post this price"` | as named |
| Ledger | `combobox "Ledger asset"` | `All assets`, `QUSD`, `MBTC`, `METH` |
| Ledger | `combobox "Postings shown"` | `20`, `50`, `200` |
| Ledger | `textbox "Posted from"`, `textbox "Posted before"` | desk wall times |
| Ledger | `table "Ledger totals"` | columns Asset, Debits, Credits, Net; always all three assets |
| Ledger | `table "Postings"` | columns Posting, Kind, Time, Account, Asset, Amount; one row per leg, grouped by posting |

`<shock>` is defined in Interactions under desk formats.

### Interactions (DP-04, DP-09, DP-11, DP-19, DP-38, DP-44, DP-46, DP-47, DP-50, DP-61, DP-63)

**Desk formats.** These are the interface's own language. Every figure on screen, in emails, in the text statement and in the PDF uses them, and every amount, price and percentage field accepts exactly what they show:

- **Amounts.**
  - *Display:* the integer part with its digits grouped in threes by a narrow no-break space (U+202F), always grouped, including four-digit integer parts. Then a comma, then exactly the asset's decimals. A negative amount starts with the minus sign U+2212. A positive signed amount (statement legs) starts with `+`. For example, `7 877,529600` QUSD, `0,00037038` MBTC, `−37 038,000000` QUSD.
  - *Input:* digits, with optional U+202F grouping placed exactly as the display places it, and an optional comma followed by 1 up to the asset's decimals. There is no sign, no point, and no leading zero except a single `0` before the comma.
- **Prices.**
  - *Display:* `$` followed by the price in the amount display form with exactly 8 decimals, for example `$56 000,00000000`.
  - *Input:* New price takes the same input form with up to 8 decimals, with or without `$`. The browser sends it to the API as digits, a point and exactly the decimals typed, with no padding and no grouping: typing `56 000,5` sends `"56000.5"`, and `52 000` sends `"52000"`.
- **Percentages** (rates, loan-to-value, threshold, bonus, reserve factor). Two decimals with a comma, then `%` with no space between, for example 1005 bps shows as `10,05%`. The risk textboxes show and accept the number without `%`, for example `80,00`, with up to two decimals.
- **Health factors.** Four decimals with a comma, for example `1,1250`. A position with no debt shows `No debt`.
- **Share prices.** Twelve decimals with a comma.
- **Shock.** `<shock>` is the shock in percent, with U+2212 for negatives, `+` for positives and none at zero, and one decimal: `−12,5`, `+5,0`, `0,0`.
- **Durations.** `m:ss`. Minutes may exceed 59, so 300 seconds shows `5:00` and 3600 seconds shows `60:00`.
- **Wall times.** Desk wall times are in the desk time zone (`desk_time_zone` from the API) as `HH:MM:SS <abbr>`. On the Ledger view and in statements they are `YYYY-MM-DD HH:MM:SS <abbr>`. `<abbr>` is the zone's abbreviation as the IANA tz database gives it for that instant: `NST` or `NDT` for the default zone, Newfoundland time, which is three and a half hours behind UTC in winter and two and a half in summer.
- **Desk-time input** (Posted from and Posted before). Type `YYYY-MM-DD HH:MM` as a desk wall time. A wall time inside a daylight-saving gap is refused. A wall time inside a fold resolves to the earlier of its two instants, which is the daylight-time reading. For example, in the default zone, `2026-11-01 01:30` means `2026-11-01T04:00:00Z`, and `2026-03-08 02:30` does not exist.

**Acting as.**

- Choosing a member opens a session for them through the API. The browser keeps the token in its own local storage for later visits, sends it on every request, reloads the data for that member without a full page reload, and moves to that role's home view.
- `?actor=<actor_id>` does the same on load, then removes the parameter from the URL with a history replace.
- The browser never uses cookies.

**Amount fields.**

- Browser-side checks run on every input and show their field error at once: the field is marked invalid, and the message sits under it as its description.
- Submitting with a browser-side error sends nothing and moves focus to the first field in error.
- Pressing Enter in an amount field presses that field's own button:
  - Collateral amount presses Open position.
  - Draw amount presses Draw.
  - Repay amount presses Repay.
  - Collateral change presses Add collateral.
  - Supply amount presses Supply.
  - Withdraw amount presses Withdraw.
  - Amount to pay presses Get firm quote.
  - Transfer amount presses Record transfer.
  - New price presses Post price.

**Comboboxes.** Each combobox opens with Alt+Arrow Down or Enter, moves through its options with the Arrow keys, and chooses with Enter.

**Swap preview.**

- Every input in Amount to pay, and every change of Pay with or Receive, asks the server for a preview of the exact typed amount. There is no submit button.
- The preview shows only the reply to the latest input. A reply to an earlier input, whether its figures or its error, is never shown, even if it arrives last.
- Changing the amount or either asset also clears the Firm quote region.

**Firm quote and swap.** Get firm quote creates a quote and fills the Firm quote region. Swap now executes that quote and fills the Swap receipt region.

**Draw and Retry.**

- Each new press of Draw creates a new Idempotency-Key for that draw.
- If the reply is lost to a network failure, the `Retry` button appears directly after Draw in the Tab order, and focus stays on Draw.
- Retry (by click, or Enter when focused) resends the same body with the same key.
- Swap now, Withdraw and Confirm liquidation reuse their key the same way, without a separate Retry button: pressing the same button again with unchanged inputs resends the same key.

**Open position.** After a successful open, the new `Position <position_id>` link in My positions is the next Tab stop after Open position. Focus stays on Open position.

**Repay and collateral actions.** The announcement appears and focus stays on the pressed button. The position figures update from the server's reply.

**Supply view refresh.** The pool cards, Your shares and Share value update in place on every refresh. The refresh never touches these:

- the typed values in Supply amount and Withdraw amount, and the chosen Pool
- a browser-side field error and its description
- keyboard focus and the caret position
- the last Announcements message and its `View receipt` link

**Liquidation queue grid.** It follows the WAI-ARIA grid pattern with a roving tab stop:

- Tab enters the grid once, at the cell that last had focus (at first, the first cell of the first row).
- Arrow keys move one cell at a time. Home and End move to the first and last cell of the row. Control+Home and Control+End move to the first and last cell of the grid.
- In the Action cell, focus sits on that row's Liquidate button, and Enter or Space opens the dialog.
- When the queue refreshes, focus stays on the same position's cell if it is still listed. Otherwise it moves to the first cell.

**Liquidate position dialog.** It follows the WAI-ARIA modal dialog pattern:

- It opens with focus in Repay amount, prefilled with the row's max repay. The submission carries the round shown in that row.
- Tab and Shift+Tab cycle within the dialog.
- `Repay options` is a menu button. Enter, Space or Arrow Down opens the menu with focus on its first item. Choosing an item fills Repay amount and returns focus to Repay options. `Use half of max repay` uses the max repay halved and rounded down to a whole minor unit.
- Escape closes one layer at a time. With the menu open, it closes the menu and focus returns to Repay options. With the menu closed, it closes the dialog and focus returns to the Liquidate button that opened it. Cancel also closes the dialog.
- On success the browser goes to that fill's settlement receipt.
- On a conflict the dialog closes, the copy appears in Problems, focus returns to the row's Liquidate button, and the queue refreshes.

**Risk parameter form.**

- It loads the asset's parameters and remembers their version.
- On a 412 the typed values stay. Under each field the current stored value appears as `Now <percentage>`, and the remembered version updates, so a second Save sends the typed values against the version just shown.

**Ledger filters.**

- Choosing a Ledger asset or a Postings shown value pushes one history entry. So does committing Posted from or Posted before with Enter or by leaving the field.
- The URL is `/ledger` with the parameters `asset`, `limit`, `from` and `to`, in that order, each present only when it differs from its default. The defaults are all assets, 50, and no bound. `from` and `to` hold canonical UTC instants. For example, `/ledger?asset=MBTC&limit=20&from=2026-11-01T04:00:00Z`.
- Back and Forward restore the controls and the table without a full page load. A reload keeps them.
- An unknown or malformed value, such as `asset=XYZ`, `limit=7` or a `from` that isn't a canonical instant, falls back to its default. The URL is then rewritten with a history replace, never a push, so the history length is unchanged.
- A desk-time field error leaves the URL untouched.

**Shock ruler, pointer and touch.**

- Pressing anywhere on the ruler moves the handle there. Dragging moves it in 0.5% steps.
- On every step these update in place: the handle, the shocked price, the tick fills, the hidden tick list and both counters.
- Releasing the handle posts nothing.

**Shock ruler, keyboard.**

- The ruler's input is the native slider `slider "Price shock"`. It spans the full ruler and takes pointer, touch and keyboard input. Its own thumb is not drawn. The visible handle is `img "Shock handle"`, centred at 0% at the start.
- Arrow Left and Arrow Down move −0.5%. Arrow Right and Arrow Up move +0.5%. Shift with an arrow moves 5%. Home jumps to −60% and End to +60%.
- Focus stays on the slider throughout.

**Post this price.**

- On the Steward view, Post this price copies the current shocked price into New price, in the price input form without `$`, for example `56 000,00000000`, and moves focus to Post price.
- The steward then posts it through the normal price form.
- After any successful post (manual or oracle), every open ruler for that asset recentres at 0% on the new price and reloads its positions on its next refresh.

**Tab order.** Acting as, then the section links, then the worksheet controls in reading order, then the pool cards, then the price rail. A focused control is never hidden behind a sticky bar or a banner, which is WCAG 2.2 success criterion 2.4.11, Focus Not Obscured.

**Hover and press.** Buttons and links underline with a heavier rule on hover and show a pressed state while held. A focused control shows a clearly visible ink outline set slightly outside its edge.

### Visual design (DP-62, DP-63, DP-64)

- **Colour roles, in words.**
  - The ground is a warm, slightly yellowed paper white, like assay ledger paper.
  - Text and figures are a near-black ink with a faint blue cast.
  - Rules are hairlines in a dusty khaki grey, and they are decorative only. Input borders and focus outlines use the ink, so they meet 3:1 contrast or better.
  - A single brick red is the signal colour, used only for liquidation states: the `Liquidatable in grace`, `Liquidatable now` and `Partially liquidated` labels, crossed ruler ticks, queue rows below health factor 1, the Confirm liquidation button and the Problems alert's edge.
  - A deep bottle green marks accrual and gains: rising share prices, supply rates and the Settled status.
- **Type.**
  - Headings use Space Grotesk, a geometric grotesque with slightly quirky letterforms. Body text uses IBM Plex Sans.
  - Every amount, price, rate, health factor, time and id uses IBM Plex Mono with its tabular digits, where every digit is the same width.
  - Each heading level is about a quarter larger than the level below it, and body text is the smallest step.
  - Fonts are served from the app's own origin.
- **Figures.** Amounts always show the asset's full decimals (6 for QUSD, 8 for MBTC, 18 for METH) in the desk format. Within each column they are right-aligned, so the decimal commas line up vertically.
- **Density.** Compact: rows sit on a tight ruled rhythm, with small labels above or beside each figure.
- **Composition.** A ledger sheet: pool cards on hairline rules at the left, a ruled worksheet in the centre, and the price rail at the right. The plumb line's 1.00 mark is the heaviest rule on the page. Lists, forms, tables, empty states and error states use the same ruled rows, monospace figures and hairlines. Error text is ink, and the Problems alert's edge is red.
- **Touch and contrast.** Every interactive control is at least 44 px in each direction, including the slider's hit area under the visible handle and each grid cell's button. This meets WCAG 2.2 success criterion 2.5.8, Target Size (Minimum). All text meets WCAG 2.2 AA contrast against the paper, including red and green text.

### Motion and effects (DP-48, DP-49, DP-62)

Motion is short and means something. Every motion only shifts, fades or scales an element: nothing animates its size or reflows the layout. Every transition starts quickly and settles softly, with no bounce.

- **Hover and press.** The underline rule thickens within about a tenth of a second.
- **Dialog and menu.** The Liquidate position dialog fades in and rises slightly over less than a fifth of a second, and reverses on close. The Repay options menu appears without moving.
- **Figures.** Changing numbers swap instantly. They never roll or count up, because a moving figure would misstate the ledger.
- **Shock ruler, the signature interaction.**
  - A horizontal ruler spans −60% to +60% of the chosen asset's current posted price, with the handle at 0%.
  - Below it, a canvas strip draws one thin vertical tick for each open position collateralised in that asset, at that position's liquidation price.
  - As the handle moves left, the shocked price falls and the handle passes ticks. Each tick it passes turns from ink to the signal red over 0.15 to 0.2 seconds.
  - The visible handle follows each new step with a movement of 0.1 to 0.15 seconds.
  - Moving back right reverses this step by step: each tick the handle passes again returns to ink.
  - Ticks of positions already below health factor 1 at 0% are red from the start.
  - Positions whose liquidation price lies outside the ruler's span are not drawn, but they are counted and listed when at risk.
  - On the position page, the owner's own tick is drawn taller.
  - The canvas redraws only when the handle, the asset or the positions change.
- **No idle animation.** There are no decorative loops, spinners or idle animations anywhere. A pending action shows its pending copy and a disabled button instead.
- **Reduced motion.** Under the reduced-motion preference:
  - the visible handle jumps to each step with no transition at all
  - ticks change fill instantly
  - the dialog appears without moving
  - each crossed tick also carries a diagonal hatch, so at-risk status never depends on colour or motion alone

### Feedback states (DP-09, DP-11, DP-24, DP-29, DP-32, DP-34, DP-38, DP-40, DP-44, DP-47, DP-55, DP-61)

**General rules.**

- Success and pending copy goes to `status "Announcements"`.
- Conflicts (409, 410, 412, 423), outages (503) and network failures go to `alert "Problems"`, showing the API's `detail` verbatim.
- On a 422:
  - each named field is marked invalid and shows its message directly under it, as its description
  - Problems reads `Check the highlighted fields.` with one link per invalid field that moves focus to it
  - focus moves to the first invalid field
- Focus never moves on success.
- While an action is pending, its button is disabled and Announcements reads the pending copy.
- Both live regions are always in the page, so a new message replaces the old one in place.

**Placeholders.**

- `<amount>`-style placeholders are desk-format amounts.
- `<ASSET>` is an asset code.
- `<hf>` is a desk-format health factor.
- `<n>` is a whole number.
- `<wall time>` is a desk wall time `HH:MM:SS <abbr>`.

**Pending and success copy.**

| Action | Pending | Success |
|---|---|---|
| Add member | `Adding member` | `Member added: <name>.` |
| Record transfer | `Recording transfer` | `Transfer recorded: <amount> <ASSET> to <name>.` |
| Supply | `Supplying` | `Supplied <amount> <ASSET> for <shares> shares.` (`<shares>` in desk format with no decimals) |
| Withdraw | `Withdrawing` | `Withdrew <amount> <ASSET>.` with a link `View receipt` |
| Get firm quote | `Getting quote` | `Quote ready. Firm until <wall time>.` |
| Swap now | `Swapping` | `Swapped <amount_in> <FROM> for <amount_out> <TO>.` |
| Open position | `Opening position` | `Position opened with <amount> <ASSET> collateral.` |
| Draw | `Drawing` | `Drew <amount> <ASSET>. Health factor now <hf>.` with a link `View receipt` |
| Repay, Repay all | `Repaying` | `Repaid <amount> <ASSET>. Health factor now <hf>.`, or `Repaid <amount> <ASSET>. No debt remains.` when the debt reaches zero |
| Add collateral | `Adding collateral` | `Collateral added. Health factor now <hf>.`, or `Collateral added. No debt is drawn.` |
| Withdraw collateral | `Withdrawing collateral` | `Collateral withdrawn. Health factor now <hf>.`, or `Collateral withdrawn. No debt is drawn.`, or `Collateral withdrawn. Position closed.` |
| Post price | `Posting price` | `Price posted. <n> positions now below health factor 1.` (`1 position` when n is 1) |
| Save risk parameters | `Saving risk parameters` | `Risk parameters saved for <ASSET>.` |
| Confirm liquidation | `Submitting liquidation` | `Liquidation filled. Repaid <repaid> <DEBT>, received <seized> <COLLATERAL>.` |

For example, with the seed data at start, posting MBTC at `52 000` announces `Price posted. 3 positions now below health factor 1.`

**Other copy.**

- **Stale-feed banner.** `Price feed stale. Borrowing, withdrawals of collateral and liquidations are paused.` Below it, one line per stale asset: `<ASSET> price is <n> seconds old.` While either chosen asset is stale, the Trade view also shows `Swaps are paused while the price feed is stale.` under Amount to pay.
- **Oracle status line** in each asset's price group, by `oracle_status`:

  | `oracle_status` | Line |
  |---|---|
  | `ok` | no line |
  | `unreachable` | `Couldn’t reach the price oracle – showing the last good price` |
  | `malformed` | `The price oracle sent an unreadable reading – showing the last good price` |
  | `old_round` | `The price oracle sent an older round – ignored` |
  | `not_newer` | `Manual post holds – the oracle has nothing newer` |
  | `large_move` | `The oracle moved more than 60% – not applied, post it by hand to accept it` |
  | `evidence_unavailable` | `Couldn’t store the oracle evidence – showing the last good price` |

- **Liquidation queue empty state.** `No positions are below health factor 1.`
- **Swap preview.** Before any amount is typed: `Type an amount to see the output.` When the server refuses the latest preview, the preview shows the server's field message or conflict detail in place of the output.
- **Browser-side field errors.**
  - Amount fields: `Enter digits with a comma before the decimals.`, `Enter at most <decimals> digits after the comma.` and `Enter an amount above zero.`
  - Risk percentages: `Enter a percentage with at most two decimals, for example 80,00.`
  - Desk-time fields: `Enter a desk time like 2026-11-01 01:30.` and `That time doesn’t exist in the desk time zone – the clocks skip it.`
- **Position state labels.** `Healthy`, `Margin warning`, `Liquidatable in grace`, `Liquidatable now`, `Partially liquidated`, `Closed`, for the API states `healthy`, `warned`, `liquidatable_grace`, `liquidatable`, `partially_liquidated`, `closed`.
- **Notices on the position page.** `Margin notice sent.` or `Margin notice queued, not yet sent.`, and `Liquidation notice sent.` or `Liquidation notice queued, not yet sent.`. Each is followed by the notice's creation wall time. A notice reads sent only after the server reports it sent.
- **Statement status.** `Settled` when the server reports `stored`. Otherwise `Pending statement`, followed by `Funds have moved. This settlement is not final until its statement and its PDF are confirmed in storage.`
- **Integrator webhook.** `Webhook delivered.` or `Webhook queued, not yet delivered.`
- **Network failure.** `Couldn’t reach Quillmoor. Press the same button again to retry safely.`
- **Settled shock announcement.** 400 milliseconds after the last movement of the handle, `status "Shock reading"` announces `<n> positions at risk at <shock>% shock.` (`1 position` when n is 1).

**Live data refresh.**

- The pool cards, the wallet, the price rail, the Liquidations badge, the position page, the liquidation queue, the Borrow list, the Ledger view and a receipt that reads Pending statement or Webhook queued each refetch every 5 seconds and after every action of their own. Every value they show therefore reflects the server within 5 seconds.
- The shock ruler reloads positions on load, on asset change and every 5 seconds while the handle is not being dragged.
- Every value on screen is the last server value. The browser never decides state, debt, health factor, grace, staleness or expiry from its own clock. The device clock may be wrong by hours.

## Backend

### API (DP-01, DP-02, DP-06, DP-11, DP-12, DP-13, DP-15, DP-16, DP-18, DP-26, DP-28, DP-37, DP-38, DP-40, DP-60, DP-61)

All endpoints live under `/api`. Request bodies are `application/json`. Success bodies are `application/json`, and error bodies are `application/problem+json`.

**Value formats.** These are the API's own language:

- **Amounts.** JSON strings holding a base-10 integer of the asset's minor units, with no sign and no leading zeros (for example `"12345678"`). Request amounts are above zero. Ledger balances and legs are signed, with an ASCII `-`.
- **Prices.**
  - Responses are strings in US dollars with a point and exactly 8 decimals (for example `"64000.00000000"`), one price unit being one hundred-millionth of a dollar.
  - Requests send a string of digits with an optional point and 1 to 8 decimals.
- **Share counts.** `shares_minted`, `shares_burned`, `total_shares` and each `lp_holdings[].shares` are JSON strings holding a base-10 integer with no sign and no leading zeros (zero is `"0"`), like amounts. They are never JSON numbers.
- **Health factors.** Strings with exactly 4 decimals (for example `"1.1250"`), or `null` with no debt.
- **Share prices.** Strings with exactly 12 decimals.
- **Rates and risk parameters.** JSON integers in basis points.
- **Durations.** ISO 8601, using only H, M and S with zero parts left out: `PT5M`, `PT1H`, `PT20S`, `PT1M30S`, and `PT0S` for zero.
- **Instants.**
  - The server records every instant to the whole second, rounding down.
  - Outputs are one canonical UTC form, `YYYY-MM-DDTHH:MM:SSZ`, with no fractional seconds.
  - Instant inputs are RFC 3339 with a mandatory `Z` or `±HH:MM` offset. Fractional seconds are allowed and are dropped.
- **Field names and enums.** snake_case.
- **Ids.** Opaque strings of at most 64 characters. Settlement, price post and event ids are UUIDs.
- **Copy inside the API.** Every `detail` and field message that includes an amount, price or percentage writes it in desk format, because the interface shows these messages verbatim.

**Headers.**

- `Authorization: Bearer <token>` carries the session.
- `Idempotency-Key` is required on the four endpoints marked "keyed".
- `If-Match` is required on the risk parameter save.

**Error precedence**, for the whole API. A request that breaks several rungs is answered at the earliest one:

1. 413 `payload_too_large`
2. 403 `cross_origin`
3. 415 `unsupported_media_type`
4. 400 `invalid_json`
5. 401 `unauthenticated`, which also sends `WWW-Authenticate: Bearer`
6. 400 `idempotency_key_required`
7. a stored replay, or 409 `idempotency_key_reused`
8. 404 `not_found` for an unknown resource in the path
9. 403 `forbidden` for role or ownership
10. 428 `precondition_required`, then 412 `precondition_failed`
11. state conflicts: 423, then 410, then 409, in the order an endpoint lists them
12. 422 `validation_failed`
13. 503 `statement_store_unavailable`, raised only after every check above has passed, when writing a statement or evidence object fails

A database failure answers 503 `ledger_unavailable` at whatever step it happens. Any unexpected failure answers 500 `internal_error`.

**Error body.** Every error has the same shape:

`{"type":"urn:quillmoor:problem:<code>","status":<status>,"code":"<code>","detail":"<detail>"}`

A 422 adds `"errors":{"<field>":"<message>"}`. Unknown `/api` paths, missing built files and the 500 handler answer in this same shape.

| Status | `code` | `detail` |
|---|---|---|
| 413 | `payload_too_large` | `The request body is too large.` |
| 403 | `cross_origin` | `Requests must come from Quillmoor’s own pages.` |
| 415 | `unsupported_media_type` | `Send the body as application/json.` |
| 400 | `invalid_json` | `The request body is not valid JSON.` |
| 401 | `unauthenticated` | `Choose who you are acting as.` |
| 400 | `idempotency_key_required` | `Send an Idempotency-Key header of 1 to 128 visible characters.` |
| 409 | `idempotency_key_reused` | `This Idempotency-Key was already used with a different request.` |
| 404 | `not_found` | `Nothing here by that name.` |
| 403 | `forbidden` | `Your role can’t do this.` |
| 428 | `precondition_required` | `Send the If-Match header from your latest read.` |
| 412 | `precondition_failed` | `These risk parameters changed since you opened them. Check the current values and save again.` |
| 423 | `market_stale` | the stale-feed banner copy from Feedback states for draws, collateral withdrawals and liquidations; `Swaps are paused while the price feed is stale.` for previews, quotes and swaps |
| 410 | `quote_expired` | `This quote has expired. Get a new quote.` |
| 409 | `quote_used` | `This quote has already been used.` |
| 409 | `position_closed` | `This position is closed.` |
| 409 | `already_liquidated` | `Already liquidated at this health factor` |
| 409 | `in_grace` | `This position is in its grace period.` |
| 409 | `not_liquidatable` | `This position is not below health factor 1.` |
| 409 | `insufficient_liquidity` | `Only <available> <ASSET> is available in the <ASSET> pool right now.` |
| 409 | `email_taken` | `A member with this email already exists.` |
| 409 | `pdf_pending` | `The PDF statement isn’t ready yet.` |
| 422 | `validation_failed` | `Check the highlighted fields.` |
| 503 | `statement_store_unavailable` | `The statement store is unreachable. Nothing was changed. Try again shortly.` |
| 503 | `ledger_unavailable` | `The ledger is unreachable – nothing is confirmed. Try again shortly.` |
| 500 | `internal_error` | `Something went wrong on our side – nothing is confirmed.` |

**Strict bodies.**

- A body must be a JSON object.
- A key the endpoint does not define gets `Unknown field.`. That includes `__proto__`, `constructor` and `prototype`.
- A missing required field, or a field of the wrong JSON type, gets that field's first message below. A numeric string is not a number, and a number is not an amount string.
- String fields refuse any C0 or C1 control character (U+0000 to U+001F, U+007F to U+009F), U+2028 and U+2029, with `Remove control characters.`. This check runs before the server applies Unicode NFC normalisation to the value.
- When one field breaks several checks, it carries only the first message in the order listed below.

**Field messages (422).** `<ltv>` is the loan-to-value as a desk percentage without `%`.

- Any amount field that is not a digit string, has leading zeros or is zero: `Enter a whole number of minor units above zero.`
- Any asset field naming no listed asset: `Choose a listed asset.`
- The second asset of a pair equal to the first (`to_asset`, `debt_asset`): `Choose two different assets.`
- An amount above the member's wallet balance: `Your wallet holds <balance> <ASSET>.` The message is keyed by the request's amount field: `amount` on supplies, repayments and collateral, `collateral_amount` on positions, `amount_in` on quotes and swaps (even though a swap body sends only `quote_id`), and `repay_amount` on liquidations.
- `price`: `Enter a price above zero with at most 8 decimal places.`, or `This moves the price by more than 60%. Confirm the large move to post it.`
- `confirm_large_move`: `Send true or false.`
- `quote_id`: `Send the quote id.`
- `amount` on a draw past loan-to-value: `This draw would take the position past its <ltv>% loan-to-value limit.`
- `amount` on a collateral withdrawal past loan-to-value: `This withdrawal would take the position past its <ltv>% loan-to-value limit.`
- `amount` on a collateral withdrawal above the locked collateral: `The position holds <collateral> <ASSET>.`
- `amount` on a repayment above the debt: `The current debt is <debt> <ASSET>.` A repayment `amount` may also be the string `"all"`.
- `amount` on a liquidity withdrawal above the member's share value: `Your shares are worth <value> <ASSET>.`
- `amount` on a supply that would mint no shares: `This amount is too small to receive any shares.`
- `amount_in` whose output rounds to zero: `This amount is too small to receive anything.`
- `repay_amount` above the max repay: `Repay at most <max_repay> <ASSET> on this fill.`
- `round` missing or not a whole JSON number: `Send the round shown for this position.`
- `name`: `Enter a name of 1 to 80 characters.`, counted in code points after normalisation.
- `email`: `Enter a valid email address.`
- `role`: `Choose a role.`
- `actor_id`: `Choose an existing member.`
- `from`, `to`: `Send an RFC 3339 time with an offset.`; `to` at or before `from`: `End must be after start.`
- `ltv_bps`: `Loan-to-value must be above 0% and below the liquidation threshold.`
- `liquidation_threshold_bps`: `Liquidation threshold must be above 0% and at most 95,00%.`
- `liquidation_bonus_bps`: `Bonus must be from 0% to 20,00%, and the threshold times one plus the bonus must stay below 100%.`
- `reserve_factor_bps`: `Reserve factor must be from 0% to 50,00%.`

**Cross-field checks on a risk save.** Every cross-field check uses the submitted value of each field, falling back to the stored value for fields not sent. Loan-to-value at or above the liquidation threshold is always reported on `ltv_bps`. A threshold times one plus the bonus at or above 100% is always reported on `liquidation_bonus_bps`.

**Endpoints:**

| Method and path | Who | Request | Success | Extra errors |
|---|---|---|---|---|
| `GET /api/health` | anyone, no token | | see Deployment | |
| `GET /api/actors` | anyone, no token | | `200 {"actors":[{"actor_id","name","email","role"}]}` ordered by name | |
| `POST /api/sessions` | anyone, no token | `{"actor_id"}` | `201 {"token","actor_id","role"}` | |
| `GET /api/me` | any member | | `200 {"actor_id","name","email","role"}` | |
| `POST /api/actors` | risk steward | `{"name","email","role"}`, with role one of `risk_steward`, `liquidity_provider`, `borrower`, `trader`, `liquidator` | `201 {"actor_id","name","email","role"}` | 409 `email_taken` |
| `POST /api/transfers` | risk steward | `{"actor_id","asset","amount"}` | `201 {"transfer_id","posting_id","actor_id","asset","amount"}` | |
| `GET /api/wallet` | any member | | `200 {"actor_id","balances":[{"asset","amount"}],"lp_holdings":[{"asset","shares","value"}],"position_ids":[...]}`, all three assets always listed | |
| `GET /api/pools` | any member | | `200 {"pools":[<pool>],"staleness_limit","grace_period","quote_lifetime","desk_time_zone","server_time"}` | |
| `GET /api/pools/{asset}` | any member | | `200 <pool>` plus `server_time` | |
| `GET /api/assets/{asset}/risk` | any member | | `200 {"asset","ltv_bps","liquidation_threshold_bps","liquidation_bonus_bps","reserve_factor_bps"}` with a strong `ETag` | |
| `PATCH /api/assets/{asset}/risk` | risk steward, with `If-Match` | any of the four `_bps` fields | `200` the same body plus `"positions_below_one"`, with the new `ETag` | 428, 412 |
| `POST /api/prices` | risk steward | `{"asset","price","confirm_large_move"?}` | `201 {"price_post_id","asset","price","previous_price","posted_at","source":"manual","positions_below_one","evidence_key"}` | 503 `statement_store_unavailable` |
| `GET /api/prices?asset=<ASSET>` | any member | | `200 {"prices":[{"price_post_id","asset","price","posted_at","posted_by","source","oracle_round","evidence_key"}]}` newest first | |
| `POST /api/pools/{asset}/supplies` | liquidity provider | `{"amount"}` | `201 {"supply_id","posting_id","asset","amount","shares_minted","share_price"}` | |
| `POST /api/pools/{asset}/withdrawals` (keyed) | liquidity provider | `{"amount"}` | `201 <settlement>` with kind `withdrawal` | 409 `insufficient_liquidity`, 503 `statement_store_unavailable` |
| `GET /api/swap/preview?from_asset=&to_asset=&amount_in=` | trader | | `200 {"from_asset","to_asset","amount_in","fee","amount_out","price_from","price_to"}` | 423 `market_stale`, 409 `insufficient_liquidity`; validation uses the query names |
| `POST /api/swap/quotes` | trader | `{"from_asset","to_asset","amount_in"}` | `201 {"quote_id","from_asset","to_asset","amount_in","fee","fee_to_supply","fee_to_reserve","amount_out","price_from","price_to","expires_at","server_time"}` | 423 `market_stale`, 409 `insufficient_liquidity` |
| `POST /api/swaps` (keyed) | the trader who owns the quote | `{"quote_id"}` | `201 {"swap_id","quote_id","posting_id","from_asset","to_asset","amount_in","fee","fee_to_supply","fee_to_reserve","amount_out","price_from","price_to","legs":[...],"created_at"}` | 404 for an unknown quote, 423 `market_stale`, 410 `quote_expired`, 409 `quote_used`, 409 `insufficient_liquidity`, 422 wallet |
| `POST /api/positions` | borrower | `{"collateral_asset","debt_asset","collateral_amount"}` | `201 <position>` | |
| `GET /api/positions?collateral_asset=<ASSET>&include_closed=true` | any member | both optional; closed positions are excluded by default | `200 {"positions":[<position>],"server_time"}` | |
| `GET /api/positions/{id}` | any member | | `200 <position>` | |
| `POST /api/positions/{id}/draws` (keyed) | owning borrower | `{"amount"}` | `201 <settlement>` with kind `draw` | 423 `market_stale`, 409 `position_closed`, 409 `insufficient_liquidity`, 503 `statement_store_unavailable` |
| `POST /api/positions/{id}/repayments` | owning borrower | `{"amount"}`, digits or `"all"` | `201 {"repayment_id","posting_id","amount","debt_after","health_factor_after","state_after"}` | 409 `position_closed` |
| `POST /api/positions/{id}/collateral` | owning borrower | `{"amount"}` | `201 <position>` | 409 `position_closed` |
| `POST /api/positions/{id}/collateral-withdrawals` | owning borrower | `{"amount"}` | `201 <position>` | 423 `market_stale`, 409 `position_closed` |
| `GET /api/liquidations/queue` | liquidator, risk steward | | `200 {"positions":[<position>],"server_time"}`: every position below health factor 1, lowest first | |
| `POST /api/positions/{id}/liquidations` (keyed) | liquidator | `{"repay_amount","round"}` | `201 <settlement>` with kind `liquidation` | 423 `market_stale`, 409 `already_liquidated`, 409 `position_closed`, 409 `in_grace`, 409 `not_liquidatable`, 503 `statement_store_unavailable` |
| `GET /api/settlements/{id}` | any member | | `200 <settlement>`, with `statement_status`, `notice_status` and `webhook_status` determined at the time of asking | |
| `GET /api/settlements/{id}/statement.pdf` | any member | | `200 application/pdf`, the stored PDF bytes | 409 `pdf_pending` |
| `GET /api/ledger/totals` | risk steward | | `200 {"assets":[{"asset","debits","credits","net"}]}`. Debits are the sum of positive legs, credits the absolute sum of negative legs, and net = debits − credits | |
| `GET /api/ledger/accounts?asset=<ASSET>` | risk steward | | `200 {"accounts":[{"account","asset","balance"}]}` | |
| `GET /api/ledger/postings?asset=&limit=&from=&to=` | risk steward | `limit` 1 to 200, default 50; `from` and `to` instant inputs, a half-open window `[from, to)` on `created_at` | `200 {"postings":[{"posting_id","kind","ref","created_at","legs":[{"account","asset","amount"}]}],"server_time"}` newest first | |

A losing liquidation submission carries the round its winner has just used, so it always gets `already_liquidated` (a `round` that differs from the position's current round), even when the winning fill closed the position.

**Objects.**

- `<pool>`:

  `{"asset","name","decimals","price","price_posted_at","price_age_seconds","price_source":"manual"|"oracle","oracle_round","oracle_status","market_state":"open"|"stale_feed","available_liquidity","total_borrowed","utilization_bps","borrow_rate_bps","supply_rate_bps","borrow_index","supply_balance","reserve_balance","swap_balance","total_shares","share_price","params":{"ltv_bps","liquidation_threshold_bps","liquidation_bonus_bps","reserve_factor_bps","close_factor_bps","swap_fee_bps","warning_health_factor"},"curve":{"base_bps","slope1_bps","kink_bps","slope2_bps"}}`

  - `borrow_index` is a digit string.
  - `oracle_round` is the round of the current price, or `null` for a manual post.
  - `oracle_status` is one of `ok`, `unreachable`, `malformed`, `old_round`, `not_newer`, `large_move`, `evidence_unavailable`.

- `<position>`:

  `{"position_id","borrower_id","collateral_asset","debt_asset","collateral_amount","debt","health_factor","liquidation_price","state","grace_ends_at","round","max_repay","notices":[{"notice_id","kind":"margin"|"liquidation","status":"queued"|"sent","created_at","sent_at"}],"created_at","server_time"}`

  - `state` is one of `healthy`, `warned`, `liquidatable_grace`, `liquidatable`, `partially_liquidated`, `closed`.
  - `grace_ends_at` is non-null only while the state is `liquidatable_grace`.
  - `liquidation_price` is `null` with no debt.
  - `round` is the number of fills so far.
  - `max_repay` is `"0"` outside `liquidatable` and `partially_liquidated`.

- `<settlement>`:

  `{"settlement_id","kind":"draw"|"withdrawal"|"liquidation","actor_id","position_id","asset","amount","legs":[{"account","asset","amount"}],"statement_key","pdf_key","pdf_rendered_at","statement_status":"stored"|"pending_statement","event_id","webhook_status":"queued"|"delivered","created_at"}`

  plus these fields by kind:

  - draw: `"debt_after","health_factor_after","state_after"`
  - withdrawal: `"shares_burned","share_price_after"`; `position_id` is null
  - liquidation: `"round","borrower_id","repaid","seized","bonus_amount","written_off","health_factor_before","health_factor_after","state_after","price_collateral","price_debt","notice_status":"queued"|"sent"`; `asset` is the debt asset and `amount` equals `repaid`

  `pdf_rendered_at` is null until the PDF is stored, and never changes once set.

### Business rules (DP-01, DP-03, DP-06, DP-07, DP-08, DP-12, DP-13, DP-15, DP-16, DP-17, DP-18, DP-21, DP-22, DP-23, DP-26, DP-28, DP-31, DP-32, DP-34, DP-35, DP-37, DP-39, DP-40, DP-43, DP-46, DP-51, DP-52, DP-56)

**Members, sessions and roles.**

- Each member has exactly one role.
- A session token is an opaque random string stored in Postgres. It is valid in every server process and does not expire.
- A borrower may act only on positions they own (`forbidden` otherwise).
- The risk steward may read everything.
- Writes are allowed only as listed in the API table.
- Emails are unique without regard to case.

**Exact money.**

- Every amount is an integer of the asset's minor units, and every price an integer of price units. Arithmetic is integer-only. Each division rounds as its formula states, in the pool's favour.
- The quote, the posting, the receipt, the statement, the event and every screen show the same integers.

**Fee and interest split.**

- Swap fees and accrued interest are split between the liquidity providers (`supply`) and the `reserve` in the ratio (10,000 − reserve factor) to reserve factor. The split uses largest-remainder allocation:
  - Each side first gets the floor of its exact share.
  - A leftover unit goes to the side with the larger fractional remainder.
  - On a tie, the leftover goes to `supply`.
- A swap's fee lands in the `supply` and `reserve` of the pool of the asset the trader pays with, so it raises the share price of that pool only. A swap that pays with QUSD raises the QUSD share price and leaves the share price of the asset received unchanged.
- For example, with the seed data at start, the fee of `37038` MBTC at MBTC's 10.00% reserve factor gives `fee_to_reserve` `3704` and `fee_to_supply` `33334`.

**The ledger.** It is double-entry:

- Every movement is one posting of legs. Each leg is an account, an asset and a signed non-zero integer.
- Within each posting, the legs of each asset sum to zero.
- Postings are never edited or deleted. A correction is a new posting.
- An account's balance is the sum of its legs.
- The trial balance (ledger totals) nets to zero in every asset at any instant.

Accounts, each held per asset:

| Account | Holds | Usual sign |
|---|---|---|
| `custody` | funds that entered by inbound transfer | negative |
| `wallet:<actor_id>` | a member's free balance | positive |
| `collateral:<position_id>` | collateral locked in a position | positive |
| `loan:<position_id>` | a position's debt to the pool (debt = −balance) | negative |
| `supply` | the liquidity providers' claim on the pool | positive |
| `reserve` | the reserve's claim, held back from liquidity providers | positive |
| `swap` | the swap book's net inventory, not owned by liquidity providers | either |

Postings by kind, with legs per asset:

- `transfer_in`: custody −x, wallet +x.
- `supply`: wallet −x, supply +x.
- `withdrawal`: supply −y, wallet +y.
- `lock` (opening a position or adding collateral): wallet −c, collateral +c. `release` (withdrawing collateral) is the reverse.
- `draw`: loan −d, borrower wallet +d.
- `accrual`: loan −i, supply +(i − r), reserve +r, where r is the reserve side of the split.
- `repay`: borrower wallet −p, loan +p.
- `swap`:
  - Input asset A: trader wallet −a, supply +fee_to_supply, reserve +fee_to_reserve, swap +(a − fee).
  - Output asset B: swap −b, trader wallet +b.
- `liquidation`:
  - Debt asset: liquidator wallet −repaid, loan +repaid.
  - Collateral asset: collateral −seized, liquidator wallet +seized.
  - With a write-off, also: loan +written_off, supply −written_off.
  - When the position closes with collateral left, also: collateral −rest, borrower wallet +rest.

**Pool figures read from the ledger.** These are recomputed from balances whenever they are read, and are never kept as counters. Total shares and each holder's shares are the only non-ledger pool figures.

- Available liquidity = supply + swap + Σ loan, all balances in that asset.
- Total borrowed = −Σ loan.
- Utilization (bps) = floor(total borrowed × 10,000 ÷ (total borrowed + available liquidity)), and 0 when both are zero.
- Share price = supply ÷ total shares, floored to 12 decimals. It is `1.000000000000` when there are no shares.
- A holder's share value = floor(holder shares × supply ÷ total shares).

**Supply and withdrawal.**

- Supplying x mints floor(x × total shares ÷ supply) shares, or x shares when the pool has none.
- Withdrawing y burns ceil(y × total shares ÷ supply) shares.
- A withdrawal must stay within the holder's share value (422) and the available liquidity (`insufficient_liquidity`).

**Interest.** Interest compounds through a per-second cumulative index.

- **Borrow-rate curve.** Each asset has a kinked curve. With utilization U in bps:
  - when U ≤ kink: rate = base + floor(slope1 × U ÷ kink)
  - when U > kink: rate = base + slope1 + floor(slope2 × (U − kink) ÷ (10,000 − kink))
- **Supply rate** = floor(borrow rate × U × (10,000 − reserve factor) ÷ 100,000,000).
- **Borrow index.** Each asset keeps a borrow index: an integer scaled by 10^27 that starts at 10^27. It also keeps the whole second of server time it was last brought forward to. Bringing it forward by dt seconds sets index = index + floor(index × rate × dt ÷ (10,000 × 31,536,000)), using the rate in force at the start of the interval.
- **Position debt.** Each position keeps a principal and a reference index. Both are reset to the current debt and the current index at every draw, repayment and fill. Its debt at any second is ceil(principal × index now ÷ reference index). Each accrual posts the difference between that debt and the debt already posted.
- **When accrual happens.**
  - The server brings an asset and its positions forward before any read or write that shows or uses that asset's debt, and in the background at least every 5 seconds. Every debt shown anywhere therefore equals −loan balance at that second.
  - Draws and repayments change the debt by exactly their amount after accrual.
  - `"all"` repays the debt accrued to the second of the request.

**Health factor and liquidation price.** For a position with collateral C of asset c and debt D of asset d (minor units), prices Pc and Pd (price units), decimals dc and dd, and the collateral asset's liquidation threshold LT (bps):

- Health factor × 10,000 = floor(C × Pc × LT × 10^dd ÷ (D × Pd × 10^dc)), or `null` when D is 0.
- Liquidation price = ceil(D × Pd × 10^dc × 10,000 ÷ (C × LT × 10^dd)): the collateral price below which the health factor falls under 1.
- The warning level is health factor `1.1000`.
- A draw or collateral withdrawal passes the loan-to-value check when D × Pd × 10^dc × 10,000 ≤ C × Pc × LTV × 10^dd after the change, using the collateral asset's loan-to-value.

**Position states.** The server evaluates a position on every read or write that touches it, on every price post (manual or oracle) and risk save, and in the background at least every 5 seconds with no request involved. Each position keeps a stored grace end and an after-fill mark. Each evaluation applies these rules in order:

1. Collateral 0 and debt 0 → `closed`. This is terminal, and every later write gets `position_closed`.
2. No debt, or health factor ≥ 1.1000 → `healthy`. This clears the stored grace end and the mark, and re-arms the margin notice.
3. 1.0000 ≤ health factor < 1.1000 → `warned`. This clears the stored grace end and the mark.
4. Health factor < 1.0000:
   - With no stored grace end and no mark, a grace starts: the grace end is now + the grace period, and the state is `liquidatable_grace`.
   - While now is before the stored grace end, the state is `liquidatable_grace`.
   - Otherwise the state is `partially_liquidated` when the mark is set, and `liquidatable` when it isn't.
   - A fill that leaves the health factor below 1 sets the mark.

When a position enters `warned`, or any state below 1, while its margin notice is armed, the server queues one margin notice and disarms it.

The legal edges are exactly those these rules produce, plus the recovery grace under Stale feeds:

- A position recovers through repayment, added collateral, a price post or a risk change.
- Liquidation is allowed only in `liquidatable` and `partially_liquidated`. In `liquidatable_grace` it is refused with `in_grace`, and in `healthy` or `warned` with `not_liquidatable`.
- Repayment and added collateral are allowed in every state except `closed`.

The move from `liquidatable_grace` at the grace end needs no request: background evaluation applies it.

**Opening, drawing and collateral.**

- A position pairs two different assets. Opening it locks the collateral from the borrower's wallet.
- A draw must pass the loan-to-value check (422) and fit the debt asset's available liquidity (`insufficient_liquidity`).
- A collateral withdrawal must leave the loan-to-value check passing while debt remains (422). Withdrawing the whole collateral of a debt-free position closes it.

**Liquidation fills.**

- Close factor is 5,000 bps: max repay = min(floor(D × 5,000 ÷ 10,000), cover).
- cover = floor(C × Pc × 10^dd × 10,000 ÷ (Pd × 10^dc × (10,000 + bonus))), where bonus is the collateral asset's liquidation bonus.
- A fill sends the position's current `round` and a `repay_amount` from 1 to max repay, paid from the liquidator's wallet (422).
- Seized = floor(repaid × Pd × 10^dc × (10,000 + bonus) ÷ (Pc × 10^dd × 10,000)).
- bonus_amount = seized − floor(repaid × Pd × 10^dc ÷ (Pc × 10^dd)).
- When cover is below the close-factor cap and the liquidator repays exactly max repay, the fill seizes all remaining collateral, writes the rest of the debt off against `supply`, and closes the position.
- Otherwise, a fill that brings the debt to zero releases the remaining collateral to the borrower and closes the position.
- Each fill increments `round` and queues one liquidation notice.

**Manual price posts and risk parameters.**

- A posted price is above zero, with at most 8 decimals.
- A move of more than 60% from the current price, in either direction, is refused (422) unless `confirm_large_move` is true. Exactly 60% is allowed.
- A manual post's `posted_at` is the server's now.
- `positions_below_one` counts every open position, in any asset, whose health factor is below 1 after the post.
- Risk saves follow RFC 9110 conditional requests:
  - The `ETag` is a strong validator that changes on every save.
  - `If-Match` is compared strongly. A missing `If-Match` gets 428, and a mismatch gets 412.
  - The bounds are those in the field messages.
  - A save applies at once and re-evaluates every open position.

**Oracle readings.**

- Every server process polls each asset's feed every `ORACLE_POLL_SECONDS` seconds. Each request has a 1,000 millisecond timeout. The process keeps polling forever, whatever any earlier poll returned.
- **Conversion.** A reading converts to price units with integer arithmetic only:
  - exponent ≥ −8: price = mantissa × 10^(8 + exponent)
  - otherwise: price = floor(mantissa ÷ 10^(−8 − exponent))
  - A converted price of 0 is malformed.
- **Status.** Each poll's result sets that asset's `oracle_status`, which reports the latest poll made by the server process that answers the request. Until that process's first poll returns, it reads `unreachable`. The checks apply in this order:

  | Status | When |
  |---|---|
  | `unreachable` | a non-200 status, a timeout or a connection failure |
  | `malformed` | the body is not the published shape, or `feed` is not `<ASSET>-USD`, or `publish_time` is more than 5 seconds after server now |
  | `old_round` | `round` is lower than the last applied oracle round for the asset, or equal to it with a different price or publish time |
  | `ok` or `not_newer` | `round` equals the last applied round with the same content: `ok` when the current price is that reading, `not_newer` otherwise |
  | `not_newer` | the publication instant is not strictly later than the current price's `posted_at` |
  | `large_move` | the move from the current price is more than 60% (never applied automatically) |
  | `evidence_unavailable` | the evidence object cannot be stored |
  | `ok` | the reading is applied |

- **Manual override.** A steward's manual post holds until a publication strictly later than it arrives.
- **Applying a reading.**
  - Applying a reading creates a price post with `posted_by` `"oracle"`, `source` `"oracle"`, `oracle_round` the round, and `posted_at` the publication instant.
  - It stores its evidence before it counts, and re-evaluates positions.
  - It happens at most once per asset and round across every process sharing the database.
- **On failure.** A reading that is not applied changes nothing, and the last good price stays.

**Stale feeds.**

- An asset's market is `stale_feed` while server now − `posted_at` of its current price is more than the staleness limit. Because an oracle post's `posted_at` is its publication time, staleness runs from publication, never from when the reading arrived.
- The market is `open` again from the moment a post (manual or oracle) with a fresh `posted_at` lands.
- While either asset of a position is stale, draws, collateral withdrawals and liquidations on it get `market_stale`. While either swap asset is stale, previews, quotes and swaps get `market_stale`.
- Supply, withdrawal, repayment, opening a position and adding collateral continue during staleness.
- **Recovery grace.** A post that takes an asset from `stale_feed` to `open` grants a recovery grace. Every open position involving that asset, as collateral or debt, whose health factor is below 1 after the post gets:
  - stored grace end = the later of its existing grace end and now + the grace period
  - state `liquidatable_grace`
  
  This includes positions that were `liquidatable` or `partially_liquidated`. The after-fill mark is kept, so when the recovery grace ends a marked position reads `partially_liquidated` and an unmarked one reads `liquidatable`. A post onto an open market grants nothing.

**Quotes.**

- fee = ceil(amount_in × swap_fee_bps ÷ 10,000).
- amount_out = floor((amount_in − fee) × P_from × 10^d_to ÷ (P_to × 10^d_from)).
- `expires_at` = creation + the quote lifetime.
- Execution honours the quote's prices and amounts. It is refused:
  - with `quote_expired` when server now is at or after `expires_at`
  - with `quote_used` once the quote has executed
  - with `insufficient_liquidity` when the output pool cannot pay
- A preview uses the same formulas at the current prices and creates nothing.
- For example, with the seed data at start, paying `12345678` MBTC for QUSD gives fee `37038` and amount_out `7877529600`. In desk format that is `0,12345678` MBTC in, a fee of `0,00037038` MBTC, and `7 877,529600` QUSD out.

**Retries with an Idempotency-Key.** These follow IETF Idempotency-Key semantics:

- Keyed endpoints require a key of 1 to 128 visible ASCII characters. Keys are scoped to the acting member and the endpoint path, and are kept permanently.
- The first response with a status below 500 is stored, together with a fingerprint of the canonical body. Two bodies match when they parse to the same JSON value, whatever their key order or whitespace.
- A replay with a matching body returns the stored status and body with the header `Idempotency-Replayed: true`, and moves nothing.
- The same key with a different body gets `idempotency_key_reused`.
- A 5xx response is not stored, so a retry after an outage runs fresh.
- Two requests with the same key arriving together run once. The second waits, then returns the replay.

**Contests.** Liquidations per position, and withdrawals, draws and swap outputs per pool, are linearizable across every server process sharing the database:

- Of N liquidations submitted at once for one position and round, exactly one fills. The others get `already_liquidated` and post, store and emit nothing.
- When concurrent withdrawals, draws or swap outputs together exceed a pool's available liquidity, they are served one at a time. The one that no longer fits gets `insufficient_liquidity`.

**Settlement atomicity and finality.**

- These parts commit together in one database transaction, or not at all:
  - a draw, liquidity withdrawal or liquidation commits its posting, its `.json` and `.txt` statement objects, its integrator events and (for a liquidation) its queued borrower notice
  - a manual price post commits with its evidence object
- If storing an object fails, nothing commits, any object already written is removed, and the request gets `statement_store_unavailable`. The position stays exactly as it was and is still liquidatable. The only exception is interest accrual, which follows the clock.
- The PDF is rendered after commit, from a render queue held in Postgres.
- `statement_status` is `stored` only when the server's check at the time of asking finds both the `.json` and the `.pdf` objects in storage. Otherwise it is `pending_statement`, including while storage is unreachable.
- A notice is `sent` only after the mail server accepts it. `webhook_status` is `delivered` only after Svix accepts the settlement's event.

**Integrator events.** Integrator events use the transactional outbox:

- **Which changes emit an event.** Every settlement emits one `settlement.committed` event. Every position state change emits one `position.state_changed` event, including opening a position (`from` null), grace expiry and recovery grace.
- **Same transaction.** Each event is written to the outbox in the same transaction as its change. A rolled-back change emits nothing.
- **Event ids.** `event_id` is a UUID, and it is the ledger event id.
- **Sequence.**
  - Events of a position carry `sequence`, counting from 1 per position with no gaps across both types.
  - Within one transaction, `settlement.committed` comes before `position.state_changed`.
  - Withdrawals carry `position_id` and `sequence` null.
- **`occurred_at`.** The instant of the change. For a grace expiry it is the grace end itself, not the moment the server noticed.
- **Payload.** `{"event_id","type","position_id","sequence","occurred_at","data"}`, where:
  - `settlement.committed` data is `{"settlement_id","kind","asset","amount","statement_key"}`
  - `position.state_changed` data is `{"from","to","health_factor","grace_ends_at"}`
  - amounts and health factors are in API format, and instants are canonical UTC
- **Delivery order.** Within a position, delivery follows `sequence`: event n+1 is never sent before Svix has accepted event n.

**Background jobs.** These jobs are claimed in Postgres, and each runs exactly once per item across every server process sharing the database, never twice and never decided in process memory:

- notice delivery
- PDF rendering
- webhook delivery
- oracle round application
- background evaluation and accrual

Queued notices, renders and events are attempted within 10 seconds of being queued and retried every 10 seconds while their service is unreachable.

**Shock ruler readings.** For the chosen asset with posted price P and shock s (percent, a multiple of 0.5 from −60 to 60):

- Shocked price = floor(P × (1,000 + 10 × s) ÷ 1,000) price units.
- The ruler covers the open positions with that collateral asset and debt above zero, using each position's `liquidation_price` from `GET /api/positions?collateral_asset=<ASSET>`.
- A position is at risk when the shocked price is below its liquidation price. A position whose liquidation price equals the shocked price is clear.
- Positions at risk is the count of at-risk positions. Collateral exposed is the sum of their `collateral_amount`.
- For example, with the seed data at start and MBTC chosen:
  - −12.5% gives the value text `−12,5% · $56 000,00000000`.
  - −15.0% gives `Shocked price` `$54 400,00000000`, `Positions at risk` `2` (`pos-0002` and `pos-0004`) and `Collateral exposed` `2,00000000 MBTC`.

**Server clock.** The grace period, staleness limit, quote lifetime and poll interval come from the environment, as set out in Configuration and secrets. Every time decision uses the server clock.

### Services (DP-23, DP-27, DP-31, DP-32, DP-39, DP-40, DP-41, DP-51, DP-52, DP-54, DP-55)

**Postgres** is the only system of record. It holds members, sessions, the ledger, pools, shares, indexes, positions, prices, quotes, stored retry responses, the notice queue, the event outbox and the render queue.

- The schema and seed apply automatically on serve when the database is empty, exactly once, even when several servers start against the same empty database at once.
- A non-empty database is left untouched.

**MinIO** stores objects in the bucket named by `S3_BUCKET`. Objects are never overwritten.

- **Bucket.** The server creates the bucket if it doesn't exist, at start and again before any write once MinIO is reachable. When MinIO is unreachable at boot, the server starts normally and retries the creation every 10 seconds.
- **Seed evidence.** The seed never waits for MinIO. Its price posts are the only posts without an evidence object: they carry `evidence_key` null, and the seed boots the same way whether MinIO is reachable or not.

- **Statements.**
  - Each settlement writes `statements/<kind>/<settlement_id>.json` (`application/json`) and `statements/<kind>/<settlement_id>.txt` (`text/plain; charset=utf-8`) before commit, and `statements/<kind>/<settlement_id>.pdf` (`application/pdf`) once, after rendering. `<kind>` is `draw`, `withdrawal` or `liquidation`.
  - `statement_key` names the `.json` and `pdf_key` the `.pdf`.
  - The JSON holds every settlement field except `statement_status`, `notice_status`, `webhook_status` and `pdf_rendered_at`.
- **The `.txt` statement.** UTF-8, with each line ending in a line feed. It holds exactly these lines, in this order:
  1. `Quillmoor Reserve settlement statement`
  2. `Settlement <settlement_id>`
  3. `Kind <kind label>`, where the label is `Draw`, `Liquidity withdrawal` or `Liquidation`
  4. `Member <name> (<actor_id>)` for the acting member
  5. `Amount <amount> <ASSET>`
  6. for liquidations only, these six lines:
     - `Repaid <repaid> <DEBT>`
     - `Seized <seized> <COLLATERAL>`
     - `Bonus <bonus_amount> <COLLATERAL>`
     - `Written off <written_off> <DEBT>`
     - `Health factor before <hf>`
     - `Health factor after <hf>`, or `Health factor after No debt`
  7. `Desk time <YYYY-MM-DD HH:MM:SS> <abbr>`, the settlement's `created_at` in the desk time zone
  8. `UTC <YYYY-MM-DDTHH:MM:SSZ>`, the same instant
  9. one line per leg, in the settlement's `legs` order: `<account> <ASSET> <signed amount>`

  All figures are in desk format. The PDF shows the same lines in the same order, set in the ledger-sheet type.
- **Evidence.** Each price post writes `evidence/prices/<price_post_id>.json`. It holds `price_post_id`, `asset`, `price`, `previous_price`, `posted_at`, `posted_by`, `source`, `positions_below_one` and `positions`. `positions` lists each open position involving the asset, with its `position_id`, `health_factor` and `liquidation_price` after the post. It also holds:
  - for a manual post, `"submitted"`: the request body's fields with their JSON values exactly as sent, with no defaults added and nothing normalised. A submitted `"price":"56000.5"` stays `"56000.5"`, while the top-level `price` is `"56000.50000000"`, and a `confirm_large_move` that was not sent stays absent.
  - for an oracle reading, `"oracle_response"`: the raw response body text, byte for byte, whitespace included.
- **While MinIO is unreachable:**
  - draws, withdrawals, liquidations and manual posts get `statement_store_unavailable`
  - oracle readings read `evidence_unavailable`
  - receipts read Pending statement
  - swaps, supply, repayment, opening positions, adding collateral and every read keep working

**Mailpit** receives notices over SMTP, sent from the address in `MAIL_FROM`, with figures in desk format:

- **Margin notice.** To the borrower's email, with subject `Margin notice: <position_id> at health factor <hf>`. The body states the debt and collateral with asset codes, the liquidation price, and `Repay or add collateral to stay above health factor 1.`
- **Liquidation notice.** To the borrower's email, with subject `Liquidation notice: <position_id> fill <n>`, where `<n>` is the position's round after the fill. The body states repaid, seized, bonus amount, health factor after, and the settlement id.
- **While mail is unreachable,** notices stay `queued`, the position page shows the queued copy, and every action completes. Nothing reports a notice as sent.

**WireMock** serves the price oracle. It is an invented third-party price API, and all of its data is invented.

- The app calls `GET <WIREMOCK_URL><ORACLE_PATH_PREFIX>/feeds/<ASSET>-USD/latest` for `QUSD`, `MBTC` and `METH`, with no query parameters.
- A reading is `200` with a JSON body, for example `{"feed":"MBTC-USD","round":1042,"price":{"mantissa":"6400012345678","exponent":-8},"publish_time":1793702400}`:
  - `feed`: the feed name.
  - `round`: a positive JSON integer that rises with each publication.
  - `price.mantissa`: a string of 1 to 38 digits, above zero, with no leading zeros.
  - `price.exponent`: a JSON integer from −18 to 0.
  - `publish_time`: Unix seconds, a positive JSON integer.
- Other fields are ignored.
- The baseline the environment serves at the unprefixed paths is round `1`, published at `1793577600`, with mantissas `"100000000"` (QUSD), `"6400000000000"` (MBTC) and `"320000000000"` (METH), each with exponent `-8`. Because it is older than the seed posts, the seed prices hold and `oracle_status` reads `not_newer`.

**Svix** delivers integrator webhooks.

- Messages go to the application with uid `quillmoor-reserve` and name `Quillmoor Reserve`. The app creates the application if it doesn't exist, keeps the existing one if it does, and makes it on first use.
- Each event becomes one message:
  - `eventType` is the event's `type`
  - `eventId` is `event_id`
  - the payload is the event object
  - the request carries the header `Idempotency-Key: <event_id>`
- Svix signs deliveries with Standard Webhooks headers (HMAC-SHA256).
- While Svix is unreachable, events stay queued and receipts read `Webhook queued, not yet delivered.`
- The seed emits no events.

**Gotenberg** renders each statement's HTML to PDF through `POST <GOTENBERG_URL>/forms/chromium/convert/html`. While it is unreachable:

- settlements still commit
- receipts read Pending statement
- renders stay queued, and any process renders each one exactly once when Gotenberg answers again

**Database loss.**

- While the database is unreachable, requests get `ledger_unavailable`.
- When the database drops the server's connections, the server reconnects by itself, with no restart. Within 5 seconds of the database accepting connections again, requests succeed.

### Seed data (DP-07, DP-22, DP-26, DP-38, DP-46)

Every seeded person and business is invented. Emails use the reserved `quillmoor.example` domain or other `.example` domains.

**Members:**

| actor_id | name | email | role |
|---|---|---|---|
| `stw-ines` | Ines Varga | `ines.varga@quillmoor.example` | risk_steward |
| `stw-odile` | Odile Marchetti | `odile.marchetti@quillmoor.example` | risk_steward |
| `lp-rosa` | Rosa Aldana | `rosa.aldana@quillmoor.example` | liquidity_provider |
| `lp-tomas` | Tomas Ferreira | `tomas.ferreira@quillmoor.example` | liquidity_provider |
| `br-sanna` | Sanna Lindqvist | `sanna.lindqvist@quillmoor.example` | borrower |
| `br-dele` | Dele Oyelaran | `dele.oyelaran@quillmoor.example` | borrower |
| `br-mara` | Mara Castell | `mara.castell@quillmoor.example` | borrower |
| `br-yusuf` | Yusuf Brandt | `yusuf.brandt@quillmoor.example` | borrower |
| `br-ivo` | Ivo Petrak | `ivo.petrak@quillmoor.example` | borrower |
| `tr-petra` | Petra Novak | `petra.novak@quillmoor.example` | trader |
| `lq-kestrel` | Kestrel Keepers | `desk@kestrel-keepers.example` | liquidator |
| `lq-vane` | Vane Desk | `ops@vane-desk.example` | liquidator |

**Assets.** All three share close factor 5,000 bps, swap fee 30 bps and warning health factor `1.1000`.

| Asset | Name | Decimals | Price | LTV | Liq. threshold | Bonus | Reserve factor | Curve (base, slope1, kink, slope2) |
|---|---|---|---|---|---|---|---|---|
| QUSD | Quill Dollar | 6 | `1.00000000` | 8000 | 8500 | 400 | 1000 | 0, 400, 9000, 6000 |
| MBTC | Moor Bitcoin | 8 | `64000.00000000` | 7000 | 7500 | 500 | 1000 | 0, 400, 4500, 30000 |
| METH | Moor Ether | 18 | `3200.00000000` | 7500 | 8000 | 500 | 1500 | 0, 300, 8000, 8000 |

- Seed prices are manual posts by `stw-ines`, made at the moment the seed is applied. They have no evidence object and `evidence_key` null, as set out in Services.
- Every borrow index starts at 10^27.
- The seed is written as ordinary postings (inbound transfers, supplies, locks and draws). Seed draws write no statements, and the seed queues no notices and emits no events.

**Pools at start**, each with share price `1.000000000000`:

| Pool | Supplied by | Supply = shares |
|---|---|---|
| QUSD | `lp-rosa` | 2000000000000 |
| MBTC | `lp-rosa` | 4000000000 |
| METH | `lp-tomas` | 600000000000000000000 |

**Positions at start.** All are `healthy`, at round 0, with the margin notice armed:

| position_id | borrower | Collateral | Debt | Health factor | Liquidation price |
|---|---|---|---|---|---|
| `pos-0001` | `br-sanna` | MBTC 200000000 | QUSD 60000000000 | `1.6000` | `40000.00000000` |
| `pos-0002` | `br-dele` | MBTC 150000000 | QUSD 64000000000 | `1.1250` | `56888.88888889` |
| `pos-0003` | `br-mara` | MBTC 100000000 | QUSD 40000000000 | `1.2000` | `53333.33333334` |
| `pos-0004` | `br-yusuf` | MBTC 50000000 | QUSD 21000000000 | `1.1428` | `56000.00000000` |
| `pos-0005` | `br-ivo` | METH 10000000000000000000 | QUSD 16000000000 | `1.6000` | `2000.00000000` |

Each borrower's collateral arrived by inbound transfer and was locked. Their wallets hold exactly the QUSD they drew.

**Other wallets at start:**

| Member | Wallet |
|---|---|
| `tr-petra` | MBTC 100000000, QUSD 50000000000, METH 5000000000000000000 |
| `lq-kestrel` | QUSD 250000000000 |
| `lq-vane` | QUSD 250000000000 |
| `lp-rosa` | QUSD 100000000000 |
| `lp-tomas` | METH 10000000000000000000 |
| `stw-ines`, `stw-odile` | nothing |

For example, with the seed data at start, the QUSD pool shows Available liquidity `1 799 000,000000`, Total borrowed `201 000,000000` and Utilization `10,05%`, and every asset nets to 0. From the moment of seeding, debts grow by accrual.

## Technical requirements

### Deployment (DP-58)

- **Runtime.** The app is TypeScript, running on Node.js 22 LTS with npm.
- **Run manifest.** `/app/run.json` holds the string fields `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

  `{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}`

- **Port.** The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set.
- **Health check.** `GET /api/health` answers HTTP 200 JSON `{"status":"ok"}` once Postgres is reachable and the schema is applied, and `503 {"status":"starting"}` before that.
- **Several processes.** Several server processes may share one database and one bucket at once, each with its own outage settings and oracle path prefix. Every rule in Business rules holds across them.

### Configuration and secrets (DP-59)

The server reads these at start:

| Variable | Purpose | Required |
|---|---|---|
| `DATABASE_URL` | Postgres connection, as a non-superuser database owner | yes |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | yes |
| `SMTP_HOST`, `SMTP_PORT` | mail server | yes |
| `MAIL_FROM` | From line of every notice; the environment sets it to `Quillmoor Reserve <notices@quillmoor.example>` | yes |
| `WIREMOCK_URL` | base URL of the price oracle | yes |
| `ORACLE_PATH_PREFIX` | path prefix of this instance's feeds, for example `/short`; empty when unset | no |
| `ORACLE_POLL_SECONDS` | oracle poll interval, default 2 | no |
| `SVIX_URL`, `SVIX_API_KEY` | Svix server and token | yes |
| `GOTENBERG_URL` | PDF renderer | yes |
| `DESK_TIME_ZONE` | IANA zone of the desk, default `America/St_Johns` | no |
| `GRACE_SECONDS` | grace period, default 300 | no |
| `STALENESS_SECONDS` | staleness limit, default 3600 | no |
| `QUOTE_TTL_SECONDS` | quote lifetime, default 30 | no |
| `APP_PUBLIC_PORT` | listening port | no |

- When a required variable is missing, or `DESK_TIME_ZONE` or a seconds value is invalid, the server refuses to start: it exits with a non-zero status and a message naming the variable.
- No service URL or credential has a fallback written in source.
- No URL, key or password is ever sent to the browser.
- `MAILPIT_URL` may be present and is not needed.

### Server boundary (DP-55, DP-60)

- **One origin.** The server serves the built browser app and `/api` from a single origin and sends no cross-origin allowance headers. An unsafe request (`POST`, `PATCH`, `PUT`, `DELETE`) whose `Origin` header names any other origin than the request's own gets `cross_origin`. Requests without an `Origin` header are allowed.
- **Bodies.** Bodies are limited to 16,384 bytes: a body of exactly 16,384 bytes is accepted, and 16,385 bytes gets `payload_too_large`. Bodies on `POST` and `PATCH` must be `application/json`.
- **What is never served.** Source files, source maps, environment files, lockfiles, package manifests and anything else outside the built app. A path with a file extension that is not in the build gets the 404 problem body. Any other non-API path serves the app, which renders the not-found page.
- **Dependencies at boot.** When MinIO, mail, the oracle, Svix or Gotenberg is unreachable at boot, the server starts normally and behaves as in Services. When Postgres is unreachable, the server retries every 2 seconds and the health check answers `starting`.

### Browser support and performance (DP-11, DP-46, DP-62)

- **Browsers.** Current Chromium, Firefox and WebKit, at the three viewports in Screens and layout.
- **Load.** On the seed data, each view is usable within three seconds of navigation.
- **Swap preview.** It shows the server's figures within half a second of the last keystroke.
- **Shock ruler.** Counters and tick fills update within a tenth of a second of each step.

## Working rules

- IF-01: `/app/run.json` exists, with string `install`, `build` and `serve` fields and `"_schema":"run-manifest-v1"`, and nothing else is needed to start the app.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`) and every bundled font, each with name, version and licence.
- IF-03: Every shipped package (as defined in IF-02) and every bundled font uses one of MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1.
- IF-04: The app stores state only in Postgres and MinIO: no SQLite, Redis, other databases or state files on disk.
- IF-05: The provided service configuration (the dev compose fragments, their images and their credentials) is left unchanged.
- IF-06: `package-lock.json` is committed, and the server and browser source is TypeScript compiled with strict type checking on.

## Engineering standards

- The code is idiomatic, strictly typed TypeScript, with no `any` in domain code and no non-null assertions to silence the compiler.
- Names match the domain terms in this brief: posting, leg, pool, share, position, health factor, liquidation price, round, grace, settlement, statement, notice, quote, oracle round, evidence and event.
- Each domain rule is decided in exactly one place in the server source. That includes the position state transitions, the health factor and liquidation price, pool figures from balances, the quote and fee split, oracle conversion and acceptance, staleness, desk formats and the retry-key handling. The browser renders server values and never recomputes them.
- All money, price and index arithmetic uses integers (bigint or equivalent) with the stated rounding. No floating-point value ever holds an amount, price, index or oracle mantissa.
- Every error, including the 500 handler and missing built files, leaves the server through one shared problem-details builder in the one published shape.
- Configuration comes only from environment variables, with no literal fallback for any service URL or credential.
- There is no abstraction with a single implementation, no pass-through wrapper, no dead, commented-out or unreachable code, and no defensive checks for states the rules make impossible.
- There are no features, endpoints or screens beyond this brief.
