# Plotfold — repository notes

Plotfold is a drafting and review desk: a Node 22 + TypeScript server and a
browser client, built together, backed by PostgreSQL and MinIO only.

## Layout

```
run.json              install, build and serve commands
build.mjs             esbuild: server bundle, client bundle, stylesheet, public copy
src/shared/           every domain rule, used by the server and the browser
src/server/           HTTP, live channel, storage, routes
src/client/           screens, drawing canvas, command line, panels
public/fonts/         bundled Funnel Display and Funnel Sans (OFL-1.1)
```

## Where each rule lives (one place each)

| Rule | File |
|---|---|
| Error codes, order and sentences | `src/shared/errors.ts` |
| Rounding and display precision | `src/shared/numbers.ts` |
| Model types, handles, inheritance | `src/shared/model.ts` |
| Geometry maths (intersections, areas, transforms) | `src/shared/geometry.ts` |
| Operation engine, conflict rules, patches | `src/shared/apply.ts` |
| Geometry commands (trim, fillet, offset, array…) | `src/shared/edits.ts` |
| Hatch boundary and area | `src/shared/hatch.ts` |
| Dimension values | `src/shared/dimensions.ts` |
| Constraint solver | `src/shared/constraints.ts`, `src/shared/expressions.ts` |
| Command table and prompts | `src/shared/commands.ts` |
| Snap priority and drafting aids | `src/shared/snap.ts` |
| Entity-list labels | `src/shared/labels.ts` |
| Compare counts and markup flags | `src/shared/compare.ts` |
| Paper mapping and title blocks | `src/shared/sheets.ts` |
| Drawing text format | `src/shared/plottext.ts` |
| SVG for sheets and exports | `src/shared/svgtext.ts`, `src/shared/render.ts` |
| State machines and roles | `src/shared/transitions.ts` |
| Phone gesture formulas | `src/shared/gestures.ts` |

The browser applies operations with the same `applyGroup` the server uses, so
optimistic edits and authoritative results come from one implementation.

## Running locally

```
npm ci && npm run build && node dist/server/index.js
```

Environment: `DATABASE_URL`, the six `S3_*` variables and the `PLOT_*`
settings. `PLOT_GRADING=1` turns on `/api/grading/*`.

## Testing notes

Headless Chromium through Playwright was installed under `/tmp/pwtest` for
manual checks; it is not part of the repository. A quick reset between manual
runs: `truncate users, folders, drawings, sessions, login_attempts cascade`.
