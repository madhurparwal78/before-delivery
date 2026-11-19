# Third party notices

Lozenge ships the production dependency tree below (`npm ls --omit=dev --all --json`) and the two bundled
typefaces. Build-only tools (TypeScript, esbuild, the `@fontsource` font packages and the type definitions)
are development dependencies and are not shipped to the browser or the server runtime.

## Shipped packages

| Package | Version | Licence |
|---|---|---|
| pdf-lib | 1.17.1 | MIT |
| @pdf-lib/standard-fonts | 1.0.0 | MIT |
| @pdf-lib/upng | 1.0.1 | MIT |
| pako | 1.0.11 | MIT AND Zlib (both BSD-style permissive licences) |
| tslib | 1.14.1 | 0BSD (BSD Zero Clause) |
| pngjs | 7.0.0 | MIT |
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

## Bundled fonts

Both typefaces are served by the app itself from `/fonts` and are licensed under the
SIL Open Font License, Version 1.1.

| Served as | Typeface | Copyright | Licence |
|---|---|---|---|
| Stack Sans Headline (`stack-sans-headline-300/500/700.woff2`) | Quicksand | Copyright The Quicksand Project Authors (Andrew Paglinawan) | SIL OFL 1.1 |
| Stack Sans Text (`stack-sans-text-400/600.woff2`) | Inter | Copyright The Inter Project Authors | SIL OFL 1.1 |

The font files are copied into the build from the `@fontsource/quicksand` and `@fontsource/inter`
development packages, which distribute the upstream OFL font binaries unchanged.

## Sample data

The Fernhollow Tea sample, its stockists and every person in it are invented for this app.
