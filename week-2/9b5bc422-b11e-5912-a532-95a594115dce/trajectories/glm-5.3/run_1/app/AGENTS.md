# Oddment Workspace — project memory

Local-first personal workspace: block documents, canvas of the same blocks, record tables, daily journal, templates. Device storage is IndexedDB (`oddment`), server is Express + Postgres (sync/accounts/sessions/devices/share links) + MinIO via a hand-rolled SigV4 S3 client (`server/s3.ts`, written because the `minio` npm package pulls `sax` under BlueOak-1.0.0, which IF-03 forbids).

## Layout
- `server/` — Express app (`server.ts`), Postgres schema (`db.ts`), S3 client (`s3.ts`), one error shape (`errors.ts`).
- `src/` — React 19 + zustand client. `src/lib/app.ts` is the single store; `src/lib/sync.ts` is the sync engine; `src/lib/store.ts` is the IndexedDB layer; `src/lib/seed.ts` holds the exact seed data.
- `shared/domain.ts` — types shared by client and server.
- Build: `tsc -b` (tsconfig.app.json + tsconfig.server.json) then `vite build` → `dist/client`; server compiles to `dist/server` via root `dist`. Serve: `node dist/server/server.js` on `$APP_PUBLIC_PORT` (default 4173).

## Sync design (tests never call /api/sync)
One record per change (document/block/note/connector/table/column/row/attachment) with `baseVersion`. Outbox in IndexedDB keeps ONE entry per record. Server versions each record and logs to `sync_log`; clients pull with a cursor. Key rules:
- **Pull cursor only advances when changes are pulled and applied** — never from the push response, or a device skips other devices' changes (this bug cost hours).
- Replay detection must compare payloads canonically (Postgres JSONB reorders keys) — see `canonicalJson` in `server/server.ts`.
- `createOnly` on upload pushes: records the account already holds are left alone; identical payloads are replays.
- Text conflicts (block text/title/cell) create a `sync_conflicts` row; pulls carry `conflictValues` so BOTH devices show the Both kept marker. The first resolution push wins and clears the row. Non-text fields are last-write-wins.
- Delete forever (`document` change with `deleted` + `{gone:true}`) cascades server-side: related records logged deleted, S3 objects removed, share links revoked; pushes for a gone document answer `dropped` and the device shows the published notice.

## Hard-won client lessons
- Every `put*` to IndexedDB must be followed by `reload()` or the zustand store goes stale and controlled inputs reset.
- Controlled textareas need an optimistic local draft (sync only when not focused), or fast typing races async persistence.
- IndexedDB `getAll` returns keys in ascending key order — never rely on it for order; sort by `createdAt`/`order`.
- A grid container needs `grid-template-columns: minmax(0, 1fr)` or inner scroll regions blow the page sideways at 375px.
- The skip link must be the first element in the DOM; CSS restores the visual composition (banner/nav after main).
- `aria-label` on buttons with icon+text keeps accessible names exact (`Fit to view`, `New note`, ...).

## Verification
Playwright scripts used during development live in /tmp (smoke1, bothkept, records, final1, phone, keyboard_ui, attach_journal_delete, deal_slots). `npx tsc -p tsconfig.app.json --noEmit` and `-p tsconfig.server.json --noEmit` must both pass. Fonts are OFL-1.1 TTFs in `public/fonts`; THIRD_PARTY_NOTICES.md is generated from `npm ls --omit=dev --all --json`.
