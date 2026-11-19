# Third-party notices

Kettlehole Audio Earshot ships the packages and fonts below. The package list is the
production dependency tree reported by `npm ls --omit=dev --all --json`.

## Shipped packages

| Package | Version | Licence |
| --- | --- | --- |
| busboy | 1.6.0 | MIT |
| lucide | 0.546.0 | ISC |
| pg | 8.16.3 | MIT |
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
| streamsearch | 1.1.0 | MIT |
| xtend | 4.0.2 | MIT |

## Shipped fonts

The app serves these fonts itself from `/fonts`. The WOFF2 files are copied into the build
from the `@fontsource` packages, which are build-time dependencies.

| Font | Source package | Licence |
| --- | --- | --- |
| Bricolage Grotesque | @fontsource/bricolage-grotesque 5.3.0 | SIL Open Font License 1.1 |
| Inter | @fontsource/inter 5.3.0 | SIL Open Font License 1.1 |
| JetBrains Mono | @fontsource/jetbrains-mono 5.3.0 | SIL Open Font License 1.1 |

## Build-time only

These are not shipped to the browser or the server runtime: esbuild (MIT), typescript
(Apache-2.0), @types/busboy (MIT), @types/node (MIT), @types/pg (MIT) and the three
`@fontsource` packages (MIT packaging around the OFL-1.1 fonts above).
