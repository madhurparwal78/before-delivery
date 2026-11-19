# Ottoline Rask Selected Builds

The public hiring portfolio of Ottoline Rask, an invented independent developer who trades as Quillfern Works. Every
person, client, project, review, figure and the career timeline are fictional and labelled so on the site.

It shows six annotated case studies with live previews, a filtered project gallery, five services, skills,
illustrative client reviews and figures, a career timeline and an enquiry form whose message reaches the studio inbox by
mail. Two backing services are used: a Mailpit mail server (SMTP) that carries each enquiry, and a MinIO object store
that holds the 42 project covers and preview frames, which the browser reaches only through `GET /media/<key>`.

## Run

`run.json` holds the commands: `npm ci`, `npm run build`, `npm start`. The server binds `0.0.0.0` on port 4173 (or
`APP_PUBLIC_PORT`) and serves every page whether or not the services can be reached; it recovers when they return.

## Environment

| Variable | Used for |
|---|---|
| `APP_PUBLIC_PORT` | listening port (default 4173) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO media library |
| `MEDIA_PROBE_SECONDS` | how often an unreachable media library is probed (default 5) |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit |
| `MAIL_TIMEOUT_SECONDS` | how long a send may take before the API answers 503 (default 10) |
| `GRADING_KEY` | enables the two grading routes; without it they do not exist |

## Interfaces

`GET /api/health`, `GET /api/media`, `GET /media/<key>`, `POST /api/enquiries`, and with `GRADING_KEY`:
`DELETE /api/grading/media/<key>` and `POST /api/grading/reset`. Pages: `/`, `/work/<slug>`, and a not-found page.
