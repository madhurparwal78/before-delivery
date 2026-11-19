# Third-party notices

This file lists the third-party software, fonts and icons that ship with this app (or are used to build it), together with their licences and copyright notices.

## Production dependencies

Every package in the production dependency tree (`npm ls --omit=dev --all`), 18 packages in total. Copyright lines are taken from each package's licence file in `node_modules`.

| Package | Version | Licence (SPDX) | Copyright |
| --- | --- | --- | --- |
| amqplib | 2.3.1 | MIT | amqplib copyright (c) 2013, 2014 |
| pg | 8.23.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-cloudflare | 1.4.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-connection-string | 2.14.1 | MIT | Copyright (c) 2014 Iced Development |
| pg-int8 | 1.0.1 | ISC | Copyright © 2017, Charmander <~@charmander.me> |
| pg-pool | 3.14.0 | MIT | Copyright (c) 2017 Brian M. Carlson |
| pg-protocol | 1.16.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-types | 2.2.0 | MIT | No copyright line in the package's licence file (no licence file found); author: Brian M. Carlson |
| pgpass | 1.0.5 | MIT | No copyright line in the package's licence file (no licence file found); author: Hannes Hörl <hannes.hoerl+pgpass@snowreporter.com> |
| postgres-array | 2.0.0 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-bytea | 1.0.1 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-date | 1.0.7 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-interval | 1.2.0 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| react | 19.3.1 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| react-dom | 19.3.1 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| scheduler | 0.28.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| split2 | 4.2.0 | ISC | Copyright (c) 2014-2018, Matteo Collina <hello@matteocollina.com> |
| xtend | 4.0.2 | MIT | Copyright (c) 2012-2014 Raynos. |

## Build-time tools (not shipped)

These are used only to compile and bundle the app. None of their code is included in the production server or the browser bundle, apart from the compiled output they produce.

| Package | Version | Licence (SPDX) | Copyright |
| --- | --- | --- | --- |
| typescript | 5.9.3 | Apache-2.0 | No copyright line in the package's licence file; author: Microsoft Corp. |
| vite | 8.3.7 | MIT | Copyright (c) 2019-present, VoidZero Inc. and Vite contributors |
| @vitejs/plugin-react | 6.3.0 | MIT | Copyright (c) 2019-present, Yuxi (Evan) You and Vite contributors |
| @types/node | 22.20.5 | MIT | Copyright (c) Microsoft Corporation. |
| @types/pg | 8.23.1 | MIT | Copyright (c) Microsoft Corporation. |
| @types/react | 19.3.0 | MIT | Copyright (c) Microsoft Corporation. |
| @types/react-dom | 19.3.0 | MIT | Copyright (c) Microsoft Corporation. |

## Fonts

All four typefaces are licensed under the SIL Open Font License 1.1 (OFL-1.1). The shipped files are the latin variable subsets from the `@fontsource-variable` npm packages, version 5.3.0. The full licence file for each font ships next to it in `public/fonts/`.

| Font | Licence | Copyright | Shipped file | Source |
| --- | --- | --- | --- | --- |
| Archivo | SIL Open Font License 1.1 (OFL-1.1) | Copyright 2020 The Archivo Project Authors (https://github.com/Omnibus-Type/Archivo) | `public/fonts/archivo-latin-wdth.woff2` | npm tarball https://registry.npmjs.org/@fontsource-variable/archivo/-/archivo-5.3.0.tgz (`files/archivo-latin-wdth-normal.woff2`) |
| Unbounded | SIL Open Font License 1.1 (OFL-1.1) | Copyright 2022 The Unbounded Project Authors (https://github.com/googlefonts/unbounded) | `public/fonts/unbounded-latin-wght.woff2` | npm tarball https://registry.npmjs.org/@fontsource-variable/unbounded/-/unbounded-5.3.0.tgz (`files/unbounded-latin-wght-normal.woff2`) |
| Hanken Grotesk | SIL Open Font License 1.1 (OFL-1.1) | Copyright 2021 The Hanken Grotesk Project Authors (https://github.com/marcologous/hanken-grotesk) | `public/fonts/hanken-grotesk-latin-wght.woff2` | npm tarball https://registry.npmjs.org/@fontsource-variable/hanken-grotesk/-/hanken-grotesk-5.3.0.tgz (`files/hanken-grotesk-latin-wght-normal.woff2`) |
| JetBrains Mono | SIL Open Font License 1.1 (OFL-1.1) | Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono) | `public/fonts/jetbrains-mono-latin-wght.woff2` | npm tarball https://registry.npmjs.org/@fontsource-variable/jetbrains-mono/-/jetbrains-mono-5.3.0.tgz (`files/jetbrains-mono-latin-wght-normal.woff2`) |

### SIL Open Font License 1.1

```text
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

## Icons

**Lucide icons — ISC License**

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.

```text
ISC License

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

The icon outlines are copied into the app as SVG path data in `src/web/components/ui.tsx` and drawn by its `Icon` component. No Lucide package is installed or shipped.

## Seed media

The four seed export videos in `seed/exports/` are original works generated with ffmpeg for this app from lavfi test sources (synthetic gradients, patterns and cellular automata). They contain no third-party content. The exact ffmpeg command for each file, and its SHA-256, is recorded in `assets.json`.

- `seed/exports/tidewire-bloom.mp4`
- `seed/exports/salt-halo.mp4`
- `seed/exports/lantern-static.mp4`
- `seed/exports/halo-undertow.mp4`
