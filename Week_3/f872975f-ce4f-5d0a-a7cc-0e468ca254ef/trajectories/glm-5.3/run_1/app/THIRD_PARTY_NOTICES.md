# Third-party notices

Kerfwell Rack ships the following packages and fonts. Each entry lists the name,
version and licence as reported by its package metadata.

## Production dependency tree

| Package | Version | Licence |
|---|---|---|
| jpeg-js | 0.4.4 | BSD-3-Clause |
| pg | 8.23.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pg-int8 | 1.0.1 | ISC |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| xtend | 4.0.2 | MIT |
| pgpass | 1.0.5 | MIT |
| split2 | 4.2.0 | ISC |
| pngjs | 7.0.0 | MIT |

No native library is bundled beyond these packages: `pg` uses its pure
JavaScript driver (the optional `pg-native` binding is not installed), and
`jpeg-js` and `pngjs` are pure JavaScript codecs.

## Self-hosted fonts

The app serves its fonts from its own origin. Each font is licensed under the
SIL Open Font License 1.1.

| Font | Family | Weights | Licence |
|---|---|---|---|
| Barlow Condensed | Barlow Condensed | 400, 500, 600 | OFL-1.1 |
| IBM Plex Sans | IBM Plex Sans | 400, 600 | OFL-1.1 |
| IBM Plex Mono | IBM Plex Mono | 400, 500 | OFL-1.1 |
