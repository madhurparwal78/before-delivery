# Third party notices

Sixbell Rest Log ships the packages and fonts below. Everything listed is under MIT, Apache-2.0,
BSD-2-Clause, BSD-3-Clause, ISC or SIL OFL-1.1.

## Shipped packages

The production dependency tree, as reported by `npm ls --omit=dev --all --json`.

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

`pg` declares `pg-native` as an optional peer dependency. It is not installed and not shipped.

## Bundled fonts

Both families are served by the application from `/static/fonts/` as WOFF2 files, taken from the
`@fontsource` packages at build time.

| Font | Files | Copyright | Licence |
| --- | --- | --- | --- |
| Spectral | `spectral-400.woff2`, `spectral-400-italic.woff2`, `spectral-600.woff2`, `spectral-600-italic.woff2` | Copyright 2017 The Spectral Project Authors | SIL OFL-1.1 |
| IBM Plex Sans | `plex-400.woff2`, `plex-500.woff2`, `plex-600.woff2` | Copyright 2019 IBM Corp. | SIL OFL-1.1 |

## Build-time only

These are development dependencies. They are not shipped with the running product.

| Package | Licence |
| --- | --- |
| esbuild | MIT |
| typescript | Apache-2.0 |
| @types/node | MIT |
| @types/pg | MIT |
| @fontsource/spectral | MIT (packaging); fonts under SIL OFL-1.1 |
| @fontsource/ibm-plex-sans | MIT (packaging); fonts under SIL OFL-1.1 |
