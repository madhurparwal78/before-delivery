# Third party notices

Elevens ships the production dependency tree below, as reported by
`npm ls --omit=dev --all --json`, together with the bundled font files in
`src/client/fonts`. Every licence is one of MIT, ISC, BSD-2-Clause, BSD-3-Clause,
Apache-2.0, 0BSD or SIL OFL 1.1.

## Shipped packages

| Package | Version | Licence |
|---|---|---|
| js-tokens | 4.0.0 | MIT |
| loose-envify | 1.4.0 | MIT |
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
| react | 18.3.1 | MIT |
| react-dom | 18.3.1 | MIT |
| scheduler | 0.23.2 | MIT |
| split2 | 4.2.0 | ISC |
| ws | 8.22.1 | MIT |
| xtend | 4.0.2 | MIT |

### Optional peer dependencies

`pg` names `pg-native` and `ws` names `bufferutil` and `utf-8-validate` as
optional peer dependencies. None of them is installed, so none is shipped. Their
licences are MIT, should an installation add them.

| Package | Licence |
|---|---|
| pg-native | MIT |
| bufferutil | MIT |
| utf-8-validate | MIT |

## Bundled fonts

| Font | File | Licence |
|---|---|---|
| Big Shoulders Display | `src/client/fonts/big-shoulders-display.woff2` | SIL Open Font License 1.1 |
| IBM Plex Sans | `src/client/fonts/ibm-plex-sans.woff2` | SIL Open Font License 1.1 |
| IBM Plex Mono | `src/client/fonts/ibm-plex-mono-400.woff2` | SIL Open Font License 1.1 |
| IBM Plex Mono | `src/client/fonts/ibm-plex-mono-600.woff2` | SIL Open Font License 1.1 |

Icons and club badges are drawn by the app from text and simple shapes, so no
icon package is shipped.
