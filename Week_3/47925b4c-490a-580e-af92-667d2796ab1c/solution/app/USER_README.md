# Nachtwit Gevelwerk

A site survey and throw layout workspace for independent projection artists working on Belgian
building fronts. One artist surveys a wall on foot, lays out real serial-numbered bodies and lenses
on it, proves half-metre by half-metre whether the light reads after dark, hires any shortfall from
a rental house and issues the rig sheet a venue technician works from.

## What it does

- **Walls** (`/sites`): create a site with a measured wall (half-metre cells, show time in the
  Brussels zone), upload a phone photo, set four reference points and a check point, and see the
  rectified wall. Readings are entered cell by cell in lx, fc, cd/m2 or fL, queued on the device
  without signal and synced when it returns.
- **Workspace** (`/sites/<siteId>/layouts/<layoutId>`): place bodies and aim lenses by pointer or
  by keyboard alone, walk the show-night loupe across the wall and read each cell's contrast, band,
  pixels per metre and blend state.
- **Shelf** (`/kit`): the kit ledger. Every movement posts a balanced pair of entries; mistakes are
  corrected by reversal; show hours derate a body's output.
- **Hire** (`/hire`): check rental stock, ask for a one-body hold, quote in exact cents and confirm.
- **Sheet** (`/sheets/<sheetId>`): the issued rig sheet, its technician link, and the mask bundle job.
- **Technician** (`/rig/<token>`): the capability link, no account: the circuit checklist and the PDF.

## Run it

```
npm ci
npm run build
npm run serve
```

`run.json` carries the same three commands. The server binds `0.0.0.0` on `APP_PUBLIC_PORT`
(default 4173). `GET /api/health` answers `{"status":"ok"}` once Postgres answers.

## Environment

Read at start, never sent to the browser.

| Variable | Service | Meaning |
| --- | --- | --- |
| `APP_PUBLIC_PORT` | – | port to listen on, default 4173 |
| `DATABASE_URL` | Postgres | every record |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | wall photos, rectified tiles, rig sheet PDFs, mask bundles |
| `GOTENBERG_URL` | Gotenberg | renders the rig sheet PDF |
| `WIREMOCK_URL` | rental house API | stock, holds, quotes, confirmations, releases |
| `TECH_LINK_SECONDS` | – | technician link window, default 1209600 (14 days) |
| `READING_STALE_SECONDS` | – | age at which a reading set is stale, default 10368000 (120 days) |
| `MASK_STEP_MILLISECONDS` | – | pause before each mask step, default 0 |

Several server processes may share one database; any may stop at any moment. Postgres is the
only database and MinIO the only object store: nothing is kept on the server's disk.
