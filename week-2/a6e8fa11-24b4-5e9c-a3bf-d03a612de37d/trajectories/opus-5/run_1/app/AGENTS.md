# Furrowbook — repository notes

Offline-first spreadsheet workbook for crop field-trial networks (Tilth & Tally). TypeScript,
Node 22, PostgreSQL + S3-compatible object storage + SMTP sink. No other datastore.

## Run it

```
npm ci          # install
npm run build   # typecheck, compile server, bundle client, copy fonts
npm run start   # one process serving the API and the browser app on APP_PUBLIC_PORT (4173)
```

`run.json` is the only supported entry point. `GET /api/health` answers as soon as the server
accepts requests, even when storage, mail or the database are down.

## Layout

- `src/shared/` — rules shared by the server and the browser: formula parsing and evaluation
  (`formula/`), cell inputs and display formats (`values.ts`), op types, validation and application
  (`ops.ts`), the role table (`roles.ts`), the season state machine (`season.ts`), csv
  neutralisation (`csv.ts`), limits, references and station-zone time.
- `src/server/` — HTTP pipeline (`http/`), domain services (`domain/`), backing services
  (`services/`), schema and seed.
- `src/client/` — React app: `lib/store.ts` holds the workbook store (pending edits, sync,
  conflicts, the recalc furrow), `components/grid.tsx` the keyboard grid, `screens/` the routes.

## Rules that live in exactly one place

| Rule | File |
| --- | --- |
| Role table | `src/shared/roles.ts` |
| Season transitions | `src/shared/season.ts` |
| Edit check order | `src/server/domain/editChecks.ts` |
| Conflict detection and sequencing | `src/server/domain/sync.ts` |
| Closure, depth, budgets, formula evaluation | `src/shared/formula/evaluate.ts` |
| csv neutralisation | `src/shared/csv.ts` |
| Import limits and checks | `src/server/domain/import.ts` |
| Error shape and precedence | `src/server/http/errors.ts`, `src/server/http/pipeline.ts` |
| Request keys (exactly-once) | `src/server/domain/requestKeys.ts` |

## Things worth knowing

- **Everything is derived from the op log.** `loadWorkbookState` replays `ops` rows; a restore is a
  single `restore` op carrying the version snapshot. No client-supplied values are ever stored.
- **Sheet renames rewrite formula text** so formulas keep pointing at the renamed sheet by identity.
- **Formatted empty cells stay in the evaluation** so bold and number formats survive on blank cells.
- **Offline** relies on three browser-side caches: pending ops, the last workbook snapshot and the
  signed-in member, all in `localStorage`, plus `src/client/sw.js` for the app shell.
- **Idempotency** is keyed on member + endpoint (+ workbook for sync). Import hashes the file bytes
  and name, not the multipart body, so a repeat with a new boundary still replays.
- **Ops keep historical authors**: `ops.author_id` and `versions.created_by` carry no foreign key so
  a member can be removed without touching the record of what they did.

## Checking changes

There is no committed test suite. During development the app was exercised with Playwright and
direct API scripts covering: the eight journeys, role and season gates, formula budgets, import
limits, exports (including an xlsx round trip validated with openpyxl), share links, outage and
recovery behaviour with storage and mail pointed at closed ports, responsive layout at 375/768/1280
and reduced-motion recalc. Re-create those scripts in `/tmp` when making changes; reset the database
(`drop schema public cascade; create schema public;`) between runs because seeds and request keys
are sticky.
