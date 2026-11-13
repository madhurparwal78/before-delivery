# Third-party notices

This file lists every shipped package (the production dependency tree reported by
`npm ls --omit=dev --all --json`) and the typefaces shipped with the app, with
each one's licence. The app itself is original work for Maison Neuf.

## Packages

| Package | Version | Licence |
|---|---|---|
| pg | 8.23.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-native | (unmet optional dependency; not installed) | MIT |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pg-int8 | 1.0.1 | MIT |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| xtend | 4.0.2 | MIT |
| pgpass | 1.0.5 | MIT |
| split2 | 4.2.0 | ISC |

Development-only packages (not shipped): typescript (Apache-2.0), @types/node
(MIT), @types/pg (MIT), esbuild (MIT).

## Typefaces

| Typeface | Version | Licence |
|---|---|---|
| Gloock | v8 | SIL Open Font License 1.1 |
| Rethink Sans | v7 | SIL Open Font License 1.1 |

Both fonts are served from this app's own origin as `.woff2` files; they were
fetched once at build time from Google Fonts (fonts.google.com). The SIL Open
Font License 1.1 texts are available at https://openfontlicense.org.
