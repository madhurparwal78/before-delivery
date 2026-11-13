# Third-party notices — Halfsheet Works Stationhouse

## Shipped packages (production dependency tree)

`npm ls --omit=dev --all` lists one package. It is bundled into the browser build; the server runs on
Node.js built-ins only (its Postgres, SMTP, Kill Bill and S3 clients are written for this app).

| Package | Version | Licence | Copyright |
|---|---|---|---|
| preact | 10.29.8 | MIT | Copyright (c) 2015-present Jason Miller |

## Build-time packages (devDependencies, not shipped)

| Package | Version | Licence | Copyright |
|---|---|---|---|
| @types/estree | 1.0.9 | MIT | Copyright (c) the @types/estree authors |
| @types/node | 22.20.5 | MIT | Copyright (c) the @types/node authors |
| esbuild | 0.28.2 | MIT | Copyright (c) the esbuild authors |
| fdir | 6.5.0 | MIT | Copyright (c) thecodrr <thecodrr@protonmail.com> |
| nanoid | 3.3.20 | MIT | Copyright (c) Andrey Sitnik <andrey@sitnik.ru> |
| picocolors | 1.1.1 | ISC | Copyright (c) Alexey Raspopov |
| picomatch | 4.0.7 | MIT | Copyright (c) Jon Schlinkert (https://github.com/jonschlinkert) |
| postcss | 8.5.32 | MIT | Copyright (c) Andrey Sitnik <andrey@sitnik.es> |
| rollup | 4.65.1 | MIT | Copyright (c) Rich Harris |
| source-map-js | 1.2.2 | BSD-3-Clause | Copyright (c) Valentin 7rulnik Semirulnik <v7rulnik@gmail.com> |
| tinyglobby | 0.2.17 | MIT | Copyright (c) Superchupu |
| typescript | 5.9.3 | Apache-2.0 | Copyright (c) Microsoft Corp. |
| undici-types | 6.21.0 | MIT | Copyright (c) the undici-types authors |
| vite | 7.3.7 | MIT | Copyright (c) Evan You |
| @esbuild/* platform binaries (one per OS/CPU, e.g. @esbuild/linux-x64) | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @rollup/rollup-* platform binaries (one per OS/CPU, e.g. @rollup/rollup-linux-x64-gnu) | 4.65.1 | MIT | Copyright (c) 2015 Lukas Taegert-Atkinson and Rollup contributors |

## Fonts (bundled, self-hosted woff2, latin subset from Fontsource)

| Font | Files | Licence | Copyright |
|---|---|---|---|
| Archivo Narrow | src/client/fonts/archivo-narrow-latin-600-normal.woff2 | SIL OFL 1.1 (OFL-1.1) | Copyright 2019 The Archivo Narrow Project Authors (https://github.com/Omnibus-Type/ArchivoNarrow) |
| IBM Plex Sans | src/client/fonts/ibm-plex-sans-latin-400/500/600-normal.woff2 | SIL OFL 1.1 (OFL-1.1) | Copyright © 2017 IBM Corp. with Reserved Font Name "Plex" |
| IBM Plex Mono | src/client/fonts/ibm-plex-mono-latin-400/500-normal.woff2 | SIL OFL 1.1 (OFL-1.1) | Copyright © 2017 IBM Corp. with Reserved Font Name "Plex" |

## Icons

| Icon set | Use | Licence | Copyright |
|---|---|---|---|
| Lucide (path data of layout-grid, clock-3, file-check-2, users, chart-column, log-out, chevron-left, chevron-right, calendar-check, grip-vertical, snowflake, upload, circle-alert, receipt, x; inlined in src/client/ui.tsx) | navigation and action icons | ISC | Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022. |

## Original assets

| File | Licence | Note |
|---|---|---|
| public/favicon.svg | original | drawn for this app |

---

### ISC licence (Lucide)

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is
hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE
INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE,
DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

### SIL Open Font License 1.1 (Archivo Narrow, IBM Plex Sans, IBM Plex Mono)

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

