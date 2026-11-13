# Third-party notices

Rampwright ships the packages and fonts below. Everything listed is under MIT, ISC, BSD-2-Clause,
BSD-3-Clause, Apache-2.0, 0BSD, Zlib or OFL-1.1.

## Packages

The production dependency tree, as reported by `npm ls --omit=dev --all --json`.

| Package | Version | Licence |
| --- | --- | --- |
| js-tokens | 4.0.0 | MIT |
| loose-envify | 1.4.0 | MIT |
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
| react | 18.3.1 | MIT |
| react-dom | 18.3.1 | MIT |
| scheduler | 0.23.2 | MIT |
| xtend | 4.0.2 | MIT |

`pg-native` is an optional dependency of `pg`. It is not installed and is not shipped.

## Fonts

Both faces are served from the app's own origin, as WOFF2 files copied at build time from the
`@fontsource` packages (build-time only dependencies).

| Font | Version | Licence |
| --- | --- | --- |
| Inter (regular, semi-bold, extra-bold) | 5.1.0 (@fontsource/inter) | OFL-1.1 |
| JetBrains Mono (regular, bold) | 5.1.1 (@fontsource/jetbrains-mono) | OFL-1.1 |

## Build-time tools

These are development dependencies. They are not part of the shipped bundle: esbuild
(MIT), typescript (Apache-2.0), @types/node, @types/pg, @types/react, @types/react-dom (MIT),
@fontsource/inter and @fontsource/jetbrains-mono (OFL-1.1 for the font files, MIT for the packaging).
