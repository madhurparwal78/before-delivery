# Airfold — repository memory

Halfpenny Post Co. Airfold: a web messenger for sealed one-to-one letters. Node server + browser client in one TypeScript app. PostgreSQL for accounts/conversations/letters/blobs/blocks; MinIO for sealed attachments; WebSocket for live updates.

## Layout

- `/app/run.json` — `run-manifest-v1` with `npm ci` / `npm run build` / `npm start`. Port 4173 (`APP_PUBLIC_PORT`).
- `src/shared/` — the sealing scheme, shared by the browser and the tests. `sealing.ts` is the one implementation of the published scheme; `sealing-spec.ts` the constants; `username.ts` the username rules.
- `src/server/` — config, clock (grading offset), db pool, store (schema), accounts (sign-up, sessions, recovery, username changes), conversations (delivery states, unread counts, seal status), posting (the 409 ladder), object-storage (S3), hub (WebSocket), routes (every published endpoint), sweep (30-day returns), main (boot, static client, SPA fallback).
- `src/client/` — store (IndexedDB: identity, outbox, letter bodies), identity (non-extractable private keys, sealing), photos (re-encode, no metadata), app (state controller: collection, outbox retries, toasts), main (every screen and dialog), dom (element helper, focus trap), api (the published API from the browser).
- `public/` — the built client: `index.html`, `app.js` (esbuild bundle), `styles.css`, `fonts/` (Zilla Slab woff2 + OFL licence).
- `test/` — `shared.mts` (the scheme), `api.mts` (the endpoints), `live.mts` (clock rules, WebSocket), `interop.mts` (an independent implementation of the scheme), `browser*.py` (the eight journeys, attachments, viewports, reduced motion, touch). Run with `node test/run.mjs <suite>`; the browser suites need a running server.

## Things that bit us, and their fixes

- Sessions created inside a sign-up transaction must use the **transaction's client**, not the pool: the uncommitted account row is invisible to other connections (FK violation).
- Conversation sides record the **peer's** current key in `accepted_key_id`, and the seal status is computed from the **sender's** side record. Getting the key direction wrong makes every conversation show `changed` and refuse every letter.
- Blocking: the blocker cannot post (409 `contact_blocked`); the blocked person's posts are answered 201 `sent` but must never be delivered, even after unblocking. The letter row carries `blocked_post` so the inbox and ack skip it for good.
- Returns are applied on **every read** of the affected rows (`letterById`, `lettersOfConversation`, `inboxFor`) plus the 10-second sweep; the grading clock drives them.
- Express 5 uses regex routes (`app.get(/.*/)`); `*` paths throw `PathError`. Inside a router mounted at `/api`, `req.path` has **no** mount prefix.
- The `keys` WebSocket frame must actually be **sent** (to every correspondent) when a recovery changes an account's current key; the client's key-change warning depends on it.
- The browser render is guarded by a signature: re-render only when the material on screen changed, and include the signup step, the conversation load state and the hidden-letter count. Chip updates go through a **quiet** listener so typing keeps its focus and value.
- The fold animation is appended to `document.body` (fixed over the composer); renders replace the panes and would detach it mid-sequence.
- A photo or file being prepared disables Send and the composer waits for the preparation promise, so a letter can never leave before its attachment is sealed.
- Toasts are raised once per letter id: the held frame and the delivered frame describe the same letter.
- Escape for dialogs is heard at the **document** level; focus can sit on a re-rendered opener button.

## Environment

`DATABASE_URL`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `APP_PUBLIC_PORT`, `GRADING` (enables the grading routes and `?skip_recovery_check=1`), `ATTACHMENT_MAX_BYTES`, and the six timers. No credential is hard-coded; the client loads no remote anything.

## Fonts

Zilla Slab was built from the Mozilla `zilla-slab` UFO sources (`fontmake`), subset to Latin as woff2 with `fonttools`, and shipped with the SIL OFL licence at `public/fonts/OFL.txt`. `scripts/notices.mjs` regenerates `THIRD_PARTY_NOTICES.md` from the installed production tree and fails the build if any package falls outside MIT/ISC/BSD-2-Clause/BSD-3-Clause/Apache-2.0/0BSD.
