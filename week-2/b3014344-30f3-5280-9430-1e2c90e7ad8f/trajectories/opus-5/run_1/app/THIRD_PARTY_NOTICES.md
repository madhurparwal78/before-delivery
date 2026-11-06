# Third party notices

Pampero Ledger ships the packages and fonts below. Everything here is under a permissive
licence (MIT, ISC or OFL-1.1); nothing under GPL, LGPL, AGPL or SSPL is shipped.

## Shipped packages

The production dependency tree, as reported by `npm ls --omit=dev --all --json`.

| Package | Version | Licence |
| --- | --- | --- |
| lucide-static | 1.66.0 | ISC |
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
| three | 0.187.0 | MIT |
| xtend | 4.0.2 | MIT |

`three` and the Lucide icon files from `lucide-static` are bundled into the pages the browser
loads; the rest run on the server only.

## Bundled fonts

The woff2 files served from `/fonts` are copied at build time from the `@fontsource` packages
of the same names.

| Font | Licence | Copyright |
| --- | --- | --- |
| Bricolage Grotesque | OFL-1.1 | Copyright 2022 The Bricolage Project Authors |
| IBM Plex Sans | OFL-1.1 | Copyright 2017 IBM Corp. |
| IBM Plex Mono | OFL-1.1 | Copyright 2017 IBM Corp. |

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

Copyright of each font is held by its authors, named above. These fonts are licensed under the
SIL Open Font License, Version 1.1. The full text is published at
<https://openfontlicense.org>, and is reproduced in the `LICENSE` file of each `@fontsource`
package in `node_modules`.

PERMISSION & CONDITIONS: Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify, redistribute, and sell
modified and unmodified copies of the Font Software, subject to the conditions of the licence:
the Font Software may not be sold by itself; copies must retain this notice; and neither the
Font Software nor any of its derivatives may use the Reserved Font Names without permission.

THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
