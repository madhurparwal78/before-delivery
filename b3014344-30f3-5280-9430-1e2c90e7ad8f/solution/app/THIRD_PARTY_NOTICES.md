# Third-party notices

Pampero Ledger ships the packages, fonts and media listed here. Every licence is in the allowed set
(MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, CC0-1.0, BlueOak-1.0.0, OFL-1.1).

## Fonts (bundled, self-hosted)

Latin-subset WOFF2 files copied from the Fontsource 5.3.0 npm packages into `src/client/fonts/`.

| Font | Files | Source | Licence | Copyright |
|---|---|---|---|---|
| Bricolage Grotesque | `bricolage-grotesque-latin-500-normal.woff2`, `bricolage-grotesque-latin-700-normal.woff2` | https://fontsource.org/fonts/bricolage-grotesque | OFL-1.1 | Copyright 2022 The Bricolage Grotesque Project Authors |
| IBM Plex Sans | `ibm-plex-sans-latin-400-normal.woff2`, `ibm-plex-sans-latin-500-normal.woff2`, `ibm-plex-sans-latin-600-normal.woff2` | https://fontsource.org/fonts/ibm-plex-sans | OFL-1.1 | Copyright 2019 IBM Corp. |
| IBM Plex Mono | `ibm-plex-mono-latin-400-normal.woff2`, `ibm-plex-mono-latin-500-normal.woff2` | https://fontsource.org/fonts/ibm-plex-mono | OFL-1.1 | Copyright 2019 IBM Corp. |

## Packages

`shipped` packages are the production dependency tree (`npm ls --omit=dev --all`); `build` packages run only at build time.

| Package | Version | Licence | Copyright | Use |
|---|---|---|---|---|
| @dimforge/rapier3d-compat | 0.12.0 | Apache-2.0 | "Licensor" shall mean the copyright owner or entity authorized by | build |
| @esbuild/darwin-arm64 | 0.25.12 | MIT |  | build |
| @esbuild/darwin-arm64 | 0.28.2 | MIT |  | build |
| @rollup/rollup-darwin-arm64 | 4.67.3 | MIT | Copyright (c) Lukas Taegert-Atkinson | build |
| @tweenjs/tween.js | 23.1.3 | MIT | Copyright (c) 2010-2012 Tween.js authors. | build |
| @types/estree | 1.0.10 | MIT | Copyright (c) Microsoft Corporation. | build |
| @types/node | 22.20.5 | MIT | Copyright (c) Microsoft Corporation. | build |
| @types/pg | 8.23.1 | MIT | Copyright (c) Microsoft Corporation. | build |
| @types/react | 19.3.0 | MIT | Copyright (c) Microsoft Corporation. | shipped |
| @types/react-dom | 19.3.0 | MIT | Copyright (c) Microsoft Corporation. | build |
| @types/stats.js | 0.17.4 | MIT | Copyright (c) Microsoft Corporation. | build |
| @types/three | 0.187.0 | MIT | Copyright (c) Microsoft Corporation. | build |
| @types/webxr | 0.5.24 | MIT | Copyright (c) Microsoft Corporation. | build |
| csstype | 3.2.3 | MIT | Copyright (c) 2017-2018 Fredrik Nicol | shipped |
| esbuild | 0.25.12 | MIT | Copyright (c) 2020 Evan Wallace | build |
| esbuild | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace | build |
| fdir | 6.5.0 | MIT | Copyright 2023 Abdullah Atta | build |
| fflate | 0.8.3 | MIT | Copyright (c) 2026 Arjun Barrett | build |
| fsevents | 2.3.3 | MIT | Copyright (C) 2010-2020 by Philipp Dunkel, Ben Noordhuis, Elan Shankar, Paul Miller | build |
| lucide-react | 1.66.0 | ISC | Copyright (c) 2026 Lucide Icons and Contributors | shipped |
| meshoptimizer | 1.1.1 | MIT | Copyright (c) 2016-2026 Arseny Kapoulkine | build |
| nanoid | 3.3.20 | MIT | Copyright 2017 Andrey Sitnik <andrey@sitnik.ru> | build |
| pg | 8.23.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson | shipped |
| pg-cloudflare | 1.4.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson | shipped |
| pg-connection-string | 2.14.1 | MIT | Copyright (c) 2014 Iced Development | shipped |
| pg-int8 | 1.0.1 | ISC | Copyright © 2017, Charmander <~@charmander.me> | shipped |
| pg-pool | 3.14.0 | MIT | Copyright (c) 2017 Brian M. Carlson | shipped |
| pg-protocol | 1.16.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson | shipped |
| pg-types | 2.2.0 | MIT | Copyright (c) Brian M. Carlson | shipped |
| pgpass | 1.0.5 | MIT | Copyright (c) Hannes Hörl <hannes.hoerl+pgpass@snowreporter.com> | shipped |
| picocolors | 1.1.1 | ISC | Copyright (c) 2021-2024 Oleksii Raspopov, Kostiantyn Denysov, Anton Verinov | build |
| picomatch | 4.0.7 | MIT | Copyright (c) 2017-present, Jon Schlinkert. | build |
| postcss | 8.5.32 | MIT | Copyright 2013 Andrey Sitnik <andrey@sitnik.es> | build |
| postgres-array | 2.0.0 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) | shipped |
| postgres-bytea | 1.0.1 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) | shipped |
| postgres-date | 1.0.7 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) | shipped |
| postgres-interval | 1.2.0 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) | shipped |
| react | 19.3.1 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. | shipped |
| react-dom | 19.3.1 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. | shipped |
| rollup | 4.67.3 | MIT | Copyright (c) 2017 [these people](https://github.com/rollup/rollup/graphs/contributors) | build |
| scheduler | 0.28.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. | shipped |
| source-map-js | 1.2.2 | BSD-3-Clause | Copyright (c) 2009-2011, Mozilla Foundation and contributors | build |
| split2 | 4.2.0 | ISC | Copyright (c) 2014-2018, Matteo Collina <hello@matteocollina.com> | shipped |
| three | 0.187.0 | MIT | Copyright © 2010-2026 three.js authors | shipped |
| tinyglobby | 0.2.17 | MIT | Copyright (c) 2024 Madeline Gurriarán | build |
| typescript | 5.9.3 | Apache-2.0 | "Licensor" shall mean the copyright owner or entity authorized by the copyright owner that is granting the License. | build |
| undici-types | 6.21.0 | MIT | Copyright (c) Matteo Collina and Undici contributors | build |
| vite | 7.3.7 | MIT | Copyright (c) 2019-present, VoidZero Inc. and Vite contributors | build |
| xtend | 4.0.2 | MIT | Copyright (c) 2012-2014 Raynos. | shipped |

Platform build binaries installed only on the build host's platform: `@rollup/rollup-<platform>` (MIT, Copyright (c) 2017 [these people]) and `@esbuild/<platform>` (MIT, Copyright (c) 2020 Evan Wallace), the native halves of rollup and esbuild above.

## Media

Every picture in the app is drawn in code for this app (licence `original`): the three.js studio objects,
the still SVG drawings, the fold motif, the seeded logo SVG, palette PDF and homepage PNG. Icons are Lucide (ISC), inlined via lucide-react.

## SIL Open Font License 1.1: Bricolage Grotesque

```
Copyright 2022 The Bricolage Grotesque Project Authors (https://github.com/ateliertriay/bricolage)

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

## SIL Open Font License 1.1: IBM Plex Sans and IBM Plex Mono

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
