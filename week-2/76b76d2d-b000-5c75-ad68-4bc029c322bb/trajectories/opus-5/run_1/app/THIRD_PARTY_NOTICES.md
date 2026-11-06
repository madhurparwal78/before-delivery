# Third-party notices

Halide Box Office ships the packages and fonts below. Licence identifiers are SPDX.

## Runtime packages

The production dependency tree (`npm ls --omit=dev --all --json`).

| Package | Version | Licence |
|---|---|---|
| pg | 8.16.3 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-int8 | 1.0.1 | ISC |
| pg-native | not installed (optional peer of pg) | MIT |
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

`pg` is the Postgres driver. `pg-native` is an optional peer dependency of `pg`; it is listed
because it appears in the dependency tree, and it is not installed or shipped.

## Bundled icons

| Package | Version | Licence |
|---|---|---|
| lucide-static | 0.544.0 | ISC |

The icon files under `dist/public/icons/` come from `lucide-static` and are inlined into pages.

## Bundled fonts

| Font | Version | Licence |
|---|---|---|
| Inter (`inter-400.woff2`, `inter-600.woff2`) | 5.2.8 | OFL-1.1 |
| Instrument Serif (`instrument-serif-400.woff2`) | 5.2.6 | OFL-1.1 |
| IBM Plex Mono (`ibm-plex-mono-400.woff2`) | 5.2.6 | OFL-1.1 |

Font files are copied from the `@fontsource/inter`, `@fontsource/instrument-serif` and
`@fontsource/ibm-plex-mono` packages at build time and served from `dist/public/fonts/`.

## Build-only tooling

These are development dependencies. They are not shipped with the running application.

| Package | Version | Licence |
|---|---|---|
| @fontsource/ibm-plex-mono | 5.2.6 | OFL-1.1 |
| @fontsource/instrument-serif | 5.2.6 | OFL-1.1 |
| @fontsource/inter | 5.2.8 | OFL-1.1 |
| @types/node | 22.13.10 | MIT |
| @types/pg | 8.11.11 | MIT |
| esbuild | 0.25.10 | MIT |
| lucide-static | 0.544.0 | ISC |
| typescript | 5.9.3 | Apache-2.0 |
