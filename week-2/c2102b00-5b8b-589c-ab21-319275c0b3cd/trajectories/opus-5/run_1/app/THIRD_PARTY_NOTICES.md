# Third-party notices

Tally Split ships the packages and fonts below. Everything else in this repository is the app's own source.

## Shipped packages

The production dependency tree from `npm ls --omit=dev --all --json`.

| Package | Version | Licence |
| --- | --- | --- |
| `base64-js` | 1.5.1 | MIT |
| `better-sqlite3` | 11.10.0 | MIT |
| `bindings` | 1.5.0 | MIT |
| `bl` | 4.1.0 | MIT |
| `buffer` | 5.7.1 | MIT |
| `chownr` | 1.1.4 | ISC |
| `decompress-response` | 6.0.0 | MIT |
| `deep-extend` | 0.6.0 | MIT |
| `detect-libc` | 2.1.2 | Apache-2.0 |
| `end-of-stream` | 1.4.5 | MIT |
| `expand-template` | 2.0.3 | (MIT OR WTFPL) |
| `file-uri-to-path` | 1.0.0 | MIT |
| `fs-constants` | 1.0.0 | MIT |
| `github-from-package` | 0.0.0 | MIT |
| `ieee754` | 1.2.1 | BSD-3-Clause |
| `inherits` | 2.0.4 | ISC |
| `ini` | 1.3.8 | ISC |
| `mimic-response` | 3.1.0 | MIT |
| `minimist` | 1.2.8 | MIT |
| `mkdirp-classic` | 0.5.3 | MIT |
| `napi-build-utils` | 2.0.0 | MIT |
| `node-abi` | 3.101.0 | MIT |
| `once` | 1.4.0 | ISC |
| `prebuild-install` | 7.1.3 | MIT |
| `pump` | 3.0.4 | MIT |
| `rc` | 1.2.8 | (BSD-2-Clause OR MIT OR Apache-2.0) |
| `readable-stream` | 3.6.2 | MIT |
| `safe-buffer` | 5.2.1 | MIT |
| `semver` | 7.8.5 | ISC |
| `simple-concat` | 1.0.1 | MIT |
| `simple-get` | 4.0.1 | MIT |
| `string_decoder` | 1.3.0 | MIT |
| `strip-json-comments` | 2.0.1 | MIT |
| `tar-fs` | 2.1.5 | MIT |
| `tar-stream` | 2.2.0 | MIT |
| `three` | 0.173.0 | MIT |
| `tunnel-agent` | 0.6.0 | Apache-2.0 |
| `util-deprecate` | 1.0.2 | MIT |
| `wrappy` | 1.0.2 | ISC |

## Bundled fonts

Both families are served from the app's own origin, from the files in `dist/public/fonts`.

| Font | Licence | Notice | Packaged from |
| --- | --- | --- | --- |
| Archivo (variable, latin and latin-ext) | OFL-1.1 | Copyright 2020 The Archivo Project Authors (https://github.com/Omnibus-Type/Archivo) | `@fontsource-variable/archivo` |
| IBM Plex Sans (400 and 600, latin and latin-ext) | OFL-1.1 | Copyright 2017 IBM Corp. (https://github.com/IBM/plex) | `@fontsource/ibm-plex-sans` |

The SIL Open Font License 1.1 text is included with each font package in `node_modules`.
