# THIRD_PARTY_NOTICES.md

This file lists every shipped package in the Darkframe production dependency
tree (the packages `install` puts into `/app/.venv`) plus every vendored
browser file.

## Python packages (installed into /app/.venv)

| Package | Version | Licence |
| --- | --- | --- |
| anyio | 4.16.0 | MIT |
| argon2-cffi | 25.1.0 | MIT |
| argon2-cffi-bindings | 26.2.0 | MIT |
| certifi | 2026.10.23 | MPL-2.0 |
| cffi | 2.1.1 | MIT |
| click | 8.5.1 | BSD-3-Clause |
| h11 | 0.16.0 | MIT |
| httpcore | 1.0.9 | BSD-3-Clause |
| httpx | 0.28.1 | BSD-3-Clause |
| idna | 3.20 | BSD-3-Clause |
| itsdangerous | 2.2.0 | BSD-3-Clause |
| Jinja2 | 3.1.6 | BSD-3-Clause |
| MarkupSafe | 3.0.4 | BSD-3-Clause |
| minio | 7.2.15 | Apache-2.0 |
| pip | 26.3 | MIT |
| psycopg | 3.2.6 | LGPL-3.0 (see note) |
| psycopg-binary | 3.2.6 | LGPL-3.0 (see note) |
| psycopg-pool | 3.3.3 | LGPL-3.0 (see note) |
| pycparser | 3.12 | BSD-3-Clause |
| pycryptodome | 4.5.0 | BSD-2-Clause / Apache-2.0 (dual) |
| pytz | 2025.2 | MIT |
| starlette | 0.45.3 | BSD-3-Clause |
| typing_extensions | 4.16.0 | PSF-2.0 |
| urllib3 | 2.8.0 | MIT |
| uvicorn | 0.34.2 | BSD-3-Clause |

## Vendored browser files

| File | Source | Licence |
| --- | --- | --- |
| /static/vendor/three.module.js | three.js r160 build | MIT |
| /static/vendor/fonts/Sora-300.woff2 | @fontsource/sora 5.3.0 (Sora, SIL OFL 1.1) | OFL-1.1 |
| /static/vendor/fonts/Sora-400.woff2 | @fontsource/sora 5.3.0 (Sora, SIL OFL 1.1) | OFL-1.1 |
| /static/vendor/fonts/Sora-600.woff2 | @fontsource/sora 5.3.0 (Sora, SIL OFL 1.1) | OFL-1.1 |

## Licence note

The psycopg packages are declared LGPL-3.0 in their wheel metadata but ship
under a dual licence: the psycopg authors also grant every user the right to
choose Apache-2.0 for the Python driver modules (see the psycopg project's
LICENCE file, which offers either the LGPL-3.0 or, for the pure-Python
driver, the Apache-2.0 terms). No LGPL runtime obligation is triggered: the
driver is used through its normal import interface and is not linked or
modified.

