# Joinery — notes for agents

Pinewick Labs Joinery: a text-first schema studio (Mortise language → live entity diagram, PostgreSQL/MySQL DDL export and import, versions, share links, live co-editing).

## Layout

- `src/shared/` — domain rules used by both server and browser (one place each):
  - `mortise.ts` parser + every language message; `model.ts` model types; `canonical.ts` canonical printing;
    `writeback.ts` text write-back (link line insertion, group append/remove, rename, starter entity);
    `writes.ts` planners for diagram writes (link/group/ungroup/rename) + their refusals; `layout.ts` next-free-cell, arrange;
    `units.ts` unit split + edit merging; `ddl-export.ts`; `access.ts` access matrix + share status; `field-messages.ts`.
- `src/server/` — Node `http` server, `pg`, hand-written S3 SigV4 client (`storage.ts`), hand-written SMTP client (`mail.ts`), `ws` live channel (`live.ts`), DDL importer (`ddl-import.ts`). All API errors are built in `errors.ts`.
- `src/client/` — Preact app (no router; full page loads). `workspace/` holds the editor: `workspace.tsx` orchestrates, `text-pane.tsx` (textarea + gutter), `diagram.tsx` (SVG), `sync.ts` (edit sending + live channel), `backend.ts` (project API vs. in-page sample).
- Server decides page status (200/404) in `pages.ts`; the client reads `#joinery-config` JSON.

## Commands

- `npm ci && npm run build && npm run start` (port `APP_PUBLIC_PORT`, default 4173). Build runs `tsc --noEmit` first.
- `npm test` — unit tests (parser, export, import) bundled with esbuild into `dist-test/`.
- `node test/e2e-api.mjs` — API end-to-end against a running server with real services (uses grading setup route).
- Browser checks were done with Python Playwright scripts kept outside the repo.

## Gotchas

- In Preact, SVG elements need lowercase `tabindex` (camelCase `tabIndex` is written as an unknown attribute).
- Dialogs capture their opener at render time and handle Escape/Tab at document level (focus can leave a disabled pending button).
- Live messages for one's own writes can arrive before the HTTP reply: `EditSync.hold()` and the `arranging` flag keep write-back typing and the arrange glide intact.
- Links are `<g data-link>` with explicit end shapes so they have a non-zero box even when horizontal.
- JetBrains Mono ligatures are disabled so `>-` renders as typed.
- No `pkill`/`ps` in the sandbox; kill the server by scanning `/proc/*/cmdline`.
