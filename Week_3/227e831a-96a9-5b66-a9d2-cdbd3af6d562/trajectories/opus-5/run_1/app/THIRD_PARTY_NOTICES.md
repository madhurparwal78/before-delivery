# Third-party notices

Skinout ships the packages and fonts below. The package list is the production
dependency tree reported by `npm ls --omit=dev --all --json`.

## Shipped packages

| Package | Version | Licence |
| --- | --- | --- |
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
| xtend | 4.0.2 | MIT |

## Bundled fonts

| Font | Source package | Licence |
| --- | --- | --- |
| Space Grotesk | @fontsource/space-grotesk 5.1.1 | SIL OFL 1.1 |
| IBM Plex Sans | @fontsource/ibm-plex-sans 5.1.1 | SIL OFL 1.1 |
| IBM Plex Mono | @fontsource/ibm-plex-mono 5.1.1 | SIL OFL 1.1 |

The font files in `dist/public/fonts` are copied from those packages at build
time and served by the app itself.
