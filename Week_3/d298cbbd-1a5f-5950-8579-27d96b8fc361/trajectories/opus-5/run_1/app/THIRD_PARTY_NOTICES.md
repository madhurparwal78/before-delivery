# Third party notices

Holloway Carriage Co. Strikeproof ships the packages and fonts below. "Shipped packages" is the
production dependency tree as `npm ls --omit=dev --all --json` reports it. Every licence is one of
MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1.

## Shipped packages

| Package | Version | Licence | Home |
|---|---|---|---|
| `@fontsource/bodoni-moda` | 5.3.0 | OFL-1.1 | https://fontsource.org/fonts/bodoni-moda |
| `@fontsource/jost` | 5.3.0 | OFL-1.1 | https://fontsource.org/fonts/jost |
| `pg` | 8.23.1 | MIT | https://github.com/brianc/node-postgres |
| `pg-cloudflare` | 1.4.1 | MIT | https://github.com/brianc/node-postgres |
| `pg-connection-string` | 2.14.1 | MIT | https://github.com/brianc/node-postgres/tree/master/packages/pg-connection-string |
| `pg-int8` | 1.0.1 | ISC | https://github.com/charmander/pg-int8 |
| `pg-pool` | 3.14.0 | MIT | https://github.com/brianc/node-postgres/tree/master/packages/pg-pool |
| `pg-protocol` | 1.16.1 | MIT | https://github.com/brianc/node-postgres |
| `pg-types` | 2.2.0 | MIT | https://github.com/brianc/node-pg-types |
| `pgpass` | 1.0.5 | MIT | https://github.com/hoegaarden/pgpass |
| `postgres-array` | 2.0.0 | MIT | https://github.com/bendrucker/postgres-array |
| `postgres-bytea` | 1.0.1 | MIT | https://github.com/bendrucker/postgres-bytea |
| `postgres-date` | 1.0.7 | MIT | https://github.com/bendrucker/postgres-date |
| `postgres-interval` | 1.2.0 | MIT | https://github.com/bendrucker/postgres-interval |
| `split2` | 4.2.0 | ISC | https://github.com/mcollina/split2 |
| `xtend` | 4.0.2 | MIT | https://github.com/Raynos/xtend |

## Fonts

Both font families are served by the app itself, from the two `@fontsource` packages above. The
browser loads nothing from another origin.

| Font family | Licence | Copyright |
|---|---|---|
| Bodoni Moda | SIL Open Font License 1.1 (OFL-1.1) | Copyright 2019 The Bodoni Moda Project Authors (https://github.com/indestructible-type/Bodoni) |
| Jost | SIL Open Font License 1.1 (OFL-1.1) | Copyright 2020 The Jost Project Authors (https://github.com/indestructible-type/Jost) |

## Build-time only

These are development dependencies. They are not shipped and not served to the browser:
`typescript` (Apache-2.0), `esbuild` (MIT), `@types/node` (MIT), `@types/pg` (MIT).

## Everything else

The typing engine, the generator, the SMTP client, the live channel, the chart drawing and the
stationery stylesheet are part of this repository. The `holloway-120` word list and the six
public-domain quotes ship as published in the brief.
