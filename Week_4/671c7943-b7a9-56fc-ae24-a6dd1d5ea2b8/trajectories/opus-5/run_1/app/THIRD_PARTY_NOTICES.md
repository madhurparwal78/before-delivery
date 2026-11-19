# Third party notices

Sollis Studio Folio ships the packages below. The list is the production dependency
tree reported by `npm ls --omit=dev --all --json`.

## Shipped packages

| Package | Version | Licence |
|---|---|---|
| `@fontsource/instrument-sans` | 5.3.0 | OFL-1.1 |
| `@fontsource/instrument-serif` | 5.3.0 | OFL-1.1 |
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
| `split2` | 4.2.0 | ISC |
| `xtend` | 4.0.2 | MIT |

Every package above is under the MIT or ISC licence, except the two `@fontsource`
packages, which are under the SIL Open Font Licence 1.1 and supply the font files
the app serves.

## Font families

| Family | Package | Licence |
|---|---|---|
| Instrument Serif | `@fontsource/instrument-serif` | SIL Open Font Licence 1.1 |
| Instrument Sans | `@fontsource/instrument-sans` | SIL Open Font Licence 1.1 |

Instrument Serif is Copyright 2022 The Instrument Serif Project Authors and
Instrument Sans is Copyright 2022 The Instrument Sans Project Authors, both
licensed under the SIL Open Font Licence, Version 1.1. The full licence text ships with each
package at `node_modules/@fontsource/instrument-serif/LICENSE` and
`node_modules/@fontsource/instrument-sans/LICENSE`.

## Build tools

The build uses `typescript` and `esbuild` as development dependencies. Neither is
shipped: the served bundle holds only this project's own code.
