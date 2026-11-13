# Third-party notices

Everything the Strongroom Ledger server and browser load is listed here. The packages
are the production dependency tree that `install` puts into `/app/.venv`, as
`.venv/bin/python -m pip list` reports. The fonts are bundled under
`app/static/fonts` and are served from the app's own origin.

## Python packages

| Package | Version | Licence |
|---|---|---|
| anyio | 4.16.0 | MIT |
| asyncpg | 0.30.0 | Apache-2.0 |
| certifi | 2026.10.23 | MPL-2.0 |
| click | 8.5.0 | BSD-3-Clause |
| h11 | 0.16.0 | MIT |
| httpcore | 1.0.9 | BSD-3-Clause |
| httpx | 0.28.1 | BSD-3-Clause |
| idna | 3.20 | BSD-3-Clause |
| pip | 26.3 | MIT |
| setuptools | 66.1.1 | MIT |
| starlette | 0.41.3 | BSD-3-Clause |
| typing_extensions | 4.16.0 | PSF-2.0 |
| uvicorn | 0.32.1 | BSD-3-Clause |

## Fonts

| Font | Version | File | Licence |
|---|---|---|---|
| Space Grotesk | v22 (Google Fonts, latin subset) | `app/static/fonts/space-grotesk-var.woff2` | OFL-1.1 |
| IBM Plex Sans | v23 (Google Fonts, latin subset) | `app/static/fonts/ibm-plex-sans-var.woff2` | OFL-1.1 |
| IBM Plex Mono | v20 (Google Fonts, latin subset) | `app/static/fonts/ibm-plex-mono-400.woff2`, `app/static/fonts/ibm-plex-mono-600.woff2` | OFL-1.1 |

No other script, style or font is loaded at runtime, and nothing is fetched from a
content delivery network.
