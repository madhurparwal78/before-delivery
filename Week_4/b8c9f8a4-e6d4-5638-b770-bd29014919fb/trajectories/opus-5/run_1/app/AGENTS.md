# Open Bonnet — repository notes

Ostler Lane Open Bonnet: a single-car condition walkround for one private UK seller.
TypeScript throughout, PostgreSQL and MinIO as the only datastores.

## Layout

- `src/shared/` — code both sides use: panel table and car-space frames, published copy
  strings, formatting (London time, money, time left, mils), the panel diagram SVG.
- `src/server/domain/` — one place per domain rule: paint bands, findings and the seen
  content hash, listing transitions, offer lapse and transitions, the publish gate, the
  odometer tape, advisories and recurrence, London local starts, the error shape.
- `src/server/repo/` — read and write layers over PostgreSQL.
- `src/server/services/` — provider calls (MinIO, WireMock record API, Gotenberg, ntfy),
  image judging and derivatives, the publish pipeline, report HTML.
- `src/client/stage/` — the Three.js stage: `camera.ts` holds the beat and camera rules
  used by both the WebGL scene and the drawn SVG still, so their projections agree.
- `src/client/owner/`, `src/client/link/` — owner screens and the buyer and inspector
  link screens.

## Things that were easy to get wrong

- Mounting two `app.use` layers over the same prefix where both read the body means the
  second reader waits on a stream that has already ended, and the request hangs. There
  is now exactly one body reader for `/api/owner` and one for `/api/link`, each picking
  its own limit from the path.
- `busboy` applies `basename()` to the uploaded file name, so a name holding `/` or
  `..` can never be refused. `src/server/http/multipart.ts` reads the body itself and
  keeps the name exactly as sent.
- An owner handler that catches `ApiRefusal` and returns swallows `401 not_signed_in`,
  so the sign-in dialog never opens. Every owner handler rethrows an ended session
  before looking at anything else.
- The inspector's device state is one stored object. Writing part of it back without
  the rest drops the other fields, which is how the offline reload lost its car.
- `overflow-x: hidden` on `html, body` breaks `position: sticky`, which silently stops
  the stage pinning. Use `overflow-x: clip`.
- Playwright's `locator.screenshot()` scrolls the element into view first, which moves
  the scroll-driven stage before the pixels are captured. Use `page.screenshot()` and
  offset by the stage's client rect.
- Every panel rim drawn with `depthTest: false` lets far-side rims paint across the
  body. Only the current panel needs to stand out, and it does so through its vertex
  colour profile, which peaks at each frame edge's midpoint.
- `tsc` runs before `esbuild` in the build. A type error leaves `dist` half written, so
  always read the build output rather than piping it to `/dev/null`.

## Checking the hard visual rules

`/tmp/visual2.mjs` (not committed) measures hero brightness and the lit panel rule from
real screenshots. Keep the margins positive if the scene changes.

## Run

`npm run build` then `npm run serve`. Health is `GET /api/health`. The seeded owner
passphrase is `bonnet-up-at-dawn`.
