# Third party notices

Spurline ships the packages and fonts below. The package list is the production
dependency tree reported by `npm ls --omit=dev --all --json`. Optional native
helpers of `pg` and `ws` (`pg-native`, `bufferutil`, `utf-8-validate`) are not
installed and are not shipped.

## Shipped packages

| Package | Version | Licence |
|---|---|---|
| @fontsource/inter | 5.2.5 | MIT (package), OFL-1.1 (font files) |
| @fontsource/inter-tight | 5.2.5 | MIT (package), OFL-1.1 (font files) |
| @fontsource/jetbrains-mono | 5.2.5 | MIT (package), OFL-1.1 (font files) |
| pg | 8.13.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-int8 | 1.0.1 | ISC |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pgpass | 1.0.6 | MIT |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| ws | 8.18.0 | MIT |
| xtend | 4.0.2 | MIT |

## Bundled fonts

| Font | Files | Licence |
|---|---|---|
| Inter | `inter-300.woff2`, `inter-400.woff2`, `inter-600.woff2` | OFL-1.1 |
| Inter Tight | `inter-tight-700.woff2` | OFL-1.1 |
| JetBrains Mono | `mono-300.woff2`, `mono-400.woff2`, `mono-500.woff2` | OFL-1.1 |

Inter and Inter Tight are copyright The Inter Project Authors. JetBrains Mono is
copyright The JetBrains Mono Project Authors. Both are licensed under the SIL
Open Font License 1.1.

## Build-time only

TypeScript (Apache-2.0), esbuild (MIT), @types/* (MIT) and jsdom (MIT) are
development dependencies. They are not part of the served application.
