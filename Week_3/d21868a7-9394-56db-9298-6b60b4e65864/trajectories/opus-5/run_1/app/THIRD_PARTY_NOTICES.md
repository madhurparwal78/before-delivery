# Third party notices

Ditchbook ships the production dependency tree below, as reported by
`npm ls --omit=dev --all --json`, together with the bundled fonts and icon
drawings listed after it. Every licence is one of MIT, ISC, BSD-2-Clause,
BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1.

## Shipped packages

| Package | Version | Licence | Home |
| --- | --- | --- | --- |
| `pg` | 8.23.1 | MIT | https://github.com/brianc/node-postgres |
| `pg-cloudflare` | 1.4.1 | MIT | https://www.npmjs.com/package/pg-cloudflare |
| `pg-connection-string` | 2.14.1 | MIT | https://github.com/brianc/node-postgres/tree/master/packages/pg-connection-string |
| `pg-int8` | 1.0.1 | ISC | https://www.npmjs.com/package/pg-int8 |
| `pg-pool` | 3.14.0 | MIT | https://github.com/brianc/node-postgres/tree/master/packages/pg-pool#readme |
| `pg-protocol` | 1.16.1 | MIT | https://www.npmjs.com/package/pg-protocol |
| `pg-types` | 2.2.0 | MIT | https://github.com/brianc/node-pg-types |
| `pgpass` | 1.0.5 | MIT | https://www.npmjs.com/package/pgpass |
| `postgres-array` | 2.0.0 | MIT | https://www.npmjs.com/package/postgres-array |
| `postgres-bytea` | 1.0.1 | MIT | https://www.npmjs.com/package/postgres-bytea |
| `postgres-date` | 1.0.7 | MIT | https://www.npmjs.com/package/postgres-date |
| `postgres-interval` | 1.2.0 | MIT | https://www.npmjs.com/package/postgres-interval |
| `split2` | 4.2.0 | ISC | https://www.npmjs.com/package/split2 |
| `xtend` | 4.0.2 | MIT | https://github.com/Raynos/xtend |

## Bundled fonts

| Font | Files | Licence | Source |
| --- | --- | --- | --- |
| Archivo (400, 700) | `/fonts/archivo-400.woff2`, `/fonts/archivo-700.woff2` | OFL-1.1 | https://github.com/Omnibus-Type/Archivo, packaged by `@fontsource/archivo` (OFL-1.1) |
| IBM Plex Sans (400, 600) | `/fonts/plex-400.woff2`, `/fonts/plex-600.woff2` | OFL-1.1 | https://github.com/IBM/plex, packaged by `@fontsource/ibm-plex-sans` (OFL-1.1) |

## Bundled icon drawings

| Set | Licence | Source |
| --- | --- | --- |
| Lucide icons, inlined at build time into `src/client/lucide.ts` | ISC | https://github.com/lucide-icons/lucide, packaged by `lucide-static` (ISC) |

The headgate glyph and the cobalt sweep are drawn in this repository's own code.

## Build-time only

These are development dependencies and are not shipped: `@fontsource/archivo`
(OFL-1.1), `@fontsource/ibm-plex-sans` (OFL-1.1), `lucide-static` (ISC),
`esbuild` (MIT), `typescript` (Apache-2.0), `@types/node` (MIT) and
`@types/pg` (MIT). The font and icon files they carry are listed above because
the built app bundles them.
