# Third party notices

Furrowbook ships the packages and fonts listed below. Everything else in `package.json` is a
build-time dependency and is not part of the served application.

## Shipped packages

The production dependency tree, as reported by `npm ls --omit=dev --all --json`.

| Package | Version | Licence |
| --- | --- | --- |
| `js-tokens` | 4.0.0 | MIT |
| `loose-envify` | 1.4.0 | MIT |
| `pg` | 8.13.1 | MIT |
| `pg-cloudflare` | 1.4.1 | MIT |
| `pg-connection-string` | 2.14.1 | MIT |
| `pg-int8` | 1.0.1 | ISC |
| `pg-pool` | 3.14.0 | MIT |
| `pg-protocol` | 1.16.1 | MIT |
| `pg-types` | 2.2.0 | MIT |
| `pgpass` | 1.0.6 | MIT |
| `postgres-array` | 2.0.0 | MIT |
| `postgres-bytea` | 1.0.1 | MIT |
| `postgres-date` | 1.0.7 | MIT |
| `postgres-interval` | 1.2.0 | MIT |
| `react` | 18.3.1 | MIT |
| `react-dom` | 18.3.1 | MIT |
| `scheduler` | 0.23.2 | MIT |
| `xtend` | 4.0.2 | MIT |

## Bundled fonts

Font files are copied into `dist/public/assets/fonts` at build time and served from the app's own
origin. They come from the Fontsource packages below, which are build-time dependencies.

| Font | Source package | Version | Licence |
| --- | --- | --- | --- |
| Space Grotesk (400, 600, 700) | `@fontsource/space-grotesk` | 5.1.1 | OFL-1.1 |
| IBM Plex Sans (400, 600) | `@fontsource/ibm-plex-sans` | 5.1.1 | OFL-1.1 |
| IBM Plex Mono (400, 600) | `@fontsource/ibm-plex-mono` | 5.1.1 | OFL-1.1 |

## Build-time only

`typescript`, `esbuild`, `@types/node`, `@types/pg`, `@types/react`, `@types/react-dom` and the
Fontsource packages above are used to compile and bundle the app. Their code is not shipped; only
the compiled output and the font files above are served.
