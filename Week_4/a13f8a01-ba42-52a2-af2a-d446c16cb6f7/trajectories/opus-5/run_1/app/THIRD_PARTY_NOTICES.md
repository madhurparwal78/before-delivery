# Third party notices

Ashlar ships the packages, shelf libraries and fonts listed here. Every one of them is covered by
MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1.

## Shipped packages

The production dependency tree, as reported by `npm ls --omit=dev --all --json`.

| Package | Version | Licence |
| --- | --- | --- |
| `acorn` | 8.14.0 | MIT |
| `pg` | 8.13.1 | MIT |
| `pg-cloudflare` | 1.4.1 | MIT |
| `pg-connection-string` | 2.14.1 | MIT |
| `pg-int8` | 1.0.1 | ISC |
| `pg-native` | optional, not installed | BSD-3-Clause |
| `pg-pool` | 3.14.0 | MIT |
| `pg-protocol` | 1.16.1 | MIT |
| `pg-types` | 2.2.0 | MIT |
| `pgpass` | 1.0.6 | MIT |
| `postgres-array` | 2.0.0 | MIT |
| `postgres-bytea` | 1.0.1 | MIT |
| `postgres-date` | 1.0.7 | MIT |
| `postgres-interval` | 1.2.0 | MIT |
| `xtend` | 4.0.2 | MIT |

## Build-time packages

These run only during `npm run build`; their code is not served. The shelf libraries and fonts they
provide are listed in their own sections below.

| Package | Version | Licence |
| --- | --- | --- |
| `@fontsource/fragment-mono` | 5.1.0 | OFL-1.1 |
| `@fontsource/work-sans` | 5.1.0 | OFL-1.1 |
| `@types/node` | 22.10.2 | MIT |
| `@types/pg` | 8.11.10 | MIT |
| `canvas-confetti` | 1.9.3 | ISC |
| `dayjs` | 1.11.13 | MIT |
| `esbuild` | 0.24.2 | MIT |
| `lodash` | 4.17.21 | MIT |
| `matter-js` | 0.20.0 | MIT |
| `tinycolor2` | 1.6.0 | MIT |
| `typescript` | 5.7.2 | Apache-2.0 |

## Shelf libraries

Served by the app at `/shelf/<name>@<version>/<file>`, and mirrored into the bucket under
`shelf/<name>@<version>/<file>`.

| Shelf id | File | Global | Licence |
| --- | --- | --- | --- |
| `dayjs@1.11.13` | `dayjs.min.js` | `dayjs` | MIT |
| `lodash@4.17.21` | `lodash.min.js` | `_` | MIT |
| `matter-js@0.20.0` | `matter.min.js` | `Matter` | MIT |
| `tinycolor2@1.6.0` | `tinycolor.js` | `tinycolor` | MIT |
| `canvas-confetti@1.9.3` | `confetti.js` | `confetti` | ISC |

## Fonts

Served by the app at `/public/fonts/`, so no font is ever fetched from an outside host.

| Font | Files | Licence |
| --- | --- | --- |
| Work Sans | `work-sans-latin-{200,300,400,500,600}-normal.woff2` | OFL-1.1 (SIL Open Font License 1.1) |
| Fragment Mono | `fragment-mono-latin-400-normal.woff2` | OFL-1.1 (SIL Open Font License 1.1) |
