# Tallyframe

A self-hosted relational spreadsheet for operations teams. Three services:
Postgres (all state), Mailpit (invite email sink), MinIO (CSV export storage).

## Build and run

- `run.json` manifest: `install` = `npm ci`, `build` = `npm run build`
  (tsc for the server, esbuild for the client), `serve` = `npm run start`
  (runs the built app from `dist/` with no build step).
- Config comes only from the environment: `DATABASE_URL`, `SMTP_HOST`,
  `SMTP_PORT`, `MAIL_FROM`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`,
  `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
  `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`, `IDEMPOTENCY_TTL_SECONDS`.
- Seeded accounts all use the password `ledger-demo-2026`:
  mara@ (Owner), dev@ (Editor, own rows), priya@ (Editor, all rows),
  sam@ (Viewer), jonah@ (no access).

## Source layout

- `src/shared/` — the JSON parser that keeps number literals as exact text,
  decimal rounding to 4 places, and the single API error shape.
- `src/server/` — one module per domain rule:
  - `formula.ts` reads formulas with located diagnoses; `evaluator.ts` is
    the only evaluator (dependency graph, cycles, summary groups, previews).
  - `recalc.ts` diffs pre/post evaluations in the caller's view and decides
    depths and list order. `edits-core.ts` runs every edit in one transaction
    with history, undo and idempotency. `edits-ops.ts` holds the operations.
  - `undo.ts` is the undo/redo engine (accept-list applicability).
  - `rename.ts` rewrites formula tokens on renames; `names.ts` derives
    summary names and column ids.
  - `exports.ts` builds RFC 4180 CSV, neutralises text, and verifies the
    stored bytes again on download; `storage.ts` speaks S3 SigV4 by hand.
  - `mail.ts` speaks SMTP by hand and folds RFC 2047 Subjects.
  - `routes.ts` maps requests with the error precedence; `boundary.ts` is
    the server boundary; `seed.ts` creates the seed data once.
- `src/client/` — `app.ts` (routing, screens, dialogs), `grid.ts` (grid,
  cards, keyboard model, picker, menus), `sends.ts` (commit pipeline,
  response application, Settle roll), `pipeline.ts` (send order + the one
  resend), `state.ts`, `ui.ts`, `api.ts`.

## Testing

`tests/` holds the verification used while building:

- `api-test.py`, `api-test-2.py` — 159 API checks against the seed (roles,
  revisions, races, undo, cycles, exports, shares, boundary, idempotency).
  They mutate the database; reset it and restart the server first.
- `outage-test.py` — run against an instance whose S3/SMTP hosts are dead.
- `ui-smoke.mjs`, `ui-test-2.mjs` — headless Chromium flows (need
  playwright; the grid, cards, badges, viewer read-only, sign-out landing).

## Notes for future work

- The evaluator's recalculation list matches the brief's worked examples
  exactly (price change, row delete/restore, qty 4.16, summary creation).
  Keep `recalc.ts` as the single place for depths.
- Undo applicability uses accept lists extended by the person's own
  undos/redos; `extendAccepts` in `edits-core.ts` is the only writer.
- Client responses apply strictly in send order (`pipeline.ts`); only the
  newest-sent success plays the Settle roll.
