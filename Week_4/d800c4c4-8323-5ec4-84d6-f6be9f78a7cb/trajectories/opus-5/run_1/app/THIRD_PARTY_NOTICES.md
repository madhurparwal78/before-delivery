# Third-party notices

Pegworth Desk ships the packages and font files listed here. Nothing else is
served to the browser, and the browser loads nothing from another origin.

## Shipped packages

Every package in the production dependency tree reported by
`npm ls --omit=dev --all --json`:

| Package | Version | Licence |
| --- | --- | --- |
| js-tokens | 4.0.0 | MIT |
| loose-envify | 1.4.0 | MIT |
| pg | 8.16.3 | MIT |
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
| xtend | 4.0.2 | MIT |

## Bundled fonts

Self-hosted from the font files shipped in `dist/public/assets/fonts`.

| Font | File | Source package | Licence |
| --- | --- | --- | --- |
| Archivo Black | archivo-black-latin-400-normal.woff2 | @fontsource/archivo-black | OFL-1.1 |
| IBM Plex Sans | ibm-plex-sans-latin-400-normal.woff2 | @fontsource/ibm-plex-sans | OFL-1.1 |
| IBM Plex Sans | ibm-plex-sans-latin-600-normal.woff2 | @fontsource/ibm-plex-sans | OFL-1.1 |
| IBM Plex Mono | ibm-plex-mono-latin-400-normal.woff2 | @fontsource/ibm-plex-mono | OFL-1.1 |
| IBM Plex Mono | ibm-plex-mono-latin-600-normal.woff2 | @fontsource/ibm-plex-mono | OFL-1.1 |

## Icons

The line icons and tool silhouettes are drawn in this repository as SVG paths
from each part’s shape kind and its size in holes. No icon package is shipped.
