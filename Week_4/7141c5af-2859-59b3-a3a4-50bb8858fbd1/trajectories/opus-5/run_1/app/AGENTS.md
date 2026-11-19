# Semenza Desk — repository notes

Bottega Semenza's Semenza Desk: one conservator's desk that carries a chair from
stamp and condition pins through material, dye lot, hide layout, estimate,
private client page, bench weeks and courier collection to a signed PDF dossier,
plus the public site.

## Running it

```sh
npm ci          # install
npm run build   # server bundle + client bundle + CSS + Jost woff2 into dist/
npm run serve   # binds 0.0.0.0 on APP_PUBLIC_PORT (4173)
```

`/app/run.json` holds the same three commands under `"_schema":"run-manifest-v1"`.

Everything is read from the environment at start in `src/server/config.ts`; no
credential is hard-coded and none reaches the browser.

## Layout

```
src/shared/     copy tables, languages, dates, cases, drawings, note markup
                (imported by both the server and the browser)
src/server/
  domain/       the pure rules: decimal, money, time, layout, stamp, csv,
                seatHeight, names, png
  services/     the five providers: storage (MinIO), search (Meilisearch),
                mail (SMTP), providers (WireMock supplier + courier), render
                (Gotenberg)
  db/           schema, seed data, seed runner
  http/         errors, request reading, responses, context/router, pipeline
  api/          one module per resource; `routes.ts` is the published surface
  features/     work that spans resources: dossier, letters, indexing, tasks,
                clientPageData
  pages/        server-rendered HTML
src/client/
  ui/           dom, motion, dialog, api, shell (live regions, pending states)
  screens/      one module per screen
  main.ts       reads `document.body.dataset.screen` and hands over
```

## Rules that live in exactly one place

Change them here and nowhere else.

| Rule | Where |
| --- | --- |
| Exact decimal arithmetic | `src/server/domain/decimal.ts` |
| Money, tax, milestones, hides, quarter metres | `src/server/domain/money.ts` |
| Wall time, DST gaps and overlaps, zone transitions | `src/server/domain/time.ts` |
| Placement and rotation refusals, the used figure | `src/server/domain/layout.ts` |
| Stamp numbers (Luhn) | `src/server/domain/stamp.ts` |
| Pin-note markup | `src/shared/noteMarkup.ts` |
| Name folding for sign-off and signing | `src/server/domain/names.ts` |
| Seat height in four languages | `src/server/domain/seatHeight.ts` |
| Workbook format, materials list guarding | `src/server/domain/csv.ts` |
| Hold order of checks, stock cache | `src/server/api/materials.ts` |
| Glue cure and the bench day's start | `src/server/api/bench.ts` |
| Client state moves (`closing` → `erasing` → `erased`) | `src/server/features/tasks.ts` |
| The request precedence order | `src/server/http/pipeline.ts` |
| The one error shape | `src/server/http/errors.ts` |
| Feedback copy (F-01 … F-112) | `src/shared/feedback.ts` |
| Client page copy (C01 … C52, M, K) | `src/shared/clientCopy.ts` |
| Motion durations (160/320/640 only) | `src/client/ui/motion.ts` |

## Things that bit once

- **Meilisearch reports an existing index as a *failed task*, not a 409.**
  `POST /indexes` answers 202 even when the index is there. `ensureIndex` must
  check for the index first and accept `index_already_exists` on the task, or
  every restart after the first makes search look unavailable.
- **`ON CONFLICT` needs the partial index's predicate.** `pieces_stamp` is
  `UNIQUE (desk_id, stamp_number) WHERE stamp_number IS NOT NULL`, so any upsert
  must repeat that `WHERE`.
- **A file's size limit is decided before authentication.** The multipart body is
  split in the pipeline at step 2, not at step 8, so an 8,000,001-byte
  photograph answers 413 even with no session.
- **`patchList` must call `update` on created rows too**, otherwise a first
  render leaves whatever `create` did not fill in.
- **A `.tile` inside another grid** keeps `grid-column: span 12` and overflows.
  Case tiles use `.tile-case` with `grid-column: auto`.
- **Published copy prints character for character**, so `escapeHtml` leaves a
  straight apostrophe alone (every attribute here is double-quoted).
- Postgres `BIGINT`, `NUMERIC` and `DATE` are read as text (`db/pool.ts`), so no
  value passes through a binary float.

## Verifying

`sh scripts/verify.sh` runs everything from a fresh database:

| Script | What it checks |
| --- | --- |
| `scripts/domain-checks.ts` | every worked example in the brief (96) |
| `scripts/probe.py` | the API, its refusals and the precedence order (153) |
| `scripts/pages.py` | first-response headings, titles, `lang`/`dir` |
| `scripts/browser.py` | real-browser journeys, keyboard and 375 touch (129) |
| `scripts/axe.py` | axe-core on every screen at 375 and 1280, SR7/14/15/16/17 (74) |
| `scripts/degraded.py` | each copy with its provider down, short timers (50) |
| `scripts/sweep.py` | mail, file limits, workbook, list file, dossier (59) |

Helpers: `scripts/restart.sh [--fresh]` for the primary copy,
`scripts/copies.sh <copy> <port>` for the others. The real deployment gives each
copy its own database; `copies.sh` isolates them by Postgres schema instead,
because the dev role may not create databases.

Test data must be unique per run where a published rule is "once only": stamp
numbers, photograph bytes, enquiry addresses. Otherwise the second run trips
F-14, F-26 or F-12 and looks like a failure.

## Boundaries kept

- Only the published endpoints and routes exist; no debug or test endpoint.
- No payment code, no WebGL, no canvas 3D, no video, no image from outside the
  repository — every drawing comes from one dot primitive in
  `src/shared/drawings.ts`, and the seeded photographs from
  `src/server/domain/png.ts`.
- The supplier and courier are reached only through `WIREMOCK_URL`.
- No datastore beyond Postgres, MinIO, Mailpit, WireMock, Gotenberg and
  Meilisearch; nothing that must outlive a restart is kept in memory or on disk
  (the stock cache, provider back-off and mail outbox are Postgres tables).
