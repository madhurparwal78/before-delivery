# Third-party notices

Galley ships the packages and font files listed here. Every entry is used as published,
without modification.

## Shipped packages

The production dependency tree, from `npm ls --omit=dev --all --json`.

| Package | Version | Licence |
| --- | --- | --- |
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

## Bundled fonts

The three typefaces are served by the app from `/static/fonts/`. Each is used under the
SIL Open Font License 1.1 (OFL-1.1).

| Font | Files | Licence | Copyright |
| --- | --- | --- | --- |
| Source Serif 4 | `source-serif-4-latin-400-normal.woff2`, `source-serif-4-latin-600-normal.woff2`, `source-serif-4-latin-400-italic.woff2` | OFL-1.1 | Copyright 2014-2023 Adobe (http://www.adobe.com/), with Reserved Font Name "Source". |
| IBM Plex Sans | `ibm-plex-sans-latin-400-normal.woff2`, `ibm-plex-sans-latin-500-normal.woff2`, `ibm-plex-sans-latin-600-normal.woff2` | OFL-1.1 | Copyright 2017 IBM Corp. All rights reserved. |
| IBM Plex Mono | `ibm-plex-mono-latin-400-normal.woff2`, `ibm-plex-mono-latin-500-normal.woff2` | OFL-1.1 | Copyright 2017 IBM Corp. All rights reserved. |

The font files come from the `@fontsource/source-serif-4`, `@fontsource/ibm-plex-sans` and
`@fontsource/ibm-plex-mono` packages, which are build-time only and are not themselves shipped.

## Licence texts

- MIT: https://opensource.org/license/mit/
- ISC: https://opensource.org/license/isc-license-txt/
- OFL-1.1: https://openfontlicense.org/
