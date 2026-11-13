# Third party notices

Twinrow ships the packages, fonts and icons listed here. Every one carries an open licence
(MIT, BSD, ISC, Apache-2.0 or SIL OFL). Nothing is fetched from another origin at runtime:
the fonts and icons below are served by the app itself.

## Shipped packages

The production dependency tree (`npm ls --omit=dev --all`).

| Package | Version | Licence |
| --- | --- | --- |
| @fontsource/manrope | 5.3.0 | SIL OFL 1.1 |
| @fontsource/open-sans | 5.3.0 | SIL OFL 1.1 |
| @ioredis/commands | 1.10.0 | MIT |
| cluster-key-slot | 1.1.1 | Apache-2.0 |
| debug | 4.4.3 | MIT |
| denque | 2.1.0 | Apache-2.0 |
| ioredis | 5.11.1 | MIT |
| js-tokens | 4.0.0 | MIT |
| loose-envify | 1.4.0 | MIT |
| lucide-react | 0.460.0 | ISC |
| ms | 2.1.3 | MIT |
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
| redis-errors | 1.2.0 | MIT |
| redis-parser | 3.0.0 | MIT |
| scheduler | 0.23.2 | MIT |
| split2 | 4.2.0 | ISC |
| standard-as-callback | 2.1.0 | MIT |
| ws | 8.22.1 | MIT |
| xtend | 4.0.2 | MIT |

## Fonts

| Font | Source | Licence |
| --- | --- | --- |
| Manrope | `@fontsource/manrope`, self-hosted woff2 and woff | SIL Open Font License 1.1 |
| Open Sans | `@fontsource/open-sans`, self-hosted woff2 and woff | SIL Open Font License 1.1 |

## Icons

| Icon set | Source | Licence |
| --- | --- | --- |
| Lucide (workspace nav icons) | `lucide-react`, bundled with the app | ISC |

The stitch glyphs drawn in the chart and in the symbol tiles are original vector shapes made
for Twinrow and are not from an icon set.

## Build-time tools

These are development dependencies and are not shipped: typescript (Apache-2.0), vite (MIT),
@vitejs/plugin-react (MIT), @types/* (MIT).
