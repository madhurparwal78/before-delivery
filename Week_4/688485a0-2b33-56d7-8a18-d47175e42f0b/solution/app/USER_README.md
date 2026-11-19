# Jarful

Jarful is a web workspace where one developer keeps JSON documents in collections. They write filters and aggregation
pipelines, add indexes and validation rules, load and download files, and invite a few people to look at or edit the data.

- **Owners** create projects and collections, write filters and pipelines, add indexes and validation rules, load and
  download files, and invite people.
- **Editors** edit documents and saved queries and see the owner's changes live.
- **Readers** browse, query and download; they cannot change anything.

Everything runs in one TypeScript app (Node.js 22 server, React client). The query and aggregation engine is the app's own:
queries and pipelines are JSON only (no JavaScript, `$where`, `$function` or `$expr`). Live changes travel over
server-sent events from the app server.

## Services

| Service | What it holds | Variables |
|---|---|---|
| PostgreSQL | accounts, sessions, projects, members, invitations, collections, documents with versions, indexes, rules, saved queries, pipeline drafts, file loads, downloads and every collection's change feed | `DATABASE_URL` |
| MinIO (S3 API) | every uploaded file at `imports/<id>` and every generated download at `exports/<id>.<jsonl\|csv>` | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Mailpit (SMTP) | sign-up codes and invitation notices | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` |

## Run it

`run.json` holds the three commands:

```
npm ci            # install from the lockfile
npm run build     # builds the browser app (Vite) and the server (tsc)
npm run start     # serves on 0.0.0.0, in the foreground
```

The server listens on `APP_PUBLIC_PORT`, else `PORT`, else 4173. `GET /api/health` answers `{"status":"ok"}`, or
`{"status":"unavailable"}` when object storage cannot be reached, and 503 `{"status":"starting"}` until the database answers.
The server keeps starting when a service is down.

## Environment variables

| Variable | Meaning | Default |
|---|---|---|
| `APP_PUBLIC_PORT`, `PORT` | listening port | 4173 |
| `APP_PUBLIC_URL` | public base address used in invitation emails | none |
| `DATABASE_URL` | PostgreSQL connection string | none |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | object storage | none |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | mail sink and sender | none |
| `GRADING_KEY` | protects `POST /api/grading/seed`; without it the route is always `not_found` | none |
| `JARFUL_MAX_DOC_BYTES` | largest document in bytes | 16384 |
| `JARFUL_MAX_DEPTH` | deepest document nesting | 20 |
| `JARFUL_SCAN_LIMIT` | most documents one run may examine | 10000 |
| `JARFUL_PAGE_SIZE` | documents per results page | 20 |
| `JARFUL_IMPORT_MAX_LINES` | most data lines in one load | 5000 |
| `JARFUL_SCHEMA_SAMPLE` | documents the schema summary reads | 1000 |
| `JARFUL_PREVIEW_DOCS` | documents in each stage preview | 5 |
| `JARFUL_MAX_STAGES` | most stages in one pipeline | 20 |

Nothing in this list is ever sent to the browser. The app never writes under its own directory.

## Layout of the source

- `src/server`: HTTP boundary (`http.ts`), configuration (`config.ts`), PostgreSQL (`db.ts`, `store.ts`), object storage
  (`s3.ts`), mail (`mail.ts`), the query and aggregation engine (`engine/`) and the routes (`routes/`).
- `src/shared`: code both sides use (the number display rule, the document messages, the houseplant sample).
- `src/client`: the React app, its styles and the bundled fonts (`fonts/`, SIL OFL 1.1).
