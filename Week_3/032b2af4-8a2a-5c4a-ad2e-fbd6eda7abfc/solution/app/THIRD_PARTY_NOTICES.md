# Third-party notices

Pacely ships the Python packages, the font and the media listed here. Every package is permissively licensed.

## Python packages (installed into `.venv` from `requirements.txt`)

| Package | Version | Licence | Copyright |
|---|---|---|---|
| anyio | 4.16.0 | MIT | Copyright (c) Alex Grönholm |
| asyncpg | 0.32.0 | Apache-2.0 | Copyright (c) MagicStack Inc. |
| click | 8.5.0 | BSD-3-Clause | Copyright 2014 Pallets |
| h11 | 0.16.0 | MIT | Copyright (c) 2016 Nathaniel J. Smith and other contributors |
| idna | 3.20 | BSD-3-Clause | Copyright (c) Kim Davies and contributors |
| Jinja2 | 3.1.6 | BSD-3-Clause | Copyright 2007 Pallets |
| MarkupSafe | 3.0.4 | BSD-3-Clause | Copyright 2010 Pallets |
| starlette | 1.10.0 | BSD-3-Clause | Copyright (c) Encode OSS Ltd. |
| typing_extensions | 4.16.0 | PSF-2.0 | Copyright (c) Python Software Foundation |
| tzdata | 2026.6 | Apache-2.0 | Copyright (c) Python Software Foundation |
| uvicorn | 0.54.0 | BSD-3-Clause | Copyright (c) Encode OSS Ltd. |
| pip | as installed by `python3 -m venv` | MIT | Copyright (c) The pip developers |

## Font

| File | Licence | Source |
|---|---|---|
| `static/fonts/inter-latin-wght-normal.woff2` (Inter variable, from the Fontsource package `@fontsource-variable/inter` 5.3.0) | OFL-1.1 | https://github.com/rsms/inter |

Inter: Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter). The full licence text follows; it is also
shipped as `static/fonts/OFL.txt`.

```
Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter) Inter-Italic[opsz,wght].ttf: Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)

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

| File | Licence | Source |
|---|---|---|
| `assets/gravel-road.jpg` | public domain | https://commons.wikimedia.org/wiki/File:White_Rim_Road_(Island_in_the_Sky)_(5a1f46fd-155d-451f-6742-0856f2ad632f).jpg (US National Park Service) |
| `assets/marathon-runners.jpg` | public domain | https://commons.wikimedia.org/wiki/File:51st_Marine_Corps_Marathon_Georgetown.jpg (US Marine Corps) |
| `assets/cyclists.webm` | public domain | https://commons.wikimedia.org/wiki/File:Gravel_bike_race_in_southeast_Oregon_(42340272145).webm (US Bureau of Land Management) |
| `assets/music.ogg` | original | synthesised for this app |

Icons, the logo, medals, crown and map drawings are original inline SVG made for this app. The kit modules `cursor` and
`idempotency` were adapted into `pacely/cursor.py` and `pacely/idempotency.py`, and `safe_redirect` into `static/js/core/api.js`.
