# Third party notices

Relayo ships the Python production dependency tree installed by the `install` command in
`/app/run.json` from `requirements.txt`, with its transitive dependencies. Every shipped
package is under the MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC, PSF-2.0 or MPL-2.0
licence.

| Package | Version | Licence | Why it ships |
|---|---|---|---|
| anyio | 4.15.1 | MIT | Async primitives used by httpcore |
| asyncpg | 0.30.0 | Apache-2.0 | PostgreSQL driver |
| certifi | 2026.10.23 | MPL-2.0 | Trust store used by httpx |
| click | 8.5.0 | BSD-3-Clause | Command line parsing used by uvicorn |
| h11 | 0.16.0 | MIT | HTTP/1.1 protocol used by httpcore and uvicorn |
| httpcore | 1.0.9 | BSD-3-Clause | Transport used by httpx |
| httpx | 0.28.1 | BSD-3-Clause | HTTP client for the Keycloak calls |
| idna | 3.20 | BSD-3-Clause | International domain names used by httpx |
| Jinja2 | 3.1.6 | BSD-3-Clause | Page templates |
| MarkupSafe | 3.0.4 | BSD-3-Clause | Escaping used by Jinja2 |
| pip | 23.0.1 | MIT | Bundled with the virtual environment that installs the tree |
| setuptools | 66.1.1 | MIT | Bundled with the virtual environment |
| typing_extensions | 4.16.0 | PSF-2.0 | Typing back-ports used by anyio |
| uvicorn | 0.34.3 | BSD-3-Clause | ASGI server |

All site media — the logo, the gradient orb, the agent posters, the integration icons, the
article covers and the careers image band — is original vector artwork drawn by this
application. No screenshot, video, brand mark or downloaded image from any other site is used,
and no font, style or script is loaded from another origin.
