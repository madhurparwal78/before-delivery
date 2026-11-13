# Elevens

Elevens is a fantasy football game for a ten-club national league. Managers build a 15-player squad
inside a 100.0m budget, pick a starting eleven, captain, vice-captain and chip before each deadline,
make transfers (with free transfers and 4-point hits), and watch live points arrive while matches
are played. Supporters' groups run private mini leagues with six-character join codes. A single
game operator publishes fixtures (which sets the deadline), records match events, runs the daily
price change and closes each gameweek. The server decides every rule; every open page is kept in
step over one WebSocket.

## Run it

The commands come from `run.json`:

| Step | Command |
|---|---|
| install | `npm ci` (uses `package-lock.json`) |
| build | `npm run build` (type-check, then bundle the server and the browser app into `dist/`) |
| serve | `node dist/server.js` (foreground, binds `0.0.0.0`) |

On start the server waits up to 60 seconds for Postgres, applies its schema and seed data, then
serves. If MinIO or PocketBase is unreachable it starts anyway and sets them up once they answer.
`GET /api/health` answers `{"status":"ok"}` as soon as it is serving.

The seeded operator account is `operator@sideline.test` / `chalk-and-floodlights-26`.

## Environment

| Variable | Used for |
|---|---|
| `APP_PUBLIC_PORT` | HTTP port (4173 when unset) |
| `DATABASE_URL` | Postgres: players, prices, fixtures, squads, picks, chips, ledger, transfers, events, scores, leagues, sessions, idempotency records, snapshot receipts, notices waiting for delivery |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO: one locked-team snapshot per manager per gameweek at `snapshots/gw-<nn>/<manager id>.json` |
| `POCKETBASE_URL`, `POCKETBASE_ADMIN_EMAIL`, `POCKETBASE_ADMIN_PASSWORD` | PocketBase: manager accounts (`users`) and the notice inbox (`notices`, created by the app) |

No credential or service URL is sent to the browser; the browser talks only to this app.

## Outages

- PocketBase down: sign-up and sign-in answer 503, existing sessions keep working, notices wait in
  Postgres and are delivered once PocketBase is back.
- MinIO down: the deadline lock still happens; receipts read "pending" and the server retries the
  snapshot write every 5 seconds.
