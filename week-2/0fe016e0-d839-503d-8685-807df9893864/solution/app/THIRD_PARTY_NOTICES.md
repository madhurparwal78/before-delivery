# Third-party notices

Shipped packages are the modules the production binary links, as listed by `go version -m server`.
Each ships under `third_party/<module path>` (a `replace` line in `go.mod`) with its own licence file. The full licence texts follow the list.

| Module | Version | Licence | Copyright |
|---|---|---|---|
| github.com/jackc/pgx/v5 | v5.7.2 | MIT | Copyright (c) 2013-2021 Jack Christensen |
| github.com/jackc/pgpassfile | v1.0.0 | MIT | Copyright (c) 2019 Jack Christensen |
| github.com/jackc/pgservicefile | v0.0.0-20240606120523-5a60cdf6a761 | MIT | Copyright (c) 2020 Jack Christensen |
| github.com/jackc/puddle/v2 | v2.2.2 | MIT | Copyright (c) 2018 Jack Christensen |
| golang.org/x/crypto | v0.31.0 | BSD-3-Clause | Copyright 2009 The Go Authors |
| golang.org/x/sync | v0.10.0 | BSD-3-Clause | Copyright 2009 The Go Authors |
| golang.org/x/text | v0.21.0 | BSD-3-Clause | Copyright 2009 The Go Authors |
| Go standard library (go1.23) | 1.23 | BSD-3-Clause | Copyright 2009 The Go Authors |

The two inline SVG glyphs (the ladder mark in the header and the tick beside `Attested`) were drawn
for this app (`original`). The app ships no font, image, audio or video file.

## MIT licence (github.com/jackc/pgx/v5, github.com/jackc/pgpassfile, github.com/jackc/pgservicefile, github.com/jackc/puddle/v2)

```
Copyright (c) 2013-2021 Jack Christensen

MIT License

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

The same MIT terms apply to pgpassfile (Copyright (c) 2019 Jack Christensen), pgservicefile
(Copyright (c) 2020 Jack Christensen) and puddle (Copyright (c) 2018 Jack Christensen).

## BSD-3-Clause licence (golang.org/x/crypto, golang.org/x/sync, golang.org/x/text)

```
Copyright 2009 The Go Authors.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

   * Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.
   * Redistributions in binary form must reproduce the above
copyright notice, this list of conditions and the following disclaimer
in the documentation and/or other materials provided with the
distribution.
   * Neither the name of Google LLC nor the names of its
contributors may be used to endorse or promote products derived from
this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
