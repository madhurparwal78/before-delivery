# Third-party notices

Stationhouse ships the packages and assets listed here. The shipped packages are the production
dependency tree reported by `npm ls --omit=dev --all --json`; the bundled assets are the font files
and icon artwork copied into the built browser bundle.

## Shipped packages

| Package | Version | Licence |
|---|---|---|
| busboy | 1.6.0 | MIT |
| pg | 8.23.1 | MIT |
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
| streamsearch | 1.1.0 | MIT |
| xtend | 4.0.2 | MIT |

`busboy` and `streamsearch` are Copyright Brian White and distributed under the MIT licence.
`pg` and its related packages are Copyright Brian Carlson and distributed under the MIT licence.

## Bundled fonts

| Font | Files | Licence |
|---|---|---|
| Archivo Narrow | `fonts/archivo-narrow-400.woff2`, `fonts/archivo-narrow-600.woff2` | SIL Open Font License 1.1 |
| IBM Plex Sans | `fonts/ibm-plex-sans-400.woff2`, `fonts/ibm-plex-sans-600.woff2` | SIL Open Font License 1.1 |
| IBM Plex Mono | `fonts/ibm-plex-mono-400.woff2` | SIL Open Font License 1.1 |

Archivo Narrow is Copyright The Archivo Project Authors. IBM Plex Sans and IBM Plex Mono are
Copyright IBM Corp. The font files are taken from the Fontsource distributions
(`@fontsource/archivo-narrow`, `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono`, build-time
dependencies) and are redistributed under the SIL Open Font License 1.1.

## Bundled icons

| Icon set | Where | Licence |
|---|---|---|
| Lucide (clock, chevron-left, chevron-right, calendar-days, snowflake) | `src/client/icons.ts`, drawn into the browser bundle | ISC |

Lucide is Copyright 2022 Lucide Contributors, a fork of Feather Icons, Copyright 2013-2022 Cole
Bemis, both under the ISC licence.

## Licence texts

### MIT

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

### ISC

Permission to use, copy, modify, and/or distribute this software for any purpose with or without
fee is hereby granted, provided that the above copyright notice and this permission notice appear
in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS
SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE
AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT,
NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE
OF THIS SOFTWARE.

### SIL Open Font License 1.1

Copyright of each font remains with its authors, as named above. This Font Software is licensed
under the SIL Open Font License, Version 1.1. The licence permits the fonts to be used, studied,
modified and redistributed freely as long as they are not sold by themselves, carry this notice,
and any derivative uses a different reserved font name. The fonts are provided "as is", without
warranty of any kind. The full text is available at <https://openfontlicense.org>.
