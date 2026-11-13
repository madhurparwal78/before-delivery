# Third-party notices

This file lists every shipped package and the bundled Sora font, with its licence.

## Go modules (production dependency tree)

| Package | Version | Licence |
|---|---|---|
| github.com/google/uuid | v1.6.0 | BSD-3-Clause |
| github.com/jackc/pgpassfile | v1.0.0 | MIT |
| github.com/jackc/pgservicefile | v0.0.0-20240606120523-5a60cdf6a761 | MIT |
| github.com/jackc/pgx/v5 | v5.7.2 | MIT |
| github.com/jackc/puddle/v2 | v2.2.2 | MIT |
| golang.org/x/crypto | v0.31.0 | BSD-3-Clause |
| golang.org/x/net | v0.21.0 | BSD-3-Clause |
| golang.org/x/sync | v0.10.0 | BSD-3-Clause |
| golang.org/x/text | v0.21.0 | BSD-3-Clause |

The golang.org/x modules carry the Go Authors' BSD-3-Clause licence; github.com/google/uuid carries the BSD-3-Clause licence of Google Inc.

## npm packages (production dependency tree)

| Package | Version | Licence |
|---|---|---|
| esbuild | 0.24.2 | MIT |
| @esbuild/linux-arm64 | 0.24.2 | MIT |

The other @esbuild platform packages in the tree carry the same MIT licence and the platform binaries they install are not shipped for other platforms.

## Bundled font

| Font | Licence |
|---|---|
| Sora (Light 300, Regular 400, SemiBold 600) | SIL Open Font License 1.1 |

The Sora font files are bundled from the Google Fonts repository, where they are distributed under the SIL Open Font License, Version 1.1. The full licence text is at `static/fonts/OFL.txt` (also copied as `THIRD_PARTY_SORA_OFL.md`).
