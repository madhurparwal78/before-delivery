# Third party notices

Switchlamp ships the Go modules, the frontend packages and the font files named
below. Every one of them is under MIT, Apache-2.0, BSD, ISC, MPL-2.0 or OFL-1.1.

## Go modules the program imports

These are the modules in the build of `./bin/server`, as `go list -deps` reports
them.

| Module | Version | Licence |
|---|---|---|
| github.com/cespare/xxhash/v2 | v2.3.0 | MIT |
| github.com/gorilla/websocket | v1.5.3 | BSD-2-Clause |
| github.com/jackc/pgpassfile | v1.0.0 | MIT |
| github.com/jackc/pgservicefile | v0.0.0-20240606120523-5a60cdf6a761 | MIT |
| github.com/jackc/pgx/v5 | v5.12.0 | MIT |
| github.com/jackc/puddle/v2 | v2.2.3 | MIT |
| github.com/rabbitmq/amqp091-go | v1.16.0 | BSD-2-Clause |
| github.com/redis/go-redis/v9 | v9.23.0 | BSD-2-Clause |
| go.uber.org/atomic | v1.12.0 | MIT |
| golang.org/x/sync | v0.22.0 | BSD-3-Clause |
| golang.org/x/sys | v0.48.0 | BSD-3-Clause |
| golang.org/x/text | v0.41.0 | BSD-3-Clause |

The Go standard library, which includes the embedded IANA time zone database
(`time/tzdata`), is under BSD-3-Clause.

## Frontend production dependency tree

`npm ls --omit=dev --all` reports exactly these packages. They are fetched during
`install` and only their font files are bundled; no JavaScript from them is
served.

| Package | Version | Licence |
|---|---|---|
| @fontsource/chivo-mono | 5.2.6 | OFL-1.1 |
| @fontsource/darker-grotesque | 5.2.5 | OFL-1.1 |
| @fontsource/lexend | 5.2.6 | OFL-1.1 |

## Bundled fonts

| Font | Files | Licence |
|---|---|---|
| Darker Grotesque (Google Inc.) | `darker-grotesque-latin-400/600/700-normal.woff2` | OFL-1.1 |
| Lexend (Google Inc.) | `lexend-latin-400/500/700-normal.woff2` | OFL-1.1 |
| Chivo Mono (Google Inc.) | `chivo-mono-latin-400-normal.woff2` | OFL-1.1 |

## Bundled images

The freight yard plates at `internal/web/static/plates/dusk.png` and
`night.png` are drawn by `cmd/plates`, a seeded procedural script in this
repository, during `build`. They are original work and carry the same licence as
this repository.
