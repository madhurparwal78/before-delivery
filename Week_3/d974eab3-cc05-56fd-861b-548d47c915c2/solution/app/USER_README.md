# Vireo Pace

The Alder Quay Laboratories brand site: a seven-chapter story from a breath of air to the energy a cell spends, the
product chapter with a printed product information sheet, an interview series and the ON/OFF lifestyle Meridian.
Every page reads one published content record (product, interviews, eight scenarios) through the site's own API.

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (compiles the server and the browser modules with `tsc`) |
| serve | `npm run start` (foreground, `0.0.0.0`, port from `APP_PUBLIC_PORT`, default 4173) |

## Environment

| Variable | Used for | Service |
|---|---|---|
| `DATABASE_URL` | the Postgres connection holding the content record; tables are created at every start | Postgres |
| `GOTENBERG_URL` | the print service base address; each sheet request posts an HTML document to `/forms/chromium/convert/html`, health reads `/health` | Gotenberg |
| `GRADING_KEY` | the `X-Grading-Key` of `PUT` and `DELETE /api/grading/content`; unset means the route does not exist | none |
| `APP_PUBLIC_PORT` | the listening port | none |

`DATABASE_URL` and `GOTENBERG_URL` are required. A service that is down at start does not stop the site: Postgres is
retried until it answers, and the sheet answers 503 until Gotenberg answers again.

## API

`GET /api/health`, `GET /api/content`, `GET /api/interviews/<slug>`, `GET /api/scenarios/<id>`, `GET /api/product/sheet`,
and the grading route `PUT` / `DELETE /api/grading/content`. Every error is `{"error","message"}`.
