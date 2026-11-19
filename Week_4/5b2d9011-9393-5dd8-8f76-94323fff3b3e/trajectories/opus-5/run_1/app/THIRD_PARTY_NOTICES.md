# Third-party notices

Holdfast Nights ships the packages and fonts below. Everything here is under a
permissive licence; nothing GPL, LGPL, AGPL or SSPL is shipped.

Shipped packages are the Go modules the program imports (`go list -deps .`) plus
the frontend production dependency tree (`npm ls --omit=dev --all`), plus the two
fonts vendored under `web/public/fonts`.

## Go modules

| Module | Version | Licence |
|---|---|---|
| github.com/jackc/pgx/v5 | v5.12.0 | MIT |
| github.com/jackc/pgpassfile | v1.0.0 | MIT |
| github.com/jackc/pgservicefile | v0.0.0-20240606120523-5a60cdf6a761 | MIT |
| github.com/jackc/puddle/v2 | v2.2.3 | MIT |
| github.com/redis/go-redis/v9 | v9.23.0 | BSD-2-Clause |
| github.com/cespare/xxhash/v2 | v2.3.0 | MIT |
| go.uber.org/atomic | v1.12.0 | MIT |
| golang.org/x/sync | v0.22.0 | BSD-3-Clause |
| golang.org/x/sys | v0.48.0 | BSD-3-Clause |
| golang.org/x/text | v0.41.0 | BSD-3-Clause |

The Go standard library, including the `time/tzdata` IANA database the server
carries, is under BSD-3-Clause.

## Frontend packages

| Package | Version | Licence |
|---|---|---|
| three | 0.169.0 | MIT |

`esbuild` and `typescript` are build-only dev dependencies and are not shipped.

## Fonts

| Font | Licence |
|---|---|
| Pixelify Sans | SIL Open Font License 1.1 (OFL-1.1) |
| Chakra Petch | SIL Open Font License 1.1 (OFL-1.1) |

Both are vendored as latin-subset `.woff2` files under `web/public/fonts`.

## Licence texts

### MIT

```
Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in the
Software without restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the
Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

Copyright holders of the MIT-licensed packages above: Jack Christensen (pgx,
pgpassfile, pgservicefile, puddle), Caleb Spare (xxhash), Uber Technologies, Inc.
(atomic), and the three.js authors (three).

### BSD-2-Clause

```
Copyright (c) 2013 The github.com/redis/go-redis Authors. All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

   * Redistributions of source code must retain the above copyright notice, this
     list of conditions and the following disclaimer.
   * Redistributions in binary form must reproduce the above copyright notice,
     this list of conditions and the following disclaimer in the documentation
     and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS
OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN
IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### BSD-3-Clause

```
Copyright 2009 The Go Authors.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

   * Redistributions of source code must retain the above copyright notice, this
     list of conditions and the following disclaimer.
   * Redistributions in binary form must reproduce the above copyright notice,
     this list of conditions and the following disclaimer in the documentation
     and/or other materials provided with the distribution.
   * Neither the name of Google LLC nor the names of its contributors may be used
     to endorse or promote products derived from this software without specific
     prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS
OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN
IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### SIL Open Font License 1.1

The full text is published at <https://openfontlicense.org>. In summary, the
fonts may be used, studied, modified and redistributed freely so long as they are
not sold by themselves, any modified version carries a different name, and this
notice is kept with them.

Pixelify Sans is copyright the Pixelify Sans project authors. Chakra Petch is
copyright Cadson Demak. Both are reserved-font-name releases under OFL-1.1.
