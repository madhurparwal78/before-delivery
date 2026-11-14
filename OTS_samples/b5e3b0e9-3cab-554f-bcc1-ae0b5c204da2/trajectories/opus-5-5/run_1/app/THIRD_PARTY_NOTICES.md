# Third-party notices

Runup Bay ships the packages below (the production dependency tree from
`npm ls --omit=dev --all --json`) and the fonts bundled in `client/fonts`.
Each one keeps its own copyright and licence.

## npm packages

| Package | Version | Licence |
|---|---|---|
| @types/node | 22.20.5 | MIT |
| @types/pg | 8.23.1 | MIT |
| @types/ws | 8.18.2 | MIT |
| esbuild | 0.28.2 | MIT |
| @esbuild/aix-ppc64 (optional platform binary; only the one for the build machine is installed) | 0.28.2 | MIT |
| @esbuild/android-arm (optional platform binary; only the one for the build machine is installed) | 0.28.2 | MIT |
| @esbuild/android-arm64 (optional platform binary; only the one for the build machine is installed) | 0.28.2 | MIT |
| @esbuild/android-x64 (optional platform binary; only the one for the build machine is installed) | 0.28.2 | MIT |
| @esbuild/darwin-arm64 (optional platform binary; only the one for the build machine is installed) | 0.28.2 | MIT |
| @esbuild/darwin-x64 (optional platform binary; only the one for the build machine is installed) | 0.28.2 | MIT |
| @esbuild/freebsd-arm64 (optional platform binary; only the one for the build machine is installed) | 0.28.2 | MIT |
| @esbuild/freebsd-x64 (optional platform binary; only the one for the build machine is installed) | 0.28.2 | MIT |
| @esbuild/linux-arm (optional platform binary; only the one for the build machine is installed) | 0.28.2 | MIT |
| @esbuild/linux-arm64 (optional platform binary; only the one for the build machine is installed) | 0.28.2 | MIT |
| @esbuild/linux-ia32 (optional platform binary; only the one for the build machine is installed) | 0.28.2 | MIT |
| @esbuild/linux-loong64 (optional platform binary; only the one for the build machine is installed) | 0.28.2 | MIT |
| @esbuild/linux-mips64el (optional platform binary; only the one for the build machine is installed) | 0.28.2 | MIT |
| @esbuild/linux-ppc64 (optional platform binary; only the one for the build machine is installed) | 0.28.2 | MIT |
| @esbuild/linux-riscv64 (optional platform binary; only the one for the build machine is installed) | 0.28.2 | MIT |
| @esbuild/linux-s390x (optional platform binary; only the one for the build machine is installed) | 0.28.2 | MIT |
| @esbuild/linux-x64 (optional platform binary; only the one for the build machine is installed) | 0.28.2 | MIT |
| @esbuild/netbsd-arm64 (optional platform binary; only the one for the build machine is installed) | 0.28.2 | MIT |
| @esbuild/netbsd-x64 (optional platform binary; only the one for the build machine is installed) | 0.28.2 | MIT |
| @esbuild/openbsd-arm64 (optional platform binary; only the one for the build machine is installed) | 0.28.2 | MIT |
| @esbuild/openbsd-x64 (optional platform binary; only the one for the build machine is installed) | 0.28.2 | MIT |
| @esbuild/openharmony-arm64 (optional platform binary; only the one for the build machine is installed) | 0.28.2 | MIT |
| @esbuild/sunos-x64 (optional platform binary; only the one for the build machine is installed) | 0.28.2 | MIT |
| @esbuild/win32-arm64 (optional platform binary; only the one for the build machine is installed) | 0.28.2 | MIT |
| @esbuild/win32-ia32 (optional platform binary; only the one for the build machine is installed) | 0.28.2 | MIT |
| @esbuild/win32-x64 (optional platform binary; only the one for the build machine is installed) | 0.28.2 | MIT |
| pg | 8.23.1 | MIT |
| pg-cloudflare (optional) | 1.4.1 | MIT |
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
| preact | 10.29.8 | MIT |
| split2 | 4.2.0 | ISC |
| typescript | 5.9.3 | Apache-2.0 |
| undici-types | 6.21.0 | MIT |
| ws | 8.23.0 | MIT |
| xtend | 4.0.2 | MIT |

Optional peer packages named in the tree but not installed: `pg-native` (MIT),
`bufferutil` (MIT), `utf-8-validate` (MIT) and `preact-render-to-string` (MIT).

## Fonts

| Font | Files | Licence |
|---|---|---|
| Stack Sans Headline, Copyright 2025 The Stack Sans Project Authors | `client/fonts/stack-sans-headline-*.woff2` | OFL-1.1 (`client/fonts/OFL-stack-sans.txt`) |
| Stack Sans Text, Copyright 2025 The Stack Sans Project Authors | `client/fonts/stack-sans-text-*.woff2` | OFL-1.1 (`client/fonts/OFL-stack-sans.txt`) |
| Spline Sans Mono, Copyright 2022 The Spline Sans Mono Project Authors | `client/fonts/spline-sans-mono-*.woff2` | OFL-1.1 (`client/fonts/OFL-spline-sans-mono.txt`) |

The PDF reports use the standard PDF Helvetica font, which is not embedded.
