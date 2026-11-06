# Turnstone Studio — repository notes

A self-hosted shop and publishing desk for one independent 3D model author.
Node.js 22, TypeScript with `strict`, no framework. PostgreSQL, MinIO, Kill Bill,
Mailpit and Meilisearch are the only datastores.

## Running it

```
npm ci          # install
npm run build   # compile server + client, assemble dist/public
npm run start   # serve on 0.0.0.0:4173 (or APP_PUBLIC_PORT)
npm run typecheck
npm run notices # regenerate THIRD_PARTY_NOTICES.md
```

`run.json` carries the same three commands for the harness.

The server listens immediately and answers `GET /api/health`. Schema creation,
the Kill Bill catalogue, the author account, index settings, the seed and the
reindex all run in the background and retry until they succeed, so the process
starts with any provider unreachable.

## Layout

| Path | What lives there |
| --- | --- |
| `src/config.ts` | Every environment value, read once at start. Nothing else reads `process.env`. |
| `src/shared/` | Code both the server and the browser use: locale formats, published copy, strings, labels, viewer geometry, palette, role routing. No Node APIs here. |
| `src/domain/` | The rules: plans, state machine, money, visibility and within-plan ranking, editions, slugs, billing cycle, identifiers, sessions. |
| `src/db/` | Pool, schema, seed and one repository per concern. |
| `src/services/` | The five providers, plus the search projection (`indexer.ts`), the mail outbox and the health monitor. |
| `src/media/` | glTF reading/scaling, glTF package assembly, binary STL, ZIP, PNG, the software preview renderer, the invoice PDF. |
| `src/queue/` | The five ordered stages, the worker and its retry schedule. |
| `src/http/` | Router, the one error shape, body limits, cookies, the dispatcher, static assets. |
| `src/api/` | Route handlers. `src/api/index.ts` is the route table. |
| `src/pages/` | Server-rendered HTML. `src/pages/routes.ts` is the page route table. |
| `src/client/` | Browser modules, compiled to ES modules and served from `/assets/js/client`. |
| `assets/` | `app.css` and the vendored woff2 fonts. |

## Where each rule is decided

The brief requires one place per rule. These are those places:

- Legal state moves — `src/domain/states.ts`
- Plan entitlements — `src/domain/plans.ts`
- Money and half-up rounding — `src/domain/money.ts`
- Within-plan ranking and read-only — `src/domain/model.ts`
- The visibility filter for every derived surface — `belongsInSearchIndex` in `src/domain/model.ts`
- Idempotent replay — `src/db/idempotency.ts`
- The edition claim — `src/db/editions.ts`
- Viewer geometry — `src/shared/viewer.ts` (server and browser share it)
- Published error codes and copy — `src/shared/copy.ts`, shaped by `src/http/errors.ts`
- Role landing and page access — `src/shared/roles.ts`

## Things worth knowing

- **The palette has one source.** `src/shared/palette.ts` feeds both the preview
  renderer and, through `scripts/build.mjs`, the `:root` custom properties
  prepended to `assets/app.css`.
- **Ring coordinates are canvas CSS pixels.** The server renders the ring at a
  nominal 960×720 and the browser re-measures on load and on resize.
- **Viewer data attributes hold end values at once**; only the drawn marks tween.
- **The search index is authoritative for public surfaces.** A removal is
  recorded in `search_removals` before the delete and cleared only once
  Meilisearch confirms; while one is outstanding every derived surface answers
  `search_unavailable`. `reindexAll` at start makes the index match the database
  exactly.
- **Kill Bill quirks.** The catalogue is uploaded as `text/xml`. A subscription
  body must not carry `productName` when it carries `planName`. A deferred
  downgrade needs `billingPolicy=END_OF_TERM` — `policy` is ignored there.
- **Seed numbers are load-bearing.** The brief pins them: 42 catalogue models,
  category 15/14/13, licence 42/29/9, format 42/32, and Survey Lantern at
  €18.37 / €55.11 / €146.95. A change to seed geometry or prices must keep them.
- **Empty live regions stay in the accessibility tree.** They lose their box but
  never `display: none`, or a later announcement is not read.

## Verification

There is no test framework in the repository. The suites used during
development live outside it and talk to a running server; re-create them as
needed. They cover: the API surface and error precedence, the upload/queue
pipeline, editions and the last-copy race, plans, outages through a toggleable
TCP proxy, page rendering and locales, email and PDF text, and browser
behaviour (viewer keys and geometry, catalogue address state, breakpoints,
reduced motion, keyboard checkout).

To reset the development database and index between runs, drop the public
schema tables and the Meilisearch index, then restart; the seed rebuilds.
