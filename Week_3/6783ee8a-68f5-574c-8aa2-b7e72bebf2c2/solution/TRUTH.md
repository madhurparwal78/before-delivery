# TRUTH: Brackenpad golden

Every value says where it came from: `brief: <section>` (verbatim) or `decided: <why>`.

## Journeys (ideal end-to-end flow)

1. **Build from the keyboard.** Start: owner signed in, notebook with one empty code cell, command mode, first cell selected (brief: Interactions/Modes). B inserts below and selects it, Enter enters edit mode ("Edit mode" announced in "Notebook status"), Escape returns ("Command mode"), A inserts above, M/Y retype, D,D deletes (second D within `double_press_ms` of the first, exactly that many counts), Z restores the last deletion of this tab with ids, types, sources, outputs at their positions; a second Z does nothing. Autosave sends retypes and text after `autosave_ms`; server holds the same cells (brief: Journeys 1, DP-11).
2. **Run together.** Shift+Enter, Ctrl+Enter, Alt+Enter run the cell (queue, start, result per run on the server). The kernel is one Web Worker per tab. Every open screen gets counts, outputs, kernel status and "Cell <n> ran as [<N>]" through the live stream without reloading (DP-14).
3. **Runaway code.** An endless loop stops at `exec_limit_ms` on the page clock: cell `interrupted`, error output "Execution time limit reached (<s> s)", kernel Interrupted. I,I interrupts at once ("Run interrupted"). Variables survive because loops carry a guard that reads a shared flag. 0,0 opens "Restart kernel?"; Restart starts a new worker (variables gone, outputs stay), status Restarting then Idle (DP-19/20).
4. **Prose.** Markdown cells render headings, tables, math (MathML, TeX kept as annotation), allowlisted raw HTML and links (brief: Markdown). The table of contents renumbers live; activating an entry selects the cell, scrolls, enters command mode and focuses it (DP-21..23).
5. **Conflict without loss.** Every save carries the base revision; a stale save answers 409 and opens "Notebook changed elsewhere" with focus inside; Escape does not close it; "Reload latest" shows the other tab's text, "Keep my version" saves again against current revisions (DP-28/29).
6. **Checkpoints.** Ctrl+S: "Saving checkpoint…" until MinIO confirms, then "Checkpoint saved". Compare pairs cells by id with tags and counts; Revert stores "Before revert" first, then restores; the other screen shows the cells live (DP-30..33).
7. **Import and export.** Over-limit body: 413 before any parse; malformed: 422 with every error at its JSON path; good file: imported with outputs kept as given; Download original returns the exact bytes; export reads back (DP-34..36).
8. **Share, phone, outage.** Invitation mail through Mailpit, `/invite/<token>`, phone layout under 768 px with the Contents drawer and Cell actions sheet; storage outage keeps edits in the page, banner shown, saves retry every 5 s; search finds the notebook (DP-37..45).

## Palette (hex used by the build)

ground #ffffff, surface #f5f5f5, band edge #e0e0e0, ink #333333, muted line #9e9e9e (brief), muted text #666666 (decided: AA), accent #b84a14 / edge #9c3d0f / hover #9a3f0e (decided: AA with white, same hue as the brief's orange), footer submit #d8601f (brief: brighter orange, AA as large text), disc #737373, footer #616161 over #4e4e4e (brief), wordmark grey #6f6f6f (decided: AA).

## Type, space, layout

Source Sans 3 semibold headings; Inter body, italic dates, bold footer heads and submit; Fira Code only in code cells and code output; counts tabular Inter in muted grey (brief: Type). Container 1140 px, 12-column feel, 15 px gutters; bands padded 5 rem (3 rem phone) (brief: Composition, Density). Below 768 px: one column, "Open menu", Contents drawer, Cell actions sheet; 768 px and above: wide layout with the contents column about a third at 768 and a quarter at 1280; comparison 50/50 from 1280 (brief: Screens and layout).

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| hero mark | load, once | 1000 ms | ease-in | none, full opacity (brief) |
| buttons, cards, windows | hover/press | 50 ms | ease | 0 |
| header links | hover | 150 ms | linear | 0 |
| menus, phone menu | open | 350 ms | ease | none |
| cell insert, delete | change | 200 ms | ease | none |
| cell move | change | 200 ms (WAAPI) | ease | none |
| sheet, drawer | open | 200 ms | ease | none |
| diptych slide, fade | Compare, close | 340 ms | ease | none |

## States per async action

Save: "Unsaved changes", "Saving…", "All changes saved", "Saving paused: storage unavailable" plus the outage banner and a 5 s retry. Checkpoint: "Saving checkpoint…", "Checkpoint saved", "Checkpoint not saved: storage unavailable". Import: "Importing…", 413 alert, 422 list, 503 copy. Share: "Sending invitation…", "Invitation sent to <email>", "<email> already has access", "Invitation not sent: email is unavailable". Search: debounce 500 ms, "<N> notebooks found", "No notebooks match “<q>”.", "Search is unavailable" (brief: Feedback states).

## Decided where the brief is silent

- The kernel is interrupted through a SharedArrayBuffer flag (page is cross-origin isolated); the kernel status stays "Kernel interrupted" until the next run (decided: legal move Interrupted -> Busy).
- A seeded, imported or reverted cell has run state `finished` when it has a count, `failed` with an error output, else `idle` (decided).
- Viewers get Export, Checkpoints (read and compare) and Download original; no run, save or revert controls (decided: roles paragraph).
- Landing menu items and footer links scroll to existing sections or open mail; no extra screens (decided: scope).

## Media and licences

All art is drawn inline (SVG/CSS). Fonts Source Sans 3, Inter, Fira Code: OFL-1.1, self-hosted. Icons: Lucide, ISC. Packages: see `app/THIRD_PARTY_NOTICES.md`, `app/assets.json`.
