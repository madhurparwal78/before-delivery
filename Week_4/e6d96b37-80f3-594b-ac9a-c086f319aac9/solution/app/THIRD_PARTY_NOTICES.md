# Third-party notices

Flan ships the packages below (the production dependency tree, `npm ls --omit=dev --all`), the bundled fonts and the Lucide icons. Every name, coin and register record in the app is invented; the fixture coin photographs are drawn by the app's own code (`src/server/fixtures/draw.ts`) and are original.

## Shipped packages

| Package | Version | Licence | Copyright |
|---|---|---|---|
| @fontsource/archivo | 5.2.8 | OFL-1.1 | Copyright (c) Google Inc. |
| @fontsource/saira | 5.2.8 | OFL-1.1 | Copyright (c) Google Inc. |
| lucide-react | 0.553.0 | ISC | Copyright (c) Eric Fennis |
| pg | 8.16.3 | MIT | Copyright (c) Brian Carlson <brian.m.carlson@gmail.com> |
| pg-cloudflare | 1.4.1 | MIT | Copyright (c) the package authors |
| pg-connection-string | 2.14.1 | MIT | Copyright (c) Blaine Bublitz <blaine@iceddev.com> (http://iceddev.com/) |
| pg-int8 | 1.0.1 | ISC | Copyright (c) the package authors |
| pg-pool | 3.14.0 | MIT | Copyright (c) Brian M. Carlson |
| pg-protocol | 1.16.1 | MIT | Copyright (c) the package authors |
| pg-types | 2.2.0 | MIT | Copyright (c) Brian M. Carlson |
| pgpass | 1.0.5 | MIT | Copyright (c) Hannes Hörl <hannes.hoerl+pgpass@snowreporter.com> |
| postgres-array | 2.0.0 | MIT | Copyright (c) Ben Drucker |
| postgres-bytea | 1.0.1 | MIT | Copyright (c) Ben Drucker |
| postgres-date | 1.0.7 | MIT | Copyright (c) Ben Drucker |
| postgres-interval | 1.2.0 | MIT | Copyright (c) Ben Drucker |
| react | 19.2.0 | MIT | Copyright (c) the package authors |
| react-dom | 19.2.0 | MIT | Copyright (c) the package authors |
| scheduler | 0.27.0 | MIT | Copyright (c) the package authors |
| split2 | 4.2.0 | ISC | Copyright (c) Matteo Collina <hello@matteocollina.com> |
| xtend | 4.0.2 | MIT | Copyright (c) Raynos <raynos2@gmail.com> |

## Bundled fonts

| Font | Files | Licence | Copyright |
|---|---|---|---|
| Saira (weights 500, 600, latin) | via @fontsource/saira 5.2.8, woff2 and woff in `dist/client/assets` | SIL OFL 1.1 | Copyright 2016 The Saira Project Authors (https://github.com/Omnibus-Type/Saira) |
| Archivo (weights 400, 700, latin) | via @fontsource/archivo 5.2.8, woff2 and woff in `dist/client/assets` | SIL OFL 1.1 | Copyright 2020 The Archivo Project Authors (https://github.com/Omnibus-Type/Archivo) |

## Icons

Lucide icons (circle-alert, menu, x, refresh-cw, image-plus, shield-check, camera) through lucide-react 0.553.0, ISC licence. Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT); all other copyright (c) for Lucide are held by Lucide Contributors 2022.

## Build tools (used by `npm run build`, not shipped)

| Package | Version | Licence | Copyright |
|---|---|---|---|
| @esbuild/darwin-arm64 | 0.25.12 | MIT | Copyright (c) the package authors |
| @rollup/rollup-darwin-arm64 | 4.67.5 | MIT | Copyright (c) Lukas Taegert-Atkinson |
| @types/estree | 1.0.10 | MIT | Copyright (c) the package authors |
| @types/node | 22.19.0 | MIT | Copyright (c) the package authors |
| @types/pg | 8.15.6 | MIT | Copyright (c) the package authors |
| @types/react | 19.2.2 | MIT | Copyright (c) the package authors |
| @types/react-dom | 19.2.2 | MIT | Copyright (c) the package authors |
| esbuild | 0.25.12 | MIT | Copyright (c) the package authors |
| fdir | 6.5.0 | MIT | Copyright (c) thecodrr <thecodrr@protonmail.com> |
| nanoid | 3.3.20 | MIT | Copyright (c) Andrey Sitnik <andrey@sitnik.ru> |
| picocolors | 1.1.1 | ISC | Copyright (c) Alexey Raspopov |
| picomatch | 4.0.7 | MIT | Copyright (c) Jon Schlinkert (https://github.com/jonschlinkert) |
| postcss | 8.5.32 | MIT | Copyright (c) Andrey Sitnik <andrey@sitnik.es> |
| rollup | 4.67.5 | MIT | Copyright (c) Rich Harris |
| source-map-js | 1.2.2 | BSD-3-Clause | Copyright (c) Valentin 7rulnik Semirulnik <v7rulnik@gmail.com> |
| tinyglobby | 0.2.17 | MIT | Copyright (c) Superchupu |
| typescript | 5.9.3 | Apache-2.0 | Copyright (c) Microsoft Corp. |
| undici-types | 6.21.0 | MIT | Copyright (c) the package authors |
| vite | 6.4.1 | MIT | Copyright (c) Evan You |

## SIL Open Font License 1.1 (Saira and Archivo)

```
Google Inc.

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```
