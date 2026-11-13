# Third-party notices

Stowdeck ships the packages, fonts and demo photographs listed here. Everything else in
this repository was written for this product.

## Shipped packages

These are the production dependency tree as reported by `npm ls --omit=dev --all --json`.

| Package | Version | Licence | Source |
| --- | --- | --- | --- |
| `busboy` | 1.6.0 | MIT | https://github.com/mscdex/busboy |
| `jpeg-js` | 0.4.4 | BSD-3-Clause | https://github.com/eugeneware/jpeg-js |
| `pg` | 8.23.1 | MIT | https://github.com/brianc/node-postgres |
| `pg-cloudflare` | 1.4.1 | MIT | https://github.com/brianc/node-postgres |
| `pg-connection-string` | 2.14.1 | MIT | https://github.com/brianc/node-postgres/tree/master/packages/pg-connection-string |
| `pg-int8` | 1.0.1 | ISC | https://github.com/charmander/pg-int8 |
| `pg-pool` | 3.14.0 | MIT | https://github.com/brianc/node-postgres/tree/master/packages/pg-pool |
| `pg-protocol` | 1.16.1 | MIT | https://github.com/brianc/node-postgres |
| `pg-types` | 2.2.0 | MIT | https://github.com/brianc/node-pg-types |
| `pgpass` | 1.0.5 | MIT | https://github.com/hoegaarden/pgpass |
| `pngjs` | 7.0.0 | MIT | https://github.com/lukeapage/pngjs |
| `postgres-array` | 2.0.0 | MIT | https://github.com/bendrucker/postgres-array |
| `postgres-bytea` | 1.0.1 | MIT | https://github.com/bendrucker/postgres-bytea |
| `postgres-date` | 1.0.7 | MIT | https://github.com/bendrucker/postgres-date |
| `postgres-interval` | 1.2.0 | MIT | https://github.com/bendrucker/postgres-interval |
| `split2` | 4.2.0 | ISC | https://github.com/mcollina/split2 |
| `streamsearch` | 1.1.0 | MIT | https://github.com/mscdex/streamsearch |
| `xtend` | 4.0.2 | MIT | https://github.com/Raynos/xtend |

## Build-time packages

These are development dependencies. They are not part of the shipped dependency tree, but
their output is: `esbuild` bundles the server and the browser code, `typescript` type-checks
it, and the icons below come from `lucide-static`.

| Package | Version | Licence | Source |
| --- | --- | --- | --- |
| `esbuild` | 0.24.x | MIT | https://github.com/evanw/esbuild |
| `lucide-static` | 0.468.x | ISC | https://github.com/lucide-icons/lucide |
| `typescript` | 5.7.x | Apache-2.0 | https://github.com/microsoft/TypeScript |
| `@types/busboy`, `@types/node`, `@types/pg`, `@types/pngjs` | — | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |

## Icons

The move, remove and close icons are `chevron-up`, `chevron-down` and `x` from the Lucide
icon set, inlined at build time from `lucide-static`.

- Lucide — ISC — https://github.com/lucide-icons/lucide

## Fonts

- **Host Grotesk** (`public/fonts/host-grotesk-latin.woff2`,
  `public/fonts/host-grotesk-latin-ext.woff2`) — SIL Open Font License 1.1 (OFL-1.1) —
  https://fonts.google.com/specimen/Host+Grotesk. The two files are the Latin and
  Latin Extended subsets published by Google Fonts.

## Demo photographs

No third-party photographs are shipped. The twelve object photographs used by the seed, and
the three of them the landing page plays, are procedurally drawn for this product by
`src/build/objects.ts` and written to `dist/public/assets/objects/` at build time. They are
original work owned by this project and carry no third-party licence.

The landing page labels them as stand-ins: `Demo photographs are open-access museum images
or drawn stand-ins.`

## Time zone data

The accepted home-zone list in `src/shared/zoneNames.ts` is the zone-name column of the
`zone.tab` table from the IANA time zone database, release 2025b
(https://www.iana.org/time-zones). The tz database is in the public domain.
