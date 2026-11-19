# Third-party notices

Ottoline Rask Selected Builds ships **no third-party runtime package**: the production dependency tree
(`npm ls --omit=dev --all`) is empty. The server uses only Node.js built-in modules (`node:http`, `node:net`,
`node:crypto`, `node:fs`) and the browser code uses only web platform APIs.

## Fonts (shipped, self-hosted woff2 files in `public/fonts`)

All three font families are licensed under the SIL Open Font License, Version 1.1 (OFL-1.1). The files come from the
Fontsource distributions of the families (Fontsource packaging is MIT; the font files keep their OFL licence).

| Family | Files | Licence | Copyright |
|---|---|---|---|
| Fraunces (variable, latin subset, axes opsz, wght, SOFT, WONK) | `fraunces-latin-full-normal.woff2` | OFL-1.1 | Copyright 2018 The Fraunces Project Authors (https://github.com/undercasetype/Fraunces) |
| IBM Plex Sans (400, 500, 600, latin subset) | `ibm-plex-sans-latin-400-normal.woff2`, `ibm-plex-sans-latin-500-normal.woff2`, `ibm-plex-sans-latin-600-normal.woff2` | OFL-1.1 | Copyright 2019 IBM Corp. All rights reserved. |
| IBM Plex Mono (400, 500, latin subset) | `ibm-plex-mono-latin-400-normal.woff2`, `ibm-plex-mono-latin-500-normal.woff2` | OFL-1.1 | Copyright 2017 IBM Corp. All rights reserved. |

Source: https://fontsource.org (`@fontsource-variable/fraunces` 5.x, `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono`).

## Build tools (development dependencies, not shipped)

`esbuild` bundles the browser code into one script at build time; `typescript` type-checks the server and the browser code and compiles the server.

| Package | Version | Licence | Copyright |
|---|---|---|---|
| typescript | 5.9.3 | Apache-2.0 | Copyright (c) Microsoft Corporation |
| @types/node | 22.20.5 | MIT | Copyright (c) Microsoft Corporation |
| esbuild | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/aix-ppc64 (platform binary of esbuild, one installed per machine) | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/android-arm (platform binary of esbuild, one installed per machine) | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/android-arm64 (platform binary of esbuild, one installed per machine) | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/android-x64 (platform binary of esbuild, one installed per machine) | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/darwin-arm64 (platform binary of esbuild, one installed per machine) | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/darwin-x64 (platform binary of esbuild, one installed per machine) | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/freebsd-arm64 (platform binary of esbuild, one installed per machine) | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/freebsd-x64 (platform binary of esbuild, one installed per machine) | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/linux-arm (platform binary of esbuild, one installed per machine) | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/linux-arm64 (platform binary of esbuild, one installed per machine) | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/linux-ia32 (platform binary of esbuild, one installed per machine) | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/linux-loong64 (platform binary of esbuild, one installed per machine) | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/linux-mips64el (platform binary of esbuild, one installed per machine) | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/linux-ppc64 (platform binary of esbuild, one installed per machine) | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/linux-riscv64 (platform binary of esbuild, one installed per machine) | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/linux-s390x (platform binary of esbuild, one installed per machine) | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/linux-x64 (platform binary of esbuild, one installed per machine) | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/netbsd-arm64 (platform binary of esbuild, one installed per machine) | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/netbsd-x64 (platform binary of esbuild, one installed per machine) | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/openbsd-arm64 (platform binary of esbuild, one installed per machine) | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/openbsd-x64 (platform binary of esbuild, one installed per machine) | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/openharmony-arm64 (platform binary of esbuild, one installed per machine) | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/sunos-x64 (platform binary of esbuild, one installed per machine) | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/win32-arm64 (platform binary of esbuild, one installed per machine) | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/win32-ia32 (platform binary of esbuild, one installed per machine) | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/win32-x64 (platform binary of esbuild, one installed per machine) | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| undici-types (dependency of @types/node) | 6.21.0 | MIT | Copyright (c) Matteo Collina and Undici contributors |

## Artwork

Every picture is original and made for this site: the 42 cover and preview-frame objects are drawn by the server's own
code (`src/server/artwork`) and stored in the media library at start; the OR monogram sculpture, the service visuals
and the icons are inline vector drawings. Licence: original. No stock, third-party or remotely fetched image ships.

## SIL Open Font License, Version 1.1 (applies to every font file above)

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide development of collaborative font projects, to
support the font creation efforts of academic and linguistic communities, and to provide a free and open framework in
which fonts may be shared and improved in partnership with others.

The OFL allows the licensed fonts to be used, studied, modified and redistributed freely as long as they are not sold
by themselves. The fonts, including any derivative works, can be bundled, embedded, redistributed and/or sold with any
software provided that any reserved names are not used by derivative works. The fonts and derivatives, however, cannot
be released under any other type of license. The requirement for fonts to remain under this license does not apply to
any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright Holder(s) under this license and clearly marked as
such. This may include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the copyright statement(s).

"Original Version" refers to the collection of Font Software components as distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting, or substituting -- in part or in whole -- any
of the components of the Original Version, by changing formats or by porting the Font Software to a new environment.

"Author" refers to any designer, engineer, programmer, technical writer or other person who contributed to the Font
Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining a copy of the Font Software, to use, study, copy,
merge, embed, modify, redistribute, and sell modified and unmodified copies of the Font Software, subject to the
following conditions:

1) Neither the Font Software nor any of its individual components, in Original or Modified Versions, may be sold by
itself.

2) Original or Modified Versions of the Font Software may be bundled, redistributed and/or sold with any software,
provided that each copy contains the above copyright notice and this license. These can be included either as stand-alone
text files, human-readable headers or in the appropriate machine-readable metadata fields within text or binary files as
long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font Name(s) unless explicit written permission is
granted by the corresponding Copyright Holder. This restriction only applies to the primary font name as presented to
the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font Software shall not be used to promote, endorse
or advertise any Modified Version, except to acknowledge the contribution(s) of the Copyright Holder(s) and the
Author(s) or with their explicit written consent.

5) The Font Software, modified or unmodified, in part or in whole, must be distributed entirely under this license, and
must not be distributed under any other license. The requirement for fonts to remain under this license does not apply
to any document created using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF COPYRIGHT, PATENT,
TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM OTHER DEALINGS IN THE FONT
SOFTWARE.
