# TRUTH — Wobblewell Arcade Pratfall Cup (golden)

Every value says where it came from: `brief: <section>` (copied from the brief) or `decided: <why>` (the brief is
silent; the reason ties it to the brief's intent).

## 1. Journeys (ideal end-to-end flows)

### J1 Sign up and verify (DP-01, DP-02, DP-03, DP-06, DP-07)
- Start: signed-out visitor on `/signup` (brief: Journeys 1). Single centred card, product name above it (brief: Screens and layout).
- Action: fill `Email`, `Handle`, `Password`; press `Create account`. Button disabled + `aria-busy="true"` reading "Creating account…" (brief: Feedback states).
- Server: `POST /api/auth/signup` → 201, session cookie `pc_session` (HttpOnly, SameSite=Lax), new party of one, verification link stored with its send time on the process clock and mailed through Mailpit (brief: API, Business rules, Services).
- Visible end of step: Notices "Account created. Check <email> for your verification link."; the app shell with region "Verify your email" ("Verify your email to add friends and find matches." + `Resend verification email`) (brief: Feedback states).
- Unverified rail: the `Add friend by handle` field stays usable with the note "Friends unlock once your email is verified."; sending answers 403 `email_unverified` → Notices "Verify your email first." (brief: Feedback states, "any email-unverified rejection").
- Mail outage: Notices "Account created, but we couldn't send your verification email. Resend it once mail is back."; Resend → "Mail is down right now. Try again in a minute." (brief: Feedback states, DP-06).
- Open link `/verify?token=…`: region "Verification" shows "Checking your link…", then "Email verified. You can add friends and play." (brief). Then `/` shows the rail's `Add friend by handle` field and no banner.
- Provider record: Mailpit holds one message per link sent, from `Pratfall Cup <no-reply@wobblewell.test>`, subject "Verify your Pratfall Cup email", body = link + "This link expires in 30 minutes." (brief: Services). PostgreSQL `users.email_verified = true`; `link_tokens.status` `used`.
- Invalid then valid submit: a taken handle shows "That handle is taken." under the field and Notices "Check the highlighted fields."; fixing it creates the account.

### J2 Make a friend and watch presence (DP-08, DP-09, DP-10, DP-11)
- Start: two verified players, not friends, each signed in (brief).
- A types B's handle in `Add friend by handle`, presses Enter → Notices "Friend request sent to <handle>.", field cleared (brief: Interactions, Feedback states). Unknown handle → "No player called <handle>." and the field keeps its text.
- B's rail `Requests` list shows `Accept <handle>` within a refetch triggered by the `friends` push; B presses it → "You and <handle> are now friends." (brief).
- Both rails list each other in `Friends` with `data-presence` online (heartbeats every 5 s) (brief: Business rules). When A joins a party of two → `in_party` within 2 s; when A's tab closes → `offline` once 15 s pass without a heartbeat (brief).
- Provider record: `friendships` row (low_id, high_id, since); no `friend_requests` row left.

### J3 Block a player (DP-12, DP-13)
- A opens `/u/<B>`, presses `Block <B>` → "<B> is blocked."; the profile offers `Unblock <B>` (brief).
- One transaction removes the friendship, friend requests and party invites both ways (brief: Business rules). Both rails drop the other on the `friends` push. DMs → `403 blocked`; presence hidden (`presence: null`) and no presence events cross the pair.
- Unblock → "<B> is unblocked."; profile shows `Add friend` (strangers again).

### J4 Assemble a party, chat and talk (DP-14, DP-15, DP-16, DP-29, DP-30, DP-31)
- Leader presses `Invite <handle> to party` on each friend row → "Invite sent to <handle>."; invitee's stage shows region "Party invites" with `Join <leader>'s party` → "You joined <leader>'s party." (brief).
- All four see `list "In your party"` (rail) and `list "Party members"` (stage) with the same four ids; the leader's row has `data-leader="true"` and the text "Leader" (brief).
- Party chat: message appears in every member's `log "Party chat"` (bean, handle, time) within 1 s (brief).
- Voice: `Join voice` asks for the microphone ("Connecting…"), then "You joined voice."; tiles carry `data-connected`, `data-muted`, `data-speaking` (brief).
- Leader presses `Leave party` → "You left the party."; the others see the badge move to the earliest-joined member and "<handle> is now party leader." (brief).

### J5 Queue and fill a lobby (DP-17, DP-18, DP-19, DP-20)
- Leader presses `Find a match` → button pending "Finding a match…" → Lobby view (queued: "Finding a match…", `Cancel search`) → seated within 2 s: "Seated in a lobby.", region "Lobby" `data-state="filling"`, `status "Seats"` "<n> of 12 seated", 12 seat `listitem`s (brief).
- 12th seat → `data-state="countdown"`, `timer "Countdown"` "Starting in <n>" counting down each whole second (brief). A seated player leaves → "A player left. Countdown cancelled — waiting for players.", timer gone, `data-state="filling"`, seat reopened.
- Countdown ends → every seated party `in_match`; the Match view replaces the Lobby view.

### J6 Play, fall, spectate, regroup (DP-21–DP-28)
- Match view: canvas `img "3D course view"`, `status "Round"` "Wobble Dash · Race", `timer "Round clock"` m:ss, slots-left numeral, `list "Live standings"` (12 rows) (brief).
- Keys WASD/arrows, Space, Shift (or touch stick, Jump, Dive) set `data-buttons`; the client sends the value on each change stamped with the latest received tick (brief).
- Own outcome → `alert "Round result"` "Qualified!", "Eliminated" or "You won Pratfall Cup!", popping in, fading after 3 s (brief).
- Out of play → `status "Spectating"` "Spectating <handle>" following the lowest-id party friend in play, else the rank-1 bean; `Previous player` / `Next player` cycle beans in play in rank order (brief).
- Match over → "Cup #<id> is over. You're back with your party."; region "Results" with heading "Cup #<id> results", `list "Final standings"`, `link "Photo-finish: <round name>"` per round, `Back to party` (brief). Party is idle with the same members.

### J7 Check a photo-finish (DP-32–DP-36)
- `/u/<rival>` → `list "Match history"` → `link "Cup #1"` with "Winner" or "Out in <round name>" → `/matches/1` (heading "Cup #1", per round kind, seed, starters, slots, qualified players, `Photo-finish: <name>`) → `/matches/1/rounds/<n>` (brief).
- `slider "Playhead"` 0…lastTick ("Tick <T> of <lastTick>"); arrows ±1, Page Up/Down ±20, Home, End, click, drag (brief). URL `?tick=` replaced (no history entries).
- `list "Lanes"` rows in rank order carry `data-tick/x/y/z/rank/state/hue`; at the last tick the last qualifier shows "Last slot" (`data-marker="last_slot"`) and the next "First out" (brief).

## 2. Palette (DP-43)

| Role | Hex | Use | Source |
|---|---|---|---|
| Ground (cream) | `#FBF1DE` | page, panels, 3D sky | brief: Visual design (warm cream); decided: hex |
| Ground, deeper | `#F3E3C3` / `#E9D3A8` | cards, panels, hover shades | brief: "slightly deeper cream fills instead of shadows" |
| Paper | `#FFFAF0` | fields, list cards | decided: lightest cream tint for inputs |
| Ink | `#231942` | all text, icons, outlines | brief: deep midnight violet-navy; decided: hex |
| Accent (pink) | `#FF4F7B` (hover `#F2386A`) | primary buttons (ink label), focus ring, selected tab, playhead thumb, 3D finish line, online presence dot | brief; decided: hex |
| Qualified (teal) | `#08776A` | qualified marks, last-slot ring/chip, winner text | brief; decided: hex (4.6:1 on cream) |
| Eliminated (red) | `#C8102E` | eliminated marks, first-out ring/chip, "Eliminated" banner | brief; decided: hex |
| Bean body | `hsl(H 72% 55%)`, H from the hue list | every bean, SVG and 3D | brief: hue rule; decided: saturation/lightness for "strong, mid-light" |

Pink text is never used on cream; field errors use ink text with an ink bar (red is reserved for eliminations) — decided: colour roles.

## 3. Type, space and layout

- Display: Bricolage Grotesque 700/800 — headings, round names, results header (brief). Body: Atkinson Hyperlegible 400/700 (brief). Numbers: Atkinson Hyperlegible Mono with `tabular-nums` (brief).
- Scale (ratio 1.333, brief: "about a third larger"): body 1rem, h3 1.333rem, h2 1.777rem, h1 2.369rem (≈2.37× body, brief: "about two and a third").
- Density: 1rem base gap, 1.5rem card padding, row gaps 0.6rem; every control ≥ 44×44 px (brief).
- Panels/cards: 2px ink outline, 16px radius, no shadows (brief).

| Viewport | Layout | Source |
|---|---|---|
| ≥1024 (1280×800) | three columns: rail 20% · stage · dock 25vw; `Collapse dock` shrinks the dock to a 64px strip with `Expand dock`; choice stored in `localStorage` key `pc-dock` | brief; decided: 64px strip, key name |
| 640–1023 (768×1024) | rail 15rem column + stage; dock hidden behind top-bar `Party dock`, opening as a dialog panel (≤26rem) over the right side; match canvas full stage width; touch controls shown | brief; decided: 640 breakpoint, 15rem rail |
| <640 (375×812) | one column; top bar `Friends` and `Party dock` open full-screen dialogs; match canvas edge-to-edge with touch controls along its bottom; photo-finish lanes stack under the playhead | brief |

Touch controls show when `(max-width: 1023px), (pointer: coarse)` (brief: narrower than 1024 or coarse pointer).

## 4. Motion (DP-35, DP-41)

| Element | Trigger | Duration | Easing | Reduced motion | Source |
|---|---|---|---|---|---|
| Party-card and lobby-seat beans | always while shown | 2000 ms cycle, 2 px rise, phase offset per bean | ease-in-out wave | none (beans still) | brief; decided: a paused `element.animate()` per bean, scrubbed from page time by one shared 50 ms timer (20 steps/s is smooth for 2 px and keeps the page idle between steps, unlike a per-frame loop) |
| Seat fill | a bean takes a seat | 480 ms drop from −28 px | cubic-bezier(0.22,1,0.36,1) | appears in place | brief (~½ s) |
| Dock collapse/expand | toggle | 250 ms width | ease-out curve above | instant | brief (~¼ s) |
| Friends / Party dock panels | open | 250 ms slide from their edge | same | instant | brief |
| Round result banner | own outcome | 160 ms pop from 0.9 scale (grows from its bottom edge), fades 300 ms after 3 s | same / ease-out | appears, removed after 3 s | brief |
| Presence dot, voice tile ring, tabs, buttons hover | state change | 160 ms colour/ring | same | colour change kept (not movement) | brief (~⅙ s) |
| Button press | pointer down | translateY(1px) | — | none | brief |
| Countdown, round clock | each second | instant swap | — | — | brief |
| Photo-finish beans | every playhead change | 150 ms glide; `data-beans` moving→still | ease-out cubic | cut; never "moving" | brief (0.1–0.2 s) |
| Photo-finish camera | jumps (>1 tick, Home/End/Page keys, click, drag end) | 500 ms flight to frame rank-1 bean + finish line; `data-camera` moving→still | ease-out cubic | cut; never "moving"; `table "Photo-finish frame"` in a polite live region | brief (0.4–0.6 s) |
| Live match camera | each broadcast tick | eases 35% toward the followed bean per tick | — | kept (play) | brief; decided: per-tick ease so it follows server ticks |

3D scenes (decided, brief: low-poly, flat shading, cream sky, no shadows or post-processing): no multisampling; static course parts merged into one mesh per colour plus one ink outline set; the live canvas is drawn on the next animation frame after each broadcast tick (at most once per frame); Lambert flat-shaded meshes with ink edge lines, hemisphere light 2.6 + one directional light 0.8 (upward faces at about full colour), scenes shaded in sRGB values so a mesh shows its SVG bean's hue; finish line = 1 m pink stripe across the course with two low ink-outlined posts; photo-finish camera is a three-quarter view from the runners' right that frames the rank-1 bean, the finish line (wherever it is, so early ticks frame a longer stretch) and, on the deciding tick, the last-slot bean (teal ring, radius 0.7 m) and first-out bean (red ring, radius 0.95 m).

## 5. States per async action (DP-42)

Pending = button disabled + `aria-busy="true"` (+ pending copy where listed); a new action first clears the Notices
region so its own outcome is what gets announced (decided: the region always describes the latest action).

| Action | Pending | Success | Errors |
|---|---|---|---|
| Create account | "Creating account…" | "Account created. Check <email> for your verification link." / mail failed copy | field copy (email, handle, password, taken) + "Check the highlighted fields." |
| Resend verification | "Sending…" | "Verification email sent to <email>." | "Your email is already verified." / "Mail is down right now. Try again in a minute." |
| Verify link | "Checking your link…" | "Email verified. You can add friends and play." | "This link has expired. Request a new one." / "This link has already been used or replaced by a newer one." |
| Sign in | "Signing in…" | goes to the app | "Email or password is wrong." |
| Send reset link | "Sending…" | "If that email has an account, a reset link is on its way." | mail-down copy; email field copy |
| Set new password | "Saving…" | "Password changed. Sign in with your new password." | link copies; "Use 10 to 128 characters." |
| Send / accept / decline / withdraw request, remove, block, unblock | "Sending…" (send) | brief copy | brief copy; your own handle is a field error ("You can't add yourself." under the add-friend field, Notices "Check the highlighted fields." — brief: API 422 field handle); other rejections "That can't be done right now." |
| Invite / join / decline invite / leave / hand over | — | brief copy (succession copy to every member) | "That party is full." / busy / leader-only / friends-only / invite closed |
| Find a match / cancel / leave lobby | "Finding a match…" (stays while queued) | "Seated in a lobby." / "Search cancelled." / "You left the lobby." | "Your party is already searching or playing." / "Your party isn't searching any more." |
| Countdown cancelled, match over, forfeit | — | brief copy | — |
| Send message | — | appears in the log | "Messages are 1 to 500 characters." (field) / "Slow down — you can send again in a few seconds." / "You can't message this player." |
| Join voice | "Connecting…" | "You joined voice." | "Microphone blocked. Allow microphone access to talk." |
| Live connection | "Reconnecting…" | "Back online." | — |
| Any unexpected server error | — | — | "Something went wrong. Try again." |

## 6. Breakpoints

`640px` (rail column ↔ Friends dialog) and `1024px` (dock column ↔ Party dock dialog; touch controls) — decided:
the brief's three viewports fall cleanly on either side. No horizontal overflow at 375, 768, 1280 (brief).

## 7. Simulation and course (DP-21–DP-24) — decided where the brief leaves it to the builder

- Brief constants: 20 ticks/s; gravity 30 m/s²; run 8 m/s; jump 10 m/s; dive 12 m/s + 3 m/s up for 12 ticks; fall at y < −5; falling 20 ticks, respawning 20 ticks at (0, 0, last checkpoint; start line and every 25 m), alive at F+40; spawns x = 3, 1, −1, −3 in rows z = −2, −4, −6, survival ring 8 m; no obstacles in the first 10 m; race 100–140 m, final 60–80 m, ≤10 m wide; survival arena radius 15 m.
- Decided integration: semi-implicit Euler (velocity then position, dt = 0.05 s); a bean lands when it crosses y = 0 downward over floor; floors are point-supported.
- Decided course (seeded mulberry32): linear courses are a sequence of sections after z ≈ 12–14 m — spinning single-arm sweepers (radius 3.6–4.6 m, period 4–6 s), bumper rows (|x| 1.7–3.2 m, never in the middle lane) and up to 2 (race) / 1 (final) gaps of 3.5–5.5 m crossed by moving platforms (8 m wide, sliding ±1 m along x, period 60–100 ticks), never within 2.5 m of a checkpoint. Survival: one two-arm sweeper spanning the arena (period 6–9 s).
- Decided collision response: linear-course sweeper knocks (5 m/s, 6 m/s lift) never point outward from an outer lane (so a straight runner can't be thrown off the side); bumpers knock a runner 2 m/s back and in toward the middle lane, landing at 0.35 of its lane offset (lanes contract without collapsing onto one point); survival sweepers fling outward (7 m/s) and along the sweep (4 m/s) with 6 m/s lift. Beans pass through each other; platforms don't carry beans.
- Verified guarantees (decided check, 160,000 seeds incl. the middle and top of the range): lone forward race ≤ 769 ticks (< 800), lone forward final ≤ 523 (< 600), lone survival bean (2-bean run) falls ≤ 205 ticks (< 600), lone right-holding bean falls at tick ≤ 32 (< 100).
- Seeded Cup #1 (brief seeds 20261026, 4242, 777): race decided at tick 466 with 8 qualifiers (nico_noodle takes the last slot, pip_bounce is first out); survival 8 → 4 at tick 118; final won at tick 208 by user 9 (nico_noodle). pip_bounce's placement is "Out in Wobble Dash".

## 8. Server decisions

- Countdown end (`countdown_ends_at`) is stamped and compared on the PostgreSQL clock — decided: several server processes share the lobby, so they must agree on one clock; link expiry alone uses the process clock (brief).
- Seating runs in queue order under one PostgreSQL advisory lock; transactions that touch lobbies take that lock first (seating → party → lobby order) — decided: whole-party seating across processes (brief: DP-18).
- A lobby is hosted by the process its first party queued through; that process runs the match and broadcasts ticks. A forfeit sent to another process is relayed through `pg_notify` — decided: brief says live matches need work only within one process.
- Cross-process pushes (party, lobby, friends, invites, chat) go through PostgreSQL `LISTEN/NOTIFY`, each process re-reading state — decided.
- Every matches/replays endpoint, `/api/simulate` included, requires sign-in but not verification (brief: API, "Matches and replays (sign-in required, verification not required)").
- TypeScript source, source maps, `.env` files, package manifests, lockfiles, anything under `node_modules` and `run.json` return the app's 404; built assets are served as files; every other unknown non-API path returns the app shell so client routes work (brief: Server boundary). Where this is decided: `isForbidden` and `handleStatic` in `server/http.ts`.

## 9. Media and licences

| Item | Files | Licence | Source |
|---|---|---|---|
| Bricolage Grotesque | bricolage-grotesque-latin-700/800-normal.woff2 | OFL-1.1 | brief: type; copied from @fontsource at build |
| Atkinson Hyperlegible | atkinson-hyperlegible-latin-400/700-normal.woff2 | OFL-1.1 | brief |
| Atkinson Hyperlegible Mono | atkinson-hyperlegible-mono-latin-400/700-normal.woff2 | OFL-1.1 | brief |
| Lucide icons | bundled from `lucide` | ISC | brief: Lucide outline icons |
| Runtime packages | pg (+ pg-* / postgres-* / pgpass / split2 / xtend), ws, preact, three, lucide | MIT / ISC | decided; listed in THIRD_PARTY_NOTICES.md |

No images, audio files, video or replay archives; the bean is procedural SVG / low-poly mesh (brief).

## 10. Brief 3.0.0 rules beyond the 1.0.0 golden

Brief 3.0.0 adds or tightens the rules below. The app in `app/` implements each one. Every value comes from the brief, and its line is cited.

Where each rule lives (decided: one place per rule): identity copy `client/shell.tsx` (top bar) and `client/rail.tsx` (" (you)"); presence words `client/copy.ts`; Your profile link `client/rail.tsx`; profile counts `server/friends.ts` (`GET /api/users/<handle>`) and `client/pages.tsx`; unread counts `client/state.ts` (`showLogs`, `countUnread`) with the tab names in `client/dock.tsx`; invite pushes are `invites` events in `server/party.ts` / `server/friends.ts`, which `server/hub.ts` turns into a `party` push that makes the client refetch `/api/party`; link issuance `server/auth.ts` `issueLink` / `spendLink`; ids `positiveId` in `server/matches.ts`; pair lock `lockPair` in `server/users.ts`; rate limit `checkRate` in `server/chat.ts`.

How link issuance meets the rule (decided): every new link is stored as `sending`, then mailed. Once the mail is accepted, one transaction under the per-account advisory lock marks the active link of that kind `replaced` and the new one `active`. So when requests overlap, the last swap wins and every other link answers `410 link_invalid`. Spending selects only an `active` row `FOR UPDATE`, so concurrent uses of one link succeed exactly once.

### New product rules
- **Identity (DP-04; L46, L103, L136, L139):** the top bar shows the text "Signed in as <handle>" with your own handle next to `button "Sign out"`. In `list "In your party"` your own row shows your handle followed by " (you)", and no other row carries that suffix.
- **Presence words (DP-10; L140):** the screen-reader presence text in each `list "Friends"` row is exactly "Offline", "Online", "In a party" or "In a match", for `data-presence` offline, online, in_party and in_match.
- **Your profile (DP-32; L103, L141):** the rail has `link "Your profile"`, placed after the add-friend field and before Requests, opening `/u/<your own handle>`.
- **Profile counts (DP-32; L111, L178, L366):** `GET /api/users/<handle>` adds `"played":<n>,"wins":<n>`. They count every finished match the player took part in and every finished match they won, over all of their matches, not only the 20 listed. Running matches don't count. Under the profile heading, show the text "Matches played: <played>" and "Wins: <wins>" on every profile, your own included.
- **Unread counts (DP-29; L170, L637):** the dock tabs are named "Party chat (<n> unread)" or "Messages (<n> unread)" while n ≥ 1 messages are unread, and "Party chat" or "Messages" otherwise.
  - A message from another player that arrives while the page is open and its log is not on screen is unread.
  - Party messages clear when `log "Party chat"` is on screen (the Party chat tab is selected in the open dock).
  - A direct message clears when `log "Messages with <handle>"` for its sender is on screen.
  - Your own messages are never unread. Counts belong to the page and start at 0 on every load.
- **Invites leave the stage (L195):** when an invite stops being open for any reason, its Join and Decline buttons leave every open stage of both players within one second. The reasons are joined, declined, cancelled by a block, or cancelled because its sender stopped leading. `region "Party invites"` disappears once no invite is open. This needs a push to both players on every invite state change, leader hand-over included.
- **Concurrent link issuance (DP-02; L44, L446, L778):**
  - When several verification links (or several reset links) are requested concurrently for one account, exactly one of the issued links is still valid once every request has answered. All the others answer `410 link_invalid`.
  - The database must decide this, not in-process timing (L778), because several server processes share it. For example, lock the user row (`SELECT … FOR UPDATE`) in the same transaction that invalidates the earlier unused links of that kind and inserts the new one.
  - Concurrent uses of one link must also succeed exactly once (single use, L44), using a conditional `UPDATE … WHERE status = 'unused'`.

### Rules already in 1.0.0 that the golden must hold under load
- **Ids (L328):** ids are positive integers. A path or body id that is out of range for the database column, or that names no row, is simply "not found": answer the endpoint's documented 4xx (`404 request_not_found`, `404 not_friends`, `404 invite_not_found`, `404 match_not_found`, `404 round_not_found`, and the leader-change 422 or `403 not_friends`, as each endpoint lists). Never answer 500. Parse ids before querying, or use `bigint` parameters.
- **Blocking (DP-12; L54, L466–L472):** a block is one transaction that cancels pending friend requests and party invites in both directions. A friend request, an accept or a party invite that races a block must not leave a pending request, a friendship or a pending invite behind. Serialize on the pair, for example with an advisory lock on (low_id, high_id) taken by block, request, accept and invite, or with a re-check under row locks.
- **Rate limit (L410, L634):** at most 5 messages from one sender in any rolling 5 seconds, across all channels, even when requests arrive in parallel. Decide it in the database under a per-sender lock.

### Status after iteration 1 (2026-10-28)
- The app implements every rule above and scored oracle 1.0 (67/67) on the current bundle (`gf.py run stumblerush3 --agent both`: oracle 1.0, nop 0.0).
- The earlier `test_bean_hue_everywhere` failure was a test defect, and the bundle now fixes it: the test opens the Messages tab whatever its unread suffix. The app's tab naming ("Messages (<n> unread)", brief L170, L637) is correct. Do not change it, and make no app change for that failure.

### Status after iteration 2 (2026-10-28)
- The verifier run scored 66/67. The one failure, `test_wf_live_match_full_cup` ("no round-result banner for the player still in play"), comes from a timing race in the test. The app has no defect here, so there is no app change.
- What happens in that test: 11 of 12 starters forfeit, so the lone runner's qualifying tick is also the deciding tick (L602, "no bean is still in play"). Round 2 would then have one starter, so the match finishes at once (L529, L532).
- The app broadcasts the deciding tick first. That tick raises "Qualified!" in the client (`client/live.ts` `onTick`). The server then stores the results and finishes the match (`server/live.ts` `run`), all within a few database writes.
- The banner stays on the stage for 3 s, over the Results view (L259, `ResultBanner` in `client/stage.tsx`). The test stops looking for banners as soon as `GET /api/matches/<id>` reads `finished`, and it polls about every 125 ms. Whether it sees the banner depends on that gap, which the brief neither fixes nor asks for.
- The same app passed this test in iteration 1, which fits a timing race.
- The round-result banner pops in by scale only (0.9 → 1 over 160 ms, brief L259 "pops in from slightly smaller to full size in about a sixth of a second") and fades only after three seconds. An opacity fade-in made axe's colour-contrast check fail on `.round-result` whenever it ran during the pop. Keep the pop scale-only.

### Status after iteration 1 of the next golden round (2026-10-28)
- The verifier run scored 65/67. Two tests failed, and the app now has a fix for each.
- `test_feedback_states_outcomes` ("waiting for page socket"):
  - The client opened `/ws` only after `GET /api/me` answered, which is usually after the page's load event.
  - The test registers `route_web_socket`, reloads, then waits in a plain sleep loop. Playwright's sync API runs that handler only during a Playwright call, so the test saw the socket only when the socket opened during `reload()`.
  - Fix (decided: the live connection is part of booting the shell): app routes open the socket as the page boots, alongside the session load (`client/main.tsx`). `connect()` in `client/socket.ts` does nothing while a socket is open or opening. A 4401 close leaves no socket, so signing in reconnects.
  - The sleep-loop wait is still a test defect, filed as a dispute.
- `test_keyboard_and_screen_reader_access` (axe `color-contrast` on `.round-result`):
  - axe advances the paused page clock in 16 ms steps, so the banner's 3 s timer can fire mid-audit. axe then measured the text at partial opacity during the fade-out.
  - Fix (decided): a banner that has started its fade is already announced and on its way out, so it becomes `inert` for the fade (`BannerCard` in `client/match-view.tsx`). The pop stays scale-only and the fade is unchanged (brief L259).
- Self-test: a cold copy (`npm ci`, `npm run build`, `npm start` from `run.json`) passed both tests in the Linux Playwright container.

### Status after iteration 1 of the golden round on 2026-10-28 (evening)
- The bundle's brief is unchanged. Its tests differ from the published bundle only in docstrings and comments. Before this round, the app was byte-identical to the one that scored oracle 1.0.
- Added the method files: `DESIGN.md` and `PLAN.md` at the working-copy root, and `app/assets.json` as `[]`. No binary asset ships outside the build output, and the fonts are copied from `@fontsource` at build and listed in `THIRD_PARTY_NOTICES.md`.
- Tap targets (brief: Visual design, "Every tap target is at least 44 pixels in both directions"): the account-page text links, the Results photo-finish links, the top-bar brand and the rail's friend-handle links were 20 px tall. They are now at least 44 px tall (`client/styles.css`).
- Overflow (brief: Viewports, "No page scrolls horizontally"): at the last tick, the playhead thumb (28 px, centred on its tick) hung 14 px past the slider and made the 375 px photo-finish 2 px wide. The slider is now inset by half the thumb (`margin-inline: 14px`). Click, drag and keyboard still map to the same ticks, because pointer ticks are measured against the slider's own box.
- Visual critic (fresh context), fixes applied (decided: each finding traces to a brief line):
  - At 375 px the top bar cut "Signed in as <handle>" down to "Signed in as …" (brief: Public screens, top bar). Below 640 px the identity line now takes its own row under the brand and buttons.
  - In `list "In your party"` and `list "Requests"`, the Leader badge or the request note squeezed the handle to "pip_…". Those rows now wrap the badge or note onto a second line before the handle is cut. Only long handles still truncate (brief: "Long handles truncate with an ellipsis").
  - The photo-finish heading no longer breaks inside "photo-finish".
- Critic items not taken, because they are layout taste rather than brief rules and the layout already passes: friend-row actions on their own line, the empty stage below the party card, the summary page's qualified players as plain text, and the account-card heading size. The 3D beans already have eyes and the obstacles already have ink edges; at the photo-finish framing they are simply small.

### Status after iteration 1 of the golden round on 2026-10-29
- The brief is unchanged. The verifier was revised after the last oracle 1.0: among other changes, `axe()` now runs a fixed rule list (colour contrast included) on the lobby, live match, spectating and Results views too.
- The unchanged app passed all 74 revised tests from a cold `npm ci`, `npm run build` and `npm start` in the Linux Playwright container, with a second process on `SMTP_PORT=9` for the mail outage. Server and client `tsc` strict checks pass. No app change was needed.

### Status after iteration 2 of the golden round on 2026-10-29
- The kit's TRUTH check found that the static rule contradicted the brief (Server boundary: "Unknown non-API paths return the app shell so client routes work"). The app had the same defect: it returned 404 for any unknown path with a dot in its last segment, for example `/missing.png`.
- Fix: `isForbidden` in `server/http.ts` covers only the brief's list, which is TypeScript source, source maps, `.env` files, package manifests, lockfiles, `node_modules` and `run.json`. Those paths return the app's 404. Built assets are served as files, and every other non-API path returns the shell with 200.
- Self-test: a cold `npm ci` and `npm run build` passed the strict `tsc` checks. Probes then returned 404 for each forbidden kind, 200 with the shell for `/missing.png`, `/deep/x.js` and the client routes, and 200 for `/assets/app.js`.

### Status after iteration 1 of the golden round on 2026-10-29 (night)
- The brief is unchanged, and the app is byte-identical to the published solution that scored oracle 1.0.
- The verifier changed only in `test_feedback_states_outcomes`. Its socket waits now use `ui()` instead of a plain sleep loop (the dispute filed earlier). Its `/api/party` stubs now keep the real read's invites and change only the party. No app change was needed.
- Self-test: a cold `npm ci`, `npm run build` (strict server and client `tsc`) and `npm start` from `run.json` passed all 74 revised tests in the Linux Playwright container, with a second process on `SMTP_PORT=9` for the mail outage.

### Status after iteration 1 of the golden round on 2026-10-29 (early morning)
- The brief is unchanged, and the app is byte-identical to the published solution that scored oracle 1.0.
- The verifier changed only in `test_feedback_states_outcomes`. It now records every copy the Notices region shows (`record_notices`, `heard`), so a party reread that announces the search ending (L308) can no longer hide "Your party isn't searching any more." No app change was needed.
- Self-test: a cold `npm ci`, `npm run build` (strict server and client `tsc`) and `npm start` from `run.json` ran in the Linux Playwright container, with a second process on `SMTP_PORT=9`. The result was 73 of 74.
- The one failure was `test_interface_motion`, with `ValueError: could not convert string to float: ''` in `banner_gone`. It passed on two reruns of that test alone.
- Cause: `banner_gone` makes two separate calls, `is_visible()` and then a read of the computed `opacity`. `finish_motion` ends the 300 ms fade, and the app then removes the banner (`BannerCard` `onDone`, brief L259: the banner "fades after three seconds"). If the removal lands between the two calls, `getComputedStyle` on the detached node returns `''`.
- This is a race in the test, and it is filed as a dispute. No app change was made.
