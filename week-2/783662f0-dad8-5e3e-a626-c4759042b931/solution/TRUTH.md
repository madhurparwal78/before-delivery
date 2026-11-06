# TRUTH — Plotwright golden

The brief made concrete. `brief: <section>` values are copied verbatim from `instruction.md`;
`decided: <why>` values fill silences in the brief's own intent. Visual tokens are in `DESIGN.md`.

## Journeys (ideal end-to-end flow)

### 1. Renting a server (brief: Journeys 1; DP-18..26)
- Start: `rowan` signed in, no servers. `/servers/new` shows "Step 1 of 3: Name" with focus on that heading.
- Next with an empty name: Checkout status lists `Enter a server name.`; the step stays.
- Name typed → Next → "Step 2 of 3: Plan" (focus on heading) → Back: the name is still filled → Next →
  choose `Hamlet, 6.00 USD a month` → Next → "Step 3 of 3: Review" → Rent server (button reads `Renting server`).
- Server side: Kill Bill account `plotwright-<server id>` (USD), AUTO_PAY_OFF tag, subscription
  `plotwright-<server id>-plan` on `hamlet-monthly`; only then the server row (`pending_approval`).
  The answer is `201 {server, billing, billing_url:"/s/<slug>/billing"}`; the same Idempotency-Key and
  body replays it without a second account.
- Lands on `/s/<slug>/billing`: PENDING, `Plan: Hamlet`, `6.00 USD due`,
  `Waiting for the billing provider to confirm payment.` A reload keeps it.
- Approve payment: `Asking the billing provider to take the payment.`, then an external payment
  `pw-pay-<invoice id>` for each unpaid invoice → PAID, `Payment confirmed by the billing provider.`
  Slow provider (no answer in 5 s): 202, PAYMENT PENDING and
  `Payment sent to the billing provider. Waiting for confirmation.`; the settler adopts the payment by
  its external key and the 10 s re-read shows PAID. Exactly one Kill Bill payment per invoice.
- Change plan to Borough: Kill Bill changes the subscription at once (IMMEDIATE) and invoices the
  difference; the page shows `Plan change to Borough is waiting for the billing provider to confirm payment.`
  and the server keeps Hamlet limits. Approve → `Plan changed to Borough.`, `Plan: Borough`, PAID.
- Download statement: `<slug>-statement.csv`, RFC 4180, rows plan_change/invoice/credit/payment in
  Kill Bill order with a running balance ending on the account balance; byte-identical when unchanged.
- Payment receipt mail `Payment confirmed for <server name>` once per confirmed payment.

### 2. Game night (brief: Journeys 2; DP-52)
- Owner rents and approves (journey 1). Friends → invites three emails; each press sends a fresh
  Idempotency-Key; Invite status `Invite sent to <email>`; each invite mails exactly one link
  `<base>/join/<token>`.
- Each friend opens the link: `Join <server name>`, `<inviter display name> invited <email>.`,
  signs up → lands on `/s/<slug>/roster`, creates two characters (dialog closes,
  `Character created: <name>`, focus back on New character).
- Party: Start party; others press `Join <party name>`; every member's Party list updates live; the
  leader starts "The Surveyor's Pegs". Walking onto the Old Well (8, 12) announces only
  `Checkpoint reached: Old Well` to every member (snapshot then manifest then row in MinIO).
- Two friends sit at the Oak Chess Table (panel draws in on the table route, focus a8 / h1); the
  third presses Watch (focus a8). The demonstration game by keyboard ends `Checkmate. <Black> wins.`;
  seated players then read `Coins settled: +10 for you` / `-10 for you`.
- Result bundle stored, settlement written once, one `Result: Oak Chess Table` mail per seated player
  with only their own coin line.
- History → the game → replay opens at `Move 12 of 12`. Owner exports: `Export ready`, Download export.

### 3. Season close (brief: Journeys 3; DP-27..31, DP-94)
- An unpaid invoice appears: the next re-read (≤ 10 s) moves the server to past_due,
  `suspends_at = past_due_since + BILLING_GRACE_SECONDS`, sends `Invoice overdue for <server name>`
  once, and every page shows the mustard banner with `suspends_at_label` verbatim.
- At `suspends_at` (checked every second) the server suspends in one transaction: games in play end
  `Abandoned: the server was suspended. Stakes returned.`, seats and spectators freed, runs paused,
  trades cancelled; open panels announce `This server is suspended. Play is paused until the invoice is paid.`
  The ink banner replaces the mustard one. Play answers 423 `server_suspended`.
- Export still works. Approve payment → PAID, receipt, runs resume. Start new season (confirmed in
  `Start a new season?`) → `Season 2 started`, boards empty.

### 4. Building, parking, crafting (brief: Journeys 4; DP-36..48, DP-96..97)
- World view cursor starts on the active character. Keyboard: arrows move the cursor; Shift+arrow
  walks (`Moved to x, y`); B places the selected material (`Placed stone block at x, y`); X breaks.
- Inventory (I): focus a1; Space picks up (`Picked up wood block from a1`), arrows, Space drops
  (`Moved wood block to e1`); dragging sends the identical request; Craft Fence → `Crafted fence`.
- Paper Kite: Enter on its tile opens `menu "Paper Kite"`; Move → `Parking Paper Kite. Choose a runway tile.`,
  cursor stays on the plane's tile; a grass tile announces `Not a runway`; Enter on a runway tile parks
  (`Paper Kite parked on runway at x, y`) and the sprite drives each stored step.
- Save world → `World saved`; storage down → `Save not written. Storage is unreachable, so nothing was saved and your world is unchanged. Try again in a minute.`

### 5–8 (brief: Journeys 5–8)
- Party chapter: checkpoint copy only; storage down → the waiting variant, retried every 10 s until
  stored exactly once; the leader leaving makes the earliest-joined member leader
  (`<name> now leads the party.`) on every screen live.
- Keyboard chess: promotion picker opens before sending, focus Queen, survives clock ticks; Escape
  returns focus to the pawn; castling by moving the king two files; offer rematch; Escape closes the
  panel and focus lands on the table tile. Last chair race: one seat, others `table_full`, focus on Watch.
- Trading: three-step offer form; partner hears `<name> offers a trade.` and gets
  `Open trade with <name>`; any change resets both accepts; completion moves everything in one
  zero-sum trade entry.
- Spectating: table pushes within 1 s, never a hidden hand; history search per server; replay viewer
  steps with Home/End/arrows announcing `Move n of total: <move copy>`.

## Decisions where the brief is silent

| Topic | Value | Source |
|---|---|---|
| Background billing check | each server claimed per 10 s across instances; balance read first, full read only when the status could move | decided: brief "at least every 10 seconds" with seven instances on one Kill Bill |
| `provider_reachable` | the answering instance's own observation, not stored | decided: instances share a database but not a network path |
| Weather push | claimed per period on the server row, loop every 250 ms | decided: one push per change within 1.5 s |
| Open trades on stream connect | re-pushed after the snapshot to the trade's parties | decided: a party opening the world later must still reach its window |
| Sign-in URL | canonical `/sign-in?next=<encoded path>`; a signed-in visitor goes straight on | decided: one stable address |
| Replay counter | brief: "the counter reads `Move <n> of <total>`"; "Each step updates the board and the counter in the same repaint and announces the step copy." The counter is its own element and always reads exactly `Move <n> of <total>`. After each step, the `status "Replay announcements"` region reads exactly the step copy `Move <n> of <total>: <move copy>`. Placement: the counter element is the first part of that region | decided: the step copy begins with the counter text, so the counter is not shown twice |
| Table before a game | position shows the game's opening position | decided: the board is visible from the first seat |
| Parallel requests with one Idempotency-Key | the first claims the key across instances; the others wait for it, then replay its stored response | decided: brief "The same key with the same body returns the stored response: the same status, the same body and the same record" |
| Move answer arriving after a table push | the panel keeps the pushed table; the answer's announcement still shows | decided: the server publishes each change before it answers, so a push received during the request is at least as new; brief "Moves. An accepted move appears and is announced within one second" |

## Palette, type, space

See `DESIGN.md` (paper `#f5f0e3`, ink `#161b12`, accent `#b8431c`, felt `#164430`, mustard `#d9a521`;
Pixelify Sans / Atkinson Hyperlegible / JetBrains Mono; 4 px unit; 2 px ink rules).

## Layout per viewport (brief: Screens and layout)

| Screen | 375×812 | 768×1024 | 1280×800 |
|---|---|---|---|
| World view | map full width (44 px tiles), bottom drawer ≤ 70 % height | map + 300 px rail (Collapse rail, Show chat) | map ≥ 60 % + fixed 320 px rail with chat |
| Roster | list above details | list ≤ 40 % left, details right, tops level | card grid (≥ 2 per row) + 320 px details rail |
| Dialogs | full-width bottom sheet | centred card | centred card |
| Table panel | covers everything under the top bar, 44 px squares | centred ≤ 640 px | centred ≤ 640 px, rail visible |
| Billing | one column | status + Approve left, plan + statement right | same |
| Admin | one column | one column | two columns |

## Motion

See `DESIGN.md ## Motion` (every graded animation is WAAPI with `data-anim`/`data-phase`; reduced
motion jumps to the end state with nothing in the animation list).

## States per async action

| Action | Pending | Success | Failure |
|---|---|---|---|
| Sign in | `Signing in` | next path or `/servers` | `Handle or passcode is wrong.` |
| Rent server | `Renting server` | billing route, PENDING | field errors; outage copy |
| Approve payment | `Asking the billing provider to take the payment.` | PAID / pending copy | published billing copy per code |
| Take seat / Watch | `Taking seat` / `Joining`, disabled | table route, draw-in | `This table is full. You can watch from the spectator ring.`, focus Watch |
| Save / export | `Saving world` | `World saved` / `Export ready` | save / export not-written copy |
| Coin purchase | Pay | purchase route, `<coins> coins added to <name>.` | 429 / 503 copy |

## Media and licences

All art drawn in code (`original`); Lucide icons (ISC); three OFL-1.1 fonts self-hosted
(`app/assets.json`); no image, audio or video files.
