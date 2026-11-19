# Third-party notices

Tramela Estate ships the packages, typefaces and geometry data listed here. Everything is
served from the app's own origin; the app requests nothing from third-party origins at run
time.

## Shipped npm packages

The production dependency tree, as reported by `npm ls --omit=dev --all --json`.

| Package | Version | Licence |
| --- | --- | --- |
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

`node-postgres` (the `pg` family) is copyright Brian Carlson and contributors, under the MIT
licence. `pg-int8`, `split2` and the `postgres-*` helpers carry the ISC and MIT licences of
their respective authors.

## Typefaces

| Typeface | Files | Licence |
| --- | --- | --- |
| Big Shoulders Display | `public/fonts/big-shoulders-display-700-latin.woff2`, `public/fonts/big-shoulders-display-700-latin-ext.woff2` | SIL Open Font License 1.1 (OFL-1.1) |
| Public Sans | `public/fonts/public-sans-400-latin.woff2`, `public/fonts/public-sans-400-latin-ext.woff2`, `public/fonts/public-sans-600-latin.woff2`, `public/fonts/public-sans-600-latin-ext.woff2` | SIL Open Font License 1.1 (OFL-1.1) |

Big Shoulders Display is copyright The Big Shoulders Project Authors. Public Sans is
copyright The Public Sans Authors, based on Libre Franklin by Impallari Type. Both are
licensed under the SIL Open Font License, Version 1.1, which permits the bundling and
serving of the font files with this application.

## Coastline geometry

| Data | File | Licence |
| --- | --- | --- |
| Natural Earth 1:50m Admin 0 Countries, clipped to the estate's view and simplified to three decimal places | `public/coastline.json` | Public domain (CC0-1.0) |

Natural Earth is a public-domain map dataset released by Nathaniel Vaughn Kelso and Tom
Patterson. No permission is needed to use it for any purpose, and the dataset carries no
warranty.

## Everything else

The server, the browser code, the tool and paint-tin drawings and the miniature map are
written for this application and carry no third-party licence.
