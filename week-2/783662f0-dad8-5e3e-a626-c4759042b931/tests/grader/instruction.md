# Ninefold Works Plotwright

Plotwright is a hosted browser sandbox for friend groups. An owner rents a world server on a plan. Friends join through emailed invites, keep characters, build on a top-down tile map, carry an inventory, craft, trade, park cars and planes, play short story chapters as a party, and sit at in-world tables for chess, four in a row and a four-player trick-taking card game for coin stakes. Kill Bill holds each server's account, plan subscription, invoices and payments, and each player's coin purchases. MinIO stores world saves, story checkpoints, finished-game result bundles and owner exports as objects. Mailpit receives every mail the product sends: invites, receipts, overdue warnings and game results. Postgres stores everything else.

The following are out of scope:
- Open sign-up. People join only through an emailed invite, or when an owner adds an existing account by handle.
- Taking card or bank details. Kill Bill records every payment as an external payment.
- Voice and first-person 3D.
- Any datastore apart from the Postgres database and the MinIO bucket you are given.

## Problem and users

Friend groups who share a block-building world usually rent a game server from a commodity host. One person pays at roughly 5 to 15 US dollars a month, often an older sibling, a parent or the group's organiser. Hosts typically suspend a server a day or two after an invoice goes overdue, then delete its worlds 5 to 30 days later. The person paying often learns this only when friends message to say the server is gone. A crash that leaves a save half-written can cost the group weeks of building.

To play chess or cards during a session, the group moves to a separate site. That site has its own accounts, no link to the world's coins and no shared record of who won. Arguments that "lag ate my move" cannot be settled, because nothing replays the game from an authoritative log. Players who use screen readers can play keyboard chess on a few dedicated chess sites, but they lose that inside the game world.

Plotwright puts all of this in one place:
- The billing provider confirms each server's billing state.
- The server alone decides every table move, every clock, every trade and the weather.
- Every coin movement is a ledger entry that balances to zero.
- Saves and exports are either fully written or not written at all.
- Mail that cannot be sent is held and shown as held. It is never reported as sent.

Users:

- **Server owner** (weekly). Rents a server and gets it approved and paid through the billing provider. Keeps the server out of suspension, adds and invites members, sets tables, refunds coin purchases, and saves, restores and exports worlds.
- **Player** (daily). Keeps a roster of characters and walks the map. Builds and breaks blocks, crafts, trades, buys coins, parks vehicles, plays chapters to checkpoints, and sits at tables for staked games.
- **Party leader** (daily). Gathers a party for a chapter. When they leave, leadership passes cleanly to the right member.
- **Screen-reader player** (daily). Does everything a pointer player does with the keyboard alone, and hears each result announced. That includes walking, building, parking, inventory moves, sitting down and every board move.
- **Spectator** (weekly). Stands by an occupied table and follows the game live. Later, finds any finished game in history and steps through it to the exact final position and score.

## Journeys

1. **Renting a server.** Rowan is signed in and belongs to no server.
   - Rowan opens Rent a server and goes through "Step 1 of 3: Name", "Step 2 of 3: Plan" and "Step 3 of 3: Review". Rowan goes Back once and finds the name still filled in, then presses Rent server.
   - Rowan lands on the new server's billing route, which shows PENDING and the amount due, and presses Approve payment.
   - On a normal day the page shows PAID. On a slow day it shows PAYMENT PENDING with the waiting message, and after a reload a little later it shows PAID. Kill Bill holds exactly one payment for the invoice either way.
   - Rowan changes the plan to Borough, sees the plan-change-pending notice, approves, sees Borough as PAID, and downloads the billing statement.

2. **Game night.** This journey runs across four browsers: the owner and three friends.
   1. The owner rents a server and approves payment.
   2. The owner opens Friends and invites three friends by email.
   3. Each friend opens the join link from their mail, signs up on the Join page, lands on the roster and creates two characters with the New character dialog.
   4. A friend starts a party, the others join, and the leader starts "The Surveyor's Pegs". The party walks to the Old Well and everyone hears that the checkpoint was reached.
   5. Two friends walk to the Oak Chess Table and take seats. The third presses Watch. The two seated friends play the published demonstration game by keyboard, and it ends in checkmate.
   6. The stake settles, and both seated players receive the game-result mail.
   7. The spectator opens the game from history, and the replay viewer reads "Move 12 of 12".
   8. The owner exports the worlds.

3. **Season close.** A server is PAID, and then Kill Bill issues an invoice that nobody pays.
   - The owner receives the overdue warning mail, and every page shows the past-due banner with the server-given suspension time.
   - When the grace window ends, the server is suspended. Both tables that were in play are abandoned and every stake is returned. The open table panels show the suspension notice, a chapter run pauses, and the suspension banner replaces the past-due one.
   - The owner exports the worlds while suspended, approves payment, sees PAID, and receives a receipt. Play resumes.
   - The owner starts a new season on Leaderboards, and the leaderboards empty.

4. **Building, parking and crafting.** Ines signs in, opens Larkspur Commons and plays as Inkfinch.
   - Using only the keyboard, Ines moves the tile cursor next to Inkfinch and places a stone block from the inventory. Ines then breaks it, and the block returns to the inventory.
   - Ines opens the Inventory, moves the stack of wood with Space and the arrow keys, and crafts a fence.
   - With the cursor on the plane Paper Kite, Ines presses Enter and chooses Move. Ines hears "Parking Paper Kite. Choose a runway tile." and hears "Not a runway" as the cursor crosses grass. Ines parks the plane on a runway tile.
   - Ines saves the world. When storage is down, Ines hears the save-not-written notice instead, and the world is unchanged.

5. **A party chapter.** Kofi starts a party as Kestrel and Juno joins as Junebug. Kofi starts "The Surveyor's Pegs".
   - Junebug walks onto the Old Well tile, and both players hear only the checkpoint message.
   - When storage is down, they hear the waiting variant. The checkpoint is stored later, once storage returns.
   - Kofi leaves the party, and Junebug becomes its leader on both screens without a reload.

6. **Keyboard chess and the last chair.** Juno uses only a keyboard and a screen reader.
   - Juno walks Junebug next to the Oak Chess Table and takes a seat. The panel opens on the table route with focus on the board. Juno moves around the board grid, castles, and promotes a pawn through the promotion picker, which stays open across clock ticks.
   - Juno offers a rematch and closes the panel. Focus lands on the table's map tile.
   - At the Felt Card Table, three characters are seated when two more press Take seat at the same moment. One sits. The other hears that the table is full, and focus moves to Watch.

7. **Trading and topping up.** Kofi buys a Satchel of coins for Kestrel through the three-step coin checkout and lands on the purchase's route, which shows PAID.
   - Kestrel stands next to Inkfinch and offers coins for a lantern.
   - Ines changes the offer, and both screens show that both accepts were reset. Both players accept the final contents, and the trade completes with one balanced ledger entry.

8. **Watching and replaying.** Oskar stands next to an occupied card table and watches it live.
   - Oskar sees each played card within a second, and never sees any hand.
   - Later, Oskar searches the server's game history by a player's name and opens the game. With Home, End and the arrow keys, Oskar steps through it and hears each move. The final board, result and coin lines match what was played.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Run manifest and health check** `/app/run.json` installs, builds and serves the app, and the health endpoint answers as specified in Deployment even when a provider is down.
- **DP-02 — Configuration from the environment** Every Postgres, MinIO, Kill Bill and mail address and credential, the port and the public base address are read from the environment at start, as qualified in Configuration and secrets, and never appear in source, browser code or any response.
- **DP-03 — Same-origin server boundary** The server applies the body, content-type, origin and file-exposure rules in Server boundary to every request.
- **DP-04 — One error shape and precedence** Every error response uses the one JSON shape, the one precedence order and the Retry-After rules stated in API.
- **DP-05 — Conditional writes with ETags** Every server, world, table and character read returns a strong ETag, and every PUT or PATCH needs a matching If-Match, answering 428 or 412 as stated in API.
- **DP-06 — Field limits and unknown fields** Every text field accepts its published maximum length and refuses one more with its published field error, and any unknown body field, including names of built-in object members, answers 422 unknown_field.
- **DP-07 — Game reads need a session and membership** Game state, legal moves, move logs, replays, history, leaderboards and event streams answer 401 without a session, 404 to non-members and 403 not_your_turn for legal moves asked by anyone but the seated player on turn.
- **DP-08 — Event streams resume without gaps** Every event stream numbers its events, and a reconnect with Last-Event-ID receives every missed event in order before live events, with no duplicates, as stated in API.
- **DP-09 — Times in UTC, shown in the server's zone** The API sends every time as a UTC instant with milliseconds, and screens show times and labels in the server's own time zone setting.
- **DP-10 — Sign-in lands on your servers** A seeded player signs in with handle and passcode and lands on the servers list, or on the protected page they first asked for, and a reload keeps them there.
- **DP-11 — Sound cues and the Sound toggle** The published game sounds are generated in the browser only while the account's Sound setting is on, and the setting is remembered on the server.
- **DP-12 — Look and feel** Screens show the surveyed, tactile and candid look and the typeface and accent rules in Visual design.
- **DP-13 — Server-only game authority** Move legality, clocks, shuffles, settlement, trades and billing status are decided only in server code, each in one place, and browser code renders server state without deciding it.
- **DP-14 — Character roster within the limits** A member creates characters with a name, an appearance and a loadout within the roster, loadout and plan limits in Business rules, with names unique per server.
- **DP-15 — Roster by keyboard** The New character dialog and the character picker work with the keyboard alone, with the focus order, error summary and announcements in Interactions and Feedback states.
- **DP-16 — Roster screen layouts** The roster screen shows its published single-column, two-column and card-grid layouts at the three published widths.
- **DP-17 — Adding members by handle** The owner adds an existing account as a member by handle within the plan's member limit, and refusals follow the published order.
- **DP-18 — Rent a server in three steps** An owner rents a server through the three-step checkout, Back keeps entered values, and Rent server lands on the new server's billing route showing PENDING, which a reload keeps.
- **DP-19 — Checkout opens a provider account** Checkout creates the server in pending approval together with its Kill Bill account, auto-pay-off tag and plan subscription, and a replayed idempotency key returns the stored response without a second account.
- **DP-20 — Active only on provider-confirmed payment** Approve payment pays each unpaid invoice in Kill Bill with an external payment, and a server becomes active only when Kill Bill confirms its plan invoice paid, never on a client action, redirect or query string.
- **DP-21 — Slow provider leaves the payment pending** When Kill Bill does not answer a payment within 5 seconds, Approve payment answers 202 with PAYMENT PENDING, and a background settler later confirms exactly that payment, as qualified in Business rules.
- **DP-22 — One payment per invoice** However many Approve payment requests arrive at once, on however many instances, Kill Bill records exactly one payment per invoice and every other request gets its published answer.
- **DP-23 — Billing provider outage** With Kill Bill unreachable, checkout, payment, plan change and the statement are refused and change nothing, and the billing page shows the outage copy over the last confirmed status.
- **DP-24 — Plan change pending until confirmed** A plan change is made in Kill Bill at once, but the server keeps its old plan and limits, with the plan-change-pending notice, until Kill Bill confirms the change is paid.
- **DP-25 — Plan change on the billing page** An owner picks a new plan, sees the pending notice, approves payment and sees the new plan as PAID, on the billing route throughout and after a reload.
- **DP-26 — Billing statement** The owner downloads a billing statement whose rows, order, amounts and running balance follow Kill Bill exactly and whose bytes repeat when nothing changed.
- **DP-27 — Overdue grace window decided by the server** An unpaid invoice moves an active server to past due, and only the server moves it to suspended once the grace window set by BILLING_GRACE_SECONDS has passed.
- **DP-28 — Suspended servers refuse play** A suspended or not-yet-active server refuses every play, trade, purchase and save action with 423, and a provider-confirmed payment reactivates it.
- **DP-29 — Banners show the server's status** Every page of a past-due or suspended server shows its published banner word for word, with the status and suspension time the API returns whatever the device clock says.
- **DP-30 — Suspension abandons live play** Suspension abandons every game in play with stakes returned, frees its seats and spectators, pauses chapter runs, and a move racing it is either in the abandoned game's log or refused.
- **DP-31 — Billing mail** The owner receives the published overdue warning and a receipt for each confirmed payment, each exactly once.
- **DP-32 — World saves are all or nothing** A world save stores its snapshot, manifest and row together or nothing, and a failed save shows and announces the save-not-written copy, never a success.
- **DP-33 — Restore a world from a save** The owner restores a world to a stored save, recorded as a new save whose snapshot is a byte copy, and the map then matches it.
- **DP-34 — Reproducible owner export** The owner exports the latest save of every world as one archive, also while suspended, holding only that server's worlds, byte-identical when nothing changed.
- **DP-35 — Export storage failure partway** When storage fails partway through an export, the request answers 503, no export object remains, and the admin screen shows the export-not-written copy.
- **DP-36 — World map grid and tile cursor** The world map is a keyboard grid with one roving tile cursor, labelled tiles, the published key bindings and a tile inspector.
- **DP-37 — Walking on the map** A character walks one tile per step onto passable tiles only, by API, by Shift with an arrow key or with Walk here on a neighbouring tile.
- **DP-38 — Placing and breaking blocks** A player places blocks from their inventory and breaks blocks into it on tiles next to their character, with each rule's published rejection.
- **DP-39 — World announcements** Each map action announces exactly one published message in the World announcements live region.
- **DP-40 — World chat per server** Chat in a world stores and shows only that world's messages, oldest first, within the length limit.
- **DP-41 — Published breakpoints** The world view switches between the drawer layout, the map with collapsible rail and the map with fixed rail and chat exactly at the breakpoints in Screens and layout.
- **DP-42 — Full screen world view** The Full screen button and F put the world view's root into full screen with the published full-screen layout, and leaving restores the previous layout and focus.
- **DP-43 — Block place and break motion** A placed block grows in and a broken block bursts into shards within the published bands, and reduced motion swaps them instantly.
- **DP-44 — Parking cars and planes** A vehicle's owner parks a car on a road tile reached along roads or a plane on a runway tile, and each trip's steps are stored.
- **DP-45 — Parking by keyboard** A keyboard player opens their vehicle's menu, moves the tile cursor in parking mode with guidance announcements, parks with Enter and cancels with Escape, sending the same requests as a pointer.
- **DP-46 — Tap to park on a phone** On a phone-sized touch screen a player taps Move on their plane, taps a runway tile and sees and hears it parked.
- **DP-47 — Trip replay uses only stored steps** Replaying a stored trip from its steps reproduces the stored final tile, whatever was built on the route afterwards.
- **DP-48 — Vehicle drive motion** A parked vehicle's sprite drives through every stored step in order within the published per-tile band, and reduced motion moves it at once.
- **DP-49 — Parties and leadership succession** Characters form, join and leave parties, leadership passes to the longest-standing member when the leader leaves, an empty party closes, and every member's party list updates live.
- **DP-50 — Story chapter checkpoints** A party leader starts a chapter run, members reach its checkpoints in order, and each checkpoint snapshot is stored completely or kept for retry, as qualified in Business rules.
- **DP-51 — Chapter replay** Replaying a chapter run from its stored walk log reproduces the stored positions and checkpoints.
- **DP-52 — Game night** Four people go from renting a server through invites, characters, a chapter checkpoint, a keyboard chess game with a spectator and its mail to a replay and an export, as told in Journeys.
- **DP-53 — Table settings in two steps** The owner sets a table's stake and turn clock in a two-step form within the published limits, only while no seat is taken and only against the current version.
- **DP-54 — Exactly one player wins a contested seat** When several characters claim the last free seat at once, exactly one gets it and every other claim gets the table-full rejection.
- **DP-55 — Table full offers the spectator ring** A player who loses the seat race sees and hears the table-full copy and focus moves to the Watch button.
- **DP-56 — Seat lands on the table route** Taking a seat or watching opens the table panel on the table's own route with focus on its published target, and reloading or opening that address restores both.
- **DP-57 — Table draw-in** After the server confirms a seat, the table tile grows into the board panel, the map dims, tokens slide to their places and the turn fuse drains, and closing reverses it back to the tile.
- **DP-58 — Reduced-motion draw-in** With reduced motion the panel appears at once over an already dimmed map, and the turn clock reads as a numeric countdown updated once a second.
- **DP-59 — Full screen table panel** The Full screen button and F put the table panel into full screen, where its clock, dialogs and live regions keep working, and leaving returns focus to the button.
- **DP-60 — Chess rules on the server** The server accepts only legal chess moves, including castling, en passant and promotion, and declares check, checkmate and stalemate.
- **DP-61 — Automatic chess draws** Threefold repetition and the fifty-move rule end a chess game as a draw automatically, with no claim needed.
- **DP-62 — Move announcements** Every accepted or rejected move is announced in the Game announcements live region with the published wording.
- **DP-63 — Keyboard-only chess** A screen-reader player takes a seat, moves, castles, promotes and offers a rematch on the chess board grid with the keyboard only, and focus returns to the table tile when the panel closes.
- **DP-64 — Dialogs survive the turn clock** The promotion picker and the forfeit dialog stay open and focused through clock ticks and server pushes until the player chooses or the server ends the turn.
- **DP-65 — Rematch** After a settled game, once every seated player accepts a rematch a new game starts at the same table with the first move passed on.
- **DP-66 — Chess piece slide** An accepted chess move slides the piece to its square and fades a captured piece within the published band, and reduced motion swaps at once.
- **DP-67 — Table lifecycle** A table moves through open, seated, in play, finished and settled, and every illegal step is refused with its published error code.
- **DP-68 — Server turn clock and forfeit** When the server's per-turn deadline passes, the player on turn forfeits and the stake settles, whatever the client shows.
- **DP-69 — Turn clock shows server time** The turn clock counts down from the remaining time the server reports, whatever the device clock says, and the timeout is announced to every viewer.
- **DP-70 — Stakes and zero-sum settlement** Starting a game holds each seat's stake and each finished game writes one settlement entry, every ledger entry sums to zero and every wallet equals the sum of its lines.
- **DP-71 — Settlement waits for a stored result** A finished game settles only after its result bundle is stored, settles exactly once across retries and instances, and shows the waiting copy while storage is down.
- **DP-72 — Coin counter motion** After a settlement the coin balance counts to its new value within the published band and ends exactly on the ledger balance, and reduced motion jumps straight there.
- **DP-73 — Game result mail** Every seated player receives one game-result mail per settled game carrying only their own coin line.
- **DP-74 — Four in a row rules** The server drops each disc to the lowest free cell, rejects full columns and out-of-turn drops, accepts exactly one of two simultaneous drops, and ends the game on four in a line or a full board.
- **DP-75 — Trick game rules** The server deals from a stored seed, enforces following suit, gives each trick to the highest card of the led suit and scores the hand.
- **DP-76 — Hidden hands at the table** During a hand a seated player's table view and game record show only their own cards, and no other player or spectator receives them.
- **DP-77 — Disc drop and card deal motion** Discs drop, cards deal and played cards flip within the published bands, and reduced motion shows each end state at once.
- **DP-78 — Live spectating** Spectators join the ring at any table and see each change within the push delay in Business rules, without hidden cards.
- **DP-79 — Game replay reproduces the result** Replaying a finished game from its stored log reproduces the stored final position, score and settlement.
- **DP-80 — Game history search per server** Game history search and its result count cover only the current server's games.
- **DP-81 — Replay viewer by keyboard** A spectator opens a game from history and steps through it with the published keys, hearing each move, to the exact final position, result and coin lines.
- **DP-82 — Hidden cards on every read path** No game read, history list, event stream, replay or export sends a card in an unplayed hand to anyone but its holder until the hand ends.
- **DP-83 — Invites with a one-time join link** A member invites a friend by email, and the mailed link lets the friend sign up and join once before it expires.
- **DP-84 — Latest invite wins, one mail per invite** Re-inviting an email supersedes its earlier link, and each invite sends exactly one mail even under parallel requests.
- **DP-85 — Held mail while mail is down** While mail is unreachable every mail is held and shown as held, then sent exactly once when mail returns.
- **DP-86 — Friends list with live presence** The Friends dialog shows every member with ONLINE or OFFLINE and updates within the published push delay without a reload.
- **DP-87 — Coin top-up in three steps** A player buys a published coin pack through a three-step checkout, Back keeps the choices, and Pay lands on the purchase's own route.
- **DP-88 — Coins only on confirmed payment** A coin purchase credits coins with one ledger pair and a receipt mail only after Kill Bill confirms its payment, including after a slow answer.
- **DP-89 — Daily purchase limit** A player makes at most 5 coin purchases per server per day in the server's time zone, and parallel attempts never exceed it.
- **DP-90 — Refund of unspent coins** The owner refunds a purchase through Kill Bill only while its coins are unspent, writing one reversing ledger pair.
- **DP-91 — Trade window with escrow** Two players trade items and coins in a trade window where offers are held, both must accept the same contents within 60 seconds, and completion moves everything atomically in one zero-sum entry.
- **DP-92 — Accept races never complete unseen contents** When accepts and changes race, a trade completes only with contents both players accepted, otherwise it resets and says so.
- **DP-93 — Trade window updates live** Each side's offer and accept state reach the other player's open trade window within the published push delay.
- **DP-94 — Leaderboards and seasons** Each server ranks characters per game by wins with shared competition ranks, updates live after each settlement, and resets when the owner starts a new season.
- **DP-95 — Achievements** The eight published achievements unlock once each and show a toast for 5 seconds that never takes focus from an open dialog.
- **DP-96 — Inventory grid by keyboard and pointer** The inventory is a keyboard grid where an item moves by keyboard or by dragging with identical requests and published stack rules.
- **DP-97 — Crafting** Crafting a published recipe removes its inputs and adds its output in one step, or changes nothing.
- **DP-98 — Weather schedule and storm grounding** The server decides the weather from the published schedule, refuses plane parking during a storm and pushes each change.
- **DP-99 — Weather badge and day tint** The world view shows the server's weather in a badge with an announcement on change and darkens the map by the server's night level with the published motion.

## Frontend

### Screens and layout (DP-10, DP-16, DP-18, DP-25, DP-29, DP-36, DP-41, DP-42, DP-56, DP-59, DP-81, DP-87, DP-94)

**Routes.** Each route renders its screen when it is opened directly or reloaded.
- A visitor who is not signed in and opens a protected route goes to `/sign-in?next=<path>`.
- Only `/sign-in`, `/join/<token>` and `/help` are open to visitors who are not signed in.
- Any other path renders the not-found page, as does an owner-only route opened by a non-owner.

| Route | Screen |
|---|---|
| `/sign-in` | Sign-in |
| `/join/<token>` | Join a server (sign-up from an invite) |
| `/servers` | Your servers |
| `/servers/new` | Rent a server (three-step checkout) |
| `/s/<server slug>/billing` | Billing (owner only) |
| `/s/<server slug>/admin` | Server admin (owner only) |
| `/s/<server slug>/roster` | Roster |
| `/s/<server slug>/coins` | Coins: top-up checkout and your purchases |
| `/s/<server slug>/coins/<purchase id>` | Purchase |
| `/s/<server slug>/leaderboards` | Leaderboards |
| `/s/<server slug>/w/<world slug>` | World view |
| `/s/<server slug>/w/<world slug>/t/<table id>` | World view with that table's panel open |
| `/s/<server slug>/games` | Game history |
| `/s/<server slug>/games/<game id>` | Replay viewer |
| `/help` | Help and every keyboard shortcut |

**Top bar.** Every screen has a top bar.
- On the left is the wordmark "Plotwright", followed by the main navigation with three links: Play, Games and Help.
  - On a server's pages, Play opens that server's first world and Games opens that server's history. Elsewhere, both open `/servers`.
- On a server's pages, the bar also has links to Roster, Coins and Leaderboards and the Friends button. The owner also sees Billing and Server admin.
- On the right are the character picker (on world and roster pages) and Sign out.
- Below 768 pixels wide, everything except the three navigation links moves into a "Menu" disclosure.

**Server notice.**
- Every page of a past-due or suspended server shows a full-width banner directly under the top bar, to the owner and to every member. It is chosen only from the Server object's `status` and `suspends_at_label`.
- Every server page reads the Server object when it opens, on each `server` event, and at least every 10 seconds. A status change therefore appears on open pages within 20 seconds.

**Sign-in and Join.** One centred card each.
- 375: full width with page margins. 768 and 1280: centred, about the width of a paperback page.
- Join shows the server's name and the inviter above the form.

**Your servers.** A heading, then a list of the user's servers. Each entry shows the name, the user's role and the status word in capitals. Below the list is Rent a server.
- 375: one column. 768: two columns of cards. 1280: three columns of cards.

**Rent a server.** A three-step form, described under Interactions. At 768 and up, a plain summary panel to the right shows the chosen plan's monthly price, its character limit and its member limit. At 375 the summary sits below the form.

**Billing.**
- Contents, in order: the heading, the Billing status region, Approve payment, the plan choice with Change plan, and the Download statement link.
- 375: one column, in that order. 768 and 1280: the status card and Approve payment on the left, the plan choice and Download statement on the right.
- The page re-reads billing every 10 seconds.

**Server admin.** Sections:
- Members (add by handle, then the member list)
- Tables (each table with its stake, turn clock and a Settings button)
- Worlds (one block per world with its rename field, its saves newest first, and a Restore button per save)
- Export
- Server settings (time zone)
- Coin purchases
- Outgoing mail

Layout:
- 375 and 768: one column, in the order above.
- 1280: two columns. The left holds Members, Tables, Export and Server settings. The right holds Worlds, Coin purchases and Outgoing mail.

**Roster.**
- Contents: the heading "Characters", the New character button, the character picker, the roster of the user's characters on this server, and a Character details region for the selected character. The details show the name, appearance, loadout, coin balance, world and tile, and the appearance choice with Save appearance.
- Layouts:
  - Under 768 pixels (checked at 375×812): one column, with the roster as a list (one character per row, full width) above Character details.
  - 768 to 1279 pixels (checked at 768×1024): the roster list on the left, at most about 40 percent of the width, and Character details on the right. The tops of the two are level.
  - 1280 pixels and up (checked at 1280×800): the roster as a grid of cards, at least two cards per row, filling the left. Character details sit in a fixed rail about 320 pixels wide on the right.
- No other breakpoint changes which layout a published viewport gets.

**Coins.**
- Contents: the three-step coin checkout, then the list of your purchases on this server, newest first.
- 375 and 768: one column. 1280: the checkout on the left, the purchases on the right.

**Purchase.** The heading "Purchase", then the Purchase status region. The owner also sees Refund. One column at every size.

**Leaderboards.**
- Contents: the heading "Leaderboards", a "Season <n>" subheading, one tab per game and the leaderboard table. The owner also sees Start new season.
- One column at every size. The table spans the content width, which is capped at about 720 pixels at 1280.

**World view.** This is the main screen.
- A paper-toned tile map, 40 tiles wide and 24 tall, sits under a fine ink survey grid.
- Each tile is 32 pixels square at 768 pixels wide and up, and 44 pixels below 768.
- The map pans by scrolling or dragging inside its own area. The page never scrolls sideways.
- A header strip above the map shows, in this order: the world name, the Weather badge, the active character's coin balance, Inventory, Offer a trade, Full screen and Save world. Below 768 the strip wraps onto two lines.
- A night overlay over the map darkens it by the server's night level.
- The rail holds, in this order: Party, Tile inspector, Chat and the Sound toggle.

| Viewport width | Layout |
|---|---|
| under 768 pixels (checked at 375×812) | One column. The map fills the width under the top bar and header strip. A bottom drawer starts closed, showing only a handle bar with Open drawer. Open, it covers up to 70 percent of the screen height and stacks Party, Tile inspector, Chat and Sound. No rail sits beside the map. |
| 768 to 1279 pixels (checked at 768×1024) | The map on the left and a rail about 300 pixels wide on the right with Party, Tile inspector and Sound. Chat sits behind a Show chat disclosure at the bottom of the rail. Collapse rail hides the rail and gives the map the full width, and the button then reads Expand rail. |
| 1280 pixels and up (checked at 1280×800) | The map on the left, taking at least 60 percent of the width. A fixed rail about 320 pixels wide on the right shows Party, Tile inspector, Chat and Sound. There is no collapse control. |

- The rail's left edge is never left of the map's right edge.
- No breakpoint other than 768 and 1280 changes which of these layouts a viewport gets.

**Full-screen world layout.** While the world view's root is full screen, at any size:
- The map fills the screen.
- The rail is hidden until R shows it as an overlay on the right; R hides it again.
- Chat is hidden until C shows it; C hides it again.
- The header strip stays as a single line along the top edge.

On leaving full screen, the layout that matches the viewport width comes back.

**Table panel.**
- The panel opens over the world view as a felt-green inset with a firm ink rule, never as a separate page. It holds:
  - the board, in the centre;
  - the seated tokens, at their edges of the board;
  - the spectator ring, around the panel;
  - the turn clock, beside the active seat;
  - the table controls, including Full screen;
  - the Game announcements line.
- 768 and 1280: centred over the map, at most about 640 pixels wide. The rail stays visible at 1280.
- 375: the panel covers everything under the top bar. Chess squares are at least 44 pixels, and the controls stack under the board.
- In full screen, the board grows to the largest size that fits beside the seats and controls.

**Dialogs over the world view.** Each dialog is a centred card at 768 and up and a full-width sheet anchored to the bottom at 375.
- New character
- Inventory: the 6 by 4 grid, with Crafting below it
- Offer a trade
- Trade with `<name>`
- Friends

**Game history.** A search box, then the results count, then the list of games. One column at every size.

**Replay viewer.**
- Contents: the board (for the card game, the dealt hands and the tricks), the step controls, the move counter and the Result region.
- 375: the board, then the controls, then the result. 768 and 1280: the board on the left, the controls and result on the right.

### Public screens and controls (DP-06, DP-10, DP-11, DP-15, DP-17, DP-18, DP-25, DP-26, DP-29, DP-32, DP-34, DP-36, DP-39, DP-40, DP-41, DP-42, DP-45, DP-53, DP-55, DP-56, DP-59, DP-62, DP-63, DP-64, DP-69, DP-80, DP-81, DP-83, DP-86, DP-87, DP-90, DP-91, DP-94, DP-95, DP-96, DP-97, DP-99)

Only the controls and regions below are public. Their role and accessible name are fixed, and everything else is yours to design. `<…>` marks a value taken from the record.

| Where | Role and accessible name | Visible copy or content |
|---|---|---|
| every page | `navigation "Main"` with `link "Play"`, `link "Games"`, `link "Help"` | |
| every page when signed in | `button "Sign out"` | |
| server pages | `link "Roster"`, `link "Coins"`, `link "Leaderboards"`, `button "Friends"` | |
| server pages, owner only | `link "Billing"`, `link "Server admin"` | |
| server pages | `region "Server notice"` | banner copy, present only when the server is past due or suspended |
| sign-in | `textbox "Handle"`, `textbox "Passcode"` (masked), `button "Sign in"`, `status "Sign-in status"` | |
| join | `heading "Join <server name>"`, `textbox "Handle"`, `textbox "Display name"`, `textbox "Passcode"` (masked), `button "Join server"`, `status "Join status"` | `<inviter display name> invited <email>.` under the heading |
| your servers | `heading "Your servers"`, `list "Servers"` with `link "<server name>"` per server, `link "Rent a server"` | each entry shows the status word |
| rent a server | `heading "Step <n> of 3: <step name>"`; step 1 `textbox "Server name"`; step 2 `radiogroup "Plan"` with `radio "Hamlet, 6.00 USD a month"` and `radio "Borough, 12.00 USD a month"`; step 3 a review list; `button "Back"` (steps 2 and 3), `button "Next"` (steps 1 and 2), `button "Rent server"` (step 3); `status "Checkout status"` | |
| billing | `heading "Billing"`, `status "Billing status"`, `button "Approve payment"`, `radiogroup "Plan"` (the same two radios), `button "Change plan"`, `link "Download statement"` | |
| server admin | `textbox "Member handle"`, `button "Add member"`, `list "Members"` | |
| server admin | per table: `button "Settings for <table name>"`, which opens `dialog "Table settings"` with `heading "Step <n> of 2: <step name>"`, `spinbutton "Stake"` (step 1), `spinbutton "Turn clock seconds"` (step 2), `button "Back"`, `button "Next"`, `button "Save settings"` | |
| server admin | per world `region "<world name>"` with `textbox "World name"`, `button "Rename world"`, `button "Save world"`, `list "Saves"`, `button "Restore save <number>"` per save | |
| server admin | `button "Export worlds"`, `link "Download export"` (once ready), `combobox "Time zone"`, `button "Save time zone"`, `list "Coin purchases"` with `link "<character name>: <pack name>"` per purchase, `list "Outgoing mail"`, `status "Admin status"` | each mail entry reads `<subject> to <handle>: <SENT or HELD>` |
| roster | `heading "Characters"`, `button "New character"`, `list "Roster"` with `listitem` per character, `region "Character details"` with `radiogroup "Appearance"` and `button "Save appearance"`, `status "Roster status"` | |
| roster, world view | `combobox "Character"` with `listbox` of `option "<character name>"` | |
| new character | `dialog "New character"` with `textbox "Name"`, `radiogroup "Appearance"` (`radio "Surveyor"`, `radio "Mason"`, `radio "Pilot"`, `radio "Gardener"`), `listbox "Loadout"` (multi-select, `option "Compass"`, `option "Rope"`, `option "Lantern"`, `option "Trowel"`, `option "Whistle"`, `option "Map case"`), `button "Create"`, `status "New character status"` | |
| coins | `heading "Step <n> of 3: <step name>"`; step 1 `radiogroup "Coin pack"` with `radio "Pouch, 100 coins, 1.00 USD"`, `radio "Satchel, 550 coins, 5.00 USD"`, `radio "Chest, 1200 coins, 10.00 USD"` and `radiogroup "Character"` with `radio "<character name>"` per own character; step 2 the review; step 3 `button "Pay <price> USD"`; `button "Back"`, `button "Next"`; `list "Purchases"`; `status "Purchase status"` | |
| purchase | `heading "Purchase"`, `status "Purchase status"`, `button "Refund"` (owner only) | |
| leaderboards | `heading "Leaderboards"`, `heading "Season <n>"`, `tablist "Game"` with `tab "Chess"`, `tab "Four in a row"`, `tab "Card game"`, `table "Leaderboard"` with columns Rank, Character, Wins, `button "Start new season"` (owner), `dialog "Start a new season?"` with `button "Start season"` and `button "Keep season"`, `status "Leaderboard status"` | |
| friends | `dialog "Friends"` with `list "Friends"`, `textbox "Friend's email"`, `button "Send invite"`, `list "Invites"`, `status "Invite status"` | each friend reads `<display name> (<handle>): <ONLINE or OFFLINE>`; each invite reads `<email>: <SENT, HELD, USED, EXPIRED or SUPERSEDED>` |
| world view | `grid "World map"`, one `gridcell` per tile, named `<x>, <y>, <tile label>` and then `, <contents>` when the tile holds anything | for example `12, 7, Grass, Inkfinch` |
| world view | `status "Weather"`, the coin balance as `group "Coin balance"`, `button "Inventory"`, `button "Offer a trade"`, `button "Full screen"` / `button "Exit full screen"` (with pressed state), `button "Save world"`, `status "World announcements"`, `status "Achievements"` | Weather shows CLEAR, RAIN or STORM |
| world view, 768 and up | `complementary "World rail"` | |
| world view, 768 to 1279 | `button "Collapse rail"` / `button "Expand rail"`, `button "Show chat"` / `button "Hide chat"` | |
| world view, under 768 | `button "Open drawer"` / `button "Close drawer"`, `region "Drawer"` | |
| rail or drawer | `region "Party"` with `list "Party members"`, `textbox "Party name"`, `button "Start party"`, `button "Join <party name>"` per open party, `button "Leave party"`, `button "Start chapter"` | the leader's entry is marked "Leader" in words |
| rail or drawer | `region "Tile inspector"` with `radiogroup "Block material"` (`radio "Wood"`, `radio "Stone"`, `radio "Brick"`, `radio "Glass"`) and, as the tile allows, `button "Walk here"`, `button "Place block"`, `button "Break block"`, `button "Take seat"`, `button "Watch"`, `button "Move <vehicle name>"`, `button "Park here"`, `button "Cancel parking"` | tile label, coordinates, contents |
| rail or drawer | `region "Chat"` with `log "Chat messages"`, `textbox "Message"`, `button "Send"`; `button "Sound"` with pressed state | each message reads `<character name>: <text>` |
| vehicle menu | `menu "<vehicle name>"` with `menuitem "Move"` | |
| inventory | `dialog "Inventory"` with `grid "Inventory"` (6 columns a to f, 4 rows 1 to 4), `region "Crafting"` with `button "Craft <recipe name>"` per recipe, `status "Inventory announcements"` | cells are named `<column letter><row number>, <item name>, <count>` or `<column letter><row number>, empty` |
| offer a trade | `dialog "Offer a trade"` with `heading "Step <n> of 3: <step name>"`, `combobox "Partner"` (step 1), `spinbutton "Coins to offer"` and `spinbutton "<item name> to offer"` per item kind you hold (step 2), `button "Back"`, `button "Next"`, `button "Open trade"` (step 3) | |
| trade | `dialog "Trade with <partner name>"` with `region "Your offer"`, `region "<partner name>'s offer"`, `spinbutton "Coins to offer"`, `spinbutton "<item name> to offer"`, `button "Update offer"`, `button "Accept"`, `button "Cancel trade"`, `status "Trade status"`; in the header strip, `button "Open trade with <name>"` while a trade is open | each offer region shows its coins, items and ACCEPTED or NOT ACCEPTED |
| table panel | `dialog "<table name>"`, `list "Seats"`, `list "Spectators"`, `timer "Turn clock"`, `button "Start game"`, `button "Stand up"`, `button "Forfeit"`, `button "Offer rematch"`, `button "Accept rematch"`, `button "Close table"`, `button "Full screen"` / `button "Exit full screen"`, `status "Game announcements"` | |
| chess | `grid "Chess board"`, a `gridcell` per square named `<square>, <colour> <piece>` or `<square>, empty` | for example `e4, White Knight` |
| four in a row | `grid "Four in a row board"` (columns a to g, rows 1 at the bottom to 6 at the top), cells named `<square>, Ink disc`, `<square>, Gold disc` or `<square>, empty`; `button "Drop in column <n>"` for n from 1 to 7, for seated players | |
| card game | `listbox "Your hand"` with an `option "<card name>"` per card, `region "Current trick"` | |
| promotion | `dialog "Choose promotion piece"` with `button "Queen"`, `button "Rook"`, `button "Bishop"`, `button "Knight"` | |
| forfeit | `dialog "Forfeit this game?"` with `button "Forfeit game"`, `button "Keep playing"` | |
| game history | `searchbox "Search games"`, `status "Search results"`, `list "Games"` with `link "<table name>: <player names in seat order joined by ' vs '>"` per game | |
| replay viewer | `region "Replay board"`, `button "First move"`, `button "Previous move"`, `button "Next move"`, `button "Last move"`, `status "Replay announcements"`, `region "Result"` | the counter reads `Move <n> of <total>` |
| not found | `heading` | the not-found copy |

**Names used inside controls.**
- Card names take the form `<Rank> of <Suit>`. Ranks are Two to Ten, Jack, Queen, King and Ace. Suits are Clubs, Diamonds, Hearts and Spades.
- Tile labels are Grass, Water, Road, Runway, Sand, or the table's name.
- A tile's contents are joined with ", " in this order:
  1. its block, as `<material> block` with the material in lower case;
  2. its vehicle name;
  3. the names of the characters on it, in alphabetical order.
- Item names are in Seed data.

**Animated elements.** Every animated element carries a `data-anim` attribute naming its animation, and a `data-phase` attribute. The `data-anim` names are:
- `table-drawin`
- `token-slide`
- `turn-fuse`
- `piece-slide`
- `piece-capture`
- `disc-drop`
- `card-deal`
- `card-flip`
- `vehicle-drive`
- `block-place`
- `block-shard`
- `coin-count`
- `night-tint`

`data-phase` is `start` when the animation begins, `mid` from its half-way point (for `card-flip`, from the moment the card is edge-on), and `end` when it finishes. Under reduced motion it is set to `end` at once. The night overlay also carries `data-night-level` with the level it shows.

### Interactions (DP-11, DP-15, DP-18, DP-36, DP-37, DP-38, DP-42, DP-45, DP-46, DP-53, DP-55, DP-56, DP-59, DP-63, DP-64, DP-65, DP-81, DP-86, DP-87, DP-91, DP-94, DP-95, DP-96, DP-97)

**Grids.**
- The world map, the chess board, the four-in-a-row board and the inventory each follow the WAI-ARIA Authoring Practices grid pattern with a roving tabindex.
- Exactly one cell of each grid has `tabindex="0"`, and every other cell has `tabindex="-1"`. The grid is one Tab stop, and arrow keys move focus between cells.
- The focused cell's accessible name is its published cell name. On the world map the focused cell is the tile cursor.
- Grid sizes:

| Grid | Size |
|---|---|
| world map | 40 columns by 24 rows |
| chess board | 8 by 8 |
| four in a row | 7 columns by 6 rows |
| inventory | 6 columns by 4 rows |

**Lists and dialogs.**
- The card hand follows the listbox pattern with `aria-activedescendant`. Focus stays on the listbox while the active option moves.
- Every dialog follows the WAI-ARIA dialog (modal) pattern:
  - focus moves into the dialog;
  - Tab and Shift+Tab wrap inside it;
  - Escape closes it;
  - focus returns to the control that opened it.
- This covers the table panel, the promotion picker, the forfeit dialog, the drawer sheet, New character, Inventory, Offer a trade, Trade with, Friends, Table settings and Start a new season.

**Key bindings.** This is the complete list of key bindings.
- Letter shortcuts never act while focus is in a text box, spinbutton, combobox or searchbox.
- Each shortcut works whichever control in its region has focus.

| Where focus is | Key | Effect |
|---|---|---|
| any grid | Arrow keys | Move one cell, stopping at the edge |
| any grid | Home, End | First or last cell of the current row |
| any grid | Ctrl+Home, Ctrl+End | First cell of the first row, or last cell of the last row |
| any grid | PageUp, PageDown | Up or down 8 rows, stopping at the first or last row |
| World map or Tile inspector | Shift+Arrow | Walk the active character one tile |
| World map or Tile inspector | B | Place a block of the selected material on the cursor tile |
| World map or Tile inspector | X | Break the block on the cursor tile |
| World map | Enter | In parking mode, park on the cursor tile. On a tile holding one of your vehicles, open its vehicle menu. Otherwise, move focus to the Tile inspector's first button |
| World view | Escape | In parking mode, cancel parking mode |
| World view | F | Enter or leave full screen |
| World view | I | Open Inventory |
| World view in full screen | R | Show or hide the rail overlay |
| World view in full screen | C | Show or hide chat |
| Vehicle menu | Up, Down, Enter, Escape | Move, choose, or close the menu back to the tile |
| Table panel | T | Announce the turn clock copy in Game announcements |
| Table panel | F | Enter or leave full screen for the panel |
| Table panel | Escape | Close the innermost open dialog, or the panel itself |
| Chess board | Enter or Space | Select your piece, or send a move to the focused square |
| Chess board | Escape | Clear the selection |
| Four in a row board | Enter or Space | Drop in the focused cell's column |
| Your hand | Up, Down, Left, Right, Home, End | Move the active card |
| Your hand | Enter | Play the active card |
| Inventory grid | Space | Pick up the item in the focused cell, or drop the carried item into it |
| Inventory grid | Escape | Cancel a carried item and leave it where it was. Otherwise, close Inventory |
| Replay board | Left, Right, Home, End | Previous move, next move, first move, last move |
| Character combobox | typing, Down, Up, Enter, Escape | Filter, move the active option, pick it, clear the text |
| Appearance radio group | Arrow keys | Choose an appearance |
| Loadout listbox | Up, Down, Space | Move, and toggle the focused item |

**Map.**
- The tile cursor starts on the active character's tile.
- Clicking or tapping a tile moves the cursor there and shows that tile in the Tile inspector. Below 768 pixels this does not open the drawer.
- The inspector offers its buttons by tile:
  - Walk here: the tile is directly north, east, south or west of the active character.
  - Place block: a grass or sand tile with no block.
  - Break block: the tile has a block.
  - Take seat and Watch: a table tile.
  - Move `<vehicle name>`: the tile holds one of your vehicles.
- Every action goes to the server, and the server's answer is announced.

**Parking.**
- Move `<vehicle name>`, either the inspector button or the menu item, starts parking mode and announces the parking prompt. Below 768 pixels it also closes the drawer.
- In parking mode, every tile of the right surface (road for a car, runway for a plane) with no vehicle on it shows a highlighted inset.
- When the cursor arrives on a tile of the wrong surface, the guidance copy is announced. Highlights and guidance are hints only; the server decides.
- Any of these sends the same park request: a tap or click on a tile, Enter on the cursor tile, or Park here.
- Cancel parking or Escape leaves parking mode, announces the cancel copy and returns focus to the vehicle's tile.

**Roster.**
- New character opens its dialog with focus on Name.
- Tab order inside the dialog is Name, then Appearance (one stop, with arrow keys choosing), then Loadout (one stop, with Space toggling the focused item), then Create, then back to Name.
- Space on a fourth loadout item while three are selected leaves it unselected and announces the loadout limit copy in New character status.
- Create sends the request.
  - On success, the dialog closes, Roster status announces the created copy, and focus returns to New character.
  - On field errors, the dialog stays open. Each field shows its error, and New character status announces the error summary. The summary is each field's message in field order (Name, Appearance, Loadout), joined by single spaces, and each message is also a link that focuses its field. Focus moves to the first invalid field.
- Escape closes the dialog without creating anything, and focus returns to New character.
- The character picker:
  - typing filters to your own characters on this server by name prefix;
  - Down and Up move the active option;
  - Enter picks it, which shows its details on the roster and makes it the active character on the world view;
  - Escape clears the text.

**Multi-step forms.** Each multi-step form follows one procedure:
- Each step shows its heading.
- Next checks only the current step's fields. Errors show by those fields and in the form's status region, and the form stays on that step.
- Back returns to the previous step with every value entered so far still in place.
- Validation never runs on Back.
- Focus moves to each new step's heading.

The four forms and their steps:
1. Rent a server: "Step 1 of 3: Name", "Step 2 of 3: Plan", "Step 3 of 3: Review". Rent server sends the checkout.
2. Coin checkout: "Step 1 of 3: Pack" (the pack and the character), "Step 2 of 3: Review", "Step 3 of 3: Pay". Pay sends the purchase.
3. Offer a trade: "Step 1 of 3: Partner", "Step 2 of 3: Your offer", "Step 3 of 3: Review". Open trade sends the trade.
4. Table settings: "Step 1 of 2: Stake", "Step 2 of 2: Turn clock". Save settings sends the change with the If-Match it read when the dialog opened.

**Landing routes.** After each action, the address bar shows its route, and reloading or opening that address shows the same screen:

| Action | Route |
|---|---|
| Sign-in | the `next` path, or `/servers` |
| Join server | `/s/<slug>/roster` |
| Rent server | `/s/<slug>/billing` |
| Approve payment and Change plan | stay on `/s/<slug>/billing` |
| Pay | `/s/<slug>/coins/<purchase id>` |
| Take seat or Watch | the table route |
| Close table or Stand up | the world route |

**Taking a seat or watching.**
- While the request is in flight, the button reads "Taking seat" or "Joining" and is disabled.
- On success, the panel opens with the draw-in and the address becomes the table route. Focus moves to the focus target:

| Game | Seated player | Spectator |
|---|---|---|
| chess | the top-left square from your side: a8 for White, h1 for Black | a8 |
| four in a row | Drop in column 1 | the board's cell a6 |
| card game | Your hand (first card active); the Current trick region before the deal or once the hand is empty | the Current trick region |

  Reloading or opening the table route moves focus to the same target.
- If someone else gets the seat, World announcements announces the table-full copy and focus moves to Watch in the Tile inspector.

**Table panel.**
- Escape or Close table closes the panel and keeps your seat. Stand up leaves the seat.
- Either way, the address returns to the world route and focus returns to the table's map tile.
- A refused Stand up keeps the panel open and announces its refusal.

**Chess.**
- Enter or Space on your piece selects it. Enter or Space on a destination sends the move.
- To castle, select the king and choose the square two files over.
- A pawn move that reaches the last rank opens the promotion picker before anything is sent, with focus on Queen.
  - Choosing a piece sends the move.
  - Escape closes the picker without a move and returns focus to the pawn's square.
- With a pointer, click the piece and then the destination. On touch, tap them.

**Four in a row and cards.** Drop in column `<n>`, Enter on a board cell, or a click or tap on a column sends a drop. Enter, a click or a tap on a card plays it.

**Forfeit.** Forfeit opens the forfeit dialog with focus on Keep playing. Forfeit game sends the forfeit. Keep playing or Escape closes the dialog, and focus returns to Forfeit.

**Dialogs and timers.**
- The promotion picker, the forfeit dialog, the trade window and every other open dialog keep focus on the same control across every clock tick, server push, toast and repaint.
- They close only when the player chooses or presses Escape, or when the server ends the turn or the game. In that case focus moves to the panel's focus target.
- Opening the table panel again during its closing motion keeps it open. No stale timer closes it later.
- A repaint never overwrites a status or error message that the user's last action has just shown in the same region.

**Inventory.**
- I or the Inventory button opens the Inventory dialog, with focus on cell a1.
- Space on a filled cell picks up its stack and announces it. Arrow keys then move the cursor, and Space on the target cell sends the move. Escape cancels.
- Dragging a stack with a pointer, or with touch, from one cell to another sends the identical move request.
- Craft `<recipe name>` sends a craft request.

**Trading.**
- Offer a trade opens the three-step form. Open trade creates the trade, and the Trade window opens.
- The partner hears that a trade was offered, and the header strip shows Open trade with `<name>`, which opens the same window for them.
- Update offer sends your side, and Accept accepts what is on screen.
- Both windows show every change from the other side within the push delay, without a reload.

**Friends.** Friends opens the dialog. Send invite sends an invite for the email typed in, with a fresh Idempotency-Key per press, and the same key on an automatic retry.

**Leaderboards.** Each tab follows the tabs pattern (arrow keys move between tabs). The table updates in place within the push delay after a settlement. Start new season asks for confirmation first.

**Full screen.**
- The Full screen button or F calls `requestFullscreen()` from the Fullscreen API on the view's root element. That is the element with id `world-root` for the world view and the panel's dialog element for a table, never the whole document.
- The button's name toggles between "Full screen" and "Exit full screen", and its pressed state follows `document.fullscreenElement`.
- Leaving full screen by Escape, by the button or by F returns focus to the Full screen button.
- A `fullscreenerror` event announces the refusal copy and leaves the layout unchanged.

**Sound.**
- The Sound toggle saves the setting on the server and applies it at once. The pressed state means sound is on.
- Sounds are made only with Web Audio `AudioContext` oscillators. No audio file is shipped or fetched.
- While Sound is off, no oscillator is started at all. Reduced motion does not turn sound off.

| Cue | Oscillators started |
|---|---|
| seat taken | 2 |
| move accepted | 1 |
| move refused | 1 |
| turn clock warning, played once when your own turn reaches 10 seconds left | 1 |
| game won | 3 |
| game lost | 2 |

**Replay viewer.**
- The viewer opens on the final position, with the counter reading `Move <total> of <total>`.
- First move and Home show the position after move 1. Last move and End show the final position. Previous move, Next move and the Left and Right arrow keys step one move.
- Each step updates the board and the counter in the same repaint and announces the step copy.

**Touch.** Every tap target is at least 44 by 44 pixels. Nothing depends on hover or a long press.

### Visual design (DP-12)

**Mood.**
- **Surveyed.** A hairline grid of dark ink runs under every map tile, like survey paper.
- **Tactile.** Game tables are felt-green insets with a firm two-pixel ink rule.
- **Candid.** Status words are never shown by colour alone. They are PAID, PENDING, PAYMENT PENDING, PAST DUE, SUSPENDED, ONLINE, OFFLINE, ACCEPTED, CLEAR, RAIN, STORM, SENT and HELD.

**Colour roles.**
- A warm off-white paper ground.
- A near-black, faintly green ink for text, grid lines and rules.
- A burnt red-orange accent, used only in three places:
  - the tile cursor, on the map and on every board grid;
  - the primary button, which carries white text;
  - the active turn fuse.

  The accent is never used on error borders, error text or decoration. Errors are ink with a warning icon and words.
- A deep billiard-table green felt for table panels, with paper-coloured text.
- A mustard signal yellow for the past-due banner and the selected chess piece's ring, with ink on it.
- The suspension banner is ink with paper text.
- All text and controls meet WCAG 2.2 AA contrast.

**Type.**
- Pixelify Sans, a squared pixel-styled display face, is used for headings, the wordmark and every status word, and status words are always in capitals.
- Atkinson Hyperlegible, a sturdy, highly legible sans, is used for body text, controls and the titles of cards, such as server, roster and purchase cards.
- JetBrains Mono with equal-width numerals is used for clocks, countdowns, coin counts, amounts, coordinates and move numbers, so digits never shift as they change.
- Each heading step is about a quarter larger than the one below.

**Density.** Compact. Rail sections are tight but evenly spaced, and lists show one record per line where they fit.

**Composition.**
- The paper map fills the left, with the rail on the right.
- Tables open as felt panels over the dimmed map.
- Dialogs are paper cards with an ink rule.

**Art.** Draw the tile art yourself as simple flat shapes:

| Thing | Shape |
|---|---|
| grass | paper tint with ink ticks |
| water | wavy lines |
| road | grey band with a dashed centre |
| runway | pale band with threshold bars |
| sand | dots |
| blocks | squares shaded by material |
| vehicles | top-down silhouettes |
| table tiles | felt squares with an ink rule |
| character tokens | paper squares with initials in the display face |

**Icons.** Use the Lucide icon set.

**Controls.** Controls are at least 44 pixels on touch. On pointer screens they are at least 32 pixels, with a 44-pixel hit area.

### Motion and effects (DP-43, DP-48, DP-57, DP-58, DP-66, DP-72, DP-77, DP-99)

**How motion is built.**
- Every animation below uses CSS transitions or the Web Animations API (`element.animate()`), so that the browser's animation list shows it while it runs.
- Durations are bands, and any value inside a band is correct.
- Nothing loops while the world is idle. The only continuous motion is the turn fuse during a running turn. No decorative animation exists apart from those named here.

**Feedback motion.**
- Hovering or pressing a button or tile thickens its ink edge and adds a soft shadow in about a seventh of a second. The focus ring appears in the same time.
- Status words swap at once.

**Animations.**

| Animation | What moves | Duration band | Curve |
|---|---|---|---|
| Chess piece slide | The moved piece slides in a straight line from its origin square to its target square, without changing size. A captured piece fades from fully visible to invisible over the same span. | 180 to 260 ms | decelerating (the standard ease-out) |
| Disc drop | The disc slides straight down from above its column to its cell. It then makes one upward bounce of 6 to 10 pixels and settles. | 120 ms plus 40 ms for each row fallen, plus or minus 30 ms. A disc landing in the top row falls 1 row; the bottom row is 6 rows. | accelerating fall (the standard ease-in), then the bounce |
| Card deal | At game start each card flies from the deck at the table's centre to its seat, in deal order. Each card starts 60 ms, plus or minus 15 ms, after the previous one. Other seats and spectators see card backs. | each flight 150 to 250 ms | ease-out |
| Card flip | A card played to the trick turns over half a turn around its vertical axis. Its face stays hidden until the card is edge-on. | 200 to 300 ms | ease-in-out |
| Vehicle drive | After a park, the vehicle's sprite moves from tile to tile through every stored step in order, never skipping a tile. | 90 to 130 ms per tile | linear |
| Block place | The new block grows from 60 percent of its size to full size. | 120 to 180 ms | ease-out |
| Block break | 6 to 10 shard elements burst outward and fade out, then are removed from the page. | gone within 400 ms | ease-out |
| Coin count | After any change to the active character's balance, the counter counts up or down, showing at least 5 distinct values. It ends exactly on the new balance. | 400 to 700 ms | ease-out |
| Night tint | The night overlay eases to each new night level. | 800 to 1200 ms | ease-in-out |

**Table draw-in (signature).** The job is to sit down at an in-world table and see at once who is seated, who is watching and whose clock is running, without losing your place in the world.
1. Pressing Take seat or Watch moves nothing until the server confirms.
2. The table's 32-pixel map tile then grows along its own outline into the full board panel, passing through intermediate sizes. This takes just under half a second, starting quickly and settling gently. Over the same span the map behind fades to 40 percent visible, and the address changes to the table route.
3. When the panel reaches full size, each seated token slides from its map tile to its board edge in about a third of a second. At the same time, spectator tokens settle into the ring.
4. The fuse ring around the active seat's token then drains from a full circle to nothing, at a steady rate that reaches nothing exactly when the server's remaining time runs out.
   - A partly spent turn starts partly drained.
   - The ring refills when the next turn's push arrives.
5. Closing or standing up reverses these steps: the tokens slide back, the panel shrinks to the exact tile, the map returns to full visibility, and focus lands on the tile.

Opening and closing each take under one second. Opening the route directly or by reload shows the panel already open, with no growth.

**Reduced motion.** When the system asks for reduced motion:
- Every animation above is replaced by an instant change to its end state. The browser's animation list stays empty for these elements, nothing slides, no shards appear, and the coin counter jumps straight to its final value.
- The board panel appears in place over an already dimmed map, and closing removes it at once.
- The fuse ring is not drawn. The turn clock shows only its text, updated once a second.
- Countdowns still tick once a second.
- Focus behaves exactly as it does with motion.

### Feedback states (DP-06, DP-11, DP-15, DP-17, DP-23, DP-29, DP-32, DP-35, DP-39, DP-45, DP-55, DP-62, DP-64, DP-69, DP-71, DP-81, DP-85, DP-87, DP-88, DP-89, DP-90, DP-92, DP-95, DP-96, DP-97, DP-99)

**Rules for all copy.**
- Every string in backticks renders character for character: straight apostrophes, the same case, digits and punctuation.
- Each action produces exactly one announcement in its region. Nothing is prefixed, suffixed or joined to a published string unless a row here publishes the combined string.
- A region's text is replaced by its newest announcement.
- Every live region named in this brief is a polite `status` region, except `log "Chat messages"`, which is also polite.
- Field errors appear next to their field and are tied to it for assistive technology. Each form's status region lists them as links to their fields.
- An error response's `message` is the copy published for that error here. A 412 always uses the stale-version copy.

**Placeholders.**

| Placeholder | Meaning |
|---|---|
| `<x>, <y>` | tile coordinates |
| `<surface>` | `road` or `runway` |
| `<signed amount>` | `+<n>`, `-<n>` or `0` |
| `<seconds>` | the remaining turn time rounded up to whole seconds, never below 0 |
| `<suspends at>` | the Server object's `suspends_at_label`, exactly as given |
| `<balance>` | the Kill Bill account balance in US dollars with two decimals |
| `<plan name>` | Hamlet or Borough |
| `<price>` | a pack price in US dollars with two decimals |
| `<limit>` | the plan's limit |
| `<cell>` | an inventory cell name such as `c2` |

**Billing status region.** The region holds these lines, each in its own block, in this order:
1. The outage message, shown only while the provider is unreachable.
2. The status word: `PENDING`, `PAYMENT PENDING`, `PAID`, `PAST DUE` or `SUSPENDED`.
3. `Plan: <plan name>`
4. `<balance> USD due`
5. The status message. It is left out when the outage message shows.

- On a load or reload, the status message is the Billing state's message.
- After an action on the page, the status message is that action's message. It stays until the next action or a reload.
- A background re-read updates lines 2 to 4 only.
- For each action answer, use the first row of the table below whose condition holds.

**All published copy.**

| Area | State | Region | Copy |
|---|---|---|---|
| sign-in | pending | button | `Signing in` |
| sign-in | wrong credentials | Sign-in status | `Handle or passcode is wrong.` |
| join | pending | button | `Joining server` |
| join | link used | Join status | `This invite link has already been used.` |
| join | link expired | Join status | `This invite link has expired. Ask for a new invite.` |
| join | link superseded | Join status | `This invite link was replaced by a newer invite. Use the latest email.` |
| join | email already has an account | Join status | `An account already uses this email. Ask the owner to add you by handle.` |
| join | member limit | Join status | `This server's plan allows <limit> members.` |
| checkout | pending | button | `Renting server` |
| checkout | billing outage | Checkout status | `The billing provider is unreachable, so no server was created. Try again in a minute.` |
| billing | Billing state pending_approval | Billing status | `Waiting for the billing provider to confirm payment.` |
| billing | Billing state active, no plan change pending | Billing status | `Payment confirmed by the billing provider.` |
| billing | Billing state active, `pending_plan` set (here `<plan name>` is the pending plan) | Billing status | `Plan change to <plan name> is waiting for the billing provider to confirm payment.` |
| billing | Billing state past_due | Billing status | `Invoice overdue. Approve payment before <suspends at> to keep this server running.` |
| billing | Billing state suspended | Billing status | `Suspended until the billing provider confirms payment.` |
| billing | Billing state with `payment_pending` true, and the 202 answer | Billing status | `Payment sent to the billing provider. Waiting for confirmation.` |
| billing | action waiting for its answer | Billing status | `Asking the billing provider to take the payment.` |
| billing | the answer confirms a plan change (`pending_plan` is now `null` and `plan` is the newly chosen plan) | Billing status | `Plan changed to <plan name>.` |
| billing | Change plan answered, change still pending | Billing status | the active-with-`pending_plan` message above |
| billing | Approve payment answered with 200, balance zero or less | Billing status | `Payment confirmed by the billing provider.` |
| billing | Approve payment answered with 200, balance still positive | Billing status | `The billing provider has not confirmed the payment yet. This page checks again every 10 seconds.` |
| billing | `nothing_due` | Billing status | `There is nothing to pay.` |
| billing | `payment_pending` | Billing status | `A payment is already waiting for the billing provider.` |
| billing | `same_plan` | Billing status | `The server is already on that plan.` |
| billing | `plan_change_pending` | Billing status | `A plan change is already waiting for payment.` |
| billing | `server_not_active` | Billing status | `Plans can change only while the server is active.` |
| billing | statement refused during an outage | Billing status | `The billing provider is unreachable, so no statement was made. Try again in a minute.` |
| billing | outage (line 1), shown when `provider_reachable` is false or an action answers 503 | Billing status | `The billing provider is unreachable. Nothing was charged or changed. Showing the last confirmed status.` |
| banner | past due | Server notice | `An invoice is overdue. This server will be suspended at <suspends at> unless the payment is approved.` |
| banner | suspended | Server notice | `This server is suspended because an invoice is unpaid. Play and saves are paused until the billing provider confirms payment. Your worlds can still be exported.` |
| refusal | 423 `server_suspended` | the action's region | `This server is suspended. Play and saves resume once the billing provider confirms payment.` |
| refusal | 423 `server_inactive` | the action's region | `This server is waiting for its first payment to be confirmed.` |
| tables | open table panel at the moment of suspension | Game announcements | `This server is suspended. Play is paused until the invoice is paid.` |
| members | added | Admin status | `<handle> added to the server` |
| members | `unknown_handle` | Admin status | `No player has that handle.` |
| members | `already_member` | Admin status | `<handle> is already a member.` |
| members | `member_limit_reached` | Admin status | `This server's plan allows <limit> members.` |
| any form | 412 stale version | the form's region | `This changed since you opened it. The latest version is now shown.` |
| roster | created | Roster status | `Character created: <name>` |
| roster | appearance saved | Roster status | `Appearance saved` |
| roster | `roster_full` | New character status | `You already have the most characters allowed on this server.` |
| roster | `character_limit` | New character status | `This server's plan allows <limit> characters.` |
| tables | settings saved | Admin status | `Settings saved for <table name>` |
| tables | `table_in_use` | Table settings form | `Settings can change only while no one is seated.` |
| admin | time zone saved | Admin status | `Time zone saved` |
| admin | world renamed | Admin status | `World renamed to <name>` |
| saves | saving | World announcements and Admin status | `Saving world` |
| saves | saved | World announcements and Admin status | `World saved` |
| saves | save not written | World announcements and Admin status | `Save not written. Storage is unreachable, so nothing was saved and your world is unchanged. Try again in a minute.` |
| saves | restored | Admin status | `World restored from save <number>` |
| saves | restore failed | Admin status | `Restore failed. Storage is unreachable, so the world is unchanged.` |
| saves | export ready | Admin status | `Export ready` |
| saves | export not written | Admin status | `Export not written. Storage is unreachable. Try again in a minute.` |
| world | walked | World announcements | `Moved to <x>, <y>` |
| world | `blocked` | World announcements | `You can't walk there.` |
| world | placed | World announcements | `Placed <material> block at <x>, <y>` |
| world | broken | World announcements | `Broke <material> block at <x>, <y>` |
| world | `too_far` | World announcements | `Too far away. Stand next to that tile first.` |
| world | `not_buildable` | World announcements | `You can only build on grass or sand.` |
| world | `tile_taken` | World announcements | `That tile is taken.` |
| world | `no_block` | World announcements | `There is no block there.` |
| world | `no_block_in_inventory` | World announcements | `You have no <material> block in your inventory.` |
| world | `inventory_full` | World announcements and Inventory announcements | `Inventory full. Make room first.` |
| vehicles | parking mode, car | World announcements | `Parking <vehicle name>. Choose a road tile.` |
| vehicles | parking mode, plane | World announcements | `Parking <vehicle name>. Choose a runway tile.` |
| vehicles | cursor on a wrong-surface tile, car | World announcements | `Not a road` |
| vehicles | cursor on a wrong-surface tile, plane | World announcements | `Not a runway` |
| vehicles | cancelled | World announcements | `Parking cancelled` |
| vehicles | parked | World announcements | `<vehicle name> parked on <surface> at <x>, <y>` |
| vehicles | `wrong_surface`, car | World announcements | `Cars park only on road tiles.` |
| vehicles | `wrong_surface`, plane | World announcements | `Planes park only on runway tiles.` |
| vehicles | `no_route` | World announcements | `No road leads there.` |
| vehicles | `weather_grounded` | World announcements | `Planes are grounded during the storm.` |
| party | new leader | World announcements | `<character name> now leads the party.` |
| chapters | checkpoint stored (replaces the walk copy) | World announcements | `Checkpoint reached: <checkpoint name>` |
| chapters | checkpoint waiting for storage | World announcements | `Checkpoint reached: <checkpoint name>. Not saved yet; it will be saved when storage is back.` |
| chapters | last checkpoint stored (replaces the checkpoint copy) | World announcements | `Chapter complete: <chapter title>` |
| tables | seated | World announcements | `You sit at <table name>, seat <seat label>.` |
| tables | watching | World announcements | `You are watching <table name>.` |
| tables | `table_full` | World announcements | `This table is full. You can watch from the spectator ring.` |
| tables | stood up | World announcements | `You stood up from <table name>.` |
| tables | Stand up refused, `game_in_play` | Game announcements | `You can't stand up during a game. Forfeit first.` |
| tables | Stand up refused, `not_settled` | Game announcements | `You can stand up once the coins have settled.` |
| full screen | `fullscreenerror` | World announcements or Game announcements | `Full screen is not available here.` |
| chess | quiet move | Game announcements | `<Piece> to <square>` |
| chess | capture | Game announcements | `<Piece> takes <square>` |
| chess | en passant | Game announcements | `Pawn takes <square> en passant` |
| chess | castling | Game announcements | `Castles kingside` or `Castles queenside` |
| chess | suffixes, in this order | Game announcements | `, promotes to <Piece>`, then `, check` or `, checkmate` |
| chess | rejections (mover only) | Game announcements | `Illegal: your king would be in check` · `Illegal: that piece cannot move there` · `Illegal: there is no piece of yours on <square>` · `Illegal: you cannot castle now` · `Illegal: choose a promotion piece` · `Illegal: it is not your turn` |
| four in a row | drop | Game announcements | `<seat label> drops in column <n>` |
| four in a row | rejections (mover only) | Game announcements | `Illegal: that column is full` · `Illegal: it is not your turn` |
| cards | card played | Game announcements | `<character name> plays <card name>` |
| cards | trick won (replaces the play copy) | Game announcements | `<character name> wins the trick` |
| cards | rejections (mover only) | Game announcements | `Illegal: you must follow suit` · `Illegal: that card is not in your hand` · `Illegal: it is not your turn` |
| tables | `stale_turn` (mover only) | Game announcements | `That move came too late; the board has changed.` |
| tables | `turn_expired` (mover only) | Game announcements | `Time ran out before your move arrived.` |
| tables | game end, every viewer (replaces the final move's copy) | Game announcements | `<reason sentence> <result sentence>` |
| tables | settled, seated players (replaces the end copy) | Game announcements | `Coins settled: <signed amount> for you` |
| tables | result waiting for storage | Game announcements | `Result not stored yet. Coins will settle once storage is back.` |
| tables | rematch offered | Game announcements | `<character name> offers a rematch` |
| tables | rematch started | Game announcements | `Rematch started` |
| tables | turn clock, your turn | Turn clock | `Your turn: <seconds> s` |
| tables | turn clock, someone else's turn | Turn clock | `<character name>'s turn: <seconds> s` |
| replay | step | Replay announcements | `Move <n> of <total>: <move copy>` |
| history | several results | Search results | `<n> games found` |
| history | one result | Search results | `1 game found` |
| history | no results | Search results | `No games found` |
| invites | sent | Invite status | `Invite sent to <email>` |
| invites | held | Invite status | `Invite held: mail is down` |
| invites | `already_member` | Invite status | `<email> already belongs to a member.` |
| coins | pending | Purchase status | the 202 billing copy above |
| coins | paid | Purchase status | `<coins> coins added to <character name>.` |
| coins | refunded | Purchase status | `Refunded. <coins> coins were removed from <character name>.` |
| coins | receipt held (an extra line, shown while the receipt is held) | Purchase status | `Receipt held: mail is down` |
| coins | `coins_spent` | Purchase status | `Some of these coins are spent, so this purchase can't be refunded.` |
| coins | `already_refunded` | Purchase status | `This purchase is already refunded.` |
| coins | `daily_limit_reached` | Purchase status | `You've made 5 purchases today. Try again after midnight server time.` |
| coins | billing outage | Purchase status | `The billing provider is unreachable, so nothing was charged. Try again in a minute.` |
| trading | offered, to the partner | World announcements | `<name> offers a trade.` |
| trading | opened | Trade status | `Trade opened with <name>` |
| trading | offer updated (your side) | Trade status | `Offer updated` |
| trading | either side changed, or 409 `trade_changed` | Trade status | `Trade changed. Both players must accept again.` |
| trading | you accepted | Trade status | `You accepted. Waiting for <name>.` |
| trading | partner accepted | Trade status | `<name> accepted.` |
| trading | an accept expired | Trade status | `Accept expired. Press Accept again.` |
| trading | completed | Trade status | `Trade complete` |
| trading | cancelled | Trade status | `Trade cancelled` |
| trading | completion failed on a full inventory | Trade status | `Trade could not complete: an inventory is full. Both players must accept again.` |
| trading | `too_far` | Offer a trade form | `Stand next to <name> to trade.` |
| trading | `trade_open` | Offer a trade form | `<name> is already trading.` |
| inventory | picked up | Inventory announcements | `Picked up <item name> from <cell>` |
| inventory | moved, merged or swapped | Inventory announcements | `Moved <item name> to <cell>` |
| inventory | carry cancelled | Inventory announcements | `Move cancelled` |
| inventory | crafted | Inventory announcements | `Crafted <output item name>` |
| inventory | `missing_ingredients` | Inventory announcements | `Missing ingredients for <recipe name>.` |
| achievements | unlocked | Achievements | `Achievement unlocked: <achievement name>` |
| leaderboards | season started | Leaderboard status | `Season <n> started` |
| leaderboards | empty board | in the table | `No wins yet this season.` |
| weather | changed to clear | World announcements | `Weather: clear` |
| weather | changed to rain | World announcements | `Weather: rain` |
| weather | changed to storm | World announcements | `Weather: storm. Planes are grounded.` |
| not found | heading | page | `We couldn't find that page.` |

**Game end.**
- Reason sentences:
  - `Checkmate.`
  - `Stalemate.`
  - `Threefold repetition.`
  - `Fifty-move rule.`
  - `Four in a row.`
  - `Board full.`
  - `Hand over.`
  - `<character name> ran out of time.`
  - `<character name> forfeited.`
  - `Abandoned: the server was suspended.`
- Result sentences:
  - `Draw.`
  - `<name> wins.`
  - `<name> and <name> win.`
  - `<name>, <name> and <name> win.`
  - `Stakes returned.` for an abandoned game.
- Winners are listed in seat order.
- Example: `Checkmate. Inkfinch wins.`

**Replay viewer Result region.** The region holds the stored end copy, then one line per seat in seat order, reading `<character name>: <signed amount>`.

**Field errors.**
- Lengths count Unicode characters after trimming spaces at both ends.
- A field at exactly its maximum is accepted.
- The API returns the same messages in `fields`.

| Field | Rule | Copy |
|---|---|---|
| Handle (sign-in, join, member handle) | required | `Enter a handle.` |
| | longer than 24 | `Use at most 24 characters.` |
| | not 3 to 24 lower-case letters, digits or hyphens | `Use 3 to 24 lower-case letters, digits or hyphens.` |
| | taken (join) | `That handle is taken.` |
| Passcode | required | `Enter your passcode.` |
| | longer than 64 | `Use at most 64 characters.` |
| | shorter than 8 (join) | `Use at least 8 characters.` |
| Display name | required | `Enter a display name.` |
| | longer than 40 | `Use at most 40 characters.` |
| Friend's email | required | `Enter an email address.` |
| | longer than 254, or a part before the @ longer than 64 | `Use at most 254 characters, with at most 64 before the @.` |
| | not one @ with text on both sides and a dot in the part after it | `Enter an email address like name@example.com.` |
| Server name | required | `Enter a server name.` |
| | longer than 40 | `Use at most 40 characters.` |
| | not 3 to 40 letters, digits, spaces or hyphens | `Use 3 to 40 letters, digits, spaces or hyphens.` |
| | taken | `That server name is taken.` |
| Plan | none chosen | `Choose a plan.` |
| Name (character) | required | `Enter a name.` |
| | longer than 20 | `Use at most 20 characters.` |
| | not 2 to 20 letters, digits, spaces or hyphens | `Use 2 to 20 letters, digits, spaces or hyphens.` |
| | taken on this server | `That character name is taken on this server.` |
| Appearance | none chosen | `Choose an appearance.` |
| Loadout | more than 3 | `Choose at most 3 items.` |
| World name | required | `Enter a world name.` |
| | longer than 40 | `Use at most 40 characters.` |
| Party name | required | `Enter a party name.` |
| | longer than 30 | `Use at most 30 characters.` |
| Message (chat) | required | `Write a message.` |
| | longer than 280 | `Use at most 280 characters.` |
| Stake | missing, not whole, or outside 0 to 100 | `Use a whole number of coins from 0 to 100.` |
| Turn clock seconds | missing, not whole, or outside 5 to 120 | `Use 5 to 120 seconds.` |
| Time zone | not in the list | `Choose a time zone from the list.` |
| Coin pack | none chosen | `Choose a coin pack.` |
| Character (coins) | none chosen | `Choose a character.` |
| Partner | none chosen | `Choose a player to trade with.` |
| Coins to offer | not whole, or outside 0 to your available coins | `Use a whole number from 0 to <available>.` |
| `<item name>` to offer | not whole, or outside 0 to your available count | `Use a whole number from 0 to <count>.` |
| any body field not published for that endpoint | unknown | `Unknown field.` |

## Backend

### API (DP-04, DP-05, DP-06, DP-07, DP-08, DP-09, DP-10, DP-14, DP-17, DP-19, DP-20, DP-21, DP-22, DP-23, DP-24, DP-26, DP-28, DP-32, DP-33, DP-34, DP-35, DP-37, DP-38, DP-40, DP-44, DP-47, DP-49, DP-50, DP-51, DP-53, DP-54, DP-60, DP-65, DP-67, DP-74, DP-76, DP-78, DP-79, DP-80, DP-82, DP-83, DP-84, DP-86, DP-88, DP-89, DP-90, DP-91, DP-92, DP-94, DP-95, DP-96, DP-97, DP-98)

**Conventions.**
- All endpoints are JSON over HTTP under `/api`. Every request with a body sends `Content-Type: application/json`.
- Times are UTC instants in ISO 8601 with milliseconds and the `Z` offset, for example `2026-11-01T18:07:42.123Z`.
- Ids are opaque strings.
- Coin amounts are integers. Money amounts are strings with two decimals.
- Sign-in and join set an `HttpOnly`, `SameSite=Lax` session cookie.
- Every endpoint needs a session, except these four:
  - `GET /api/health`
  - `POST /api/session`
  - `GET /api/invites/<token>`
  - `POST /api/invites/<token>/accept`
- A `character_id` in a body must name one of the session user's characters on that server.
- Server routes take the server slug.

**Body fields.** Every endpoint accepts only the body fields its row lists.
- Any other field answers `422 {"error":"unknown_field","message":"Unknown field: <name>","fields":{"<name>":"Unknown field."}}`, naming the first unknown field in body order.
- This includes names of built-in object members such as `constructor`, `toString`, `__proto__` and `hasOwnProperty`. A body field is only ever matched against the endpoint's own published list.

**Error shape.** Every error is `{"error":"<code>","message":"<text>"}`.
- Validation adds `"fields":{"<field>":"<message>"}`.
- 412 adds `"etag":"<current ETag>"`.

**Error precedence.** One order covers the whole API. An endpoint row lists only its own extra codes, in the order they apply within their step.
1. The Server boundary checks: 413 `payload_too_large`, 415 `unsupported_media_type` and 403 `cross_origin`.
2. 401 `unauthenticated`.
3. 404 `not_found`. This applies when the path's record does not exist, when it belongs to a server the caller is not a member of, or when a body id (`character_id`, `partner_id`, `save_id`) does not exist on that server. Non-members always get this 404, never a 403.
4. An idempotent replay returns its stored response.
5. 403 for role checks: `forbidden` (owner only), `not_your_character` (a character on this server that belongs to another user), `not_seated`, `not_leader`, `not_your_turn` and `not_trade_party`.
6. 428 `precondition_required`, then 412 `precondition_failed`.
7. A handle named in the body (adding a member): first 422 `validation` with field `handle` when it breaks a Handle field rule (required, too long, wrong format), then 404 `unknown_handle` when no account has that handle.
8. 423 `server_suspended` or `server_inactive`.
9. 409 state conflicts.
10. 422: `unknown_field` first, then `validation` for every other field, then rule codes.
11. 429 `daily_limit_reached`.
12. 503 `billing_unavailable`, `storage_unavailable` or `database_unavailable`.

For example, a non-owner who adds an unknown handle gets 403 `forbidden`, and the owner adding an empty handle gets 422 `validation` with the Handle field's required copy.

**Retry-After.**

| Status | Retry-After, in whole seconds |
|---|---|
| 503 `billing_unavailable` | 30 |
| 503 `storage_unavailable` | 10 |
| 503 `database_unavailable` | 2 |
| 423 | 10, the interval at which the server re-reads Kill Bill |
| 429 | the seconds until the next midnight in the server's time zone, rounded up |

**Conditional writes.**
- `GET` of a server, world, table, character or billing record answers with a strong `ETag` header, a quoted value that changes whenever that record changes.
- Every `PUT` or `PATCH` needs `If-Match`:
  - With no `If-Match`, the answer is `428 {"error":"precondition_required"}`.
  - With a value that is not the current ETag, the answer is `412 {"error":"precondition_failed","etag":"<current>"}`.
  - A successful write answers with the new `ETag`.
- The check and the write happen in one database transaction.

**Idempotency.**
- Checkout, invites and coin purchases require an `Idempotency-Key` header of 1 to 64 letters, digits, `-` or `_`. A missing or malformed key answers 422 `validation` with field `idempotency_key`.
- Keys are scoped to the user and the endpoint.
- The same key with the same body returns the stored response: the same status, the same body and the same record.
- The same key with a different body answers 409 `idempotency_key_reused`.
- Responses with status 500 or more are never stored, so a retry after them runs again.

**Event streams.** Event streams follow the Server-Sent Events standard (`text/event-stream`):
- **Connect.** Each stream first sends `retry: 2000`.
- **Ids.** Every event has an `id:` taken from one strictly increasing integer sequence per server. A stream skips ids of events that are not meant for its subscriber.
- **Fresh connect.** A connection without `Last-Event-ID` gets a snapshot event first. Its id is the latest id at that moment.
- **Resume.** A connection with `Last-Event-ID: <n>` gets every event after `n` that is meant for it, in id order, with no duplicates and no gaps, and then live events. When `n` is older than the 30 minutes of history kept, it gets a snapshot first, as on a fresh connect.
- **Heartbeat.** The comment line `: ping` is sent every 15 seconds.
- **Data.** Each event's data is one JSON line.
- **Errors.** A stream that has to end sends `event: error` with the standard error shape.
- **Streams and events.**

| Stream | Events |
|---|---|
| `GET /api/servers/<slug>/events` | `snapshot` `{"server","friends","weather"}`; `server` (Server); `presence` `{"handle","online"}`; `friends` `{"friends":[Friend]}`; `party` (Party); `leaderboard` `{"game","season","entries"}`; `weather` (Weather); `invite` (Invite, to its inviter only); `trade` (Trade, to its two parties only); `achievement` `{"character_id","name","unlocked_at"}` (to the character's user only) |
| `GET /api/servers/<slug>/worlds/<world>/events` | `world` (World, the snapshot and after every change); `chat` (Message) |
| `GET /api/tables/<id>/events` | `table` (Table as filtered for the subscriber, the snapshot and after every change); `announcement` `{"text"}` (copy meant for every viewer) |

**Shared objects.**
- **Server.** `{"id","slug","name","owner","role","status":"pending_approval|active|past_due|suspended","status_word":"PENDING|PAID|PAST DUE|SUSPENDED","suspends_at":null|"<time>","suspends_at_label":null|"YYYY-MM-DD HH:MM <time zone>","time_zone":"<IANA zone>","plan":"hamlet|borough","season":<n>,"worlds":[{"slug","name"}],"member_count","character_count"}`
- **Billing.** `{"server_id","status","status_word":"PENDING|PAYMENT PENDING|PAID|PAST DUE|SUSPENDED","plan","pending_plan":null|"hamlet|borough","payment_pending":true|false,"balance","currency":"USD","past_due_since","suspends_at","suspends_at_label","killbill_account_id","provider_reachable":true|false,"checked_at"}`
  - `status_word` is `PAYMENT PENDING` whenever `payment_pending` is true.
- **Character.** `{"id","name","owner","world","x","y","appearance":"surveyor|mason|pilot|gardener","loadout":["<item kind>"],"balance","available"}`
  - `available` is `balance` minus the coins this character offers in open trades.
- **Inventory.** `{"character_id","slots":[{"slot":1..24,"kind":null|"<item kind>","count","held"}]}`
  - Slots run row by row: a1 is slot 1 and f4 is slot 24.
  - `held` is the part of the slot's count offered in open trades.
- **World.**
  `{"slug","name","width":40,"height":24,"tiles":[24 strings of 40 chars],"tables":[{"id","name","game","x","y","state"}],"blocks":[{"x","y","material"}],"vehicles":[{"id","name","kind":"car|plane","owner_character_id","x","y"}],"characters":[{"id","name","x","y"}]}`
  - Tile codes are `.` grass, `~` water, `=` road, `#` runway, `s` sand and `T` table.
- **Message.** `{"id","character":{"id","name"},"text","created_at"}`
  - `text` is the message as stored, after trimming.
- **Table.**
  `{"id","name","game":"chess|four|tricks","world","x","y","state":"open|seated|in_play|finished|settled","stake","turn_seconds","seats":[{"seat","label","character":null|{"id","name"}}],"spectators":[…],"game_id","turn","to_move_seat","turn_remaining_ms","position","hand":null|["<card>"],"hand_counts","result":null|Result,"settled","pending_store","rematch_offers":[…]}`
  - `position` for chess is `{"fen"}`.
  - `position` for four in a row is `{"rows":[6 strings of 7, top first]}`, with `.` for empty, `I` for an Ink disc and `G` for a Gold disc.
  - `position` for the card game is `{"trick":[{"seat","card"}],"led_suit","tricks_won"}`.
  - `hand` is set only for the seated user's own seat.
  - `turn_remaining_ms` is measured on the server when the response is built.
- **Result.** `{"outcome":"win|draw|forfeit|abandoned","reason":"checkmate|stalemate|threefold_repetition|fifty_move_rule|four_in_a_row|board_full|hand_over|timeout|forfeit|server_suspended","winners":[<seat>],"text","settlement":[{"character_id","amount"}]}`
  - `settlement` holds each seat's net coin change, in seat order.
- **Party.** `{"id","name","state":"open|closed","leader_id","members":[{"character_id","name","joined_at"}],"run_id"}`
- **Run.** `{"id","party_id","chapter_id","world","state":"in_progress|paused|completed","checkpoints":[{"n","name","x","y","reached","stored"}],"started_at"}`
- **Trade.** `{"id","state":"open|completed|cancelled","version":<n>,"sides":[{"character_id","name","coins","items":[{"kind","count"}],"accepted":true|false,"accepted_at"}],"updated_at"}`
- **Invite.** `{"id","email","state":"pending|used|expired|superseded","mail":"sent|held","expires_at"}`
- **Purchase.** `{"id","character_id","pack","coins","price","state":"pending|paid|refunded","receipt":"sent|held","created_at"}`
- **Weather.** `{"weather":"clear|rain|storm","since","changes_at","night_level"}`
- **Friend.** `{"handle","display_name","online"}`
- **Card codes.** A rank from `2 3 4 5 6 7 8 9 T J Q K A` followed by a suit from `C D H S`.
- **Move strings.**
  - Chess uses from and to squares, for example `e2e4`, with a promotion letter where needed, for example `e7e8q`. Castling is the king's two-square move.
  - Four in a row uses `"1"` to `"7"`.
  - The card game uses a card code.

**Session, invites and servers.**

| Endpoint | Body | Success | Extra errors |
|---|---|---|---|
| `GET /api/health` | | see Deployment | |
| `POST /api/session` | `{"handle","passcode"}` | `200 {"user":{"handle","display_name"}}` | 401 `bad_credentials` |
| `DELETE /api/session` | | `204` | |
| `GET /api/me` | | `200 {"user","servers":[Server],"preferences":{"sound"}}` | |
| `POST /api/me/preferences` | `{"sound":true\|false}` | `200 {"preferences":{"sound"}}` | 422 `validation` |
| `GET /api/invites/<token>` | | `200 {"server_name","inviter","email"}` | 404; 410 `invite_used`, `invite_expired`, `invite_superseded` |
| `POST /api/invites/<token>/accept` | `{"handle","display_name","passcode"}` | `201 {"user","server":Server}`, and signs the new user in | 404; 410 as above; 409 `email_in_use`, `member_limit_reached`; 422 `validation` |
| `POST /api/checkout` | `{"server_name","plan"}` | `201 {"server","billing","billing_url":"/s/<slug>/billing"}` | 422 `validation`; 503 |
| `GET /api/servers/<slug>` | | `200 Server` | |
| `PATCH /api/servers/<slug>` | `{"time_zone"}`, owner | `200 Server` | 422 `validation` |
| `POST /api/servers/<slug>/members` | `{"handle"}`, owner | `201 {"member"}` | 422 `validation` and 404 `unknown_handle` (step 7); 409 `already_member`, `member_limit_reached` |
| `POST /api/servers/<slug>/invites` | `{"email"}`, any member | `201 {"invite":Invite}` | 409 `already_member`; 422 `validation` |
| `GET /api/servers/<slug>/invites` | | `200 {"invites":[Invite]}`, the caller's own | |
| `GET /api/servers/<slug>/friends` | | `200 {"friends":[Friend]}` | |
| `GET /api/servers/<slug>/mail` | owner | `200 {"mail":[{"id","kind","to_handle","subject","state":"held\|sent","created_at","sent_at"}]}` | |
| `GET /api/servers/<slug>/billing` | owner | `200 Billing`, reading Kill Bill live; when Kill Bill is unreachable, still 200 with the last confirmed state and `"provider_reachable":false` | |
| `POST /api/servers/<slug>/billing/payments` | `{}`, owner | `200 Billing` once confirmed or still positive; `202 Billing` when the payment is pending | 409 `payment_pending`, `nothing_due`; 503 |
| `POST /api/servers/<slug>/plan` | `{"plan"}`, owner | `200 Billing` | 409 `server_not_active`, `same_plan`, `plan_change_pending`; 422; 503 |
| `GET /api/servers/<slug>/billing/statement.csv` | owner | `200 text/csv; charset=utf-8`, with `Content-Disposition: attachment; filename="<slug>-statement.csv"` | 503 `billing_unavailable` |
| `GET /api/servers/<slug>/ledger` | owner | `200 {"entries":[{"id","kind":"grant\|stake\|settlement\|top_up\|refund\|trade","game_id","trade_id","purchase_id","lines":[{"account","amount"}],"created_at"}]}` | |

**Characters, inventory and crafting.**

| Endpoint | Body | Success | Extra errors |
|---|---|---|---|
| `GET /api/servers/<slug>/characters?q=<prefix>&mine=true\|false` | | `200 {"characters":[Character],"total"}`, up to 10 sorted by name, with `total` counting all matches | |
| `POST /api/servers/<slug>/characters` | `{"name","appearance","loadout":[…]}` | `201 {"character"}` | 409 `roster_full`, `character_limit`; 422 `validation` |
| `GET /api/characters/<id>` | | `200 Character` | |
| `PATCH /api/characters/<id>` | `{"appearance"}`, own character | `200 Character` | 403 `not_your_character`; 422 |
| `GET /api/characters/<id>/wallet` | own character or owner | `200 {"character_id","balance","available","lines":[…]}` | 403 `not_your_character` |
| `GET /api/characters/<id>/inventory` | own character | `200 Inventory` | 403 |
| `POST /api/characters/<id>/inventory/moves` | `{"from","to"}` | `200 Inventory` | 403; 409 `slot_held`; 422 `validation`, `empty_slot` |
| `POST /api/characters/<id>/crafts` | `{"recipe"}` | `201 {"inventory","crafted":{"kind","count"}}` | 403; 423; 409 `inventory_full`; 422 `missing_ingredients`, `validation` |
| `GET /api/characters/<id>/achievements` | | `200 {"achievements":[{"id","name","unlocked_at"}]}` | |

**World.**

| Endpoint | Body | Success | Extra errors |
|---|---|---|---|
| `GET /api/servers/<slug>/worlds/<world>` | | `200 World` | |
| `PATCH /api/servers/<slug>/worlds/<world>` | `{"name"}`, owner | `200 World` | 422 |
| `POST /api/characters/<id>/walk` | `{"direction":"north\|east\|south\|west"}` | `200 {"character","announcement","checkpoint":null\|{"run_id","n","name","stored"}}` | 422 `blocked` |
| `POST /api/servers/<slug>/worlds/<world>/blocks` | `{"character_id","x","y","material"}` | `201 {"block","announcement"}` | 409 `tile_taken`; 422 `too_far`, `not_buildable`, `no_block_in_inventory`, `validation` |
| `POST /api/servers/<slug>/worlds/<world>/blocks/break` | `{"character_id","x","y"}` | `200 {"block","announcement"}` | 409 `inventory_full`; 422 `too_far`, `no_block` |
| `POST /api/vehicles/<id>/park` | `{"x","y"}` | `201 {"trip":{"id","vehicle_id","from","to","steps":["N\|E\|S\|W"]},"vehicle","announcement"}` | 403 `not_your_character`; 409 `tile_taken`, `weather_grounded`; 422 `wrong_surface`, `no_route`, `same_tile` |
| `GET /api/trips/<id>/replay` | | `200 {"trip_id","stored","replayed","match"}` | |
| `GET /api/servers/<slug>/worlds/<world>/chat` | | `200 {"messages":[Message]}`, the latest 50 messages of that world only, oldest first | |
| `POST /api/servers/<slug>/worlds/<world>/chat` | `{"character_id","text"}` | `201 {"message":Message}` | 422 `validation` |
| `GET /api/servers/<slug>/worlds/<world>/saves` | | `200 {"saves":[{"id","number","created_at","restored_from","objects"}]}`, newest first | |
| `POST /api/servers/<slug>/worlds/<world>/saves` | `{}` | `201 {"save"}` | 503 |
| `POST /api/servers/<slug>/worlds/<world>/restore` | `{"save_id"}`, owner | `200 {"world","save"}` | 503 |
| `POST /api/servers/<slug>/exports` | `{}`, owner, allowed in every status | `201 {"export":{"id","key","download_url"}}` | 503 |
| `GET /api/servers/<slug>/exports/<id>` | owner | `200 application/x-tar`, with `Content-Disposition: attachment; filename="<slug>-worlds.tar"` | |
| `GET /api/servers/<slug>/weather` | | `200 Weather` | |

**Parties and chapters.**

| Endpoint | Body | Success | Extra errors |
|---|---|---|---|
| `GET /api/servers/<slug>/parties` | | `200 {"parties":[Party]}`, open parties only | |
| `POST /api/servers/<slug>/parties` | `{"character_id","name"}` | `201 {"party"}` | 409 `already_in_party`; 422 |
| `POST /api/parties/<id>/members` | `{"character_id"}` | `200 {"party"}` | 409 `party_closed`, `already_in_party` |
| `DELETE /api/parties/<id>/members/<character id>` | | `200 {"party"}` | 404 when the character is not a member |
| `POST /api/parties/<id>/chapter-runs` | `{"chapter_id"}` | `201 {"run"}` | 403 `not_leader`; 409 `run_in_progress`; 422 |
| `GET /api/chapter-runs/<id>` and `/replay` | | `200 {"run"}`; `200 {"run_id","stored":{"positions","checkpoints_reached"},"replayed":{…},"match"}` | |

**Tables and games.**

| Endpoint | Body | Success | Extra errors |
|---|---|---|---|
| `GET /api/tables/<id>` | | `200 Table` | |
| `PATCH /api/tables/<id>` | `{"stake","turn_seconds"}`, owner | `200 Table` | 409 `table_in_use`; 422 |
| `POST /api/tables/<id>/seats` | `{"character_id"}` | `201 {"seat","table"}` | 409 `table_full`, `already_seated`; 422 `too_far`, `insufficient_coins` |
| `DELETE /api/tables/<id>/seats/<character id>` | | `200 Table` | 404; 409 `game_in_play`, `not_settled` |
| `POST`, `DELETE /api/tables/<id>/spectators[/<character id>]` | `{"character_id"}` | `201`, or `200`, with `Table` | 409 `already_seated`; 422 `too_far` |
| `POST /api/tables/<id>/start` | `{"character_id"}` | `200 Table` | 403 `not_seated`; 409 `table_not_full`, `game_in_play`, `not_settled`, `rematch_required`; 422 `insufficient_coins` |
| `GET /api/tables/<id>/legal-moves?character_id=<id>` | | `200 {"moves":["<move>"]}` | 403 `not_your_turn` for everyone except the seated player on turn |
| `POST /api/tables/<id>/moves` | `{"character_id","turn","move"}` | `200 {"announcement","table"}` | 403 `not_seated`; 409 `game_not_in_play`, `stale_turn`, `turn_expired`; 422 `illegal_move`, `validation` |
| `POST /api/tables/<id>/forfeit` | `{"character_id"}` | `200 Table` | 403; 409 `game_not_in_play` |
| `POST /api/tables/<id>/rematch` | `{"character_id"}` | `200 Table` | 403; 409 `not_settled`; 422 `insufficient_coins` |
| `GET /api/games/<id>` | | `200 {"id","table_id","table_name","game","seats","moves","position","result","settled","started_at","finished_at","seed","hands"}`, for any member, during play and after | |
| `GET /api/games/<id>/replay` | | `200 {"game_id","stored":{"position","result"},"replayed":{…},"match"}` | |
| `GET /api/servers/<slug>/games?q=<text>&page=<n>` | | `200 {"games":[{"id","table_name","game","players","result_text","finished_at"}],"total","page","page_size":20}` | |

- `turn` is the number of moves already accepted in the current game.
- History lists settled games only, newest first. `q` is a case-insensitive substring of the table name or of any player's name.
- For a card game, `seed` and `hands` follow the Hidden cards rule in Business rules.
- On an unfinished game, `GET /api/games/<id>/replay` replays only up to the last move played.

**Coins and trades.**

| Endpoint | Body | Success | Extra errors |
|---|---|---|---|
| `POST /api/servers/<slug>/coin-purchases` | `{"character_id","pack":"pouch\|satchel\|chest"}` | `201 Purchase` (paid) or `202 Purchase` (pending) | 403; 422; 429; 503 |
| `GET /api/coin-purchases/<id>` | buyer or owner | `200 Purchase` | 403 `forbidden` |
| `GET /api/servers/<slug>/coin-purchases` | | `200 {"purchases":[Purchase]}`: the caller's own, or every purchase for the owner | |
| `POST /api/coin-purchases/<id>/refund` | `{}`, owner | `200 Purchase` | 409 `not_paid`, `already_refunded`, `coins_spent`; 503 |
| `POST /api/servers/<slug>/trades` | `{"character_id","partner_id","coins","items"}` | `201 Trade` | 409 `trade_open`; 422 `too_far`, `validation` |
| `GET /api/trades/<id>` | either party | `200 Trade` | 403 `not_trade_party` |
| `POST /api/trades/<id>/offer` | `{"character_id","version","coins","items"}` | `200 Trade` | 403; 409 `trade_closed`, `trade_changed`; 422 |
| `POST /api/trades/<id>/accept` | `{"character_id","version"}` | `200 Trade` | 403; 409 `trade_closed`, `trade_changed`, `inventory_full` |
| `POST /api/trades/<id>/cancel` | `{"character_id"}` | `200 Trade` | 403; 409 `trade_closed` |
| `GET /api/servers/<slug>/leaderboards/<game>` | | `200 {"game","season","entries":[{"rank","character_id","name","wins","reached_at"}]}` | |
| `POST /api/servers/<slug>/seasons` | `{}`, owner | `201 {"season"}` | |

### Business rules (DP-05, DP-08, DP-09, DP-13, DP-14, DP-17, DP-19, DP-20, DP-21, DP-22, DP-24, DP-26, DP-27, DP-28, DP-30, DP-32, DP-33, DP-34, DP-37, DP-38, DP-44, DP-47, DP-49, DP-50, DP-51, DP-53, DP-54, DP-60, DP-61, DP-65, DP-67, DP-68, DP-69, DP-70, DP-71, DP-74, DP-75, DP-76, DP-78, DP-79, DP-82, DP-83, DP-84, DP-86, DP-88, DP-89, DP-90, DP-91, DP-92, DP-93, DP-94, DP-95, DP-96, DP-97, DP-98)

**Time.**
- Every stored time is a UTC instant.
- Each server has a time zone setting, an IANA zone, which defaults to `UTC` for rented servers. Screens and labels show times in it as `YYYY-MM-DD HH:MM`.
- The device clock may be wrong by hours. Every time-dependent status is decided on the server, and the browser renders it.
- A countdown in the browser starts from the server's `remaining_ms` and subtracts the time elapsed since that value arrived, measured with `performance.now()`. It never compares against `Date.now()`, so a browser clock skewed by 10 minutes either way shows the same countdown.

**Plans and limits.**

| Plan | Price | Characters per server | Members per server, including the owner |
|---|---|---|---|
| Hamlet | 6.00 USD a month | 12 | 6 |
| Borough | 12.00 USD a month | 40 | 20 |

- Limits come from the confirmed plan only.
- A user holds at most 3 characters per server. More answers `roster_full`.
- A create that would pass the plan's character limit answers `character_limit`.
- Names are unique per server, ignoring case.
- A loadout is 0 to 3 distinct loadout items.
- A new character starts on the spawn tile with a 500-coin grant. Its inventory starts with the starter stacks, followed by its loadout items, one each, in listbox order.
- Adding a member: the handle must pass the Handle field rules and name an existing account. Then `already_member` is checked before `member_limit_reached`.

**Billing state.**
- Kill Bill is the only source of billing state. Plotwright never marks a server paid on its own.

| From | To | When |
|---|---|---|
| pending_approval | active | Kill Bill shows the plan invoice and the account balance is zero or less |
| active | past_due | Kill Bill shows an unpaid invoice, other than a pending plan change's invoice. `past_due_since` is the server time when this is first seen, and `suspends_at` is `past_due_since` plus `BILLING_GRACE_SECONDS` |
| past_due | active | the balance reaches zero or less before `suspends_at` |
| past_due | suspended | server time reaches `suspends_at` |
| suspended | active | the balance is zero or less |

- No other change exists.
- No request, redirect or query string activates a server.
- Plotwright re-reads Kill Bill on every billing read and action, and in a background check of every server at least every 10 seconds.
- A background loop checks `suspends_at` at least once a second. Every request also evaluates it.

**Approve payment.**
1. If a pending server's plan invoice is not yet issued, wait up to 10 seconds for it.
2. For each unpaid invoice, ask Kill Bill for an external payment of its full balance, with payment external key `pw-pay-<invoice id>`.
3. Read the account back. The answer is 200 with the confirmed state, even if the balance is still positive.
4. With nothing unpaid and a balance of zero or less, the answer is 409 `nothing_due`.

**Slow payments.**
- If a payment call has no answer within 5 seconds, record the payment as pending and answer 202. `payment_pending` is then true.
- A settler runs on every instance at least every 5 seconds. It claims each pending payment with a database row lock, so that one instance handles it at a time.
- For each pending payment, the settler looks up the Kill Bill payment with that external key:
  - If it exists and succeeded, the settler adopts it, reads the balance back and applies the status table.
  - If Kill Bill still has no payment with that key 30 seconds after the attempt, the settler sends it again with the same key.
- Exactly one Kill Bill payment exists per invoice.

**Parallel approvals.**
- Approve payment requests for one server are serialised by a database lock that holds across instances.
- While a payment is pending, every other approval answers 409 `payment_pending`. The 202 replay of an approval with the same `Idempotency-Key` returns the same pending payment.
- Once the payment is confirmed, approvals answer 409 `nothing_due`.

**Plan change.**
- A plan change is allowed only while the server is active and no change is pending.
- Kill Bill changes the subscription at once and invoices the prorated difference.
- `pending_plan` holds the new plan until Kill Bill shows an invoice carrying the new plan's charge and a balance of zero or less. Then `plan` becomes the new plan.

**Checkout.**
- The server is created in `pending_approval` only after Kill Bill holds its account, the AUTO_PAY_OFF tag and the subscription.
- If Kill Bill fails partway, no server exists, and a retry with the same key reuses any account it made.
- The slug is the lower-cased name with spaces turned into hyphens.

**Statement.**
- The statement is CSV following RFC 4180: CRLF line endings, no byte-order mark, a header row of `date,kind,plan,amount,balance_after,kb_id`, and quotes only where RFC 4180 requires them.
- Rows follow Kill Bill's order. For each invoice in ascending invoice number:
  1. A `plan_change` row comes first if this is the first invoice carrying a confirmed new plan's charge. Its amount is `0.00`, and `kb_id` is the subscription event id.
  2. Then the `invoice` row. Its amount is the invoice amount, and `kb_id` is the invoice id.
  3. Then a `credit` row for each credit item on that invoice that adds account credit. Its amount is the credit as a negative value, and `kb_id` is the item id.
  4. Then one `payment` row for each payment of that invoice, in ascending effective time. Its amount is the payment as a negative value, and `kb_id` is the payment id.
- `date` is `YYYY-MM-DD`, taken per row kind as follows:

| Kind | Date |
|---|---|
| `plan_change` | the change event's effective date, exactly as Kill Bill gives it |
| `invoice` | the invoice date, exactly as Kill Bill gives it |
| `credit` | the invoice date of the invoice that carries the credit item, exactly as Kill Bill gives it |
| `payment` | the effective date and time of the payment's successful transaction, converted to a date in the server's time zone |

- `plan` is `Hamlet` or `Borough`, the plan of the invoice's recurring charge.
- `amount` and `balance_after` have two decimals. `balance_after` is the running sum, and the final row's value equals Kill Bill's account balance.
- A pending plan change has no row until it is confirmed.
- Two downloads with no billing activity in between are byte-identical.
- While Kill Bill is unreachable, the statement answers 503 and no file is served.

**Suspended and inactive servers.**
- A suspended or pending server refuses everything except reads, billing, members, invites, mail, seasons and exports. That includes walking, blocks, parking, chat, characters, parties, chapter runs, seats, watching, starts, moves, forfeits, rematches, trades, crafting, coin purchases and refunds, saves and restores.
- A suspended server answers 423 `server_suspended`, and a pending server answers 423 `server_inactive`.

**Suspension cascade.** In the same database transaction that moves a server to suspended:
- Every game in play ends with outcome `abandoned` and reason `server_suspended`. It settles at once, with each stake returned.
- All seats are freed and all spectators are removed, and those tables end `open`.
- Every in-progress chapter run becomes `paused`, keeping its stored checkpoints.
- Every open trade is cancelled.
- Every table and server stream gets the change within the push delay.
- The cascade takes each table's row lock. A move that commits first is part of the abandoned game's log. A move that arrives later answers 423, and nothing is ever written after the abandonment.
- Reactivation returns paused runs to `in_progress` and never resumes an abandoned game.
- The abandoned game's result bundle is written as for any finished game.

**Map and blocks.**
- Coordinates run from x 0 to 39 and from y 0 to 23. North lowers y by one.
- Grass, road, runway and sand are passable. Water, table tiles, tiles with blocks and leaving the map are not, and walking there answers `blocked`.
- Placing a block:
  - The tile must be grass or sand, otherwise `not_buildable`.
  - It must be within one tile of the character, counting diagonals, otherwise `too_far`.
  - It must hold no block, vehicle or character, otherwise `tile_taken`.
  - It uses one unheld block of that material from the first slot, in slot order, that holds it, otherwise `no_block_in_inventory`.
- Breaking a block needs the same distance. The block goes to the first slot holding that kind with fewer than 64, or else to the first empty slot. Otherwise the answer is `inventory_full` and the block stays.

**Chat.**
- A message belongs to the world it was posted in. Each world's chat list and `chat` events carry only that world's messages.
- The text is trimmed at both ends before the Message field rules apply.

**Inventory.**
- Each slot holds one kind, up to 64.
- A move between slots:
  - into an empty slot, moves the whole stack;
  - onto the same kind, merges up to 64 and leaves the rest where it was;
  - onto a different kind, swaps the two stacks.
- A slot with held items cannot move, and answers `slot_held`.
- A move from an empty slot answers `empty_slot`.

**Crafting.**
- A craft removes the recipe's inputs, taking unheld items from the lowest slots first, and adds its output by the stacking rule, all in one transaction.
- Missing inputs answer `missing_ingredients`.
- An output with no room answers `inventory_full`, and nothing changes.

**Vehicles and trips.**
- A car parks only on road. It travels along one shortest road path, moving north, east, south or west, and with no path the answer is `no_route`.
- A plane parks only on runway. It flies along x first and then along y.
- The wrong surface answers `wrong_surface`, the vehicle's own tile answers `same_tile`, and another vehicle on the target answers `tile_taken`.
- A plane park while the weather is storm answers 409 `weather_grounded`.
- Each park stores the trip's start tile and its steps.
- Replay applies only the stored steps to the start tile. Blocks placed later never change it.

**Parties and chapters.**
- A character belongs to at most one open party, and the creator leads it.
- When the leader leaves, the earliest-joined remaining member leads. The last member leaving closes the party for good.
- Every party change is pushed as a `party` event within the server-stream push delay.
- Only the leader starts a run. There is at most one run per party, and it plays in the leader's world.
- Walk steps by members in that world are appended to the run's walk log, together with the starting tiles.
- The next checkpoint is reached when any member steps onto its tile. After the last one, the run is completed.
- Each reached checkpoint writes its snapshot object, then its manifest object, then its row.
  - If storage fails, any object written is deleted, `stored` stays false, and the checkpoint is retried at least every 10 seconds by any instance until it is stored, exactly once.
- Replay applies the walk log to the starting tiles.

**Saves, restores and exports.**
- A save writes its snapshot object, then its manifest object, then its row.
  - If either object write fails, the server deletes what that save wrote, writes no row and answers 503.
  - Saves are numbered per world from 1.
- A snapshot is compact JSON `{"world","blocks":[{"x","y","material"}],"vehicles":[{"id","x","y"}]}`, with blocks sorted by y and then x, and vehicles sorted by id.
- A restore:
  - reads the chosen save's snapshot and checks it against its manifest's sha256;
  - writes a new save whose snapshot bytes are a copy of it, with `restored_from` set to the chosen number;
  - then replaces the world's blocks and vehicle tiles. Characters stay where they are.

  If storage fails, nothing changes.
- An export is one archive in POSIX ustar tar format, uncompressed. Its entries, in this order:
  1. `export.json`, compact JSON `{"server":{"id","name"},"worlds":[{"slug","name","save_number","save_created_at"}]}`.
  2. For each world that has a save, in slug order, `<world slug>/snapshot.json`, holding exactly the bytes of that world's latest save snapshot.
- Each entry has mode 0644, uid and gid 0, empty owner names, and a modification time of its save's `created_at` in whole seconds. For `export.json` it is the newest included save's, or the server's creation time when no world has a save.
- The archive ends with the two zero blocks and no further padding.
- Two exports with no save in between are byte-identical.
- The export writes the archive object, then its manifest object, then its row. If a write fails, the server deletes what it wrote and answers 503, so no export object remains.
- An export holds no game or card data.

**Tables.**
- A stake is 0 to 100 coins and a turn clock is 5 to 120 seconds, both inclusive.
- The owner may change them only while no seat is taken, otherwise `table_in_use`, and only with the current ETag.
- Seats:
  - chess: seat 1 White, seat 2 Black;
  - four in a row: seat 1 Ink, seat 2 Gold;
  - card game: seats 1 to 4 North, East, South and West.
- A seat request gets the lowest free seat.
- Taking a seat or watching needs the character within one tile, counting diagonals.
- A character holds at most one seat anywhere, and a user holds at most one seat per table, otherwise `already_seated`.
- Taking a seat needs `available` coins of at least the stake.
- When several claims race for the last seat, exactly one wins. The rest get `table_full`, and no half-taken seat is left.

**Table state.**

| From | To | By |
|---|---|---|
| open | seated | the last free seat is taken |
| seated | open | someone stands up |
| seated | in_play | Start game by a seated player |
| in_play | finished | win, draw, forfeit, timeout or abandonment |
| finished | settled | the result is stored and coins settle |
| settled | in_play | every seated player has offered or accepted a rematch |
| settled | open | someone stands up |

| Request | State | Answer |
|---|---|---|
| Start game | open | 409 `table_not_full` |
| Start game | in_play | 409 `game_in_play` |
| Start game | finished | 409 `not_settled` |
| Start game | settled | 409 `rematch_required` |
| move or forfeit | any state but in_play | 409 `game_not_in_play` |
| Stand up | in_play | 409 `game_in_play` |
| Stand up | finished | 409 `not_settled` |
| rematch | any state but settled | 409 `not_settled` |

- Rematch offers clear when anyone stands up.
- In a rematch, the chess and four-in-a-row characters swap seats. In the card game, the first lead passes to the next seat.

**Turn clock.**
- A deadline is set at the start of a game and after every accepted move.
- The server checks deadlines at least once a second. When a deadline passes, the player on turn forfeits with reason `timeout`, and `finished_at` is the deadline.
- A move at or after the deadline answers `turn_expired` and ends the game the same way.
- A move with the wrong `turn` answers `stale_turn`.
- An illegal move does not reset the clock.
- Each table's moves are applied one at a time under its row lock. When two drops or moves race for the same turn, exactly one is accepted, and the other answers `stale_turn`, or `illegal_move` if it was out of turn.
- Push delay: table changes reach subscribers within one second, and server-stream events within 1.5 seconds.

**Chess.**
- The server enforces:
  - check;
  - checkmate, which wins;
  - stalemate, which is a draw;
  - castling rights, with no castling out of, through or into check, and none after the king or that rook has moved;
  - en passant, only on the move immediately after the double step;
  - promotion, which needs a piece letter.
- Two draws apply automatically:
  - **Threefold repetition.** The third occurrence of the same position ends the game. The same position means the same placement, side to move and castling rights, and the same en passant capture, which counts only when it is legal.
  - **Fifty-move rule.** The game ends after 100 half-moves with no capture and no pawn move, unless that last half-move is checkmate.
- No other draws exist.

**Four in a row.** 7 columns by 6 rows, and Ink moves first. A disc falls to the lowest empty cell, and a full column is illegal. Four in a line wins: horizontally, vertically or along either diagonal. A full board is a draw.

**Card game.**
- 52 cards are dealt 13 to each seat at the start, shuffled from a random seed stored with the game.
- Seat 1 leads the first game, and play goes up the seats, wrapping from 4 to 1.
- A player must follow suit when able.
- The highest card of the led suit wins the trick, with Ace high and no trumps. The trick's winner leads next.
- 13 tricks make a hand, and each trick scores one point.

**Hidden cards.** One visibility filter builds every card-game response and event.
- Until the hand ends, a card in a hand that has not been played reaches only its holder. No response, event, error, history entry, replay or export gives it to anyone else, spectators included.
- `GET /api/games/<id>` gives a seated player their own `hands` entry and `seed: null`. Everyone else gets `hands: null` and `seed: null`.
- Once the hand ends, every read shows the seed and all dealt hands.
- The replay of an unfinished hand stops at the last played card.

**Coins.**
- Every coin movement is one ledger entry. Its lines sum to zero, and every account's balance is the sum of its lines.
- Entries are never edited. Corrections are new reversing entries.
- Accounts are `house`, each character id, and `escrow:<game id>`.

| Entry | Lines |
|---|---|
| Grant | house −500, character +500 |
| Stake, written at each game start | each seat −stake, escrow +total |
| Settlement, written once per game | escrow −total, each seat +payout |
| Top-up | house −coins, character +coins |
| Refund | character −coins, house +coins |
| Trade | one line per coin movement between the two characters |

- Payouts:
  - **Two-seat win, forfeit or timeout:** the winner gets twice the stake and the loser 0.
  - **Draw or abandoned:** each seat gets its stake back.
  - **Card game, hand over:** seats with fewer tricks than the top count get 0. The top seats each get their stake back plus an even share of the stakes of the other seats, and any remainder goes one coin each to the top seats in ascending seat order.
  - **Card game, forfeit or timeout:** the forfeiter gets 0, and the other three share as top seats.
- Result `settlement` amounts are payout minus stake.
- Starting a game needs every seat's `available` coins to be at least the stake, otherwise `insufficient_coins`.

**Storing results.**
1. A finished game writes its result bundle object, then its manifest object.
2. Then, in one database transaction, it writes the result row and the settlement entry and moves the table to settled.
3. It then queues one game-result mail per seated player.

- If storage fails, the table stays finished with `pending_store: true`, no coins move, and any instance retries at least every 10 seconds.
- A game settles exactly once.
- Replay re-runs the stored moves, and the stored seed for cards, and must reproduce the stored position, result and settlement.

**Leaderboards and seasons.**
- A season starts when the server is created, numbered 1, and again on each Start new season.
- For each game kind, a leaderboard counts each character's wins in games settled during the current season. A win is being one of the Result's `winners`.
- Ranking follows standard competition ranking: equal wins share a rank, and the next rank skips, as in 1, 2, 2, 4.
- Within a shared rank, characters are ordered by `reached_at`, the time they reached that win count, earliest first.
- Only characters with at least one win are listed.
- Every settlement pushes a `leaderboard` event.

**Achievements.** Each achievement unlocks once per character and is pushed as an `achievement` event.

| Name | Unlocks when the character |
|---|---|
| First Stone | places a block for the first time |
| Groundbreaker | has broken 10 blocks in total |
| Smooth Landing | parks a plane |
| Long Haul | parks a car after a trip of 10 or more steps |
| Checkmate Artist | wins a chess game by checkmate |
| Four Down | wins a four-in-a-row game by four in a row |
| Trick Taker | takes 7 or more tricks in one hand |
| Maker | crafts any recipe |

The toast stays 5 seconds on its own timer, then disappears. It never takes focus.

**Invites and presence.**
- Any member may invite.
- Before an invite is created, its email is checked against the server's members' account emails. A match answers `already_member`.
- A new invite for an email supersedes every earlier pending invite for that email on that server.
- A join link works once, and expires after `INVITE_TTL_SECONDS`.
- Joining creates the account with the invite's email, signs it in and makes it a member. The plan's member limit applies.
- Each invite sends exactly one mail.
- A user is online on a server while they have at least one open server stream. Coming online is pushed within the push delay. Going offline is pushed within 20 seconds of the last stream closing.
- A new member appears in every member's friends list through a `friends` event.

**Mail.**
- Every mail is first stored as `held`, then sent through SMTP.
- It becomes `sent` only after the SMTP server accepts it.
- While SMTP is unreachable, held mail is retried at least every 10 seconds by any instance, under a row lock, so each mail is sent exactly once.

**Coin purchases.**
1. A purchase needs a fresh `Idempotency-Key`.
2. Plotwright finds or creates the buyer's Kill Bill account for this server, adds an external charge for the pack price to it, and then makes an external payment for the resulting invoice, with payment external key `pw-coins-<purchase id>`.
3. Coins are credited only once Kill Bill shows that payment succeeded. The credit is one top-up entry, in the same transaction that marks the purchase paid and queues the receipt.

- The slow-payment rule applies: no answer within 5 seconds means 202 pending, and the settler finishes it exactly once.
- A failure before the external charge exists answers 503 and keeps no purchase.
- A player may make at most 5 purchases per server per day, counting pending, paid and refunded purchases. The day runs from midnight to midnight in the server's time zone.
  - The check and the insert happen under a per-user lock, so parallel attempts never pass 5.
  - The sixth answers 429 `daily_limit_reached`.
- A refund is allowed only for a paid purchase whose character has `available` coins of at least the pack's coins. Otherwise the answer is `coins_spent`.
  - The refund goes to Kill Bill on that payment, with transaction external key `pw-refund-<purchase id>`.
  - It writes one refund entry and queues the refund mail.

**Trades.**
- A trade opens between two characters in the same world within one tile, counting diagonals, otherwise `too_far`. A character is in at most one open trade, otherwise `trade_open`.
- Offered coins and items are held: they cannot be staked, placed, crafted, moved or offered elsewhere.
- Every offer change increases `version` and clears both accepts.
- An accept must name the current `version`, otherwise 409 `trade_changed`.
- An accept lapses 60 seconds after it is given, on server time, if the trade has not completed.
- When both sides have accepted the same version, the trade completes in one transaction:
  - coins and items move;
  - one trade entry is written;
  - the state becomes `completed`.
- If an inventory cannot take the items, completion fails with 409 `inventory_full`, both accepts clear, and the trade stays open.
- A trade therefore never completes with contents that one side did not accept.
- Either side may cancel.
- Every change is pushed to both parties.

**Weather and day.**
- Weather period `k` is the seconds since the Unix epoch divided by `WEATHER_PERIOD_SECONDS`, rounded down.
- The weather is the list `clear, rain, clear, storm`, indexed by `(k + weather seed) mod 4`.
- Each change is pushed within the push delay.
- Day phase is the seconds since the epoch, modulo `DAY_CYCLE_SECONDS`, divided by `DAY_CYCLE_SECONDS`.
- `night_level` is linear between these points and is rounded to three decimals:

| Phase | Night level |
|---|---|
| 0 | 0.45 |
| 0.25 | 0.15 |
| 0.5 | 0 |
| 0.75 | 0.15 |
| 1 | 0.45 |

- The browser re-reads the weather every 60 seconds and on each `weather` event, and shows the returned `night_level`.

### Services (DP-19, DP-20, DP-21, DP-23, DP-26, DP-31, DP-32, DP-34, DP-35, DP-50, DP-71, DP-73, DP-83, DP-85, DP-88, DP-90)

**Kill Bill.**
- **Catalog.** At start, if the tenant has no catalog, upload one with:
  - BASE products Hamlet and Borough;
  - plans `hamlet-monthly` at 6.00 USD and `borough-monthly` at 12.00 USD;
  - price list DEFAULT;
  - billing period MONTHLY;
  - one evergreen phase with no trial;
  - immediate plan changes.
- **Server records.** Each server has:
  - an account with external key `plotwright-<server id>`, its name, and currency USD;
  - the AUTO_PAY_OFF tag;
  - a base subscription with external key `plotwright-<server id>-plan`;
  - an external payment for every invoice, with external key `pw-pay-<invoice id>`.
- **Buyer records.** Each coin buyer has an account per server, with external key `plotwright-<server id>-<handle>`, currency USD and the AUTO_PAY_OFF tag. On it are the external charges, the payments with external key `pw-coins-<purchase id>`, and the refunds with transaction external key `pw-refund-<purchase id>`.
- **Seeded servers.** At first start, each seeded server gets its account, tag and subscription, finding them by external key when they already exist. Its first invoice is then approved, and the server turns active once the balance is read back. This finishes within 60 seconds after Kill Bill becomes reachable.
- **When unreachable.**
  - Checkout, payments, plan changes, coin purchases, refunds and the statement answer 503 `billing_unavailable` and change nothing.
  - Billing reads answer with the last confirmed state.

**Mail (Mailpit over SMTP).**
- Every mail comes from `MAIL_FROM`, which is set to `Plotwright <no-reply@plotwright.test>`.
- It goes only to its recipient, and carries only that recipient's data.
- Links are absolute, built from the public base address, never from the request's Host.
- Each body line below is one line of a plain-text body.

| Mail | To | Subject | Body lines |
|---|---|---|---|
| invite | the invited email | `<inviter display name> invited you to <server name>` | `<inviter display name> invited you to play on <server name> in Plotwright.` / `Join with this one-time link: <base>/join/<token>` / `The link works once and expires at <expiry label>.` |
| overdue warning, once per overdue invoice | owner | `Invoice overdue for <server name>` | `An invoice for <server name> is overdue. The server will be suspended at <suspends at> unless the payment is approved.` / `Billing: <base>/s/<slug>/billing` |
| payment receipt, once per confirmed server payment | owner | `Payment confirmed for <server name>` | `The billing provider confirmed a payment of <amount> USD for <server name>. Plan: <plan name>.` |
| coin receipt | buyer | `Coins added on <server name>` | `<character name> received <coins> coins for <price> USD.` |
| coin refund | buyer | `Coin purchase refunded on <server name>` | `<coins> coins were removed from <character name> and <price> USD was refunded.` |
| game result | each seated player | `Result: <table name>` | `<end copy>` / `Your coins: <signed amount>` / `Replay: <base>/s/<slug>/games/<game id>` |

`<expiry label>` is the invite's expiry, formatted as `YYYY-MM-DD HH:MM <time zone>` in the server's time zone.

**MinIO.**
- Every object lives in the bucket named by `S3_BUCKET`, under `servers/<server id>/`:

| Record | Keys |
|---|---|
| world save | `servers/<server id>/worlds/<world slug>/saves/<save id>/snapshot.json` and `…/manifest.json` |
| chapter checkpoint | `servers/<server id>/chapter-runs/<run id>/checkpoints/<n>/snapshot.json` and `…/manifest.json` |
| game result | `servers/<server id>/games/<game id>/result.json` and `…/manifest.json` |
| export | `servers/<server id>/exports/<export id>.tar` and `servers/<server id>/exports/<export id>.manifest.json` |

- A manifest is `{"kind","server_id","object","sha256","bytes","created_at"}`.
- The data object is always written before its manifest.
- **When unreachable.**
  - Saves, restores and exports answer 503 `storage_unavailable`.
  - Checkpoints and results wait for retry.

**Postgres.**
- Postgres holds every record not listed above: the event log, mail, purchases, trades, inventories, seasons, idempotency records and the ledger among them.
- Every row carries its server, and every query filters by it.
- The schema and seed are applied idempotently at every serve. Two instances starting at once must not duplicate anything.

**Test instances.** The verifier runs extra copies of the app next to the primary one, each with one dependency changed. Every copy must behave exactly as this brief says for that condition. Unless stated otherwise, a copy shares the primary's database, bucket and Kill Bill tenant.

| Address env var | What differs |
|---|---|
| `APP_KILLBILL_DOWN_URL` | Kill Bill is unreachable |
| `APP_STORAGE_DOWN_URL` | MinIO is unreachable |
| `APP_MAIL_DOWN_URL` | SMTP is unreachable |
| `APP_SLOW_BILLING_URL` | Kill Bill sits behind a relay that holds every payment request 7 seconds before passing it on |
| `APP_STORAGE_PARTIAL_URL` | MinIO sits behind a relay that accepts every object write except keys ending in `manifest.json`, which fail with 503 |
| `APP_SHORT_URL` | its own empty database and bucket, with short `BILLING_GRACE_SECONDS`, `INVITE_TTL_SECONDS`, `WEATHER_PERIOD_SECONDS` and `DAY_CYCLE_SECONDS` |

### Seed data (DP-10, DP-14, DP-17, DP-36, DP-44, DP-46, DP-49, DP-50, DP-52, DP-53, DP-96, DP-97, DP-98)

Every seeded person, server, character, vehicle and place is invented.

**Users.** Each user's email is `<handle>@plotwright.test`.

| Handle | Display name | Passcode |
|---|---|---|
| `mara` | Mara Quill | `mara-plots-01` |
| `tobias` | Tobias Wren | `tobias-plots-02` |
| `ines` | Ines Varga | `ines-plots-03` |
| `kofi` | Kofi Ansel | `kofi-plots-04` |
| `juno` | Juno Hart | `juno-plots-05` |
| `oskar` | Oskar Lind | `oskar-plots-06` |
| `priya` | Priya Sorrel | `priya-plots-07` |
| `rowan` | Rowan Ashby | `rowan-plots-08` |
| `sefa` | Sefa Okoro | `sefa-plots-09` |
| `dara` | Dara Finch | `dara-plots-10` |
| `eli` | Eli Brandt | `eli-plots-11` |

**Servers.** Rowan, Sefa, Dara and Eli belong to no server.

| Slug | Name | Owner | Other members | Plan | Time zone | Weather seed | World |
|---|---|---|---|---|---|---|---|
| `larkspur-commons` | Larkspur Commons | mara | ines, kofi, juno, oskar | Borough | `UTC` | 0 | `meadow`, "Meadow Survey" |
| `fennel-reach` | Fennel Reach | tobias | priya, ines | Hamlet | `America/Chicago` | 2 | `saltmarsh`, "Saltmarsh Survey" |

A rented server gets one world, `home` ("Home"), and a random weather seed from 0 to 3.

**Starter layout.** Every world uses this layout, which is 40 by 24 tiles and grass unless listed:
- Road: row y 10 for x 0 to 39, and column x 20 for y 11 to 17.
- Runway: row y 2 for x 30 to 37.
- Water: x 0 to 5, y 18 to 23.
- Sand: x 34 to 39, y 18 to 23.
- Spawn tile: (16, 8).

Tables start open, with a 10-coin stake and a 30-second turn clock:

| Name | Game | Tile |
|---|---|---|
| Oak Chess Table | chess | (12, 6) |
| Lantern Four Table | four in a row | (16, 6) |
| Felt Card Table | card game | (20, 6) |
| Birch Chess Table | chess | (24, 6) |

**Characters.** Each starts with one 500-coin grant, the Surveyor appearance, an empty loadout and the starter stacks.

| Server | Character | User | Tile |
|---|---|---|---|
| Larkspur Commons | Quarry Mara | mara | (19, 7) |
| Larkspur Commons | Inkfinch | ines | (12, 7) |
| Larkspur Commons | Kestrel | kofi | (13, 7) |
| Larkspur Commons | Junebug | juno | (12, 9) |
| Larkspur Commons | Oxbow | oskar | (21, 7) |
| Fennel Reach | Tinderwren | tobias | (12, 7) |
| Fennel Reach | Pennyroyal | priya | (13, 7) |
| Fennel Reach | Kesh | priya | (20, 7) |
| Fennel Reach | Inkwell | ines | (21, 7) |

**Starter stacks.**

| Cell | Item | Count |
|---|---|---|
| a1 | wood block | 16 |
| b1 | stone block | 16 |
| c1 | brick block | 8 |
| d1 | glass block | 4 |

**Items.** Kind codes, with display names in parentheses:
- `wood` (wood block)
- `stone` (stone block)
- `brick` (brick block)
- `glass` (glass block)
- `fence` (fence)
- `signpost` (signpost)
- `window` (window)
- `milestone` (milestone)
- `lantern` (lantern)
- `compass` (compass)
- `rope` (rope)
- `trowel` (trowel)
- `whistle` (whistle)
- `map_case` (map case)

The loadout items are compass, rope, lantern, trowel, whistle and map case.

**Recipes.**

| Recipe id | Name | Inputs | Output |
|---|---|---|---|
| `fence` | Fence | 2 wood block | 1 fence |
| `signpost` | Signpost | 1 wood block, 1 fence | 1 signpost |
| `window` | Window | 1 glass block, 2 wood block | 1 window |
| `milestone` | Milestone | 3 stone block | 1 milestone |
| `lantern` | Lantern | 1 glass block, 1 brick block | 1 lantern |

**Coin packs.**

| Pack | Coins | Price |
|---|---|---|
| `pouch` | 100 | 1.00 USD |
| `satchel` | 550 | 5.00 USD |
| `chest` | 1200 | 10.00 USD |

**Vehicles.**

| Server | Vehicle | Kind | Owner | Tile |
|---|---|---|---|---|
| Larkspur Commons | Blue Hatchback | car | Kestrel | (5, 10) |
| Larkspur Commons | Paper Kite | plane | Inkfinch | (31, 2) |
| Larkspur Commons | Moth | plane | Junebug | (33, 2) |
| Fennel Reach | Rust Pickup | car | Pennyroyal | (2, 10) |

**Chapter.** Chapter `surveyors-pegs`, "The Surveyor's Pegs", is available in every world.

| n | Checkpoint | Tile |
|---|---|---|
| 1 | Old Well | (8, 12) |
| 2 | Mill Gate | (24, 12) |
| 3 | Runway Beacon | (34, 3) |

**Demonstration game.** This is the 12-move chess game used in Game night:

`a2a3 e7e5 b2b3 b8c6 h2h3 d7d6 a3a4 c8e6 f2f3 a7a6 g2g4 d8h4`

Its final move is announced as `Queen to h4, checkmate`, and Black wins.

**Empty at start.** No parties, runs, games, saves, exports, chat, blocks, invites, purchases, trades, achievements or mail exist at start. Every server is in season 1.

Ids are random and generated at seeding. Tests read them from the API.

## Technical requirements

### Deployment (DP-01)

- **Runtime.** Node.js 22 LTS with npm. The application is written in TypeScript.
- **Run manifest.** `/app/run.json` has string fields `install`, `build` and `serve`, plus `"_schema":"run-manifest-v1"`. For example:
  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```
- **Port.** The app listens on `0.0.0.0` at the port in `APP_PUBLIC_PORT`. The verifier always sets it, to 4173 for the primary instance. One process serves both the browser app and the API.
- **Health.** `GET /api/health` answers HTTP 200 with `{"status":"ok"}` as soon as the app is listening, whether or not Kill Bill, MinIO, SMTP or Postgres is reachable.
- **Schema and seed.** The app applies its schema and seed at serve time, idempotently, not only at build time.

### Configuration and secrets (DP-02)

Read these at start. Never hard-code them, never send them to the browser and never include them in a response:
- `DATABASE_URL`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`
- `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`
- `APP_PUBLIC_PORT`
- `PUBLIC_BASE_URL`, the public base address used for every link in mail. When it is unset, the value of `APP_PUBLIC_URL` is used instead.

Rules for these variables:
- A missing service address, credential, bucket, sender address, port or public base address stops the start, with an error naming the variable. There is no fallback value in code.
- Four tunable durations are optional. Each has one published default, decided in exactly one place in the source:

| Variable | Default |
|---|---|
| `BILLING_GRACE_SECONDS` | 172800 seconds (48 hours) |
| `INVITE_TTL_SECONDS` | 259200 seconds (72 hours) |
| `WEATHER_PERIOD_SECONDS` | 600 seconds |
| `DAY_CYCLE_SECONDS` | 86400 seconds |

- The bucket named by `S3_BUCKET` already exists. Do not create buckets.

### Server boundary (DP-03, DP-07, DP-34, DP-80, DP-82)

**Same origin.**
- The app's own origin is the origin of the public base address. The server sends no cross-origin allowance headers.
- A state-changing request is refused with 403 `cross_origin` when its `Origin` header is `null`, or is present and differs from the app's own origin. This includes an Origin that matches only the request's `Host` header.
- A forged `Host` header never changes a link, a redirect or a mail.

**Request limits.**
- JSON bodies of up to 16,384 bytes are accepted, with exactly 16,384 allowed. Larger bodies answer 413.
- A body sent with any other content type answers 415.

**Never served.** These paths render the not-found page:
- server source files and source maps;
- `.env` files and `.git`;
- `node_modules`;
- `/app/run.json`;
- any credential.

The browser bundle contains no credential.

**Session and membership on reads.** Every game read follows the 401 and 404 rules of the error precedence:
- game state;
- legal moves;
- move logs;
- replays;
- history;
- leaderboards;
- every event stream.

**One server at a time.**
- Every read, list, search, autocomplete, count, total, export, stream, object key, mail list and ledger view is scoped to exactly one server.
- Anything belonging to another server answers the same 404 as an unknown id.
- `member_count`, `character_count`, `total` and every search count cover only the requested server.

**Unreachable dependency at boot.**
- When Kill Bill, MinIO or SMTP is unreachable at start, the app still starts, serves pages and health, and answers the published outage behaviour.
- When Postgres is unreachable, the app retries every 2 seconds and answers 503 `database_unavailable` until it connects.

### Browser support and performance (DP-41, DP-69, DP-78)

- **Browsers.** Current Chromium, Firefox and WebKit.
- **Viewports.** 375×812 (touch), 768×1024 and 1280×800, with no horizontal page scrolling on any of them.
- **Load time.** The world view is usable within three seconds of opening it.
- **Moves.** An accepted move appears and is announced within one second of the server's answer.
- **Clock drift.** The turn clock never drifts more than one second from the server's remaining time while the page stays open.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` fields and `"_schema":"run-manifest-v1"`, and the app starts with exactly those commands.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package with its licence, plus each bundled font (Pixelify Sans, Atkinson Hyperlegible, JetBrains Mono) and the Lucide icons with theirs. "Shipped packages" means the production dependency tree reported by `npm ls --omit=dev --all --json`.
- IF-03: Every shipped package's `license` field is one of MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 or 0BSD. The bundled fonts are OFL-1.1, and the Lucide icons are ISC.
- IF-04: The only datastores are the Postgres database at `DATABASE_URL` and the MinIO bucket at `S3_BUCKET`. No SQLite, embedded database, Redis or local file holds state, and Kill Bill is the only source of truth for billing.
- IF-05: Every font, image, sound and script is served from the app's own origin. Built pages make no request to any other host.
- IF-06: Any development service configuration provided in the repository's first commit (compose files and their seed jobs) is left unchanged.
- IF-07: Application source is TypeScript, and `package-lock.json` is committed.

## Engineering standards

- **Typed code.** The code is idiomatic, strictly typed TypeScript. It has no `any` and no type assertions that only silence the compiler.
- **Domain names.** Identifiers use this brief's domain terms, including Server, Plan, BillingStatus, World, Tile, Block, Vehicle, Trip, Character, Inventory, Recipe, Party, ChapterRun, Checkpoint, Table, Seat, Stake, Settlement, TradeWindow, Season and Invite.
- **One error builder.** Every error response is built by one function. That includes the global 500 handler, the static-file 404 and the event-stream error event.
- **One place per rule.** Each of these rules is decided in exactly one server module, and the browser only renders it:
  - move legality per game;
  - the table lifecycle;
  - the billing status machine;
  - the trade state machine;
  - the turn clock;
  - the card visibility filter;
  - the settlement split;
  - leadership succession;
  - per-server query scoping.
- **Configuration.** Configuration comes only from environment variables, as Configuration and secrets states, with each tunable's default in one place.
- **No dead or defensive code.** There are no unused exports, unreachable branches, commented-out code, or checks for states the rules or the types already make impossible.
- **No needless layers.** No interface, factory or wrapper has only one implementation or only passes calls through.
- **No extras.** No feature, endpoint, screen or setting goes beyond this brief, and no provider response is faked or stubbed in shipped code.
