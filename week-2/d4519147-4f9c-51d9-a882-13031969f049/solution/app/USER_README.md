# Scopewright

Scopewright (Plumbline Labs) is a browser diagramming workspace for keeping a PCI DSS network diagram and
account-data-flow diagram current. Diagrams hold named scope zones (Cardholder Data Environment, Connected-to,
Out of scope); the server derives which systems sit in each zone and which data flows cross each zone's edge, and in
which direction, every time a page is saved. Owners share a diagram with one person at a time as editor or viewer,
export dated PNG/SVG/JSON sets, import legacy diagram XML or SVG files (kept as evidence), and read an append-only
audit trail.

## Running it

The app is started only through `run.json`:

| Step | Command |
|---|---|
| install | `npm ci` (from `package-lock.json`) |
| build | `npm run build` (type-checks with `tsc --noEmit`, bundles the server and browser app with esbuild into `dist/`) |
| serve | `node dist/server.js` (foreground, binds `0.0.0.0`) |

Node.js 22 LTS. The server applies its schema and seed data idempotently at every start, creates the bucket if it is
missing, and answers `GET /api/health` with `{"status":"ok"}` once PostgreSQL is connected (503 `{"status":"starting"}`
until then, retrying every 2 seconds). Storage or mail being down never stops it from starting.

## Environment

Every value is read once at start (`src/server/config.ts`), never logged and never sent to the browser.

| Variable | Used for |
|---|---|
| `DATABASE_URL` | PostgreSQL, the system of record (people, sessions, diagrams, pages, shares, mail queue, audit events) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO object storage for export sets and imported originals (SigV4, no SDK) |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Outbound mail to Mailpit (invitations, access-changed notices) |
| `MAILPIT_URL` | Not read: delivery uses SMTP; Mailpit's HTTP API is only for inspecting delivered mail |
| `APP_PUBLIC_PORT` | Listening port (default 4173) |
| `APP_PUBLIC_URL` | The only base for absolute links (invitation emails); also selects the `__Host-` cookie on https |
| `SESSION_IDLE_SECONDS` (1800), `SESSION_ABSOLUTE_SECONDS` (43200) | Session expiry |
| `SIGNIN_WINDOW_SECONDS` (900), `SIGNIN_LOCK_SECONDS` (900) | Sign-in lockout (5 per email+IP, 20 per IP) |
| `INVITE_TTL_SECONDS` (259200), `INVITE_RATE_WINDOW_SECONDS` (3600), `INVITE_LOOKUP_WINDOW_SECONDS` (600) | Invitation expiry, 20 invitations per diagram per window, 20 failed lookups per IP per window |
| `IDEMPOTENCY_KEY_SECONDS` (86400) | Export Idempotency-Key lifetime |
| `DOWNLOAD_LINK_SECONDS` (60) | Personal download link lifetime |

## Services

- **PostgreSQL**: the only database. Several instances can share one database; migrations take an advisory lock.
- **MinIO**: `exports/<diagramId>/<exportId>/diagram.{png,svg,json}` and `imports/<diagramId>/<importId>/{original,model.json}`.
  Objects are never public; the browser only ever receives `/api/downloads/<token>` links bound to one person.
- **Mailpit**: plain-text quoted-printable messages over SMTP. Messages are queued in PostgreSQL in the same
  transaction as the share change and retried by every running instance every few seconds until accepted.

## Seeded people

Dana Okafor (owner of Harbor Lane CDE scope), Ravi Sato and Jo Mendes (editors), Lee Varga (viewer, assessor),
Morgan Fell (no access) and Sam Whitlow (owner of Kestrel Pay processing scope). Their passwords are in the product brief.
