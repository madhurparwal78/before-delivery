# Third-party notices

This file names every shipped package and both font families with its licence.
"Shipped packages" are the production dependency tree as `npm ls --omit=dev --all --json` reports it.

## Packages

| Package | Version | Licence |
|---|---|---|
| `@fontsource/bodoni-moda` | 5.2.5 | OFL-1.1 |
| `@fontsource/jost` | 5.2.5 | OFL-1.1 |
| `esbuild` | 0.28.2 | MIT |
| `@esbuild/aix-ppc64` | 0.28.2 | MIT |
| `@esbuild/android-arm` | 0.28.2 | MIT |
| `@esbuild/android-arm64` | 0.28.2 | MIT |
| `@esbuild/android-x64` | 0.28.2 | MIT |
| `@esbuild/darwin-arm64` | 0.28.2 | MIT |
| `@esbuild/darwin-x64` | 0.28.2 | MIT |
| `@esbuild/freebsd-arm64` | 0.28.2 | MIT |
| `@esbuild/freebsd-x64` | 0.28.2 | MIT |
| `@esbuild/linux-arm` | 0.28.2 | MIT |
| `@esbuild/linux-arm64` | 0.28.2 | MIT |
| `@esbuild/linux-ia32` | 0.28.2 | MIT |
| `@esbuild/linux-loong64` | 0.28.2 | MIT |
| `@esbuild/linux-mips64el` | 0.28.2 | MIT |
| `@esbuild/linux-ppc64` | 0.28.2 | MIT |
| `@esbuild/linux-riscv64` | 0.28.2 | MIT |
| `@esbuild/linux-s390x` | 0.28.2 | MIT |
| `@esbuild/linux-x64` | 0.28.2 | MIT |
| `@esbuild/netbsd-arm64` | 0.28.2 | MIT |
| `@esbuild/netbsd-x64` | 0.28.2 | MIT |
| `@esbuild/openbsd-arm64` | 0.28.2 | MIT |
| `@esbuild/openbsd-x64` | 0.28.2 | MIT |
| `@esbuild/openharmony-arm64` | 0.28.2 | MIT |
| `@esbuild/sunos-x64` | 0.28.2 | MIT |
| `@esbuild/win32-arm64` | 0.28.2 | MIT |
| `@esbuild/win32-ia32` | 0.28.2 | MIT |
| `@esbuild/win32-x64` | 0.28.2 | MIT |
| `nodemailer` | 6.9.16 | MIT-0 |
| `pg` | 8.16.1 | MIT |
| `pg-cloudflare` | 1.4.1 | MIT |
| `pg-native` | 3.4.1 | MIT (optional, not installed) |
| `pg-connection-string` | 2.14.1 | MIT |
| `pg-int8` | 1.0.1 | ISC |
| `pg-pool` | 3.14.0 | MIT |
| `pg-protocol` | 1.16.1 | MIT |
| `pg-types` | 2.2.0 | MIT |
| `pgpass` | 1.0.5 | MIT |
| `postgres-array` | 2.2.0 | MIT |
| `postgres-bytea` | 1.0.1 | MIT |
| `postgres-date` | 1.0.7 | MIT |
| `postgres-interval` | 1.2.0 | MIT |
| `split2` | 4.2.0 | ISC |
| `xtend` | 4.0.2 | MIT |

All licences are among MIT, ISC and OFL-1.1. The `@esbuild/*` platform packages are optional dependencies of `esbuild`, listed for completeness; only the package for the running platform is installed.

## Fonts

- **Bodoni Moda** — designed by Christian Thalmann. Licence: SIL Open Font License 1.1 (OFL-1.1). Served through `@fontsource/bodoni-moda` (OFL-1.1) and bundled by the app.
- **Jost** — designed by indestructible type*. Licence: SIL Open Font License 1.1 (OFL-1.1). Served through `@fontsource/jost` (OFL-1.1) and bundled by the app.

Both font families are bundled as `.woff2` files and served by the app from its own origin.

## Development-only packages (not shipped)

`typescript` (Apache-2.0), `tsx` (MIT), `@types/node` (MIT), `@types/pg` (MIT) and `@types/nodemailer` (MIT) are development dependencies used to build and type-check the source. They are not part of the production dependency tree and are not shipped to the browser or the server runtime.
