# TRUTH — Overcall (golden)

Every value says where it came from: `brief: <section>` (copied verbatim) or `decided: <why>` (the brief is silent; the
reason ties it to the brief's intent).

## Journeys (ideal end to end)

1. **Score an over by keyboard.** Start: signed-in scorer on `/matches/:id/score` of a match whose first innings has begun
   with the opening bowler chosen; the page asks for the pen over `/ws` (`{"type":"score","match":id}`) and enables the pad
   when the `pen` message carries a pen id (`brief: Business rules, The pen`). Keys `0`-`6`, `D N B L`, `W`, `U`, `R`,
   `Escape` work with focus anywhere outside a text field, select or open dialog (`brief: Interactions`). Each digit sends
   `POST /deliveries` with `expected_seq`; keys pressed while one saves are queued and sent in order, each against the then-current
   `last_seq`; nothing on screen changes until the server answers; the pad has `aria-busy="true"` meanwhile. The This over
   strip, the commentary and the score update from the answer; the Ball tick rolls the changed digits; `FREE HIT` shows
   after a no-ball. End: after the sixth legal ball the server's state says `next_bowler_needed`, the batters have changed
   ends, and the Next bowler dialog opens by itself with focus on `Bowler`.
2. **Take wickets and fix mistakes.** `W` opens the Wicket dialog (focus on the first enabled radio of `How out`; kinds the
   server's rules forbid are `disabled`; on a free hit the dialog shows `Free hit: only a run out can dismiss a batter.`).
   Catch, LBW and run out record with fielder, batter out, runs completed and new batter. `Change delivery <seq>` opens the
   change dialog (focus on the pad button matching the current runs; `#change-preview` shows `New: <runs part>`); `Save change`
   sends `PUT /deliveries/:seq`; the replayed innings is shown and `Delivery <seq> changed. Innings recalculated.` is announced.
   `U` sends `DELETE /deliveries/last` and announces `Undid delivery <seq>.`.
3. **Follow from home.** `/live/<code>` loads the viewer state over HTTP (shown at once), then watches over `/ws`
   (`{"type":"watch","code":code}`). Each `state` message is shown exactly `LIVE_DELAY_MS` after it arrives by the page's own
   timer, in arrival order. A change or undo sets `#notice` (`The scorer changed delivery <seq>.` / `The scorer undid delivery
   <seq>.`) and is announced with the recomputed values. `#scoreboard` is pinned at the top (`position: sticky; top: 0`) while
   the commentary scrolls beneath; the pin releases into the `Scorecard` link. At the result the `#result` band shows, and the
   scorecard has the full innings.
4. **Hand over the pen.** Organiser's match page: `Send invitation` posts `/api/matches/:id/invitations`; Mailpit receives the
   message (`Subject: Score <home> v <away> on Overcall`, the link `<APP_BASE_URL>/invitations/<token>`, the line
   `This invitation works once and expires after <hours> hours.`). The invitee opens the link, `Accept invitation` lands on the
   scoring page; while the first scorer's socket is open it is read-only and `#pen-notice` names the first scorer. When that
   socket closes the pen lapses `PEN_GRACE_MS` later (Valkey key `pen:<match id>` expiry), every read-only page gets
   `No one is scoring this match.` and `Take the pen`; one page gets the pen (`SET NX`).
5. **Chase and finish.** At the break both pages show `#innings-break` (`Innings break` plus the target sentence). `Start second
   innings` opens Start innings; the chase line updates after every delivery; the result shows on the scorer page, every
   viewer page, the scorecard and both teams' history, and persists after reload.
6. **Settle a tie.** Level scores with `super_over` on: `super_over_break` with heading `Super over <n>` and `Scores level. <team>
   bat first in super over <n>.`; each half is one over ending at 2 wickets; the result `<team> won the super over`; super overs
   are in the scorecard and never in careers or net run rate.
7. **Run the group.** The tournament page holds one table per group (caption = group name; columns `Team P W L T Pts NRR`); a
   finished group match publishes the new tables on `tournament:<id>`; the page re-sorts in place and announces `Points table
   updated.`; a player's career page shows the new figures after reload.
8. **Keep a logo.** The team page's organiser form uploads `POST /api/teams/:id/logo`; while pending `Upload logo` is disabled and
   `Uploading logo` shows under it; the logo shows only after MinIO confirms the object (`logos/<team id>/<n>.png|jpg`). With
   storage down the answer is 503 `STORAGE_UNAVAILABLE` and the outage copy shows under the input and in `#alert`; the previous
   logo stays.

## Palette roles (hex used by the build)

| Role | Hex | Source |
|---|---|---|
| ground (page, even bands) | `#0E0B1A` | brief: Visual design (near-black, violet cast) |
| surface (pad group, dialogs, panels, odd bands) | `#1E1A3C` | brief: Visual design (deep indigo, lighter than ground) |
| key (pad keys) | `#34305A` | decided: keys must separate from the pad's surface fill |
| field (inputs, selects) | `#2A2650` | decided: WCAG 1.4.11 control boundary |
| ink | `#F0EBFF` | brief: Visual design (very pale lavender-white) |
| muted | `#A9A2C8` | brief: Visual design (greyed lavender) |
| accent lime | `#C6FF3D` | brief: Visual design (acid lime, only primary actions, armed outline, changed digits) |
| band violet (white text) | `#4A1FE0`, deep `#3A15B8` | brief: Visual design (deep electric-violet for result, points slab, errors, outages) |
| pale panel (landing hero, ground text) | `#EDE8FF` | brief: Visual design (a pale panel across the left three-quarters) |

## Type

Display Dela Gothic One 400 (`font-display: block`), body DM Sans variable (`swap`), both self-hosted woff2 in `public/fonts`
and preloaded. Steps ×4/3 from 1rem: `1rem`, `1.333rem`, `1.777rem`, `2.369rem`, `3.157rem` (brief: Visual design). List names
`2rem`. Poster total (runs, `/`, wickets) `calc(100vw / 8)` capped 168 px on a laptop and `calc(100vw / 6)` at ≤ 600 px; overs and run
rate at body size (brief: Visual design). Landing corner words `min(10vw, 144px)`, phones `100vw / 6`. Tabular figures everywhere
numbers align (brief). Measure 62ch; forms 40ch (about 34 characters of input plus padding).

## Space and layout per viewport

| Width | Layout | Source |
|---|---|---|
| 320 | one column; nav behind `Menu`; pad keys `(100vw - 88px) / 4` = 58 px (≥ 48); tables scroll inside their own section; no page scrolls sideways | brief: Frontend |
| 375 / 390 | scoring page stack from the top: scoreboard (poster), batters, bowler and run rate, chase slot, This over, FREE HIT slot, break/result bands, `Scoring pad` (4 × 4 square keys, 72 px), `Retire batter`, feedback strip, commentary. Every pad key ends above y = 760 | brief: Frontend (Scoring page layout) |
| 768 | pad in a right column (360 px, sticky) beside scoreboard and commentary, keys 72 px (≥ 44); nav inline | brief: Frontend |
| 1024 / 1280 / 1440 | content capped at 1280 px; poster total 1/8 of the width; viewer scoreboard pinned | brief: Frontend, Visual design |

Spacing unit 8 px; radius 0; no border, shadow or gradient anywhere except the 3 px bottom edge of inputs (decided: control boundary).

## Motion

| Element | Trigger | Duration, easing | Reduced-motion substitute | Source |
|---|---|---|---|---|
| `.digit` (runs, wickets, overs) | page shows a new state | `TICK_MS` (260), `cubic-bezier(0.2, 0.9, 0.3, 1)`; delay 0 runs, `TICK_STAGGER_MS` wickets, 2 × `TICK_STAGGER_MS` overs; one `Element.animate` with `id` `ball-tick`; `data-ticking="true"` while it runs; up on increase, down on a decrease | no animation is created; digits change at once; changed digits stay lime (`data-changed`) | brief: Motion and effects |
| buttons | pressed | `background-color` darkens while held, no transition | same | brief: Motion |
| landing `OVER` / `CALL` | scroll | `position: sticky` wrappers, `mix-blend-mode: difference` | `position: fixed` in the corners, panels a plain stack | brief: Motion, Visual design |
| dialogs, notices, menu | open / close | instant | same | brief: Motion |

## States per async action

Record a delivery: pad `aria-busy`, later keys queued; refusal in `#alert` (and the open dialog); network failure
`That ball was not saved. Check your connection and try again.`. Change: `Save change` disabled; refusal in the dialog and `#alert`.
Undo: `Undo` disabled; `Nothing to undo in this innings.` on 409. Start an over or innings: dialog button disabled; refusals under
the select and in `#alert`. Send invitation: button disabled; `Invitation sent to <email>.` under the form and in `#announcer`;
field error under the textbox; mail outage in `#alert`. Upload logo: button disabled, `Uploading logo`; `Logo updated.`; type or
size copy under the input; storage outage under the input and in `#alert`. Sign in or up: button disabled; failure copy in a band.
Points table change: re-sorts in place, `Points table updated.`. A stale delivery (409 `STALE_DELIVERY`): `The score has moved on.
Showing the latest.` in `#alert`, then the latest state is fetched. `#announcer` and `#alert` are visually hidden (brief); a still
feedback strip mirrors them for sighted users (decided: OVERRIDES visible confirmation).

## Breakpoints

600 px: nav collapses behind `Menu` (brief: at 390 and narrower; decided: 600 so tablets in portrait at 768 keep the nav inline); 900 px: on the landing page only, the nav and the stacked links collapse behind `Menu` too, because the pinned `OVER` would cover them (decided);
768 px: scoring page two columns; 1280 px content cap. Judge viewports 375×812, 768×1024, 1280×800 are covered.

## Media and licences

No raster image, icon set or stock media ships. The landing pitch strip, pad close-up, over map, points slab and wagon wheel and the
commentary's over maps are inline SVG drawn for this app (licence `original`). Fonts: Dela Gothic One and DM Sans, SIL OFL 1.1, listed
in `assets.json` and `THIRD_PARTY_NOTICES.md` with the full licence text. Production packages: preact, pg, ioredis, ws and their
transitive dependencies, all MIT, ISC or Apache-2.0 (see `THIRD_PARTY_NOTICES.md`).

## Server truths

One laws engine (`src/server/laws`) replays an innings' log (`over`, `delivery`, `retirement` entries) after every start, over,
delivery, change, undo or retirement; scorecard, points table, net run rate (exact fractions, half away from zero to 3 decimals),
team history and careers read the same replay. Postgres stores users, sessions, teams, players, tournaments, groups, matches, XIs,
scorers, innings and their ball logs, invitations (token stored as a SHA-256), logo records; no derived totals are stored. Valkey
holds `pen:<match id>` (value: pen id, expiry `PEN_GRACE_MS`, renewed five times per grace while the holder's socket is open) and the
channels `match:<id>` and `tournament:<id>`; with Valkey down the pen is kept in process memory with the same rules and every
watcher gets `{"type":"live","status":"paused"}`. MinIO holds `logos/<team id>/<n>.png|jpg`. Mailpit receives one message per
invitation and an invitation is stored only after the SMTP server accepts it.
