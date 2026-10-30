# Third-party notices

Relay Bench ships the packages and fonts below. "Shipped packages" is the
production dependency tree reported by `npm ls --omit=dev --all --json`.

## Shipped packages

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
| ws | 8.18.3 | MIT |
| xtend | 4.0.2 | MIT |

`bufferutil`, `utf-8-validate` and `pg-native` are optional peers of `ws` and
`pg`. They are not installed and are not shipped.

## Bundled fonts

The browser loads every font from this app. No font is fetched from a
third-party host.

| Font | Served as | Source package | Licence |
| --- | --- | --- | --- |
| Playfair Display (400, 700) | `/assets/fonts/playfair-400.woff2`, `/assets/fonts/playfair-700.woff2` | @fontsource/playfair-display 5.3.0 | OFL-1.1 |
| Inter (400, 600) | `/assets/fonts/inter-400.woff2`, `/assets/fonts/inter-600.woff2` | @fontsource/inter 5.3.0 | OFL-1.1 |
| JetBrains Mono (400) | `/assets/fonts/mono-400.woff2` | @fontsource/jetbrains-mono 5.3.0 | OFL-1.1 |

The `@fontsource/*` packages are build-time sources for those font files; only
the `.woff2` files above reach the browser.

## Build-time only

These are development dependencies and are not shipped: `esbuild`
(MIT), `typescript` (Apache-2.0), `@types/node`, `@types/pg`, `@types/ws`
(MIT), and the three `@fontsource` packages listed above.
