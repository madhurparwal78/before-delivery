# Third-party notices

Hangline ships the packages and fonts below. "Server" packages are the production dependency tree
(`npm ls --omit=dev --all`); "bundled" packages are compiled into the browser bundle in
`dist/client` at build time.

## Server packages (production dependency tree)

| Package | Version | Licence | Copyright |
|---|---|---|---|
| pg | 8.16.3 | MIT | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-cloudflare | 1.4.1 | MIT | Copyright (c) 2023 Brian Carlson |
| pg-connection-string | 2.14.1 | MIT | Copyright (c) 2014 Iced Development |
| pg-int8 | 1.0.1 | ISC | Copyright © 2017, Charmander |
| pg-pool | 3.14.0 | MIT | Copyright (c) 2017 Brian M. Carlson |
| pg-protocol | 1.16.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-types | 2.2.0 | MIT | Copyright (c) 2014 Brian M. Carlson |
| pgpass | 1.0.5 | MIT | Copyright (c) 2013-2016 Hannes Hörl |
| postgres-array | 2.0.0 | MIT | Copyright (c) Ben Drucker |
| postgres-bytea | 1.0.1 | MIT | Copyright (c) Ben Drucker |
| postgres-date | 1.0.7 | MIT | Copyright (c) Ben Drucker |
| postgres-interval | 1.2.0 | MIT | Copyright (c) Ben Drucker |
| split2 | 4.2.0 | ISC | Copyright (c) 2014-2021, Matteo Collina |
| xtend | 4.0.2 | MIT | Copyright (c) 2012-2014 Raynos |
| pg-native | not installed (optional peer of pg, listed by `npm ls` without a version) | MIT | Copyright (c) 2014 Brian M. Carlson |

## Bundled browser packages

| Package | Version | Licence | Copyright |
|---|---|---|---|
| react | 19.2.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates |
| react-dom | 19.2.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates |
| scheduler | 0.27.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates |
| three | 0.180.0 | MIT | Copyright © 2010-2025 three.js authors |

Build tools (TypeScript, Vite, @vitejs/plugin-react and their dependencies) run only at build time
and ship nothing.

## Fonts (self-hosted, served from the app's own origin)

| Font | Package | Weights | Licence | Copyright |
|---|---|---|---|---|
| Instrument Serif | @fontsource/instrument-serif 5.2.8 | 400 | OFL-1.1 (SIL Open Font License 1.1) | Copyright 2022 The Instrument Serif Project Authors |
| Hanken Grotesk | @fontsource/hanken-grotesk 5.2.8 | 400, 500, 600 | OFL-1.1 (SIL Open Font License 1.1) | Copyright 2021 The Hanken Grotesk Project Authors |

## Media

| File | Licence | Source |
|---|---|---|
| public/favicon.svg | original | drawn for Hangline |

The 3D gallery, flat drawings, hatch pattern and snapshot PNGs are drawn by the app's own code.

## SIL Open Font License, Version 1.1

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
