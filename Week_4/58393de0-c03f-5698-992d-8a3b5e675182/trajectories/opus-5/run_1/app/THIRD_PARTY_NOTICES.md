# Third-party notices

Quarkyard ships the production packages below, as reported by `npm ls --omit=dev --all --json`,
together with the Fira Sans typeface. Everything else in the product — renders, doodles, geometry,
circuit solving and file building — is Quarkyard's own code.

## Shipped npm packages

| Package | Version | Licence |
|---|---|---|
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

## Fonts

| Font | Licence | Notes |
|---|---|---|
| Fira Sans | OFL-1.1 | Served by the app from `/fonts`; licence text in `assets/fonts/FiraSans-LICENSE.txt`. |

## Icons

Icon outlines follow the Lucide icon set (ISC licence, https://lucide.dev). They are drawn by
Quarkyard's own inline SVG markup; no Lucide package is shipped at runtime.

## Build-only tooling

esbuild (MIT) and TypeScript (Apache-2.0) are development dependencies and are not shipped.
