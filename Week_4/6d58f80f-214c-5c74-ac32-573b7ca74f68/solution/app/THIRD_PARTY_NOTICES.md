# Third-party notices

Lintel Drive ships the packages, fonts and icons below. Every one is under MIT, ISC, BSD-2-Clause, BSD-3-Clause,
Apache-2.0, 0BSD or OFL-1.1.

## Shipped packages (production dependency tree, `npm ls --omit=dev --all`)

| Package | Version | Licence | Copyright | Source |
|---|---|---|---|---|
| pg | 8.23.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson | git://github.com/brianc/node-postgres |
| pg-cloudflare | 1.4.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson | git://github.com/brianc/node-postgres |
| pg-connection-string | 2.14.1 | MIT | Copyright (c) 2014 Iced Development | git://github.com/brianc/node-postgres |
| pg-int8 | 1.0.1 | ISC | Copyright © 2017, Charmander <~@charmander.me> | https://github.com/charmander/pg-int8 |
| pg-pool | 3.14.0 | MIT | Copyright (c) 2017 Brian M. Carlson | git://github.com/brianc/node-postgres |
| pg-protocol | 1.16.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson | git://github.com/brianc/node-postgres |
| pg-types | 2.2.0 | MIT | Copyright the pg-types authors | git://github.com/brianc/node-pg-types |
| pgpass | 1.0.5 | MIT | Copyright the pgpass authors | https://github.com/hoegaarden/pgpass |
| postgres-array | 2.0.0 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) | bendrucker/postgres-array |
| postgres-bytea | 1.0.1 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) | bendrucker/postgres-bytea |
| postgres-date | 1.0.7 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) | bendrucker/postgres-date |
| postgres-interval | 1.2.0 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) | bendrucker/postgres-interval |
| split2 | 4.2.0 | ISC | Copyright (c) 2014-2018, Matteo Collina <hello@matteocollina.com> | https://github.com/mcollina/split2 |
| ws | 8.22.1 | MIT | Copyright (c) 2011 Einar Otto Stangvik <einaros@gmail.com> | https://github.com/websockets/ws |
| xtend | 4.0.2 | MIT | Copyright (c) 2012-2014 Raynos. | git://github.com/Raynos/xtend |

## Bundled into the browser build (compiled into `dist/client` by Vite)

| Package | Version | Licence | Copyright | Source |
|---|---|---|---|---|
| pdfjs-dist | 5.7.284 | Apache-2.0 | Copyright Mozilla Foundation and the PDF.js contributors | https://github.com/mozilla/pdf.js |
| react | 19.3.1 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. | https://github.com/react/react |
| react-dom | 19.3.1 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. | https://github.com/react/react |
| scheduler | 0.28.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. | https://github.com/react/react |

The build toolchain (TypeScript, Vite and their dependencies) runs only at build time and is not shipped.

## Fonts: IBM Plex

IBM Plex Sans, IBM Plex Sans Condensed and IBM Plex Mono, from version 5.3.0 of the Fontsource packages
(`@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-sans-condensed`, `@fontsource/ibm-plex-mono`), latin subsets,
self-hosted from `src/client/fonts/`. Copyright 2019 IBM Corp. Licensed under the SIL Open Font License 1.1:

```
Copyright 2019 IBM Corp. All rights reserved. IBMPlexSans-Italic[wdth,wght].ttf: Copyright 2019 IBM Corp. All rights reserved.

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

## Icons: Lucide

Line icon paths from Lucide (lucide-static 0.468.0, https://lucide.dev), inlined in `src/client/icons.tsx`.
Licensed under the ISC License:

```
ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

## Original assets

The favicon, the empty-state drawings, the grid thumbnails and the seed drawing sheets and blueprint images are drawn
in code for this app (licence: original).
