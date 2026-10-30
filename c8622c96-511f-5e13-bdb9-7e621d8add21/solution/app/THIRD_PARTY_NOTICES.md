# Third-party notices

Saltprint Desk ships the packages, fonts and icons listed here. Every one is under a licence on the
allowlist (MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, OFL-1.1, CC0-1.0).

## Server packages (bundled into `dist/server.js` and `dist/image-worker.js` at build time)

The build bundles these into the server, so `npm ls --omit=dev --all` reports an empty production tree;
they still ship inside the bundle and are listed here with their licences.

| Package | Version | Licence | Copyright |
|---|---|---|---|
| buffer-writer | 2.0.0 | MIT | Copyright (c) Brian M. Carlson |
| jpeg-js | 0.4.4 | BSD-3-Clause | Copyright (c) 2014, Eugene Ware |
| packet-reader | 1.0.0 | MIT | Copyright (c) Brian M. Carlson |
| pg | 8.3.3 | MIT | Copyright (c) 2010 - 2020 Brian Carlson |
| pg-connection-string | 2.14.1 | MIT | Copyright (c) 2014 Iced Development |
| pg-int8 | 1.0.1 | ISC | Copyright © 2017, Charmander <~@charmander.me> |
| pg-pool | 3.14.0 | MIT | Copyright (c) 2017 Brian M. Carlson |
| pg-protocol | 1.16.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-types | 2.2.0 | MIT | Copyright (c) Brian M. Carlson |
| pgpass | 1.0.6 | MIT | Copyright (c) Hannes Hörl <hannes.hoerl+pgpass@snowreporter.com> |
| pngjs | 7.0.0 | MIT | pngjs original work Copyright (c) 2015 Luke Page & Original Contributors |
| postgres-array | 2.0.0 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-bytea | 1.0.1 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-date | 1.0.7 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-interval | 1.2.0 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| semver | 7.6.3 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors |
| xtend | 4.0.2 | MIT | Copyright (c) 2012-2014 Raynos. |

`semver` is pinned to 7.6.3 through `overrides` in `package.json`; `pg` only uses it for the optional native binding, which the bundle leaves out.

## Bundled into the browser app at build time

| Package | Version | Licence | Copyright |
|---|---|---|---|
| lucide (Lucide icon set; icon nodes for check, lock, clock, chevrons, x, search, download, log-out, plus, trash, upload, user, bookmark, gavel, alert) | 0.468.0 | ISC | Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022. |

## Build-only tools (installed by `npm ci`, not shipped)

| Package | Version | Licence | Copyright |
|---|---|---|---|
| typescript | 5.7.2 | Apache-2.0 | Copyright (c) Microsoft Corporation |
| esbuild, @esbuild/&lt;platform&gt; (the one optional binary for the build host) | 0.24.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @types/node | 22.10.2 | MIT | Copyright (c) Microsoft Corporation |
| @types/pg | 8.11.10 | MIT | Copyright (c) Microsoft Corporation |
| @types/pngjs | 6.0.5 | MIT | Copyright (c) Microsoft Corporation |
| undici-types | 6.20.0 | MIT | Copyright (c) Matteo Collina and Undici contributors |
| pg-types (types for @types/pg) | 4.1.0 | MIT | Copyright (c) Brian M. Carlson |
| postgres-array (under @types/pg) | 3.0.4 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-bytea (under @types/pg) | 3.0.0 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-date (under @types/pg) | 2.1.0 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-interval (under @types/pg) | 3.0.0 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| obuf | 1.1.2 | MIT | Copyright Fedor Indutny, 2015 |
| pg-numeric | 1.0.2 | ISC | Copyright © 2018, Charmander <~@charmander.me> |
| postgres-range | 1.1.4 | MIT | Copyright (c) Abbas Mashayekh |

## Fonts (self-hosted woff2, latin subsets, from Fontsource)

| Family | Files | Licence | Copyright |
|---|---|---|---|
| Newsreader | `public/fonts/newsreader-latin-500-normal.woff2`, `newsreader-latin-600-normal.woff2`, `newsreader-latin-500-italic.woff2` | OFL-1.1 | Copyright 2020 The Newsreader Project Authors (https://github.com/productiontype/Newsreader) |
| IBM Plex Sans | `public/fonts/ibm-plex-sans-latin-400-normal.woff2`, `-500-normal`, `-600-normal` | OFL-1.1 | Copyright 2018 IBM Corp. All rights reserved. |
| IBM Plex Mono | `public/fonts/ibm-plex-mono-latin-400-normal.woff2`, `-500-normal` | OFL-1.1 | Copyright 2018 IBM Corp. All rights reserved. |

## Imagery

Seeded frames are halftone JPEGs drawn by `src/server/halftone.ts` when the app first serves (original work for this app). No stock or copied photographs ship with the app.

## SIL Open Font License 1.1 — Newsreader

```
Copyright 2020 The Newsreader Project Authors (http://github.com/productiontype/Newsreader)

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

## SIL Open Font License 1.1 — IBM Plex Sans and IBM Plex Mono

```
Copyright 2018 IBM Corp. All rights reserved.

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
