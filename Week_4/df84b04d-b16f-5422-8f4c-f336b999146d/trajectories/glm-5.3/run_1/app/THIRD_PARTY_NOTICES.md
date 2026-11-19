# Third-party notices

Twigline by Pellwick & Ash ships the following third-party packages, fonts and icon assets.

## npm packages (production dependency tree of `npm ls --omit=dev --all`)

| Package | Version | Licence |
|---|---|---|
| pg | 8.23.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pg-int8 | 1.0.1 | ISC |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| xtend | 4.0.2 | MIT |
| pgpass | 1.0.5 | MIT |
| split2 | 4.2.0 | BSD-3-Clause |
| ws | 8.23.0 | MIT |

All are permissive licences from the allowed set (MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD).

## Fonts

- **Inter** — SIL Open Font License 1.1 (OFL-1.1). © The Inter Project Authors (Rasmus Andersson). Self-hosted as WOFF2 subsets in `/fonts`, generated from the Google Fonts distribution of Inter.
- **Noto Sans** — SIL Open Font License 1.1 (OFL-1.1). © Google Inc. Self-hosted as WOFF2 subsets in `/fonts`, generated from the Google Fonts distribution of Noto Sans.

## Icons

All icons used in the interface are original inline SVG line glyphs authored for this project; no icon package is bundled.

## Notes

- The page loads no fonts, scripts or styles from any CDN or external origin.
- Development-only tooling (TypeScript, esbuild, Playwright and their transitive dependencies) is not part of the shipped production tree and is excluded from the runtime bundle.
