# Hourline Launch Hub

Hourline Launch Hub is the web app a Scandinavian fashion or lifestyle brand uses to run its seasonal drops from
Copenhagen across six markets (Copenhagen, Stockholm, Paris, London, New York and Tokyo).

- **Launch producers** plan each drop's go-live on the embargo dial, schedule weekly restocks, add VIP waitlist
  members and manage the workspace's members.
- **Shoppers** find drops on the public calendar, join a market's waitlist, confirm from the emailed link and
  claim a held piece before the hold ends.
- **Merchandisers** split each wholesale edition across stockist requests, keep line sheets and the lookbook in
  order, and keep the stockist directory current.
- **Finance leads** confirm allocations at the price list in force; each confirmation creates one Kill Bill invoice
  and one confirmation email.
- **Press leads** write and publish drop stories and send editors embargoed preview links that expire.
- **Stockist buyers** request quantities for their own store and see only that store's allocations and invoices.

## Running it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` (installs from `package-lock.json`) |
| build | `npm run build` (type-checks, builds the browser app with Vite and the server with esbuild into `dist/`) |
| serve | `npm run start` (runs `node dist/server.mjs` in the foreground) |

The server listens on `0.0.0.0`, port `APP_PUBLIC_PORT` (default 4173). On every start it applies the schema and
the seed data under a Postgres advisory lock, so several copies can start together. `GET /api/health` answers
`{"status":"ok"}` once that is done. A sweep runs every second in every copy and uses database locks, so each
go-live, hold offer, hold expiry, restock and email happens exactly once.

Seeded members sign in with the password `Hourline-Seed-2027` (for example `ida.holm@marenvale.example`, the
launch producer of Maren Vale).

## Configuration

Everything is read from the environment at start (`src/server/config.ts`); nothing is sent to the browser.

| Variable | Used for | Default |
|---|---|---|
| `DATABASE_URL` | Postgres: every record, the outbox of email and the sweep's locks | required |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO: look images under `looks/<dropId>/` and press ZIPs under `press/<previewId>.zip` | required |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill: one account per stockist and one committed invoice per confirmation | required |
| `SMTP_HOST`, `SMTP_PORT` | Mailpit, over SMTP | required |
| `MAIL_FROM` | the From line of every email | `Hourline <launch@hourline.example>` |
| `APP_PUBLIC_PORT` | the listening port | `4173` |
| `APP_PUBLIC_URL` | this copy's own origin, for absolute links in email and the same-origin write check | `http://127.0.0.1:<port>` |
| `SESSION_TTL_SECONDS` | how long a session lasts after sign-in | `28800` |
| `PREVIEW_LINK_TTL_SECONDS` | how long a press preview link works | `604800` |
| `OPT_IN_LINK_TTL_SECONDS` | how long a waitlist opt-in link works | `86400` |
| `WAITLIST_RATE_WINDOW_SECONDS` | the window of the 5-joins-per-client waitlist limit | `600` |
| `INVITE_LINK_TTL_SECONDS` | how long an invitation link works | `604800` |
| `RESET_LINK_TTL_SECONDS` | how long a password-reset link works | `3600` |

## Services

| Service | What the app does there |
|---|---|
| Postgres | stores workspaces, members, sessions, drops, markets, styles, waitlists, holds, claims, idempotency records, rate-limit counts, allocations, price lists, stockists, looks, stories, previews, restock series and the email outbox |
| MinIO | stores look images (re-encoded upright with all metadata removed) and the press ZIPs; the bucket stays private and images reach browsers only through the app |
| Kill Bill | holds an account per stockist (`hourline-<stockistId>`) and one invoice per confirmed allocation with one external charge per priced line |
| Mailpit | receives every email over SMTP: invitations, password resets, waitlist opt-ins, holds, allocation confirmations and press previews |

When MinIO is down, uploads and press ZIP downloads answer `503 storage_unavailable`; when Kill Bill is down,
confirmation answers `503 billing_unavailable` and nothing is recorded or mailed.
