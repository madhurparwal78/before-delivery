# Long Rail Headstring

Headstring is an online 8-ball pool game for the mobile web. It opens from a link with no install and is for casual and committed players on phones and laptops. It has server-refereed coin-stake tables, friends, clubs, 8-player tournaments, a cosmetic shop and offline practice against an AI. The backend uses exactly three services: Postgres as the only store, Kill Bill for one-off Cash pack payments, and Mailpit for the verification link and the Cash receipt. Out of scope: withdrawals or transfers of any currency, refunds and chargebacks, social sign-in, push notifications, analytics, moderation queues, data export, weekly reward payouts, and any extra process or datastore.

## Problem and users

Players of online 8-ball games put hours of earned coins, and often real money, on stake tables where they cannot see why a result stood. The same complaints keep appearing: a connection drops mid-match and the stake is gone, coins vanish with no record, a paid pack is followed by a lost balance, and cheating reports get canned replies. Players are left with screenshots and tickets that rarely win. In Headstring every coin has a ledger line, every shot has a server-run result, and the table says in plain words what happened. Coins and Cash can never be withdrawn, so a stake table stays a game and not a wager.

- **Ranked player** (daily): picks a stake table, gets a fair opponent near their level, and trusts the coins, level and win record afterwards.
- **Practising newcomer** (daily): learns aiming against the AI, including with no connection, before risking coins.
- **Tournament entrant** (weekly): pays into an 8-player knockout and receives the exact published prize or a full refund.
- **Club captain** (weekly): fills a capped club with friends and sees a club score that matches its members' wins.
- **Cue collector** (occasional): buys Cash packs and spends Coins or Cash on cues without paying twice or being credited wrongly.
- **Invited friend** (weekly): opens a shared link, signs up if needed, and reaches the same zero-stake table as the host.

## Journeys

1. **First shot.** A visitor with no session opens `/` and lands on the tutorial table. They aim, set power and strike through labelled controls, keys or touch. The step readout advances over three shots, then a skippable sign-up prompt appears.
2. **Sign-up with resume.** A guest on Home taps Play 1-on-1. The sign-up sheet opens, they create an account, and the tapped action resumes at the tier picker. Home shows the sign-up grant and the Starter Cue.
3. **Stake table.** A signed-in player picks a tier and joins the queue. They reach the same table address as a paired opponent, both see their Coins drop by the entry, and they take turns under the server's clock. The match ends on a result both players see, with Coins, XP and record agreeing on Home and Profile after reload.
4. **Offline practice.** After one earlier visit, a player with no network opens Home, sees online modes disabled, starts a Rookie rack, watches the AI think and play, leaves, and is offered the unfinished rack on return.
5. **Buying Cash.** A verified adult opens a Cash pack, pays in the app's own dialog, sees the Confirming state, then sees the new Cash balance and receives a receipt email. Spending Cash on a cash cue marks it owned and lets them equip it.
6. **Private table.** A host creates a private table and shares the link. A friend, signed in or not, follows it and reaches the same table. After sign-up the friend lands on the table address directly.
7. **Tournament.** An entrant registers at a tier and watches the entrant count rise in place. Taking the last seat draws the bracket and begins the ready check. If the window ends short of 8, every entry returns and the screen says so.
8. **Club.** A player joins an open club, sees the roster and weekly score, sends preset messages, and has their role changed by the owner. Leaderboards show their pinned rank.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — First shot main journey** A new visitor who opens `/` with no session gets the tutorial table with no sign-up, completes a shot through the labelled controls, and sees the tutorial step readout advance.
- **DP-02 — First shot keyboard path** With keys only, using the published aim, spin and hold-release power shortcuts, a visitor completes a tutorial shot and the step readout advances.
- **DP-03 — First shot zero-power cancel** Releasing the power hold at 0% cancels the shot, uses no tutorial step, and posts the published cancel sentence in the table announcements log.
- **DP-04 — First shot phone path** At 375x812 portrait the tutorial table runs with its long axis vertical, no rotate wall, no sideways scrolling and every control at least 44 px, and a shot completes by touch alone.
- **DP-05 — Sign-up main journey** A guest who taps Play 1-on-1 and signs up in the sheet resumes at the tier picker, and Home then shows the published grant and the Starter Cue.
- **DP-06 — Sign-up keyboard path** The sign-up sheet keeps Tab and Shift+Tab inside it, closes on Escape, returns focus to its opener, and its error summary links to each invalid field.
- **DP-07 — Sign-up age copy** A year of birth under 13 shows the published block sentence and creates no account, and a year under 18 shows the published note before the account is created.
- **DP-08 — Sign-up phone path** At 375x812 the sheet fits the screen, and reopening it during its closing motion keeps it open with no later re-hide.
- **DP-09 — Session API** The published sign-up and sign-in calls set the published session cookie, return the published bodies, and answer the sixth sign-in attempt in a minute with the published rate limit, as qualified in Business rules.
- **DP-10 — Lobby main journey** Home shows the avatar, display name, level, XP bar, Coins and Cash matching `GET /api/me`, unchanged after reload, with the first-match highlight for a player with no matches.
- **DP-11 — Lobby live chips** In two tabs of one player, a Refill or daily reward claimed in one tab updates the chips in the other without reload, and the fourth Refill of the day is refused with the published sentence.
- **DP-12 — Lobby keyboard path** The first Tab reaches the skip control, which moves on to the mode cards, and the cards then take focus in published visual order with a visible focus mark.
- **DP-13 — Lobby phone path** At 375x812 Home shows the published single-column order, the secondary row is reachable, and every target is at least 44 px.
- **DP-14 — Practice offline main journey** After one earlier visit and with the network off, Home shows the published offline state with online modes disabled, and a Rookie rack starts with no server call and earns nothing.
- **DP-15 — Practice screen-reader turns** The AI's Thinking state and finished turn are announced in the polite table log with published copy, and the turn text updates to match.
- **DP-16 — Practice keyboard and resume** Difficulty and start work with keys only, a shot can be played with keys, and leaving and returning offers the published resume prompt.
- **DP-17 — Practice phone path** At 375x812 and offline, practice setup and the table work with score and turn present as DOM text.
- **DP-18 — Stake tier picker main journey** The tier picker shows all five tiers with entry, pot and lock state, a locked tier shows its minimum level, and an unaffordable tier shows its shortfall with a Refill link or a Lower tier link.
- **DP-19 — Stake carousel keyboard path** Arrow keys move the tier carousel, Enter joins the queue on an available tier, and Escape or Cancel leaves the queue.
- **DP-20 — Stake carousel reversing motion** A reversed carousel move runs back from its current position with no jump, a swipe snaps to a tier on a phone, and reduced motion gives a plain crossfade with the same end state.
- **DP-21 — Stake pairing live update** Two contexts queued at one tier reach the same table address within 3 seconds with both Coin chips down by the entry and no reload, and Cancel before pairing debits nothing.
- **DP-22 — Stake table guards** The server enforces the published queue rejections, level band widening, mode unlock and second-device rule, as qualified in Business rules.
- **DP-23 — Table turns main journey** On a scripted table with two contexts, a shot by one player updates the other's turn, score and group text without reload.
- **DP-24 — Table foul announcement** A scripted foul shows the exact published reason in both contexts, is announced in the table log, and states ball in hand in text.
- **DP-25 — Table turns keyboard path** The shooter takes a whole shot with keys only, including ball in hand, while the waiting player's aim controls are hidden and inert.
- **DP-26 — Table turns phone path** The same scripted table at 375x812 keeps turn, score and group readable as DOM text with controls at least 44 px.
- **DP-27 — Server shot clock and reconnect** The shot clock and reconnect timers show the server's remaining time whatever the device clock says, a late shot is refused, and reconnect, forfeit and void follow Business rules.
- **DP-28 — Match result main journey** On a scripted table the winner pots the 8 in the called pocket, and both players see the result with the published Coin change, XP and reason.
- **DP-29 — Match result after reload** After reload, both players' Home and Profile show the Coins, level and win record of the same settled match.
- **DP-30 — Called pocket keyboard path** When a shooter's group is cleared the shot is blocked with the published sentence until a pocket is called by keys.
- **DP-31 — Result under reduced motion** Under reduced motion the result shows final numbers at once with no counting, a level-up lists its reward, and rematch is disabled with the published reason when funds are short.
- **DP-32 — Escrow and ledger lines** Each stake and settlement writes balanced lines, a wallet balance equals the sum of its lines in each currency, each match's escrow ends exactly once, and Profile lists the lines.
- **DP-33 — Shop main journey** Buying a Coin cue drops the balance, marks the item owned and lets it be equipped, and equipping mid-match changes nothing until the player's next match.
- **DP-34 — Shop keyboard path** Shop tabs move by arrow keys, and the item dialog keeps Tab inside it and returns focus to the item on Escape.
- **DP-35 — Shop exact text** Insufficient-funds and level-locked items show the published sentences, and the compare panel shows the published stat bonuses in the published format.
- **DP-36 — Shop phone path** At 375x812 the Shop shows its published grid, stat bars keep text values, and nothing scrolls sideways.
- **DP-37 — Cash pack main journey** A verified adult using the link from Mailpit buys a pack, sees `Confirming`, then the new Cash balance, and a receipt mail and a Kill Bill PURCHASE payment both exist.
- **DP-38 — Cash pack keyboard path** The payment dialog completes with keys only, focus stays managed, and the result is announced politely.
- **DP-39 — Cash pack eligibility copy** An under-18 player is not offered payment, and an unverified adult is sent to verify with a one-tap resend, each with published copy.
- **DP-40 — Cash pack outage screen** With Kill Bill unreachable the payment fails with the published sentence, nothing is credited, and the Shop stays usable.
- **DP-41 — Cash pack idempotent credit** A repeated request with the same `Idempotency-Key` credits once and records one Kill Bill payment, and a conflicting reuse is refused as published.
- **DP-42 — Friends main journey** A request by code is accepted and the friend appears in the list.
- **DP-43 — Friends live presence and invite** In two contexts, presence changes in the open friends panel within 5 seconds without reload, and the host's invite link brings both to the same table address.
- **DP-44 — Friends panel reversing motion** The friends panel slides in, closing it mid-flight reverses from where it is with no jump, and its contents are hidden and inert once closed.
- **DP-45 — Invite after sign-up on a phone** A logged-out person at 375x812 continues from an invite to the table after sign-up, and an expired link shows the published expiry word.
- **DP-46 — Clubs main journey** A player joins an open club, sees the roster and weekly score, and leaves, and the owner sees the published ownership rule and a full club gives the published refusal.
- **DP-47 — Clubs live messages** A preset message sent in one context appears in the other without reload.
- **DP-48 — Clubs keyboard role menu** A role change works through a menu with arrows, Enter, Escape and focus return, and is announced politely.
- **DP-49 — Leaderboard phone path** At 375x812 the leaderboard scope tabs work and the player's own rank row stays pinned in view.
- **DP-50 — Tournament main journey** Registering at a tier moves the entry out of Coins, and the bracket screen shows the published prize split.
- **DP-51 — Tournament live count** The entrant count updates without reload in a second context, and taking the last seat draws the bracket and begins the ready check on the page already open.
- **DP-52 — Tournament keyboard and screen reader** The 8-slot bracket is reachable in reading order, the ready control works by keys, and the check is announced.
- **DP-53 — Tournament phone and short window** At 375x812 the bracket scrolls inside its own region, and a window ending with fewer than 8 refunds every entry and says so with the published sentence.
- **DP-54 — Tournament prizes and refunds** Tournament APIs publish the exact prizes, exactly one entrant wins a last seat, and refunds write ledger lines, as qualified in Business rules.
- **DP-55 — Accessibility baseline** The main screens pass an automated WCAG 2.2 AA check and every focusable control shows a visible focus mark.
- **DP-56 — Published layouts** The table, rail and scoreboard layouts match the published arrangement at 375x812, 768x1024 and 1280x800, with no sideways scrolling on any main screen.
- **DP-57 — Mail outage screen** With mail unreachable, sign-up and play still work, Home and Shop show the published mail notices, and no success copy claims a mail was sent.
- **DP-58 — Postgres outage screen** With Postgres unreachable, Home shows `Could not reach the table`, a retry control, and cached values marked stale.
- **DP-59 — Settings persistence and mirroring** Settings survive a reload and reach the same player in a new context, left-handed mode mirrors the table controls, and the reduced-motion toggle acts as the device preference does.
- **DP-60 — Contact Loupe opens and locks** On the shooter's turn a pointer or aim key opens the Contact Loupe with its label and numeral in DOM text, locking draws the tangent line and freezes the numeral, and the shot receipt repeats the angle and first ball.
- **DP-61 — Contact Loupe reverses and rests** Unlocking during the draw reverses the tangent line from its current length with no jump, and under reduced motion the loupe and line appear whole with the same text.
- **DP-62 — Referee rulings** Scripted shots produce the published ruling for each foul, break outcome, group claim, 9-Ball case and win or loss reason, and a client cannot submit ball positions or outcomes.
- **DP-63 — Health and server boundary** The health route, size limits, content types, error shape, same-origin rule and refused paths behave as published in Server boundary.
- **DP-64 — Hall-lamp look** Every screen shows the near-black hall with one pool of lamp light on the table, tall condensed scoreboard counters, brass rulings and tabular figures.
- **DP-65 — Server authority and secrets** Source shows settlement, shot results and clocks decided only on the server, credentials read from the environment, and no provider call faked.

## Frontend

### Screens and layout (DP-10, DP-13, DP-36, DP-49, DP-53, DP-56)

Every screen has no sideways scrolling at 375x812, 768x1024 and 1280x800.

| Screen | Route | What it shows |
|---|---|---|
| Tutorial | `/` with no session and no finished-tutorial mark in this browser | Tutorial table, step readout |
| Home | `/home` | Avatar, display name, level, XP bar, equipped cue, chips, mode cards, secondary row. Signed-in players get a lobby; guests get the same cards with `Guest` as the name, and no chips or equipped cue |
| Tier picker | `/play`, also `/play?mode=<mode>` | Stake tier carousel |
| Mode picker | `/play/special` | 9-Ball and No Guidelines |
| Table | `/table/<table id>` | Live match or private table |
| Practice setup | `/practice` | Difficulty and resume prompt |
| Practice table | `/practice/table` | AI rack or free table |
| Shop | `/shop` | Tabs, item grid |
| Tournaments | `/tournaments` | One open bracket per tier |
| Bracket | `/tournaments/<tournament id>` | Entrants, bracket, prize split, ready check |
| Clubs | `/clubs` and `/clubs/<club id>` | Club list; club roster, score, messages |
| Leaderboards | `/leaderboards` | Scope tabs, ranking, own rank |
| Profile | `/profile` | Record and ledger |
| Settings | `/settings` | All settings |
| Email verified | `/verify?token=<token>` | Verification result |
| Invite | `/invite/<token>` | Invite result or sign-up |
| Add friend | `/friends/add/<friend code>` | Send a request by link |

A signed-in player who opens `/` goes to `/home`. Any other unknown path shows the not-found heading from Feedback states.

**Home.**
- At 375x812 there is one column, in this order: identity block, chips, notices, mode cards in published order, secondary row.
- At 768x1024 the mode cards form two columns.
- At 1280x800 the mode cards form three columns.
- The cards keep one fixed order at every width: the order of the mode-card row in the Home and shared table under Public screens and controls. Its first six buttons are the main cards, and its last three form the secondary row.

**Table screen, used by the tutorial, practice and online tables.**
- At 375x812 the order top to bottom is `Scoreboard`, the table with its long axis vertical, `Shot controls`. The page may scroll vertically.
- At 768x1024 the order is `Scoreboard` across the top, the table with its long axis horizontal, `Shot controls` below it.
- At 1280x800 `Scoreboard` is a rail along the left edge, the table sits in the centre with its long axis horizontal, and `Shot controls` is on the right. Left-handed mode swaps the rail and the controls.
- A signed-in player's Coins and Cash chips appear in a thin header on every signed-in screen, including the table.
- There is no rotate-your-phone wall in any orientation.

**Shop grid.** One column at 375x812, two at 768x1024, four at 1280x800.

**Bracket.** At 375x812 `Bracket` is a region that scrolls sideways inside itself while the page does not.

**Friends panel.** It is a panel on Home at the right edge: full width at 375x812, one third of the screen wide at 1280x800.

### Public screens and controls (DP-01, DP-05, DP-10, DP-18, DP-23, DP-33, DP-37, DP-42, DP-46, DP-50, DP-55, DP-59, DP-60)

Only these names are public. Every name is an exact ARIA role plus accessible name, with one exception: `password field "Password"` means a masked password input with the visible label `Password`. It has no ARIA role, so it is found by its label. `textbox "Year of birth"` is a plain text input that asks for a numeric keypad, not a number spinner.

**Table screen**

| Role and name | Notes |
|---|---|
| `img "Table"` | The drawn table. Never in the Tab order, and clicking it never takes shortcuts away |
| `slider "Aim angle"` | 0.0 to 359.9 degrees, in 0.1 steps; 0.0 points at the foot end and values rise clockwise |
| `slider "Fine aim"` | -1.0 to 1.0 degrees, in 0.1 steps; added to the aim |
| `slider "Shot power"` | 0 to 100 percent; rests at 50 at the start of every turn |
| `slider "Side spin"` | -100 (left) to 100 (right) |
| `slider "Top spin"` | -100 (back) to 100 (top) |
| `button "Lock aim"` | Pressed state shows locked; optional before striking |
| `button "Strike"` | Shoots with the current slider values |
| `radiogroup "Called pocket"` | Radios `Top left`, `Top right`, `Middle left`, `Middle right`, `Bottom left`, `Bottom right`; shown only when a pocket must be called |
| `region "Shot controls"` | Holds the sliders, Lock aim and Strike; hidden and inert while it is not this player's shot |
| `group "Ball placement"` | Shown only with ball in hand: `slider "Cue ball across"`, `slider "Cue ball along"`, each on the scale in Business rules, and `button "Place ball"` |
| `status "Turn"` | Turn text |
| `region "Scoreboard"` | Each player's name, group and balls left, then the pot |
| `status "Rule banner"` | Inside the Scoreboard; the one sentence chosen by the banner rule in Feedback states |
| `log "Table announcements"` | Polite; every announcement on the table |
| `timer "Shot clock"` | `<seconds>s` |
| `timer "Reconnect"` | Shown only while a player is dropped |
| `status "Spin"` | Spin text |
| `status "Contact loupe"` | Loupe label and numeral |
| `img "Contact loupe view"` | The magnified circular overlay |
| `progressbar "Tangent draw"` | The drawn share of the tangent line, 0 to 100, updated as it draws |
| `region "Shot receipt"` | Receipt for the last shot |
| `status "Tutorial step"` | Tutorial only |
| `dialog "Match result"` | Result line, `status "Coin change"`, `status "XP gained"`, `button "Rematch"`, `button "Back to lobby"` |
| `textbox "Invite link"`, `button "Copy link"` | Read-only link, on a private table waiting for a friend |
| `link "Back to lobby"` | Leaves the table screen; the match keeps running |

**Home and shared**

| Role and name | Notes |
|---|---|
| `link "Skip to modes"` | First Tab stop on Home |
| `link "Profile"` | Avatar and name |
| `status "Equipped cue"` | In the identity block for signed-in players; its text is the equipped cue's name, for example `Starter Cue` |
| `status "Coins"`, `status "Cash"` | Text is the number; on an outage, followed by the stale word |
| `progressbar "XP"` | Visible text `<xp> / <xp to next> XP`; beside it the text `Level <level>` |
| `button "Claim daily reward"` | Disabled once claimed |
| `button "Refill"` | Shown while Coins are under 100, beside `<refills left> left today` |
| `button "Play 1-on-1"`, `button "Play Special"`, `button "Play with Friends"`, `button "Practice Offline"`, `button "Shop"`, `button "Settings"`, `button "Tournaments"`, `button "Clubs"`, `button "Leaderboards"` | Mode cards, inside `region "Modes"` |
| `button "Friends"` | Opens the Friends panel; shows expanded state |
| `status "Home notice"`, `status "Connection"`, `status "Mail notice"` | Home notices |
| `button "Retry"` | On the outage bar |
| `link "Back to table"` | Shown while the player has a live match |
| `dialog "Save your progress"` | After the tutorial: `button "Create account"`, `button "Skip for now"` |

**Sign-up and sign-in**

| Role and name | Notes |
|---|---|
| `dialog "Create your account"` | `textbox "Email"`, `password field "Password"`, `textbox "Display name"`, `textbox "Year of birth"`, `button "Create account"`, `button "Sign in instead"`, `button "Close"` |
| `dialog "Sign in"` | `textbox "Email"`, `password field "Password"`, `button "Sign in"`, `button "Create an account instead"`, `button "Close"` |
| `alert "Check these fields"` | Error summary; one link per invalid field, named with that field's error, moving focus to the field |

**Play and practice**

| Role and name | Notes |
|---|---|
| `region "Stake tiers"` | The tier carousel and a Tab stop; one `group "<tier name>"` per tier, each with the texts `Entry <entry>` and `Pot <pot>` and its lock or shortfall state, with `button "Join table"` on the selected card only when that tier is available |
| `status "Selected tier"` | Selected tier's name |
| `status "Queue"`, `button "Cancel"` | Queue text and leave control |
| `link "Refill"`, `link "Lower tier"` | Shown on an unaffordable tier, as set out under Tier carousel in Interactions |
| `button "9-Ball"`, `button "No Guidelines"` | Mode picker |
| `radiogroup "Difficulty"` | Radios `Rookie`, `Regular`, `Shark`, `Free table` |
| `button "Start rack"` | Starts the selected practice |
| `region "Unfinished rack"` | `button "Resume rack"`, `button "New rack"` |

**Shop and payment**

| Role and name | Notes |
|---|---|
| `tablist "Shop sections"` | Tabs `Cues`, `Cash cues`, `Cloths`, `Cash packs` |
| `button "<item name>"` | In `Cues`, `Cash cues` and `Cloths`; opens `dialog "<item name>"` |
| `button "Buy for <price> <currency>"` | In the item dialog; `<currency>` is `Coins` or `Cash` |
| `button "Equip"` | In the item dialog once owned |
| `region "Compare"` | In a cue's item dialog |
| `button "Close"` | In the item dialog |
| `button "Buy <pack name>"` | In `Cash packs`, for example `Buy Chalk Pack`, for an eligible player; opens `dialog "Buy Cash"` |
| `dialog "Buy Cash"` | Shows the pack's name and Cash amount, `button "Pay <price in dollars>"`, for example `Pay $0.99`, and `button "Cancel"` |
| `button "Resend verification"` | One tap; in `Cash packs` for an unverified adult |
| `status "Shop notice"` | All Shop feedback; stays readable and in the accessibility tree while a dialog is open |

**Friends**

| Role and name | Notes |
|---|---|
| `region "Friends"` | The panel |
| `button "Close friends"` | Closes it |
| `textbox "Friend code"`, `button "Send request"` | Request by code; the player's own code is shown as text |
| `button "Create private table"` | Creates a table and goes to it |
| `list "Friends list"` | One listitem per friend with name and presence, and `button "Block <name>"` |
| `button "Accept <name>"`, `button "Decline <name>"` | Incoming requests |
| `status "Friends notice"` | Feedback |

**Clubs and leaderboards**

| Role and name | Notes |
|---|---|
| `button "Create club"`, `textbox "Club name"`, `radiogroup "Join policy"` with `Open` and `Request to join` | Create form on `/clubs` |
| `button "Join <club name>"` | Club list |
| `button "Leave club"` | Club screen |
| `status "Weekly score"`, `status "Members"` | `Weekly score <score>`; `<count> / 50` |
| `list "Roster"` | One listitem per member with name and role |
| `button "Change role for <name>"` | Opens `menu` with `menuitem "Make owner"`, `"Make officer"`, `"Make member"`; shown to the owner |
| `button "Approve <name>"`, `button "Reject <name>"` | Join requests; owner and officers |
| `group "Preset messages"` | One button per preset |
| `log "Club messages"` | `<name>: <preset>` |
| `status "Club notice"` | Feedback |
| `tablist "Scope"` | Tabs `Global`, `Friends`, `Club` |
| `table "Weekly wins"` | Rank, name, wins |
| `region "Your rank"` | Stays pinned in view |

**Tournaments**

| Role and name | Notes |
|---|---|
| `button "Register for <tier name>"` | Tournaments list |
| `status "Entrants"` | Entrant count text |
| `region "Bracket"` | Contains `list "Bracket slots"` with 8 listitems |
| `table "Prize split"` | Place and Coins |
| `button "Ready"` | During the ready check, for an entrant |
| `status "Ready check"` | Ready text |
| `log "Tournament announcements"` | Polite |

**Settings and Profile**

| Role and name | Notes |
|---|---|
| `switch "Sound"`, `switch "Music"`, `switch "Left-handed mode"`, `switch "Reduced motion"` | Toggles |
| `slider "Aim sensitivity"` | 1 to 10 |
| `radiogroup "Theme"` | Radios `Light`, `Dark`, `System` |
| `list "Blocked users"` | `button "Unblock <name>"` |
| `button "Delete account"` | Opens `alertdialog "Delete account"` with `password field "Password"`, `button "Delete my account"`, `button "Keep my account"` |
| `region "Player record"` | Text lines `Level <n>`, `Wins <n>`, `Losses <n>`, `Win rate <n.n>%`, `Streak <n>`, `Highest pot <n>` |
| `table "Ledger"` | Columns `Date`, `Kind`, `Amount`, `Balance after`, with rows as set out in Feedback states |

### Interactions (DP-02, DP-03, DP-04, DP-06, DP-12, DP-16, DP-18, DP-19, DP-25, DP-30, DP-33, DP-34, DP-35, DP-37, DP-38, DP-39, DP-44, DP-48, DP-52, DP-60)

**Table keyboard shortcuts.** They work with focus anywhere in the table screen, including on a button or slider. The exceptions are a text field, where they do nothing, and inside `Called pocket`, where arrow keys move between radios.

| Key | Action |
|---|---|
| Left, Right | Rotate aim by 1 degree; Right adds, Left subtracts, wrapping at 360 |
| Shift+Left, Shift+Right | Rotate aim by 0.1 degree |
| Up, Down | On a focused slider other than the aim, change its value; elsewhere nothing |
| S | Cycle spin: none, top, back, left, right. Set the spin sliders to 0/0, then 50 top, 50 back, 50 left, 50 right, and update `Spin` to `Spin: none`, `Spin: top`, `Spin: back`, `Spin: left`, `Spin: right` |
| L | Toggle Lock aim |
| Hold Space | Power starts at 0% and stays there for the first fifth of a second, then rises at 50% a second up to 100%, shown on `Shot power`. Releasing shoots at the shown value |
| Escape during the hold | Cancels the hold; `Shot power` returns to 50 |
| Enter on a focused button | Activates it. Strike is struck by Enter, or by the Space hold |

A Space release or Strike at 0% power is a cancel, not a shot. It uses no turn and no tutorial step, and `Shot power` returns to 50. These keys do nothing while it is not the player's shot.

**Pointer and touch aiming.** Moving a pointer over the table aims at the pointer. Tapping or dragging on the table aims at the touch point. Sliders work by touch. Strike uses the current `Shot power`. Tutorial, practice and online tables behave the same.

**Ball in hand.** `Ball placement` appears for the player holding the ball, with its sliders starting at the default spot from Business rules. Moving its sliders, or dragging the cue ball on the table, positions it. `Place ball` confirms and `Turn` becomes `Your turn`. A player may also strike without pressing it, and the shot is taken from the ball's current spot. After an illegal break `Cue ball along` stops at the head string and dragging cannot pass it.

**Called pocket.** When the shooter's group is cleared, or at any shot where the 8 is their only legal target, `Called pocket` appears, Strike is disabled and Space does not start a hold. A Space press in this state posts the called-pocket sentence as set out in Feedback states. Choosing a radio by arrow keys or tap enables Strike.

**Tab order on the table.** `Called pocket` when shown, `Ball placement` when shown, `Aim angle`, `Fine aim`, `Shot power`, `Side spin`, `Top spin`, `Lock aim`, `Strike`, then `Back to lobby`.

**Dialogs and sheets.** Every dialog keeps Tab and Shift+Tab wrapping inside it, closes on Escape unless it is `Match result`, and returns focus to the control that opened it. If that control has gone, focus moves to the screen's main heading. `Match result` keeps Tab inside until the player presses `Back to lobby` or `Rematch`. From the first moment of a closing motion, the page beneath takes clicks and tapping the opener reopens the sheet.

**Sign-up resume.** A guest who taps any online mode gets `dialog "Create your account"`. After sign-up the tapped action runs: Play 1-on-1 goes to `/play`, Play Special to `/play/special`, Play with Friends opens the Friends panel on Home, Shop to `/shop`, Tournaments to `/tournaments`, Clubs to `/clubs`, Leaderboards to `/leaderboards`. Settings and Practice Offline open for guests without a sheet.

**Home keyboard.** The first Tab reaches `Skip to modes`. Enter moves focus to `region "Modes"`, and the next Tab reaches `Play 1-on-1`. Tab continues through the cards in the published order.

**Tier carousel.**
- On load the selected tier is Corner Bar and focus is on `region "Stake tiers"`, which is a Tab stop. The next Tab stop is `Join table` when the selected card has one.
- Left and Right, with focus in `Stake tiers`, change the selected tier one step and update `Selected tier`. Focus stays where it is, on the region or, if the new card has no `Join table`, moves to the region.
- The carousel stops at each end and does not wrap: Left on Corner Bar and Right on The Penthouse do nothing.
- A tier is available when the player meets its level and holds its entry. Enter, with focus on the region or on `Join table`, joins the queue on an available tier and does nothing on any other.
- A tier the player's level does not reach shows only its level lock, with no `Join table` and no links, whatever their Coins.
- `link "Refill"` goes to `/home` and appears on an unaffordable tier while Coins are under 100 and Refills remain. `link "Lower tier"` appears on every other unaffordable tier above Corner Bar and selects the highest available tier below it. Neither appears when no Refill and no lower tier is possible.
- Joining moves focus to `Cancel`. While queued the carousel ignores Left and Right. Escape, anywhere on the screen, or `Cancel` leaves the queue, and focus returns to `Stake tiers`.
- On a phone a horizontal swipe moves one tier and snaps. A swipe of less than a quarter of a card returns to where it was.

**Shop.** Left and Right move between tabs, and the tab under focus is activated. `Enter` on an item opens its dialog. Opening an item, a pack or a tab counts as a new Shop action.

- **Item dialog.** `Buy for <price> <currency>` is shown only while the item is unowned. If the player's level is under the item's minimum, or they are short of funds, the button stays visible and disabled, and the matching sentence from Feedback states appears in `Shop notice` the moment the dialog opens. The level sentence wins when both apply. Closing the dialog clears that sentence. An owned item shows `Equip` in place of the buy button, and `Equip` is disabled while the item is equipped.
- **After a buy.** The dialog stays open and focus moves to `Equip`.
- **Compare.** The region shows the item's four stat rows, each with a bar and its text value, then the text `Equipped: <cue name>` and that cue's four rows.
- **Cash packs tab.** Every pack's name, Cash amount and price show as text for everyone. An eligible player gets `Buy <pack name>` on each pack. An under-18 player gets no buy button, no `Resend verification` and no route to `Buy Cash`, and the under-18 sentence shows in `Shop notice` when the tab opens. An unverified adult gets no buy button, and gets `Resend verification` and the unverified sentence in `Shop notice` when the tab opens.
- **Paying.** `Pay` disables both dialog buttons and shows `Confirming` in `Shop notice`, with the dialog still open. When the answer arrives, the dialog closes, focus returns to `Buy <pack name>`, and `Shop notice` shows the outcome. `Cancel` and Escape close the dialog before `Pay` with nothing charged. Escape does nothing while `Confirming` shows.

**Friends panel.** `Friends` and `Play with Friends` open it. `Close friends` or Escape closes it, and focus returns to the opener. Reversing during the slide runs back from the current position. Once closed it is hidden and inert, so nothing in it can be seen, focused or read at any viewport. The panel is not a modal: the rest of Home stays usable.

**Role menu.** Enter on `Change role for <name>` opens the menu with focus on its first item. Up and Down move, Enter applies, Escape closes, and focus returns to the opener in each case.

**Bracket.** `Bracket slots` reads slot 1 to slot 8, each `Slot <n>: <name>`, or `Slot <n>: Open`. Each listitem takes keyboard focus. `Ready` follows the list in Tab order.

**Contact Loupe.**
- On the player's turn, moving the pointer over the table or pressing an aim key opens the loupe at three times magnification on the predicted contact point.
- It shows the ghost-ball outline, the impact line, the tangent line at right angles to it, and the numeral and label.
- Lock aim closes the rim, draws the tangent line and freezes the numeral and aim: aim keys and sliders do nothing while it is locked.
- Unlocking, by `Lock aim` or `L`, reverses the line. Strike works with the loupe open, closed, locked or unlocked, and the loupe blocks nothing.
- The loupe does not open on the opponent's turn or in No Guidelines.

**Tutorial end.** After the third shot `Save your progress` opens. `Create account` opens the sign-up sheet. `Skip for now` goes to `/home`. Either way this browser is marked as having finished the tutorial.

### Visual design (DP-55, DP-64)

- **Colour.** The ground is a near-black blue-grey and the ink is a warm parchment white. The table cloth is a deep lamp-lit blue. There is one warm brass accent for rails, rulings and focus marks, and one burnt orange reserved for fouls and errors. Only the table is lit; every other surface sits near black. The Light theme inverts the ground to warm parchment and keeps the same brass and foul colours, with the table still lit. The Dark theme is the default look.
- **Type.** Headings and counters use Big Shoulders Display, a tall condensed scoreboard face. Body text uses IBM Plex Sans. Each heading step is about a third larger than the one below. All numerals use tabular figures so counters do not shift. Cut angles and win rates show one decimal.
- **Density.** Comfortable, with room around each counter.
- **Composition.** A single overhead lamp pool of light falls on the table at the centre. An edge-mounted scoreboard rail holds players, stake and clock. Every lobby surface is built from tall condensed scoreboard counters on the dark ground. All cloth, balls and cues are drawn by the app, with no photographs or copied assets.
- **Targets and contrast.** Every interactive control is at least 44 px in both directions at 375x812 and 768x1024. Text and controls meet WCAG 2.2 AA contrast in both themes. Focus marks are a brass outline clear of the control.

### Motion and effects (DP-08, DP-20, DP-31, DP-44, DP-59, DP-60, DP-61)

- **Loupe open.** The loupe grows from about six tenths of its size to full size in a little under a fifth of a second, settling softly with a fast start and a slow finish.
- **Aim lock.** The rim closes, and the tangent line draws from none of its length to all of it in about a third of a second, shown on `Tangent draw`. Unlocking during the draw runs the line back from its current length over a proportionate time, with no jump. Unlocking after it has finished draws it back from full length.
- **Sheets and panels.** The sign-up sheet rises and the Friends panel slides in, each in about a third of a second. Closing takes the same time. A newer open or close always wins; no timer left from an earlier close may re-hide what is open.
- **Tier carousel.** Moving one tier takes about a third of a second. A press in the other direction during travel reverses from the current position.
- **Result.** The Coin change and XP numbers count up over no more than one second.
- **Shots.** The canvas replays server results. On a scripted table balls jump to their resting places with no travel.
- **Press feedback.** Buttons give a brass press mark in about a tenth of a second.
- **No loops.** No unnamed decorative loop runs on any screen. The table is still between shots.
- **Reduced motion.** Under the device preference or the `Reduced motion` setting:
  - The loupe appears at full size with no growth.
  - `Tangent draw` goes to 100 at once.
  - Unlocking takes it to 0 at once.
  - Sheets and panels appear and disappear with no slide.
  - The carousel uses a plain crossfade of under a quarter of a second with no sideways travel and the same selected tier.
  - Numbers show final values at once.
  - Shots show their end state at once.
  - The same labels, receipts and verdicts appear.

### Feedback states (DP-01, DP-03, DP-05, DP-07, DP-11, DP-15, DP-18, DP-21, DP-22, DP-23, DP-24, DP-28, DP-30, DP-31, DP-32, DP-35, DP-37, DP-39, DP-40, DP-45, DP-46, DP-48, DP-50, DP-52, DP-53, DP-57, DP-58)

Placeholders: `<name>` is a display name; `<entry>` and `<pot>` are from the tier table; `<seconds>` is a whole number from the server; `<pocket>` is a radio name from `Called pocket`.

**Number format.** Every number of 1,000 or more shown on screen uses thousands commas, with no exceptions. This covers Coins, Cash, XP, entries, pots, prices, prizes, `<shortfall>`, record counts and ledger cells, for example `Short by 1,500 Coins`. Cut angles, win rates and dollar prices keep their published decimals. JSON numbers carry no commas.

**Rulings.** These can appear in both `Rule banner` and `Table announcements`, in both contexts.

| Event | Exact copy |
|---|---|
| Cue ball scratch | `Foul: cue ball scratched.` |
| Wrong first contact, 8-ball | `Foul: first contact was not your group.` |
| Wrong first contact, 9-Ball | `Foul: first contact was not the lowest ball.` |
| No contact | `Foul: cue ball hit nothing.` |
| No cushion after contact | `Foul: no ball reached a cushion after contact.` |
| Ball off table | `Foul: ball left the table.` |
| Shot clock expiry | `Foul: shot clock expired.` |
| Illegal break | `Illegal break: opponent gets ball in hand behind the head string.` |
| 8 on the break | `8 on the break: re-spotted, shooter continues.` |
| Group claimed | `<name> takes solids.` or `<name> takes stripes.` |
| Pot | `Ball <number> potted in <pocket>.` |
| Legal shot with nothing potted | `Legal shot: nothing potted.` |
| Called pocket needed | `Call a pocket before you shoot.` |

**Log-only lines.** These appear in `Table announcements` and never in `Rule banner`.

| Event | Exact copy |
|---|---|
| Ball in hand, after any foul or illegal break; `<name>` is the player who now holds the ball | `<name> has ball in hand.` |
| Practice thinking | `<opponent> is thinking` where `<opponent>` is the difficulty name |
| Practice turn done | `<opponent> finished its turn` |
| Zero-power release or strike | `No power. Shot cancelled.` |
| Escape during hold | `Shot cancelled.` |

**Log order for one shot.** Lines are posted once each, in this order, leaving out any that do not apply:
1. Each pot line, in `pocketed` order, or the legal-shot line when the shot was legal and nothing was potted.
2. The group claim.
3. The one foul, illegal-break or 8-on-the-break sentence.
4. The ball-in-hand line. An illegal break posts it too.
5. The called-pocket sentence, when the next shooter must call a pocket.
6. The new `Turn` text, if the turn changed, in each viewer's own words.
7. If the match ended, `Game over`, then the viewer's result line. A shot that ends the match posts no ball-in-hand line and no called-pocket sentence.

A foul on a break posts the illegal-break sentence and no foul sentence. A clock expiry follows the same order with no pot lines.

**Banner rule.** After a shot `Rule banner` and `ruleBanner` hold exactly one sentence, the first of these that the shot produced:
1. The viewer's result line, if the match ended.
2. The foul sentence.
3. The illegal-break sentence.
4. The 8-on-the-break sentence.
5. The called-pocket sentence.
6. The group claim.
7. The last pot line.
8. The legal-shot line.

The banner keeps its sentence until the next ruling, and is empty, with `ruleBanner` as `""`, until the first ruling of a table. A table that starts with a pocket to call opens with the called-pocket sentence in the banner. A Space press blocked by a missing called pocket puts that sentence in the banner and posts it to the log again. On the tutorial and on `Free table` the banner stays empty apart from any such sentence, and no opponent lines appear.

**Turn.** `Turn` shows exactly one of `Your turn`, `<name>'s turn`, `Ball in hand`, or `Game over`. The player holding the ball sees `Ball in hand`, and their opponent sees `<name>'s turn`. In practice, `<name>` is the difficulty name. On the tutorial and `Free table` it stays `Your turn`.

**Scoreboard.** Groups read `Solids`, `Stripes` or `Open`, and a 9-Ball table always reads `Open`. Next comes `<n> balls left`, or `1 ball left`, with the count defined by `ballsLeft` under API. The pot reads `Pot <pot>`, or `Pot Tournament` at a tournament table.

**Tutorial step.** `Step <n> of 3`, starting at `Step 1 of 3` and staying at `Step 3 of 3` after the last shot.

**Shot receipt.** `First ball <number>. Cut <angle>°.`, or `No first ball.` when nothing was struck.

**Loupe text.** The label is `Legal`, `Wrong group` or `Blocked`. The numeral is `Cut <angle>°` with one decimal, or `Cut --` when Blocked. The first ball appears as `First ball <number>` when one is predicted.

**Results.** The result line is shown in `Match result` and announced. In each row below the first column names the case, and `<name>` is the other player.

| Case | Winner sees | Loser sees |
|---|---|---|
| 8 in called pocket | `You won: 8 in the called pocket.` | `You lost: <name> potted the 8 in the called pocket.` |
| 8 early | `You won: <name> potted the 8 early.` | `You lost: 8 potted before your group was cleared.` |
| Uncalled pocket | `You won: <name> potted the 8 in an uncalled pocket.` | `You lost: 8 potted in an uncalled pocket.` |
| Scratch on the 8 | `You won: <name> scratched on the 8.` | `You lost: scratched on the 8.` |
| Foul on the 8 | `You won: <name> fouled on the 8.` | `You lost: foul on the 8.` |
| Forfeit | `You won: <name> forfeited.` | `You lost: forfeited after 3 timed-out turns.` |
| 9-Ball | `You won: 9 potted legally.` | `You lost: <name> potted the 9.` |

Void, shown to both: `Match voided: both entries returned.`

Coin change: `Pot won: <pot> Coins` for the winner, `Entry lost: <entry> Coins` for the loser, `Entry returned: <entry> Coins` on a void, `No Coins at stake` at a private or tournament table. XP gained: `+<xp> XP`. A level-up adds one line per level gained: `Level <level> reached: +5 Cash`. A rematch that cannot be funded shows the disabled `Rematch` with `Not enough Coins for a rematch.` After pressing `Rematch`: `Waiting for <name>.`

**Sign-up and sign-in.**

| Case | Copy |
|---|---|
| Under 13 | `Headstring is for players 13 and over.` |
| Under 18 note, in the sheet as soon as the year is entered | `Age under 18: tables are open, Cash packs are not.` |
| Pending | `Creating your account` |
| Email field | `Enter a valid email address.` |
| Password field | `Use at least 8 characters.` |
| Display name field | `Use 2 to 20 characters.` |
| Year field | `Enter a four-digit year.` |
| Email in use | `That email already has an account.` |
| Bad sign-in | `Email or password is wrong.` |
| Rate limit | `Too many tries. Wait a minute and try again.` |

**Home.**

| Case | Region | Copy |
|---|---|---|
| New player highlight on Play 1-on-1 | card | `First match` |
| Daily claimed | `Home notice` | `Daily reward claimed.` |
| Daily already claimed | `Home notice` | `Daily reward already claimed today.` |
| Refill added | `Home notice` | `Refill added.` |
| Refill used up | `Home notice` | `No Refills left today. Back after midnight UTC.` |
| Refill not needed | `Home notice` | `Refill is for balances under 100 Coins.` |
| No network, on each online mode card | card | `Offline` |
| Postgres outage | `Connection` | `Could not reach the table` |
| Stale marker after each chip value | chip | `Stale` |
| Mail delayed for this player | `Mail notice` | `Verification mail is delayed. Play on; we will retry.` |

**Profile ledger.** `Ledger` shows Coins and Cash lines together in one table, for the player's wallet account only, newest first with the latest write first on a tie, up to the newest 50 lines.

| Cell | Format | Example |
|---|---|---|
| `Date` | The line's UTC date as `YYYY-MM-DD` | `2026-10-30` |
| `Kind` | The line's `kind` with underscores turned to spaces and the first letter capitalised | `Match entry` |
| `Amount` | A `+` or `-` sign, the number, then `Coins` or `Cash` | `-100 Coins`, `+5 Cash` |
| `Balance after` | That currency's wallet balance after the line, then `Coins` or `Cash` | `900 Coins` |

**Play.**

| Case | Copy |
|---|---|
| Locked tier | `Reach level <min level>` |
| Unaffordable tier | `Short by <shortfall> Coins` |
| Queue searching | `Searching within <band> levels` |
| Left queue | `Left the queue. No Coins moved.` |
| Refused at queue for Coins | `Not enough Coins for this table.` |
| Locked mode, on `No Guidelines` | `Unlocks at level 5` |
| Second device | `You're in a match on another device` |
| Late shot | `Too late. The shot clock ran out.` |
| Dropped player | `<name> dropped: <seconds>s to reconnect` |
| Table not yours | `This table is private to its players.` |
| Table unknown | `Table not found` |
| Page not found heading | `Nothing on this table` |
| Practice resume | `Resume your unfinished rack?` |

The second-device, not-yours and unknown-table sentences each show as the main heading at the table address, in place of the table and its controls.

**Shop.**

| Case | Copy |
|---|---|
| Item bought | `Bought <item name>.` |
| Equipped | `Equipped <item name>.` |
| Owned or equipped mark | `Owned`, `Equipped` |
| Short of funds | `You need <shortfall> more <currency>.` |
| Level locked | `Reach level <min level> to buy this.` |
| Compare rows, always all four, including zero | `Aim +<n>%`, `Power +<n>%`, `Spin +<n>%`, `Time +<n> s` |
| Pending payment | `Confirming` |
| Pack confirmed, receipt `sent`; `<cash>` is the pack's Cash amount | `Cash added: <cash> Cash. Receipt sent to <email>.` |
| Pack confirmed, receipt `delayed` | `Cash added: <cash> Cash. Receipt delayed. Your Cash is safe.` |
| Payment down | `Payments are down. You have not been charged.` |
| Under 18 | `Players under 18 cannot buy Cash.` |
| Unverified | `Verify your email to buy Cash.` |
| Resent | `Verification email sent to <email>.` |
| Mail down on resend | `Could not send mail. Try again soon.` |

The payment-down message appears in `Shop notice`. A repaint of the Shop never removes it; it stays until the next Shop action. All Shop copy is announced politely through `Shop notice`.

**Verification page.** Heading `Email verified`; invalid or used token: `This link is no longer valid.`

**Friends.**

| Case | Copy |
|---|---|
| Request sent | `Request sent to <name>.` |
| Accepted | `<name> is now your friend.` |
| Unknown code | `No player has that code.` |
| Blocked | `You can't add this player.` |
| Presence | `Online`, `In a match`, `Offline` |
| Invite expired, as the page heading and on a table left waiting | `Expired` |
| Host waiting | `Waiting for your friend` |
| Logged-out invite note | `Sign up to join the table` |

**Clubs and leaderboards.**

| Case | Copy |
|---|---|
| Joined | `Joined <club name>.` |
| Requested | `Request sent to <club name>.` |
| Left | `Left <club name>.` |
| Full | `Club is full` |
| Owner leaving | `Owners must hand over the club before leaving.` |
| Role changed | `<name> is now <role>.` where `<role>` is `owner`, `officer` or `member` |
| Create refused, level | `Reach level 5 to create a club.` |
| Create refused, Coins | `You need 5,000 Coins to create a club.` |
| Own rank | `#<rank> <name> <wins> wins` |
| Own rank with no wins | `Unranked` |
| Friends scope empty | `No friends on the board yet.` |
| Club scope empty | `Join a club to see this board.` |
| Preset messages | `Good luck`, `Nice shot`, `Well played`, `Back soon`, `Ready to play?` |

**Tournaments.**

| Case | Copy |
|---|---|
| Entrant count | `<n> of 8 entered` |
| Registered | `Registered. <entry> Coins moved to the bracket.` |
| Bracket drawn, in the log | `Bracket drawn. Ready check started.` |
| Ready check | `Ready check: <seconds>s left` |
| Ready pressed | `You are ready.` |
| All ready, in the log | `All players ready.` |
| Window ended short | `Not enough players. Your <entry> Coins are back.` |
| Ready check missed | `Ready check missed. Your <entry> Coins are back.` |
| Refused, bracket full | `Bracket is full` |

Every pending async action disables its control and shows its pending copy where one is listed; other actions show their result within two seconds. Each notice is the newest action's result; a timer or repaint never replaces it with an older state.

## Backend

### API (DP-09, DP-22, DP-27, DP-32, DP-41, DP-54, DP-62, DP-63)

All bodies are `application/json`. Field names are camelCase. Every error is `{"error":"<code>","message":"<sentence>"}`. A 422 has the code `validation_failed`, the message `Check these fields` and adds `"errors":{"<field>":"<sentence>"}`. Where a sentence exists in Feedback states, `message` carries it.

**Error precedence, for the whole API:** body problems (400, 413, 415), then 401 `unauthenticated`, then 404 `not_found` for an unknown resource, then 403, then 409 state conflicts, then 422 validation. An idempotent replay returns its stored response before any state check. A route that needs an unreachable dependency answers its 503 after the 401 check, or in place of it when the session cannot be read.

**Session**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| POST `/api/auth/signup` | `{"email":"a@example.test","password":"chalk-and-rail","displayName":"Mara","birthYear":1994}` | 201 `<session body>`, sets the cookie | 403 `under_age`; 409 `email_taken`; 422 |
| POST `/api/auth/signin` | `{"email":"a@example.test","password":"chalk-and-rail"}` | 200 `<session body>`, sets the cookie | 401 `invalid_credentials`; 429 `rate_limited` with `Retry-After` in seconds |
| POST `/api/auth/signout` | none | 204 | |
| POST `/api/auth/resend-verification` | none | 202 `{"status":"sent"}` | 409 `already_verified`; 503 `mail_unavailable` |
| POST `/api/auth/verify` | `{"token":"..."}` | 200 `{"emailVerified":true}` | 410 `link_invalid` |

`<session body>` is `{"id":"...","email":"...","displayName":"...","level":1,"xp":0,"coins":1000,"cash":0,"emailVerified":false,"minor":false}`. The cookie is `hs_session`, `HttpOnly`, `SameSite=Lax`, `Path=/`, without `Secure`, because grading runs over plain HTTP.

**Player and wallet**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| GET `/api/me` | | 200: session body fields plus `xpToNext`, `wins`, `losses`, `winRate` (one decimal), `winStreak`, `highestPot`, `equippedCueId`, `equippedClothId`, `dailyRewardClaimed`, `refillsLeft`, `mailDelayed`, `activeTableUrl`, `friendCode`, `settings` | |
| PATCH `/api/me/settings` | any of `{"sound":true,"music":true,"aimSensitivity":5,"leftHanded":false,"reducedMotion":false,"theme":"dark"}` | 200 the full `settings` | 422 |
| DELETE `/api/me` | `{"password":"..."}` | 204, clears the cookie | 403 `invalid_credentials`; 409 `in_match` |
| POST `/api/wallet/daily-reward` | none | 200 `{"coins":<balance>}` | 409 `daily_claimed` |
| POST `/api/wallet/refill` | none | 200 `{"coins":<balance>,"refillsLeft":<n>}` | 409 `refill_limit`; 409 `refill_not_needed` |
| GET `/api/wallet/ledger?currency=coins` | `currency` is `coins` or `cash` | 200 `{"balance":<n>,"lines":[{"id":"...","pairId":"...","playerId":"...","currency":"coins","account":"wallet","amount":-100,"kind":"match_entry","refId":"...","createdAt":"<ISO 8601>"}]}`, the player's wallet lines newest first | 422 |

`account` is `wallet`, `escrow`, `house` or `system`. `playerId` is null on every line that is not a wallet line.

**Play**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| POST `/api/queue` | `{"mode":"eight-ball","tier":1}` | 201 `{"ticketId":"...","status":"queued"}` | 403 `level_locked`; 403 `mode_locked`; 409 `insufficient_coins`; 409 `already_queued`; 409 `in_match`; 422 |
| GET `/api/queue` | | 200 `{"status":"queued","band":3}`, or `{"status":"paired","tableUrl":"/table/<id>"}`, or `{"status":"none"}` | |
| DELETE `/api/queue` | | 200 `{"status":"cancelled"}` | 409 `already_paired`; 409 `not_queued` |
| GET `/api/tables/{id}` | | 200 `<table body>` | 403 `not_seated` |
| POST `/api/tables/{id}/shots` | `{"aimDegrees":12.5,"power":60,"sideSpin":0,"topSpin":0,"calledPocket":null}` | 200 `<table body>` | 403 `not_seated`; 409 `other_device`; 409 `not_your_turn`; 409 `shot_clock_expired`; 409 `called_pocket_required`; 409 `match_over`; 409 `script_exhausted`; 422 |
| POST `/api/tables/{id}/place` | `{"across":50,"along":25}` | 200 `<table body>` | 403 `not_seated`; 409 `other_device`; 409 `not_your_turn`; 409 `no_ball_in_hand`; 409 `cue_ball_overlap`; 422 |
| POST `/api/tables/{id}/rematch` | none | 202 `{"status":"waiting"}`, or 201 `{"tableUrl":"/table/<id>"}` when both have asked | 403 `not_seated`; 409 `insufficient_coins`; 409 `match_not_over` |
| GET `/api/matches/{id}/ledger` | `id` is the table id | 200 `{"lines":[...]}`, every line of the match for all accounts, in the shape above | 403 `not_seated` |

`other_device` comes before the route's other 409s. `<table body>` is, with the example's solids and stripes each holding one ball:

```json
{"id":"...","mode":"eight-ball","tier":1,"status":"in_play",
 "seats":[{"seat":1,"playerId":"...","displayName":"...","group":"solids","ballsLeft":1,"connected":true},
          {"seat":2,"playerId":"...","displayName":"...","group":"stripes","ballsLeft":1,"connected":true}],
 "activeSeat":1,"ballInHand":false,"calledPocketRequired":false,
 "shotClockSeconds":27,"reconnectSeconds":null,"pot":180,"seatedHere":true,
 "ruleBanner":"...","balls":[3,8,9],"result":null}
```

- `group` is `solids`, `stripes` or `null`.
- `ballsLeft` depends on the table. With a group, in `eight-ball` and `no-guidelines`, it is the number of that group's balls on the table, never counting the 8, and is 0 once the group is cleared. On a break or open table, both seats show the number of object balls on the table other than the 8. In `nine-ball`, `group` is always `null` and both seats show the number of object balls on the table, counting the 9.
- `seatedHere` is true when this session is the player's seated session.
- `ruleBanner` is the viewer's `Rule banner` text.
- `result`, for a viewer once the match ended, is `{"line":"...","coinChange":"...","xpGained":60,"levelUps":[],"coins":<balance>}`.
- Any field in a shot or placement body other than those shown is refused with 422 naming that field, for example `"errors":{"balls":"Not accepted."}`.

`mode` is `eight-ball`, `nine-ball` or `no-guidelines`. `<pocket>` values in the API are `top-left`, `top-right`, `middle-left`, `middle-right`, `bottom-left`, `bottom-right`. The top pockets are at the foot end.

**Shop**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| GET `/api/shop` | | 200 `{"items":[{"id":"...","kind":"cue","name":"...","currency":"coins","price":400,"minLevel":1,"aim":5,"power":2,"spin":0,"time":0,"owned":false,"equipped":false}],"packs":[{"id":"...","name":"...","cash":50,"priceUsd":"0.99"}]}` | |
| POST `/api/shop/items/{id}/buy` | none | 201 `{"coins":<n>,"cash":<n>}` | 403 `level_locked`; 409 `already_owned`; 409 `insufficient_funds` |
| POST `/api/shop/items/{id}/equip` | none | 200 `{"equippedCueId":"...","equippedClothId":"..."}` | 409 `not_owned` |
| POST `/api/shop/cash-packs/{id}/purchase` | none; header `Idempotency-Key`, 1 to 64 characters | 201 `{"purchaseId":"...","status":"confirmed","cash":<balance>,"paymentId":"<Kill Bill id>","receipt":"sent"}`, where `receipt` is `sent` or `delayed` | 403 `age_restricted`; 403 `email_unverified`; 409 `idempotency_conflict`; 422 for a missing key; 503 `payments_unavailable` |

**Friends and invites**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| GET `/api/friends` | | 200 `{"friendCode":"...","friends":[{"id":"...","displayName":"...","presence":"online"}],"incoming":[{"requestId":"...","id":"...","displayName":"..."}],"outgoing":[...],"blocked":[...]}` | |
| POST `/api/friends/requests` | `{"code":"..."}` | 201 `{"requestId":"..."}` | 404 `unknown_code`; 403 `blocked`; 409 `already_friends`; 409 `request_pending`; 422 for one's own code |
| POST `/api/friends/requests/{id}/accept` | none | 200 `{"status":"accepted"}` | 403 |
| POST `/api/friends/requests/{id}/decline` | none | 204 | 403 |
| POST `/api/friends/{playerId}/block` | none | 204 | |
| DELETE `/api/friends/{playerId}/block` | none | 204 | |
| POST `/api/private-tables` | none | 201 `{"tableId":"...","tableUrl":"/table/<id>","inviteUrl":"<origin>/invite/<token>"}` | 409 `in_match` |
| GET `/api/invites/{token}` | no session needed | 200 `{"status":"open","hostName":"..."}` | 410 `invite_expired` |
| POST `/api/invites/{token}/accept` | none | 200 `{"tableUrl":"/table/<id>"}` | 410 `invite_expired`; 409 `table_full`; 409 `in_match` |

`presence` is `online`, `in_match` or `offline`.

**Clubs and leaderboards**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| GET `/api/clubs` | | 200 `{"clubs":[{"id":"...","name":"...","joinPolicy":"open","memberCount":3,"weeklyScore":101}]}` | |
| POST `/api/clubs` | `{"name":"...","joinPolicy":"open"}` | 201 `<club body>` | 403 `level_locked`; 409 `insufficient_coins`; 409 `already_in_club`; 409 `name_taken`; 422 for a name outside 3 to 24 characters |
| GET `/api/clubs/{id}` | | 200 `<club body>`: list fields plus `members` as `[{"playerId":"...","displayName":"...","role":"owner","weeklyWins":0}]`, `requests`, and `messages` | |
| POST `/api/clubs/{id}/join` | none | 200 `{"status":"member"}` or 202 `{"status":"requested"}` | 409 `club_full`; 409 `already_in_club` |
| POST `/api/clubs/{id}/leave` | none | 204 | 409 `owner_must_transfer`; 409 `not_a_member` |
| POST `/api/clubs/{id}/requests/{playerId}` | `{"decision":"approve"}` or `{"decision":"reject"}` | 200 `{"status":"member"}` or `{"status":"rejected"}` | 403; 409 `club_full`; 422 |
| PATCH `/api/clubs/{id}/members/{playerId}` | `{"role":"officer"}` | 200 `<club body>` | 403; 422 |
| POST `/api/clubs/{id}/messages` | `{"preset":"Nice shot"}` | 201 `{"messageId":"..."}` | 403; 422 for any other text |
| GET `/api/leaderboards?scope=global` | `scope` is `global`, `friends` or `club` | 200 `{"rows":[{"rank":1,"playerId":"...","displayName":"...","wins":41}],"own":{"rank":12,"wins":3}}`; `own.rank` is null with no wins | 422 |

**Tournaments**

| Method and path | Request | Success | Own errors |
|---|---|---|---|
| GET `/api/tournaments` | | 200 `{"tournaments":[<tournament body>]}`, one open bracket per tier | |
| GET `/api/tournaments/{id}` | | 200 `<tournament body>` | |
| POST `/api/tournaments/{id}/register` | none | 201 `<tournament body>` | 403 `level_locked`; 409 `tournament_full`; 409 `already_registered`; 409 `tournament_closed`; 409 `insufficient_coins`; 409 `in_match` |
| POST `/api/tournaments/{id}/ready` | none | 200 `<tournament body>` | 403 `not_entered`; 409 `not_in_ready_check` |

`<tournament body>` is `{"id":"...","tier":1,"tierName":"Corner Bar","status":"open","entry":100,"entrantCount":1,"entrants":[{"slot":null,"playerId":"...","displayName":"...","ready":false}],"prizes":{"first":400,"second":160,"semiFinal":80,"house":80},"windowSecondsLeft":287,"readySecondsLeft":null}`. `slot` is null until the bracket is drawn, and `windowSecondsLeft` is null with no entrants.

**Grading routes.** They exist only when the environment variable `GRADING_KEY` is set. Every call carries the header `X-Grading-Key`. A missing or wrong header, or an unset variable, answers 404 `not_found`. The key is `longrail-grading-7f3c`.

- `POST /api/grading/players` with `{"email":"p1@example.test","password":"chalk-and-rail","displayName":"Pat One","birthYear":1990,"level":3,"xp":0,"coins":1000,"cash":0,"emailVerified":true}`, and optional `"weeklyWins":0`, answers 201 `{"id":"..."}`. It writes the opening balance as ledger lines, gives the Starter Cue, and writes no mail.
- `PATCH /api/grading/players/{id}` with `{"coins":50}` and/or `{"cash":0}` sets the balance by one `grading_adjustment` pair for the difference and reaches open pages like any balance change. It answers 200 `{"coins":<n>,"cash":<n>}`.
- `POST /api/grading/tables` answers 201 `{"tableId":"...","tableUrl":"/table/<id>"}`, or 409 `insufficient_coins`. A complete literal example:

```json
{"mode":"eight-ball","tier":1,"players":["<player id seat 1>","<player id seat 2>"],
 "activeSeat":1,"phase":"groups","groups":{"1":"solids","2":"stripes"},
 "balls":[3,8,9,10],
 "script":[
  {"firstContact":3,"pocketed":[{"ball":3,"pocket":"top-left"}],"cushion":true,"scratch":false,"offTable":[]},
  {"firstContact":8,"pocketed":[{"ball":8,"pocket":"bottom-right"}],"cushion":true,"scratch":false,"offTable":[]}]}
```

`phase` is `break`, `open` or `groups`; `groups` is `null` unless `phase` is `groups`. `balls` lists the object balls on the table. `offTable` lists ball numbers, with 0 for the cue ball. `firstContact` is a ball number or `null`. On a break `cushion` means the break's cushion requirement was met. The route moves both entries to escrow exactly as a normal match does and ignores tier level minimums. Each shot taken through the normal controls above 0% power consumes the next script entry instead of the simulation. Balls jump to rest with no travel, and the rules engine decides everything else: fouls, groups, turns, wins, settlement, ledger, XP. Script entries are not checked for physical sense.

### Business rules (DP-09, DP-11, DP-14, DP-18, DP-21, DP-22, DP-23, DP-24, DP-25, DP-27, DP-28, DP-29, DP-30, DP-31, DP-32, DP-33, DP-35, DP-37, DP-39, DP-41, DP-43, DP-45, DP-46, DP-48, DP-50, DP-51, DP-53, DP-54, DP-62)

**Accounts.** Email and password only.
- Age is the current UTC year minus `birthYear`. Under 13: 403, no account and nothing stored. Under 18: `minor` is true; the player may play and may not buy Cash.
- A new account gets the sign-up grant of 1,000 Coins and the Starter Cue.
- `Password` is at least 8 and at most 72 characters; `displayName` is 2 to 20 characters; `birthYear` is 1900 to the current year.
- Sign-up never waits on mail.
- After 5 failed sign-ins for one email within 60 seconds, every further attempt in that window, correct or not, answers 429. The window starts at the first failure.
- A session lasts until sign-out.
- Deleting an account is refused during a live match, tournament or queue. It ends the session, leaves ledger lines with the player's name removed, and hands a club to its longest-standing member, or closes the club if the player was alone.

**Wallet.** Two currencies that never mix. Coins go on tables; Cash comes from packs and level-ups and buys looks alone.
- Each movement of value writes exactly two ledger lines in one currency, sharing a `pairId`, whose amounts sum to zero. Nothing edits an earlier line.
- Every pair has one of the shapes below. All but the two `house_cut` shapes have the player's `wallet` account on one side. A `house_cut` pair runs from `escrow` to `house`, with no wallet side.

| Movement | Negative line | Positive line | `kind` |
|---|---|---|---|
| Match entry, once per player | `wallet`, entry | `escrow`, entry | `match_entry` |
| Match win | `escrow`, pot | winner's `wallet`, pot | `match_win` |
| Match cut | `escrow`, both entries less the pot | `house`, the same | `house_cut` |
| Match void, once per player | `escrow`, entry | `wallet`, entry | `match_refund` |
| Tournament entry | `wallet`, entry | `escrow`, entry | `tournament_entry` |
| Tournament prize, once per prize | `escrow`, prize | `wallet`, prize | `tournament_prize` |
| Tournament cut | `escrow`, the house share | `house`, the same | `house_cut` |
| Tournament refund, once per entrant | `escrow`, entry | `wallet`, entry | `tournament_refund` |
| Credit | `system` | `wallet` | `grant`, `opening_balance`, `daily_reward`, `refill`, `level_reward`, `cash_purchase`, or a raising `grading_adjustment` |
| Spend | `wallet` | `system` | `cue_purchase` for Coin cues, `item_purchase` for Cash items, `club_fee`, or a lowering `grading_adjustment` |

For example, a settled Corner Bar match writes `wallet -100`, `escrow +100` for each player, then `escrow -180`, winner's `wallet +180`, then `escrow -20`, `house +20`.

- A wallet balance always equals the sum of that wallet's lines, in Coins and Cash separately.
- Value passes from one player to another only through a settled match or tournament, and nothing can be withdrawn or converted.
- Daily reward: one claim of 100 Coins each UTC day.
- Refill: a player holding under 100 Coins may add 500, at most 3 times each UTC day.
- Simultaneous claims of the same reward succeed exactly once. The loser gets the matching 409.

**Tiers.**

| Tier | Name | Min level | Entry | Pot |
|---|---|---|---|---|
| 1 | Corner Bar | 1 | 100 | 180 |
| 2 | Back Room | 3 | 500 | 900 |
| 3 | Downtown | 7 | 2,500 | 4,500 |
| 4 | Velvet Room | 12 | 10,000 | 18,000 |
| 5 | The Penthouse | 20 | 50,000 | 90,000 |

The pot is both entries less the 10 percent house cut.

**Progression.** Leaving level L costs L raised to the power 1.5, multiplied by 100, then rounded to the nearest 10 XP.

| Level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| XP to next | 100 | 280 | 520 | 800 | 1,120 | 1,470 | 1,850 | 2,260 |

`xp` is progress into the current level and carries over on level-up. XP for a match is the tier number times 60 for the winner and times 20 for the loser. Every level gained adds 5 Cash. `winRate` is wins over wins plus losses, as a percentage to one decimal, and 0.0 with no matches. `winStreak` resets on a loss. `highestPot` is the largest pot won. Settlement updates Coins, XP, level, record and ledger in one transaction, so the result dialog, Home, Profile and `GET /api/me` all come from that one settled match, before and after reload. Forfeits count as a win and a loss. A void and a private table count for nothing. A tournament match counts toward XP and record at its tier and has no pot.

**Match states.** `queued -> paired -> escrowed -> in_play -> settled | forfeited | voided`.
- A ticket is `queued` until a partner fits.
- Pairing and the move to escrow happen together once both players are confirmed to hold the entry. If one no longer does, their ticket ends with the Coins refusal copy and the other stays queued.
- `DELETE /api/queue` on `queued` debits nothing. Afterwards it is 409 `already_paired`.
- A shot is accepted only in `in_play`. After that it is 409 `match_over`.
- Each match's escrow ends exactly once, as a settlement or a void refund.
- Settlement writes the match win and match cut pairs, so both entries less the 10 percent cut equal the winner's credit and escrow for the match ends at zero.

**Matchmaking.** Players match in the same mode and tier when their level difference is at most the band. The band starts at 3 and widens by 3 every 10 seconds, based on the longer-waiting ticket. Among fits, the longest-waiting ticket pairs first. The first-queued player takes seat 1 and breaks. Bots never appear at stake tables. Pairing happens within 3 seconds of two fitting tickets existing, and both pages move to `/table/<table id>` with no reload. A player has one queue ticket and one live match at a time. Reloading that address shows the same table.

**Seated session and second device.** A device is a session. Each seat has one seated session, and all its tabs work.
- At a stake table the seated session is the one that queued. At a private table it is the session that created the table or accepted the invite.
- A grading table and a tournament table are created with no session, so the first session of that player to open the table page or call a table route takes the seat.
- Another session of a seated player gets 200 from `GET /api/tables/{id}` with `seatedHere` false, sees the second-device copy and no controls, and any shot or placement from it is 409 `other_device` carrying that sentence.
- If the seated session is dropped, the next session of that player to open the table takes the seat and rejoins the current state.
- A session of anyone else gets 403 `not_seated`.

**Table scale and ball in hand.** `across` runs from 0 at the left cushion to 100 at the right cushion, and `along` from 0 at the head-end cushion to 100 at the foot-end cushion. The head string is at `along` 25. The default spot is `across` 50, `along` 25, and a shot taken with ball in hand and no placement goes from there. After an illegal break a placement must have `along` at 25 or below, and 25 itself is allowed. A higher value is 422 with `"errors":{"along":"Place the ball behind the head string."}`, and the ball stays in hand. After any other foul every value from 0 to 100 is allowed.

**8-ball rules.**
- **Break.** A break is legal when it drops at least one ball or drives four or more object balls into the rails. If it does neither, or fouls in any way, the opponent takes the table and has ball in hand, limited to the area behind the head string, and the ruling is the illegal-break sentence. A legal break that pockets a ball keeps the turn. The table stays open after the break whatever was potted.
- **8 on the break.** The 8 returns to its spot and the same player shoots again, unless the same shot fouled, which is an illegal break with the 8 re-spotted.
- **Open table.** Any ball except the 8 may be hit first. The first legal pot claims that ball's group: 1 to 7 solids, 9 to 15 stripes. If both groups fall on the claiming shot, the first entry in `pocketed` decides.
- **Legal shot.** The shooter's own group is hit first, or the 8 once the group is cleared. Then a ball is pocketed or any ball reaches a cushion.
- **Turn.** A legal shot that pockets one of the shooter's balls keeps the turn. Anything else passes it. Opponent balls potted stay down.
- **Fouls.** There are six: a scratch, a wrong first ball, no ball struck, nothing reaching a cushion after contact, any ball leaving the table, and the clock running out. After each one the opponent may place the cue ball wherever they like, with ball in hand. An object ball off the table is re-spotted. When several fouls occur on one shot, the ruling names the first in this order: scratch, off table, no contact, wrong first contact, no cushion.
- **Called pocket.** When the shooter's group is cleared, a shot without `calledPocket` is 409 `called_pocket_required`.
- **Win.** With the group cleared, the shooter sinks the 8 legally in the pocket they called.
- **Loss.** Pot the 8 before the group is cleared, in an uncalled pocket, while scratching, or on a shot that otherwise fouls. Reasons are decided in this order: scratch on the 8, foul on the 8, 8 early, uncalled pocket.

**9-Ball.** The lowest ball on the table must be hit first; anything else is the 9-Ball wrong-contact foul. Any ball potted on a legal shot keeps the turn. Potting the 9 on a legal shot wins at any time. A 9 potted on a foul is re-spotted, and the other fouls and ball in hand apply. No group, no called pocket.

**No Guidelines.** Normal 8-ball rules with no aim path line and no Contact Loupe. It unlocks at level 5; under that, 403 `mode_locked`. 9-Ball has no unlock level. Special modes use the same tier picker and rewards.

**Shot clock and reconnect.** The device clock may be wrong: every remaining time on screen is the server's, sent at least once a second, and the browser never computes it from its own clock.
- The shot clock is `SHOT_CLOCK_SECONDS`, default 30 seconds, plus the Time stat of the shooter's cue, per turn. Expiry is a foul that passes the turn with ball in hand.
- A shot arriving after expiry, from the player whose turn just expired, is 409 `shot_clock_expired`, whatever the browser's countdown shows, until the next shot is taken. After that it is 409 `not_your_turn`.
- A player counts as dropped within 5 seconds of their last table connection ending. Reloading or reconnecting rejoins the current state.
- The reconnect grace is `RECONNECT_GRACE_SECONDS`, default 30 seconds, and `reconnectSeconds` shows the server's remaining value. The shot clock keeps running throughout.
- After 3 consecutive timed-out turns of one player that player forfeits, connected or not. Any shot by that player resets their count.
- If both players are dropped and both graces run out, the server voids the match and returns each entry. Grace running out for one player ends nothing by itself.

**Cues and stats.** No bonus goes past 25% for Aim, 10% for Power, 15% for Spin or 3 seconds for Time. A cue is owned once; a second buy is 409 `already_owned`, and two simultaneous buys give one 201. Cash cues carry no bonus in any stat. Stats are fixed when a match leaves `paired`, so equipping mid-match changes nothing until the player's next match. Aim lengthens the aim guideline, Power raises maximum strike speed, Spin raises maximum spin, Time extends the shot clock.

**Cash packs.** Requires `minor` false and a verified email, in that order.
- A purchase is confirmed only when Kill Bill returns a successful PURCHASE payment. Cash is credited only then, and the player sees `Confirming` until the response arrives. No hosted checkout, no card details and no webhooks are used.
- The first success answers 201. Repeating the same `Idempotency-Key` for the same player and pack answers 200 with the identical body, credits nothing and makes no new payment. A simultaneous duplicate waits for the first and then replays.
- The same key with a different pack is 409 `idempotency_conflict`.
- A request that failed with 503 stores nothing, so the same key may be retried.

**Email verification.** Sign-up sends one verification mail. A link works once and does not expire. A resend makes a new link and voids the old one. Play never depends on it; only buying Cash does.

**Friends and presence.** Each player has one 8-character uppercase `friendCode`. Requests go by code or by the link `/friends/add/<friend code>`. Blocking removes any friendship and pending requests and stops new ones either way. Presence reaches open panels within 5 seconds.

**Private tables.** Zero stake, 8-ball, no Coins, XP or stats. The host lands on the table and waits. The invite lives for `INVITE_TTL_SECONDS`, default 900 seconds, and the invitee takes seat 2 when they accept. After expiry the link answers 410 and shows the expiry word, and a table still waiting ends. A logged-out person sees the sheet on the invite page and, after signing up or signing in, lands on `/table/<table id>`. Reloading shows the same table. Shot clock, fouls and reconnect work as at stake tables, and a void or forfeit moves no value.

**Tournaments.** `open -> full -> ready_check -> round_of_8 -> semi_finals -> final -> paid | refunded`.
- One open bracket exists at every tier at all times. A new bracket opens as soon as one fills or refunds.
- The window is `TOURNAMENT_WINDOW_SECONDS`, default 300 seconds, and starts at the first entrant. An empty bracket has no window.
- Registering moves the entry to escrow as ledger lines and requires the tier's minimum level.
- Exactly 8 can register. When simultaneous requests compete for the last seat, one wins and the rest get 409 `tournament_full`.
- There is no withdrawal after registering.
- The eighth entrant draws random slots and starts the ready check of `READY_CHECK_SECONDS`, default 30 seconds.
- Fewer than 8 at the window's end, or any entrant not ready at the check's end: every entry is refunded by ledger lines and the state is `refunded`.
- All ready: the state moves to `round_of_8`, with slots 1 and 2, 3 and 4, 5 and 6, 7 and 8 at tables on the published address. A forfeit advances the opponent. A void advances the lower slot number.
- Tournament matches take no entry and pay no pot; the bracket's escrow pays the prizes and the house share once when the final ends, leaving that escrow at zero.

| Tier | Pool | First (50%) | Second (20%) | Each semi-final loser (10%) | House (10%) |
|---|---|---|---|---|---|
| Corner Bar | 800 | 400 | 160 | 80 | 80 |
| Back Room | 4,000 | 2,000 | 800 | 400 | 400 |
| Downtown | 20,000 | 10,000 | 4,000 | 2,000 | 2,000 |
| Velvet Room | 80,000 | 40,000 | 16,000 | 8,000 | 8,000 |
| The Penthouse | 400,000 | 200,000 | 80,000 | 40,000 | 40,000 |

**Clubs.**
- Creating needs level 5 and 5,000 Coins, paid as a ledger line.
- Capacity is 50, and the limit itself is allowed. A join or approval at 50 is 409 `club_full`, and one of two simultaneous claims of the last seat wins.
- A player is in at most one club.
- Roles are `owner`, `officer`, `member`. Only the owner changes roles, and making someone owner makes the old owner an officer. Owner and officers decide join requests.
- The owner cannot leave while others remain: 409 `owner_must_transfer`. An owner alone may leave, which closes the club.
- Messages are presets only.
- `weeklyScore` is the sum of current members' weekly wins, updated when a match settles and when the roster changes.

**Leaderboards.** Weekly wins at stake tables, resetting Monday 00:00 UTC, scoped global, friends and club, ties ordered by earlier last win and then display name. Players with zero wins are not listed.

**Practice.** Runs entirely in the browser, with no server call, and earns no Coins, XP or stats.
- The AI breaks every rack, and every AI turn ends within 20 seconds with `Your turn` in `Turn`, or `Ball in hand` after an AI foul.
- Each AI shot shows the thinking copy, for one to two seconds. An AI turn takes at most 3 shots.
- Practice has no shot clock and uses the same 8-ball rules and rulings.
- `Free table` has no opponent; `Turn` stays `Your turn`.
- An unfinished rack is saved in the browser after each completed turn, and `/practice` offers it through `Unfinished rack`.

**Tutorial.** Three shots with no opponent and no rules beyond the loupe label, playing solids. Any shot above 0% power moves `Tutorial step` to the next step when the balls stop.

**Contact Loupe.** The label uses the first ball on the aim line: `Legal` if the shooter may hit it first, `Wrong group` if not, `Blocked` if the aim line reaches a cushion before any ball. The cut angle is the angle between the cue ball's travel and the line of centres at contact, to 0.1 degree.

### Services (DP-37, DP-40, DP-41, DP-57, DP-58)

**Postgres.** System of record for accounts, sessions, ledger lines, escrow, matches, shots, brackets, friends and clubs. Transactions decide every settlement. When it is unreachable, every route needing it answers 503 `{"error":"store_unavailable","message":"Could not reach the table"}`. Home then stays on `/home`, shows that sentence in `Connection` with `Retry`, and shows the last values this browser saw in the chips, each followed by the stale marker, or only the marker if it has none. Sign-in and sign-up show the same sentence in the sheet. `Retry` calls `GET /api/me` again and removes the bar on success. The tutorial and practice keep working.

**Kill Bill.** Each player has one account, created at their first purchase, with `externalKey` equal to the player's id and `email` set. Its default payment method uses the built-in `__EXTERNAL_PAYMENT__` plugin. Each pack is one PURCHASE payment on that account, for the pack's price in USD. When Kill Bill is unreachable, or does not answer within 5 seconds, the purchase answers 503 `{"error":"payments_unavailable","message":"Payments are down. You have not been charged."}`, nothing is credited, and every other Shop action keeps working.

**Mailpit.** Mail goes through `SMTP_HOST` and `SMTP_PORT`, From the value of `MAIL_FROM`, which is `Long Rail <no-reply@longrail.example>`. Only two messages exist.

| Mail | To | Subject | Body contains |
|---|---|---|---|
| Verification | the player's email | `Verify your Long Rail email` | The link `<public origin>/verify?token=<token>` |
| Receipt | the player's email | `Your Long Rail receipt` | Pack name, Cash amount, price in dollars, Kill Bill payment id |

`<public origin>` is `APP_PUBLIC_URL`, or the request's own origin when that is unset; invite links use the same value. `receipt` is `sent` only once the mail server has accepted the message. When mail is unreachable, sign-up still answers 201 with `mailDelayed` true on `GET /api/me`. A purchase still credits and answers 201 with `"receipt":"delayed"`. A resend answers 503 `{"error":"mail_unavailable","message":"Could not send mail. Try again soon."}`. Undelivered mail is stored in Postgres and retried every 30 seconds while the server runs, and `mailDelayed` clears on delivery.

### Seed data (DP-18, DP-33, DP-35, DP-46, DP-49, DP-60)

Every seeded person and club is invented. The seed is applied idempotently on serve. Seeded players cannot sign in. Their weekly wins are constants that never reset.

**Coin cues**, `currency` coins:

| Id | Name | Price | Min level | Aim | Power | Spin | Time |
|---|---|---|---|---|---|---|---|
| `cue-starter` | Starter Cue | 0 | 1 | 0 | 0 | 0 | 0 |
| `cue-ash-break` | Ash Break | 400 | 1 | 5 | 2 | 0 | 0 |
| `cue-copper-ferrule` | Copper Ferrule | 1,500 | 3 | 10 | 3 | 5 | 1 |
| `cue-night-maple` | Night Maple | 6,000 | 7 | 15 | 6 | 8 | 1 |
| `cue-velvet-taper` | Velvet Taper | 20,000 | 12 | 20 | 8 | 12 | 2 |
| `cue-long-rail-master` | Long Rail Master | 75,000 | 20 | 25 | 10 | 15 | 3 |

**Cash cues**, `currency` cash, all stat bonuses zero:

| Id | Name | Price | Min level |
|---|---|---|---|
| `cue-brass-inlay` | Brass Inlay | 40 | 1 |
| `cue-lamp-black` | Lamp Black | 90 | 3 |

**Cloths**, `currency` cash: `cloth-hall-blue` Hall Blue, price 0, level 1, owned and equipped from sign-up; `cloth-oxblood` Oxblood, 30, level 1; `cloth-moss` Moss, 30, level 1; `cloth-brass-felt` Brass Felt, 60, level 5.

**Cash packs:**

| Id | Name | Cash | Price |
|---|---|---|---|
| `pack-chalk` | Chalk Pack | 50 | $0.99 |
| `pack-rack` | Rack Pack | 120 | $1.99 |
| `pack-hall` | Hall Pack | 300 | $4.99 |

**Clubs:**

| Name | Policy | Members |
|---|---|---|
| Corner Pocket Society | Open | Mara Quill owner, Teo Banks officer, Ines Varga member; score 101 |
| Night Rail Club | Request to join | Rook Adeyemi owner, Sol Petrov member; score 50 |
| Full House Hall | Open | Hale Dunmore owner plus `Hall Regular 01` to `Hall Regular 49` members, 50 in all; score 0 |

**Seeded leaderboard players:**

| Name | Level | Weekly wins |
|---|---|---|
| Mara Quill | 14 | 41 |
| Rook Adeyemi | 16 | 38 |
| Teo Banks | 11 | 33 |
| Ines Varga | 9 | 27 |
| Sol Petrov | 6 | 12 |

Hale Dunmore and the Hall Regulars have level 5 and zero wins.

**Tutorial tables.** At every step the cue ball is on the head spot and `Aim angle` starts at 0.0.
- Step 1: ball 1 alone on the foot spot, so the first reading is `Legal` and `Cut 0.0°`.
- Step 2: ball 9 alone on the foot spot, so the first reading is `Wrong group` and `Cut 0.0°`.
- Step 3: ball 1 alone on the foot spot.
- Rotating the aim 90 degrees from any step reads `Blocked`.
- A step 1 shot at the starting aim produces the receipt for first ball 1 at cut 0.0.

## Technical requirements

### Deployment (DP-63)

TypeScript on Node 22. Rooms are held in the app server's own memory, Postgres is the only store, and realtime runs inside the same process over WebSockets or server-sent events on the same origin and port. No wire format is public. `/app/run.json` holds string `install`, `build` and `serve` commands and the schema marker, for example:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm start"}
```

The server binds `0.0.0.0` on port 4173, honouring `APP_PUBLIC_PORT` when set. `GET /api/health` answers HTTP 200 JSON. Apply the schema and seed idempotently on serve, not only at build. Leave nothing in `/app` that breaks copying it: no virtual environment and no absolute symlinks.

### Configuration and secrets (DP-65)

Read at start, never hard-coded and never sent to the browser: `DATABASE_URL`; `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`; `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`; `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`; `GRADING_KEY`. `MAILPIT_URL` is for inspection only and the app does not need it. Time settings, each a whole number of seconds with the default stated in Business rules: `SHOT_CLOCK_SECONDS`, `RECONNECT_GRACE_SECONDS`, `TOURNAMENT_WINDOW_SECONDS`, `READY_CHECK_SECONDS`, `INVITE_TTL_SECONDS`.

### Server boundary (DP-27, DP-62, DP-63, DP-65)

- The server decides every shot result, turn, clock, settlement and balance. A client sends only aim, power, spin, a called pocket and a ball placement.
- Same-origin only: no CORS headers are sent. A state-changing request whose `Origin` header does not match its `Host` is 403 `cross_origin`.
- Request bodies are limited to 65,536 bytes, and a body of exactly that size is allowed. Larger is 413 `payload_too_large`. A body that is not `application/json` on a route that takes one is 415 `unsupported_media_type`. Malformed JSON is 400 `malformed_json`. An unknown `/api` path is 404 `not_found`.
- The server never serves source files, dependency manifests, environment files or credentials. Requests for them answer 404.
- The server never fetches a URL a user supplies, and sends no mail beyond the two published messages.
- The app boots and serves its shell with any dependency unreachable, and never crashes on an unreachable or unusable `DATABASE_URL`. `GET /api/health` always answers 200 once the server listens: `{"status":"ok"}` when Postgres, Kill Bill and SMTP are reachable, `{"status":"unavailable"}` when any is not, never 503. Its answer may be up to 5 seconds old.

### Browser support and performance (DP-14, DP-21, DP-43, DP-51, DP-55, DP-56)

Support the current Chromium, Firefox and WebKit at 375x812, 768x1024 and 1280x800, with touch and with a keyboard. The app is installable: it has a web manifest and a service worker that takes control of the page during the first visit and keeps the shell, fonts, tutorial and practice available with no network. `Offline` follows the browser's online state and updates in place. Home is usable within three seconds on a normal connection.

Live updates need no reload: balances on all open pages, turns and scores, and entrant counts within 2 seconds; presence within 5 seconds; clocks at least once a second.

## Working rules

- **IF-01** `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`.
- **IF-02** `THIRD_PARTY_NOTICES.md` at `/app` lists the name, version and licence of every shipped package; shipped packages means the production dependency tree (`npm ls --omit=dev --all --json`) plus bundled fonts.
- **IF-03** Shipped packages use only MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, CC0-1.0 or OFL-1.1 licences.
- **IF-04** Postgres is the only datastore: no Redis, SQLite, message broker or extra running process.
- **IF-05** `/app` contains no virtual environment and no absolute symlinks.
- **IF-06** The app loads no script, font or style from another origin; all assets are served by the app.
- **IF-07** The provided service configuration stays unedited.

## Engineering standards

- The code is idiomatic strict TypeScript for Node 22, with no use of `any` to bypass the type checker.
- Names match the domain terms in this brief: escrow, ledger line, settlement, ball in hand, called pocket, ready check.
- Each domain rule, such as a foul ruling, a state transition or a derived value, is decided in exactly one place in the source.
- No abstraction has a single implementation unless a provider boundary needs it.
- No dead, commented-out or unreachable code is left in, and no defensive checks for impossible states.
- All API errors go through the one published error shape.
- No feature goes beyond this brief.
