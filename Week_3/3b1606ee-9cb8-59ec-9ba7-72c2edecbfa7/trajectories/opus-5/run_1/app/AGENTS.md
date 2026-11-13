# Airfold — repository notes

Halfpenny Post Co. Airfold: a sealed one-to-one web messenger. One TypeScript app —
a Node server (`src/server`) and a browser client (`src/client`) sharing `src/shared`.
PostgreSQL holds accounts, conversations, sealed letters and delivery state; MinIO holds
sealed attachments and profile photos; live updates travel over `/ws`.

## Layout

- `src/shared/scheme.ts` — the published sealing scheme (padding, base64url, limits). One place.
- `src/shared/types.ts` — the API records.
- `src/server/domain/*` — one rule per module: `usernames`, `delivery` (every letter state
  change), `unread`, `access` (participant access), `retract` (the 24 hour window), `keys`,
  `sealed`, `conversations`.
- `src/server/routes/*` — endpoint handlers, following the published error order
  (boundary, 401, 404, 403, replay, 409, 413/422, 503).
- `src/client/crypto/*` — Web Crypto only: identity keys (non-extractable), conversation
  keys, letter and profile sealing, recovery codes, seal numbers.
- `src/client/data/*` — IndexedDB stores, API client, state store, persistent outbox,
  inbox collection, socket.
- `src/client/ui/*` — screens, dialogs, postmarks, motion, live regions.

## Build and run

- `npm run build` → `dist/server/index.js` (esbuild ESM bundle; `pg`/`ws` bundled,
  `pg-native`/`bufferutil`/`utf-8-validate` external) and `dist/client/**`.
- `node scripts/restart.mjs` restarts the built server locally (this box has no `ps`/`pkill`).
- `node scripts/smoke.mjs` runs the whole API with `scripts/scheme.mjs`, a second and
  independent implementation of the sealing scheme (so it also proves scheme interop).
- `node scripts/notices.mjs` rewrites `THIRD_PARTY_NOTICES.md` from the production tree.
- Browser journeys live outside the app in `/opt/uitest` (Playwright, Chromium) and cover
  the eight journeys plus layout, motion, outage and corrupted-attachment checks.

## Decisions worth remembering

- A restored browser cannot open its own old sealed profile, so contacts keep the last
  profile they opened in their own IndexedDB cache and the name survives a key change.
- The post answer and the socket frame race, so a letter's stored state never goes
  backwards (`latestState` in `src/client/data/store.ts`).
- Delete for me is held in memory only until the undo window ends, so a reload keeps
  the letter, as the brief requires.
- Composer, header, stub and foot are rebuilt only when they change; replacing a focused
  element blurs it.

## Gotchas

- `pg` is CommonJS: the server bundle injects `createRequire` in a banner.
- This container has no `ps`, `pkill` or `file`; use `/proc` (see `scripts/restart.mjs`).
- `atob` throws on base64 lengths ≡ 1 (mod 4): `isBase64url` rejects those.
- Timestamps use `timestamptz(3)`; `seq` is a global identity column on `letters`.
- Grading routes only exist when `GRADING=1`; the grading clock offset lives in the
  `clock_offset` table and every server rule reads `serverNow()`.
