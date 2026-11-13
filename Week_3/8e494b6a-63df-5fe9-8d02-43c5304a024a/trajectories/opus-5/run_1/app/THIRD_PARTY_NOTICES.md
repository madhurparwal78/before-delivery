# Third party notices

Spoorline ships the packages and fonts below. Everything else in this repository is the
product's own source.

## Shipped packages

The production dependency tree, as `npm ls --omit=dev --all --json` reports it.

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

`pg-native` is an optional peer of `pg` and is not installed or shipped.

## Bundled fonts

Both font families are served from this app's own origin out of `assets/fonts`.

| Font family | Files | Licence |
|---|---|---|
| Inter | `inter-latin-400-normal.woff2`, `inter-latin-500-normal.woff2`, `inter-latin-600-normal.woff2` | SIL Open Font License 1.1 (OFL-1.1), Copyright 2016 The Inter Project Authors |
| JetBrains Mono | `jetbrains-mono-latin-400-normal.woff2`, `jetbrains-mono-latin-600-normal.woff2` | SIL Open Font License 1.1 (OFL-1.1), Copyright 2020 The JetBrains Mono Project Authors |

## Build-time only

These are development dependencies. They are not shipped with the running app.

| Package | Version | Licence |
|---|---|---|
| typescript | 5.7.2 | Apache-2.0 |
| esbuild | 0.24.2 | MIT |
| @types/node | 22.10.2 | MIT |
| @types/pg | 8.11.10 | MIT |
