# Third-party notices

Lacquer ships the packages and fonts listed here. Versions come from the production
dependency tree (`npm ls --omit=dev --all --json`) of `package-lock.json`.

## Shipped packages

| Package | Version | Licence |
| --- | --- | --- |
| pg | 8.13.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pg-int8 | 1.0.1 | ISC |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| xtend | 4.0.2 | MIT |
| pgpass | 1.0.6 | MIT |
| react | 18.3.1 | MIT |
| react-dom | 18.3.1 | MIT |
| scheduler | 0.23.2 | MIT |
| loose-envify | 1.4.0 | MIT |
| js-tokens | 4.0.0 | MIT |

`pg-native` is an optional peer of `pg` and is not installed or shipped.

## Bundled fonts

| Font | Files | Licence |
| --- | --- | --- |
| Archivo (variable, width and weight axes) | `src/client/fonts/archivo-latin-wdth-normal.woff2`, `src/client/fonts/archivo-latin-ext-wdth-normal.woff2` | SIL Open Font License 1.1 (OFL-1.1) |
| IBM Plex Sans (400, 500, 600, 700) | `src/client/fonts/ibm-plex-sans-latin-*-normal.woff2` | SIL Open Font License 1.1 (OFL-1.1) |
| IBM Plex Mono (400, 500, 600) | `src/client/fonts/ibm-plex-mono-latin-*-normal.woff2` | SIL Open Font License 1.1 (OFL-1.1) |

The full font licence texts are kept beside the font files:
`src/client/fonts/Archivo-LICENSE.txt`, `src/client/fonts/IBMPlexSans-LICENSE.txt` and
`src/client/fonts/IBMPlexMono-LICENSE.txt`.

## Licence texts

### MIT

Permission is hereby granted, free of charge, to any person obtaining a copy of this
software and associated documentation files (the "Software"), to deal in the Software
without restriction, including without limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons
to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.

### ISC

Permission to use, copy, modify, and/or distribute this software for any purpose with or
without fee is hereby granted, provided that the above copyright notice and this permission
notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO
THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT
SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR
ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF
CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE
OR PERFORMANCE OF THIS SOFTWARE.

### SIL Open Font License 1.1

The fonts are licensed under the SIL Open Font License, Version 1.1. The full text, with
the copyright notices of each family, is in the licence files listed above.
