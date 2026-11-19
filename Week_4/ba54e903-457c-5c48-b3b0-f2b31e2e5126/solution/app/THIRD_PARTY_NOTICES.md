# Third-party notices

Community Hub ships the Python packages below. They are exactly what the `install` command in `run.json`
(`pip install -r requirements.txt`, every version pinned) puts into `/app/.venv`. There is no npm tree: the pages use
hand-written JavaScript and CSS with no build step.

| Package | Version | Licence | Copyright |
|---|---|---|---|
| Flask | 3.1.0 | BSD-3-Clause | Copyright 2010 Pallets |
| Werkzeug | 3.1.3 | BSD-3-Clause | Copyright 2007 Pallets |
| Jinja2 | 3.1.6 | BSD-3-Clause | Copyright 2007 Pallets |
| MarkupSafe | 3.0.4 | BSD-3-Clause | Copyright 2010 Pallets |
| itsdangerous | 2.2.0 | BSD-3-Clause | Copyright 2011 Pallets |
| click | 8.5.0 | BSD-3-Clause | Copyright 2014 Pallets |
| blinker | 1.9.0 | MIT | Copyright 2010 Jason Kirtland |
| gunicorn | 23.0.0 | MIT | Copyright 2009-2024 (c) Benoît Chesneau, Copyright 2009-2015 (c) Paul J. Davis |
| packaging | 26.3 | Apache-2.0 OR BSD-2-Clause | Copyright (c) Donald Stufft and individual contributors |
| pg8000 | 1.28.3 | BSD-3-Clause | Copyright (c) 2007-2009, Mathieu Fenniak; pg8000 contributors |
| scramp | 1.4.1 | MIT | Copyright The Contributors to the scramp project |
| asn1crypto | 1.5.1 | MIT | Copyright (c) 2015-2022 Will Bond |
| pip | 25.0.1 | MIT | Copyright (c) 2008-present The pip developers |

The PostgreSQL driver is pg8000 (pure Python, BSD-3-Clause), chosen so that no shipped package carries a GPL-family
licence.

## Media and artwork

Every binary asset is original, made for this app, and listed with its SHA-256 in `assets.json`:

| File | Licence | Origin |
|---|---|---|
| `static/favicon.svg` | original | hand-written SVG mark |
| `static/media/hero.webm` | original | rendered for this app from generated graphics |
| `static/media/hero-poster.jpg` | original | a frame of `hero.webm` |
| `static/media/night-shift-lofi.ogg` | original | synthesised for this app |
| `static/media/aurora-drift.ogg` | original | synthesised for this app |
| `static/media/ronin-rain.ogg` | original | synthesised for this app |

Community icons, splash art and banners are drawn as SVG by `hub/art.py` at request time. No web font is bundled:
text uses the system sans-serif stack.
