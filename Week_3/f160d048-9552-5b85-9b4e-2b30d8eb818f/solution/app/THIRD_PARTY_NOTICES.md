# Third-party notices

Candour Bench ships no runtime dependency: the production dependency tree (`npm ls --omit=dev`) is empty.
Every package below is a build-time input that is bundled into `dist/` by Vite and esbuild (the server in `dist/server.cjs`, the page in `dist/client/`), or a type or tooling package used only to build.

## Font

| File | Family | Licence | Source |
|---|---|---|---|
| `public/fonts/literata-*-wght-*.woff2` (latin and latin-ext, normal and italic) | Literata (variable) | OFL-1.1 | https://github.com/googlefonts/literata, packaged by `@fontsource-variable/literata` |

Literata is bundled as self-hosted WOFF2 files. Its licence is the SIL Open Font License 1.1, reproduced in full below.

## Icons

Menu, close, bookmark, star, slider and alert icons are inline SVG from `lucide-react` (ISC), bundled into the page.

## Drawings

The lab glassware (pipette rack, flask, centrifuge rotor) and the pay band specimen are drawn by the app as inline SVG: licence `original`.

## Packages

| Package | Version | Licence | Copyright | Use |
|---|---|---|---|---|
| @babel/code-frame | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors | bundled or build tooling |
| @babel/compat-data | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors | bundled or build tooling |
| @babel/core | 7.29.13 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors | bundled or build tooling |
| @babel/generator | 7.29.13 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors | bundled or build tooling |
| @babel/helper-compilation-targets | 7.29.13 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors | bundled or build tooling |
| @babel/helper-globals | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors | bundled or build tooling |
| @babel/helper-module-imports | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors | bundled or build tooling |
| @babel/helper-module-transforms | 7.29.13 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors | bundled or build tooling |
| @babel/helper-plugin-utils | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors | bundled or build tooling |
| @babel/helper-string-parser | 7.29.13 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors | bundled or build tooling |
| @babel/helper-validator-identifier | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors | bundled or build tooling |
| @babel/helper-validator-option | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors | bundled or build tooling |
| @babel/helpers | 7.29.13 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors | bundled or build tooling |
| @babel/parser | 7.29.13 | MIT | Copyright (C) 2012-2014 by various contributors (see AUTHORS) | bundled or build tooling |
| @babel/plugin-transform-react-jsx-self | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors | bundled or build tooling |
| @babel/plugin-transform-react-jsx-source | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors | bundled or build tooling |
| @babel/template | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors | bundled or build tooling |
| @babel/traverse | 7.29.13 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors | bundled or build tooling |
| @babel/types | 7.29.11 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors | bundled or build tooling |
| @esbuild/aix-ppc64 | 0.28.2 | MIT |  | bundled or build tooling |
| @esbuild/android-arm | 0.28.2 | MIT |  | bundled or build tooling |
| @esbuild/android-arm64 | 0.28.2 | MIT |  | bundled or build tooling |
| @esbuild/android-x64 | 0.28.2 | MIT |  | bundled or build tooling |
| @esbuild/darwin-arm64 | 0.28.2 | MIT |  | bundled or build tooling |
| @esbuild/darwin-x64 | 0.28.2 | MIT |  | bundled or build tooling |
| @esbuild/freebsd-arm64 | 0.28.2 | MIT |  | bundled or build tooling |
| @esbuild/freebsd-x64 | 0.28.2 | MIT |  | bundled or build tooling |
| @esbuild/linux-arm | 0.28.2 | MIT |  | bundled or build tooling |
| @esbuild/linux-arm64 | 0.28.2 | MIT |  | bundled or build tooling |
| @esbuild/linux-ia32 | 0.28.2 | MIT |  | bundled or build tooling |
| @esbuild/linux-loong64 | 0.28.2 | MIT |  | bundled or build tooling |
| @esbuild/linux-mips64el | 0.28.2 | MIT |  | bundled or build tooling |
| @esbuild/linux-ppc64 | 0.28.2 | MIT |  | bundled or build tooling |
| @esbuild/linux-riscv64 | 0.28.2 | MIT |  | bundled or build tooling |
| @esbuild/linux-s390x | 0.28.2 | MIT |  | bundled or build tooling |
| @esbuild/linux-x64 | 0.28.2 | MIT |  | bundled or build tooling |
| @esbuild/netbsd-arm64 | 0.28.2 | MIT |  | bundled or build tooling |
| @esbuild/netbsd-x64 | 0.28.2 | MIT |  | bundled or build tooling |
| @esbuild/openbsd-arm64 | 0.28.2 | MIT |  | bundled or build tooling |
| @esbuild/openbsd-x64 | 0.28.2 | MIT |  | bundled or build tooling |
| @esbuild/openharmony-arm64 | 0.28.2 | MIT |  | bundled or build tooling |
| @esbuild/sunos-x64 | 0.28.2 | MIT |  | bundled or build tooling |
| @esbuild/win32-arm64 | 0.28.2 | MIT |  | bundled or build tooling |
| @esbuild/win32-ia32 | 0.28.2 | MIT |  | bundled or build tooling |
| @esbuild/win32-x64 | 0.28.2 | MIT |  | bundled or build tooling |
| @fontsource-variable/literata | 5.3.0 | OFL-1.1 | Copyright 2017 The Literata Project Authors (https://github.com/googlefonts/literata) Literata-Italic[opsz,wght].ttf: Copyright 2017 The Literata Project Authors (https://github.com/googlefonts/literata) | bundled or build tooling |
| @jridgewell/gen-mapping | 0.3.13 | MIT | Copyright 2024 Justin Ridgewell <justin@ridgewell.name> | bundled or build tooling |
| @jridgewell/remapping | 2.3.5 | MIT | Copyright 2024 Justin Ridgewell <justin@ridgewell.name> | bundled or build tooling |
| @jridgewell/resolve-uri | 3.1.2 | MIT | Copyright 2019 Justin Ridgewell <jridgewell@google.com> | bundled or build tooling |
| @jridgewell/sourcemap-codec | 1.6.0 | MIT | Copyright 2024 Justin Ridgewell <justin@ridgewell.name> | bundled or build tooling |
| @jridgewell/trace-mapping | 0.3.31 | MIT | Copyright 2024 Justin Ridgewell <justin@ridgewell.name> | bundled or build tooling |
| @rolldown/pluginutils | 1.0.0-rc.3 | MIT | Copyright (c) 2024-present VoidZero Inc. & Contributors | bundled or build tooling |
| @rollup/rollup-android-arm-eabi | 4.67.5 | MIT |  | bundled or build tooling |
| @rollup/rollup-android-arm64 | 4.67.5 | MIT |  | bundled or build tooling |
| @rollup/rollup-android-x64 | 4.67.5 | MIT |  | bundled or build tooling |
| @rollup/rollup-darwin-arm64 | 4.67.5 | MIT |  | bundled or build tooling |
| @rollup/rollup-darwin-x64 | 4.67.5 | MIT |  | bundled or build tooling |
| @rollup/rollup-freebsd-arm64 | 4.67.5 | MIT |  | bundled or build tooling |
| @rollup/rollup-freebsd-x64 | 4.67.5 | MIT |  | bundled or build tooling |
| @rollup/rollup-linux-arm-gnueabihf | 4.67.5 | MIT |  | bundled or build tooling |
| @rollup/rollup-linux-arm-musleabihf | 4.67.5 | MIT |  | bundled or build tooling |
| @rollup/rollup-linux-arm64-gnu | 4.67.5 | MIT |  | bundled or build tooling |
| @rollup/rollup-linux-arm64-musl | 4.67.5 | MIT |  | bundled or build tooling |
| @rollup/rollup-linux-loong64-gnu | 4.67.5 | MIT |  | bundled or build tooling |
| @rollup/rollup-linux-loong64-musl | 4.67.5 | MIT |  | bundled or build tooling |
| @rollup/rollup-linux-ppc64-gnu | 4.67.5 | MIT |  | bundled or build tooling |
| @rollup/rollup-linux-ppc64-musl | 4.67.5 | MIT |  | bundled or build tooling |
| @rollup/rollup-linux-riscv64-gnu | 4.67.5 | MIT |  | bundled or build tooling |
| @rollup/rollup-linux-riscv64-musl | 4.67.5 | MIT |  | bundled or build tooling |
| @rollup/rollup-linux-s390x-gnu | 4.67.5 | MIT |  | bundled or build tooling |
| @rollup/rollup-linux-x64-gnu | 4.67.5 | MIT |  | bundled or build tooling |
| @rollup/rollup-linux-x64-musl | 4.67.5 | MIT |  | bundled or build tooling |
| @rollup/rollup-openbsd-x64 | 4.67.5 | MIT |  | bundled or build tooling |
| @rollup/rollup-openharmony-arm64 | 4.67.5 | MIT |  | bundled or build tooling |
| @rollup/rollup-win32-arm64-msvc | 4.67.5 | MIT |  | bundled or build tooling |
| @rollup/rollup-win32-ia32-msvc | 4.67.5 | MIT |  | bundled or build tooling |
| @rollup/rollup-win32-x64-gnu | 4.67.5 | MIT |  | bundled or build tooling |
| @rollup/rollup-win32-x64-msvc | 4.67.5 | MIT |  | bundled or build tooling |
| @types/babel__core | 7.20.5 | MIT | Copyright (c) Microsoft Corporation. | bundled or build tooling |
| @types/babel__generator | 7.27.0 | MIT | Copyright (c) Microsoft Corporation. | bundled or build tooling |
| @types/babel__template | 7.4.4 | MIT | Copyright (c) Microsoft Corporation. | bundled or build tooling |
| @types/babel__traverse | 7.28.0 | MIT | Copyright (c) Microsoft Corporation. | bundled or build tooling |
| @types/estree | 1.0.10 | MIT | Copyright (c) Microsoft Corporation. | bundled or build tooling |
| @types/node | 22.20.5 | MIT | Copyright (c) Microsoft Corporation. | bundled or build tooling |
| @types/pg | 8.23.1 | MIT | Copyright (c) Microsoft Corporation. | bundled or build tooling |
| @types/react | 19.3.0 | MIT | Copyright (c) Microsoft Corporation. | bundled or build tooling |
| @types/react-dom | 19.3.0 | MIT | Copyright (c) Microsoft Corporation. | bundled or build tooling |
| @vitejs/plugin-react | 5.2.0 | MIT | Copyright (c) 2019-present, Yuxi (Evan) You and Vite contributors | bundled or build tooling |
| baseline-browser-mapping | 2.11.35 | Apache-2.0 | "Licensor" shall mean the copyright owner or entity authorized by | bundled or build tooling |
| browserslist | 4.29.5 | MIT | Copyright 2014 Andrey Sitnik <andrey@sitnik.es> and other contributors | bundled or build tooling |
| caniuse-lite | 1.0.30001822 | CC-BY-4.0 | original works of authorship and other material subject to copyright | bundled or build tooling |
| convert-source-map | 2.0.0 | MIT | Copyright 2013 Thorsten Lorenz. | bundled or build tooling |
| csstype | 3.2.3 | MIT | Copyright (c) 2017-2018 Fredrik Nicol | bundled or build tooling |
| debug | 4.4.3 | MIT | Copyright (c) 2014-2017 TJ Holowaychuk <tj@vision-media.ca> | bundled or build tooling |
| electron-to-chromium | 1.5.477 | ISC | Copyright 2018 Kilian Valkhof | bundled or build tooling |
| esbuild | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace | bundled or build tooling |
| escalade | 3.2.0 | MIT | Copyright (c) Luke Edwards <luke.edwards05@gmail.com> (lukeed.com) | bundled or build tooling |
| fdir | 6.5.0 | MIT | Copyright 2023 Abdullah Atta | bundled or build tooling |
| fsevents | 2.3.3 | MIT |  | bundled or build tooling |
| gensync | 1.0.0-beta.2 | MIT | Copyright 2018 Logan Smyth <loganfsmyth@gmail.com> | bundled or build tooling |
| js-tokens | 4.0.0 | MIT | Copyright (c) 2014, 2015, 2016, 2017, 2018 Simon Lydell | bundled or build tooling |
| jsesc | 3.1.0 | MIT | Copyright Mathias Bynens <https://mathiasbynens.be/> | bundled or build tooling |
| json5 | 2.2.3 | MIT | Copyright (c) 2012-2018 Aseem Kishore, and [others]. | bundled or build tooling |
| lru-cache | 5.1.1 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors | bundled or build tooling |
| lucide-react | 1.69.0 | ISC | Copyright (c) 2026 Lucide Icons and Contributors | bundled or build tooling |
| ms | 2.1.3 | MIT | Copyright (c) 2020 Vercel, Inc. | bundled or build tooling |
| nanoid | 3.3.20 | MIT | Copyright 2017 Andrey Sitnik <andrey@sitnik.ru> | bundled or build tooling |
| node-releases | 2.0.63 | MIT | Copyright (c) 2017 Sergey Rubanov (https://github.com/chicoxyzzy) | bundled or build tooling |
| pg | 8.23.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson | bundled or build tooling |
| pg-cloudflare | 1.4.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson | bundled or build tooling |
| pg-connection-string | 2.14.1 | MIT | Copyright (c) 2014 Iced Development | bundled or build tooling |
| pg-int8 | 1.0.1 | ISC | Copyright © 2017, Charmander <~@charmander.me> | bundled or build tooling |
| pg-pool | 3.14.0 | MIT | Copyright (c) 2017 Brian M. Carlson | bundled or build tooling |
| pg-protocol | 1.16.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson | bundled or build tooling |
| pg-types | 2.2.0 | MIT |  | bundled or build tooling |
| pgpass | 1.0.5 | MIT |  | bundled or build tooling |
| picocolors | 1.1.1 | ISC | Copyright (c) 2021-2024 Oleksii Raspopov, Kostiantyn Denysov, Anton Verinov | bundled or build tooling |
| picomatch | 4.0.7 | MIT | Copyright (c) 2017-present, Jon Schlinkert. | bundled or build tooling |
| postcss | 8.5.32 | MIT | Copyright 2013 Andrey Sitnik <andrey@sitnik.es> | bundled or build tooling |
| postgres-array | 2.0.0 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) | bundled or build tooling |
| postgres-bytea | 1.0.1 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) | bundled or build tooling |
| postgres-date | 1.0.7 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) | bundled or build tooling |
| postgres-interval | 1.2.0 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) | bundled or build tooling |
| react | 19.3.1 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. | bundled or build tooling |
| react-dom | 19.3.1 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. | bundled or build tooling |
| react-refresh | 0.18.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. | bundled or build tooling |
| rollup | 4.67.5 | MIT | Copyright (c) 2017 [these people](https://github.com/rollup/rollup/graphs/contributors) | bundled or build tooling |
| scheduler | 0.28.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. | bundled or build tooling |
| semver | 6.3.2 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors | bundled or build tooling |
| source-map-js | 1.2.2 | BSD-3-Clause | Copyright (c) 2009-2011, Mozilla Foundation and contributors | bundled or build tooling |
| split2 | 4.2.0 | ISC | Copyright (c) 2014-2018, Matteo Collina <hello@matteocollina.com> | bundled or build tooling |
| tinyglobby | 0.2.17 | MIT | Copyright (c) 2024 Madeline Gurriarán | bundled or build tooling |
| typescript | 5.9.3 | Apache-2.0 | "Licensor" shall mean the copyright owner or entity authorized by the copyright owner that is granting the License. | bundled or build tooling |
| undici-types | 6.21.0 | MIT | Copyright (c) Matteo Collina and Undici contributors | bundled or build tooling |
| update-browserslist-db | 1.3.4 | MIT | Copyright 2022 Andrey Sitnik <andrey@sitnik.es> and other contributors | bundled or build tooling |
| vite | 7.3.7 | MIT | Copyright (c) 2019-present, VoidZero Inc. and Vite contributors | bundled or build tooling |
| xtend | 4.0.2 | MIT | Copyright (c) 2012-2014 Raynos. | bundled or build tooling |
| yallist | 3.1.1 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors | bundled or build tooling |

## SIL Open Font License 1.1 (Literata)

```text
Copyright 2017 The Literata Project Authors (https://github.com/googlefonts/literata) Literata-Italic[opsz,wght].ttf: Copyright 2017 The Literata Project Authors (https://github.com/googlefonts/literata)

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
