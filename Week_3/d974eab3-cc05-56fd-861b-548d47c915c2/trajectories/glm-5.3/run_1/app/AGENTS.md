# Vireo Pace — Alder Quay Laboratories brand site

TypeScript brand site on Node 22. One published content record in Postgres feeds every page
through the site's own API; Gotenberg prints the product sheet PDF from the same record.

## Build and run

- `run.json`: `npm ci` / `npm run build` / `npm run start`
- Build = `tsc` (server + client types) then `esbuild` bundles `src/client/main.ts` to
  `dist/public/js/vireo.js`, then `public/` is copied to `dist/public/`.
- Server entry: `dist/src/server/main.js` (paths in `src/server/main.ts` are relative to `dist/`).
- Env: `DATABASE_URL`, `GOTENBERG_URL`, `GRADING_KEY` (absent → grading route answers the
  unknown-path 404), `APP_PUBLIC_PORT` (default 4173).

## Layout of the code

- `src/domain/` — content types, seed data (product, interviews, scenarios, edition 1),
  site copy, formatting rules (yen/mg with thousands commas, not-a-medicine notice,
  `Content edition <n>` line), grading body shape validation.
- `src/server/` — `main.ts` (http server, static files, page routing), `api.ts`
  (`/api/*` incl. grading), `db.ts` (single `content_record` row, idempotent create +
  seed on empty DB, retry loop while Postgres is down), `sheet.ts` (HTML for Gotenberg),
  `views.ts`/`layout.ts` (server-rendered shells; all record content arrives via the API).
- `src/client/` — bundled browser code: chapter rail/hash sync, menu dialog, tablists,
  disclosures, nitrate slider, scroll-led Inner Pace + oxygen stages, ON/OFF Meridian,
  interviews, product tabs/pack/sheet download. Client `copy.ts` holds the fixed UI copy
  that the brief publishes as site copy (chapters, stages, panels, disclosures).

## Rules worth remembering

- The chapter story pins About (3 viewports) and Oxygen & Energy (5 viewports) with
  sticky stages only at ≥768px and without reduced motion; the progress formulas live in
  `src/client/story.ts`.
- Scenario order is fixed in `SCENARIO_ORDER` (both domain and client copies must agree).
- Every API error body uses `{"error","message"}`.
- Body limit 262,144 bytes: exactly that is accepted (then shape-checked), more is 413.
- The grading route checks key → size → shape, in that order; a wrong key answers 404.
- The database is the only content store; nothing from the record is copied into the
  browser bundle or the served HTML.
- Fonts (Shippori Mincho, Zen Kaku Gothic New) ship as woff2 under `public/fonts/`
  with their SIL OFL notices; no page loads anything from another origin.

## Testing

Playwright (Python) e2e suites were used during development and live in /tmp
(`e2e.py` ~145 checks, `e2e2.py` ~52 checks: marker, swipes, scroll formulas,
sheet outage/recovery, grading round-trip, phone/tablet/reduced-motion layouts).
