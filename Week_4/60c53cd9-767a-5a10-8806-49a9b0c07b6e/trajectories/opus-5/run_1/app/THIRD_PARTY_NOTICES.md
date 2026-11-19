# Third party notices

Highwater Unit Finder ships the packages and assets below. Every one of them is
licensed under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, CC0-1.0
or OFL-1.1.

## Shipped packages

These are the production dependency tree from `npm ls --omit=dev --all --json`.

| Package | Version | Licence |
| --- | --- | --- |
| `draco3d` | 1.5.7 | Apache-2.0 |
| `meilisearch` | 0.45.0 | MIT |
| `pg` | 8.13.1 | MIT |
| `pg-cloudflare` | 1.4.1 | MIT |
| `pg-connection-string` | 2.14.1 | MIT |
| `pg-int8` | 1.0.1 | ISC |
| `pg-pool` | 3.14.0 | MIT |
| `pg-protocol` | 1.16.1 | MIT |
| `pg-types` | 2.2.0 | MIT |
| `pgpass` | 1.0.6 | MIT |
| `postgres-array` | 2.0.0 | MIT |
| `postgres-bytea` | 1.0.1 | MIT |
| `postgres-date` | 1.0.7 | MIT |
| `postgres-interval` | 1.2.0 | MIT |
| `xtend` | 4.0.2 | MIT |

## Bundled assets

| Asset | Source | Licence |
| --- | --- | --- |
| `three` (bundled into `dist/public/app.js`) | three.js r171 | MIT |
| Draco decoder (`dist/public/draco/draco_wasm_wrapper.js`, `draco_decoder.wasm`) | Google Draco, shipped with three.js | Apache-2.0 |
| Red Hat Display typeface (`dist/public/fonts/red-hat-display-*.woff2`) | Red Hat, Inc., via `@fontsource/red-hat-display` | OFL-1.1 |
| Red Hat Text typeface (`dist/public/fonts/red-hat-text-*.woff2`) | Red Hat, Inc., via `@fontsource/red-hat-text` | OFL-1.1 |
| Lucide icons (`dist/public/icons.svg`) | Lucide, via `lucide-static` | ISC |

## Build-only tools

`typescript`, `esbuild`, `@types/*`, `@fontsource/red-hat-display`,
`@fontsource/red-hat-text`, `lucide-static` and `three` are development
dependencies. The fonts, icons and the three.js runtime they provide are
copied or bundled into `dist/public` and are listed above as shipped assets.
