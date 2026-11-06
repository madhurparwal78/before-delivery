# Third-party notices

Every package in the production dependency tree (`npm ls --omit=dev --all --json`) and every bundled font is listed here with its licence. All of them are MIT, MIT-0, BSD, ISC, Apache-2.0 or SIL Open Font License 1.1.

Build-only tools (TypeScript, Vite and Playwright) are development dependencies: they are not part of the production tree and nothing from them is shipped.

## Bundled fonts

Served from `/fonts`, latin subsets only, with no runtime request to any other origin.

| Font | Licence |
| --- | --- |
| Big Shoulders Display | SIL Open Font License 1.1 |
| IBM Plex Sans | SIL Open Font License 1.1 |
| IBM Plex Mono | SIL Open Font License 1.1 |

## Shipped packages

83 packages, of which these four are declared directly: `express`, `nodemailer`, `pg`, `three`.

| Package | Version | Licence |
| --- | --- | --- |
| `accepts` | 1.3.8 | MIT |
| `array-flatten` | 1.1.1 | MIT |
| `body-parser` | 1.20.9 | MIT |
| `bytes` | 3.1.2 | MIT |
| `call-bind-apply-helpers` | 1.0.2 | MIT |
| `call-bound` | 1.0.4 | MIT |
| `content-disposition` | 0.5.4 | MIT |
| `content-type` | 1.0.5 | MIT |
| `cookie` | 0.7.2 | MIT |
| `cookie-signature` | 1.0.7 | MIT |
| `debug` | 2.6.9 | MIT |
| `depd` | 2.0.0 | MIT |
| `destroy` | 1.2.0 | MIT |
| `dunder-proto` | 1.0.1 | MIT |
| `ee-first` | 1.1.1 | MIT |
| `encodeurl` | 2.0.1 | MIT |
| `es-define-property` | 1.0.1 | MIT |
| `es-errors` | 1.3.0 | MIT |
| `es-object-atoms` | 1.1.2 | MIT |
| `escape-html` | 1.0.3 | MIT |
| `etag` | 1.8.1 | MIT |
| `express` | 4.22.3 | MIT |
| `finalhandler` | 1.3.2 | MIT |
| `forwarded` | 0.2.0 | MIT |
| `fresh` | 0.5.2 | MIT |
| `function-bind` | 1.1.2 | MIT |
| `get-intrinsic` | 1.3.0 | MIT |
| `get-proto` | 1.0.1 | MIT |
| `gopd` | 1.2.0 | MIT |
| `has-symbols` | 1.1.0 | MIT |
| `hasown` | 2.0.4 | MIT |
| `http-errors` | 2.0.1 | MIT |
| `iconv-lite` | 0.4.24 | MIT |
| `inherits` | 2.0.4 | ISC |
| `ipaddr.js` | 1.9.1 | MIT |
| `math-intrinsics` | 1.1.0 | MIT |
| `media-typer` | 0.3.0 | MIT |
| `merge-descriptors` | 1.0.3 | MIT |
| `methods` | 1.1.2 | MIT |
| `mime` | 1.6.0 | MIT |
| `mime-db` | 1.52.0 | MIT |
| `mime-types` | 2.1.35 | MIT |
| `ms` | 2.0.0 | MIT |
| `negotiator` | 0.6.3 | MIT |
| `nodemailer` | 10.3.1 | MIT-0 |
| `object-inspect` | 1.13.4 | MIT |
| `on-finished` | 2.4.2 | MIT |
| `parseurl` | 1.3.3 | MIT |
| `path-to-regexp` | 0.1.13 | MIT |
| `pg` | 8.23.1 | MIT |
| `pg-cloudflare` | 1.4.1 | MIT |
| `pg-connection-string` | 2.14.1 | MIT |
| `pg-int8` | 1.0.1 | ISC |
| `pg-pool` | 3.14.0 | MIT |
| `pg-protocol` | 1.16.1 | MIT |
| `pg-types` | 2.2.0 | MIT |
| `pgpass` | 1.0.5 | MIT |
| `postgres-array` | 2.0.0 | MIT |
| `postgres-bytea` | 1.0.1 | MIT |
| `postgres-date` | 1.0.7 | MIT |
| `postgres-interval` | 1.2.0 | MIT |
| `proxy-addr` | 2.0.8 | MIT |
| `qs` | 6.16.2 | BSD-3-Clause |
| `range-parser` | 1.2.1 | MIT |
| `raw-body` | 2.5.3 | MIT |
| `safe-buffer` | 5.2.1 | MIT |
| `safer-buffer` | 2.1.2 | MIT |
| `send` | 0.19.2 | MIT |
| `serve-static` | 1.16.3 | MIT |
| `setprototypeof` | 1.2.0 | ISC |
| `side-channel` | 1.1.1 | MIT |
| `side-channel-list` | 1.0.1 | MIT |
| `side-channel-map` | 1.0.1 | MIT |
| `side-channel-weakmap` | 1.0.2 | MIT |
| `split2` | 4.2.0 | ISC |
| `statuses` | 2.0.2 | MIT |
| `three` | 0.171.0 | MIT |
| `toidentifier` | 1.0.1 | MIT |
| `type-is` | 1.6.18 | MIT |
| `unpipe` | 1.0.0 | MIT |
| `utils-merge` | 1.0.1 | MIT |
| `vary` | 1.1.2 | MIT |
| `xtend` | 4.0.2 | MIT |

## Notes

- `pg` declares an optional peer dependency on `pg-native`, which this app never installs or ships, so it does not appear above.
- `nodemailer` is MIT-0, the MIT No Attribution variant, which is strictly more permissive than MIT.
