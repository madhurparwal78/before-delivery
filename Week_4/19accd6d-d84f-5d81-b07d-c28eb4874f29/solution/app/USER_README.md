# Wringbench

Wringbench is a hosted data transformation workbench by Fallow Kettle Co. You paste text or drop a file, chain operations
into a recipe (encode, decode, compress, checksum, regular expressions, sorting, JSON and CSV) and watch the output change
as you type. Recipes bake in the browser, in a dedicated worker, so the text stays on the page. Saved recipes are versioned,
searchable and shared with a team, and two kinds of share link reproduce the exact recipe, input bytes and output.

## Run it

`run.json` holds the three commands:

```
install: npm ci
build:   npm run build      (type-checks, then bundles the server, the browser app and the bake worker into build/)
serve:   node build/server.js
```

The server binds `0.0.0.0` on `APP_PUBLIC_PORT` (default 4173), serves the built frontend and the API, and starts only once
PostgreSQL answers (it retries every 2 seconds). MinIO, Meilisearch and Mailpit may be down at start; the app then behaves
as described in the brief and recovers when they return. `GET /api/health` always answers 200.

## Services and settings

| Service | What it holds | Environment |
|---|---|---|
| PostgreSQL | accounts, sessions, teams, recipes and versions, snapshot records, file records, import attempts | `DATABASE_URL` |
| MinIO | `files/<id>`, `snapshots/<token>/input`, `snapshots/<token>/output` | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Mailpit (SMTP) | verification and invite emails | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` |
| Meilisearch | the Library search index | `MEILISEARCH_URL`, `MEILISEARCH_API_KEY`, `WRINGBENCH_SEARCH_INDEX` |

Other settings: `APP_PUBLIC_PORT`, `APP_PUBLIC_URL` (the base of emailed links), `WRINGBENCH_AUTOBAKE_MS`,
`WRINGBENCH_REGEX_BUDGET_MS`, `WRINGBENCH_INPUT_MAX_BYTES`, `WRINGBENCH_FILE_MAX_BYTES`, `WRINGBENCH_OUTPUT_DISPLAY_BYTES`,
`WRINGBENCH_VERSIONS_KEPT`, `WRINGBENCH_TEAM_MAX`, `WRINGBENCH_SHARE_TTL_CHOICES`, `WRINGBENCH_INVITE_TTL_SECONDS`,
`WRINGBENCH_VERIFY_TTL_SECONDS` and `WRINGBENCH_GRADING` (`1` turns on `POST /api/grading/seed` and `/api/grading/outage`).
The limits the page obeys are published at `GET /api/config`. No credential is ever sent to the browser.

## Layout of the source

- `src/shared`: the operation catalogue (one definition per operation: name, arguments, defaults and behaviour), step
  validation, span carry, the bake protocol and the small helpers both sides use.
- `src/worker`: the bake worker. Every operation of a bake runs there.
- `src/server`: the API, the live channel (`/api/live`, WebSocket), the storage, mail and search clients.
- `src/client`: the React app: workbench, Library, history, import, team, snapshot and account screens.
