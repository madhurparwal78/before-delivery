# Third party notices

Switchyard ships the packages below. The list is the production dependency tree
(`npm ls --omit=dev --all`) plus the two fonts that ship with the app and load
from its own origin. Nothing else is fetched at runtime, and no asset is loaded
from any other origin.

## Shipped packages

| Package | Licence |
|---|---|
| `pg@8.13.1` | MIT |
| `pg-cloudflare@1.4.1` | MIT |
| `pg-connection-string@2.14.1` | MIT |
| `pg-int8@1.0.1` | ISC |
| `pg-pool@3.14.0` | MIT |
| `pg-protocol@1.16.1` | MIT |
| `pg-types@2.2.0` | MIT |
| `pgpass@1.0.6` | MIT |
| `postgres-array@2.0.0` | MIT |
| `postgres-bytea@1.0.1` | MIT |
| `postgres-date@1.0.7` | MIT |
| `postgres-interval@1.2.0` | MIT |
| `xtend@4.0.2` | MIT |
| `ws@8.22.1` | MIT |

`pg-native`, `bufferutil` and `utf-8-validate` are optional peer dependencies of
`pg` and `ws`. They are not installed and not shipped.

## Shipped fonts

| Font | Licence | Source |
|---|---|---|
| Unbounded | OFL-1.1 | `@fontsource/unbounded` (build-time only; the `.woff2` files are copied into the app's own `/fonts` path) |
| Onest | OFL-1.1 | `@fontsource/onest` (build-time only; the `.woff2` files are copied into the app's own `/fonts` path) |

The full font licences are served beside the fonts, at
`/fonts/Unbounded-OFL.txt` and `/fonts/Onest-OFL.txt`.

## Build-time only

These are development dependencies. They are not shipped and are not present at
runtime: `typescript` (Apache-2.0), `esbuild` (MIT), `@types/node` (MIT),
`@types/pg` (MIT), `@types/ws` (MIT), `@fontsource/unbounded` (OFL-1.1) and
`@fontsource/onest` (OFL-1.1).

Every shipped package and asset is under MIT, ISC, BSD-2-Clause, BSD-3-Clause,
Apache-2.0, 0BSD or, for the fonts, OFL-1.1.
