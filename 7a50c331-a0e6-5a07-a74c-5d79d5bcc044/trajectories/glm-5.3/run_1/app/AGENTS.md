# Tessel

Tessel is a graph database console for software agents. Every record lives in
PostgreSQL (`DATABASE_URL`); every notice travels over SMTP to Mailpit
(`SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`). The server is a plain Python 3.12
aiohttp app started by `/app/run.json` (`serve` runs `python -m tessel_server`),
binding 0.0.0.0:4173. Seeded members sign in with `deku-demo-pw-2026`
(see `USER_README.md`).

## Layout

- `tessel_server/config.py` — environment, and the whole schema in `SQL`.
- `tessel_server/textutil.py` — timestamps, lengths, entity keys, tokens, CSV
  neutralisation, the return-path rule: the shared vocabulary of the rules.
- `tessel_server/pricing.py` — the pricing arithmetic in whole cents; the
  landing calculator uses the same functions client-side in `static/tessel.js`.
- `tessel_server/api.py` — the one error-precedence pipeline of the API.
- `tessel_server/routing.py` + `routes.py` — the published route table.
- `tessel_server/domain.py` — supersession, relations, history, the graph read
  model. `active_at` is the one place that decides the active fact.
- `tessel_server/gql.py` — the read-only graph query language; checks in the
  pinned order READ_ONLY_QUERY, CYPHER_SYNTAX, CYPHER_SEMANTIC.
- `tessel_server/handlers.py` — every /api handler.
- `tessel_server/pages.py` — every HTML page and its markdown twin.
- `tessel_server/seed.py` — the idempotent seed of both organizations.
- `tessel_server/static/` — the stylesheet and the two plain browser scripts.

## Rules worth remembering

- A refusal changes nothing. Concurrency winners are decided by row locks
  (`FOR UPDATE` on the organization or database row) inside one transaction.
- Facts carry the log sequence number of their ingest; restore keeps those
  numbers so ties and history read exactly as before the delete.
- Lengths count code points after NFC; storage counts UTF-8 bytes.
- Deleting a database keeps only `source_versions` (reduced to organization,
  tokens and time) and audit events; everything else goes.
- API keys are viewer or editor only, and a key's scope empties to `[]`, never
  to "all databases".
- The `/app/.browser_screenshots/` and `/app/.downloads/` directories stay
  empty; `fixtures/code-host-repo.json` is the one saved file the app reads.
