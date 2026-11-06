# Rungboard — repository notes

Rungboard is the booking and casting workspace of Vesper & Rowe Talent: one
TypeScript web app with a JSON API, backed by PostgreSQL, MinIO, Kill Bill and
Mailpit. `/app/run.json` holds the install, build and serve commands.

## Layout

- `src/shared` — code both sides use: `zone.ts` (IANA time-zone and civil-date
  arithmetic), `format.ts` (every published display format), `types.ts` (API shapes).
- `src/server/domain` — the domain rules, each decided in exactly one place:
  `offices.ts` (business days, automatic release, hold-until), `fees.ts` (day,
  overtime, usage, service-fee split, tax), `licences.ts` (term, end instant,
  status), `statements.ts` (lines, totals, recoupment), `roster.ts` (import units
  and matching), `csv.ts`, `ics.ts`, `age.ts`.
- `src/server/data` — SQL access per record family.
- `src/server/api` — route tables; every route declares auth, roles, body kind,
  file limit and idempotency, and the pipeline in `src/server/http/router.ts`
  applies the one error precedence (routing, 429, 401, 404/410, 403, size and
  type, idempotent replay, 409/412, 422, then 503).
- `src/server/services` — Kill Bill, MinIO (own SigV4 client), SMTP (own client),
  the ZIP writer and the image pipeline.
- `src/client` — vanilla TypeScript SPA: `lib/router.ts` (history, route cover,
  heading focus and titles), `lib/motion.ts` (only 140/300/560 ms), `lib/dialog.ts`
  (focus trap, sheets), `lib/forms.ts` (live regions, Problems summary, pending
  copy), `screens/*`.
- `public/` — stylesheet and the two bundled fonts (Fraunces, Hanken Grotesk).

## Things worth remembering

- **Image decoding runs in a child process** (`dist/server/image-worker.js`).
  `@napi-rs/canvas` segfaults on malformed JPEGs, so decoding must never happen
  in the server process. The decoder already applies EXIF orientation, so the
  worker only scales and re-encodes.
- The outbox `dedupe_key` index must be a plain unique index; a partial index
  cannot be used as an `ON CONFLICT` target.
- Published controls fix some roles: `Client`, `Hold until`, `Shoot date` and
  `Date of birth` are plain text inputs, because `type=date` or a `list`
  attribute changes the ARIA role away from `textbox`.
- Answers carry `Cache-Control: no-store`; a cached 410 would otherwise keep a
  restored talent looking withdrawn.
- A 413 answer sets `Connection: close` and destroys the socket after the
  response, so the client can still read it.
- Sweep, mail delivery and seeding are safe with several copies: advisory locks
  plus `ON CONFLICT` claims and `FOR UPDATE SKIP LOCKED`.

## Checks

- `npm run typecheck` — strict TypeScript, no `any`.
- `npm run notices` — regenerates `THIRD_PARTY_NOTICES.md` and fails if a
  production licence falls outside the allowed list.
- `npm ci && npm run build && npm start` — the run manifest; health answers at
  `GET /api/health`.
