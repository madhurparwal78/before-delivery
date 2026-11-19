# Third-party notices

Linewell ships the packages and fonts listed here. "Shipped packages" is the production
dependency tree, as reported by `npm ls --omit=dev --all --json`.

## Shipped packages

| Package | Version | Licence |
| --- | --- | --- |
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
| split2 | 4.2.0 | ISC |
| ws | 8.22.1 | MIT |
| xtend | 4.0.2 | MIT |

`pg-native`, `bufferutil` and `utf-8-validate` are optional peers of the packages above.
Linewell does not install them, so they are not shipped.

## Bundled fonts

The three font families are self-hosted. Their `.woff2` files are copied into the built
client from the packages below at build time; nothing is loaded from another origin.

| Font | Source package | Version | Licence |
| --- | --- | --- | --- |
| Instrument Serif | @fontsource/instrument-serif | 5.2.6 | OFL-1.1 |
| IBM Plex Sans | @fontsource/ibm-plex-sans | 5.2.6 | OFL-1.1 |
| IBM Plex Mono | @fontsource/ibm-plex-mono | 5.2.6 | OFL-1.1 |

## Bundled icon artwork

The thin line icons in `src/client/icons.ts` are hand-written SVG paths drawn from the
Lucide icon set, which is published under the ISC licence. No Lucide package is shipped.

## Build-only tools

These are development dependencies and are not part of the shipped application:
`esbuild` (MIT), `typescript` (Apache-2.0), `@types/node` (MIT), `@types/pg` (MIT),
`@types/ws` (MIT) and the three `@fontsource` packages listed above, which supply the
font files that are copied into the build.
