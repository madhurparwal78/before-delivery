# Third-party notices

Plinth ships the following packages (the production dependency tree, as given by
`npm ls --omit=dev --all --json`), each with its version and licence, plus three
bundled fonts with their licence.

## Packages

| Package | Version | Licence |
|---|---|---|
| @esbuild/aix-ppc64 | 0.24.2 (optional platform binary) | MIT |
| @esbuild/android-arm | 0.24.2 (optional platform binary) | MIT |
| @esbuild/android-arm64 | 0.24.2 (optional platform binary) | MIT |
| @esbuild/android-x64 | 0.24.2 (optional platform binary) | MIT |
| @esbuild/darwin-arm64 | 0.24.2 (optional platform binary) | MIT |
| @esbuild/darwin-x64 | 0.24.2 (optional platform binary) | MIT |
| @esbuild/freebsd-arm64 | 0.24.2 (optional platform binary) | MIT |
| @esbuild/freebsd-x64 | 0.24.2 (optional platform binary) | MIT |
| @esbuild/linux-arm | 0.24.2 (optional platform binary) | MIT |
| @esbuild/linux-arm64 | 0.24.2 | MIT |
| @esbuild/linux-ia32 | 0.24.2 (optional platform binary) | MIT |
| @esbuild/linux-loong64 | 0.24.2 (optional platform binary) | MIT |
| @esbuild/linux-mips64el | 0.24.2 (optional platform binary) | MIT |
| @esbuild/linux-ppc64 | 0.24.2 (optional platform binary) | MIT |
| @esbuild/linux-riscv64 | 0.24.2 (optional platform binary) | MIT |
| @esbuild/linux-s390x | 0.24.2 (optional platform binary) | MIT |
| @esbuild/linux-x64 | 0.24.2 (optional platform binary) | MIT |
| @esbuild/netbsd-arm64 | 0.24.2 (optional platform binary) | MIT |
| @esbuild/netbsd-x64 | 0.24.2 (optional platform binary) | MIT |
| @esbuild/openbsd-arm64 | 0.24.2 (optional platform binary) | MIT |
| @esbuild/openbsd-x64 | 0.24.2 (optional platform binary) | MIT |
| @esbuild/sunos-x64 | 0.24.2 (optional platform binary) | MIT |
| @esbuild/win32-arm64 | 0.24.2 (optional platform binary) | MIT |
| @esbuild/win32-ia32 | 0.24.2 (optional platform binary) | MIT |
| @esbuild/win32-x64 | 0.24.2 (optional platform binary) | MIT |
| esbuild | 0.24.2 | MIT |
| pg | 8.23.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-int8 | 1.0.1 | ISC |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pgpass | 1.0.5 | MIT |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| split2 | 4.2.0 | MIT |
| typescript | 5.9.3 | Apache-2.0 |
| ws | 8.22.1 | MIT |
| xtend | 4.0.2 | MIT |

## Bundled fonts

Bundled as WOFF2 files in `public_src/fonts/`, served by the app.

| Font | Files | Licence |
|---|---|---|
| Space Grotesk | space-grotesk-400.woff2, space-grotesk-700.woff2 | SIL Open Font License 1.1 (OFL-1.1) |
| IBM Plex Sans | plex-sans-400.woff2, plex-sans-700.woff2 | SIL Open Font License 1.1 (OFL-1.1) |
| IBM Plex Mono | plex-mono-400.woff2, plex-mono-700.woff2 | SIL Open Font License 1.1 (OFL-1.1) |

The WOFF2 files are built from the @fontsource distribution of each family, which
carries the upstream font licences unchanged.
