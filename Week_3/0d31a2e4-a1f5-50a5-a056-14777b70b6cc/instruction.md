# Wobblewell Arcade Pratfall Cup

Pratfall Cup is a browser party-royale game for squads of two to four friends. Players sign up, verify their email, add friends, form a party, and queue together into 12-player elimination matches played in a 3D obstacle course. They never install a client. The party stays together from the friend request to the final round. Party chat, direct messages and push-to-talk voice are built in. Every round result can be replayed: the server runs an authoritative fixed-tick 3D simulation from a published seed, so anyone can open a past round and scrub its photo-finish tick by tick. The app uses two backend services. PostgreSQL is the system of record for every account, friendship, party, lobby, match, round, accepted input and message. Mailpit receives account mail (verification and password reset). Out of scope: installed clients, regions or server selection, bots, cosmetics, stores or payments, sound effects or music (voice is the only audio), object storage, replay archives or video files, admin or operations pages, and any datastore other than PostgreSQL.

## Problem and users

Casual elimination party games lose whole evenings to "party broke" moments. A friend can't join because of a version or region mismatch. A squad gets split across lobbies. Someone is eliminated and can't follow their friends. After a round, nobody can see why they missed a qualifying slot by a hair. Squads work around this today: they run a separate voice app next to the game, re-invite everyone after every match, and argue over screenshots. Most of these players are teens and young adults on school or work laptops where installing a client is blocked or slow. For a solo founder running a small browser arcade, every broken party is churn: a squad that splits once seldom queues again. Pratfall Cup is served from one origin with one build and one region, so there is nothing to mismatch. Parties are seated whole. Eliminated players keep watching. Every result can be checked against the server's own record.

Users:

- **Player** (daily): signs up, verifies their email, adds friends, and sees at a glance who is online, in a party or in a match.
- **Party leader** (daily): assembles up to four friends, keeps them in one lobby, and queues into matchmaking.
- **Party member** (daily): chats, talks over voice with mute and push-to-talk, and spectates friends after being eliminated.
- **Rival or curious player** (weekly): opens a past match from a profile and scrubs the photo-finish to see exactly who qualified on which tick.

## Journeys

1. **Sign up and verify.** Start: a signed-out visitor on the sign-up page. They enter an email, handle and password and press Create account. They see a notice that the verification link was sent, plus a banner saying friends and matchmaking are locked until they verify. They open the link from the email. End: the verified confirmation shows, the banner is gone, and the friends rail accepts requests. If mail is down at sign-up, the account is still created, the notice says the email failed, and Resend works once mail is back.
2. **Make a friend and watch presence.** Start: two verified players who are not friends, each signed in. One types the other's handle into the rail and sends a request. The other accepts it from the Requests list. End: each sees the other in their Friends list with a presence dot. The dot changes to in a party when one of them joins a party, and to offline about a quarter-minute after they close the tab.
3. **Block a player.** Start: two friends. One opens the other's profile and presses Block. End: each has disappeared from the other's rail. Neither can send the other a direct message or see the other's presence, and the blocker's profile view offers Unblock.
4. **Assemble a party, chat and talk.** Start: four friends, each in a party of one. The leader invites the other three from the rail, and each accepts. End: all four see the same members, grouped in the rail and on the stage, with one leader badge. They exchange party chat messages, join voice, and see each other's voice tiles show muted or speaking. When the leader leaves, all remaining members see the leader badge move to the member who joined earliest.
5. **Queue and fill a lobby.** Start: an idle party whose leader is signed in. The leader presses Find a match. The party sees a searching notice, then the Lobby view with its seats filling as other parties are seated. When all seats are full, a countdown starts. If a player leaves during the countdown, everyone sees it cancel and the seat reopen. End: when the countdown ends, every seated player is moved into the match together.
6. **Play, fall, spectate, regroup.** Start: a party in a running match. Each member steers their bean through the 3D race with keys or touch controls and sees live standings, the round clock and the slots-left count. A member who is eliminated sees the eliminated banner and then a spectator view that follows a friend still in play. End: after the final, the results view lists the final standings, and every member is back in the same party, ready to queue again without re-inviting.
7. **Check a photo-finish.** Start: a signed-in player on a rival's profile. They open a past match from the match history, then open the photo-finish for a round. They drag the playhead or use the arrow, Home and End keys. End: the 3D view and the lane list show every bean's recorded position at each tick, the round's last tick marks who took the last slot and who was first out, and the slots-left numeral matches the tick.

How each kind of requirement is scored. Journey requirements (DP-07, DP-11, DP-13, DP-16, DP-20, DP-28, DP-31, DP-36) score only one thing: the journey completes in real browsers and reaches its visible end state. Each rule a journey passes through is scored once, by the requirement that owns it:

- API and state rules: their behaviour requirement.
- Existence of every public role and name, Tab order and focus: DP-39. Exceptions, each scored by its own requirement: the signed-in identity copy ("Signed in as <handle>" and the " (you)" suffix) by DP-04, the presence words in friend rows by DP-10, the unread counts in the dock tab names by DP-29, and `link "Your profile"` with the profile counts by DP-32.
- Key and touch mapping: DP-26.
- Spectator camera rules: DP-27.
- Voice signalling and voice tile data: DP-30.
- Lane-list data and playhead keys: DP-34.
- Motion timing and reduced motion: DP-35 and DP-41.
- Bean hue values (API and SVG data attribute): DP-40. Bean hue as seen on the 3D canvases: DP-44.

The rubric requirements score only what a still screenshot or the code shows, and nothing a behaviour check already scores. DP-43 covers the overall look of the screens, excluding bean hue. DP-44 covers the composition and legibility of the photo-finish screenshot. DP-45 covers how the code obtains credentials and produces the simulation, the 3D scenes and voice.

## Mandatory requirements

This is the complete list of mandatory requirements; every check traces to one of these lines and the detailed sections below.

- **DP-01 — Sign-up with verification email** Visitors create an account with email, handle and password, and the server sends a verification link to that address through Mailpit, as qualified in Business rules and Services.
- **DP-02 — Single-use expiring links** Verification and reset links work once, expire after the published lifetime measured on the server process's own clock, and stop working once a newer link of the same kind is issued, as qualified for overlapping requests in Business rules.
- **DP-03 — Verification gate** Until an account's email is verified, the friends, party, matchmaking and chat endpoints reject it with the email-unverified error from API.
- **DP-04 — Sign-in and sessions** Players sign in with email and password, receive an HTTP-only session cookie, see in the app shell who they are signed in as, with their own party row marked as theirs, and end the session by signing out.
- **DP-05 — Password reset** A player requests a reset link by email and sets a new password through it, and the request never reveals whether the email has an account.
- **DP-06 — Mail outage handling** When Mailpit is unreachable, sign-up still succeeds and reports the verification email as failed, resend and reset answer with the mail-unavailable error, and resend works again once mail is back.
- **DP-07 — Account journey** In the browser a visitor signs up, opens the emailed link, sees the verified confirmation, and lands in the app with the unverified banner gone.
- **DP-08 — Friend requests** Verified players send friend requests by handle, accept, decline or withdraw them, and remove friends, following the replay and rejection rules in API.
- **DP-09 — Crossed requests merge** Two players who send each other friend requests at the same moment end up with exactly one accepted friendship and no pending request.
- **DP-10 — Presence** Each friend shows as offline, online, in a party or in a match, derived from WebSocket heartbeats and party state, as qualified in Business rules.
- **DP-11 — Friends and presence journey** In two browsers, one player adds the other by handle, the other accepts from the rail, and each sees the other's presence dot change when they join a party and when they disconnect.
- **DP-12 — Blocking** Blocking a player removes the friendship, cancels pending friend requests and party invites both ways, and stops direct messages and presence both ways until unblocked.
- **DP-13 — Block journey** From a profile page a player blocks a friend and sees them leave the rail, and the blocked player sees the blocker vanish from theirs.
- **DP-14 — Party invites and size cap** The leader invites accepted friends into a party of at most four, and invitees join by accepting, with the rejections listed in API.
- **DP-15 — One leader with succession** Every party has exactly one leader, only the leader can queue, cancel or hand over leadership, and when the leader leaves, the member who has been in the party longest takes over.
- **DP-16 — Party journey** Four friends in four browsers form one party, all see the same grouped members and leader badge in the rail and on the stage, and all see leadership pass when the leader leaves.
- **DP-17 — Queue and cancel** The leader queues an idle party and can cancel while it is still queued, following the party state machine in Business rules.
- **DP-18 — Whole-party seating** Each queued party is seated whole in one 12-seat lobby or not at all, and concurrent placements never overfill a lobby or split a party.
- **DP-19 — Lobby countdown** A lobby starts its countdown only when every seat is filled, cancels it and reopens the seat when a seated player leaves, and starts the match when the countdown ends, as qualified in Business rules.
- **DP-20 — Lobby journey** The leader presses Find a match, the party watches the seats fill in the Lobby view, the countdown appears when the lobby is full, and everyone sees it cancel when a player leaves.
- **DP-21 — Fixed-tick 3D physics** The server simulates every round in 3D at a fixed tick rate, with gravity, jump, dive, spinning sweepers, moving platforms, bumpers and falls, on a course generated from the round's published seed, as qualified in Business rules.
- **DP-22 — Deterministic re-simulation** The same seed, starters, accepted inputs and forfeits always produce the same positions, finish order and eliminations, and these match both the frames broadcast live and the stored results.
- **DP-23 — Input acceptance and storage** The server accepts a player's input only inside the published tick window, rejects every other input with a reason, and stores the effective input for each player and tick, plus each forfeit, in PostgreSQL, as qualified in Business rules.
- **DP-24 — Qualification rules** Each round's slot count is derived once from its kind and its number of starters and stored; race and final slots fill in finish order with same-tick ties broken by ascending player id, while survival keeps its survivors under the separate selection and time-limit rules in Business rules.
- **DP-25 — Match round flow** A match runs a race, a survival round and a final, each moving through pending, running and resolved, finishes with one winner or none, and returns every party to idle with the same members.
- **DP-26 — Play controls** WASD or the arrow keys, Space and Shift, and the on-screen touch controls on narrow and touch screens produce the published input buttons, which the server stores.
- **DP-27 — Spectating after elimination** A player who is out of play keeps watching as a spectator: the Match region's data-following-user-id names the remaining player the spectator camera follows, starting with a party friend still in play, and buttons switch it.
- **DP-28 — Match journey** A party plays a full match in the browser, sees the 3D course and live standings, gets a qualified or eliminated banner, spectates, and returns to the party view together.
- **DP-29 — Party chat and direct messages** Party members chat in the party channel and friends message each other directly, with history stored in PostgreSQL, the limits in API, and unread counts on the dock tabs as qualified in Business rules.
- **DP-30 — Voice with mute and push-to-talk** In the supported voice environment, party members join peer-to-peer voice, mute themselves or switch to push-to-talk, the server relays signalling only among a party's voice members, and every member's voice tile data shows who is connected, muted and speaking.
- **DP-31 — Chat and voice journey** Two party members exchange chat messages in the dock and join voice, and each sees the other's tile change when they mute or hold the push-to-talk key.
- **DP-32 — Profiles and match history** Each player's profile counts their finished matches and wins and lists their newest finished matches with their placement, as qualified in API and Business rules, linking to each match and its rounds, and the rail links to your own profile.
- **DP-33 — Frames API** For any resolved round, the frames endpoint returns every bean's position, state and rank at a requested tick, re-simulated from the stored seed, inputs and forfeits.
- **DP-34 — Photo-finish lane list and playhead** The photo-finish view has a playhead slider and a lane list whose rows carry the same tick, position and rank as the frames endpoint, and the keyboard and dragging give identical results.
- **DP-35 — Photo-finish motion** On every playhead change, every 3D bean mesh glides to its recorded position over the published glide time as shown by data-beans, the replay camera flies to the leading bean on jumps as shown by data-camera, and the slots-left numeral updates within one frame, while reduced motion replaces each movement with a cut.
- **DP-36 — Photo-finish journey** A player opens a rival's profile, opens a past match, scrubs a round's photo-finish to its deciding tick, and sees who took the last slot.
- **DP-37 — Deployment and server boundary** The app runs from the run manifest, answers the health check, accepts same-origin requests only within the size limits, and never serves source files or credentials.
- **DP-38 — Responsive layout** The rail, stage and dock rearrange as described for viewports 375, 768 and 1280 pixels wide, with no horizontal overflow.
- **DP-39 — Keyboard and screen-reader access** Every control is reachable in a logical Tab order with a visible focus ring, dialogs keep focus inside and return it when closed, and every role and name in Public screens and controls exists.
- **DP-40 — Bean identity** Every player appears as a bean in the hue derived from their user id, and that hue is the same in the API and in every SVG bean.
- **DP-41 — Interface motion** Lobby beans bob gently, panels and banners move with the timings described, nothing else loops, and reduced motion removes each movement.
- **DP-42 — Feedback states** Every async action shows a pending state and its exact success, error or outage copy, announced in the Notices live region.
- **DP-43 — Visual design** Screens follow the cream, ink, pink, teal and red colour roles, the display and body typefaces with tabular numbers, comfortable density, and the rail-stage-dock composition, with bean hues scored under DP-40 instead.
- **DP-44 — Signature replay craft** On a still screenshot of the 3D photo-finish, the finish line, the lane order, the last-slot bean and the playhead read at a glance in the composition and match the brand's style; across screenshots before and after a playhead jump the replay camera has reframed onto the leading bean; every visible 3D bean mesh plainly carries its player's hue.
- **DP-45 — Honest wiring** Credentials come from the environment, the simulation and qualification run on the server, the match and replay are real WebGL scenes whose bean meshes, spectator camera and replay camera are driven by the server's positions and the hue rule, and voice uses real microphone capture and peer connections, as read in the source.

## Frontend

### Screens and layout (DP-07, DP-11, DP-16, DP-20, DP-28, DP-32, DP-36, DP-38)

Routes:

- `/signup`, `/signin`, `/forgot-password`, `/reset-password?token=<token>` and `/verify?token=<token>` are the account pages. Each is a single centred card on the cream page, with the product name above it.
- `/` is the app shell. Signed-out visitors to any app route are sent to `/signin`.
- `/u/<handle>` is a profile. `<handle>` is a player's handle, always shown in lowercase.
- `/matches/<id>` is a match summary. `<id>` is the match's numeric id.
- `/matches/<id>/rounds/<n>` is the photo-finish for round `<n>` (1, 2 or 3). An optional `?tick=<T>` opens it at tick `<T>`.

The app shell has three parts:

- **Rail (left):** the Friends list. It shows each friend's SVG bean, handle and a presence dot. The members of your current party sit at the top in their own group, "In your party", where your own row shows your handle followed by " (you)". Below the list come the add-friend field, the Your profile link to your own profile page, and the Requests list.
- **Stage (centre):** shows one view at a time, chosen by your party's state:
  - **Party view** (idle): the party card with member beans, the leader badge, Find a match or the waiting line, and Leave party.
  - **Lobby view** (queued or in a lobby): the seat count, a grid of 12 seats holding beans, the countdown, Leave lobby (leader only) and Leave party (any member of a party of two or more). While queued, the view shows the searching notice, Cancel search (leader only) and Leave party.
  - **Match view** (in a match): the 3D canvas fills the stage. The heads-up overlay shows the round name, the round clock, the slots-left numeral and the live standings list. Touch controls appear when required (see Interactions).
  - **Results view** (right after a match ends): the final standings, links to each round's photo-finish, and Back to party.
- **Dock (right):** tabs for Party chat and Messages, with the Voice panel and its tiles below them.

Profile page: a large bean, the handle, the counts "Matches played: <played>" and "Wins: <wins>" under the handle (the `played` and `wins` values from API, shown on every profile, your own included), the Add friend, Block or Unblock action, and the Match history list. Match summary page: the match name, its rounds with kind, seed, starters, slots and qualified players, and a photo-finish link per round. Photo-finish page: the 3D replay view on top, the playhead below it, and the lane list beside the view (wide screens) or below it (narrow screens).

Viewports:

- **1280×800:** three columns. The rail takes about a fifth of the width, the dock about a quarter, and the stage fills the middle. The dock starts expanded on a browser's first visit. Collapse dock shrinks it to a slim strip holding only its expand button, and the stage widens to fill the space. The browser remembers the choice and restores it on the next load.
- **768×1024:** the rail stays as the left column. The dock is hidden behind the Party dock button in the top bar and opens as a panel over the right side of the stage. The match canvas fills the stage width, and touch controls show.
- **375×812:** one column. The top bar holds the Friends and Party dock buttons, and each opens a full-screen panel. The match canvas fills the screen width, with touch controls overlaid along its bottom edge. On the photo-finish page, the lane list stacks under the playhead.

No page scrolls horizontally at any of these widths. Long handles truncate with an ellipsis and never wrap under a bean.

### Public screens and controls (DP-04, DP-10, DP-11, DP-13, DP-16, DP-20, DP-26, DP-27, DP-28, DP-29, DP-30, DP-31, DP-32, DP-34, DP-35, DP-39, DP-40)

Only the controls and regions below are public. Tests and judges touch nothing else. In the "Visible copy" column, `<handle>` is the other player's handle, `<n>` is a count, and `<T>` and `<lastTick>` are tick numbers. Data attributes are listed where checks read them. Positions are always printed with exactly three decimals, for example `12.500`.

| Role and accessible name | Where | Visible copy / data |
|---|---|---|
| field labelled `Email`, `Handle`, `Password` | sign-up | labels as named |
| `button "Create account"` | sign-up | "Create account" |
| field labelled `Email`, `Password`; `button "Sign in"` | sign-in | "Sign in" |
| `link "Forgot password?"` | sign-in | "Forgot password?" |
| field labelled `Email`; `button "Send reset link"` | forgot password | as named |
| field labelled `New password`; `button "Set new password"` | reset password | as named |
| `region "Verification"` | verify page | shows the verify copy from Feedback states |
| `status "Notices"` | every page, polite | carries all non-field feedback |
| `region "Verify your email"` | app shell, unverified only | banner copy from Feedback states, with `button "Resend verification email"` |
| `button "Sign out"`; text "Signed in as <handle>" | top bar | "Sign out"; in "Signed in as <handle>", `<handle>` is your own handle |
| `complementary "Friends"` | rail (wide); `dialog "Friends"` at 375 | heading "Friends" |
| `button "Friends"` | top bar at 375 | opens `dialog "Friends"` |
| `list "In your party"` | rail top | one `listitem` per party member, `data-user-id`; your own row shows your own handle followed by " (you)", and no other row carries that suffix |
| `list "Friends"` | rail | one `listitem` per friend: bean, handle, presence dot; `data-user-id`, `data-presence` (offline, online, in_party, in_match), presence text visible to screen readers, which is exactly "Offline", "Online", "In a party" or "In a match" for those four values |
| `textbox "Add friend by handle"`, `button "Send request"`, `link "Your profile"` | rail | as named; Your profile opens `/u/<your own handle>` |
| `list "Requests"` | rail | incoming: `button "Accept <handle>"`, `button "Decline <handle>"`; outgoing: `button "Withdraw request to <handle>"` |
| `button "Invite <handle> to party"`, `button "Message <handle>"`, `link "<handle>"` | each friend row | as named |
| `region "Party invites"` | stage, when invites exist | `button "Join <handle>'s party"`, `button "Decline invite from <handle>"` |
| `region "Party"` | stage, party view | `list "Party members"`, one `listitem` per member with `data-user-id`, the leader's row has `data-leader="true"` and the text "Leader" |
| `button "Find a match"` | party view, leader only | "Find a match" |
| text "Waiting for <handle> to start a match" | party view, members | `<handle>` is the leader |
| `button "Make <handle> leader"` | each member row, leader's view | as named |
| `button "Leave party"` | party view and lobby view (queued or in a lobby), for every member of a party of two or more, leader included | "Leave party" |
| `button "Cancel search"` | stage while queued, leader only | "Cancel search" |
| `region "Lobby"` | stage while in a lobby | `data-lobby-id`, `data-state` (filling, countdown) |
| `status "Seats"` | lobby | "<n> of 12 seated" |
| `list "Seats"` | lobby | 12 `listitem`s, each filled one with `data-user-id` |
| `timer "Countdown"` | lobby during countdown only | "Starting in <n>" (whole seconds) |
| `button "Leave lobby"` | lobby, leader only | "Leave lobby" |
| `region "Match"` | stage in a match | `data-match-id`, `data-round` (n), `data-tick` (latest tick received), `data-buttons` (the button value the client is sending now, from Business rules), `data-following-user-id` (the player the camera follows, empty while the camera holds the course overview) |
| `img "3D course view"` | match | the WebGL canvas |
| `status "Round"` | match | "<round name> · <kind label>", with names and labels from Business rules |
| `timer "Round clock"` | match | time left as m:ss |
| element with `data-slots-left` | match and photo-finish | label "Slots left" (race, final) or "Falls to go" (survival), followed by the number |
| `list "Live standings"` | match | one `listitem` per starter: `data-user-id`, `data-rank`, `data-state`, `data-hue`, `data-x`, `data-y`, `data-z` for the latest tick |
| `group "Touch controls"` | match, when shown | contains `group "Move stick"`, `button "Jump"`, `button "Dive"` |
| `alert "Round result"` | match, for your own outcome | "Qualified!", "Eliminated" or "You won Pratfall Cup!" |
| `status "Spectating"` | match, while out of play | "Spectating <handle>"; `button "Previous player"`, `button "Next player"` |
| `button "Forfeit"` | match, while in play | "Forfeit" |
| `region "Results"` | stage after a match | heading "Cup #<id> results", `list "Final standings"`, `link "Photo-finish: <round name>"` per round, `button "Back to party"` |
| `complementary "Party dock"` | dock (1280); `dialog "Party dock"` at 768 and 375 | |
| `button "Collapse dock"` / `button "Expand dock"` | dock edge at 1280 | `aria-expanded` matches the dock |
| `button "Party dock"` | top bar at 768 and 375 | opens `dialog "Party dock"` |
| `tablist` with `tab "Party chat"` and `tab "Messages"` | dock | with unread messages a tab is named "Party chat (<n> unread)" or "Messages (<n> unread)" instead, as qualified under Chat in Business rules |
| `log "Party chat"`, `textbox "Message party"`, `button "Send"` | Party chat tab | each message shows the sender's bean, handle and time |
| `list "Conversations"` | Messages tab | one entry per friend you have messaged |
| `log "Messages with <handle>"`, `textbox "Message <handle>"`, `button "Send"` | open DM | |
| `region "Voice"` | dock | `button "Join voice"` / `button "Leave voice"` |
| `button "Mute"` | voice, while joined | toggle; `aria-pressed="true"` while muted |
| `switch "Push to talk"` | voice, while joined | hint "Hold V to talk" while on |
| `list "Voice"` | voice | one `listitem` per party member in voice: bean, handle, `data-user-id`, `data-connected`, `data-muted`, `data-speaking` ("true" or "false") |
| heading `<handle>` | profile | text "Matches played: <played>" and "Wins: <wins>" under it, with the counts from API |
| `button "Add friend"`, `button "Remove <handle> from friends"`, `button "Block <handle>"`, `button "Unblock <handle>"` | profile | shown depending on the relationship |
| `list "Match history"` | profile | `link "Cup #<id>"` per match, with the placement text from Business rules |
| heading "Cup #<id>" and `link "Photo-finish: <round name>"` | match summary | |
| `region "Photo-finish"` | photo-finish page | `data-camera` ("moving" or "still"), `data-beans` ("moving" or "still") |
| `img "3D photo-finish view"` | photo-finish | WebGL canvas |
| `slider "Playhead"` | photo-finish | value range 0 to `<lastTick>`, value text "Tick <T> of <lastTick>" |
| `status "Frame"` | photo-finish, polite | "Tick <T> of <lastTick>, <n> <slots label>", where the slots label is the lowercase form of the slots-left label |
| `list "Lanes"` | photo-finish | one `listitem` per starter, in rank order: `data-user-id`, `data-tick`, `data-x`, `data-y`, `data-z`, `data-rank`, `data-state`, `data-hue`; the rows marked in the frame show "Last slot" or "First out" and carry `data-marker` (last_slot or first_out) |
| `table "Photo-finish frame"` | photo-finish, reduced motion only | columns Rank, Player, X, Y, Z, State, for the current tick |
| every SVG bean | everywhere | `data-hue` holds the player's hue |

### Interactions (DP-11, DP-16, DP-20, DP-26, DP-27, DP-30, DP-34, DP-39)

- **Tab order:** top bar, then rail (add-friend field, friend rows, requests), then stage, then dock (dock toggle, tabs, log, message field, voice controls). Enter activates the focused control. Every focused control shows a pink ring with a thin ink outline.
- **Panels:** the Friends and Party dock panels open as dialogs. Opening one moves focus to its first control. Tab cycles inside it. Escape or the panel's `button "Close"` closes it and returns focus to the button that opened it. At 1280, Collapse dock and Expand dock toggle the dock, and focus stays on the toggle.
- **Adding a friend:** type a handle into the add-friend field and press Enter or Send request. The field clears on success and keeps its text on error.
- **Invites:** activating Invite <handle> to party sends the invite. The invitee's stage shows Party invites within one second. Joining moves the invitee into the inviter's party, and every member's rail and stage update within one second. When an invite stops being open for any reason (joined, declined, cancelled by a block, or cancelled because its sender stopped leading), its Join and Decline buttons leave every open stage of both players within one second, and `region "Party invites"` disappears once no invite is open.
- **Queueing:** pressing Find a match disables the button and shows the queue pending copy. Every member's stage switches to the Lobby view once the party is seated. Seat changes and countdown start or cancel reach every seated player within one second. The countdown numeral drops by one each whole second.
- **Steering in a match:** with focus anywhere on the match view except a text field:
  - W or Up arrow: forward
  - S or Down arrow: back
  - A or Left arrow: left
  - D or Right arrow: right
  - Space: jump
  - Shift: dive

  Several keys combine. Releasing a key clears its button. The client sends its button value each time it changes, stamped with the latest tick it has received, and `data-buttons` reflects the current value immediately.
- **Touch controls:** shown when the viewport is narrower than 1024 pixels or the device's main pointer is coarse. Dragging inside the Move stick picks one of eight directions (each 45-degree sector maps to one direction or a diagonal pair). A dead zone of the inner fifth of the stick's radius means "no direction". Holding Jump or Dive holds that button. Lifting the finger clears it. Touch controls never cover the slots-left numeral or the round clock.
- **Spectating:** when your bean is out of play, the camera switches to follow another player (Business rules decides whom). Previous player and Next player cycle through the beans still in play, in rank order. If the followed bean leaves play, the camera moves to the next bean in play within one second. `data-following-user-id` names the followed player, following the camera rules under Spectating in Business rules.
- **Voice:** Join voice asks for the microphone. Mute toggles sending. Turning Push to talk on stops sending until V is held. While Push to talk is on, holding V transmits and releasing it stops. V does nothing while a text field has focus. Your own tile updates immediately, and other members' tiles update within one second.
- **Photo-finish playhead:**

  | Input | Effect |
  |---|---|
  | Right arrow | one tick forward |
  | Left arrow | one tick back |
  | Page Up | 20 ticks forward |
  | Page Down | 20 ticks back |
  | Home | tick 0 |
  | End | the last tick |
  | Click on the track | jumps to that tick |
  | Drag the thumb | moves through ticks continuously |

  All moves are clamped to the range. Releasing a drag on tick `<T>` leaves the view in exactly the state that keyboard navigation to `<T>` produces. The URL's `tick` value updates on every change, without adding history entries. The lane list and `data-slots-left` show the new tick within 200 ms of the change.
- **Hover and press:** buttons and rows shift to a slightly deeper shade on hover. Buttons sink slightly while pressed.

### Visual design (DP-40, DP-43, DP-44)

Colour roles, and only these:

- **Ground:** a warm cream, like paper in afternoon sun. Used for the page and panels.
- **Ink:** a deep midnight violet-navy. Used for all text, icons and outlines.
- **Accent:** a hot watermelon pink. Used for primary buttons (pink fill with an ink label), the focus ring, the selected tab, the playhead thumb and the finish line in the 3D scenes. Pink text never sits directly on cream at body size.
- **Qualified:** a sea teal-green. Used only to mark qualified players.
- **Eliminated:** a crimson red. Used only to mark eliminated players.

Red and green never appear as decoration. Panels and cards use thin ink outlines and slightly deeper cream fills instead of shadows.

Type:

- **Display:** Bricolage Grotesque, a chunky, characterful grotesque. Used for headings, round names and the results header.
- **Body:** Atkinson Hyperlegible, designed so similar letters never get confused. Used for body text, labels and chat.
- **Numbers:** every number (seat counts, clock, countdown, ticks, positions, ranks) is set in Atkinson Hyperlegible Mono with tabular figures, so numerals never change width as they count.
- **Scale:** each heading level is about a third larger than the one below it. Page titles are about two and a third times the body size.

Density is comfortable: generous space between rows, one idea per card.

Every tap target is at least 44 pixels in both directions. All text and meaningful icons meet WCAG 2.2 AA contrast against their background.

Every player is a procedural bean: a rounded jelly-bean body with two simple eyes. It appears as an SVG in the rail, lobby, party card, voice tiles and every list, and as a low-poly 3D mesh in the match and replay. In both forms the body is a strong, mid-light colour (neither pastel nor dark) in the player's hue from Business rules, so the same person looks the same everywhere. Icons are Lucide outline icons in ink.

The 3D scenes are low-poly with flat shading on a cream sky. They have a pink finish line, ink-outlined obstacles, and no shadows or post-processing. On the photo-finish, the last-slot bean wears a small teal ring and the first-out bean a small red ring, so a still screenshot shows who made it and who missed. Apart from the bean bodies, the pink finish line and these two teal and red marker rings, every surface in a 3D scene is cream, ink or a pale, washed-out tint of them, so each bean's body is the only strongly coloured surface in its hue.

### Motion and effects (DP-35, DP-41)

Two speeds apply throughout. Small state changes take about a sixth of a second. Larger moves take about half a second. Every move starts quickly and eases softly into place.

- **Lobby idle bob:** beans in lobby seats and on the party card rise and fall by two pixels on a gentle wave of about two seconds per cycle, each bean slightly out of phase with its neighbours. This is the only looping motion in the product. Spinners, pulses and shimmer loops are banned. Pending states use static text.
- **Seat fill:** a newly seated bean drops into its seat in about half a second.
- **Dock and panels:** the dock collapses and expands, and the panels slide in from their edge, in about a quarter of a second. They slide back out the same way.
- **Round result banner:** pops in from slightly smaller to full size in about a sixth of a second, and fades after three seconds.
- **Presence dots and voice tiles:** change colour or ring in about a sixth of a second.
- **Countdown and round clock:** each numeral swaps instantly, with no motion.

Signature: the 3D photo-finish.

1. The playhead moves through tick 0 to the last tick of the round, at the published tick rate.
2. On every playhead change, every bean mesh glides from its previous position to its recorded position for the new tick, taking between a tenth and a fifth of a second. `data-beans` reads "moving" during the glide and "still" afterwards.
3. When the playhead jumps by more than one tick (Home, End, Page Up or Page Down, a click on the track, or the end of a drag), the replay camera flies from its current framing to frame the rank-1 bean at the new tick and the finish line, over four to six tenths of a second. `data-camera` reads "moving" during the flight and "still" when it settles. On single-tick steps, the camera eases along with the beans in the step time.
4. The slots-left numeral changes within one animation frame of the playhead reaching or leaving a finish or elimination tick.
5. Every step reverses exactly when the playhead moves back. Stepping from tick `<T>` to `<T-1>` puts every bean back at its tick `<T-1>` position.

Reduced motion (when the operating system asks for it):

- The lobby bob stops, and beans sit still.
- Seat fill, panels and banners appear and disappear without movement.
- The replay camera cuts to its new framing, and `data-camera` never reads "moving".
- Beans jump to their recorded positions, and `data-beans` never reads "moving".
- The `table "Photo-finish frame"` appears inside a polite live region and carries the current tick's data.
- The live match camera keeps following the bean, because that is play, not decoration.

### Feedback states (DP-06, DP-42)

Every async action does the following:

- **Pending:** the triggering button is disabled, with `aria-busy="true"`, and shows the pending copy below where one is listed.
- **Field errors:** the message appears under the field and is linked as the field's description, and Notices says "Check the highlighted fields."
- **Everything else:** success, error and outage copy appears in `status "Notices"`.

Placeholders: `<email>` is the address entered, `<handle>` is the other player's handle, `<id>` is the match id.

| Action | Pending | Success | Errors and outage |
|---|---|---|---|
| Create account | "Creating account…" | email sent: "Account created. Check <email> for your verification link." / email failed: "Account created, but we couldn't send your verification email. Resend it once mail is back." | field copy: email "Enter a valid email address.", "That email already has an account."; handle "Use 3 to 20 lowercase letters, digits or underscores.", "That handle is taken."; password "Use 10 to 128 characters." |
| Resend verification email | "Sending…" | "Verification email sent to <email>." | already verified: "Your email is already verified."; mail down: "Mail is down right now. Try again in a minute." |
| Open verify link | "Checking your link…" | "Email verified. You can add friends and play." | expired: "This link has expired. Request a new one."; used or replaced: "This link has already been used or replaced by a newer one." |
| Unverified banner | | "Verify your email to add friends and find matches." | any email-unverified rejection: "Verify your email first." |
| Sign in | "Signing in…" | goes to the app | "Email or password is wrong." |
| Send reset link | "Sending…" | "If that email has an account, a reset link is on its way." | mail down: the mail-down copy above |
| Set new password | "Saving…" | "Password changed. Sign in with your new password." | the two link copies above; field: "Use 10 to 128 characters." |
| Send request | "Sending…" | "Friend request sent to <handle>." / merged or accepted: "You and <handle> are now friends." | "No player called <handle>." / "You can't add yourself." / "You're already friends with <handle>." / "You can't add this player." |
| Accept request | | the merge copy from Send request | "That request is no longer open." |
| Decline / withdraw request | | "Request declined." / "Request withdrawn." | "That request is no longer open." |
| Remove friend | | "<handle> removed from friends." | |
| Block / unblock | | "<handle> is blocked." / "<handle> is unblocked." | |
| Invite / join party | | "Invite sent to <handle>." / "You joined <handle>'s party." | "That party is full." / "That party is busy right now. Try again after its search or match." / "Only the party leader can do that." / "You can only invite friends." / "That invite is no longer open." |
| Decline invite | | "Invite declined." | "That invite is no longer open." |
| Leave party / hand over | | "You left the party." / "<handle> is now party leader." (shown to every member, including on succession) | |
| Find a match | "Finding a match…" (stays while queued) | "Seated in a lobby." | "Your party is already searching or playing." |
| Cancel search | | "Search cancelled." (also shown to all members when a membership change cancels the search) | "Your party isn't searching any more." |
| Leave lobby | | "You left the lobby." | |
| Countdown cancelled | | "A player left. Countdown cancelled — waiting for players." | |
| Match over | | "Cup #<id> is over. You're back with your party." | |
| Forfeit | | "You forfeited this round." | |
| Send message | | the message appears in the log | "Messages are 1 to 500 characters." (field) / "Slow down — you can send again in a few seconds." / "You can't message this player." |
| Join voice | "Connecting…" | "You joined voice." | "Microphone blocked. Allow microphone access to talk." |
| Live connection | "Reconnecting…" | "Back online." | |
| Any unexpected server error | | | "Something went wrong. Try again." |
| Any other rejection without copy in this table (for example, a button made stale by another player's change) | | | "That can't be done right now." |

## Backend

### API (DP-01–DP-06, DP-08, DP-09, DP-12, DP-14, DP-15, DP-17, DP-18, DP-23, DP-29, DP-32, DP-33)

General rules:

- Requests and responses use `application/json` (UTF-8).
- Request bodies are limited to 16 KB, except `POST /api/simulate`, which allows 256 KB.
- Timestamps are ISO 8601 UTC with milliseconds.
- Ids are positive integers. Positions are numbers rounded to three decimals.

Every error uses one shape:
`{"error":{"code":"<code>","message":"<plain text>"}}`
Validation errors add the field messages, which use the field copy from Feedback states:
`422 {"error":{"code":"validation_failed","message":"...","fields":{"<field>":"<message>"}}}`
Illegal state transitions add the current state:
`409 {"error":{"code":"invalid_transition","message":"...","state":"<current state>"}}`

Errors that apply to many endpoints:

| Status | Code | When |
|---|---|---|
| 401 | `unauthenticated` | no valid session |
| 403 | `email_unverified` | an unverified account calls a gated endpoint (marked "gated" below) |
| 404 | `not_found` | unknown `/api` path |
| 413 | `payload_too_large` | body over the limit |
| 415 | `unsupported_media_type` | a request with a body that isn't JSON |
| 403 | `bad_origin` | the `Origin` header is present and doesn't match the app's own origin |

Objects:

- `User`: `{"id","handle","hue"}`
- `Me`: User plus `"email"` and `"emailVerified"` (boolean)

Accounts:

- `POST /api/auth/signup` with `{"email","handle","password"}` → `201 {"user":Me,"verificationEmail":"sent"|"failed"}` and sets the session cookie. Errors: 422 (fields email, handle, password); `409 email_taken`; `409 handle_taken`.
- `POST /api/auth/verify` with `{"token"}` → `200 {"user":Me}`. No session needed. Errors: `410 link_expired`; `410 link_invalid` (unknown, already used or replaced).
- `POST /api/auth/verification/resend` with `{}` → `202 {"verificationEmail":"sent"}`. Errors: `409 already_verified`; `503 mail_unavailable`.
- `POST /api/auth/login` with `{"email","password"}` → `200 {"user":Me}` and sets the cookie. Error: `401 invalid_credentials`.
- `POST /api/auth/logout` → `204` and clears the cookie.
- `GET /api/me` → `200 {"user":Me}`, or 401.
- `POST /api/auth/password-reset` with `{"email"}` → `202 {"status":"accepted"}`, whether or not the email has an account. Errors: 422 (field email); `503 mail_unavailable`.
- `POST /api/auth/password-reset/confirm` with `{"token","password"}` → `200 {"status":"password_changed"}`. Errors: 422 (field password); `410 link_expired`; `410 link_invalid`.

Players and friends:

- `GET /api/users/<handle>` → `200 {"user":User,"friendship":"none"|"pending_in"|"pending_out"|"friends"|"blocked"|"blocked_by","presence":<presence or null>,"played":<n>,"wins":<n>,"matches":[{"id","name","finishedAt","outcome":"winner"|"eliminated","round":<n or null>}]}`. `played` counts every finished match the player took part in and `wins` the finished matches they won, both over all their matches, not only the listed ones. `matches` holds the player's newest 20 finished matches, newest `finishedAt` first, then by id descending. Running matches never appear. `outcome` is winner with `round` null, or eliminated with `round` set to the round number in which the player was eliminated. Error: `404 user_not_found`.
- `GET /api/friends` (gated) → `200 {"friends":[{"user":User,"presence","since"}],"incoming":[{"id","from":User,"sentAt"}],"outgoing":[{"id","to":User,"sentAt"}],"blocked":[User]}`.
- `POST /api/friends/requests` with `{"handle"}` (gated). Outcomes:
  - new request: `201 {"request":{"id","to":User,"status":"pending","sentAt"}}`
  - the same pending request already exists (replay): `200` with the same body
  - the target already has a pending request to you: that request is accepted instead, `200 {"friendship":{"user":User,"status":"accepted","since"}}`

  Errors: `404 user_not_found`; 422 (field handle, for your own handle); `409 already_friends`; `403 blocked` (a block exists in either direction).
- `POST /api/friends/requests/<id>/accept` (gated) → `200 {"friendship":{...}}`. Error: `404 request_not_found` (unknown, not addressed to you, or no longer pending).
- `POST /api/friends/requests/<id>/decline` (gated) → `204`. Same 404.
- `DELETE /api/friends/requests/<id>` (gated, your own outgoing request) → `204`. Same 404.
- `DELETE /api/friends/<userId>` (gated) → `204`. Error: `404 not_friends`.
- `POST /api/blocks` with `{"userId"}` (gated) → `201 {"blocked":User}`; an existing block replays as `200`. Errors: `404 user_not_found`; 422 (field userId, for yourself).
- `DELETE /api/blocks/<userId>` (gated) → `204`. Error: `404 not_blocked`.

Parties and lobbies (all gated). `Party` is `{"id","state","leaderId","members":[{"user":User,"joinedAt"}],"lobbyId","matchId","queuedAt"}`.

- `GET /api/party` → `200 {"party":Party,"invites":{"incoming":[{"id","from":User,"partyId","sentAt"}],"outgoing":[{"id","to":User,"sentAt"}]}}`.
- `POST /api/party/invites` with `{"userId"}` → `201 {"invite":{"id","to":User,"sentAt"}}`; an existing pending invite to the same player replays as `200`. Errors: `403 not_leader`; `403 not_friends` (also when a block exists); `409 already_in_party`; `409 party_full`; `409 party_busy` (party not idle).
- `POST /api/party/invites/<id>/accept` → `200 {"party":Party}`. Errors: `404 invite_not_found`; `409 party_full`; `409 party_busy` (either party not idle).
- `POST /api/party/invites/<id>/decline` → `204`. Same 404.
- `POST /api/party/leave` → `200 {"party":Party}` (your new party of one). Errors: `409 already_solo`; `409 party_busy` (in a match).
- `POST /api/party/leader` with `{"userId"}` → `200 {"party":Party}`. Errors: `403 not_leader`; 422 (field userId, for a non-member).
- `POST /api/party/queue` → `202 {"party":Party}` with state queued. Errors: `403 not_leader`; `409 invalid_transition`.
- `POST /api/party/queue/cancel` → `200 {"party":Party}` with state idle. Errors: `403 not_leader`; `409 invalid_transition`.
- `POST /api/lobby/leave` → `200 {"party":Party}` with state idle. Errors: `403 not_leader`; `409 invalid_transition`.
- `GET /api/lobbies/<id>` → `200 {"lobby":{"id","state","size":12,"seats":[{"seat","userId","partyId","seatedAt"}],"countdownEndsAt","matchId"}}`. `countdownEndsAt` is null outside the countdown, and `matchId` is null until the match starts. Error: `404 lobby_not_found`.

Matches and replays (sign-in required, verification not required). `Round` is `{"n","kind","name","seed","state","starters":[userId],"slots","lastTick","results":[{"userId","outcome":"qualified"|"eliminated","finishTick","eliminatedTick","position"}]}`. `lastTick` is null and `results` is empty until the round is resolved. `seed` is published from the moment the round is created.

- `GET /api/matches/<id>` → `200 {"match":{"id","name","state":"running"|"finished","lobbyId","startedAt","finishedAt","winnerId","participants":[User],"rounds":[Round]}}`. Error: `404 match_not_found`.
- `GET /api/matches/<id>/rounds/<n>/frames?tick=<T>` → `200 {"matchId","round","kind","tick","lastTick","slots","slotsLeft","beans":[{"userId","handle","hue","x","y","z","state","rank","finishTick","marker"}]}`. `beans` is in rank order. `finishTick` is the bean's qualifying tick once that tick is at or before `<T>`, and null otherwise. `marker` is `"last_slot"`, `"first_out"` or null. `state` uses the bean-state values from Business rules. Errors: `404 round_not_found`; `409 round_not_resolved`; `422 tick_out_of_range` (missing, not an integer, below 0 or above `lastTick`).
- `GET /api/matches/<id>/rounds/<n>/inputs` → `200 {"kind","seed","starters":[userId],"inputs":[{"tick","userId","buttons"}],"forfeits":[{"tick","userId"}]}`. `inputs` holds the effective inputs from Business rules: at most one per tick and user id, sorted by tick then user id. `forfeits` holds at most one event per player, sorted the same way. Errors: 404; `409 round_not_resolved`.
- `POST /api/matches/<id>/forfeit` → `200 {"result":{"outcome":"eliminated"}}`. Error: `409 invalid_transition` (you are not in play).
- `POST /api/simulate` with `{"kind":"race"|"survival"|"final","seed","starters":[userId],"inputs":[{"tick","userId","buttons"}],"forfeits":[{"tick","userId"}],"tick"}` → `200 {"kind","seed","slots","lastTick","results":[...],"frame":{"tick","lastTick","slots","slotsLeft","beans":[...]}}`. `forfeits` is optional and defaults to none. `tick` is optional and defaults to the last tick. `handle` in each bean is null for ids that aren't accounts. This runs the same simulation as live rounds. Error: 422 when any of these fails:
  - `seed` is an integer from 0 to 4294967295
  - `starters` holds 1 to 12 distinct positive ids
  - `inputs` holds at most 6000 entries, each from a starter, with a tick inside the round's time limit, buttons from 0 to 63, and no two entries sharing a tick and user id
  - `forfeits` holds at most one entry per starter, each with a tick from 1 to the round's time limit in ticks
  - `tick` is from 0 to the resulting last tick

Chat (gated). `Message` is `{"id","channel":"party"|"dm","partyId","fromUserId","toUserId","body","sentAt"}`.

- `GET /api/party/messages` → `200 {"messages":[Message]}`: the newest 50 of your current party, oldest first.
- `POST /api/party/messages` with `{"body"}` → `201 {"message":Message}`. Errors: 422 (field body); `429 rate_limited` with a `Retry-After` header in whole seconds.
- `GET /api/dms/<userId>/messages` → `200 {"messages":[Message]}`: the newest 50, oldest first.
- `POST /api/dms/<userId>/messages` with `{"body"}` → `201 {"message":Message}`. Errors: `403 blocked` (a block exists in either direction); `403 not_friends`; 422; 429.

Health: `GET /api/health` → `200 {"status":"ok"}` once PostgreSQL is connected and the schema is applied, otherwise `503 {"status":"starting"}`.

WebSocket: `GET /ws` upgrades on the same origin and uses the session cookie. A connection without a valid session closes with code 4401, and one with a foreign `Origin` closes with 4403. Messages are JSON objects with a `type`.

- **Client to server:**
  - `{"type":"heartbeat"}`, sent every 5 seconds
  - `{"type":"input","matchId","round","tick","buttons"}`
  - `{"type":"voice_signal","to","data"}`
  - `{"type":"voice_state","inVoice","muted","speaking"}`
- **Server to client:**
  - `{"type":"presence","userId","presence"}`
  - `{"type":"friends"}` (refetch hint)
  - `{"type":"party","party":Party}`
  - `{"type":"lobby","lobby":{...}}`
  - `{"type":"round","matchId","round":Round}`
  - `{"type":"tick","matchId","round","tick","beans":[{"userId","x","y","z","state"}]}`
  - `{"type":"input_rejected","tick","reason":"late"|"early"|"not_playing"|"invalid"}`
  - `{"type":"chat","message":Message}`
  - `{"type":"voice_signal","from","data"}`
  - `{"type":"voice_state","userId","inVoice","muted","speaking"}`
  - `{"type":"error","code"}`

### Business rules (DP-01–DP-06, DP-08–DP-10, DP-12, DP-14, DP-15, DP-17–DP-19, DP-21–DP-27, DP-29, DP-30, DP-32–DP-35, DP-40)

**Accounts and links.**

- Field rules:
  - Emails are stored lowercase, contain one "@" and a dot in the domain, and are at most 254 characters.
  - Handles are 3 to 20 characters from lowercase letters, digits and underscore, unique regardless of case.
  - Passwords are 10 to 128 characters.
- Sign-up signs the new account in immediately.
- Verification and reset links are single-use random tokens. Each expires 30 minutes after it is sent. That time is stamped and judged on the server process's own clock, never the database clock.
- Issuing a new link of a kind makes every earlier unused link of that kind for that account invalid. A link counts as earlier than another when the request that issued it had already received its response before the other link's request was sent. Requests whose lifetimes overlap (each sent before another's response arrived) are concurrent, and no order between them is defined. When several links of a kind are requested concurrently for one account, then once every one of those requests has answered, exactly one of the links they issued is still valid and all the others answer `410 link_invalid`. Which of them survives is not specified. Every link of that kind issued earlier than all of them is invalid.
- A completed reset ends every existing session of that account.
- Link URLs are `<base>/verify?token=<token>` and `<base>/reset-password?token=<token>`. `<base>` is `APP_PUBLIC_URL` when set, otherwise `http://localhost:<port>`.
- Gated endpoints (friends, blocks, party, lobby and chat) need a verified email.

**Presence** is computed per player. It is shown only to accepted friends who have no block with that player in either direction, and is null on any other profile view.

- offline: no heartbeat for 15 seconds or more
- in_match: connected and the party is in_match
- in_party: connected and in a party of two or more, or the party is queued or in_lobby
- online: connected otherwise

The rail reflects a presence change within 2 seconds of it happening.

**Friendships:**

- Pending requests are directional. At most one pending request exists per pair of players, in either direction.
- A request to a player who already has a pending request to you accepts that request, inside the same transaction. When two players send requests to each other at the same moment, the result is one accepted friendship and no pending request: the earlier request gets 201 and the later gets the merge 200.
- Declining or withdrawing removes the request.

**Blocking** in one transaction:

- removes any friendship
- cancels pending friend requests in both directions
- cancels pending party invites in both directions

Afterwards, direct messages are rejected both ways, presence is hidden both ways, friend requests and party invites are rejected both ways, and no presence events are sent between the pair. Unblocking restores none of these: the pair are simply strangers again.

**Parties.**

- Every verified player is always in exactly one party. A new account starts in a party of one, as its leader. Parties hold at most 4 members and have exactly one leader.
- Only the leader invites, queues, cancels the queue, leaves the lobby or hands over leadership.
- When the leader leaves, leadership passes to the member with the earliest join time, with ties going to the lower user id.
- A player who leaves gets a new party of one.
- Joining through an invite moves you out of your current party, which may trigger succession there.
- Pending invites from a player are cancelled when that player stops being leader or leaves.

Party states:

| From | Event | To |
|---|---|---|
| idle | leader queues | queued |
| queued | matchmaker seats the party | in_lobby |
| queued | leader cancels, or any member leaves | idle |
| in_lobby | leader leaves the lobby | idle |
| in_lobby | countdown ends | in_match |
| in_match | match finishes | idle (same members) |

Rejections:

- queue when not idle: 409 invalid_transition
- cancel when not queued: 409 invalid_transition
- leave lobby when not in_lobby: 409 invalid_transition
- invites accepted, or joins attempted, while either party is not idle (queued included): 409 party_busy
- leaving the party while in_match: 409 party_busy

When any member leaves the party while it is in_lobby, the leader included, that member gives up their seat and gets a new idle party of one. The rest of the party stays seated, with succession if the leader left. When a member leaves while the party is queued, the search is cancelled for the rest. When a cancel and a placement race, whichever commits first wins, and the other gets the accurate current state.

**Matchmaking and lobbies.**

- A queued party is seated within 2 seconds of queueing.
- Parties are seated in queue order (queue time, then party id). Each goes into the oldest lobby in state filling with at least as many free seats as the party has members. If there is none, a new lobby opens.
- Each party is seated atomically: whole or not at all. No lobby ever holds more than 12 players, even when two leaders race for the last seats or when more than one server process shares the database.

Lobby states:

| From | Event | To |
|---|---|---|
| filling | 12th seat filled | countdown, which lasts 10 seconds on the server clock |
| countdown | any seat freed | filling, countdown cancelled, seat reopened |
| countdown | countdown ends | running, match created, every seated party moves to in_match |
| running | match finishes | finished |

When the lobby fills again, the countdown restarts from the full 10 seconds.

**Matches and rounds.**

| Round | Kind | Name | Kind label | Slots | Time limit | Course |
|---|---|---|---|---|---|---|
| 1 | race | "Wobble Dash" | "Race" | ceil(0.6 × starters) | 60 seconds | course length between 100 and 140 m |
| 2 | survival | "Sweeper Spin" | "Survival" | ceil(0.5 × starters) | 45 seconds | circular arena of 15 m radius |
| 3 | final | "Crown Climb" | "Final" | 1 (the winner) | 60 seconds | course length between 60 and 80 m |

- Round 1's starters are the 12 seated players. Each later round's starters are the previous round's qualifiers.
- Each round is created in state pending with a random 32-bit seed, and its slots value is derived and stored once at creation.
- A round spends 5 seconds in pending before it runs. It then runs from tick 0 until it is decided or reaches its time limit, and becomes resolved, with `lastTick` and results stored.
- If a round would have exactly one starter, that player is the winner and the match finishes. With no starters, the match finishes with no winner.
- A final that ends without a finisher has no winner.
- The match is named "Cup #<id>". When it finishes, its lobby finishes, every party returns to idle, and the results show.
- Forfeiting follows the forfeit rule under Inputs.

**Simulation** (the same rules govern live rounds, frames and `/api/simulate`, and all three agree exactly):

- **Ticks:** 20 per second. Tick 0 is the spawn frame. The input in effect for a player at tick `<T>` drives the step from tick `<T>` to `<T+1>`.
- **Coordinates:** in metres. +z points from the start toward the finish, +y is up, and +x is the runner's left as seen from the follow camera. Course floors sit at y = 0.
- **Movement:**
  - Gravity: 30 m/s².
  - Direction: the input direction is the sum of the pressed direction bits, scaled to unit length. A diagonal moves at the same speed as a straight line.
  - Running: while grounded, horizontal velocity is set to 8 m/s in the input direction (zero with no direction). While airborne, horizontal velocity carries over and steering has no effect.
  - Jump: on every tick the jump bit is set and the bean is grounded, vertical velocity becomes 10 m/s. Holding Space bounces again on each landing.
  - Dive: on every tick the dive bit is set and the bean is not already diving, horizontal speed becomes 12 m/s in the input direction (or +z with no direction) and 3 m/s is added upward. The dive lasts 12 ticks, during which steering and jump are ignored. Holding Shift starts a new dive as soon as one ends.
- **Scope of checks:** the builder's own course generator decides the course layout, obstacle shapes and sizes, and collision response. No check computes a trajectory independently. Simulation checks compare the app's own outputs with each other (live broadcast, stored results, frames and simulate) and with the rules printed here: tick rate, spawns, bean states, fall and respawn timing, qualification, ranking and the guarantees below.
- **Input buttons** are a value from 0 to 63 that adds these bits:
  - 1: forward (+z)
  - 2: back (−z)
  - 4: left (+x)
  - 8: right (−x)
  - 16: jump
  - 32: dive

  Opposite directions cancel out.
- **Obstacles:** spinning sweepers, moving platforms (sliding along x) and bumpers (which knock beans back). Their placement comes only from the seed, and their motion only from the tick number, never the wall clock. Beans pass through each other.
- **Spawns:** race and final starters spawn in ascending id order, in rows of four at x = 3, 1, −1 and −3, with rows at z = −2, −4 and −6. Survival starters spawn evenly around a ring of 8 m radius, in ascending id order. The spawn area and the first 10 m past the start line hold no obstacles.
- **Falls:** take a bean that is alive at tick `<F-1>` and has y below −5 at tick `<F>`.
  - In race and final, it is falling from `<F>` through `<F+19>`, with gravity continuing and input ignored. It is respawning from `<F+20>` through `<F+39>`, frozen at x = 0, y = 0 and the z of the last checkpoint passed (the start line and every 25 m after it). It is alive again from `<F+40>`.
  - In survival, it is eliminated from `<F>`.
- **Bean states:** every broadcast tick, frame and DOM `data-state` uses exactly one of these values: `alive`, `falling`, `respawning`, `qualified` or `eliminated`.
  - Every bean is alive at tick 0.
  - A bean is qualified from its qualifying tick and eliminated from its elimination tick, both inclusive.
  - From that tick on, its position stays where it was on that tick. For a forfeit, the position stays where it was on the tick before.
- **Finishing:** in race and final, a bean finishes on the first tick its z reaches the finish line while alive.
- **Guarantees for every seed:**
  - A lone bean that holds only forward from tick 0 finishes the race course in under 40 seconds and the final course in under 30 seconds.
  - A lone bean with no input in the survival arena falls within 30 seconds. The race and final courses are at most 10 m wide with nothing beyond x = ±5 m, so a lone bean that holds only right from tick 0 runs off the side and falls within 5 seconds.
- **Rounding:** the simulation keeps full precision internally and never feeds rounded values back into itself. Every position that leaves it (WebSocket, frames API, simulate API, DOM) is rounded to three decimals, with halves rounded away from zero. Re-simulating a stored round from its seed, starters, effective inputs and forfeits reproduces every broadcast tick, every stored result and `lastTick` exactly.

**Inputs.**

- The client stamps each input with the latest tick it has received. Let `<L>` be the latest tick the server has simulated when the input arrives.
- An input stamped `<T>` is accepted when all of these hold:
  - its round is running
  - it comes from a player in play
  - its buttons are from 0 to 63
  - `<T>` is from `<L-10>` to `<L+10>`

  This window absorbs up to half a second of transport delay either way.
- Rejections are checked in this order:
  1. invalid: malformed, wrong match or round, or buttons out of range
  2. not_playing: round not running, or player not in play
  3. late: `<T>` below `<L-10>`
  4. early: `<T>` above `<L+10>`

  Each rejection is sent back as `input_rejected` with the stamped tick.
- An accepted input's effective tick is the later of `<T>` and `<L>`. The input drives the next step and never rewrites a tick already simulated. It holds until the player's next accepted input.
- Each player has at most one input per effective tick. A later accepted input with the same effective tick replaces the earlier one. The stored and exported inputs are exactly these effective inputs, so no two exported entries share a tick and user id.
- Every effective input is stored in PostgreSQL with its round, effective tick, player and buttons before the round becomes resolved.
- **Forfeits:** a forfeit from a player in play, made when the latest simulated tick is `<L>`, is stored as a forfeit event at tick `<L+1>`.
  - The bean is eliminated at that tick and keeps its tick `<L>` position. The forfeiting player then spectates.
  - Forfeit events are stored in PostgreSQL with the round's inputs, exported with them, and accepted by the simulate endpoint, so a round with forfeits re-simulates exactly.

**Qualification and ranking.**

- **Last tick:** a round's last tick is the tick it is decided. If it is not decided sooner, it is its time limit in ticks (the time limit in seconds × 20). A round is decided at the first tick on which any of these holds:
  - race: the number of qualified beans reaches the slots value
  - survival: the number of beans not eliminated is at or below the slots value
  - final: a bean finishes
  - any kind: no bean is still in play (alive, falling or respawning)
- **Race and final finishes:** beans that finish on the same tick are taken in ascending player id order and qualify until the slots are full. In the final, the single slot makes the first of them the winner. A bean that finishes on the deciding tick after the slots are full does not qualify.
- **Survival:** on the deciding tick, if more beans fall than are needed to reach the slots value, the fallers with the lowest ids are kept as survivors until the slots value is reached. Every bean not eliminated on the last tick qualifies on it. At the time limit this can be more beans than the slots value.
- **Terminal states:** on the last tick, only beans still in play (alive, falling or respawning) that have not qualified are eliminated, on that tick, with their position frozen where it was on that tick. This includes finishers beyond the last slot. Beans already eliminated before the last tick, by a survival fall or a forfeit, keep their original elimination tick and their frozen position; the last tick never changes them. Results always hold one entry per starter:
  - qualified: `finishTick` is the qualifying tick, `eliminatedTick` is null
  - eliminated: `eliminatedTick` is the tick the bean was eliminated (its survival fall, its forfeit, or the last tick for beans still in play then), `finishTick` is null
- Rank at tick `<T>`:
  1. Beans qualified by `<T>`, ordered by qualifying tick and then id. In survival, survivors qualify only on the last tick.
  2. Beans still in play, ordered by z descending and then id in race and final, or by id in survival.
  3. Eliminated beans, ordered by their own elimination tick descending. Beans eliminated on the same tick are ordered by z at that tick descending and then id in race and final, or by id in survival.
- A result's `position` is its rank at the last tick.
- `slotsLeft` at `<T>`: in race and final, slots minus beans qualified by `<T>`; in survival, beans alive minus slots, never below zero.
- Markers appear only in the last-tick frame. `last_slot` goes to the lowest-ranked qualifier and `first_out` to the bean ranked immediately after it.
- Profile placement text is "Winner", or "Out in <round name>" for players eliminated in that round. Every participant of a finished match is either its winner or was eliminated in exactly one round, because a match with no winner eliminates everyone. These are therefore the only two texts.

**Spectating.** The match camera follows one bean, chosen in this order:

- While you are in play, it follows your own bean, and `data-following-user-id` is your own id.
- If you are eliminated, or qualified and waiting for the round to end, it follows the lowest-id party friend still in play.
- If no party friend is in play, it follows the rank-1 bean in play.
- When no bean is in play (the round is pending or resolved, or the last bean has just left play), the camera holds a fixed overview framing the whole course and its finish line. `data-following-user-id` is then empty, and `status "Spectating"` is not shown.

**Bean hue.**

- A player's hue is `H[(id × 5) mod 12]`, where `H` is the list 30, 40, 50, 60, 185, 200, 215, 230, 250, 270, 290, 310 (degrees, counted from index 0).
- The API `hue`, every SVG bean's `data-hue` and the 3D mesh body all use it.
- On the match and photo-finish canvases each visible bean mesh body plainly carries its player's hue. This is judged from screenshots under DP-44, not measured pixel by pixel.
- No bean hue falls in the red or green ranges reserved for eliminated and qualified.

**Chat.**

- Message bodies are trimmed and must be 1 to 500 characters.
- Each sender may send at most 5 messages in any rolling 5 seconds, across all channels.
- Party chat belongs to the party.
- Direct messages are allowed only between accepted friends with no block in either direction.
- New messages reach recipients' open logs within one second. Unread counts: a message from another player that arrives while the page is open and its log is not on screen is unread. A party message stops being unread when `log "Party chat"` is on screen (the Party chat tab selected in the open dock), and a direct message when `log "Messages with <handle>"` for its sender is on screen. While `<n>` of a tab's messages (party messages for Party chat, direct messages for Messages) are unread, with `<n>` at least 1, that tab is named "Party chat (<n> unread)" or "Messages (<n> unread)"; otherwise it is named "Party chat" or "Messages". Your own messages are never unread. The counts belong to the open page and start at 0 on every load.

**Voice.**

- Voice is a peer-to-peer WebRTC mesh between the party members who have joined voice, using host candidates only. Voice is guaranteed only in the voice environment stated in Browser support and performance.
- The server relays signalling only between members of the same party who are both in voice. Any other signal gets `{"type":"error","code":"not_in_voice"}`.
- Muting disables the outgoing audio track. While Push to talk is on, the track is enabled only while V is held.
- Speaking is true while the outgoing audio level stays above a fixed threshold for at least a tenth of a second, and it is never true while muted or while Push to talk is on without V held.
- Voice state reaches other members' tiles within one second. Audio is never recorded or stored.

### Services (DP-01, DP-02, DP-05, DP-06, DP-45)

**PostgreSQL** (`DATABASE_URL`) stores:

- accounts (password hashes only), sessions, link tokens and their sent times
- friendships and requests, blocks
- parties, memberships with join times, invites
- lobbies and seats
- matches, rounds (seed, starters, slots, last tick)
- per-round results with finish and elimination ticks
- every effective input and every forfeit event
- chat messages

The app applies its schema idempotently every time it starts serving, not only at build time.

**Mailpit** (SMTP at `SMTP_HOST`:`SMTP_PORT`, no authentication, no TLS) receives one message per link sent, from `Pratfall Cup <no-reply@wobblewell.test>`:

| Message | Sent to | Subject | Body |
|---|---|---|---|
| verification | the account's email | "Verify your Pratfall Cup email" | the verify link and the line "This link expires in 30 minutes." |
| reset | the account's email | "Reset your Pratfall Cup password" | the reset link and the same expiry line |

A reset request for an email with no account sends nothing.

When Mailpit is unreachable, which the app decides within 5 seconds of trying:

- Sign-up still returns 201 with `"verificationEmail":"failed"`.
- Resend returns `503 mail_unavailable`.
- Every password-reset request returns `503 mail_unavailable`, whether or not the email has an account.
- No token issued during a failed send is usable.

Once Mailpit is back, Resend sends a fresh link, which invalidates any earlier link.

### Seed data (DP-01, DP-08, DP-32, DP-36)

Every seeded person, handle and match is invented. Seeding runs idempotently at serve time. All seeded players are in their own party of one, offline, with no messages.

Players, all with the password `Bounce-Seed-2026` and the email `<handle>@wobblewell.test`:

| id | handle | verified |
|---|---|---|
| 1 | pip_bounce | yes |
| 2 | juniper_jolt | yes |
| 3 | marlo_tumble | yes |
| 4 | sunny_skid | yes |
| 5 | otto_wobble | yes |
| 6 | rue_flop | yes |
| 7 | kit_kaboom | yes |
| 8 | bea_boing | yes |
| 9 | nico_noodle | yes |
| 10 | tamsin_trip | yes |
| 11 | wren_whoops | yes |
| 12 | ivo_splat | yes |
| 13 | lula_leap | yes |
| 14 | dex_dash | yes |
| 15 | cleo_clatter | yes |
| 16 | fen_fumble | yes |
| 17 | late_lark | no |

Friendships: pip_bounce–juniper_jolt, pip_bounce–marlo_tumble and juniper_jolt–marlo_tumble are accepted. sunny_skid has a pending request to pip_bounce. There are no blocks.

Match 1, "Cup #1", is finished. It started at 2026-10-25 19:00:00 UTC and finished at 19:06:00 UTC, and players 1 to 12 took part.

| Round | Seed | Stored inputs |
|---|---|---|
| 1 (race) | 20261026 | players 1 to 10 hold buttons 1 from tick 0; players 11 and 12 send nothing |
| 2 (survival) | 4242 | none |
| 3 (final) | 777 | every starter holds buttons 1 from tick 0 |

The slots, qualifiers, last ticks, results and winner of match 1 are computed once by the simulation when seeded and stored like any other round. Later rounds' starters come from the earlier rounds' qualifiers.

## Technical requirements

### Deployment (DP-37)

The runtime is Node.js 22 with npm, and all code is TypeScript. `/app/run.json` holds string commands:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"npm run build","serve":"npm start"}
```

`serve` binds to `0.0.0.0` on port 4173, or on `APP_PUBLIC_PORT` when it is set, and serves the API, the WebSocket and the built browser app from that one port. `GET /api/health` follows the health rule in API.

### Configuration and secrets (DP-37, DP-45)

Read at start, from the environment only:

- `DATABASE_URL`
- `SMTP_HOST`
- `SMTP_PORT`
- `APP_PUBLIC_PORT` (optional)
- `APP_PUBLIC_URL` (optional, the link base)

`MAILPIT_URL` may be present and is not used by the app. No credential or connection string is hard-coded, logged, written into the browser bundle, or included in any response. Session cookies are named `pc_session` and are `HttpOnly` and `SameSite=Lax`.

### Server boundary (DP-37)

- Same origin only: no cross-origin headers. State-changing requests and WebSocket upgrades follow the bad-origin rule in API, and the body limits apply as stated there.
- The server never serves TypeScript source, source maps, `.env` files, package manifests, lockfiles, `node_modules` or `run.json`. Those paths return the app's 404.
- Unknown non-API paths return the app shell so client routes work.
- If PostgreSQL is unreachable at boot, the server keeps retrying every 2 seconds and health reports starting. If Mailpit is unreachable at boot, the server starts normally and follows the outage rules in Services.
- A second server process (for example, one started with mail pointed at a dead address) may share the database. Seating and seat counts stay correct across processes. Presence, live matches and voice only need to work among clients connected to the same process.

### Browser support and performance (DP-38, DP-40)

- Supported: current Chromium, Firefox and Safari at viewports 375×812, 768×1024 and 1280×800, including headless Chromium with software WebGL.
- The app shell is usable within three seconds of load.
- The match canvas draws its first frame within five seconds of the round's first tick, and live standings refresh at least four times a second.
- The photo-finish view is usable within three seconds of opening.
- Voice environment: voice is supported when every party member's browser can reach the others directly, on the same machine or the same local network, and the app is opened from a secure context. HTTPS counts, as does plain HTTP on `localhost` or `127.0.0.1`. Checks run every browser on one machine with a synthetic microphone. Outside this environment, voice may fail to connect. Where the browser refuses the microphone, the app shows the microphone-blocked copy from Feedback states.
- Scenes stay low-poly, with no post-processing and no shadows, so software WebGL keeps at least 15 frames per second for a 12-bean round.

## Working rules

- IF-01: `/app/run.json` exists, with `"_schema":"run-manifest-v1"` and string `install`, `build` and `serve` commands that build and serve the app as described in Deployment.
- IF-02: `/app/THIRD_PARTY_NOTICES.md` lists every shipped package (name, version, licence) and every shipped font (family, file, licence). A package ships when `/app/package.json` lists it under `dependencies` or `optionalDependencies`, along with every package those depend on in turn as installed. `devDependencies` hold build and test tooling only: after the build, `npm prune --omit=dev` leaves an app that still serves the same pages. A font ships when its file is in the app outside `node_modules`, build output included.
- IF-03: Shipped packages use only MIT, ISC, BSD-2-Clause, BSD-3-Clause or Apache-2.0 licences. Shipped fonts use only OFL-1.1. The two allowlists are kept separate.
- IF-04: PostgreSQL is the only datastore. The app uses no other database, cache server, object storage, replay archive or file-based store, and keeps no replay video or snapshot files. The photo-finish re-simulates from inputs stored in PostgreSQL.
- IF-05: At runtime the app contacts no host other than its configured services. The one exception is the direct WebRTC voice connections between party members' own browsers. Fonts, icons and scripts are self-hosted, and voice uses no external STUN or TURN servers.
- IF-06: Server and browser source is TypeScript, compiled with strict type checking.
- IF-07: The provided service compose files and seeded service configuration stay unchanged.

## Engineering standards

These are source-review standards. The quality judge grades them by reading the code. They add no behaviour beyond the sections above.

- Code is idiomatic, strictly typed TypeScript. It uses no `any` and no non-null assertions to silence the compiler.
- Names in code match this brief's domain terms: party, leader, lobby, seat, countdown, round, starters, slots, tick, seed, input buttons, frame, rank, qualified, eliminated, spectating, presence.
- Each domain rule is decided in exactly one place in the source: every state transition, slot count, rank order, tie-break, hue, link expiry and presence status, and the round simulation that live rounds, frames and the simulate endpoint share.
- Every error response is built through one error shape matching the API section. No endpoint invents its own.
- The code has no dead, commented-out or unreachable code, and no defensive checks for states the types or the database constraints already rule out.
- Concurrency rules (seating, crossed friend requests, cancel against placement, concurrent link issuance) hold across server processes because the database decides them, never in-process timing.
- The code contains no feature, endpoint or setting beyond this brief.
