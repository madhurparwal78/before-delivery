# Third party notices

Roundkeeper ships the packages and typefaces below. Shipped packages are the production
dependency tree reported by `npm ls --omit=dev --all --json`.

## Shipped packages

| Package | Version | Licence |
|---|---|---|
| pg | 8.16.3 | MIT |
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
| xtend | 4.0.2 | MIT |

`pg` also names `pg-native` as an optional peer dependency. It is not installed and not
shipped, so no native PostgreSQL library is included.

## Typefaces

Both typefaces are served by the app itself from `/assets/fonts`.

| Typeface | Files | Licence |
|---|---|---|
| Fraunces (variable weight), by Undercase Type | `fraunces-wght.woff2` | SIL Open Font License 1.1 |
| Atkinson Hyperlegible, by the Braille Institute of America | `atkinson-400.woff2`, `atkinson-700.woff2` | SIL Open Font License 1.1 |

The font files come from the `@fontsource-variable/fraunces` and
`@fontsource/atkinson-hyperlegible` packages, which are build-time only and are not part of
the shipped dependency tree.
