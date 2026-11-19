# Pensight — repository notes

Pensight is the inspection console for a one-person ROV net-pen inspection
business. The Rust server owns every domain rule; the browser only displays the
server's results.

## Layout

```
/app
  run.json                  install / build / serve commands
  Cargo.toml, Cargo.lock    the Rust server
  src/
    main.rs                 boot, retry, axum serve
    config.rs               the environment variables, read once at start
    error.rs                ONE ApiError type -> the single published error shape
    db.rs                   pool, schema, id counters, the farm import lock
    seed.rs                 the exact starting seed, applied once
    model.rs                record loaders and every JSON shape
    history.rs              defect history entries and their `changes`
    report.rs               report pack build and exact restore
    valkey.rs               heartbeats, edit locks, the pensight:events channel
    store/s3.rs             MinIO over plain HTTP, SigV4 signed by hand
    domain/                 one place per rule (position, size, grade, clearance,
                            legacy import, link status, copilot, search, export)
    providers/              the two WireMock-backed HTTP providers
    api/                    the endpoints, the boundary and the router
  web/                      TypeScript console built with esbuild into web/dist
```

## Rules that live in exactly one place

| Rule | File |
|---|---|
| Bearing, depth, chart x/y and panel cell | `src/domain/position.rs` |
| Sizes, areas and fouling cover | `src/domain/size.rs` |
| Pen condition grade | `src/domain/grade.rs` |
| Clearance decision and staleness | `src/domain/clearance.rs` |
| Dive transitions | `src/api/dives.rs` |
| Edit lock check | `src/api/defects.rs::check_lock` |
| One-at-a-time defect writes | `select … for update` in `model::load_defect_for_update` |
| Import matching and serialisation | `src/domain/legacy.rs`, `db::lock_farm_imports` |
| Link status and regeneration | `src/domain/link.rs`, `src/api/links.rs` |
| Tool-call validation and findings context | `src/domain/copilot.rs` |
| Origin check and 405 by method and path | `src/api/mod.rs::boundary` |
| Search matching | `src/domain/search.rs` |
| Export neutralisation | `src/domain/export.rs` |

## Working with the stack

- Services come from the environment: `DATABASE_URL`, `S3_*`, `VALKEY_URL`,
  `WIREMOCK_URL`, `APP_PUBLIC_PORT`, `APP_PUBLIC_URL`.
- The browser must use the **origin of `APP_PUBLIC_URL`** (here
  `http://127.0.0.1:4173`). A write from `http://localhost:4173` is correctly
  refused with 403 `cross_origin`.
- The seed is written once and recorded in `app_meta`, so restarting after a
  farm erasure does not bring the farm back.
- To get back to a fresh install, drop and recreate the `public` schema in
  Postgres and restart the server.

## Build and run

```
cargo fetch --locked && npm ci --prefix web        # install
npm run build --prefix web && cargo build --release --locked   # build
./target/release/pensight                          # serve on 0.0.0.0:4173
```

The frontend bundle is `web/dist/pensight.js`; the server serves only
`web/dist`, the API and the report link pages.
