# Saltreach

Saltreach, by Low Tide Works, is a browser village-builder set on tidal salt-flat islands. Islanders
lay out a village on a procedural 3D island, keep brine, peat and copper producers and storages
running, train small raiding parties and raid other islands asynchronously. The server decides
everything: placement, build and training timers, every spend, the full battle, loot, trophies,
leagues, daily and weekly rewards and every clan role. The browser sends only intents.

Every finished raid can be rebuilt from its published seed, deploy list and resolution lootable
amounts; the Wake dial on the replay screen scrubs it tick by tick with the same simulation module
the server uses. Open screens follow changes made elsewhere through server-sent events at
`/api/events`.

## Running it

The commands are in `run.json`:

| Step | Command | What it does |
|---|---|---|
| install | `npm ci` | installs exactly the versions in `package-lock.json` |
| build | `npm run build` | type-checks under strict mode, bundles the browser app into `dist/public` and the server into `dist/server/main.mjs` |
| serve | `npm run start` | serves the app and the API on `0.0.0.0:$APP_PUBLIC_PORT` (4173 by default) |

Node.js 22 LTS is required. On start the server applies its schema and seed data to the database
idempotently, so an empty database is ready without a separate step. It starts serving even when
PostgreSQL or Mailpit is unreachable, answers `GET /api/health` with `{"status":"ok"}` throughout,
and reconnects on its own.

## Services

- **PostgreSQL** holds all state: accounts and argon2id password hashes, sessions, villages and
  buildings, timers, the paired ledger, raids with their seeds, deploys and per-tick hashes,
  rewards, clans, chat, requests, throttle counters, idempotency records and the mail queue.
- **Mailpit** (SMTP, no authentication or TLS) receives every email: confirmation links, password
  resets and clan invitations. Mail is first written to the queue in PostgreSQL and delivered
  exactly once, so sign-ups and resets keep working while Mailpit is down.

## Environment

Every value is read once at start. Nothing here is sent to the browser.

| Variable | Meaning | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string (a non-superuser) | required |
| `SMTP_HOST`, `SMTP_PORT` | Mailpit's SMTP address | required |
| `MAIL_FROM` | From header of every message | `Saltreach <tides@saltreach.lowtide.test>` |
| `APP_PUBLIC_PORT` | listen port | `4173` |
| `APP_PUBLIC_URL` | origin used in mail links and the same-origin check; `https` makes the session cookie Secure | `http://localhost:<port>` |
| `SALTREACH_CLOCK_START` | when set, the server clock reads this instant at start and runs on from it | real time |
| `RAID_FINALIZE_SECONDS` | how long a locked raid may wait for its finalize | `300` |
| `SHIELD_SECONDS` | shield lifetime after a defence that conceded two or more stars | `43200` |
| `TARGET_COOLDOWN_SECONDS` | same-target cooldown after a resolved raid | `86400` |
| `VERIFY_TOKEN_SECONDS` | confirmation link lifetime | `86400` |
| `RESET_TOKEN_SECONDS` | password reset link lifetime | `1800` |
| `SESSION_SECONDS` | session lifetime from sign-in | `2592000` |
| `BUILD_TIME_DIVISOR` | divides every build and training duration (rounded up, at least 1 s) | `1` |

## Accounts to try

The seed data creates the studio operator (`ops@lowtide.test`, who sees Operations) and five
islanders, among them Pell Saunder and Ivo Brack of the clan Brackwater Kin. Their emails and
passwords are listed in the product brief's Seed data section.

## Layout of the source

- `src/shared/` — the catalog, grid geometry and the battle simulation, imported by both sides.
- `src/server/` — the HTTP server, API routes, the ledger, raids, rewards, clans, the mail queue and the live channel.
- `src/client/` — the Preact interface, the three.js island and its flat-plan fallback, and the Wake dial.
