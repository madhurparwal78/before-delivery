# TRUTH: Twinrow golden ground truth

Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys, end to end

1. **Rib swatch by keyboard** (brief: Journeys 1). Start: a signed-in designer opens a blank flat chart, 2 rows by 10 columns.
   Tab reaches the one cursor cell (row 1, column 1); arrows move it and stop at the edges (row 1 at the bottom). Letter keys
   place a symbol and move the cursor one cell in the row's reading direction (left on right-side rows, right on wrong-side rows).
   `status "Cell announcement"` reads `Placed Purl at row 3, column 5.` Each answer from the server carries the changed cells and
   every row's text, so cell and written line change in one render. End state: `list "Row errors"` reads `All rows check out.`;
   Postgres `cells` holds the rib with `rev` raised per edit; a reload shows the same chart and lines.
2. **Balancing a shaped chart** (brief: Journeys 2). Two designers open one chart. Removing a stitch gives both pages the same
   row error through Valkey channel `pattern:<id>`; `status "Row check"` reads it on both; fixing the row reads `Row 12 is correct.`
   and Publish then succeeds after a version is saved.
3. **Writing a row as text** (brief: Journeys 3). `Edit row <n>` opens `textbox "Row <n> instructions"` with the line. Enter applies:
   good text rewrites cells and returns in canonical form with `Row 3 updated: 4 cells changed.`, focus returns to the edit button
   and the changed cells flash. Bad text leaves the chart alone, sets `aria-invalid`, shows the exact error and puts the caret at the
   failing position. Pushed edits never touch the open box.
4. **Designing together** (brief: Journeys 4). Presence is the Valkey hash `presence:<id>`; `data-peer` marks a peer's cursor cell.
   Two edits with one `rev`: the first stands, the other gets `alert "Conflict"` for `NOTICE_SECONDS` and the server's value.
5. **Testing on two devices** (brief: Journeys 5). The invitation mail (Mailpit) carries one link to `/invite/<token>`. Joining lands
   on `/follow/<id>` at row 1 of the latest version. Steps use `counter:<pid>:<uid>` with a compare-and-set Lua script; both devices
   and the designer's `table "Testers"` update live.
6. **Notes and a new version** (brief: Journeys 6). A saved note reaches the designer live, adds `data-notes` and sends one mail
   `Note on row 5 of <pattern name>`. Saving a version shows `Version 3 is out. You are following version 2.` without changing row,
   chart or focus; `Move to version 3` keeps the row number or goes to the last row.
7. **Compare, restore, publish** (brief: Journeys 7). Compare shows the exact summary and marks `data-diff`. Restore makes a new
   version with the note `Restored from version <n>`, nothing is deleted. `/p/<id>` and the PDF carry no tester data.
8. **Valkey outage** (brief: Journeys 8). Health stays 200, `status "Live"` reads `Live updates are off. Your work is still saved.`,
   saves go to Postgres, the counter falls back to Postgres with the same from-row rule, other pages catch up on reload.

## Palette roles (hex used by the build)

ground #FFFFFF, surface #F8FAFD, ink #505C6E, line #E3EAF4 (decided: slightly darker than the seed so cell borders read),
accent #3D85C6 (borders and icons only), accent-strong #286090, on-accent #F4F6F9, active pill #E3EEFA, muted arrow #6F7F96,
danger #9B2C2C (decided: errors need an AA hue). Ten tiles: green #EAF2EC, rose #F6E4E2, tan #F3E8DF, butter #F5EFDC, blue #E6EEF5,
lilac #EEE8F3, sage #E9EFE0, pink #F6E4E8, teal #DFEFEB, periwinkle #E8E8F5 (brief: Visual design; seed tints).

## Type

Manrope for all text (400, 500, 600, 700), Open Sans 600 for the product name only; both self-hosted woff2, SIL OFL
(brief: Type). Body 16px; panel headings 1.4 x body (22.4px); lead line 18px semibold accent-strong; card labels 14px bold; tabular
figures everywhere (`font-variant-numeric: tabular-nums`). Sentence case only.

## Space and layout per viewport

Top bar 56px (decided: a little taller than a 44px target). `data-layout` is `desktop` from 1024, `tablet` 600-1023, `phone` below 600
(brief: Screens and layout). Desktop: rail 250px, chart and instructions side by side, eight side panels in two columns beneath. Tablet
and phone: `tablist "Pattern"` with Chart, Instructions, Testers; the stacked workspace nav follows the panel; cards in one column on phone.
Follow page: grid left and controls right on desktop; grid above a bottom-pinned dock on tablet and phone. Grid cells 32 x 32px,
the grid scrolls inside its own region; 44px minimum for every other control.

## Motion table

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| Twin lift (token, cells, row arrow) | pointer or focus, or a pin | instant | none | border, fill, arrow colour and pin stay; no 2px shift |
| Follow highlight band | counter change | `ROW_MOTION_MS` (200) | ease-out | jumps at once, no `data-motion` |
| Change flash | peer edit or applied text | 600ms | step tint | static outline 2000ms with `data-outline="static"` |
| Version notice | new version pushed | 250ms | ease-out | appears in place |

## States per async action

Create, Save version, Publish, Restore, Invite, Save note, Sign in: disabled with `aria-busy="true"` until the answer. Errors sit in the
named alert beside the field with `aria-invalid="true"`; a failed save reads `That change was not saved. Try again.` Loading pages read
`Loading...`; a failed data call reads `This page could not be loaded. Reload to try again.`; a page a person may not open shows
`heading "Not found."`.

## Media and licences

No photographs. Stitch glyphs are original SVG shapes (licence `original`). Navigation icons: lucide-react 0.577.0 (ISC), inlined.
Fonts: the npm packages @fontsource/manrope and @fontsource/open-sans 5.3.0 (SIL OFL), latin subsets imported by `styles.css` and
emitted by the build (brief: Server boundary, "served by the app from open-licensed packages"); no binary asset sits in `app/`, so `app/assets.json` is empty.
