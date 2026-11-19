# Third-party notices

Everything Wringbench ships or builds with, with its licence. All licences are MIT, ISC, BSD, Apache-2.0, 0BSD, Zlib or OFL-1.1.

## Production dependencies

These make up `npm ls --omit=dev --all` and run on the server.

| Package | Version | Licence | Copyright |
|---|---|---|---|
| fflate | 0.8.3 | MIT | Copyright (c) 2026 Arjun Barrett |
| pg | 8.23.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-cloudflare | 1.4.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-connection-string | 2.14.1 | MIT | Copyright (c) 2014 Iced Development |
| pg-int8 | 1.0.1 | ISC | Copyright © 2017, Charmander <~@charmander.me> |
| pg-pool | 3.14.0 | MIT | Copyright (c) 2017 Brian M. Carlson |
| pg-protocol | 1.16.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-types | 2.2.0 | MIT | Copyright Brian M. Carlson |
| pgpass | 1.0.5 | MIT | Copyright Hannes Hörl <hannes.hoerl+pgpass@snowreporter.com> |
| postgres-array | 2.0.0 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-bytea | 1.0.1 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-date | 1.0.7 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-interval | 1.2.0 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| split2 | 4.2.0 | ISC | Copyright (c) 2014-2018, Matteo Collina <hello@matteocollina.com> |
| ws | 8.22.1 | MIT | Copyright (c) 2011 Einar Otto Stangvik <einaros@gmail.com> |
| xtend | 4.0.2 | MIT | Copyright (c) 2012-2014 Raynos. |

## Bundled and build-time dependencies

React and the Lucide icons are bundled; fflate runs on the server and is bundled into the bake worker too into the browser build; the rest build the app and are not shipped.

| Package | Version | Licence | Copyright |
|---|---|---|---|
| @esbuild/aix-ppc64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace (platform build of esbuild) |
| @esbuild/android-arm | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace (platform build of esbuild) |
| @esbuild/android-arm64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace (platform build of esbuild) |
| @esbuild/android-x64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace (platform build of esbuild) |
| @esbuild/darwin-arm64 | 0.28.2 | MIT | Copyright the darwin-arm64 authors |
| @esbuild/darwin-x64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace (platform build of esbuild) |
| @esbuild/freebsd-arm64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace (platform build of esbuild) |
| @esbuild/freebsd-x64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace (platform build of esbuild) |
| @esbuild/linux-arm | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace (platform build of esbuild) |
| @esbuild/linux-arm64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace (platform build of esbuild) |
| @esbuild/linux-ia32 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace (platform build of esbuild) |
| @esbuild/linux-loong64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace (platform build of esbuild) |
| @esbuild/linux-mips64el | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace (platform build of esbuild) |
| @esbuild/linux-ppc64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace (platform build of esbuild) |
| @esbuild/linux-riscv64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace (platform build of esbuild) |
| @esbuild/linux-s390x | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace (platform build of esbuild) |
| @esbuild/linux-x64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace (platform build of esbuild) |
| @esbuild/netbsd-arm64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace (platform build of esbuild) |
| @esbuild/netbsd-x64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace (platform build of esbuild) |
| @esbuild/openbsd-arm64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace (platform build of esbuild) |
| @esbuild/openbsd-x64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace (platform build of esbuild) |
| @esbuild/openharmony-arm64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace (platform build of esbuild) |
| @esbuild/sunos-x64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace (platform build of esbuild) |
| @esbuild/win32-arm64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace (platform build of esbuild) |
| @esbuild/win32-ia32 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace (platform build of esbuild) |
| @esbuild/win32-x64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace (platform build of esbuild) |
| @types/node | 22.20.5 | MIT | Copyright (c) Microsoft Corporation. |
| @types/pg | 8.23.1 | MIT | Copyright (c) Microsoft Corporation. |
| @types/react | 19.3.0 | MIT | Copyright (c) Microsoft Corporation. |
| @types/react-dom | 19.3.0 | MIT | Copyright (c) Microsoft Corporation. |
| @types/ws | 8.18.2 | MIT | Copyright (c) Microsoft Corporation. |
| csstype | 3.2.3 | MIT | Copyright (c) 2017-2018 Fredrik Nicol |
| esbuild | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| lucide-react | 1.69.0 | ISC | Copyright (c) 2026 Lucide Icons and Contributors |
| react | 19.3.1 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| react-dom | 19.3.1 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| scheduler | 0.28.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| typescript | 5.9.3 | Apache-2.0 | "Licensor" shall mean the copyright owner or entity authorized by the copyright owner that is granting the License. |
| undici-types | 6.21.0 | MIT | Copyright (c) Matteo Collina and Undici contributors |

## Fonts

Both fonts are self-hosted from `public/assets/fonts` and are licensed under the SIL Open Font License 1.1 (OFL-1.1).

- **Inter** (variable, latin and latin-ext subsets), OFL-1.1, Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter). Files from the npm package @fontsource-variable/inter 5.3.0.
- **Fragment Mono** (400, latin and latin-ext subsets), OFL-1.1, Copyright 2022 The Fragment-Mono Project Authors (https://github.com/weiweihuanghuang/fragment-mono). Files from the npm package @fontsource/fragment-mono 5.3.0.

### Inter licence text

```
Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter) Inter-Italic[opsz,wght].ttf: Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)

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

### Fragment Mono licence text

```
Copyright 2022 The Fragment-Mono Project Authors (https://github.com/weiweihuanghuang/fragment-mono) FragmentMono-Italic.ttf: Copyright 2022 The Fragment-Mono Project Authors (https://github.com/weiweihuanghuang/fragment-mono)

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

**Lucide** icons (ISC), used through the lucide-react package. The package licence follows.

```
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

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

The following Lucide icons are derived from the Feather project:

airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out

The MIT License (MIT) (for the icons listed above)

Copyright (c) 2013-present Cole Bemis

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

## Original artwork

The wrung-cloth mascot and the favicon are original drawings made for Wringbench (licence: original). The mascot is inline SVG in the source; the favicon is `public/assets/favicon.svg`.
