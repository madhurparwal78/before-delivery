# Third-party notices

Lowlamp Field Log ships the packages and the font below. `runtime` packages are in the production
dependency tree (`npm ls --omit=dev --all`); `build` packages are bundled or used while building.

| Package | Version | Licence | Used as | Copyright |
|---|---|---|---|---|
| @esbuild/darwin-arm64 | 0.28.2 | MIT | build | git+https://github.com/evanw/esbuild.git |
| @types/node | 22.20.5 | MIT | build | https://github.com/DefinitelyTyped/DefinitelyTyped.git |
| @types/pg | 8.15.5 | MIT | build | https://github.com/DefinitelyTyped/DefinitelyTyped.git |
| esbuild | 0.28.2 | MIT | build | git+https://github.com/evanw/esbuild.git |
| pg | 8.23.1 | MIT | runtime | Brian Carlson <brian.m.carlson@gmail.com> |
| pg-cloudflare | 1.4.1 | MIT | runtime | git://github.com/brianc/node-postgres.git |
| pg-connection-string | 2.14.1 | MIT | runtime | Blaine Bublitz <blaine@iceddev.com> (http://iceddev.com/) |
| pg-int8 | 1.0.1 | ISC | runtime | https://github.com/charmander/pg-int8 |
| pg-pool | 3.14.0 | MIT | runtime | Brian M. Carlson |
| pg-protocol | 1.16.1 | MIT | runtime | git://github.com/brianc/node-postgres.git |
| pg-types | 2.2.0 | MIT | runtime | Brian M. Carlson |
| pgpass | 1.0.5 | MIT | runtime | Hannes Hörl <hannes.hoerl+pgpass@snowreporter.com> |
| postgres-array | 2.0.0 | MIT | runtime | Ben Drucker |
| postgres-bytea | 1.0.1 | MIT | runtime | Ben Drucker |
| postgres-date | 1.0.7 | MIT | runtime | Ben Drucker |
| postgres-interval | 1.2.0 | MIT | runtime | Ben Drucker |
| preact | 10.29.8 | MIT | build | the package authors |
| split2 | 4.2.0 | ISC | runtime | Matteo Collina <hello@matteocollina.com> |
| typescript | 5.9.3 | Apache-2.0 | build | Microsoft Corp. |
| undici-types | 6.21.0 | MIT | build | git+https://github.com/nodejs/undici.git |
| xtend | 4.0.2 | MIT | runtime | Raynos <raynos2@gmail.com> |

## Font

| Font | Version | Licence | Source |
|---|---|---|---|
| Sora (variable, latin and latin-ext woff2, served from `/fonts/`) | @fontsource-variable/sora 5.3.0 | OFL-1.1 | https://github.com/sora-xor/sora-font via Fontsource |

Sora is copyright The Sora Project Authors (https://github.com/sora-xor/sora-font). Its licence, the SIL Open
Font License 1.1, is reproduced in full in `public/fonts/OFL.txt` and below.

```
Copyright 2019 The Sora Project Authors (https://github.com/sora-xor/sora-font)

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

## Media

Every drawing (the landing eyepiece views, the compass, the packet page, the icons, the favicon) is drawn in code for this app (licence `original`).
