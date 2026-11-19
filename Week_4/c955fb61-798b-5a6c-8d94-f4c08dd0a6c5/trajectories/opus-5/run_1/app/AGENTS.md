# Slackwater Plan — repository notes

A Gantt-chart planner. TypeScript on Node 22, no framework. Three backing services only:
Postgres (every record), MinIO (stored exports), Mailpit (assignment notices).

## Layout

- `src/shared` — code both sides use: date arithmetic (`dates.ts`), the working-day calendar
  (`calendar.ts`), the published copy (`copy.ts`), predecessor canonical text, API types.
- `src/server/domain` — the domain rules, each decided in exactly one place:
  - `schedule.ts` forward pass, backward pass, total float, critical path, group rollup, late flag,
    baseline variance;
  - `predecessors.ts` the Predecessors cell grammar and its first-failure order;
  - `loops.ts` the loop path (fewest links, then lowest row numbers).
- `src/server/api` — the router (`index.ts`), the per-project edit engine (`engine.ts`), the
  workload figures, the grading setup route, baseline persistence.
- `src/server` — `http.ts` (error precedence and body limits), `repo.ts` (project read model and
  row flattening), `live.ts` (WebSocket channel and presence), `storage.ts` (hand-rolled S3 SigV4),
  `mail.ts` (hand-rolled SMTP plus the Postgres notice queue), `exports/` (CSV and PDF writers).
- `src/client` — `state.ts`, `actions.ts` (every write, with a per-item edit queue),
  `project.ts` (page shell and live channel), `gantt.ts`, `list.ts`, `workload.ts`, `dialogs.ts`,
  `motion.ts` (the knock-on), `pages.ts`, `app.css`.

## Rules worth remembering

- The browser never computes dates. Its only exception is the snapped preview in the drag tip and
  the in-flight bar, which uses the shared `Calendar`.
- Working-day numbers: `W(x)` is the count of working days strictly before `x`. A task has
  `S = W(start)`, `F = S + duration`; a milestone has `S = F = W(date) + 1`.
- An item stores a chosen start. The shown start is the latest of that and every link bound, so
  moving a predecessor back lets dependents return no earlier than their own chosen start.
- Item versions rise on name, chosen start, duration, percent, group, assignee and incoming-link
  edits. Being pushed by a link, a holiday or a reorder does not change them.
- Row order is derived from `items.position`: top-level units by position, each group immediately
  followed by its own children by position.
- `renderView` in `project.ts` keeps focus and scroll across every redraw. Grid cells carry
  `data-focus-key="cell:<row>:<column>"`, bars `bar:<id>`; the active-cell keys are remapped so
  focus follows a moved item rather than a node.
- The Task list cell editor lives in `state.editing` so a pushed change cannot close it.
- Presence selection is sent over the live channel. `focusout` only clears the mark on the next
  macrotask, because a redraw briefly takes the focused bar out of the page.

## Local checking

- `sh scripts/restart.sh` rebuilds, drops and recreates the dev schema, restarts the app on 4173
  and seeds the published example data into `/tmp/setup.json`.
- `python3 scripts/verify.py` checks every worked example and the API error precedence.
- `scripts/seed.json` is the published seed data in the shape the grading setup route takes.
