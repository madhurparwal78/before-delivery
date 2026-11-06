# Oddment Workspace

A local-first personal workspace: block documents, an infinite canvas of the same blocks, record tables with live totals, a daily journal and templates. It works with no account and no network; every change is saved on the device first. After sign-in it syncs through Postgres and stores attachments in MinIO.

## Run it

The commands live in `run.json`:

```sh
npm ci          # install
npm run build   # type-check, bundle the browser app, the service worker and the server
npm run serve   # serve on 0.0.0.0, port 4173 or APP_PUBLIC_PORT
```

Health is at `GET /api/health`.

## Environment

| Variable | Service | Purpose |
|---|---|---|
| `DATABASE_URL` | Postgres | accounts, sessions, devices, the change log, share links |
| `S3_ENDPOINT` | MinIO | object storage endpoint |
| `S3_REGION` | MinIO | signing region |
| `S3_BUCKET` | MinIO | bucket holding `attachments/<userId>/<attachmentId>` |
| `S3_FORCE_PATH_STYLE` | MinIO | `true` for path-style addressing |
| `S3_ACCESS_KEY_ID` | MinIO | access key |
| `S3_SECRET_ACCESS_KEY` | MinIO | secret key |
| `SHARE_LINK_SECONDS` | app | share link lifetime; optional, default 604800 |
| `ACCOUNT_STORAGE_BYTES` | app | stored bytes per account; optional, default 50000000 |
| `APP_PUBLIC_PORT` | app | listening port; optional, default 4173 |

The app applies its schema at every start and again when Postgres returns. It boots and serves local features with either service unreachable.
