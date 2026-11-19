# Third-party notices

Rimewire ships the packages below (the production tree, `npm ls --omit=dev --all`), three self-hosted font families and the Lucide icons bundled through `lucide-react`. Platform-specific `@img/sharp-*` packages are optional: npm installs only the one matching the host (for example `@img/sharp-linux-x64` and `@img/sharp-libvips-linux-x64` on Linux x64). The libvips binaries are unmodified prebuilt native image libraries under LGPL-3.0-or-later.

## Shipped packages

| Package | Version | Licence | Copyright |
|---|---|---|---|
| @emnapi/runtime | 1.11.3 | MIT | Copyright (c) 2021-present Toyo Li |
| @img/colour | 1.1.0 | MIT | Copyright (c) 2012 Heather Arthur |
| @img/sharp-darwin-arm64 | 0.35.5 | Apache-2.0 | Copyright 2013 Lovell Fuller and others. |
| @img/sharp-darwin-x64 | 0.35.5 | Apache-2.0 | Copyright 2013 Lovell Fuller and others. |
| @img/sharp-freebsd-wasm32 | 0.35.5 | Apache-2.0 | Copyright 2013 Lovell Fuller and others. |
| @img/sharp-libvips-darwin-arm64 | 1.3.4 | LGPL-3.0-or-later | libvips: Copyright John Cupitt and others; bundled libraries under their own licences (see package) |
| @img/sharp-libvips-darwin-x64 | 1.3.4 | LGPL-3.0-or-later | libvips: Copyright John Cupitt and others; bundled libraries under their own licences (see package) |
| @img/sharp-libvips-linux-arm | 1.3.4 | LGPL-3.0-or-later | libvips: Copyright John Cupitt and others; bundled libraries under their own licences (see package) |
| @img/sharp-libvips-linux-arm64 | 1.3.4 | LGPL-3.0-or-later | libvips: Copyright John Cupitt and others; bundled libraries under their own licences (see package) |
| @img/sharp-libvips-linux-ppc64 | 1.3.4 | LGPL-3.0-or-later | libvips: Copyright John Cupitt and others; bundled libraries under their own licences (see package) |
| @img/sharp-libvips-linux-riscv64 | 1.3.4 | LGPL-3.0-or-later | libvips: Copyright John Cupitt and others; bundled libraries under their own licences (see package) |
| @img/sharp-libvips-linux-s390x | 1.3.4 | LGPL-3.0-or-later | libvips: Copyright John Cupitt and others; bundled libraries under their own licences (see package) |
| @img/sharp-libvips-linux-x64 | 1.3.4 | LGPL-3.0-or-later | libvips: Copyright John Cupitt and others; bundled libraries under their own licences (see package) |
| @img/sharp-libvips-linuxmusl-arm64 | 1.3.4 | LGPL-3.0-or-later | libvips: Copyright John Cupitt and others; bundled libraries under their own licences (see package) |
| @img/sharp-libvips-linuxmusl-x64 | 1.3.4 | LGPL-3.0-or-later | libvips: Copyright John Cupitt and others; bundled libraries under their own licences (see package) |
| @img/sharp-linux-arm | 0.35.5 | Apache-2.0 | Copyright 2013 Lovell Fuller and others. |
| @img/sharp-linux-arm64 | 0.35.5 | Apache-2.0 | Copyright 2013 Lovell Fuller and others. |
| @img/sharp-linux-ppc64 | 0.35.5 | Apache-2.0 | Copyright 2013 Lovell Fuller and others. |
| @img/sharp-linux-riscv64 | 0.35.5 | Apache-2.0 | Copyright 2013 Lovell Fuller and others. |
| @img/sharp-linux-s390x | 0.35.5 | Apache-2.0 | Copyright 2013 Lovell Fuller and others. |
| @img/sharp-linux-x64 | 0.35.5 | Apache-2.0 | Copyright 2013 Lovell Fuller and others. |
| @img/sharp-linuxmusl-arm64 | 0.35.5 | Apache-2.0 | Copyright 2013 Lovell Fuller and others. |
| @img/sharp-linuxmusl-x64 | 0.35.5 | Apache-2.0 | Copyright 2013 Lovell Fuller and others. |
| @img/sharp-wasm32 | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later AND MIT | Copyright 2013 Lovell Fuller and others. |
| @img/sharp-webcontainers-wasm32 | 0.35.5 | Apache-2.0 | Copyright 2013 Lovell Fuller and others. |
| @img/sharp-win32-arm64 | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later | Copyright 2013 Lovell Fuller and others. |
| @img/sharp-win32-ia32 | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later | Copyright 2013 Lovell Fuller and others. |
| @img/sharp-win32-x64 | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later | Copyright 2013 Lovell Fuller and others. |
| @types/react | 19.3.0 | MIT | Copyright (c) Microsoft Corporation. |
| csstype | 3.2.3 | MIT | Copyright (c) 2017-2018 Fredrik Nicol |
| detect-libc | 2.1.2 | Apache-2.0 | Copyright 2017 Lovell Fuller and others. |
| lucide-react | 1.63.0 | ISC | Copyright (c) 2026 Lucide Icons and Contributors |
| pg | 8.23.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-cloudflare | 1.4.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-connection-string | 2.14.1 | MIT | Copyright (c) 2014 Iced Development |
| pg-int8 | 1.0.1 | ISC | Copyright © 2017, Charmander <~@charmander.me> |
| pg-pool | 3.14.0 | MIT | Copyright (c) 2017 Brian M. Carlson |
| pg-protocol | 1.16.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-types | 2.2.0 | MIT | Copyright (c) 2013 Brian M. Carlson |
| pgpass | 1.0.5 | MIT | Copyright (c) 2013-2016 Hannes Hörl |
| postgres-array | 2.0.0 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-bytea | 1.0.1 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-date | 1.0.7 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-interval | 1.2.0 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| react | 19.3.1 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| react-dom | 19.3.1 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| scheduler | 0.28.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| semver | 7.8.5 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors |
| sharp | 0.35.5 | Apache-2.0 | Copyright 2013 Lovell Fuller and others. |
| split2 | 4.2.0 | ISC | Copyright (c) 2014-2018, Matteo Collina <hello@matteocollina.com> |
| tslib | 2.8.1 | 0BSD | Copyright (c) Microsoft Corporation. |
| xtend | 4.0.2 | MIT | Copyright (c) 2012-2014 Raynos. |

## Fonts

Self-hosted WOFF2 files in `src/web/fonts/` (Latin subset, taken from the Fontsource packages `@fontsource/barlow-condensed` 5.3.0, `@fontsource/ibm-plex-sans` 5.3.0 and `@fontsource/ibm-plex-mono` 5.3.0).

| Font | Weights | Licence | Copyright |
|---|---|---|---|
| Barlow Condensed | 700, 800 | OFL-1.1 | Copyright 2017 The Barlow Project Authors (https://github.com/jpt/barlow) |
| IBM Plex Sans | 400, 600 | OFL-1.1 | Copyright 2019 IBM Corp. All rights reserved. |
| IBM Plex Mono | 400, 500 | OFL-1.1 | Copyright 2017 IBM Corp. All rights reserved. |

## Icons

Lucide icons (ISC), rendered inline as SVG through `lucide-react` 1.63.0. Copyright (c) Lucide Icons and Contributors; parts derived from Feather (MIT), Copyright (c) 2013-2022 Cole Bemis.

## Original assets

The service-tag drawing (`src/web/components/TagMark.tsx`) is an inline SVG drawn for this app (licence: original).

## Build tools (not shipped)

Used only by `npm run build`; none of their code reaches the server runtime or the browser bundle except where listed above.

| Package | Version | Licence |
|---|---|---|
| @oxc-project/types | 0.155.0 | MIT |
| @rolldown/binding-android-arm-eabi | 1.2.15 | MIT |
| @rolldown/binding-android-arm64 | 1.2.15 | MIT |
| @rolldown/binding-darwin-arm64 | 1.2.15 | MIT |
| @rolldown/binding-darwin-x64 | 1.2.15 | MIT |
| @rolldown/binding-freebsd-x64 | 1.2.15 | MIT |
| @rolldown/binding-linux-arm-gnueabihf | 1.2.15 | MIT |
| @rolldown/binding-linux-arm64-gnu | 1.2.15 | MIT |
| @rolldown/binding-linux-arm64-musl | 1.2.15 | MIT |
| @rolldown/binding-linux-ppc64-gnu | 1.2.15 | MIT |
| @rolldown/binding-linux-s390x-gnu | 1.2.15 | MIT |
| @rolldown/binding-linux-x64-gnu | 1.2.15 | MIT |
| @rolldown/binding-linux-x64-musl | 1.2.15 | MIT |
| @rolldown/binding-openharmony-arm64 | 1.2.15 | MIT |
| @rolldown/binding-win32-arm64-msvc | 1.2.15 | MIT |
| @rolldown/binding-win32-x64-msvc | 1.2.15 | MIT |
| @rolldown/pluginutils | 1.0.1 | MIT |
| @types/node | 22.19.1 | MIT |
| @types/pg | 8.23.1 | MIT |
| @types/react-dom | 19.3.0 | MIT |
| @vitejs/plugin-react | 6.1.2 | MIT |
| fdir | 6.5.0 | MIT |
| fsevents | 2.3.3 | MIT |
| lightningcss | 1.33.0 | MPL-2.0 |
| lightningcss-android-arm64 | 1.33.0 | MPL-2.0 |
| lightningcss-darwin-arm64 | 1.33.0 | MPL-2.0 |
| lightningcss-darwin-x64 | 1.33.0 | MPL-2.0 |
| lightningcss-freebsd-x64 | 1.33.0 | MPL-2.0 |
| lightningcss-linux-arm-gnueabihf | 1.33.0 | MPL-2.0 |
| lightningcss-linux-arm64-gnu | 1.33.0 | MPL-2.0 |
| lightningcss-linux-arm64-musl | 1.33.0 | MPL-2.0 |
| lightningcss-linux-x64-gnu | 1.33.0 | MPL-2.0 |
| lightningcss-linux-x64-musl | 1.33.0 | MPL-2.0 |
| lightningcss-win32-arm64-msvc | 1.33.0 | MPL-2.0 |
| lightningcss-win32-x64-msvc | 1.33.0 | MPL-2.0 |
| nanoid | 3.3.20 | MIT |
| picocolors | 1.1.1 | ISC |
| picomatch | 4.0.7 | MIT |
| postcss | 8.5.32 | MIT |
| rolldown | 1.2.15 | MIT |
| source-map-js | 1.2.2 | BSD-3-Clause |
| tinyglobby | 0.2.17 | MIT |
| typescript | 5.9.3 | Apache-2.0 |
| undici-types | 6.21.0 | MIT |
| vite | 8.3.5 | MIT |

## SIL Open Font License 1.1

Applies to Barlow Condensed, IBM Plex Sans and IBM Plex Mono.

```
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
