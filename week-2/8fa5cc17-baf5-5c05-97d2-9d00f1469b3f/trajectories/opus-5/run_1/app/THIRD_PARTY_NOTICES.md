# Third party notices

Quire ships the packages below (the production dependency tree reported by
`npm ls --omit=dev --all --json`) and the fonts below (bundled into
`dist/public/fonts` at build time and served by the app itself).

## Shipped packages

| Package | Version | Licence |
|---|---|---|
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

| Font | Source package | Version | Licence |
|---|---|---|---|
| Fraunces | @fontsource/fraunces | 5.1.0 | OFL-1.1 |
| Source Serif 4 | @fontsource/source-serif-4 | 5.1.0 | OFL-1.1 |
| IBM Plex Mono | @fontsource/ibm-plex-mono | 5.1.0 | OFL-1.1 |

## Build-time only

These are development dependencies: they are not shipped in the running app,
apart from the font files listed above.

| Package | Version | Licence |
|---|---|---|
| typescript | 5.7.2 | Apache-2.0 |
| esbuild | 0.24.2 | MIT |
| @types/node | 22.10.2 | MIT |
| @types/pg | 8.11.10 | MIT |
