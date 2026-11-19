# Orrin Fieldworks Fernsquare

Fernsquare is a shared developer sandbox for data availability networks. Rollup teams, bootcamps and protocol educators use it to learn the mechanics before they ship. Each workspace runs its own private, deterministic simulated network. Blocks arrive on a server clock. Blobs become 64-byte shares, laid out in an erasure-extended data square with namespaced Merkle roots. Light nodes sample that square, a full node publishes fraud proofs, and validators, delegations and governance proposals run on a valueless test token called FERN. Every rule is published below, and the workspace owner can make the block producer misbehave on purpose. The backend uses three services only: PostgreSQL as the system of record, MinIO as the byte store for blob payloads and square snapshots, and Mailpit as the mail sink for invites and notices. The following are out of scope: real chains, real keys, wallets, signatures, bridges, outside RPC, peer-to-peer networking, prices, trading, market data and any yield framed as investment. FERN exists only inside the app. Also out of scope: any datastore, cache or queue beyond those three services, and any sign-in beyond local email and password accounts.

## Problem and users

Teams building rollups and app-chains on a data availability layer must understand how a blob becomes shares, why a square has its width, what a namespaced Merkle proof proves, and how many samples a light node needs before it trusts a block. Today they piece this together from scattered spec pages and constants that disagree between versions. Public testnets ration tokens through chat faucets. Their explorers never show the extended square, the row and column roots, or a withheld-share attack in progress. So every team writes throwaway scripts, and onboarding a new hire takes a week. Fernsquare comes from a one-person company, Orrin Fieldworks. The founder pays in support hours whenever a number on screen does not match its published formula. Teams pay in lost hours whenever the sandbox misreports a stored blob, a passed proposal or a finished unbonding.

Users:

- **Workspace owner** (weekly): sets up the team's private network, invites teammates with roles, and stages withholding or bad-encoding blocks for training.
- **Rollup developer** (daily): registers namespaces, submits blobs with a correct fee, then finds, proves and downloads them from the square.
- **Light node operator** (daily): runs sampling rounds against new blocks and reads the exact availability confidence after each sample.
- **Delegator** (weekly): delegates FERN to validators, collects rewards by the published rule, and unbonds without losing track of when the tokens free up.
- **Governance voter** (occasional): deposits on and votes for proposals, and sees them tallied and settled at the stated time.

## Journeys

1. **Submit a blob and watch it land.** Felix is signed in on the Submit panel of Fernhill Labs, a seeded workspace with two pending blobs in the mempool. He picks the Harbor namespace and types his data. The size, share, gas and fee readouts update with every keystroke, and he submits with Enter. His blob appears as Pending. Amara has the explorer open in her own browser, and her mempool count goes up by one without a reload. When the next block is produced, both of them see the blob as included in that block. The blocks table shows the new block's blob count and square width, and Felix's shares sit at the published positions.
2. **Inspect a block share by share.** A developer opens block 2 and walks the data square with the arrow keys. Opening a share shows its namespace, info byte, sequence length and data bytes. The developer reads the row roots, column roots and data root, proves the Harbor namespace (inclusion in two rows), proves an unregistered namespace (absence), and verifies each row proof. Further down the block page, the Square walk cards take the developer through Lay out, Extend and Commit as they scroll. The data root on the Commit card matches the one in the roots list.
3. **Sample a block.** A light node operator opens the Kestrel node, picks block 2 and presses Take sample three times. Each sample is announced with its share coordinates and the exact confidence. The operator then turns Auto-sample on. When the next block is produced, Kestrel samples it once per interval.
4. **Stage an attack for training.** Amara, the owner, sets Next block to Withhold shares. When the next block is produced it shows Sampling. Seconds later, Wren's first withheld sample rejects it. Every open browser in the workspace shows the rejection banner. The block's blob transactions turn Rejected, their fees come back, and every member receives one alert mail. On another run she picks Bad encoding instead. Five seconds after production the full node publishes a fraud proof, and its panel shows both roots and the result.
5. **Delegate, earn, unbond.** Felix delegates FERN to Cedar. Once the next block includes the delegation, his balance and Cedar's stake change and his pending rewards grow block by block. Later he undelegates, which withdraws his rewards. At the exact server instant his unbonding ends, the tokens return to his balance and an unbonding-complete mail arrives.
6. **Vote and deposit.** Felix opens proposal 3 while it is in its voting period. He reads the live tally, picks No with veto and casts his vote. After the next block both he and Amara see the new veto share, and when the voting period ends the proposal shows Rejected with veto. He then tops up proposal 4's deposit to the minimum. Its voting period opens and every member receives the voting-open mail.
7. **Bring a teammate in.** Amara invites a new email address as a Developer. The invitee opens the link in the Mailpit message, sets a name and password, and lands on the workspace explorer.
8. **Check a blob on a phone.** On a 390 px wide phone, Felix uses the workspace panel tabs to reach block 2's Harbor blob. He reads its status, size, shares, fee and share positions, then taps a cell of the square to open its share panel. With reduced motion turned on, a newly arrived square appears complete at once.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Sign-in and workspace landing.** Seeded people sign in with email and password, land on /w/<workspaceId>/explorer of their first workspace, and stay there on reload, as qualified in Interactions and API.
- **DP-02 — Workspace roles.** Owner, Developer and Viewer rights follow the published role table; every control a person's role cannot use is disabled with the published accessible description and the server answers 403 with the published role copy.
- **DP-03 — Member invites.** The owner's invite sends one Mailpit message with a single-use link valid for INVITE_TTL_HOURS, whose accept page lands the invitee on the workspace explorer, as qualified in Business rules.
- **DP-04 — Workspace isolation.** Another workspace's namespaces, blobs, blocks, light nodes, proposals and members answer 404 with the Not found page, never 403.
- **DP-05 — Write error order.** Every write applies the published error order (401, 404, 403, 422 first failing rule, 409, 503) with the published bodies.
- **DP-06 — Grading routes and health.** The key-guarded reset, seed and clock routes and the health route behave exactly as published in API.
- **DP-07 — Seeded network.** The seed builds exactly the published workspaces, people, namespaces, validators, balances, history blocks 1-5, mempool, light nodes and proposals.
- **DP-08 — Block clock.** Block h of every network is produced at APP_START_AT + h x BLOCK_TIME_SECONDS, heights are gapless, and due events run in the published order.
- **DP-09 — Namespace registration.** Registration enforces the published namespace format, reserved ranges, validation order and global uniqueness, with exactly one winner among simultaneous registrations.
- **DP-10 — Live fee readouts.** The Submit blob form shows size, shares, gas and fee readouts that follow the published formulas on every keystroke and prefill the fee field with the minimum.
- **DP-11 — Gas and fee rule.** Gas and fee follow the published formula, the fee is held at submit and charged at inclusion, and the estimate equals the fee charged.
- **DP-12 — Blob refusals.** Blob submission refuses an unchosen namespace, an empty blob, an oversize blob, a too-low fee and an insufficient balance with the published copy, in order.
- **DP-13 — Storage-confirmed blobs.** A blob becomes Pending only after MinIO confirms its byte-exact object at blobs/<blobId>, and a failed write leaves no blob or held fee.
- **DP-14 — Blob inclusion journey.** A submitted blob moves from Pending to Included in block <h> when its block is produced, seen live by every member's open explorer without reload.
- **DP-15 — Live network updates.** Every workspace page reflects new blocks, blob states, samples, fraud proofs, tallies and stake within 2 seconds of the server event and announces blocks in the Network updates live region.
- **DP-16 — Share encoding.** Every stored share follows the published 64-byte share format, including the info byte, the sequence length in first shares and tail padding.
- **DP-17 — Square layout.** Blocks take pending blobs in the published order, size the square by the published rule, and store the layout that the explorer, proofs and snapshot all read.
- **DP-18 — Keyboard square navigation.** The data square is a grid with published cell names and data attributes, roving focus by arrows, Home, End, Ctrl+Home and Ctrl+End, and a share panel that opens with Enter and closes with Escape back to the cell.
- **DP-19 — Erasure extension.** The extended square follows the published GF(2^8) Reed-Solomon extension and quadrant order, matching the published share bytes.
- **DP-20 — Square snapshot.** Each produced block's extended square is stored in MinIO at the published key and downloads byte for byte from the block page.
- **DP-21 — Roots and data root.** Row roots, column roots and the data root follow the published namespaced Merkle rules and match the published worked hashes.
- **DP-22 — Namespace proofs.** Prove namespace returns the published inclusion and absence proofs per row, and Verify gives the same verdict in the browser and on the server.
- **DP-23 — Sampling confidence.** Confidence after s samples follows the published formula, shown to 4 decimals, and a node marks a block Available at the published threshold.
- **DP-24 — Sample sequence.** Each node's samples for a block follow the published seeded generator, so coordinates match the published worked sequences.
- **DP-25 — Auto-sampling and availability.** Auto-sampling nodes sample on the published schedule, Take sample draws the next sample of the same sequence, and block states follow the published state machine.
- **DP-26 — Producer behaviour.** Only the owner sets Next block, which applies to the next produced block only and then returns to Honest.
- **DP-27 — Withheld block rejection.** A withheld block serves every share except the published bottom-right region, and the first withheld sample by any light node rejects it.
- **DP-28 — Rejection consequences.** A rejected block shows its banner live in every open context, turns its blob transactions Rejected with fees refunded, and sends one mail per member, as qualified in Business rules.
- **DP-29 — Bad encoding fraud proof.** FRAUD_CHECK_DELAY_MS after production the full node publishes exactly one fraud proof for the first failing line, which light nodes verify before rejecting the block.
- **DP-30 — Fraud proof panel.** The block page shows the Bad encoding fraud proof panel with the published lines, appearing live in every open context.
- **DP-31 — Delegation rules.** Delegate, undelegate, redelegate and claim follow the published limits, redelegation lock, refusal copy and inclusion-time effects.
- **DP-32 — Reward split.** Per-block rewards follow the published stake, commission and floor-division rule, matching the published worked amounts.
- **DP-33 — Unbonding at server time.** Unbonding releases at its end instant inclusive on the server clock, posts the release and queues the notice in one step, and the browser shows only the server's status.
- **DP-34 — Paired ledger.** Every token movement posts two balancing entries, each person's balance equals the sum of their entries, and the bonded total equals the bonded accounts.
- **DP-35 — Proposal deposits and periods.** Proposals move through deposit and voting periods on server time, and a deposit at or after the deposit end instant is refused.
- **DP-36 — Voting and tally.** Votes, voting power and the live and final tallies follow the published quorum, veto and pass rule, matching the published worked tallies.
- **DP-37 — Governance mail.** Voting-open and vote-reminder mails go to the published recipients at the published times.
- **DP-38 — Phone workspace panels.** Below 768 px wide the workspace shows one panel at a time behind the Workspace panels tablist, and every control a test touches is at least 44 x 44 px.
- **DP-39 — Blob page.** The blob page shows status, namespace, size, shares, fee and share positions, and works by touch on a phone, including tapping a square cell to open its panel.
- **DP-40 — Square reveal and motion limits.** A newly arrived square reveals row by row at the published pace, nothing loops except the pausable marquee, and reduced motion shows every end state at once.
- **DP-41 — Square walk.** The block page's Square walk cards rise in, activate by scroll thirds, hover and focus, and draw this block's Lay out, Extend and Commit stages, as qualified in Motion and effects.
- **DP-42 — Storage outage.** While MinIO is unreachable, blob submission and snapshot download are refused with the published copy while everything else works, and both recover without a restart.
- **DP-43 — Mail outbox.** Every mail is written to an outbox in the same transaction as its event and retried until SMTP accepts it, so actions succeed while mail is down.
- **DP-44 — Console look and composition.** Screens carry the published dark console look, layout, square imagery and component set at all three viewports.
- **DP-45 — Configuration from environment.** Every service credential, URL, timer and limit is read from the published environment variables at start, never hard-coded or sent to the browser.

## Frontend

### Screens and layout (DP-01, DP-38, DP-39, DP-44)

All workspace routes sit under `/w/<workspaceId>/`. None of the three viewports (375×812, 768×1024, 1280×800) or the phone check at 390×844 may scroll sideways. The data square is the one exception: on phones it scrolls sideways inside its own frame.

- **Sign in** (`/signin`; `/` redirects here when signed out, or to the explorer when signed in). A centred single-column panel holds the Sign in form.
- **Invite accept** (`/invites/<token>`). A centred panel with the heading `Join <workspace name> on Fernsquare` and the accept form.
- **Explorer** (`/w/<id>/explorer`). The page runs top to bottom:
  - The **live square hero stage**: a two-line headline about running your own data availability network, an 18 px lede, and below them the data square of the latest produced block (whatever its status) filling the media stage.
  - The **network stat trio**: three stats, each a value, a unit and a noun on one line over a short muted caption. They are `<h> blocks` (caption `Current height`), `<k> × <k> shares` (caption `Latest square`, the square width of the latest produced block whatever its status) and `<n> blobs` (caption `Included today`, counted by the Blob counts rule in Business rules).
  - Rejection banners, then the `Next block` control, the mempool count, and the `Blocks` table (newest first; columns Height, Time, Blobs, Square, Status).
  - The `Namespaces` table (Name, Hex, Blobs).
  - The one off-white band. It holds the **namespace showcase cards** (one dark card per namespace with strand art drawn from that namespace's shares, its name, its hex and `<n> blobs`), the **validator monogram marquee**, and a secondary outline pill `Register a namespace`.
  - Back on the dark ground, the **light node spotlight panels**: one wide panel per light node with its name, its latest confidence and a solid pill `Open <node name>`. Panels alternate sides and pair the copy with a luminous ring artwork.
  - The **console footer** over the **share strand wave**.
- **Block** (`/w/<id>/explorer/blocks/<h>`). The heading `Block <h>`, then a facts list (time, status, square width, data root). Next comes the banner if the block was rejected, then the data square with the `Row roots` list beside it and the `Column roots` list below it, then the `Namespace legend`, the `Download square snapshot` button and the `Blobs in this block` table. Then the prove form and the `Namespace proof` results, the `Bad encoding fraud proof` panel when one exists, and the **square walk cards** section at the end.
- **Transaction** (`/w/<id>/explorer/tx/<txId>`). Kind, sender, status, fee, gas, height and time.
- **Blob** (`/w/<id>/blobs/<blobId>`). The heading `Blob <first 8 characters of the id>` and a `Blob facts` list: status, namespace (name and hex), `Size <n> bytes`, `Shares <s>`, `Fee <f> FERN`, a link `Block <h>` once included, and the `Share positions` list of `(<r>, <c>)` items. Below that is the block's data square with this blob's cells outlined. Desktop shows facts and square side by side. Phones stack the facts above the square.
- **Submit** (`/w/<id>/submit`). The Register namespace form, then the Submit blob form, each a single column inside a spotlight-style panel with a 44 px heading. Then the `Your blobs` table.
- **Nodes** (`/w/<id>/nodes`) lists the light nodes. A **node page** (`/w/<id>/nodes/<nodeId>`) is a **light node spotlight panel** holding the controls, the `Confidence <x>%` readout and the `Samples` table.
- **Stake** (`/w/<id>/stake`). The balance readouts, the `Validators` table, the Delegate, Undelegate and Redelegate forms, `Claim rewards`, and the `Your delegations` and `Unbondings` tables.
- **Vote** (`/w/<id>/vote`) shows the `Proposals` table (Number, Title, Status) and the New proposal form. A **proposal page** (`/w/<id>/vote/<n>`) shows the heading `Proposal <n>: <title>`, its status, its period end times, the `Tally` region, the `Your vote` radio group, and the Deposit form while in its deposit period.
- **Ledger** (`/w/<id>/ledger`). The balance readout and the `Ledger` table (Time, Height, Entry, Amount, Balance after), newest first.
- **Members** (`/w/<id>/members`). The `Members` table (Name, Email, Role) and the Invite member form, shown to every member and usable by the owner only.
- **Not found**. Any route the person cannot open shows the heading `Not found` and one outline pill back to the explorer.

Every page carries the **console top bar**: a fixed bar 64 px tall across the full width. At 768 px and wider it holds the logo link, the workspace navigation links, the **primary action pill** `Submit blob` and the `Menu` button. Below 768 px it keeps only the logo, the pill and the `Menu` button (a two-line hamburger), and the `Workspace panels` tablist sits directly under the bar. Content sits in a centred container at most 1200 px wide. Lists and forms sit in outlined panels. Card grids are three columns on desktop, two at 768, and one column 342 px wide on phones.

### Public screens and controls (DP-01, DP-02, DP-03, DP-09, DP-10, DP-18, DP-22, DP-25, DP-26, DP-31, DP-36, DP-38, DP-39, DP-41)

Only these roles and names are public. Every form named here is a `form` landmark with that accessible name. Field labels repeat across forms and are scoped by their form. The table lists the visible copy of each control. Disabled controls carry the accessible description given in the Business rules role table.

| Where | Role and accessible name | Visible copy and notes |
|---|---|---|
| Every page | `link "Fernsquare home"` | Logo mark and the word `Fernsquare` |
| Every page, ≥768 px | `navigation "Workspace"` with links `Explorer`, `Submit`, `Nodes`, `Stake`, `Vote` | Current link has `aria-current="page"` |
| Every page | `link "Submit blob"` | Primary action pill in the top bar |
| Every page | `button "Menu"` | Opens `dialog "Menu"` with links `Members`, `Ledger` and `button "Sign out"` |
| Every page, <768 px | `tablist "Workspace panels"`, tabs `Explorer`, `Submit`, `Nodes`, `Stake`, `Vote` | Selected tab has `aria-selected="true"` |
| Every workspace page | `status "Network updates"` | Live region for block and rejection announcements |
| Explorer, block page | `alert "Block <h> rejected"` | Rejected-block banner (copy in Feedback states) |
| Sign in | form `Sign in`: `textbox "Email"`, password field `Password`, `button "Sign in"` | |
| Invite accept | form `Accept invite`: `textbox "Your name"` (new people only), password field `Password`, `button "Accept invite"` | |
| Members | `table "Members"`; form `Invite member`: `textbox "Email"`, `radiogroup "Role"` (`Developer`, `Viewer`), `button "Send invite"`, `status "Invite member status"` | Shown to every member; disabled for developers and viewers |
| Explorer | `region "Network stats"` | The stat trio |
| Explorer | `radiogroup "Next block"` (`Honest`, `Withhold shares`, `Bad encoding`), `status "Producer status"` | Shown to every member; disabled for developers and viewers |
| Explorer | text `Mempool <n> blobs` | `blob` when n is 1 |
| Explorer | `table "Blocks"`, `table "Namespaces"`, `list "Namespace showcase"` | Block heights link to block pages |
| Explorer | `region "Validators"` | Monogram marquee; carries `data-motion` = `running`, `paused` or `off` |
| Explorer | `region "Light nodes"` with `link "Open <node name>"` per node | Spotlight panels |
| Explorer, block, blob pages | `grid "Data square, block <h>"` | One per page; cells described in Interactions |
| Block page | `list "Row roots"`, `list "Column roots"` | Each item carries `data-min`, `data-max`, `data-hash` and shows `Row <r>` or `Column <c>` with min, max and the full hash |
| Block page | text `Data root <hex>` | 64 lowercase hex characters, in full |
| Block page | `list "Namespace legend"` | Items `<name>` and `<n> shares` (`1 share`), with `data-namespace` and `data-count`; padding item named `Padding` |
| Block page | `dialog "Share <r>, <c>"` with `button "Close"` | Share panel |
| Block page | `textbox "Namespace to prove"`, `button "Prove namespace"`, `region "Namespace proof"` with `button "Verify row <r>"` and `list "Row <r> proof nodes"` per proved row | Each proof node item carries `data-min`, `data-max`, `data-hash` and shows the full hash |
| Block page | `region "Bad encoding fraud proof"` | Present only when the block has a fraud proof |
| Block page | `button "Download square snapshot"`, `status "Snapshot status"` | |
| Block page | `table "Blobs in this block"` | Rows link to blob pages |
| Block page | `list "Square walk"` with `article "Lay out"`, `article "Extend"`, `article "Commit"` | Each article is focusable |
| Blob page | `list "Blob facts"`, `list "Share positions"`, `link "Block <h>"` | |
| Submit | form `Register namespace`: `textbox "Namespace name"`, `textbox "Namespace hex"`, `button "Register namespace"`, `alert` and `status "Register namespace status"` | |
| Submit | form `Submit blob`: `combobox "Namespace"` (each option's label is the namespace name alone, such as `Harbor`), `textbox "Data"`, file input `Upload file`, `region "Blob estimate"`, `textbox "Fee (FERN)"`, `button "Submit blob"`, `alert` and `status "Submit blob status"` | Estimate lines `Size <n> bytes`, `Shares <s>`, `Gas <g>`, `Fee <f> FERN` |
| Submit, Stake | text `Available <a> FERN` | |
| Submit | `table "Your blobs"` | Status column uses the transaction state copy |
| Node page | `combobox "Block"` (options `Block <h>`), `button "Take sample"`, `switch "Auto-sample"`, `table "Samples"`, text `Confidence <x>%`, `status "Sampling updates"` | |
| Stake | text `Balance <a> FERN`; `table "Validators"` (Name, Stake, Commission, Share of bonded) | Commission and share of bonded show as percentages |
| Stake | form `Delegate`: `combobox "Validator"`, `textbox "Amount (FERN)"`, `button "Delegate"` | Each staking form shows `Fee <f> FERN` |
| Stake | form `Undelegate`: `combobox "Validator"`, `textbox "Amount (FERN)"`, `button "Undelegate"` | |
| Stake | form `Redelegate`: `combobox "From validator"`, `combobox "To validator"`, `textbox "Amount (FERN)"`, `button "Redelegate"` | Validator options are named by validator name |
| Stake | `button "Claim rewards"`, `table "Your delegations"` (Validator, Amount, Pending rewards), `table "Unbondings"` (Validator, Amount, Completes, Status), `status "Stake status"` | Unbonding status copy `Unbonding until <time>` or `Released` |
| Vote | `table "Proposals"`; form `New proposal`: `textbox "Title"`, `textbox "Description"`, `textbox "Initial deposit (FERN)"`, `button "Submit proposal"` | |
| Proposal page | `region "Tally"`, `radiogroup "Your vote"` (`Yes`, `No`, `No with veto`, `Abstain`), `button "Cast vote"`; form `Deposit`: `textbox "Deposit (FERN)"`, `button "Deposit"`; `status "Vote status"` | |
| Ledger | `table "Ledger"` | |

The `Tally` region shows these lines: `Votes <a> of <b> FERN (<turnout>%)`, `Yes <a> FERN`, `No <a> FERN`, `No with veto <a> FERN (<veto share>%)`, `Abstain <a> FERN`, `Yes share <x>%`, and either `Projected result <status>` while voting or `Result <status>` once final.

### Interactions (DP-01, DP-18, DP-22, DP-25, DP-38, DP-39, DP-41)

- **Sign in.** Tab order is Email, Password, Sign in, and Enter in either field submits. On success the browser goes to `/w/<workspaceId>/explorer` of the person's first workspace (the one joined earliest). Reloading any workspace route keeps the person signed in on the same route.
- **Menu dialog and share panel.** Both are modal. Tab and Shift+Tab wrap inside them, Escape closes them, and focus returns to the control that opened them (the `Menu` button, or the grid cell for the share panel).
- **Data square grid.** The grid has 2k rows of type `row`, each carrying `data-row` and `data-revealed`, and each row holds 2k `gridcell`s. A cell's name is `Share <r>, <c>: <label>`. The label is the registered namespace name for blob shares in the original quadrant, `Padding` for tail padding, `Parity` for every share outside the original quadrant, and `Withheld` for a share the producer withheld. Each cell carries:
  - `data-row` and `data-col`;
  - `data-quadrant` (`Q0` original, `Q1` row parity, `Q2` column parity, `Q3` parity of parity);
  - `data-namespace` (the 18-character leaf namespace hex);
  - `data-kind` (`blob`, `padding`, `parity` or `withheld`);
  - `data-share` (the 128-character share hex, or empty for withheld);
  - `data-mine="true"` when the share belongs to a blob the signed-in person submitted.

  Exactly one cell is in the Tab order, starting at (0, 0). Arrow keys move one cell and stop at the edges. Home and End move to the first and last cell of the row. Ctrl+Home and Ctrl+End move to (0, 0) and (2k−1, 2k−1). Enter opens the share panel. Tab leaves the grid to the next control. Clicking or tapping a cell focuses it and opens its panel. The share panel shows `Namespace <hex>`, `Info byte <two hex digits>`, `Sequence length <n> bytes` (first shares only, read from bytes 10–13) and `Data <hex of the data bytes>`.
- **Prove namespace.** Type 18 hex characters in `Namespace to prove`, then press Enter or the button. The `Namespace proof` region lists each original-half row in order, using the line copy from Business rules. Under each inclusion or absence line, the `Row <r> proof nodes` list shows that row's proof nodes left to right, and an absence line also shows `Next leaf hash <hash>`. `Verify row <r>` recomputes that row's root in the browser from the proof and prints the verdict next to the row.
- **Light nodes.** `Block` defaults to the latest block and follows new blocks until the person picks one. `Take sample` (Enter or Space) draws the next sample for the chosen block. `Auto-sample` toggles with Space.
- **Producer.** Arrow keys move within `Next block` and the choice is saved immediately.
- **Forms.** Enter in a single-line field submits. Field errors appear under the field, linked as its description, and the same text appears in the form's alert. Focus moves to the first invalid field.
- **Phones.** Tapping a `Workspace panels` tab opens that panel's route. The square sits in its own sideways-scrolling frame with every cell at least 44 × 44 px. Swiping inside the frame scrolls the square, not the page.
- **Square walk.** Each card can be hovered, focused with Tab, or activated by scrolling (see Motion and effects). When hover or focus leaves a card, the scroll position decides the active card again.
- **Role limits.** Every control the person's role cannot use stays visible, is disabled, and carries the accessible description from the Business rules role table.
- **Time.** The browser never decides time-dependent state. Statuses, completion times and period ends come from the server and render as fixed times, never as countdowns. The device clock may be wrong.

### Visual design (DP-44)

- **Typefaces.** The display face is the system grotesk stack (system-ui and its platform equivalents) at semi-bold weight with wide letter spacing, used for headings and stat values. The body face is the same system grotesk at regular and medium weight, with tabular figures for every number. A system monospace (ui-monospace and its equivalents) is used only for namespace hex, share bytes, hashes and roots. No font files are shipped or fetched.
- **Scale.** Each heading step is about a fifth larger than the one below it. The hero headline is the largest type on any screen. Form headings are about two and a half times body size.
- **Colour roles.** A near-black ground with a faint violet tint runs edge to edge on every dark screen. Panels are outlined with a dark slate hairline. Headings and primary ink are a near-white with a faint violet cast, and body text is a cool muted grey. The single off-white band carries near-black ink. A cool mid-grey "active field" fills the active Square walk card and the outage and rejection banners, with near-black ink. Violet and pale lavender appear only as strand light inside the square, the showcase cards, the spotlight ring art and the footer wave. They never appear on chrome, buttons or text.
- **Density and shape.** Comfortable spacing with tall section rhythm. Every data surface is a panel outlined in one hairline with slightly rounded corners. Pills are fully round. Those are the only two corner shapes.
- **Composition.** A fixed top bar over a centred container. Dark sections, with one hard-cut off-white band holding the namespace showcase and the marquee.
- **The square as imagery.** In the hero, each original share is a cell of strand light hued by its namespace. Parity quadrants are drawn as thinner, cooler strands. Every cell also carries a namespace-specific stroke pattern, so namespace never depends on hue alone. The footer wave and the showcase art are drawn from real shares of real blocks.
- **Working screens.** Lists are full-width outlined panels with hairline row dividers and tabular figures. Transaction ids and blob ids in tables and on the transaction page are truncated in the middle (first 8 and last 8 characters) and paired with a `Copy` pill. Roots, data roots, proof-node hashes, leaf hashes, fraud-proof roots and share bytes always show in full, wrapping inside their panel in the monospace face. Forms are single-column with one solid near-white pill as the only primary action. Empty states are one large sentence plus one outline pill, for example `No blobs yet.` with `Submit a blob`. Loading shows the strand canvas drawn very faintly, never a spinner.
- **Controls and contrast.** Every control is at least 44 × 44 px. Text and controls meet WCAG 2.2 AA contrast, and focus shows a clear outline offset from the control.
- **Seed components.** The design keeps these, under these names: console top bar, primary action pill, secondary outline pill, live square hero stage, network stat trio, namespace showcase cards, validator monogram marquee, square walk cards, light node spotlight panel, split-letter section heading, console footer and share strand wave.

### Motion and effects (DP-40, DP-41)

- **Square walk.** This is the signature, on the block page.
  - **Rise.** The three cards rise into place when the top of the card list reaches 80% of the viewport height, or on load if it is already there. Card 1 starts at once, card 2 a tenth of a second later and card 3 a fifth of a second later. Each rises over six tenths of a second, settling softly. Each card's `data-state` reads `hidden` before its start, `rising` from its start until 600 ms after it, and `shown` from then on, timed by the page's own timers. For example, 150 ms after the trigger the states are rising, rising, hidden. At 700 ms they are shown, shown, rising.
  - **Activation by scroll.** Progress p through the section is (window scroll position − section top) ÷ (section height − viewport height), clamped to 0–1. The section is at least two and a half viewport heights tall on desktop, and the card trio stays pinned in view while it scrolls. Card 1 is active while p < 1/3, card 2 while 1/3 ≤ p < 2/3, and card 3 when p ≥ 2/3. This works in both directions, card by card. Below 768 px, the active card is the one whose centre has most recently crossed the middle of the viewport. Hover or keyboard focus also activates a card.
  - **Active and inactive cards.** The active card carries `aria-current="step"`. Its text panel fills from the ground colour to the active-field grey while its ink cross-fades to near-black over about a third of a second. Inactive cards dim to about half strength within about a sixth of a second.
  - **Stage drawings.** Each card's media square draws that block's stage once, with the viewer's blob shares outlined. `Lay out` shows the k × k original cells (`data-cells` = k²). `Extend` grows to the 2k × 2k square with parity strands (`data-cells` = (2k)²). `Commit` strokes 4k root ticks along the right and bottom edges (`data-ticks` = 4k) and resolves the corner to the text `Data root <hex>`, equal to the block's data root. Each drawing takes about a second.
- **Square reveal.** When a new block arrives live, the square on screen switches to it. Row r gets `data-revealed="true"` r × `SQUARE_ROW_REVEAL_MS` after arrival (row 0 at once), timed by the page's own timers, so the square fills top to bottom. Before its time a row reads `data-revealed="false"`. The hero stage re-lays only once per block.
- **Entrances.** Section copy and pills fade up and come into focus from a slight blur over about six tenths of a second, siblings a tenth of a second apart, once on first sight. Split-letter section headings settle letter by letter from left to right, a few hundredths of a second apart. The heading's accessible name is always the whole word.
- **Hover and press.** Pills lighten and their arrow nudges sideways within about a sixth of a second. Links brighten within about a sixth of a second. Showcase card art grows by a few percent over about six tenths of a second.
- **Marquee.** The validator monograms drift sideways at about one monogram every two seconds. The drift pauses on hover and while off-screen (`data-motion="paused"`).
- **No other motion.** No other element loops or animates unseen. Strand canvases render once, and again on resize.
- **Reduced motion.** With reduced motion on, nothing rises, staggers, blurs or strokes in. Every Square walk card is `shown` at once with card 1 active on load, and the active card switches instantly on scroll third, hover or focus. A new square has every row revealed at once with the same values. The marquee shows `data-motion="off"` and stands still. Entrances and split-letter headings appear in their final state. The data root, cell values and blob outlines are identical to the full-motion view.

### Feedback states (DP-12, DP-15, DP-25, DP-27, DP-28, DP-42)

- **Pending.** While a write is in flight, its button is disabled with `aria-busy="true"` and the form's status reads `Working…`. Data panels that are loading carry `aria-busy="true"` and show the faint strand canvas.
- **Success copy**, announced in the form's status region:
  - Register namespace: `Namespace <name> registered.`
  - Submit blob: `Blob submitted. It is pending until a block includes it.`
  - Delegate, Undelegate, Redelegate, Claim rewards, Deposit, Cast vote and Submit proposal: `Transaction sent. It takes effect when the next block is produced.`
  - Invite: `Invite queued for <email>.`
  - Producer: `Next block: <option label>.`
  - Snapshot: `Downloading snapshot…`, then `Snapshot ready.`
- **Field errors.** The 422 messages published in Business rules appear under the field and in the form's `alert`.
- **Network updates** (`status "Network updates"`). Each event is announced once:
  - a new block: `Block <h> produced: <n> blobs, square <k> × <k>.` (`blob` when n is 1; n is the block's blob count from the Blob counts rule);
  - a withheld rejection: `Block <h> was rejected: shares were withheld. Light node <name> could not fetch share (<r>, <c>).`;
  - a bad-encoding rejection: `Block <h> was rejected: row <i> is not encoded correctly.` (or `column <i>`).
- **Rejected-block banners.** The same two rejection texts are the banner copy. The block page always shows its banner. The explorer shows a banner for every rejected block among the latest 5 heights, newest first. Each banner appears within 2 seconds of the rejection, without a reload.
- **Sampling updates** (`status "Sampling updates"`, node page). Each sample of the selected block is announced once: `Sample <s>: share (<r>, <c>) available. Confidence <x>%.` or `Sample <s>: share (<r>, <c>) withheld. Block <h> is unavailable.`
- **Storage outage** (full-container banner, also in the form's alert or status):
  - submit refused: `Storage is unavailable, so blobs can't be submitted right now. The explorer still works.`
  - snapshot refused: `Storage is unavailable, so the snapshot can't be downloaded right now.`
- **Proof verdicts:** `Verified against row <r> root.` and `Proof does not match row <r> root.`
- **Sign-in error:** `Email or password is incorrect.`
- **Unreachable server:** `Fernsquare can't reach the server. Your last action was not sent.`
- **Expired invite** (accept page): `This invite link has already been used or has expired.`

## Backend

### API (DP-01, DP-03, DP-04, DP-05, DP-06, DP-09, DP-11, DP-12, DP-13, DP-20, DP-22, DP-25, DP-31, DP-35, DP-36, DP-42)

Every request and response body is `application/json` unless stated otherwise. A write without a JSON content type answers 415 `{"error":"Send JSON."}`. Request bodies may be up to 1,048,576 bytes (that size allowed); a larger body answers 413 `{"error":"Request body is too large."}`. The session is the `fs_session` cookie (HttpOnly, SameSite Lax).

**Values.** Amounts in responses are integers in ufern, in fields ending `Ufern`. Amounts in requests are decimal strings in FERN with at most 6 decimals (`"1000"`, `"0.006705"`). Percentages in responses (`confidence`, `turnout`, `vetoShare`, `yesShare`, `shareOfBonded`) are numeric strings without a percent sign, with the decimals published in Business rules (for example `"39.0625"`, `"87.96"`). `commission` is the rate as a decimal fraction string (`"0.05"` for 5%). Times are ISO 8601 UTC. Every reference to a validator, light node, person or namespace record in requests and responses carries that record's id as returned by the seed route or the list routes, except namespaces in blob, block, proof and share bodies, which carry the 18-character hex. Responses add the display name beside each id in a field ending `Name`.

**Error bodies:** 401 `{"error":"Sign in to continue."}`; 404 `{"error":"Not found"}`; 403, 409 and 503 `{"error":"<copy>"}`; 422 `{"errors":{"<field>":"<message>"}}` with exactly one field.

**Error order.** One rule covers the whole API, for every route under `/api/w/<workspaceId>/`:
1. 401 not signed in;
2. 404 when the workspace or the named resource is not visible to the person (another workspace's resource is always 404);
3. an idempotent replay returns its stored response;
4. 403 role (copy chosen by the role table in Business rules);
5. 422 validation (first failing rule, in the published order);
6. 409 state conflict;
7. 503 storage unavailable (blob submit and snapshot download only).

**Idempotency.** Writes that create a transaction accept an `Idempotency-Key` header, scoped to person and workspace. Repeating the key with the same body returns the stored status and body without creating anything. Repeating it with a different body answers 409 `{"error":"This idempotency key was used for a different request."}`.

**Transaction responses.** Every transaction write answers 201 with `{"id","kind","status":"pending","feeUfern","gas","submittedAt"}`. Blob submissions add `"blobId","size","shares"`.

Session and people:
- `POST /api/session` `{"email","password"}` → 200 `{"user":{"id","name","email"},"workspaces":[{"id","name","role"}]}` and sets the cookie. Wrong credentials → 401 `{"error":"Email or password is incorrect."}`.
- `DELETE /api/session` → 204.
- `GET /api/me` → 200, same body as sign-in.

Invites:
- `GET /api/invites/<token>` → 200 `{"workspaceName","email","role","existingAccount":true|false}`. Used, expired or unknown → 410 `{"error":"This invite link has already been used or has expired."}`.
- `POST /api/invites/<token>/accept` `{"name","password"}` (name ignored for existing accounts) → 200 `{"workspaceId"}` and sets the cookie. Errors: 410 as above, 422 (`name`, `password`), and 401 with the sign-in error for a wrong existing password.

Workspace:
- `GET /api/w/<id>` → `{"id","name","role","height","clock","nextBlock":"honest"|"withhold"|"bad-encoding"}`.
- `PUT /api/w/<id>/producer` `{"nextBlock"}` → 200 `{"nextBlock"}`. Errors: 403; 422 `{"errors":{"nextBlock":"Choose Honest, Withhold shares or Bad encoding."}}`.
- `GET /api/w/<id>/members` → `[{"id","name","email","role"}]`.
- `POST /api/w/<id>/invites` `{"email","role":"developer"|"viewer"}` → 201 `{"id","email","role","expiresAt"}`. Errors: 403; 422 `email` `Enter a valid email address.` or `role` `Choose Developer or Viewer.`; 409 `{"error":"<email> is already a member of this workspace."}`.

Namespaces and blobs:
- `GET /api/w/<id>/namespaces` → `[{"id","name","hex","blobCount"}]`, with `blobCount` from the Blob counts rule.
- `POST /api/w/<id>/namespaces` `{"name","hex"}` → 201 `{"id","name","hex"}`. Fields `hex` and `name`; 409 when taken.
- `GET /api/w/<id>/fee-estimate?bytes=<n>` → 200 `{"size","shares","gas","feeUfern"}`.
- `POST /api/w/<id>/blobs` `{"namespace":"<hex>","dataBase64","fee":"<FERN>"}` → 201 transaction response. Fields `namespace`, `data` and `fee` (balance refusals use `fee`); 503 storage.
- `GET /api/w/<id>/blobs?mine=true` and `GET /api/w/<id>/blobs/<blobId>` → `{"id","txId","namespace","namespaceName","size","shares","gas","feeUfern","status":"pending"|"included"|"rejected","statusText","height","positions":[[r,c]]}`.
- `GET /api/w/<id>/transactions?mine=true`, `GET /api/w/<id>/transactions/<txId>` → `{"id","kind","sender","senderName","status","statusText","height","feeUfern","gas","submittedAt"}`, where `sender` is the person's id.
- `GET /api/w/<id>/mempool` → `{"count","blobs":[...]}`, where count is the number of pending blob transactions.

Blocks:
- `GET /api/w/<id>/blocks` → newest first `[{"height","producedAt","blobs","squareWidth","status":"sampling"|"available"|"rejected","dataRoot"}]`, with `blobs` from the Blob counts rule.
- `GET /api/w/<id>/blocks/<h>` → `{"height","producedAt","status","squareWidth","dataRoot","rowRoots":[{"min","max","hash"}],"columnRoots":[...],"blobs":[{"id","namespace","positions"}],"rejection":null|{"reason":"withheld","node","nodeName","row","col"}|{"reason":"bad-encoding","axis":"row"|"column","index"}}`, where `node` is the light node's id.
- `GET /api/w/<id>/blocks/<h>/shares` → `{"k","rows":[[{"row","col","quadrant","namespace","kind","share"}]]}`, with `share` null when withheld.
- `GET /api/w/<id>/blocks/<h>/proofs?namespace=<hex>` → `{"height","namespace","rows":[...]}`, one entry per row 0..k−1:
  - `{"row","kind":"inclusion","start","end","shares":[hex],"nodes":[{"min","max","hash"}],"root":{...}}`;
  - `{"row","kind":"absence","nextLeaf":{"col","namespace","hash"},"nodes":[...],"root":{...}}`;
  - `{"row","kind":"outside"}`.

  A malformed namespace answers 422 `namespace` with the namespace character or length message.
- `POST /api/w/<id>/blocks/<h>/proofs/verify` `{"namespace","proof":<one row entry>}` → 200 `{"verified":true|false,"root":{"min","max","hash"}}`.
- `GET /api/w/<id>/blocks/<h>/fraud-proof` → 200 `{"height","axis","index","shares":[{"position","share","nodes":[...],"verified"}],"committedRoot":{...},"recomputedRoot":{...},"publishedAt"}`, or 404 when there is none.
- `GET /api/w/<id>/blocks/<h>/snapshot` → 200 `application/octet-stream`, (2k)² × 64 bytes, with `Content-Disposition: attachment; filename="block-<h>-square.bin"`. 503 storage.

Light nodes:
- `GET /api/w/<id>/light-nodes` → `[{"id","name","number","autoSample"}]`.
- `PATCH /api/w/<id>/light-nodes/<nodeId>` `{"autoSample":bool}` → 200 node.
- `GET /api/w/<id>/light-nodes/<nodeId>/samples?height=<h>` → `{"height","k","samples":[{"index","row","col","served","confidence"}],"confidence","verdict":"sampling"|"available"|"unavailable"}`. `confidence` is `"0.0000"` before the first sample.
- `POST /api/w/<id>/light-nodes/<nodeId>/samples` `{"height"}` → 201 sample. Errors: 409 `{"error":"Light node <name> has already taken <n> samples of block <h>."}` once `SAMPLES_PER_BLOCK` is reached; 404 for an unknown height.

Staking (fee shown before submit via `GET /api/w/<id>/staking/fee` → `{"gas","feeUfern"}`):
- `GET /api/w/<id>/validators` → `[{"id","name","selfStakeUfern","stakeUfern","commission","shareOfBonded"}]`.
- `GET /api/w/<id>/staking/me` → `{"balanceUfern","availableUfern","heldUfern","delegations":[{"validator","validatorName","amountUfern","pendingRewardsUfern"}],"unbondings":[{"validator","validatorName","amountUfern","completesAt","status":"unbonding"|"released"}],"redelegations":[{"from","fromName","to","toName","amountUfern","arrivedAt","movableAt"}]}`. `validator`, `from` and `to` are validator ids.
- `POST /api/w/<id>/staking/delegate` `{"validator","amount"}`.
- `POST /api/w/<id>/staking/undelegate` `{"validator","amount"}`.
- `POST /api/w/<id>/staking/redelegate` `{"from","to","amount"}`.
- `POST /api/w/<id>/staking/claim` `{}`. 409 `{"error":"There are no rewards to claim."}`.

Each staking write answers 201 with the transaction response. `validator`, `from` and `to` take validator ids; an id that is not a validator of this workspace fails the first staking refusal. Fields are `validator`, `from`, `to` and `amount`.

Governance:
- `GET /api/w/<id>/proposals` and `GET /api/w/<id>/proposals/<n>` → `{"number","title","description","status","statusText","depositUfern","minDepositUfern","depositEndsAt","votingEndsAt","tally":{"votesUfern","totalBondedUfern","turnout","yesUfern","noUfern","noWithVetoUfern","abstainUfern","vetoShare","yesShare","result"},"myVote"}`. `result` is the projected or final status label; `myVote` is the option string or null.
- `POST /api/w/<id>/proposals` `{"title","description","initialDeposit"}`.
- `POST /api/w/<id>/proposals/<n>/deposits` `{"amount"}`.
- `POST /api/w/<id>/proposals/<n>/votes` `{"option":"yes"|"no"|"no_with_veto"|"abstain"}`.

Each governance write answers 201 with the transaction response. Fields are `title`, `amount` and `option`; 409 for period conflicts.

Ledger:
- `GET /api/w/<id>/ledger?account=<account>` → `{"account","balanceUfern","entries":[{"id","pairId","account","counterAccount","kind","label","amountUfern","height","at"}]}`. Without `account`, every entry of the workspace is returned.

Grading and health (outside the workspace error order):
- `GET /api/health` → 200 `{"status":"ok"}`, or 200 `{"status":"unavailable"}` while storage is unreachable (never 503).
- Every `/api/grading/*` route requires header `X-Grading-Key` equal to `GRADING_KEY`. A missing or wrong key answers 404.
  - `POST /api/grading/reset` → 200 `{"clock"}`: empties every table and the bucket and sets the clock to `APP_START_AT`. While storage is unreachable it still answers 200: it empties the tables and leaves the bucket as it is.
  - `POST /api/grading/seed` → 200: resets, builds the whole seed and returns exactly this shape (every id is a string; `<…>` marks a value):

    ```
    {"clock":"<ISO time>",
     "workspaces":{"fernhill":{"id":"<id>","name":"Fernhill Labs"},
                   "quarry":{"id":"<id>","name":"Quarry Labs"}},
     "people":{"amara":{"id":"<id>","name":"Amara Osei","email":"<email>","password":"<password>","session":"<cookie value>"},
               "felix":{...same keys},"priya":{...same keys},"jonas":{...same keys}},
     "namespaces":{"orchard":{"id":"<id>","name":"Orchard","hex":"00000000000000a100"},
                   "harbor":{...same keys},"lantern":{...same keys},"quarryMain":{...same keys}},
     "lightNodes":{"wren":{"id":"<id>","name":"Wren","number":1},
                   "kestrel":{...same keys},"heron":{...same keys}},
     "validators":{"fernhill":{"alder":{"id":"<id>","name":"Alder"},"birch":{...},"cedar":{...},"dogwood":{...}},
                   "quarry":{"alder":{...},"birch":{...},"cedar":{...},"dogwood":{...}}},
     "blobs":{"block2":[{"id":"<blob id>","txId":"<tx id>","namespace":"<hex>","size":<bytes>}, ...],
              "block3":[...],"block4":[...],"block5":[...],"mempool":[...]},
     "proposals":{"1":{"number":1,"title":"<title>"}, ... ,"7":{"number":7,"title":"<title>"}}}
    ```
    Each `blobs` list holds that block's (or the mempool's) blobs in submission order, with the same item keys: `block2` has 4 items (Orchard 60, Orchard 10, Harbor 120, Lantern 20 bytes), `block3`, `block4` and `block5` have 1 each, and `mempool` has 2 (Orchard 300, Lantern 200 bytes). The `session` value is used as the `fs_session` cookie. While storage is unreachable the seed still answers 200 with this same body and builds every PostgreSQL record, including shares, roots, proofs, fraud proofs and the mempool blobs. It writes the payload and snapshot objects it could not store once storage answers again, within 10 seconds.
  - `POST /api/grading/clock` `{"advanceMs":n}` (an integer from 0 to 86,400,000 inclusive) → 200 `{"clock","heights":{"<workspaceId>":h}}`. It moves the server clock and runs every due event at its own instant. Anything else answers 422 `{"errors":{"advanceMs":"Give a whole number of milliseconds from 0 to 86400000."}}`.

**Live channel.** A same-origin WebSocket at `/api/w/<workspaceId>/live` pushes every workspace event to signed-in members. The upgrade is refused for anyone else.

### Business rules (DP-02, DP-03, DP-08, DP-09, DP-11, DP-12, DP-13, DP-16, DP-17, DP-19, DP-21, DP-22, DP-23, DP-24, DP-25, DP-26, DP-27, DP-28, DP-29, DP-30, DP-31, DP-32, DP-33, DP-34, DP-35, DP-36, DP-37, DP-43)

**Token and formats.** The token is FERN. One FERN is 1,000,000 ufern. Screens show amounts with thousands separators and 6 decimals plus ` FERN` (for example `3,999.992000 FERN`). In messages, `<a>` and `<f>` mean an amount in that format without the unit. Dates show as `D MMM YYYY` (for example `6 Nov 2026`) and times as `HH:mm:ss` 24-hour, both in `APP_TIME_ZONE`.

**Percentages.** Confidence shows 4 decimals (see Sampling confidence). Tally turnout, veto share and yes share, a validator's share of bonded stake and its commission show 2 decimals followed by `%` on screen (commission `5.00%`). Display rounds half away from zero; every decision uses exact fractions. Share of bonded = validator stake ÷ total bonded. A share whose denominator is 0 shows `0.00`. For example, with the seed data at start the shares of bonded are Alder 41.67%, Birch 30.56%, Cedar 18.52% and Dogwood 9.26%.

**Blob counts.** A namespace's blob count (`Namespaces` table, showcase cards, `blobCount`) counts its blob transactions whose status is Included; pending and rejected blobs are not counted. A block's blob count (`Blocks` table, `blobs` in block lists, the block announcement) counts every blob transaction the block took at production, including those later rejected with it. The `Included today` stat counts blob transactions with status Included in blocks produced on the current server date in `APP_TIME_ZONE`. For example, with the seed data at start: Orchard 2, Harbor 1, Lantern 2, Quarry main 0; blocks 1–5 count 0, 4, 1, 1, 1; the trio reads `5 blocks`, `2 × 2 shares`, `5 blobs`; and the mempool reads `Mempool 2 blobs`.

**Roles.**

| Role | Can |
|---|---|
| Owner | Everything a Developer can, plus manage members and set producer behaviour |
| Developer | Register namespaces, submit blobs, take samples and toggle auto-sample, delegate, undelegate, redelegate, claim, create proposals, deposit, vote |
| Viewer | Read everything in the workspace, including snapshot download and proofs; sends no transactions |

403 copy by route, and the accessible description of the matching disabled controls (the viewer copy wins on every write route, owner-only ones included):

| Route and controls | Owner | Developer | Viewer |
|---|---|---|---|
| `PUT …/producer`; `radiogroup "Next block"` | allowed | 403 and disabled: `Only the owner can change producer behaviour.` | 403 and disabled: `Viewers can't make changes in this workspace.` |
| `POST …/invites`; form `Invite member` controls | allowed | 403 and disabled: `Only the owner can manage members.` | 403 and disabled: `Viewers can't make changes in this workspace.` |
| Every other write (namespaces, blobs, light-node samples and auto-sample, staking, proposals, deposits, votes) and its controls | allowed | allowed | 403 and disabled: `Viewers can't make changes in this workspace.` |
| Every read | allowed | allowed | allowed |

**Invites.**
- The owner invites an email with a role (Developer or Viewer). The link `/invites/<token>` is single-use and valid for `INVITE_TTL_HOURS` hours from sending. It is refused at and after the expiry instant.
- An unknown email sets a name and a password on the accept page. Errors: `Enter your name.` and `Password must be at least 8 characters.`, in that order.
- An email that already has an account confirms with its existing password.
- Acceptance adds the membership, signs the person in, and makes the link used.

**Server clock and event order.**
- With `CLOCK_MODE` `realtime` (the default), the server clock starts at `APP_START_AT` on first boot, advances with real time, and is persisted so a restart continues from where it was. With `manual`, it moves only through the grading clock route.
- Block h of every network is produced at `APP_START_AT + h × BLOCK_TIME_SECONDS`. Heights are gapless.
- Whenever the clock moves, every due event runs in time order, each at its own instant. At equal instants the order is:
  1. unbonding releases;
  2. proposal period ends;
  3. block production;
  4. light-node samples;
  5. fraud checks.

**Namespaces.**
- A namespace is 9 bytes (1 version byte, then 8 id bytes), written as 18 lowercase hex characters. Input is lowercased first.
- These are reserved and never registrable: version `00` with id up to `00000000000000ff` (that is, `000000000000000000` through `0000000000000000ff`, including the transaction namespace `000000000000000001` and the pay-for-blob namespace `000000000000000004`), tail padding `fffffffffffffffffe`, and parity `ffffffffffffffffff`. Users may use only version `00`.
- Messages, in this order, first failure only:
  1. `Namespace must use only the characters 0-9 and a-f.`
  2. `Namespace must be 18 hex characters (1 version byte and 8 id bytes); this one has <n>.`
  3. `Only namespace version 00 is open to users.`
  4. `Namespace <hex> is reserved.`
  5. `Give the namespace a name.`
  6. Then 409 `Namespace <hex> is already registered.` This applies across all workspaces. Of simultaneous registrations of one hex, exactly one gets 201 and the rest get 409.

**Shares.**
- A share is 64 bytes. Bytes 0–8 are the namespace. Byte 9 is the info byte: share version (0) × 2, plus 1 for the first share of a blob, so `01` for a first share and `00` for a continuation.
- A first share has the blob length in bytes as a 4-byte big-endian unsigned integer in bytes 10–13, then 50 data bytes in bytes 14–63. A continuation share has 54 data bytes in bytes 10–63. Unused bytes of a blob's last share are `00`.
- A blob of N bytes takes 1 share if N ≤ 50, else 1 + ceil((N − 50) / 54). Worked: 1 → 1, 50 → 1, 51 → 2, 104 → 2, 105 → 3, 120 → 3, 200 → 4, 300 → 6, 1000 → 19, 3452 → 64.
- A tail padding share has namespace `fffffffffffffffffe`, info byte `01`, length 0, and every other byte `00`.
- The square holds blob shares and tail padding only. Worked: block 2 share (0, 0) is `00000000000000a100010000003c` followed by 50 bytes of `6f`. Share (0, 2) is `00000000000000a100010000000a` followed by ten `70` and forty `00`.

**Square layout.**
- At production, a block takes pending blobs in submission order while they fit, stopping at the first that does not fit; that blob waits for the next block. Non-blob transactions are always included, in submission order.
- Shares are ordered by namespace (byte order), then submission order, then tail padding. They are laid row by row into a k × k original square, where k is the smallest power of two with k × k ≥ the data shares. An empty block is 1 × 1, and k is at most `MAX_SQUARE_WIDTH`.
- The layout is computed once at production and stored. The explorer, proofs and snapshot all read the stored layout.
- The largest blob is 50 + 54 × (`MAX_SQUARE_WIDTH`² − 1) bytes, which is 3,452 bytes by default.
- Worked, block 2: Orchard 60 bytes → 2 shares, Orchard 10 → 1, Harbor 120 → 3, Lantern 20 → 1. That is 7 data shares, so k = 4 with 9 padding shares. Row 0 is Orchard, Orchard, Orchard, Harbor. Row 1 is Harbor, Harbor, Lantern, padding. Rows 2–3 are padding.
- Worked, blocks 3 and 5: one 120-byte blob → 3 shares, so k = 2 with 1 padding share.
- Worked, block 6 with the seeded mempool and Felix's 200-byte Harbor blob: Orchard 6 + Harbor 4 + Lantern 4 = 14 shares, so k = 4 with 2 padding. Felix's shares are indices 6–9, which are (1, 2), (1, 3), (2, 0) and (2, 1). Without Felix's blob: 10 shares, k = 4, 6 padding.

**Erasure extension.**
- The field is GF(2^8) with reduction polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11d). Addition is XOR. Multiplication uses log and antilog tables with generator 2. Worked: 2 × 0x80 = 0x1d.
- For a line of k shares, byte position b (0–63) of share i (i = 0..k−1) is the value at x = i of the unique polynomial of degree < k. Evaluating that polynomial at x = k..2k−1 gives byte b of the k parity shares (Lagrange interpolation, with points as the field elements 0..2k−1).
- Quadrants: Q0 `Original` (top-left) is the original square. Q1 `Row parity` (top-right) extends each row of Q0. Q2 `Column parity` (bottom-left) extends each column of Q0. Q3 `Parity of parity` (bottom-right) extends each row of Q2.
- Worked for k = 2: P(2) = 3·a ⊕ 2·b and P(3) = 2·a ⊕ 3·b. For block 3 byte 14: a = 0x42 and b = 0x6e. 3·a = 0xc6 and 2·b = 0xdc, so share (0, 2) byte 14 is 0x1a. 2·a = 0x84 and 3·b = 0xb2, so share (0, 3) byte 14 is 0x36. Byte 9 (info bytes 01 and 00) gives 03 and 02.
- Block 3 full shares:
  - (0, 0) `00000000000000c3000100000078426c6f6273206172652073706c697420696e746f207368617265732c206c61696420696e20612073717561726520616e6420`
  - (0, 1) `00000000000000c30000657874656e6465642077697468207061726974792e20426c6f6273206172652073706c697420696e746f207368617265732c206c6169`
  - (0, 2) `00000000000000c30003caf0e8421a7c7b6ed58e717e7f20755250697492e7f21869be515ee3544b5f3486547b694420696e887d2073435d475c4938e36a6eb2`
  - (2, 0) `00000000000000c30003c840d2548676f140778a61726520574cb4bb9c60bbb29cb16095b8a396af957460b4a3bbac60bbb260a36095939fa396af60a3b2ac60`
  - (3, 3) `242424242424240f210106cd4ec7acb322e72a8ca9c1a780b7ff9cd2e88b5d655cd4ff808a598eb89270b790ecd2a840d2dca5e640e6b492a896be6859d0d6eb`

**Namespaced Merkle trees and roots.**
- A share in Q0 uses its own first 9 bytes as its leaf namespace. Every share in Q1, Q2 and Q3 uses the parity namespace `ffffffffffffffffff`. A leaf is (min = ns, max = ns, hash = SHA-256(0x00 ‖ ns ‖ share)).
- An inner node is (min = the smaller child min, max = the larger child max, hash = SHA-256(0x01 ‖ left.min ‖ left.max ‖ left.hash ‖ right.min ‖ right.max ‖ right.hash)). A root is shown as min hex, max hex and hash hex. Serialized, it is min ‖ max ‖ hash (50 bytes).
- Row root r is the NMT root over the 2k leaves of extended row r. Column root c is the same over column c.
- The data root is the binary Merkle root over the 4k serialized roots (row roots 0..2k−1, then column roots 0..2k−1), with leaf = SHA-256(0x00 ‖ root bytes) and inner = SHA-256(0x01 ‖ left ‖ right).
- Worked, block 3:
  - leaf (0, 0) hash `8ae44032ea24401cfbd4dd0a2d3bd02c316cbfe62602df791dae30495b4eb7a4`;
  - row 0 root min `00000000000000c300`, max `ffffffffffffffffff`, hash `fe8ec31b23bfbc21aaccebbd8b05298542b2b4c75316cea156c65ab15882341f`;
  - column 0 root hash `0a81b3a2aaeeccd4dbd1cbe93e9fabc992d5a3bb56a0a14a107d43875367c996`;
  - data root `917f4d16f69e876c76da0cdbc6f8935001e4628f279912d1cbdb1425885f23eb`.
- Worked, block 2:
  - row 0 min `00000000000000a100`, hash `a0d9966f3fb0d09021d636825ee1e231dd1bdba95d2c27fe747d21f8a534f165`;
  - row 1 min `00000000000000b200`, hash `06370d2ca07b9029694bfce8f2b0e32dbb1e8e904264e06d6b3fc61afb16249a`;
  - rows 2 and 3 min `fffffffffffffffffe`;
  - data root `74394f261f82f1bf398e3de573733f5249c6eaa0b7c98ba5c3c0361e83fcbbdf`.

**Namespace proofs.**
- Prove namespace (a block and a namespace) covers rows 0..k−1.
- **Inclusion.** For a row whose [min, max] covers the namespace and which holds it, the proof gives the start column, the end column (exclusive), and the proof nodes. The proof nodes are the fewest subtree nodes covering every leaf outside [start, end), ordered left to right.
- **Absence.** For a row that covers the namespace but holds none of it, the proof gives the leaf with the smallest namespace greater than it (its column and leaf hash), plus that leaf's inclusion proof.
- Verify recomputes the row root from the proof. The browser and the server must reach the same root.
- Line copy in the `Namespace proof` region:
  - `Row <r>: inclusion, columns <start> to <end − 1>, <n> proof nodes`;
  - `Row <r>: absence, next leaf at column <c>`;
  - `Row <r>: outside this row's namespace range`.
- Worked, block 2, Harbor:
  - Row 0 is inclusion with start 3, end 4 and 3 proof nodes: `f88cc191e709c55fd17d251db310293382646b0209a4d19a4db97a9d59bb4889` (columns 0–1), `586695226acd1200025e9256e1b90a222099dabdc0141448c3b2d19a8aa695e2` (column 2), and `cd5b55a6080cfcc3dec12ea9cc751cb120867ea543c76a263976141f23b98b00` (columns 4–7).
  - Row 1 is inclusion with start 0, end 2 and 2 proof nodes: columns 2–3 with min `00000000000000c300` and max `fffffffffffffffffe`, then columns 4–7.
  - Rows 2 and 3 are outside.
- Worked, absence of `00000000000000b100` in row 0: the next leaf is column 3 (namespace `00000000000000b200`) with leaf hash `0ddeab3716b07d5949f65557ec01cf5c07707c340db2636024b03e7530d0e78a`, plus the same 3 proof nodes.

**Sampling confidence.**
- A producer must withhold at least (k+1) × (k+1) of the (2k)² extended shares to make a block unrecoverable. So one uniform sample finds a withheld share with chance p = (k+1)² / (2k)².
- Confidence after s samples = 1 − (1 − p)^s, shown as a percentage with 4 decimals.
- Worked:
  - k = 2 (p = 9/16): 56.2500%, 80.8594%, 91.6260%;
  - k = 4 (p = 25/64): 39.0625%, 62.8662%, 77.3716%, 86.2108%, 91.5972%, 94.8796%;
  - k = 8 (p = 81/256): 31.6406%, 53.2700%, 68.0556%;
  - k = 1: 100.0000% after 1 sample.
- A node marks a block Available once its confidence is ≥ 99% and every sample was served. That takes 10 samples for k = 4 and 6 for k = 2.

**Sample sequence.** Per node and block, rng = mulberry32((`SAMPLE_SEED` + 7919 × height + 104729 × node number) mod 2^32). Each sample draws row = floor(rng() × 2k), then column = floor(rng() × 2k), with replacement. Each call of mulberry32 with 32-bit state `a` is exactly:

```
a = a + 0x6D2B79F5 | 0; t = Math.imul(a ^ a >>> 15, 1 | a);
t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296
```

Worked sequences:
- Wren (node 1) at height 6, k = 4: (2, 5), (1, 5), (1, 3), (2, 0), (1, 7), (3, 4), (6, 4), (1, 4).
- Kestrel (node 2) at height 2: (6, 2), (7, 7), (4, 0), (4, 5), (4, 6), (7, 1).
- Wren at height 4: (0, 3), (2, 0), (6, 5).

**Sampling schedule and block states.**
- An auto-sampling node samples every block produced while it is on. It takes one sample every `SAMPLE_INTERVAL_MS`, starting one interval after production, up to `SAMPLES_PER_BLOCK`. It stops early once the block is rejected.
- `Take sample` draws the next sample of the same per-node, per-block sequence, up to the same cap.
- A block is `Sampling` from production until a light node of its workspace marks it Available (it becomes `Available`) or it is rejected (it becomes `Rejected`). A fraud proof still rejects an Available block. A block is rejected at most once. No transition leaves Rejected.

**Producer behaviour.** The owner's `Next block` choice (`Honest`, `Withhold shares` or `Bad encoding`) applies to the next produced block only. It then returns to Honest.

**Withholding.** A withheld block serves every share except rows k−1..2k−1 × columns k−1..2k−1 (the bottom-right (k+1) × (k+1)). The first withheld sample by any light node rejects the block. Worked: with `Withhold shares` and the seeded mempool, block 6 is k = 4. Wren's sixth sample, (3, 4), taken 6 s after production, rejects it. The five samples before it show confidences 39.0625% through 91.5972%.

**Bad encoding and fraud proofs.**
- With `Bad encoding`, the producer flips the lowest bit of byte 14 of share (0, k) and commits every root to the altered square.
- `FRAUD_CHECK_DELAY_MS` after production, the network full node re-extends rows 0..2k−1, then columns 0..2k−1, and publishes one proof for the first line whose recomputed root differs from the committed one.
- The proof holds the block height, the axis and index, and the k original shares of that line, each with its NMT proof against its column root (for a row) or row root (for a column). It also holds the committed root and the recomputed root.
- Light nodes verify the proof by checking the k share proofs, re-extending, recomputing the root and comparing. On a mismatch the block is rejected.
- The `Bad encoding fraud proof` panel shows, in order (hashes in full):
  - `Row <i> of block <h>`;
  - `<k> of <k> shares verified against column roots`;
  - `Committed row root <hash>`;
  - `Recomputed row root <hash>`;
  - `Row <i> is not encoded correctly. Block <h> rejected.`

  A column proof uses `Column` and `row roots` instead.
- Worked, block 5: committed `e192ae6614412c74a5c3172143235d152cdbf258ddd317c74d6acc0ec835defe`, recomputed `fe8ec31b23bfbc21aaccebbd8b05298542b2b4c75316cea156c65ab15882341f`.
- Worked, block 6 with `Bad encoding` and the seeded mempool: share (0, 4) byte 14 goes from 0x71 to 0x70. Committed `11ff6ecf60e7971fdd14b69761c46758fe74b59cf4cad36467f73b8334f999a5`, recomputed `285512c9cea4bb8c34ce7b2a1ce036f8e7087fa6e48cf2f7cb67dfb497d4672b`.

**Rejection consequences.**
- When a block is rejected, every blob transaction in it becomes `Rejected — block <h> was rejected` and its fee is refunded.
- Staking and governance transactions and the rewards of that block stand.
- One mail goes to each member of the workspace (see Services).

**Gas and fees.**
- Gas = 65,000 + shares × 64 × 8. Fee in ufern = ceil(gas × `MIN_GAS_PRICE`), computed exactly with no floating-point rounding.
- Worked:

  | Bytes | Shares | Gas | Fee |
  |---|---|---|---|
  | 1 | 1 | 65,512 | 0.006552 FERN |
  | 120 | 3 | 66,536 | 0.006654 FERN |
  | 200 | 4 | 67,048 | 0.006705 FERN |
  | 300 | 6 | 68,072 | 0.006808 FERN |
  | 1,000 | 19 | 74,728 | 0.007473 FERN |

- Staking and governance transactions use 80,000 gas, a fee of 0.008000 FERN.
- The blob fee charged is the fee the developer entered, which defaults to the minimum the estimate shows. The fee is held at submit and charged (burned) at inclusion.
- Available balance = balance − held fees − held amounts.
- The `Fee (FERN)` field follows the minimum as the person types, until the person edits it.

**Blob submission.**
- Data is UTF-8 text from `Data` (its byte count is the UTF-8 length) or the exact bytes of `Upload file`.
- Refusals, 422, in this order, first failure only:
  1. `Choose a namespace.`
  2. `A blob must contain at least 1 byte.`
  3. `This blob is <n> bytes; a block holds at most <max> bytes of blob data.` (both numbers with thousands separators; `<max>` is the largest blob above)
  4. `Fee must be an amount in FERN with at most 6 decimals.`
  5. `Fee too low: this blob needs at least <f> FERN.`
  6. `Insufficient balance: available <a> FERN, this blob needs <f> FERN.`
- Then 503 while storage is down.
- A blob becomes `Pending` only after MinIO confirms the payload object. A failed write leaves no blob, no transaction and no held fee.
- Of simultaneous submissions that together exceed the available balance, the earlier-committed ones succeed and the rest get the insufficient-balance refusal.

**Transaction states.**
- States are `Pending`, `Included in block <h>`, and `Rejected — <reason>`. A pending transaction is never shown as included.
- Every transaction (blob, delegate, undelegate, redelegate, claim, proposal, deposit, vote) takes effect when its block is produced, in submission order.
- A transaction whose rule fails at inclusion becomes `Rejected — <refusal copy>`. Its fee is charged and its held amount is released.

**Staking.**
- Rewards of block N use stake as it stood before block N's transactions:
  - validator share = floor(R × validator stake / total bonded), where R = `BLOCK_REWARD_UFERN`;
  - commission = floor(share × rate), paid to the validator's operator account;
  - each delegation (self stake included) gets floor((share − commission) × amount / validator stake);
  - remainders are discarded.
- Rewards accrue as pending per delegation. `Claim rewards` withdraws all of them. Delegating more to a validator, undelegating from it, or redelegating from it withdraws that delegation's pending rewards at inclusion, after that block's rewards are added.
- Worked:
  - Before block 6, Felix's 300 FERN in Birch earns 0.025000 FERN per block (Birch share 305,555 ufern, commission 30,555).
  - Felix delegates 1,000 FERN to Cedar, included in block 6; his balance becomes 3,999.992000 FERN.
  - From block 7, total bonded is 11,800 FERN, Cedar's share is 254,237 ufern, and Felix's Cedar reward is 0.084745 FERN per block. After blocks 7–11 his pending reward is 0.423725 FERN.
  - Undelegating 1,000 FERN from Cedar, included in block 12 (`10:03:00`), withdraws 0.508470 FERN (blocks 7–12). His balance becomes 4,000.492470 FERN, and the 1,000.000000 FERN unbonding completes at `10:05:00`. After release his balance is 5,000.492470 FERN.
- Unbonding takes `UNBONDING_SECONDS` from inclusion. Release is inclusive at the end instant. The release ledger pair and the unbonding-complete mail are written in the same transaction.
- The `Unbondings` table shows `Unbonding until <time>` until the server reports release, then `Released`. It updates within 2 seconds of the release event, even if the device clock says otherwise.
- Redelegation moves stake at inclusion. Stake that arrived by redelegation cannot move again until `UNBONDING_SECONDS` after it arrived.
- Refusals (422, field in brackets), in this order:
  1. `Choose a validator.` (validator, from, to)
  2. `Choose a different validator.` (redelegate to the same validator)
  3. `Amount must be an amount in FERN with at most 6 decimals.` (amount)
  4. `Amount must be more than 0.` (amount)
  5. `You can delegate at most <a> FERN.` (available minus fee), `You can undelegate at most <a> FERN.` or `You can redelegate at most <a> FERN.` (movable stake) (amount)
  6. `This stake arrived from <validator> at <time> and can move again at <time>.` (amount)
  7. `You already have <max> unbondings in progress from <validator>.` (`<max>` = `MAX_UNBONDINGS`) (amount)
  8. `You already have <max> redelegations in progress.` (`<max>` = `MAX_REDELEGATIONS`) (amount)
  9. `Insufficient balance: available <a> FERN, this transaction needs <f> FERN.` (also for claim, proposal and vote)

  `<validator>` in messages is the validator's name.

**Paired ledger.**
- Accounts:
  - `member:<userId>` (liquid balance);
  - `operator:<validatorId>`;
  - `bonded:<validatorId>`;
  - `unbonding`;
  - `rewards`;
  - `burn`;
  - `deposits:<n>`;
  - `genesis`.
- Every movement posts exactly two entries with one `pairId`, amounts equal and opposite. A credit to an account is positive.
- Person-facing labels: `Genesis allocation`, `Fee`, `Fee refund`, `Delegation to <v>`, `Unbonding started from <v>`, `Redelegation from <v> to <w>`, `Rewards from <v>`, `Unbonding released from <v>`, `Deposit on proposal <n>`, `Deposit refund`, `Deposit burned` (`<v>` and `<w>` are validator names).
- A person's balance equals the sum of their account's entries. The total bonded equals the sum of every `bonded:*` account. Every `pairId` sums to zero.
- Corrections are new reversing pairs, never edits. Holds are not ledger entries.

**Governance.**
- Minimum deposit is `MIN_DEPOSIT_FERN`. The deposit period of `DEPOSIT_PERIOD_SECONDS` starts when the proposal is included. The voting period of `VOTING_PERIOD_SECONDS` starts at the time of the block whose inclusion brings the deposit to the minimum.
- Deposits are accepted only in the deposit period. A deposit submitted or included at or after the deposit end instant is refused with 409, or `Rejected — <copy>` at inclusion: `The deposit period for proposal <n> has ended.`
- Votes are accepted only in the voting period. Before it: `Proposal <n> is not open for voting yet.` At or after its end instant: `The voting period for proposal <n> has ended.`
- Options are `Yes`, `No`, `No with veto` and `Abstain`. A voter may change their vote until the end; the latest included vote counts. Missing option: `Choose an option.`
- Voting power is the voter's bonded stake at the moment of tally. Validator self stake votes as the validator.
- Tally:
  1. If votes / total bonded < 33.4% → `Rejected — quorum not reached`, deposits burned.
  2. Else if No with veto / votes > 33.4% → `Rejected with veto`, deposits burned.
  3. Else if Yes / (votes − Abstain) > 50% → `Passed`.
  4. Otherwise `Rejected`.

  Deposits are refunded on Passed and Rejected. If the deposit is not met by the deposit end → `Failed — deposit not met`, refunded.
- Status labels: `Deposit period`, `Voting period`, and the outcomes above.
- The live tally is recomputed after every block. The final tally runs at the voting end instant.
- Proposals are signalling only. A passed proposal changes no parameter; parameters stay as configured.
- New proposal: `Give the proposal a title.`, `Keep the title to 120 characters or fewer.`, description up to 2,000 characters (`Keep the description to 2,000 characters or fewer.`). The initial deposit may be 0. Proposals are numbered in inclusion order.
- Worked, proposal 3:
  - Before Felix votes: votes 9,500 of 10,800 (87.96%); Yes 4,500, No 2,000, No with veto 3,000 (31.58%); Yes share 47.37%; projected `Rejected`.
  - Felix votes No with veto, included in block 6: votes 9,800 (90.74%), veto 33.67%, projected and final `Rejected with veto`.
  - Felix votes Yes instead: Yes share 48.98%, `Rejected`.

### Services (DP-03, DP-13, DP-20, DP-28, DP-33, DP-37, DP-42, DP-43)

**PostgreSQL** is the system of record. It holds:
- workspaces, members, invites and sessions;
- accounts and the paired ledger;
- namespaces, transactions and blobs;
- every block with its stored share bytes, layout, row, column and data roots;
- samples and fraud proofs;
- validators, delegations, unbondings and redelegations;
- proposals, deposits and votes;
- the persisted clock and the mail outbox.

Paired entries live in a table `ledger_entries` with at least the columns `workspace_id`, `pair_id`, `account` and `amount_ufern`.

**MinIO** (bucket `S3_BUCKET`):
- Every blob payload byte for byte at `blobs/<blobId>`.
- Each produced block's extended square at `squares/<workspaceId>/<height>.bin`: the 2k × 2k shares row by row, with withheld shares as 64 zero bytes.
- A snapshot that could not be written is written once storage answers again, within 10 seconds.
- Storage outage behaviour (copy in Feedback states):
  - blob submit and snapshot download answer 503 after every other check;
  - the explorer, square, roots, proofs, namespace registration, staking and voting keep working from PostgreSQL;
  - health reports unavailable;
  - everything recovers without a restart once storage answers.

**Mailpit** (SMTP `SMTP_HOST`:`SMTP_PORT`, From `MAIL_FROM`). Every mail is written to the outbox in the same transaction as its event. A sender delivers it and retries every 5 seconds until SMTP accepts. While SMTP is unreachable, every action still succeeds and the outbox keeps the mail. Every mail is plain text and names the workspace.

| Event | To | Subject |
|---|---|---|
| Invite sent | the invitee | `Join <workspace name> on Fernsquare` (body holds `<APP_PUBLIC_URL>/invites/<token>`) |
| Block rejected | each member of the workspace | `Block <h> was rejected` |
| Unbonding released | the delegator | `Unbonding complete: <amount> FERN from <validator name>` |
| Voting opens | each member of the workspace | `Voting is open on proposal <n>: <title>` |
| `VOTE_REMINDER_SECONDS` before voting ends | each member with bonded stake who has no vote | `Reminder: proposal <n> closes at <time>` |

The seed itself sends no mail.

### Seed data (DP-07)

Every seeded person, workspace and validator is invented. The grading seed (and an empty database at first boot) builds exactly this, leaving the clock at block 5's time, `10:01:15` in `Europe/Berlin`. Block 6 is produced 15 s later.

- **People.**

  | Name | Email | Workspace and role |
  |---|---|---|
  | Amara Osei | `amara.osei@fernhill.test` | Owner of Fernhill Labs |
  | Felix Navarro | `felix.navarro@fernhill.test` | Developer in Fernhill Labs |
  | Priya Raman | `priya.raman@fernhill.test` | Viewer in Fernhill Labs |
  | Jonas Weber | `jonas.weber@quarry.test` | Owner of Quarry Labs |

  Passwords are returned only by the seed route.
- **Namespaces.** Fernhill Labs has Orchard `00000000000000a100`, Harbor `00000000000000b200` and Lantern `00000000000000c300`. Quarry Labs has Quarry main `00000000000000d400`.
- **Validators** (simulated operators, not people). Fernhill Labs:

  | Validator | Self stake | Commission |
  |---|---|---|
  | Alder | 4,000 FERN | 5% |
  | Birch | 3,000 FERN | 10% |
  | Cedar | 2,000 FERN | 0% |
  | Dogwood | 1,000 FERN | 20% |

  Delegations: Amara 500 FERN to Alder, Felix 300 FERN to Birch. Total bonded is 10,800 FERN. Quarry Labs has the same four validators with their self stake only.
- **Liquid balances after the seed:** Amara 2,000.000000 FERN, Felix 5,000.000000 FERN, Priya 100.000000 FERN, Jonas 1,000.000000 FERN. Genesis allocation entries are sized so these balances hold exactly after every seeded fee, refund, delegation and deposit. There are no pending rewards: history blocks paid none, and rewards start with block 6. For example, with the seed data at start Amara's available balance is 1,999.986487 FERN, because of her two held fees.
- **Fernhill history.** Each block was produced at its block time and every check on it has run:
  1. Block 1: empty (1 × 1, one tail padding share). Available.
  2. Block 2: Orchard blobs of 60 bytes (`o` × 60) and 10 bytes (`p` × 10), Harbor 120 bytes (`h` × 120), and Lantern 20 bytes (`l` × 20), all by Felix, in that submission order. Square 4 × 4. Available.
  3. Block 3: one Lantern blob by Felix, 120 bytes, the UTF-8 text `Blobs are split into shares, laid in a square and extended with parity. Blobs are split into shares, laid in a square an`. Square 2 × 2. Available.
  4. Block 4: one Harbor blob of 300 bytes (`h` × 300), produced with withheld shares. Square 4 × 4. Rejected: Wren's third sample, share (6, 5), was withheld.
  5. Block 5: the same Lantern blob as block 3, produced badly encoded (share (0, 2) byte 14 flipped from 1a to 1b). Square 2 × 2. Rejected, with a fraud proof on row 0.
- **Mempool** (pending, by Amara, in this order): Orchard 300 bytes (`q` × 300), then Lantern 200 bytes (`r` × 200). Their payload objects exist in MinIO, and snapshots exist for blocks 1–5. The one exception is a seed built while storage is unreachable, which writes those objects later, as the seed route in API states. The Pending rule in Blob submission governs submitted blobs, not seeded records.
- **Light nodes.** Fernhill Labs has Wren (node number 1, auto-sample on) and Kestrel (node number 2, auto-sample off, no samples taken). Quarry Labs has Heron (node number 1).
- **Fernhill proposals:**

  | # | Title | State |
  |---|---|---|
  | 1 | `Raise the maximum square width to 16` | Passed |
  | 2 | `Lower the block time to 10 seconds` | Rejected with veto |
  | 3 | `Fund a public sampling dashboard` | Voting period, ends `10:06:15`, 100 FERN deposited (by Amara). Votes: Alder Yes, Birch No with veto, Cedar No, Amara Yes; Felix has not voted |
  | 4 | `Add a namespace directory` | Deposit period, 40 FERN of 100 deposited (by Amara), deposit period ends `10:04:35` |
  | 5 | `Rename the Dogwood validator` | Failed — deposit not met |
  | 6 | `Halve the block reward` | Rejected — quorum not reached |
  | 7 | `Add a second light node tier` | Rejected |

## Technical requirements

### Deployment (DP-06)

Backend: TypeScript on Node 22 with npm. Frontend: TypeScript built with Node 22 in the same `build` step, served by the same server.

- `/app/run.json` holds string commands `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"node dist/server.js"}
  ```
- The server binds `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when set.
- `GET /api/health` answers as published in API.
- The schema is applied idempotently every time the server starts, not only at build.
- One server process holds the simulation, the clock, the mail sender and the WebSocket hub.

### Configuration and secrets (DP-45)

All of these are read at start, never hard-coded and never sent to the browser:

- **Services:** `DATABASE_URL`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` (default `Fernsquare <no-reply@fernsquare.test>`).
- **Server:** `APP_PUBLIC_URL`, `APP_PUBLIC_PORT`, `GRADING_KEY`, `CLOCK_MODE` (`realtime` or `manual`, default `realtime`), `APP_START_AT` (default `2026-11-06T09:00:00Z`), `APP_TIME_ZONE` (default `Europe/Berlin`).
- **Network timers and limits:**

  | Variable | Default |
  |---|---|
  | `BLOCK_TIME_SECONDS` | 15 |
  | `MAX_SQUARE_WIDTH` | 8 |
  | `MIN_GAS_PRICE` | 0.1 ufern per gas |
  | `BLOCK_REWARD_UFERN` | 1000000 |
  | `SAMPLE_SEED` | 42 |
  | `SAMPLES_PER_BLOCK` | 16 |
  | `SAMPLE_INTERVAL_MS` | 1000 |
  | `FRAUD_CHECK_DELAY_MS` | 5000 |
  | `UNBONDING_SECONDS` | 120 |
  | `MAX_UNBONDINGS` | 7 |
  | `MAX_REDELEGATIONS` | 7 |
  | `MIN_DEPOSIT_FERN` | 100 |
  | `DEPOSIT_PERIOD_SECONDS` | 300 |
  | `VOTING_PERIOD_SECONDS` | 600 |
  | `VOTE_REMINDER_SECONDS` | 120 |
  | `INVITE_TTL_HOURS` | 72 |
  | `SQUARE_ROW_REVEAL_MS` | 100 |

  The browser receives only `SQUARE_ROW_REVEAL_MS` and display settings.

### Server boundary (DP-04, DP-42)

- The browser talks only to the app's own origin. All service calls happen on the server.
- The server never serves source files, environment values, credentials, MinIO keys or presigned storage URLs.
- Writes are subject to the content-type and body-size rules in API, and unknown routes answer 404.
- If MinIO or SMTP is unreachable at boot, the server still starts and serves. Storage-dependent routes answer the outage response, mail stays in the outbox, and both recover as soon as the service answers, without a restart. Storage reachability is rechecked on every storage request and at least every 5 seconds. A server started with an empty database and `S3_ENDPOINT` pointing at an address nothing answers on must boot, report the unavailable health body, and serve the grading reset, seed and clock routes, so its seeded explorer, squares and proofs render while blob submission and snapshot download are refused.

### Browser support and performance (DP-15, DP-38)

- **Browsers:** current Chromium, Firefox and Safari.
- **Viewports:** 375×812, 390×844, 768×1024 and 1280×800.
- **Speed:** the explorer is usable within 3 seconds of navigation on the seeded data. Live events reach open pages within 2 seconds. The block page's square and roots render within 2 seconds for an 8 × 8 original square.
- **Service workers:** none are required, and pages work with them blocked.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`.
- IF-02: `THIRD_PARTY_NOTICES.md` at `/app` lists every shipped package (the production dependency tree, `npm ls --omit=dev --all --json`) with its name, version and licence.
- IF-03: Every shipped package (same definition as IF-02) is licensed MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or BlueOak-1.0.0.
- IF-04: The app uses no datastore, cache, queue or external service beyond PostgreSQL, MinIO and Mailpit, and calls no outside network host.
- IF-05: No font files or remote assets are shipped or fetched. Type uses system font stacks only.
- IF-06: `package-lock.json` is committed and `install` uses it.
- IF-07: The provided service configuration and dev credentials files are left unchanged.

## Engineering standards

- The TypeScript compiles in strict mode with no `any` escapes, and the code reads idiomatically for Node 22 and the browser.
- Names in code match this brief's domain terms (share, square, row root, data root, light node, sample, fraud proof, delegation, unbonding, proposal, deposit, tally, ledger pair).
- Each domain rule (share count, square width, extension, NMT hashing, confidence, the sample generator, gas and fee, reward split, tally, every state transition) is decided in exactly one place in the source, and the browser reuses the same rule rather than restating it.
- No abstraction exists with only a single implementation, and there are no defensive checks for states the published state machines make impossible.
- There is no dead, commented-out or unreachable code, and no feature beyond this brief.
- Every API error uses the one published error shape, with status codes chosen by the single published error order.
- Money is integer ufern throughout, and percentages are computed from exact fractions before display rounding.
