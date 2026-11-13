# Third-party notices

Cutline Jury Desk ships the packages, fonts and icon set listed here. Every licence below is one of
MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, CC0-1.0 or SIL OFL-1.1.

## Shipped packages

The production dependency tree reported by `npm ls --omit=dev --all --json`.

| Package | Version | Licence |
| --- | --- | --- |
| `@fontsource-variable/archivo` | 5.3.0 | SIL OFL-1.1 |
| `@fontsource/ibm-plex-mono` | 5.3.0 | SIL OFL-1.1 |
| `@fontsource/ibm-plex-sans` | 5.3.0 | SIL OFL-1.1 |
| `jpeg-js` | 0.4.4 | BSD-3-Clause |
| `lucide-static` | 0.468.0 | ISC |
| `pg` | 8.13.1 | MIT |
| `pg-cloudflare` | 1.4.1 | MIT |
| `pg-connection-string` | 2.14.1 | MIT |
| `pg-int8` | 1.0.1 | ISC |
| `pg-pool` | 3.14.0 | MIT |
| `pg-protocol` | 1.16.1 | MIT |
| `pg-types` | 2.2.0 | MIT |
| `pgpass` | 1.0.6 | MIT |
| `pngjs` | 7.0.0 | MIT |
| `postgres-array` | 2.0.0 | MIT |
| `postgres-bytea` | 1.0.1 | MIT |
| `postgres-date` | 1.0.7 | MIT |
| `postgres-interval` | 1.2.0 | MIT |
| `preact` | 10.25.4 | MIT |
| `xtend` | 4.0.2 | MIT |

`pg` declares `pg-native` as an optional dependency. It is not installed and is not shipped.

## Bundled fonts

| Font | Files served | Licence |
| --- | --- | --- |
| Archivo (variable, weight and width axes) — Omnibus-Type | `/fonts/archivo-variable.woff2`, from `@fontsource-variable/archivo` | SIL OFL-1.1 |
| IBM Plex Sans — IBM | `/fonts/plex-sans-400.woff2`, `/fonts/plex-sans-600.woff2`, from `@fontsource/ibm-plex-sans` | SIL OFL-1.1 |
| IBM Plex Mono — IBM | `/fonts/plex-mono-400.woff2`, `/fonts/plex-mono-600.woff2`, from `@fontsource/ibm-plex-mono` | SIL OFL-1.1 |

## Bundled icon set

| Icon set | Icons used | Licence |
| --- | --- | --- |
| Lucide, from `lucide-static` 0.468.0 | `triangle`, `star`, `circle`, `x`, `arrow-up`, `arrow-down` | ISC |

Lucide is a fork of Feather Icons, copyright (c) 2013-2022 Cole Bemis, and is distributed under the
ISC licence. The icon drawings are inlined into the stylesheet bundle at build time; no raster
artwork ships with the app.

## Build-only tools

`typescript`, `esbuild`, `@types/node`, `@types/pg` and `@types/pngjs` are development dependencies.
They produce the build output but are not part of the shipped dependency tree.
