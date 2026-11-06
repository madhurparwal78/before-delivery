# Third-party notices

Every shipped package, every build-time package, and every bundled font, each with its licence. The shipped
packages are the production dependency tree (`npm ls --omit=dev --all`); the build bundles them into
`dist/server.js` and `dist/public/assets`.

## Shipped packages (the production dependency tree, bundled into dist/)

| Package | Version | Licence | Copyright |
|---|---|---|---|
| buffer-writer | 2.0.0 | MIT | Copyright the buffer-writer authors (Brian M. Carlson) |
| packet-reader | 1.0.0 | MIT | Copyright the packet-reader authors (Brian M. Carlson) |
| pg | 8.3.3 | MIT | Copyright (c) 2010 - 2020 Brian Carlson |
| pg-connection-string | 2.14.1 | MIT | Copyright (c) 2014 Iced Development |
| pg-int8 | 1.0.1 | ISC | Copyright © 2017, Charmander <~@charmander.me> |
| pg-pool | 3.14.0 | MIT | Copyright (c) 2017 Brian M. Carlson |
| pg-protocol | 1.16.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-types | 2.2.0 | MIT | Copyright the pg-types authors (Brian M. Carlson) |
| pgpass | 1.0.6 | MIT | Copyright the pgpass authors (Hannes Hörl <hannes.hoerl+pgpass@snowreporter.com>) |
| postgres-array | 2.0.0 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-bytea | 1.0.1 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-date | 1.0.7 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-interval | 1.2.0 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| semver | 7.7.3 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors |
| three | 0.180.0 | MIT | Copyright © 2010-2025 three.js authors |
| xtend | 4.0.2 | MIT | Copyright (c) 2012-2014 Raynos. |

## Build-time packages (not shipped to the browser or the server bundle)

| Package | Version | Licence | Copyright |
|---|---|---|---|
| @dimforge/rapier3d-compat | 0.12.0 | Apache-2.0 | Copyright 2020 Dimforge EURL |
| @esbuild/darwin-arm64 | 0.25.11 | MIT | Copyright the @esbuild/darwin-arm64 authors |
| @tweenjs/tween.js | 23.1.3 | MIT | Copyright (c) 2010-2012 Tween.js authors. |
| @types/node | 22.18.12 | MIT | Copyright (c) Microsoft Corporation. |
| @types/pg | 8.15.5 | MIT | Copyright (c) Microsoft Corporation. |
| @types/stats.js | 0.17.4 | MIT | Copyright (c) Microsoft Corporation. |
| @types/three | 0.180.0 | MIT | Copyright (c) Microsoft Corporation. |
| @types/webxr | 0.5.24 | MIT | Copyright (c) Microsoft Corporation. |
| @webgpu/types | 0.1.74 | BSD-3-Clause | Copyright 2022 WebGPU Developers |
| esbuild | 0.25.11 | MIT | Copyright (c) 2020 Evan Wallace |
| fflate | 0.8.3 | MIT | Copyright (c) 2026 Arjun Barrett |
| meshoptimizer | 0.22.0 | MIT | Copyright (c) 2016-2024 Arseny Kapoulkine |
| typescript | 5.9.3 | Apache-2.0 | Copyright the typescript authors (Microsoft Corp.) |
| undici-types | 6.21.0 | MIT | Copyright (c) Matteo Collina and Undici contributors |

## Bundled fonts

| Font | Files | Licence | Copyright |
|---|---|---|---|
| Montserrat (regular 400, semi-bold 600, latin) | `public/fonts/montserrat-latin-400-normal.woff2`, `public/fonts/montserrat-latin-600-normal.woff2` (Fontsource `@fontsource/montserrat` 5.3.0) | SIL Open Font License, Version 1.1 (OFL-1.1) | Copyright 2011 The Montserrat Project Authors (https://github.com/JulietaUla/Montserrat) |
| Open Sans (variable weight, latin) | `public/fonts/open-sans-latin-wght-normal.woff2` (Fontsource `@fontsource-variable/open-sans` 5.3.0) | SIL Open Font License, Version 1.1 (OFL-1.1) | Copyright 2020 The Open Sans Project Authors (https://github.com/googlefonts/opensans) |

## Original media

The hero scene, board silhouettes, empty-cart drawing, icons (drawn in the Lucide style for this app), favicon and the 3D board are drawn in code for this app (`original`).

## SIL Open Font License, Version 1.1 (Montserrat)

```
Copyright 2011 The Montserrat Project Authors (https://github.com/JulietaUla/Montserrat) Montserrat-Italic[wght].ttf: Copyright 2011 The Montserrat Project Authors (https://github.com/JulietaUla/Montserrat)

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

## SIL Open Font License, Version 1.1 (Open Sans)

```
Copyright 2020 The Open Sans Project Authors (https://github.com/googlefonts/opensans) OpenSans-Italic[wdth,wght].ttf: Copyright 2020 The Open Sans Project Authors (https://github.com/googlefonts/opensans)

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
