# Third party notices

Twohouse ships the packages below, as reported by `npm ls --omit=dev --all --json`, and the two
typefaces it serves from `/assets/fonts`. Everything else in the running app is first-party code.

## Shipped packages

| Package | Version | Licence |
| --- | --- | --- |
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

`pg-native` is an unmet optional dependency of `pg`: it is never installed and never shipped.

## Typefaces

| Typeface | Files | Licence |
| --- | --- | --- |
| Dela Gothic One | `dela-gothic-one-latin-400-normal.woff2` | SIL Open Font License 1.1 |
| DM Sans | `dm-sans-latin-400-normal.woff2`, `dm-sans-latin-500-normal.woff2`, `dm-sans-latin-700-normal.woff2` | SIL Open Font License 1.1 |

## Build-only tools

These are development dependencies and are not part of the shipped tree: `typescript` (Apache-2.0),
`esbuild` (MIT), `@types/node` (MIT), `@types/pg` (MIT).
