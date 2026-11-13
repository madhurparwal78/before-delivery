# Third-party notices

Switchlamp ships the following packages and fonts. Each is used under its
licence, reproduced in the module cache at build time; no other artwork,
font or library is bundled or fetched at runtime.

## Go modules the program imports

| Package | Version | Licence |
|---|---|---|
| github.com/jackc/pgx/v5 | v5.7.5 | MIT |
| github.com/jackc/puddle/v2 (pgx dependency) | v2.2.2 | MIT |
| github.com/jackc/pgpassfile (pgx dependency) | v1.0.0 | MIT |
| github.com/jackc/pgservicefile (pgx dependency) | — | MIT |
| github.com/redis/go-redis/v9 | v9.17.0 | BSD-2-Clause |
| github.com/cespare/xxhash/v2 (go-redis dependency) | v2.3.0 | MIT |
| github.com/dgryski/go-rendezvous (go-redis dependency) | — | MIT |
| github.com/rabbitmq/amqp091-go | v1.10.0 | BSD-2-Clause |
| golang.org/x/crypto | v0.44.0 | BSD-3-Clause |
| golang.org/x/text (x/crypto dependency) | v0.31.0 | BSD-3-Clause |

The Go standard library is BSD-3-Clause and ships with the Go toolchain.

## Fonts

The three bundled fonts are placed in `static/fonts` during `install` by
`tools/fonts.sh` from their locally installed open-licence packages:

| Font | Licence |
|---|---|
| Darker Grotesque (display type) | SIL Open Font License 1.1 |
| Lexend (body type) | SIL Open Font License 1.1 |
| Chivo Mono (literal keys, dedup keys, signatures) | SIL Open Font License 1.1 |

## Frontend

Pages are rendered by the backend in Go; there is no frontend package
dependency tree. The stylesheet and script in `static/` are written for this
product, as are the procedural freight-yard plates generated at build time by
`tools/plate`, which draws every pixel itself and bundles no artwork.
