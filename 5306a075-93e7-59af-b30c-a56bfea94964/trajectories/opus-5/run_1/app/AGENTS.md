# Loomwise Evidence Desk — repository notes

A TypeScript web app that carries customer evidence through to a roadmap: notes → highlighted
quotes → insights on features → weighted scores and rank → releases → "you asked, we shipped"
emails and a public roadmap.

## Running it

| Step | Command |
| --- | --- |
| install | `npm ci` |
| build | `npm run build` (server `tsc` → `dist/server`, client Vite → `dist/client`) |
| serve | `npm run start` (`node dist/server/index.js`, port `APP_PUBLIC_PORT` or 4173) |

`/app/run.json` is the manifest; those three commands are the only supported entry points.
`npm run typecheck` checks both projects. The server waits for PostgreSQL at boot (retrying every
2 seconds) and never waits for object storage or mail.

## Layout

```
shared/     pure logic used by both sides: doc model + offsets, highlight segmentation, types, date format
server/
  domain/   one module per domain rule (sanitize, priority, transitions, cursor, csv, search, …)
  repo/     SQL reads and writes grouped by aggregate
  services/ storage (hand-rolled S3 SigV4), smtp, scope snapshots, mail rendering, background workers
  http/     kernel (router + error precedence), validate, multipart, pages, routes/
client/
  components/ shell, dialog, highlighted body, hierarchy rail, evidence thread, note reader
  screens/    signin, inbox, features, feature detail, roadmap, companies, import, settings, invite
```

## Rules that live in exactly one place

Each of these is decided once and reused; change it there, never at a call site.

| Rule | Module |
| --- | --- |
| note body allowlist, serialisation | `server/domain/sanitize.ts` |
| plain text, offsets, render tree | `shared/doc.ts` |
| highlight segmentation | `shared/segments.ts` |
| re-anchoring through edits | `server/domain/reanchor.ts` |
| derived counters (insights, companies, impact) | `server/repo/features.ts` (`loadCounters`) |
| objective fit, priority, rounding, rank | `server/domain/priority.ts` |
| note / feature / release state machines | `server/domain/transitions.ts` |
| inbox order and cursor | `server/domain/cursor.ts` |
| import matching and skip reasons | `server/domain/legacyimport.ts` |
| attachment content check, filename, keys | `server/domain/attachments.ts` |
| CSV reading, quoting, formula neutralisation | `server/domain/csv.ts` |
| search match and snippet window | `server/domain/search.ts` |
| share-link activity | `server/domain/sharelinks.ts` |
| workspace time zone, DST, instant formats | `server/domain/zone.ts` |
| error shape and precedence | `server/errors.ts`, `server/http/kernel.ts` |

## Decisions worth remembering

- **Counters are never cached.** `loadFeatureWorld` recomputes insight/company/impact from the
  `insights` rows on every read, so every surface equals a recomputation by construction.
- **Priority is exact rational arithmetic.** `priority = Σ(w·fit)·impact·confidence / (3·Σw·effort)`
  is rounded with integer maths (`roundRational`), so no float drift. Seed values match the brief
  exactly (SAML 33.75, Scheduled 33.60, …).
- **Offsets are UTF-16 code units** (JS string indices). Python test helpers must convert.
- **`notes.created_at` is truncated to whole seconds** so the cursor has exactly the precision the
  API publishes. Other tables default to `clock_timestamp()` so rows keep their insertion order
  inside one transaction (the seed relies on this).
- **Block-boundary newlines render inside the following block** as a `\n` text node, which keeps
  "the joined text of an insight's marks equals its quote" true across paragraphs and list items.
- **Concurrency** uses PostgreSQL advisory locks: `feature:<id>` for counters and score versions,
  `release:<id>` + `board:<workspace>` for board moves, `import:<workspace>` for real imports.
- **Content-Type is kept verbatim** in the kernel; lowercasing it once broke mixed-case multipart
  boundaries (`----WebKitFormBoundary…`).
- **The inbox page size is 5** (`PAGE_SIZE` in `client/screens/Inbox.tsx`) so the seed's 7 notes
  need "Load more notes", which is the journey the brief describes.
- **The picked board card is refocused in an effect**, because changing lane remounts the button.
- **Selecting a quote focuses the note body**, so the `L` shortcut works wherever focus started.
- Storage and mail work is queued in PostgreSQL (`attachments.pending_bytes`,
  `pending_object_deletions`, `outbox`) and claimed with `FOR UPDATE SKIP LOCKED`, so any instance
  that can reach the service drains it. No restart is ever needed.
- `THIRD_PARTY_NOTICES.md` is generated from `npm ls --omit=dev --all --json`; regenerate it after
  any dependency change. Versions are pinned exactly in `package.json`.

## Seed data

Two workspaces, `Tallyrun` (America/New_York) and `Quarry Labs` (Europe/Berlin); every member's
password is `evidence-desk-2026`. Sign in as `hop@tallyrun.example` (head of product),
`pm@tallyrun.example` / `pm2@tallyrun.example` (product managers) or `csm@tallyrun.example`
(customer success). The seed is inserted only when the database holds no workspaces, so wiping the
schema and restarting gives a clean fixture.
