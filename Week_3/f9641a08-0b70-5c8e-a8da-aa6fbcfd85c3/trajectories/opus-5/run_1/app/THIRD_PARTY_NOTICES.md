# Third party notices

Roam House Atelier ships the packages and font files listed below. "Shipped packages" is the
production dependency tree reported by `npm ls --omit=dev --all --json`.

## Shipped packages

| Package | Version | Licence |
|---|---|---|
| @fontsource/schibsted-grotesk | 5.1.0 | OFL-1.1 |
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

`pg-native` appears in `pg`'s optional dependencies. It is not installed and not shipped.

## Bundled fonts

| Font | Files | Licence |
|---|---|---|
| Schibsted Grotesk (weights 400, 500, 700, 900) | `public/fonts/schibsted-grotesk-latin-*.woff2` | OFL-1.1 |

The font files are copied from the `@fontsource/schibsted-grotesk` package during `npm run build`
and are served by the app itself from `/assets/fonts/`.

## Build-time only

These are development dependencies. They are not shipped with the running app.

| Package | Version | Licence |
|---|---|---|
| typescript | 5.7.2 | Apache-2.0 |
| @types/node | 22.10.2 | MIT |
| @types/pg | 8.11.10 | MIT |
