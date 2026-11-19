# Third-party notices

Quarkyard ships the packages, font and vendored library below. Each is under a licence on the project's allow-list
(MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, Zlib, BlueOak-1.0.0, CC0-1.0; fonts OFL-1.1).
Regenerate with `npm run notices`.

## Shipped packages (production dependency tree, `npm ls --omit=dev --all`)

| Package | Version | Licence | Copyright |
|---|---|---|---|
| @fontsource/fira-sans | 5.3.0 | OFL-1.1 | "Font Software" refers to the set of files released by the Copyright |
| @types/react | 19.3.0 | MIT | Copyright (c) Microsoft Corporation. |
| csstype | 3.2.3 | MIT | Copyright (c) 2017-2018 Fredrik Nicol |
| lucide-react | 1.70.0 | ISC | Copyright (c) 2026 Lucide Icons and Contributors |
| pg | 8.23.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-cloudflare | 1.4.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-connection-string | 2.14.1 | MIT | Copyright (c) 2014 Iced Development |
| pg-int8 | 1.0.1 | ISC | Copyright © 2017, Charmander <~@charmander.me> |
| pg-pool | 3.14.0 | MIT | Copyright (c) 2017 Brian M. Carlson |
| pg-protocol | 1.16.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-types | 2.2.0 | MIT | see package metadata |
| pgpass | 1.0.5 | MIT | see package metadata |
| postgres-array | 2.0.0 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-bytea | 1.0.1 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-date | 1.0.7 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-interval | 1.2.0 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| react | 19.3.1 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| react-dom | 19.3.1 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| scheduler | 0.28.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| split2 | 4.2.0 | ISC | Copyright (c) 2014-2018, Matteo Collina <hello@matteocollina.com> |
| three | 0.187.0 | MIT | Copyright © 2010-2026 three.js authors |
| xtend | 4.0.2 | MIT | Copyright (c) 2012-2014 Raynos. |

## Vendored library

| Library | Version | Licence | Files |
|---|---|---|---|
| Manifold (manifold-3d), compiled to WebAssembly | 3.5.4 | Apache-2.0 | `third_party/manifold/manifold.js`, `third_party/manifold/manifold.wasm` |

Copyright the Manifold authors; the Apache License 2.0 text is in `third_party/manifold/LICENSE`.
Lucide icons (`lucide-react`, ISC) are inlined as SVG; Fira Sans is served from this app.

## Font licence: Fira Sans (SIL Open Font License 1.1)

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

## Build tooling (development dependencies, not shipped in the served app)

| Package | Version | Licence | Copyright |
|---|---|---|---|
| @dimforge/rapier3d-compat | 0.12.0 | Apache-2.0 | "Licensor" shall mean the copyright owner or entity authorized by |
| @esbuild/darwin-arm64 | 0.28.2 | MIT | see package metadata |
| @jridgewell/resolve-uri | 3.1.2 | MIT | Copyright 2019 Justin Ridgewell <jridgewell@google.com> |
| @jridgewell/sourcemap-codec | 1.6.0 | MIT | Copyright 2024 Justin Ridgewell <justin@ridgewell.name> |
| @jridgewell/trace-mapping | 0.3.31 | MIT | Copyright 2024 Justin Ridgewell <justin@ridgewell.name> |
| @rolldown/pluginutils | 1.0.1 | MIT | Copyright (c) 2026-present, rolldown/plugins repository contributors |
| @tweenjs/tween.js | 23.1.3 | MIT | Copyright (c) 2010-2012 Tween.js authors. |
| @types/chai | 5.2.3 | MIT | Copyright (c) Microsoft Corporation. |
| @types/deep-eql | 4.0.2 | MIT | Copyright (c) Microsoft Corporation. |
| @types/estree | 1.0.10 | MIT | Copyright (c) Microsoft Corporation. |
| @types/node | 22.20.5 | MIT | Copyright (c) Microsoft Corporation. |
| @types/pg | 8.23.1 | MIT | Copyright (c) Microsoft Corporation. |
| @types/react-dom | 19.3.0 | MIT | Copyright (c) Microsoft Corporation. |
| @types/stats.js | 0.17.4 | MIT | Copyright (c) Microsoft Corporation. |
| @types/three | 0.187.0 | MIT | Copyright (c) Microsoft Corporation. |
| @types/webxr | 0.5.24 | MIT | Copyright (c) Microsoft Corporation. |
| @typescript/typescript-darwin-arm64 | 7.0.2 | Apache-2.0 | "Licensor" shall mean the copyright owner or entity authorized by the copyright owner that is granting the License. |
| @vitejs/plugin-react | 6.2.1 | MIT | Copyright (c) 2019-present, Yuxi (Evan) You and Vite contributors |
| @vitest/mocker | 5.1.0 | MIT | Copyright (c) 2021-Present VoidZero Inc. and Vitest contributors |
| @vitest/spy | 5.1.0 | MIT | Copyright (c) 2021-Present VoidZero Inc. and Vitest contributors |
| assertion-error | 2.0.1 | MIT | Copyright (c) 2013 Jake Luer jake@qualiancy.com (http://qualiancy.com) |
| chai | 6.3.0 | MIT | Copyright (c) 2017 Chai.js Assertion Library |
| es-module-lexer | 2.3.2 | MIT | Copyright (C) 2018-2022 Guy Bedford |
| esbuild | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| estree-walker | 3.0.3 | MIT | Copyright (c) 2015-20 [these people](https://github.com/Rich-Harris/estree-walker/graphs/contributors) |
| expect-type | 1.4.0 | Apache-2.0 | Copyright 2024 Misha Kaletsky |
| fflate | 0.8.3 | MIT | Copyright (c) 2026 Arjun Barrett |
| magic-string | 1.4.5 | MIT | Copyright 2018 Rich Harris |
| meshoptimizer | 1.1.1 | MIT | Copyright (c) 2016-2026 Arseny Kapoulkine |
| obug | 3.0.0 | MIT | Copyright © 2025-PRESENT Kevin Deng (https://github.com/sxzz) |
| picomatch | 4.0.7 | MIT | Copyright (c) 2017-present, Jon Schlinkert. |
| std-env | 4.3.0 | MIT | Copyright (c) Pooya Parsa <pooya@pi0.io> |
| tinybench | 6.2.3 | MIT | Copyright (c) 2022 Tinylibs |
| tinyexec | 1.3.1 | MIT | Copyright (c) 2024 Tinylibs |
| tinyglobby | 0.2.17 | MIT | Copyright (c) 2024 Madeline Gurriarán |
| typescript | 7.0.2 | Apache-2.0 | "Licensor" shall mean the copyright owner or entity authorized by the copyright owner that is granting the License. |
| undici-types | 6.21.0 | MIT | Copyright (c) Matteo Collina and Undici contributors |
| vite | 8.3.6 | MIT | Copyright (c) 2019-present, VoidZero Inc. and Vite contributors |
| vitest | 5.1.0 | MIT | Copyright (c) 2021-Present VoidZero Inc. and Vitest contributors |
| why-is-node-running | 3.2.1 | MIT | Copyright (c) 2016 Mathias Buus |
