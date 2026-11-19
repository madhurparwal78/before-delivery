# Moothall — repository notes

Moothall is the Larkspur Signal Co. community app: TypeScript on Node 22, four backend services
(Postgres, MinIO, Mailpit, Valkey), served from one origin on `APP_PUBLIC_PORT` (default 4173).

## Layout

```
run.json                 install / build / serve manifest (npm ci, npm run build, npm run start)
scripts/                 bundle-client.cjs (esbuild + assets), licenses.cjs (THIRD_PARTY_NOTICES.md)
src/core/                config, db pool and schema, seed, errors, crypto, time
src/domain/              the domain rules, each decided in exactly one place
src/services/            valkey (events, replay, rate limits), s3 (SigV4), image codecs, mail
src/server/              http boundary, routing, guards, routes/*
src/web/                 server-rendered pages (layout.ts, pages.ts)
src/shared/              copy strings, formats, html helper, renderers used by SSR *and* the client
src/client/              browser modules bundled to /static/app.js
src/assets/              app.css, icon.svg, bundled OFL fonts
```

## Where each rule lives

| Rule | File |
| --- | --- |
| Error shape, codes, statuses | `src/core/errors.ts` |
| Error precedence | `src/server/http.ts` (`applyBoundary`, guards) and each route's check order |
| Hot rank | `src/core/schema.ts` (`hotRankSql`) |
| Cursor format | `src/domain/cursor.ts` |
| Vote arithmetic, score and hot rank in one transaction | `src/domain/votes.ts` |
| Derived counters (`commentCount`, `descendantCount`) | `src/domain/comments.ts` |
| Post state machine, versions, pins, locks, mod log | `src/domain/moderation.ts` |
| Markdown subset and allow-list (the renderer only ever emits allowed elements) | `src/domain/markdown.ts` |
| Projections (exact key sets) | `src/domain/posts.ts`, `comments.ts`, `communities.ts`, `reports.ts`, `viewer.ts` |
| Two-factor requirement | `src/domain/communities.ts` (`requiresTwoFactor`) and `src/server/guards.ts` |
| Idempotency | `src/domain/idempotency.ts` |
| Every visible string | `src/shared/copy.ts` |
| Card, comment tree, table markup (one implementation for SSR and live updates) | `src/shared/render.ts` |

## Development

```sh
npm ci && npm run build          # tsc (server) + tsc (client, noEmit) + esbuild + licence audit
npm run start                    # serves on 4173, applies schema and seed first
```

The licence audit fails the build if a shipped package is not permissive, so new dependencies must
be MIT/ISC/BSD/Apache-2.0/0BSD/BlueOak/OFL. `sharp` is deliberately avoided (libvips is LGPL);
images go through the `@jsquash` wasm codecs instead, and markdown and S3 signing are written here.

Seeded accounts use the password `moothall-seed-2026`; `larkspur_admin` is the site admin and its
two-factor secret is `JBSWY3DPEHPK3PXP`.

## Grading-style instances

```sh
APP_PUBLIC_PORT=4174 S3_ENDPOINT=http://127.0.0.1:9 node dist/server/main.js   # storage down
APP_PUBLIC_PORT=4175 VALKEY_URL=http://127.0.0.1:9 node dist/server/main.js    # live service down
APP_PUBLIC_PORT=4176 LOCK_HOUR_SECONDS=4 REPORT_DEADLINE_SECONDS=8 ... node dist/server/main.js
```

`GRADING_KEY` unlocks `/api/grading/*` (and every call needs `X-Grading-Key`); without it those
routes answer 404.

## Gotchas found while building this

- Postgres `log(double precision)` is base 10, which is what hot rank needs; `sign()` must be cast.
- `hotRankSql` reads `created_at`, so a post is inserted with rank 0 and updated in the same
  transaction rather than computing the rank inside `insert ... values`.
- A suspended account's sessions are revoked, so `memberForSession` must still find the revoked row
  to answer 403 `SUSPENDED` instead of 401.
- ioredis needs `enableOfflineQueue: false` for commands (so votes fail fast) but `true` for the
  subscriber (so its `subscribe` survives a slow connect).
- The timed-lock sweeper emits `post-state` on the Valkey prefix of the instance that sweeps, so
  instances sharing one database but using different `VALKEY_KEY_PREFIX` values will not see each
  other's expiry events. Each grading instance has its own database, so this only shows up locally.
- `rollScore` keeps the text it should end on in `dataset.rolling`, otherwise an optimistic roll
  that finishes after a rollback writes the stale score back.
- The fold pill must be in the page before the fold animation starts, or focus cannot move to it.
