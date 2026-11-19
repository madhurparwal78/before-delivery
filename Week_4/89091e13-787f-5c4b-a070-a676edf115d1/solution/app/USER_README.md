# Fernsquare

Fernsquare is a shared developer sandbox for data availability networks, made by Orrin Fieldworks. Each workspace runs a private,
deterministic simulated network on a server clock: blobs become 64-byte shares laid in an erasure-extended data square with
namespaced Merkle roots, light nodes sample the square, a full node publishes fraud proofs, and validators, delegations and
governance proposals run on the valueless test token FERN. The workspace owner can make the block producer withhold shares or
encode a block badly, on purpose.

Out of scope: real chains, keys, wallets, signatures, bridges, outside RPC, peer-to-peer networking, prices, trading and any
yield framed as investment. FERN exists only inside the app.

## Run it

`run.json` holds the three commands (Node 22, npm):

| Step | Command |
|---|---|
| install | `npm ci` (from `package-lock.json`) |
| build | `npm run build` (type-checks in strict mode, bundles the server and the browser app into `dist/`) |
| serve | `node dist/server.js` (foreground, binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173) |

The schema is applied idempotently at every start. An empty database builds the published seed (Fernhill Labs and Quarry Labs,
blocks 1-5, mempool, light nodes, validators, proposals) at first boot. `GET /api/health` answers `{"status":"ok"}` or, while MinIO
is unreachable, `{"status":"unavailable"}` (always HTTP 200).

`npm run notices` regenerates `THIRD_PARTY_NOTICES.md` after `npm ci`.

## Services

| Service | Used for | Variables |
|---|---|---|
| PostgreSQL | system of record: accounts, ledger, blocks with their shares and roots, samples, fraud proofs, staking, governance, clock, mail outbox | `DATABASE_URL` |
| MinIO | blob payloads at `blobs/<blobId>` and square snapshots at `squares/<workspaceId>/<height>.bin` | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Mailpit | invites and notices (written to an outbox in the same transaction as the event, retried every 5 seconds) | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` (default `Fernsquare <no-reply@fernsquare.test>`) |

If MinIO or SMTP is unreachable the server still starts: blob submission and snapshot download answer 503 with the published copy,
mail stays in the outbox, and both recover without a restart.

## Configuration

Read once at start by `src/server/config.ts`; nothing here is sent to the browser except `SQUARE_ROW_REVEAL_MS` and the display time zone.

| Variable | Default | Meaning |
|---|---|---|
| `APP_PUBLIC_URL` | none | public origin, used in invite links |
| `APP_PUBLIC_PORT` | 4173 | listen port |
| `GRADING_KEY` | none | guards `/api/grading/*` (missing or wrong key answers 404; unset disables the routes) |
| `CLOCK_MODE` | `realtime` | `realtime` advances the server clock with real time; `manual` moves it only through `POST /api/grading/clock` |
| `APP_START_AT` | `2026-11-06T09:00:00Z` | the clock's first instant; block h is produced at `APP_START_AT + h x BLOCK_TIME_SECONDS` |
| `APP_TIME_ZONE` | `Europe/Berlin` | display time zone of dates and times |
| `BLOCK_TIME_SECONDS` | 15 | block interval |
| `MAX_SQUARE_WIDTH` | 8 | largest original square width |
| `MIN_GAS_PRICE` | 0.1 | ufern per gas |
| `BLOCK_REWARD_UFERN` | 1000000 | reward per block, split by stake |
| `SAMPLE_SEED` | 42 | seed of every light node's sample sequence |
| `SAMPLES_PER_BLOCK` | 16 | samples a node may take of one block |
| `SAMPLE_INTERVAL_MS` | 1000 | auto-sampling interval |
| `FRAUD_CHECK_DELAY_MS` | 5000 | delay before the full node checks a block |
| `UNBONDING_SECONDS` | 120 | unbonding and redelegation lock |
| `MAX_UNBONDINGS` | 7 | unbondings in progress per validator |
| `MAX_REDELEGATIONS` | 7 | redelegations in progress |
| `MIN_DEPOSIT_FERN` | 100 | proposal deposit minimum |
| `DEPOSIT_PERIOD_SECONDS` | 300 | deposit period |
| `VOTING_PERIOD_SECONDS` | 600 | voting period |
| `VOTE_REMINDER_SECONDS` | 120 | reminder lead before voting ends |
| `INVITE_TTL_HOURS` | 72 | invite lifetime |
| `SQUARE_ROW_REVEAL_MS` | 100 | row-by-row reveal pace of a newly arrived square |

## Layout of the source

`src/shared` holds the rules both sides use (namespaced Merkle hashing and proof verification, the sample generator and
confidence, amount and time formatting, announcement copy); `src/server` the API, simulation engine, clock, storage, mail and
live channel; `src/client` the React app.
