# Open Bonnet

Open Bonnet is the web product a private UK owner uses to sell one well-kept older car in the open.
The owner builds a single scroll-driven 3D condition walkround per car: every finding sits on the
panel it belongs to, paint gauge readings sit beside it, and the car's roadworthiness test record
is pulled, read and answered. Each named buyer then reaches every finding, claims a viewing, makes
an offer, and leaves a dated record of what they were shown. An inspector records independent gauge
readings on a pre-purchase visit, often with no signal.

## What it holds

- **Owner** — signs in with a passphrase, keeps one or more car files, places findings on the
  panel diagram, stores photos with the number plate masked for buyers, pulls and re-pulls the test
  record, answers every advisory, publishes a version with a stored PDF condition report, issues
  named links, offers viewing slots, accepts an offer and completes the sale.
- **Buyer** — arrives by a named link, walks round the faceted 3D car one finding at a time, reads
  every card, claims a viewing and makes an offer, and keeps a dated record of what they saw.
- **Inspector** — arrives by a named link and records readings and pinned findings that keep
  working with no signal and sync when the connection comes back.

## Running it

The run manifest is `run.json`. Nothing else is needed.

```sh
npm ci        # install, from the lockfile only
npm run build # type-check, then bundle the server, the client and the stylesheet
npm run serve # serve in the foreground on 0.0.0.0
```

`GET /api/health` answers `200 {"status":"ok"}` once the schema is applied and the seed has either
finished or been skipped. It keeps answering 200 while a backing service is down.

On every serve the app applies its schema (safe to repeat, safe to run concurrently) and, on an
empty database, seeds the published starting data. An instance that cannot reach the object store,
the renderer or the record API at boot skips seeding; exactly one instance that can reach them
completes it.

## What it reads from the environment

| Variable | What it is |
|---|---|
| `APP_PUBLIC_PORT` | the port to serve on (default 4173); the server binds `0.0.0.0` |
| `DATABASE_URL` | PostgreSQL, the system of record for cars, readings, findings, versions, links, seen records, slots, offers, alerts and owner sessions |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO, which holds the uploaded originals, the buyer copies, the condition reports and the handover record |
| `WIREMOCK_URL` | the roadworthiness-record API the owner pulls the test history from |
| `GOTENBERG_URL` | the renderer that turns this app's HTML into the condition report and the handover record |
| `NTFY_URL`, `NTFY_USERNAME`, `NTFY_PASSWORD` | the phone alerts for a viewing claim, a new offer and an offer about to lapse |
| `OFFER_LAPSE_SECONDS` | how long an offer stands (default 172800) |
| `OFFER_WARNING_SECONDS` | how little is left before the lapse warning (default 14400) |
| `LINK_TTL_SECONDS` | how long a named link lasts (default 1209600) |
| `RECORD_PULL_MAX_AGE_SECONDS` | how old a test record pull may be before publishing is blocked (default 2592000) |

Every one of them is read once, at start, in `src/server/config.ts`. None of them reaches the
browser: the client is served a page that knows only its own route.

## The seeded start

A fresh database holds the published seed: the owner's passphrase, a live `1998 Calder Merrow GT`
with nine findings, its photos, its test record and three viewing slots, a draft
`1999 Calder Tern 1.8`, and four named links (one buyer who has seen nothing, one who has seen the
first four findings, one who has seen all nine and holds a slot and an open offer, and one
inspector). Seeding writes the offer and the held slot
directly, so a fresh start has no alerts and the phone topic has no message.

## How it is built

- TypeScript on Node 22, with no web framework: `src/server` holds the API, the page shell and the
  static assets; `src/web` holds the client; `src/shared` holds what both sides must agree on — the
  thirteen panels, the car-space frames, the camera maths, the bands and the published copy.
- The stage is a Three.js scene built from this project's own geometry. It draws a frame only when
  the scroll position, the viewport or the server's state changes, and never while idle. Without
  WebGL, under reduced motion and after a lost context, the same geometry is drawn as a vector
  still through the same camera matrix.
- `npm run build` runs `tsc --noEmit` and then esbuild; the build output is `dist/server.js`,
  `public/app.js`, `public/sw.js` and `public/app.css`.
