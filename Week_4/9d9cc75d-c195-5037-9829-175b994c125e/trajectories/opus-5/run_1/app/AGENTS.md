# Lozenge — repository notes

Lozenge is a browser workbook: CSV sources, one left join, sheets built on shelves, dashboards with
actions, published workbooks with row-level security, extract refreshes, alerts and exports.
PostgreSQL and MinIO are the only datastores.

## Layout

```
run.json              run manifest (install / build / serve)
scripts/build.mjs     esbuild: server bundle, client bundle, CSS, fonts
shared/               rules used by both sides (one place per rule)
  types.ts            domain shapes (sheet spec, pills, filters, query result)
  display.ts          the display rule (numbers, shares, data-value, calcRound)
  formula.ts          lexer, parser, AST, the 27 functions, node and depth counting
  check.ts            formula checks in the published error order, cycle search
  chart.ts            ticks, categorical and sequential colour, captions, chart table, refusals
  viewplan.ts         dimension and measure column order, axis measure, sort order
  twin.ts             the data table twin model (also used by exports)
  dashboard.ts        the container sizing rule (stage 1280x800, gap 8)
server/
  index.ts            http server, static files, API dispatch, error precedence
  http.ts             router, body limits, rate limits, the one error shape
  domain/query.ts     the published query order, LOD, table calcs, filters, totals, limits
  domain/evaluate.ts  formula evaluation (row level and aggregate)
  domain/source.ts    snapshot load, left join with duplicate-key notice, entitlements
  domain/extract.ts   refresh state machine, schedule, alerts, inbox
  domain/exportjobs.ts export job states; domain/render.ts PDF, PNG, crosstab
  routes/*.ts         one file per area; routes/grading.ts only when LOZ_GRADING=1
client/               vanilla TS, no framework; view/ holds chart, twin, shelves, dialogs
```

## Rules that live in exactly one place

- query order and every filter step: `server/domain/query.ts`
- display of every number: `shared/display.ts`
- ticks, colour, captions, chart choice and refusals: `shared/chart.ts`
- column order and the axis measure: `shared/viewplan.ts`
- dashboard sizing: `shared/dashboard.ts`
- error precedence and the error body: `server/http.ts` + `server/index.ts`

## Things worth remembering

- The bundled sample lives in a project with no members (ids `sample-project`, `sample-source`,
  `sample-workbook`, `sample-sheet`). The home page queries `sample-sheet` without an account; every
  other id in that project answers 404 because nobody is a member.
- Row-level security has no exemption: a creator with no entitlement row sees no rows.
- A level-of-detail expression is row-level (`hasAggregate` stops at `{...}`), so a bare LOD
  calculation is aggregated by the pill (AVG by default).
- The right table of a join is deduplicated by its key inside each mark, so `SUM(Target)` counts once
  per stockist.
- `data-pending` on `<body>` counts ordinary API requests only, never server-event streams.
- Playwright in this container needs `npx playwright install-deps chromium`; without the system
  libraries a page containing a `<select>` freezes the headless shell.

## Checks run during development

Browser journeys and API worked examples were exercised with temporary Playwright and Python scripts
(home, sheet editor keyboard and pointer, filters, calculations, dashboards and actions, phone layout,
exports, upload with a storage outage, publishing, parameters, reduced motion, two-tab extract state).
They are not part of the repository; `npm run typecheck` covers both tsconfigs.
