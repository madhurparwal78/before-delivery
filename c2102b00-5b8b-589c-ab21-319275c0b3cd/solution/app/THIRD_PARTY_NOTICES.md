# Third-party notices

Tally Split ships **one runtime npm package**, `three`, bundled into the browser script and served
from the app's own origin. The production dependency tree (`npm ls --omit=dev --all --json`) is that
one package. The server uses only Node.js built-ins (`node:http`, `node:sqlite`, `node:crypto`,
`node:net`, `fetch`).

## Shipped packages

| Package | Version | Licence | Copyright |
|---|---|---|---|
| three | 0.187.0 | MIT | Copyright © 2010-2026 three.js authors |

## Bundled fonts

| Font | Files | Version | Licence | Copyright |
|---|---|---|---|---|
| Archivo (variable, wdth and wght axes, Latin subset) | `public/fonts/archivo-latin-wdth-normal.woff2` | Fontsource `@fontsource-variable/archivo` 5.3.0 | OFL-1.1 (SIL Open Font License 1.1) | Copyright 2020 The Archivo Project Authors (https://github.com/Omnibus-Type/Archivo) |
| IBM Plex Sans (400 and 600, Latin subset) | `public/fonts/ibm-plex-sans-latin-400-normal.woff2`, `public/fonts/ibm-plex-sans-latin-600-normal.woff2` | Fontsource `@fontsource/ibm-plex-sans` 5.3.0 | OFL-1.1 (SIL Open Font License 1.1) | Copyright 2019 IBM Corp. All rights reserved. |

## Build-time dependencies (not shipped)

These run only during `npm run build` and are not part of the production tree.

| Package | Version | Licence | Copyright |
|---|---|---|---|
| typescript | 5.9.3 | Apache-2.0 | Copyright (c) Microsoft Corporation |
| esbuild | 0.25.12 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/* platform binary (one of aix-ppc64, android-arm, android-arm64, android-x64, darwin-arm64, darwin-x64, freebsd-arm64, freebsd-x64, linux-arm, linux-arm64, linux-ia32, linux-loong64, linux-mips64el, linux-ppc64, linux-riscv64, linux-s390x, linux-x64, netbsd-arm64, netbsd-x64, openbsd-arm64, openbsd-x64, openharmony-arm64, sunos-x64, win32-arm64, win32-ia32, win32-x64) | 0.25.12 | MIT | Copyright (c) 2020 Evan Wallace |
| @types/node | 22.20.5 | MIT | Copyright (c) Microsoft Corporation |
| @types/three | 0.187.0 | MIT | Copyright (c) Microsoft Corporation |
| undici-types | 6.21.0 | MIT | Copyright (c) Matteo Collina and Undici contributors |

## Original artwork

The crate's corrugated-kraft, packing-tape and stamp textures are drawn at run time on a canvas by
`src/client/crate/textures.ts`; the crate's box and units are built from primitive geometry. Licence: original.

The kraft-paper fibre texture (an inline SVG noise filter in `public/assets/app.css`) and the
empty-case drawing (inline SVG in the member home screen) were drawn for this app. Licence: original.

## SIL Open Font License, Version 1.1

Applies to Archivo and IBM Plex Sans.

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
