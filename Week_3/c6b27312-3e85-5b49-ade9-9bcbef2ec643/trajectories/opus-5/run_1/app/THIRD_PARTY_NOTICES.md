# Third-party notices

Tinework ships the packages below (the production dependency tree from
`npm ls --omit=dev --all --json`) and the two bundled font files. Everything else in the
app — the Tine evaluator, the pre-flight checks, the voxel compare, the WebGL scene, the
S3 client, the SMTP client and the ZIP and TAR writers — is first-party code.

## Shipped packages

| Package | Version | Licence |
|---|---|---|
| `@ioredis/commands` | 1.10.0 | MIT |
| `cluster-key-slot` | 1.1.1 | Apache-2.0 |
| `debug` | 4.4.3 | MIT |
| `denque` | 2.1.0 | Apache-2.0 |
| `earcut` | 3.2.4 | ISC |
| `ioredis` | 5.11.1 | MIT |
| `ms` | 2.1.3 | MIT |
| `pg` | 8.23.1 | MIT |
| `pg-cloudflare` | 1.4.1 | MIT |
| `pg-connection-string` | 2.14.1 | MIT |
| `pg-int8` | 1.0.1 | ISC |
| `pg-pool` | 3.14.0 | MIT |
| `pg-protocol` | 1.16.1 | MIT |
| `pg-types` | 2.2.0 | MIT |
| `pgpass` | 1.0.5 | MIT |
| `postgres-array` | 2.0.0 | MIT |
| `postgres-bytea` | 1.0.1 | MIT |
| `postgres-date` | 1.0.7 | MIT |
| `postgres-interval` | 1.2.0 | MIT |
| `redis-errors` | 1.2.0 | MIT |
| `redis-parser` | 3.0.0 | MIT |
| `split2` | 4.2.0 | ISC |
| `standard-as-callback` | 2.1.0 | MIT |
| `xtend` | 4.0.2 | MIT |

Direct dependencies are `pg` (PostgreSQL), `ioredis` (Valkey) and `earcut` (polygon
triangulation for the viewport meshes); the rest of the table is their own dependency
tree.

## Bundled fonts

| File | Face | Source | Licence |
|---|---|---|---|
| `public/fonts/stack-sans-text.woff2` | Stack Sans Text (weight 400) | Inter, by The Inter Project Authors | SIL Open Font License 1.1 |
| `public/fonts/stack-sans-headline.woff2` | Stack Sans Headline (weight 500) | Inter, by The Inter Project Authors | SIL Open Font License 1.1 |

Both files are copies of the Inter latin subsets published by `@fontsource/inter`
(itself MIT), taken at build time and served from the app's own origin. The Inter font
software is Copyright 2016 The Inter Project Authors
(https://github.com/rsms/inter) and is licensed under the SIL Open Font License,
Version 1.1, available at https://scripts.sil.org/OFL.

## Build-time only

TypeScript, esbuild, `@fontsource/inter` and the `@types/*` packages are development
dependencies: they produce the shipped bundle and are not part of it.
