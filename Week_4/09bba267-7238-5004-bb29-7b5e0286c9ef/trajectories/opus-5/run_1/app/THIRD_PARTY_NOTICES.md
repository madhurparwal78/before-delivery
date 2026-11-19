# Third party notices

Halyard Seatwise ships the packages and fonts below. The list is the production dependency tree
reported by `npm ls --omit=dev --all --json`, plus every bundled font file.

## Packages

| Package | Version | Licence |
| --- | --- | --- |
| `@fontsource/fraunces` | 5.3.0 | OFL-1.1 |
| `@fontsource/public-sans` | 5.3.0 | OFL-1.1 |
| `pg` | 8.23.1 | MIT |
| `pg-cloudflare` | 1.4.1 | MIT |
| `pg-connection-string` | 2.14.1 | MIT |
| `pg-int8` | 1.0.1 | ISC |
| `pg-pool` | 3.14.0 | MIT |
| `pg-protocol` | 1.16.1 | MIT |
| `pg-types` | 2.2.0 | MIT |
| `pgpass` | 1.0.5 | MIT |
| `postgres-array` | 2.0.0 | MIT |
| `postgres-bytea` | 1.0.1 | MIT |
| `postgres-date` | 1.0.7 | MIT |
| `postgres-interval` | 1.2.0 | MIT |
| `react` | 19.3.1 | MIT |
| `react-dom` | 19.3.1 | MIT |
| `scheduler` | 0.28.0 | MIT |
| `split2` | 4.2.0 | ISC |
| `xtend` | 4.0.2 | MIT |

## Fonts

Both font families are served by the app itself from the packages above; no page asks another
origin for a font.

| Font | Version | Licence |
| --- | --- | --- |
| Fraunces (latin 400 and 700, woff2 and woff) | 5.3.0 (`@fontsource/fraunces`) | OFL-1.1 |
| Public Sans (latin 400 and 600, woff2 and woff) | 5.3.0 (`@fontsource/public-sans`) | OFL-1.1 |

Copyright and licence texts travel with each package in `node_modules/<package>/LICENSE`.
