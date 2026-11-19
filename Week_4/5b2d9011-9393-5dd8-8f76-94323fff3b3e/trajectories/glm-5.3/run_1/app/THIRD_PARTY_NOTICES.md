# Third-party notices

This file lists every shipped package with its licence, per IF-02.

## Go modules the program imports

Imported directly:

| Module | Version | Licence |
|---|---|---|
| github.com/jackc/pgx/v5 | v5.13.0 | MIT |
| github.com/valkey-io/valkey-go | v1.0.80 | BSD-3-Clause |

Transitive requirements of those modules (part of the shipped dependency tree):

| Module | Version | Licence |
|---|---|---|
| github.com/jackc/pgpassfile | v1.0.0 | MIT |
| github.com/jackc/pgservicefile | v0.0.0-20240606120523-5a60cdf6a761 | MIT |
| github.com/jackc/puddle/v2 | v2.2.3 | MIT |
| golang.org/x/sync | v0.25.0 | BSD-3-Clause |
| golang.org/x/sys | v0.50.0 | BSD-3-Clause |
| golang.org/x/text | v0.44.0 | BSD-3-Clause |

Licence texts for the Go module tree are distributed with the modules under their own terms; the Go standard library and `time/tzdata` are BSD-3-Clause (the Go licence).

## Frontend production dependency tree

`npm ls --omit=dev --all`:

| Package | Version | Licence |
|---|---|---|
| three | 0.180.0 | MIT |

Build-time only (not shipped in the bundle): esbuild (MIT), typescript (Apache-2.0), @types/three (MIT).

## Fonts

Vendored Open Font Licence files, per IF-03 and IF-07:

| Font | File | Licence |
|---|---|---|
| Pixelify Sans | `frontend/fonts/pixelify-sans-latin.woff2` | OFL-1.1 (`frontend/fonts/OFL-PixelifySans.txt`) |
| Chakra Petch | `frontend/fonts/chakra-petch-300.woff2`, `-400`, `-500`, `-600` | OFL-1.1 (`frontend/fonts/OFL-ChakraPetch.txt`) |

All shipped packages and fonts use MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC, MPL-2.0, Zlib, CC0-1.0, Unlicense or OFL-1.1. Nothing GPL, LGPL, AGPL or SSPL ships.
