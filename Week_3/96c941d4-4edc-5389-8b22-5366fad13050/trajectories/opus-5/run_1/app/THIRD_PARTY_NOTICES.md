# Third-party notices

Squallglass ships original TypeScript and original procedural canvas/SVG artwork. The third-party
material below is the complete set of shipped packages and bundled fonts.

## Shipped packages

These are the production dependency tree reported by `npm ls --omit=dev --all --json`.

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
| xtend | 4.0.2 | MIT |

The optional peer dependency `pg-native` is not installed and is not shipped.

Full licence texts for each package are distributed inside that package under `node_modules`
after `npm ci`.

## Bundled fonts

Both font families are bundled locally from `public/fonts` and are served only by this app. Their
complete licence texts ship beside the font files.

| Font family | Files | Licence | Licence text |
| --- | --- | --- | --- |
| Bricolage Grotesque | `bricolage-grotesque-latin-ext-600-normal.woff2`, `bricolage-grotesque-latin-ext-700-normal.woff2` | SIL Open Font License 1.1 | `public/fonts/LICENSE-bricolage-grotesque.txt` |
| Atkinson Hyperlegible | `atkinson-hyperlegible-latin-ext-400-normal.woff2`, `atkinson-hyperlegible-latin-ext-700-normal.woff2` | SIL Open Font License 1.1 | `public/fonts/LICENSE-atkinson-hyperlegible.txt` |

Copyright 2022 The Bricolage Grotesque Project Authors
(https://github.com/ateliertriay/bricolage).

Copyright 2020 Braille Institute of America, Inc. (Atkinson Hyperlegible).

## Build-only tooling

`typescript`, `esbuild`, `@types/node`, `@types/pg`, `@fontsource/bricolage-grotesque` and
`@fontsource/atkinson-hyperlegible` are development dependencies. They are not part of the shipped
production dependency tree; the two `@fontsource` packages are the upstream source of the bundled
font files listed above.
