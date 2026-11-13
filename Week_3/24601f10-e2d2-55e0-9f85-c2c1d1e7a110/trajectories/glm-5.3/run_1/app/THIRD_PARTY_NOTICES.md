# Third-party notices

Cupfold ships the following software:

## Bundled Geist font

- **Geist** (variable weight, latin subset), files `Geist-Variable.woff2` served from
  `/assets/fonts/`.
  - Source: the Vercel Geist typeface family
  - Licence: SIL Open Font License 1.1 (OFL-1.1)
  - Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font)

## npm production dependencies

The complete production dependency tree (`npm ls --omit=dev --all`) of this app:

| Package | Version | Licence |
|---|---|---|
| busboy | 1.6.0 | MIT |
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
| streamsearch | 1.1.0 | MIT |
| ws | 8.22.1 | MIT |
| xtend | 4.0.2 | MIT |

`pg-native`, `bufferutil` and `utf-8-validate` appear as optional (uninstalled)
peer dependencies of `pg` and `ws` and are not shipped.

All licences above are among MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0,
0BSD and OFL-1.1.

## Development-only dependencies (not shipped to browsers)

`typescript`, `esbuild`, `@types/node`, `@types/pg`, `@types/ws` and
`@types/busboy` are build-time tools used to compile and bundle the app and are
not part of the served output.
