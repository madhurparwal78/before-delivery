# Third-party notices

Hangline ships the packages and fonts below. The package list is the production dependency
tree reported by `npm ls --omit=dev --all --json`. Development-only tooling (TypeScript, Vite,
esbuild and type definitions) is not shipped and is not listed here.

## npm packages

| Package | Version | Licence |
| --- | --- | --- |
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
| react | 19.3.1 | MIT |
| react-dom | 19.3.1 | MIT |
| scheduler | 0.28.0 | MIT |
| split2 | 4.2.0 | ISC |
| three | 0.187.0 | MIT |
| xtend | 4.0.2 | MIT |

`pg-native` is an optional peer of `pg`. It is not installed and not shipped.

## Fonts

Both fonts are served from the app's own origin from `public/fonts`.

| Font | File | Licence |
| --- | --- | --- |
| Instrument Serif | `public/fonts/instrument-serif-latin.woff2` | SIL Open Font License 1.1 (OFL-1.1) |
| Hanken Grotesk | `public/fonts/hanken-grotesk-latin.woff2` | SIL Open Font License 1.1 (OFL-1.1) |

## Licence texts

### MIT

Permission is hereby granted, free of charge, to any person obtaining a copy of this software
and associated documentation files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

### ISC

Permission to use, copy, modify, and/or distribute this software for any purpose with or
without fee is hereby granted, provided that the above copyright notice and this permission
notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS
SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE
AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT,
NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE
OF THIS SOFTWARE.

### SIL Open Font License 1.1

Copyright (c) 2022 The Instrument Serif Project Authors.
Copyright (c) 2021 The Hanken Grotesk Project Authors.

This Font Software is licensed under the SIL Open Font License, Version 1.1. This license is
available at <https://openfontlicense.org>. The Font Software may be used, studied, modified
and redistributed freely as long as it is not sold by itself, the Reserved Font Names are not
used without permission, and derivative works stay under the same licence. THE FONT SOFTWARE IS
PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
