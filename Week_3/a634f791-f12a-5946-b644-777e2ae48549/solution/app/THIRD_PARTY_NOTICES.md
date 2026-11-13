# Third-party notices

Northfall Reference Desk ships the Python packages below (the whole production tree that
`run.json`'s install command installs from `requirements.txt`; no npm package ships) and two fonts.
Images are listed in `IMAGE_MANIFEST.md`.

## Python packages

| Package | Version | Licence | Copyright |
|---|---|---|---|
| blinker | 1.9.0 | MIT | Copyright 2010 Jason Kirtland |
| click | 8.5.0 | BSD-3-Clause | Copyright 2014 Pallets |
| flask | 3.1.3 | BSD-3-Clause | Copyright 2010 Pallets |
| gunicorn | 26.2.0 | MIT | Copyright 2009 Benoît Chesneau, Copyright 2009-2015 Paul J. Davis |
| itsdangerous | 2.2.0 | BSD-3-Clause | Copyright 2011 Pallets |
| jinja2 | 3.1.6 | BSD-3-Clause | Copyright 2007 Pallets |
| markupsafe | 3.0.4 | BSD-3-Clause | Copyright 2010 Pallets |
| pip | the version `python3 -m venv` seeds into `.venv` (25.0.1 with Python 3.12.14) | MIT | Copyright The pip developers |
| packaging | 26.3 | Apache-2.0 OR BSD-2-Clause | Copyright Donald Stufft and individual contributors |
| psycopg | 3.3.6 | LGPL-3.0-only | Copyright 2020 The Psycopg Team |
| psycopg-binary | 3.3.6 | LGPL-3.0-only | Copyright 2020 The Psycopg Team (the wheel also bundles libpq under the PostgreSQL Licence and OpenSSL under Apache-2.0) |
| typing-extensions | 4.16.0 | PSF-2.0 | Copyright 2001 Python Software Foundation |
| tzdata | 2026.6 | Apache-2.0 | Copyright (c) 2020 Paul Ganssle; IANA time zone data in the public domain |
| werkzeug | 3.1.9 | BSD-3-Clause | Copyright 2007 Pallets |

psycopg and psycopg-binary are used unmodified as separate libraries; their source is available at
https://github.com/psycopg/psycopg under the GNU Lesser General Public License version 3.

## Fonts

Both fonts are self-hosted from `northfall/static/fonts/` (Latin subsets from Fontsource) and are
licensed under the SIL Open Font License, Version 1.1; the licence text follows.

| Font file | Family and weight | Licence | Copyright |
|---|---|---|---|
| source-serif-4-latin-300-normal.woff2 | Source Serif 4, Light 300 (Fontsource 5.3.1) | SIL Open Font License 1.1 | Copyright 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source' |
| inter-latin-500-normal.woff2 | Inter, Medium 500 (Fontsource 5.3.0) | SIL Open Font License 1.1 | Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter) |

## SIL Open Font License, Version 1.1

SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007


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
