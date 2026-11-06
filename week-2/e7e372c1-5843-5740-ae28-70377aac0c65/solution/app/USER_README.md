# Vellichor Holdings Tracewell

Tracewell is the public treasury record for Vellichor Holdings, Inc. (invented, Nasdaq: VLCH), whose main asset is a fully staked ETH treasury.

- **Public side** (`/`): four headline figures (total ETH held, cumulative staking rewards, ETH per 1,000 diluted shares, mNAV), each with the clock its inputs run on, how fresh it is and the filing it came from. Activate a tile to trace it (Unspool) down to the exhibit row. `/cite/<figure>/<date>` is a dated permalink.
- **Staff side** (`/staff`, `/staff/restatements`): a treasury analyst drafts the weekly holdings restatement and attaches the signed exhibit, disclosure counsel reviews it, a disclosure officer releases, withdraws or corrects it. Every change lands in an append-only, attributed audit trail.
- **Operator console** (`/operator`): the replayable signed price tape and the rehearsal clock.

## Run

`run.json` holds the three commands:

```
npm ci          # install from the lockfile
npm run build   # typecheck, build the browser app, bundle the server into dist/server.js
node dist/server.js
```

The server binds `0.0.0.0` on `APP_PUBLIC_PORT` (default 4173). `GET /api/health` answers `{"status":"ok"}` even while the filing vault is unreachable.

## Environment (read once, in `server/config.ts`)

| Variable | Meaning | Service |
|---|---|---|
| `DATABASE_URL` | Postgres connection string; schema and seed are applied idempotently on every start | Postgres |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | the MinIO bucket used as the filing vault | MinIO |
| `APP_PUBLIC_PORT` | listener port, default 4173 | |
| `ETH_STALE_SECONDS` | whole seconds without an ETH tick before the ETH clock turns stale, default 120 | |
| `STAFF_SESSION_IDLE_SECONDS` | whole seconds of staff inactivity before a session ends, default 1800 | |

Postgres must be reachable to serve; the app still starts when the vault is not, and recovers within ten seconds of the vault coming back. The session signing key and the tick key are generated on first start and kept in Postgres.

## Seeded staff

Password `tracewell-rehearsal-26` for each: Tamsin Okafor (treasury analyst), Imre Castellanos (analyst, counsel, officer), Rafe Lindqvist (counsel), Wren Adeyemi (counsel, officer), Noor Halvorsen (officer), Basil Ferreira (operator). Emails are `<first>.<last>@vellichor.example`.

## Layout of the source

- `server/` Node 22, TypeScript, `pg`; `shared/` pure modules used by both sides (New York calendar arithmetic, exact decimals, wire types); `web/` React 19 browser app; `seed/exhibits/` the four seeded exhibit PDFs (`scripts/make-seed-exhibits.ts` regenerates them).
