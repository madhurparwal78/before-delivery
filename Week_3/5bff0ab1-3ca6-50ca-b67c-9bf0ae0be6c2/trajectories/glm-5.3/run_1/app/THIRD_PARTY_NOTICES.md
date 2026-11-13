# Third-Party Notices

This file lists every shipped package and bundled font with its licence.
Shipped packages are the production dependency tree from
`npm ls --omit=dev --all --json`.

## Packages

| Package | Version | Licence |
|---|---|---|
| pg | 8.23.1 | MIT |
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
| pgpass | 1.5.0 | MIT |
| split2 | 4.2.0 | ISC |
| redis | 6.3.1 | MIT |
| @redis/bloom | 6.3.1 | MIT |
| @redis/client | 6.3.1 | MIT |
| @redis/json | 6.3.1 | MIT |
| @redis/search | 6.3.1 | MIT |
| @redis/time-series | 6.3.1 | MIT |
| three | 0.187.0 | MIT |

## Fonts

| Font | File | Licence |
|---|---|---|
| Gloock | `public/fonts/gloock-400.woff2` | SIL Open Font License 1.1 |
| Rethink Sans (Regular) | `public/fonts/rethinksans-400.woff2` | SIL Open Font License 1.1 |
| Rethink Sans (Medium) | `public/fonts/rethinksans-500.woff2` | SIL Open Font License 1.1 |

The fonts are bundled with the app and are never fetched from Google or any other
host at run time.

## Licence texts

### MIT (pg and its dependencies, redis and its packages, three)

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions: The above copyright notice and this
permission notice shall be included in all copies or substantial portions of
the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

### ISC (pg-int8, split2)

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies. THE SOFTWARE IS PROVIDED "AS
IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE
INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT
SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL
DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING
OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

### SIL Open Font License 1.1 (Gloock, Rethink Sans)

The fonts are licensed under the SIL Open Font License, Version 1.1. The full
licence text is available at https://openfontlicense.org/open-font-license-official-text/.
The fonts may be used, studied, modified, redistributed and sold as long as the
reserved names are not used by derivative editions, and the licence is bundled
with any redistribution.
