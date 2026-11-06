# Third-party notices

Clinchline ships the production dependency tree below, as reported by
`npm ls --omit=dev --all --json`, together with the two bundled typefaces. Every
licence here is one of the licences the working rules allow.

## Shipped packages

| Package | Version | Licence |
| --- | --- | --- |
| @emnapi/runtime | 1.11.3 | MIT |
| @img/colour | 1.1.0 | MIT |
| @img/sharp-libvips-linux-arm64 | 1.3.4 | LGPL-3.0-or-later |
| @img/sharp-linux-arm64 | 0.35.5 | Apache-2.0 |
| @img/sharp-wasm32 | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later AND MIT |
| detect-libc | 2.1.2 | Apache-2.0 |
| heic-decode | 2.0.0 | ISC |
| libheif-js | 1.23.5 | LGPL-3.0 |
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
| semver | 7.8.5 | ISC |
| sharp | 0.35.5 | Apache-2.0 |
| split2 | 4.2.0 | ISC |
| tslib | 2.9.1 | 0BSD |
| xtend | 4.0.2 | MIT |

## Bundled fonts

| Typeface | Source | Licence |
| --- | --- | --- |
| Archivo | 5.2.5 (@fontsource/archivo) | OFL-1.1 |
| Public Sans | 5.2.5 (@fontsource/public-sans) | OFL-1.1 |

## Notes

- `libheif-js` and its bundled libheif build are used only to decode HEIC uploads;
  they are LGPL-3.0 licensed and are used as unmodified libraries.
- `sharp` bundles prebuilt libvips binaries for the host platform; the combined
  notice above reflects the licences those binaries carry.
- The fonts are served from the app itself, so the browser loads nothing from a
  third-party host.
