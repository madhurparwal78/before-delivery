# Third party notices

Open Bonnet ships the packages below, the Outfit font and the pictures it draws for itself.
Shipped packages are the production dependency tree, as `npm ls --omit=dev --all --json` reports
it; the build-only packages that produce `dist/` and `public/` follow them.

## Shipped packages

| Package | Version | Licence | Copyright |
|---|---|---|---|
| `@img/sharp-darwin-arm64` | 0.33.5 | Apache-2.0 | Copyright (c) Lovell Fuller and contributors |
| `@img/sharp-darwin-x64` | optional, installed only on its own platform | Apache-2.0 | Copyright (c) Lovell Fuller and contributors |
| `@img/sharp-libvips-darwin-arm64` | 1.0.4 | LGPL-3.0-or-later | Copyright (c) Lovell Fuller and contributors; libvips, Copyright (c) John Cupitt and contributors |
| `@img/sharp-libvips-darwin-x64` | optional, installed only on its own platform | LGPL-3.0-or-later | Copyright (c) Lovell Fuller and contributors; libvips, Copyright (c) John Cupitt and contributors |
| `@img/sharp-libvips-linux-arm` | optional, installed only on its own platform | LGPL-3.0-or-later | Copyright (c) Lovell Fuller and contributors; libvips, Copyright (c) John Cupitt and contributors |
| `@img/sharp-libvips-linux-arm64` | optional, installed only on its own platform | LGPL-3.0-or-later | Copyright (c) Lovell Fuller and contributors; libvips, Copyright (c) John Cupitt and contributors |
| `@img/sharp-libvips-linux-s390x` | optional, installed only on its own platform | LGPL-3.0-or-later | Copyright (c) Lovell Fuller and contributors; libvips, Copyright (c) John Cupitt and contributors |
| `@img/sharp-libvips-linux-x64` | optional, installed only on its own platform | LGPL-3.0-or-later | Copyright (c) Lovell Fuller and contributors; libvips, Copyright (c) John Cupitt and contributors |
| `@img/sharp-libvips-linuxmusl-arm64` | optional, installed only on its own platform | LGPL-3.0-or-later | Copyright (c) Lovell Fuller and contributors; libvips, Copyright (c) John Cupitt and contributors |
| `@img/sharp-libvips-linuxmusl-x64` | optional, installed only on its own platform | LGPL-3.0-or-later | Copyright (c) Lovell Fuller and contributors; libvips, Copyright (c) John Cupitt and contributors |
| `@img/sharp-linux-arm` | optional, installed only on its own platform | Apache-2.0 | Copyright (c) Lovell Fuller and contributors |
| `@img/sharp-linux-arm64` | optional, installed only on its own platform | Apache-2.0 | Copyright (c) Lovell Fuller and contributors |
| `@img/sharp-linux-s390x` | optional, installed only on its own platform | Apache-2.0 | Copyright (c) Lovell Fuller and contributors |
| `@img/sharp-linux-x64` | optional, installed only on its own platform | Apache-2.0 | Copyright (c) Lovell Fuller and contributors |
| `@img/sharp-linuxmusl-arm64` | optional, installed only on its own platform | Apache-2.0 | Copyright (c) Lovell Fuller and contributors |
| `@img/sharp-linuxmusl-x64` | optional, installed only on its own platform | Apache-2.0 | Copyright (c) Lovell Fuller and contributors |
| `@img/sharp-wasm32` | optional, installed only on its own platform | Apache-2.0 | Copyright (c) Lovell Fuller and contributors |
| `@img/sharp-win32-ia32` | optional, installed only on its own platform | Apache-2.0 | Copyright (c) Lovell Fuller and contributors |
| `@img/sharp-win32-x64` | optional, installed only on its own platform | Apache-2.0 | Copyright (c) Lovell Fuller and contributors |
| `color` | 4.2.3 | MIT | Copyright (c) the package authors |
| `color-convert` | 2.0.1 | MIT | Copyright (c) the package authors |
| `color-name` | 1.1.4 | MIT | Copyright (c) the package authors |
| `color-string` | 1.9.1 | MIT | Copyright (c) the package authors |
| `detect-libc` | 2.1.2 | Apache-2.0 | Copyright (c) Lovell Fuller and contributors |
| `is-arrayish` | 0.3.4 | MIT | Copyright (c) the package authors |
| `pg` | 8.13.1 | MIT | Copyright (c) the package authors |
| `pg-cloudflare` | 1.4.1 | MIT | Copyright (c) the package authors |
| `pg-connection-string` | 2.14.1 | MIT | Copyright (c) the package authors |
| `pg-int8` | 1.0.1 | ISC | Copyright (c) Charmander and contributors |
| `pg-native` | optional, installed only on its own platform | MIT | Copyright (c) the package authors |
| `pg-pool` | 3.14.0 | MIT | Copyright (c) the package authors |
| `pg-protocol` | 1.16.1 | MIT | Copyright (c) the package authors |
| `pg-types` | 2.2.0 | MIT | Copyright (c) the package authors |
| `pgpass` | 1.0.6 | MIT | Copyright (c) the package authors |
| `postgres-array` | 2.0.0 | MIT | Copyright (c) the package authors |
| `postgres-bytea` | 1.0.1 | MIT | Copyright (c) the package authors |
| `postgres-date` | 1.0.7 | MIT | Copyright (c) the package authors |
| `postgres-interval` | 1.2.0 | MIT | Copyright (c) the package authors |
| `semver` | 7.8.6 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors |
| `sharp` | 0.33.5 | Apache-2.0 | Copyright (c) Lovell Fuller and contributors |
| `simple-swizzle` | 0.2.4 | MIT | Copyright (c) the package authors |
| `three` | 0.170.0 | MIT | Copyright (c) 2010-2024 three.js authors |
| `xtend` | 4.0.2 | MIT | Copyright (c) the package authors |

The `@img/sharp-libvips-*` packages carry libvips under the GNU Lesser General Public License,
version 3 or later. They are used unmodified, as dynamically loaded libraries, and their source is
available from https://github.com/lovell/sharp-libvips.

## Build-only packages

These produce the server bundle, the client bundle and the stylesheet. They are not part of the
production dependency tree and none of their code is served.

| Package | Version | Licence | Copyright |
|---|---|---|---|
| `@esbuild/aix-ppc64` | 0.24.2 | MIT | Copyright (c) 2020 Evan Wallace |
| `@esbuild/android-arm` | 0.24.2 | MIT | Copyright (c) 2020 Evan Wallace |
| `@esbuild/android-arm64` | 0.24.2 | MIT | Copyright (c) 2020 Evan Wallace |
| `@esbuild/android-x64` | 0.24.2 | MIT | Copyright (c) 2020 Evan Wallace |
| `@esbuild/darwin-arm64` | 0.24.2 | MIT | Copyright (c) 2020 Evan Wallace |
| `@esbuild/darwin-x64` | 0.24.2 | MIT | Copyright (c) 2020 Evan Wallace |
| `@esbuild/freebsd-arm64` | 0.24.2 | MIT | Copyright (c) 2020 Evan Wallace |
| `@esbuild/freebsd-x64` | 0.24.2 | MIT | Copyright (c) 2020 Evan Wallace |
| `@esbuild/linux-arm` | 0.24.2 | MIT | Copyright (c) 2020 Evan Wallace |
| `@esbuild/linux-arm64` | 0.24.2 | MIT | Copyright (c) 2020 Evan Wallace |
| `@esbuild/linux-ia32` | 0.24.2 | MIT | Copyright (c) 2020 Evan Wallace |
| `@esbuild/linux-loong64` | 0.24.2 | MIT | Copyright (c) 2020 Evan Wallace |
| `@esbuild/linux-mips64el` | 0.24.2 | MIT | Copyright (c) 2020 Evan Wallace |
| `@esbuild/linux-ppc64` | 0.24.2 | MIT | Copyright (c) 2020 Evan Wallace |
| `@esbuild/linux-riscv64` | 0.24.2 | MIT | Copyright (c) 2020 Evan Wallace |
| `@esbuild/linux-s390x` | 0.24.2 | MIT | Copyright (c) 2020 Evan Wallace |
| `@esbuild/linux-x64` | 0.24.2 | MIT | Copyright (c) 2020 Evan Wallace |
| `@esbuild/netbsd-arm64` | 0.24.2 | MIT | Copyright (c) 2020 Evan Wallace |
| `@esbuild/netbsd-x64` | 0.24.2 | MIT | Copyright (c) 2020 Evan Wallace |
| `@esbuild/openbsd-arm64` | 0.24.2 | MIT | Copyright (c) 2020 Evan Wallace |
| `@esbuild/openbsd-x64` | 0.24.2 | MIT | Copyright (c) 2020 Evan Wallace |
| `@esbuild/sunos-x64` | 0.24.2 | MIT | Copyright (c) 2020 Evan Wallace |
| `@esbuild/win32-arm64` | 0.24.2 | MIT | Copyright (c) 2020 Evan Wallace |
| `@esbuild/win32-ia32` | 0.24.2 | MIT | Copyright (c) 2020 Evan Wallace |
| `@esbuild/win32-x64` | 0.24.2 | MIT | Copyright (c) 2020 Evan Wallace |
| `esbuild` | 0.24.2 | MIT | Copyright (c) 2020 Evan Wallace |
| `typescript` | 5.7.2 | Apache-2.0 | Copyright (c) Microsoft Corporation |
| `@types/node` | 22.10.2 | MIT | Copyright (c) Microsoft Corporation and DefinitelyTyped contributors |
| `@types/pg` | 8.11.10 | MIT | Copyright (c) Microsoft Corporation and DefinitelyTyped contributors |
| `@types/three` | 0.170.0 | MIT | Copyright (c) Microsoft Corporation and DefinitelyTyped contributors |
| `@types/stats.js` | 0.17.4 | MIT | Copyright (c) Microsoft Corporation and DefinitelyTyped contributors |
| `@types/webxr` | 0.5.24 | MIT | Copyright (c) Microsoft Corporation and DefinitelyTyped contributors |
| `@tweenjs/tween.js` | 23.1.3 | MIT | Copyright (c) 2010-2012 tween.js authors |
| `@webgpu/types` | 0.1.74 | BSD-3-Clause | Copyright (c) 2019 WebGPU authors |
| `fflate` | 0.8.3 | MIT | Copyright (c) 2023 Arjun Barrett |
| `meshoptimizer` | 0.18.1 | MIT | Copyright (c) 2016-2023 Arseny Kapoulkine |
| `obuf` | 1.1.2 | MIT | Copyright (c) Fedor Indutny |
| `pg-numeric` | 1.0.2 | ISC | Copyright (c) Charmander and contributors |
| `postgres-range` | 1.1.4 | MIT | Copyright (c) the package authors |
| `undici-types` | 6.20.0 | MIT | Copyright (c) Matteo Collina and Undici contributors |

## Font

**Outfit**, by the Outfit Project Authors, under the SIL Open Font License 1.1. The latin subset is
self-hosted in `public/fonts/` at weights 400, 500, 600 and 700, taken from the `@fontsource/outfit`
package. No font is loaded from another origin.

```
Copyright 2021 The Outfit Project Authors (https://github.com/Outfitio/Outfit-Fonts)

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

## Pictures

Every picture in this product is made in this project and carries no third party licence:

- the faceted car, its markers and the drawn still (`src/shared/scene.ts`, `src/web/stage/`),
- the top-down panel diagram (`src/shared/diagram.ts`),
- the Open Bonnet mark, the favicon and the two record plate marks (`src/web/pages/buyer.ts`,
  `src/web/parts/plate.ts`, `public/favicon.svg`),
- the owner story panel's dawn lane (`src/web/parts/story.ts`),
- the procedural road terrain band (`src/web/parts/terrain.ts`),
- the seeded finding photos and the seeded invoice, drawn at seed time (`src/server/db/seed-art.ts`).
