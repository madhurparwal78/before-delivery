# Third party notices

Kipwell Stays ships the packages below (the production dependency tree of
`npm ls --omit=dev --all`) and the two bundled font families.

## Shipped packages

| Package | Version | Licence |
|---|---|---|
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

`pg-native` and `fsevents` are optional dependencies of `pg` and `split2`
respectively; neither is installed or shipped.

## Bundled fonts

| Font family | Source | Licence |
|---|---|---|
| Chivo | Omnibus-Type Chivo Project Authors, packaged as `@fontsource/chivo` | OFL-1.1 |
| IBM Plex Sans Arabic | IBM Corp., packaged as `@fontsource/ibm-plex-sans-arabic` | OFL-1.1 |

The font files served from `/fonts` are copied from those packages at build
time: `chivo-400.woff2`, `chivo-700.woff2`, `chivo-900.woff2`,
`plex-arabic-400.woff2` and `plex-arabic-700.woff2`.

## Build-only tools

These are development dependencies and are not shipped with the app:
`typescript` (Apache-2.0), `esbuild` (MIT), `@types/node` (MIT),
`@types/pg` (MIT), `@fontsource/chivo` (OFL-1.1) and
`@fontsource/ibm-plex-sans-arabic` (OFL-1.1).
