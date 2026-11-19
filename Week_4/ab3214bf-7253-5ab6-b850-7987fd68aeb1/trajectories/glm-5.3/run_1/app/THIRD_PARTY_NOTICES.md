# Third-party notices

This file lists every shipped package with its licence, plus the Unbounded and
Onest typefaces with their licence. Shipped packages are the production
dependency tree of `requirements.txt`.

## Python packages

| Package | Version | Licence |
|---|---|---|
| anyio | 4.16.0 | MIT |
| asyncpg | 0.32.0 | Apache-2.0 |
| cffi | 2.1.1 | MIT-0 |
| click | 8.5.1 | BSD-3-Clause |
| cryptography | 43.0.3 | Apache-2.0 OR BSD-3-Clause |
| h11 | 0.16.0 | MIT |
| idna | 3.20 | BSD-3-Clause |
| pycparser | 3.12 | BSD-3-Clause |
| starlette | 0.41.3 | BSD-3-Clause |
| typing_extensions | 4.16.0 | PSF-2.0 |
| uvicorn | 0.32.1 | BSD-3-Clause |

`pip` (MIT) is the installer used by the manifest's `install` command; it is
not imported by the application.

## Typefaces

| Typeface | File | Licence |
|---|---|---|
| Unbounded (Black, latin subset) | `hourproof/static/fonts/unbounded-900.woff2` | SIL Open Font License 1.1 |
| Onest (latin subset) | `hourproof/static/fonts/onest-400.woff2` | SIL Open Font License 1.1 |

The licence texts for the two typefaces are shipped alongside the font files as
`OFL-Unbounded.txt` and `OFL-Onest.txt`.

All licences above are among MIT, Apache-2.0, BSD-3-Clause, PSF-2.0 and the SIL
Open Font License 1.1.
