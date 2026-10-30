# TRUTH — Tilth & Tally Furrowbook (golden)

The brief made concrete. Each value says where it came from: `brief: <section>` (verbatim) or
`decided: <why>` (the brief is silent; the reason ties it to the brief's intent).

## Ground rules of the build

- State = `workbooks.genesis` (empty "Plots" sheet, or the imported content) + the ordered `ops` record (seq 1, 2, 3… without gaps); `restore` ops carry the restored version's snapshot. Every read folds them through the one shared engine (`src/shared/engine.ts`) used by the browser too. — brief: Derived values; DP-60
- New workbook: `headSeq` 0, state `draft`, one empty sheet "Plots". — brief: API · Workbooks; decided: genesis content keeps headSeq starting at 0
- Error body: `{"error":{"code","message","fields"?,"limit"?}}`; one precedence: 413 → 403 cross_origin → 401 → 404 → 403 forbidden → replay/409 key reuse → 409 state → 415/422 → 503. — brief: API · Error shape, Error precedence
- `GET /api/invites/<token>` → `{"invite":{"name","stationName"}}` (404 when used/unknown). — decided: the invite screen must greet by name and station and no listed endpoint provides it
- `GET /api/share/<token>` additionally carries `timeZone`. — decided: the share strip must show expiry as `<local time>` in station time
- Sheet `position` is 1-based. — decided
- A batch groups consecutive pending edits made against the same base; its `baseSeq` is the head the member saw when making them. — decided: keeps offline conflicts honest (journey 4)
- Paste of tab-separated text into the grid commits ordinary cell edits. — decided: journey 7's "bulk paste"
- Several instances share one database: schema/seed under an advisory lock; cutoff lock by conditional UPDATE; mail and export workers claim rows with SKIP LOCKED and only act when their own service is up. — decided: brief · Deployment ("Several instances may run at once")

## Journeys (ideal flow and recorded end state)

1. **Start the season's workbook** — Tomás signs in at `/signin`; types "Soy" in `searchbox "Search workbooks"` → only Ridgeback's soybean workbook is listed; clears it; "Create workbook" → `dialog "Create workbook"`, names it, double-taps "Create" (disabled, "Creating…" after the first press; one request key per dialog session) → lands on `/w/<id>` with notice "Workbook created."; back on "Workbooks" the row appears once. Provider: one `workbooks` row, one `request_keys` row.
2. **Bring last season forward** — "Import workbook" shows `list "Import limits"` (six lines from `GET /api/limits`, comma thousands); picks the .xlsx → new draft workbook whose tabs, values, formulas, dates and bold match; notice "Imported <name> with <n> sheets.". Provider: `stations/<sid>/imports/<wid>/original.xlsx` stored before the row is committed; on any later failure the object is deleted (undo point in `routes/workbooks.ts`).
3. **Field edge** — offline: strip "Offline · edits will sync when you're back in range"; each commit shows its value at once with a rust corner mark and description "Pending sync"; strip "Offline · 4 edits waiting"; reload keeps them (localStorage per member + workbook). Online: one batch with one fixed key, retried every 5 s and on `online` with identical key/body; end "All edits synced"; each op exactly once in `ops`.
4. **Two technicians, one cell** — Dana's batch is sequenced first; Lee's becomes `conflict`; Lee sees "Plots!B2 conflicted with Dana Okafor's edit. Your value is in the conflict tray." and "Conflicts (1)"; Enter on it opens the rail on Conflicts with focus on "Re-apply mine for Plots!B2"; item shows "Yours: 59.3", "Current: 58.1 by Dana Okafor"; re-apply → "Your value is back in Plots!B2.", tray "No conflicts. Every edit you made is saved.", focus on the "Conflicts" rail tab.
5. **Recalc furrow** — editing `Plots!F4`: G4 outlined at 0 ms, Analysis B2:B4 at 60 ms, C2:C4 at 120 ms; numerals count over 180 ms in their format; Analysis tab badge rises 3 → 6; all three bars move at 60 ms; Recalc status "Edit to Plots!F4 updated 7 cells on 2 sheets."; Changed cells lists 7 items.
6. **Season close** — cutoff typed `YYYY-MM-DD HH:MM` station time → "Cutoff set to <local time>."; the server locks within 5 s (sweeper every 1 s) and queues one "Season closed: <name>" mail per lead; Dana's late edit → "Edit to Plots!B2 was rolled back: the season is closed." and a `rejected` tray entry; "Reopen season…" with a later cutoff; Dana re-applies.
7. **Undo a bad paste** — Versions → "Restore version 1" → `alertdialog "Restore version 1?"` → Restore: saves `before_restore` (n+1), appends one restore op, records `restore` (n+2); notice "Restored version 1 as version 3." with "Undo restore" for 10 s → "Restore undone as version 5.". Snapshots at `stations/<sid>/workbooks/<wid>/versions/<n>.json`.
8. **Hand to the sponsor** — Export csv of Plots and xlsx; each becomes Ready after its file is stored under `stations/<sid>/exports/<eid>/<fileName>`, then one export-ready mail with `<origin>/api/exports/<eid>/download`; text starting with "=" gets a leading apostrophe in csv. Share 7 days → "Link created. It expires <local time>."; sponsor sees values, chart, no edit controls; revoke → "This link has expired or was turned off.".

## Palette (hex used by the build) — DESIGN.md is the full table

| Role | Hex | Source |
|---|---|---|
| paper ground | #F4EEDC | brief: Colour |
| raised paper | #FAF6EA | decided: layered paper, never white |
| sunk paper | #ECE4CC | decided: headers like a ruled margin |
| ink | #1C2620 | brief: Colour |
| ink muted | #4C574D | decided: AA secondary text |
| khaki rule / strong / clip | #CDBF98 / #8A7B50 / #A89766 | brief: Colour |
| graph minor / major | #E2D8BB / #D2C59F | brief: Graph paper |
| khaki fill | #D8CBA2 | brief: Colour (locked/archived chips) |
| rust / deep | #B4441C / #963614 | brief: Colour |
| field green / deep | #33743E / #285C31 | brief: Colour |

## Type, space, layout

- Space Grotesk 600 headings (h1 28.8, h2 24, h3 20, h4 16.8 — ratio 1.2), IBM Plex Sans 14/1.45 body, IBM Plex Mono tabular numerals right-aligned in cells; all bundled woff2. — brief: Type
- Grid rows 24 px, columns 96 px, row numbers 48 px; graph lines every 8 px with every fifth (40 px) darker. — brief: Density, Graph paper; decided: multiples of 8
- 1280×800: rail open beside the grid, 25 % (min 300 px). 768×1024: rail closed, overlay over the right 40 %. 375×812: top bar mark + station + "Menu"; format picker and Bold on their own line; row numbers and column A frozen; rail a bottom sheet ≤ 70 vh with grab handle. — brief: Layout by viewport
- Every button outside the grid ≥ 44 × 44 px; page never scrolls sideways. — brief: At every width

## Motion

One easing everywhere, `cubic-bezier(.2,.8,.2,1)`: a quick start that settles gently with no bounce. — brief: Motion and effects ("one easing everywhere"); decided: the curve

| Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| furrow outline | wave lands (depth 1 at 0, +60 per depth, ≥8 at 420 ms) | until fade | — | static outline 1.5 s, all at once |
| furrow count | wave lands | 180 ms | the one easing, cubic-bezier(.2,.8,.2,1) | value swaps at once |
| chart bars/points | source cell's wave | 180 ms | same | swap at once |
| outline fade | 600 ms after last wave | 600 ms | cubic-bezier(.2,.8,.2,1) | removed after 1.5 s |
| tab badge | each wave on that sheet | stepwise | — | final count at once; rail opens on Changed cells |
| rail / bottom sheet | toggle | 200 ms | cubic-bezier(.2,.8,.2,1) | 80 ms opacity |
| dialogs, Season menu | open/close | 160 ms | same | 80 ms opacity |
| toasts | notice | 200 ms in, visible 6 s (restore 10 s) | same | 80 ms opacity |
| hover/press | pointer | 100 ms | same | instant |
| rollback underline | conflict/rejection | 500 ms | same | static 500 ms |
| syncing bar | sync request in flight | 1200 ms sweep, repeats | same | hidden; text "Syncing <n> edits…" |

Furrow frames are timers scheduled up front at fixed offsets and drawn from their offset (`src/client/workbook/furrow.ts`), so they follow the page clock and never rely on a self-rescheduling loop. — decided

## States per async action

As the brief's Feedback states table: pending copy on the disabled button ("Signing in…", "Creating…", "Importing…", "Saving…", "Sending…", "Starting…", "Restoring…", "Re-applying…"), success through `status "Notices"`, field errors under the field in rust with an icon, outage copy for 503. — brief: Feedback states

## Breakpoints

≤ 599 px phone, 600–1099 px tablet, ≥ 1100 px desktop. — decided: brackets the three tested widths

## Media and licences

- Fonts: Space Grotesk, IBM Plex Sans, IBM Plex Mono 5.3.0 (Fontsource), OFL-1.1, latin woff2 in `app/src/client/fonts/`. — brief: Type
- Icons: Lucide geometry inlined, ISC. Product mark, favicon, plot and furrow drawings: original SVG. — decided
