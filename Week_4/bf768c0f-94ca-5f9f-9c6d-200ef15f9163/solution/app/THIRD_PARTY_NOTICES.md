# Third-party notices

Gambit Hall ships the Python packages below (installed from `requirements.txt`, every version
pinned, transitive packages included) and one vendored browser library. Every image the app shows
is original work made for this app (see `assets.json`); it ships no font file and no sound file
(the six sounds are synthesised in the page with the Web Audio API).

## Python runtime packages

| Package | Version | Licence | Copyright |
|---|---|---|---|
| annotated-doc | 0.0.5 | MIT | Copyright (c) Sebastián Ramírez |
| annotated-types | 0.8.0 | MIT | Copyright (c) 2022 the contributors |
| anyio | 4.15.1 | MIT | Copyright (c) 2018 Alex Grönholm |
| click | 8.5.0 | BSD-3-Clause | Copyright 2014 Pallets |
| fastapi | 0.162.0 | MIT | Copyright (c) 2018 Sebastián Ramírez |
| h11 | 0.16.0 | MIT | Copyright (c) 2016 Nathaniel J. Smith and other contributors |
| idna | 3.20 | BSD-3-Clause | Copyright (c) 2013-2025, Kim Davies and contributors |
| Jinja2 | 3.1.6 | BSD-3-Clause | Copyright 2007 Pallets |
| MarkupSafe | 3.0.4 | BSD-3-Clause | Copyright 2010 Pallets |
| opentelemetry-api | 1.45.1 | Apache-2.0 | Copyright The OpenTelemetry Authors |
| pillow | 13.0.0 | MIT-CMU | Copyright (c) 1997-2011 Secret Labs AB; (c) 1995-2011 Fredrik Lundh and contributors; (c) 2010 Jeffrey A. Clark and contributors |
| psycopg | 3.3.6 | LGPL-3.0-only (named exception: psycopg) | Copyright (C) 2020 The Psycopg Team |
| psycopg-binary | 3.3.6 | LGPL-3.0-only (named exception: psycopg) | Copyright (C) 2020 The Psycopg Team |
| psycopg-pool | 3.3.3 | LGPL-3.0-only (named exception: psycopg) | Copyright (C) 2020 The Psycopg Team |
| pydantic | 2.14.1 | MIT | Copyright (c) 2017 to present Pydantic Services Inc. and individual contributors |
| pydantic_core | 2.50.1 | MIT | Copyright (c) 2022 Samuel Colvin |
| python-multipart | 0.0.32 | Apache-2.0 | Copyright 2012, Andrew Dunham |
| starlette | 1.9.0 | BSD-3-Clause | Copyright © 2018, Encode OSS Ltd. |
| typing-inspection | 0.4.4 | MIT | Copyright (c) 2025 Pydantic Services Inc. |
| typing_extensions | 4.16.0 | PSF-2.0 | Copyright (c) 2001-2025 Python Software Foundation |
| uvicorn | 0.54.0 | BSD-3-Clause | Copyright © 2017-present, Encode OSS Ltd. |

The interpreter's own `pip` and `setuptools`, used only by the install step, are MIT licensed.

## Vendored browser library

| Library | Version | File | Licence | Copyright |
|---|---|---|---|---|
| three.js | r160 | `app/static/vendor/three.module.js` | MIT (full text in `app/static/vendor/THREE-LICENSE.txt`) | Copyright © 2010-2023 three.js authors |

## Media

| Files | Licence | Made by |
|---|---|---|
| `app/static/avatars/avatar_01.png` to `avatar_12.png`, `house.png` | original | drawn for this app by a Pillow script |
| `app/static/favicon.svg` | original | hand-written for this app |
| the four flat piece sets, the icons, the board | original | inline SVG and CSS written for this app (`app/pieces.py`, `templates/_icons.html`) |
| the three deep piece sets | original | three.js geometry built in code for this app (`static/js/deep.js`) |
