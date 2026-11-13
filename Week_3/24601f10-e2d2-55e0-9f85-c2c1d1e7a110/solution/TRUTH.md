# TRUTH — Cupfold golden

The ground truth of the reference app. Every value says where it came from: `brief: <section>` (copied from
`instruction.md`) or `decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Journeys (ideal end-to-end flows)

1. **Set up a cup from a roster file.** Start: no account. `/signup` (Username, Password, `Create account`) lands on `/t`
   (brief: Screens and layout). `/t/new`: name, format, time zone (default UTC), trophy fill, `Create tournament` lands on
   `/t/<id>/setup`, which survives reload. `Upload roster` opens `dialog "Upload roster"`; a file with three mistakes closes
   the dialog, shows `list "Roster errors"` headed by the focused level-2 heading `The roster was not added. Fix these lines and upload again.`,
   and adds nothing; the rejected file is still stored in MinIO at `rosters/<id>/<sha256>.cupfold.txt` (brief: Services).
   The corrected file replaces the field all or nothing, only after MinIO confirms; `status "Page notice"` reads
   `Added <n> entrants from <file name>.`; `Download roster file` returns the bytes unchanged. `Upload logo` stores
   `logos/<id>/<sha256>.png|jpg`; `img "<name> logo"` shows on the setup page at once and on the public page once check-in has
   opened. (brief: Journeys 1)
2. **Seed, check in and start.** Seeding list: Alt+ArrowUp/Down, a typed seed in `spinbutton "Seed for <name>"`, or a drag
   moves an entrant, is saved at once (`PUT /seeding`, `seeding_version`), renumbers, keeps focus, announces
   `<name> moved to seed <n>` in `status "Your action"` and updates `list "Round 1 preview"`. `Open check-in` takes
   `YYYY-MM-DD HH:MM[:SS]` in the tournament zone, converted to UTC; empty means the server default. Players press `Check in`
   (only while the server says open) and land on `/t/<id>/me`; counts and `<name> checked in` reach every screen live. Check-in
   closes on server time; later check-ins answer 409 `Check-in is closed.`. `Start tournament` removes no-shows, shows
   `Removed <n> no-shows: <names>.` and lands on `/t/<id>/bracket` with byes in the standard places. (brief: Journeys 2)
3. **Report, confirm, dispute, resolve.** A player reports on the card (`dialog "Report score"`); the opponent's card shows
   `<u>-<l> reported by <name>, awaiting <opponent>` live; the opponent confirms or disputes in `dialog "Confirm score"`;
   organizers resolve in `dialog "Resolve dispute"` (from the card or `/t/<id>/disputes`, which lands on
   `/t/<id>/bracket?match=<id>`); every screen shows the resolved card and the announcement. (brief: Journeys 3)
4. **Two people on one match.** Writes carry `version`; the second save is refused with
   `This match was updated by <username>. Current score: <score>.`, the dialog stays open with focus on its first spinbutton
   and the card shows the same result. Both players reporting makes exactly one dispute. (brief: Journeys 4, Business rules)
5. **Fix an old result with Shutter trace.** Match details, `Edit result`, `Review edit`: the preview lists the dependent set in
   reset order with `<n> matches will reset, <c> of them confirmed`; a tangerine path draws card by card (320 ms per segment, cards
   at least 90 ms apart), slats close to half (240 ms); Escape or `Cancel` reverses card by card and returns focus to
   `button "Edit result"`; `Confirm edit` commits exactly the previewed set (409 `stale_preview` if anything moved), other
   screens receive `matches.reset` in order and announce `<n> matches reset`. (brief: Journeys 5, Motion)
6. **Double elimination to a grand final reset.** Losers drop into the published losers rounds; if the losers-side finalist
   wins grand final 1, `Grand final reset needed` is announced and the reset card is played; otherwise it is `not needed`.
   (brief: Business rules, Double elimination)
7. **Round robin and Swiss standings.** `table "Standings"` columns as published, a `Decided by` name on every row, live
   reorder on every screen; Swiss round 2 pairs with no rematch and gives the bye to the published entrant. (brief: Journeys 7)
8. **Follow on a phone, keep the history.** Share link, `tablist "Rounds"`, swipe of at least 50 px more horizontal than
   vertical moves a round; when the tournament finishes each linked player's `/u/<username>` gains one row
   `<name> · <ordinal> of <field size> · <YYYY-MM-DD>` written once. (brief: Journeys 8, Business rules)

Every API route, status code, error body, copy string and grading route is as published in the brief; error precedence is
405, 413, 401, 429, 404, 403, 409, 422, 503, implemented once in `src/server/http.ts`.

## Palette (brief: Visual design; hex decided)

| Role | Hex |
|---|---|
| ground (warm cream) | #F6F0E4 |
| surface (plain white: form cards, dialogs, Bye / Not needed / Waiting cards) | #FFFFFF |
| ink (near-black warm brown; text on tangerine) | #2B211A |
| muted (warm grey-brown) | #6B5C50 |
| accent (saturated tangerine: buttons and the Shutter trace path only) | #FF8A1E, hover #EE7A0E |
| lilac (Pending, Called; Lilac fill) | #DCD0F5 |
| lemon (Awaiting confirmation; Lemon fill; error band) | #F7EC9E |
| mint (Confirmed, Resolved; Mint fill) | #BDEBCB |
| charcoal (Disputed outline and flag, Will reset outline, slats) | #3A3330 |
| focus | 3px ink outline, 3px offset (cards: 4px inside the card) |

## Type, space, shape

Geist variable (bundled woff2, OFL-1.1) for everything. Steps a third apart (brief: Type): 16 body, 18 labels and facts,
24, 32, 42.7, 56.9, 75.9, 101, 134.9 px. Wordmark 134.9 px desk, 101 tablet, 75.9 phone (the largest text on the landing page).
Card names 42.7 px desk, 32 tablet and phone; scores 75.9 desk, 56.9 tablet, 42.7 phone; tabular figures on every number.
Card radius 28, tile radius 48, button radius 0, no shadows, 8 px spacing unit (decided: comfortable density).
Every control and card is at least 44 x 44 px.

## Layout per viewport (brief: Screens and layout; chosen by width alone)

* Phone under 768, tablet 768 to 1199, desk 1200 and up.
* Landing desk: wordmark top-left, description top-right, tall rounded tile centred, format names right-aligned to its left
  (sizes 56.9 / 42.7 / 32 / 24 by distance from the chosen one), fact and `Start a tournament` under the tile. Phone: wordmark,
  description, one horizontal snapping row of format names, full-width tile with its object cropped by the right edge, fact, button.
* Bracket desk: left rail 25 % (name, state, `Check-in count`, actions); bracket area fills the rest with the current round at its
  left edge and cards `75vw + 6rem` wide so the column runs past the right edge. Tablet: rail becomes a top bar, cards
  `50vw - 3.5rem` so the current and next rounds show. Phone: top bar, actions, `tablist "Rounds"`, one round, standings.
  Double elimination stacks winners, losers and grand final regions. `Whole bracket` and Z scale the tree to fit.
* Setup: desk two columns (seeding left; preview, roster, logo, co-organizers, check-in right), tablet and phone one column
  in that order. Public page: field list left, trophy right cropped by the right edge, name and `<n> entrants` under it; phone
  stacks name, trophy, field.
* No page scrolls horizontally at 375x812, 768x1024 or 1280x800.

## Motion table (brief: Motion and effects; all driven by page timers and animation frames)

| Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| Format swap slats (landing) | choose a format | 330 ms | ease-out cubic | instant swap |
| Advance (`data-motion="advance"` name) | match becomes confirmed or resolved | 320 ms | ease-out cubic | no element is created |
| Card fill | state change | 250 ms | cubic-bezier(.2,.8,.2,1) | none |
| Shutter trace path segment | `Review edit` | 320 ms each, cards >= 90 ms apart | ease-out cubic | every dependent outlined, `Will reset`, list and count at once |
| Slats half-close (`data-shutter="half"`) | path reaches a card | 240 ms | cubic-bezier(.2,.8,.2,1) | none |
| Slats reopen, reverse order | Cancel, Escape, a changed score | 90 ms apart | linear | list and count clear at once |
| Slats close (`closed`) | `Confirm edit`, and `matches.reset` on other screens | 240 ms | cubic-bezier(.2,.8,.2,1) | none |
| Button hover, card status word lift | hover | 80 ms | ease-out | none |

No looping or decorative animation exists anywhere.

## States per async action (brief: Feedback states)

Pending: button disabled and `Saving...` in `status "Dialog status"` (page notice outside dialogs). Success: dialog closes, focus
returns to the card, `status "Your action"` reads the outcome. Refused: the published message in `Dialog status` (or the lemon
`alert` band outside dialogs), the dialog stays open, focus on its first spinbutton; field errors sit under the field in ink.
Outage: uploads show `File storage is unavailable. Nothing was added. Try again in a moment.` in the dialog and the band; focus
stays in the dialog; health answers 200 `{"status":"unavailable"}`. Live connection down: lemon band
`Live updates paused. Reconnecting...`, retry within 2 s, catch-up with `after=<seq>`. Notices leave after `CUPFOLD_TOAST_MS`.
Decided copy (the brief is silent, kept minimal): `Loading...` while a first fetch is in flight; `You are not checked in.` on `/me`
before start for a player who has not checked in; `Choose a file.`, `List every entrant once.`, `@<username> is already in the field.`
for conditions the brief does not name; `The link could not be copied. Select it and copy it by hand.` if the clipboard is refused.

## Breakpoints

375x812 phone, 768x1024 tablet, 1280x800 desk; 320 px reflows without horizontal scroll (decided: WCAG reflow).

## Media and licences

All art is drawn in code (`src/client/art/Objects.tsx`, licence `original`): cup, loving cup, ring medal, counters, trophies,
a disputed-flag icon. Fonts: Geist variable woff2, `public/fonts/`, OFL-1.1, from `@fontsource-variable/geist` 5.3.0
(`app/assets.json`, `THIRD_PARTY_NOTICES.md`). Tournament logos are user uploads stored in MinIO. No other media, no CDN.
