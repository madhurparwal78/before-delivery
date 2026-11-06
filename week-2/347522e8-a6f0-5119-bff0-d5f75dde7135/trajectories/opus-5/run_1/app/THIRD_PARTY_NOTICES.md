# Third-party notices

Railside ships the packages, fonts and icon set listed here. Every one is
licensed under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or
OFL-1.1.

## Shipped packages

The production dependency tree as reported by `npm ls --omit=dev --all --json`.

| Package | Version | Licence |
|---|---|---|
| `pg` | 8.16.3 | MIT |
| `pg-cloudflare` | 1.4.1 | MIT |
| `pg-connection-string` | 2.14.1 | MIT |
| `pg-int8` | 1.0.1 | ISC |
| `pg-pool` | 3.14.0 | MIT |
| `pg-protocol` | 1.16.1 | MIT |
| `pg-types` | 2.2.0 | MIT |
| `pgpass` | 1.0.5 | MIT |
| `postgres-array` | 2.0.0 | MIT |
| `postgres-bytea` | 1.0.1 | MIT |
| `postgres-date` | 1.0.7 | MIT |
| `postgres-interval` | 1.2.0 | MIT |
| `split2` | 4.2.0 | ISC |
| `xtend` | 4.0.2 | MIT |

`pg-native` is an unmet optional dependency of `pg`; it is not installed and
not shipped.

## Bundled fonts

The font files below are copied into `dist/public/assets/fonts` at build time
and served from the app's own origin. The packages they come from are build-time
development dependencies and are not part of the production dependency tree.

| Font | Source package | Version | Licence |
|---|---|---|---|
| Archivo Black (latin, 400) | `@fontsource/archivo-black` | 5.3.0 | OFL-1.1 |
| Public Sans (latin, 400 and 600) | `@fontsource/public-sans` | 5.3.0 | OFL-1.1 |
| JetBrains Mono (latin, 400 and 700) | `@fontsource/jetbrains-mono` | 5.3.0 | OFL-1.1 |

- Archivo Black — Copyright The Archivo Black Project Authors. SIL Open Font
  License 1.1.
- Public Sans — Copyright The Public Sans Project Authors. SIL Open Font
  License 1.1.
- JetBrains Mono — Copyright The JetBrains Mono Project Authors. SIL Open Font
  License 1.1.

## Bundled icon set

| Icon set | Source package | Version | Licence |
|---|---|---|---|
| Lucide | `lucide-static` | 0.544.0 | ISC |

Lucide — ISC License. Copyright for portions of Lucide are held by Cole Bemis
2013-2023 as part of Feather (MIT). All other copyright for Lucide are held by
Lucide Contributors 2025. The build step reads the icons the screens use and
writes them into a single sprite at `dist/public/assets/icons.svg`.

## Build-time only tools

These are development dependencies. They are not shipped in the production
dependency tree and none of their code is served to the browser.

| Package | Version | Licence |
|---|---|---|
| `typescript` | 5.9.3 | Apache-2.0 |
| `esbuild` | 0.25.10 | MIT |
| `@types/node` | 22.15.3 | MIT |
| `@types/pg` | 8.15.5 | MIT |
