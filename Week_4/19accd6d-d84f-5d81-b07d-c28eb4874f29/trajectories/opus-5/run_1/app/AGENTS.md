# Wringbench — repository notes

Wringbench is a hosted data transformation workbench: paste or drop payloads, chain operations into
a recipe, and watch the output bake in the browser. The brief that defines every behaviour is the
product specification; this file records how the code is laid out and the decisions that are easy to
undo by accident.

## Running it

```
npm ci          # install
npm run build   # generates icons, bundles server + page + worker, copies fonts
npm run serve   # node build/server.js, binds 0.0.0.0 on APP_PUBLIC_PORT (4173 by default)
npm run check   # runs the worked examples from the brief through the shared modules
npm run typecheck
```

`/app/run.json` holds the install, build and serve commands for the deployment harness.

Services come from the environment and are never hard-coded: `DATABASE_URL`, `S3_*`, `SMTP_*`,
`MAIL_FROM`, `MEILISEARCH_*`, `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`. Published limits come from the
`WRINGBENCH_*` variables and are read once at start in `src/server/config.ts`.
`WRINGBENCH_GRADING=1` enables `POST /api/grading/seed` and `POST /api/grading/outage`; both answer
404 otherwise.

## Layout

```
src/shared/   definitions used by both sides: ops.ts (the 34-operation catalogue), bytes.ts,
              hash.ts, json.ts, csv.ts, recipe.ts (validation, links, the compare rule),
              wringline.ts (the v1 import grammar), span.ts, format.ts
src/worker/   pipeline.ts (fork/merge, pausing, errors) and worker.ts, the one bake worker
src/server/   http.ts (router, body limits, same-origin boundary), store.ts, db.ts, storage.ts
              (MinIO over hand-rolled SigV4), mail.ts (minimal SMTP), search.ts, live.ts,
              snapshots.ts, routes/*
src/client/   main.ts (shell, info strip, router), workbench.ts, workbench-state.ts, baker.ts,
              dialogs.ts, dom.ts, screens/* and styles.css
scripts/      build.mjs (esbuild + icon generation + font copying), check.ts (worked examples)
```

## Decisions worth keeping

- **One place per domain rule.** The version conflict lives in `store.conflictIfStale`, snapshot
  status in `snapshots.snapshotStatus`, line counting in `bytes.countLines`, span offsets in
  `span.carrySpan`, the compare matching rule in `recipe.compareVersions`, Wring Line matching in
  `wringline.parseWringLine`, and the team cap in `config.limits.teamMax` as used by the team
  routes.
- **The catalogue is the only operation definition.** `src/shared/ops.ts` carries each operation's
  arguments, defaults and behaviour; the worker runs them and the server validates arguments from
  the same specs.
- **The server never bakes.** It stores and relays recipes only.
- **Checksums are hand-written** (`src/shared/hash.ts`) so output is identical in every browser;
  the MD5 and SHA-256 constant tables are hard-coded rather than computed from `Math.sin`.
- **JSON is parsed by our own strict parser** so `Invalid JSON at line L column C` is the same text
  in every engine.
- **Pane order in the DOM is the published Tab order.** The Output pane is a grid so that
  "Download output" can sit in the title bar while coming after the Output textbox in the DOM.
- **The span tint in Output** is painted by a mirror div behind a transparent-background textarea
  (`.editor-mirror`); the Input tint is the native `::selection`.
- **Reorder handles use pointer events only** (mouse and touch), and the dragged card element is
  moved in the DOM so pointer capture survives the drag.
- **`[hidden] { display: none !important }`** is deliberate: several panes set `display: flex`,
  which would otherwise defeat the hidden attribute.
- Only `Workbench announcements`, `Library announcements`, `Team announcements` and
  `Account status` are polite live regions; every other `role="status"` carries `aria-live="off"`
  so the one polite region stays the one that announces.

## Checking behaviour

`npm run check` covers every worked example in the brief (encodings, errors, hexdump, sorting, JSON,
CSV, checksums, gzip, fork, span carry, the recipe link, the compare rule and Wring Line). The
browser journeys were verified with Playwright against a live instance at 1280x800, 768x1024 and
375x812, including the grading outage routes.
