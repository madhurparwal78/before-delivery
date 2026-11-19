# Third-party notices

Tallyframe ships the packages below (the production dependency tree, `npm ls --omit=dev --all`), bundles three fonts and one icon set into its client, and is built with the development packages listed after them.

## Shipped packages

| Package | Version | Licence | Copyright |
|---|---|---|---|
| pg | 8.16.3 | MIT | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-cloudflare | 1.4.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-connection-string | 2.14.1 | MIT | Copyright (c) 2014 Iced Development |
| pg-int8 | 1.0.1 | ISC | Copyright © 2017, Charmander <~@charmander.me> |
| pg-pool | 3.14.0 | MIT | Copyright (c) 2017 Brian M. Carlson |
| pg-protocol | 1.16.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-types | 2.2.0 | MIT | see the package's licence file |
| pgpass | 1.0.5 | MIT | see the package's licence file |
| postgres-array | 2.0.0 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-bytea | 1.0.1 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-date | 1.0.7 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-interval | 1.2.0 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| split2 | 4.2.0 | ISC | Copyright (c) 2014-2018, Matteo Collina <hello@matteocollina.com> |
| xtend | 4.0.2 | MIT | Copyright (c) 2012-2014 Raynos. |

## Bundled fonts

Each font is a WOFF2 file vendored in the app and served from its own origin. All three are licensed under the SIL Open Font License, Version 1.1 (OFL-1.1); the full licence text follows the list.

- **Instrument Serif** — src/client/fonts/instrument-serif-*.woff2 (from @fontsource/instrument-serif 5.2.8), weights 400, latin and latin-ext. Licence: SIL Open Font License 1.1 (OFL-1.1). Copyright 2022 The Instrument Serif Project Authors (https://github.com/Instrument/instrument-serif)
- **IBM Plex Sans** — src/client/fonts/ibm-plex-sans-*.woff2 (from @fontsource/ibm-plex-sans 5.2.8), weights 400, 500, 600 latin; 400 latin-ext. Licence: SIL Open Font License 1.1 (OFL-1.1). Copyright 2019 IBM Corp. All rights reserved.
- **IBM Plex Mono** — src/client/fonts/ibm-plex-mono-*.woff2 (from @fontsource/ibm-plex-mono 5.2.7), weights 400, 500 latin. Licence: SIL Open Font License 1.1 (OFL-1.1). Copyright 2019 IBM Corp. All rights reserved.

## Icon set

- **Lucide** — lucide 0.548.0, licence ISC. Icons are inlined as SVG into the client bundle.

```
ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2023 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2025.

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

---

The MIT License (MIT) (for portions derived from Feather)

Copyright (c) 2013-2023 Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Build-time packages (not shipped)

| Package | Version | Licence | Copyright |
|---|---|---|---|
| @esbuild/aix-ppc64 | 0.25.12 | MIT | see the package's licence file |
| @esbuild/android-arm | 0.25.12 | MIT | see the package's licence file |
| @esbuild/android-arm64 | 0.25.12 | MIT | see the package's licence file |
| @esbuild/android-x64 | 0.25.12 | MIT | see the package's licence file |
| @esbuild/darwin-arm64 | 0.25.12 | MIT | see the package's licence file |
| @esbuild/darwin-x64 | 0.25.12 | MIT | see the package's licence file |
| @esbuild/freebsd-arm64 | 0.25.12 | MIT | see the package's licence file |
| @esbuild/freebsd-x64 | 0.25.12 | MIT | see the package's licence file |
| @esbuild/linux-arm | 0.25.12 | MIT | see the package's licence file |
| @esbuild/linux-arm64 | 0.25.12 | MIT | see the package's licence file |
| @esbuild/linux-ia32 | 0.25.12 | MIT | see the package's licence file |
| @esbuild/linux-loong64 | 0.25.12 | MIT | see the package's licence file |
| @esbuild/linux-mips64el | 0.25.12 | MIT | see the package's licence file |
| @esbuild/linux-ppc64 | 0.25.12 | MIT | see the package's licence file |
| @esbuild/linux-riscv64 | 0.25.12 | MIT | see the package's licence file |
| @esbuild/linux-s390x | 0.25.12 | MIT | see the package's licence file |
| @esbuild/linux-x64 | 0.25.12 | MIT | see the package's licence file |
| @esbuild/netbsd-arm64 | 0.25.12 | MIT | see the package's licence file |
| @esbuild/netbsd-x64 | 0.25.12 | MIT | see the package's licence file |
| @esbuild/openbsd-arm64 | 0.25.12 | MIT | see the package's licence file |
| @esbuild/openbsd-x64 | 0.25.12 | MIT | see the package's licence file |
| @esbuild/openharmony-arm64 | 0.25.12 | MIT | see the package's licence file |
| @esbuild/sunos-x64 | 0.25.12 | MIT | see the package's licence file |
| @esbuild/win32-arm64 | 0.25.12 | MIT | see the package's licence file |
| @esbuild/win32-ia32 | 0.25.12 | MIT | see the package's licence file |
| @esbuild/win32-x64 | 0.25.12 | MIT | see the package's licence file |
| @napi-rs/lzma-linux-x64-gnu | 1.5.1 | MIT | see the package's licence file |
| @rollup/rollup-android-arm-eabi | 4.67.3 | MIT | see the package's licence file |
| @rollup/rollup-android-arm64 | 4.67.3 | MIT | see the package's licence file |
| @rollup/rollup-android-x64 | 4.67.3 | MIT | see the package's licence file |
| @rollup/rollup-darwin-arm64 | 4.67.3 | MIT | see the package's licence file |
| @rollup/rollup-darwin-x64 | 4.67.3 | MIT | see the package's licence file |
| @rollup/rollup-freebsd-arm64 | 4.67.3 | MIT | see the package's licence file |
| @rollup/rollup-freebsd-x64 | 4.67.3 | MIT | see the package's licence file |
| @rollup/rollup-linux-arm-gnueabihf | 4.67.3 | MIT | see the package's licence file |
| @rollup/rollup-linux-arm-musleabihf | 4.67.3 | MIT | see the package's licence file |
| @rollup/rollup-linux-arm64-gnu | 4.67.3 | MIT | see the package's licence file |
| @rollup/rollup-linux-arm64-musl | 4.67.3 | MIT | see the package's licence file |
| @rollup/rollup-linux-loong64-gnu | 4.67.3 | MIT | see the package's licence file |
| @rollup/rollup-linux-loong64-musl | 4.67.3 | MIT | see the package's licence file |
| @rollup/rollup-linux-ppc64-gnu | 4.67.3 | MIT | see the package's licence file |
| @rollup/rollup-linux-ppc64-musl | 4.67.3 | MIT | see the package's licence file |
| @rollup/rollup-linux-riscv64-gnu | 4.67.3 | MIT | see the package's licence file |
| @rollup/rollup-linux-riscv64-musl | 4.67.3 | MIT | see the package's licence file |
| @rollup/rollup-linux-s390x-gnu | 4.67.3 | MIT | see the package's licence file |
| @rollup/rollup-linux-x64-gnu | 4.67.3 | MIT | see the package's licence file |
| @rollup/rollup-linux-x64-musl | 4.67.3 | MIT | see the package's licence file |
| @rollup/rollup-openbsd-x64 | 4.67.3 | MIT | see the package's licence file |
| @rollup/rollup-openharmony-arm64 | 4.67.3 | MIT | see the package's licence file |
| @rollup/rollup-win32-arm64-msvc | 4.67.3 | MIT | see the package's licence file |
| @rollup/rollup-win32-ia32-msvc | 4.67.3 | MIT | see the package's licence file |
| @rollup/rollup-win32-x64-gnu | 4.67.3 | MIT | see the package's licence file |
| @rollup/rollup-win32-x64-msvc | 4.67.3 | MIT | see the package's licence file |
| @types/estree | 1.0.10 | MIT | Copyright (c) Microsoft Corporation. |
| @types/node | 22.18.12 | MIT | Copyright (c) Microsoft Corporation. |
| @types/pg | 8.15.5 | MIT | Copyright (c) Microsoft Corporation. |
| esbuild | 0.25.12 | MIT | Copyright (c) 2020 Evan Wallace |
| fdir | 6.5.0 | MIT | Copyright 2023 Abdullah Atta |
| fsevents | 2.3.3 | MIT | Copyright (C) 2010-2020 by Philipp Dunkel, Ben Noordhuis, Elan Shankar, Paul Miller |
| lucide | 0.548.0 | ISC | Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2023 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2025. |
| nanoid | 3.3.20 | MIT | Copyright 2017 Andrey Sitnik <andrey@sitnik.ru> |
| picocolors | 1.1.1 | ISC | Copyright (c) 2021-2024 Oleksii Raspopov, Kostiantyn Denysov, Anton Verinov |
| picomatch | 4.0.7 | MIT | Copyright (c) 2017-present, Jon Schlinkert. |
| postcss | 8.5.32 | MIT | Copyright 2013 Andrey Sitnik <andrey@sitnik.es> |
| rollup | 4.67.3 | MIT | Copyright (c) 2017 [these people](https://github.com/rollup/rollup/graphs/contributors) |
| source-map-js | 1.2.2 | BSD-3-Clause | Copyright (c) 2009-2011, Mozilla Foundation and contributors |
| tinyglobby | 0.2.17 | MIT | Copyright (c) 2024 Madeline Gurriarán |
| typescript | 5.9.3 | Apache-2.0 | see the package's licence file |
| undici-types | 6.21.0 | MIT | Copyright (c) Matteo Collina and Undici contributors |
| vite | 7.1.12 | MIT | Copyright (c) 2019-present, VoidZero Inc. and Vite contributors |

## SIL Open Font License 1.1 (Instrument Serif, IBM Plex Sans, IBM Plex Mono)

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
