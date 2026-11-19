# TRUTH

The golden's ground truth: what the finished app does, with where each value came from (`brief: <section>` copied verbatim, or `decided: <why>`).

## End-to-end flows

### 1. Build the week
- Start: Noor (coordinator) is signed in on `Weekly orders`, list view, one teammate has the same list open. (brief: Journeys 1)
- Actions: in the `Add task` row of a section Noor types `Order dry goods`, Enter, `Pack orders`, Enter, `Count freezer`, Enter. Focus stays in the row, the box empties after each, and the tasks appear in order. She focuses the first row's `Open Order dry goods`, presses Shift+ArrowDown twice (`List status`: `3 tasks selected`), opens `Set Tags for selection`, ticks `Fresh`, `Apply tags` (`Tags set on 3 tasks`, focus back on the button), then Ctrl+] on `Pack orders` (`Pack orders is now a subtask of Order dry goods`). (brief: Journeys 1, Interactions List)
- End state: postgres holds three tasks with `Tags = ["Fresh"]` and `Pack orders.parentId` set; the teammate's list shows the tasks, tag text and `aria-level` 2 without a reload (live NOTIFY, brief: DP-14).

### 2. Watch a rule fire
- Start: four chained rules (Ready to review, Review sets owner, Owner flags, High priority notice). (brief: Business rules, Worked chain)
- Action: Stage set to Ready (grid cell, detail or API).
- End state: `Rule runs` lists `Ready to review ran: moved to Review` (depth 1), `Review sets owner ran: assigned to Noor Halvorsen` (2), `Owner flags ran: set Priority to High` (3), `Stopped: chain depth limit 3 reached at High priority notice` (4), each indented 16 px per depth; the Cost formula column updates in the same event; a teammate's open panel receives the entries live and each slides in from 8 px over 160 ms. The pink-to-coral `Rule trace` line is drawn through the changed tasks.

### 3. Request to decision
- Start: a signed-out requester opens `/f/supply-request`. (brief: Journeys 3)
- Actions: submit empty; focus moves to the `There is a problem` summary with three links; each link focuses its field; fix and submit; the page reads `Request received. Your reference is REQ-0001.` The coordinator's list shows the task in place. Coordinator picks an approver and `Request approval`; the approver's inbox gains `Approval requested: <task>` with `Decide`; Decide dialog, `Approve`, `Submit decision`.
- End state: `approvals.status = approved`; requester's detail chip reads `Approved` in place; requester inbox gets `<approver> approved <task>`; `Approval status` reads `Decision saved: Approved`.

### 4. Keyboard and touch
- Board: Space picks up (`Picked up Order dry goods. To do, position 1 of 3.`), arrows announce `Order dry goods, Doing, position 1 of 2.`, Space drops and saves (`Dropped Order dry goods in Doing, position 2 of 2.`), Escape cancels. Timeline: arrows shift a bar a day (`Order dry goods moved to 2026-03-03 to 2026-03-05`), `d` then arrows then Enter links a blocker (`Order dry goods now blocks Pack orders`), the waiting bar shows `Starts before Order dry goods is due`. At 375x812: tabs switch views by arrow keys, a tapped card opens a bottom sheet, a touch drag crosses columns without scrolling.

### 5. Recurring work and the digest
- `POST /grading/clock` past a weekly task's due date creates exactly one successor (claim `successor:<task>`), announced `Weigh stock repeats on 2026-03-09` on every open list. A member with unread items in a finished window gets exactly one mail `Everyweek: <n> unread in your inbox` (claim `digest:<person>:<window end>`).

### 6. Two people, one task
- Focusing `Name` posts a hold; the other page shows `Being edited by <name>` and `aria-readonly="true"`. Saving releases it and the other detail shows the new name. A save from an old version answers 409 `stale_task`; the page opens `This task changed` (focus kept inside, `Load latest` or `Keep my edit`).

### 7. Goals and workload
- Changing `Suppliers confirmed` to 80 moves `Kitchen runs on time` to 76.25 (`76%`) and `Run a steady year` to 72.5 (`73%`) in another window; bars ease over 400 ms on the page clock. Workload cells show `5.8 of 4 h, over capacity` for Friday; reassigning `Pack orders` by dialog (R) or drag updates both windows (`Pack orders reassigned to Ilse Marchetti`).

### 8. Monthly report
- Attach file: object `attachments/<task>/<id>/<name>` in minio, size cap `EVERYWEEK_UPLOAD_MAX_BYTES`. Download project: job `preparing`, object written and confirmed, then `ready`; with the store unreachable: `failed`, `Download failed: file storage is unavailable. Nothing was saved.`, no link, dark outage band.

## Palette roles (hex used by the build)

ground #FFFFFF; ink #0D0D0D; panel #F3F3F3 (board columns; the `/goals` link card stack panel, brief: Goal link card stack "a light-grey panel"); panel-soft #FAFAFA (empty-state, loading and error panels); panel-dark #3F3F3F (step cards, showcase cards); muted #6B6B6B (secondary text); muted-on-dark #C4C4C4 (decided: AA on near-black); accent #FFC7F2 (current choice, dark text on it); coral #F95A4E (small marks, far end of the trace line); danger #B3261E (decided: AA red for error text); hairline #E5E5E5. (brief: Visual design, Palette by role)

## Type, space and layout

- Instrument Sans, shipped at `/fonts`: 500 for display with tight tracking, 400 for body; tabular figures on every count. Hero 64px, section headings 48px, working-screen h1 33px, h2 28px, h3 23px, h4 19px, body 16px, label 14px, fine 13px. (brief: Type; decided: one fifth up per level)
- Radii: 28px panels, 12px cards, 999px pills. Every control has a 44px tap area. Top bar 56px, the only sticky element, hairline shadow when scrolled. (brief: Shapes and density, Top bar)
- 375: links fold into `Menu`; panel collapsed and in flow above the view; tab list `Project views`; bottom sheet (88% height); board stacked; list rows wrap with Name on its own line; welcome collage first, chips scroll sideways. 768: panel collapsed; tabs; sheet from the right edge at 66% width; board two per row; workload scrolls sideways. 1280: panel open; chip row; docked detail; board side by side. Desktop begins at 1100px, phone ends at 639px. (brief: Screens and layout; decided: 1100px so no breakpoint changes a published viewport)

## Motion

| Element | Trigger | Duration | Easing | Reduced-motion substitute |
|---|---|---|---|---|
| card and bar move | drop, key move, remote move | `EVERYWEEK_MOVE_MS` (320) | cubic-bezier(0.2, 0, 0, 1) | `data-move-progress` 1.0000, settled at once |
| progress bar | goal value change | `EVERYWEEK_PROGRESS_MS` (400) | same | `data-shown-percent` is the new value |
| rule run entry | new entry | 160 | same, 8px slide | `data-slide-offset` 0.00 |
| formula cell | dependent value change | 240 | linear fade | settled at once |
| chips, hover, focus | interaction | 200 | ease-in-out | none |
| carousel, accordion, chevron | click | 320 | ease-in-out | jump |
| trace line | rule run | 250 | ease-out draw | drawn at once |
| collage swap | team-kind chip | 320, 12px shift | ease-in-out | instant swap |
| welcome sections | scroll into view | 400, 12px fade-up once | ease-out | visible |
| toast | action | in 200, lives `EVERYWEEK_TOAST_MS` (4000) | ease | instant |

All from brief: Motion and effects, or decided (named in DESIGN.md Motion).

## States per async action

- Sign-up/verify/sign-in/join: busy button (`aria-busy`), second activation ignored, `Account status` copy. Add task: input clears at once, order kept by a queue per section, `Couldn't save. Nothing changed.` on failure. Save name/description: stale dialog on 409 `stale_task`, hold note on `held_by_other`. Attach file: busy, alert `File is larger than 1 MB` or the storage message, dark band while storage is down. Download: `Preparing`, `Ready`, `Download failed: ...`. Loading: `Loading` then pill `Reload` after 5 seconds. Empty: large sentence on #FAFAFA with a pill.

## Breakpoints

375, 768, 1280 published viewports; layouts as above. (brief: Published viewports)

## Media and licences

Instrument Sans latin 400 and 500 woff2 (OFL-1.1, Fontsource, `assets.json`). Icons: Lucide path data inlined (ISC). Logo mark, collage, recipe glyphs, showcase mockups, empty motif: drawn in code (original). No raster, audio, video or model.
