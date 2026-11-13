# Third-party notices

Interline Desk ships the packages and fonts listed below. Shipped packages are
the Go modules the program imports plus the npm production dependency tree
(`npm ls --omit=dev --all --json`). Every entry is under a permitted licence.

## Go modules

| Module | Version | Licence |
| --- | --- | --- |
| github.com/jackc/pgpassfile | v1.0.0 | MIT |
| github.com/jackc/pgservicefile | v0.0.0-20240606120523-5a60cdf6a761 | MIT |
| github.com/jackc/pgx/v5 | v5.12.0 | MIT |
| github.com/jackc/puddle/v2 | v2.2.3 | MIT |
| golang.org/x/sync | v0.24.0 | BSD-3-Clause |
| golang.org/x/text | v0.43.0 | BSD-3-Clause |

The Go standard library (Go 1.27) is under BSD-3-Clause.

## npm production dependencies

| Package | Version | Licence |
| --- | --- | --- |
| @fontsource/figtree | 5.2.6 | MIT (package); the font files are OFL-1.1 |
| @fontsource/inter | 5.2.8 | MIT (package); the font files are OFL-1.1 |

## Bundled fonts

| Font | Files | Licence |
| --- | --- | --- |
| Figtree (Erik Kennedy) | `dist/fonts/figtree-400.woff2`, `figtree-600.woff2`, `figtree-700.woff2` | OFL-1.1 |
| Inter (Rasmus Andersson) | `dist/fonts/inter-400.woff2`, `inter-600.woff2` | OFL-1.1 |

Both families are self-hosted and served from this application's own origin.

## Build-only tools

These are development dependencies; they are not shipped with the application.

| Package | Version | Licence |
| --- | --- | --- |
| esbuild | 0.25.10 | MIT |
| typescript | 5.9.3 | Apache-2.0 |
