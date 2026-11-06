# Third-party notices

Snaglight ships the packages in its production dependency tree, as reported by
`npm ls --omit=dev --all --json`, and the font files bundled under `assets/fonts`.
Everything listed below is licensed under MIT, ISC, BSD-2-Clause, BSD-3-Clause,
Apache-2.0, 0BSD or SIL OFL 1.1.

## Shipped packages

| Package | Version | Licence |
| --- | --- | --- |
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
| xtend | 4.0.2 | MIT |

`pg-native` is an unmet optional dependency of `pg`; it is not installed and not
shipped.

## Bundled fonts

| Font file | Family | Version | Licence |
| --- | --- | --- | --- |
| `assets/fonts/archivo-latin.woff2` | Archivo (variable, latin subset) | v25 | SIL OFL 1.1 |
| `assets/fonts/ibm-plex-sans-latin.woff2` | IBM Plex Sans (variable, latin subset) | v23 | SIL OFL 1.1 |
| `assets/fonts/ibm-plex-mono-400.woff2` | IBM Plex Mono Regular (latin subset) | v20 | SIL OFL 1.1 |
| `assets/fonts/ibm-plex-mono-600.woff2` | IBM Plex Mono SemiBold (latin subset) | v20 | SIL OFL 1.1 |

Archivo is Copyright (c) Omnibus-Type. IBM Plex Sans and IBM Plex Mono are
Copyright (c) 2017 IBM Corp. Both families are released under the SIL Open Font
License, Version 1.1, which permits bundling and redistribution with this
notice.

## Build-time tools

These are development dependencies. They are not part of the shipped tree and no
part of them is served to the browser.

| Package | Version | Licence |
| --- | --- | --- |
| esbuild | 0.24.2 | MIT |
| typescript | 5.7.2 | Apache-2.0 |
| @types/node | 22.10.2 | MIT |
| @types/pg | 8.11.10 | MIT |
