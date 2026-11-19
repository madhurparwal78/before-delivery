# TRUTH — Tallyframe golden

Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys, ideal flow

1. **Owner sets up a ledger** (brief: Journeys 1). Documents list at 1280 → New document → name →
   Create document (busy, address unchanged) → 201 → address `/d/<id>`, empty-document copy
   `This document has no tables yet.`, focus on Create first table, `Created document <name>.` once.
   Create first table → New table dialog → Items → `/d/<id>/t/<table>`, `This table has no rows yet.`,
   focus Add row, `Created table Items.` once. Add column Name (Text) and Cost (Decimal), each
   `Added column <name>.`; Add row twice, type values, Tab/Enter commit. Add column Formula
   `[Cost] * 2` — preview `Result: 4.0000` on each keystroke. New summary (Items, group Name, Sum of
   Cost) → summary address, focus in its grid, `Created summary Items by Name.`. Cost options →
   Rename column → Unit Cost: the formula becomes `[Unit Cost] * 2`, summary column `Sum of Unit Cost`.
   Rename table → Stock_Items: summary `Stock_Items by Name`. Undo twice restores every text. At 375
   Add column is a full-height sheet (0,0,375,812) sliding up 200 ms (`data-entering`), a 64-character
   name wraps, Notes is announced each time; with reduced motion the sheet appears in place.
   Provider record: Postgres `history` rows `table_add`, `column_add`…, `column_update`, `table_rename`, `undo`, `undo`.
2. **Editor enters orders** (brief: Journeys 2). Add row (keyboard) → new row's first cell active;
   type, Tab, pickers (`Moss` → Moss Street Bakery), Enter on the last row stays. Shift+Arrow range,
   Ctrl+C → clipboard `4.0000\r\n2.0000\r\n10.0000`, `Copied 3 cells.`; Delete clears as one
   `cell_batch`; Ctrl+Z restores. Paste of three quantities: one roll, one undo entry. A slow
   answer keeps its cell muted + `aria-busy`, later commits go at once, answers apply in send order
   and only the newest-sent success rolls and announces. A lost answer is resent once with the same
   Idempotency-Key and replays (history +1). A dropped connection reverts with
   `Could not reach Tallyframe. Your last change was not saved.`.
3. **Conflicts** (brief: Journeys 3; Business rules: Races). Stale cell → 409, cell shows current,
   notice `Someone else changed this cell. It now shows <current>. Your edit was not saved.`; stale
   row delete → row back + `Someone else changed this row first. It was not deleted.`; formula bar vs
   dialog and rename vs formula → column 409, bar/dialog refilled, `Someone else changed this column first. Your change was not saved.`.
4. **Delete and restore a product** (brief: Journeys 4). Delete row removes at once; status
   `Deleted row Oak Shelf Bracket.` + Undo delete for 8 s unpaused; Orders show `#REF!`, picker drops
   the product, rail `Products, 3 rows`. Double Undo: first restores (list of 8 cells), second
   answers `Nothing to undo.`; Undo disabled. At 375 a 500 ms press on a card heading opens
   `Row actions for <row>`; Undo delete restores the card and focuses its heading, `Restored row <row>.` once.
5. **Share and resend** (brief: Journeys 5). An address with a line break → 422, field message,
   `aria-invalid`, nothing sent. During a mail outage the share is saved Not sent, banner
   `Invite not sent: the mail server is unreachable. The share is saved. Press Resend when mail is back.`;
   a cross-site Resend → 403. Resend → `Invite sent to <email>.`, banner gone. Mailpit: exactly one
   message, To the one address, Subject `Mara Lindqvist shared <name> with you` (RFC 2047 when not ASCII).
6. **Export for the accountant** (brief: Journeys 6). Export CSV → `Writing Customers.csv` + 1.2 s
   cobalt sweep → `Customers.csv is ready.` + `Download Customers.csv`. MinIO object
   `exports/<doc>/<export>.csv`, size and SHA-256 read back. Download serves the stored bytes after
   re-verifying them (`Customers.csv downloaded.`); later edits never change it; a damaged object
   answers 502 → `This file no longer matches what was exported. Export again.`; storage down → export
   `failed`, `Export failed: the file could not be stored. Your edits are safe. Try again later.`.
7. **Viewer reads and downloads** (brief: Journeys 7). Signed-out link → `/sign-in?next=<path>` →
   back to the path, focus on the active cell, grid `aria-readonly="true"`, every write attempt
   announces `You can view this document but not change it.`; sign out → `/sign-in`, focus Email;
   Back → session check → sign-in again, no row data shown.
8. **Editor counts stock on a phone** (brief: Journeys 8). Drawer switch, card Save, restricted
   totals (`Recalculated 1 cell in 1 table.`), scope widened on the next read, narrowed: 404 →
   re-read, `2 rows are no longer shown to you.`, focus first card heading; role → Viewer: 403 →
   `You no longer have permission to change this document.`, cards read-only, late success still
   applies its value; Editor again → controls return on the next read.

## Palette (decided values in the brief's roles; see DESIGN.md)

| Role | Hex | Source |
|---|---|---|
| paper ground | `#F6F1E6` | brief: warm paper off-white; hex decided |
| raised paper | `#FBF8F1` | decided: surfaces separate by tone, no shadows |
| ink | `#1C1A16` | brief: near-black ink |
| muted / pending | `#5E584D` (6.3:1 on ground) | brief: grey meets 4.5:1 |
| rule | `#D8CEBB`; strong `#B9AD95` | brief: warm grey-beige hairlines |
| cobalt | `#1F48C6` | brief: single cobalt accent |
| vermilion | `#B3361C` | brief: burnt vermilion errors |

## Type, space and layout

- Instrument Serif headings (h1 24.5 / h2 20.4 / h3 17 px: each ~1.2×), IBM Plex Sans 14 px body,
  IBM Plex Mono for numbers, right-aligned so points line up (brief: Visual design).
- Grid row 28 px, 4 px spacing unit, 2 px radius, 1 px hairlines, 2 px focus outline (decided: compact; brief: ≥2 px focus).
- 1280: rail ~1/6, pinned formula bar, grid with sticky header row and first column, status bar.
  768: Tables toggle, rail absent from the page while collapsed, Edit formula dialog.
  375: record cards, Tables drawer from the left, full-height sheets, ≥44 px targets, 48 px inside sheets and the drawer
  (brief: Screens and layout; 48 decided: sliding surfaces measure a hair under their size mid-transform).

## Motion

| Element | Trigger | Duration | Easing | Reduced motion | Source |
|---|---|---|---|---|---|
| changed cell roll | commit applied | start depth×60 ms, roll 220 ms | cubic-bezier(.2,.8,.2,1) | instant, static 2 px bar | brief |
| error stamp | error result | 120 ms, scale 1.08→1 | same | instant | brief |
| text/date/bool crossfade | commit | 220 ms | same | instant | brief |
| status tally | commit | min(600, last start + 220) ms | linear steps | sentence at once | brief |
| dialogs, menus, deleted-row strip | open/close | 140 ms fade | same | none | brief |
| sheet | open at 375 | 200 ms slide up, `data-entering` | same | in place, no attribute | brief |
| drawer | open at 375 | 220 ms slide | same | none | brief |
| leaving card | delete at 375 | 200 ms fold, `data-leaving` | same | removed in the same frame | brief |
| export progress | Export CSV | 1.2 s sweep then holds | same | full and still, `data-motion="static"` | brief |

## States per async action

| Action | Pending | Success | Refused / failed |
|---|---|---|---|
| sign in | button busy + disabled | lands on `next` or `/` | 401 copy in alert |
| commit | value muted, `aria-busy`, status `Saving changes` | stored display, roll, tally, sentence | 409 conflict copy; 422 field message + editor reopens; 403 permission copy + read-only; 404 re-read; network/5xx connection copy after one resend |
| create document/table/summary/column | main button busy + disabled, address unchanged | address + focus + creation copy | 422 field messages, focus first invalid |
| share | Send invite busy | `Invite sent to <email>.` or outage banner | field message under Email |
| export | `Writing <file>` + progress | `<file> is ready.` + link | failed copy, no link |
| download | — | `<file> downloaded.` | not ready / store unreachable / refused copy |

## Breakpoints

`< 768` phone, `768–1279` tablet, `≥ 1280` desktop (brief: Screens and layout).

## Media and licences

Lucide icons (ISC, bundled SVG); Instrument Serif, IBM Plex Sans, IBM Plex Mono WOFF2 (OFL-1.1),
vendored in `app/src/client/fonts`, listed in `app/assets.json`. No images, audio or video (decided:
the ledger itself is the look).

## Decided where the brief is silent

- Summary group row ids are derived from (summary id, key), so they are stable across appearance,
  disappearance and views (decided: the brief requires stability per key; deriving needs no write on read).
- The column dependency graph is derived from the stored formulas on every request rather than
  stored separately (decided: derived values computed at read time cannot drift from the formulas).
- Once any commit has succeeded, the status bar's tally and sentence are those of the newest-sent
  successful commit, and a 409, 422, 403, 404 or failure never replaces them: when the refused or
  failed commit's `Saving changes` clears, the strip shows that commit's sentence again (brief:
  Interactions, Send order and the one resend: "A 409 or a failure never replaces them").
- Before any commit on the page has succeeded there is no sentence to show, so the strip reads
  `All changes saved.` when the page opens and again after a 422 refusal (nothing was unsaved);
  after any other miss before a first success it is empty (decided: the brief is silent on the
  strip before a first success; an empty strip read as unfinished, and "saved" must never follow a
  lost change).
- Grid columns are sized from their header and longest display (floor 88 px, per-type cap 96–220 px),
  so the seven seed Orders columns fit at 1280; an overflowing grid shows a hairline fade at its right
  edge, and the row rules stop after the last row, leaving plain raised paper below (ruled-paper
  texture is for empty states only, DESIGN.md Finish) (decided: brief Visual design, a paper ledger with hairline-ruled rows).
- At 375, sheet actions are full-width, primary first, pinned to the sheet's foot above a hairline when
  they end the sheet; radio groups are a two-column grid of 48 px rows; at 768 and 1280 a group of more than three radios is a three-column grid (decided: brief Visual design, Touch).
- Undo applicability uses the token of the change that last set each record (decided: matches the
  brief's 13 → 14 → Undo → Undo example, where revision equality alone would refuse the second undo).
