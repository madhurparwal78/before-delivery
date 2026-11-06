# Third-party notices

Swarmline Bloom Desk ships the packages, fonts and icons listed here. Every
licence below is one of MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD
or the SIL Open Font License 1.1.

## Shipped packages

The production dependency tree reported by `npm ls --omit=dev --all --json`.

| Package | Version | Licence |
| --- | --- | --- |
| `pg` | 8.16.3 | MIT |
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

Each font is served by the app itself from `/fonts` and is licensed under the
SIL Open Font License 1.1.

| Font | Version | Weights bundled | Licence | Source package |
| --- | --- | --- | --- | --- |
| Young Serif | 5.2.5 | 400 | SIL Open Font License 1.1 | `@fontsource/young-serif` |
| Public Sans | 5.2.5 | 400, 600 | SIL Open Font License 1.1 | `@fontsource/public-sans` |
| IBM Plex Mono | 5.2.5 | 400, 600 | SIL Open Font License 1.1 | `@fontsource/ibm-plex-mono` |

Each `@fontsource` package carries the SIL Open Font License 1.1 text of the
Google Fonts distribution it repackages, in `node_modules/@fontsource/<font>/LICENSE`.
Only the `latin` WOFF2 files listed above are bundled.

## Bundled icons

| Icons | Version | Licence |
| --- | --- | --- |
| Lucide (`compass`, `log-out`, `panel-left`, `file-text`) | 0.544.0 | ISC |

Lucide: Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2023
as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide
Contributors 2022.

## Build-time tools

These are not shipped to the browser or the server runtime: `typescript`,
`esbuild`, `@types/node`, `@types/pg`, `@fontsource/*` and `lucide-static`
(the last two supply the bundled font files and icon geometry listed above).
