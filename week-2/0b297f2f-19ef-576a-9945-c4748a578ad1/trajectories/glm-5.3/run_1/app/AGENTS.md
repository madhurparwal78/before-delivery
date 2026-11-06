# Hangline — repository notes

Shared 3D exhibition planner for temporary exhibitions (curators, registrars,
preparators, lenders). See the brief in the task history for the full
requirements; this file records how the code is laid out and the conventions
that must hold.

## Stack and layout

- Node.js 22, TypeScript, npm. No frameworks: `server/` is a plain `http`
  server (`node build/server/main.js`), `client/` is an esbuild IIFE bundle.
- `run.json` manifest: install `npm ci`, build `npm run build`,
  serve `npm run start`. Port 4173 (or `APP_PUBLIC_PORT`).
- Services: Postgres (`DATABASE_URL`), MinIO (`S3_*`), Mailpit (`SMTP_*`).
  No other datastore (IF-04). Config only from env (DP-87).
- `server/s3.ts` is a hand-rolled SigV4 S3 client (Put/Get/Head only).
- `server/mail.ts` speaks SMTP over a raw socket; `server/zone.ts` implements
  the Europe/London DST rules; `server/png.ts` encodes the snapshot PNGs.
- Fonts ship in `public/fonts` (Instrument Serif, Hanken Grotesk, OFL-1.1);
  licences listed in `THIRD_PARTY_NOTICES.md`.

## Domain rules, each decided in exactly one place

- Hang rules and their order (off_wall, off_centre_line, too_close, too_bright):
  `server/rules.ts#checkHangRules`. Rejection copy: `hangRejectionMessage`.
- Placement and preview transitions: `canTransition` / `canPreviewTransition`.
- Undo window (10 s, server clock): `undoWindow`; remaining time `remainingMs`.
- Unit conversion (cm/in → whole mm, half-up): `server/units.ts#unitToMm`.
- Lux-hours (planned lux × 686 open hours) and lux status: `server/store.ts`
  `toPlacement` (single projection used by every read path).
- Publish time (09:00 Europe/London, 2-hour minimum, or
  `PREVIEW_PUBLISH_DELAY_SECONDS`): `server/api.ts#schedulePreview`.
- Events: `server/api.ts#writeEvent` — every state change writes exactly one.
- Display strings (`...museum time`): `server/dates.ts#display`.

## Gotchas learned while building

- Reads inside a transaction must use the transaction client (`store.x(id, client)`),
  otherwise uncommitted rows are invisible and fresh placements 404.
- Photo uploads have raw bodies: their route is matched before the JSON body
  reader in `Api.route`.
- Oversized bodies: reject with 413, then destroy the request — never destroy
  first or the response never reaches the client.
- The browser page route `/p/<token>` serves HTML; `/api/p/<token>` serves the
  frozen snapshot JSON. Don't route both through the API handler.
- Announcements and team-updates text must be kept in component state and
  re-rendered: `replaceChildren` wipes live regions otherwise.
- The client marks its own action `seq` values as seen (`markOwnSeq`) so a tab
  never announces its own changes as team updates.
- Editing a placed object must send only changed fields: the API refuses
  width/height changes while placed (409 object_placed).
