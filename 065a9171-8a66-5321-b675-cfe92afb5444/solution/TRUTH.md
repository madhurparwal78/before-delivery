# TRUTH — Tallow Cover golden

Every value says where it comes from: `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys (ideal flow)

1. **Priya asks for three days off** (brief: Journeys 1). Start: Priya signed out, 168.00 h remaining.
   Sign in → `/shifts`. Open Request leave, choose Annual leave, first/last day ~6 weeks ahead, note,
   Save draft → "Draft saved." (one `draft` row). Submit request → "Request sent to Larchfield House."
   (the same row moves to `submitted`; no second row). `/leave` lists
   "Annual leave, <date> to <date>, Submitted" with its hours; the Holiday line shows the balance.
2. **Fenella works the queue** (brief: Journeys 2). `/queue?home=larchfield&status=open&week=&request=<id>`.
   The strip shows 21 cells; Preview approval drops Priya's Early bars one unit each, 40 ms apart, 320 ms;
   breached cells fade in hatching, "-1 below floor", "no senior on shift" and a dashed ghost slot.
   Dropping the Cover chip on a slot (or Enter on it) → `covers` row `open`, request `cover_pending`,
   one email per eligible bank carer, slot gold "cover posted". A claim adds a rota assignment; the next
   5-second refresh raises the bar; with no gaps left Approve enables; approving emails Priya once.
3. **Femi claims a shift on a weak signal** (brief: Journeys 3). Cover email names home, unit, date, HH:MM–HH:MM,
   skill, `/cover`, never the absent person. Claim sends one fresh Idempotency-Key; network retries reuse it and
   answer the stored success byte for byte with `Idempotent-Replayed: true`. Cover `claimed`, one assignment
   (linked to the cover); "Shift claimed: …" shows once; the shift appears in My shifts.
   After clocking out, Holiday accrual's pending hours grow; after HR closes the month a `period` entry.
4. **Aoife on a laggy tablet and her phone** (brief: Journeys 4). Clock in disables at once and sends one punch
   with a fresh Idempotency-Key (retries reuse it). The phone's own key is refused `already_clocked_in` (punches
   for one person are serialised on the person row), its Clock status shows the message and the next fetch
   switches it to Clock out. Exactly one attendance and one `in` punch. Night across the October change = 11 h.
5. **Kwame off sick during approved leave** (brief: Journeys 5). Sickness covering approved annual days makes
   them sick-covered: the request's `sickness_hours` rises, its cost (`hours` − `sickness_hours`) falls and
   `remaining_hours` on `/api/me`, `/api/me/shifts` and the Holiday line rises by the same amount; Today and the
   strip count Kwame away once. Report with first day 8 days ago → `fit_note_required`.
   Upload PNG → `evidenced`, object at `fit-notes/larchfield/<sickness id>/<upload id>.png`. Return closes.
   Managers see "away", never the reason or note.
6. **Rosalind** (brief: Journeys 6). New floor version Rowan Night 4/1 from a future date (listed with the
   old one, audit `floor_version_added`). Today lists the bank carer's missed clock-out (4 h after rostered end,
   last 7 London days); its Correct link opens `/attendance?home=<id>&date=<shift date>`; the correction with a
   reason clears it (audit `attendance_corrected`, version +1). Fenella's save on the old version gets
   `stale_version`; her dialog stays open, refilled from `current`. Close last month (`period` entries for every
   bank carer); export the CSV (`exports/timesheets/<YYYY-MM>/<id>.csv`) and download it as
   `timesheets-<YYYY-MM>.csv` (attachment).
7. **Grace's rota after a swap and rename** (brief: Journeys 7). Removing an assignment deletes it (and cancels a
   claimed cover behind it); the re-add is a new assignment. Live surfaces read the current display name;
   audit entries store the actor's name and role when written. Absent colleagues show "away" only.
8. **Priya's escalation while mail is down** (brief: Journeys 8). Escalation moves the request to `escalated`
   and queues one email; the outbox keeps it until SMTP works. Subjects built from stored text turn each run of
   control characters into one space and are RFC 2047 encoded when not ASCII; `To` is the stored address alone.

## Decided behaviour where the brief is silent

- `uncovered_breaches`, the approval floor check and ghost slots cover affected shifts only, and a shift
  is affected only inside the request's dates (decided: brief "recomputes every shift the request affects").
- Covers on a gap are matched per request (decided: covers belong to a request; ending it cancels them).
- Clock-in picks the earliest matching assignment that has no attendance yet (decided: an assignment
  has at most one attendance).
- Floors and policy shows one `table "Floor versions"` and one `table "Leave policy versions"` across the
  caller's homes with a Home column, and HR gets the two add forms per home (decided: the brief names one
  table of each; a leave policy has no unit, so its form needs a home).
- A multipart file name has the HTML form escapes `%22`, `%0D`, `%0A` decoded before the brief's file-name
  rule runs (decided: browsers send `"` as `%22`, and the brief keeps `"` in `file_name`).
- A Cover chip released away from a slot returns home at once rather than gliding (decided: the brief only
  says it is sent back, and an instant return keeps the chip where the next press lands).
- Homes and units the caller may see, and the London date, are embedded in the app shell (decided: the
  brief has no homes endpoint but the rail, filters and export form need home and unit names).
- Validation copy the brief does not give: `date` "Use a date like 2026-09-14.", `shift`
  "Choose early, late or night.", `week` "Choose an ISO week like 2026-W44.", `kind` "Choose in or out.",
  `unit_id` "Choose a unit in this home.", malformed body "Send a JSON object.".
- `floor_breach` message pluralises: "1 shift" / "2 shifts" (decided: reading of "shift(s)").

## Palette (brief: Visual design; hex decided)

ground `#F5EFE3`, surface `#FAF6EE`, ink `#1E2A33`, ink-muted `#4B5761`, bar = ink at 38 %,
hairline `#D6CCBA`, teal `#0E5A57` (hover `#0A4A47`, press `#073836`), rust `#A23E26` (hatching only),
gold `#C9A04A` (posted cover), gold edge `#8E6E25`.

## Type, space, layout

Fraunces 600 for screen titles (33.18 px), 500 for the queue requester (27.65 px); IBM Plex Sans
400/500/600 body 16 px, steps ×1.2, smallest 12 px; `tabular-nums` everywhere (brief: Type).
4 px spacing unit, 1 px hairlines, no shadows, 44 px targets.

| Viewport | Layout |
|---|---|
| 1280 | rail 1/6, queue list 2/5 of the working area (≈ 1/3 of the screen), detail the rest; strip 21 columns |
| 768 | rail becomes a top bar with wrapped home/unit links; list above detail; strip 21 columns |
| 375 | managers get "Homes and units" opening the rail as a drawer; tables become cards; queue shows list or detail with Back to queue; strip 7 day rows × 3 horizontal bars, vertical stepped floor rule |

## Motion (brief: Motion and effects)

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| bars | select / refresh | 320 ms together | cubic-bezier(0.2, 0.8, 0.2, 1) | snap |
| affected bars | Preview on | 320 ms, 40 ms stagger L→R | same | snap, "4 → 3" pair |
| hatch, labels, ghost slots | after landing | 220 ms fade | same | instant |
| labels then bars | Preview off | 220 ms fade, then 320 ms rise, 40 ms stagger R→L | same | snap, pair removed |
| ghost slot | cover posted | 200 ms to gold | same | instant |
| bar | cover claimed / claimed cover cancelled (refresh) | 320 ms rise / fall | same | snap |
| buttons | hover / press | 180 ms colour | ease-out | none |
| dialogs | open / close | 200 ms fade + 8 px rise | same | instant |

## States per async action

Exactly the brief's Feedback states table (pending, success, error copy) in the named live regions;
network failure shows "Couldn't reach Tallow. Check your connection and try again.".

## Media and licences

Fraunces and IBM Plex Sans woff2 from Fontsource 5.3.0 (OFL-1.1); `mark.svg` and inline icons original.
