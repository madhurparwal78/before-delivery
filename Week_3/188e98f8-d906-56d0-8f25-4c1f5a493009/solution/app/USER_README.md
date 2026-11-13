# Roundkeeper

The answer desk for a weekly team quiz league in one village pub. Three desks and a public table:

- **Quizmaster** (`/quizmaster`): uploads picture-round sheets, opens and closes each round, rules on disputed marks and publishes rounds into the league table.
- **Marker** (`/marker`, `/archive`): marks every team's answers by keyboard or by tapping, and searches the answer archive.
- **Team captain** (`/captain`): submits the team's answers from a phone, renames the team and disputes a mark.
- **Public table** (`/`): the round strip and the league table; tiles turn and slide when a round is published.

Each desk opens with a seeded desk code (no accounts or passwords). Only the server decides round status, scores and the table.

## Run it

`run.json` holds the three commands:

```
npm ci            # install, from package-lock.json only
npm run build     # type-checks, then bundles the server and the client into dist/
npm run start     # serves on 0.0.0.0, port APP_PUBLIC_PORT (default 4173)
```

On every start the app applies its schema and seed data to the database (idempotently) and makes sure its bucket exists. It keeps retrying while PostgreSQL is unreachable; `GET /api/health` answers 503 until the database is ready.

## Environment variables

| Variable | Used for |
|---|---|
| `DATABASE_URL` | PostgreSQL: league, teams, rounds, answers, marks, disputes, sessions, idempotency records, submit counts |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO: picture-round sheets at `sheets/night-4/round-<n>/<sha256>.<png|jpg>` |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit: one ruling note per ruling, sent to the raising captain |
| `ROUND_SECONDS` | Answer allowance per round, whole seconds from 5 to 3600 (default 240) |
| `APP_PUBLIC_PORT` | Listening port (default 4173) |

No credential or URL is written into any page or response.

## Third-party notices

See `THIRD_PARTY_NOTICES.md`. Fonts (Fraunces, Atkinson Hyperlegible) are self-hosted under the SIL Open Font License 1.1.
