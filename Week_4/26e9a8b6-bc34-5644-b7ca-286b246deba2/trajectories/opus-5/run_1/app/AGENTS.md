# Pennywasher — repository notes

Community repair guides built on an uploaded `.glb`: named parts, numbered
steps, versions, forks and embeds. TypeScript throughout, Postgres + MinIO +
Mailpit, no other datastore.

## Layout

```
src/shared/    rules both the browser and the server run (one place each)
  copy.ts        every piece of page text from Feedback states
  cost.ts        running parts cost, guide total, cost formatting
  glb.ts         binary glTF container checks, parts, node paths
  limits.ts      the configurable limits and code-point counting
  palette.ts     the colour roles; the stylesheet reads them as custom properties
  scrollmap.ts   the published scroll mapping and motion durations
  worddiff.ts    word-by-word diff for the version compare
src/server/
  domain/        guides, working copy, versions, publishing, search, engagement
  http/          router, error shapes and precedence, responses, context
  render/        server-rendered HTML
  routes/        API and page routes
  storage/       S3 (SigV4, no SDK) and the cached storage health
  mail/smtp.ts   minimal SMTP client
  live.ts        the one WebSocket live hub (presence, edits, questions, …)
src/client/      stage (three.js), reader, editor, screens, frame loop
src/tools/       sample .glb generation, run by the build
```

## Running

- `npm run build` bundles the server, the client and the sample models.
- `npm run serve` starts on `APP_PUBLIC_PORT` (4173).
- Rebuild and restart locally with `npm run build && npm run serve`.

## Checks

All development checks need a running server on `127.0.0.1:4173`.

| Script | Covers |
| --- | --- |
| `node scripts/smoke.mjs` | API, seed data, versions, forks, limits, precedence |
| `node scripts/browser-reader.mjs` | scroll mapping, deep links, reduced motion, stills, phone |
| `node scripts/browser-editor.mjs` | keyboard authoring, undo/redo, versions, upload, co-editing |
| `node scripts/browser-journeys.mjs` | forks, questions, discovery, likes, embed, sound |
| `node scripts/instance-checks.mjs` | `short-limits` and `storage-down` instances, boundary, secrets |
| `node scripts/generate-notices.mjs` | rewrites `THIRD_PARTY_NOTICES.md` and fails on a bad licence |

## Things worth remembering

- The reader's scroll spine is sections of `var(--vh)`; the phase field for
  step n is absolutely placed at `(n + 0.65) x H` so it fills the viewport at
  that step's settled position.
- `--vh`, `--wordmark-height` and `--bar-height` are measured by the client,
  because the reader bar wraps and the mapping needs the real window height.
- Dialogs must be found with `dialogNamed`, never `byLabel`: a reader-bar
  button and its dialog share an accessible name.
- A live `field` change from the same account in another tab is applied like
  anyone else's; only *uncommitted text in that field* opens `Edit conflict`.
- Pages answer `Cache-Control: no-store`, or a `410` withdrawn page sticks in
  the browser cache after the guide is published again.
- The cached storage health is primed during boot, so the first reader render
  on `storage-down` already knows.
- MinIO confirms an upload with `x-amz-checksum-sha256` on PUT and a HEAD with
  `x-amz-checksum-mode: ENABLED`; a row counts as stored only after that.
