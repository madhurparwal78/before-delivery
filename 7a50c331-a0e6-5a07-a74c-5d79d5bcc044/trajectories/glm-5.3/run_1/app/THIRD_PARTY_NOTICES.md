# Third-party notices

Tessel ships the following packages in its production dependency tree, as
installed by `run.json`'s `install` command into `.venv` from the pinned
requirements. Development-only tools are excluded.

| Package | Version | Licence |
|---|---|---|
| aiohappyeyeballs | 2.7.1 | PSF-2.0 |
| aiohttp | 3.14.5 | Apache-2.0 |
| aiosignal | 1.4.0 | Apache-2.0 |
| asyncpg | 0.32.0 | Apache-2.0 |
| attrs | 26.1.0 | MIT |
| frozenlist | 1.8.0 | Apache-2.0 |
| idna | 3.20 | BSD-3-Clause |
| multidict | 7.2.1 | Apache-2.0 |
| propcache | 0.5.4 | MIT |
| typing_extensions | 4.16.0 | PSF-2.0 |
| yarl | 1.25.1 | Apache-2.0 |

Every shipped package carries an MIT, BSD, Apache-2.0, ISC, PSF or MPL-2.0
licence. The Python standard library is PSF-licensed and ships with the
Python 3.12 runtime.

Tessel sends no data anywhere but its own address. Mail travels over SMTP to
the configured Mailpit sink; every record lives in the configured PostgreSQL.
