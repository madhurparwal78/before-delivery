# Skinout — repository notes

A gear closet and trip pack lists for one long-distance hiker. Node 22,
TypeScript everywhere, Postgres as the system of record, MinIO for photos,
import originals and pack sheets, Gotenberg for pack-sheet PDFs.

## Run manifest

`run.json` holds `install` (`npm ci`), `build` (`npm run build`) and `serve`
(`npm run start`). The build bundles the server to `dist/server/index.js`, the
browser app to `dist/public/app.js`, the service worker and the stylesheet, and
copies the woff2 fonts to `dist/public/fonts`. The server binds `0.0.0.0` on
`APP_PUBLIC_PORT` (4173 when unset) and serves only built browser assets and
the routes in the brief.

## Layout

- `src/shared/` — the domain rules both the server and the offline client use.
  Each rule lives in exactly one file:
  - `weights.ts` decimal-exact gram conversion (BigInt, half-up once) and
    display formatting, including the pound split and the goal delta;
  - `lines.ts` the per-line worn/base/consumable split, carry notes, totals,
    category entries and the Not in closet test;
  - `categories.ts`, `normalise.ts` (NFKC identity), `states.ts` (trip-list
    state machine), `sharetime.ts` (share validity in the hiker's zone),
    `packsheet.ts` (sheet content and currency), `imagetype.ts` (photo type
    from leading bytes), `csv.ts` (record reading, file and row checks),
    `importmatch.ts` (import matching).
- `src/server/` — `http/pipeline.ts` runs the published error order (413, 415,
  403 cross-site, 401, 404, route, then the handler); `http/errors.ts` builds
  the single error shape; `http/json.ts` keeps JSON number source text so gram
  conversion is exact; `routes/*` one module per area; `store.ts` reads items
  and lists and derives their JSON; `s3.ts` is a small SigV4 client (no AWS
  SDK); `gotenberg.ts` renders pack sheets; `seed.ts` loads `SKINOUT_SEED`.
- `src/client/` — a hand-rolled SPA. `main.ts` routes and owns the header,
  offline flag and live `Connection` region; `pages/workspace.ts` holds the
  packing model (per-line request chains, provisional lines, held changes after
  a 401, offline queue replay); `strata.ts` draws Pack Strata and runs the
  chip → band → numerals sequence; `derive.ts` recomputes a list locally with
  the shared rules; `store.ts` is the localStorage cache and op queue;
  `sw.ts` caches the shell, assets and the last GETs for offline use.

## Decisions worth remembering

- The workspace never rebuilds its live regions, banners or zones on a repaint;
  rows are diffed in place so focus is never dropped to the body.
- `confirmed` in the workspace is the last list the server confirmed; a change
  held by the Sign in again dialog shows that state until it is resent.
- Line requests are serialised per item id, so the hiker's last input wins and
  a late answer never moves the screen back.
- Retirement keys and sync op ids are stored as `text` canonical bodies: a
  jsonb column would reparse the string and break the equality check.
- A request whose body was cut short by the 413 check closes the connection,
  otherwise keep-alive clients hang on the next request.
- `multipart/form-data` boundaries are case-sensitive: never lowercase the
  content-type before reading the boundary.

## Checking it by hand

`node scripts/notices.mjs` regenerates `THIRD_PARTY_NOTICES.md` from
`npm ls --omit=dev --all --json`. `npx tsc --noEmit` type-checks everything.
With the services up, `curl localhost:4173/api/health` answers `{"status":"ok"}`
and the seed passphrase is `switchback-ridge-47`.
