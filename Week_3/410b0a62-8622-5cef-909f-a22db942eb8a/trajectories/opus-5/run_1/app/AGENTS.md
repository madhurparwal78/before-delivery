# Ottermere Sport Tempoline — repository notes

Endurance training planner. TypeScript on Node 22, PostgreSQL and S3-compatible object
storage only. The same server serves the API, the page shells and the built client.

## Layout

- `src/config.ts` — every environment variable, read once at start.
- `src/domain/` — pure rules, shared by the server and the browser bundle:
  `time.ts` (athlete-local dates, ISO weeks, wall-clock conversion), `display.ts`
  (rounding and formatting), `stress.ts` (normalised power/speed and scoring),
  `series.ts` (CTL/ATL/TSB recurrence), `compliance.ts` (pairing and states),
  `steps.ts` (builder steps), `activityFile.ts` (CSV/JSON parsing and file checks),
  `plans.ts` (rest weeks, plan dates), `links.ts` (link state machine),
  `validation.ts` (every field message).
- `src/db/` — pool, idempotent schema, queries.
- `src/services/` — clock, scoring and series recomputation, planned/completed writes,
  week views, live stream bus.
- `src/http/` — router, context and access rules, error shapes, page shells, API handlers.
- `src/seed/` — the demo set and the shared seed engine used by `/api/grading/seed`.
- `src/client/` — the browser app (vanilla TypeScript, bundled by esbuild).

## Rules that live in exactly one place

- Stress: `domain/stress.ts` plus `services/scoring.ts#scoreWithThreshold`.
- Series: `domain/series.ts#computeSeries`, stored by `services/scoring.ts#recomputeSeriesFrom`.
- Compliance: `domain/compliance.ts`.
- Display rounding: `domain/display.ts` (half away from zero, 1e-9 tolerance).
- File checks: `domain/activityFile.ts`, ordered by `http/api/uploads.ts`.
- Error-check order and shapes: `http/errors.ts` and `http/respond.ts`.

## Working notes

- `APP_TODAY` (or the grading seed's `today`) owns "today"; the browser reads it from
  `/api/me` and never from its own clock.
- The demo set loads on the first serve of a database with no `initialised` state row;
  `POST /api/grading/reset` clears everything and keeps it empty.
- Build: `npm run build` (esbuild for the server bundle and the client bundle, fonts
  copied from `@fontsource/*`). Typecheck with `npm run typecheck`.
- `npm run notices` regenerates `THIRD_PARTY_NOTICES.md` from the production tree.
- A second instance with a dead `S3_ENDPOINT` must still serve reads, manual entry and
  `GET /api/health` → `{"status":"unavailable"}`.
