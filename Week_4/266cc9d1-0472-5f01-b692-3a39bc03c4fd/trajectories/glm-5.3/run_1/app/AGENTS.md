# Spanwise — repository notes

Larchline Geospatial Spanwise: drone survey vegetation-clearage findings
delivered from contractors to utilities, on a 3D globe.

## Stack and layout

- Node.js 22, strict TypeScript, no frontend framework: the client is hand-rolled
  DOM modules under `src/client/screens`, bundled by esbuild (`scripts/build.mjs`).
- The only production dependency is `pg`. S3 and SMTP are implemented directly
  (SigV4 signing in `src/server/s3.ts`, socket SMTP in `src/server/mail.ts`) —
  no SDKs, so the shipped dependency tree stays MIT/ISC only.
- `npm run build` bundles the server to `dist/server/main.js` and the client to
  `dist/assets/app.js`, copying `src/client/styles` (including the self-hosted
  fonts) and `index.html`.
- Serve with `npm start` (binds 0.0.0.0 on `APP_PUBLIC_PORT`, default 4173).

## Domain rules and where they live

Each rule has exactly one home:

- WGS84 ECEF and geodesy: `src/domain/geodesy.ts`. Positions stay float64.
- Centreline, chainage/offset projection, tower geometry: `src/domain/geometry.ts`.
  `pointAt` walks the great circle in 500 m steps and converts back through
  `ecefToGeodetic` — **never** `atan2` on ECEF, which yields geocentric (not
  geodetic) latitude and shifts towers ~20 km.
- Corridor seeds, fixture terrain, clearance derivation (canopy top → conductor
  segment distance → Violation/Clear), span lookup: `src/domain/corridors.ts`.
- Flight track parsing, interval-scoped samples, earliest-pass-wins interpolation,
  coverage merging: `src/domain/flight.ts`. Coverage keys are `from_m`/`to_m`
  (the API contract). The very first sample's projected chainage is clamped to 0
  so chainage 0 counts as covered.
- Fixture file generation (deterministic per asset+path): `src/domain/fixtures.ts`.
- Storage confirmation (write → HEAD read-back of size and SHA-256):
  `src/server/storage.ts`. MinIO serves `x-amz-checksum-sha256` on HEAD only when
  the object carries one; the client falls back to hashing a read.
- Idempotency (scope, parsed-body comparison, replay, 24 h TTL):
  `src/server/idempotency.ts`.
- Error shape and precedence: `src/server/errors.ts` + the route table in
  `src/server/routes.ts`.
- Labels (`F-<n>`, commit-ordered, no reuse): `label_counter` row updated in the
  same transaction as the insert.
- Findings-set state machine: `routes.ts` (`submit`, `close`, `revise` all
  re-check state under `FOR UPDATE` inside the transaction).
- The "latest scrub input wins" rule: `flightSeq` in
  `src/client/screens/workspace.ts` / `review.ts`; late answers are discarded.

## Gotchas learned

- `pg` needs JSON **strings** (not objects) for jsonb parameters, with no cast in
  the SQL; passing an object yields `invalid input syntax for type json`.
- MinIO's HEAD does not return the checksum header unless `x-amz-checksum-mode:
  ACTIVE` is sent, and returns the MD5 ETag otherwise.
- The Globe constructor must not call `onCameraChange` synchronously: the
  workspace's helpers (`chainageAt`, `groundAt`) are `const`s declared after the
  constructor call, so a synchronous callback hits the temporal dead zone.
- Camera easing: `pose.height + (target.height - target.height) * k` was a real
  bug caught by reading the readout's `Camera` line in a browser test.
- Mailpit message bodies use CRLF; trim link URLs extracted from them.
- Keyboard shortcuts must not be blocked by focus in the range slider: the
  brief says shortcuts work from the slider and listbox, only text fields are
  excluded.

## Testing

Playwright (dev dependency) drives real Chromium; `npx playwright install
chromium` was run once. Tests are written ad-hoc under `/app` and removed after
each run — the app itself ships no test suite.
