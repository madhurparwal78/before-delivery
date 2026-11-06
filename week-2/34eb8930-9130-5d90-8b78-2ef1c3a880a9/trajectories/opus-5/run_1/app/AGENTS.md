# Quillmere Drafts — repository notes

Live proposal editor for a grant-writing consultancy. Node 22, TypeScript everywhere,
PostgreSQL plus an S3-compatible bucket, no other datastore.

## Run

- `npm ci`, `npm run build`, `npm run start` (see `/app/run.json`).
- `npm run build` typechecks both projects, bundles the server and the browser app with
  esbuild, and copies the fonts and icons into `dist/public`.
- `npm run notices` regenerates `THIRD_PARTY_NOTICES.md` from the production tree.
- Config comes from the environment only: `DATABASE_URL`, `S3_*`, `APP_PUBLIC_PORT`,
  `PRESENCE_IDLE_SECONDS`.

## Shape of the source

```
src/shared/   types.ts (domain unions), doc.ts (document model), ot.ts (transform)
src/server/   http.ts + routes.ts (API), socket.ts (one hub), livedoc.ts (live body + saving),
              edits.ts (op frames, suggestions, decisions, comments), shares.ts, access.ts,
              permissions.ts, modes.ts, notices.ts, seed.ts, storage.ts (SigV4 by hand)
src/client/   main.ts router, signin.ts, home.ts, editor/* (session, page, margin, toolbar,
              outline, find, share), app.css
```

Each domain rule lives in one place: the role table in `permissions.ts`, visibility in
`access.ts`, share expiry in `shares.ts`, suggestion crediting and first-decision-wins in
`edits.ts`, save state in `livedoc.ts`/`snapshot.ts`, idle presence in `socket.ts`.

## How the live editing works

- The server owns one revision counter per proposal. Every accepted op frame, decision,
  Accept all, Reject all and replace_all adds exactly 1 and is recorded in `operations`
  as **text primitives** (insert, delete, mark, style) in the order applied.
- Broadcast `op` frames carry those primitives, so every screen applies the same text
  change. Suggestion strikes and underlines come from the card records, never from the ops.
- A screen keeps an outbox: one frame in flight, the rest queued. When a remote frame
  arrives, queued frames are rebased (the server rebases the in-flight one from its own
  `baseRevision`), and the local caret moves with the remote edits.
- `src/shared/doc.ts` runs on both sides, so offsets, blocks, marks and card ranges stay
  identical.

## Storage

- One object per proposal at `documents/<id>.json`, written within ~250 ms of a change and
  retried every 5 s after a failure. `saved`/`save_failed` frames drive the save status.
- Seeded proposals start at revision 1 with `savedRevision` 0 and need their object, so
  they answer 503 while storage is unreachable; proposals created during an outage open
  from an empty body and edit normally.

## Testing notes

- Seed people all use the password `quillmere-demo-2026`.
- Playwright is not a project dependency; verification ran from a scratch directory
  outside the repo.
- A dirty bucket with stale `documents/*.json` beats a fresh database: the seed only
  writes objects that are missing. Clear both when resetting a dev environment.
