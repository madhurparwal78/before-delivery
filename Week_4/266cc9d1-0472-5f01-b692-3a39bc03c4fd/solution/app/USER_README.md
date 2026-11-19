# Spanwise

Spanwise is a web workspace where drone survey contractors deliver annual transmission-line
vegetation clearance findings to the electric utilities they work for, on a 3D globe that streams
terrain and a reality mesh.

- **Survey processors** upload each corridor's 3D Tiles reality mesh, quantized-mesh terrain
  pyramid and CZML flight track. A file is shown as Stored only after object storage itself has
  confirmed its size and SHA-256.
- **Vegetation analysts** scrub along the corridor on the span ribbon, record every tree too close
  to a conductor (clearance is the 3D distance from the canopy top to the span's conductor), and
  submit a frozen findings set. Submitting writes a JSON evidence pack and emails a review link.
- **Utility foresters** open the emailed review link in any browser and accept or dispute each
  finding; **field crew leads** use the same link on a tablet to find the span and nearest tower.

## Running it

The commands are in `run.json` and run from this folder:

| Step | Command |
|---|---|
| install | `npm ci` (uses `package-lock.json`) |
| build | `npm run build` (type-checks the server and client, bundles the client with Vite, copies Cesium's workers and assets) |
| serve | `node dist/server/main.js` (foreground; binds `0.0.0.0`) |

On start the server applies its schema and inserts any missing seed rows, then generates the seed
fixtures (terrain pyramids, the Ash Creek canopy tileset with Draco geometry and a KTX2 texture,
and the Ash Creek flight track) in code and stores them under the storage-confirmation rule once
object storage answers. `GET /api/health` answers as soon as the server listens.

Seeded staff sign in with their access codes (for example `kestrel-analyst-2093`).

## Configuration

Every value is read from the environment at start.

| Variable | Service | Purpose |
|---|---|---|
| `DATABASE_URL` | PostgreSQL | every record, the shared email outbox and idempotency records |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | S3-compatible object storage (MinIO) | asset files and evidence packs |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | SMTP mail sink (Mailpit) | review-link and decision-summary emails |
| `REVIEW_LINK_TTL_SECONDS` | — | review link lifetime, default 1,209,600 (14 days) |
| `APP_PUBLIC_URL` | — | the origin used in review link URLs; default `http://localhost:<port>` |
| `APP_PUBLIC_PORT` | — | the listening port; default 4173 |

Object storage and mail are probed at boot and every 5 seconds (`GET /api/status`). When storage
is unreachable the app keeps serving findings, flight positions and coverage; file reads, uploads,
submit and evidence answer `503`. Emails that cannot be sent stay queued in the shared outbox and
are delivered by any process that can reach mail, without a restart.
