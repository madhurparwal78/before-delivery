# Third-party notices

Undersign ships the packages below. The first table is the production dependency tree (`npm ls --omit=dev --all`) that the server runs. The second table lists the build-time packages (the React/Vite client toolchain, pdf.js and icons) whose output is bundled into `dist/client` or used only to build. Fonts are listed with their full SIL Open Font License text at the end.

## Production packages (server runtime)

| Package | Version | Licence | Copyright |
|---|---|---|---|
| @hono/node-server | 1.19.18 | MIT | Copyright (c) Yusuke Wada <yusuke@kamawada.com> (https://github.com/yusukebe) |
| hono | 4.13.16 | MIT | Copyright (c) Yusuke Wada <yusuke@kamawada.com> (https://github.com/yusukebe) |
| pg | 8.23.1 | MIT | Copyright (c) Brian Carlson <brian.m.carlson@gmail.com> |
| pg-cloudflare | 1.4.1 | MIT | Copyright (c) the package authors |
| pg-connection-string | 2.14.1 | MIT | Copyright (c) Blaine Bublitz <blaine@iceddev.com> (http://iceddev.com/) |
| pg-int8 | 1.0.1 | ISC | Copyright (c) the package authors |
| pg-pool | 3.14.0 | MIT | Copyright (c) Brian M. Carlson |
| pg-protocol | 1.16.1 | MIT | Copyright (c) the package authors |
| pg-types | 2.2.0 | MIT | Copyright (c) Brian M. Carlson |
| pgpass | 1.0.5 | MIT | Copyright (c) Hannes Hörl <hannes.hoerl+pgpass@snowreporter.com> |
| postgres-array | 2.0.0 | MIT | Copyright (c) Ben Drucker |
| postgres-bytea | 1.0.1 | MIT | Copyright (c) Ben Drucker |
| postgres-date | 1.0.7 | MIT | Copyright (c) Ben Drucker |
| postgres-interval | 1.2.0 | MIT | Copyright (c) Ben Drucker |
| split2 | 4.2.0 | ISC | Copyright (c) Matteo Collina <hello@matteocollina.com> |
| xtend | 4.0.2 | MIT | Copyright (c) Raynos <raynos2@gmail.com> |

## Build-time packages (client bundle and toolchain)

| Package | Version | Licence | Copyright |
|---|---|---|---|
| @babel/code-frame | 7.29.7 | MIT | Copyright (c) The Babel Team (https://babel.dev/team) |
| @babel/compat-data | 7.29.7 | MIT | Copyright (c) The Babel Team (https://babel.dev/team) |
| @babel/core | 7.29.7 | MIT | Copyright (c) The Babel Team (https://babel.dev/team) |
| @babel/generator | 7.29.12 | MIT | Copyright (c) The Babel Team (https://babel.dev/team) |
| @babel/helper-compilation-targets | 7.29.7 | MIT | Copyright (c) The Babel Team (https://babel.dev/team) |
| @babel/helper-module-imports | 7.29.7 | MIT | Copyright (c) The Babel Team (https://babel.dev/team) |
| @babel/helper-module-transforms | 7.29.7 | MIT | Copyright (c) The Babel Team (https://babel.dev/team) |
| @babel/helper-plugin-utils | 7.29.7 | MIT | Copyright (c) The Babel Team (https://babel.dev/team) |
| @babel/helper-validator-identifier | 7.29.7 | MIT | Copyright (c) The Babel Team (https://babel.dev/team) |
| @babel/helper-validator-option | 7.29.7 | MIT | Copyright (c) The Babel Team (https://babel.dev/team) |
| @babel/helpers | 7.29.10 | MIT | Copyright (c) The Babel Team (https://babel.dev/team) |
| @babel/parser | 7.29.12 | MIT | Copyright (c) The Babel Team (https://babel.dev/team) |
| @babel/plugin-transform-react-jsx-self | 7.29.7 | MIT | Copyright (c) The Babel Team (https://babel.dev/team) |
| @babel/plugin-transform-react-jsx-source | 7.29.7 | MIT | Copyright (c) The Babel Team (https://babel.dev/team) |
| @babel/template | 7.29.7 | MIT | Copyright (c) The Babel Team (https://babel.dev/team) |
| @babel/traverse | 7.29.12 | MIT | Copyright (c) The Babel Team (https://babel.dev/team) |
| @babel/types | 7.29.11 | MIT | Copyright (c) The Babel Team (https://babel.dev/team) |
| @jridgewell/gen-mapping | 0.3.13 | MIT | Copyright (c) Justin Ridgewell <justin@ridgewell.name> |
| @jridgewell/remapping | 2.3.5 | MIT | Copyright (c) Justin Ridgewell <justin@ridgewell.name> |
| @jridgewell/sourcemap-codec | 1.6.0 | MIT | Copyright (c) Justin Ridgewell <justin@ridgewell.name> |
| @jridgewell/trace-mapping | 0.3.31 | MIT | Copyright (c) Justin Ridgewell <justin@ridgewell.name> |
| @napi-rs/canvas | 0.1.100 | MIT | Copyright (c) the package authors |
| @napi-rs/canvas-darwin-arm64 | 0.1.100 | MIT | Copyright (c) the package authors |
| @rolldown/pluginutils | 1.0.0-rc.3 | MIT | Copyright (c) the package authors |
| @types/babel__core | 7.20.5 | MIT | Copyright (c) Troy Gerwien |
| @types/babel__generator | 7.27.0 | MIT | Copyright (c) Troy Gerwien |
| @types/babel__template | 7.4.4 | MIT | Copyright (c) Troy Gerwien |
| @types/babel__traverse | 7.28.0 | MIT | Copyright (c) Troy Gerwien |
| @types/node | 22.20.5 | MIT | Copyright (c) Microsoft TypeScript |
| @types/pg | 8.23.1 | MIT | Copyright (c) Phips Peter |
| @types/react | 19.3.0 | MIT | Copyright (c) Asana |
| @types/react-dom | 19.3.0 | MIT | Copyright (c) Asana |
| @vitejs/plugin-react | 5.2.0 | MIT | Copyright (c) Evan You |
| baseline-browser-mapping | 2.11.34 | Apache-2.0 | Copyright (c) the package authors |
| browserslist | 4.29.5 | MIT | Copyright (c) Andrey Sitnik <andrey@sitnik.es> |
| caniuse-lite | 1.0.30001820 | CC-BY-4.0 | Copyright (c) Ben Briggs |
| convert-source-map | 2.0.0 | MIT | Copyright (c) Thorsten Lorenz |
| debug | 4.4.3 | MIT | Copyright (c) Josh Junon (https://github.com/qix-) |
| electron-to-chromium | 1.5.472 | ISC | Copyright (c) Kilian Valkhof |
| escalade | 3.2.0 | MIT | Copyright (c) Luke Edwards |
| gensync | 1.0.0-beta.2 | MIT | Copyright (c) Logan Smyth <loganfsmyth@gmail.com> |
| js-tokens | 4.0.0 | MIT | Copyright (c) Simon Lydell |
| jsesc | 3.1.0 | MIT | Copyright (c) Mathias Bynens |
| json5 | 2.2.3 | MIT | Copyright (c) Aseem Kishore <aseem.kishore@gmail.com> |
| lru-cache | 5.1.1 | ISC | Copyright (c) Isaac Z. Schlueter <i@izs.me> |
| lucide-react | 1.66.0 | ISC | Copyright (c) Eric Fennis |
| ms | 2.1.3 | MIT | Copyright (c) the package authors |
| node-releases | 2.0.63 | MIT | Copyright (c) Sergey Rubanov <chi187@gmail.com> |
| pdfjs-dist | 5.7.284 | Apache-2.0 | Copyright (c) the package authors |
| picocolors | 1.1.1 | ISC | Copyright (c) Alexey Raspopov |
| react | 19.1.10 | MIT | Copyright (c) the package authors |
| react-dom | 19.1.10 | MIT | Copyright (c) the package authors |
| react-refresh | 0.18.0 | MIT | Copyright (c) the package authors |
| scheduler | 0.26.0 | MIT | Copyright (c) the package authors |
| semver | 6.3.1 | ISC | Copyright (c) GitHub Inc. |
| typescript | 5.9.3 | Apache-2.0 | Copyright (c) Microsoft Corp. |
| undici-types | 6.21.0 | MIT | Copyright (c) Daniele Belardi |
| update-browserslist-db | 1.3.4 | MIT | Copyright (c) Andrey Sitnik <andrey@sitnik.es> |
| vite | 7.3.7 | MIT | Copyright (c) Evan You |
| yallist | 3.1.1 | ISC | Copyright (c) Isaac Z. Schlueter <i@izs.me> (http://blog.izs.me/) |

## Fonts (SIL Open Font License 1.1)

| File | Family | Licence | Source |
|---|---|---|---|
| public/fonts/fraunces-latin-wght-normal.woff2 | Fraunces (variable, latin) | SIL OFL 1.1 (OFL-1.1-RFN or no-RFN) | https://github.com/undercasetype/Fraunces via Fontsource |
| public/fonts/public-sans-latin-wght-normal.woff2 | Public Sans (variable, latin) | SIL OFL 1.1 (OFL-1.1-RFN or no-RFN) | https://github.com/uswds/public-sans via Fontsource |
| public/fonts/ibm-plex-mono-latin-400-normal.woff2 | IBM Plex Mono 400 (latin) | SIL OFL 1.1 (OFL-1.1-RFN or no-RFN) | https://github.com/IBM/plex via Fontsource |
| public/fonts/ibm-plex-mono-latin-500-normal.woff2 | IBM Plex Mono 500 (latin) | SIL OFL 1.1 (OFL-1.1-RFN or no-RFN) | https://github.com/IBM/plex via Fontsource |

### Fraunces licence text

```text
Copyright 2020 The Fraunces Project Authors (github.com/undercasetype/Fraunces) Fraunces-Italic[SOFT,WONK,opsz,wght].ttf: Copyright 2020 The Fraunces Project Authors (github.com/undercasetype/Fraunces)

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

### Public Sans licence text

```text
Copyright 2015 The Public Sans Project Authors (https://github.com/uswds/public-sans) PublicSans-Italic[wght].ttf: Copyright 2015 The Public Sans Project Authors (https://github.com/uswds/public-sans)

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

### IBM Plex Mono licence text

```text
Copyright 2017 IBM Corp. All rights reserved. IBMPlexMono-ThinItalic.ttf: Copyright 2017 IBM Corp. All rights reserved. IBMPlexMono-ExtraLight.ttf: Copyright 2017 IBM Corp. All rights reserved. IBMPlexMono-ExtraLightItalic.ttf: Copyright 2017 IBM Corp. All rights reserved. IBMPlexMono-Light.ttf: Copyright 2017 IBM Corp. All rights reserved. IBMPlexMono-LightItalic.ttf: Copyright 2017 IBM Corp. All rights reserved. IBMPlexMono-Regular.ttf: Copyright 2017 IBM Corp. All rights reserved. IBMPlexMono-Italic.ttf: Copyright 2017 IBM Corp. All rights reserved. IBMPlexMono-Medium.ttf: Copyright 2017 IBM Corp. All rights reserved. IBMPlexMono-MediumItalic.ttf: Copyright 2017 IBM Corp. All rights reserved. IBMPlexMono-SemiBold.ttf: Copyright 2017 IBM Corp. All rights reserved. IBMPlexMono-SemiBoldItalic.ttf: Copyright 2017 IBM Corp. All rights reserved. IBMPlexMono-Bold.ttf: Copyright 2017 IBM Corp. All rights reserved. IBMPlexMono-BoldItalic.ttf: Copyright 2017 IBM Corp. All rights reserved.

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

No raster images, audio or video ship. The empty-state ledger sheet and every icon are inline SVG drawn for this app or taken from Lucide (ISC, listed above as lucide-react). The sample PDFs are generated by the server at request time from invented text.
