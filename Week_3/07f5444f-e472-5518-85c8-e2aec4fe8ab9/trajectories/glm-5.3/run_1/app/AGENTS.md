# Quirewell Stand Desk — working notes

A regional orchestra's music-library desk: programmes, string counts, cuts on
bar maps, marked-part and bowing-master scans in MinIO, folders for players,
and rental-set returns. Postgres is the system of record; MinIO ("the score
store") holds scans; Mailpit receives all mail.

## Layout

- `run.json` — install/build/serve commands (run-manifest-v1).
- `src/server/` — the API, one error shape and one ordering (`app.ts`),
  read models derived from stored rows (`model.ts`), SigV4 MinIO client
  (`store.ts`), SMTP with acceptance-before-`sent` (`mail.ts`), schema
  (`schema.sql`) and seed (`seed.ts`).
- `src/shared/` — London wall-clock conversion and the domain shapes, shared
  by server and client. Every date rule lives here.
- `src/client/` — screens (sign-in, desk, rentals, section desk, folders),
  DOM helpers with modal focus trapping (`dom.ts`), API client with the
  latest-save-wins tickets (`api.ts`).
- `esbuild.mjs` — bundles the client, inlines the Lucide icon sprite into the
  shell, copies `src/client/styles.css` and the schema into `dist`.
- `public/` — the built shell, `app.js`, self-hosted TTF fonts, icon sources.

## Things that bit us once

- `esbuild.mjs` must build `public/index.html` from
  `src/client/index.template.html`; injecting the sprite in place loses the
  `<!--ICON_SPRITE-->` marker on the second build.
- `tsc` does not copy `schema.sql`; `esbuild.mjs` copies it into `dist/server`.
- Express 5's `@types` type `req.params` values as `string | string[]`; the
  `pathParam` helper in `app.ts` is the single read of path parameters.
- The error order matters: same-origin and body/content-type checks run in a
  middleware *before* the session middleware, so 415/413 beat 401.
- `Intl` in en-GB puts a comma after the weekday in date styles;
  `formatDate`/`formatDateTime` build their strings from `formatToParts` to
  match `Sat 14 Nov 2026` exactly.
- After a database reset, restart the server: schema and seed apply only at
  boot. Sessions die with the schema, so old cookie jars stop working.
- The seed's business day S is London midnight on the day the seed runs; the
  reminder sweep runs at boot, after each rental set is created, and every
  `REMINDER_SWEEP_SECONDS`.

## Checks worth rerunning after changes

- `npx tsc -p tsconfig.server.json --noEmit` and the strict client check
  (see `package.json` build) both pass.
- With the seed: Programme 01 reads 38:40 / 57-57-0; cutting Weir 120–184
  saves 4:28, flags 14 parts, ends at 34:12; 10-8-6-5-4 gives 61/57/4.
- Publishing sends one folder notice per seated player (46 for Programme 01
  at 10-8-6-5-4), and Mailpit decodes subjects exactly as typed.
