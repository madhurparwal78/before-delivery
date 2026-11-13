# Third-party notices

Kerfwell Rack ships the packages below. `shipped (runtime)` rows are the production dependency tree
(`npm ls --omit=dev --all`); React, React DOM and Scheduler are also bundled into the browser script.
`build only` rows are used by `npm run build` and are not served.

| Package | Version | Licence | Use | Copyright |
|---|---|---|---|---|
| @esbuild/darwin-arm64 | 0.25.11 | MIT | build only | Copyright the @esbuild/darwin-arm64 authors |
| @types/node | 22.18.12 | MIT | build only | Copyright (c) Microsoft Corporation. |
| @types/pg | 8.15.5 | MIT | build only | Copyright (c) Microsoft Corporation. |
| @types/pngjs | 6.0.5 | MIT | build only | Copyright (c) Microsoft Corporation. |
| @types/react | 19.2.2 | MIT | build only | Copyright (c) Microsoft Corporation. |
| @types/react-dom | 19.2.2 | MIT | build only | Copyright (c) Microsoft Corporation. |
| csstype | 3.2.3 | MIT | build only | Copyright (c) 2017-2018 Fredrik Nicol |
| esbuild | 0.25.11 | MIT | build only | Copyright (c) 2020 Evan Wallace |
| jpeg-js | 0.4.4 | BSD-3-Clause | shipped (runtime) | Copyright (c) 2014, Eugene Ware |
| pg | 8.16.3 | MIT | shipped (runtime) | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-cloudflare | 1.4.1 | MIT | shipped (runtime) | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-connection-string | 2.14.1 | MIT | shipped (runtime) | Copyright (c) 2014 Iced Development |
| pg-int8 | 1.0.1 | ISC | shipped (runtime) | Copyright © 2017, Charmander <~@charmander.me> |
| pg-pool | 3.14.0 | MIT | shipped (runtime) | Copyright (c) 2017 Brian M. Carlson |
| pg-protocol | 1.16.1 | MIT | shipped (runtime) | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-types | 2.2.0 | MIT | shipped (runtime) | Copyright the pg-types authors |
| pgpass | 1.0.5 | MIT | shipped (runtime) | Copyright the pgpass authors |
| pngjs | 7.0.0 | MIT | shipped (runtime) | pngjs original work Copyright (c) 2015 Luke Page & Original Contributors |
| postgres-array | 2.0.0 | MIT | shipped (runtime) | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-bytea | 1.0.1 | MIT | shipped (runtime) | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-date | 1.0.7 | MIT | shipped (runtime) | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-interval | 1.2.0 | MIT | shipped (runtime) | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| react | 19.2.0 | MIT | shipped (runtime) | Copyright (c) Meta Platforms, Inc. and affiliates. |
| react-dom | 19.2.0 | MIT | shipped (runtime) | Copyright (c) Meta Platforms, Inc. and affiliates. |
| scheduler | 0.27.0 | MIT | shipped (runtime) | Copyright (c) Meta Platforms, Inc. and affiliates. |
| split2 | 4.2.0 | ISC | shipped (runtime) | Copyright (c) 2014-2018, Matteo Collina <hello@matteocollina.com> |
| typescript | 5.9.3 | Apache-2.0 | build only | Copyright the typescript authors |
| undici-types | 6.21.0 | MIT | build only | Copyright (c) Matteo Collina and Undici contributors |
| xtend | 4.0.2 | MIT | shipped (runtime) | Copyright (c) 2012-2014 Raynos. |

## Fonts (self-hosted, `public/fonts/`)

| Font | Files | Version | Licence | Copyright |
|---|---|---|---|---|
| Barlow Condensed (Fontsource `@fontsource/barlow-condensed` 5.3.0) | barlow-condensed-latin-600-normal.woff2 | 5.3.0 | OFL-1.1 | Copyright 2017 The Barlow Project Authors (https://github.com/jpt/barlow) |
| IBM Plex Sans (Fontsource `@fontsource/ibm-plex-sans` 5.3.0) | ibm-plex-sans-latin-400-normal.woff2, ibm-plex-sans-latin-600-normal.woff2 | 5.3.0 | OFL-1.1 | Copyright 2017 IBM Corp. |
| IBM Plex Mono (Fontsource `@fontsource/ibm-plex-mono` 5.3.0) | ibm-plex-mono-latin-400-normal.woff2, ibm-plex-mono-latin-500-normal.woff2 | 5.3.0 | OFL-1.1 | Copyright 2017 IBM Corp. |

## Icons

The line icons in `src/client/icons.tsx` (log-out, undo, redo, upload, download) follow Lucide's shapes.
Lucide, ISC licence, Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT); all other copyright (c) for Lucide are held by Lucide Contributors 2022.

## Other assets

`public/favicon.svg` was drawn for this app (licence: original).

## SIL Open Font License 1.1 (Barlow Condensed, IBM Plex Sans, IBM Plex Mono)

```
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
