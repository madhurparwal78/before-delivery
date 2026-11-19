# TRUTH

The golden's ground truth. Every value says `brief: <section>` (from `instruction.md`) or `decided: <why>`.

## Ideal flows

1. **Build by keyboard** (brief: Journeys 1, DP-01..07). Start: author opens `/edit/<slug>` of a draft. Tab reaches `Add step` (toolbar order: Add step, Undo, Redo, Save version, Versions, Choose a model file, Upload model, Co-authors, Publish, Withdraw, Delete guide). Enter adds step 6, focus lands in `Step 6 title`, `Editor status` says `Step 6 added.`. Text and number fields commit 250 ms after the last keystroke, sliders/checkboxes/selects on the same delay; the stage applies an edit exactly at 250 ms with no tween. Ctrl/Cmd+S saves a version (`Saved as version 2.`), `Latest version 2` appears in every open tab live. Alt+ArrowUp/Down moves the focused step (`Step 6 moved to position 5.`). The `Resize stage and steps` separator takes ArrowLeft/Right (-5/+5), Home 30, End 70 (range 30-70, start 50). Provider end state: Postgres working copy and versions rows.
2. **Change your mind** (DP-08..14). Ctrl+Z / Ctrl+Shift+Z undo and redo only the signed-in person's own edits of this open page (text, step move, step add, step delete); a field a co-author changed since gives `Cannot undo: <name> has changed this since.`; empty stacks give `Nothing to undo.` / `Nothing to redo.`. Ctrl+S then stores exactly the undone state.
3. **Read a repair** (DP-15..19). The window scrolls: header section, one section per step, closing section, each one viewport tall (page height = H x (steps + 2)). Step n is current for y in [nH, (n+1)H); pose moves linearly through 35%-65% of the section; the settled position is y = (n + 0.65) H; the parts cost counts 640 ms; header figures count 800 ms. Closing total on post red.
4. **Share a step** (DP-25..30). `?step=n` opens settled with no tween; scroll replaces the address, buttons and links push history; a step past the end opens the last step with `This guide has <total> steps. Showing step <total>.`; signed-out Ask/Like/Fork/Add go to `/signin?next=<local path>` and come back; a non-local `next` lands on `/dashboard`.
5. **Reduced motion / no WebGL** (DP-32..38). Buttons replace scrolling, pose and figures are final at once; without WebGL `data-state="still"`, an image `<title>, step <n> still` drawn by the server (`/api/guides/<id>/stills/<n>`) and the still-fallback copy.
6. **Phone** (DP-39..45). Stage top 40%, `Stage status` and numbered `Parts` list below, step panel, bar fixed at the bottom; `Free look` (off on every load) enables one-finger orbit (1 degree per 2 px) and pinch zoom; vertical drag scrolls the page otherwise. Editor tabs `Stage`, `Steps`, `Parts`, one pane visible, others hidden.
7. **Bring a model** (DP-46..52). Drop or `Choose a model file` -> browser checks (shared `.glb` module, `/api/limits`) -> preview with no request (`data-state="preview"`) -> `Upload model` (XHR, `Uploading <file>: <percent>%.`) -> server checks, MinIO PUT confirmed by length and SHA-256 at `models/<modelId>.glb` -> `<file> is stored. <size> bytes confirmed.`. Refusals name the reason; storage outage shows the author copy and 503.
8. **Go back safely** (DP-54..60). `Versions` toggles a non-modal region; Space picks (third drops the earliest), `Compare` shows two butted fields with word and side-bar marks; `Restore version n` dialog appends a new version with `restored_from`; a second tab updates live.
9. **Adapt someone's guide** (DP-62..68). `Fork guide` dialog -> `Fork version <n>` -> own public draft titled `<title> (fork)` with the pinned version as version 1 and the credit `Forked from <title> by <author name>, version <n>.`.
10. **Edit together** (DP-69..75). One WebSocket per page (`/api/live`); `People editing` shows `<name>, step <n>`; different fields merge; same-field conflict opens the `Edit conflict` alertdialog (`Keep mine` / `Take theirs`); stale saves answer 409 and open the compare.
11. **Ask and answer** (DP-76..82). Unconfirmed accounts get the refusal copy and `Resend confirmation`; the message from Mailpit carries `<APP_PUBLIC_URL>/confirm?token=<token>`; questions and answers arrive live; limits answer 429 with `Retry-After`.
12. **Find a guide** (DP-83..90). `/search` updates in place 250 ms after the last key and replaces the address; tags by keyboard; `Load more` continues from an opaque cursor; collections reorder with Alt+Arrow; likes count once and live.
13. **Embed** (DP-91..97). `/embed/<slug>?step=n` settled and read-only, no cookie, `frame-ancestors *`; `Workshop sound` creates nothing until pressed, then one looping generated buffer source through one master gain at 0.25 (0 when off); `sound=off` hides it.

## Palette (brief: Colour roles, Guide phases; hex decided in DESIGN.md)

bone `#EFE6D4` (ground), surface `#E1D4BB`, older compare `#D6C7A8`, ink `#1F150C`, muted `#65503F`, slate `#3D5A7C` (accent, white on it), post red `#C9301F`, mustard `#E3A82B`, maroon `#5A1523`. Phases: Open up red/white, Take out bone/ink, Fit new mustard/ink, Close up slate/white, Test it maroon/white, Closing total red/white. All text pairs meet WCAG 2.2 AA (checked in DESIGN.md).

## Type, space, layout

Dela Gothic One (display) and DM Sans (body, tabular numerals), bundled woff2 (brief: Type). Body 16 px minimum; each heading level a quarter larger than the one below (app chain 25/31.25/39 px; chapter chain clamp(32px,7vw,100px) x 1.25 per level). Square corners everywhere, 2 px outlines on form cells, no shadows or gradients, targets at least 44 px. Layouts (brief: Screens and layout): desktop from 1200 (steps column left, stage from 42% full height, reader bar atop the column), tablet 768-1199 (stage 46% top, panel below, bar fixed bottom), phone below 768 (stage 40%).

## Motion (brief: Motion and effects; all on one rAF frame loop)

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| camera and offsets | step button, key, link, Back | 320 ms | ease-out | snap, final next frame |
| editor apply | edit of apart amount, parts, pose | 250 ms delay | none | same |
| callouts | pose reaches band end / step leaves | 180 ms | ease-out | at once |
| `parts-cost` | current step changes | 640 ms | ease-out | final at once |
| header `total-cost`, `part-count`, `step-count` | first render without `?step` | 800 ms | ease-out | final at once |
| buttons | hover, press | immediate | none | same |

## States per async action

Stage: loading `Loading the model.`, ready, preview, error band (storage out, retry every 5 s), still. Upload: `Uploading <file>: 0%.` rising, stored, refusal, outage. Commit: optimistic local apply, refusal reverts and keeps the typed text, `Your last change was not saved. Try again.`. Search: `Searching.`, count, none, limits. Ask: sending, refusal, rate limit with seconds. Sign-in/up/confirm: Account status copies (brief: Feedback states).

## Breakpoints

375x812, 768x1024, 1280x800 (brief: Screens and layout); thresholds 768 and 1200.

## Media

Sample models generated by the build from solids (original); step stills drawn by the server (original); fonts OFL-1.1; Lucide ISC icons inlined; sound generated in the browser (original). No fetched photos or files.
