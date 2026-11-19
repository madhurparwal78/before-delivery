# Tallwind

Business banking cockpit with its public marketing site.

## Run manifest

See `run.json`:

```json
{"_schema":"run-manifest-v1","install":"npm ci","build":"","serve":"npm start"}
```

## Environment

- `DATABASE_URL` — PostgreSQL database (the only datastore).
- `APP_PUBLIC_PORT` — listening port (default 4173).
- `APP_PUBLIC_URL` — public base address.
- `APP_NOW` — optional ISO 8601 UTC instant fixing the business clock's start.
- `LOGIN_LOCKOUT_WINDOW_SECONDS` — sign-in lockout window (default 900).
- `INQUIRY_RATE_WINDOW_SECONDS` — inquiry rate window (default 600).
- `FX_QUOTE_TTL_SECONDS` — currency quote lifetime (default 600).

## Seeded logins

All seeded users share the password `deku-demo-pw-2026`.

| Email | Role | Company |
|---|---|---|
| owner@example.com | Owner | Larkspur Studio |
| admin@example.com | Admin | Larkspur Studio |
| member@example.com | Member | Larkspur Studio |
| outsider@example.com | Owner | Outpost Goods |

Sign in at `/login`. The cockpit lives under `/app`.
