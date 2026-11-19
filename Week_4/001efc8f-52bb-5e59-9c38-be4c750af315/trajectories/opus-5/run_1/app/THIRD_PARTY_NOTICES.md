# Third-party notices

Rimewire ships the production dependency tree below, taken from
`npm ls --omit=dev --all --json`, together with the bundled fonts and icon
geometry listed at the end.

## Shipped packages

| Package | Version | Licence |
|---|---|---|
| `@img/sharp-darwin-arm64` | 0.33.5 | Apache-2.0 |
| `@img/sharp-darwin-x64` | 0.33.5 | Apache-2.0 |
| `@img/sharp-libvips-darwin-arm64` | 1.0.4 | LGPL-3.0-or-later |
| `@img/sharp-libvips-darwin-x64` | 1.0.4 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linux-arm` | 1.0.5 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linux-arm64` | 1.0.4 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linux-s390x` | 1.0.4 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linux-x64` | 1.0.4 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linuxmusl-arm64` | 1.0.4 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linuxmusl-x64` | 1.0.4 | LGPL-3.0-or-later |
| `@img/sharp-linux-arm` | 0.33.5 | Apache-2.0 |
| `@img/sharp-linux-arm64` | 0.33.5 | Apache-2.0 |
| `@img/sharp-linux-s390x` | 0.33.5 | Apache-2.0 |
| `@img/sharp-linux-x64` | 0.33.5 | Apache-2.0 |
| `@img/sharp-linuxmusl-arm64` | 0.33.5 | Apache-2.0 |
| `@img/sharp-linuxmusl-x64` | 0.33.5 | Apache-2.0 |
| `@img/sharp-wasm32` | 0.33.5 | Apache-2.0 |
| `@img/sharp-win32-ia32` | 0.33.5 | Apache-2.0 |
| `@img/sharp-win32-x64` | 0.33.5 | Apache-2.0 |
| `busboy` | 1.6.0 | MIT |
| `color` | 4.2.3 | MIT |
| `color-convert` | 2.0.1 | MIT |
| `color-name` | 1.1.4 | MIT |
| `color-string` | 1.9.1 | MIT |
| `detect-libc` | 2.1.2 | Apache-2.0 |
| `is-arrayish` | 0.3.4 | MIT |
| `pg` | 8.13.1 | MIT |
| `pg-cloudflare` | 1.4.1 | MIT |
| `pg-connection-string` | 2.14.1 | MIT |
| `pg-int8` | 1.0.1 | ISC |
| `pg-native` | 3.5.2 | MIT |
| `pg-pool` | 3.14.0 | MIT |
| `pg-protocol` | 1.16.1 | MIT |
| `pg-types` | 2.2.0 | MIT |
| `pgpass` | 1.0.6 | MIT |
| `postgres-array` | 2.0.0 | MIT |
| `postgres-bytea` | 1.0.1 | MIT |
| `postgres-date` | 1.0.7 | MIT |
| `postgres-interval` | 1.2.0 | MIT |
| `react` | 19.0.0 | MIT |
| `react-dom` | 19.0.0 | MIT |
| `scheduler` | 0.25.0 | MIT |
| `semver` | 7.8.5 | ISC |
| `sharp` | 0.33.5 | Apache-2.0 |
| `simple-swizzle` | 0.2.4 | MIT |
| `streamsearch` | 1.1.0 | MIT |
| `xtend` | 4.0.2 | MIT |

`@img/sharp-libvips-*` are unmodified prebuilt builds of libvips, used by
`sharp` for photo re-encoding and thumbnails. `pg-native` and the
`@img/sharp-*` builds for other platforms are optional entries of the tree and
are not installed on this platform.

## Bundled fonts

| Font | Files | Licence |
|---|---|---|
| Barlow Condensed (Bold 700) | `assets/fonts/barlow-condensed-latin-700-normal.woff2` | OFL-1.1 |
| IBM Plex Sans (Regular 400, SemiBold 600) | `assets/fonts/ibm-plex-sans-latin-400-normal.woff2`, `assets/fonts/ibm-plex-sans-latin-600-normal.woff2` | OFL-1.1 |
| IBM Plex Mono (Regular 400, SemiBold 600) | `assets/fonts/ibm-plex-mono-latin-400-normal.woff2`, `assets/fonts/ibm-plex-mono-latin-600-normal.woff2` | OFL-1.1 |

All fonts are served by the app itself; nothing is fetched from another origin.

## Bundled icon geometry

| Source | Use | Licence |
|---|---|---|
| Lucide icon set | The glyph path data inlined in `src/web/Icons.tsx` | ISC |
