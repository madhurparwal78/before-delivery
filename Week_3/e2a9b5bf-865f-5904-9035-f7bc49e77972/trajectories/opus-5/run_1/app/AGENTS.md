# Lowlamp Field Log — repository notes

A night-first observing log for one backyard deep-sky observer. One web app over
four services: Postgres, MinIO, Gotenberg and an SMTP server.

## Running it

Everything starts from `/app/run.json`:

```
install  npm ci
build    npm run build        # scripts/build.mjs, esbuild
serve    npm run start        # node dist/server/index.js
```

The server binds `0.0.0.0` on `APP_PUBLIC_PORT` (default 4173). `GET /api/health`
answers `{"status":"ok"}` once Postgres is reachable and `503 {"status":"starting"}`
until then, retrying every two seconds.

All configuration is read from the environment at start: `DATABASE_URL`, the
`S3_*` set, `GOTENBERG_URL`, `SMTP_HOST`/`SMTP_PORT`, `MAIL_FROM`,
`SIGNIN_LOCK_SECONDS`, `SIGNIN_SESSION_SECONDS`. Nothing is hard-coded and
nothing reaches the browser.

## Layout

```
src/shared/   domain rules used by both the browser and the server
src/server/   http boundary, routes, providers, persistence
src/client/   the single-page app (vanilla TypeScript, no framework)
scripts/      build.mjs and domain-check.ts
```

## Each domain rule lives in exactly one place

| Rule | File |
| --- | --- |
| Derived optics, the train table, default optics | `src/shared/optics.ts` |
| The projection, its inverse, the keyboard cursor | `src/shared/projection.ts` |
| A measured pair's separation and position angle | `src/shared/pair.ts` |
| The completeness rule and the choice of rule edition | `src/shared/completeness.ts` |
| Evening dates, wall clocks and UTC offsets | `src/shared/clock.ts` |
| Packet transitions and which action is legal | `src/shared/packet-state.ts` |
| The safe `next` path | `src/shared/next-path.ts` |
| Every published string | `src/shared/messages.ts` |
| Packet page layout, shared by the PDF and the preview | `src/shared/packet-page.ts` |
| Field-level conflict resolution | `src/server/field-resolution.ts` |
| The order that decides an observation delete | `src/server/observation-delete.ts` |
| The sign-in lock | `src/server/signin-lock.ts` |
| The one API error shape | `src/server/errors.ts` |

## Things worth knowing before changing code

- **Half-up rounding.** `roundHalfUp` in `src/shared/round.ts` nudges by a
  relative epsilon so a true half such as 33.5′ rounds up to 34′.
- **The field circle has no CSS border.** Its rim is drawn on the canvas, so the
  canvas radius and the circle's radius are the same number of pixels. A border
  would shift every pointer-placed mark by one pixel's worth of arcminutes.
- **The client never repaints optics from a server reply.** The browser and the
  server share `deriveOptics`, so the newest local pick is already the answer.
  A Field swap starts only from a local pick.
- **`view = device copy + journal`.** `src/client/derive.ts` applies the queued
  changes over the last known server state. The DP-68 exemptions (unsaved typing,
  a later queued change) and offline progress fall out of this, rather than being
  special-cased.
- **One sender across tabs** uses the Web Locks API (`lowlamp-sender`), held only
  while a sync is in flight. A tab that closes releases it at once.
- **Sign-in attempts commit their own record.** The attempt transaction returns a
  result rather than throwing, because a throw would roll back the failure it
  just recorded and the lock would never form.
- **Seeded stroke files** are kept in the `seeded_strokes` table and written to
  MinIO by a reconciler, so the app seeds cleanly while storage is down.
- **`strokes_has_marks`** is a separate column: an observation "has a sketch"
  only when its current stroke file holds at least one stroke or star, while the
  stored bytes are kept either way.

## Checking it

`scripts/domain-check.ts` walks every worked example in the brief (derived
optics, the projection table, pair values, evening dates over a fall back, rule
editions, the safe `next` path, stroke file parsing):

```
npx esbuild scripts/domain-check.ts --bundle --platform=node --format=esm \
  --target=node22 --outfile=/tmp/domain-check.mjs && node /tmp/domain-check.mjs
```

`npx tsc --noEmit` typechecks `src` and `scripts` under strict settings. There is
no `any` in domain code.
