# TRUTH — Ochre Kerb Kerbline (golden)

The brief made concrete. `brief: <section>` values are copied verbatim; `decided: <why>` values
fill silence in the brief's intent.

## Journeys (ideal end-to-end flow)

### 1. First race as a guest
- Start: no session, `/` (brief: Journeys 1). Guest start page shows brand only, checkbox
  `I am 13 or older`, radiogroup `Starter car` (Kestrel Hatch, Wren Coupe, Moth Roadster with class
  and PI; Kestrel checked by default — decided: a radio group needs a checked member), `Start racing`.
- Enter with the box unchecked → alert `Confirm you are 13 or older to play.`, focus on the checkbox.
- Space checks the box, arrows move the car choice, Enter submits → button `Starting…` (disabled)
  → `POST /v1/guests` → `201`, `kerb_session` cookie, `opening` movement of 1,000 coins
  (`wallet:<id>` +1,000 / `house:grants` −1,000), one car at stage 0.
- Lands on `/race?layout=saltflat-ring&mode=practice&event=guided-first-race` with focus on
  `region "Race HUD"` showing `Lap 1/1`, `0 km/h`, `Coins 0`, `Press Enter to start`.
- Enter starts; 60 steps per second of page time; the browser records an input event at step 0
  and at every step whose input differs.
- On the ending step: one `POST /v1/runs/<id>/finish` with `{"seed","inputs"}` (compact JSON,
  serialised once), `history.replaceState` to `/runs/<id>`, focus on `heading "Run result"`.
  A request that gets no HTTP response is resent with the same bytes every 1.5 s (decided: under
  the brief's 2 s ceiling) until any response.
- Server: row-locked transaction stores the raw bytes as `replays/<runId>.json` with
  `x-amz-meta-sha256`, records the SHA-256, run → `verifying` (never answers `submitted`).
  After `VERIFY_DELAY_MS` the worker replays the bytes: `verified`, `pickups` movement (coins
  collected) and `result` movement (300 guided first race, once per player).
- Results screen: `Verifying run…` → `Verified: <raceMs as m:ss.mmm>, +<payout> coins`, laps table,
  payout counted up over 0.8 s. Reload of `/garage`: `Coin balance` = 1,000 + payout.

### 2. Stage 2 brake upgrade by keyboard
- Tab to `Upgrade Brakes to stage 2` (inside `group "Brakes"`), Enter → `dialog "Confirm upgrade"`
  with price 700 (class D), stat change `Braking 9.5 → 11.0 m/s²`, PI change, focus on
  `Buy for 700 coins`. Tab/Shift+Tab stay inside; Escape cancels at no charge, focus back on the opener.
- Enter buys: one purchase attempt = one `Idempotency-Key` + one byte-identical body; button
  `Buying…` (disabled). No HTTP response → text `We couldn't confirm the purchase. Nothing changes
  here until it is confirmed.`, `Check again` focused, nothing on the page changes and balance
  pushes are held.
- Check again resends key + bytes; the server replays its stored `201`. The dialog closes, focus on
  `Upgrade Brakes to stage 3`, the sweep plays once, `Garage updates` announces
  `Brakes stage 2 fitted. Balance: <balance> coins. <summary>`.
- Provider: one `upgrade` movement (`house:shop`), `owned_cars.brakes = 2`, `paid_brakes += 700`,
  `purchases` row with the reference result, idempotency record. Reload shows the same pips,
  meters, PI, figure and balance with no animation.

### 3. Garage on a phone (375 × 812)
- One column (Car, Upgrade slots, Setup sheet); numbered stage strip above content; page links
  behind `Menu` (collapsed: links not rendered); every control ≥ 44 × 44 px.
- Tap `Upgrade Tires to stage 1` → Buy; tap `Refit Engine to stock` → `dialog "Confirm refit"`,
  `Refit and refund 150 coins` (half of 300, rounded down) → `Engine refitted to stock. Refund: 150
  coins. Balance: <balance> coins.`; `refit` movement on `house:refits`.
- Menu → Garage link focused; `Coin history` → `/garage/coins`: `Balance X coins` and
  `Ledger total X coins` equal; four columns wrap inside cells.

### 4. Spending from two tabs
- Both tabs open a dialog; each fits alone, not both. The per-player row lock serialises:
  one `201`, one `402 INSUFFICIENT_COINS`. The `402` tab re-reads `GET /v1/garage`, shows
  `Not enough coins` / `You need <shortfall> more coins.` and focuses Cancel. Balance pushes reach
  both tabs without reload; an open dialog follows the live balance (into not-enough, back to buy
  after a refit in the other tab, focus staying on Cancel; next Buy uses a new key).

### 5. Hunting a ghost
- `/boards?layout=saltflat-ring&mode=time-trial&class=B&units=kmh` (decided: query keys `layout`,
  `mode`, `class`, `units`; the brief requires the filters in the address). Filter changes push a new
  address and only the newest filter set may render (`Loading times…` until then).
- `Download replay` (`/v1/runs/<id>/replay`) returns the exact bytes + `X-Replay-SHA256`.
- `Race this ghost` → `/race?layout=saltflat-ring&mode=time-trial&ghost=<runId>`; HUD shows
  `Ghost: loading` → `Ghost: <name>`, `Delta <signed>` updated every step.
- Escape → `dialog "Paused"`; nothing advances however long it stays open. Restart creates exactly
  one new run within 2 s and discards every timer and request of the abandoned run.
- A faster verified lap pushes a `board` message; the open board replaces the player's single row,
  renumbers ranks, recomputes gaps and updates `Your time` without a reload.

### 6. Climbing the championship
- `/championship`: two ruled league regions with map cards (outline + tulip glyphs). Two Rookie
  runs verifying together reach 50 points; Rookie completion and the Club + Quarry Switchbacks
  unlock are one commit; one `championship` push; the page shows `Complete`, announces
  `Rookie league complete. Club league and Quarry Switchbacks unlocked.`, and every open garage
  adds `Quarry Switchbacks` to `Reference map`.
- No class C car → `Enter Club Circuit` opens `dialog "Loaner car"` (`You have no eligible class C
  car. Race the loaner Halcyon RS for half result coins?`); `Race the loaner` opens the race address,
  the run is created with `"loaner": true` and pays half result coins.

### 7. Racing a friend
- `/lobby/new`: `AI drivers` 0–2, `Create private lobby` → `/lobby/<id>` with read-only
  `Invite link`. The friend without a session is redirected to `/?next=/lobby/<id>`, starts as a
  guest and lands on the lobby with focus on `Join lobby`.
- Ready marks, the server's countdown (`Starting in 3/2/1`), cancellation on un-ready or a drop,
  the position tower and `Reconnecting` rows all come from server pushes; the device clock is never
  read. The server races at 60 steps/s with each player's latest key state.

### 8. Saving the garage; finishing during an outage
- `/sign-in`: email → `Sending…` → `Check <email> for your sign-in link.`; one SMTP message,
  subject `Your Kerbline sign-in link`, sender `MAIL_FROM`, body link `<APP_PUBLIC_URL>/sign-in/<token>`.
  Opening it converts the guest into the account (same player id, garage, ledger).
- With MinIO down: finish answers `202 held`; results show `Held for verification` and the alert
  `Replay storage is unavailable. Runs are held and will verify when it returns.`; no payout,
  no board row; the run resumes by itself within 5 s of storage returning.

## Palette (hex values the build uses)

| Role | Hex | Source |
|---|---|---|
| paper ground | `#F3EAD3` | brief: Visual design (warm cream); decided: HSL 43°/57%/89% |
| surface | `#FAF5E6` | decided: lighter cells on the paper |
| ink | `#1C1A16` | brief: near-black ink |
| muted ink | `#574F44` | decided: labels, AA 6.7:1 |
| accent | `#B93E0B` | brief: one safety-orange accent; decided: darkest AA orange (4.66:1) |
| gain | `#1F6B3A` | brief: deep forest green |
| loss | `#A3301B` | brief: brick red |

## Type, space and layout

- Headings Barlow Condensed 600; body Fira Sans 400/600; figures JetBrains Mono 400/600
  (brief: Type). Sizes 15 / 20 / 26.67 / 35.56 px (4/3 steps, title 2.37× body).
- Compact: 8 px gaps, 12 px cell padding, 1 px ink rules, 2 px section rules, every control
  ≥ 44 px (brief: Density).
- Stage gutter 76 px with `01 02 03` and labels; a numbered strip above content below 768 px
  (brief: Composition, Screens and layout).

| Width | Layout | Source |
|---|---|---|
| < 768 | one column; Menu; boards hide Car and Top speed; filters stacked; dialogs full width | brief: Screens and layout |
| 768–1279 | garage Car + Slots side by side, Setup full width; dealer 2 columns; leagues side by side | brief |
| ≥ 1024 | race view + HUD; `Race this ghost` | brief |
| ≥ 1280 | garage three columns; dealer 3 columns | brief |

## Motion

| Element | Trigger | Duration | Easing | Reduced-motion substitute | Source |
|---|---|---|---|---|---|
| dialog | open / close | 200 ms / 120 ms | cubic-bezier(0.16,1,0.3,1) | at once | brief: Dialogs |
| menu panel | Menu | 0 | — | — | brief |
| payout figure | verdict | 800 ms | ease-out cubic | at once | brief |
| board row | push insert/move | 1000 ms slide + tint fade | settle | none | brief |
| stat bars | upgrade button focus/hover | 250 ms each way, retract replays the curve backwards | ease-out cubic | jump | brief |
| 3D car | idle | 30 s per turn; resumes 2 s after drag | linear | no idle turn, drag still orbits | brief |
| sweep marker + ribbon | confirmed upgrade | 0–1200 ms | ease-out cubic | end state at once | brief: signature |
| chips S1/S2/S3 | marker at 1/3, 2/3, end | 250 ms flip | ease-out | at once | brief |
| predicted lap + balance | 1450 ms | 250 ms (done 1700 ms) | ease-out cubic | at once | brief |
| pips | 1700 ms | 250 ms fill | settle | at once | brief (within 2 s) |
| announcement | 1950 ms | — | — | same paint | brief |

Graded motion runs on `requestAnimationFrame` + `performance.now()` (decided: the brief binds race
and motion to the page clock).

## States per async action

| Action | Pending | Success | Error | Outage |
|---|---|---|---|---|
| guest start | `Starting…` | lands on guided race / lobby | age alert | — |
| finish | `Verifying run…` | `Verified: …` | rejected copy by reason | `Held for verification` + banner |
| upgrade | `Buying…` | `<System> stage <n> fitted. Balance: … <summary>` | `Not enough coins` / shortfall; unconfirmed copy; `Garage refreshed from the server.` | — |
| car purchase | `Buying…` | `<Car name> added to your garage. Balance: …` | as upgrade | — |
| refit | `Refitting…` | `<System> refitted to stock. Refund: … Balance: …` | `Garage refreshed from the server.` (decided) | — |
| board load | `Loading times…` | rows | — | — |
| sign-in link | `Sending…` | `Check <email> for your sign-in link.` | error summary + field | mail outage copy |
| redeem | `Signing you in…` | `Signed in as <email>. Your garage is saved.` | expired/used copy + `Send a new one` | — |
| ghost | `Ghost: loading` | `Ghost: <name>` | `Ghost unavailable. Racing without it.` | same |

## Decided where the brief is silent

- Guest and grading player names: `Guest XXXX`; grading players without a name are `Racer XXXX`.
- Every response produced after the idempotency check (201, 402, 403, 409, 422) is stored under
  the key, so a retry replays it (brief: "A 402 answer is stored like any other").
- The keep-which-garage dialog shows the device garage from `GET /v1/garage` and the account
  garage from the `409 GARAGE_CHOICE_REQUIRED` message text (the error shape allows only a message).
- A drift stage that ends on its timer judges its unfinished lap for board validity.
- A lobby race also closes at the 1-lap step limit (7,200 steps); the lobby body carries each car's
  `distanceM`, `lane` and `speedMps` so pages can draw the race.
- Ghosts on later laps use the ghost's same lap when it exists, otherwise its last lap.
- Track outlines: straights keep length; corner angles (all left turns) are those that best close
  the loop; the remaining gap is spread along the lap.

## Media and licences

No image, audio, video or model files. Cars, tracks, glyphs and icons are drawn in code; icons from
`lucide` (ISC); fonts from the Fontsource npm packages (OFL-1.1), bundled by the build and listed with their
OFL text in `app/THIRD_PARTY_NOTICES.md`. `app/assets.json` is `[]`: the app tree holds no binary
file (decided: IF-06 bundles fonts from npm packages, which the package licence scan covers).
