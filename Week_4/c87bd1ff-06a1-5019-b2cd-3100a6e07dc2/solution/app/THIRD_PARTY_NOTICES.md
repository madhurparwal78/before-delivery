# Third-party notices

Gavelhouse ships the packages and fonts below. Each is used under the licence named here.

## Go modules (linked into the server)

| Package | Version | Licence | Copyright |
|---|---|---|---|
| github.com/lib/pq | v1.12.3 | MIT | Copyright (c) 2011-2013, 'pq' Contributors. Portions Copyright (c) 2011 Blake Mizerany |
| github.com/gorilla/websocket | v1.5.3 | BSD-2-Clause | Copyright (c) 2013 The Gorilla WebSocket Authors. All rights reserved. |

## Front-end production dependencies (bundled into the browser script)

| Package | Version | Licence | Copyright |
|---|---|---|---|
| preact | 11.1.1 | MIT | Copyright (c) 2015-present Jason Miller |

The front end is built with esbuild (MIT) and TypeScript (Apache-2.0); neither is part of what ships.

## Fonts (served from the app itself)

| Family | Files | Licence | Copyright |
|---|---|---|---|
| Anton | `web/public/fonts/anton-latin-400.woff2` | OFL-1.1 | Copyright 2020 The Anton Project Authors (https://github.com/googlefonts/AntonFont.git) |
| Work Sans | `web/public/fonts/work-sans-latin-wght.woff2` | OFL-1.1 | Copyright 2019 The Work Sans Project Authors (https://github.com/weiweihuanghuang/Work-Sans.git) |

The full SIL Open Font License 1.1 texts are in `licences/OFL-Anton.txt` and `licences/OFL-Work-Sans.txt`.

## Images

The six lot portraits are drawn in code (inline SVG in `web/src/portraits.tsx`) for this app; licence `original`.

## Licence texts

### MIT (lib/pq, preact)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

### BSD-2-Clause (gorilla/websocket)

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met: 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer. 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution. THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

### SIL Open Font License 1.1 (Anton, Work Sans)

See `licences/OFL-Anton.txt` and `licences/OFL-Work-Sans.txt` for the complete text.
