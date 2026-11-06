# TRUTH — Fly Floor Co. Promptside (golden)

The brief made concrete. `brief:` = copied from instruction.md; `decided:` = the brief is silent.

## Journeys (ideal flow)

1. **Post-rehearsal triage** (brief: Journeys 1). Start: seed + pull (STG-61 door, STG-62 thunder, STG-63 chair; snapshot seq 1, triage 3).
   `/triage` → j/k to STG-62 → `a` → Accept dialog (Department prefilled Sound, No priority, No owner) → Priority High, Owner Kofi Mensah → Enter →
   button reads `Sending to intake` → intake record `accepted`, task `STG-62` → notice `STG-62 accepted into Rehearsal 1.`; triage 3→2,
   Backlog 8→9, Rehearsal 1 total 51→52 in one snapshot. `m` on STG-61 → Duplicate of STG-1 → `STG-61 merged into STG-1.` (record `merged`, task STG-1).
   `d` on STG-63 → reason → `STG-63 declined. Triage is clear.`; Cancelled +1; record `declined`, `decision_note` = reason; focus on
   heading `Triage is clear` with `Every request from the rehearsal room has an answer.`
2. **Notes session** (brief: Journeys 2). Focus a row, `x`, Shift+Down ×19 → `20 selected` → Ctrl+K → `Assign to Oren Vale` → Enter →
   one bulk call → rows show Oren Vale → `20 tasks assigned to Oren Vale.`; current row keeps focus. Ctrl+Z → `Undo restored 20 tasks.`
3. **Build queue** (brief: Journeys 3). As Devi Rangan, STG-12 → Status Done → `STG-12 moved to Done. STG-10 closed. 2 tasks freed.`;
   cascade STG-13 (depth 1, order 1, freed by STG-12), STG-14 (depth 2, order 2, freed by STG-10); blocked 7→5; Rehearsal 1 3→5 done.
4. **Focus notes and plot** (brief: Journeys 4). STG-21..32 selected, `2` → rows busy, toolbar `Saving` → one notice
   `Priority set to High on 12 tasks.` Attach a PDF (kind Plot) on STG-37 → `Uploading <name>` + Upload progress → object
   `tasks/STG-37/<uuid>/<name>` confirmed by HEAD, then row → listed with `Current` → `<name> attached to STG-37.`
5. **Last fitting** (brief: Journeys 5). Ruth marks STG-51 Done → STG-48 auto-closes (activity `auto_closed`, actor Promptside),
   STG-47 freed by STG-48; both tabs update via `/api/events` within 2 s.
6. **Tech table** (brief: Journeys 6). Phone: Departments drawer → Sound → tap STG-38 → full-screen sheet → Owner. Simultaneous laptop edit:
   one PATCH wins (If-Match), the other gets 412 with `current`; loser shows `STG-38 was changed by someone else. Showing the saved version.`
7. **Shared view** (brief: Journeys 7). `/tasks?dept=carpentry&blocked=1&group=cycle&row=STG-41`; each view change pushes history, row moves replace.
8. **Mistaken bulk move** (brief: Journeys 8). 15 carpentry notes → Move to Done → `15 tasks moved to Done. 2 tasks freed.` (STG-26 by STG-3,
   STG-46 by STG-6) → Ctrl+Z → `Undo restored 15 tasks. 2 tasks blocked again.`, reverse cascade, one `undo` activity per task.
9. **Director** (brief: Journeys, last paragraph). `/requests` → File a request (button `Filing` while pending) → `Request filed. It reaches triage within a few seconds.`
   → row Pending / `Awaiting triage` → after decision: Accepted / task id.

## Server truths

- Every change runs under one row lock on `sequence` (decided: serializes changes across processes sharing the database, so pulls
  and rollovers happen once and `seq` is gap-free); snapshot computed from the board read inside that transaction (brief: Snapshot).
- Events: `changes.event` + `pg_notify('promptside_change', seq)`; each process streams `event: change`, `id: <seq>`; `event: status`
  per process; a comment every 10 s (brief: at least every 15 s).
- Attachments are changes of kind `attachment` with an `attached` activity entry, and they add 1 to the task's version (brief: Versions,
  "Each change that touches a task adds 1"; Activity lists `attached`). So an upload after an edit makes that edit's undo stale (brief: Undo, Stale).
  The upload reply and the event carry the attachment in place of the task, so each tab reads the task back to learn its new version (decided).
- A PATCH that changes nothing: 200, `change` = last seq, `undoable:false`, task unchanged (brief: PATCH row "returns 200 with no new change").
- Undo `reblocked`: undone cascade reversed, filtered to tasks actually re-blocked; any other re-blocked tasks follow in number order (decided).
- Pull every 1.5 s (brief: at least every 5 s); rollover check every 1 s (brief: within 5 s); monitor every 5 s (brief).
- `GET /api/status` checks PocketBase and MinIO live on each request; the monitor and any failed provider call update what the process last saw, which drives the `status` event (brief: Outage detection, "A failed call also marks that service down at once"; decided: no status value is held before a live check has answered).
- Cycles live in the Postgres `cycles` table (key, name, position, starts_at, ends_at), written in the start-up migration transaction from the anchor recorded in `meta` (first start, first Monday); `tasks.cycle` references it (brief: Services, Postgres holds "cycles and their recorded start").
- Filing while the intake is down: 503 `intake_unavailable`; the dialog stays open with `Request intake is unreachable, so the request was not filed.` (decided: the brief gives no copy; it mirrors the decision copy).

## Palette (hex the build uses)

| Role | Hex | Source |
|---|---|---|
| paper ground | #F7F2E8 | brief: warm off-white; hex decided |
| surface | #FFFCF5 | decided |
| ink | #1E1A15 | brief: warm near-black |
| muted | #5C5347 | decided (6.7:1) |
| rule | #D8CDBB | brief: soft warm grey hairline |
| control edge | #857A68 | decided (3.7:1 for boundaries) |
| accent stage-green | #1E5B43 | brief |
| accent tint | #E1EDE4 | decided |
| alert brick | #9A2B1E | brief (Blocked, errors, outage banners only) |
| tapes | carpentry #F2CD4E, paint #9CC3EC, lighting #F3A867, sound #C9B0EE, wardrobe #F4B3CB, props #CFAB82 | brief: colours; hex decided |

## Type, space, layout

- Fraunces (headings, h1 24.9 / h2 20.7 / h3 17.3), IBM Plex Sans 14.4 body, IBM Plex Mono tabular numerals for ids, counts, dates (brief: Type).
- 4/8 px rhythm; rows 32 px with a mouse at ≥768, 44 px below 768 and on coarse pointers (brief: Density).
- ≥1200: rail 240 fixed, board four columns scrolling sideways inside their own area, pane docked 420 with properties and activity side by side.
  768–1199: rail 240, board one status-grouped list, pane overlays the right 420 with properties above activity. <768: Departments drawer,
  full-screen sheet, owner and priority hidden on rows (brief: Layout by width).
- Margin rule: 1 px rule at x = 20 px (12 px on phones) down every grid and list, ending at the last row; cue-line draws on it (brief: Prompt-book margin). The ruled-paper grain sits under list rows only (decided: empty paper below a short list must not read as empty rows).
- Header stays one line from 768 px (theatre name truncates first); the countdown is plain muted mono text, not boxed (decided: it is not a control).
- Tasks toolbar at 768 px and wider: New task, Undo and Commands sit right-aligned in the heading row (still inside `toolbar "Task tools"`), so the filters keep one line at 1280 (decided).
- Notices strip: bottom-left of the main column (rail width + 16 px) at 768 px and wider so it never covers the rail's `Working as`; full width on phones (decided).
- Detail Title is a one-line textarea that grows to the whole title; Enter saves (brief: "Text fields save when they lose focus or on Enter").
- Triage: a muted column caption row (Request, Requester, Department), hidden from assistive tech so the grid's rows stay the triage tasks; the current row shows Accept, Decline and Merge buttons that open the same dialogs as a, d and m and return focus to the row (decided: the decisions need a pointer path too).
- At 768 px and wider every row shows the id, department strip, title, status chip, Blocked chip when blocked, priority and owner's name (brief: Screens and layout, "Each row shows…"; tablet "list view is unchanged"), in a row about 32 px tall with a mouse (brief: Density). Board cards at ≥1200 show the same cells. When the list area is narrower than 880 px (pane docked at 1280, or a tablet), the row keeps every cell by stacking the id over the department strip and the priority over the owner in two 14 px tiers (decided: the brief's cells and its ~32 px rows both hold in a 528 px list area). Owner and priority are hidden on rows only below 768 px (brief: Layout by width).
- The phone sheet and Departments drawer are non-modal `<dialog>`s that cover the page themselves (full-screen sheet; drawer over a scrim) with their own focus trap, so they can slide out with the pane's 160 ms exit (decided: a modal dialog cannot animate its exit without leaving the page inert).

## Motion

| Element | Trigger | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| Detail pane | open / close | 240 in / 160 out | cubic-bezier(.2,.8,.2,1) / (.4,0,1,1) | appears/disappears in one frame |
| Sheet, drawer | open / close | 240 / 160 | same | one frame |
| Dialogs, palette | open | 160 fade + 6 px rise (they close in one frame: the brief times only their entrance) | cubic-bezier(.2,.8,.2,1) | one frame |
| Buttons, rows, links | hover / press | 120 background-color | ease | none |
| Status chip | status change | 160 opacity | ease-out | none |
| Cue-line | change with cascade | 60 ms per depth draw (scaleY) + 160 fade after 100 ms | linear / ease-in | no line |
| Freed row | reached | Blocked → `Freed by <id>` crossfade 250 | ease-out | same frame for all rows |
| Blocked digits | each reached row | 120 roll | ease-out | jump |
| Cycle progress | end of cascade | 250 scaleX, delayed by the cascade span | ease-out | jump |
| Reverse cascade | undo with `reblocked` | reached in `reblocked` order, step min(60, 480/n) | linear | one frame |

Everything finishes within 600 ms of the reply; nothing loops (brief: Motion and effects).

## States per async action

| Action | Pending | Success | Rejection |
|---|---|---|---|
| Field / keyboard edit | rows `aria-busy`, toolbar `Saving`, optimistic value | server values + one notice | saved value restored + one notice (brief copy) |
| Bulk | same for every row | one notice | `No tasks changed…` copy |
| Undo | toolbar `Saving` | `Undo restored…` | `Nothing to undo.` / `Undo stopped: a task changed after that edit.` |
| Triage decision | submit `Sending to intake`, disabled | decision copy (+ ` Triage is clear.`) | intake copy, task stays in triage |
| Upload | `Uploading <file>` + Upload progress | listed after 201, `<file> attached to <id>.` | storage / not attached copy |
| File a request | `Filing`, disabled | `Request filed…` | field errors / decided intake copy |
| Network failure | — | — | `Couldn't reach Promptside. Nothing was saved.` |

## Media and licences

Fonts: Fraunces, IBM Plex Sans, IBM Plex Mono woff2 from Fontsource 5.3.0, SIL OFL-1.1 (app/assets.json, THIRD_PARTY_NOTICES.md).
Favicon and inline SVG marks: original. No photographs or fetched images.
