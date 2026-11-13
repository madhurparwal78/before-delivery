# Third party notices

Long Rail Headstring ships the production dependency tree below (`npm ls --omit=dev --all`) and
the bundled fonts. Everything else in `/app` is first-party code.

## Shipped packages

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

`pg-native` is an unmet optional dependency of `pg`; it is not installed and not shipped.

## Bundled fonts

| Font | Version | Licence |
| --- | --- | --- |
| Big Shoulders Display (`public/fonts/big-shoulders-display.woff2`) | v24 (Google Fonts build) | OFL-1.1 |
| IBM Plex Sans (`public/fonts/ibm-plex-sans.woff2`) | v23 (Google Fonts build) | OFL-1.1 |

## Build-only tools

These are development dependencies and are not shipped with the running app: `typescript`
(Apache-2.0), `esbuild` (MIT), `@types/node` (MIT), `@types/pg` (MIT).
