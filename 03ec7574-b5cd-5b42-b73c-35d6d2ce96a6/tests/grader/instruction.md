# Corvo Treasury Console

Build Corvo, a treasury wallet console for a company's finance team, plus the public site that sells it. Signed-in members keep money in named wallets that each hold one asset. Every outgoing transfer passes through a policy of ordered rules, and the policy allows or denies it based on the destination, the amount, the time and a rolling spend total. A transfer at or above a wallet's approval floor reserves its funds and waits until a key quorum of named approvers signs it. The approval that reaches the threshold executes the transfer exactly once, even when approvals race. Every write lands in a hash-chained audit trail and a signed event log. Strict roles and full organization isolation apply throughout.

The public site has a landing page, a pricing page and a contact sales form. The only backing service is PostgreSQL, at `DATABASE_URL`.

Out of scope:
- self sign-up, password reset and any administrator above an organization
- real blockchains, signing, gas, swaps, cards, yield and bridging
- delivery of webhooks to outside addresses
- payment for plans
- any datastore other than PostgreSQL

Execution moves numbers between database rows and records a deterministic transaction hash.

## Problem and users

Finance teams that hold stablecoins and ether lose money in the same ways again and again:
- a payout sent twice because a request was retried
- a large payment approved by the person who asked for it
- a policy edit that silently changed the rules for a payment already waiting
- an audit log that nobody can prove is complete

Corvo makes each of these impossible to get wrong without being seen. The policy decides every transfer and names the deciding rule. Large payouts wait for distinct signers. Funds are reserved while a payout waits. Every movement is booked as two balancing ledger entries, and every write is chained into a verifiable audit trail.

Each member belongs to exactly one organization and holds exactly one role.

- **Visitor.** Reads the landing and pricing pages and asks sales for a call through the contact form. Reaches no console page and no signed-in endpoint.
- **`owner`.** Does everything an operator does. Also:
  - creates and edits wallets, and freezes and unfreezes them
  - writes policies, aggregations and key quorums
  - manages members and API keys
  - reads the audit trail and the signed event log
  - reads and rotates the signing secret
  - approves or rejects intents when they sit in the intent's quorum
- **`operator`.** Records deposits, sends transfers and payroll batches, and cancels pending requests they started.
- **`approver`.** Approves or rejects pending payouts of quorums that include them, from the approvals inbox.
- **`auditor`.** Reads every treasury record, the members and API keys, the audit trail and the signed event log. Verifies the chain and exports intents. Never writes.

Every member role can read wallets, intents, policies, aggregations, quorums and members. An API key carries the role `operator` or `auditor`, chosen by the owner who creates it. It acts inside that owner's organization only.

## Journeys

1. **A payout waits for two approvers.**
   - Start: the seed data at start.
   - Omar Patel (operator) opens the Operating USDC wallet page. He sends `15000` to `0x1111111111111111111111111111111111111111` with the memo `October hardware`.
   - He reads the waiting message. Available falls by `15000` while Balance stays.
   - On his own request he sees no Approve control anywhere.
   - Ada Byrne (approver) opens the approvals inbox and finds the row at 0 of 2 approvals. She presses Approve and reads the approved toast. The row leaves her inbox. She already approved the seeded waiting payout, so no row remains, and keyboard focus lands on the inbox's empty-state text from Feedback states.
2. **The deciding approval executes once.**
   - Ben Okoro and Nadia Owens press Approve on that row at the same moment.
   - Exactly one of them reads the executed toast. The other reads the server's refusal on the row.
   - On the intents page the intent reads `executed` with a transaction hash.
   - Operating USDC's Balance has fallen by `15000`, and the ledger holds one balancing pair for the payment.
3. **A policy blocks the burn address.**
   - Omar sends `100` to `0x000000000000000000000000000000000000dead`.
   - He reads a block message that names the rule `Block burn address`. His typed values stay in the form.
4. **Simulating a capped vendor.**
   - Nadia opens the Operating limits policy and simulates a `transfer` of `60000` from Operating USDC to `0x2222222222222222222222222222222222222222`.
   - She reads `DENY` with `no rule matched`, the revision evaluated, the daily outflow value and the per-rule trace. The daily cap no longer holds.
   - She then tightens the policy and saves it. A payout already waiting keeps the revision it was decided under.
5. **A payroll batch is one intent.**
   - Omar builds a three-line batch on Operating USDC: `4800` to `0x4444444444444444444444444444444444444444`, `4900` to `0x5555555555555555555555555555555555555555`, and `2500` to Payroll USDC's address.
   - He watches the running total read `12200 USDC` and submits.
   - The batch waits as one intent. After Ada and Ben approve it, every line has moved, and Payroll USDC's Balance has risen by `2500`.
6. **Freezing pauses execution, not exits.**
   - While a payout waits, Nadia freezes Operating USDC through the confirmation dialog.
   - Ada can still reject the payout with a reason, and Available is restored. Approve on another waiting payout is refused on its row.
7. **An auditor reads and proves the record.**
   - Uma Diaz (auditor) filters the intents list to Executed and pages with Load more. Each intent appears once.
   - She downloads the CSV. A wallet named with a leading equals sign stays inert text.
   - She opens the audit page and reads the verified chain line.
8. **A visitor asks sales.**
   - On the contact page, a visitor enters a free mail address and leaves Company empty, then sends.
   - Every invalid field shows its message, and focus lands on Work email.
   - After the fixes, the thanks line replaces the form and takes focus.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Reserved payouts wait at the floor.** A transfer at or above the approval floor of a wallet with a quorum waits as pending_approval with the quorum's members, threshold, expiry and the deciding policy revision copied in, and reserves its amount so Available falls while Balance stays.
- **DP-02 — Distinct approvers execute once.** Only members of the intent's quorum may decide it, never its initiator, never twice and never through an API key, one rejection rejects it, and the approval that reaches the threshold executes it in the same request without evaluating policy again.
- **DP-03 — Send and approve in the console.** An operator sends on the wallet page and reads the waiting message, approvers find the row in the approvals inbox with its progress, and the deciding approval shows the executed toast and removes the row.
- **DP-04 — Racing decisions have one winner.** Simultaneous final approvals, cancellations, rejections and freezes on one intent leave exactly one outcome, execute it at most once, and answer every loser with the conflict code named in Business rules.
- **DP-05 — No overdraw under races.** Racing transfers, batches, deposits and reservations never take a wallet's balance or available balance below zero, and available always equals balance minus the reserved amounts of its pending intents.
- **DP-06 — Idempotent writes.** A transfer, batch or deposit sent with an Idempotency-Key replays its stored first answer verbatim, refuses the key on another path or body, answers a key still in flight with 409 IDEMPOTENCY_KEY_IN_PROGRESS and forgets keys after the retention period, as qualified in Business rules.
- **DP-07 — Ordered policy evaluation with a trace.** A wallet's policy decides every transfer and batch line by its ordered rules in the five pinned steps under the revision live at server time, and the evaluate route reports the decision, the revision, the aggregation values and the per-rule trace while writing nothing.
- **DP-08 — Seeded policy decisions.** The seeded Operating limits policy blocks the burn address, caps the vendors by the daily outflow, allows the payroll sweep and payroll lines up to 5000, and denies everything else.
- **DP-09 — Denials reserve nothing.** A denied transfer creates no intent and reserves nothing, but appends one transfer.denied audit event and one signed event naming the deciding rule and the policy revision.
- **DP-10 — Send outcomes in words.** The Send form reports each outcome in its pinned words, names the deciding rule of a policy block, and keeps what was typed after a refusal.
- **DP-11 — Policy grammar and revisions.** A policy outside the grammar is 422 INVALID_POLICY naming the first offending path, every successful update raises revision by 1 and keeps each earlier revision readable, and deleting a policy in use is 409 POLICY_IN_USE.
- **DP-12 — Rule editor and Simulate.** The policy page lists the ordered rules with their condition fields, Simulate shows ALLOW or DENY with the deciding rule or no rule matched, the evaluated revision and the trace while writing nothing, and a refused save shows its path and keeps the edits.
- **DP-13 — Rolling aggregations.** An aggregation sums or counts a wallet's pending_approval and executed intents of its asset, optionally only those to the same destination, inside a rolling window of server time, plus the request being decided.
- **DP-14 — Expiry at the exact second.** A pending intent is expired from the server second equal to its expires_at, refuses decisions from that second, releases its reservation, leaves every aggregation and records exactly one intent.expired event, as qualified in Business rules.
- **DP-15 — Quorum snapshot.** Editing a key quorum never changes the members, threshold or expiry of an intent already waiting on it.
- **DP-16 — Rejection and cancellation.** A rejection with a reason, or a cancellation by the creator or an owner, ends a pending intent and releases its reservation, on a frozen wallet too.
- **DP-17 — Approvals inbox contents.** The approvals inbox lists, newest first, the own organization's pending_approval intents whose quorum includes the member, which the member did not start and has not decided.
- **DP-18 — Keyboard inbox and intents list.** In the console a reject needs a reason, focus moves as pinned after each decision, a refused approval keeps its row with the server's message, and the intents list pages with Load more in place, filters by status and expands rows into their details.
- **DP-19 — Frozen wallets pause execution.** A frozen wallet refuses new transfers, batches and approvals with 409 WALLET_FROZEN and records nothing for them, still accepts deposits, rejections, cancellations and expiry, and only an owner freezes or unfreezes it.
- **DP-20 — Transfer checks in order.** A transfer runs its checks in the pinned order and answers the first that fails.
- **DP-21 — Inline create row and freeze.** An owner creates a wallet from the inline row of the wallets table, reads its activity newest first, and freezes it through a confirmation dialog that swaps the Send form for the frozen banner.
- **DP-22 — Batches all or nothing.** A batch of 1 to 100 lines is refused whole on the first invalid, mismatched or denied line with its index or on an unaffordable total without one, and an accepted batch is one intent holding the total that executes every line together, crediting internal lines.
- **DP-23 — Small transfers execute at once.** A transfer below the floor, or on a wallet with no quorum, executes at once with its transaction hash and writes intent.created then intent.executed.
- **DP-24 — Exact amounts.** Amounts are exact integers of base units for the 6-decimal and 18-decimal assets, parsed from the pinned string form, refused with their codes when malformed, and returned both raw and in the canonical display form.
- **DP-25 — Addresses and checksums.** Addresses are derived from the wallet id, accepted in lowercase, uppercase or a correct EIP-55 mixed case, refused with INVALID_ADDRESS_CHECKSUM for a wrong mixed-case checksum, stored and returned lowercase, refused for self transfers and crossed assets, and credited to a sibling wallet when internal.
- **DP-26 — Unknown fields and text limits.** A body key the endpoint does not define is 422 UNKNOWN_FIELD, a missing or malformed field is 422 VALIDATION_ERROR naming the dotted path, and text lengths count code points after NFC with control characters refused, writing nothing.
- **DP-27 — App id, credential and role in order.** Every signed-in route checks the X-Corvo-Org header, then the credential, then the app id match, then the role, answering the first failure with its pinned status and code.
- **DP-28 — Roles read fresh on every request.** Every role and API key reads what its role reads, every call beyond its rights is 403 FORBIDDEN_ROLE with no row changed, and a role change applies on the member's next request.
- **DP-29 — API keys follow their creator.** An owner creates operator or auditor keys whose secret shows once and is never stored readable, a key acts only within its role and never approves, and a revoked key or a key whose creator was removed is 401 INVALID_CREDENTIAL.
- **DP-30 — Organization isolation.** Another organization's wallets, intents, policies, quorums, aggregations, members and API keys answer exactly like missing ones on every route, nested ids, filters and cursors included.
- **DP-31 — Members, quorum rules and the last owner.** Owners add, demote and remove members under the field rules, a removal ends that member's sessions and revokes their keys, quorums take 1 to 10 eligible members and a threshold within their count, quorum members cannot be demoted or removed, and an organization always keeps one owner even under racing changes.
- **DP-32 — Audit chain.** Every write, every denial and every expiry appends one audit event with a gapless seq whose hash recomputes from the previous hash and the canonical event.
- **DP-33 — Signed event log.** Payment events, expiry included, are appended to a signed event log whose signatures recompute from the signing secret current when each was written.
- **DP-34 — Quorums, audit and settings pages.** The quorums page reads thresholds as a of n, the audit page shows the chain status and the signed event log, and settings shows a new API key once and rotates the signing secret.
- **DP-35 — Seeded members sign in.** Every seeded member signs in with the seeded password and reads their member, role and organization from login and /api/v1/me.
- **DP-36 — Seeded treasury state, written once.** The seeded records read exactly as pinned in Seed data, are written once into an empty database under a lock, and are never written again on a later boot.
- **DP-37 — Bad credentials refused.** A wrong password, an unknown email or a removed member's email is 401 BAD_CREDENTIALS.
- **DP-38 — Sign out kills the token.** After sign out the old token answers 401 INVALID_CREDENTIAL.
- **DP-39 — Sign in and redirects.** Signed-out console routes land on sign in with a next path that is honoured only for same-origin /console paths, a wrong pair keeps the email, the session survives a reload and Sign out returns to /.
- **DP-40 — Wallet management.** Owners create and edit wallets with names of 1 to 60 code points unique per organization after normalisation and case folding, chain and asset never change, and wallets list by name.
- **DP-41 — Deposits.** A deposit credits the balance at once under a reference unique per wallet, on a frozen wallet too, and only owners, operators and operator keys record one.
- **DP-42 — Bound cursor pages.** The intents list pages newest first by a cursor bound to its filters and organization, returns every matching intent exactly once while intents are created, refuses a cursor reused elsewhere or altered with 422 INVALID_CURSOR, and never ends on an empty page.
- **DP-43 — Console overview and wallet page.** The overview shows the four stat cards over the wallets table, and the wallet page shows its facts with the Send, Deposit and Payroll batch forms only for operators and owners and Freeze wallet only for owners.
- **DP-44 — Landing page.** The landing page carries every pinned section, card, stat and case title in order, credits only invented names, shows no consent banner and calls no other host.
- **DP-45 — Header menus.** The four header menus open on click, Enter and Space, close on Escape, a click outside and a second click, return focus on Escape and open one at a time under a sticky frosted header.
- **DP-46 — Pricing page.** The pricing page carries both plan cards, the inclusions and the comparison matrix, takes no payment, sends Talk to sales to /contact, and its pricing questions open one at a time by pointer and keyboard.
- **DP-47 — Design language.** Pages are white with near-black display headings that close in a slate grey phrase, body text in Inter at four weights, a dark capsule that turns violet under the pointer, and cards on a soft shadow.
- **DP-48 — Motion and reduced motion.** Sections spring up once as they enter view, the hero panel's approval steps forward and back with scroll, linked cards lift on hover, a busy button turns a spinner that reads Working under reduced motion where nothing moves, and console pages never animate on scroll.
- **DP-49 — Not-found page and first paint.** An unknown address answers 404 with a link to /, and the public pages arrive as complete documents that link only to the app's own host and port.
- **DP-50 — Contact requests validated.** The contact route stores a valid request without credentials and refuses a request by its first invalid field in the pinned field order, whatever the JSON key order, with that field's path, free mail domains with the work email message.
- **DP-51 — Contact form errors and focus.** The contact form shows a refusal under every invalid field at once, marks each invalid and announced, keeps the typed values and focuses the first invalid field, and a valid send replaces the form with the thanks line and focuses it.
- **DP-52 — Accessibility contract.** Public and console pages meet WCAG 2.2 AA, every exposed image has a name, focus is visible on every control, dialogs trap and return focus, and status badges carry their words at AA contrast.
- **DP-53 — Phone layouts.** At 375 pixels wide no page scrolls sideways, the header Menu opens the links, and Approve stays inside the screen in a stacked console row.
- **DP-54 — Health and boot.** GET /api/health answers 200 {"status":"ok"} once the schema and seed are ready, sign in works the moment it does, and the server answers 503 instead of exiting while PostgreSQL is unreachable, recovering without a restart.
- **DP-55 — Envelope, request ids and timestamps.** Every /api response except the plain health route carries the envelope with a fresh lowercase version 4 request id, refusals carry an empty details object unless named, and every timestamp reads YYYY-MM-DDTHH:MM:SSZ.
- **DP-56 — PostgreSQL holds every record.** Every pinned table lives in PostgreSQL, no password, token or key secret is stored readable, and the public pages reference no outside host.
- **DP-57 — Core actions answer quickly.** A transfer, an approval and a policy evaluation over the seed data each answer within 500 milliseconds.
- **DP-58 — Paired ledger.** Every money movement writes exactly two ledger entries that sum to zero, and every wallet's balance equals the sum of its entries after every write.
- **DP-59 — Formula-safe intents export.** The intents CSV export lists the filtered intents with every cell that starts with a formula character neutralised, and the console shows such names and memos as plain text.
- **DP-60 — Audit verification.** The audit verify route recomputes the organization's chain and names the first broken seq, and the audit page shows its result.
- **DP-61 — Payroll batch builder.** On the wallet page an operator adds and removes batch lines, reads an exact running total, sees a refused line marked by its number with focus on its field, and submits the batch as one intent.
- **DP-62 — Request limits.** A body over 1,000,000 bytes is 413 PAYLOAD_TOO_LARGE, a body that is not JSON is refused with its pinned code, and nothing is written.
- **DP-63 — Rules decided once.** Each domain rule, from amount parsing to policy decisions, intent transitions, expiry and audit hashing, is decided in exactly one place in the source and reused by every route and page that needs it.

## Frontend

### Screens and layout (DP-03, DP-18, DP-21, DP-39, DP-43, DP-53, DP-61)

| Route | Purpose | Who |
|---|---|---|
| `/` | landing page | public |
| `/pricing` | plans, comparison matrix, pricing questions | public |
| `/contact` | contact sales form | public |
| `/login` | sign in | public |
| `/console` | overview: stat cards and the wallets table | any member |
| `/console/wallets/{id}` | wallet detail with Send, Deposit and Payroll batch | any member |
| `/console/approvals` | approvals inbox | any member |
| `/console/intents` | every intent with a status filter, Load more and Download CSV | any member |
| `/console/policies` | policy list | any member |
| `/console/policies/{id}` | rule editor, revision history and the Simulate panel | any member; saving is `owner` only |
| `/console/quorums` | key quorums and aggregations | any member; changes are `owner` only |
| `/console/audit` | audit trail, chain status and signed event log | `owner`, `auditor` |
| `/console/settings` | members, API keys, app id, signing secret | any member; changes are `owner` only |

**Entry and redirects.**
- Signed out, every `/console` route lands on `/login?next=<path>`.
- After sign in, the member returns to `next` when it is a same-origin path beginning with `/console`. Any other value, such as an absolute address or one starting with two slashes, is ignored and the member lands on `/console`.
- An operator or approver who opens `/console/audit` sees `You do not have access to this page` and nothing of that panel.
- A wallet, intent or policy id that does not exist in the member's own organization shows `Not found`, whether or not another organization owns it.
- The session survives a reload. Sign out returns to `/`.

**Console frame.** The console is a sidebar-nav workspace:
- A fixed left rail holds Overview, Approvals, Intents, Policies, Quorums, Audit and Settings. Approvals carries a count of the intents the member may decide. Audit appears for owners and auditors only.
- A top bar shows the organization name, the member's name and email, a role badge and `Sign out`.
- Every console list is a table.

**Screens.**
- **Overview.**
  - Four stat cards: `Total wallets`, `Pending intents`, `Awaiting your approval` and `Executed in 24 hours`. The last counts the organization's intents executed in the 86,400 seconds before the page was rendered, by server time.
  - Below them, the wallets table with the columns `Name`, `Chain`, `Asset`, `Balance`, `Available`, `Pending`, `Policy`, `Quorum` and `Status`.
  - Stat cards and the rail count update on every page load and after each decision made in the inbox.
- **Wallet page.**
  - The facts: name, full address with a Copy button, chain, asset, `Balance`, `Available`, `Pending`, the policy and quorum by name, the approval floor and the status badge.
  - For operators and owners on an active wallet: the Send form, the Deposit form and the Payroll batch builder. On a frozen wallet, Deposit stays and the frozen banner replaces Send and Payroll batch.
  - For owners: Freeze wallet or Unfreeze wallet.
  - Below: the activity table of deposits and intents, newest first.
- **Approvals inbox.** One row per intent. A row shows:
  - the wallet name
  - the destination shortened to its first 6 and last 4 characters, with the full address as its accessible description (for a batch, the line count instead)
  - the amount and asset, the memo, the initiator's name
  - the expiry moment as `YYYY-MM-DD HH:MM UTC`
  - the policy decision with its rule and `revision <n>`
  - a progress bar with the text `<a> of <n> approvals`, where `<a>` is the approvals recorded and `<n>` is `required_approvals`
- **Intents list.**
  - Shows 20 intents at a time, newest first.
  - Each row has id, wallet, kind, destination or line count, amount, status badge, initiator, created time and `<a> of <n>`.
  - Expanding a row shows:
    - the policy decision with `Decided under revision <n>`, where `<n>` is the intent's stored `policy_revision` (`No policy` when null)
    - each approval with name, decision and time
    - the rejection reason, the transaction hash and a batch's lines
- **Policy page.**
  - Rules in order, each with `Name`, `Method`, `Action` and every condition's `Field source`, `Field`, `Operator` and `Value`.
  - A revision history listing each revision with its time.
  - The Simulate panel.
- **Quorums page.**
  - Key quorums with members by name, the threshold as `<threshold> of <member count>`, expiry in hours, and the wallets using them.
  - Aggregations with metric, window in hours, asset, grouping, and the policies that reference them.
- **Audit page.**
  - Two tabs. The audit trail shows seq, time, type, actor, subject, and the first 12 characters of the hash, newest first, with the chain status line.
  - The signed event log shows seq, type, time and signature.
- **Settings.**
  - Organization name and app id with Copy, and the members table.
  - The API keys panel: name, role, prefix, creator, created and revoked times.
  - For owners only: the webhook signing secret panel.

**Viewports.**
- **1280 x 800.**
  - The console rail is fixed on the left and the work surface fills the rest.
  - Stat cards sit four in a row.
  - The wallet page puts the facts and activity in a wide left column. Send, Deposit and Payroll batch stack in a right column of about a third of the width.
  - The landing product cards use four columns.
- **768 x 1024.**
  - The rail collapses to icons with visible labels on focus and hover.
  - Stat cards sit two by two, and card grids use two columns.
  - The wallet page's forms move below the facts.
- **375 x 812.**
  - Everything is one column.
  - The public header shows the wordmark and a `Menu` button that opens a full-height sheet.
  - The console rail becomes a top bar with its own `Menu` button.
  - Console tables become stacked cards of label and value pairs. Approve and Reject sit side by side at the bottom of each inbox card, fully inside the screen.
  - The landing stats sit two by two, and the case cards scroll sideways inside their own row.

No page scrolls sideways at any of the three sizes.

### Public screens and controls (DP-10, DP-12, DP-34, DP-44, DP-45, DP-46, DP-51, DP-61)

Only the roles and accessible names below are public; everything else is yours.

| Where | Role and accessible name | Visible copy or behaviour |
|---|---|---|
| every page | `link "Skip to main content"` | first focusable element |
| every page | `status "Notifications"` | holds toasts |
| public header | `button "Products"`, `button "Solutions"`, `button "Developer"`, `button "Resources"` | each opens a panel of links with captions; `aria-expanded` reflects state |
| public header | `link "Pricing"` to `/pricing`, `link "Log in"` to `/login`, `link "Get started"` to `/login` | Log in is a white capsule, Get started the dark capsule |
| public header at phone width | `button "Menu"` | opens the full-height sheet |
| footer | `link "Contact"` to `/contact`, `link "Pricing"` to `/pricing` | columns `Product`, `Solutions`, `Developer`, `Resources`; lines `Money moves when the right people agree.` and `© 2026 Corvo Labs, Inc` |
| `/` hero | `heading` level 1 | `Hold, move and govern digital money on your rules`, closing phrase `on your rules` in slate |
| `/` hero | lead text | `Open wallets, write spending policies and route large payouts to the people who must sign, all in one console.` |
| `/` hero | `link "Get started"` to `/login`, `link "Contact sales"` to `/contact` | capsules |
| `/` hero | `region "Pending transfer preview"` with `progressbar "Approvals"` | drawn in markup: a transfer card reading `1 of 2 approvals` with a `pending_approval` badge |
| `/` | heading `One wallet layer for every money flow` | closing phrase `every money flow`; seven cards in this order, title then sentence: `Wallets for every customer` / `Give each user a wallet the moment they sign up.`; `Trading desks that keep pace` / `Settle fills and rebalance positions in seconds.`; `Treasury with guardrails` / `Route and spend company funds under written policies and named approvers.` (a link to `/console/approvals`); `Accounts for neobanks` / `Offer dollar balances with the controls a bank expects.`; `Payments by software agents` / `Let agents pay within limits that people set and can read.`; `Card spend from balances` / `Fund card purchases straight from wallet balances.`; `Yield on idle funds` / `Put balances that sit still to work under policy.` |
| `/` | stats row | `40M+` `wallets opened`, `85+` `countries`, `$5B+` `moved each month`, `99.95%` `uptime over the last year` |
| `/` | heading `Teams building on Corvo` | closing phrase `Corvo`; four case cards, not links: `Northline pays contractors in 60 countries from one Corvo treasury`, `Paygrid gives hourly workers dollar wallets on Corvo`, `Tidepool runs its trading desk settlements through Corvo`, `Fennick ships a self-custody wallet built with Corvo` |
| `/` | heading `Made for builders. Ready for auditors.` | closing phrase `Ready for auditors.`; four cards: `Keys kept apart` / `Signing keys live in isolated hardware with layered controls.`; `Use only what you need` / `Adopt wallets, policies or approvals one at a time.`; `Built to scale` / `Millions of wallets and transfers without a queue.`; `High-level building blocks` / `Policies, quorums and audit trails instead of raw keys.` |
| `/` | heading `Start in an afternoon. Ship this week.` | closing phrase `Ship this week.`; sentence `Open wallets, set policies and move your first payout today.`; both hero capsules again |
| `/pricing` | heading level 1 `Pricing that grows with you.` | lead `Start free, then pay for the active wallets and transfers you actually use.` |
| `/pricing` | `region "Developer"` | `For teams getting started. Every core feature, with 20,000 signatures and $250,000 in transfers free each month.`; tier table by active wallets: `Starter` `0 - 999` `Free`; `Growth` `1,000 - 4,999` `$249 / month`; `Scale` `5,000 - 19,999` `$649 / month`; `link "Get started"` to `/login` |
| `/pricing` | `region "Enterprise"` | `For platforms that need custom controls and global reach.`; `Custom rates per transfer or per active wallet`, `Uptime commitments and a named support lead`, `Webhooks, single sign-on and custom integrations`, `Volume pricing on signed transfers`; `link "Talk to sales"` to `/contact` |
| `/pricing` | text and list | `Trusted by 1,400+ finance teams.`; `Every plan includes` with `Embedded wallets`, `One sign-in for every app`, `Audited, compliant infrastructure`, `Usage-based billing`, `Reports and analytics`, `A console you can brand` |
| `/pricing` | `table "Feature comparison matrix"` | columns `Developer` and `Enterprise`; `Policy engine` and `Key quorum approvals` carry a check with the accessible name `Included` in both; `Single sign-on` reads `Add-on` under Developer and `Included` under Enterprise |
| `/pricing#pricing-questions` | `button "What counts as an active wallet?"`, `button "Do failed transfers count?"`, `button "Can we change plans later?"` | each opens its answer: a wallet with at least one transfer in the month; no, only executed transfers count; yes, at any time from the next month |
| `/login` | `textbox "Email"`, password field labelled `Password`, `button "Sign in"`, `alert` | heading `Sign in to Corvo`; the wrong-pair message from Feedback states |
| console | `navigation "Console"` with links `Overview`, `Approvals`, `Intents`, `Policies`, `Quorums`, `Audit`, `Settings`; `button "Sign out"`; at phone width `button "Menu"` | |
| `/console` | `table "Wallets"`, `button "Create wallet"` | inline row: `textbox "Name"`, `combobox "Chain"`, `combobox "Asset"`, `combobox "Policy"`, `combobox "Quorum"`, `textbox "Approval floor"`, `button "Save wallet"`, `button "Discard"` |
| wallet page | `button "Copy address"` | |
| wallet page | `form "Send"`: `textbox "Destination address"`, `textbox "Amount"`, `textbox "Memo"`, `button "Send"` | |
| wallet page | `form "Deposit"`: `textbox "Amount"`, `textbox "Reference"`, `button "Record deposit"` | |
| wallet page | `form "Payroll batch"`: per line `textbox "Line <k> destination"`, `textbox "Line <k> amount"`, `textbox "Line <k> memo"`, `button "Remove line <k>"`; `button "Add line"`; `status "Batch total"` reading `Total: <total> <ASSET>`; `button "Submit batch"` | `<k>` is the 1-based line number; it opens with one line |
| wallet page | `button "Freeze wallet"` opening `dialog "Freeze wallet"` with `button "Freeze"` and `button "Keep active"`; `button "Unfreeze wallet"` | dialog text `Freezing pauses new transfers and approvals. Deposits, rejections and cancellations still work.` |
| wallet page | `region "Frozen wallet"` | the frozen banner |
| wallet page | `table "Activity"` | |
| `/console/approvals` | each intent a `group "Intent <id>"` holding `button "Approve"` and `button "Reject"`; after Reject `textbox "Reason for rejecting"` and `button "Confirm reject"` | empty-state paragraph |
| `/console/intents` | `combobox "Status"` with `All`, `Pending approval`, `Executed`, `Rejected`, `Cancelled`, `Expired`; `table "Intents"`; per row `button "Details for <id>"`; `button "Cancel request"`; `button "Load more"`; `link "Download CSV"` | |
| policy page | `table "Rules"`; `button "Add rule"`, `button "Remove rule <k>"`, `button "Move rule <k> up"`, `button "Move rule <k> down"`, `button "Add condition to rule <k>"`, `button "Save policy"` | `<k>` is the 1-based rule number |
| policy page | `form "Simulate"`: `combobox "Method"`, `combobox "Wallet"`, `textbox "Destination address"`, `textbox "Amount"`, `button "Simulate"`; `status "Simulation result"` | the result shows `ALLOW` or `DENY`, the rule name or `no rule matched`, `Evaluated against revision <n>`, each aggregation as `<name>: <display value>`, and one trace line per rule reading `<rule>: matched`, `<rule>: not matched` or `<rule>: skipped (method)` |
| `/console/quorums` | `table "Key quorums"`, `table "Aggregations"`, `button "Create key quorum"`, `button "Edit <quorum name>"`, `button "Create aggregation"` | |
| `/console/audit` | `tablist` with `tab "Audit trail"` and `tab "Signed events"`; `status "Chain status"`; `button "Verify chain"` | |
| `/console/settings` | `table "Members"`, `button "Add member"`, per row `combobox "Role for <name>"`, `button "Remove <name>"` opening `dialog "Remove member"` with `button "Remove"` and `button "Keep member"` | |
| `/console/settings` | `table "API keys"`, `button "Create API key"`, `textbox "Key name"`, `combobox "Key role"`, `button "Revoke <key name>"`; signing secret panel with `button "Reveal"` and `button "Rotate"` | the new secret shows once beside `Copy this key now. It will not be shown again.` |
| `/contact` | heading `Contact sales`, lead `Talk to our team about building with Corvo`; `textbox "Full name"`, `textbox "Work email"`, `textbox "Company"`, `combobox "Monthly volume"` with `Under $1M`, `$1M to $10M`, `$10M to $100M`, `Over $100M`; `textbox "How can we help?"`; `button "Send message"` | |
| not-found page | `link "Back to home"` to `/` | heading `Page not found` |

No photograph, logo image, illustration or font file ships. Card art is an inline icon on a mist tile. Case art is a mist tile carrying the invented company name in the display face. There is no customer logo strip. No consent banner shows, because the site sets no tracking cookie.

### Interactions (DP-18, DP-21, DP-45, DP-46, DP-51, DP-52, DP-61)

- **Header menus.**
  - A panel opens on click, Enter or Space.
  - It closes on Escape, on a click outside and on a second click. Escape returns focus to its button.
  - Opening one closes any other.
- **Pricing questions.** Opening one closes the others. Each opens and closes with Enter and Space.
- **Pointer and focus feedback.**
  - The dark capsule turns violet under the pointer, and outlined capsules gain a violet border.
  - Inline links gain an underline.
  - Linked cards lift slightly on hover and on keyboard focus.
- **Inline create row.**
  - `Create wallet` opens the row at the top of the table and focuses `Name`.
  - `Save wallet` adds the wallet to the table in name order. `Discard` or Escape closes the row and returns focus to `Create wallet`.
- **Dialogs.**
  - The Freeze wallet and Remove member dialogs move focus to their safe button (`Keep active`, `Keep member`) when they open.
  - Tab and Shift+Tab stay inside the dialog.
  - Escape or the safe button closes the dialog without acting. Focus returns to the control that opened it.
- **Approvals inbox, keyboard only.**
  - `Approve` decides at once.
  - `Reject` reveals the reason field and moves focus into it. Escape hides the field and returns focus to that row's `Reject`.
  - `Confirm reject` with an empty reason keeps focus in the field and marks it invalid with the field message from Feedback states.
  - When a decided row leaves the inbox, focus moves to the next row's `Approve`. If the decided row was last, focus moves to the previous row's `Approve`. If no row remains, focus moves to the empty-state text, which accepts programmatic focus.
  - A refused decision keeps the row in place, shows the server's message inside it and keeps focus on the pressed button.
- **Intents list.**
  - `Load more` appends the next 20 intents in place and keeps focus on `Load more`, or moves focus to the first appended row's details button when no more remain and the button disappears.
  - Changing `Status` reloads the first page for that filter.
  - `Details for <id>` toggles the row's details.
  - `Cancel request` cancels a pending intent the member may cancel.
  - `Download CSV` downloads the export for the current filters.
- **Payroll batch builder.**
  - `Add line` appends a line and focuses its destination. `Remove line <k>` removes that line, renumbers the rest and focuses the next line's destination, or `Add line` when none follows. The last remaining line cannot be removed, so its Remove button is disabled.
  - When an amount field loses focus with text that is not a valid amount, that line shows its amount message from Feedback states.
  - The running total updates on every keystroke. It is computed exactly from the valid amounts, without rounding, and shows `Total: 0 <ASSET>` when none are valid.
  - On a refusal that names an index, the line numbered index plus one is marked invalid on the field the server named, and focus moves to that field.
- **Policy editor.**
  - Owners add, remove and reorder rules and conditions in place, then save.
  - A refused save keeps every edit and focuses the field matching the refusal path when one exists.
  - Simulate evaluates the saved revision, never unsaved edits.
- **Contact form.**
  - A refused send moves focus to the first invalid field in form order: Full name, Work email, Company, Monthly volume, How can we help?
  - A valid send replaces the form with the thanks line and moves focus to it.
- **Keyboard everywhere.** Every control works from the keyboard, and Tab order follows reading order.

Every page and form works as a plain document first. Small scripts written for each page then upgrade the delivered HTML in place for:
- the header menus and the pricing questions
- the inline create row and the dialogs
- the Send, Deposit and Payroll batch forms
- the approvals inbox, the rule editor and Simulate
- Load more and the toasts

### Visual design (DP-47, DP-52)

The idea is a bright, quiet treasury desk. Every number is exact, and every signature takes a deliberate press.

**Colour roles.**

| Role | Colour in words | Used for |
|---|---|---|
| paper | white | page, cards, inputs |
| mist | very light cool grey | alternating section bands, the console rail, table header rows, icon tiles |
| haze | light cool grey with a hint of violet | selected rows, chip backgrounds |
| ink | near-black with a trace of blue | headings, primary text, the dark capsule |
| graphite | dark grey with a trace of blue | secondary body copy |
| slate | mid grey with a trace of blue | the closing phrase of every display heading, captions, helper text |
| line | very light grey with a trace of violet | dividers, card and input borders |
| violet | electric blue-violet | dark capsule hover fill, the focus ring, the active rail item, console link hover |
| violet tint | light lavender | approval progress fill, selected chip text background |
| success | soft teal mint fill with dark green text | the `executed` and `active` badges |
| danger | strong red, with white text on its fills | `rejected` badges, denials, error text |
| info | clear blue fill with dark blue text | the `pending_approval` badge |
| muted | light grey fill with dark grey text | `cancelled`, `expired` and `frozen` badges |

Every display heading ends in slate, so the first half reads as the statement and the closing phrase as the subject.

**Type.**
- Display headings use Helvetica Neue, falling back to Arial and then the system sans. They are set at the regular weight with slightly tight letter spacing.
- Everything else uses Inter, falling back to the system sans, at light, regular, medium and semibold.
- The hero heading is roughly four times the body size and holds on at most two lines on a wide screen. Section headings are about two and a half times the body size, and card headings about one and a quarter times.
- Console tables use a compact body size with tabular figures so amounts align.

**Shape and density.**
- Buttons and chips are full capsules. Cards are gently rounded, and inputs and menus a little less.
- Cards float on a soft, wide, faint shadow.
- Public pages are airy with generous section padding. The console is compact.
- Every control is at least 44 pixels tall and wide on touch layouts.

**Icons.** All icons are drawn inline:
- a diamond brand mark beside the wordmark
- an arrow on every call to action that leads to another page
- a small bar chart on the stats row and the overview
- a tick list on the Approvals rail item
- a rounded card on wallet rows
- two crossing arrows on Send and on intent rows
- a down chevron on menus and pricing questions

Icons that only decorate are hidden from assistive technology. An icon that is a control's only content gives the control its name.

**Contrast.** WCAG 2.2 AA throughout. Text, including every badge word on its fill and every button label, has at least 4.5 to 1 contrast. The focus ring and control borders have at least 3 to 1. Status is never shown by colour alone: every badge prints its word.

### Motion and effects (DP-48)

Motion is short and springy, and every motion means something.

| Name | Meaning | Feel and timing | Where |
|---|---|---|---|
| spring-rise | a section entering view | rises from a little below, overshoots its resting place a touch and settles, in a little over half a second; it fades in faster than it rises | each landing and pricing section the first time a fifth of it is visible, never again on that page view |
| blur-in | a headline arriving | each word sharpens from a soft blur in under half a second, words starting about a twentieth of a second apart | hero lead and display headings, once on load or on entry |
| card-lift | "this is pressable" | lifts a few pixels in about a fifth of a second, settling back on leave | linked cards on hover and keyboard focus |
| pill-fill | hover or press on a capsule | fill and border colour ease over about a sixth of a second | every capsule |
| spinner | a request in flight | one even turn about every eight tenths of a second, for as long as the request runs | a busy button |
| progress-fill | an approval landing | the bar grows to its new length in under half a second with the same slight overshoot | approval progress bars in the inbox |
| toast | feedback arriving and leaving | slides up a short distance and fades in in about a quarter of a second, and leaves the same way after five seconds | the Notifications region |

**Signature interaction: the hero approval scrubs with scroll.**
- At the top of the landing page, the hero panel reads `1 of 2 approvals` with its bar half full and a `pending_approval` badge.
- As the page scrolls through its first 400 pixels, the bar grows in proportion, from half full at 0 to full at 400.
- When the scroll passes 200 pixels, a second approver dot appears, the text changes to `2 of 2 approvals` and the badge changes to `executed`.
- Scrolling back reverses each step at the same points. Above 200 pixels the panel again reads `1 of 2 approvals` and `pending_approval`, and the bar shrinks in proportion.

Console pages never animate on scroll. No other looping or decorative animation exists; the spinner is the only loop, and only while a request is in flight.

**Reduced motion.** When the user prefers reduced motion:
- every section rests in its final place with no blur
- cards stay put on hover and focus, with only their border changing colour
- capsule colours change at once
- the progress bar jumps to its new length
- toasts appear and leave without sliding
- the busy button shows the word `Working` in place of the spinner
- the hero panel stays at `1 of 2 approvals` and does not change with scroll

Nothing is hidden or lost.

### Feedback states (DP-03, DP-10, DP-18, DP-21, DP-34, DP-51, DP-52, DP-61)

**How each async action reports.**
- **Pending.** The pressed button is disabled and busy, and shows the spinner (or `Working`) until the answer arrives.
- **Success.** The toast below is announced in the `Notifications` status region.
- **Field error.** The server's message appears under the field named by `details.field`. The field is marked invalid and described by that message, and the message is announced in `Notifications`. Every typed value is kept.
- **Database outage.** On a `503` `DATABASE_UNAVAILABLE`, the toast reads `Corvo can't reach its database. Nothing was changed. Try again in a moment.` and the form keeps its values.

**Toasts.**
- `Wallet created`, `Wallet frozen`, `Wallet unfrozen`
- `Approved: <a> of <n> approvals`
- `Transfer executed` after the deciding approval of a transfer, and `Batch executed` after the deciding approval of a batch
- `Intent rejected`, `Intent cancelled`, `Deposit recorded`
- `Policy saved, revision <n>`, where `<n>` is the new revision
- `Key quorum saved`, `Aggregation created`
- `Member added`, `Member updated`, `Member removed`
- `API key created`, `API key revoked`
- `Signing secret rotated`, `Address copied`

**Send outcomes, shown in the form's result line and announced.**
- an immediate execution: `Transfer executed`
- a waiting transfer: `Waiting for approval: 0 of <n> approvals`
- a named-rule denial: `Blocked by policy rule <rule name>`
- a default denial: `Blocked by policy: no rule allowed this transfer`
- `INSUFFICIENT_FUNDS`: `Not enough available balance`

**Payroll batch outcomes.**
- `Batch executed`
- `Batch waiting for approval: 0 of <n> approvals`
- `Line <k> blocked by policy rule <rule name>`
- `Line <k> blocked by policy: no rule allowed it`
- `Not enough available balance`
- an amount that is not a valid amount when its field loses focus: `Enter an amount like 1250 or 0.5`

**Other messages.**
- Sign in: a wrong pair shows `Email or password is incorrect` in the alert and keeps the email.
- Inbox: an empty reason shows `Enter a reason to reject` under the field.
- Policy editor: a refused save shows the server's message followed by `at <details.path>`.

**Empty states.** `Nothing waiting for your approval`, `No intents yet`, `No deposits or intents yet`.

**Status badges.** The word is printed: `pending_approval`, `executed`, `rejected`, `cancelled`, `expired`, `active`, `frozen`.

**Frozen banner.** `This wallet is frozen. New transfers and approvals are paused.`

**Amounts on screen.** The display form followed by the asset in capitals, for example `238000 USDC` or `12.5 ETH`. Times on screen read `YYYY-MM-DD HH:MM UTC`.

**Chain status.**
- The page shows `Chain verified: <count> events` or `Chain broken at event <seq>` from the verify route.
- It loads with the page and refreshes when `Verify chain` is pressed.

**Contact messages.**
- `full_name`: `Enter your full name (2 to 80 characters)`
- `work_email`: `Enter a valid email address`, or `Use your work email` for a free mail domain
- `company`: `Enter your company name (2 to 120 characters)`
- `monthly_volume`: `Choose a monthly volume`
- `message`: `Tell us a little more (10 to 2000 characters)`
- a control character in any field: `Remove control characters from this field`

The thanks line reads `Thanks. Our team will reply within one business day.`

## Backend

### API (DP-26, DP-27, DP-28, DP-30, DP-54, DP-55, DP-59, DP-60, DP-62)

**Content type.** Requests with a body send `Content-Type: application/json`. Other media types are `415` `UNSUPPORTED_MEDIA_TYPE`.

**Body size.** A body larger than 1,000,000 bytes is `413` `PAYLOAD_TOO_LARGE`; exactly 1,000,000 bytes is allowed.

**Malformed bodies.**
- A body that is not valid JSON is `400` `MALFORMED_JSON`.
- Valid JSON that is not an object is `422` `VALIDATION_ERROR` with `details.field` `body`.
- A route that takes no body accepts an empty body or `{}`.

**Envelope.** Every `/api` response is
`{"success": bool, "data": object|null, "error": {"code","message","details"}|null, "meta": {"request_id"}}`. There are two exceptions:
- `GET /api/health`, which answers the plain object below
- the CSV body of the export route

Every response, refusals and replays included, carries a fresh lowercase version 4 UUID in `meta.request_id`. A refusal has `success` false, `data` null, a code, a message a person can read and `details`. `details` is an object that stays empty unless this brief names its keys.

**Timestamps.** Every timestamp is UTC as `YYYY-MM-DDTHH:MM:SSZ`.

**Credentials.**
- `POST /api/v1/auth/login` returns a bearer token for `Authorization: Bearer <token>`. API keys are sent the same way.
- Every route except login, contact and the health routes also sends `X-Corvo-Org: <app id>`.

**Error precedence, for the whole API.** Each request stops at the first failing step:
1. size, media type and JSON parse (`413`, `415`, `400`)
2. a missing `X-Corvo-Org`: `400` `APP_ID_REQUIRED`
3. no credential: `401` `UNAUTHENTICATED`. A bearer value that is neither a live session token nor a live API key: `401` `INVALID_CREDENTIAL`.
4. an app id that is not the caller's organization's: `403` `APP_ID_MISMATCH`
5. the route's role step: `403` `FORBIDDEN_ROLE`. It runs before any lookup. On approve and reject this step admits every member and every key.
6. on routes that accept `Idempotency-Key`: the header check, then the idempotency record (in flight, replay or reuse)
7. lookup of the path resource. An id of another organization answers exactly like a missing one, with identical status, code, message and details.
8. body checks: `UNKNOWN_FIELD` over the whole body first, then each field in the route's pinned field order, whatever order the JSON keys arrive in. The pinned field order is the order Business rules gives for that route. Where Business rules gives none, it is the order of the route's Request column in the table below.
9. the route's decision checks, in the order Business rules gives for that route: state conflicts, permissions on the resource, policy, then funds

Rows below name only their own codes.

**Shapes.**
- **Wallet:** `{id, name, chain, asset, address, balance, balance_raw, reserved, reserved_raw, available, available_raw, policy_id, quorum_id, approval_floor, approval_floor_raw, status, created_at}`
- **Intent:** `{id, wallet_id, kind, destination_address, amount, raw_amount, memo, status, created_by, required_approvals, quorum_member_ids, approvals: [{member_id, decision, reason, created_at}], policy_decision: {action, rule, reason, policy_id, policy_revision}, created_at, expires_at, decided_at, executed_at, tx_hash, rejection_reason, items}`
  - `items` is a list of `{position, destination_address, amount, raw_amount, memo}` for a batch, and empty for a transfer.
  - Every listed field is present, and null when it has no value.
- **Member:** exactly `{id, name, email, role, created_at}`
- **API key:** exactly `{id, name, role, prefix, created_by, created_at, revoked_at}`. No response ever carries a password, a password hash, a token hash or a key secret, except the one-time `secret` at key creation.

"Readers" means every member role and API keys of both roles.

| Endpoint | Who | Request | `data` on success; own errors |
|---|---|---|---|
| `GET /api/health` | anyone | none | plain `{"status":"ok"}` with `200`; see Server boundary |
| `GET /api/v1/health` | anyone | none | `{status: "ok"}` |
| `POST /api/v1/auth/login` | anyone | `{email, password}` | `{token, member, organization: {id, name, app_id}}`; `401` `BAD_CREDENTIALS` |
| `POST /api/v1/auth/logout` | member | none | `{}` |
| `GET /api/v1/me` | any credential | none | `{member, api_key, organization}`, one of `member` and `api_key` null |
| `POST /api/v1/contact` | anyone | `{full_name, work_email, company, monthly_volume, message}` | `201` `{id, created_at}` |
| `GET /api/v1/wallets` | readers | none | `{wallets: [wallet]}` sorted by name, by code point after NFC |
| `GET /api/v1/wallets/{id}` | readers | none | wallet |
| `POST /api/v1/wallets` | `owner` | `{name, chain, asset, policy_id, quorum_id, approval_floor}`; the last three optional | `201` wallet; `404` `POLICY_NOT_FOUND`, `QUORUM_NOT_FOUND` |
| `PATCH /api/v1/wallets/{id}` | `owner` | any of `{name, policy_id, quorum_id, approval_floor}`; null detaches policy or quorum | wallet |
| `POST /api/v1/wallets/{id}/freeze` | `owner` | none | wallet |
| `POST /api/v1/wallets/{id}/unfreeze` | `owner` | none | wallet |
| `POST /api/v1/wallets/{id}/transfers` | `owner`, `operator`, operator key | `{destination_address, amount, memo}`; `memo` optional, default empty | `201` intent |
| `POST /api/v1/wallets/{id}/batches` | `owner`, `operator`, operator key | `{items: [{destination_address, amount, memo}]}` | `201` intent |
| `POST /api/v1/wallets/{id}/deposits` | `owner`, `operator`, operator key | `{amount, reference}` | `201` `{id, wallet_id, amount, raw_amount, reference, created_by, created_at}` |
| `GET /api/v1/intents` | readers | query `status`, `wallet_id`, `limit`, `cursor` | `{items: [intent], next_cursor}`; `422` `INVALID_CURSOR` |
| `GET /api/v1/intents/export` | readers | query `status`, `wallet_id` | CSV, described below |
| `GET /api/v1/intents/{id}` | readers | none | intent |
| `POST /api/v1/intents/{id}/approve` | members in its quorum | none | intent |
| `POST /api/v1/intents/{id}/reject` | members in its quorum | `{reason}` | intent |
| `POST /api/v1/intents/{id}/cancel` | its creator, `owner` | none | intent |
| `GET /api/v1/approvals/inbox` | members | none | `{items: [intent]}` |
| `GET /api/v1/policies` | readers | none | `{policies: [policy]}` by name |
| `POST /api/v1/policies` | `owner` | `{version, name, chain_type, rules}` | `201` policy `{id, version, name, chain_type, rules, revision, created_at, updated_at}` |
| `GET /api/v1/policies/{id}` | readers | none | policy at its live revision |
| `GET /api/v1/policies/{id}/revisions` | readers | none | `{revisions: [{revision, name, rules, created_at}]}` ascending |
| `PATCH /api/v1/policies/{id}` | `owner` | any of `{name, rules}` | policy |
| `DELETE /api/v1/policies/{id}` | `owner` | none | `{deleted: true}` |
| `POST /api/v1/policies/{id}/evaluate` | readers | `{method, wallet_id, destination_address, amount}` | `{action, rule, reason, policy_id, policy_revision, aggregations: {<aggregation id>: <raw value string>}, trace: [{rule, considered, matched, conditions: [bool]}]}` |
| `GET /api/v1/aggregations` | readers | none | `{aggregations: [{id, name, metric, window_seconds, asset, group_by, created_at}]}` |
| `POST /api/v1/aggregations` | `owner` | `{name, metric, window_seconds, asset, group_by}`; `group_by` optional, default `wallet` | `201` aggregation |
| `GET /api/v1/quorums` | readers | none | `{quorums: [{id, name, member_ids, authorization_threshold, expiry_seconds, created_at}]}` |
| `POST /api/v1/quorums` | `owner` | `{name, member_ids, authorization_threshold, expiry_seconds}` | `201` quorum |
| `PATCH /api/v1/quorums/{id}` | `owner` | any of those four fields | quorum |
| `GET /api/v1/members` | readers | none | `{members: [member]}` by email |
| `POST /api/v1/members` | `owner` | `{name, email, role, password}` | `201` member |
| `PATCH /api/v1/members/{id}` | `owner` | `{role}` | member |
| `DELETE /api/v1/members/{id}` | `owner` | none | `{removed: true}` |
| `GET /api/v1/api-keys` | `owner`, `auditor`, auditor key | none | `{api_keys: [api key]}` by creation |
| `POST /api/v1/api-keys` | `owner` | `{name, role}` | `201` `{id, name, role, prefix, secret, created_by, created_at}` |
| `DELETE /api/v1/api-keys/{id}` | `owner` | none | `{revoked: true}` |
| `GET /api/v1/audit` | `owner`, `auditor`, auditor key | query `after_seq`, `limit` (1 to 500, default 100) | `{events: [{seq, type, actor, subject_id, at, data, prev_hash, hash}]}` by seq ascending |
| `GET /api/v1/audit/verify` | `owner`, `auditor`, auditor key | none | `{valid, events, first_broken_seq}` |
| `GET /api/v1/webhooks/secret` | `owner` | none | `{secret}` |
| `POST /api/v1/webhooks/secret/rotate` | `owner` | none | `{secret}` |
| `GET /api/v1/webhooks/events` | `owner`, `auditor`, auditor key | query `after_seq`, `limit` (1 to 500, default 100) | `{events: [{id, seq, type, created_at, timestamp, body, signature}]}` by seq ascending |

**Not found codes.** `WALLET_NOT_FOUND`, `INTENT_NOT_FOUND`, `POLICY_NOT_FOUND`, `QUORUM_NOT_FOUND`, `MEMBER_NOT_FOUND`, `API_KEY_NOT_FOUND`. A body's top-level `wallet_id`, `policy_id` or `quorum_id` outside the caller's organization answers its not found code with `404`. A `wallet_id` query filter outside the organization matches nothing.

**Export format.**
- Status `200`. `Content-Type: text/csv; charset=utf-8` and `Content-Disposition: attachment; filename="corvo-intents.csv"`.
- A header row, then every matching intent in the list order. Lines end with a carriage return and line feed.
- Columns: `id,wallet_id,wallet_name,kind,destination_address,amount,asset,status,created_by,created_at,executed_at,tx_hash,memo`.
- A cell that contains a comma, a double quote or a line break is quoted, with quotes doubled.
- A cell whose first character is `=`, `+`, `-`, `@`, a tab or a carriage return is prefixed with a single quote `'`.

A refused call answers with the status and code this brief names. Where no status is named, it answers a 4xx of your choosing: never a server error and never a silent success.

### Business rules (DP-01 to DP-33, DP-35 to DP-42, DP-50, DP-58)

**Amounts.**
- A request amount is a JSON string matching `^(0|[1-9][0-9]*)(\.[0-9]+)?$`. It is held as an exact integer of base units: `usdc` has 6 decimals and `eth` has 18.
- Refusals, each with `details.field`:
  - any other value, a JSON number included: `422` `INVALID_AMOUNT`
  - more fractional digits than the asset allows: `422` `AMOUNT_PRECISION`
  - zero: `422` `AMOUNT_NOT_POSITIVE`. `approval_floor` is the exception and allows zero.
  - more than 1,000,000,000 whole units: `422` `AMOUNT_TOO_LARGE`. Exactly 1,000,000,000 is allowed.
- Responses give every amount twice:
  - as a raw integer string (`raw_amount`, `balance_raw`, `reserved_raw`, `available_raw`, `approval_floor_raw`)
  - as a display string: the integer part, then, only when the fraction is not zero, a dot and the fraction with trailing zeros removed
- For example, `usdc` raw `12000000000` displays `12000`, raw `1500000` displays `1.5` and raw `1` displays `0.000001`. `eth` raw `1250000000000000001` displays `1.250000000000000001`.
- No floating point value takes part in parsing, comparing, summing or formatting an amount.

**Addresses.**
- A wallet's address is `0x` plus the first 40 hex characters of the SHA-256 digest of `corvo:` followed by the wallet id.
- An address is `0x` plus 40 hex digits, else `422` `INVALID_ADDRESS`.
- All-lowercase and all-uppercase hex digits are accepted. A mixed-case address must equal its EIP-55 checksum form, else `422` `INVALID_ADDRESS_CHECKSUM`. The checksum hashes the lowercase hex with Keccak-256: the original Keccak padding, not NIST SHA3-256. For example, `0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed` is accepted, and the same address with any one letter's case flipped is refused.
- Where the checks apply and how they report:
  - transfers and evaluate: `details.field`
  - batch lines: `details.index` and `details.field`
  - policy condition values: `INVALID_POLICY` with the bracketed path
- Addresses are lowercased before they are stored, compared or returned.
- A destination equal to the source wallet's address is `422` `SELF_TRANSFER`.
- A destination equal to another wallet of the same organization is internal: execution credits that wallet. If the other wallet's chain or asset differs, the request is `422` `ASSET_MISMATCH`.

**Text fields and limits.**
- Every text field is normalised to Unicode NFC and then measured in code points.
- Names and references are trimmed of leading and trailing whitespace before measuring and storing. This covers wallet, policy, rule, aggregation, quorum, member and API key names, deposit references, and the contact `full_name` and `company`.
- Any C0 or C1 control character in a text field is `422` `VALIDATION_ERROR` on that field. Line breaks count as control characters. The contact `message` is the one exception: its carriage return and line feed pairs become single line feeds, and line feeds are allowed.
- Limits, all inclusive:

| Field | Code points |
|---|---|
| wallet name | 1 to 60 |
| policy, rule, aggregation, quorum and member names | 1 to 80 |
| API key name | 1 to 60 |
| memo | 0 to 140 |
| reject reason | 1 to 280, with at least one non-whitespace character |
| deposit reference | 1 to 64 |
| contact `full_name` | 2 to 80 |
| contact `company` | 2 to 120 |
| contact `message` | 10 to 2000 |

- For example, a memo of 140 `💸` is accepted and 141 is refused. A memo of 140 `e` each followed by a combining acute accent is stored as 140 `é`.
- Wallet names are unique per organization after NFC and Unicode default case folding, so `operating usdc`, or `STRASSE` against an existing `Straße`, is `409` `WALLET_NAME_TAKEN`.
- Text is stored and returned as sent after normalisation and trimming. It is always shown as plain text, never interpreted as markup or a formula.

**Field rules.**
- **Body checks.** A body key the endpoint does not define, at any depth, is `422` `UNKNOWN_FIELD` with the dotted `details.field`, such as `items.2.extra`. A missing or malformed field is `422` `VALIDATION_ERROR` with the dotted path of the first offending field in the route's pinned field order (see the error precedence in API), such as `items.2.destination_address`.
- **Wallets.**
  - `chain` is `ethereum` or `base`, and `asset` is `usdc` or `eth`. Neither ever changes.
  - A new wallet starts at balance 0. `approval_floor` defaults to 0.
- **Members.**
  - `email` is trimmed, lowercased and unique across all organizations. A taken email is `409` `MEMBER_EXISTS`.
  - `role` is `owner`, `operator`, `approver` or `auditor`.
  - An initial `password` has at least 12 code points.
- **API keys.** `role` is `operator` or `auditor`; anything else is `422` `VALIDATION_ERROR` on `role`. The secret is `cvo_` followed by 40 lowercase hex digits, and `prefix` is its first 12 characters.
- **Aggregations.** `metric` is `sum_amount` or `count`. `window_seconds` is 60 to 2,592,000. `asset` is `usdc` or `eth`. `group_by` is `wallet` or `destination`.
- **Key quorums.**
  - `member_ids` lists 1 to 10 distinct members of the organization whose role is `owner` or `approver`, else `422` `INVALID_QUORUM_MEMBER`.
  - `authorization_threshold` runs from 1 to the member count, else `422` `INVALID_THRESHOLD`.
  - `expiry_seconds` is 60 to 2,592,000.
- **Deposits.** `reference` is unique per wallet, else `409` `DUPLICATE_DEPOSIT`.
- **Contact.**
  - `work_email` is a valid address. The domains `gmail.com`, `yahoo.com`, `outlook.com` and `hotmail.com` are refused with the message `Use your work email`.
  - `monthly_volume` is one of the four options.
  - The route's pinned field order is `full_name`, `work_email`, `company`, `monthly_volume`, `message`. The route reports only the first invalid field in that order, whatever the JSON key order, as `422` `VALIDATION_ERROR`. The `/contact` page instead checks every field and shows all refusals at once.
- **Idempotency-Key.** An empty value, more than 128 characters, or any character outside printable ASCII is `422` `VALIDATION_ERROR` with `details.field` `Idempotency-Key`.

**Policies.**
- A policy has `version` (always the JSON string `"1.0"`), `name`, `chain_type` (the JSON string `"ethereum"`) and 1 to 50 `rules`.
- A rule is `{name, method, conditions, action}`:
  - `name` is unique within the policy
  - `method` is `transfer`, `batch_payout` or `*`
  - `action` is `ALLOW` or `DENY`
  - `conditions` is a list of 0 to 20 conditions
- A condition is `{field_source, field, operator, value}`:

| field_source | field | value |
|---|---|---|
| `request_body` | `destination.address` | address string |
| `request_body` | `source.asset` | `usdc` or `eth` |
| `request_body` | `source.chain` | `ethereum` or `base` |
| `request_body` | `source.amount` | raw integer |
| `system` | `current_unix_timestamp` | integer seconds |
| `reference` | `aggregation.<aggregation id of the same organization>` | raw integer or count |

- **Operators.**
  - The operators are `eq`, `neq`, `lt`, `lte`, `gt`, `gte` and `in`.
  - `lt`, `lte`, `gt` and `gte` are legal only on `source.amount`, `current_unix_timestamp` and aggregation fields. Their value is a non-negative integer given as a JSON integer or a digit string, compared exactly. `eq` and `neq` on those fields compare the same way.
  - `in` takes a list of 1 to 100 strings.
- **Check order.** Create and update check in this order, stopping at the first failure:
  1. unknown keys over the whole body: `UNKNOWN_FIELD`
  2. `version` (create only): `422` `INVALID_POLICY` with `details.path` `version`. The JSON number `1.0` and a missing value both fail.
  3. `name`: `VALIDATION_ERROR` on `name`
  4. `chain_type` (create only): `INVALID_POLICY` with path `chain_type`
  5. `rules`
- **Inside `rules`.** Every defect other than an unknown key is `422` `INVALID_POLICY` with a bracketed `details.path` naming the first offending element, such as `rules[1].conditions[0].operator` or `rules[0].name`. A rule count outside 1 to 50 has the path `rules`. A missing key, a wrong type, a value outside the grammar, a bad address checksum and an aggregation id not in the organization all fall here.
- **Revisions.**
  - A new policy has revision 1. Every successful update raises `revision` by exactly 1 and keeps the earlier revision readable through the revisions route.
  - The revision live at a server moment is the latest revision saved at or before it. An edit applies from the next transfer or evaluation.
- Deleting a policy that a wallet uses is `409` `POLICY_IN_USE`.

**Policy evaluation.**
- A request is evaluated against `{"source": {"asset", "chain", "amount"}, "destination": {"address"}}`, where `amount` is the raw integer.
- The method is `transfer` for a transfer and `batch_payout` for each batch line.
- Evaluation uses the policy's live revision at server time now. The browser's clock and time zone never enter.

The five steps:
1. A wallet with no policy allows: `{"action":"ALLOW","rule":null,"reason":"no_policy","policy_id":null,"policy_revision":null}`.
2. Only rules whose method is the request's method, or `*`, are considered. A rule matches when every condition is true. A rule with no conditions always matches.
3. If a considered `DENY` rule matches, the decision is `DENY` with the name of the first matching `DENY` rule in policy order and reason `matched_rule`.
4. Otherwise, if a considered `ALLOW` rule matches, the decision is `ALLOW` with the first matching `ALLOW` rule's name and reason `matched_rule`.
5. Otherwise the decision is `{"action":"DENY","rule":null,"reason":"default_deny"}` with the policy id and revision.

**The evaluate route.**
- It evaluates the named policy for the named wallet, whether or not the wallet uses that policy, and writes nothing.
- An `aggregations` entry appears for every aggregation the policy references.
- `trace` has one entry per rule, in policy order:
  - A rule whose method does not apply has `considered` false, `matched` false and `conditions` empty.
  - A considered rule lists each condition's truth in order, and `matched` is true exactly when all of them are true.

**Aggregation values.** For a request on wallet W with destination D at server time T:
- The value covers W's intents in the aggregation's asset with status `pending_approval` or `executed`, created later than T minus the window and not after T.
- With `group_by` `wallet`:
  - `sum_amount` is the sum of their raw amounts plus the request's raw amount
  - `count` is their number plus 1
- With `group_by` `destination`, only transfers to D and batch lines to D count:
  - `sum_amount` is the sum of those transfers' amounts and those lines' amounts, plus the request's
  - `count` is the number of such transfers and lines, plus 1
- For a batch line, the request contributes the raw amounts of the batch's lines up to and including that line (only those to D under `destination`), and 1 for `count`.
- Denied, rejected, cancelled and expired intents and deposits never count.
- A wallet whose asset differs from the aggregation's asset gives the value 0, and the request adds nothing.

For example, with the seed data at start, evaluating `60000` to the `0x2222…` vendor from `wal_operating` gives `Daily outflow` 72000 USDC (raw `72000000000`), so `Vendors under daily cap` does not match.

**Intent states.**
- A transfer or batch is created either `executed`, or `pending_approval` when the wallet has a quorum and the raw amount is at least the floor.
- From `pending_approval` the legal moves are:
  - to `executed` by the deciding approval
  - to `rejected` by one rejection
  - to `cancelled` by its creator or an owner
  - to `expired` by time
- `executed`, `rejected`, `cancelled` and `expired` are final. Any decision or cancellation of a final intent is `409` `INTENT_NOT_PENDING`.
- **A pending intent copies at creation:**
  - `required_approvals` from the quorum threshold
  - `quorum_member_ids` from the quorum's members
  - `expires_at` as `created_at` plus the quorum's `expiry_seconds`
  - `policy_decision` with its `policy_id` and `policy_revision`
- Later edits of the quorum, the policy, or the wallet's policy or quorum assignment never change these.
- Approvals never evaluate policy again. A pending intent executes even when the live revision, or a newly attached policy, would now deny it.
- **An immediate intent** has `required_approvals` 0, empty `quorum_member_ids` and null `expires_at`.
- `tx_hash` is `0x` plus the SHA-256 hex digest of `corvo-tx:` followed by the intent id. It is set at execution.

**Reservations and balances.**
- `reserved` is the sum of the raw amounts of the wallet's `pending_approval` intents, and `available` equals balance minus reserved.
- After every write, balance ≥ 0 and available ≥ 0.
- A transfer or batch whose raw amount exceeds available is `409` `INSUFFICIENT_FUNDS`, with empty details.
- Rejection, cancellation and expiry release the reservation and move no money.

**Execution.**
- Execution subtracts the raw amount from the source balance and credits any internal destination wallet.
- It sets `executed_at` and `decided_at` to the moment of execution, and sets `tx_hash`.
- A batch executes every line together.

**Ledger.**
- Every money movement writes exactly two ledger entries that share one movement id and sum to zero:
  - an opening balance: `external` minus, wallet plus
  - a deposit: `external` minus, wallet plus
  - each executed transfer: source minus, destination wallet (or `external`) plus
  - each executed batch line: one pair per line
- A wallet's `balance_raw` always equals the sum of the ledger entries on its account.
- Nothing ever edits or deletes a ledger entry.

**Transfer checks.**
- The general steps run in order: role, idempotency, wallet lookup, then the body. The body's pinned field order is `amount`, then `destination_address` (address, checksum, `SELF_TRANSFER`, `ASSET_MISMATCH`), then `memo`, whatever the JSON key order.
- Then the decision checks:
  1. the wallet is not frozen: `409` `WALLET_FROZEN`
  2. the policy decision is not `DENY`: `403` `POLICY_DENIED`, with `details` `{rule, reason, policy_revision}`
  3. available covers the amount
- Then it answers `201` with the intent.

**Batches.**
- A batch has 1 to 100 lines. A count outside that range is `VALIDATION_ERROR` on `items`.
- Each line is checked in line order. Within a line, fields follow the transfer body's pinned field order: `amount`, then `destination_address` (address, checksum, `SELF_TRANSFER`, `ASSET_MISMATCH`), then `memo`, whatever the JSON key order. The first invalid line refuses the batch with `422`, its code, and `details` carrying `index` (0-based) and `field` (for example `items.2.amount`).
- Then a frozen wallet is refused.
- Then the lines are evaluated by policy in order. The first denied line refuses the batch with `403` `POLICY_DENIED` and `details` `{index, rule, reason, policy_revision}`.
- Only then is an unaffordable total refused, with no index.
- An accepted batch is one intent of kind `batch` holding the total. It needs approval when the total is at least the floor.
- Nothing about a refused batch is stored except a policy denial's audit and signed events.

**Approve and reject decision checks.** These follow the lookup, for every caller:
1. the caller is a member, not an API key: `403` `FORBIDDEN_ROLE`
2. the body: `UNKNOWN_FIELD`, or `VALIDATION_ERROR` on `reason`
3. the status, after applying expiry, is `pending_approval`: `409` `INTENT_NOT_PENDING`
4. the caller is in `quorum_member_ids`: `403` `NOT_IN_QUORUM`
5. the caller is not `created_by`: `403` `SELF_APPROVAL`
6. the caller has not decided this intent: `409` `ALREADY_DECIDED`
7. approve only: the wallet is not frozen: `409` `WALLET_FROZEN`, with nothing recorded

So:
- An API key gets `404` on a missing intent and `403` `FORBIDDEN_ROLE` on an existing one.
- An operator or auditor member, who can never sit in a quorum, gets `404`, then `409` `INTENT_NOT_PENDING`, then `403` `NOT_IN_QUORUM`.

A rejection sets `rejected`, `decided_at` and `rejection_reason`. An approval is recorded, and when the approvals reach `required_approvals` the intent executes before the answer. Both answer `200` with the intent.

**Cancel decision checks.**
- The role step admits `owner`, `operator` and operator keys.
- After the lookup:
  1. an operator member or operator key that is not `created_by`: `403` `FORBIDDEN_ROLE`
  2. not pending: `409` `INTENT_NOT_PENDING`
- Otherwise the intent is set to `cancelled` with `decided_at`.

**Expiry.**
- An intent is expired when server time is greater than or equal to `expires_at`. A decision landing in the second equal to `expires_at` is refused as not pending.
- The server applies expiry when any request reads or decides the intent, or reads a list containing it, and also by a sweep no later than 5 seconds after `expires_at`, whichever comes first.
- Expiry sets `status` `expired` and `decided_at` equal to `expires_at`, and releases the reservation.
- It appends exactly one `intent.expired` audit event and one signed event, however many requests race to apply it:
  - actor `system`
  - `at` and `created_at` equal to `expires_at`
  - `data` `{intent_id, wallet_id, kind, raw_amount, status: "expired"}`
- Expiry applies on frozen wallets too.

**Frozen wallets.**
- Freezing an already frozen wallet is `409` `WALLET_FROZEN`. Unfreezing an active wallet is `409` `WALLET_NOT_FROZEN`.
- A frozen wallet refuses new transfers, new batches and approvals.
- It still accepts deposits, rejections, cancellations and expiry, each of which releases or credits as usual.

**Deposits.** A deposit credits the balance at once and answers `201`.

**Concurrency winner rules.** Every write locks the rows it reads, so simultaneous requests behave as if they ran one after another in commit order:
- **Several final approvals on one intent:** the first to commit executes the intent. Each later one answers `409` `INTENT_NOT_PENDING`.
- **Approve against cancel, or approve against reject:** whichever commits first wins. The other answers `409` `INTENT_NOT_PENDING`.
- **A freeze against a deciding approval** ends in exactly one of two states:
  - the intent executed and then the wallet froze
  - the wallet froze, and the approval answered `409` `WALLET_FROZEN` with no approval recorded
- **Approval against expiry:** the server time read inside the deciding transaction is compared with `expires_at`. At or after it, the approval expires the intent and answers `409` `INTENT_NOT_PENDING`.
- **Transfers and batches racing for one wallet's funds** never overdraw. Each that would answers `409` `INSUFFICIENT_FUNDS`.
- **Deposits racing with one reference:** exactly one answers `201`. The rest answer `409` `DUPLICATE_DEPOSIT`.
- **Two owners demoting or removing each other at once:** at least one owner remains, and the loser answers `409` `LAST_OWNER`.

**Idempotency.**
- `POST` on transfers, batches and deposits accepts `Idempotency-Key`. A key belongs to one organization.
- **Binding.** The first request with a key binds it to that request's method, path (wallet id included) and the SHA-256 digest of its raw body bytes.
- **In flight.** While that first request is still running, any request with the key in the same organization answers `409` `IDEMPOTENCY_KEY_IN_PROGRESS`. Such a request writes nothing and keeps nothing.
- **Replay.** Once the first request has finished and its answer was kept, a request with the same key, method, path and body:
  - answers the first status, with the first `success`, `data` and `error` byte for byte
  - adds the header `Idempotent-Replayed: true` and a fresh `meta.request_id`
  - writes nothing
  - returns the stored answer even when the intent has changed since. A pending transfer replayed after it executed still shows `pending_approval`.
- **Reuse.** The same key with another method, path or body is `422` `IDEMPOTENCY_KEY_REUSED`. For example, a key first used on a transfer and then on the deposits route is refused this way.
- **What is kept.** Successes and `POLICY_DENIED` refusals are kept. Any other refusal releases the key and keeps nothing, so a later identical request runs afresh.
- **Retention.** A kept record older than the retention period (see Configuration) no longer replays. The request runs afresh and replaces the record.
- Concurrent identical requests with one key create at most one intent and never answer a server error.

**Pagination.**
- `GET /api/v1/intents` orders by `created_at` descending, then id descending. Intents created in the same second follow id order.
- `limit` is 1 to 100 (default 20); anything else is `422` `VALIDATION_ERROR` on `limit`.
- `status` is one of the five states; anything else is `VALIDATION_ERROR` on `status`.
- **The cursor.**
  - `next_cursor` is an opaque string encoding the last `(created_at, id)` together with the `status`, `wallet_id` and organization it was issued for.
  - A cursor presented with different filters, by another organization, or altered in any way is `422` `INVALID_CURSOR` with `details.field` `cursor`.
- **Walking the pages.**
  - Walking every page returns every intent that matched when the walk began exactly once, in order, even while new intents are created.
  - `next_cursor` is null exactly when no further match exists, so the last page is never empty unless the whole result is.

**Approvals inbox.** The inbox lists, newest first, the caller's organization's `pending_approval` intents whose `quorum_member_ids` include the caller, which the caller did not start and has not decided. Expiry is applied first.

**Members, quorums and roles.**
- **Fresh roles.** The server reads the caller's membership and role fresh on every request. A token of a member whose role changed acts with the new role on its next request.
- **Removing a member:**
  - deletes their sessions, so their tokens answer `401` `INVALID_CREDENTIAL` and their email answers `401` `BAD_CREDENTIALS` at login
  - in the same transaction, revokes every live API key that member created, setting `revoked_at`
  - appends one `api_key.revoked` event per key, in key creation order, before `member.removed`. Each event names the remover as actor.
- **Keys** stay live when their creator is only demoted.
- **Quorum members.** Removing a quorum member, or changing their role to `operator` or `auditor`, is `409` `MEMBER_IN_QUORUM`.
- **The last owner.** An organization always keeps at least one owner: removing or demoting the last one is `409` `LAST_OWNER`. `MEMBER_IN_QUORUM` is checked first, so the seeded `mem_nw_owner`, while it is the only owner and sits in `kq_finance`, answers `MEMBER_IN_QUORUM`.

**Sign in and sessions.**
- Login compares the trimmed, lowercased email. A wrong password or an unknown email is `401` `BAD_CREDENTIALS`.
- After logout the token answers `401` `INVALID_CREDENTIAL`.
- A revoked API key answers `401` `INVALID_CREDENTIAL` from its next use.

**Audit chain.**
- **What gets an event.** Every successful write, every policy denial and every expiry appends exactly one audit event per change. `seq` runs from 1 per organization, with no gaps.
- **The event object** is `{seq, type, actor, subject_id, at, data}`:
  - `actor` is the member email, `api_key:` followed by the key prefix, or `system`
  - `subject_id` is the id of the row the event is about. For `transfer.denied` it is the wallet id.
- **The hash.**
  - `hash` is the SHA-256 hex digest of `prev_hash` followed by the canonical JSON of the event object.
  - Canonical JSON has its keys sorted, separators `,` and `:` with no spaces, non-ASCII characters written as themselves, and UTF-8 encoding.
  - `prev_hash` of seq 1 is 64 zeros. Otherwise it is the previous event's `hash`.
- **Types:**
  - wallets: `wallet.created`, `wallet.updated`, `wallet.frozen`, `wallet.unfrozen`
  - policies: `policy.created`, `policy.updated`, `policy.deleted`
  - aggregations and quorums: `aggregation.created`, `quorum.created`, `quorum.updated`
  - money: `deposit.received`, `transfer.denied`
  - intents: `intent.created`, `intent.approved`, `intent.rejected`, `intent.cancelled`, `intent.executed`, `intent.expired`
  - members and keys: `member.added`, `member.updated`, `member.removed`, `api_key.created`, `api_key.revoked`
  - `webhook_secret.rotated`
- **Data shapes:**
  - every `intent.*` event: `{intent_id, wallet_id, kind, raw_amount, status}`
  - `transfer.denied`: `{wallet_id, raw_amount, rule, reason, policy_revision}`, plus `index` for a batch line
  - `api_key.revoked`: `{api_key_id, prefix}`
  - `member.removed`: `{member_id}`
  - other types: an object describing the change
- **Paired events.** An approval that executes writes `intent.approved` and then `intent.executed`. A transfer that executes at once writes `intent.created` and then `intent.executed`.
- **Verification.**
  - The verify route recomputes the chain.
  - `first_broken_seq` is the lowest seq where any of these holds: the seq is not one more than the previous, `prev_hash` differs from the previous `hash`, or `hash` does not recompute.
  - `valid` is true exactly when `first_broken_seq` is null. `events` is the count.

**Signed event log.**
- **Which events.** `intent.created`, `intent.approved`, `intent.rejected`, `intent.cancelled`, `intent.executed`, `intent.expired`, `transfer.denied` and `deposit.received` are appended to the signed log alongside their audit events, with `seq` from 1 per organization.
- **`body`** is the exact JSON string of `{"id","type","created_at","data"}` in that key order:
  - `data` equals the matching audit event's `data`
  - `deposit.received` data is `{deposit_id, wallet_id, raw_amount}`
- **`timestamp`** is the unix second of `created_at`, as an integer.
- **`signature`** is `v1,` followed by the base64 HMAC-SHA256 of the id, a dot, the timestamp, a dot and the body. The key is the UTF-8 bytes of the signing secret current when the event was written.
- Rotating the secret signs later events with the new secret and never changes an earlier event. Nothing is delivered to an outside address.

### Services (DP-56, DP-58)

PostgreSQL at `DATABASE_URL` is the only backing service, and the database is the source of truth. Every record a page shows lives there. Execution moves balances between rows and calls no chain, bank or outside service.

The app applies its schema idempotently when `serve` starts. Amounts are stored as PostgreSQL `numeric` with no scale, and every timestamp column is `timestamptz` truncated to whole seconds.

These tables exist with at least these columns, and tests read them directly:

| Table | Columns |
|---|---|
| `organizations` | `id`, `name`, `app_id` (`app_` and 12 lowercase letters or digits), `webhook_secret` (`whsec_` and 32 lowercase hex digits), `created_at` |
| `members` | `id`, `organization_id`, `name`, `email`, `role`, `password_hash` (salted), `created_at` |
| `sessions` | `id`, `member_id`, `token_hash`, `created_at` |
| `api_keys` | `id`, `organization_id`, `name`, `role`, `prefix`, `secret_hash`, `created_by`, `created_at`, `revoked_at` |
| `wallets` | `id`, `organization_id`, `name`, `chain`, `asset`, `address`, `balance_raw`, `policy_id`, `quorum_id`, `approval_floor_raw`, `status`, `created_at` |
| `policies` | `id`, `organization_id`, `version`, `name`, `chain_type`, `rules`, `revision`, `created_at`, `updated_at` |
| `policy_revisions` | `policy_id`, `revision`, `name`, `rules`, `created_at` |
| `aggregations` | `id`, `organization_id`, `name`, `metric`, `window_seconds`, `asset`, `group_by`, `created_at` |
| `key_quorums` | `id`, `organization_id`, `name`, `member_ids`, `authorization_threshold`, `expiry_seconds`, `created_at` |
| `intents` | `id`, `organization_id`, `wallet_id`, `kind`, `destination_address`, `raw_amount`, `memo`, `status`, `created_by`, `required_approvals`, `quorum_member_ids`, `policy_decision`, `created_at`, `expires_at`, `decided_at`, `executed_at`, `tx_hash`, `rejection_reason` |
| `intent_items` | `intent_id`, `position`, `destination_address`, `raw_amount`, `memo` |
| `approvals` | `intent_id`, `member_id`, `decision`, `reason`, `created_at` |
| `deposits` | `id`, `wallet_id`, `raw_amount`, `reference`, `created_by`, `created_at` |
| `ledger_entries` | `id`, `organization_id`, `movement_id`, `kind` (`opening`, `deposit`, `transfer`, `batch_line`), `account` (a wallet id or `external`), `asset`, `raw_amount` (signed), `intent_id`, `deposit_id`, `created_at` |
| `idempotency_records` | `organization_id`, `key`, `method`, `path`, `body_sha256`, `status_code`, `response`, `created_at` |
| `audit_events` | `organization_id`, `seq`, `type`, `actor`, `subject_id`, `at`, `data`, `prev_hash`, `hash` |
| `webhook_events` | `id`, `organization_id`, `seq`, `type`, `created_at`, `timestamp`, `body`, `signature` |
| `contact_requests` | `id`, `full_name`, `work_email`, `company`, `monthly_volume`, `message`, `created_at` |

**Ids.** Generated ids are a prefix plus 20 lowercase letters or digits. The prefixes are `org_`, `mem_`, `key_`, `wal_`, `pol_`, `agg_`, `kq_`, `int_`, `dep_`, `evt_` and `con_`. Seeded ids are exactly as listed in Seed data.

**When PostgreSQL is unreachable.**
- Every `/api/v1` route answers `503` `DATABASE_UNAVAILABLE`, writing nothing.
- Pages show the outage copy from Feedback states.
- Service resumes on its own once the database answers again.

### Seed data (DP-35, DP-36)

Every seeded person and business is invented. Every seeded account uses the password `deku-demo-pw-2026`, which is fixture data stored only as a salted hash.

**Organizations.**
- `Northwind Treasury`: id `org_northwind`, app id `app_nw7k2m9q4x1z`.
- `Acme Payroll`: id `org_acme`, app id `app_ac3p8r5t6v2w`.

**Members.**

| Id | Name | Email | Role | Organization |
|---|---|---|---|---|
| `mem_nw_owner` | Nadia Owens | `nw.owner@example.com` | `owner` | Northwind |
| `mem_nw_operator` | Omar Patel | `nw.operator@example.com` | `operator` | Northwind |
| `mem_nw_approver1` | Ada Byrne | `nw.approver1@example.com` | `approver` | Northwind |
| `mem_nw_approver2` | Ben Okoro | `nw.approver2@example.com` | `approver` | Northwind |
| `mem_nw_auditor` | Uma Diaz | `nw.auditor@example.com` | `auditor` | Northwind |
| `mem_acme_owner` | Jordan Lee | `acme.owner@example.com` | `owner` | Acme |

**Northwind Treasury holds:**
- aggregation `agg_daily_outflow` named `Daily outflow`: `sum_amount`, 86400 seconds, `usdc`, `group_by` `wallet`
- key quorum `kq_finance` named `Finance quorum`: members `mem_nw_approver1`, `mem_nw_approver2` and `mem_nw_owner`, threshold 2, expiry 604800 seconds
- policy `pol_operating` named `Operating limits`, version `"1.0"`, chain type `ethereum`, revision 1, with these rules in order:
  1. `Block burn address`: `transfer`; `destination.address` `in` `["0x000000000000000000000000000000000000dead"]`; `DENY`
  2. `Vendors under daily cap`: `transfer`; `destination.address` `in` `["0x1111111111111111111111111111111111111111", "0x2222222222222222222222222222222222222222", "0x3333333333333333333333333333333333333333"]` and `aggregation.agg_daily_outflow` `lte` `50000000000`; `ALLOW`
  3. `Sweep to payroll`: `transfer`; `destination.address` `eq` the address of `wal_payroll`; `ALLOW`
  4. `Payroll lines under 5000`: `batch_payout`; `source.amount` `lte` `5000000000`; `ALLOW`
- wallet `wal_operating`, `Operating USDC`: `base`, `usdc`, balance 250000, policy `pol_operating`, quorum `kq_finance`, floor 10000
- wallet `wal_payroll`, `Payroll USDC`: `base`, `usdc`, balance 40000, no policy, quorum `kq_finance`, floor 25000
- wallet `wal_gas`, `Gas reserve`: `ethereum`, `eth`, balance 12.5, no policy, no quorum, floor 0
- intent `int_seed_paid`: transfer from `wal_operating` to `0x1111111111111111111111111111111111111111`, `3500`, memo `September tooling`, created and executed at `2026-09-15T10:00:00Z` by `mem_nw_operator`
  - policy decision `ALLOW`, `Vendors under daily cap`, `matched_rule`, `pol_operating` revision 1
- intent `int_seed_pending`: transfer from `wal_operating` to `0x2222222222222222222222222222222222222222`, `12000`, memo `Q4 logistics invoice`, created by `mem_nw_operator` at the moment the seed runs
  - `pending_approval`, `required_approvals` 2, members of `kq_finance`, expiry 604800 seconds later
  - one approval by `mem_nw_approver1`
  - the same policy decision as `int_seed_paid`

**Acme Payroll holds** wallet `wal_acme_ops`, `Acme Operating`: `base`, `usdc`, balance 9000, no policy, no quorum, floor 0.

**Ledger.**
- Each wallet has one `opening` pair. `wal_operating` opens at 253500, which `int_seed_paid`'s `transfer` pair then reduces.
- So at start `wal_operating` has balance 250000, reserved 12000 and available 238000.

**Seed audit chain.** All events have actor `system` and `at` equal to the moment the seed runs.
- Northwind, seq 1 to 15:
  - five `member.added` in the member order above
  - `aggregation.created`, `quorum.created`, `policy.created`
  - three `wallet.created` (`wal_operating`, `wal_payroll`, `wal_gas`)
  - `intent.created` and `intent.executed` for `int_seed_paid`
  - `intent.created` and `intent.approved` for `int_seed_pending`
- Acme, seq 1 and 2: `member.added`, then `wallet.created`.
- Northwind's signed log holds the four matching intent events. Each organization's signing secret is generated once, at seed.

**Writing the seed.**
- The seed writes only into an empty database. It runs under a PostgreSQL advisory lock, so two `serve` processes booting at once seed exactly once.
- A later boot writes no audit or signed event and changes no row. Renamed wallets stay renamed, balances keep their transfers, `int_seed_pending.created_at` is unchanged, and the next audit event continues from the last seq.

## Technical requirements

### Deployment (DP-49, DP-54)

- **Runtime.** The app is written in JavaScript on Node 22. The grading container runs Debian with Node 22 and Python 3.12, as an unprivileged user.
- **Run manifest.** Ship `/app/run.json` with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, for example:
  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm start"}
  ```
  - The grader runs the commands in that order from the root of a fresh copy of `/app`. They use only relative paths, and every dependency installs inside the app root.
  - `install` and `build` run without `DATABASE_URL` and must not touch the database. Only `serve` receives it. Schema setup and the seed happen when `serve` starts.
- **Listening.** `serve` binds `0.0.0.0` on `APP_PUBLIC_PORT` when it is set, otherwise on 4173.
- **Health.** `GET /api/health` answers HTTP 200 with `{"status":"ok"}` once the schema and seed are ready.
- **Production only.** The production build is served, never a dev server or watch mode. The server keeps running after the session ends and is not a child of an interactive shell.
- **Account notes.** `/app/USER_README.md` lists every seeded account with its password.
- **Reserved folders.** `.browser_screenshots/` and `.downloads/` exist at the app root, empty.
- **Database.** PostgreSQL is already running. Do not download, install or start another copy. Use no persistent volumes, fixed container names or custom networks.

### Configuration and secrets (DP-29, DP-33, DP-56)

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | PostgreSQL connection |
| `APP_PUBLIC_URL` | the app's public address |
| `APP_PUBLIC_PORT` | the listening port (default 4173) |
| `CORVO_IDEMPOTENCY_RETENTION_SECONDS` | idempotency retention in seconds, default `86400`. A record whose age is greater than this value no longer replays. |

- All of these are read at start and never hard-coded.
- No variable value, password, token, key secret or signing secret is ever sent to the browser, except the signing secret through its owner-only route and a new key's secret once.
- Passwords, session tokens and API key secrets are stored only as hashes.

### Server boundary (DP-27, DP-28, DP-30, DP-54, DP-56, DP-62)

- **Same origin.** The site and the API under `/api` share one origin. The API sends no cross-origin allowance, and pages load scripts, styles and data only from that origin.
- **Rendering.** The server renders every page as a complete HTML document. Small page scripts enhance it in place.
- **What the server never serves:** source files, the run manifest, environment files, lockfiles, the database, or any path outside the built public assets and the routes in this brief. Any such path answers the not-found page with `404`.
- **Request limits** are as stated in API.
- **Authority.** The server decides every rule in Business rules. Hiding a control is presentation only, and the server refuses the call regardless of what the page drew.
- **Boot.**
  - If PostgreSQL is unreachable at boot, the server still starts listening and retries the connection every 2 seconds.
  - Until the schema and seed are ready, `GET /api/health` answers `503` `{"status":"starting"}`.
  - If the database becomes unreachable later, it answers `503` `{"status":"unavailable"}`.
  - The server recovers on its own without a restart and never exits because the database is down.
  - Sign in works on the first request after health first answers ok.

### Browser support and performance (DP-49, DP-52, DP-53, DP-57)

- **Browsers.** Current Chromium, Firefox and Safari, at 375 x 812, 768 x 1024 and 1280 x 800. English only.
- **First paint.** The landing hero heading shows on first paint without waiting for any data request. Every page is usable within two seconds on the seed data.
- **Speed.** A transfer, an approval and a policy evaluation over the seed data each answer within 500 milliseconds. Every list endpoint answers a page in one request.
- **Launch basics.** Every page sets a descriptive title, and an unknown address returns the not-found page.

## Working rules

- **IF-01.** `/app/run.json` is a JSON object with `"_schema":"run-manifest-v1"` and non-empty string `install`, `build` and `serve` commands that use only paths relative to the app root.
- **IF-02.** `/app/USER_README.md` lists every seeded account's email, role and the password `deku-demo-pw-2026`.
- **IF-03.** `.browser_screenshots/` and `.downloads/` exist at the app root and are empty.
- **IF-04.** `/app/THIRD_PARTY_NOTICES.md` names every shipped package with its version and licence. Shipped packages are the production dependency tree reported by `npm ls --omit=dev --all --json`.
- **IF-05.** Every shipped package is licensed under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or BlueOak-1.0.0.
- **IF-06.** No datastore other than PostgreSQL at `DATABASE_URL` is started, bundled or written to for records. No SQLite, no Redis, and no JSON files holding records.
- **IF-07.** The provided environment and service configuration files are left untouched, and the seed values in Seed data ship unchanged.
- **IF-08.** The served app is the production build. No dev server, watch mode or hot reload runs in `serve`.

## Engineering standards

- The code is idiomatic modern JavaScript: one module style throughout and async/await for asynchronous work. It has no dead, commented-out or unreachable code.
- Names in the source use this brief's domain terms: intent, quorum, approval floor, reservation, aggregation, revision, ledger entry, movement.
- Each domain rule is decided in exactly one place in the source and reused by every caller. This covers amount parsing and display, address and checksum checks, text measuring, policy decisions, aggregation values, intent transitions, expiry, the audit hash and the event signature.
- No amount ever passes through a JavaScript `Number`. Amounts are exact integers from request to database to response.
- Every write is one database transaction that locks the rows it reads and allocates the audit `seq` and signed `seq` inside that transaction. This covers changes to a balance, a reservation, an intent's status, the ledger, the audit chain or the signed log.
- Every `/api` response and refusal, unexpected errors included, is built in the one envelope shape. No route returns a framework default body.
- There is no abstraction with a single implementation, no defensive check for a state the rules make impossible, and no feature beyond this brief.
- Configuration comes only from the environment variables named in this brief.
