# Third-party notices

Kerfwell Rack ships the packages and fonts listed below. Every entry is covered by one of
MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0 or OFL-1.1.

## npm packages

The production dependency tree from `npm ls --omit=dev --all --json`.

| Package | Version | Licence |
| --- | --- | --- |
| jpeg-js | 0.4.4 | BSD-3-Clause |
| pg | 8.23.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-int8 | 1.0.1 | ISC |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pgpass | 1.0.5 | MIT |
| pngjs | 7.0.0 | MIT |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| split2 | 4.2.0 | ISC |
| xtend | 4.0.2 | MIT |

## Fonts

Served from the application’s own origin under `public/fonts`.

| Font | Version | Licence |
| --- | --- | --- |
| Barlow Condensed | v13 (latin subset) | OFL-1.1 |
| IBM Plex Sans | v23 (latin subset) | OFL-1.1 |
| IBM Plex Mono | v20 (latin subset) | OFL-1.1 |

## Native libraries

No shipped package bundles a native library: `jpeg-js` and `pngjs` decode and encode images
in pure JavaScript, and `pg` speaks the PostgreSQL wire protocol directly.
