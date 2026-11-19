# Linewell

A browser diagram editor for small groups who draw together: TypeScript on both sides,
Postgres for the source of truth, MinIO for rendered exports, Mailpit for invite and
mention email.

## Running it

```
npm ci && npm run build && npm run start      # the three commands in run.json
```

The server binds `0.0.0.0:4173` (or `APP_PUBLIC_PORT`). HTTP and the live socket share
that port. `GET /api/health` answers `{"status":"ok"}` even when MinIO or Mailpit is away.
Every service address and credential comes from the environment (see `src/server/env.ts`)
and never reaches the browser bundle.

`npx tsc --noEmit` typechecks everything; `npm run build` bundles the server and client
with esbuild and copies the self-hosted fonts.

## Where each domain rule lives

Each rule is decided in exactly one place, and the server and the browser share it.

| Rule | File |
| --- | --- |
| Document shape, ids, reading order, layer visibility | `src/shared/document.ts` |
| Ports, default port pair, snapping, resize anchoring, insertion position, align and distribute units, connector label placement | `src/shared/geometry.ts` |
| Router rules 1 to 7, the rerouted list | `src/shared/router.ts` |
| Operation kinds and the published-keys rule | `src/shared/operation.ts` |
| Text safety and field validation | `src/shared/validate.ts` |
| Every published string | `src/shared/copy.ts` |
| Outline tree texts and structure | `src/shared/outline.ts` |
| Applying an operation and its inverse | `src/shared/engine.ts` |
| Error shape and precedence | `src/server/errors.ts` |
| Sequence allocation, opId dedup, undo stacks, conflict notices | `src/server/operations.ts` |
| Invite state transitions and expiry | `src/server/invites.ts` |
| Version timer and restore | `src/server/versions.ts` |
| Export states, dedup and the retry guard | `src/server/exports.ts` |

The browser applies operations optimistically through the same `src/shared/engine.ts`, so
an offline edit and the server's result agree.

## Client structure

`src/client/workspace/controller.ts` holds the one `Workspace` state object, the single
render pass and every command in `actions.ts`. Panels (`panels.ts`), dialogs
(`dialogs.ts`) and the canvas (`canvas.ts`) are pure builders over that state.
`live.ts` owns the socket, the local queue and the replay rule. `pointer.ts` listens on
the persistent canvas host, not on the SVG, because the SVG is rebuilt during a drag.

Motion runs on page timers and animation frames (`motion.ts`); nothing depends on a CSS
animation finishing, so advancing the page clock advances the motion.

## Things worth remembering

- A socket counts as connected only once the server's `hello` arrives. A socket that opens
  and says nothing must not cancel the offline countdown.
- Rebuilding the canvas loses focus, so `renderCanvasRegion` puts the roving focus back.
- `newId` is monotonic within a process: router rule 7 routes a page's connectors in id
  order, so ids must rise with creation order.
- Separation (rule 7) outranks bend count in the router cost, because shifting a segment
  sideways adds bends. Bend minimality is only checked on single-connector pages.
- An export stays `rendering` for the whole ten-second storage budget. Giving up sooner
  would let two simultaneous retries both answer 202.
- `object_ids` records every id a diagram has ever had, so a deleted object answers 409
  while an id that never belonged answers 404.

## Verifying changes

There is no checked-in test suite. During development the behaviour was exercised with
Playwright scripts against a running server covering: canvas markup and roles, snapping
and Alt, tethered reroute and the drop settle, groups, align and distribute, hidden and
locked layers, blocked connectors, pages and layers with their reorder notices, delete and
undo of a delete, same-field conflicts, role changes, the offline queue and replay, session
end and sign-in, invites through Mailpit, concurrency and opId dedup, the version timer,
SVG and PNG exports, and the storage-down, mail-down and short-invite-lifetime copies.
Reproduce them by driving the published API and the published control names.
