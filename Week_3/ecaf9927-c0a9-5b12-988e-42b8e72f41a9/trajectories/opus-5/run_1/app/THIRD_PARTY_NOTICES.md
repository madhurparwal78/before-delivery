# Third party notices

Kerfline Bench ships the packages and fonts listed below.

## Shipped packages

The production dependency tree, as reported by `npm ls --omit=dev --all --json`.

| Package | Version | Licence |
| --- | --- | --- |
| @jscad/modeling | 2.13.0 | MIT |
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

The woff2 files in `static/fonts` are served from the app's own origin. They were taken
from the `@fontsource` distributions of the upstream open-source families, at the
versions noted.

| Font | Version | Licence |
| --- | --- | --- |
| Space Grotesk (latin, weights 500 and 600) | 5.3.0 | OFL-1.1 |
| IBM Plex Sans (latin, weights 400, 500 and 600) | 5.3.0 | OFL-1.1 |
| IBM Plex Mono (latin, weights 400 and 500) | 5.3.0 | OFL-1.1 |
