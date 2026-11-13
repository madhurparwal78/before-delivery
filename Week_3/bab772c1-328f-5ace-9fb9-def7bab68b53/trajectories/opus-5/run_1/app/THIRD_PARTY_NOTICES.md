# Third-party notices

Perilune Ledger ships the packages and fonts below. Everything else in the app is
its own source.

## Shipped packages

The production dependency tree (`npm ls --omit=dev --all`):

| Package | Version | Licence |
| --- | --- | --- |
| @ioredis/commands | 1.11.0 | MIT |
| amqplib | 2.2.1 | MIT |
| cluster-key-slot | 1.1.2 | Apache-2.0 |
| debug | 4.4.3 | MIT |
| denque | 2.1.0 | Apache-2.0 |
| ioredis | 5.4.1 | MIT |
| lodash.defaults | 4.2.0 | MIT |
| lodash.isarguments | 3.1.0 | MIT |
| ms | 2.1.3 | MIT |
| pg | 8.13.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-int8 | 1.0.1 | ISC |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pgpass | 1.0.6 | MIT |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| redis-errors | 1.2.0 | MIT |
| redis-parser | 3.0.0 | MIT |
| standard-as-callback | 2.1.0 | MIT |
| xtend | 4.0.2 | MIT |

## Bundled fonts

Served from the app's own origin (`/fonts/`) and sent to the PDF renderer with
each dossier. The files come from the Fontsource packages named below, which are
build-time dependencies only.

| Font | Files | Licence |
| --- | --- | --- |
| Archivo (Omnibus-Type) | `archivo-latin-400-normal.woff2`, `archivo-latin-600-normal.woff2` | SIL OFL 1.1 |
| IBM Plex Sans (IBM) | `ibm-plex-sans-latin-400-normal.woff2`, `ibm-plex-sans-latin-600-normal.woff2` | SIL OFL 1.1 |
| IBM Plex Mono (IBM) | `ibm-plex-mono-latin-400-normal.woff2`, `ibm-plex-mono-latin-500-normal.woff2` | SIL OFL 1.1 |

## Build-time tools

These are development dependencies and are not shipped with the app:
`@fontsource/archivo`, `@fontsource/ibm-plex-mono`, `@fontsource/ibm-plex-sans`
(SIL OFL 1.1 for the font files, MIT for the packaging), `@types/node` (MIT),
`@types/pg` (MIT), `esbuild` (MIT) and `typescript` (Apache-2.0).
