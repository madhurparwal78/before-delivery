# Tailboard third-party notices

This file lists every shipped package and bundled font or icon set with its licence (IF-02, IF-03).

## Production Python dependencies (installed into `/app/.venv`)

| Package | Version | Licence |
|---|---|---|
| starlette | 0.41.3 | BSD-3-Clause |
| uvicorn | 0.32.1 | BSD-3-Clause |
| asyncpg | 0.30.0 | Apache-2.0 |
| minio | 7.2.15 | Apache-2.0 |
| tzdata | 2025.2 | Apache-2.0 |

Transitive dependencies installed with them:

| Package | Version | Licence |
|---|---|---|
| anyio | 4.16.0 | MIT |
| argon2-cffi | 25.1.0 | MIT |
| argon2-cffi-bindings | 26.2.0 | MIT |
| certifi | 2026.10.23 | MPL-2.0 |
| cffi | 2.1.1 | MIT |
| click | 8.5.1 | BSD-3-Clause |
| h11 | 0.16.0 | MIT |
| idna | 3.20 | BSD-3-Clause |
| pycparser | 3.12 | BSD-3-Clause |
| pycryptodome | 4.5.0 | BSD-2-Clause / public domain dual |
| typing_extensions | 4.16.0 | PSF-2.0 |
| urllib3 | 2.8.0 | MIT |

Each licence text ships with its wheel inside `/app/.venv` (see each distribution's
`LICENSE` file, reachable via `pip show <package>`).

## Bundled fonts

| Font | Files | Licence |
|---|---|---|
| IBM Plex Sans | `static/fonts/ibm-plex-sans-latin-*.woff2` | OFL-1.1 (see `static/fonts/OFL.txt`) |
| IBM Plex Sans Condensed | `static/fonts/ibm-plex-sans-condensed-latin-*.woff2` | OFL-1.1 |
| IBM Plex Mono | `static/fonts/ibm-plex-mono-latin-*.woff2` | OFL-1.1 |

The IBM Plex font files are self-hosted from the app's own origin; no font is fetched
from a third party at runtime (IF-06).

## Icons

All icons and gauges are simple outline vector shapes drawn in the application source
(`static/js/copy.js`, `static/board.css`). No third-party icon set is bundled.

## Front-end packages

The front end uses no npm packages; `npm ls --omit=dev --all --json` reports no
production front-end dependencies.
