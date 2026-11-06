# Third-party notices

Fluxseal ships the production dependency tree below, as reported by
`npm ls --omit=dev --all --json`, together with the bundled fonts and icon set. Every entry is
licensed under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1.

## Shipped packages

| Package | Version | Licence |
| --- | --- | --- |
| `@fontsource/ibm-plex-mono` | 5.3.0 | OFL-1.1 |
| `@fontsource/instrument-sans` | 5.3.0 | OFL-1.1 |
| `@fontsource/instrument-serif` | 5.3.0 | OFL-1.1 |
| `lucide-react` | 0.544.0 | ISC |
| `pg` | 8.16.3 | MIT |
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
| `react` | 19.1.1 | MIT |
| `react-dom` | 19.1.1 | MIT |
| `scheduler` | 0.26.0 | MIT |
| `split2` | 4.2.0 | ISC |
| `xtend` | 4.0.2 | MIT |

`pg-native` is an unmet optional dependency of `pg`: it is not installed and nothing of it ships.

## Bundled fonts

| Asset | Source package | Licence |
| --- | --- | --- |
| Instrument Serif (latin, 400) | `@fontsource/instrument-serif` 5.3.0 | OFL-1.1 |
| Instrument Sans (latin, 400/500/600) | `@fontsource/instrument-sans` 5.3.0 | OFL-1.1 |
| IBM Plex Mono (latin, 400/500) | `@fontsource/ibm-plex-mono` 5.3.0 | OFL-1.1 |

The woff and woff2 files are served from the app's own origin out of `dist/web/assets`.

## Bundled icon set

| Asset | Source package | Licence |
| --- | --- | --- |
| Lucide icons (tree-shaken React components) | `lucide-react` 0.544.0 | ISC |

## Licence texts

- MIT: https://opensource.org/license/mit
- ISC: https://opensource.org/license/isc-license-txt
- SIL Open Font License 1.1 (OFL-1.1): https://openfontlicense.org

Each package keeps its own licence text in its directory under `node_modules`.
