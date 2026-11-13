# Third-party notices

This file lists every package and font shipped with Elevens. The packages are
the production dependency tree, as reported by
`npm ls --omit=dev --all --json`. Every licence below is one of MIT, ISC,
BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or SIL OFL 1.1.

## Production dependencies

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
| postgres-date | 1.0.7 | ISC |
| postgres-interval | 1.2.0 | MIT |
| split2 | 4.2.0 | ISC |
| ws | 8.22.2 | MIT |
| xtend | 4.0.2 | MIT |

The optional native packages `pg-native`, `bufferutil` and `utf-8-validate`
appear as unmet optional entries in the pg and ws trees; none of them is
installed, so no code from them is shipped.

Development-only tooling, not part of the shipped production tree: typescript
(Apache-2.0), esbuild (MIT), vite (MIT), @types/node (MIT), @types/pg (MIT),
@types/ws (MIT). Only compiled first-party TypeScript runs at runtime.

## Bundled fonts

All fonts are self-hosted under `public/fonts` and served by the app itself.
Each file is a subset of the corresponding Google Fonts release, which is
licensed under the SIL Open Font License 1.1.

| Font | File | Licence | Source |
|---|---|---|---|
| Big Shoulders Display, weight-700 instance | public/fonts/big-shoulders-display.woff2 | SIL OFL 1.1 | https://github.com/google/fonts/tree/main/ofl/bigshouldersdisplay |
| IBM Plex Sans, weight-400 instance | public/fonts/ibm-plex-sans.woff2 | SIL OFL 1.1 | https://github.com/google/fonts/tree/main/ofl/ibmplexsans |
| IBM Plex Mono, Regular | public/fonts/ibm-plex-mono.woff2 | SIL OFL 1.1 | https://github.com/google/fonts/tree/main/ofl/ibmplexmono |

The client bundle `public/assets/app.js` is built entirely from first-party
TypeScript source; no third-party runtime package is bundled into it.
