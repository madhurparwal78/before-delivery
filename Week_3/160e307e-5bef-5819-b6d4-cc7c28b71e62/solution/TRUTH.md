# TRUTH — Due Coin golden

Every value says where it came from: `brief: <section>` (copied from instruction.md) or `decided: <why>` (the brief is silent; the reason ties it to its intent).

## Journeys, end to end

### 1. First visit (brief: Journeys 1, Screens and layout)
- Start: no cookie. The first request without a valid `dc_session` (a page such as `GET /`, or any API call) creates a guest and sets `dc_session` (HttpOnly, SameSite=Lax, path `/`, not Secure) and answers `chosen:false`. The client replaces the URL with `/welcome` (brief: Screens).
- `/welcome`: `heading "Pick a name"`, `textbox "Name"`, `radiogroup "Avatar"` with 24 radios (Avatar 1 selected, one tab stop, arrows move and select), `button "Continue"`, `button "Skip"`.
- Continue with a valid name: `POST /api/me/name` → 200; page goes to `/`, focus on the `h1`; profile link `<name> profile`; reload keeps it.
- Taken or blocked name: `alert #name-error` with the published copy and 3 suggestion buttons; `textbox "Name"` gets `aria-invalid="true"` and `aria-describedby` including `name-error`. A suggestion fills the field and focuses it.
- Skip: `POST /api/me/skip` → `Guest-NNNN`. After a successful Continue or Skip the page always goes to `/` and focus moves to its `h1` (brief: Interactions, Welcome), whichever page sent the visitor to `/welcome`.
- Database down: `/api/me` answers `503 DATABASE_UNAVAILABLE`, the page stays where it is and the outage banner shows.

### 2. Pass and play (brief: Journeys 2, Interactions)
- `/play/local`: `radiogroup "Format"` (Quick selected), `Player 1 name`, `Player 2 name` (defaults `Player 1`, `Player 2`), `switch "Turn the board each turn"` (on), `Start`.
- Start keeps the route and shows the match screen. The whole match runs on `src/shared` in the browser. Player 1 is seat 0, plays white and breaks board 1 with up to 3 attempts. Each turn change wipes the field (520 ms) and, with the switch on, turns the board 180 degrees (about 500 ms).
- End (winner, 25 points, eight boards, or Resign): `dialog "Match over"` with `<name> wins`, `#final-score`, `#end-reason` when resigned, `#save-status`. The result goes to `POST /api/local-matches` with the shot log; the server replays it. Success: `Saved to your history.` and a `Pass and play` history row. Database down or offline: the log is kept in `localStorage` and `Saved on this device. It will be added to your history when online.` is shown; it is re-sent on every page load and every 30 seconds.

### 3. Private room (brief: Journeys 3, API Rooms)
- Host: `button "Create a room"` → `dialog "Create a room"` (Quick/Classic) → `POST /api/rooms` → `/room/<code>` with `#room-code`, `#room-link` (`<APP_PUBLIC_URL>/join/<code>`; brief: Public screens and controls; decided: the server writes `APP_PUBLIC_URL` into the page shell it serves so the browser builds the link from the configured address, not the page origin), `Waiting for opponent...`, `#room-expiry` (`Closes in m:ss` counted on browser timers from the server's `expiresInMs`).
- Guest opens the link: `textbox "Your name"` prefilled, `Join` → `POST /api/rooms/<code>/join` (exactly one joiner wins; others `409 ROOM_FULL`; a third viewer sees `heading "Room full"`).
- Both press `Ready` (one `Ready` button per seat, enabled only for the viewer). Server tosses (`TOSS_SEED` 0: seat 0), match becomes `active`, `#toss-result` shows `<name> won the toss and breaks with white.`; 2 s later both pages go to `/match/<id>`.
- Rematch: `button "Rematch"` → `Rematch offered`; the other page shows `<name> wants a rematch.` and `Accept rematch`; accept creates a new match in the same room at 0-0 with the breaker swapped.

### 4. Ranked (brief: Journeys 4)
- `Play ranked` for an unlinked guest opens `dialog "Link your email"`. `Send link` shows `Sending...`, then `Link sent to <email>. Open it on any device.` only after the SMTP server accepted the message; refusal answers `503 MAIL_UNAVAILABLE` and shows `We couldn't send the link. Try again in a minute.`.
- The emailed link `<APP_PUBLIC_URL>/auth/link/<token>` links the email (or signs this browser in as the email's owner) and redirects to `/?link=…`; the client shows `Email linked: <email>` / `Signed in as <name>` in `#page-status`.
- `/queue/ranked`: `Looking for players near <rating>`, `Rating band: low-high` (starts ±100, widens 50 per `BAND_WIDEN_SECONDS`, to ±400), `#queue-elapsed`, `#radar`, `Cancel` or Escape. Pairing is one atomic claim; the earlier joiner takes seat 0; both are pushed `matchFound`.
- Queue matches are Quick (decided: brief names no format for queue play; one board keeps ranked games short).

### 5. A shot, refereed (brief: Journeys 5, Motion)
- Aim (keys, sliders, drag on the striker, pull-back), Shoot or Space. `data-phase` `refereeing`: the striker is ghosted. The server rules; both pages get `shotResult`. `moving`: server frames play back on animation frames at up to 2x, compressed to fit 2.4 s (decided: the brief says up to twice real speed and capped at 2.4 s). Then the verdict banner (200 ms), verdict word (250 ms scale), score numerals. If the turn passes: 520 ms field wipe, then `data-turn`, `data-field`, `#turn-text` change and `data-phase` returns to `aim`.

### 6. Board and match end (brief: Journeys 6, Business rules)
- Last coin: banner, then `dialog "Board over"` (`<winner> wins board <n>`, `#board-points`, `Next board`, focus returns to `#board`). A board that ends the match goes straight to `dialog "Match over"` with its points line in `#board-points`.
- Match over: black field, `You won`/`You lost` online, `#final-score`, `#end-reason`, `#rating-change` (ranked), `#chalk-earned`, `Rematch` (private), `Home`. No Escape.

### 7. Dropped connection (brief: Journeys 7)
- Socket closed or no `pong` for 5 s: the other page shows `#reconnect-overlay` `<name> is reconnecting... m:ss` (announced once). The offline page shows `Connection lost. Reconnecting...` in `#page-status`. Back within `RECONNECT_SECONDS`: same seat, same board. A reconnect token kept for the browser tab only (session storage) lets a reloaded tab rejoin its seat (brief: API Socket): the tab sends it on `/ws?match=<id>&token=<token>`, and the server closes that tab's earlier socket at once so the seat passes to the reloaded page without waiting for the 5 s silence (decided: how the token is used; the `dc_session` cookie still says who the player is). After the window the opponent wins by forfeit (`left`); both gone: `abandoned` (no winner, no rating, no chalk, no history).

### 8. Collector (brief: Journeys 8, Shop and ledger)
- `/shop`: `tablist "Item kinds"` (Strikers, Boards, Coin sets) with roving focus, `article` per item, `Buy <item>` (disabled and `Need <n> more` when short), `Equip <item>`, `Equipped` (`aria-pressed="true"`). One idempotency key per item is reused until success, the button disables on first press, and the server serialises per player: one purchase movement, balance `250` lower.

## Palette (brief: Visual design; hex decided)

| Role | Hex | Pair |
|---|---|---|
| ground | `#F4EFE6` | ink 16.42 |
| surface | `#FFFFFF` | ink 18.80 |
| ink | `#14110F` | on tomato 5.07 |
| muted | `#5F574D` | on ground 6.20 |
| cobalt (accent) | `#1B45D7` | white 7.29 |
| tomato | `#F2452B` | ink 5.07 |
| black field | `#0C0B0A` | `#F4EFE6` 17.17 |
| board themes | ply `#E7BB78`, chalk `#E9E3D5`, walnut `#6C4731`; frame `#5A3B22` | drawn |
| coins | white `#F8F4EA` rim ink, black `#1C1815` rim `#EFE8D8`, queen `#C9281A` | drawn |

## Type (brief: Visual design)
Chivo (OFL, self-hosted woff2) at 400, 700 and 900. Body 18 px / 1.5. Display words (DUE COIN, PASS, ROOM, RANKED, verdict words, WON, LOST, empty states) in 900 capitals at line-height about 0.8. Heading steps ratio 1.333. Tabular figures on scores, clocks, history.

## Space and layout per viewport (brief: Screens and layout)
- Outer margin 12 px, square corners, 2 px ink borders, 44 px targets (48 px striker slider).
- Match, below 768 px: header, score rail as a strip above the board, board, controls. 768 to 1279: board, rail below, controls. 1280 and up: rail is a 320 px column right of the board, controls under the board. The board's rendered side is the 740 mm surface; its frame is drawn in the margin around it. The board side is `min(stage width, stage height)` through container query units so all four pockets stay in view at 375x812, 768x1024 and 1280x800.
- Welcome avatars: 4 columns, 6 at 768, 8 at 1280.

## Motion (brief: Motion and effects)

| Element | Trigger | Duration, easing | Reduced motion |
|---|---|---|---|
| pieces | ruling frames | server frames, up to 2x, cap 2400 ms, rAF | final positions at once |
| pocketed piece | frame where it leaves | 140 ms scale and move into the pocket | none |
| `#verdict` | ruling arrives and pieces stop | 200 ms slide and fade in, 150 ms out, stays `verdictBannerMs` | at once |
| `#verdict-word` | banner in | 250 ms scale from 0.4 | full size |
| `#field-wipe` | turn passes | 520 ms translateY, `data-from` top or bottom | none; attributes change at once |
| keep-turn pulse | shooter keeps turn | 250 ms overlay opacity | none |
| `#board-rotator` | local turn change | about 500 ms rotate 180 | 150 ms crossfade |
| striker ring | enters illegal spot | 120 ms, 4 px twice | colour change only |
| `#shot-timer` | 5 s or less left | 1 s opacity loop | none |
| `#radar` | waiting | 1.6 s turn, loop | none |
| dialogs | open | 260 ms rise | none |
| buttons | hover, press | 90 ms | none |
| loading pockets | first fetch | 360 ms each, staggered | static |

Sequencing uses browser timers and animation frames; visuals use CSS and `element.animate()`.

## States per async action (brief: Feedback states)
Continue, Send link (`Sending...`), Create, Join (disabled), Ready (`Waiting...`), Shoot (`refereeing`), Buy (disabled; failure `Purchase failed. No chalk was taken.`), Rematch (`Rematch offered`), pass-and-play save (`Saving...`, `Saved to your history.`, `Saved on this device. It will be added to your history when online.`), connection (`Connection lost. Reconnecting...`, reconnect overlay). Outage banner on every page: `Online play is unavailable right now. Pass and play still works.`; Create a room, Join with a code, Play casual, Play ranked and Buy are disabled.

## Rules decisions where the brief is silent
- Queen pending when the shooter times out: the queen returns to the centre (decided: the cover attempt ended with the turn).
- A break that touches nothing on its first contact (null or cushion) is a miss and restores the layout (decided: brief says the break is retried without changing the turn).
- A timeout is numbered as a ruling (`shotSeq` + 1) so both pages sync; `TURN_EXPIRED` applies only while it is not the sender's turn and their last turn ended by timeout.
- Playing a due: the lowest-numbered coin pocketed on the shot returns.

## Media and licences
All art (board, pieces, skins, avatars, shop swatches) is drawn in SVG by the app (`original`, no files). Files: three Chivo woff2 (SIL OFL 1.1, listed in `assets.json`). Icons: Lucide (ISC), inlined. No CDN, no remote font, no third-party request.
