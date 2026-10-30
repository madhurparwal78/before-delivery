# Third-party notices

Passboard compiles its server (`dist/server/main.cjs`) and browser (`dist/web/app.js`) with esbuild, so every
third-party package is installed at build time from `package-lock.json` and the code that ships is compiled in.
The production dependency tree reported by `npm ls --omit=dev --all --json` is therefore empty; every package
below is listed with the role it plays. Allowed licences only: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0,
0BSD and BlueOak-1.0.0 for code; SIL OFL 1.1 for fonts.

## Packages

| Package | Version | Licence | Role | Copyright |
|---|---|---|---|---|
| @esbuild/aix-ppc64 | 0.28.2 | MIT | build tool | Copyright the package authors (see the package's LICENSE) |
| @esbuild/android-arm | 0.28.2 | MIT | build tool | Copyright the package authors (see the package's LICENSE) |
| @esbuild/android-arm64 | 0.28.2 | MIT | build tool | Copyright the package authors (see the package's LICENSE) |
| @esbuild/android-x64 | 0.28.2 | MIT | build tool | Copyright the package authors (see the package's LICENSE) |
| @esbuild/darwin-arm64 | 0.28.2 | MIT | build tool | Copyright the package authors (see the package's LICENSE) |
| @esbuild/darwin-x64 | 0.28.2 | MIT | build tool | Copyright the package authors (see the package's LICENSE) |
| @esbuild/freebsd-arm64 | 0.28.2 | MIT | build tool | Copyright the package authors (see the package's LICENSE) |
| @esbuild/freebsd-x64 | 0.28.2 | MIT | build tool | Copyright the package authors (see the package's LICENSE) |
| @esbuild/linux-arm | 0.28.2 | MIT | build tool | Copyright the package authors (see the package's LICENSE) |
| @esbuild/linux-arm64 | 0.28.2 | MIT | build tool | Copyright the package authors (see the package's LICENSE) |
| @esbuild/linux-ia32 | 0.28.2 | MIT | build tool | Copyright the package authors (see the package's LICENSE) |
| @esbuild/linux-loong64 | 0.28.2 | MIT | build tool | Copyright the package authors (see the package's LICENSE) |
| @esbuild/linux-mips64el | 0.28.2 | MIT | build tool | Copyright the package authors (see the package's LICENSE) |
| @esbuild/linux-ppc64 | 0.28.2 | MIT | build tool | Copyright the package authors (see the package's LICENSE) |
| @esbuild/linux-riscv64 | 0.28.2 | MIT | build tool | Copyright the package authors (see the package's LICENSE) |
| @esbuild/linux-s390x | 0.28.2 | MIT | build tool | Copyright the package authors (see the package's LICENSE) |
| @esbuild/linux-x64 | 0.28.2 | MIT | build tool | Copyright the package authors (see the package's LICENSE) |
| @esbuild/netbsd-arm64 | 0.28.2 | MIT | build tool | Copyright the package authors (see the package's LICENSE) |
| @esbuild/netbsd-x64 | 0.28.2 | MIT | build tool | Copyright the package authors (see the package's LICENSE) |
| @esbuild/openbsd-arm64 | 0.28.2 | MIT | build tool | Copyright the package authors (see the package's LICENSE) |
| @esbuild/openbsd-x64 | 0.28.2 | MIT | build tool | Copyright the package authors (see the package's LICENSE) |
| @esbuild/openharmony-arm64 | 0.28.2 | MIT | build tool | Copyright the package authors (see the package's LICENSE) |
| @esbuild/sunos-x64 | 0.28.2 | MIT | build tool | Copyright the package authors (see the package's LICENSE) |
| @esbuild/win32-arm64 | 0.28.2 | MIT | build tool | Copyright the package authors (see the package's LICENSE) |
| @esbuild/win32-ia32 | 0.28.2 | MIT | build tool | Copyright the package authors (see the package's LICENSE) |
| @esbuild/win32-x64 | 0.28.2 | MIT | build tool | Copyright the package authors (see the package's LICENSE) |
| @types/busboy | 1.5.5 | MIT | build tool | Copyright (c) Microsoft Corporation. |
| @types/node | 22.20.5 | MIT | build tool | Copyright (c) Microsoft Corporation. |
| @types/pg | 8.23.1 | MIT | build tool | Copyright (c) Microsoft Corporation. |
| busboy | 1.6.0 | MIT | server bundle | Copyright Brian White. All rights reserved. |
| esbuild | 0.28.2 | MIT | build tool | Copyright (c) 2020 Evan Wallace |
| pg | 8.23.1 | MIT | server bundle | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-cloudflare | 1.4.1 | MIT | server bundle | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-connection-string | 2.14.1 | MIT | server bundle | Copyright (c) 2014 Iced Development |
| pg-int8 | 1.0.1 | ISC | server bundle | Copyright © 2017, Charmander <~@charmander.me> |
| pg-pool | 3.14.0 | MIT | server bundle | Copyright (c) 2017 Brian M. Carlson |
| pg-protocol | 1.16.1 | MIT | server bundle | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-types | 2.2.0 | MIT | server bundle | Copyright (c) Brian M. Carlson |
| pgpass | 1.0.5 | MIT | server bundle | Copyright (c) Hannes Hörl <hannes.hoerl+pgpass@snowreporter.com> |
| postgres-array | 2.0.0 | MIT | server bundle | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-bytea | 1.0.1 | MIT | server bundle | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-date | 1.0.7 | MIT | server bundle | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-interval | 1.2.0 | MIT | server bundle | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| preact | 10.27.2 | MIT | browser bundle | Copyright (c) 2015-present Jason Miller |
| split2 | 4.2.0 | ISC | server bundle | Copyright (c) 2014-2018, Matteo Collina <hello@matteocollina.com> |
| streamsearch | 1.1.0 | MIT | server bundle | Copyright Brian White. All rights reserved. |
| typescript | 5.9.3 | Apache-2.0 | build tool | "Licensor" shall mean the copyright owner or entity authorized by the copyright owner that is granting the License. |
| undici-types | 6.21.0 | MIT | build tool | Copyright (c) Matteo Collina and Undici contributors |
| xtend | 4.0.2 | MIT | server bundle | Copyright (c) 2012-2014 Raynos. |

## Icons

| Item | Licence | Copyright |
|---|---|---|
| Lucide icon paths (chevron-left, chevron-right, calendar-check, log-out, menu, x, download, copy), inlined in `src/web/icons.tsx` | ISC | Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022. |

## Fonts

| Font | Version | Licence | File | Copyright |
|---|---|---|---|---|
| Big Shoulders Display | v21 (Fontsource @fontsource-variable/big-shoulders-display 5.3.0) | OFL-1.1 | `public/fonts/big-shoulders-display-latin-wght-normal.woff2` | Copyright 2019 The Big Shoulders Project Authors (https://github.com/xotypeco/big_shoulders) |
| Public Sans | v18 (Fontsource @fontsource-variable/public-sans 5.3.0) | OFL-1.1 | `public/fonts/public-sans-latin-wght-normal.woff2` | Copyright 2015 The Public Sans Project Authors (https://github.com/uswds/public-sans) |

### Big Shoulders Display — SIL Open Font License, Version 1.1 (OFL-1.1)

```
Google Inc.

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

### Public Sans — SIL Open Font License, Version 1.1 (OFL-1.1)

```
Copyright 2015 The Public Sans Project Authors (https://github.com/uswds/public-sans) PublicSans-Italic[wght].ttf: Copyright 2015 The Public Sans Project Authors (https://github.com/uswds/public-sans)

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
