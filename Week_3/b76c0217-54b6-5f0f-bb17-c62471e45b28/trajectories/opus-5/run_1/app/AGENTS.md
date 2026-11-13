# Galley — repository notes

Galley is a hosted documentation platform (Sorts & Quoins). One TypeScript app serves both the
signed-in editor and the public reader site on one origin and port. Backing services: Postgres,
MinIO, Mailpit, and nothing else.

## Layout

```
run.json                 install / build / serve commands (run-manifest-v1)
scripts/build.mjs        esbuild build: server bundle, client bundles, css, fonts
src/server.ts            http server, router table, error mapping, boot
src/config.ts            every environment variable, read once at start
src/http/                router, request helpers, the one error shape
src/db/                  pool, idempotent schema, and the SQL per area
src/domain/              the rules: paths, anchors, markdown + components, gate,
                         redirects, search, analytics, openapi, messages
src/services/            storage (SigV4 by hand), mail (SMTP by hand), events (SSE),
                         publisher, renderer, outage switch, demo seed
src/api/                 request handlers and the three JSON documents
src/ui/                  server-rendered HTML (shell, reader, editor, screens)
src/client/              browser TypeScript (dom helpers, reader, editor, tree, splice, drawer)
src/styles/app.css       the one stylesheet
```

## Rules that live in exactly one place

| Rule | File |
| --- | --- |
| Every visible and announced string | `src/domain/messages.ts` |
| Path rule | `src/domain/paths.ts` |
| Anchor rule (h2/h3, `-2` repeats) | `src/domain/anchors.ts` |
| Page source parsing, component validation, rendering, link rewriting | `src/domain/markdown.ts` |
| Gate problems and their order | `src/domain/gate.ts` |
| Redirect collapsing, loop detection, public resolution | `src/domain/redirects.ts` |
| Search bands and order | `src/domain/search.ts` |
| Helpful percentage | `src/domain/analytics.ts` |
| Publish status transitions and snapshots | `src/services/publisher.ts` |
| Error codes, statuses and precedence | `src/http/errors.ts` |

## Things worth remembering

- Saved state is read only through page JSON, navigation JSON and publish-report JSON
  (`src/api/documents.ts`). Tests never read the schema.
- Client timers run on page timers (`setTimeout`, `requestAnimationFrame`, `performance.now`)
  because the verifier pauses the page clock. Never drive state from CSS transition events.
- The sidebar element doubles as the modal drawer below 768 pixels (`src/client/drawer.ts`);
  the header's `Sections` tabs and version switcher are *moved* into it, never duplicated,
  so role queries stay unambiguous.
- The editor tree is re-read from the server HTML on navigation events
  (`src/client/tree.ts`), which keeps markup in one place. Refreshes are held off while a
  splice or inline rename owns the rows, and finished `data-splice` states survive a refresh.
- A `page` event is not adopted into an open editor; only a `navigation` event makes a clean
  editor re-read its source, so another editor's save still meets the revision conflict.
- MinIO is reached with hand-rolled SigV4 (`src/services/storage.ts`) and Mailpit with a
  hand-rolled SMTP client (`src/services/mail.ts`); production ships only `pg`.
- `ensureBucket` runs in the background at boot so an unreachable MinIO cannot delay listening.

## Checking it by hand

```
npm ci && npm run build && node dist/server.js
curl -s localhost:4173/api/health
```

Demo sign-in: `ines@quire.test` / `quire-owner-2026` (owner), `dara@quire.test` /
`quire-editor-2026` (editor), `lev@quire.test` / `quire-viewer-2026` (viewer).
Grading routes (`GRADING_ROUTES=on`): `POST /api/grading/seed`, `POST /api/grading/outage`.
