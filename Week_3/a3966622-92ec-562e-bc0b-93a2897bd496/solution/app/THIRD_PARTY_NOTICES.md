# Third-party notices

Slackwater ships the packages in the production dependency tree (`npm ls --omit=dev --all`) and three
self-hosted font families. Build-only tools are listed after them. The product's own code and drawings are original.

## Shipped packages

| Package | Version | Licence | Copyright |
|---|---|---|---|
| react | 19.3.1 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| react-dom | 19.3.1 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| scheduler | 0.28.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |

## Bundled fonts

| Font | Files | Licence | Copyright |
|---|---|---|---|
| Saira Condensed | `public/fonts/saira-condensed-latin-600-normal.woff2` | OFL-1.1 | Copyright 2016 The Saira Project Authors (omnibus.type@gmail.com), with reserved font name "Saira" |
| IBM Plex Sans | `public/fonts/ibm-plex-sans-latin-400-normal.woff2`, `public/fonts/ibm-plex-sans-latin-600-normal.woff2` | OFL-1.1 | Copyright 2019 IBM Corp. All rights reserved. |
| IBM Plex Mono | `public/fonts/ibm-plex-mono-latin-400-normal.woff2`, `public/fonts/ibm-plex-mono-latin-500-normal.woff2` | OFL-1.1 | Copyright 2017 IBM Corp. All rights reserved. |

The woff2 files are the latin subsets published by Fontsource (`@fontsource/saira-condensed`, `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono`, version 5.3.0).

## Build-only tools (not shipped)

esbuild and TypeScript install one native package for the build machine's platform (for example `@esbuild/linux-x64`, MIT, or `@typescript/typescript-linux-x64`, Apache-2.0); the rows below were read on the machine that wrote this file.

| Package | Version | Licence | Copyright |
|---|---|---|---|
| @esbuild/darwin-arm64 | 0.28.2 | MIT | see package |
| @types/node | 22.20.5 | MIT | Copyright (c) Microsoft Corporation. |
| @types/react | 19.3.0 | MIT | Copyright (c) Microsoft Corporation. |
| @types/react-dom | 19.3.0 | MIT | Copyright (c) Microsoft Corporation. |
| @typescript/typescript-darwin-arm64 | 7.0.2 | Apache-2.0 | see package |
| esbuild | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| typescript | 7.0.2 | Apache-2.0 | see package |
| undici-types | 6.21.0 | MIT | Copyright (c) Matteo Collina and Undici contributors |

## SIL Open Font License, Version 1.1

Applies to Saira Condensed (Copyright 2016 The Saira Project Authors), IBM Plex Sans (Copyright 2019 IBM Corp.) and IBM Plex Mono (Copyright 2017 IBM Corp.).

```
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
