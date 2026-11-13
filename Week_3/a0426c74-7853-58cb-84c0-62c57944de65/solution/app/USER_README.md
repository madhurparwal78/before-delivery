# Plotfold

Plotfold is a drafting and review desk that runs in the browser. Small teams draw anything to scale from a typed
command line or with the pointer, work live with each other (each person has their own undo), use layers, blocks,
dimensions, hatches and constraints, attach other drawings as references (xrefs), lay out paper sheets with scaled
viewports and publish numbered sheet versions. Reviewers compare two versions with Delta swipe, mark them up, approve
or reject them and follow up with pinned issues and linked RFIs, including from a phone.

One TypeScript web app: a Node server and a browser client, on two services.

- **PostgreSQL** holds the server-ordered operation log and every record (accounts, folders and roles, drawings,
  layers, blocks, constraints, sheets, versions, markups, issues, RFIs, reviews, links, export jobs, undo stacks).
- **MinIO** holds every byte that must survive as a file: underlay images, imported drawing files, published sheet
  files and exports.

## Run it

`run.json` holds the three commands:

```
install   npm ci
build     npm run build        (esbuild bundles the server and the browser client into dist/)
serve     node dist/server.js  (foreground; listens on 0.0.0.0, port APP_PUBLIC_PORT, default 4173)
```

`GET /api/health` answers `{"status":"ok"}` when MinIO answers and `{"status":"unavailable"}` when it does not (always
HTTP 200). If PostgreSQL is unreachable at start the server retries every second and answers health once connected; if
MinIO is unreachable the server still boots and serves drawings, and publish, underlay, import and export answer their
outage texts until storage returns (no restart needed).

Development helpers: `npm run typecheck` (tsc), `npm test` (node:test unit tests).

## Environment variables

| Variable | Service / use | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | required |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | required |
| `APP_PUBLIC_PORT` | listening port | 4173 |
| `PLOT_GRADING` | `1` turns the grading routes on (seed, session, view, clock, operation batch, storage); unset: they answer 404 | off |
| `PLOT_PRESENCE_TIMEOUT_MS` | person removed from "People here" this long after their socket closes | 15000 |
| `PLOT_LINK_TTL_MS` | view link lifetime | 604800000 |
| `PLOT_REVIEW_TTL_MS` | each review step is due this long after it opens | 604800000 |
| `PLOT_OP_WINDOW` | a base revision more than this many revisions behind is refused (`stale_base`) | 1000 |
| `PLOT_DOM_MARGIN_PX` | browser keeps entity elements within this margin of the view | 200 |
| `PLOT_DOM_CEILING` | at most this many entity elements (nearest first) stay in the page | 500 |
| `PLOT_UNDERLAY_MAX_BYTES` | largest underlay image | 2000000 |
| `PLOT_DRAWING_QUOTA_BYTES` | total underlay bytes per drawing | 20000000 |
| `PLOT_TEXT_MAX_BYTES` | largest imported drawing text file | 1000000 |
| `PLOT_EXPORT_STEP_MS` | an export job advances 20 percent every step | 400 |
| `PLOT_OP_RATE` | operations per person per minute | 600 |
| `PLOT_LOGIN_RATE` | sign-in attempts per username per minute | 10 |
| `PLOT_TOAST_MS` | how long a toast stays (sent to the browser) | 5000 |
| `PLOT_UNDO_DEPTH` | undo groups kept per person per drawing | 100 |

Credentials and service URLs are read from the environment at start and never sent to the browser; the page receives
only the toast lifetime, the DOM margin and the DOM ceiling.

## Files

Exports are the Plotfold drawing text format (`plotfold 1`) and standalone SVG. Fonts (Funnel Display, Funnel Sans) are
bundled and served from `/fonts`; nothing is loaded from another origin. Third-party licences are listed in
`THIRD_PARTY_NOTICES.md`.
