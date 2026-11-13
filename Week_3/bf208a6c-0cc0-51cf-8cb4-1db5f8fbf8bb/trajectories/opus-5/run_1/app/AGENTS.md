# Pinsheet — repository notes

Self-hosted live post board service. TypeScript on Node 22, Postgres, MinIO, SMTP (Mailpit) and ntfy only.

## Layout

- `src/shared/` — types, copy strings (`copy.ts` holds every published string), validation, the permission table. Imported by both sides so each rule lives in one place.
- `src/server/` — `index.ts` (http server, page routes, static files, error mapping), `boards.ts` (board rows plus the access rules of error-order 2 and 3), `posts.ts` (post rows, displayed order, hand order, sort/group gates), `events.ts` (event log plus the SSE hub), `services.ts` (service status and the 10 second workers), `storage.ts` (SigV4 S3 client), `mail.ts` (minimal SMTP client), `push.ts` (ntfy), `routes/`.
- `src/client/` — `main.ts` dispatches on the server-injected bootstrap; `board/view.ts` owns the board screen (shell, keyed sheet reconciliation, live events), `board/move.ts` (keyboard and pointer moves), `board/loupe.ts`, `board/dialogs.ts`, `board/slideshow.ts`.
- `scripts/build.mjs` — type-checks both sides, compiles the server with tsc, bundles the client and the stylesheet with esbuild, copies the Work Sans woff2 files.

## Things worth remembering

- Pages are server-rendered shells. `/b/:id`, `/s/:token`, `/embed/:token` and `/invite/:token` decide their HTTP status on the server: 404 for anything a caller cannot open, 200 with the password screen for a locked password board.
- Session and unlock cookies are HMAC-signed values (`session.ts`); the key is derived from environment secrets, so no secret ever reaches the browser.
- Every mutation records its event inside the same transaction and calls `flushBoard` after the commit. The hub re-resolves each subscriber's access on every flush, which is what makes revocation (rotate, privacy, password, removal, delete) close streams with `access_lost`.
- The client refetches the listing after each event, so screens always match `GET /api/boards/<id>/posts`.
- Frames are reused by post id so the Loupe lift can grow the same element and FLIP can animate moves. `renderSheet` restores focus after DOM reordering, because detaching a focused node blurs it.
- Drags aim at a slot and only reflow on the drop; keyboard steps reflow on every arrow because each step is announced.
- Intentional navigation away from a board uses `view.leaveAfter`, so the stream's `access_lost` reload does not abort the request.

## Local checks

```
npm run typecheck && npm run build && npm run start
```

Playwright specs used during development live outside the repository (`/tmp/qa`); the grading fixture at `POST /api/grading/fixture` with `X-Grading-Key` seeds users, boards and posts for them.
