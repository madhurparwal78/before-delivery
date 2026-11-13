# Ditchbook — repository notes

Water-ordering and headgate desk for the Wirrinbah Water Trust. One web app:
TypeScript throughout, Postgres for every record and decision, MinIO for
stroke records and regulator packs, Mailpit for all notices.

## Architecture

- `src/shared/` — the domain rules, decided once each:
  - `decimal.ts` exact decimal arithmetic (scaled BigInt; no binary floats)
  - `district-time.ts` Australia/Sydney offsets, the `YYYY-MM-DDTHH:MM:SSZ`
    instant format, window labels with the AEST/AEDT repeated-hour mark,
    district-date periods
  - `domain.ts` window status, the conversion and pro-rating rule, turnout max
    volumes, rates, and the ration shares (largest remainder)
- `src/server/` — the API: `api.ts` routes, `actions.ts` (orders,
  restrictions, rations), `cards.ts` (strokes, succession), `capacity.ts`
  (revisions), `packs.ts` (document + pipeline), `erase.ts`, `s3.ts` (hand
  rolled SigV4), `smtp.ts` (raw SMTP), `store.ts` (row types + lapse),
  `seed.ts`, `schema.ts`, `main.ts` (boundary, worker loop)
- `src/client/` — the browser app: `app.ts` (router/session/topbar/polling),
  `grower.ts`, `field.ts` (dwell), `board.ts`, `capacity.ts`, `clerk.ts`
  (packs, contractors, review)
- `public/` — `app.css`, bundled fonts (Archivo, IBM Plex Sans; OFL texts in
  `public/licenses/`)

## Build and run

`run.json` holds the manifest: `npm ci`, `npm run build`, `npm run start`.
The build compiles the server with `tsc` (NodeNext, imports rewritten), bundles
the client with esbuild, and copies `public/` into `dist/public`.

## Testing

`test/run-all.sh` runs the whole suite against a fresh database:
unit tests (`district-time.test.ts`, `domain.test.ts` — the published
examples from the brief), API e2e (`api-e2e.py`, `api-lapse-dst.py`,
`api-final-checks.py`, `api-search-shapes.py`), outage harnesses
(`outage.test.mjs`, `mail-outage.test.mjs`), and the browser journeys
(`browser-*.py` — journeys 1–8, viewports, live updates, the frozen device
clock, edge cases). `test/run-with-fresh-db.sh` resets Postgres, restarts the
server and runs one test.

## Conventions worth keeping

- Every ML figure is a three-decimal string, computed once on the server.
- Contested judgements lock the window row first, then the allocation rows in
  grower-id order, inside one transaction.
- The lapse is judged inside any read or write that touches the window;
  `windows_lapse_done` makes it exactly-once. The conflict notice for a
  refused order is queued outside the rolled-back transaction.
- The browser never derives a status from the device clock; every screen
  polls on its own timer (≤3s) and repaints from server figures.
- A poll must never clobber what the user is typing: the order form keeps
  live selections, the capacity table keeps dirty cells, and dialogs are
  never closed by a repaint.
