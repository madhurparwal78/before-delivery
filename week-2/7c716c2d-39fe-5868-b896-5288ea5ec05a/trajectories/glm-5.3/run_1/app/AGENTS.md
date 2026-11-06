# Tallyroom Workspace — implementation notes

One TypeScript web app: a Node.js 22 server (`src/server`) serving the API, the
event stream and the built browser bundle, plus a React client (`src/client`).

## Key files

- `src/server/calendar.ts` — counted days, cycle boundaries, the calendar in
  effect on a date, calendar validation. Every cycle question routes through here.
- `src/server/tz.ts` — the timezone engine (Intl-based): local midnight across
  clock changes, offsets, ISO instants with the workspace offset.
- `src/server/scope.ts` — per-viewer visibility (`visibleScope`) and the request
  context (`requireCtx`), which carries the workspace zone and today.
- `src/server/store.ts` — mutations that emit events: issues, messages, unread
  derivation, docs and versions.
- `src/server/api.ts` — the route table, idempotency records and error precedence.
- `src/server/dispatch.ts` — the SSE endpoint and the live dispatch loop; the
  per-event access check lives in `projectAndSend`.
- `src/server/jobs.ts` — the timed sweeps: typing lapses, presence, knock expiry,
  stream grace, digests, seat-limit adoption, retention, outbox delivery probes.
- `src/server/billing.ts` — the Kill Bill account/subscription chain, the
  confirmed `seats` custom field and `seats_scheduled` reductions.
- `src/client/main.tsx` — routing, landing rules, module panes and the pickers.

## Environment quirks discovered while building

- Kill Bill (this build) has no global custom-field resource: values are updated
  by delete (`DELETE /subscriptions/{id}/customFields?customField={id}`) plus
  create, and the delete can lag the create for a moment, so writes poll.
- The `/1.0/kb/accounts?externalKey=...` lookup answers with a single object,
  not an array.
- Dev test suites live in `/tmp` (`journey-test.mjs`, `deep-test.mjs`,
  `multicopy-test.mjs`, `outage-test.mjs`, `mailoutage-test.mjs`,
  `shift-test.mjs`); a headless Chromium for them is under
  `/tmp/pw-browsers` (needs the apt libs installed).
