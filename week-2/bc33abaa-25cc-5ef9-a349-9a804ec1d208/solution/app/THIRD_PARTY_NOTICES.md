# Third-party notices

Orrery Studio ships the packages, fonts and assets below. The shipped package tree is what
`npm ls --omit=dev --all` reports; packages marked "bundled" are compiled into `dist/` by the build;
build tools never reach the browser or the server bundle.

## Packages

| Package | Version | Licence | How it ships | Copyright |
|---|---|---|---|---|
| @dimforge/rapier3d-compat | 0.12.0 | Apache-2.0 | build tool only | Copyright 2020 Dimforge EURL |
| @esbuild/darwin-arm64 | 0.28.2 | MIT | build tool only | See the package's licence file |
| @tweenjs/tween.js | 23.1.3 | MIT | build tool only | Copyright (c) 2010-2012 Tween.js authors. |
| @types/node | 22.20.5 | MIT | build tool only | Copyright (c) Microsoft Corporation. |
| @types/pg | 8.23.1 | MIT | build tool only | Copyright (c) Microsoft Corporation. |
| @types/stats.js | 0.17.4 | MIT | build tool only | Copyright (c) Microsoft Corporation. |
| @types/three | 0.186.0 | MIT | build tool only | Copyright (c) Microsoft Corporation. |
| @types/webxr | 0.5.24 | MIT | build tool only | Copyright (c) Microsoft Corporation. |
| esbuild | 0.28.2 | MIT | build tool only | Copyright (c) 2020 Evan Wallace |
| fflate | 0.8.3 | MIT | build tool only | Copyright (c) 2026 Arjun Barrett |
| meshoptimizer | 1.1.1 | MIT | build tool only | Copyright (c) 2016-2026 Arseny Kapoulkine |
| pg | 8.23.1 | MIT | bundled into dist/ at build time | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-cloudflare | 1.4.1 | MIT | bundled into dist/ at build time | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-connection-string | 2.14.1 | MIT | bundled into dist/ at build time | Copyright (c) 2014 Iced Development |
| pg-int8 | 1.0.1 | ISC | bundled into dist/ at build time | Copyright © 2017, Charmander <~@charmander.me> |
| pg-pool | 3.14.0 | MIT | bundled into dist/ at build time | Copyright (c) 2017 Brian M. Carlson |
| pg-protocol | 1.16.1 | MIT | bundled into dist/ at build time | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-types | 2.2.0 | MIT | bundled into dist/ at build time | See the package's licence file |
| pgpass | 1.0.5 | MIT | bundled into dist/ at build time | See the package's licence file |
| postgres-array | 2.0.0 | MIT | bundled into dist/ at build time | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-bytea | 1.0.1 | MIT | bundled into dist/ at build time | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-date | 1.0.7 | MIT | bundled into dist/ at build time | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-interval | 1.2.0 | MIT | bundled into dist/ at build time | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| preact | 10.29.8 | MIT | bundled into dist/ at build time | Copyright (c) 2015-present Jason Miller |
| split2 | 4.2.0 | ISC | bundled into dist/ at build time | Copyright (c) 2014-2018, Matteo Collina <hello@matteocollina.com> |
| three | 0.186.1 | MIT | shipped (runtime dependency, served to the browser) | Copyright © 2010-2026 three.js authors |
| typescript | 5.9.3 | Apache-2.0 | build tool only | See the package's licence file |
| undici-types | 6.21.0 | MIT | build tool only | Copyright (c) Matteo Collina and Undici contributors |
| xtend | 4.0.2 | MIT | bundled into dist/ at build time | Copyright (c) 2012-2014 Raynos. |

## Fonts

All three families are self-hosted woff2 files under `public/fonts/`, licensed under the SIL Open Font License 1.1.

### Space Grotesk

- Version: 5.3.0 (Fontsource @fontsource/space-grotesk)
- Licence: OFL-1.1
- Copyright 2020 The Space Grotesk Project Authors (https://github.com/floriankarsten/space-grotesk)
- Files: public/fonts/space-grotesk-latin-500-normal.woff2, public/fonts/space-grotesk-latin-700-normal.woff2

### IBM Plex Sans

- Version: 5.3.0 (Fontsource @fontsource/ibm-plex-sans)
- Licence: OFL-1.1
- Copyright 2019 IBM Corp. All rights reserved.
- Files: public/fonts/ibm-plex-sans-latin-400-normal.woff2, public/fonts/ibm-plex-sans-latin-500-normal.woff2, public/fonts/ibm-plex-sans-latin-600-normal.woff2

### IBM Plex Mono

- Version: 5.3.0 (Fontsource @fontsource/ibm-plex-mono)
- Licence: OFL-1.1
- Copyright 2017 IBM Corp. All rights reserved.
- Files: public/fonts/ibm-plex-mono-latin-400-normal.woff2, public/fonts/ibm-plex-mono-latin-500-normal.woff2

## Media

Every other picture in the app (icons, drafted diagrams, empty-state drawings, the embed placeholder) is drawn
in code for this app (`original`). Scene thumbnails are rendered by the app from each scene's own graph.

## SIL Open Font License 1.1

```
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
