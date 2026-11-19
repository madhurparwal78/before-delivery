# Semenza Desk

The working desk of one independent upholsterer and furniture conservator in Turin, and the public site of Bottega Semenza.
It carries one chair from stamp and condition pins through material, dye lot, hide layout, estimate, private client page,
bench weeks and courier collection to a signed conservation dossier as a PDF. Visitors read finished cases and send enquiries;
clients answer on a private page in English, Italian, Japanese or Arabic.

## Running it

The commands are in `run.json`:

```
npm ci          # install
npm run build   # bundles the server and the browser code into dist/
npm run serve   # serves on 0.0.0.0, port APP_PUBLIC_PORT (4173 by default)
```

Node 22 is required. On start the app applies its schema, seeds an empty database and keeps retrying any file store,
search or PDF service that is down. `GET /api/health` answers `{"status":"ok"}`.

Seeded sign-ins: `agnese@bottega-semenza.example` / `tacks-and-hide-2027` and `ruben@bottega-semenza.example` / `second-desk-2027`.

## Environment

| Variable | Service | Purpose |
|---|---|---|
| `DATABASE_URL` | Postgres | system of record |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | every file, byte for byte; the bucket is made if missing |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit | client, reminder and enquiry mail; `MAIL_FROM` falls back to `Semenza Desk <desk@bottega-semenza.example>` |
| `WIREMOCK_URL` | WireMock | the supplier and courier APIs |
| `GOTENBERG_URL` | Gotenberg | dossier PDFs |
| `MEILISEARCH_URL`, `MEILISEARCH_API_KEY`, `SEARCH_INDEX_PREFIX` | Meilisearch | the desk's search; index `<prefix>_entries`, default prefix `main` |
| `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` | none | the port, and the base of private client addresses when set |
| `ENQUIRY_RATE_WINDOW_SECONDS`, `FILE_RATE_WINDOW_SECONDS` | none | rate windows, 3600 seconds by default |
| `STOCK_CACHE_SECONDS` | none | supplier stock cache, 300 |
| `CLOSURE_WAIT_SECONDS` | none | wait before a closed client is erased, 2592000 |
| `HOLD_DAYS` | none | days a dye lot hold lasts, 7 |
| `CLIENT_PAGE_SECONDS`, `REMINDER_AFTER_SECONDS` | none | client page life 1209600 and reminder 604800 |
| `SESSION_SECONDS` | none | session life, 604800 |

`MAILPIT_URL` is provided by the environment for tooling; the app sends through SMTP and does not read it.
