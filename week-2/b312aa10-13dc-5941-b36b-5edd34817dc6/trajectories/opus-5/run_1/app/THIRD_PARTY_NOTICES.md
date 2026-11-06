# Third-party notices

Lineboard ships the production dependency tree below, as reported by
`npm ls --omit=dev --all --json`, together with the bundled fonts it serves from
its own origin. Every entry is covered by one of MIT, ISC, BSD-2-Clause,
BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0 or OFL-1.1.

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

`pg-native` is an optional peer of `pg` and is not installed or shipped.

## Bundled fonts

| Font | Version | Licence |
|---|---|---|
| Archivo Black (latin subset, `archivo-black-latin.woff2`) | v23 | OFL-1.1 |
| IBM Plex Sans (latin subset, variable 400–600, `ibm-plex-sans-latin.woff2`) | v23 | OFL-1.1 |

Both fonts are served by Lineboard itself from `/fonts/`; the browser loads no
third-party host.

## Build-only tools

These are development dependencies. They are not shipped in the production
dependency tree and no part of them is served to the browser.

| Package | Version | Licence |
|---|---|---|
| typescript | 5.7.2 | Apache-2.0 |
| esbuild | 0.24.2 | MIT |
| @types/node | 22.10.2 | MIT |
| @types/pg | 8.11.10 | MIT |
