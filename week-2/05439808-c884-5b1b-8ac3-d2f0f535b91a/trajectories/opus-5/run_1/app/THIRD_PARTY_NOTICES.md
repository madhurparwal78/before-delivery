# Third party notices

Saltreach ships the packages, fonts and icons listed here. Nothing is loaded
from another origin at run time: every font file and script is bundled and
served by the app itself.

## Shipped packages

The production dependency tree, as reported by `npm ls --omit=dev --all --json`.
Entries marked "optional, not installed" are platform builds that npm records in
the tree but does not place in `node_modules` on this platform.

| Package | Version | Licence |
| --- | --- | --- |
| `@fontsource/atkinson-hyperlegible` | 5.3.0 | OFL-1.1 |
| `@fontsource/fraunces` | 5.3.0 | OFL-1.1 |
| `@fontsource/jetbrains-mono` | 5.3.0 | OFL-1.1 |
| `@node-rs/argon2` | 2.2.2 | MIT |
| `@node-rs/argon2-android-arm-eabi` | optional, not installed | MIT |
| `@node-rs/argon2-android-arm64` | optional, not installed | MIT |
| `@node-rs/argon2-darwin-arm64` | optional, not installed | MIT |
| `@node-rs/argon2-darwin-x64` | optional, not installed | MIT |
| `@node-rs/argon2-freebsd-x64` | optional, not installed | MIT |
| `@node-rs/argon2-linux-arm-gnueabihf` | optional, not installed | MIT |
| `@node-rs/argon2-linux-arm64-gnu` | 2.2.2 | MIT |
| `@node-rs/argon2-linux-arm64-musl` | 2.2.2 | MIT |
| `@node-rs/argon2-linux-x64-gnu` | optional, not installed | MIT |
| `@node-rs/argon2-linux-x64-musl` | optional, not installed | MIT |
| `@node-rs/argon2-win32-arm64-msvc` | optional, not installed | MIT |
| `@node-rs/argon2-win32-ia32-msvc` | optional, not installed | MIT |
| `@node-rs/argon2-win32-x64-msvc` | optional, not installed | MIT |
| `pg` | 8.23.1 | MIT |
| `pg-cloudflare` | 1.4.1 | MIT |
| `pg-connection-string` | 2.14.1 | MIT |
| `pg-int8` | 1.0.1 | ISC |
| `pg-native` | optional, not installed | MIT |
| `pg-pool` | 3.14.0 | MIT |
| `pg-protocol` | 1.16.1 | MIT |
| `pg-types` | 2.2.0 | MIT |
| `pgpass` | 1.0.5 | MIT |
| `postgres-array` | 2.0.0 | MIT |
| `postgres-bytea` | 1.0.1 | MIT |
| `postgres-date` | 1.0.7 | MIT |
| `postgres-interval` | 1.2.0 | MIT |
| `split2` | 4.2.0 | ISC |
| `three` | 0.170.0 | MIT |
| `xtend` | 4.0.2 | MIT |

## Bundled fonts

| Font | Source package | Licence |
| --- | --- | --- |
| Fraunces (600) | `@fontsource/fraunces` | OFL-1.1 |
| Atkinson Hyperlegible (400, 700) | `@fontsource/atkinson-hyperlegible` | OFL-1.1 |
| JetBrains Mono (400) | `@fontsource/jetbrains-mono` | OFL-1.1 |

The `@fontsource/*` npm packages are MIT licensed wrappers; the font files they
carry are licensed under the SIL Open Font License 1.1.

## Icon set

| Set | Source | Licence |
| --- | --- | --- |
| Saltreach outline icons | `src/client/ui/icons.ts`, authored for this project | MIT |

The icons are drawn as inline SVG paths on a 24-unit grid with one stroke
weight, so no third party icon font or sprite is shipped.

## Licence texts

Full licence texts ship inside each package directory under `node_modules`
(`LICENSE` or `LICENSE.md`), and the OFL text for each font family ships in its
`@fontsource` package.
