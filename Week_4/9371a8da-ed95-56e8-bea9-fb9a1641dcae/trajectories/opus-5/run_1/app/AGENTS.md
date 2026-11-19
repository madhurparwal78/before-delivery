# Marginalia — repository notes

A shared LaTeX review workspace: projects hold text files and figures,
suggestions and comment threads anchor to exact passages, a numbered ledger
records every change, and citation checks run from the include graph.

## Running it

Everything goes through `/app/run.json`:

- install: `npm ci`
- build: `npm run build` (esbuild bundles the server and the browser app into
  `dist/`, copies the fonts and the page shell)
- serve: `npm run start` (`node dist/server/index.js`)

The server binds `0.0.0.0` on `APP_PUBLIC_PORT` (4173 otherwise), answers
`GET /api/health` as soon as it is listening, and applies the schema and the
seed on every serve. Every address, credential and `..._SECONDS` setting comes
from the environment (`src/server/config.ts`).

## Layout

```
src/shared/anchors.ts      the anchor rules, shared by server and browser
src/server/domain/*        one module per domain rule
src/server/infra/*         S3 (SigV4 over fetch) and SMTP clients, no libraries
src/server/routes/*        endpoints, grouped by topic
src/server/http/*          boundary, error shape and precedence, router, context
src/web/*                  React app: pages, dialogs, components
```

Each domain rule lives in exactly one place:

| Rule | Where |
| --- | --- |
| who may do what | `domain/roles.ts` |
| paths and extensions | `domain/paths.ts` |
| allowed request keys, unstorable text, field limits | `domain/validation.ts` |
| anchor rules and caret following | `shared/anchors.ts` |
| include-graph citation scan | `domain/citations.ts` |
| stored citation report, export readiness | `domain/citationReport.ts` |
| revisions, ledger, restore | `domain/files.ts` |
| review order and payload | `domain/review.ts` |
| invite state machine and hourly allowance | `domain/invites.ts` |
| mention records, claiming, sending | `domain/mentions.ts` |
| header-safe names and the two email bodies | `domain/emails.ts` |
| upload type judging and the SVG checks | `domain/uploads.ts`, `domain/xml.ts` |
| which fields each audience sees of a person | `domain/shapes.ts` (`personView`) |
| share link lifetime | `domain/share.ts` |
| reproducible zip and export file names | `domain/zip.ts` |
| layout for a window width | `web/layout.ts` |
| published copy | `web/copy.ts` |
| Escape layers and focus traps | `web/layers.ts`, `web/components/Dialog.tsx` |

## Things worth knowing

- **One at a time.** Saves, accepts, rejects, uploads, labels, restores, role
  changes and invites take a per-project advisory lock
  (`tx.lockProject`), so simultaneous requests serialise and the loser gets the
  documented conflict.
- **The source editor** is a `contenteditable` div, not a textarea, because open
  suggestions show their inserted text inline. Every block child is a line; the
  text is read back with `collect()` in `web/components/SourceEditor.tsx`.
  Stored bytes keep their own line breaks: only the replaced span changes
  (`web/text.ts`).
- **Freshness.** `actions.current` counts answered own-actions; a refresh answer
  whose request predates the latest action answer is discarded. Storage actions
  carry their own sequence (`storageSent`/`storageAnswered`).
- **Mention emails** live in `mention_emails`; the posting instance tries once
  at the moment the comment answers, after which any instance may claim a due
  record, but only after opening a fresh SMTP connection.

## Testing notes

Playwright (with `apt-get install libglib2.0-0 libnss3 …`) drives the UI. A quick
database reset:

```
node -e "const pg=require('pg');const p=new pg.Pool({connectionString:process.env.DATABASE_URL});p.query('drop schema public cascade; create schema public;').then(()=>p.end())"
```

Extra instances for the storage-down, mail-down and short-timer cases are
started by overriding `S3_ENDPOINT`, `SMTP_HOST`/`SMTP_PORT` or the
`..._SECONDS` settings together with `APP_PUBLIC_PORT`.
