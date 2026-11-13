# TRUTH — Sideline Works Elevens (golden)

The brief made concrete. Each value says where it came from: `brief: <section>` (verbatim) or
`decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Journeys (ideal end-to-end flows)

### 1. First squad (brief: Journeys 1; DP-10)
- Start: visitor with no session opens any screen → sent to `/signin` (brief: Screens and layout).
- Clicks `link "Create an account"`; fills `textbox "Email"`, `"Password"` (10–72 chars), `"Team name"` (3–30 trimmed); `button "Create account"` shows "Creating account…". An invalid submit shows each error under its field (coral, `aria-describedby`) and as links in `status "Account"` that move focus to the field; PocketBase gets no user (brief: Feedback states).
- Valid submit → PocketBase `users` record (`name` = team name), Postgres `managers` row, `elevens_session` cookie (HttpOnly, SameSite Lax, path /) → lands on `/transfers` with heading "Build your squad" and fifteen empty shirt outlines (2 GK, 5 DEF, 5 MID, 3 FWD) (brief: Screens / Transfers).
- Filters (Position, Club, Max price, Sort) and the Pitch/List view are written to the address (`position`, `club`, `max_price`, `sort`, `view`); defaults are left out of the address (decided: a clean address until the manager filters). Enter in `listbox "Players"` fills the first empty slot of that position; Enter/click on a filled shirt empties it.
- `button "Confirm squad"` ("Confirming…") → `POST /api/squad` → "Squad confirmed. Bank <bank>m." → `/team`, showing the default eleven, bench, "C"/"V" armbands and the bank. Provider: `squads`, `squad_players`, `ledger_entries` (+1000 opening, one purchase per player), `manager_gameweeks`.
- A refused squad (e.g. four from one club) announces "Squad refused: <messages>." in `status "Team updates"`; no squad is stored.

### 2. Setting the team (brief: Journeys 2; DP-11–15)
- Pitch region is one Tab stop (roving tabindex; first time the goalkeeper). Rows top→bottom: forwards, midfielders, defenders, goalkeeper, bench tray (brief: Screens / Pick Team). Arrows move; Home/End jump; Enter/Space/tap selects (amber outline, `aria-pressed=true`, `toolbar "Player actions"`); a second shirt swaps (starter↔bench) or reorders the bench; Escape cancels; C/V set captain/vice from any shirt or toolbar button.
- Each save → `PUT /api/picks` with the client's composed lineup (the incoming player takes the outgoing index and any armband; the server regroups by position and checks every rule) → one announcement: "<in> moves into the eleven for <out>.", "Bench order saved.", "<name> is now captain.", "<name> is now vice-captain.", "Swap refused: <messages>.", "Captain refused: <messages>." Reload shows the saved lineup.

### 3. Transfers with a hit (brief: Journeys 3; DP-16–22)
- Enter/click on squad shirts marks them out (coral "Out" tag, selling price shown, coral outline); Enter in the Players list brings a player in for the earliest unpaired out of that position, else "Mark a <position> to sell first."; Escape on the pitch unmarks the latest unpaired out; Escape in the list returns focus to the pitch.
- Every change → `PUT /api/transfers/draft`; `status "Draft preview"` shows the server preview: "Transfers <count> · Free used <free> · Hit -<hit> pts · Bank <bank>m". A second tab, Back and reload show the same draft.
- `button "Review transfers"` opens `dialog "Confirm transfers"` (focus on "Keep editing", Tab trapped, Escape closes, focus returns) listing "<out> → <in>", hit and bank afterwards; "Confirm transfers" ("Confirming…") posts with the shown hit and a fresh `Idempotency-Key` → "Transfers confirmed: <count> made, hit <hit> points, bank <bank>m." Provider: `transfers`, paired `sale`/`purchase` ledger entries sharing the transfer id, `idempotency_keys`, draft → `confirmed`.

### 4. The deadline (brief: Journeys 4; DP-30–34)
- Operator publishes 5 fixtures; deadline = first kickoff − 90 min, shown in league time (Europe/Dublin) as "Sat 8 Nov 13:30"; status line "Gameweek <n> · Open · Deadline <deadline>".
- A 200 ms server ticker locks within 1 s of the deadline in one transaction: gameweek → locked, `locked_teams` row + snapshot JSON per squad, free transfers → min(5, unused + 1), drafts cleared, one `deadline_locked` notice per manager. Writes at/after the deadline answer 409 `gameweek_locked` with "Deadline passed. Gameweek <n> is locked, so this change was not saved." and queue a `transfer_refused` notice.
- Every open Pick Team/Transfers tab gets the push within 2 s: `status "Locked banner"` "Gameweek <n> is locked. Pick Team and Transfers reopen when the next gameweek opens.", controls disabled, header "Gameweek <n> · Locked". The device clock is never consulted.
- Snapshot written to MinIO at `snapshots/gw-<nn>/<manager id>.json` (HEAD first, never overwritten); History row reads "Team locked, receipt stored" with `link "Download gameweek <n> snapshot"`.

### 5. Matchday (brief: Journeys 5; DP-39–46)
- Operator starts the gameweek, records a goal from the console (Fixture, Player, Event, Value; `event_id` generated per submission and kept across automatic resends) → "Event recorded." / "Already recorded, not counted again."; event log shows "<name> · goal · +5 pts" with `button "Void"`.
- The manager's Pick Team re-reads the squad view and league over the push, then runs the Points relay: shirt pulse (180 ms, shirt `data-points` updates) → signed chip `data-relay-chip` "+10" with "x2" flies to the gameweek total (380 ms) → digit roll (600 ms, total `data-points` updates) → league row slides (330 ms, row `data-points`/`data-rank` update). `status "Live points"`: "<name>: goal, +10 for your team. Gameweek total <total>." A replayed event changes nothing.

### 6. Closing the gameweek (brief: Journeys 6; DP-47–50)
- Console `button "Close gameweek"` → `dialog "Close gameweek"` → "Close gameweek" ("Closing…") → "Gameweek <n> closed. Final scores are in." In one transaction: auto-subs in eleven order (first bench player who played and keeps the shape valid; none under Bench Boost), captain fallback to the vice, fixed points/net, Free Hit revert with `reversal` entries, league `last_rank`, next gameweek opens, `auto_sub` notices.

### 7. Supporters' league (brief: Journeys 7; DP-51–54)
- `/leagues`: "Create league" → "League created. Share code <code>." (6 chars, no O/0/I/1); "Join league" (case-insensitive) → "Joined <league name>." / "No league uses that code." / "You are already in this league."
- `/leagues/<id>`: `table "Standings"`, admin sees the code with "Copy join code" (clipboard + "Join code <code> copied." — decided: confirms the copy in words) and "New join code" → "New join code <code>. The old code no longer works." Team names link to `/leagues/<id>/members/<manager id>` with that member's history and snapshot downloads.

### 8. Daily price change (brief: Journeys 8; DP-23–26)
- Console Prices: Run date, Move player, Rise/Fall, "Add move", "Run price change" → "Price change applied: <applied> moved, <skipped> held at the cap." Each owned mover queues "<name> rose to <price>m." Selling price = purchase + floor(rise / 2) in tenths, or the current price after a fall. History's reconciliation line: "Bank <bank>m · Squad selling value <value>m · Ledger balance <bank>m".

## Palette (brief: Visual design; hex decided in DESIGN.md)

| Role | Hex | Source |
|---|---|---|
| ground (page) | #0B1410 | brief: near-black green |
| ground-raised (header, rail, panels) | #111E18 | decided: one lift step |
| ground-sunk (inputs, list rows) | #08100C | decided |
| chalk (text, lines) | #EEF1EA; lines at 55 % | brief: thin off-white chalk lines |
| chalk-dim (secondary text, never on turf) | #B4C2B8 | decided: AA on ground |
| turf / turf-alt (mown bands, shirt bodies) | #1F5A37 / #1A4E30 | brief: deep turf green |
| amber (focus, selection, captain, active chip, total, relay, rank up) | #F2B33D | brief: one amber accent |
| coral (refusals, errors, hits, Out, rank down, negative chip) | #FF7A66 | brief: coral alert |

## Type (brief: Visual design)
Big Shoulders Display 800/700 uppercase for titles; IBM Plex Sans 400/500/600 body at 15px/1.45; IBM Plex Mono 500/600 `tabular-nums` for every figure. Scale ×1.25: 15 → 18.75 → 23.4 → 29.3 → 36.6px. Smallest text 12.5px (decided: compact board, 12px floor).

## Space and layout per viewport (brief: Screens and layout)
- Spacing 2/4/8/16/32/64 px (brief: steps that double); radius 4px controls, 6px panels (decided).
- 1280×800: two columns, pitch ≈ 2/3 with the sticky ledger rail on the right; header 56 + banner (locked only) + heading row 48 + action slot 44 + four 96px shirt rows + bench tray 104 ≤ 800 (decided budget).
- 768×1024: one column; rail below the pitch as a two-column band of figures, not sticky; header wraps the links to a second row.
- 375×812: one column; shirts 64px wide in 88px rows; the rail is a sticky bottom strip (Bank, Free transfers, GW total carrying `data-gameweek-total`) with `button "Ledger"` opening `dialog "Ledger"` (figures + chips); league table below the bench; History/League tables scroll inside focusable frames with the first column fixed; header rows: wordmark + bell + sign-out, status line, links.
- Breakpoints: `max-width: 1023px` and `max-width: 599px` (decided: between the brief's three viewports).

## Motion (brief: Motion and effects)

| Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| Dialogs and sheet | open / close | 200 ms in (opacity, translateY 8px) / 140 ms out | cubic-bezier(.2,.8,.2,1) / (.4,0,1,1) | appear and leave at once |
| Locked banner | gameweek leaves open | 200 ms slide down (transform) | cubic-bezier(.2,.8,.2,1) | appears at once |
| Shirt hover / press | pointer | 120 ms outline/stroke / 80 ms brightness .82 | ease-out | 0 ms |
| Relay 1 pulse | owned player's points change | 180 ms | cubic-bezier(.2,.9,.3,1.2) | static amber badge "+10 x2" for 4 s |
| Relay 2 flight | after pulse | 380 ms, 9-keyframe arc | cubic-bezier(.2,.8,.2,1) | none |
| Relay 3 digit roll | after flight | 600 ms per digit column | cubic-bezier(.2,.8,.2,1) | total changes at once |
| Relay 4 row move | after roll | 330 ms FLIP translateY | cubic-bezier(.2,.8,.2,1) | row and rank change at once |
| Non-scoring bench chip | bench event without Bench Boost | 1.5 s static dimmed badge | — | same |
A second update during a relay ends it at once and applies the newest values with the static badge (brief). Stage order runs on timers; movement is WAAPI. Nothing loops.

## States per async action (brief: Feedback states)
Pending copy on the button and disabled until the reply: "Signing in…", "Creating account…", "Confirming…", "Saving…" (shown on the shirt), "Playing…", "Cancelling…" (on the chip), "Creating…", "Joining…", "Replacing…", "Preparing…" (on the download link), "Publishing…", "Recording…", "Voiding…", "Starting…", "Closing…", "Running…", "Marking…" (decided: Mark all read), "Resetting…" (decided: Reset draft). Results and errors are announced once in the named region with the brief's copy; errors in coral.
- Outages: PocketBase down → 503 `accounts_unavailable` "Sign-in is unavailable right now. Try again in a minute."; Notices dialog "Notices are delayed. They will appear here when the inbox is back."; MinIO down → receipt "Receipt pending. Your locked team is safe; the file will be stored when storage is back.", downloads 503 "Storage is unreachable. Try the download again in a minute."; empty inbox "No notices yet."; no league "Join or create a mini league to see it move."

## Media and licences
- Pitch, shirts, club badges and line icons: drawn by the app as inline SVG (original).
- Fonts: Big Shoulders Display, IBM Plex Sans, IBM Plex Mono — Fontsource 5.3.0 Latin WOFF2, OFL-1.1 (SIL Open Font License 1.1), self-hosted; listed in `app/assets.json` with sha256 and in `app/THIRD_PARTY_NOTICES.md` with the full OFL text.
- Shipped packages: pg (and its MIT/ISC tree), ws (MIT), preact (MIT).
