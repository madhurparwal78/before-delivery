# Third-party notices

Lumenfold Dispatch ships the packages and fonts below. Everything else in this app (server, browser
code, icons drawn as inline SVG, and the placeholder media the server renders) is original work.

## Shipped packages (production dependency tree, `npm ls --omit=dev --all`)

| Package | Version | Licence | Copyright |
|---|---|---|---|
| pg | 8.23.1 | MIT | Copyright (c) 2010-2024 Brian Carlson (brian.m.carlson@gmail.com) |
| pg-cloudflare | 1.4.1 | MIT | Copyright (c) 2010-2024 Brian Carlson and the node-postgres contributors |
| pg-connection-string | 2.14.1 | MIT | Copyright (c) 2014 Iced Development (Blaine Bublitz) |
| pg-int8 | 1.0.1 | ISC | Copyright (c) 2017 Charmander |
| pg-pool | 3.14.0 | MIT | Copyright (c) 2017 Brian M. Carlson |
| pg-protocol | 1.16.1 | MIT | Copyright (c) 2010-2024 Brian Carlson and the node-postgres contributors |
| pg-types | 2.2.0 | MIT | Copyright (c) 2014 Brian M. Carlson |
| pgpass | 1.0.5 | MIT | Copyright (c) 2013-2016 Hannes Hörl |
| postgres-array | 2.0.0 | MIT | Copyright (c) Ben Drucker (bendrucker.me) |
| postgres-bytea | 1.0.1 | MIT | Copyright (c) Ben Drucker (bendrucker.me) |
| postgres-date | 1.0.7 | MIT | Copyright (c) Ben Drucker (bendrucker.me) |
| postgres-interval | 1.2.0 | MIT | Copyright (c) Ben Drucker (bendrucker.me) |
| preact | 10.29.8 | MIT | Copyright (c) 2015-present Jason Miller |
| split2 | 4.2.0 | ISC | Copyright (c) 2014-2021 Matteo Collina and contributors |
| xtend | 4.0.2 | MIT | Copyright (c) 2012-2014 Raynos |

The MIT licence: Permission is hereby granted, free of charge, to any person obtaining a copy of this
software and associated documentation files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished
to do so, subject to the following conditions: The above copyright notice and this permission notice
shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS
IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

The ISC licence: Permission to use, copy, modify, and/or distribute this software for any purpose with
or without fee is hereby granted, provided that the above copyright notice and this permission notice
appear in all copies. THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS.

## Build tools (not shipped; used by `npm run build`)

| Package | Version | Licence | Copyright |
|---|---|---|---|
| esbuild (and its platform package @esbuild/*) | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| typescript | 5.9.3 | Apache-2.0 | Copyright (c) Microsoft Corporation |
| @types/node | 22.20.5 | MIT | Copyright (c) Microsoft Corporation |
| @types/pg | 8.23.1 | MIT | Copyright (c) Microsoft Corporation |
| undici-types | 6.21.0 | MIT | Copyright (c) Matteo Collina and Undici contributors |

## Bundled fonts (self-hosted woff2 from Fontsource, latin subset)

| Font | Files | Licence | Copyright |
|---|---|---|---|
| Bricolage Grotesque (600, 700) | `public/fonts/bricolage-grotesque-latin-*.woff2` | OFL-1.1 | Copyright 2022 The Bricolage Grotesque Project Authors (https://github.com/ateliertriay/bricolage) |
| IBM Plex Sans (400, 500, 600) | `public/fonts/ibm-plex-sans-latin-*.woff2` | OFL-1.1 | Copyright © 2017 IBM Corp. with Reserved Font Name "Plex" |
| IBM Plex Mono (400, 500) | `public/fonts/ibm-plex-mono-latin-*.woff2` | OFL-1.1 | Copyright © 2017 IBM Corp. with Reserved Font Name "Plex" |

### SIL Open Font License, Version 1.1

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at: https://openfontlicense.org

-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide development of collaborative font
projects, to support the font creation efforts of academic and linguistic communities, and to provide a
free and open framework in which fonts may be shared and improved in partnership with others.

The OFL allows the licensed fonts to be used, studied, modified and redistributed freely as long as they
are not sold by themselves. The fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved names are not used by derivative
works. The fonts and derivatives, however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply to any document created using the
fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright Holder(s) under this license and
clearly marked as such. This may include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the copyright statement(s).

"Original Version" refers to the collection of Font Software components as distributed by the Copyright
Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting, or substituting -- in part or in
whole -- any of the components of the Original Version, by changing formats or by porting the Font
Software to a new environment.

"Author" refers to any designer, engineer, programmer, technical writer or other person who contributed
to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining a copy of the Font Software, to
use, study, copy, merge, embed, modify, redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components, in Original or Modified Versions, may
be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled, redistributed and/or sold with any
software, provided that each copy contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or in the appropriate machine-readable
metadata fields within text or binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font Name(s) unless explicit written
permission is granted by the corresponding Copyright Holder. This restriction only applies to the
primary font name as presented to the users.

4) The name(s) of the Copyright Holder(s) and the Author(s) of the Font Software shall not be used to
promote, endorse or advertise any Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written permission.

5) The Font Software, modified or unmodified, in part or in whole, must be distributed entirely under
this license, and must not be distributed under any other license. The requirement for fonts to remain
under this license does not apply to any document created using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF THE USE OR INABILITY TO
USE THE FONT SOFTWARE OR FROM OTHER DEALINGS IN THE FONT SOFTWARE.

## Media

No third-party images, audio or video ship with the app. Icons are original inline SVG; generated job
outputs are placeholder media the server renders at run time.
