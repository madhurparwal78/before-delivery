# Cairn — repository notes

Local-first notebook of linked Markdown notes with end-to-end encrypted Sync and bounded Publish.

## Layout

- `src/shared/` — domain rules shared by server and browser: `boundary.ts` (hops, inside set,
  severed links, page slugs), `markdown.ts` (allowlisted renderer), `dossier.ts` (page shell,
  search index, previews, sitemap), `addons.ts` (add-on state and deadline math), `lifecycle.ts`,
  `envelope.ts`, `validation.ts`, `sample.ts` (sample case), `time.ts`, `copy.ts`.
- `src/server/` — HTTP router (`http.ts`, server boundary), `api/` route modules, `publish.ts`
  (all-or-nothing publish, takedown), `publicRoutes.ts` (`/d/`, `/p/`), `sweep.ts`, `seed.ts`,
  `storage.ts` (hand-rolled SigV4 S3 client), `killbill.ts`, `smtp.ts`, `entitlement.ts`.
- `src/client/` — React app (`main.tsx` and components), `reader.ts` (dossier link previews),
  CSS in `tokens.css`, `app.css`, `reader.css`.
- `scripts/build.mts` — esbuild bundling, font copying, app shell; `scripts/notices.mts` —
  THIRD_PARTY_NOTICES generator.

## Commands

- `npm run build` → `tsc` (server to `dist/server`), client typecheck, then esbuild to `dist/public`.
- `npm start` → `node dist/server/index.js`, binds `0.0.0.0:${APP_PUBLIC_PORT:-4173}`.
- Restart helper used while developing: kill any process whose cmdline holds `dist/server/index.js`
  (`ps`/`pkill` are not installed in this container; read `/proc/*/cmdline`).

## Service facts learned the hard way

- Kill Bill: `POST /1.0/kb/subscriptions` must not send `productCategory` together with `planName`,
  and must not reuse a subscription `externalKey` (only `bundleExternalKey` is set, to
  `<account_id>-<addon>`). Subscription writes can take >5 s, so write calls use a 12 s timeout.
- Cancelling with `END_OF_TERM` before Kill Bill has invoiced gives `billingEndDate = now`, so the
  add-on lands in `grace`; after an invoice exists the end date is a month out and the state is
  `ending`. Both paths are correct per the brief.
- MinIO: path-style requests, SigV4 signed by hand in `storage.ts`. Unreachable endpoints fail after
  a 4 s timeout and raise `StorageUnavailableError`, which the API turns into `503 storage_unavailable`.
- Mailpit speaks plain SMTP on 1025; `smtp.ts` is a small client (EHLO/MAIL/RCPT/DATA).
- `pg` returns `date` columns as strings here (type parser set in `db.ts`) so billing end dates do
  not shift with the server's zone.

## Design decisions worth keeping

- The boundary, the severed count, the rendering allowlist, dossier transitions, add-on state and
  deadline maths live once in `src/shared/` and are imported by both sides. The workbench counters
  and the server's manifest preview therefore agree by construction.
- Markdown is rendered by a hand-written subset renderer rather than a parser plus sanitiser, so the
  allowlist holds by construction: raw HTML is escaped text and only generated tags exist.
- Published and preview pages use absolute internal paths (`/d/<slug>/<page>`, `/p/<token>/<page>`),
  which keeps links working whether or not the address ends in a slash.
- Amber marks only what is public or about to become public, plus focus rings; brick red with an
  icon marks cuts, conflicts and errors.
- A service worker (`src/client/sw.ts`) keeps the app shell on the device, which is what makes the
  notebook open and edit after a reload with the network off.
- Vault keys are unwrapped in the browser and kept as non-extractable `CryptoKey` values in
  IndexedDB, so a vault stays unlocked across reloads but the key never leaves the device.

## Testing notes

Throwaway scripts live outside the repository. `/tmp/api.ts` (end-to-end API), `/tmp/outage.ts`
(storage and billing outages on extra ports) and `/tmp/lapse.ts` (grace, read-only, sweep warning and
takedown) are bundled with `npx esbuild /tmp/x.ts --bundle --platform=node --outfile=/tmp/x.js` and
run with node. `/tmp/uitest/` holds Playwright scripts (`journey.mjs`, `outage-ui.mjs`,
`conformance.mjs`, `shots.mjs`) with Chromium installed there; `npx playwright install-deps chromium`
was needed for the system libraries.

Extra instances share the database, which is how provider outages and deadline overrides are tested:

- `APP_PUBLIC_PORT=4174 S3_ENDPOINT=http://10.255.255.1:9000 node dist/server/index.js`
- `APP_PUBLIC_PORT=4175 KILLBILL_URL=http://10.255.255.1:8080 node dist/server/index.js`
- `APP_PUBLIC_PORT=4176 CAIRN_PUBLISH_RETENTION_SECONDS=2 CAIRN_PUBLISH_WARNING_LEAD_SECONDS=1 CAIRN_SWEEP_INTERVAL_SECONDS=1 node dist/server/index.js`
