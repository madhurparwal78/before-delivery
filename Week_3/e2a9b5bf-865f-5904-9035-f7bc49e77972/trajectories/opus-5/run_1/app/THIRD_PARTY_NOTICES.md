# Third party notices

Lowlamp Field Log ships the packages below and the Sora font. "Shipped packages"
is the production dependency tree reported by `npm ls --omit=dev --all --json`.

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

## Bundled font

| Font | Version | Licence |
| --- | --- | --- |
| Sora (served from `/fonts/sora-400.woff2` and `/fonts/sora-600.woff2`, taken from `@fontsource/sora`) | 5.1.0 | OFL-1.1 |

Sora is © 2020 The Sora Project Authors, licensed under the SIL Open Font
License, Version 1.1.

## Build-time only

These are development dependencies. They are not shipped and not served:
`@fontsource/sora` (the source of the two woff2 files above), `@types/node`,
`@types/pg`, `esbuild`, `typescript`.
