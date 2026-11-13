# Image manifest

Every image file the app serves lives in `northfall/static/img/` and is served
from this origin. All of them are flat vector drawings produced for this product
by `tools/make_images.py`, which draws them from the same geometry and palette as
the inline icons. None is a photograph, none was obtained from a third party, and
none carries a third-party licence.

| File | Size | Where it is shown | Origin | Licence |
|---|---|---|---|---|
| `portrait-aino-rask.svg` | 480×480 | `/contact` directory card | Drawn for Northfall by `tools/make_images.py` | Part of this product; no third-party rights |
| `portrait-mikael-soderholm.svg` | 480×480 | `/contact` directory card | Drawn for Northfall by `tools/make_images.py` | Part of this product; no third-party rights |
| `portrait-leena-varjo.svg` | 480×480 | `/contact` directory card | Drawn for Northfall by `tools/make_images.py` | Part of this product; no third-party rights |
| `portrait-tomas-brandt.svg` | 480×480 | `/contact` directory card | Drawn for Northfall by `tools/make_images.py` | Part of this product; no third-party rights |
| `portrait-iiris-kallio.svg` | 480×480 | `/contact` directory card | Drawn for Northfall by `tools/make_images.py` | Part of this product; no third-party rights |
| `portrait-joonas-hirvi.svg` | 480×480 | `/contact` directory card | Drawn for Northfall by `tools/make_images.py` | Part of this product; no third-party rights |
| `story-2014.svg` | 1200×675 | `/story` chapter 2014–2016 | Drawn for Northfall by `tools/make_images.py` | Part of this product; no third-party rights |
| `story-2017.svg` | 1200×675 | `/story` chapter 2017–2019 | Drawn for Northfall by `tools/make_images.py` | Part of this product; no third-party rights |
| `story-2020.svg` | 1200×675 | `/story` chapter 2020–2022 | Drawn for Northfall by `tools/make_images.py` | Part of this product; no third-party rights |
| `story-2023.svg` | 1200×675 | `/story` chapter 2023–2026 | Drawn for Northfall by `tools/make_images.py` | Part of this product; no third-party rights |
| `texture-promise.svg` | 1200×600 | decorative texture behind the home promise line | Drawn for Northfall by `tools/make_images.py` | Part of this product; no third-party rights |
| `social-preview.svg` | 1200×630 | `og:image` on every page | Drawn for Northfall by `tools/make_images.py` | Part of this product; no third-party rights |

Each portrait and each story image carries alternative text describing what the
drawing shows, written in `northfall/pages/content.py`. The promise-line texture
is decorative and is hidden from assistive technology.

There is no video anywhere in the product and no `<video>` element is served.
