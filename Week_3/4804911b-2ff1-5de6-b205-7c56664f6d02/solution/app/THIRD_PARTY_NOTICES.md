# Third-party notices

Interval ships the packages and fonts below. Every package is under MIT, ISC or Apache-2.0; both fonts are under the SIL Open Font License 1.1.

## Shipped packages (the production dependency tree)

| Package | Version | Licence | Copyright |
|---|---|---|---|
| @acuminous/bitsyntax | 0.1.2 | MIT | bitsyntax-js copyright © 2012-2014 |
| @phosphor-icons/core | 2.1.1 | MIT | Copyright © 2023 Phosphor Icons |
| amqplib | 0.10.5 | MIT | amqplib copyright © 2013, 2014 |
| buffer-more-ints | 1.0.0 | MIT | Copyright © 2012 David Wragg. All rights reserved. |
| debug | 4.4.3 | MIT | Copyright © 2014-2017 TJ Holowaychuk <tj@vision-media.ca> |
| ms | 2.1.3 | MIT | Copyright © 2020 Vercel, Inc. |
| pg | 8.13.1 | MIT | Copyright © 2010 - 2021 Brian Carlson |
| pg-cloudflare | 1.4.1 | MIT | Copyright © 2010 - 2021 Brian Carlson |
| pg-connection-string | 2.14.1 | MIT | Copyright © 2014 Iced Development |
| pg-int8 | 1.0.1 | ISC | Copyright © 2017, Charmander <~@charmander.me> |
| pg-pool | 3.14.0 | MIT | Copyright © 2017 Brian M. Carlson |
| pg-protocol | 1.16.1 | MIT | Copyright © 2010 - 2021 Brian Carlson |
| pg-types | 2.2.0 | MIT | Copyright © the pg-types authors (Brian M. Carlson) |
| pgpass | 1.0.6 | MIT | Copyright © the pgpass authors (Hannes Hörl <hannes.hoerl+pgpass@snowreporter.com>) |
| postgres-array | 2.0.0 | MIT | Copyright © Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-bytea | 1.0.1 | MIT | Copyright © Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-date | 1.0.7 | MIT | Copyright © Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-interval | 1.2.0 | MIT | Copyright © Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| preact | 10.25.4 | MIT | Copyright © 2015-present Jason Miller |
| querystringify | 2.2.0 | MIT | Copyright © 2015 Unshift.io, Arnout Kazemier,  the Contributors. |
| requires-port | 1.0.0 | MIT | Copyright © 2015 Unshift.io, Arnout Kazemier,  the Contributors. |
| safe-buffer | 5.1.2 | MIT | Copyright © Feross Aboukhadijeh |
| three | 0.171.0 | MIT | Copyright © 2010-2024 three.js authors |
| url-parse | 1.5.10 | MIT | Copyright © 2015 Unshift.io, Arnout Kazemier,  the Contributors. |
| xtend | 4.0.2 | MIT | Copyright © 2012-2014 Raynos. |

`three` (MIT) is installed as a build dependency and bundled into the browser script.
`@phosphor-icons/core` (MIT) is installed as a build dependency and bundled into the browser script as inline SVG paths.

Build tooling (esbuild, TypeScript, the `@types` packages and the `@fontsource` font sources) is installed only to build the app and does not ship.

## Bundled fonts

| Font | Files | Licence | Source |
|---|---|---|---|
| Bebas Neue | public/fonts/bebas-neue-latin-400-normal.woff2 | OFL-1.1 | https://fontsource.org/fonts/bebas-neue (Copyright 2010 The Bebas Neue Project Authors (https://github.com/dharmatype/Bebas-Neue)) |
| EB Garamond | public/fonts/eb-garamond-latin-400-italic.woff2, public/fonts/eb-garamond-latin-400-normal.woff2, public/fonts/eb-garamond-latin-600-italic.woff2, public/fonts/eb-garamond-latin-600-normal.woff2 | OFL-1.1 | https://fontsource.org/fonts/eb-garamond (Copyright 2017 The EB Garamond Project Authors (https://github.com/octaviopardo/EBGaramond12)) |

The full licence text of each font sits beside it as `public/fonts/BebasNeue-OFL.txt` and `public/fonts/EBGaramond-OFL.txt`; the text of the SIL Open Font License 1.1 is reproduced here:

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

