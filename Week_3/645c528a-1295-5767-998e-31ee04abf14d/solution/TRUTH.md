# TRUTH — Long Rail Headstring

The brief made concrete. `brief: <section>` values are copied verbatim; `decided: <why>` values are where the brief is silent.

## Journeys

1. **First shot.** Start: no session, no `hs_tutorial_done` in this browser. `/` shows the tutorial table, `Step 1 of 3`, ball 1 on the foot spot (brief: Seed data). Strike at the rest power: balls replay, `Tutorial step` reads `Step 2 of 3`, receipt `First ball 1. Cut 0.0°.`. Third shot opens `Save your progress`. `Skip for now` goes to `/home`; the browser is marked. Provider: nothing recorded.
2. **Sign-up with resume.** Start: guest on `/home`. Play 1-on-1 opens `Create your account`. Valid submit: `POST /api/auth/signup` 201, `hs_session` set, grant pair of 1,000 Coins, Starter Cue owned, verification mail handed to the outbox and sent without waiting (brief: Accounts). The tapped action resumes at `/play`. Provider: one Mailpit message `Verify your Long Rail email`.
3. **Stake table.** Start: two signed-in players on `/play`. Enter joins the queue. Within 3 seconds both reach `/table/<id>`, each with Coins down by the entry and `match_entry` pairs written. Turns run under the server clock. Result: `Match result` on both, Coins, XP and record equal on Home and Profile after reload.
4. **Offline practice.** After one visit the service worker controls the page. Network off: Home marks the seven online cards `Offline` and disables them. Rookie rack: no `/api` write, AI thinks, plays, hands back with `Your turn` or `Ball in hand`. Leaving and returning offers `Resume your unfinished rack?`.
5. **Buying Cash.** Verified adult on `Cash packs`. `Buy Chalk Pack`, `Pay $0.99`, `Confirming`, then `Cash added: 50 Cash. Receipt sent to <email>.`. Provider: Kill Bill account with `externalKey` = player id, default method `__EXTERNAL_PAYMENT__`, one PURCHASE of 0.99 USD; Mailpit receipt with pack, Cash, price, payment id.
6. **Private table.** Host creates a table from the Friends panel and waits (`Waiting for your friend`, `Invite link`). Friend follows the link, signs up if needed, and lands on `/table/<id>` in seat 2.
7. **Tournament.** Register moves the entry to escrow; count rises in place on open pages; the eighth entrant draws random slots and starts the ready check. Short of 8 at the window's end: refunds and `Not enough players. Your <entry> Coins are back.`.
8. **Club.** Join an open club, see roster and weekly score, send presets, role changed by the owner; Leaderboards pin `#<rank> <name> <wins> wins`.

## Palette

decided, within brief: Visual design. Dark: ground `#0D1115`, surface `#141A20`, ink `#F1E9DA`, muted `#B3AC9C`, brass `#C9A24B`, foul `#F0783C`, cloth lit `#3A8FCA` / base `#1B5079` / edge `#0A2237`. Light: ground `#F2EADA`, surface `#E9DFCB`, ink `#191D22`, muted `#55503F`, brass fill unchanged, brass text `#6F5413`, foul text `#A33E0C` (decided: the brief keeps the hues and also demands AA text, so text alone deepens).

## Type

brief: Type. Headings and counters Big Shoulders Display 700/800; body IBM Plex Sans 400/500/600; tabular figures everywhere. decided: 24, 32, 42 heading steps (about a third apart), counters 56.

## Space and layout

decided: 8px unit, 2px radius, 1px brass rulings. brief: Screens and layout.
- 375x812: one column; Scoreboard, table long axis vertical, Shot controls.
- 768x1024: Scoreboard across the top, table horizontal, Shot controls below; mode cards two columns; shop two.
- 1280x800: Scoreboard rail left, table centre, Shot controls right, swapped in left-handed mode; mode cards three; shop four; Friends panel one third wide.

## Motion

| Element | Trigger | Duration | Easing | Reduced-motion substitute | Source |
|---|---|---|---|---|---|
| Loupe | open | 190 ms | cubic-bezier(.16,1,.3,1) | whole at once | brief: Motion |
| Tangent draw | lock or unlock | 330 ms, proportionate | linear | 100 or 0 at once | brief: Motion |
| Sign-up sheet | open, close | 330 ms | cubic-bezier(.22,.8,.3,1) | no slide | brief: Motion |
| Friends panel | open, close | 330 ms | same | no slide | brief: Motion |
| Tier carousel | Left, Right, swipe | 330 ms | same | 200 ms crossfade | brief: Motion |
| Result numbers | dialog opens | 900 ms | ease-out | final values | brief: Motion |
| Button press | press | 100 ms | linear | state colour only | brief: Motion |
| Shots | shot taken | replay at 20 frames a second | linear between frames | end state at once | brief: Motion |

Sheets and panels use CSS transitions on `transform` and `visibility`, so a newer open or close reverses from the current position and no timer exists to re-hide anything (decided: that satisfies "a newer open or close always wins" by construction).

## States per async action

Sign-up: `Creating your account`, control disabled. Pay: `Confirming`, both buttons disabled, Escape ignored. Queue: `Searching within <band> levels`. Every other action disables nothing longer than its request and shows its result in the named notice slot (brief: Feedback states).

## Decided behaviour the brief leaves open

- `aimSensitivity` scales how far one pointer move turns the aim: at 5 and above the aim lands on the pointer, below 5 it moves part of the way (decided: the brief pins pointer aiming at the default and gives no other aim input that could use the setting).
- `music` default off, `sound` default on (decided: nothing plays uninvited). Sound and the room tone are synthesised, so no audio file ships.
- A player counts as dropped 2 seconds after their last table connection ends (brief allows up to 5; decided: a reload should not flash a drop).
- A seat that never opened a table connection counts as connected: the shot clock and forfeit rule still end such a match (decided: drop needs a connection that ended).
- A queue ticket ends when the player's last connection closes (decided: an empty tab must not be paired).
- Tournament matches are 8-ball (decided: the brief names no other mode for brackets).
- `Sign out` sits on Settings (decided: the route is published and needs a control).
- A rematch at a tournament table is disabled (decided: the bracket decides the next match).
- Practice `Match result` reads `No Coins at stake` and `+0 XP` (brief: Practice earns nothing).

## Breakpoints

decided: 768 and 1024 min-width. Between 1024 and 1280 the desktop layout holds.

## Media and licences

Table, balls and cue drawn on canvas; icons inline SVG drawn for this app; app icons `original`. Fonts: Big Shoulders Display and IBM Plex Sans, SIL OFL 1.1, self-hosted woff2 from Fontsource.
