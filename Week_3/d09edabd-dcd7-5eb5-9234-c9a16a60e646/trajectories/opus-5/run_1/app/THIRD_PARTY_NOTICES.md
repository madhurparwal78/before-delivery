# Third-party notices

Keyway Bench ships the packages, fonts and icon set listed here. Every licence is
MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, CC0-1.0 or
OFL-1.1.

## Shipped packages

The production dependency tree (`npm ls --omit=dev --all --json`).

| Package | Version | Licence |
|---|---|---|
| `@ioredis/commands` | 1.10.0 | MIT |
| `cluster-key-slot` | 1.1.1 | Apache-2.0 |
| `debug` | 4.4.3 | MIT |
| `denque` | 2.1.0 | Apache-2.0 |
| `ioredis` | 5.11.1 | MIT |
| `ms` | 2.1.3 | MIT |
| `pg` | 8.23.1 | MIT |
| `pg-cloudflare` | 1.4.1 | MIT |
| `pg-connection-string` | 2.14.1 | MIT |
| `pg-int8` | 1.0.1 | ISC |
| `pg-native` | — | BSD-3-Clause (optional, not installed) |
| `pg-pool` | 3.14.0 | MIT |
| `pg-protocol` | 1.16.1 | MIT |
| `pg-types` | 2.2.0 | MIT |
| `pgpass` | 1.0.5 | MIT |
| `postgres-array` | 2.0.0 | MIT |
| `postgres-bytea` | 1.0.1 | MIT |
| `postgres-date` | 1.0.7 | MIT |
| `postgres-interval` | 1.2.0 | MIT |
| `redis-errors` | 1.2.0 | MIT |
| `redis-parser` | 3.0.0 | MIT |
| `split2` | 4.2.0 | ISC |
| `standard-as-callback` | 2.1.0 | MIT |
| `xtend` | 4.0.2 | MIT |

## Bundled fonts and icons

These are built into the served frontend assets.

| Package | Version | Licence | What is shipped |
|---|---|---|---|
| `three` | 0.171.0 | MIT | the 3D renderer bundled into the browser build |
| `@fontsource/inter` | 5.3.0 | OFL-1.1 | the Inter font files served from /fonts |
| `@fontsource/jetbrains-mono` | 5.3.0 | OFL-1.1 | the JetBrains Mono font files served from /fonts |
| `lucide-static` | 0.468.0 | ISC | the Lucide stroke icons inlined into the browser build |

## Build-time only

TypeScript (Apache-2.0) and esbuild (MIT) compile and bundle the app. They are not
shipped at runtime.
