# TRUTH — Wren Calendar golden

Every value says where it came from: `brief: <section>` (copied verbatim) or `decided: <why>` (the brief is silent; the reason ties
it to the brief's intent).

## Journeys (ideal end to end)

1. **A weekly meeting across the change.** Ines Okafor signs in (`ines@sundialwren.example`, `wren-seed-2027`, brief: Seed data), opens
   `/calendar?view=week&date=2027-03-15`. Partners' weekly shows 13:00 to 14:00 London (09:00 New York, a zone that changed clocks one week
   before London). Dara Kessler on New York time sees 09:00 to 10:00. The week of 29 March both see their usual times again
   (brief: Journeys 1; Seed data table 9 Mar 14:00, 16 Mar 13:00, 30 Mar 14:00, 6 Apr 14:00 London). Provider record: Postgres `events`
   holds `09:00` local and zone `America/New_York`; instants are derived per occurrence by `resolveLocal`.
2. **Dragging without waking anyone.** Pointer down on a block opens Three clocks beside it (ribbon slides out in 330 ms, brief: Motion),
   numerals roll at every 15-minute snap (200 ms), each bar is pink while that time is inside working hours. Release saves in the event's own
   zone, the quick dialog opens with the same three times in its title row, other screens show the new time within a second (live feed).
   Status: `Saving <title>...` then `Moved <title> to <time> <city>.` (brief: Feedback states). Undo stays 10 seconds.
3. **Editing part of a series.** Move one occurrence (exception), delete another (trash item `occurrence`), then change this and following:
   the series becomes two (`split_from`), each exception and answer stays on its date in whichever series holds it, the later series has the
   remaining `COUNT` (brief: Business rules, This and following).
4. **Two people, one event.** Simultaneous `PATCH` with the same `If-Match`: exactly one `200`, the rest `412 version_conflict` with the winner's
   values; the loser's dialog `This event changed` offers `Reapply my changes` (sends the loser's changed fields on the winner's version,
   `Saved <title>.`) or `Keep theirs` (`Kept the saved values for <title>.`).
5. **An invitation meets out of office.** Inviting Tane Whitcombe over the seeded out-of-office week answers `No` with the window message,
   writes one decision and one notice per recipient, delivers it once to each open screen; counts become `0 yes, 1 no, 0 maybe, 0 waiting`.
6. **A guest proposes a time.** Maybe for one occurrence plus a proposal; the organiser's open event page lists it within a second with
   `Accept`/`Decline`; accepting moves only that occurrence (exception), makes the proposer `Yes`, and announces
   `Proposal accepted: <title> moves to <time> <city>.` once.
7. **The office manager's week.** Zone rule recorded (`Rule recorded for <city>.`) warns only occurrences from its date on timed events saved after
   that date whose own shift is not zero; sharing level changes reach the colleague's open grid at once (`Your access to <calendar> changed to
   <level>.`); a print started while Gotenberg is down stays `pending` with Retry and completes after the service returns, with one object key
   `prints/<id>.pdf`.
8. **Restoring what was deleted.** Trash restores ids, guests, answers, switches, proposals, exceptions and link; an occurrence is its own item;
   an untouched item is purged `TRASH_RETENTION_SECONDS` after being trashed, from every surface including change-log payloads.
9. **Setting up my own view.** Custom days, week start, hidden weekends and a second zone are person settings in Postgres and reach other tabs
   within a second. `?` lists keys; `Escape` on an event page goes to `/calendar?...&focus=<id>` with the block focused.
10. **Sketching a meeting.** Drag across empty slots, type half a title, reload: the server draft comes back with focus in `Title`, also in
    another browser; Save, Cancel and Escape delete it. No browser storage is used.
11. **A crowded day.** Lane rule (longest, earliest, id) per day column; a night call shows a block on each of its two days; month cells show
    `+N more` where shown chips plus N equal the day's events and recalc with window height.
12. **Setting up a repeat.** Radiogroups for Repeat, Monthly by (read from the start date) and Ends save `FREQ`, `BYDAY` (`2TU`, `-1FR`), `COUNT`
    or `UNTIL`; every other form answers `422` on `rrule`.
13. **Finding a time.** `/api/find-a-time`: earliest 15-minute-aligned slots inside everyone's office hours, `Busy blocks` per person cut at each
    local midnight of the viewer.
14. **Sharing a calendar.** Manage sharing lets a colleague change other people's levels from `/sharing` while their grid is open.
15. **Being reminded.** Reminders are derived from occurrences plus `reminder_states`; they fire on the server clock within a second, write one
    notice, show `region "Reminder: <title>"`, snooze (`Snoozed <title> for <n> minutes.`) fires once more; moving an occurrence moves them.
16. **Focus time.** `decline_mode` `new_and_existing` (default) declines existing and new overlapping meetings; `new_only` only new ones.
17. **Out of office with conflicts.** New invitations answer `No` with the message; existing meetings are listed in `list "Conflicts"` to answer.
18. **Finding and copying.** Search, open the result on its date with the block focused, duplicate (`<title> copy`), move to another calendar,
    switch on Public holidays.
19. **A guest and the zone rule.** Guests see the warning `A zone rule for <city> took effect on <date>: <note> <saved> now shows as <shown>.`
    without Move; Move (full access, This and following) returns warned occurrences to their saved clock time.
20. **Switches on a live event.** See guest list off kills the shared link for good; Modify event on shows the list to every guest of that event.

## Palette (hex used by the build)

| Role | Hex | Source |
|---|---|---|
| ground | #150A1C | brief: plum-black ground |
| surface | #22122C | brief: slightly lifted dark plum |
| hour band tints | #1A0E23 / #21122C | brief: alternating tint steps, no lines |
| ink | #FFFFFF | brief: white ink |
| muted | #BCA6C6 | brief: soft greyed mauve |
| accent | #FF2E93 with text #150A1C | brief: hot pink, dark plum-black text when a fill |
| selected | #3A2147 | decided: keeps pink off selection |
| selected hover | #4A2F58 | decided: one tint step above selected for hover on buttons already resting on selected; white text 11.4:1 |
| danger | #FFB59E | decided: error copy that is not the accent |
| control edge | #8F7A99 | decided: 1px inset edge on form fields and check marks, above 3:1 on ground and surface for WCAG 2.2 AA |
| rose / amber / teal / indigo | #A8215A / #8A5300 / #0B6E69 / #4A44C4 | decided: solid fills with white text above 4.5:1; Public holidays is rose |

## Type, space, layout

Sora light 300 titles (31.25, 25, 20 px: each step a quarter larger), Sora regular 400 content at 16 px minimum, 600 for emphasis (brief: Visual
design). Three clocks numerals are tabular, each digit in a 0.7 em cell and the colon in a 0.3 em cell, with time above city above bar on every surface (brief: "evenly spaced numerals"; decided: one stack order). A clock on another date than the line beside it adds a muted `next day` or `previous day` under its bar; the group's accessible name stays as published (decided: exact times need their date). Landing: heading, sentence, Sign in and the text link stack on the one left edge (brief: Hero "on that edge"). Slot 24 px per 15 minutes (decided). A timed block of 45 minutes or more wraps its title to two lines with its times below; shorter blocks keep one line each (decided: block text stays readable without opening it). In the main navigation only the current page carries a fill; Sign out rests unfilled like the links (decided: one selected item per row). One left edge: 312 px at 1280, 24.4% (brief: about 22%; decided: the rail holds seven 44 px mini month days plus 2 px each side; rail ends there; toolbar, grid, single columns start there), 10% at 768
for single columns, even 16 px margins at 375 (brief: Screens and layout). At 600 and wider the time grid scrolls inside the room under the toolbar and rail, so they stay on the first screen with the 09:00 row at the top of the scrolling area (decided: brief First draw and Screens and layout both hold); at phone width the page scrolls. Breakpoints 600 and 1024 (brief). Every control and tap target is at least 44 px in each direction (brief: Density).

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| Three clocks ribbon | pointer down on a block | 330 ms | cubic-bezier(.2,.8,.2,1) | appears without sliding |
| digit | each 15-minute snap | 200 ms | cubic-bezier(.3,.9,.3,1) | swaps; line announced |
| ribbon travel into dialog | release | 330 ms | cubic-bezier(.2,.8,.2,1) | none |
| dialogs | open | 200 ms | cubic-bezier(.2,.8,.2,1) | at once |
| dialogs | close (an inert picture of the dialog fades; the dialog itself is gone at once) | 120 ms | ease-in | at once |
| blocks changed live | live message | 240 ms position | cubic-bezier(.2,.8,.2,1) | jump |

## States per async action

Exact copy from brief: Feedback states (Saving..., Saved..., Moved..., Undid..., Your answer is saved..., Rule recorded..., Settings saved.,
print state copy, `File storage is not answering. Nothing was changed. Try again shortly.`). Pending copy is announced in `status "Wren status"`
and the result in the same region; field errors sit beside fields with a linked summary.

## Media and licences

No pictures. Sora 300/400/600 (SIL OFL 1.1, `app/web/fonts`, listed in `app/assets.json` and `THIRD_PARTY_NOTICES.md`). Icons are small inline SVG
drawn in code (original).

## Decided where the brief is silent

`kind` values `event`/`focus`/`out_of_office`; colours `calendar`/`rose`/`amber`/`teal`/`indigo`; `POST /api/events/:id/undo` for Undo;
`reminders.minutes` null for all-day; reminders and trash purge run on 250 ms and 400 ms server-side ticks; every write transaction takes one
advisory lock so change-log order equals commit order across processes; the live feed projects each row for each person at send time. The page reads `/api/time` before its first draw, so no view ever takes today or the now line from the device clock.
