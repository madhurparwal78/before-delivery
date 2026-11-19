# Third-party notices

Pilotlight ships the packages and fonts below. The list of shipped packages is the
production dependency tree reported by `npm ls --omit=dev --all --json`, plus the font
files bundled into `dist/public/fonts`.

## Shipped packages

| Package | Version | Licence |
| --- | --- | --- |
| bcryptjs | 3.0.3 | BSD-3-Clause |
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
| split2 | 4.2.0 | ISC |
| xtend | 4.0.2 | MIT |

`pg-native` is an unmet optional dependency of `pg`: it is never installed and never
shipped.

## Bundled fonts

| Font | Source package | Version | Licence |
| --- | --- | --- | --- |
| Archivo (variable, width axis) | @fontsource-variable/archivo | 5.3.0 | OFL-1.1 |
| IBM Plex Sans (400, 600) | @fontsource/ibm-plex-sans | 5.3.0 | OFL-1.1 |
| IBM Plex Mono (400, 500) | @fontsource/ibm-plex-mono | 5.3.0 | OFL-1.1 |

The font packages are development dependencies: only the `.woff2` files are copied into
the build output and served by the app itself.

## Icons

The line icons in the interface are inline SVG paths taken from Lucide
(https://lucide.dev), licensed ISC. No icon package is installed or shipped: the paths
live in `src/client/icons.ts` and are drawn by the app itself.
