# Third-party notices

Farshore Buckets ships the packages, fonts and icon sets listed here. Every entry is licensed under
MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1.

## Shipped packages

These are the production dependencies reported by `npm ls --omit=dev --all --json`.

| Package | Version | Licence |
|---|---|---|
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
| `split2` | 4.2.0 | ISC |
| `xtend` | 4.0.2 | MIT |

`pg-native` appears in `pg`'s optional dependencies. It is not installed and not shipped.

## Bundled fonts

The font files are served from the app's own origin under `/assets/fonts/`. They are taken from the
Fontsource packages at build time, which are devDependencies and are not shipped themselves.

| Font | Files | Licence |
|---|---|---|
| Space Grotesk (Florian Karsten) | `space-grotesk-500.woff2`, `space-grotesk-600.woff2` | OFL-1.1 |
| IBM Plex Sans (IBM) | `plex-sans-400.woff2`, `plex-sans-500.woff2` | OFL-1.1 |
| JetBrains Mono (JetBrains) | `jetbrains-mono-400.woff2` | OFL-1.1 |

## Icon sets

Farshore ships no icon set. Every control is labelled with text, and the replica map, meters and
progress bars are drawn from the app's own SVG and CSS.

## Build-time tools

These are devDependencies. They run during `npm run build` and are not part of the served app:
`typescript` (Apache-2.0), `esbuild` (MIT), `@types/node` (MIT), `@types/pg` (MIT),
`@fontsource/space-grotesk`, `@fontsource/ibm-plex-sans` and `@fontsource/jetbrains-mono` (MIT
packaging of OFL-1.1 fonts).
