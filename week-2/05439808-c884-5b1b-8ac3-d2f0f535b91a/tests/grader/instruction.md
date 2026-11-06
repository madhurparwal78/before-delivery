# Low Tide Works Saltreach

Saltreach is a browser village-builder set on tidal salt-flat islands. Islanders lay out a village on a 3D island, keep their brine, peat and copper producers and storages running, train small raiding parties, and raid other players' islands without being online at the same time. The server is the only source of truth. It decides placement, build and training timers, every resource spend, the full battle, the loot, the trophies, the leagues, the rewards and every clan role. The browser sends only intents, such as "place this building here" or "deploy this unit on this cell at this tick". Every finished raid can be rebuilt from its published seed, its deploy list and the lootable amounts stored at resolution, and the Wake dial lets any participant scrub through it tick by tick. Every open screen follows changes made elsewhere, by another tab, another islander or the server's own timers, within a short published bound. The product uses exactly two backend services. PostgreSQL holds all state, and Mailpit receives every email. Out of scope: payments and in-app purchases, paid speed-ups, push notifications outside the open app, live player-versus-player play, spectating a raid in progress, social or third-party sign-in, more than one village per account, walls, chat attachments, native mobile apps, and any datastore other than PostgreSQL.

## Problem and users

Small studios that run asynchronous base-builders lose players and money to modified clients. Those clients forge loot totals, skip build timers, report battles that never happened and read other players' villages through guessable IDs. Each forged raid hurts a real defender, who loses stored resources and league standing. The studio then pays in refunds, support time and churn. Today a solo developer can trust the client and diff battle logs after the fact by hand, or rent a backend where battle checking is a bolt-on. Neither option resets timers at each player's own midnight across daylight-saving changes, keeps a balance from going negative when a raid lands while the defender is spending, or offers a replay that matches the server's numbers exactly. Saltreach computes everything on the server and publishes enough for anyone to check a raid.

- **Islander** (daily): grows and lays out their salt-flat village, keeps producers and storages running, and raids other islands for brine, peat and copper without being cheated or overdrawn.
- **Raider** (daily, the same person as an islander, acting in a raid): scouts a matched island, deploys trained units tick by tick, then scrubs the replay to see exactly why the raid earned its stars and loot.
- **Clan warden** (weekly, a clan member holding the skipper or mate role): runs a clan by admitting, promoting, demoting and removing members, moderating clan chat and handling unit donation requests.
- **Clan member** (daily): chats with clanmates, requests and donates trained units, and checks the clan's league standing.
- **Studio operator** (occasional, the solo founder): investigates disputed raids by re-running the published seed, and keeps mail and database outages from corrupting player state.

## Journeys

1. **Arrive and confirm.** A visitor with no account opens the sign-up screen and enters an email, password, display name and time zone (the browser's zone is preselected). After submitting, they see the "check your inbox" notice. They open the confirmation mail in their inbox, follow the link to see the confirmation notice, sign in, and land on their starter island. The top rule shows the starter balances, two free builders, the starter army and the Mudflat league. When they sign out and press the browser's Back button, they see the sign-in screen with the signed-out notice, never the island.
2. **Build and upgrade.** A signed-in islander on their village opens the Build dialog and picks a Peat Rick. A translucent ghost appears on the grid. They move it, rotate it and confirm it with mouse, touch or keyboard alone. The Rick rises from the salt, the builder queue shows its countdown, and the storage cap in the top rule grows once the job finishes. They then upgrade the Brine Pan and see the free-builder count drop and return.
3. **Run the economy.** An islander with two tabs open collects their producers in one tab and watches the readouts count up to the stored amounts in both. They queue three batches of Saltjacks, cancel the middle one, and see the later batch's countdown move earlier and the housing counter fall. A job finishes while they do nothing, and both tabs show the new level.
4. **Scout and raid.** A verified raider opens Raid and gets a scout report of a matched island: layout, levels, lootable amounts and league. They start the raid, pick a unit and tap cells on the tidal ring as the raid clock runs, then end the raid. The result panel shows stars, destruction, transferred loot and trophy change, with a link to the replay.
5. **Be raided.** A defender has their village open when a raider locks it. The under-attack notice appears. When the raid resolves, the readouts drop to the server's post-raid values, the shield end appears in local time, and the open Raid log gains the raid. They open the replay from there.
6. **Replay a defence.** On the Wake dial the defender drags, flings and steps tick by tick. Buildings fall at their recorded ticks, and the destruction, stars and loot numerals match the server at every resting tick.
7. **Collect the rewards.** An islander opens the Rewards panel, opens the daily chest, sees which streak day it paid, and claims the weekly league bonus. They change their time zone in Profile, and the open Rewards panel shows the new next-unlock times in their new local time.
8. **Run a clan.** A verified islander founds a clan and becomes its skipper. They invite a friend by email, and the friend accepts from the Clan panel. The skipper promotes the friend to mate and later demotes them, and from then on the friend's moderation buttons are refused. The skipper removes a disruptive message, and every clanmate's open chat shows the removal notice in its place. When the skipper later leaves, the longest-serving mate leads the clan.
9. **Share an army.** A clan member posts a request for two Saltjacks. A clanmate donates both from their own army. The requester's open panel shows the progress as each donation lands, the request fills, both armies change, and the roster's donated and received counters update.
10. **Settle a dispute and ride out an outage.** The studio operator signs in to Operations, pastes a disputed raid's ID and re-runs it. The page reports that the seed reproduces every tick. Later Mailpit goes down. Sign-ups still show the normal notice, the status line shows mail as queued, and the confirmation mails arrive exactly once after Mailpit is back.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Account sign-up** Signing up answers the same accepted response and queues exactly one confirmation-subject mail whether or not the address is already registered, as qualified in Business rules and Services.
- **DP-02 — Email verification** A confirmation link verifies its account once, and only while it is within the verification lifetime; used, superseded or expired links answer invalid_token.
- **DP-03 — Sign-in and session** Signing in with the right password starts a session cookie and returns a fresh CSRF token, a wrong password or unknown email gets the identical invalid_credentials answer, and signing out ends the session.
- **DP-04 — Password reset** A reset request answers identically for any address, the reset link works once and only within the reset lifetime, and completing it ends every existing session of that account.
- **DP-05 — Sign-in and mail throttles** Sign-in attempts, reset requests and confirmation resends beyond the limits in Business rules answer rate_limited with a Retry-After header, and exactly the limit succeeds even when the requests arrive at the same instant.
- **DP-06 — One live link per account** When several confirmation or reset links for one account are issued at the same instant, exactly one of each kind works afterwards, the one issued last, and every other answers invalid_token.
- **DP-07 — Session end on open screens** After sign-out the browser's Back button shows the sign-in screen with the signed-out notice, and a session ended elsewhere answers unauthenticated and shows the session-ended alert on every open screen within the live bound.
- **DP-08 — Onboarding feedback states** Sign-up, sign-in, resend, forgot, reset and sign-out show their published pending, success, error and field-error copy in the named live regions.
- **DP-09 — Onboarding journey** A visitor signs up in the browser, confirms through the inbox link, signs in and lands on the starter island with the top rule showing the seeded starter values.
- **DP-10 — Intent-only building requests** Placing, moving or upgrading a building accepts only the published intent fields, and any extra field such as a level, finish time, cost or owner is rejected with a field error and nothing is stored.
- **DP-11 — Placement rules** A building is placed only when its rotated footprint lies in the build area, overlaps nothing, stays within its type's count limit and is affordable with a free builder, and each failure answers its published code.
- **DP-12 — Upgrades and builders** An upgrade needs a free builder, a high enough island saltmark and the level's cost, finishes at a server-computed time, and the free-builder count always equals the saltmark-derived builder total minus active jobs.
- **DP-13 — Race-safe spends** Concurrent spends on one island never take a balance below zero or use more builders than exist, and each losing request answers insufficient_resources or no_free_builder.
- **DP-14 — Cancel and move** Cancelling a job before its finish time refunds its cost up to storage room and frees its builder, a cancel at or after the finish time answers job_already_finished while the level is gained, and moving or rotating keeps the level and any running job.
- **DP-15 — Building feedback states** Place, move and upgrade show their published pending, success, error and field-error copy in the named live regions.
- **DP-16 — Build journey** In the browser an islander places, rotates and confirms a new building, sees it in the builder queue with a countdown, and sees its level badge and the derived counters update when the job completes.
- **DP-17 — Producer collection** Collecting a producer credits the output accrued since its last collection, computed from server timestamps and capped by its buffer and storage room, reports any amount lost, and concurrent collects of one producer credit that output exactly once.
- **DP-18 — Paired resource ledger** Every resource and unit movement is a pair of ledger rows that sum to zero, every balance equals the sum of its rows, and no stored amount ever exceeds its derived storage cap.
- **DP-19 — Army training and housing** Training charges the published cost, refuses batches that would overflow derived housing, and adds each batch's units to the army at its server-computed finish time.
- **DP-20 — Training queue order** Training batches run one after another in queue order, and cancelling a waiting or running batch refunds its cost up to storage room and moves every later batch's start and finish as Business rules publish.
- **DP-21 — Live readouts across tabs** An islander's open screens show the top rule and queues changed by another tab, or by a job or batch finishing on the server, within the live bound and without a reload.
- **DP-22 — Economy feedback states** Collect, train, cancel job and cancel training show their published pending, success, error and field-error copy in the named live regions.
- **DP-23 — Economy journey** In the browser an islander collects producers, trains and cancels units and sees the resource, builder and army readouts change to the server's values after each action.
- **DP-24 — Scout view** A scout report contains only the published fields (layout, levels, lootable amounts and public identity) and never the defender's email, time zone, shield end, army or training queue.
- **DP-25 — Private villages and raids** Full village, ledger, raid and snapshot reads answer not_found for any island or raid the caller does not own, attack or defend.
- **DP-26 — Raid eligibility** Scouting or locking your own island, a shielded island, an island already under attack, or a target still in your same-target cooldown answers its published conflict code.
- **DP-27 — Single raid lock** When several raiders lock the same island at once, exactly one receives the raid and every other gets already_under_attack.
- **DP-28 — Deploy validation** Deploy batches accept only units reserved at lock, cells on the tidal ring, and non-decreasing ticks inside the raid window, and they answer field errors keyed by deploy position.
- **DP-29 — Idempotent raid requests** Start-raid, deploy and finalize requests return their stored response when an Idempotency-Key is repeated, and answer idempotency_key_reused when the same key comes with a different body.
- **DP-30 — Raid start feedback states** Next island, start raid and deploy show their published pending, success and error copy in the named live regions.
- **DP-31 — Raid journey** In the browser a verified raider scouts a match, starts the raid, deploys units on the tidal ring during the raid clock, ends the raid and sees the server's result.
- **DP-32 — Finalize deadline** A raid not finalized before its finalize deadline ends abandoned with the deadline end reason: it moves no units, loot or trophies, grants no shield, and releases its lock.
- **DP-33 — Deterministic battle** Resolving a raid runs the published simulation on the stored seed, layout, deploy list and resolution lootable amounts, so the same inputs always produce the same per-tick hashes, destruction, stars and loot.
- **DP-34 — Loot at resolution** A resolved raid takes its lootable amounts from the defender's balances at the moment resolution commits, after any defender spend that committed first, and moves each looted resource as a defender debit and an equal raider credit capped by the raider's storage room.
- **DP-35 — Trophies, leagues and star bonus** A resolved raid changes both players' trophies by the published amounts without going below zero, places each player in the league their trophies fall in, and grants the star bonus only within the attacker's daily cap for their local day.
- **DP-36 — Shield and cooldown** A defence that concedes two or more stars shields the defender for exactly the shield lifetime from resolution, no raid lock commits on that island while the shield runs, and every resolved raid starts the attacker's same-target cooldown for exactly the cooldown lifetime.
- **DP-37 — Defender's open screen** The defender's open village shows the under-attack notice within the live bound of a lock and, within the same bound of resolution, the post-raid readouts, the shield end and the new Raid log row.
- **DP-38 — Raid result feedback states** End raid and the Raid log show their published pending, success and error copy in the named live regions.
- **DP-39 — Raid log journey** In the browser a defender finds the raid against them in the Raid log with its result and opens its replay from there.
- **DP-40 — Raid snapshots** The snapshot endpoint returns to a participant, for any tick of a resolved raid, that tick's destruction, stars, loot, building and unit state and the published state hash, and the final tick equals the raid's result.
- **DP-41 — Wake dial scrubbing** Dragging around the Wake dial moves one tick per degree, redraws the scene at every notch crossed as its drawn-tick attribute shows, and on every settle sets the scene's tick, destruction, stars, loot and hash attributes to that tick's snapshot.
- **DP-42 — Dial coast and settle** Releasing the dial after a fling makes it coast with the published friction and then spring-settle on a whole tick within the raid's range, never resting between ticks.
- **DP-43 — Dial keyboard and reduced motion** Arrow, Page Up, Page Down, Home and End keys step the dial, and with reduced motion the dial becomes a stepped slider with tick buttons and a numeric input that cut straight to each snapshot.
- **DP-44 — Replay feedback states** Opening a replay shows the published loading, ready and error copy in the named live regions.
- **DP-45 — Replay journey** In the browser a participant opens a replay, scrubs forward and back and sees buildings fall at their recorded ticks while the inner numerals match the server.
- **DP-46 — Daily chest and streak** The daily chest can be claimed once per local day in the islander's saved time zone, pays the step of the 7-step streak table the claim reaches, and of several claims at the same instant exactly one succeeds.
- **DP-47 — Weekly tide-league bonus** The league bonus can be claimed once per local week starting Monday at local midnight in the islander's saved zone, correct across daylight-saving weeks and month and year boundaries, and pays the bonus of the islander's current league.
- **DP-48 — Time-zone change and reward clocks** After the islander changes their saved time zone, the next daily chest and league bonus open at the instants Business rules publish, so no change of zone ever yields an extra claim.
- **DP-49 — Rewards feedback states** Opening the chest and claiming the league bonus show their published copy, and an open Rewards panel updates its next-unlock texts within the live bound after a time-zone change.
- **DP-50 — Rewards journey** In the browser an islander opens the daily chest and claims the league bonus, sees the credited amounts in the top rule, and then sees the next chest and next league bonus times in their own local time.
- **DP-51 — Clan founding and invitations** A verified islander founds a clan as its skipper, wardens invite by email with an identical answer for any address and exactly one invitation mail per request, and an invitee joins only while the clan has room and the invitation is still valid.
- **DP-52 — Warden powers** Promote, demote, remove-member and delete-message follow the published role rules, and a lower role calling them directly answers forbidden.
- **DP-53 — Immediate role changes** A demotion or removal takes effect on the affected member's very next request in the same session, and concurrent role changes on one member apply one at a time as Business rules publish.
- **DP-54 — Skipper succession** When the skipper leaves, the skipper role passes to the member Business rules name, and a clan whose last member leaves is dissolved and frees its name at once.
- **DP-55 — Clan chat** Members post plain-text messages that every clanmate sees exactly as typed, and a warden's deletion replaces the message for everyone with the removal notice.
- **DP-56 — Clan chat throttle** Clan chat posts beyond the published limit answer rate_limited with a Retry-After header, and exactly the limit is stored even when posts arrive at the same instant.
- **DP-57 — Clan screens stay live** New and deleted messages and a member's removal show on every affected open Clan panel within the live bound, and the Clan link counts unread messages while the chat log is hidden.
- **DP-58 — Clan league standing** The league table ranks clans by the summed trophies of their current members, and the clan view shows its own rank.
- **DP-59 — Clan feedback states** Founding, inviting, accepting, promoting, demoting, removing, leaving, posting and deleting show their published pending, success, error and field-error copy in the named live regions.
- **DP-60 — Clan journey** In the browser a skipper founds a clan, invites by email, sees the invitee join, promotes them to mate and demotes them, and moderates chat.
- **DP-61 — Donation requests** A member keeps at most one open request naming a unit and count and may cancel it, clanmates donate up to what it still needs and at most three each, and a donation that commits after the request closed or after the recipient's housing filled is refused with its published code.
- **DP-62 — Donor daily cap** Each donor gives at most 8 units per local day in their own saved time zone, and a donation beyond that answers donation_cap_reached with the next allowed instant.
- **DP-63 — Paired donations and counters** Every donation writes a donor debit and an equal recipient credit of units, and each member's donated, received and housing counters equal what the records show.
- **DP-64 — Donation progress on open screens** The requester's open Clan panel shows each donation's progress on their request within the live bound.
- **DP-65 — Donation feedback states** Requesting, donating and cancelling a request show their published pending, success, error and field-error copy in the named live regions.
- **DP-66 — Donation journey** In the browser a member posts a request, a clanmate donates, and both see the request fill and their armies and counters change.
- **DP-67 — Operator raid re-run** The studio operator re-runs any resolved raid from its stored inputs and sees whether every tick's hash matches, while anyone else calling operator routes gets forbidden.
- **DP-68 — Database outage and recovery** With PostgreSQL unreachable the app keeps answering its health check and answers database_unavailable elsewhere, leaves only whole ledger pairs, abandons raids whose deadline passed meanwhile, and serves normally again once the database returns, with no restart.
- **DP-69 — Mail outage queue** Mail requested while Mailpit is unreachable is queued and delivered exactly once after Mailpit returns, while the request still gets its normal answer.
- **DP-70 — Opaque errors** Every error body uses the one published shape and never contains a stack trace, SQL text, file path, library name or secret.
- **DP-71 — Malformed ids** Every route with an id in its path answers not_found for ids that are zero, negative, beyond the published maximum, not plain decimal digits or shaped like a UUID, and never answers 500 for them.
- **DP-72 — Operations feedback states** Re-running a raid and checking the ledger show their published pending, success and error copy in the named live regions.
- **DP-73 — Operator journey** In the browser the operator signs in, reads the service status, re-runs a disputed raid by ID and checks the ledger.
- **DP-74 — Keyboard building placement** An islander can select, place, rotate, move and confirm a building, and open and close the Build dialog, using only the keyboard.
- **DP-75 — Touch camera and reduced motion** On a touch screen one finger pans, a pinch zooms and a two-finger twist rotates the island, and with reduced motion build, upgrade and raid animations become instant state changes.
- **DP-76 — Grid feedback states** Keyboard cursor moves and ghost confirmations announce their published copy, and confirming an invalid ghost sends no request and shows the invalid-spot copy.
- **DP-77 — Run manifest and health** The app installs, builds and serves from the run manifest on the published port, and its health path answers the published body.
- **DP-78 — Session and request boundary** State changes need the session cookie plus a matching CSRF token from the same origin, bodies over the size limit or of the wrong type are refused, and only built client files are served.
- **DP-79 — Responsive layout** Island screens at tablet and laptop sizes keep the published centre box clear of interface, and every screen at phone, tablet and laptop sizes has no horizontal overflow and tap targets of at least 44 pixels.
- **DP-80 — Flat-plan fallback** Without WebGL the island shows as a flat top-down plan with the same controls, data attributes and replay behaviour.
- **DP-81 — Visual identity** Every screen uses the dusky indigo, salt-white and single kiln-orange identity with the published typefaces, flat rule-separated panels and a procedural 3D island.
- **DP-82 — Shared simulation module** The battle rules exist once in the source and are imported by both the server's resolution and the browser's replay and preview.
- **DP-83 — Configuration from environment** Every service address, credential, lifetime and port is read from the published environment variables at start, and none is hard-coded or sent to the browser.
- **DP-84 — Profile feedback states** Saving the profile shows its published pending, success, error and field-error copy in the named live regions.

## Frontend

### Screens and layout (DP-09, DP-16, DP-23, DP-31, DP-39, DP-45, DP-50, DP-60, DP-66, DP-73, DP-79)

Every screen has a deep indigo ground. Panels are flat and separated by thin rules. Signed-in screens share three fixed pieces:

- **Top rule**: one thin band across the top. It shows the resource readouts (brine, peat, copper, each as amount over cap), the builder readout (free over total), the island's saltmark, the army readout (used over capacity), trophies, the league and, when the islander is shielded, the shield end in local time. The main navigation sits on the band's right end. All numbers use the monospaced tabular face, so digits never shift sideways.
- **Queues rail**: a collapsible rail on the left edge. It holds the builder queue (one row per active job with building name, target level and a countdown) and the army queue (one row per training batch in queue order, with unit, count, countdown and a cancel button).
- **Context panels**: Building details, Train army, Scout report, Raid result, Raid log, Rewards, Clan, League and Profile. Each slides in from the right edge, and only one is open at a time.

The 3D island fills the whole viewport behind these pieces on an isometric orbit camera, looking down at roughly 35 degrees.

Screens (routes):

- **Sign-in** `/signin`, **Sign-up** `/signup`, **Forgot password** `/forgot`, **Reset password** `/reset?token=…`, **Confirm email** `/verify?token=…`: one centred column on the indigo ground with the product name in the display face. No island is shown.
- **Village** `/`: the islander's own island with the top rule, the Queues rail and the Build and Train buttons at the bottom left. Selecting a building opens Building details.
- **Scout** `/scout` and `/scout/<villageId>`: the matched island in 3D, read-only, with the Scout report panel.
- **Raid** `/raids/<raidId>`: the locked island with the tidal deploy ring outlined. It shows the unit picker at the bottom left, the raid clock and finalize countdown in the top rule, and the "End raid" button at the bottom right. After resolution the Raid result panel opens.
- **Replay** `/raids/<raidId>/replay`, with an optional `?tick=<n>` that opens at that tick (clamped to the raid's range; tick 0 when absent): the island as it was locked, with the Wake dial at the bottom centre.
- **Operations** `/ops` (operator only; anyone else is sent to `/`): a single column with the service status, a raid re-run form and a ledger check.

Any signed-in route opened without a valid session goes to `/signin`.

Layout per viewport. No screen scrolls horizontally at any of the three.

- **1280×800**: the top rule is a single row. The Queues rail is open and takes about a fifth of the width. Context panels take about a third of the width on the right. The Wake dial is a ring of comfortable thumb size, about a quarter of the viewport height, at the bottom centre. The centre box (defined under Visual design) stays clear.
- **768×1024**: the top rule is a single row with smaller gaps. The Queues rail starts collapsed to its toggle. Context panels take about a third of the width on the right. The dial is about a fifth of the viewport height.
- **375×812**: the top rule wraps into two rows, resources on the first and the other readouts and navigation on the second. Navigation shows icons only, and each keeps its accessible name. The Queues rail opens as a sheet from the left over the edge of the island. Context panels become bottom sheets that cover at most the lower 60% of the screen, and the camera recentres the selected building into the visible upper part. The dial is about 60% of the screen width, centred above the bottom edge.

The camera never places the selected building or the ghost under a panel. When a panel opens, the camera eases the target into the uncovered area.

### Public screens and controls (DP-08, DP-09, DP-16, DP-21, DP-23, DP-31, DP-37, DP-39, DP-41, DP-43, DP-45, DP-50, DP-57, DP-60, DP-64, DP-66, DP-73, DP-74, DP-75, DP-80)

Only the controls and regions below are public, and tests and judges use exactly these roles and accessible names. Everything else is the builder's choice. `<…>` marks a value filled in at run time.

| Where | Role and accessible name | Visible copy or content |
|---|---|---|
| Every screen | `status` "Tide notices" (polite) | pending, success and notice copy from Feedback states |
| Every screen | `alert` "Tide alerts" (assertive) | error, outage and session copy from Feedback states |
| Sign-up | `textbox` "Email", `textbox` "Password", `textbox` "Display name", `combobox` "Time zone", `button` "Create island", `link` "Sign in instead" | heading "Make your island" |
| Sign-in | `textbox` "Email", `textbox` "Password", `button` "Sign in", `link` "Forgot password?", `link` "Create an account", `button` "Send a new confirmation link" | heading "Back to the flats" |
| Forgot password | `textbox` "Email", `button` "Send reset link" | heading "Reset your password" |
| Reset password | `textbox` "New password", `button` "Set new password" | heading "Choose a new password" |
| Confirm email | `link` "Go to sign in" | heading "Confirming your email" |
| Signed-in screens | `navigation` "Main" with `link`s "Village", "Raid", "Raid log", "Clan", "League", "Rewards", "Profile", and `button` "Sign out"; the operator sees `link` "Operations" instead of "Raid", "Raid log", "Clan" and "Rewards". While the islander has unread clan messages, the Clan link's accessible name is "Clan (<n> unread)" and it shows a small orange count badge | icon plus label (icon only on phones) |
| Top rule | `group` "Resources" containing texts "Brine <amount> / <cap>", "Peat <amount> / <cap>", "Copper <amount> / <cap>"; texts "Builders <free>/<total>", "Saltmark <saltmark>", "Army <used>/<capacity>", "Trophies <trophies>", "League <league>", and when shielded "Shielded until <local time>" | numbers with comma thousands separators |
| Raid screen top rule | `timer` "Raid clock" showing the remaining simulated time as m:ss; text "Finalize by <m:ss>" | |
| Queues rail | `region` "Queues" containing `list` "Builder queue" and `list` "Army queue"; `button` "Hide queues" / "Show queues"; per army row `button` "Cancel training of <count> <unit>" | rows "<building> → level <n> · <m:ss>" and "<count> × <unit> · <m:ss>"; a waiting batch shows "<count> × <unit> · starts <local time>" |
| Village, Scout, Raid, Replay | `application` "Island view": the scene root, focusable, carrying the data attributes below | the 3D island, or the flat plan |
| Village | `button` "Build", which opens `dialog` "Build" containing one `button` "Place <building name>" per placeable type with its cost and footprint, and `button` "Close" | |
| Village | `button` "Train", which opens `complementary` "Train army" with `radio`s "Saltjack" and "Peat Slinger", `spinbutton` "Count", `button` "Train" | cost and time per unit |
| Village | `complementary` "Building details" with heading "<building name> · level <level>", `button`s "Upgrade to level <n>", "Cancel job", "Move", "Collect" (producers only), "Close panel" | upgrade cost and duration; for producers, "Uncollected <amount>" |
| Ghost mode (village) | `button`s "Rotate", "Confirm placement", "Cancel placement" in a small bar beside the ghost | |
| Scout | `complementary` "Scout report" with heading "<display name>", texts "Trophies <trophies>", "League <league>", `list` "Lootable" with "<amount> brine", "<amount> peat", "<amount> copper"; `button`s "Start raid" and "Next island" | |
| Raid | `radiogroup` "Units" with `radio`s "Saltjack (<n> left)" and "Peat Slinger (<n> left)"; `button` "End raid" | |
| Raid | `complementary` "Raid result" with texts "<stars> stars", "<destruction>% destroyed", "Loot <amounts>", "Trophies <signed change>", and `link` "Open replay" | |
| Replay | `slider` "Wake dial" with value range 0 to the final tick, current value the tick, value text "Tick <n> of <final>"; `button` "Play replay" / "Pause replay"; `group` "Tick readout" with texts "<destruction>%", "<stars> stars", "<brine> brine", "<peat> peat", "<copper> copper" | tick counter inside the ring |
| Replay, reduced motion | `button`s "Back 10 ticks", "Previous tick", "Next tick", "Forward 10 ticks"; `spinbutton` "Tick" | |
| Raid log | `complementary` "Raid log" with `tab`s "Attacks" and "Defences"; each resolved row has `button` "Replay raid on <opponent>" or "Replay raid by <opponent>" | rows "<stars> stars · <destruction>% · <amounts> · <local date-time>"; a locked or deploying row reads "Under way · <local date-time>"; an abandoned row reads "Abandoned · <local date-time>" |
| Rewards | `complementary` "Rewards" with `button` "Open daily chest", `button` "Claim league bonus", text "Next chest <local date-time>" while the chest cannot be opened or "Chest ready to open" while it can, text "Streak day <streak> of 7", text "Next chest holds <amounts>", text "Next league bonus <local date-time>" while the bonus cannot be claimed or "League bonus ready to claim" while it can, and text "Star bonuses today <used>/<cap>" | |
| Clan, no clan | `complementary` "Clan" with `textbox` "Clan name", `textbox` "Motto", `button` "Found clan", `list` "Invitations" with `button`s "Accept invitation to <clan>" and "Decline invitation to <clan>" | |
| Clan, member | `complementary` "Clan" with `tab`s "Members", "Chat", "Requests"; `button` "Leave clan"; above the tabs, while the member has a request in this clan, `region` "My request" with text "<given> of <count> <unit>" and, while it is open, `button` "Cancel my request" | heading "<clan name>", text "Rank <rank>" |
| Members tab | `table` "Roster" (name, role, trophies, donated, received); per row, where allowed, `button`s "Promote <name>", "Demote <name>", "Remove <name>"; for wardens, `textbox` "Invite by email" and `button` "Send invitation" | role labels "Skipper", "Mate", "Deckhand" |
| Chat tab | `log` "Clan chat"; `textbox` "Message"; `button` "Send"; for wardens, `button` "Delete message from <name>" per message | removed messages show the removal copy |
| Requests tab | `radio`s "Saltjack" and "Peat Slinger", `spinbutton` "Count", `button` "Request units"; per open request of another member `button` "Donate to <name>", which opens `dialog` "Donate" with `spinbutton` "Count", `button` "Donate", `button` "Close" | "<given> of <count> <unit>" per request |
| League | `complementary` "League" with `table` "Clan standings" (rank, clan, trophies, members) | |
| Profile | `complementary` "Profile" with `textbox` "Display name", `combobox` "Time zone", `button` "Save profile" | |
| Operations | `region` "Service status" with texts "Database: <up/down>", "Mail: <state>", "Queued mail: <n>"; `textbox` "Raid ID", `button` "Re-run raid"; `button` "Check ledger" | heading "Operations" |

`<unit>` in visible copy is the catalog name exactly ("Saltjack", "Peat Slinger"), never pluralised. `<given>` is the units donated to the request so far.

Data attributes on the `application` "Island view" element. They are always present unless noted.

- `data-view`: `village`, `scout`, `raid` or `replay`.
- `data-renderer`: `webgl` or `flat`.
- `data-building-count`: the number of buildings shown.
- `data-cursor-x`, `data-cursor-y`: the keyboard cell cursor, as integers 0–39.
- `data-ghost-type`, `data-ghost-x`, `data-ghost-y`, `data-ghost-rotation`, `data-ghost-valid` (`true`/`false`): present only while a ghost is shown. They describe the footprint's minimum corner cell and rotation in degrees.
- `data-camera-azimuth`: whole degrees 0–359. `data-camera-zoom`: two decimals, 0.50–2.00. `data-camera-pan-x`, `data-camera-pan-y`: the cell the camera looks at, with one decimal.
- `data-animating`: `true` only while a transition animation from Motion and effects is running, otherwise `false`.
- Replay only: `data-tick`, `data-destruction`, `data-stars`, `data-loot-brine`, `data-loot-peat`, `data-loot-copper`, `data-state-hash`, and `data-settled` (`true` when the dial is at rest on a whole tick, `false` while it moves).
- Replay only: `data-drawn-tick`, the tick the scene currently draws. It changes at every redraw, including each notch crossed during a drag or a coast, while `data-tick` and the other replay attributes change only on settle.

### Interactions (DP-07, DP-21, DP-37, DP-41, DP-42, DP-43, DP-49, DP-57, DP-64, DP-74, DP-75, DP-76)

Pointer and mouse on the island:

- Dragging with the main button pans the camera. Dragging with the secondary button, or with Shift held, orbits the azimuth. The wheel zooms. Clicking a building selects it and opens Building details. Clicking empty ground closes any panel.
- In ghost mode, a drag that starts on the ghost moves the ghost one cell at a time. "Rotate" turns it 90 degrees clockwise. A non-square footprint swaps its width and depth on each quarter turn. "Confirm placement" sends the request, and "Cancel placement" removes the ghost. The ghost is tinted tide teal where valid and danger red where invalid, so `data-ghost-valid` and the tint always agree.

Touch on the island. These work in every motion mode.

- One finger drags to pan. In ghost mode, a drag that starts on the ghost moves the ghost instead.
- A two-finger pinch zooms within the published zoom range.
- A two-finger twist rotates the azimuth by the twist angle.
- A tap selects a building or cell. The island absorbs these gestures, so the page itself never scrolls or zooms.

Keyboard:

- **Tab order**: the Main navigation, then the Queues rail toggle and rows, then the Build and Train buttons, then the Island view, then the open context panel, then the Wake dial and its buttons on the replay screen.
- **Focus on Island view**: arrow keys move the cell cursor one cell. Each move announces the cursor copy from Feedback states in Tide notices. Q and E orbit the camera 45 degrees. Plus and minus zoom. Shift with an arrow pans the camera one cell. B opens the Build dialog. Enter on a building opens Building details and moves focus there.
- **Build dialog**: focus moves to the first "Place" button and stays trapped in the dialog. Escape or "Close" closes it and returns focus to "Build". Choosing "Place <building name>" closes the dialog, shows the ghost with its minimum corner at the cell cursor, rotated 0 degrees, and moves focus to Island view.
- **Ghost mode**: arrow keys move the ghost one cell, R rotates it 90 degrees clockwise, and Enter confirms. If the ghost is invalid, Enter sends no request and shows the invalid-spot copy. Escape cancels the ghost and leaves focus on Island view.
- **Building details**: "Move" starts ghost mode for that building at its current cell and rotation. Escape closes the panel and returns focus to Island view.
- **Donate dialog**: focus moves to "Count" and stays trapped. Escape or "Close" closes it and returns focus to the "Donate to <name>" button that opened it.
- **Raid screen**: with focus on Island view, arrow keys move the cursor along the tidal ring only. Space or Enter deploys the selected unit on the cursor cell at the current tick. Number keys 1 and 2 pick Saltjack or Peat Slinger.
- **Wake dial**: Right or Up adds one tick and Left or Down subtracts one. Page Up adds ten and Page Down subtracts ten. Home goes to tick 0 and End to the final tick. Each key press lands on its tick at once, with no coasting, and counts as a settle. In the reduced-motion slider, the four buttons do the same, and typing a number into "Tick" and pressing Enter jumps to it (clamped to the range).

Wake dial pointer behaviour (DP-41, DP-42):

- The handle, a small orange bead, sits on the ring at the angle `tick` modulo 360, with 0 at the top and increasing clockwise. One degree equals one tick, so a full 1,800-tick raid is five turns. Notches mark every ten ticks.
- Dragging the bead or anywhere on the ring changes the tick by the change in pointer angle around the ring's centre. Clockwise moves forward, and the tick is clamped to the range from 0 to the final tick.
- Each notch crossed, while dragging or coasting, redraws the 3D scene at that notch's tick and sets `data-drawn-tick` to it. On every settle `data-drawn-tick` equals `data-tick`.
- On release, a fling coasts (see Motion and effects) and then settles. A slow release settles straight onto the nearest whole tick. Hitting tick 0 or the final tick stops the coast and settles there.
- "Play replay" advances ten ticks per second and settles on every tenth tick. It stops at the final tick, and any drag or key press pauses it.
- On every settle, the scene, the Tick readout and the replay data attributes show that tick's snapshot. Scrubbing backwards restores every earlier state exactly, including rebuilding fallen buildings.

**Live screens.** Every open signed-in screen shows a change made by any other request (another tab, another islander, the server's own timers) within 2 seconds, without a reload. This 2-second limit is the live bound, and checks allow one further second of grace. The app offers this either by server push at `/api/events` (server-sent events or a WebSocket) or by polling the reads behind the open screen at least once per second while the tab is visible. In particular:

- The top rule, Queues rail and Building details follow collections, spends, loot, donations and rewards made anywhere, and jobs and batches that finish on the server while nobody acts. When a job finishes, the job-complete copy is announced in each open tab.
- Countdowns tick once a second from the server's finish times, corrected by the server time each response reports.
- On the defender's open screens: within the live bound of a lock against their island, the under-attack notice is announced. Within the live bound of the raid's resolution, the readouts show the post-raid values, "Shielded until <local time>" appears when a shield was granted, the raid-resolved notice is announced, and an open Raid log gains the raid's row on its Defences tab. An abandoned raid announces the raid-abandoned notice instead.
- Open Clan panels follow new messages, deletions (the removal copy replaces the message), roster and role changes, request progress ("<given> of <count> <unit>" on the requester's My request region and on each request row) and closed requests. A member removed from the clan sees their open Clan panel switch to the no-clan view with the removed-member copy.
- While the "Clan chat" log is not visible on a screen, each message posted by another member adds one to that screen's unread count, shown on the Clan link as published above. Showing the log clears the count to 0, and the link's accessible name becomes "Clan" again. The count lives in the open tab only and starts at 0 when the tab loads.
- An open Rewards panel shows new next-unlock texts within the live bound after a claim or a time-zone change made in any tab, and switches to the ready texts within the live bound once a shown next-claim instant passes.
- **Session end**: when the tab's session ends by any means other than this tab's own sign-out (a password reset, sign-out in another tab, or the session lifetime passing), every open signed-in screen shows the session-ended copy in Tide alerts within the live bound and goes to `/signin`, where the alert stays visible. After this tab's own sign-out, the app goes to `/signin` and shows the signed-out copy in Tide notices. Pressing the browser's Back button afterwards, including when the browser restores the earlier page from its cache, never shows the island: the app goes to `/signin` and shows the signed-out copy again.

### Visual design (DP-81)

- **Colour roles**:
  - A deep dusk indigo is the ground behind the island and under every screen.
  - A crisp salt off-white is the ink for all text and rules.
  - One warm kiln orange marks actionable and live values only: primary buttons, the dial bead and tick counter, the readout that just changed, the unread badge, and the focused cell.
  - A muted tide teal is for water, valid placement and shield state.
  - A brick red marks danger: errors, invalid ghosts, destruction, the under-attack notice and the outage banner.
  - No other hues appear in the interface.
- **Type**: Fraunces, a soft high-contrast serif with a hint of old print, sets the product name, screen headings and panel titles. Atkinson Hyperlegible, an open, highly legible sans, sets body text and controls. JetBrains Mono with tabular figures sets every number in the top rule, queues, dial and result panels, including the tick counter inside the dial ring. Each heading step is a quarter larger than the step below it, so panel titles are about one and a half times body size and screen headings about twice body size.
- **Density**: comfortable. Panel rows have generous vertical padding, and the top rule stays one slim line on laptops.
- **Composition**: the full-bleed island is the stage. Interface hugs the edges (rule on top, rail on the left, panels on the right, dial centred at the bottom), so the centre box stays clear. The centre box is a box a quarter of the viewport's width and a quarter of its height, centred in the viewport. On the Village, Scout, Raid and Replay screens at 768×1024 and 1280×800, no part of the interface overlaps it except the open Build or Donate dialog and the ghost's small action bar. On phones the bottom sheets may cover the lower part of the screen, as described in Screens and layout. HUD panels are flat with thin salt-white rules between sections, with no drop shadows, gradients or glassy blur.
- **The island**: built from procedural geometry. It shows a cracked salt crust, shallow tidal channels around the 2-cell deploy ring, low-poly buildings with distinct silhouettes per type, and level badges floating over each building. Lighting is a low warm dusk light from one side.
- **Accessibility**: every control is at least 44 by 44 pixels. Text and essential graphics meet WCAG 2.2 AA contrast against the indigo ground. Focus shows as a two-tone ring (orange inside, off-white outside), visible on any background. Icons come from one consistent outline set, and every icon-only button has an accessible name.

### Motion and effects (DP-41, DP-42, DP-43, DP-75, DP-80)

Feel: actions start quickly and settle softly, with no bounce except the dial's spring. Three timings are used.

- **Press and hover feedback**: about a tenth of a second.
- **Panel slide-in and slide-out, numeral count-ups and camera recentring**: about a quarter of a second.
- **Building rise and collapse**: just over half a second.

No interface motion lasts longer than one second.

- **Enter and exit**: context panels slide in from the right edge (or up from the bottom on phones) and slide back out the same way. Dialogs fade and rise slightly.
- **State changes**: a newly placed building rises out of the salt. A finished upgrade gives one short orange pulse on its level badge. A changed readout counts from its old value to its new one and briefly turns orange, including changes that arrive through the live screens. In live raids and replay, a destroyed building sinks and crumbles into the salt.
- **Named loops**: there are only two. The tide water ripples, one slow cycle every 6 to 10 seconds, to show the island is live. A scaffold ring turns slowly around a building with a running job, once every 4 to 6 seconds, to show "builder at work". Nothing else loops, and there is no unnamed decorative motion. The camera never turns on its own.
- **`data-animating`** is `true` only while a rise, collapse, pulse, panel slide or camera recentre is running.
- **Wake dial**:
  1. While dragging, the bead follows the pointer exactly and the scene steps at each notch.
  2. After a fling the dial coasts, losing about 8% of its speed every frame at 60 frames per second. A hard fling fades out within about one second.
  3. When the coast slows below half a tick per frame, a stiff, well-damped spring lands the dial on the nearest whole tick in under half a second. Any overshoot stays under half a tick, and the dial never rests between ticks.
  4. On settle, the inner numerals count to the snapshot values in about a quarter of a second. The data attributes are updated at the moment of settling.
- **Reduced motion** (the system's reduced-motion setting):
  - Every rise, collapse, pulse, count-up, panel slide and camera recentre becomes an instant state change, and `data-animating` stays `false`.
  - The water and scaffold loops hold still.
  - The dial becomes a stepped slider with the four tick buttons and the "Tick" input. It does not coast or spring, and the scene and numerals cut straight to each snapshot. The data attributes behave the same as in full motion.
  - Live raids show units jumping from tick to tick.
  - Camera input (drag, pinch, twist, keys) still moves the camera, instantly.
- **Without WebGL** (DP-80): the island draws as a flat top-down plan in the same colours. Each building is a labelled rectangle on the grid, and destroyed buildings are hatched in red. `data-renderer` is `flat`, the azimuth stays 0, pan and zoom still work, and the cursor, ghost, keyboard, touch and Wake dial behave exactly as above. The flat-plan notice from Feedback states is announced once.

### Feedback states (DP-08, DP-15, DP-22, DP-30, DP-38, DP-44, DP-49, DP-59, DP-65, DP-72, DP-76, DP-84)

While an async action is pending, its button shows a busy state and ignores repeat presses, and the pending copy goes to Tide notices. Success and notice copy goes to Tide notices. Error, outage and session copy goes to Tide alerts. Each new message in a live region replaces the previous one there.

**Field errors.** When a request answers `422 validation_failed`, Tide alerts says "Check the highlighted fields." Each field named in `errors` that has a control on the screen shows its message directly under the control, and the control is marked invalid with that message as its accessible description. The message shown is the API's message for the field, and the API uses exactly these messages:

| Field | Message |
|---|---|
| any field not listed for its endpoint | "unknown field" |
| any listed field that is missing | "This field is required." |
| `email` | "Enter a valid email address." |
| `password` | "Use 10 to 128 characters." |
| `displayName` | "Use 3 to 20 letters, digits, spaces, hyphens or underscores." |
| `timeZone` | "Choose a time zone from the list." |
| `token` | "This link is incomplete." |
| `type` | "Choose a building from the catalog." |
| `x`, `y` | "Keep the whole building inside the build area." |
| `rotation` | "Use 0, 90, 180 or 270." |
| `unit` (training, requests and deploys) | "Choose Saltjack or Peat Slinger." |
| `count` on training | "Choose 1 to 20." |
| `count` on a request | "Choose 1 to 6." |
| `count` on a donation | "Choose 1 to 3." |
| `villageId` | "Use a village ID." |
| `deploys` | "Send 1 to 50 deploys, and at most 200 in one raid." |
| `deploys[<i>].tick` | "Use a tick from 0 to 1,799, never earlier than the one before." |
| `deploys[<i>].x`, `deploys[<i>].y` | "Deploy on the tidal ring." |
| `name` (clan) | "Use 3 to 24 characters." |
| `motto` | "Use at most 80 characters." |
| `body` (chat) | "Write 1 to 500 characters." |
| `limit` | "Use 1 to 100." |
| `before`, `after` | "Use an ID from this list." |
| `tick` (snapshot) | "Use a tick from 0 to the raid's final tick." |
| `role` (raid list) | "Use attack or defence." |
| `Idempotency-Key` | "Send an Idempotency-Key of 8 to 64 letters, digits, hyphens or underscores." |

Placeholders used in this section:

- `<local time>` is HH:MM, 24-hour, in the islander's saved zone.
- `<local date-time>` is like "Mon 15 Mar, 00:00" in the saved zone.
- `<amounts>` and `<lost amounts>` list the non-zero resources as "<n> brine, <n> peat, <n> copper", in that order. When every amount is zero, the placeholder reads "nothing". So a raid that took no loot shows "Loot nothing" in Raid result. Its Raid log row keeps the amounts segment, which then reads "nothing".
- `<seconds>` is the Retry-After value.
- `<building>` and `<unit>` are catalog names.
- `<clan>` is the clan's name, `<name>` a member's display name, `<role label>` "Skipper", "Mate" or "Deckhand".

Copy for any action (each row of the action table below adds its own):

| Code or event | Copy |
|---|---|
| `validation_failed` | "Check the highlighted fields." with the field messages above |
| `rate_limited` | "Too many tries. Try again in <seconds> s." |
| `not_found` | "We couldn't find that. It may have moved, or it isn't yours to see." |
| `csrf_failed` | "This page is out of date. Reload and try again." |
| `email_not_verified` | "Confirm your email to raid and join clans." |
| `database_unavailable` | "The tide records are out of reach. Nothing was changed — try again in a moment." |
| any other 5xx or network failure | "Lost contact with the server. Check your connection and try again." |

| Action | Pending | Success | Errors |
|---|---|---|---|
| Sign up | "Creating your island…" | "Check your inbox at <email>. Your confirmation link may take a few minutes to arrive." | field errors |
| Confirm email | "Confirming…" | "Email confirmed. Your island is ready." | `invalid_token`: "This link has expired or was already used. Request a new one from the sign-in screen." |
| Resend confirmation | "Sending…" | "A fresh confirmation link is on its way to <email>. It may take a few minutes." | field errors; `rate_limited` |
| Sign in | "Signing in…" | (goes to Village) | `invalid_credentials`: "That email and password don't match an account."; `rate_limited`; field errors |
| Forgot password | "Sending…" | "A reset link is on its way to <email>. It works once and expires soon." | field errors; `rate_limited` |
| Reset password | "Saving…" | "Password changed. Sign in with your new password." | `invalid_token`: "This reset link has expired or was already used."; field errors |
| Sign out | "Signing out…" | on `/signin`: "You signed out." | |
| Session ended elsewhere | | | "Your session ended. Sign in again." |
| Place building | "Placing <building>…" | "<building> placed. Done at <local time>." | `cell_occupied`: "That spot is taken."; `building_limit_reached`: "Your island already holds the most of these."; `insufficient_resources`: "Not enough resources for that."; `no_free_builder`: "All builders are busy."; field errors |
| Keyboard cursor move | | "Cell <x>, <y> — <building> level <level>" or "Cell <x>, <y> — open salt" | |
| Invalid ghost on confirm | | | "That spot is taken or off the build area." |
| Move | "Moving <building>…" | "<building> moved." | as Place |
| Upgrade | "Starting upgrade…" | "<building> upgrading to level <n>. Done at <local time>." | `saltmark_too_low`: "Raise your island's saltmark first — finish more building levels."; `max_level`: "Already at the highest level."; `upgrade_in_progress`: "A builder is already on it."; `no_free_builder` and `insufficient_resources` as Place |
| Job completes | | "<building> reached level <n>." | |
| Cancel job | "Cancelling…" | "<building> job cancelled. Refunded <amounts>." | `job_already_finished`: "That job already finished. Nothing was refunded." |
| Collect | "Collecting…" | "Collected <amounts>.", "Collected <amounts>. Storage full — <lost amounts> lost." or, when nothing was credited or lost, "Nothing to collect yet." | `not_a_producer`: "Only producers can be collected." |
| Train | "Queuing training…" | "Training <count> <unit>. Ready at <local time>." | `housing_full`: "Your camps are full."; `barracks_required`: "Build a Tide Barracks first."; `barracks_level_too_low`: "Upgrade your Tide Barracks first."; `insufficient_resources` as Place; field errors |
| Cancel training | "Cancelling training…" | "Training of <count> <unit> cancelled. Refunded <amounts>." | `batch_already_finished`: "That training already finished. Nothing was refunded." |
| Next island | "Searching the tide for an island…" | (Scout report opens) | no match: "No island is in reach right now. Try again in a minute." |
| Start raid | "Locking the island…" | "Island locked. Deploy before the finalize countdown runs out." | `already_under_attack`: "Another raider got there first."; `village_shielded`: "That island is shielded."; `target_cooldown`: "You raided this island recently."; `cannot_raid_self`: "That's your own island."; `raid_in_progress`: "Finish your current raid first."; `no_army`: "Train some units first."; `email_not_verified` |
| Deploy batch | | | `units_unavailable`: "You have no more of that unit in this raid."; `raid_abandoned` as End raid; network or 5xx: "Deploys didn't reach the tide. Retrying…" (retried with the same key) |
| End raid | "Resolving the raid on the server…" | "Raid resolved: <stars> stars, <destruction>% destroyed." | `raid_abandoned`: "The finalize window closed. The raid was abandoned and nothing moved."; `nothing_deployed`: "Deploy at least one unit first."; `raid_not_active`: "This raid is already over." |
| Open Raid log | "Loading raids…" | | |
| Raid locked against you | | "Your island is under attack." | |
| Raid against you resolved | | "Your island was raided: <stars> stars, <destruction>% destroyed." | |
| Raid against you abandoned | | "The raid on your island was abandoned. Nothing moved." | |
| Replay load | "Loading replay…" | "Replay ready: <final> ticks." | `raid_not_resolved`: "This raid has no replay yet."; `not_found` |
| Open daily chest | "Opening…" | "Daily chest opened (day <streak> of 7): <amounts>." | `already_claimed`: "Next chest at <local date-time>." |
| Claim league bonus | "Claiming…" | "<league> league bonus claimed: <amounts>." | `already_claimed`: "Next league bonus at <local date-time>." |
| Save profile | "Saving…" | "Profile saved." | field errors |
| Found clan | "Founding…" | "<clan> founded. You lead it." | `clan_name_taken`: "That clan name is taken."; `already_in_clan`: "Leave your current clan first."; field errors |
| Send invitation | "Inviting…" | "Invitation recorded for <email>. The mail may take a few minutes." | `forbidden`: "Only wardens can do that."; field errors |
| Accept invitation | "Joining…" | "You joined <clan>." | `clan_full`: "That clan is full."; `already_in_clan` as Found clan; `not_found`: "That invitation is no longer open." |
| Promote or demote | "Updating…" | "<name> is now <role label>." | `forbidden` as Send invitation; `invalid_role_change`: "That role change isn't allowed." |
| Remove member | "Removing…" | "<name> was removed from the clan." | `forbidden` as Send invitation; `invalid_role_change` as Promote |
| Leave clan | "Leaving…" | "You left <clan>.", "You left <clan>. <name> now leads it." when the skipper role passed, or "You left <clan>. The clan was disbanded." | |
| Removed from the clan (live) | | | "You are no longer in <clan>." (also shown as text in the no-clan Clan panel) |
| Any clan action after leaving or removal | | | `not_in_clan`: "You're no longer in this clan." |
| Send message | "Sending…" | (message appears in Clan chat) | `rate_limited`; field errors |
| Delete message | "Removing…" | the message shows "Message removed by a warden" for everyone | `forbidden` as Send invitation |
| Request units | "Posting…" | "Request posted for <count> <unit>." | `request_open`: "You already have an open request."; field errors |
| Cancel my request | "Cancelling…" | "Request cancelled." | `request_closed`: "That request is already filled or closed." |
| Donate | "Donating…" | "You donated <count> <unit> to <name>." | `request_closed` as Cancel my request; `exceeds_request`: "That request needs fewer units now."; `donor_limit`: "You've already given 3 units to this request."; `donation_cap_reached`: "You've given 8 units today. Donate again at <local date-time>."; `units_unavailable`: "You don't have those units."; `recipient_housing_full`: "Their camps are full."; `raid_in_progress` as Start raid; field errors |
| Re-run raid | "Re-running seed…" | "Seed <seed> re-run matches every tick (0–<final>)." or "Seed <seed> re-run differs from tick <tick>." | `not_found`: "No raid has that ID."; `raid_not_resolved`: "That raid has no result to re-run." |
| Check ledger | "Checking…" | "Ledger balanced: <pairs> pairs." or "Ledger unbalanced: <unbalanced> pairs, <overCap> balances over cap." | |

Where a row gives its own copy for a code, that copy replaces the any-action copy for that action.

Outage and status copy:

- `database_unavailable` also shows a red banner under the top rule with the same copy, until a request succeeds.
- Operations "Mail" state: "Mail: delivering" when up, "Mail: queued, Mailpit unreachable" when down.
- Flat-plan notice in Tide notices: "3D view unavailable — showing the flat plan."

Every success copy above stays true when mail is only queued.

## Backend

### API (DP-01–DP-06, DP-10, DP-24, DP-25, DP-29, DP-40, DP-51, DP-67, DP-70, DP-71)

Conventions:

- All endpoints live under `/api`. Request and response bodies are `application/json; charset=utf-8`. The optional live channel `/api/events` is the only exception (see Interactions).
- A request with a body and any other content type answers `415`. A body larger than 65,536 bytes answers `413`; exactly 65,536 bytes is allowed. Syntactically broken JSON answers `400 malformed_json`.
- Instants are ISO 8601 UTC strings with millisecond precision ending in `Z`, for example `2027-03-15T04:00:00.000Z`.
- **IDs** are positive integers from 1 to 9,007,199,254,740,991 inclusive, written in JSON as numbers. A path id is valid only when written as plain decimal digits without a leading zero and within that range. Any other path id (0, negative, beyond the maximum, a decimal fraction, letters, a UUID-shaped value) answers `404 not_found`, exactly like an id that does not exist, never 422 or 500. Id fields in a body (`villageId`) or query (`before`, `after`) must be JSON integers or plain decimal strings in that range, otherwise they answer 422 on that field. A well-formed body or query id that does not resolve answers `404 not_found`.
- **Exact fields**: every JSON body accepts exactly the fields its endpoint lists. Any other field, top-level or nested (for example `level`, `finishesAt`, `cost`, `ownerId`, `role`, `trophies`), answers `422` with that field's key and the "unknown field" message, and nothing is stored.
- **One error shape**: every error is `{"error":"<code>","message":"<short human sentence>"}`. Validation errors add `"errors":{"<field>":"<message>"}`, using the field messages from Feedback states, where nested fields are keyed like `deploys[3].tick`. `already_claimed` adds `"nextClaimAt"`, and `donation_cap_reached` adds `"nextDonationAt"`. No other error adds keys. Error bodies never contain stack traces, SQL text, file paths, library or framework names, environment values or secrets. Unexpected failures answer `500 {"error":"internal","message":"Something went wrong."}`.
- **Error precedence**: when several errors apply, the first in this order answers:
  1. `413`, then `415`, then `400 malformed_json`
  2. `503 database_unavailable`
  3. `401 unauthenticated`
  4. `403 csrf_failed`
  5. `429 rate_limited`
  6. `403 forbidden` on `/api/ops/*` routes
  7. `409 not_in_clan` on every route whose path starts with `/api/clan/`, when the caller belongs to no clan; this is decided before any target id in the path is resolved
  8. `404 not_found`, including malformed path ids
  9. `403 forbidden` or `403 email_not_verified`
  10. Idempotency handling: a missing or malformed key answers 422; a stored response is replayed; a reused key with a different body answers `409 idempotency_key_reused`
  11. `422 validation_failed`
  12. Other `409` state conflicts, in the order the endpoint's row in the table below lists them

  A replayed response is therefore returned before any state check.
- Every `409` uses the shape above with one of these codes: `cell_occupied`, `building_limit_reached`, `saltmark_too_low`, `max_level`, `upgrade_in_progress`, `job_already_finished`, `no_free_builder`, `insufficient_resources`, `not_a_producer`, `housing_full`, `barracks_required`, `barracks_level_too_low`, `batch_already_finished`, `cannot_raid_self`, `already_under_attack`, `village_shielded`, `target_cooldown`, `raid_in_progress`, `no_army`, `units_unavailable`, `raid_not_active`, `raid_abandoned`, `nothing_deployed`, `raid_not_resolved`, `idempotency_key_reused`, `already_claimed`, `already_in_clan`, `not_in_clan`, `clan_name_taken`, `clan_full`, `invalid_role_change`, `request_open`, `request_closed`, `exceeds_request`, `donor_limit`, `donation_cap_reached`, `own_request`, `recipient_housing_full`.
- Other codes: `400 malformed_json`, `400 invalid_token`, `401 unauthenticated`, `401 invalid_credentials`, `403 csrf_failed`, `403 forbidden`, `403 email_not_verified`, `404 not_found`, `413 payload_too_large`, `415 unsupported_media_type`, `422 validation_failed`, `429 rate_limited` (always with a `Retry-After` header in whole seconds, at least 1), `503 database_unavailable`.
- `401 unauthenticated` answers any route marked "session" when there is no valid session.
- **Idempotency-Key header**: 8 to 64 characters from letters, digits, `-` and `_`. A repeated key returns the stored status and body with header `Idempotent-Replayed: true`.

Objects:

- **Me**: `{"id","email","displayName","timeZone","verified","role":"islander"|"operator","villageId"|null,"trophies","league":"Mudflat"|"Shingle"|"Saltmarsh"|"Tidewall","clanId"|null}`. The operator's `trophies` is 0 and `league` is `"Mudflat"`.
- **Building**: `{"id","type","x","y","rotation","level","upgrade":null|{"toLevel","startedAt","finishesAt"},"uncollected"}`. `x`,`y` is the footprint's minimum corner cell, `rotation` is 0, 90, 180 or 270, `level` is 0 while a new building is under construction, and `uncollected` is present only on producers.
- **Army**: `{"units":{"saltjack","peat_slinger"},"training":[{"id","unit","count","startsAt","finishesAt"}],"housing":{"used","capacity"}}`. `training` lists the running batch and every waiting batch, in queue order.
- **Village** (owner only): `{"id","displayName","grid":{"width":40,"height":40},"buildings":[Building],"resources":{"brine":{"amount","cap"},"peat":{…},"copper":{…}},"saltmark","builders":{"total","free"},"army":Army,"shield":{"endsAt"}|null,"underAttack","trophies","league","serverTime"}`. `underAttack` is true while a locked or deploying raid targets the island.
- **Scout**: exactly `{"villageId","displayName","trophies","league","buildings":[{"id","type","x","y","rotation","level"}],"lootable":{"brine","peat","copper"}}`. It never includes the email, time zone, shield, army, training, upgrade state, ledger or any other field.
- **Raid**: `{"id","state":"locked"|"deploying"|"resolved"|"abandoned","endReason":null|"finalized"|"deadline_passed","attacker":{"villageId","displayName"},"defender":{"villageId","displayName"},"lockedAt","finalizeBy","seed","layout":[{"index","id","type","x","y","rotation","level","hp"}],"army":{"saltjack","peat_slinger"},"lootable":{…},"deploys":[{"tick","unit","x","y"}],"result":null|{"finalTick","destruction","stars","lootable":{…},"loot":{…},"transferred":{…},"trophies":{"attacker","defender"},"starBonus"},"resolvedAt"|null}`. The top-level `lootable` is the amount taken at lock, shown during the raid. `result.lootable` is the amount taken at resolution, which the simulation's loot uses.
- **Snapshot**: `{"raidId","tick","finalTick","destruction","stars","loot":{"brine","peat","copper"},"hash","buildings":[{"index","id","hp","destroyed"}],"units":[{"index","unit","x","y","hp","alive"}]}`
- **LedgerEntry**: `{"id","pairId","kind","asset","amount","counterparty":"tide"|{"villageId","displayName"},"raidId"|null,"createdAt"}`. `asset` is `brine`, `peat`, `copper`, `saltjack` or `peat_slinger`, and `amount` is a signed integer.
- **Member**: exactly `{"accountId","displayName","villageId","role":"skipper"|"mate"|"deckhand","trophies","donated","received","joinedAt","mateSince"|null}`. `mateSince` is set only on mates.
- **Message**: `{"id","author":{"accountId","displayName"},"body"|null,"removed","createdAt"}`
- **Request**: `{"id","requester":{"accountId","displayName"},"unit","count","given","state":"open"|"filled"|"closed","createdAt"}`

Endpoints. "Session" means a signed-in session is required. "Verified" adds `403 email_not_verified` for unconfirmed accounts. "Key" means an Idempotency-Key header is required.

| Method and path | Request | Success | Extra errors |
|---|---|---|---|
| GET `/api/health` | | `200 {"status":"ok"}` | never fails while the process serves |
| GET `/api/status` | | `200 {"database":"up"\|"down","mail":"up"\|"down"}` | never 503 |
| GET `/api/session` | | `200 {"user":Me\|null,"csrfToken"}`; sets the session cookie if absent | |
| POST `/api/auth/signup` | `{"email","password","displayName","timeZone"}` | `202 {"status":"check_email"}` | 422 |
| POST `/api/auth/verify` | `{"token"}` | `200 {"status":"verified"}` | 422, `400 invalid_token` |
| POST `/api/auth/resend-verification` | `{"email"}` | `202 {"status":"check_email"}` | 422 |
| POST `/api/auth/signin` | `{"email","password"}` | `200 {"user":Me,"csrfToken"}`; replaces the session cookie | 422, `401 invalid_credentials` |
| POST `/api/auth/signout` (session) | `{}` | `204` | |
| POST `/api/auth/forgot` | `{"email"}` | `202 {"status":"check_email"}` | 422 |
| POST `/api/auth/reset` | `{"token","password"}` | `200 {"status":"password_reset"}` | 422, `400 invalid_token` |
| GET `/api/me` (session) | | `200 Me` | |
| PATCH `/api/me` (session) | `{"displayName"?,"timeZone"?}` | `200 Me` | 422 |
| GET `/api/catalog` | | `200 {"buildings":[…],"units":[…]}`, the Business rules catalog with durations after scaling | |
| GET `/api/village` (session) | | `200 Village` | `404` for the operator |
| GET `/api/villages/{id}` (session) | | `200 Village` for your own island | `404` for any other id |
| POST `/api/village/buildings` (session) | `{"type","x","y","rotation"}` | `201 Building` | 422, `cell_occupied`, `building_limit_reached`, `no_free_builder`, `insufficient_resources` |
| PATCH `/api/village/buildings/{id}` (session) | `{"x","y","rotation"}` | `200 Building` | 404, 422, `cell_occupied` |
| POST `/api/village/buildings/{id}/upgrade` (session) | `{}` | `200 Building` | 404, `upgrade_in_progress`, `max_level`, `saltmark_too_low`, `no_free_builder`, `insufficient_resources` |
| POST `/api/village/buildings/{id}/cancel` (session) | `{}` | `200 {"building":Building\|null,"refunded":{…},"lost":{…}}` | 404, `job_already_finished` |
| POST `/api/village/buildings/{id}/collect` (session) | `{}` | `200 {"collected":{"brine","peat","copper"},"lost":{"brine","peat","copper"}}` | 404, `not_a_producer` |
| GET `/api/village/ledger?limit=<1–100>&before=<entryId>` (session) | | `200 {"entries":[LedgerEntry]}`, newest first, default limit 50 | 422 |
| GET `/api/army` (session) | | `200 {"army":Army}` | `404` for the operator |
| POST `/api/army/train` (session) | `{"unit","count"}` | `201 {"army":Army}` | 422, `barracks_required`, `barracks_level_too_low`, `housing_full`, `insufficient_resources` |
| POST `/api/army/training/{batchId}/cancel` (session) | `{}` | `200 {"army":Army,"refunded":{…},"lost":{…}}` | 404, `batch_already_finished` |
| GET `/api/scout/next` (session, verified) | | `200 {"match":Scout\|null}` | |
| GET `/api/villages/{id}/scout` (session, verified) | | `200 Scout` | 404, `cannot_raid_self`, `village_shielded`, `already_under_attack`, `target_cooldown` |
| POST `/api/raids` (session, verified, key) | `{"villageId"}` | `201 Raid` | 404, 422, `cannot_raid_self`, `village_shielded`, `already_under_attack`, `target_cooldown`, `raid_in_progress`, `no_army` |
| POST `/api/raids/{id}/deploys` (session, key) | `{"deploys":[{"tick","unit","x","y"}]}` | `200 Raid` | 404, 422, `raid_not_active`, `raid_abandoned`, `units_unavailable` |
| POST `/api/raids/{id}/finalize` (session, key) | `{}` | `200 Raid` | 404, `raid_not_active`, `raid_abandoned`, `nothing_deployed` |
| GET `/api/raids?role=attack\|defence` (session) | | `200 {"raids":[{"id","state","endReason","role","opponent":{"villageId","displayName"},"lockedAt","resolvedAt","stars","destruction","transferred"}]}`, newest first, at most 50 | 422 |
| GET `/api/raids/{id}` (session) | | `200 Raid` | 404 |
| GET `/api/raids/{id}/snapshot?tick=<n>` (session) | | `200 Snapshot` | 404. A missing `tick`, or one that is not a whole number, answers 422 on `tick` for any raid. On a raid that is not resolved (locked, deploying or abandoned), every `tick` written as a whole number answers `raid_not_resolved`, with no range check. Only on a resolved raid does a tick outside 0–finalTick answer 422 on `tick`. This row is the one exception to the error precedence. |
| GET `/api/me/rewards` (session) | | `200 {"serverTime","timeZone","daily":{"periodStart","periodEnd","claimed","nextClaimAt"\|null,"streak","streakEndsAt"\|null,"chest":{…}},"weekly":{"periodStart","periodEnd","claimed","nextClaimAt"\|null,"league","bonus":{…}},"starBonus":{"used","cap","periodEnd"}}` | |
| POST `/api/me/rewards/daily` (session) | `{}` | `200 {"credited":{…},"lost":{…},"streak","nextClaimAt"}` | `already_claimed` |
| POST `/api/me/rewards/weekly` (session) | `{}` | `200 {"credited":{…},"lost":{…},"league","nextClaimAt"}` | `already_claimed` |
| POST `/api/clans` (session, verified) | `{"name","motto"}` | `201 {"clan":…}` (as GET `/api/clan`) | 422, `already_in_clan`, `clan_name_taken` |
| GET `/api/clan` (session) | | `200 {"clan":null\|{"id","name","motto","trophies","rank","myRole","members":[Member]}}` | |
| POST `/api/clan/invitations` (session, verified) | `{"email"}` | `202 {"status":"invited"}` | `forbidden`, 422 |
| GET `/api/me/invitations` (session) | | `200 {"invitations":[{"id","clan":{"id","name"},"invitedBy":{"displayName"}}]}`, empty until verified | |
| POST `/api/invitations/{id}/accept` (session, verified) | `{}` | `200 {"clan":…}` | 404, `already_in_clan`, `clan_full` |
| POST `/api/invitations/{id}/decline` (session) | `{}` | `204` | 404 |
| POST `/api/clan/members/{accountId}/promote` (session) | `{}` | `200 Member` | 404, `forbidden`, `invalid_role_change` |
| POST `/api/clan/members/{accountId}/demote` (session) | `{}` | `200 Member` | 404, `forbidden`, `invalid_role_change` |
| DELETE `/api/clan/members/{accountId}` (session) | | `204` | 404, `forbidden`, `invalid_role_change` |
| POST `/api/clan/leave` (session) | `{}` | `200 {"clan":null,"newSkipper":{"accountId","displayName"}\|null,"disbanded"}` | |
| GET `/api/clan/messages?after=<messageId>` (session) | | `200 {"messages":[Message]}`, oldest first, at most 50 | 422 |
| POST `/api/clan/messages` (session, verified) | `{"body"}` | `201 Message` | 422 |
| DELETE `/api/clan/messages/{id}` (session) | | `204` | 404, `forbidden` |
| GET `/api/clan/requests` (session) | | `200 {"requests":[Request],"mine":Request\|null}`; `requests` holds open requests only, `mine` is the caller's most recent request in this clan in any state | |
| POST `/api/clan/requests` (session, verified) | `{"unit","count"}` | `201 Request` | 422, `request_open` |
| POST `/api/clan/requests/{id}/cancel` (session) | `{}` | `200 Request` | 404, `forbidden` when the caller is not the requester, `request_closed` |
| POST `/api/clan/requests/{id}/donations` (session, verified) | `{"count"}` | `201 {"request":Request,"donation":{"unit","count","pairId"}}` | 404, 422, `own_request`, `request_closed`, `exceeds_request`, `donor_limit`, `donation_cap_reached`, `units_unavailable`, `recipient_housing_full`, `raid_in_progress` |
| GET `/api/league/clans` | | `200 {"clans":[{"rank","id","name","trophies","memberCount"}]}`, top 50 | |
| GET `/api/ops/status` (session, operator) | | `200 {"database","mail","queuedMail"}` | |
| POST `/api/ops/raids/{id}/rerun` (session, operator) | `{}` | `200 {"raidId","seed","finalTick","match","firstMismatchTick"\|null,"result":{…}}` | 404, `raid_not_resolved` |
| GET `/api/ops/ledger/check` (session, operator) | | `200 {"pairs","unbalancedPairs","overCap"}` | |

The operator may read any raid and its snapshots through the raid endpoints.

### Business rules (DP-01–DP-07, DP-10–DP-14, DP-17–DP-20, DP-24–DP-29, DP-32–DP-36, DP-40, DP-46–DP-48, DP-51–DP-58, DP-61–DP-63, DP-67, DP-68)

**Accounts.**

- Field rules:
  - Email: valid format, at most 254 characters, compared case-insensitively.
  - Password: 10 to 128 characters, stored only as an argon2id hash with 19,456 KiB of memory, 2 iterations and parallelism 1.
  - Display name: 3 to 20 letters, digits, spaces, `-` or `_`.
  - Time zone: any IANA zone name the server's zone database knows, including `UTC`.
- Account states are unverified and verified. Unverified islanders may build, collect, train and claim rewards. Scouting, raiding and all clan actions except reading `/api/clan`, reading invitations and declining need a verified account.
- Sign-up creates the account and its starter island (see Seed data) in one step.
- Sign-up, resend-verification and forgot each answer exactly the same status and body for registered, unregistered, verified and unverified addresses. Each one that is not throttled queues exactly one mail to that address with the same subject (see Services), and the response never waits for mail delivery. Sign-up never changes an existing account.
- **One live link**: issuing a confirmation link invalidates every earlier unused confirmation link for that account, and issuing a reset link does the same for reset links. Issuing the new link and invalidating the earlier ones happen in one transaction that holds a lock on that account, so of several links issued for one account at the same instant, exactly one works afterwards: the one with the latest issue time. Every other answers `invalid_token`.
- A confirmation link works while the current time is strictly before its issue time plus the verification lifetime. A reset link works only before its issue time plus the reset lifetime, and only once.
- Completing a reset sets the new password, marks the account verified, and ends every session of that account. Any request on an ended session answers `401 unauthenticated`.
- Sign-in with a wrong password or an unknown email answers the identical `invalid_credentials`. Unverified accounts may sign in.
- Sessions end at sign-out, at password reset, or when the session lifetime has passed since sign-in.

**Throttles.** Requests refused with 429 do not count towards a limit. Limits use a sliding window: a request is refused when the window before it already holds the limit's count, and `Retry-After` is the whole seconds, rounded up and at least 1, until the oldest counted request leaves the window. Checking a limit and counting the request happen together under one lock per limit key, so when requests arrive at the same instant exactly the limit's count is accepted and the rest answer 429. For example, 9 simultaneous wrong-password sign-ins for one email give exactly 5 `invalid_credentials` and 4 `rate_limited`.

- Sign-in: 5 attempts per email address per 60 seconds, counted whether the attempt succeeds or fails and whether or not the address is registered.
- Forgot: 3 requests per email address per 60 seconds.
- Resend-verification: 3 requests per email address per 60 seconds, counted separately from forgot.
- Clan chat: 5 posts per account per 10 seconds.

**Who may see and do what.**

- Full village, ledger, army, raid, raid list and snapshot reads only ever cover the caller's own island and the raids where the caller is the attacker or the defender. Any other village or raid id answers `404 not_found`, the same as an id that does not exist. The operator may read every raid.
- A caller who belongs to no clan gets `not_in_clan` from every route whose path starts with `/api/clan/`, before any target id is resolved, as placed in the API precedence list.
- Clan routes resolve the target member, message, request or invitation within the caller's own clan or invitations. Anything outside that answers `404`.
- Role and membership are read fresh from the database on every request, so a demotion, removal or leave applies to that member's very next request in the same session. A removed member's next clan request answers `not_in_clan`.
- `/api/ops/*` routes answer `403 forbidden` to every non-operator.
- Clan roles are skipper (exactly one per clan), mate and deckhand. Wardens are the skipper and the mates. A clan holds at most 4 mates. Warden rules:

| Action | Skipper | Mate | Deckhand |
|---|---|---|---|
| Invite by email | yes | yes | `forbidden` |
| Delete any message | yes | yes | `forbidden` |
| Remove a deckhand | yes | yes | `forbidden` |
| Remove a mate | yes | `forbidden` | `forbidden` |
| Remove the skipper | `invalid_role_change` | `forbidden` | `forbidden` |
| Promote deckhand → mate | yes | `forbidden` | `forbidden` |
| Promote mate → skipper (the old skipper becomes a mate) | yes | `forbidden` | `forbidden` |
| Promote the skipper | `invalid_role_change` | `forbidden` | `forbidden` |
| Demote mate → deckhand | yes | `forbidden` | `forbidden` |
| Demote a deckhand or the skipper | `invalid_role_change` | `forbidden` | `forbidden` |

  `forbidden` is decided first, from the caller's role and the target's current role as in the table. Only a caller the table allows can get `invalid_role_change`, which answers removing, promoting or demoting yourself, promoting the skipper, demoting a deckhand, and promoting a deckhand when the clan already has 4 mates.
- **Role changes apply one at a time**: every promote, demote, remove, leave and accept on a clan runs under a lock on that clan, and each is judged against the state the earlier ones left. So when a promote and a remove on the same member race, the member ends either removed with no role, or promoted and still a member when the remove was refused by the rules. A promote or demote that commits after the member's removal answers `404 not_found`.

**Catalog.** The grid is 40 × 40 cells, with x to the right and y downwards. The build area is cells 2 to 37 in both directions. The outer two-cell ring (x or y equal to 0, 1, 38 or 39) is the tidal deploy ring and holds no buildings. Footprints are width × depth at rotation 0 and 180; at 90 and 270 they swap. Every building type has levels 1 to 3; level 3 is the highest level in the catalog. "Max count" is the most of that type one island may hold. Costs and durations are per level, for level 1 / 2 / 3, and every upgrade to level 3 also costs 200 copper on top of the listed cost.

| Type key | Name | Footprint | Max count | Cost per level | Build seconds | Hit points | Effect per level |
|---|---|---|---|---|---|---|---|
| `brine_pan` | Brine Pan | 3×3 | 4 | 150/600/2,000 peat | 10/60/180 | 400/500/650 | 600/1,200/2,000 brine per hour; buffer 1,000/2,500/5,000 |
| `peat_cutter` | Peat Cutter | 2×3 | 4 | 150/600/2,000 brine | 10/60/180 | 400/500/650 | 600/1,200/2,000 peat per hour; buffer 1,000/2,500/5,000 |
| `copper_sluice` | Copper Sluice | 2×3 | 2 | 500/1,500/3,000 brine plus as much peat | 20/90/240 | 400/500/650 | 60/120/200 copper per hour; buffer 200/400/800 |
| `brine_cistern` | Brine Cistern | 3×3 | 2 | 300/1,200/3,000 peat | 10/60/180 | 600/800/1,000 | +5,000/+12,000/+25,000 brine cap |
| `peat_rick` | Peat Rick | 3×3 | 2 | 300/1,200/3,000 brine | 10/60/180 | 600/800/1,000 | +5,000/+12,000/+25,000 peat cap |
| `copper_vault` | Copper Vault | 3×3 | 1 | 1,000/2,500/5,000 brine plus as much peat | 30/120/300 | 700/900/1,100 | +500/+1,200/+2,500 copper cap |
| `tide_barracks` | Tide Barracks | 3×3 | 1 | 200/800/2,500 brine | 10/60/180 | 500/650/800 | L1 trains Saltjacks, L2 and up also Peat Slingers |
| `driftwood_camp` | Driftwood Camp | 3×3 | 2 | 200/800/2,500 peat | 10/60/180 | 400/500/600 | 20/30/40 housing |
| `kiln_tower` | Kiln Tower | 3×3 | 3 | 300/1,000/2,500 brine plus as much peat | 15/90/240 | 600/750/900 | 40/55/70 damage per shot, range 7 cells, fires every 8 ticks |

| Unit key | Name | Housing | Cost | Train seconds | Hit points | Damage | Attacks every | Range | Speed |
|---|---|---|---|---|---|---|---|---|---|
| `saltjack` | Saltjack | 1 | 25 brine | 5 | 120 | 12 | 5 ticks | 0.8 cell | 0.015 cell per tick |
| `peat_slinger` | Peat Slinger | 1 | 40 brine | 8 | 50 | 9 | 6 ticks | 3.5 cells | 0.018 cell per tick |

Every build and training duration actually applied is the published seconds divided by `BUILD_TIME_DIVISOR` and rounded up to a whole second, at least 1. `/api/catalog` reports the applied values.

**Placement and jobs.**

- A placement or move succeeds only when all of these hold:
  - The rotated footprint lies wholly inside the build area. Otherwise it answers 422 on `x` or `y`.
  - The footprint overlaps no other building. A building being moved ignores its own old cells. Otherwise it answers `cell_occupied`.
  - The island holds fewer buildings of that type than its max count. Otherwise it answers `building_limit_reached`.
- Buildings are never demolished, so every island keeps the Kiln Tower it starts with.
- A new building starts at level 0 with a job to level 1. Placing and upgrading both need a free builder and the level's full cost. The cost is debited when the job starts, and the job finishes at start plus the applied duration.
- The island's saltmark is the sum of the completed levels of all its buildings. A building under construction to level 1 counts 0, and an upgrading building counts its current level.
- An upgrade targets the building's current level + 1. Upgrading checks, in this order: a running job answers `upgrade_in_progress`; a building already at level 3 answers `max_level`; a saltmark below the target level's threshold answers `saltmark_too_low`; then the builder and cost checks. Level 2 needs a saltmark of 5 or more, and level 3 needs 15 or more. Placing a new building needs no saltmark.
- A job is complete when the current time is at or after its finish time.
- Completed jobs and finished training batches are applied, in finish order, before any read or change of that island returns. This happens on every route that touches the island, including scouts, raid locks, resolutions and donations.
- Builders total = min(5, 2 + floor(saltmark ÷ 8)). Free builders = builders total − running jobs.
- **Cancel** is decided at the instant it commits, after the completed-job step above. A cancel that commits strictly before the job's finish time refunds the job's full cost, each resource capped by storage room with any excess lost, and frees the builder; the building keeps its old level, and cancelling a new building's first job removes the building. A cancel on a building with no running job, including one whose job finished at or before the commit instant, answers `job_already_finished`, refunds nothing, and the level is gained. A cancel therefore never both refunds and gains the level.
- Moving or rotating keeps the level, the running job and a producer's uncollected output.

**Storage, production and the ledger.**

- Storage cap per resource = the island's base storage of 2,000 brine, 2,000 peat and 200 copper + the sum of every storage building's cap at its current completed level. A level-0 building adds nothing.
- Every credit is capped so that no balance exceeds its cap. Any excess is lost and reported as `lost`.
- A producer's uncollected output = min(buffer, floor(hourly rate × whole milliseconds since its accrual start ÷ 3,600,000)). The accrual start is the producer's last collection, or the finish of its last job.
- Collecting credits min(uncollected, room), reports the rest as lost, and restarts accrual at the collection instant. `collected` and `lost` always carry all three resources, with 0 for those not involved. A collection that credits and loses nothing writes no ledger pair.
- Collections of one producer run one at a time under the island lock, each judged on the accrual the earlier one left. So of several collects of one producer at the same instant, exactly one credits the accrued output, every other answers 200 with every `collected` amount 0, and the ledger holds exactly one `production` pair for them.
- Starting an upgrade on a producer first collects it. A producer with a running job produces nothing, and its accrual restarts when the job finishes.
- Every movement of a resource or unit is one ledger pair of two rows with opposite amounts and one `pairId`. The other side is either another island or the tide (the world account).
- `kind` is one of `starter`, `production`, `build_spend`, `refund`, `train_spend`, `train_complete`, `raid_loot`, `raid_deploy`, `star_bonus`, `daily_chest`, `league_bonus`, `donation`.
- Each balance and each army count is the sum of that island's rows for the asset. Corrections are new pairs, never edits.
- **Whole changes only**: everything one request changes (both rows of every pair, balances, jobs, batches, raids, claims, roles) commits in one transaction or not at all. A request cut off by a database failure leaves nothing behind.
- Every change that touches a balance runs under a lock on that island's balances. Two concurrent spends whose combined cost exceeds the balance leave exactly one successful spend, the other answering `insufficient_resources`, and no balance ever goes below zero. Two concurrent jobs competing for the last free builder leave exactly one, the other answering `no_free_builder`.

**Training and housing.**

- Training needs a completed Tide Barracks (`barracks_required`). Peat Slingers need it at level 2 or higher (`barracks_level_too_low`).
- `count` is 1 to 20. The cost for the whole batch is debited at queue time.
- **Queue order**: batches run one after another in the order they were queued. A batch's duration is count × the applied unit time. The first batch in the queue starts at the later of its enqueue instant and the instant the batch ahead of it finished or was cancelled. Every other batch starts at the finish of the batch directly ahead of it. Each batch finishes at its start plus its duration, and its whole count is credited to the army then (`train_complete`).
- **Cancelling a batch** is decided at the instant it commits. A batch that has not started is removed and its full cost refunded up to storage room, with any excess lost, so every later batch's start and finish move earlier by the cancelled batch's full duration. Cancelling the running batch refunds its full cost the same way, and the next batch starts at the cancel instant. A batch that finished at or before the commit instant answers `batch_already_finished` and refunds nothing. A batch that was already cancelled answers `404`.
- Housing capacity = the sum of completed Driftwood Camps' housing. Housing used = army units + units in waiting and running batches. A batch that would push used above capacity answers `housing_full`.

**Matchmaking and scouting.**

- Lootable amount per resource = floor(balance × 20 ÷ 100) of the defender's balance at the instant it is taken.
- An island is eligible for you when all of these hold: its owner is verified; it is not yours; its owner is not in your clan; it is not shielded; it has no locked or deploying raid; and you are not in your same-target cooldown for it.
- `/api/scout/next` picks uniformly at random among the 10 eligible islands whose trophies are closest to yours, or returns `{"match":null}`.
- Scouting a specific island answers the first conflict that applies: `cannot_raid_self`, `village_shielded`, `already_under_attack`, then `target_cooldown`.

**Raid lifecycle.**

- States: locked → deploying (on the first accepted deploy batch) → resolved (on finalize, `endReason` `finalized`) or abandoned (when the finalize deadline passes, `endReason` `deadline_passed`). Resolved and abandoned are final. `endReason` is null while the raid is locked or deploying.
- Deploy and finalize on a resolved raid answer `raid_not_active`, and on an abandoned raid answer `raid_abandoned`. Only the attacker may deploy and finalize; for anyone else the raid answers `404`.
- **Serialised per island**: a lock, a resolution, an abandonment and every spend, collection, training, cancel, reward credit or donation on an island run one at a time under that island's lock. A request touching two islands takes both locks.
- **Lock**:
  - Locking answers the same conflicts as scouting, plus `raid_in_progress` when you already have a locked or deploying raid and `no_army` when your army is empty.
  - When several raiders lock the same island at the same moment, exactly one gets `201`, and every other gets `already_under_attack`.
  - The lock stores a seed (uniform at random in 1 to 4,294,967,295), the layout (every building at level 1 or higher, ordered by creation instant and then id, with `index` as the position), the attacker's army at that moment as the reserved army, the lock-time lootable amounts, and `finalizeBy` = lock time + the finalize lifetime.
  - Locking leaves the attacker's own shield, if any, running until its end.
- **Deploy batches**:
  - A batch has 1 to 50 entries, and a raid holds at most 200 entries in total.
  - `tick` is an integer 0 to 1,799.
  - Ticks never decrease within a batch, and a batch's first tick is not below the last stored tick.
  - `x`,`y` is a cell on the tidal deploy ring.
  - `unit` is a unit key.
  - Each of these breaks answers 422 keyed by position, like `deploys[3].tick`.
  - Deploying more of a unit than the reserved army holds answers `units_unavailable`.
- **Finalize**:
  - Finalize with no deploys answers `nothing_deployed`.
  - A finalize received strictly before `finalizeBy` resolves the raid, even if resolution finishes later. At or after `finalizeBy` the raid is abandoned.
  - Abandonment is applied before any read or change of the raid or either island, so other raiders can lock the target again. This includes the first read after a database outage: a raid whose `finalizeBy` passed while the database was unreachable reads as abandoned with `endReason` `deadline_passed`, its lock is released, and a finalize sent after recovery answers `raid_abandoned`.
  - An abandoned raid moves no units, loot or trophies, starts no cooldown and grants no shield.
- **Resolution**, in one transaction holding both islands' locks, at the instant it commits:
  1. Take the resolution lootable amounts from the defender's balances at that instant, after every spend that committed before it, and store them as `result.lootable`.
  2. Run the battle simulation, and store the result and the state hash of every tick from 0 to the final tick.
  3. For each resource, transfer min(simulated loot at the final tick, the attacker's room) as one `raid_loot` pair: a defender debit and an attacker credit of that same amount.
  4. Debit every deployed unit from the attacker to the tide (`raid_deploy`).
  5. Apply trophies.
  6. Apply the star bonus.
  7. Set the defender's shield if earned.
  8. Start the attacker's same-target cooldown at `resolvedAt`, which is the commit instant.

  A defender spend that commits after the resolution is judged on the post-loot balance and answers `insufficient_resources` if it no longer fits.
- **Trophies**: an attacker earning one or more stars gains floor(destruction ÷ 4) trophies, and the defender loses half that amount, rounded down. A zero-star raid costs the attacker 3 and gives the defender 3. Trophies never go below 0. The stored change is the amount actually applied.
- **Leagues** by current trophies, shown in Me, the scout report and the top rule:

| League | Trophies |
|---|---|
| Mudflat | 0 to 399 |
| Shingle | 400 to 799 |
| Saltmarsh | 800 to 1,199 |
| Tidewall | 1,200 and over |

- **Star bonus**: the attacker's first 5 raids with one or more stars that resolve within their current local day each earn 100 brine per star from the tide (`star_bonus`), capped by room. Later starred raids that day earn 0. The cap is 5.
- **Shield**: a resolved defence in which the attacker earned 2 or more stars shields the defender from `resolvedAt` until `resolvedAt` + the shield lifetime. A later shield replaces an earlier one only if it ends later. The island is shielded while the current time is at or after the shield's start and strictly before its end. Because locks and resolutions on an island run one at a time, a lock racing that resolution either commits first (and answers `already_under_attack`, since the first raid still holds the island) or commits after it (and answers `village_shielded`); no raid lock ever commits on the island while the shield runs.
- **Same-target cooldown**: the attacker cannot lock the same island while the current time is strictly before `resolvedAt` + the cooldown lifetime.

**Battle simulation.** All quantities are integers.

- **Units and arithmetic**: positions are in thousandths of a cell, so cell (x, y) spans x×1000 to x×1000+1000. Integer division truncates toward zero, and square roots are integer floor square roots. One tick is a tenth of a second of simulated time, and the raid window is 180 simulated seconds, ticks 0 to 1,800.
- **Random draws**: a 32-bit unsigned xorshift generator seeded with the raid seed. Each draw shifts the state left 13 bits (keeping 32 bits) and XORs it in, then shifts right 17 bits and XORs it in, then shifts left 5 bits (keeping 32 bits) and XORs it in. It returns the new state.
- **Damage**: each hit deals floor(base damage × (90 + draw mod 21) ÷ 100), using one draw per hit in the order hits happen.
- **Distances**: the distance from a point to a building is measured to the nearest point of its footprint rectangle, and squared distances are compared. A target is within range when its squared distance, in thousandths, is less than or equal to the squared range in thousandths, so the edge itself is in range (a Saltjack reaches 800 thousandths, a Peat Slinger 3,500 and a Kiln Tower 7,000).
- **Snapshot tick n** is the state after n steps, so tick 0 is the untouched layout with no units. Step k (producing tick k+1) runs in this order:
  1. Every deploy with tick k spawns, in deploy-list order, at its cell's centre (cell × 1000 + 500 on each axis) with full hit points and cooldown 0.
  2. Each living unit acts, in spawn order:
     - If it has no target, or its target is destroyed, it targets the nearest standing building, with ties going to the lower layout index.
     - If the target is within range and its cooldown is 0, it hits the target and its cooldown becomes interval − 1.
     - Otherwise its positive cooldown drops by 1, and if the target is out of range it moves min(speed, distance) toward the target's nearest footprint point. Each axis moves by axis difference × step ÷ distance.
     - Units walk over buildings, and nothing blocks them.
  3. Each standing Kiln Tower acts, in layout order. Measuring from its footprint centre, it picks afresh each step the nearest living unit within its range, with ties going to the lower spawn index. If its cooldown is 0 and it has a target, it hits and its cooldown becomes 7. If its cooldown is 0 and no unit is in range, the cooldown stays 0. A positive cooldown drops by 1 whether or not it has a target.
  4. Damage applies at once, and hit points of buildings and units never go below 0, so an overkill hit leaves exactly 0. A building at 0 hit points is destroyed at once, and a unit at 0 hit points dies at once. Destroyed towers do not fire and dead units do not act.
- **Destruction** = floor(100 × destroyed layout buildings ÷ layout buildings).
- **Stars** at a tick count three marks, each kept once earned: the Ebb mark when destruction is 40 or more; the Flood mark when every Kiln Tower in the layout is destroyed; and the Spring mark when destruction reached 80 or more at some tick of 900 or less.
- **Loot** per resource at a tick = floor(resolution lootable × destruction ÷ 100).
- **Final tick**: the first tick n at which destruction is 100, or at which every spawned unit is dead and no deploy has a tick of n or later. Otherwise it is 1,800.
- **State hash** of a tick: 32-bit FNV-1a, starting from 2166136261 and multiplying by 16777619 modulo 2³² after XORing each byte. It runs over the 4-byte little-endian two's-complement form of this integer sequence:
  - tick, destruction, stars
  - loot brine, loot peat, loot copper
  - each layout building's hit points in layout order
  - each spawned unit's x, y and hit points in spawn order (dead units keep their last position with hit points 0)

  It is written as 8 lowercase hex digits.
- The same seed, layout, deploy list and resolution lootable amounts always produce the same hashes, destruction, stars and loot on the server and in the browser.
- **Operator re-run** recomputes from those stored inputs and compares every tick's hash with the stored hashes. It reports `match` and the first differing tick.

**Idempotency.**

- Start-raid, deploy and finalize need a key. Keys are scoped to the account plus the method and path, and are kept for at least 24 hours.
- The first response with a status below 500 is stored against the key and the request body, compared as parsed JSON. A repeat with the same key and the same body returns the stored response without running again, even if the raid has since changed state. So a retried start never creates a second raid, and a retried finalize never moves loot twice.
- The same key with a different body answers `idempotency_key_reused`.
- Responses of 500 and above are not stored, so a retry runs again.

**Local days and weeks.**

- The islander's local day starts at 00:00 in their saved zone and lasts until the next local day starts. Their local week starts at Monday 00:00 in that zone. So a daylight-saving day may last 23, 23.5, 24.5 or 25 hours, and a week containing a change is shorter or longer by the same amount.
- **Missing midnight**: where 00:00 does not exist on a date because the clock jumps over it, that day starts at the first instant that exists after the gap. For example, in America/Santiago on the day its clocks jump from 24:00 to 01:00, the local day starts at 01:00.
- **Repeated midnight**: where 00:00 occurs twice, the day starts at its first occurrence.
- Periods include their start instant and exclude their end instant, and are computed from the server's clock only.
- `daily.periodStart`/`periodEnd` and `weekly.periodStart`/`periodEnd` in `/api/me/rewards` are the current local day and week in the currently saved zone.

**Daily chest and streak.**

- Each daily claim records its instant, its local day (in the zone saved at that claim) and its streak step, and pays that step's chest from the tide (`daily_chest`), capped by room:

| Streak step | Chest |
|---|---|
| 1 | 300 brine, 300 peat |
| 2 | 400 brine, 400 peat |
| 3 | 500 brine, 500 peat, 20 copper |
| 4 | 600 brine, 600 peat, 30 copper |
| 5 | 700 brine, 700 peat, 40 copper |
| 6 | 800 brine, 800 peat, 50 copper |
| 7 | 1,000 brine, 1,000 peat, 100 copper |

- **Next claim**: when the saved zone equals the zone of the last daily claim, the next claim opens at the end of that claim's local day. When the zone has changed since, it opens at the later of the first local day start in the new zone strictly after the last claim's instant, and 20 hours after the last claim's instant. A claim before the next claim opens answers `already_claimed` with `nextClaimAt` set to that instant.
- **Streak**: the streak deadline is the end of the local day, in the currently saved zone, that contains the instant the next claim opens. A claim made before the deadline continues the streak at the previous step + 1, wrapping from 7 to 1. A claim at or after the deadline, or a first claim, is step 1.
- In `/api/me/rewards`, `daily.claimed` is true while a new claim is not yet allowed, and then `nextClaimAt` is the instant it opens. While a claim is allowed, `claimed` is false and `nextClaimAt` is null. `streak` is the last claim's step while the current time is before the streak deadline, otherwise 0, and `streakEndsAt` is the deadline (null when `streak` is 0). `chest` is what the next claim pays: the step after `streak`, wrapping from 7 to 1, or step 1 when `streak` is 0.
- Claims for one account run one at a time under a lock on the account, so of several daily claims at the same instant exactly one answers 200 and every other answers `already_claimed` with the same `nextClaimAt`.

**Weekly tide-league bonus.**

- Paid by the current league from the tide (`league_bonus`), capped by room: Mudflat 1,000 brine and 1,000 peat; Shingle 2,000 brine, 2,000 peat and 50 copper; Saltmarsh 3,000 brine, 3,000 peat and 100 copper; Tidewall 5,000 brine, 5,000 peat and 300 copper.
- When the saved zone equals the zone of the last league claim, the next claim opens at the end of that claim's local week. When it has changed since, it opens at the later of the first local Monday 00:00 (under the missing- and repeated-midnight rules) in the new zone strictly after the last claim's instant, and 6 days (144 hours) after the last claim's instant. `weekly.claimed`, `nextClaimAt` and `already_claimed` follow the daily rules, with the same one-at-a-time rule for simultaneous claims.
- A zone change therefore applies to the reward clocks only from the next claim on, and never yields an extra claim.
- The star-bonus cap counts starred raids resolved within the current local day in the currently saved zone, and `starBonus.periodEnd` is that day's end.

**Clans.**

- **Founding and size**: a clan name is 3 to 24 characters and unique ignoring case among existing clans. A motto is 0 to 80 characters. The founder becomes skipper. A clan holds at most 10 members, and a second clan membership answers `already_in_clan`.
- **Invitations**: an invitation stores the email and its inviter whether or not an account uses the email, and the answer is always the same. It appears in the invitations list of a verified account with that email until accepted, declined or cancelled. Every invitation request from a warden the role rules allow queues exactly one invitation mail to that address, whether or not an account uses it, the address already belongs to a clan member, or it already has a pending invitation to this clan. An address already in the clan or already holding a pending invitation to it gets no second invitation record, only the mail.
- An invitation is cancelled the moment its inviter stops being a warden of that clan (demoted, removed or left) or the clan is dissolved. A cancelled invitation answers `404 not_found` to accept and decline.
- **Accepting** runs under the clan lock and checks, in this order: the invitation is still pending (`404`), the account has no clan (`already_in_clan`), the clan has fewer than 10 members (`clan_full`). So when several invitees accept at once into a clan with one free place, exactly one joins and every other answers `clan_full`, and an accept racing its inviter's demotion, removal or leave either commits first and joins, or answers `404` and leaves no membership.
- **Leaving**: any member may leave. A member who leaves or is removed has their open request closed. When the skipper leaves, the skipper role passes at once to the mate with the earliest `mateSince`; with no mate, to the member with the earliest `joinedAt`; ties go to the lower account id. A mate promoted to skipper loses `mateSince`, and a skipper who hands over by promotion becomes a mate with `mateSince` at that instant. When the last member leaves, the clan is dissolved and its name is free for a new clan at once.
- **Chat**: a message is 1 to 500 characters after trimming, stored and returned exactly as typed. A warden's deletion keeps the message with `removed` true and `body` null.
- **Clan trophies** = the sum of current members' trophies. Rank orders clans by trophies descending, then name ascending.

**Donations.**

- A request names one unit key and a `count` of 1 to 6. A member has at most one open request (`request_open`). The requester may cancel their open request, which closes it.
- A donation gives units of the request's unit. Its `count` is 1 to 3 (422 on `count` outside that range). Then, in this order: the donor cannot be the requester (`own_request`); a filled or closed request answers `request_closed`; a count above what the request still needs answers `exceeds_request`; a donor's total to one request is at most 3 (`donor_limit`); the donor's total donated units in their current local day plus this count is at most 8 (`donation_cap_reached`, with `nextDonationAt` set to the start of the donor's next local day); the donor must hold the units (`units_unavailable`); the recipient must have housing room for them (`recipient_housing_full`); and the donor must not have a locked or deploying raid (`raid_in_progress`).
- The donor's local day is the local day rule above in the donor's currently saved zone, including the missing- and repeated-midnight rules.
- A donation is one `donation` pair: a donor debit and a recipient credit of the same count. The request becomes filled when `given` equals its count.
- Donations to one request run one at a time under a lock on the request, together with the donor's and the recipient's island locks, and each is judged against the state the earlier ones left. So the request is never overfilled; a donation that commits after the request was filled, cancelled or closed because its owner left answers `request_closed` and moves no units; and a donation that would overflow the recipient's housing after the recipient's own training or other donations committed first answers `recipient_housing_full`.
- A member's `donated` and `received` are the sums of their donation rows within the current clan since they joined.

### Services (DP-01, DP-02, DP-04, DP-06, DP-51, DP-68, DP-69)

**PostgreSQL**:

- Holds every piece of state: accounts and argon2id hashes, sessions, villages and buildings, job and training timestamps, the ledger, raids with seed, layout, deploys, resolution lootable amounts, per-tick hashes and result, shields and cooldowns, reward claims, clans, roles, invitations, chat, requests, throttle counters, idempotency records and the mail queue.
- The app connects as a non-superuser through `DATABASE_URL` and applies its schema and seed data idempotently on every start, so an empty database becomes ready without a separate step.
- Spends, raid locks, resolutions, collections, claims, role changes, accepts and donations use row locks or serializable transactions as Business rules describe.
- **While PostgreSQL is unreachable**:
  - The process keeps running.
  - `/api/health` still answers its normal body.
  - `/api/status` reports `"database":"down"`.
  - Every other API route answers `503 {"error":"database_unavailable","message":"…"}`.
  - The built client is still served, so the screen shows the database outage copy from Feedback states.
  - The database counts as unreachable whenever a connection cannot be opened or an open one drops. This includes a database that refuses new connections or ends the app's existing ones. A request in flight when that happens answers `503 database_unavailable` and commits nothing.
  - The app retries the connection at least every 5 seconds, and serves normally within 10 seconds of the database becoming reachable, without a restart.
  - After recovery, every committed movement has both ledger rows, every balance equals the sum of its rows, and requests that did not commit leave nothing behind.

**Mailpit**:

- Mail goes over SMTP to `SMTP_HOST`:`SMTP_PORT`, without authentication or TLS.
- Every message's From header is exactly `MAIL_FROM`. The environment sets it to the brief's From line, `Saltreach <tides@saltreach.lowtide.test>`, and the app uses that same line when it is unset.
- Links are built on `APP_PUBLIC_URL`.

| Trigger | To | Subject | Body |
|---|---|---|---|
| Sign-up or resend-verification for an unverified account | the address | `Confirm your Saltreach email` | link `<APP_PUBLIC_URL>/verify?token=<token>` |
| Sign-up or resend-verification for a verified account | the address | `Confirm your Saltreach email` | says the address already has an account, with links to `/signin` and `/forgot` |
| Sign-up or resend-verification for an unregistered address | the address | `Confirm your Saltreach email` | sign-up creates the account and this becomes the first row; resend says no account uses the address and links to `/signup` |
| Forgot for a registered address | the address | `Reset your Saltreach password` | link `<APP_PUBLIC_URL>/reset?token=<token>` |
| Forgot for an unregistered address | the address | `Reset your Saltreach password` | says no account uses the address and links to `/signup` |
| Clan invitation | the invited address | `<inviter display name> invited you to <clan name> on Saltreach` | how to accept from the Clan panel, with a link to `/signup` when the address has no account |

Tokens are at least 32 random URL-safe characters. A throttled request queues no mail.

**Mail queue**:

- Every message is first written to the mail queue in PostgreSQL, in the same transaction as the change that caused it. A sender delivers queued messages, retrying at least every 10 seconds.
- Each message is claimed before sending and marked sent afterwards, so it is delivered exactly once even when several app processes share the database.
- `mail` in `/api/status` is `down` when the most recent delivery attempt, or the SMTP probe made at least every 10 seconds, failed. Otherwise it is `up`.
- **While Mailpit is unreachable**: requests answer their normal responses and the messages wait in the queue. Each one is delivered exactly once within 30 seconds of Mailpit becoming reachable, whichever process sends it.

### Seed data (DP-09, DP-35, DP-54, DP-58, DP-67)

Every seeded person, clan and place is invented. Seed data is applied once, idempotently, on start.

**Starter island**. Every new account and every seeded islander starts with:

| Building | Level | Minimum corner (x, y) | Rotation |
|---|---|---|---|
| Tide Barracks | 1 | 12, 18 | 0 |
| Driftwood Camp | 1 | 25, 18 | 0 |
| Brine Pan | 1 | 12, 24 | 0 |
| Peat Cutter | 1 | 26, 24 | 0 |
| Kiln Tower | 1 | 18, 26 | 0 |

Starter balances are 1,500 brine, 1,500 peat and 100 copper, with an army of 10 Saltjacks, each written as a `starter` pair from the tide. Trophies start at 0, there is no shield, and the producers' accrual starts at account creation. So, for example, with the seed data at start, a new islander's top rule reads Brine 1,500 / 2,000, Peat 1,500 / 2,000, Copper 100 / 200, Builders 2/2, Saltmark 5, Army 10/20, Trophies 0 and League Mudflat.

**Accounts**. All are verified.

| Display name | Email | Password | Role | Time zone | Trophies | Clan |
|---|---|---|---|---|---|---|
| Studio Ops | ops@lowtide.test | Tideline-Operator-27 | operator (no village) | UTC | — | — |
| Ivo Brack | ivo@lowtide.test | Saltpan-Ivo-27 | islander | America/Chicago | 120 | Brackwater Kin, mate |
| Marrow Quay | marrow@lowtide.test | Saltpan-Marrow-27 | islander | Europe/Lisbon | 240 | — |
| Pell Saunder | pell@lowtide.test | Saltpan-Pell-27 | islander | Australia/Hobart | 610 | Brackwater Kin, skipper |
| Wren Sallow | wren@lowtide.test | Saltpan-Wren-27 | islander | Europe/Dublin | 396 | — |
| Tamsin Rook | tamsin@lowtide.test | Saltpan-Tamsin-27 | islander | Asia/Kolkata | 401 | — |

**Clan**: Brackwater Kin, motto "We keep the sluice open.", with Pell Saunder as skipper (joined first) and Ivo Brack as mate (joined second, mate since the seed instant). There are no seeded raids, messages, requests or invitations.

## Technical requirements

### Deployment (DP-77)

- The runtime is Node.js 22 LTS with npm. The app is TypeScript.
- `/app/run.json` holds the string commands `install`, `build` and `serve` and `"_schema":"run-manifest-v1"`, for example:

  ```json
  {"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm run start"}
  ```

- `serve` binds `0.0.0.0` on `APP_PUBLIC_PORT` when it is set, otherwise on 4173.
- `GET /api/health` answers HTTP 200 with exactly `{"status":"ok"}`.
- The process starts serving within 10 seconds whatever the state of its dependencies.
- The verifier also runs extra copies of the app. Each copy is set only through the variables in Configuration and secrets, and each must behave exactly as this brief describes for its settings:
  - **Mailpit unreachable**: SMTP points at a closed port for the copy's whole life.
  - **PostgreSQL unreachable**: the database address points at a closed port for the copy's whole life. It shows the app booting and serving without its database. It never recovers.
  - **Short timers**: this copy has its own empty database and these settings:
    - a finalize lifetime of 20 seconds;
    - a shield and a same-target cooldown of 30 seconds each;
    - verification and reset links of 20 seconds;
    - sessions of 60 seconds;
    - build and training durations divided by 10.
  - **Database cut**: this copy has its own empty database and a finalize lifetime of 20 seconds. While the copy runs, the verifier makes the database unreachable: it refuses new connections to the database and ends the copy's open connections. It keeps the database unreachable for up to 30 seconds, then accepts connections again. The verifier checks recovery, whole ledger pairs and raids abandoned during the outage on this copy.
  - **Clock copies**: each has its own empty database and sets `SALTREACH_CLOCK_START` five minutes before a named local boundary, so tests reach that boundary in real time. The table below lists them.

  | Copy | Server clock starts at | Boundary it reaches |
  |---|---|---|
  | Havana | 2027-03-14T04:55:00.000Z | America/Havana, Sunday 14 March 2027, whose local midnight the clock skips |
  | Santiago | 2027-09-05T03:55:00.000Z | America/Santiago, Sunday 5 September 2027, whose local midnight the clock skips |
  | Kathmandu | 2027-09-05T18:10:00.000Z | Asia/Kathmandu, Monday 6 September 2027 at 00:00 |
  | Lisbon | 2027-10-31T23:55:00.000Z | Europe/Lisbon, Monday 1 November 2027 at 00:00, which ends the week containing the autumn change |
  | Year end | 2028-12-31T09:55:00.000Z | Pacific/Kiritimati, Monday 1 January 2029 at 00:00, which is a day, week, month and year boundary |

  Checks that cross a local-day or local-week edge use only these copies and the zones named for them. A period's start and end can be read for any zone at any instant on any copy. Expected instants come from the IANA time zone database. The app uses the zone data that ships with its Node.js runtime.

### Configuration and secrets (DP-83)

All of these are read from the environment at start:

| Variable | Meaning | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection | required |
| `SMTP_HOST`, `SMTP_PORT` | Mailpit SMTP | required |
| `MAIL_FROM` | From header | the From line in Services |
| `APP_PUBLIC_PORT` | listen port | 4173 |
| `APP_PUBLIC_URL` | origin used in mail links and the same-origin check | `http://localhost:<port>` |
| `SALTREACH_CLOCK_START` | when set, the server clock reads this instant at process start and advances in real time from it; it drives every server time rule | real time |
| `RAID_FINALIZE_SECONDS` | finalize lifetime | 300 |
| `SHIELD_SECONDS` | shield lifetime | 43,200 |
| `TARGET_COOLDOWN_SECONDS` | same-target cooldown lifetime | 86,400 |
| `VERIFY_TOKEN_SECONDS` | verification lifetime | 86,400 |
| `RESET_TOKEN_SECONDS` | reset lifetime | 1,800 |
| `SESSION_SECONDS` | session lifetime | 2,592,000 |
| `BUILD_TIME_DIVISOR` | divides build and training durations | 1 |

No credential, connection string, SMTP detail or other environment value is hard-coded or ever sent to the browser.

### Server boundary (DP-03, DP-68, DP-70, DP-78)

- **Session cookie**: named `saltreach_session`, HttpOnly, SameSite=Lax, Path=/, and Secure when `APP_PUBLIC_URL` is https.
- **CSRF**: every POST, PATCH and DELETE, including sign-up and sign-in, must carry an `X-CSRF-Token` header equal to the token from `/api/session` or sign-in for that cookie. The server compares the token in constant time. A missing or wrong token answers `403 csrf_failed`. So does a state-changing request whose `Origin` header is present and differs from the app's own origin.
- **No cross-origin access**: no CORS headers are sent.
- **Body limits**: body size and content type rules are as in API conventions.
- **Response headers**: every response sets `X-Content-Type-Options: nosniff` and a content security policy that allows scripts, styles, fonts and connections only from the app's own origin.
- **SQL**: every query is parameterised.
- **User text**: every piece of user text (display names, clan names, mottos, chat, emails) is rendered as text, never as markup.
- **What is served**: only the built client files and the index document. Client routes without a file extension get the index document, sent with a header that stops the browser from storing it. Any other path with an extension, including source files, maps of server code, `.env`, `run.json`, package manifests and dependency folders, answers 404.
- **Boot without dependencies**: the server boots without its dependencies and recovers as described in Services.

### Browser support and performance (DP-79, DP-80)

- Covers current Chromium, Firefox and WebKit at 375×812, 768×1024 and 1280×800, with touch on the phone size.
- The island is visible and responds to input within three seconds of loading the village on a mid-range laptop.
- A replay is scrubbable within two seconds of opening.
- Each dial settle updates the scene and data attributes within a quarter of a second.
- The camera keeps up with drag, pinch and twist without visible lag.
- Open screens meet the live bound from Interactions.

## Working rules

- IF-01: `/app/run.json` exists with string `install`, `build` and `serve` commands and `"_schema":"run-manifest-v1"`, and nothing else is needed to install, build and serve.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package (the production dependency tree as reported by `npm ls --omit=dev --all --json`), every bundled font and the icon set, each with its licence.
- IF-03: Shipped packages (that same production dependency tree) and bundled assets use only the MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1 licences.
- IF-04: PostgreSQL is the only datastore: no SQLite, Redis, document stores or state files. Everything that must outlive a restart lives in PostgreSQL.
- IF-05: Application source is TypeScript. No hand-written JavaScript source files exist outside generated build output and tool configuration.
- IF-06: The browser loads nothing from other origins. Fonts, icons, scripts and styles are bundled and served by the app.
- IF-07: `package-lock.json` is committed, and `install` uses it.
- IF-08: The provided service compose files and their seeded credentials are left unchanged.

## Engineering standards

- The TypeScript compiles under strict mode with no type-checking suppressions. Domain values (resources, unit keys, raid states, end reasons, leagues, roles) are typed, and plain strings are not passed around for them.
- Names in the source match the domain terms of this brief: islander, island, saltmark, builder, brine, peat, copper, batch, raid, deploy, tick, seed, snapshot, mark, shield, cooldown, league, streak, warden, skipper, mate, deckhand, donation, ledger pair.
- Each domain rule is decided in exactly one place in the source, including raid state transitions, the storage cap, free builders, housing, the training queue schedule, the local-day and local-week boundaries, the next-claim instant, the streak step, skipper succession, the league for a trophy count, lootable amounts and the battle step. The battle rules exist once and are imported by both the server and the browser.
- There are no abstractions with a single implementation, and no dead, commented-out or unreachable code.
- There are no defensive checks for states the types or the database constraints already rule out.
- Every error response is built by one shared path that produces the one published shape. No handler composes its own error body.
- All SQL is parameterised, and no query text is built from request input by concatenation or template strings. User-supplied text reaches the page only as text, never through HTML-string insertion.
- The code implements nothing beyond this brief.
