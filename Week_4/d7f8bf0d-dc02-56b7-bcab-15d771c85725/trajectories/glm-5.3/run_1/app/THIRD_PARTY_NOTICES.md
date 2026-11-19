# Third-party notices

Gandyboard ships the following third-party packages and typefaces. This list mirrors
the production dependency tree reported by `npm ls --omit=dev --all --json` at build time.

## Packages (runtime, server)

| Package | Version | Licence |
|---|---|---|
| `@redis/bloom` | 1.2.0 | MIT |
| `@redis/client` | 1.6.0 | MIT |
| `@redis/graph` | 1.1.1 | MIT |
| `@redis/json` | 1.0.7 | MIT |
| `@redis/search` | 1.2.0 | MIT |
| `@redis/time-series` | 1.1.0 | MIT |
| `@types/node` | 22.10.2 | MIT |
| `cluster-key-slot` | 1.1.2 | Apache-2.0 |
| `generic-pool` | 3.9.0 | MIT |
| `pg` | 8.13.1 | MIT |
| `pg-cloudflare` | 1.4.1 | MIT |
| `pg-connection-string` | 2.14.1 | MIT |
| `pg-int8` | 1.0.1 | ISC |
| `pg-pool` | 3.14.0 | MIT |
| `pg-protocol` | 1.16.1 | MIT |
| `pg-types` | 2.2.0 | MIT |
| `pgpass` | 1.0.6 | MIT |
| `postgres-array` | 2.0.0 | MIT |
| `postgres-bytea` | 1.0.1 | MIT |
| `postgres-date` | 1.0.7 | MIT |
| `postgres-interval` | 1.2.0 | MIT |
| `redis` | 4.7.0 | MIT |
| `undici-types` | 6.20.0 | MIT |
| `xtend` | 4.0.2 | MIT |
| `yallist` | 4.0.0 | ISC |

Frontend build-time libraries (`react`, `react-dom`, `scheduler`, `js-tokens`, `loose-envify`,
`three`, and the dev toolchain `vite`, `esbuild`, `typescript`, `tsx`, `@vitejs/plugin-react`)
are devDependencies; the React family and `three` are MIT licensed and are bundled into the
built frontend at build time. `esbuild` is MIT, `vite` is MIT, `typescript` is Apache-2.0.

## Typefaces

| Typeface | Licence |
|---|---|
| Fredoka (variable) | SIL Open Font License 1.1 |
| Karla (variable) | SIL Open Font License 1.1 |

Both typefaces were obtained from the Google Fonts project catalogue and are bundled with
the application inwoff2 form served from this application's own origin. Under the OFL-1.1
they may be bundled, served and redistributed; the reserved font names "Fredoka" and
"Karla" are used unmodified.

## Notice

Permission is hereby granted, free of charge, to any person obtaining a copy of this
software and associated documentation files (the "Software"), to deal in the Software
without restriction, including without limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons
to whom the Software is furnished to do so, subject to the following conditions: The above
copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
