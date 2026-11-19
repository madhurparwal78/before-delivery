# Third-party notices

This file names every package shipped inside `/app/.venv` and inside the
production npm dependency tree of `web/`, together with its licence.

## Python packages (`/app/.venv`)

Installed from `requirements.txt` and their transitive dependencies:

| Package | Version | Licence |
|---|---|---|
| annotated-types | 0.8.0 | MIT |
| anyio | 4.16.0 | MIT |
| asn1crypto | 1.5.1 | MIT |
| click | 8.5.1 | BSD-3-Clause |
| fastapi | 0.115.6 | MIT |
| h11 | 0.16.0 | MIT |
| httptools | 0.9.0 | MIT |
| idna | 3.20 | BSD-3-Clause |
| packaging | 26.3 | Apache-2.0 OR BSD-2-Clause |
| pg8000 | 1.31.6 | BSD-3-Clause |
| pydantic | 2.14.3 | MIT |
| pydantic-core | 2.50.4 | MIT |
| python-dateutil | 4.0.0 | Apache-2.0 OR BSD-3-Clause |
| python-dotenv | 1.2.4 | BSD-3-Clause |
| python-multipart | 0.0.20 | Apache-2.0 |
| scramp | 1.5.0 | MIT-0 |
| starlette | 0.41.3 | BSD-3-Clause |
| typing-extensions | 4.16.0 | PSF-2.0 |
| typing-inspection | 0.4.5 | MIT |
| tzdata | 2026.6 | Apache-2.0 |
| uvicorn | 0.34.0 | BSD-3-Clause |
| uvloop | 0.23.0 | MIT |
| watchfiles | 1.3.0 | MIT |
| websockets | 17.4 | BSD-3-Clause |

## npm packages (production tree of `web/`)

From `npm ls --omit=dev --all`:

| Package | Version | Licence |
|---|---|---|
| react | 18.3.1 | MIT |
| react-dom | 18.3.1 | MIT |
| react-router | 6.28.0 | MIT |
| react-router-dom | 6.28.0 | MIT |
| @remix-run/router | 1.21.0 | MIT |
| scheduler | 0.23.2 | MIT |
| loose-envify | 1.4.0 | MIT |
| js-tokens | 4.0.0 | MIT |

## Assets

- **Inter, Fragment Mono and JetBrains Mono** font files ship from the app's
  own origin under the SIL Open Font License, Version 1.1 (OFL-1.1).
- **The film** `assets/data-sonification-black-hole-at-the-center-of-the-perse-c38f6693.webm`
  is NASA's public-domain "Data Sonification: Black Hole at the Center of the
  Perseus Galaxy Cluster (X-ray)".
