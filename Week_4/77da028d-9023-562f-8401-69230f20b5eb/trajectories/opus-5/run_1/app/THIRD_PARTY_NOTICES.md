# Third-party notices

Darkframe ships the packages below. "Shipped" means the production dependency
tree that `install` puts into `/app/.venv`, as
`.venv/bin/python -m pip list --format json` reports it, plus every vendored
browser file served from Darkframe's own origin.

## Python packages in `/app/.venv`

| Package | Version | Licence |
|---|---|---|
| anyio | 4.16.0 | MIT |
| asyncpg | 0.30.0 | Apache-2.0 |
| click | 8.5.0 | BSD-3-Clause |
| h11 | 0.16.0 | MIT |
| idna | 3.20 | BSD-3-Clause |
| pip | as installed by `install` | MIT |
| starlette | 0.49.3 | BSD-3-Clause |
| typing_extensions | 4.16.0 | PSF-2.0 |
| uvicorn | 0.38.0 | BSD-3-Clause |

## Vendored browser files

| File | Project | Version | Licence |
|---|---|---|---|
| `vendor/three.module.min.js`, served as `/vendor/three.module.js` | three.js | r169 | MIT |
| `vendor/sora-latin.woff2`, served as `/vendor/sora-latin.woff2` | Sora | v17 | OFL-1.1 |
| `vendor/sora-latin-ext.woff2`, served as `/vendor/sora-latin-ext.woff2` | Sora | v17 | OFL-1.1 |

The full licence texts of the vendored files are kept beside them, in
`vendor/three-LICENSE.txt` and `vendor/Sora-OFL.txt`.

No shipped package uses a licence outside MIT, BSD-2-Clause, BSD-3-Clause,
Apache-2.0, ISC, PSF-2.0, or OFL-1.1 for fonts.
