# TRUTH — Lumen Tide Tidewright (golden)

Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys (ideal end-to-end flow)

1. **Selling a week** (brief: Journeys 1, Holds, Deposit atomicity). Luka signs in → `/w/<ws>/holds`. Opens
   `/w/<ws>/yachts/<slug>`, presses `Hold week of <week date>` on a free week → `Place hold` dialog (focus on
   `Client name`) → `Place hold` (pending `Placing hold`) → address `/w/<ws>/holds/<id>`, note `Hold placed for … It
   lapses <time>.` Hold screen reads status/lapse from the server on open, after actions and every 10 s.
   `Record deposit` (enabled only while Live) → email, currency radios (EUR default), `table "Price"` reloaded per
   currency → confirm (button disabled while pending, so a double click sends once) → `/w/<ws>/charters/<id>`,
   `Invoiced`, note `Deposit recorded. Charter invoiced and confirmation sent to <email>.` Provider end state: one
   Kill Bill account `tidewright-<charter id>` with one committed invoice of 3 external charges in the client's
   currency, created by `tidewright`; one Mailpit mail `Charter confirmed: <yacht>, week of <week date>`; hold
   `charter`; week `booked`. Kill Bill down → 503, outage copy kept in the dialog through every refresh, nothing stored.
2. **Broker** (brief: Journeys 2, Broker page fields/rate limit). `Issue broker page for <broker>` → dialog
   (`Cancel` first, copy `Any earlier page for this broker ends at once.`) → mail `Your <workspace> broker page` with
   `<APP_PUBLIC_URL>/b/<token>` and `This link works until <time>.` The broker places holds in the `Hold for a client`
   sheet; `Your holds` lists only this broker's holds; the manager's Holds table shows `Placed by` = broker company.
   Ended/replaced page → 410 + ended page. Sixth hold request in the window → 429 with `Retry-After`.
3. **Planning a passage** (brief: Journeys 3, Passage energy rule). `New passage` → `Create passage` →
   `/w/<ws>/passages/<id>` with `Passage created.` → `Add leg` (6.0 kn) → sliders (keys 0.5/2.0 kn, Home 4.0, End 12.0)
   recompute every later leg locally with the shared rule; `Passage updates` gets `Leg <n> to <anchorage>: arrives with
   <charge>%[ — below reserve].`; `Send to crew` disabled while any leg is below 20% or no legs → `Save passage` →
   `Send to crew` → crew member sees it read-only.
4. **Rota** (brief: Journeys 4, Rota and rest rules). One Tab stop grid; arrows, Shift+arrows, Space, Home/End, tap
   (pointerType touch). `Save rota` → `Rota saved.`; 422 rest rule → `<crew> breaks the rest rules: <rule text>, from
   <base time> to <base time>.`; 412 → `<member> saved this rota at <base time>. Your changes are still here — check
   them and save again.` Typed cells stay; after a 412 the loaded version is refreshed so the next save can land.
5. **Arriving in port** (brief: Journeys 5, Berths, Shore power). Search lists every berth with Fits/Doesn't fit,
   Available/Booked and nightly fees; `Book berth <code>` → `Book berth` sheet (`Book berth` first) →
   `/w/<ws>/berth-bookings/<id>` with `Berth <code> booked from <arrival date>.` Shore power board refreshes every 10 s;
   taken slot → `Too late — <member> for <yacht> took this slot at <time>.`
6. **Manifest** (brief: Journeys 6, Passport data, Erasure). `Send manifest page` → mail with `/m/<token>`; the lead
   guest adds guests (sheet), enters nationality/DOB/passport, saves (`Manifest saved.`), uploads photos (re-encoded,
   orientation applied, no metadata). Stored values never shown back (`Passport details on file`, `Photo on file`).
   Captain/director see everything; manager names only. `Close charter` → erasure within 10 s of `erasesAt`.
7. **Fleet upkeep** (brief: Journeys 7). Profile two-column from 1024 px, Problems summary on refusal, Withdraw/Put back
   dialogs (`Cancel` first). Withdrawn → public page 410 gone page, out of fleet, search, sitemap, broker pages.
   Tariffs and exchange tables added from future dates; stored prices never change.
8. **Life aboard** (brief: Journeys 8). Stores search (latest input wins), cursor paging (`Load more`), `Add item` →
   item address, `Log movement` sheet → `Logged <q> <unit> <kind> — <on hand> <unit> on hand.` kept through repaints.
   Energy: `Upload daily log` → `Log uploaded — <n> days charted.`; object byte-identical at
   `energy-logs/<slug>/<id>.jsonl`, working copy in Postgres.

## Palette (brief: Visual design; hex decided in DESIGN.md)

ground `#F5F2E9`, paper `#FBF9F3`, graticule `#E6E0D0` (48 px grid), hairline `#CBC3AE`, ink `#15202C`, muted ink
`#4A5764`, teal `#1C6B66` / `#134F4B` (actions, links, focus ring), amber `#D8901C` (ribbon line, points, solar bars,
hatch edges — never text), brick `#9C3822` (dashed 20% line, hatch, `Below reserve` words, errors).

## Type, space, layout

- brief: Type — Newsreader headings (h1 39/31.25, h2 31.25/25, h3 25/20 px wide/narrow, ×1.25 per level), Inter body
  16 px, IBM Plex Mono tabular figures for every figure; all three self-hosted woff2.
- decided: 4 px spacing unit (8/12/16/24/32), radius 6/10/14, 1 px hairlines, content max 1232 px, every tap target
  ≥ 44 × 44 px (brief: Composition).
- Breakpoint (brief: Screens and layout): one at 1024 px. Below: one column, Menu dialog, bottom sheets, sticky Save bars
  (profile, manifest, leg speeds) with scroll padding so focus is never covered, tables as stacked rows. From 1024:
  fleet/legs/weeks strips, two-column screens, inline navigation.

## Motion (brief: Motion and effects)

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| button/tab/nav hover and press | pointer | 180 ms | `cubic-bezier(0.16,1,0.3,1)` | none |
| changed arrival-charge digits | speed change | 180 ms translateY roll | same | swap at once |
| reserve band | crosses 20% | 360 ms opacity in/out | same | appears/disappears at once |
| strip track (fleet, legs) | arrow, wheel notch (≤1 per 360 ms), [ ] | 360 ms transform | same | jump |
| dialogs / sheets / menu | open, close (reopen during exit keeps it) | 360 ms | same | at once |
| ribbon line, area, points (`d`) | speed change | 720 ms | same | final shape at once |
| h1 | first show | 720 ms rise | same | in place |
| loader dots | first data load | 720 ms loop, 720 ms fade out | ease-in-out | static, removed at once |
| sun badge | always | 720 ms rock ±4°, alternate loop | ease-in-out | stopped |

All three speed-change motions start in the same layout effect. Motion is CSS or `element.animate()` only.

## States per async action (brief: Feedback states)

Every action: button disabled with its pending label (also announced) → result copy next to the action and in
`status "Announcements"`, kept until the next action on that screen (polling never clears it). Field errors inline,
plus `Problems` outside dialogs; dialogs stay open as typed and focus the first field in error or the action button.
Session ended → copy + `Sign in again` (typed values kept in sessionStorage per address and put back after sign-in).
Access removed → copy, values kept.

## Decided where the brief is silent

- Direct charters store the exchange table in force on Split today for every currency (EUR rate `"1"`); `depositDate` null.
- Broker rate-limit counts are rows in Postgres, pruned by the 2 s sweep. brief: Broker rate limit — every hold
  request counts whatever its outcome (a refused 429, an unknown or ended token included); `Retry-After` runs until the
  oldest counted request leaves the window.
- Removed members are soft-removed so their sessions answer `access_removed`; their email can be used again.
- Fleet `cabins` filter values `3`–`6` mean "at least"; the `week` filter keeps yachts whose week is free.
- Nav by role: director all; manager Fleet, Holds, Charters, Brokers, Tariffs; finance Fleet, Holds, Charters, Tariffs;
  captain Today, Fleet, Charters, Passages, Berths, Shore power, Tariffs; crew Today, Fleet, Passages.

## Media and licences

All illustration drawn in code (`original`): hull profiles from length and beam, sun badge, brand mark, ribbon, energy
chart. Fonts: Newsreader, Inter, IBM Plex Mono from Fontsource 5.3.0, OFL-1.1 (`app/assets.json`,
`app/THIRD_PARTY_NOTICES.md`). No photographs (brief: Illustrations).
