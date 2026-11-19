# Third-party notices

Every package the install command puts into `/app/.venv`, with its version and licence.
No npm packages are used. The PostgreSQL client (`hub/pgwire.py`) and the mail client
(`hub/mail.py`) use only the Python standard library, so no database or mail driver ships.

| Package | Version | Licence |
|---|---|---|
| anyio | 4.16.0 | MIT |
| click | 8.5.1 | BSD-3-Clause |
| h11 | 0.16.0 | MIT |
| idna | 3.20 | BSD-3-Clause |
| Jinja2 | 3.1.4 | BSD-3-Clause |
| MarkupSafe | 3.0.4 | BSD-3-Clause |
| python-multipart | 0.0.9 | Apache-2.0 |
| starlette | 0.37.2 | BSD-3-Clause |
| typing_extensions | 4.16.0 | PSF-2.0 |
| uvicorn | 0.30.6 | BSD-3-Clause |

`pip` and `setuptools` are also present in the environment as tooling; they are
not imported by the application. The HTML templates escape by default through
Jinja2's autoescape. All artwork, video and audio served by the app are original
works generated for this product.
