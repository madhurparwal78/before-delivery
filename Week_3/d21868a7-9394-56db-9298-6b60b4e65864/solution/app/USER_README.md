# Ditchbook

Ditchbook is the water-ordering and headgate desk of the Wirrinbah Water Trust, a gravity-channel
irrigation district. One web app with its own API:

- **Growers** order megalitres to a turnout inside a delivery window, within their seasonal
  allocation, and nominate who works the gate (with an optional standby).
- **Channel operators** commit headgate strokes from a phone by holding the gate control for one
  second; delivered figures move only once the stroke record is stored.
- **Dispatchers** keep each channel's capacity table and restrictions on the three-pane channel
  board, ration a window in proportion to what each grower asked when demand outruns it, and hand
  gate cards over when a holder is removed.
- **The records clerk** signs the regulator delivery pack and erases a departed contractor's details.
- **The regulator reviewer** reads mailed packs and channel totals for a chosen period (kept in the
  Review page address), read-only.

The seeded district people sign in with their email and the password `channel-season-26`.

## Running it

`run.json` holds the three commands, run from this directory with Node.js 22:

| Step | Command | What it does |
|---|---|---|
| install | `npm ci` | installs exactly the versions in `package-lock.json` |
| build | `npm run build` | type-checks (strict TypeScript) and bundles the server (`dist/server.mjs`) and the browser app (`dist/client`) with esbuild |
| serve | `npm run start` | runs the server in the foreground on `0.0.0.0` |

On start the server listens at once, then creates its schema and the seed district in an empty
database (an existing database is left untouched). `GET /api/health` answers `{"status":"ok"}` once
that is done, and 503 `database_unavailable` before it. The app keeps serving when the object store
or the mail service is unreachable; strokes, packs and notices wait and finish by themselves when
the service answers again (retried every 5 seconds).

## Settings (environment variables, read once at start)

| Variable | Used for | Service |
|---|---|---|
| `APP_PUBLIC_PORT` | HTTP port (default 4173) | — |
| `DATABASE_URL` | every record and every capacity, allocation, holder and state decision | Postgres |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | stroke records (`strokes/<card id>.json`) and signed packs (`packs/<pack number>.txt`) in the existing private bucket | MinIO (S3 API) |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | restriction, ration, conflict and lapse notices and the pack mail to the regulator, all sent from `MAIL_FROM` | Mailpit (SMTP) |

No setting is sent to the browser or written into any response, email, stroke record or pack.
The app stores data only in Postgres and the bucket.

## Layout

- `server/` — the API and the domain rules (one module each: `decimal.ts` conversion and rounding,
  `time.ts` window status and labels, `orderStates.ts` order transitions, `cards.ts` strokes and
  holder succession, `packs.ts` the pack document, `records.ts` every window figure).
- `client/` — the React screens, bundled into `dist/client`.
- `shared/roles.ts` — each role's home route.
