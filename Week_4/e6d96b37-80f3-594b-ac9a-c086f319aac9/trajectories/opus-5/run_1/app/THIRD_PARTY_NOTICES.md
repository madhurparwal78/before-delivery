# Third-party notices

Flan ships the packages, fonts and icons below. Every one is used under a
permissive licence: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or
the SIL Open Font License 1.1.

## Shipped packages

The complete production dependency tree, as reported by
`npm ls --omit=dev --all --json`.

| Package | Version | Licence |
|---|---|---|
| `@fontsource/archivo` | 5.3.0 | OFL-1.1 |
| `@fontsource/saira` | 5.3.0 | OFL-1.1 |
| `busboy` | 1.6.0 | MIT |
| `js-tokens` | 4.0.0 | MIT |
| `loose-envify` | 1.4.0 | MIT |
| `lucide-static` | 1.70.0 | ISC |
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
| `react` | 18.3.1 | MIT |
| `react-dom` | 18.3.1 | MIT |
| `scheduler` | 0.23.2 | MIT |
| `split2` | 4.2.0 | ISC |
| `streamsearch` | 1.1.0 | MIT |
| `xtend` | 4.0.2 | MIT |

## Bundled fonts

| Font | Source package | Licence |
|---|---|---|
| Saira, weights 500 and 600, latin | `@fontsource/saira` | SIL OFL 1.1 |
| Archivo, weights 400 and 700, latin | `@fontsource/archivo` | SIL OFL 1.1 |

The font files are copied into the build at `/static/fonts/` and served by the
app itself, so the browser loads no font from a third-party origin.

## Bundled icons

| Icon set | Source package | Licence |
|---|---|---|
| Lucide | `lucide-static` | ISC |

The icons used are inlined into the client bundle at build time from the
installed `lucide-static` package.

## Notes

- `pg-native` is an optional peer of `pg`. It is neither installed nor shipped.
- Amazon S3 request signing and the OpenID Connect flow are implemented in this
  repository rather than taken from a library, so no package is shipped for
  either.
