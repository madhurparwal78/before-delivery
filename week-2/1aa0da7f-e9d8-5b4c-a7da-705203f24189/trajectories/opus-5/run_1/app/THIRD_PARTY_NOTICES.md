# Third-party notices

Wardline ships the Python packages below in `/app/.venv`, the two web fonts
served from `/static/fonts/`, and no bundled browser libraries: every line of
browser code in `wardline/static` is part of this product.

## Python packages

| Package | Version | Licence |
|---|---|---|
| anyio | 4.15.1 | MIT |
| boto3 | 1.35.76 | Apache-2.0 |
| botocore | 1.35.99 | Apache-2.0 |
| click | 8.5.0 | BSD-3-Clause |
| h11 | 0.16.0 | MIT |
| idna | 3.20 | BSD-3-Clause |
| jmespath | 1.1.0 | MIT |
| pillow | 11.0.0 | MIT-CMU |
| psycopg2-binary | 2.9.10 | LGPL-3.0-or-later with exceptions |
| pypdfium2 | 4.30.0 | Apache-2.0 OR BSD-3-Clause; the bundled PDFium binary is BSD-3-Clause |
| python-dateutil | 2.9.0.post0 | Apache-2.0 AND BSD-3-Clause |
| s3transfer | 0.10.4 | Apache-2.0 |
| six | 1.17.0 | MIT |
| starlette | 0.41.3 | BSD-3-Clause |
| typing_extensions | 4.16.0 | PSF-2.0 |
| urllib3 | 2.8.0 | MIT |
| uvicorn | 0.32.1 | BSD-3-Clause |

`pip`, `setuptools` and `wheel` come with the virtual environment itself and
are not shipped product code.

## Fonts

| Font | File | Licence |
|---|---|---|
| Martian Mono | `wardline/static/fonts/martian-mono-latin.woff2` | OFL-1.1 |
| Instrument Sans | `wardline/static/fonts/instrument-sans-latin.woff2` | OFL-1.1 |

## Bundled browser libraries

None. The browser code uses only platform APIs: `fetch`, Web Crypto,
`canvas`, WebGL2 and `localStorage`.
