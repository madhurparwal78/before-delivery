# Third-party notices

Undersign ships the packages below: the production dependency tree reported by
`npm ls --omit=dev --all --json`.

| Package | Version | Licence |
|---|---|---|
| `@fontsource/fraunces` | 5.3.0 | OFL-1.1 |
| `@fontsource/ibm-plex-mono` | 5.3.0 | OFL-1.1 |
| `@fontsource/public-sans` | 5.3.0 | OFL-1.1 |
| `@napi-rs/canvas` | 0.1.100 | MIT |
| `@napi-rs/canvas-android-arm64` | 0.1.100 | MIT |
| `@napi-rs/canvas-darwin-arm64` | 0.1.100 | MIT |
| `@napi-rs/canvas-darwin-x64` | 0.1.100 | MIT |
| `@napi-rs/canvas-linux-arm-gnueabihf` | 0.1.100 | MIT |
| `@napi-rs/canvas-linux-arm64-gnu` | 0.1.100 | MIT |
| `@napi-rs/canvas-linux-arm64-musl` | 0.1.100 | MIT |
| `@napi-rs/canvas-linux-riscv64-gnu` | 0.1.100 | MIT |
| `@napi-rs/canvas-linux-x64-gnu` | 0.1.100 | MIT |
| `@napi-rs/canvas-linux-x64-musl` | 0.1.100 | MIT |
| `@napi-rs/canvas-win32-arm64-msvc` | 0.1.100 | MIT |
| `@napi-rs/canvas-win32-x64-msvc` | 0.1.100 | MIT |
| `busboy` | 1.6.0 | MIT |
| `pdfjs-dist` | 4.10.38 | Apache-2.0 |
| `pg` | 8.23.1 | MIT |
| `pg-cloudflare` | 1.4.1 | MIT |
| `pg-connection-string` | 2.14.1 | MIT |
| `pg-int8` | 1.0.1 | ISC |
| `pg-pool` | 3.14.0 | MIT |
| `pg-protocol` | 1.16.1 | MIT |
| `pg-types` | 2.2.0 | MIT |
| `pgpass` | 1.0.5 | MIT |
| `postgres-array` | 2.0.0 | MIT |
| `postgres-bytea` | 1.0.1 | MIT |
| `postgres-date` | 1.0.7 | MIT |
| `postgres-interval` | 1.2.0 | MIT |
| `split2` | 4.2.0 | ISC |
| `streamsearch` | 1.1.0 | MIT |
| `xtend` | 4.0.2 | MIT |

The three font packages are redistributed under the SIL Open Font License 1.1:
Fraunces, Public Sans and IBM Plex Mono. The PDF page renderer, `pdfjs-dist`, is
redistributed under the Apache License 2.0. Every other package is redistributed
under the MIT or ISC licence named in its row.

The platform binaries of `@napi-rs/canvas` are optional dependencies of
`pdfjs-dist`; only the one matching the host is installed. `pg-native` is an
optional peer dependency of `pg` that Undersign never installs, so no copy of it
ships.
