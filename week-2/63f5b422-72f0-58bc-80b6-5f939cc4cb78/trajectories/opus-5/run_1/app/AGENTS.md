# Plinth — repository notes

Plinth is a collaborative visual website builder: one Node server (API, WebSocket,
editor client, published pages) plus one browser client, backed by Postgres, MinIO
and Mailpit.

## Layout

```
run.json                 install / build / serve manifest (npm ci, npm run build, node dist/server/index.js)
public/                  app.css, fonts (woff2), build/client.js (bundled client)
src/shared/              domain rules used by both sides
  types.ts               document, node, token, collection types
  breakpoints.ts         inheritance, style sources, pip states, reach of a change
  style.ts               style keys, value validation, defaults, base node CSS
  apply.ts               the operation reducer and its inverses (one place)
  ops.ts                 operation shapes and request parsing
  render.ts              per-frame and published CSS generation
  richtext.ts            the rich-text allowlist
  usage.ts               token uses and field bindings
  notices.ts             the exact notice texts
src/server/              http router, api routes, engine (seq/log/undo/conflicts),
                         hub (WebSocket), publish, published renderer, storage (SigV4),
                         mail (SMTP), images, grading routes, browser pages
src/client/              dom helpers, net, announcer, account screens
src/client/editor/       store (state + transport), actions (intents + notices),
                         navigator, canvas, stylepanel, fan, panels, dialogs,
                         addmenu, drag, keys, publishing, versions, comments
```

## Rules that live in exactly one place

- Breakpoint inheritance, style sources, pip states and the reach of a change:
  `src/shared/breakpoints.ts`.
- Applying an operation and computing its inverse (including shared-component
  mirroring): `src/shared/apply.ts`. The client and the server run the same code;
  the server passes an image index and real ids, the client replays the ids the
  server issued.
- Conflict winners, undo skipping and the change log: `src/server/engine.ts`.
- Publish-state transitions: `src/server/fingerprint.ts` decides whether a live
  page became `live_changed` by comparing what the page renders from.
- The rich-text allowlist: `src/shared/richtext.ts`.
- The not-found rule: `requireAccess` in `src/server/workspaces.ts` plus
  `ApiError` in `src/server/errors.ts`.

## Conventions

- Every notice string comes from `src/shared/notices.ts`; never inline the text.
- Motion (Cascade Fan, style panel, published Menu) is driven from animation
  frames, anchored to `performance.now()`, and settles on a page timer so the end
  state lands exactly on time. Each exposes `data-*` state and progress.
- The client applies remote messages inside the socket handler; only the motion a
  change starts runs on page time.
- Operations that create ids are applied when the server acknowledges them; every
  other operation is applied at once and rolled back by reloading the document if
  the server refuses it.

## Working on it

```
npm ci
npm run build          # tsc for the server, esbuild for the client bundle
node dist/server/index.js
```

Environment: `DATABASE_URL`, `S3_*`, `SMTP_HOST`/`SMTP_PORT`, `MAIL_FROM`,
`APP_PUBLIC_URL`, `APP_PUBLIC_PORT`, `GRADING_ROUTES`, `PRESENCE_TIMEOUT_MS`.
With `GRADING_ROUTES=on`, `POST /api/grading/seed` builds users, workspaces and
published pages in one call, and `POST /api/grading/storage-outage` makes storage
fail for one workspace.
