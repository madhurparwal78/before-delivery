# Perilune Ledger — repository notes

A TypeScript app (Node 22) that rebuilds lunar flights from uploaded captures.
One origin serves the API, the Missions page, the author console and the
read-only share page.

## Layout

- `src/shared/` — rules written once and used by the server, the browser and the
  dossier: `units.ts` + `decimal.ts` (conversion and half-away rounding),
  `doy.ts` (GMT day of year), `met.ts`, `coords.ts`, `geometry.ts` (derived
  values, landmark range, orthographic projection and pointer picking),
  `frames.ts` (frame grid, cubic Hermite, the snapping rule), `readout.ts`,
  `csv.ts`, `canonical.ts` (RFC 8785), `ijson.ts`, `copy.ts` (every published
  message), `plans.ts`, `sizes.ts`, `text.ts`.
- `src/server/` — `routes/` (dispatcher and the API), `domain/` (pass state
  machine, parser, request keys, audit chain, change version, quota, share
  links, reference, residuals, outbox), `services/` (one client per external
  service), `db/`, `seed.ts`, `dossier.ts`.
- `src/client/` — `console.ts` (the console shared by author and reader),
  `disc.ts` (disc and loupe), `playback.ts`, `panels.ts`, `transcript.ts`,
  `dialogs.ts`, `missionsPage.ts`, `app.css`.

## Build and run

- `npm run build` → `node --experimental-strip-types scripts/build.ts`: `tsc` for the server, `esbuild`
  for the browser bundle, then the stylesheet and the woff2 fonts into
  `dist/public/`.
- `npm run start` → `dist/server/server/index.js`, binding `0.0.0.0:4173`.
- Every credential and service URL comes from the environment (`src/server/config.ts`).

## Environment quirks found while building

- `amqplib@0.10` cannot handshake with the RabbitMQ in this environment
  (ECONNRESET); `amqplib@2.2.1` works.
- RabbitMQ 4.3+ counts `basic.reject(requeue=true)` as a failed delivery;
  `basic.nack` does not increase its delivery count. Let the broker dead-letter.
- Svix event ids admit only `[a-zA-Z0-9-_.]`, so the `<mission id>:<version>`
  event id travels to the service with a dot (`services/webhooks.ts`).
- `IncomingMessage`'s `close` event fires as soon as a bodyless request is
  complete, so streams listen on the response's `close` only.
- `setTimeout` cannot hold a 30-day delay (32-bit overflow); the share stream
  checks its expiry on a one-second tick instead.
- The schema is applied on every start, so columns added later need an
  `alter table ... add column if not exists` line in `db/schema.ts`.

## Testing

The development self-test and reference-suite runner live outside the shipped app,
at the working-copy root in `selftest/`. `PLAN.md` records regression evidence.
No test code or fixtures ship in the application.
