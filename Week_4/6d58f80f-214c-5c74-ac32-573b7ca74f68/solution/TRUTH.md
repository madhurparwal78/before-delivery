# TRUTH — Lintel Drive golden

The brief made concrete. `brief: <section>` values are copied verbatim; `decided: <why>` fills a silence in the
brief's own direction. `S` is the company date (America/Phoenix, UTC−7 all year) when the seed ran.

## Journeys: ideal end-to-end flow

### 1. Filing drawings (brief: Journeys 1; DP-10, DP-23, DP-38)
- Start: seed state; Marisol signed in at `/drive`.
- Marisol opens Saguaro › Drawings from `tree "Folders"` (click or Enter) → address `/drive?folder=<Drawings id>`;
  the list shows 5 options, two with the "Locked" badge. Tree counts: Drawings `5`, Reports `0`.
- Tab from Sort by focuses the first option; Shift+Down ×4 selects all five → announced "5 selected".
- Ctrl X → "5 files cut", rows show "Cut". Focus moves to Reports in the tree, Ctrl V → `POST /api/moves`
  (`Idempotency-Key`) → rows dim with `aria-busy="true"` and the hollow pending dot.
- Reply: moved 3, stayed 2. Three chips (`data-homing-chip=<file id>`) fly 40 ms apart, 420 ms each, on a curve to
  the Reports node; source rows collapse; on landing Drawings steps 5→2, Reports 0→3. Locked rows return to full
  strength with "Stayed". One announcement: "Moved 3 files to Reports. 2 locked files stayed".
- Provider: `files.folder_id` changed for 3 rows; 3 `moved` ledger rows; storage total unchanged; outbox `moved`
  change → Dev's open screen flies the same chips from Dev's rows (no announcement).

### 2. Two engineers, one file (brief: Journeys 2; DP-35)
- Both open Saguaro › Calculations. Marisol moves Wind load summary.pdf to Reports, Dev to Issued at once.
- Server: rows locked `FOR UPDATE`, conditional `UPDATE … WHERE folder_id = fromFolderId`: one winner.
- Loser's reply has `lostTo:[{folder: winner's folder, by: winner}]`; the loser's chip flies to the winner's folder;
  announcement "No files moved. Wind load summary.pdf was already moved to Issued by Dev Halvorsen" (also a notice).
- Both screens end with one folder holding the file and matching counts.

### 3. Uploading a calculation package (brief: Journeys 3; DP-26..33)
- New › Upload files in Rillito › Calculations → `POST /api/uploads` (state `started`, `partCount` =
  ceil(size ÷ 5,242,880)); bytes kept in IndexedDB; parts `PUT …/parts/n` one at a time; row "Uploading p%".
- Pause stops after the current part (`POST …/pause` → `paused`); reload lists it from `GET /api/uploads`; Resume →
  `POST …/resume`, sends only unconfirmed parts, then `POST …/complete`: storage completes the object, the app
  reads its size, then in one transaction the file row, `uploaded` ledger entry, folder count and storage total.
- Row "Done"; "Uploaded <name>" announced once; list, count and meter update together.
- Storage down: banner "File storage is unreachable. Uploads are paused and previews are unavailable until it
  returns."; starting an upload → row "Waiting for storage", banner copy announced, nothing created; a sending
  upload's part/complete 503 → "Waiting for storage"; paused stays paused; Preview says "Preview unavailable while
  file storage is unreachable.". On recovery (status pushed) waiting uploads resume; "File storage is back. Waiting
  uploads have resumed." announced.

### 4. Timed access that ends on time (brief: Journeys 4; DP-42..51)
- Share on Saguaro › Site photos: Person combobox, "Aiko Brandt — Mesquite Row Architects" + Partner tag, Editor,
  Access ends (pre-filled with `defaultEndDate`) → `POST /api/grants` → "Shared Site photos with Aiko Brandt until
  <date>"; listed in "People with access" with "Ends <date> · <n> days left".
- At 00:00 Phoenix on `S`+15 the sweep ends Callum's Calculations editor grant (`access_ended`); his parent viewer
  grant remains → notice "Your editor access to Calculations ended at the end of <S+14>, Phoenix time. You can still
  view it."; Rename leaves his toolbar.
- Rosa's Rillito › Reports editor grant ends at 00:00 after `S`+3 with nothing behind → notice "Your access to
  Reports ended at the end of <S+3>, Phoenix time."; her list empties, the preview closes, and an earlier content
  link answers 404 (access checked before expiry).

### 5. Locking and live permission changes (brief: Journeys 5; DP-39..41, DP-50, DP-51, DP-53)
- Ines locks IFC Set → "Locked 1 file"; badge shows on every open screen within 2 s.
- Marisol moves both Issued files to Reports → transmittal flies, IFC set "Stayed"; "Moved 1 file to Reports. 1
  locked file stayed".
- Ines changes Aiko to Viewer in Share → "Aiko Brandt is now viewer on Drawings"; Aiko's screen drops Rename and
  Move to and shows "Your access to Drawings is now view only."; her next write is 403.
- Ines deletes the binned site photo forever (alertdialog "Delete forever?") → object deleted first, then row,
  grants, `purged` ledger, totals → "Deleted <name> forever"; every staff meter drops.

### 6. Shortening the bin (brief: Journeys 6; DP-55, DP-56)
- Tomas schedules bin retention 14 days from a future date → "Bin retention changes to 14 days from <date>"; the
  Policy schedule shows it Scheduled. Files binned before keep 30 days; from the date, 14. Bin rows show
  "<n> days left · 30-day rule" and "· 14-day rule" side by side.

### 7. Handing a project over (brief: Journeys 7; DP-57..59)
- Marisol: Details › Hand over → New owner (staff other than owner) Dev, Days to accept 7 → "Offered 2614 Saguaro
  Medical Office to Dev Halvorsen until <date>". Dev accepts in Handovers → "You now own …"; owner changes in the
  same transaction; Marisol gets "Dev Halvorsen accepted 2614 Saguaro Medical Office.".
- Seeded Rillito offer lapses at 00:00 Phoenix after `S`+7 → `lapsed`, ledger `handover_lapsed` (actor null), Dev
  told "Your handover of 2631 Rillito Bridge Retrofit to Marisol Okafor lapsed. You still own it.".

### 8. A partner on a phone (brief: Journeys 8; DP-60)
- 375×812: Open navigation → drawer `dialog "Navigation"`; choose Drawings (drawer closes); long-press a row 500 ms
  → selection mode, "1 selected"; bottom bar (≥44 px targets) Download → content link with
  `Content-Disposition: attachment`. No horizontal scroll.

## Palette (DESIGN.md has the contrast pairs)

| Role | Hex | Source |
|---|---|---|
| paper ground | #F5F1E8 | brief: Visual design; decided: hex |
| rail / panes | #EEE8DC | decided: separates panes without shadow |
| field | #FFFDF8 | decided |
| ink | #1C2330 | brief: Visual design |
| muted ink | #4F5866 | decided (6.38:1 on paper) |
| hairline | #CBC2B1 | brief: Visual design |
| control border | #8C8475 | decided (3.28:1, WCAG 1.4.11) |
| blueprint accent | #1F4F9C | brief: Visual design (7.01:1 on paper) |
| selected tint / hover | #DFE7F3 / #ECEFF4 | brief: Visual design, Motion |
| rust warning | #A3431A | brief: Visual design (5.52:1) |

## Type, space and layout

- Headings, wordmark, pane titles: IBM Plex Sans Condensed 600; body: IBM Plex Sans 400/500 at 13/18 px; every
  numeral: IBM Plex Mono, tabular. Heading steps 15.6 / 18.72 / 22.46 px (×1.2). brief: Visual design.
- 4 px spacing step; desktop rows 40 px (two text lines); hairlines everywhere; no box shadows. brief: Composition.
- 1280×800: top bar 52 px; rail ≈20 % (New, destinations, tree, meter pinned bottom); centre (path bar, notices,
  toolbar or selection bar, list); details ≈25 % (`complementary "Details"`); uploads docked under the centre;
  the announcements strip under it. brief: Screens and layout.
- 768×1024: rail 200 px with ellipsis + title; details closed; Details opens `dialog "Details"` over the right half.
- 375×812: rail hidden → drawer; rows two lines (name; mono size and time); selection bar fixed to the bottom;
  details full-screen sheet; path bar keeps first and last segments with an ellipsis button.

## Motion

| Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| homing chip | move reply (own) or pushed move (watcher) | 420 ms, 40 ms stagger, ≤8 + "+n" | cubic-bezier(.16,.84,.3,1) | no chip; static "+n" badge on the node / path segment until focus moves |
| source row collapse | after its chip leaves | 180 ms | ease-out | removed at once |
| tree count step | last chip lands | 180 ms | ease-out | one-step change |
| dialog / sheet | open | 150 ms opacity | ease-out | appears at once |
| phone drawer | open / close | 200 ms transform | settle | appears at once |
| progress fill | each confirmed part | 120 ms | linear | — |
| row hover | pointer | 80 ms colour | linear | tint without transition |

## States per async action (brief: Feedback states)

| Action | Pending | Success | Error | Outage |
|---|---|---|---|---|
| Sign in | button pending dot | page changes | "Email or password is incorrect." | sign-in outage copy |
| Move | rows dim, `aria-busy` | composed move copy, flight | "Move failed. Nothing was moved." rows restore | same |
| Upload | row "Uploading p%" | "Uploaded <name>" | size copy; "Cancelled upload of <name>"; "Upload of <name> expired" | "Waiting for storage" + banner copy |
| Rename / New folder | — | "Renamed to …" / "Created …" | field errors; locked copy | — |
| Lock / unlock | — | "Locked n files" / "Unlocked n files" | — | — |
| Bin / restore / delete | — | bin copy / "Restored … to …" / "Deleted … forever" | — | "File storage is unreachable. <name> was not deleted." |
| Share / change / remove | — | brief copies | partner-only, date range, duplicate | picker outage copy |
| Schedule / withdraw | — | brief copies | field errors, focus first; "This change has already started." | — |
| Offer / accept / decline | — | brief copies | open handover, other-than-owner, days, lapsed | picker outage copy |

## Breakpoints

≤599 px phone; 600–1099 px tablet; ≥1100 px desktop (decided: the brief's three viewports fall in each band).

## Media and licences

- IBM Plex Sans / Sans Condensed / Mono latin woff2 (Fontsource 5.3.0), OFL-1.1 — `app/assets.json`.
- Lucide icon paths, ISC — inlined.
- Favicon, empty-state drawing, grid thumbnails, seed drawing-sheet PDFs and blueprint PNGs: drawn in code, original.
