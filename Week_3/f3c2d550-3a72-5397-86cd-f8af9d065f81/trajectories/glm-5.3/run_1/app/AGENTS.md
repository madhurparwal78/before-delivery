# Stowdeck — repository notes

Stowdeck is a private reference library for one industrial/product designer.
Photos of objects are stored with source, maker, year, true size, materials,
finish and a measured colour swatch. References are findable in seconds,
sequenceable into reels (playable one object at a time in a client meeting) and
printable as A4/US Letter contact sheets.

## Architecture

- **Server**: TypeScript + Fastify (`src/server/main.ts`), port 4173 or `APP_PUBLIC_PORT`.
- **Browser**: TypeScript, no framework (`src/browser/main.ts`), esbuild bundle at `dist/app.js`.
- **Postgres**: system of record and the only arbiter of every single-winner rule
  (facts version, reel version, append cap/uniqueness, idempotency holds,
  first Daily Pull pick, sheet retry). Table name is `"references"` (quoted —
  it is a reserved word in SQL).
- **MinIO** via `@aws-sdk/client-s3`: `references/<id>/original.{jpg,png}` (byte-exact
  upload), `references/<id>/display.jpg` (metadata-free upright square crop),
  `sheets/<sheet>.pdf`.
- **Meilisearch**: index `references` (or `MEILISEARCH_INDEX`); searchable
  title/maker/year/materials/finish/colour_family/notes; filterable
  colour_family/materials/finish/maker/year. Confirmed writes; recorded updates
  in `search_updates` applied in order for catch-up; full rebuild from Postgres
  when the index goes missing.
- **Gotenberg**: `POST /forms/chromium/convert/html` with companion `files`
  entries `index.html` and `footer.html`. **Important**: in Gotenberg 8 the page
  footer is a companion `footer.html` file using Chromium's own
  `<span class="pageNumber">` / `<span class="totalPages">` spans — NOT the
  `footerTemplate` form field. Page size comes from `paperWidth`/`paperHeight`
  form fields (inches), not from `@page` in the HTML.

## Build and run

```
run.json: install = npm install, build = npm run build, serve = npm start
npm run build  -> node esbuild.mjs (server bundle + browser bundle + static copy)
npm start      -> node dist/server.js
```

`node tools/notices.mjs` regenerates `THIRD_PARTY_NOTICES.md` from the installed
production tree and **fails the build if any licence is not**
MIT/ISC/BSD-2-Clause/BSD-3-Clause/Apache-2.0/0BSD. This is why `sharp` was
rejected (LGPL libvips binaries) in favour of pure-JS `jpeg-js` + `pngjs`.

`node tools/demo-photos.mjs` regenerates the bundled demo photographs
(`assets/photos/`, CC0 drawn stand-ins).

## Domain rules that live in exactly one module

| Rule | Module |
|---|---|
| Server clock / `STOWDECK_NOW` | `src/server/clock.ts` |
| Local times in a zone, accepted zones, pull day, next pull | `src/server/zones.ts` |
| Size storage (tenths of mm) and no-drift inch round trip | `src/shared/domain.ts` |
| Photo magic bytes, header dimensions, orientation, pixel limit | `src/server/photo.ts` |
| Upright decode, swatch areas, mean, Display P3 → sRGB, display crop | `src/server/images.ts` |
| Reference/sheet state transitions | `src/server/states.ts` |
| Error codes, precedence, per-field copy | `src/server/errors.ts` + `src/server/main.ts` |
| Idempotency holds | `src/server/idempotency.ts` |
| Daily Pull pick | `src/server/dailyPull.ts` |
| Home-zone history and pending change | `src/server/settings.ts` |

The accepted zone list is generated from `zone.tab` (`America/Argentina/...`
etc. included; `Asia/Calcutta`, `UTC`, `US/Pacific`, `Etc/*` excluded) and is
served to the Settings picker by `GET /api/settings/zones`.

## Testing notes

- Real services run in this environment (`postgres`, `minio`, `meilisearch`,
  `gotenberg` hosts); dev credentials are in the environment, never in code.
- A headless Chromium (playwright-core + `chromium_headless_shell` in
  `/tmp/pw-browsers`) was used to drive the browser journeys end to end.
- The shared database is left in the exact published seed state: 12 references
  at version 1 with computed swatches, Demo reel v1 (3 stops), Halden kickoff
  v1 (12 stops), no sheets, empty trash, Europe/London with no pending change,
  unit mm, and the three seed pull days.
