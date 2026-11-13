# Third-party notices

Sightline ships the packages below (the production tree of `npm ls --omit=dev --all`), three
fonts under the SIL Open Font License 1.1, and media made for this app.

## Packages

| Package | Version | Licence | Copyright |
|---|---|---|---|
| @pdf-lib/standard-fonts | 1.0.0 | MIT | Copyright (c) 2018 Andrew Dillon |
| @pdf-lib/upng | 1.0.1 | MIT | Copyright (c) 2017 Photopea |
| pako | 1.0.11 | (MIT AND Zlib) | Copyright (C) 2014-2017 by Vitaly Puzrin and Andrei Tuputcyn |
| pdf-lib | 1.17.1 | MIT | Copyright (c) 2019 Andrew Dillon |
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
| three | 0.187.0 | MIT | Copyright © 2010-2026 three.js authors |
| tslib | 1.14.1 | 0BSD | Copyright (c) Microsoft Corporation. |
| xtend | 4.0.2 | MIT | Copyright (c) 2012-2014 Raynos. |

## Fonts

Self-hosted woff2 files in `src/client/fonts/` (latin and latin-ext subsets copied from the Fontsource 5.3.0
packages), served from the app itself, never from a font CDN.

| Font | Source | Licence | Copyright |
|---|---|---|---|
| Instrument Serif | Fontsource instrument-serif 5.3.0 (`src/client/fonts/instrument-serif-*.woff2`) | OFL-1.1 | Copyright 2022 The Instrument Serif Project Authors (https://github.com/Instrument/instrument-serif) |
| Inter Tight | Fontsource inter-tight 5.3.0 (`src/client/fonts/inter-tight-*.woff2`) | OFL-1.1 | Copyright 2022 The Inter Project Authors (https://github.com/rsms/inter-tight) |
| JetBrains Mono | Fontsource jetbrains-mono 5.3.0 (`src/client/fonts/jetbrains-mono-*.woff2`) | OFL-1.1 | Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono) |

## Media

| File | Licence | Made by |
|---|---|---|
| assets/narration/chapter-1.mp3 | original | recorded for this app (macOS speech synthesis) |
| assets/narration/chapter-2.mp3 | original | recorded for this app (macOS speech synthesis) |
| assets/narration/chapter-3.mp3 | original | recorded for this app (macOS speech synthesis) |
| assets/narration/chapter-4.mp3 | original | recorded for this app (macOS speech synthesis) |
| assets/narration/chapter-5.mp3 | original | recorded for this app (macOS speech synthesis) |
| assets/narration/chapter-6.mp3 | original | recorded for this app (macOS speech synthesis) |
| assets/narration/chapter-7.mp3 | original | recorded for this app (macOS speech synthesis) |
| assets/narration/chapter-8.mp3 | original | recorded for this app (macOS speech synthesis) |
| plates (served from /api/media) | original | drawn procedurally by `src/server/plates.ts` at seed time |
| shard sculptures, still viewpoints, spring sculpture, classifier plot | original | drawn in code at runtime |
| icons and the empty-state mark | original | inline SVG paths drawn for this app |

## SIL Open Font License 1.1

The same licence text applies to all three fonts; each font's own copyright line is listed above.

```
Copyright 2022 The Inter Project Authors (https://github.com/rsms/inter-tight) InterTight-Italic[wght].ttf: Copyright 2022 The Inter Project Authors (https://github.com/rsms/inter-tight)

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
