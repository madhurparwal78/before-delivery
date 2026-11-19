# Third-party notices

Quarkyard ships the following third-party packages and assets. Each entry
lists the package name, version and its licence. The full licence text for
each package is distributed inside the package itself (`node_modules/<name>/LICENSE`
or equivalent).

## Runtime (production) packages

| Package | Version | Licence |
|---|---|---|
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
| preact | 10.29.8 | MIT |
| split2 | 4.2.3 | ISC |
| xtend | 4.0.2 | MIT |

## Assets bundled into the build (vendored, compiled into dist)

| Asset | Source | Licence |
|---|---|---|
| Manifold geometry library (`vendor/manifold/manifold.js`, `manifold.wasm`) | manifold-3d 3.5.5 | Apache-2.0 |
| Fira Sans (Regular, SemiBold, Bold) | Mozilla / Telefonica | OFL-1.1 |

## Fonts

Fira Sans is licensed under the SIL Open Font License, Version 1.1. The
licence text is served with the font files at `/assets/fonts/OFL.txt` and is
also included in this repository at `assets-src/fonts/OFL.txt`.

## Icons

The interface's icons are original inline SVG glyphs drawn by the app's own
components; no third-party icon files ship with the product.
