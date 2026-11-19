# TRUTH — Slackwater Plan (golden)

Every value says where it came from: `brief: <section>` or `decided: <why>`.

## Journeys, end to end

1. **Build a plan from the list.** Start: owner signed in on an empty project, List view (brief: Journeys 1). Keys: Enter or a letter on `Add task` opens the Name editor; Enter creates a task (start = first working day on or after today, 1 day, 0%) and keeps the active cell on `Add task`; Shift+Enter creates a group; Duration then Enter; Predecessors `1FS+1` then Enter; Alt+ArrowDown moves a row, Alt+ArrowRight puts it in the nearest group above; a bad entry (`9`) keeps the editor open with `aria-invalid` and the page alert `There is no row 9.`, then a corrected entry saves. End: chart bars on computed dates, an editor's chart showed each row arrive (live-channel snapshot), a reload shows the same plan (Postgres). (brief: Interactions, Task list grid)
2. **Re-plan by pointer around a holiday.** Drag Review brief 64px: tip `Mon 8 Mar 2027 - Tue 9 Mar 2027`, drop announces `Review brief now starts Mon 8 Mar 2027 and ends Tue 9 Mar 2027.`; end handle +64px makes 3 working days over Founders Day; Escape cancels; Holidays dialog adds Quiet day (`Holiday Quiet day added. 2 tasks moved. Project finishes Thu 18 Mar 2027.`). (brief: Interactions, Pointer drag; Worked example 4)
3. **Keyboard re-plan and link.** Tab into the chart, ArrowRight/Left nudge one working day, Shift+Arrow resizes, L opens `Add link` (focus returns to the bar); a viewer hears `You can view this project but not change it.` and nothing is stored. (brief: Chart by keyboard)
4. **A supplier slips.** Draft brief moves three working days: dependents pushed, critical path now Draft brief, Review brief, Design pages, Sign-off, finish Wed 17 Mar 2027, variance `1 working day later than baseline`; moving back returns each to its chosen start and no earlier. (brief: Worked example 2)
5. **Phone progress.** Timeline cards; `Update progress for <item>` opens the sheet; slider by touch, pointer, keyboard in steps of 5; Save closes, focus returns to the button, card and group roll-up change, the laptop updates without a reload.
6. **Workload and notice.** Assigning Asha Rao 6 h/day to Write copy shows Tue 2 and Wed 3 Mar over-allocated in place; one email after `ASSIGN_NOTICE_DELAY_SECONDS` with subject `New assignment: <item> in <project>` and the task link; comments appear live in open dialogs.
7. **Two editors, one task.** `People here` lists both; the typing editor keeps text and focus when pushes arrive; saving gets `<name> changed <item> first. Your change was not saved.`, the dialog adopts the current values and version, the second save succeeds.
8. **Export.** Export menu (Enter, ArrowDown, Escape), `Preparing the CSV export.`, then link only after the object is confirmed in MinIO and the 201; listed after reload; storage down: 503 and `File storage is unavailable. Your export was not saved. Try again later.` with no link.

## Palette (brief: Visual design; hex decided to satisfy it)

ground #F4F5F3 (HSL 90 9% 96%), surface #E6E9E5 (105 8% 91%), week band #EDEFEB, ink #0E2218 (150 42% 9%), muted #56655B (140 8% 37%), accent #F5E642 (55 90% 61%). Contrast: ink/ground 15.2, muted/ground 5.6, muted/surface 5.0, ink/accent 12.9. Focus ring: 2px solid ink, 2px offset.

## Type, space, layout

STIX Two Text (latin 400, 500, 400 italic, self-hosted woff2), body 18px/1.5, headings 500, each level 1.25x; hero clamp(33px, 22px + 2.3vw, 52px). Rows 44px, day column 32px, radius 2px, edge 27% of the page width at every width, phone included (brief: Visual design, Composition). Phone below 768 (one column, Timeline cards, 44px targets), tablet 768 to 1279 (header stacked, People here under it, toolbar at most two rows, Gantt seam at 27%), desktop 1280+ (People here at the header's right end, toolbar one row, nine List and twelve Workload columns fit). (brief: Layouts by width)

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| moved bars (shown start changed, not the edited bar or groups) | an accepted edit's result arrives | 220ms (`KNOCK_ON_MS`) after 45ms (`KNOCK_ON_STAGGER_MS`) times depth (capped at 12) | cubic-bezier(0.2, 0, 0, 1), inline `translateX(<px>px)`, `data-motion="knock-on"` | no `data-motion`, no transform, final place on the first frame, thin underline on shifted bars |
| `#finish-marker` | when the last sliding bar stops | 320ms (`FINISH_MOTION_MS`) | same, `data-motion="finish"` | same |
| landing demo | `region "Demo plan"` first 60% visible, once | same | same | end state at once |

Everything else appears and disappears at once. (brief: Motion and effects)

## States per async action

Pending: control `disabled`, label unchanged, edited bar or row `aria-busy="true"`, nothing announced until the server answers. No answer or 5xx: `Your change could not be saved. Try again.` and the screen returns to the server's last state. Refusals: page or dialog `alert`, `aria-invalid` on the field; the alert stays until the next action. Conflict 409: `<name> changed <item> first...`. Viewer 403: `You can view this project but not change it.` Storage outage 503: the outage alert, no link, health still 200. (brief: Feedback states)

## Media and licences

No pictures. Mark, demo plan, pointer and favicon are drawn in SVG/CSS (`original`). STIX Two Text woff2 files (OFL-1.1, from `@fontsource/stix-two-text` 5.3.0) listed in `app/assets.json`. Shipped npm packages: pg and its dependencies, react, react-dom, scheduler (MIT/ISC), listed in `app/THIRD_PARTY_NOTICES.md`.

## Decisions where the brief is silent

Sign-up creates a personal workspace; the live channel is a WebSocket on the same origin at `/api/projects/<id>/live` (brief: API, live channel "Server-Sent Events or a WebSocket, your choice" carries presence and focus selection), and the browser sends its focus selection as a message on it, so there is no HTTP write for focus and every write by a viewer other than an export answers 403 `read_only`; `PATCH /api/items/<id>` answers an extra `constraint` key; mutating responses carry `x-project-rev` and snapshots carry `rev`; a task converted to a milestone keeps 100% or becomes 0%; milestone percent is validated against the item's current kind.
