# Relayo

Relayo is a B2B AI meeting assistant. This repository serves the public
marketing site (home, five agent pages, integrations directory, resources
library, careers board, press room, blog) and the partner program: a public
application form and a staff review queue.

## Running

```sh
python3 -m venv .venv && .venv/bin/python -m pip install --no-cache-dir -r requirements.txt
.venv/bin/python -m server
```

The server listens on `0.0.0.0`, on port `APP_PUBLIC_PORT` (4173 when unset).
`GET /api/health` answers 200 once the schema, the seeded corpus and the seeded
auth accounts are in place, and 503 before that.

## Staff accounts

Both accounts sign in on `/review` with the password `deku-demo-pw-2026`
(benchmark fixture data, not a secret).

| Email | Realm role |
|---|---|
| `reviewer@example.com` | `partner-reviewer` |
| `analyst@example.com` | (none) |

`reviewer@example.com` can read and decide partner applications.
`analyst@example.com` can sign in and sign out, and is refused on every
reviewer route with 403.
