# Rimewire — repository notes

Team messenger for refrigeration and HVAC contractors. Node 22 + TypeScript,
PostgreSQL and MinIO only, mail through a local SMTP server.

## Layout

- `src/shared/` — code used by both sides: `zone.ts` (business time zone
  arithmetic and the one `<when>` format), `linkify.ts` (the message-text link
  rule), `chips.ts` (delivery-chip derivation), `copy.ts` (error and field
  copy), `api.ts` (wire shapes).
- `src/server/` — `config.ts`, `clock.ts` (the app clock), `errors.ts` (the one
  error shape and status map), `schema.ts`, `seed.ts`, `domain/` (one module per
  domain rule), `routes/`, `services/`, `jobs/`, `http/` (pipeline, router,
  multipart, assets).
- `src/web/` — React browser app. `Shell.tsx` orchestrates; panels, dialogs,
  message list, receipts scrubber are separate files.
- `assets/` — `index.html` and self-hosted fonts, copied into `dist/public`.

## Build and run

- `npm run build` → `tsc -p tsconfig.server.json` into `dist/`, esbuild bundles
  `src/web/main.tsx` into `dist/public/app.js` + `app.css`, then `assets/` is
  copied over. Fonts are marked `--external:/fonts/*` so esbuild leaves the
  `@font-face` URLs alone.
- `npm run serve` → `node dist/server/index.js`, binding `0.0.0.0:4173` or
  `APP_PUBLIC_PORT`.
- Schema and seed are applied on every serve under an advisory lock.

## Decisions worth remembering

- **Event log.** `event_log` rows are appended through `publish()` in
  `domain/events.ts`, under one advisory lock so ids become visible in order.
  `DELIVERABLE_SQL` is the single rule for which logged events a person may
  receive, used for both live delivery and resume. `channel.updated` and
  `channel.added` payloads are materialised per viewer at delivery time.
- **Deleted messages** keep their row with `deleted = true` so a replayed send
  can answer `message_deleted` and so a root with replies stays a placeholder.
  History filters them unless they still have replies.
- **Sends** take `pg_advisory_xact_lock(hashtext('send:' || author))`, which
  makes both idempotency and the send-rate count exact under simultaneous
  sends. Photo objects are written before the message row exists and removed
  again when a send loses its race.
- **Removal queue** lives in `removal_queue`; `flushRemovalQueue()` runs every
  30 seconds so a storage outage never blocks a delete.
- **Mail** goes out through a small SMTP client in `services/smtp.ts` (no
  third-party mail dependency, which also keeps the licence list clean).
  Invites use the `outbound_emails` queue; digests are sent inside a
  transaction that also marks their mentions handled, so a mail outage leaves
  the run to be retried.
- **Scrubber anchoring**: `ReceiptsPanel` keeps an instant, not a percentage,
  and recomputes its position as the track grows.
