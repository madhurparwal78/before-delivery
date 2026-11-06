# Third-party notices

Hourline Launch Hub ships the production dependency tree below (`npm ls --omit=dev --all`), together with the bundled fonts and icon set. Every entry is under a permissive licence: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, CC0-1.0 or OFL-1.1.

## Shipped npm packages

| Package | Version | Licence |
|---|---|---|
| `@fontsource/archivo` | 5.1.0 | OFL-1.1 |
| `@fontsource/ibm-plex-mono` | 5.1.0 | OFL-1.1 |
| `@fontsource/inter` | 5.1.0 | OFL-1.1 |
| `jpeg-js` | 0.4.4 | BSD-3-Clause |
| `lucide-static` | 0.460.0 | ISC |
| `pg` | 8.13.1 | MIT |
| `pg-cloudflare` | 1.4.1 | MIT |
| `pg-connection-string` | 2.14.1 | MIT |
| `pg-int8` | 1.0.1 | ISC |
| `pg-pool` | 3.14.0 | MIT |
| `pg-protocol` | 1.16.1 | MIT |
| `pg-types` | 2.2.0 | MIT |
| `pgpass` | 1.0.6 | MIT |
| `pngjs` | 7.0.0 | MIT |
| `postgres-array` | 2.0.0 | MIT |
| `postgres-bytea` | 1.0.1 | MIT |
| `postgres-date` | 1.0.7 | MIT |
| `postgres-interval` | 1.2.0 | MIT |
| `xtend` | 4.0.2 | MIT |

## Bundled fonts

| Font | Source package | Licence |
|---|---|---|
| Archivo | `@fontsource/archivo` | OFL-1.1 |
| Inter | `@fontsource/inter` | OFL-1.1 |
| IBM Plex Mono | `@fontsource/ibm-plex-mono` | OFL-1.1 |

Only the Latin WOFF2 subsets listed in `scripts/build.mjs` are copied into
`dist/public/fonts` and served from the app's own origin.

## Bundled icon set

| Icon set | Source package | Licence |
|---|---|---|
| Lucide (line icons) | `lucide-static` | ISC |

The build inlines the icons named in `scripts/build.mjs` into a single
`dist/public/icons.svg` sprite.

## Images

Every garment illustration, seeded look image and favicon is drawn by the app's own
code (`src/server/services/images.ts`). The repository contains no photographs and no
copied image files.
