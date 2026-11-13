# Third-party notices

Interline Desk ships the following third-party packages and bundled fonts.
Every item is licensed under MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC,
0BSD, MPL-2.0, Unicode-3.0 or OFL-1.1.

## Go modules

| Module | Version | Licence |
|---|---|---|
| github.com/google/uuid | v1.6.0 | BSD-3-Clause |
| github.com/lib/pq | v1.12.3 | MIT |
| golang.org/x/crypto | v0.58.0 | BSD-3-Clause |
| golang.org/x/mod | v0.41.0 | BSD-3-Clause |
| golang.org/x/net | v0.60.0 | BSD-3-Clause |
| golang.org/x/sync | v0.24.0 | BSD-3-Clause |
| golang.org/x/sys | v0.49.0 | BSD-3-Clause |
| golang.org/x/term | v0.47.0 | BSD-3-Clause |
| golang.org/x/text | v0.43.0 | BSD-3-Clause |
| golang.org/x/tools | v0.51.0 | BSD-3-Clause |

## npm production dependency tree

| Package | Version | Licence |
|---|---|---|
| esbuild | 0.28.2 | MIT |
| @esbuild/* platform binaries (linux-arm64, linux-x64 and peers) | 0.28.2 | MIT |

esbuild bundles the TypeScript sources at build time; none of it runs in the
browser. Build-time type checking only:

| Package | Version | Licence |
|---|---|---|
| typescript | 7.0.2 | Apache-2.0 |
| @types/node | 26.6.6 | MIT |
| @typescript/* platform binaries | 7.0.2 | Apache-2.0 |
| undici-types | 7.x | MIT |

## Bundled fonts

| Font | Format | Licence |
|---|---|---|
| Figtree (variable weight, latin and latin-ext) | woff2, self-hosted | SIL Open Font License 1.1 |
| Inter (variable weight, latin) | woff2, self-hosted | SIL Open Font License 1.1 |

Both font families are served from the app's own origin under `/fonts/` and
loaded by `/fonts.css`; no font is fetched from a third-party host.
