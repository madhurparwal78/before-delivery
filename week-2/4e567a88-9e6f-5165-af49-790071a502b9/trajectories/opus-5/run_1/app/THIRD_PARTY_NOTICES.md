# Third party notices

Lumenfold Dispatch ships the packages and fonts below. Everything else in the running product is
first-party code or part of the Node.js runtime.

## Shipped packages

These are the production dependencies reported by `npm ls --omit=dev --all --json`.

| Package | Version | Licence |
| --- | --- | --- |
| `pg` | 8.13.1 | MIT |
| `pg-cloudflare` | 1.4.1 | MIT |
| `pg-connection-string` | 2.14.1 | MIT |
| `pg-int8` | 1.0.1 | ISC |
| `pg-pool` | 3.14.0 | MIT |
| `pg-protocol` | 1.16.1 | MIT |
| `pg-types` | 2.2.0 | MIT |
| `pgpass` | 1.0.6 | MIT |
| `postgres-array` | 2.0.0 | MIT |
| `postgres-bytea` | 1.0.1 | MIT |
| `postgres-date` | 1.0.7 | MIT |
| `postgres-interval` | 1.2.0 | MIT |
| `xtend` | 4.0.2 | MIT |

`pg` declares `pg-native` as an optional dependency. It is not installed and not shipped.

## Bundled fonts

The browser build serves these font files from the app's own origin. Each is packaged by
[Fontsource](https://fontsource.org) and used under the SIL Open Font License 1.1.

| Font | Files | Licence |
| --- | --- | --- |
| Bricolage Grotesque | `bricolage-grotesque-500.woff2`, `bricolage-grotesque-700.woff2` | OFL-1.1 |
| IBM Plex Sans | `ibm-plex-sans-400.woff2`, `ibm-plex-sans-600.woff2` | OFL-1.1 |
| IBM Plex Mono | `ibm-plex-mono-400.woff2`, `ibm-plex-mono-500.woff2` | OFL-1.1 |

Copyright 2022 The Bricolage Grotesque Project Authors.
Copyright 2017 IBM Corp., for IBM Plex Sans and IBM Plex Mono.

## Build-time only

TypeScript, esbuild, `@types/*` and the `@fontsource/*` packages are development dependencies. Only
the font files listed above are copied into the shipped browser assets; no development package is
served to a browser or loaded at run time.
