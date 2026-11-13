# Third-party notices

Kinfold ships the packages, fonts and icons listed here. Every one of them is covered by a licence
from the permitted set: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1.

## Shipped packages

These are the production dependency tree reported by `npm ls --omit=dev --all --json`.

| Package | Version | Licence |
| --- | --- | --- |
| pg | 8.23.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-int8 | 1.0.1 | ISC |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pgpass | 1.0.5 | MIT |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| split2 | 4.2.0 | ISC |
| xtend | 4.0.2 | MIT |

`pg-native` is an optional peer of `pg` and is not installed or shipped.

## Bundled fonts

Both font families are served by the app itself from `/fonts`, as WOFF2 files taken from the
`@fontsource` packages at build time. The packaging tooling is MIT; the typefaces themselves are
under the SIL Open Font License 1.1.

| Font | Source package | Licence |
| --- | --- | --- |
| Literata (400, 600, 700) | @fontsource/literata 5.3.0 | OFL-1.1 |
| Atkinson Hyperlegible (400, 700) | @fontsource/atkinson-hyperlegible 5.3.0 | OFL-1.1 |

## Icons

Kinfold bundles no third-party icon set. The lock and card-actions icons are hand-authored inline
SVG in this repository and are covered by the project's own licence.

## Build-time tools

These are development dependencies. They are not shipped to the browser or to the server runtime:
TypeScript (Apache-2.0), esbuild (MIT), @types/node (MIT), @types/pg (MIT).
