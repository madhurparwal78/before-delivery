# Third party notices

Ridgestack ships a Node 22 server and a browser bundle. The lists below cover every package in the
production dependency tree (`npm ls --omit=dev --all`) and every font file bundled with the app.

## Shipped packages

| Package | Version | Licence |
| --- | --- | --- |
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
| xtend | 4.0.2 | MIT |

`pg-native` is an optional peer of `pg` and is not installed or shipped.

## Bundled fonts

All three font families are served from `public/fonts` as `woff2` files and are licensed under the
SIL Open Font License 1.1 (OFL-1.1).

| Font file | Family | Licence |
| --- | --- | --- |
| `inter-latin-400-normal.woff2` | Inter (Rasmus Andersson) | OFL-1.1 |
| `inter-latin-500-normal.woff2` | Inter (Rasmus Andersson) | OFL-1.1 |
| `inter-tight-latin-500-normal.woff2` | Inter Tight (Rasmus Andersson) | OFL-1.1 |
| `martian-mono-latin-400-normal.woff2` | Martian Mono (Evil Martians) | OFL-1.1 |

The font files were taken from the `@fontsource/inter`, `@fontsource/inter-tight` and
`@fontsource/martian-mono` packages, which are development dependencies only.

## Build-time only

These are development dependencies; they are not shipped with the running app: `typescript` (Apache-2.0),
`esbuild` (MIT), `@types/node` (MIT), `@types/pg` (MIT), `@fontsource/inter` (OFL-1.1),
`@fontsource/inter-tight` (OFL-1.1), `@fontsource/martian-mono` (OFL-1.1).
