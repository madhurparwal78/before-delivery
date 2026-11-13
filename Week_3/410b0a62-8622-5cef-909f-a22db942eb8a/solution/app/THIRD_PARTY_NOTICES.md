# Third-party notices

Tempoline ships the packages, fonts and icons below. Every licence is one of MIT, ISC, BSD-2-Clause, BSD-3-Clause,
Apache-2.0, 0BSD, BlueOak-1.0.0, CC0-1.0 or OFL-1.1. The drawings in the app (the today band, rings, chart, builder graph,
empty-state marks and the wordmark) are original SVG made for this app and carry no third-party licence.

## Runtime packages

The production dependency tree (`npm ls --omit=dev --all`): the server, the database driver and the libraries bundled into the browser script.

| Package | Version | Licence | Copyright |
|---|---|---|---|
| @hono/node-server | 2.1.6 | MIT | Copyright (c) 2022 - present, Yusuke Wada and Hono contributors |
| @types/react | 19.3.0 | MIT | Copyright (c) Microsoft Corporation. |
| csstype | 3.2.3 | MIT | Copyright (c) 2017-2018 Fredrik Nicol |
| hono | 4.13.16 | MIT | Copyright (c) 2021 - present, Yusuke Wada and Hono contributors |
| lucide-react | 1.69.0 | ISC | Copyright (c) 2026 Lucide Icons and Contributors |
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
| react | 19.3.1 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| react-dom | 19.3.1 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| scheduler | 0.28.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| split2 | 4.2.0 | ISC | Copyright (c) 2014-2018, Matteo Collina <hello@matteocollina.com> |
| xtend | 4.0.2 | MIT | Copyright (c) 2012-2014 Raynos. |

Icons: Lucide (package lucide-react, ISC), inlined as SVG. Lucide's own licence file also carries the MIT notice for the Feather icons it derives from.

## Build tooling (not shipped)

Installed by `npm ci` to compile the TypeScript and bundle the browser script. Nothing here runs in production.

| Package | Version | Licence | Copyright |
|---|---|---|---|
| @esbuild/aix-ppc64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/android-arm | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/android-arm64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/android-x64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/darwin-arm64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/darwin-x64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/freebsd-arm64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/freebsd-x64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/linux-arm | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/linux-arm64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/linux-ia32 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/linux-loong64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/linux-mips64el | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/linux-ppc64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/linux-riscv64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/linux-s390x | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/linux-x64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/netbsd-arm64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/netbsd-x64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/openbsd-arm64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/openbsd-x64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/openharmony-arm64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/sunos-x64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/win32-arm64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/win32-ia32 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/win32-x64 | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @types/node | 26.6.6 | MIT | Copyright (c) Microsoft Corporation. |
| @types/pg | 8.23.1 | MIT | Copyright (c) Microsoft Corporation. |
| @types/react-dom | 19.3.0 | MIT | Copyright (c) Microsoft Corporation. |
| @typescript/typescript-aix-ppc64 | 7.0.2 | Apache-2.0 | "Licensor" shall mean the copyright owner or entity authorized by the copyright owner that is granting the License. |
| @typescript/typescript-darwin-arm64 | 7.0.2 | Apache-2.0 | "Licensor" shall mean the copyright owner or entity authorized by the copyright owner that is granting the License. |
| @typescript/typescript-darwin-x64 | 7.0.2 | Apache-2.0 | "Licensor" shall mean the copyright owner or entity authorized by the copyright owner that is granting the License. |
| @typescript/typescript-freebsd-arm64 | 7.0.2 | Apache-2.0 | "Licensor" shall mean the copyright owner or entity authorized by the copyright owner that is granting the License. |
| @typescript/typescript-freebsd-x64 | 7.0.2 | Apache-2.0 | "Licensor" shall mean the copyright owner or entity authorized by the copyright owner that is granting the License. |
| @typescript/typescript-linux-arm | 7.0.2 | Apache-2.0 | "Licensor" shall mean the copyright owner or entity authorized by the copyright owner that is granting the License. |
| @typescript/typescript-linux-arm64 | 7.0.2 | Apache-2.0 | "Licensor" shall mean the copyright owner or entity authorized by the copyright owner that is granting the License. |
| @typescript/typescript-linux-loong64 | 7.0.2 | Apache-2.0 | "Licensor" shall mean the copyright owner or entity authorized by the copyright owner that is granting the License. |
| @typescript/typescript-linux-mips64el | 7.0.2 | Apache-2.0 | "Licensor" shall mean the copyright owner or entity authorized by the copyright owner that is granting the License. |
| @typescript/typescript-linux-ppc64 | 7.0.2 | Apache-2.0 | "Licensor" shall mean the copyright owner or entity authorized by the copyright owner that is granting the License. |
| @typescript/typescript-linux-riscv64 | 7.0.2 | Apache-2.0 | "Licensor" shall mean the copyright owner or entity authorized by the copyright owner that is granting the License. |
| @typescript/typescript-linux-s390x | 7.0.2 | Apache-2.0 | "Licensor" shall mean the copyright owner or entity authorized by the copyright owner that is granting the License. |
| @typescript/typescript-linux-x64 | 7.0.2 | Apache-2.0 | "Licensor" shall mean the copyright owner or entity authorized by the copyright owner that is granting the License. |
| @typescript/typescript-netbsd-arm64 | 7.0.2 | Apache-2.0 | "Licensor" shall mean the copyright owner or entity authorized by the copyright owner that is granting the License. |
| @typescript/typescript-netbsd-x64 | 7.0.2 | Apache-2.0 | "Licensor" shall mean the copyright owner or entity authorized by the copyright owner that is granting the License. |
| @typescript/typescript-openbsd-arm64 | 7.0.2 | Apache-2.0 | "Licensor" shall mean the copyright owner or entity authorized by the copyright owner that is granting the License. |
| @typescript/typescript-openbsd-x64 | 7.0.2 | Apache-2.0 | "Licensor" shall mean the copyright owner or entity authorized by the copyright owner that is granting the License. |
| @typescript/typescript-sunos-x64 | 7.0.2 | Apache-2.0 | "Licensor" shall mean the copyright owner or entity authorized by the copyright owner that is granting the License. |
| @typescript/typescript-win32-arm64 | 7.0.2 | Apache-2.0 | "Licensor" shall mean the copyright owner or entity authorized by the copyright owner that is granting the License. |
| @typescript/typescript-win32-x64 | 7.0.2 | Apache-2.0 | "Licensor" shall mean the copyright owner or entity authorized by the copyright owner that is granting the License. |
| esbuild | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| typescript | 7.0.2 | Apache-2.0 | "Licensor" shall mean the copyright owner or entity authorized by the copyright owner that is granting the License. |
| undici-types | 8.9.0 | MIT | Copyright (c) Matteo Collina and Undici contributors |

## Fonts

Both fonts are bundled as self-hosted woff2 files under /fonts and are licensed under the SIL Open Font License, Version 1.1 (OFL-1.1).

### Encode Sans Expanded (ExtraBold 800, latin subset)

Source: Fontsource package @fontsource/encode-sans-expanded 5.3.0, from the Encode Sans project (https://github.com/thundernixon/Encode-Sans). Licence: OFL-1.1.

```
Copyright 2012 The Encode Project Authors (impallari@gmail.com), with Reserved Font Name "Encode Sans". EncodeSansExpanded-ExtraLight.ttf: Copyright 2012 The Encode Project Authors (impallari@gmail.com), with Reserved Font Name "Encode Sans". EncodeSansExpanded-Light.ttf: Copyright 2012 The Encode Project Authors (impallari@gmail.com), with Reserved Font Name "Encode Sans". EncodeSansExpanded-Regular.ttf: Copyright 2012 The Encode Project Authors (impallari@gmail.com), with Reserved Font Name "Encode Sans". EncodeSansExpanded-Medium.ttf: Copyright 2012 The Encode Project Authors (impallari@gmail.com), with Reserved Font Name "Encode Sans". EncodeSansExpanded-SemiBold.ttf: Copyright 2012 The Encode Project Authors (impallari@gmail.com), with Reserved Font Name "Encode Sans". EncodeSansExpanded-Bold.ttf: Copyright 2012 The Encode Project Authors (impallari@gmail.com), with Reserved Font Name "Encode Sans". EncodeSansExpanded-ExtraBold.ttf: Copyright 2012 The Encode Project Authors (impallari@gmail.com), with Reserved Font Name "Encode Sans". EncodeSansExpanded-Black.ttf: Copyright 2012 The Encode Project Authors (impallari@gmail.com), with Reserved Font Name "Encode Sans".

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

### Inter (Regular 400 and Medium 500, latin subset)

Source: Fontsource package @fontsource/inter 5.3.0, from the Inter project (https://github.com/rsms/inter). Licence: OFL-1.1.

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
