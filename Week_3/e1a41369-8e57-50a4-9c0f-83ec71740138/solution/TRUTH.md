# TRUTH — Brightmoss Games Deedfall (golden)

The brief made concrete, never reinterpreted. Every value says where it came from: `brief: <section>`
(copied verbatim from `instruction.md`) or `decided: <why>` (the brief is silent; the reason ties the choice to
the brief's intent).

## 1. Journeys, end to end

### 1. Keep the lists by keyboard (DP-01 to DP-06, DP-09, DP-15)

- Start: a signed-in Player with an empty board (brief: Journeys 1). Four empty lists show the giant words
  `FRESH`, `OPEN`, `CLEAR`, `TREAT` and the sentences from Feedback states (brief: Empty states).
- Actions: Tab to a list (each list is one stop; an empty list takes focus itself), press `N`. "New task" opens
  with the type of that list preselected (brief: Interactions). Fill Title (and Checklist or Price), press Enter on
  "Save task". The row appears with its published accessible name. Focus goes to the new row (brief: Dialogs and
  sheets). Space completes the focused daily, `+` scores the focused habit up, Alt+ArrowDown moves a task one place
  and announces `<title> moved to position <n> of <total>`, ArrowLeft/ArrowRight cross lists (same position, or last
  row, no wrap).
- Visible end state: four non-empty lists in the chosen order, unchanged after reload.
- Provider-recorded end state: Postgres `tasks` rows with contiguous `position` 1..n per list; `ledger` has the
  daily's `task` entry; the user's other open screens received `tasks` and `player` over `GET /api/live` within
  2 seconds (brief: Journeys 1, DP-06).

### 2. Score, earn and spend (DP-07 to DP-15)

- Start: a Player with gold from one `task` ledger entry. Score a habit up: experience = round(10 x d x f), gold =
  experience / 10, value + 1; score down: health loss = round(2 x d x f), value - 1 (brief: Business rules). The row
  chip shows the band for the current value. Buying a reward costs exactly its price (a price equal to the balance
  is allowed); a dearer one answers 422 `{"errors":{"gold":"Not enough gold."}}`, the `alert` strip shows
  `Not enough gold.` and nothing changes (brief: Errors).
- End state: the gold shown equals the sum of the `ledger` entries; kinds are `task`, `reward`, `quest`, `faint`,
  `undo` (brief: Business rules).

### 3. Live party quest (DP-27 to DP-38)

- A leader forms a party ("Form party"), invites a friend by username, the friend sees `<username> invited you to
  <party name>.` and joins (invites to other parties are dropped). They chat (1 to 500 characters, 5 a minute by
  default; the next answers 429 and the composer shows `Slow down: you can send <limit> messages a minute.`).
  The leader chooses "Wake the Drowsewyrm" and presses "Invite party to quest"; the member sees
  `<quest name>: <n> of <total> accepted` and presses "Accept quest"; the leader's "Begin quest" enables at two
  accepted and the quest becomes `active` (brief: Business rules, Quests).
- Each finished task lowers the boss's Health Seam on both screens; strikes apply in arrival order under one
  in-process queue and carry `seq`. The strike that reaches 0.0 defeats the quest (`defeatedBy`), pays every
  current member the quest reward once (`quest` ledger entry plus experience) and the panel turns into the defeat
  field (`DOWN`, `<username> landed the last blow.`).

### 4. My day, my hour (DP-16 to DP-20, DP-36, DP-37)

- A Player in Toronto sets the zone and day-start hour 6 in Settings; the text `Next day start: <weekday> <HH:MM>
  (<zone>)` is the server's `nextDayStart` (brief: Success). The close of date D runs at the first instant on D+1
  the zone's clock reads the day-start hour (spring-forward gap: the first instant after the gap; fall-back: the
  first occurrence). Closes run once per Player and date (`closed_days`), within seconds from the scheduler and on
  `POST /api/grading/rollover`.
- Steps, in order: (1) each due missed daily costs round(2 x d x f) health, value - 2, streak 0; (2) done dailies
  gain 1 streak; (3) with an active quest, one strike-back event attributed to the misser hits every party member
  who is not resting for round(power x N); (4) faint checks in username order; (5) every daily's done clears and the
  open date moves to D+1 (brief: Business rules, Day close).
- End state: every member's health meter and the strike list show the same attributed lines
  (`<Boss> struck back for <h> (<username> missed <n>)`); the feed says `<Boss> struck back: you lost <h> health`.

### 5. Rest when you need to (DP-21, DP-22)

- The "Rest mode" switch saves only rest mode and shows the banner `Resting: missed dailies will not hurt you or your
  party.` within one second, without the settings success status. At the close: no health loss, streaks unchanged
  (done dailies still gain), no strike-back from their misses, a teammate's strike-back does not touch them, and
  their strikes still count (brief: Business rules, Rest mode).

### 6. Bring a routine from a file (DP-42 to DP-46)

- "Import tasks" opens the sheet. A `.deedlist` with three mistakes answers 422 with every error by line; the sheet
  lists each message verbatim in `list "Import errors"`. The original bytes are stored at
  `imports/<userId>/<importId>.deedlist` before anything else happens, accepted or rejected. The fixed file creates
  its tasks at the end of their lists and the sheet says `Imported 3 tasks`. Import history lists both attempts
  (`Rejected: 3 errors`, `Imported 3 tasks`) and "Download original" returns each file byte for byte with
  `Content-Disposition: attachment; filename="<filename>"`. With the object store down: 503 `storage_unavailable`,
  nothing stored or created, copy `File storage is unavailable. Nothing was imported.`

### 7. A party under its banner, and its history (DP-47 to DP-50)

- A leader uploads a PNG or JPEG (at most 2,000,000 bytes, signature checked) under
  `banners/<partyId>/<uploadId>.png|.jpg`; success is reported only after the store confirms; members see the new
  `<party name> banner` image live. After the quest falls it is in each participant's quest history with each
  member's total damage and every strike and strike-back line, after reload and after leaving; another party's
  quest address shows the not-found screen `Quest not found` and the API answers 404 `not_found`.

### 8. On the phone (DP-39 to DP-41)

- At 375 x 812 the "Lists" tab bar switches one list at a time (ArrowLeft/ArrowRight activate tabs); a rightward swipe
  of at least 80 px on a daily or to-do completes it, a shorter swipe springs back; the "Party" button opens the
  "Party" dialog with the whole rail. No horizontal scrolling, every control at least 44 x 44.

## 2. Contract decisions

| Decision | Value | Source |
|---|---|---|
| Error order | origin 403, 401, 404, 403, idempotent replay, 409, 413, 415, 422 | brief: API |
| Gold, health units | gold in integer hundredths, health and damage in integer tenths, half-up rounding once at the end | brief: Numbers and rounding |
| Difficulty d | trivial 0.5, easy 1, medium 1.5, hard 2 | brief: Business rules |
| Bands | v <= -10 Crimson f 2; -9..-1 Amber 1.5; 0..4 Sand 1; 5..9 Teal 0.75; >= 10 Blue 0.5; v clamped -20..20 | brief: Business rules |
| Level step | level L needs 25 x L experience; carry-over; health refills on each level | brief: Levels |
| Faint | health <= 0: level - 1 (min 1), experience 0, 10% of gold floored to the hundredth as a `faint` entry, health 50.0 | brief: Fainting |
| Undo window | `UNDO_WINDOW_SECONDS`, default 30; strictly less than the window is an undo; later an untick only clears done | brief: Business rules |
| Idempotency | key 1 to 100 characters per Player; same method, path, body returns the stored response, otherwise 409 `idempotency_key_reused`; only successful responses are stored | brief: Idempotency; decided: a refused request is state dependent, so retrying it with the same key may succeed |
| Quest after defeat | `Party.questId` keeps the defeated quest so the defeat field survives reload; an abandoned quest empties it | decided: the brief says the defeat panel "shows the same way after a reload of a defeated quest" |
| Undo of a strike | the strike event leaves the quest and later `bossHealthAfter` values rise by its damage; a defeating strike or a finished quest keeps both | brief: Business rules, Undo |
| `delta.health` | for a score down the health lost (negative); otherwise the refill from level-ups; a faint reset is not part of it | decided: the feed sentence needs the loss even when the loss makes the Player faint |
| Level-up notices | one `level_up` notice per level gained; an undone tick removes its unacknowledged notices; a notice closed on a page never reopens there from a live event sent before the ack | brief: Levels; decided: a reverted level needs no dialog, and closing a dialog must leave focus on the row (brief: Dialogs and sheets) |
| Live stream | one SSE stream; snapshot of `player`, `tasks`, `invite`, `party`, `quest` on connect; events go out 120 ms after each commit, batched per commit and in commit order | brief: Live stream; decided: a short batching window keeps one commit's events together and well inside the 2 second budget |
| Own results | the screen that acted shows the reply at once; the live stream keeps every other screen current | brief: Performance (own action within one second) |
| Chat limit copy | the limit is read from `CHAT_MAX_PER_MINUTE` by the server and handed to the page in a `chat-limit` meta tag | decided: the copy needs the value and the brief names no endpoint for it |
| Scheduler | every 2 seconds, from the server clock | brief: Business rules (within 60 seconds) |
| Health | 503 `{"status":"starting"}` while Postgres is down; 200 `{"status":"unavailable"}` while the store is down | brief: Server boundary |

## 3. Palette (hex the build uses)

| Role | Hex | Used for | Source |
|---|---|---|---|
| ground (blush) | `#F6C6C8` | blush fields | brief: Visual design; decided: hex |
| surface (pale blush) | `#FDE9E7` | task rows on blush fields, the player bar, inputs | brief: Visual design; decided: hex |
| ink (aubergine) | `#3F1C2B` | type on blush and every dark field | brief: Visual design; decided: hex |
| ink-row | `#321422` | rows on aubergine fields, the seam's damage field | brief: Visual design |
| muted | `#6F4558` | secondary text on blush, giant empty-state words | brief: Visual design |
| accent | `#FF2D8A` | the one primary action per page; the defeat field | brief: Visual design |
| on-accent | `#2A0B1C` | type on hot pink | brief: Visual design |
| Crimson, Amber, Sand, Teal, Blue chips | `#B3261E`, `#F2B84B`, `#E8D2B5`, `#1F7A7A`, `#2D4FA0` | band chips, each in its own colour | brief: Business rules; decided: hexes |

## 4. Type, space and layout per viewport

| Item | Value | Source |
|---|---|---|
| display face | Hubot Sans Variable, weight 900, `font-stretch` 125% | brief: Visual design |
| body face | Mona Sans Variable, 18px / 1.5 | brief: Visual design |
| list headings | 45px (2.5 x body) | brief: Visual design |
| hero headline | `max(7vw, 40px)`, left margin -0.1em, cropped by the left edge | brief: Landing |
| numerals | tabular figures everywhere | brief: Visual design |
| outer margin | 8px; the landing is full bleed | brief: Visual design; decided: full bleed so the headline is cropped by the page edge |
| 1280 x 800 | player bar on top; Habits, Dailies, To-dos in three equal columns (blush, aubergine, blush); party rail 360px aubergine at the right; Rewards a blush band under the columns | brief: Screens and layout |
| 768 x 1024 | lists two by two (Habits, Dailies / To-dos, Rewards), "Party" button replaces the rail | brief: Screens and layout |
| 375 x 812 | "Lists" tab bar (aubergine) under the player bar, one list at a time, "Party" button, no sideways scroll, controls at least 44 x 44 | brief: Screens and layout |
| party rail | 360px wide, as tall as the three columns; its content scrolls inside it | decided: a long chat or the leader's forms must not stretch the board |
| Health Seam panel | 200px tall; the boss name is broken over two lines (Drowse / wyrm, Clutter / hound, Gloamtide / Moth) and set across the panel so the seam cuts its letters | brief: Visual design (boss name) |
| player bar | pale blush so it differs from every neighbouring field on every viewport | decided: the brief demands no two neighbouring fields share a colour and fixes the column colours |
| square shape | radius 0 everywhere; circles only for `.score` and `.tick` | brief: Shape |

## 5. Motion

| Element | Trigger | Duration | Easing | Reduced-motion substitute | Source |
|---|---|---|---|---|---|
| sheet in | a sheet opens | 320 ms `translateX(100% -> 0)` | `cubic-bezier(.2,.8,.2,1)` | no animation | brief: Motion |
| sheet out | close | 280 ms `translateX(0 -> 100%)` | same | removed at once | brief: Motion |
| damage chip flight | own strike | 330 ms `translate`, `opacity` | same | none | brief: Health Seam step 1 |
| seam drop | boss health falls | 420 ms `height` (after the chip for an own strike) | same | final height at once | brief: Health Seam step 2 |
| numerals count | boss health falls | 540 ms in steps of 0.1 | rAF progress | final numerals at once | brief: Health Seam step 3 |
| attribution line | a strike line is added | 300 ms `transform`, `opacity` | same | none | brief: Health Seam step 4 |
| defeat field | the boss reaches 0.0 | 480 ms `clip-path` once | same | at once, and on reload | brief: Health Seam |
| level badge | "Level up" opens | 500 ms `scale(.2 -> 1)` | same | full size, no animation | brief: Level-up badge |
| swipe | touch drag on a daily or to-do | follows the pointer, 240 ms spring back | same | spring back at once | brief: Mouse and touch |

Nothing loops; the Health Seam remaining field has `data-seam="remaining"` and its height is the boss's remaining
share of the panel height (brief: Health Seam).

## 6. States per async action

| Action | Pending | Success | Failure |
|---|---|---|---|
| complete, score, buy | the control refuses a second press (`aria-disabled`) | feed sentence | `alert` strip (`Not enough gold.` or `Something went wrong. Try again.`); 409 conflicts resolve silently through the live stream |
| save task | "Save task" disabled | sheet closes, focus on the row | field messages under fields, stale copy `This task changed on another device. Close and reopen it to edit.` in its own `alert` |
| import | `Importing...`, disabled | `status` `Imported <n> tasks` | `list "Import errors"`, `The file is larger than 100,000 bytes.`, `Choose a .deedlist text file.`, `File storage is unavailable. Nothing was imported.` |
| upload banner | `Uploading...` | `status` `Banner updated.` | `The image is larger than 2,000,000 bytes.`, `Choose a PNG or JPEG image.`, `File storage is unavailable. The banner was not changed.` |
| chat send | "Send" disabled | message in the log, field clears | `Slow down: you can send <limit> messages a minute.` |
| save settings | "Save settings" disabled | `status` `Settings saved.` | field messages |
| rest switch | applies at once | banner within one second | switch reverts, strip |
| sign in, create account | both buttons disabled | `/board` | `Wrong username or password.`, field messages |

## 7. Breakpoints

| Width | Rule | Source |
|---|---|---|
| up to 767 | phone | brief: Screens and layout |
| 768 to 1279 | tablet | brief: Screens and layout |
| 1280 and up | desktop | brief: Screens and layout |

## 8. Media and licences

| Asset | Made how | Licence |
|---|---|---|
| Hubot Sans, Mona Sans variable woff2 (latin, latin-ext) | Fontsource 5.3.0 files, self-hosted in `client/fonts` | OFL-1.1 |
| Drowsewyrm serpent | drawn in code (`client/components/Serpent.tsx`) | original |
| Level badge | drawn in code (`client/components/LevelBadge.tsx`) | original |
| Icons | Lucide through `lucide-react`, inline SVG | ISC |
| Party banner | uploaded by a leader, stored in the object store | user content |
