# Third-party notices

Seatweaver ships the runtime dependencies and fonts listed here. Every one is covered by
MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD or OFL-1.1.

## Runtime dependencies (server)

| Package | Licence |
|---|---|
| `@aws-sdk/client-s3` (and the `@aws-sdk/*`, `@smithy/*` packages it depends on) | Apache-2.0 |
| `busboy` (with `streamsearch`) | MIT |
| `express` (with `accepts`, `body-parser`, `content-disposition`, `cookie`, `debug`, `encodeurl`, `etag`, `finalhandler`, `fresh`, `mime-types`, `on-finished`, `parseurl`, `path-to-regexp`, `proxy-addr`, `router`, `send`, `serve-static`, `statuses`, `type-is`, `vary` and their own dependencies) | MIT |
| `qs` (dependency of `express`) | BSD-3-Clause |
| `tslib` (dependency of the AWS SDK) | 0BSD |
| `inherits`, `once`, `setprototypeof`, `wrappy`, `split2`, `pg-int8` (dependencies of `express` and `pg`) | ISC |
| `pg` (with `pg-connection-string`, `pg-pool`, `pg-protocol`, `pg-types`, `pgpass`, `postgres-array`, `postgres-bytea`, `postgres-date`, `postgres-interval`) | MIT |

## Runtime dependencies (client bundle)

| Package | Licence |
|---|---|
| `react` | MIT |
| `react-dom` (with `scheduler`) | MIT |

## Bundled fonts

| Font | Source package | Licence |
|---|---|---|
| Instrument Serif | `@fontsource/instrument-serif` | OFL-1.1 |
| IBM Plex Sans | `@fontsource/ibm-plex-sans` | OFL-1.1 |
| IBM Plex Mono | `@fontsource/ibm-plex-mono` | OFL-1.1 |

## Build-time only

`typescript`, `vite`, `@vitejs/plugin-react` and the `@types/*` packages are MIT or
Apache-2.0 and are not shipped at runtime, except for the font files above, which the
client bundle self-hosts.
