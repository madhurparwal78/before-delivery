# TRUTH — Quirewell Stand Desk (golden)

Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys (ideal end-to-end flow)

1. **Build a programme** (brief: Journeys 1, DP-03/04/07/49). Start: Rowan signed in on `/desk/p01`.
   `New programme` → dialog (focus on `Title`) → title, first rehearsal `2026-10-25 01:30`,
   performances in `YYYY-MM-DD HH:MM` London time → client sends `2026-10-25T01:30:00+01:00`
   (repeated hour = earlier, BST offset) → `201`; Desk status `Programme <nn> created.`; the rail
   lists `Programme <nn> · <title>`; the desk opens it without a reload. `2027-03-28 01:30` is
   refused in the dialog with `There is no 01:30 on Sun 28 Mar 2027 in London time.` and nothing is
   sent. `Add work` → `The Weir added to Programme <nn>.`; `Start preparation` →
   `Programme <nn> is now In preparation.` Provider: rows in `programmes`, `performances`, `works`,
   `bar_segments`, `rehearsal_letters`, `parts`.
2. **Raise the string count** (DP-08/09/11). P01 8-7-6-5-4 → 10-8-6-5-4 → one PUT; the response
   plus a re-read of the selected work render rail, header and parts table in one frame:
   `String count saved: 10-8-6-5-4. Short 4.`, needed 61 / on hand 57 / short 4. Copies-on-hand saves
   send on blur/Enter when changed; only the latest request's answer renders.
3. **Mark a cut with the keyboard** (DP-12–17, DP-44). Ruler caret Home/arrows; Shift+arrows extend;
   Enter → `201` → hatch sweep 100 ms, collapse 330 ms (later ticks/letters slide left), the
   `vi–de 120–184` mark lands, running time counts 38:40 → 34:12 in 330 ms, then 14 `Mark cut` flags
   and Ruler status `Cut bars 120–184 · −4:28 · 14 parts to mark`. Restore (splice dialog or
   `Undo cut`): flags go, time counts up (330 ms), the mark widens back while later ticks and
   letters slide right (330 ms), hatch clears (100 ms), Ruler status `Restored bars 120–184 · +4:28`.
4. **Confirm cuts and file a bowing master** (DP-19/20/25/50). Section desk card → `Confirm cut a–b`
   → 201 or 200 with the stored `marked_by`; copy `Confirmed a–b by <name>`. Upload → `Uploading`
   → `Filed` (201) / `Not filed` + reason line. Provider: `marks` (PK part+cut), MinIO object +
   `scans` row.
5. **Marked-part scan, store outage** (DP-21–24, DP-39, DP-52). Upload status
   `Uploading scan for <label>` → `Scan filed for <label>.`; storage down on a status check → alert
   banner, upload buttons `aria-disabled="true"` described by the banner text, no file chooser.
6. **Publish folders** (DP-27–30, DP-51). Dialog lists server `publish_blockers` (or
   `Nothing blocks publishing.`), `Seated players: <n>`, `First rehearsal <date-time>`; `Publish`
   sends one Idempotency-Key; Desk status `Folders published. Player notices: <s> sent, <q> queued.`
7. **Folder on a phone** (DP-31–34, DP-46). One page at a time, swipe > ¼ width, buttons, arrow
   keys; each change GETs the page; a 404 replaces the carousel with `That part isn't in your folder.`
8. **Rentals** (DP-35–38, DP-47, DP-48). Due = London date of final performance + 14 days at 23:59
   London; overdue from 00:00 the day after; reminders from due − 7 days to each assistant; check-in
   saves only changed lines with their expected counts; `count_changed` resets only stale lines.

## Palette (brief: Visual design; hexes decided in DESIGN.md)

| Role | Hex |
|---|---|
| paper | `#F6F0E2` (deep `#EEE6D3`) |
| ink | `#221B15` (soft `#5A4D42`) |
| accent (oxblood) | `#6B1D29` (strong `#531520`) |
| rule | `#B9AD9C` |
| control edge | `#7E6F60` |
| caution | `#B4521B` |

## Type, space, layout

- brief: Fraunces display (rail numerals 40px, the largest type; h1 27.34 / h2 21.875 / h3 17.5px,
  ×1.25 per step from 14px body), IBM Plex Sans body, IBM Plex Mono tabular figures (12px bar numbers).
- decided: 4px spacing unit, 2px control radius, 44px minimum targets, 1px hairlines, no shadows.
- brief: ≥1280 three panes with a fixed full-height rail (decided 272px); 768–1279 rail removed,
  `Programmes and works` drawer from the left; <768 stacked header, inline rail (decided: scrolls
  inside 420px), ruler, parts as labelled cards. Bar labels every 10/25/50 bars by viewport width.

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| splice hatch | cut 201 | 100 ms | linear | none, redraw spliced |
| splice collapse + slide | after hatch | 330 ms | ease-out cubic | none |
| running-time count | after collapse | 330 ms | whole seconds, linear | new total at once |
| restore (brief order: flags go, count up, widen, hatch clears) | DELETE 200 | count 330, widen 330, clear 100 | count whole seconds linear; widen ease-out cubic | none, redraw restored |
| dialogs fade / drawer slide | open, close | 250 ms | cubic-bezier(0.16,1,0.3,1) | instant |
| folder page settle | page change | 330 ms | ease-out cubic | instant |
| hover / press | pointer | 100 ms | linear | instant |

decided: splice and folder slides are stepped by `requestAnimationFrame` so the page clock drives them.

## States per async action

brief: Feedback states table, copied verbatim into the client (Desk, Ruler, Upload, Rental,
Section, Bowing master status regions).

## Decided where the brief is silent

- decided: new programme id `p<number>` (seed pattern).
- brief: Delivery rules: "Each queued message is retried on every reminder sweep until accepted, and
  is sent at most once." decided: a send in flight holds its database claim (120 s, so a process that
  dies mid-send never blocks it for good); a failed send's claim is cut to `REMINDER_SWEEP_SECONDS` − 1 s,
  so it lapses before the next sweep and that sweep retries it.
- decided: rental `Work` options are every programme work, labelled `<work> — Programme <nn> · <title>`;
  slip copies default to each part's copies needed.

## Media and licences

- Fonts: Fraunces, IBM Plex Sans, IBM Plex Mono (OFL-1.1), self-hosted woff2 in `app/public/fonts`,
  listed in `app/assets.json`.
- Icons: Lucide via lucide-react (ISC). No images.
