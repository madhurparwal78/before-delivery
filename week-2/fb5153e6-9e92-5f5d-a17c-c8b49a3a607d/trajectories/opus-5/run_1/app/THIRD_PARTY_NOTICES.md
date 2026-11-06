# Third-party notices

Turnstone Studio ships the packages and fonts listed here. Every one is covered
by a licence from the allowed set: MIT, ISC, BSD-2-Clause, BSD-3-Clause,
Apache-2.0, 0BSD, MPL-2.0 or the SIL Open Font License 1.1.

## Shipped packages

These are the production dependency tree, as reported by
`npm ls --omit=dev --all --json`.

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

The font files are served by the app itself, from `assets/fonts`. No page
loads a script, style or font from another origin.

| File | Family | Licence |
| --- | --- | --- |
| `ibm-plex-mono-latin-400-normal.woff2` | IBM Plex Mono | SIL Open Font License 1.1 |
| `ibm-plex-mono-latin-600-normal.woff2` | IBM Plex Mono | SIL Open Font License 1.1 |
| `ibm-plex-sans-latin-400-normal.woff2` | IBM Plex Sans | SIL Open Font License 1.1 |
| `ibm-plex-sans-latin-600-normal.woff2` | IBM Plex Sans | SIL Open Font License 1.1 |
| `space-grotesk-latin-500-normal.woff2` | Space Grotesk | SIL Open Font License 1.1 |
| `space-grotesk-latin-600-normal.woff2` | Space Grotesk | SIL Open Font License 1.1 |

Space Grotesk is © Florian Karsten, released under the SIL Open Font License 1.1.
IBM Plex Sans and IBM Plex Mono are © IBM Corp., released under the SIL Open
Font License 1.1. The files were taken from the `@fontsource` packages of the
same names, which are build tooling only and are not shipped.
