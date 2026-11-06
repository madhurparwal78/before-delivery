# Third party notices

Lanternline Handshake Desk ships the packages and fonts listed below. Every entry
uses one of MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1.

## Shipped npm packages

The production dependency tree (`npm ls --omit=dev --all`) is:

| Package | Version | Licence |
|---|---|---|
| pg | 8.13.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pg-int8 | 1.0.1 | ISC |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| xtend | 4.0.2 | MIT |
| pgpass | 1.0.6 | MIT |

`pg-native` is an unmet optional dependency and is not installed or shipped.

## Bundled fonts

The font files under `assets/fonts` are served by the app itself from its own origin.

| Font | Files | Licence |
|---|---|---|
| Space Grotesk | `spacegrotesk-v22-*.woff2` | OFL-1.1 |
| IBM Plex Sans | `ibmplexsans-v23-*.woff2` | OFL-1.1 |
| IBM Plex Mono | `ibmplexmono-v20-*.woff2` | OFL-1.1 |

## Build-only tooling

These are development dependencies and are not shipped at runtime.

| Package | Version | Licence |
|---|---|---|
| typescript | 5.7.2 | Apache-2.0 |
| @types/node | 22.10.1 | MIT |
| @types/pg | 8.11.10 | MIT |
