# TRUTH — Conecount Paddock golden

Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>` (the brief is silent).

## Journeys (start state, actions, visible and provider-recorded end state)

1. **Onboard a club** (brief: Journeys 1). Start: operator signed in at `/operator`, club absent. Fill `Club slug`, `Club name`,
   `Time zone`, `Chair name`, `Chair email`, `Chair password`, press `Onboard club`. Empty fields show six messages under the
   fields and six links in the `Fix these fields` alert (brief: Public screens). Pending `Creating workspace`; success
   `Club <club name> is ready. <chair name> can sign in now.` in `Operator updates`; the table `Club workspaces` shows the club with
   0 events, 0 drivers, 0 published, `None`. Postgres: `clubs` and a `users` row with role `chair`. The chair signs in and lands on an empty Events screen.
2. **Set up an event** (brief: Journeys 2). Chair on `/events` presses `New event`; dialog opens with focus on `Event name`; heat comboboxes per
   class of the index table in force on the typed date; `Save event` → `Event saved as draft.`; on the event `Open registration` →
   `Event is now Registration open.`, line `Registration closes <YYYY-MM-DD> at <HH:MM>`, rail lists each heat with classes and `<n> stations open`.
3. **Register, check in, claim** (brief: Journeys 3). Driver joins at `/join/<slug>`, registers (`Registered: car <n> <class>, run heat <h>.`),
   Mailpit receives `Registered for <event name>: car <n> <class>`. Claims a station in another heat (`You are working <station> in heat <h>.`,
   Mailpit `Work assignment for <event name>: <station>, heat <h>`). After the cutoff, `Check in` dialog: typing the exact name renders the waiver PDF
   in Gotenberg, stores `clubs/<slug>/events/<id>/waivers/<registrationId>.pdf` in MinIO, records its SHA-256, then marks checked in
   (`Checked in. Your signed waiver is saved.`).
4. **Time a heat** (brief: Journeys 4, Interactions). Run grid with one tab stop; arrows, Home, End; digits/`.`/`D`/`R` drafts; Enter commits and
   moves to the next row's time cell; Alt+G jumps to the first open run; `Timing announcements` announce the sentences from Feedback states.
5. **Follow live results** (brief: Journeys 5). `/events/<id>/live`, tabs `Indexed`/`Class`/`Raw`, `Class filter`; the page polls `standings` every second;
   a committed run plays the settle for its row; scroll position, tab and filter are untouched.
6. **Correct, protest, finalise** (brief: Journeys 6). Correction needs a reason of 5+ characters, writes one immutable row (database trigger
   blocks update/delete; API answers 405 `audit_immutable`). Protest filed while the server says the window is open; chair reads the car's
   correction entries beside it and presses `Uphold` or `Deny`; `Set results final` is disabled while the server reports the window open or a protest pending.
7. **Publish** (brief: Journeys 7). `Publish final results` renders the PDF (Raw, Class, Indexed, each on its own page, header
   `<event name> final results` repeated by the table header on every page), stores `clubs/<slug>/events/<id>/results/final.pdf` once, records the
   checksum, emails each checked-in driver (`Final results: <event name>`), and only then sets `published`. Screen shows `Published at <YYYY-MM-DD HH:MM>`, `Checksum <hex>`, `Download results PDF`.
8. **Index update and CSV** (brief: Journeys 8). `/index-tables` loads a later-dated table; earlier events keep their factors (the table in force is
   chosen at read time by event date); `/season` exports `season-standings-<year>.csv` with every cell starting `=`, `+`, `-` or `@` prefixed by `'`.

## Palette (decided values; roles from brief: Visual design)

ground `#0b0c0e` (HSL L 4.9 %); surface `#15171b` (rail, cards, panels; L 8.2 %); surface-raised `#1c1f25` (inputs, dialogs); rule `#2c3038`
(hairlines); rule-strong `#4a505b`; ink `#e8ebf0` (text, primary button fill, focus ring); muted `#a3acb9` (≥7:1); accent cone orange `#ff6a1a`
used only for the live strip, cone chips, penalty readout, DNF strike and settle highlight; text on accent `#1a0c04`. No other accent; errors use ink,
an `Error:` word and a left rule (brief: orange only for live and penalty state).

## Type, space, layout

Chakra Petch 600 for headings (h1 32/38, h2 24/30, h3 18/24, h4 13.5/18: a third larger per level; brief: Type), IBM Plex Sans 400/600 15/22 for body, JetBrains
Mono 400/600 with tabular figures, right-aligned, for times, cones, positions and car numbers (brief: Type). Spacing unit 4 px; radius 2 px; every control at least
44 px (brief: Touch and contrast). Rail 248 px from 1024 px (brief: Layout rules); `combobox "Heat"` below; live standings `table` from 1024, two equal card columns
600–1023, one column under 600 (brief: Layout rules). Fonts are woff2 files committed in `client/fonts` and listed in `assets.json` (OFL-1.1).

## Motion table

| Element | Trigger | Duration, easing | Reduced-motion substitute |
|---|---|---|---|
| buttons, tabs, rows, nav links | hover/press | 100 ms ease-out on colours (brief) | none |
| dialogs | open / close | 180 ms rise 8 px + fade, `cubic-bezier(.2,.8,.2,1)` / 100 ms fade (brief) | appear and vanish at once |
| settle: raw digits | live update for a run | 200 ms roll (brief) | end value at once |
| settle: cone chips | per cone | 125 ms apart, penalty readout steps 2.000 per chip (brief) | static `1 cone` / `N cones` text |
| settle: indexed/adjusted + badge | after the last chip | appears at once (brief) | at once |
| settle: row slide | after reveal | 500 ms, `cubic-bezier(.2,.9,.25,1)`, FLIP by script, other rows shift one row height (brief) | rows re-order instantly |
| DNF | commit/correction | struck-through orange time + `DNF` for 300 ms, then slide if the order changed (brief) | end state |
| live strip | event running | none, a still line (brief) | same |

The settle is time-based by script (`requestAnimationFrame` timestamps), never scroll-linked; a new update first jumps the running settle to its end state.

## States per async action

Every action disables its control and shows the brief's pending word in the screen's named status region (control labels stay stable); results use the copy
in Feedback states character for character. Dialog failures that are not field errors (renderer, storage, window closed) close the dialog and speak in the region.
Empty/loading/error: a drawn cone mark, a one-line statement and the next step in a surface block capped at 68ch; static skeleton bars; `Try again` button (decided: brief is silent).
A named status region takes no room while empty and gains 16 px above and below when it has text, except on Live results, Timing and Rota, where updates stream in and its room stays reserved so arriving lines never move the rows; a failed submit clears the pending word (decided: a pending word must never outlive the request).

## Decided where the brief is silent

- Integer ids; unknown or malformed ids answer 404. An operator calling club endpoints gets 403 before any lookup.
- `POST /api/stations/<id>/claim` and `/assign` also return `assignmentEmail: "sent"|"pending"` so the UI can add the delayed-email line.
- Every run commit (time, DNF or rerun) and every correction stores `lastChange` with the badge text (brief: Rank change, "At each commit or correction"); a rerun grant changes no best time, so its badge is `Holds P<new>` or `No time`. decided: on the live page a rerun grant updates the badge and announcement without the cone-to-rank settle, since it records no time or cones to roll.
- The join page's club name is placed in the served HTML (`<script type="application/json" id="club">`), so no endpoint beyond the brief is needed.
- Password inputs are `type="password"` with `role="textbox"` so the brief's `textbox "Password"` names resolve.
- Last delivery failure per club keeps only the most recent failure (renderer, storage or mail).
- Live rows whose `lastChange` is null show a muted `—` named "No change yet" in the Change column and card badge slot (decided: tells "no change yet" from missing data).
- Expanded run details are a small table (Run, Raw, Cones, Adjusted, Indexed) with right-aligned mono cells; cones above zero use the penalty orange, a DNF shows the orange strike (brief: Visual design, accent uses).
- Table headers use IBM Plex Sans 600 in the muted colour, right-aligned over number columns (decided: one header face).
- Operator from 1024 px: workspaces table at 2fr with the onboarding form at 1fr beside it; below, table then form (decided: the overview leads).
- Below 1024 px the header drops the signed-in name so brand, sections and `Sign out` stay on one row (decided).

## Breakpoints

600 and 1024 px (brief: Layout rules); no other breakpoint changes which layout a published viewport gets.

## Media and licences

No pictures. Drawn inline SVG: brand cone, empty-state cone. Icons: Lucide (ISC), bundled. Fonts: Chakra Petch, IBM Plex Sans, JetBrains Mono (OFL-1.1) in
`client/fonts`, listed in `app/assets.json` and `app/THIRD_PARTY_NOTICES.md`.
