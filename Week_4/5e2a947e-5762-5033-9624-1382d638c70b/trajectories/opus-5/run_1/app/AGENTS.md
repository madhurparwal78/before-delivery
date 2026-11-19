# Sprigmap

Real-time collaborative mind-mapping and visual-outlining web app. One TypeScript
project: a Node 22 server and a browser client, PostgreSQL and an S3-compatible
object store.

## Running it

```
npm ci          # install
npm run build   # bundles the server to dist/server.js and the client to dist/public
node dist/server.js
```

`/app/run.json` carries those three commands. The server binds `0.0.0.0` on
`APP_PUBLIC_PORT` (4173 by default) and answers `GET /api/health`.

Useful during development:

- `npm run check` — `tsc --noEmit` over `src` (strict, no `any`).
- The database schema in `src/server/schema.sql` is applied idempotently on every
  boot. It is not migration-safe: change a table's shape and the dev database
  needs `drop schema public cascade; create schema public;`.

## Shape of the code

```
src/shared/   domain rules used by both sides
  layout.ts      the layout engine (mind map, org chart, list, floating topics)
  ops.ts         the operation engine: validation, apply, inverse, conflicts
  titlemerge.ts  the title transform and caret rules
  derive.ts      rollups, earliest due dates, blocked counts
  style.ts       colour and shape cascade, the luminance rule
  permissions.ts the permission table
  outline.ts     the Sprig outline format, both ways
  notes.ts       the markdown subset and link schemes
  labels.ts      the tree label grammar and ARIA values
  diff.ts        version diff by id
  states.ts      presentation, share link and export state machines
  errors.ts      error codes, statuses and the one precedence order
  copy.ts        every published sentence
src/server/   http router, storage (hand-rolled SigV4), live sockets, ticker, routes
src/client/   router, pages and the editor (state, view, actions, input, panels)
```

Each domain rule lives in exactly one place and is shared. The client applies
operations optimistically with the same `applyGroup` the server uses, and
re-syncs whenever the server reports a merge, a rejection or a recovered edit.

## Things that were easy to get wrong

- **The canvas must never scroll.** A screen point is `map point x zoom + pan`,
  so `.canvas` resets `scrollLeft`/`scrollTop` and every `focus()` inside the map
  passes `{ preventScroll: true }`. Focusing a topic outside the view otherwise
  scrolls the overflow container and every published coordinate drifts.
- **Re-rendering must not move focused nodes.** The canvas and the outline keep
  one element per topic, update it in place and only reorder nodes that are out
  of order; moving a focused node blurs it and kills an open title input.
- **Ops inside one group may reference topics the group creates** (graft, paste,
  restore), so the missing-topic check tracks ids made earlier in the group.
- **A slide keeps its place when its topic is deleted**; it is skipped, not
  dropped from `doc.slides`.
- **Deleting a branch keeps every link touching it** in the branch snapshot, so
  undo brings cross-links back even when the other end sits outside the branch.
- Comments are keyed `(map_id, id)` because seeded ids such as `c1` repeat
  between maps and the grading seed runs many times.

## State

One map is one JSONB document (`maps.doc`) holding topics, children order,
links, boundaries, slides, layout, theme, applied title edits, tombstones and
who last touched each topic. Everything else (comments, votes, mentions,
versions, share links, presentations, export jobs, attachment records, undo and
redo stacks, per-person collapse, recovered edits, clipboards) has its own table.
Operations are applied inside a transaction that locks the map row, so the server
order is the only order.
