# Third-party notices

Saltreach ships two built files: the browser bundle (`dist/public/app.js`, `app.css` and the font
files) and the server bundle (`dist/server/main.mjs`). Both are compiled by esbuild from the source and
the packages below, so every package that reaches a user is listed here with its licence. The npm
production tree (`npm ls --omit=dev`) is empty: every package is installed for the build and bundled.

## Packages compiled into the browser bundle

| Package | Version | Licence | Copyright |
|---|---|---|---|
| preact | 10.29.8 | MIT | Copyright (c) 2015-present Jason Miller |
| three | 0.186.1 | MIT | Copyright © 2010-2026 three.js authors |
| lucide | 1.64.0 | ISC | Copyright (c) 2026 Lucide Icons and Contributors |

The icon set is **Lucide** (`lucide` above, ISC licence): the outline SVG icon nodes for house, swords,
scroll-text, users, trophy, gift, user, log-out, wrench, layers, hammer, rotate-cw, check, x, play,
pause and the chevrons are inlined as SVG.

## Packages compiled into the server bundle

| Package | Version | Licence | Copyright |
|---|---|---|---|
| pg | 8.23.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-cloudflare | 1.4.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-connection-string | 2.14.1 | MIT | Copyright (c) 2014 Iced Development |
| pg-int8 | 1.0.1 | ISC | Copyright © 2017, Charmander <~@charmander.me> |
| pg-pool | 3.14.0 | MIT | Copyright (c) 2017 Brian M. Carlson |
| pg-protocol | 1.16.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-types | 2.2.0 | MIT | Copyright (c) Brian M. Carlson |
| pgpass | 1.0.5 | MIT | Copyright (c) Hannes Hörl <hannes.hoerl+pgpass@snowreporter.com> |
| postgres-array | 2.0.0 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-bytea | 1.0.1 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-date | 1.0.7 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-interval | 1.2.0 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| split2 | 4.2.0 | ISC | Copyright (c) 2014-2018, Matteo Collina <hello@matteocollina.com> |
| xtend | 4.0.2 | MIT | Copyright (c) 2012-2014 Raynos. |
| hash-wasm | 4.12.0 | MIT | Copyright (c) 2020 Dani Biró |

## Build tools and type definitions (not shipped)

| Package | Version | Licence | Copyright |
|---|---|---|---|
| @dimforge/rapier3d-compat | 0.12.0 | Apache-2.0 | Copyright 2020 Dimforge EURL |
| @esbuild/darwin-arm64 | 0.25.12 | MIT | Copyright (c) the package authors |
| @tweenjs/tween.js | 23.1.3 | MIT | Copyright (c) 2010-2012 Tween.js authors. |
| @types/node | 22.20.5 | MIT | Copyright (c) Microsoft Corporation. |
| @types/pg | 8.23.1 | MIT | Copyright (c) Microsoft Corporation. |
| @types/stats.js | 0.17.4 | MIT | Copyright (c) Microsoft Corporation. |
| @types/three | 0.186.0 | MIT | Copyright (c) Microsoft Corporation. |
| @types/webxr | 0.5.24 | MIT | Copyright (c) Microsoft Corporation. |
| esbuild | 0.25.12 | MIT | Copyright (c) 2020 Evan Wallace |
| fflate | 0.8.3 | MIT | Copyright (c) 2026 Arjun Barrett |
| meshoptimizer | 1.1.1 | MIT | Copyright (c) 2016-2026 Arseny Kapoulkine |
| typescript | 5.9.3 | Apache-2.0 | Copyright (c) Microsoft Corp. |
| undici-types | 6.21.0 | MIT | Copyright (c) Matteo Collina and Undici contributors |

## Fonts

Each font is self-hosted from `src/client/fonts/` (taken from the Fontsource 5.3.0 packages) and
served by the app. All three families are licensed under the SIL Open Font License, Version 1.1.

| Font | File | Licence | Copyright |
|---|---|---|---|
| Fraunces 600 (latin subset, woff2) | `src/client/fonts/fraunces-latin-600-normal.woff2` | OFL-1.1 | Copyright 2020 The Fraunces Project Authors (github.com/undercasetype/Fraunces) |
| Atkinson Hyperlegible 400 (latin subset, woff2) | `src/client/fonts/atkinson-hyperlegible-latin-400-normal.woff2` | OFL-1.1 | Copyright 2020 Braille Institute of America, Inc. |
| Atkinson Hyperlegible 700 (latin subset, woff2) | `src/client/fonts/atkinson-hyperlegible-latin-700-normal.woff2` | OFL-1.1 | Copyright 2020 Braille Institute of America, Inc. |
| JetBrains Mono 500 (latin subset, woff2) | `src/client/fonts/jetbrains-mono-latin-500-normal.woff2` | OFL-1.1 | Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono) |

### SIL Open Font License, Version 1.1

Copyright 2020 The Fraunces Project Authors (github.com/undercasetype/Fraunces)
Copyright 2020 Braille Institute of America, Inc.
Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at: http://scripts.sil.org/OFL

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

## Original artwork

The island, its buildings, the salt-crust texture, the tide, the product mark and the empty-state
tide line are drawn by the app's own code (three.js geometry, Canvas 2D and inline SVG) and are
original to Saltreach. No image, audio, video or model file is shipped.
