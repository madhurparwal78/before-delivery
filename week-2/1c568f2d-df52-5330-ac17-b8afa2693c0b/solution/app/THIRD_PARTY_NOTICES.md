# Third-party notices

Every package the `install` command installs (the full production tree pinned in
`requirements.txt`, plus the `pip` the virtualenv bootstraps), with its licence. No test or development tool ships. No fonts, images, audio or
video files ship: every picture, the browser tab icon included, is drawn by the app in SVG and CSS
(`assets.json` is empty).

| Package | Version | Licence | Copyright |
|---|---|---|---|
| flask | 3.1.3 | BSD-3-Clause | Copyright 2010 Pallets |
| werkzeug | 3.1.9 | BSD-3-Clause | Copyright 2007 Pallets |
| jinja2 | 3.1.6 | BSD-3-Clause | Copyright 2007 Pallets |
| markupsafe | 3.0.4 | BSD-3-Clause | Copyright 2010 Pallets |
| itsdangerous | 2.2.0 | BSD-3-Clause | Copyright 2011 Pallets |
| click | 8.5.0 | BSD-3-Clause | Copyright 2014 Pallets |
| blinker | 1.9.0 | MIT | Copyright 2010 Jason Kirtland |
| gunicorn | 26.2.0 | MIT | Copyright 2009-2024 Benoît Chesneau, 2009-2015 Paul J. Davis |
| pg8000 | 1.29.2 | BSD-3-Clause | Copyright 2007-2009 Mathieu Fenniak |
| scramp | 1.4.1 | MIT | Copyright 2019 Tony Locke |
| asn1crypto | 1.5.1 | MIT | Copyright 2015-2022 Will Bond |
| python-dateutil | 3.0.0 | Apache-2.0 OR BSD-3-Clause (dual) | Copyright 2017- Paul Ganssle, 2003-2011 Gustavo Niemeyer and others |
| six | 1.17.0 | MIT | Copyright 2010-2024 Benjamin Peterson |
| tzdata | 2026.6 | Apache-2.0 | Copyright 2020 Python Software Foundation |
| pip | 25.0.1 (bundled into `.venv` by `python3 -m venv`) | MIT | Copyright 2008-present The pip developers |

## Icon drawings

The eleven line icons in `clearhouse/icons.py` follow path data from Lucide
(https://lucide.dev), ISC licence:

> ISC License. Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of
> Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.
> Permission to use, copy, modify, and/or distribute this software for any purpose with or without
> fee is hereby granted, provided that the above copyright notice and this permission notice appear
> in all copies. THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
> REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS.
