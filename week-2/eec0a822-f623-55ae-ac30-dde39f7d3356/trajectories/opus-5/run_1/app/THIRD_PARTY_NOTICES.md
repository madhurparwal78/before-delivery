# Third party notices

Tidewright ships the packages and fonts listed here. Every licence below is one of
MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, CC0-1.0 or OFL-1.1.

## Shipped packages

The production dependency tree as `npm ls --omit=dev --all --json` reports it.

| Package | Version | Licence |
|---|---|---|
| jpeg-js | 0.4.4 | BSD-3-Clause |
| pg | 8.23.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-int8 | 1.0.1 | ISC |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pgpass | 1.0.5 | MIT |
| pngjs | 7.0.0 | MIT |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| split2 | 4.2.0 | ISC |
| xtend | 4.0.2 | MIT |

`pg` declares `pg-native` (MIT) as an optional peer dependency. It is not installed and
not shipped: Tidewright uses the pure JavaScript driver.

## Bundled fonts

| Font | Licence |
|---|---|
| Newsreader | SIL Open Font License 1.1 (OFL-1.1) |
| Inter | SIL Open Font License 1.1 (OFL-1.1) |
| IBM Plex Mono | SIL Open Font License 1.1 (OFL-1.1) |

## Build-only tools

These are development dependencies and are not part of the served app:
esbuild (MIT), typescript (Apache-2.0), @types/node (MIT), @types/pg (MIT),
@types/pngjs (MIT).
