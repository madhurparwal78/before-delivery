# Third party notices

Mothlight ships the packages and font files listed below. Package versions come from the
production dependency tree (`npm ls --omit=dev --all --json`).

## Shipped packages

| Package | Version | Licence |
| --- | --- | --- |
| `@emnapi/runtime` | 1.11.3 | MIT |
| `@img/colour` | 1.1.0 | MIT |
| `@img/sharp-libvips-linux-arm64` | 1.3.4 | LGPL-3.0-or-later |
| `@img/sharp-linux-arm64` | 0.35.5 | Apache-2.0 |
| `@img/sharp-wasm32` | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later AND MIT |
| `detect-libc` | 2.1.2 | Apache-2.0 |
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
| `semver` | 7.8.6 | ISC |
| `sharp` | 0.35.5 | Apache-2.0 |
| `split2` | 4.2.0 | ISC |
| `tslib` | 2.9.1 | 0BSD |
| `ws` | 8.18.3 | MIT |
| `xtend` | 4.0.2 | MIT |

`sharp` resolves one prebuilt binary package per platform. On a different platform the
matching package replaces `@img/sharp-linux-arm64` and `@img/sharp-libvips-linux-arm64`:

| Package | Version | Licence |
| --- | --- | --- |
| `@img/sharp-darwin-arm64`, `@img/sharp-darwin-x64`, `@img/sharp-linux-arm`, `@img/sharp-linux-ppc64`, `@img/sharp-linux-riscv64`, `@img/sharp-linux-s390x`, `@img/sharp-linux-x64`, `@img/sharp-linuxmusl-arm64`, `@img/sharp-linuxmusl-x64`, `@img/sharp-win32-arm64`, `@img/sharp-win32-ia32`, `@img/sharp-win32-x64` | 0.35.5 | Apache-2.0 |
| `@img/sharp-libvips-darwin-arm64`, `@img/sharp-libvips-darwin-x64`, `@img/sharp-libvips-linux-arm`, `@img/sharp-libvips-linux-ppc64`, `@img/sharp-libvips-linux-riscv64`, `@img/sharp-libvips-linux-s390x`, `@img/sharp-libvips-linux-x64`, `@img/sharp-libvips-linuxmusl-arm64`, `@img/sharp-libvips-linuxmusl-x64` | 1.3.4 | LGPL-3.0-or-later |

The prebuilt image library that the image package ships (`libvips`, in the
`@img/sharp-libvips-*` packages) is the one LGPL-3.0-or-later component.

## Shipped font files

| File | Family | Licence |
| --- | --- | --- |
| `dist/public/fonts/tiktok-sans-latin-wdth-normal.woff2` | TikTok Sans Variable (latin, weight and width axes) | OFL-1.1 |
| `dist/public/fonts/tiktok-sans-latin-ext-wdth-normal.woff2` | TikTok Sans Variable (latin-ext, weight and width axes) | OFL-1.1 |

Both files come from `@fontsource-variable/tiktok-sans` 5.3.0 (build dependency, OFL-1.1),
copied into the app at build time. TikTok Sans is Copyright 2024 TikTok Inc.
(<https://github.com/tiktok/TikTokSans>), licensed under the SIL Open Font License,
Version 1.1.

## Build-time dependencies

These are not shipped in the production tree: `typescript` (Apache-2.0), `esbuild` (MIT),
`@types/node`, `@types/pg`, `@types/ws` (MIT), `@fontsource-variable/tiktok-sans` (OFL-1.1,
font files shipped as listed above).
