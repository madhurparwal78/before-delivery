# Third-party notices

Yardline ships the packages below. Each is used under the licence named.

## Go modules (imported by the server)

| Module | Version | Licence |
|---|---|---|
| github.com/jackc/pgx/v5 | v5.13.0 | MIT |
| github.com/jackc/pgpassfile | v1.0.0 | MIT |
| github.com/jackc/pgservicefile | v0.0.0-20240606120523-5a60cdf6a761 | MIT |
| github.com/jackc/puddle/v2 | v2.2.3 | MIT |
| golang.org/x/sync | v0.22.0 | BSD-3-Clause |
| golang.org/x/text | v0.41.0 | BSD-3-Clause |

The Go standard library (including `time/tzdata`) is BSD-3-Clause.

## npm production dependencies (`npm ls --omit=dev --all`)

| Package | Version | Licence |
|---|---|---|
| preact | 10.29.8 | MIT |
| @fontsource/manrope | 5.3.0 | OFL-1.1 |
| @fontsource/plus-jakarta-sans | 5.3.0 | OFL-1.1 |
| preact-render-to-string | (optional peer of preact; not installed, not shipped) | MIT |

## Bundled fonts

| Font | Files shipped | Licence |
|---|---|---|
| Manrope | `manrope-latin-{400,600,700,800}-normal.woff2` | OFL-1.1 (Copyright 2019 The Manrope Project Authors) |
| Plus Jakarta Sans | `plus-jakarta-sans-latin-800-{normal,italic}.woff2` | OFL-1.1 (Copyright 2020 The Plus Jakarta Sans Project Authors) |

The SIL Open Font License 1.1 text is included with each font package under
`node_modules/@fontsource/*/LICENSE`.
