# Third-party notices

Crosshand Relay ships the packages and fonts listed here. Package versions and licences
come from the production dependency tree (`npm ls --omit=dev --all --json`).

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
| react | 19.0.0 | MIT |
| react-dom | 19.0.0 | MIT |
| scheduler | 0.25.0 | MIT |
| xtend | 4.0.2 | MIT |

## Bundled fonts

| Font | Package | Version | Licence |
| --- | --- | --- | --- |
| Archivo | @fontsource/archivo | 5.1.0 | OFL-1.1 |
| IBM Plex Sans | @fontsource/ibm-plex-sans | 5.1.1 | OFL-1.1 |
| IBM Plex Mono | @fontsource/ibm-plex-mono | 5.1.1 | OFL-1.1 |

The fonts are distributed under the SIL Open Font License 1.1
(<https://openfontlicense.org>). Their font files are served by the app itself; no page
loads anything from a third-party origin at runtime.
